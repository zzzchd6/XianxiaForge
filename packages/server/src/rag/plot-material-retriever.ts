/**
 * 剧情素材 RAG 检索器（二期）
 * 从素材清洗工具蒸馏的 6 张表 + 对标拆文库中语义召回：
 *   - 剧情素材（encounter/foreshadow/highlight/task）
 *   - 对标拆解节点（benchmark_item，拆文系统第一梯队）
 *   - 领域知识（plot_domain_knowledge）
 *   - 文风预设（style_preset，精确取优先）
 *
 * 红线：
 *   - source_snippet 永不进写作上下文（SELECT 不选取）
 *   - 查询向量只能来自 embedding_server（bge-small-zh-v1.5 / 512维）
 *   - 召回失败降级不阻断写作（返回空 + 日志）
 *   - 只读不写素材表
 */
import { creativeClient } from '../db/index.js';

// ─── 配置 ───────────────────────────────────────────────────────────────────

/** embedding_server 基础地址（不含 /v1 后缀） */
const EMBEDDING_SERVER_BASE = (process.env.EMBEDDING_SERVER_URL || 'http://127.0.0.1:8600').replace(/\/v1\/?$/, '');

/** 各类默认 topN */
const DEFAULT_TOP_N = { materials: 2, benchmark: 2, domain: 3, style: 1 };

/** 相似度下限（cosine score = 1 - distance） */
const DEFAULT_MIN_SCORE = 0.35;

// ─── 懒探活（5分钟缓存） ────────────────────────────────────────────────────

let healthCache: { available: boolean; checkedAt: number } = { available: false, checkedAt: 0 };
const HEALTH_TTL_MS = 5 * 60 * 1000;

async function isEmbeddingAvailable(): Promise<boolean> {
  const now = Date.now();
  if (now - healthCache.checkedAt < HEALTH_TTL_MS) {
    return healthCache.available;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${EMBEDDING_SERVER_BASE}/health`, { signal: controller.signal });
    clearTimeout(timer);
    const ok = res.ok;
    healthCache = { available: ok, checkedAt: now };
    if (!ok) console.warn('[RAG] embedding_server /health 返回非200，素材召回禁用');
    return ok;
  } catch (err: any) {
    healthCache = { available: false, checkedAt: now };
    console.warn(`[RAG] embedding_server 不可达(${err?.message || err})，素材召回降级为空`);
    return false;
  }
}

// ─── 向量化（直接调 /embed 简单接口，避免 OpenAI SDK 附加参数导致维度异常） ───

export async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch(`${EMBEDDING_SERVER_BASE}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: [text] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`embedding_server /embed 返回 HTTP ${res.status}`);
  }
  const body = await res.json() as { dim?: number; embeddings?: number[][] };
  const vec = body.embeddings?.[0];
  if (!vec || vec.length !== 512) {
    throw new Error(`embedding 维度异常: ${vec?.length ?? 'null'}（期望512）`);
  }
  return vec;
}

// ─── 召回结果类型 ────────────────────────────────────────────────────────────

export interface PlotMaterialHit {
  id: number;
  table: string;
  title: string;
  corePlot: string;
  triggerCondition?: string;
  reward?: string;
  costOrRisk?: string;
  emotionalBeat?: string;
  applicableSceneType?: string;
  tags?: string[];
  qualityScore?: number;
  score: number;
  /** 是否为作者手动固定的素材（true=必须融入，false=语义自动召回的灵感参考） */
  pinned?: boolean;
  /** 是否为确定性触发召回（1B：按章节类型/场景关键词硬触发，区别于语义召回） */
  deterministic?: boolean;
  /** 是否为作者收藏素材（7.2：true=召回加权 +0.08，表达用户偏好） */
  isCollected?: boolean;
  /** 最近一次被采用的章节号（7.2：用于近期已用惩罚，避免素材重复使用） */
  lastUsedChapter?: number;
}

/** 手动固定素材引用：{table, id} */
export interface PinnedMaterialRef {
  table: string;
  id: number;
}

export interface DomainKnowledgeHit {
  id: number;
  knowledgeType: string;
  applicableDomain?: string;
  title: string;
  content: string;
  tags?: string[];
  qualityScore?: number;
  score: number;
}

