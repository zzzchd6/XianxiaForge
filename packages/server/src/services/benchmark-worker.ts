/**
 * benchmark-worker.ts — 整本拆文后台 Worker（v1.5+）
 *
 * 职责：
 *   读取上传的 TXT → 按章切分 → 逐章清洗 → LLM 拆骨架/情节 → 向量化 → 写入 plot_material_benchmark
 *   通过回调推送 SSE 事件（chapter_start / chapter_complete / progress / complete / error）
 *
 * 复用：
 *   - generation_task 表做任务记录（task_type='benchmark_analysis'）
 *   - plot_material_retriever.ts::embedQuery() 做向量化（调用 Python embedding_server :8600）
 *   - BenchmarkBookAnalyzerAgent 做 LLM 拆解
 *
 * 降级红线：
 *   - embedding 不可用 → 跳过向量化，素材照常入库（embedding=NULL）
 *   - LLM 拆解失败 → 跳过该章，继续下一章
 *   - 任何异常不阻断整体流程
 */
import { readFileSync, unlinkSync } from 'fs';
import { creativeClient } from '../db/index.js';
import { BenchmarkBookAnalyzerAgent, type ChapterAnalysisResult } from '../agents/benchmark-book-analyzer.js';
import { embedQuery } from '../rag/plot-material-retriever.js';

// ─── 多编码文件读取（网文常见 utf-8 / gbk，移植自 Python extract_materials.py::read_txt）──

/**
 * 尝试多编码读取 TXT 文件，兼容中文网文常见的 GBK/GB18030 编码。
 * 优先 utf-8，其次 gb18030，再次 gbk，最后 utf-8 忽略无法解码的字节。
 */
function readTxtFile(filePath: string): string {
  const buf = readFileSync(filePath);

  // 1. 尝试 utf-8（先剥离 BOM）
  try {
    const textRaw = buf.toString('utf-8');
    // 验证：如果包含中文字符且无乱码特征字节，认为是正确的 utf-8
    const bomStripped = textRaw.replace(/^\uFEFF/, '');
    if (isValidChineseText(bomStripped)) {
      return bomStripped;
    }
  } catch { /* fall through */ }

  // 2. 尝试 gb18030（gbk 的超集，覆盖更广）
  try {
    const text = new TextDecoder('gb18030', { fatal: true }).decode(buf);
    return text;
  } catch { /* fall through */ }

  // 3. 尝试 gbk
  try {
    const text = new TextDecoder('gbk', { fatal: true }).decode(buf);
    return text;
  } catch { /* fall through */ }

  // 4. 兜底：utf-8 忽略无法解码的字节
  return buf.toString('utf-8').replace(/^\uFEFF/, '').replace(/[^\x00-\x7F\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\r\n]/g, '');
}

/** 快速检测文本是否基本合法（中文字符占比 > 50% 的网文正文） */
function isValidChineseText(text: string): boolean {
  // 取前 2000 字符检测
  const sample = text.slice(0, 2000);
  const cjk = sample.match(/[\u4e00-\u9fff]/g);
  if (!cjk) return false;
  return cjk.length / sample.length > 0.2;
}

// ─── 类型 ───────────────────────────────────────────────────

export interface BenchmarkTaskInput {
  sourceBookTitle: string;
  filePath: string;
  maxChapters: number; // 0 = 全部
}

export type BenchmarkStreamEvent =
  | { type: 'status'; data: { message: string; chapterIdx?: number; totalChapters?: number } }
  | { type: 'chapter_start'; data: { chapterIdx: number; title: string } }
  | { type: 'chapter_complete'; data: { chapterIdx: number; skeletonTitle: string | null; plotCount: number } }
  | { type: 'progress'; data: { completed: number; total: number; percent: number } }
  | { type: 'complete'; data: { totalChapters: number; totalItems: number; skipped: number } }
  | { type: 'error'; data: { message: string; chapterIdx?: number } };

type EventEmitter = (event: BenchmarkStreamEvent) => void;

// ─── 章节切分（移植自 Python benchmark_analyze.py::split_chapters）──

interface Chapter {
  idx: number;
  title: string;
  body: string;
}

const CHAPTER_HEAD_RE = /^\s*第\s*[0-9一二三四五六七八九十百千零两]+\s*[章话]\s*.{0,40}$/;

function splitChapters(raw: string): Chapter[] {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const heads: { lineStart: number; lineEnd: number; title: string }[] = [];

  let offset = 0;
  for (const line of text.split('\n')) {
    const stripped = line.trim();
    if (stripped && CHAPTER_HEAD_RE.test(stripped)) {
      heads.push({ lineStart: offset, lineEnd: offset + line.length, title: stripped });
    }
    offset += line.length + 1; // +1 = newline
  }

  const chapters: Chapter[] = [];
  for (let i = 0; i < heads.length; i++) {
    const { lineEnd, title } = heads[i];
    const bodyStart = lineEnd + 1 < text.length ? lineEnd + 1 : lineEnd;
    const bodyEnd = i + 1 < heads.length ? heads[i + 1].lineStart : text.length;
    const body = text.slice(bodyStart, bodyEnd);
    if (body.trim().length >= 100) {
      chapters.push({ idx: i + 1, title, body });
    }
  }

  return chapters;
}

