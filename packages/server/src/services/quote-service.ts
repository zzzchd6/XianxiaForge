/**
 * 金句完整流程服务（需求11）
 * 编排：候选提取 → 去重 → 五维评分+二次校验 → 三版本美化 → 入库。
 * 并提供：手动打磨任意句子、重新评分、回写正文（搜索+替换，无撤销链）。
 * 降级红线：美化失败不阻断入库（原样入库，polishStatus='none'）。
 */
import { eq, and, isNotNull } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { extractQuoteCandidates } from '../pipeline/quote-extractor.js';
import { quoteJudgeAgent, gradeOfTotal, type QuoteScores } from '../agents/quote-judge.js';
import { quotePolisherAgent, type PolishVersion } from '../agents/quote-polisher.js';

/** 每章正式入库上限（宁缺毋滥） */
const MAX_STORED_PER_CHAPTER = 3;
/** 每章待打磨候选上限 */
const MAX_CANDIDATE_PER_CHAPTER = 3;
/** 待打磨候选最低总分（低于此分直接丢弃） */
const CANDIDATE_MIN_TOTAL = 70;
/** 正式入库最低总分 */
const STORE_MIN_TOTAL = 80;

export interface QuotePipelineResult {
  /** 正式入库条数（传世/精品） */
  stored: number;
  /** 待打磨候选条数（70-79分） */
  candidates: number;
  /** 美化成功条数 */
  polished: number;
}