export interface StylePresetHit {
  id: number;
  styleName: string;
  author?: string;
  mentalModels?: string[];
  decisionHeuristics?: string[];
  descriptionRatio?: any;
  sentenceRules?: any;
  coreImagery?: string[];
  forbiddenWords?: string[];
  perspectiveRules?: string[];
  antiPatterns?: string[];
  confidence?: number;
}

export interface RagRecallResult {
  materials: PlotMaterialHit[];
  domain: DomainKnowledgeHit[];
  style: StylePresetHit | null;
  /** 召回耗时ms（含向量化） */
  elapsedMs: number;
  /** 是否降级（embedding不可用或查询异常） */
  degraded: boolean;
}

export interface RagRecallConfig {
  enabled: boolean;
  topN?: Partial<typeof DEFAULT_TOP_N>;
  minScore?: number;
  /** 文风预设精确取名称（优先于向量召回） */
  stylePresetName?: string;
  /** 手动固定的剧情素材引用（作者人工干预，强制注入，不受相似度阈值限制） */
  pinnedRefs?: PinnedMaterialRef[];
  /** 当前章节号（7.2：用于近期已用惩罚；缺省则省略惩罚，仅做收藏加权） */
  currentChapter?: number;
}

// ─── 主入口 ─────────────────────────────────────────────────────────────────

/**
 * 执行 RAG 素材召回（全降级保护）
 * @param queryText 章节意图组装的查询文本
 * @param projectId 当前项目ID（用于 project_id 过滤）
 * @param config 召回配置
 */
export async function recallPlotMaterials(
  queryText: string,
  projectId: number,
  config: RagRecallConfig
): Promise<RagRecallResult> {
  const t0 = Date.now();

  // 手动固定素材：独立于 embedding 探活，作者显式指定 → 强制注入（不受阈值/开关影响）
  const pinned = config.pinnedRefs?.length
    ? await fetchPinnedMaterials(config.pinnedRefs, projectId)
    : [];

  const empty: RagRecallResult = { materials: pinned, domain: [], style: null, elapsedMs: 0, degraded: true };

  // 自动召回关闭：仅返回固定素材
  if (!config.enabled) return { ...empty, degraded: false, elapsedMs: Date.now() - t0 };

  const topN = { ...DEFAULT_TOP_N, ...config.topN };
  const minScore = config.minScore ?? DEFAULT_MIN_SCORE;

  try {
    // 探活
    const available = await isEmbeddingAvailable();
    if (!available) {
      // 0.2 关键字降级：embedding 不可用时走 tags/title 关键字召回，保证召回永不熄火
      const fb = await recallMaterialsByKeywordFallback(queryText, projectId, topN.materials);
      const fbBench = await recallBenchmarkByKeyword(queryText, projectId, topN.benchmark);
      const materials = mergePinnedAndAuto(pinned, [...fb, ...fbBench], topN.materials);
      console.warn(`[RAG] embedding 不可用，关键字降级召回素材 ${fb.length} 条`);
      return { materials, domain: [], style: null, elapsedMs: Date.now() - t0, degraded: true };
    }

    // 向量化
    const qvec = await embedQuery(queryText);
    const vectorStr = `[${qvec.join(',')}]`;

    // 并行召回 4 类（剧情素材 / 对标拆解 / 领域知识 / 文风预设）
    const [autoMaterials, benchmark, domain, style] = await Promise.all([
      recallMaterials(vectorStr, projectId, topN.materials, minScore, config.currentChapter),
      recallBenchmarkItems(vectorStr, projectId, topN.benchmark, minScore),
      recallDomainKnowledge(vectorStr, projectId, topN.domain, minScore),
      recallStylePreset(vectorStr, projectId, topN.style, minScore, config.stylePresetName),
    ]);

    // 合并固定 + 自动：固定素材必出在前，自动召回（含对标拆解节点）去重后补足
    const materials = mergePinnedAndAuto(pinned, [...autoMaterials, ...benchmark], topN.materials);

    const elapsedMs = Date.now() - t0;
    console.log(`[RAG] 素材召回完成: 固定${pinned.length}条 自动${autoMaterials.length}条 对标${benchmark.length}条 领域${domain.length}条 文风${style ? 1 : 0}套 耗时${elapsedMs}ms`);
    return { materials, domain, style, elapsedMs, degraded: false };
  } catch (err: any) {
    console.warn(`[RAG] 素材召回异常降级: ${err?.message || err}`);
    return { ...empty, elapsedMs: Date.now() - t0 };
  }
}