// ─── 文本清洗（移植自 Python extract_materials.py::clean_text）──

const AD_LINE_PATTERNS = [
  /^\s*(ps|PS|Ps)[：:、].*/,
  /^\s*(作者|作者君|笔者)[：:].*/,
  /.*(求月票|求推荐|求订阅|求收藏|求打赏|月票|推荐票).*/,
  /.*(本章说|感谢.*打赏|感谢.*月票|加更).*/,
  /.*(https?:\/\/|www\.|\.com|\.net|\.org).*/,
  /.*(最新章节|手机阅读|请记住本站|txt下载|全文阅读|无弹窗|笔趣|飘天|起点中文).*/,
  /^\s*[-—=*·]{3,}\s*$/,
  /^\s*第[0-9一二三四五六七八九十百千]+[章节卷].{0,30}$/,
];

const CJK_RE = /[\u4e00-\u9fff]/g;

function cleanText(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const kept: string[] = [];
  const seenRecent: string[] = [];

  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    if (AD_LINE_PATTERNS.some((p) => p.test(s))) continue;

    // 乱码行：长度>10 且中文占比<20%
    if (s.length > 10) {
      const cjkMatches = s.match(CJK_RE);
      const cjkCount = cjkMatches ? cjkMatches.length : 0;
      if (cjkCount / s.length < 0.2) continue;
    }

    // 去相邻重复段落
    if (seenRecent.includes(s)) continue;
    seenRecent.push(s);
    if (seenRecent.length > 5) seenRecent.shift();

    kept.push(s);
  }

  return kept.join('\n');
}

// ─── 向量化（best-effort，失败返回 null）──────────────────

async function tryEmbed(text: string): Promise<string | null> {
  try {
    const vec = await embedQuery(text.slice(0, 500));
    if (!vec?.length) return null;
    return `[${vec.join(',')}]`;
  } catch {
    return null;
  }
}

// ─── 入库 ──────────────────────────────────────────────────

interface InsertItem {
  projectId: number;
  sourceBookTitle: string;
  itemType: 'skeleton' | 'plot';
  chapterIdx: number;
  materialType: string; // encounter/foreshadow/highlight/task for plot; '' for skeleton
  title: string;
  contentMd: string;
  tags: string[];
  setupRatio: number | null;
  developRatio: number | null;
  turnRatio: number | null;
  resolveRatio: number | null;
  emotionCurve: number[] | null;
  hook: string | null;
  qualityScore: number;
  sourceSnippet: string | null;
  embedding: string | null;
}

async function insertBenchmarkItem(item: InsertItem): Promise<number> {
  const vec = item.embedding ? `$18::vector` : 'NULL';
  const sql = `INSERT INTO plot_material_benchmark
    (project_id, source_book_title, material_type, title, content_md, tags, pinned, is_deleted,
     item_type, chapter_idx, setup_ratio, develop_ratio, turn_ratio, resolve_ratio,
     emotion_curve, hook, quality_score, source_snippet, embedding)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, false, false,
            $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, ${vec})
    RETURNING id`;

  const params: any[] = [
    item.projectId, item.sourceBookTitle, item.materialType || 'plot_unit',
    item.title, item.contentMd, JSON.stringify(item.tags),
    item.itemType, item.chapterIdx,
    item.setupRatio, item.developRatio, item.turnRatio, item.resolveRatio,
    item.emotionCurve, item.hook, item.qualityScore, item.sourceSnippet,
  ];

  if (item.embedding) params.push(item.embedding);

  const rows = await creativeClient.unsafe(sql, params) as unknown as { id: number }[];
  return rows[0].id;
}

// ─── 主 Worker ─────────────────────────────────────────────