/** 文本归一化：去标点空白，用于去重比较 */
function normalizeQuote(s: string): string {
  return s.replace(/[\s，。！？、；：""''…—·,.!?;:'"()（）【】《》\u3000]/g, '');
}

/** 判断候选与已有金句是否重复（归一化后相等或互相包含） */
function isDuplicate(candidateNorm: string, existingNorms: string[]): boolean {
  if (candidateNorm.length < 6) return false;
  return existingNorms.some((e) => {
    if (e.length < 6) return false;
    return e === candidateNorm || e.includes(candidateNorm) || candidateNorm.includes(e);
  });
}

/**
 * 章节生成后的金句完整管线（fire-and-forget调用）
 * @param projectId 项目ID
 * @param chapterId 章节计划ID（chapter_plan.id，与旧逻辑一致）
 * @param content 章节正文
 * @param title 章节标题
 */
export async function runQuotePipeline(
  projectId: number,
  chapterId: number,
  content: string,
  title?: string
): Promise<QuotePipelineResult> {
  const result: QuotePipelineResult = { stored: 0, candidates: 0, polished: 0 };

  // [步骤1] 候选提取（温度0.2）
  const candidates = await extractQuoteCandidates(projectId, content, title);
  if (candidates.length === 0) return result;

  // [步骤1.5] 去重：与本项目已有金句比对（归一化后相等/包含即视为重复）
  const existing = await creativeDb
    .select({ quoteText: schema.projectQuoteLib.quoteText })
    .from(schema.projectQuoteLib)
    .where(eq(schema.projectQuoteLib.projectId, projectId));
  const existingNorms = existing.map((r) => normalizeQuote(r.quoteText));
  const deduped = candidates.filter((c) => !isDuplicate(normalizeQuote(c.quoteText), existingNorms));
  if (deduped.length === 0) return result;

  // [步骤2] 五维评分 + 二次校验（温度0.1）
  const verdicts = await quoteJudgeAgent.evaluate(deduped);
  const accepted: {
    candidate: (typeof deduped)[number];
    scores: QuoteScores;
    grade: 'legendary' | 'good' | 'candidate';
  }[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const v = verdicts[i];
    if (!v) continue;
    const { total } = v.scores;
    if (v.worthy && total >= STORE_MIN_TOTAL && result.stored < MAX_STORED_PER_CHAPTER) {
      accepted.push({ candidate: deduped[i], scores: v.scores, grade: gradeOfTotal(total) });
      result.stored++;
    } else if (v.worthy && total >= CANDIDATE_MIN_TOTAL && result.candidates < MAX_CANDIDATE_PER_CHAPTER) {
      accepted.push({ candidate: deduped[i], scores: v.scores, grade: 'candidate' });
      result.candidates++;
    }
    // 其余（worthy=false 或 <70分）直接丢弃
  }
  if (accepted.length === 0) return result;

  // [步骤3] 智能美化（温度0.7）：仅正式入库的金句自动美化；候选留给用户手动打磨
  const rows = await Promise.all(
    accepted.map(async (a) => {
      let versions: PolishVersion[] = [];
      if (a.grade !== 'candidate') {
        try {
          versions = await quotePolisherAgent.polish(a.candidate.quoteText, {
            characterName: a.candidate.characterName,
            sceneDesc: a.candidate.sceneDesc,
          });
        } catch {
          versions = []; // 美化失败降级：原样入库
        }
      }
      if (versions.length > 0) result.polished++;
      const recommended = versions.find((v) => v.style === 'balanced') || versions[0];
      return {
        projectId,
        chapterId,
        characterId: null,
        characterName: a.candidate.characterName || null,
        quoteText: a.candidate.quoteText,
        originalText: a.candidate.quoteText,
        polishedText: recommended?.text ?? null,
        polishedVersions: versions,
        sceneDesc: a.candidate.sceneDesc || null,
        qualityScore: a.scores.total,
        scores: a.scores,
        grade: a.grade,
        polishStatus: versions.length > 0 ? 'polished' : 'none',
        isCollected: false,
        sourceType: 'auto' as const,
      };
    })
  );

  // [步骤4] 入库
  await creativeDb.insert(schema.projectQuoteLib).values(rows);
  return result;
}

/**
 * 对已入库金句（重新）美化，保存3版本并标记polish_status='polished'
 */
export async function polishQuoteRow(quoteId: number) {
  const [row] = await creativeDb
    .select()
    .from(schema.projectQuoteLib)
    .where(eq(schema.projectQuoteLib.id, quoteId));
  if (!row) return null;

  const sourceText = row.originalText || row.quoteText;
  const versions = await quotePolisherAgent.polish(sourceText, {
    characterName: row.characterName ?? undefined,
    sceneDesc: row.sceneDesc ?? undefined,
  });
  if (versions.length === 0) throw new Error('美化未返回有效版本');

  const recommended = versions.find((v) => v.style === 'balanced') || versions[0];
  const [updated] = await creativeDb
    .update(schema.projectQuoteLib)
    .set({
      polishedVersions: versions,
      polishedText: recommended.text,
      polishStatus: 'polished',
    })
    .where(eq(schema.projectQuoteLib.id, quoteId))
    .returning();
  return updated;
}

/**
 * 打磨任意句子（US-5手动入口）：先评分判断价值，有价值才生成3版本
 */
export async function polishAnyText(text: string): Promise<{
  scores: QuoteScores;
  grade: 'legendary' | 'good' | 'candidate';
  isWorth: boolean;
  reason: string;
  versions: PolishVersion[];
}> {
  const verdicts = await quoteJudgeAgent.evaluate([{ quoteText: text }]);
  const v = verdicts[0];
  if (!v) throw new Error('评分失败');
  const grade = gradeOfTotal(v.scores.total);
  const isWorth = v.worthy && v.scores.total >= CANDIDATE_MIN_TOTAL;
  let versions: PolishVersion[] = [];
  if (isWorth) {
    try {
      versions = await quotePolisherAgent.polish(text);
    } catch {
      versions = [];
    }
  }
  return { scores: v.scores, grade, isWorth, reason: v.reason, versions };
}

/**
 * 重新评分（US-4）：重跑judge更新分数与分级（待打磨候选可借此升级）
 */
export async function rescoreQuote(quoteId: number) {
  const [row] = await creativeDb
    .select()
    .from(schema.projectQuoteLib)
    .where(eq(schema.projectQuoteLib.id, quoteId));
  if (!row) return null;

  const verdicts = await quoteJudgeAgent.evaluate([{ quoteText: row.quoteText }]);
  const v = verdicts[0];
  if (!v) throw new Error('评分失败');

  const grade = gradeOfTotal(v.scores.total);
  const [updated] = await creativeDb
    .update(schema.projectQuoteLib)
    .set({ scores: v.scores, qualityScore: v.scores.total, grade })
    .where(eq(schema.projectQuoteLib.id, quoteId))
    .returning();
  return updated;
}

/** 回写正文：目标章节定位 + 搜索替换预览 + 确认替换（无撤销链，评估文档拍板） */

export type ApplyVersion = 'original' | 'conservative' | 'balanced' | 'deep' | 'current';

interface LocatedChapter {
  id: number;
  title: string;
  chapterNo: number | null;
  content: string;
}

/** 由金句的chapterId定位当前正文（兼容存的是generated_chapter.id或chapter_plan.id） */
async function locateChapterForQuote(quote: { chapterId: number | null }): Promise<LocatedChapter | null> {
  if (!quote.chapterId) return null;
  // 先按 generated_chapter.id 查
  const byId = await creativeDb
    .select({ id: schema.generatedChapter.id, title: schema.generatedChapter.title, chapterNo: schema.generatedChapter.chapterNo, content: schema.generatedChapter.content })
    .from(schema.generatedChapter)
    .where(and(eq(schema.generatedChapter.id, quote.chapterId), eq(schema.generatedChapter.isCurrent, true), isNotNull(schema.generatedChapter.content)));
  if (byId.length > 0 && byId[0].content) return byId[0] as LocatedChapter;
  // 再按 chapter_plan_id 查（runner传入的是plan.id）
  const byPlan = await creativeDb
    .select({ id: schema.generatedChapter.id, title: schema.generatedChapter.title, chapterNo: schema.generatedChapter.chapterNo, content: schema.generatedChapter.content })
    .from(schema.generatedChapter)
    .where(and(eq(schema.generatedChapter.chapterPlanId, quote.chapterId), eq(schema.generatedChapter.isCurrent, true), isNotNull(schema.generatedChapter.content)))
    .orderBy(schema.generatedChapter.id);
  if (byPlan.length > 0) return byPlan[byPlan.length - 1] as LocatedChapter;
  return null;
}

/** 解析"选中的替换文本" */
function resolveReplacement(quote: any, version: ApplyVersion): string {
  if (version === 'original') return quote.originalText || quote.quoteText;
  if (version === 'current') return quote.polishedText || quote.quoteText;
  const versions: PolishVersion[] = Array.isArray(quote.polishedVersions) ? quote.polishedVersions : [];
  const hit = versions.find((v) => v.style === version);
  return hit?.text || quote.polishedText || quote.quoteText;
}

export interface ApplyPreview {
  found: boolean;
  chapterId: number | null;
  chapterTitle: string;
  chapterNo: number | null;
  /** 在正文中要替换的原句 */
  originalText: string;
  /** 替换后的新句 */
  replacement: string;
  /** 替换前上下文片段（原句标出） */
  beforeContext: string;
  /** 替换后上下文片段 */
  afterContext: string;
  message?: string;
}

/** 应用到正文-预览：搜索原句并生成前后对比（不写库） */
export async function applyPreview(quoteId: number, version: ApplyVersion): Promise<ApplyPreview> {
  const [quote] = await creativeDb
    .select()
    .from(schema.projectQuoteLib)
    .where(eq(schema.projectQuoteLib.id, quoteId));
  if (!quote) throw new Error('金句不存在');

  const original = quote.originalText || quote.quoteText;
  const replacement = resolveReplacement(quote, version);
  const empty: ApplyPreview = {
    found: false,
    chapterId: null,
    chapterTitle: '',
    chapterNo: null,
    originalText: original,
    replacement,
    beforeContext: '',
    afterContext: '',
  };

  const chapter = await locateChapterForQuote(quote);
  if (!chapter) {
    return { ...empty, message: '未找到来源章节正文，请手动复制替换' };
  }

  const idx = chapter.content.indexOf(original);
  if (idx === -1) {
    return {
      ...empty,
      chapterId: chapter.id,
      chapterTitle: chapter.title || '',
      chapterNo: chapter.chapterNo,
      message: '未在正文中找到原句，可能已被修改，请手动替换',
    };
  }

  const ctxStart = Math.max(0, idx - 40);
  const ctxEnd = Math.min(chapter.content.length, idx + original.length + 40);
  return {
    found: true,
    chapterId: chapter.id,
    chapterTitle: chapter.title || '',
    chapterNo: chapter.chapterNo,
    originalText: original,
    replacement,
    beforeContext: chapter.content.slice(ctxStart, ctxEnd),
    afterContext:
      chapter.content.slice(ctxStart, idx) + replacement + chapter.content.slice(idx + original.length, ctxEnd),
  };
}

/** 应用到正文-确认替换：仅替换第一处精确匹配 */
export async function applyToChapter(quoteId: number, version: ApplyVersion) {
  const preview = await applyPreview(quoteId, version);
  if (!preview.found || !preview.chapterId) {
    throw new Error(preview.message || '未在正文中找到原句');
  }

  const [chapter] = await creativeDb
    .select({ id: schema.generatedChapter.id, content: schema.generatedChapter.content })
    .from(schema.generatedChapter)
    .where(eq(schema.generatedChapter.id, preview.chapterId));
  if (!chapter?.content) throw new Error('章节正文读取失败');

  const original = preview.originalText;
  const idx = chapter.content.indexOf(original);
  if (idx === -1) throw new Error('未在正文中找到原句，可能已被修改');

  const newContent = chapter.content.slice(0, idx) + preview.replacement + chapter.content.slice(idx + original.length);
  await creativeDb
    .update(schema.generatedChapter)
    .set({ content: newContent, wordCount: newContent.length, updatedAt: new Date() })
    .where(eq(schema.generatedChapter.id, preview.chapterId));

  const [quote] = await creativeDb
    .update(schema.projectQuoteLib)
    .set({ polishStatus: 'applied', appliedAt: new Date() })
    .where(eq(schema.projectQuoteLib.id, quoteId))
    .returning();

  return {
    chapterId: preview.chapterId,
    chapterTitle: preview.chapterTitle,
    before: preview.beforeContext,
    after: preview.afterContext,
    quote,
  };
}