/**
 * 合并手动固定素材与自动召回素材。
 * 固定素材始终保留在前（作者显式意图优先），自动召回去重后补足到预算上限。
 * 预算 = max(topN*2, 固定数 + topN)，确保固定素材不被截断。
 */
function mergePinnedAndAuto(
  pinned: PlotMaterialHit[],
  auto: PlotMaterialHit[],
  topN: number
): PlotMaterialHit[] {
  if (!pinned.length) return auto;
  const pinnedKeys = new Set(pinned.map((p) => `${p.table}:${p.id}`));
  const dedupAuto = auto.filter((a) => !pinnedKeys.has(`${a.table}:${a.id}`));
  const budget = Math.max(topN * 2, pinned.length + topN);
  return [...pinned, ...dedupAuto].slice(0, budget);
}

/**
 * 按 {table, id} 引用精确取回手动固定的素材（强制注入，不受相似度阈值限制）。
 * 仅过滤 is_deleted（不注入已删除素材）；不要求 embedding 非空。
 * 单表查询失败不影响其它表，降级跳过。
 */
export async function fetchPinnedMaterials(
  refs: PinnedMaterialRef[],
  projectId: number
): Promise<PlotMaterialHit[]> {
  const results: PlotMaterialHit[] = [];
  // 按表分组
  const byTable = new Map<string, number[]>();
  for (const ref of refs) {
    if (!MATERIAL_TABLES.includes(ref.table as any)) continue; // 忽略非法表名
    if (!Number.isInteger(ref.id)) continue;
    const arr = byTable.get(ref.table) || [];
    arr.push(ref.id);
    byTable.set(ref.table, arr);
  }

  for (const [table, ids] of byTable) {
    if (!ids.length) continue;
    try {
      const rows = await creativeClient.unsafe(`
        SELECT id, title, core_plot, trigger_condition, reward, cost_or_risk,
               emotional_beat, applicable_scene_type, tags, quality_score
        FROM ${table}
        WHERE NOT is_deleted AND id = ANY($1::bigint[])
          AND (project_id = $2 OR project_id IS NULL)
      `, [ids, projectId]);

      for (const row of rows) {
        results.push({
          id: Number(row.id),
          table,
          title: row.title,
          corePlot: row.core_plot,
          triggerCondition: row.trigger_condition || undefined,
          reward: row.reward || undefined,
          costOrRisk: row.cost_or_risk || undefined,
          emotionalBeat: row.emotional_beat || undefined,
          applicableSceneType: row.applicable_scene_type || undefined,
          tags: row.tags || undefined,
          qualityScore: row.quality_score ?? undefined,
          score: 1, // 固定素材视为满分相关
          pinned: true,
        });
      }
    } catch (err: any) {
      console.warn(`[RAG] 固定素材取回失败(${table}): ${err?.message || err}`);
    }
  }

  return results;
}

// ─── 剧情素材召回（4表同构） ─────────────────────────────────────────────────

const MATERIAL_TABLES = [
  'plot_material_encounter',
  'plot_material_foreshadow',
  'plot_material_highlight',
  'plot_material_task',
] as const;