export async function runBenchmarkBookTask(
  taskId: number,
  input: BenchmarkTaskInput,
  projectId: number,
  emit: EventEmitter,
): Promise<{ totalItems: number; totalChapters: number; skipped: number }> {
  const agent = new BenchmarkBookAnalyzerAgent();
  let totalItems = 0;
  let skipped = 0;

  // 1. 读取文件
  emit({ type: 'status', data: { message: '正在读取文件...' } });
  let rawText: string;
  try {
    rawText = readTxtFile(input.filePath);
    // 验证可读性：检查是否包含中文字符
    const cjkCheck = rawText.match(/[\u4e00-\u9fff]/g);
    if (!cjkCheck || cjkCheck.length < 10) {
      emit({ type: 'error', data: { message: '文件内容异常：可能为乱码或不支持的编码，请确认文件为 UTF-8 或 GBK 编码的中文 TXT' } });
      throw new Error('文件内容异常');
    }
  } catch (err: any) {
    emit({ type: 'error', data: { message: `读取文件失败: ${err?.message || err}` } });
    throw err;
  }

  // 2. 切章
  emit({ type: 'status', data: { message: '正在切分章节...' } });
  const allChapters = splitChapters(rawText);

  if (allChapters.length === 0) {
    emit({ type: 'error', data: { message: '未识别到章节（需含「第X章」标题行）' } });
    return { totalItems: 0, totalChapters: 0, skipped: 0 };
  }

  // 限制章节数
  const chapters = input.maxChapters > 0 ? allChapters.slice(0, input.maxChapters) : allChapters;
  const totalChapters = chapters.length;
  emit({ type: 'status', data: { message: `共识别 ${allChapters.length} 章，本次拆解 ${totalChapters} 章`, totalChapters } });

  // 3. 逐章处理
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];

    emit({ type: 'chapter_start', data: { chapterIdx: ch.idx, title: ch.title } });
    emit({ type: 'status', data: { message: `正在拆解第 ${ch.idx} 章：${ch.title}`, chapterIdx: ch.idx, totalChapters } });

    // 清洗章体
    const cleanedBody = cleanText(ch.body);

    if (cleanedBody.length < 300) {
      skipped++;
      emit({ type: 'chapter_complete', data: { chapterIdx: ch.idx, skeletonTitle: null, plotCount: 0 } });
      emit({ type: 'progress', data: { completed: i + 1, total: totalChapters, percent: Math.round(((i + 1) / totalChapters) * 100) } });
      continue;
    }

    // LLM 拆解
    let result: ChapterAnalysisResult;
    try {
      result = await agent.analyzeChapter(ch.idx, ch.title, cleanedBody);
    } catch (err: any) {
      skipped++;
      emit({ type: 'error', data: { message: `第${ch.idx}章拆解失败: ${err?.message || err}`, chapterIdx: ch.idx } });
      emit({ type: 'progress', data: { completed: i + 1, total: totalChapters, percent: Math.round(((i + 1) / totalChapters) * 100) } });
      continue;
    }

    // 入库骨架
    if (result.skeleton) {
      const parts: string[] = [];
      if (result.skeleton.setup) parts.push(`起：${result.skeleton.setup}`);
      if (result.skeleton.develop) parts.push(`承：${result.skeleton.develop}`);
      if (result.skeleton.turn) parts.push(`转：${result.skeleton.turn}`);
      if (result.skeleton.resolve) parts.push(`合：${result.skeleton.resolve}`);
      const contentMd = parts.join('\n') || result.skeleton.title;
      const embedText = `${result.skeleton.title} ${contentMd}`;

      const embedding = await tryEmbed(embedText);
      try {
        await insertBenchmarkItem({
          projectId,
          sourceBookTitle: input.sourceBookTitle,
          itemType: 'skeleton',
          chapterIdx: ch.idx,
          materialType: '',
          title: result.skeleton.title,
          contentMd,
          tags: ['骨架'],
          setupRatio: result.skeleton.ratios?.[0] ?? null,
          developRatio: result.skeleton.ratios?.[1] ?? null,
          turnRatio: result.skeleton.ratios?.[2] ?? null,
          resolveRatio: result.skeleton.ratios?.[3] ?? null,
          emotionCurve: result.skeleton.emotionCurve,
          hook: result.skeleton.hook,
          qualityScore: result.skeleton.qualityScore,
          sourceSnippet: null,
          embedding,
        });
        totalItems++;
      } catch (err: any) {
        console.warn(`[benchmark-worker] 骨架入库失败 第${ch.idx}章: ${err?.message || err}`);
      }
    }

    // 入库情节
    for (const plot of result.plots) {
      const embedText = `${plot.title} ${plot.content}`;
      const embedding = await tryEmbed(embedText);
      try {
        await insertBenchmarkItem({
          projectId,
          sourceBookTitle: input.sourceBookTitle,
          itemType: 'plot',
          chapterIdx: ch.idx,
          materialType: plot.materialType,
          title: plot.title,
          contentMd: plot.content,
          tags: plot.tags,
          setupRatio: null,
          developRatio: null,
          turnRatio: null,
          resolveRatio: null,
          emotionCurve: null,
          hook: null,
          qualityScore: plot.qualityScore,
          sourceSnippet: plot.sourceSnippet,
          embedding,
        });
        totalItems++;
      } catch (err: any) {
        console.warn(`[benchmark-worker] 情节入库失败 第${ch.idx}章: ${err?.message || err}`);
      }
    }

    emit({
      type: 'chapter_complete',
      data: { chapterIdx: ch.idx, skeletonTitle: result.skeleton?.title ?? null, plotCount: result.plots.length },
    });
    emit({
      type: 'progress',
      data: { completed: i + 1, total: totalChapters, percent: Math.round(((i + 1) / totalChapters) * 100) },
    });
  }

  // 4. 清理临时文件
  try {
    unlinkSync(input.filePath);
  } catch {
    // 忽略
  }

  // 5. 完成
  emit({
    type: 'complete',
    data: { totalChapters, totalItems, skipped },
  });

  return { totalItems, totalChapters, skipped };
}