async function recallMaterials(
  vectorStr: string,
  projectId: number,
  topN: number,
  minScore: number,
  currentChapter?: number
): Promise<PlotMaterialHit[]> {
  const perTable: PlotMaterialHit[][] = [];
  // 7.2 过量取：先按向量距离取 topN*3 候选，留出 JS 端收藏加权/已用惩罚的重排空间
  const fetchLimit = topN * 3;

  for (const table of MATERIAL_TABLES) {
    const tableHits: PlotMaterialHit[] = [];
    try {
      const rows = await creativeClient.unsafe(`
        SELECT id, title, core_plot, trigger_condition, reward, cost_or_risk,
               emotional_beat, applicable_scene_type, tags, quality_score,
               is_collected, last_used_chapter,
               1 - (embedding <=> $1::vector) AS score
        FROM ${table}
        WHERE NOT is_deleted AND embedding IS NOT NULL
          AND (project_id = $2 OR project_id IS NULL)
        ORDER BY embedding <=> $1::vector
        LIMIT $3
      `, [vectorStr, projectId, fetchLimit]);

      for (const row of rows) {
        if (row.score >= minScore) {
          tableHits.push({
            id: row.id,
            table,
            title: row.title,
            corePlot: row.core_plot,
            triggerCondition: row.trigger_condition || undefined,
            reward: row.reward || undefined,
            costOrRisk: row.cost_or_risk || undefined,
            emotionalBeat: row.emotional_beat || undefined,
            applicableSceneType: row.applicable_scene_type || undefined,
            tags: row.tags || undefined,
            qualityScore: row.quality_score ?? undefined,
            isCollected: row.is_collected,
            lastUsedChapter: row.last_used_chapter ?? undefined,
            score: row.score,
          });
        }
      }
    } catch (err: any) {
      console.warn(`[RAG] ${table} 召回失败: ${err?.message || err}`);
    }
    // 7.2 表内重排：综合分 = 相似度 + 收藏加权 - 近期已用惩罚，重排后截断到 topN
    const reranked = tableHits
      .map((hit) => ({ hit, final: computeWeightedScore(hit, currentChapter) }))
      .sort((a, b) => b.final - a.final)
      .slice(0, topN)
      .map((x) => x.hit);
    perTable.push(reranked);
  }

  // 7.1 分类配额：轮转公平合并，保证四类素材各占槽位，不被高分单类（如伏笔）挤没
  return fairMergePerTable(perTable, topN * 2);
}

// ─── 7.2 收藏加权综合分 ──────────────────────────────────────────────────────
/** 收藏素材加权幅度（表达用户偏好，使其在相近相似度下优先入选） */
const COLLECTED_BONUS = 0.08;
/** 近期已用惩罚幅度（避免同一素材短期内重复使用） */
const RECENT_USED_PENALTY = 0.05;
/** 近期已用判定窗口（章节差 <= 该值视为"刚用过"） */
const RECENT_USED_WINDOW = 3;

/**
 * 计算 7.2 综合分：在原始相似度之上叠加收藏加权与近期已用惩罚。
 * - 收藏素材 +COLLECTED_BONUS
 * - 若已知当前章节且 lastUsedChapter 距今 <= RECENT_USED_WINDOW，则 -RECENT_USED_PENALTY
 *   （currentChapter 缺省时省略惩罚，仅做收藏加权，保持简单）
 * 纯函数、无副作用，任何输入都不抛错（降级保护）。
 */
function computeWeightedScore(hit: PlotMaterialHit, currentChapter?: number): number {
  let final = hit.score;
  if (hit.isCollected) final += COLLECTED_BONUS;
  if (
    currentChapter != null &&
    hit.lastUsedChapter != null &&
    currentChapter - hit.lastUsedChapter <= RECENT_USED_WINDOW
  ) {
    final -= RECENT_USED_PENALTY;
  }
  return final;
}

// ─── 公平合并（7.1 分类配额） ────────────────────────────────────────────────
/**
 * 按"轮转"方式跨表合并：每轮每表先各取一席，保证四类素材公平获得槽位，
 * 避免高分单一类目把奇遇/任务挤出全局上限（topN*2）。
 */
function fairMergePerTable(perTable: PlotMaterialHit[][], budget: number): PlotMaterialHit[] {
  const merged: PlotMaterialHit[] = [];
  let rank = 0;
  let added = true;
  while (added && merged.length < budget) {
    added = false;
    for (const hits of perTable) {
      if (merged.length >= budget) break;
      if (rank < hits.length) {
        merged.push(hits[rank]);
        added = true;
      }
    }
    rank++;
  }
  return merged;
}

// ─── 关键字降级召回（0.2，embedding 不可用时的保险路径） ─────────────────────
/** 从查询文本粗提取关键字（词 token + 中文 bigram），供 tags 重叠 / title ILIKE 匹配 */
function extractKeywords(text: string): string[] {
  const kw = new Set<string>();
  const tokens = (text || '').split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2);
  for (const t of tokens) kw.add(t);
  const runs = (text || '').match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of runs) {
    for (let i = 0; i + 2 <= run.length; i++) kw.add(run.slice(i, i + 2));
  }
  return [...kw].slice(0, 40);
}

/** 将一行素材库记录映射为 PlotMaterialHit（降级路径复用，score 由 quality_score 归一） */
function mapMaterialRow(row: any, table: string, score: number): PlotMaterialHit {
  return {
    id: Number(row.id),
    table,
    title: row.title,
    corePlot: row.core_plot,
    triggerCondition: row.trigger_condition || undefined,
    reward: row.reward || undefined,
    costOrRisk: row.cost_or_risk || undefined,
    emotionalBeat: row.emotional_beat || undefined,
    applicableSceneType: row.applicable_scene_type || undefined,
    tags: row.tags || undefined,
    qualityScore: row.quality_score ?? undefined,
    isCollected: row.is_collected,
    lastUsedChapter: row.last_used_chapter ?? undefined,
    score,
  };
}

/**
 * 0.2 无向量降级：embedding_server 不可用时，用关键字对 tags[](GIN) 做重叠匹配 +
 * title ILIKE 兜底，按 quality_score 取 topN。质量低于语义召回，但保证召回永不熄火。
 */
async function recallMaterialsByKeywordFallback(
  queryText: string,
  projectId: number,
  topN: number
): Promise<PlotMaterialHit[]> {
  const keywords = extractKeywords(queryText);
  if (!keywords.length) return [];
  const patterns = keywords.map((k) => `%${k}%`);
  const perTable: PlotMaterialHit[][] = [];

  for (const table of MATERIAL_TABLES) {
    const tableHits: PlotMaterialHit[] = [];
    try {
      const rows = await creativeClient.unsafe(`
        SELECT id, title, core_plot, trigger_condition, reward, cost_or_risk,
               emotional_beat, applicable_scene_type, tags, quality_score,
               is_collected, last_used_chapter
        FROM ${table}
        WHERE NOT is_deleted
          AND (project_id = $1 OR project_id IS NULL)
          AND (tags && $2::text[] OR title ILIKE ANY($3::text[]))
        ORDER BY quality_score DESC NULLS LAST
        LIMIT $4
      `, [projectId, keywords, patterns, topN]);

      for (const row of rows) {
        const qs = row.quality_score != null ? Number(row.quality_score) : 5;
        tableHits.push(mapMaterialRow(row, table, qs / 10));
      }
    } catch (err: any) {
      console.warn(`[RAG] ${table} 关键字降级召回失败: ${err?.message || err}`);
    }
    perTable.push(tableHits);
  }

  return fairMergePerTable(perTable, topN * 2);
}

/** 0.2 单表关键字降级（供 recallMaterialsByQuery 在 embedding 不可用时复用） */
async function recallSingleTableByKeyword(
  queryText: string,
  table: string,
  projectId: number,
  topN: number
): Promise<PlotMaterialHit[]> {
  const keywords = extractKeywords(queryText);
  if (!keywords.length) return [];
  const patterns = keywords.map((k) => `%${k}%`);
  try {
    const rows = await creativeClient.unsafe(`
      SELECT id, title, core_plot, trigger_condition, reward, cost_or_risk,
             emotional_beat, applicable_scene_type, tags, quality_score,
             is_collected, last_used_chapter
      FROM ${table}
      WHERE NOT is_deleted
        AND (project_id = $1 OR project_id IS NULL)
        AND (tags && $2::text[] OR title ILIKE ANY($3::text[]))
      ORDER BY quality_score DESC NULLS LAST
      LIMIT $4
    `, [projectId, keywords, patterns, topN]);
    return rows.map((row: any) => {
      const qs = row.quality_score != null ? Number(row.quality_score) : 5;
      return mapMaterialRow(row, table, qs / 10);
    });
  } catch (err: any) {
    console.warn(`[RAG] ${table} 单表关键字降级召回失败: ${err?.message || err}`);
    return [];
  }
}

// ─── 确定性触发召回（1B：奇遇/任务硬触发，bypass 语义阈值） ──────────────────

/** 推进/关键型章节类型（这类章节更可能需要奇遇/任务驱动） */
const PROGRESSIVE_CHAPTER_TYPES = new Set([
  'progression', 'climax', 'revelation', 'singularity',
]);

/** 奇遇场景关键词（命中章节意图即确定性召回奇遇素材） */
const ENCOUNTER_SCENE_KEYWORDS = [
  '秘境', '洞府', '机缘', '奇遇', '传承', '遗迹', '宝物', '灵药', '仙府',
  '古墓', '异宝', '灵脉', '残卷', '秘籍', '天材地宝', '洞天', '福地', '夺宝',
];

export interface DeterministicRecallOptions {
  projectId: number;
  /** 章节类型（chapter_plan.chapterType） */
  chapterType?: string;
  /** 章节意图+场景拆解+情绪目标拼成的文本（用于关键词命中） */
  intentText?: string;
  /** 每类确定性取数上限（默认2） */
  topN?: number;
}

/**
 * 1B 确定性触发召回：不依赖 embedding，按章节类型/场景关键词硬触发。
 * - 奇遇：章节属推进/关键型，或意图命中奇遇关键词 → 取 applicable_scene_type IN ('transition','key') 的高分奇遇。
 * - 任务：按意图关键词对 tags[](GIN)/title 命中取高分任务（完整形态待 task_arc 状态化后按活跃任务取关联素材）。
 * 全降级保护：任何异常返回空数组，绝不阻断写作主流程。
 */
export async function recallDeterministicMaterials(
  opts: DeterministicRecallOptions
): Promise<PlotMaterialHit[]> {
  const { projectId, chapterType, intentText = '', topN = 2 } = opts;
  const results: PlotMaterialHit[] = [];
  const isProgressive = !!chapterType && PROGRESSIVE_CHAPTER_TYPES.has(chapterType);
  const hitEncounterKeyword = ENCOUNTER_SCENE_KEYWORDS.some((k) => intentText.includes(k));

  // 奇遇：推进/关键章 或 命中奇遇关键词 → 确定性取 transition/key 类
  if (isProgressive || hitEncounterKeyword) {
    try {
      const rows = await creativeClient.unsafe(`
        SELECT id, title, core_plot, trigger_condition, reward, cost_or_risk,
               emotional_beat, applicable_scene_type, tags, quality_score
        FROM plot_material_encounter
        WHERE NOT is_deleted
          AND (project_id = $1 OR project_id IS NULL)
          AND applicable_scene_type IN ('transition', 'key')
        ORDER BY quality_score DESC NULLS LAST
        LIMIT $2
      `, [projectId, topN]);
      for (const row of rows) {
        const qs = row.quality_score != null ? Number(row.quality_score) : 5;
        results.push({ ...mapMaterialRow(row, 'plot_material_encounter', qs / 10), deterministic: true });
      }
    } catch (err: any) {
      console.warn(`[RAG] 奇遇确定性触发召回失败: ${err?.message || err}`);
    }
  }

  // 任务：按意图关键词命中 tags/title（完整形态待 task_arc）
  const taskKeywords = extractKeywords(intentText).slice(0, 20);
  if (taskKeywords.length) {
    try {
      const patterns = taskKeywords.map((k) => `%${k}%`);
      const rows = await creativeClient.unsafe(`
        SELECT id, title, core_plot, trigger_condition, reward, cost_or_risk,
               emotional_beat, applicable_scene_type, tags, quality_score
        FROM plot_material_task
        WHERE NOT is_deleted
          AND (project_id = $1 OR project_id IS NULL)
          AND (tags && $2::text[] OR title ILIKE ANY($3::text[]))
        ORDER BY quality_score DESC NULLS LAST
        LIMIT $4
      `, [projectId, taskKeywords, patterns, topN]);
      for (const row of rows) {
        const qs = row.quality_score != null ? Number(row.quality_score) : 5;
        results.push({ ...mapMaterialRow(row, 'plot_material_task', qs / 10), deterministic: true });
      }
    } catch (err: any) {
      console.warn(`[RAG] 任务确定性触发召回失败: ${err?.message || err}`);
    }
  }

  return results;
}

// ─── 单表定向召回（供伏笔手法/成长高光联动复用） ─────────────────────────────

/**
 * 针对单张素材表做定向语义召回（内部自行向量化）。
 * 用于功能联动场景：伏笔台账埋/收时定向召回「伏笔手法」表，
 * 成长阶段跃迁时定向召回「高光」表。
 *
 * 全降级保护：embedding_server 不可用、向量化异常、SQL 异常均返回空数组，
 * 绝不抛错阻断写作主流程。
 *
 * @param queryText 组装好的查询文本（如伏笔标题+描述+DNA、成长阶段名+特质）
 * @param table 目标素材表名（必须是 MATERIAL_TABLES 之一）
 * @param projectId 当前项目ID（project_id 过滤）
 * @param topN 召回条数上限（默认2）
 * @param minScore 相似度下限（默认0.35）
 */
export async function recallMaterialsByQuery(
  queryText: string,
  table: string,
  projectId: number,
  topN = 2,
  minScore = DEFAULT_MIN_SCORE
): Promise<PlotMaterialHit[]> {
  if (!MATERIAL_TABLES.includes(table as any)) {
    console.warn(`[RAG] recallMaterialsByQuery 非法表名: ${table}`);
    return [];
  }
  if (!queryText || !queryText.trim()) return [];

  try {
    const available = await isEmbeddingAvailable();
    if (!available) return recallSingleTableByKeyword(queryText, table, projectId, topN);

    const qvec = await embedQuery(queryText);
    const vectorStr = `[${qvec.join(',')}]`;

    const rows = await creativeClient.unsafe(`
      SELECT id, title, core_plot, trigger_condition, reward, cost_or_risk,
             emotional_beat, applicable_scene_type, tags, quality_score,
             is_collected, last_used_chapter,
             1 - (embedding <=> $1::vector) AS score
      FROM ${table}
      WHERE NOT is_deleted AND embedding IS NOT NULL
        AND (project_id = $2 OR project_id IS NULL)
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `, [vectorStr, projectId, topN]);

    const results: PlotMaterialHit[] = [];
    for (const row of rows) {
      if (row.score >= minScore) {
        results.push({
          id: Number(row.id),
          table,
          title: row.title,
          corePlot: row.core_plot,
          triggerCondition: row.trigger_condition || undefined,
          reward: row.reward || undefined,
          costOrRisk: row.cost_or_risk || undefined,
          emotionalBeat: row.emotional_beat || undefined,
          applicableSceneType: row.applicable_scene_type || undefined,
          tags: row.tags || undefined,
          qualityScore: row.quality_score ?? undefined,
          isCollected: row.is_collected,
          lastUsedChapter: row.last_used_chapter ?? undefined,
          score: row.score,
        });
      }
    }
    return results;
  } catch (err: any) {
    console.warn(`[RAG] 单表定向召回失败(${table}): ${err?.message || err}`);
    return [];
  }
}

// ─── 对标拆解召回（拆文系统：benchmark_item，content 抽象模式，无 source_snippet 泄漏风险） ──

/** 将 benchmark_item 行映射为 PlotMaterialHit（content→corePlot，表名标记 benchmark_item） */
function mapBenchmarkRow(row: any, score: number): PlotMaterialHit {
  return {
    id: Number(row.id),
    table: 'benchmark_item',
    title: row.title,
    corePlot: row.content,
    tags: row.tags || undefined,
    qualityScore: row.quality_score ?? undefined,
    isCollected: row.is_collected,
    lastUsedChapter: row.last_used_chapter ?? undefined,
    score,
  };
}

/**
 * 对标拆解节点语义召回（拆文系统第一梯队）。
 * 仅取骨架/情节类节点（variable/arc 为后续梯队产物，入库后可直接召回）。
 * 全降级保护：SQL 异常返回空数组，不阻断写作主流程。
 */
async function recallBenchmarkItems(
  vectorStr: string,
  projectId: number,
  topN: number,
  minScore: number
): Promise<PlotMaterialHit[]> {
  try {
    const rows = await creativeClient.unsafe(`
      SELECT id, title, content, tags, quality_score,
             1 - (embedding <=> $1::vector) AS score
      FROM benchmark_item
      WHERE NOT is_deleted AND embedding IS NOT NULL
        AND (project_id = $2 OR project_id IS NULL)
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `, [vectorStr, projectId, topN]);
    return rows
      .filter((r: any) => r.score >= minScore)
      .map((r: any) => mapBenchmarkRow(r, r.score));
  } catch (err: any) {
    console.warn(`[RAG] benchmark_item 召回失败: ${err?.message || err}`);
    return [];
  }
}

/** 对标拆解关键字降级召回（embedding 不可用时的保险路径） */
async function recallBenchmarkByKeyword(
  queryText: string,
  projectId: number,
  topN: number
): Promise<PlotMaterialHit[]> {
  const keywords = extractKeywords(queryText);
  if (!keywords.length) return [];
  const patterns = keywords.map((k) => `%${k}%`);
  try {
    const rows = await creativeClient.unsafe(`
      SELECT id, title, content, tags, quality_score
      FROM benchmark_item
      WHERE NOT is_deleted
        AND (project_id = $1 OR project_id IS NULL)
        AND (tags && $2::text[] OR title ILIKE ANY($3::text[]))
      ORDER BY quality_score DESC NULLS LAST
      LIMIT $4
    `, [projectId, keywords, patterns, topN]);
    return rows.map((row: any) => {
      const qs = row.quality_score != null ? Number(row.quality_score) : 5;
      return mapBenchmarkRow(row, qs / 10);
    });
  } catch (err: any) {
    console.warn(`[RAG] benchmark_item 关键字降级召回失败: ${err?.message || err}`);
    return [];
  }
}

// ─── 领域知识召回 ────────────────────────────────────────────────────────────

async function recallDomainKnowledge(
  vectorStr: string,
  projectId: number,
  topN: number,
  minScore: number
): Promise<DomainKnowledgeHit[]> {
  try {
    const rows = await creativeClient.unsafe(`
      SELECT id, knowledge_type, applicable_domain, title, content, tags, quality_score,
             1 - (embedding <=> $1::vector) AS score
      FROM plot_domain_knowledge
      WHERE NOT is_deleted AND embedding IS NOT NULL
        AND (project_id = $2 OR project_id IS NULL)
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `, [vectorStr, projectId, topN]);

    return rows
      .filter((r: any) => r.score >= minScore)
      .map((r: any) => ({
        id: r.id,
        knowledgeType: r.knowledge_type,
        applicableDomain: r.applicable_domain || undefined,
        title: r.title,
        content: r.content,
        tags: r.tags || undefined,
        qualityScore: r.quality_score ?? undefined,
        score: r.score,
      }));
  } catch (err: any) {
    console.warn(`[RAG] plot_domain_knowledge 召回失败: ${err?.message || err}`);
    return [];
  }
}

// ─── 文风预设召回（精确取优先，向量兜底） ────────────────────────────────────

async function recallStylePreset(
  vectorStr: string,
  projectId: number,
  _topN: number,
  _minScore: number,
  stylePresetName?: string
): Promise<StylePresetHit | null> {
  try {
    // 优先精确取（按 style_name + project 作用域）
    if (stylePresetName) {
      const rows = await creativeClient.unsafe(`
        SELECT id, style_name, author, mental_models, decision_heuristics,
               description_ratio, sentence_rules, core_imagery, forbidden_words,
               perspective_rules, anti_patterns, confidence
        FROM style_preset
        WHERE NOT is_deleted
          AND style_name = $1
          AND (project_id = $2 OR project_id IS NULL)
        ORDER BY project_id NULLS LAST, "version" DESC
        LIMIT 1
      `, [stylePresetName, projectId]);

      if (rows.length > 0) {
        return mapStyleRow(rows[0]);
      }
    }

    // 向量兜底（无精确配置时，语义召回最相似的一套）
    const rows = await creativeClient.unsafe(`
      SELECT id, style_name, author, mental_models, decision_heuristics,
             description_ratio, sentence_rules, core_imagery, forbidden_words,
             perspective_rules, anti_patterns, confidence,
             1 - (embedding <=> $1::vector) AS score
      FROM style_preset
      WHERE NOT is_deleted AND embedding IS NOT NULL
        AND (project_id = $2 OR project_id IS NULL)
      ORDER BY embedding <=> $1::vector
      LIMIT 1
    `, [vectorStr, projectId]);

    if (rows.length > 0 && rows[0].score >= _minScore) {
      return mapStyleRow(rows[0]);
    }
    return null;
  } catch (err: any) {
    console.warn(`[RAG] style_preset 召回失败: ${err?.message || err}`);
    return null;
  }
}

function mapStyleRow(r: any): StylePresetHit {
  return {
    id: r.id,
    styleName: r.style_name,
    author: r.author || undefined,
    mentalModels: r.mental_models || undefined,
    decisionHeuristics: r.decision_heuristics || undefined,
    descriptionRatio: r.description_ratio || undefined,
    sentenceRules: r.sentence_rules || undefined,
    coreImagery: r.core_imagery || undefined,
    forbiddenWords: r.forbidden_words || undefined,
    perspectiveRules: r.perspective_rules || undefined,
    antiPatterns: r.anti_patterns || undefined,
    confidence: r.confidence != null ? Number(r.confidence) : undefined,
  };
}
