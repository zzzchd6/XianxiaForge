/**
 * BenchmarkBookAnalyzerAgent — 整本拆文 Agent（v1.5+）
 *
 * 移植自 Python sucaiqingxi/benchmark_analyze.py 的 LLM 拆解逻辑。
 * 输入：单章正文 → 输出：骨架(skeleton) + 情节模式(plots)
 *
 * 设计要点：
 * - 所有产出必须抽象化，禁止出现原文专名
 * - source_snippet 仅入库后台可见，禁止进写作上下文（红线）
 * - 低温 0.3 保证 JSON 稳定
 * - 失败返回空数组（best-effort 降级红线）
 */
import { BaseAgent } from './base.js';
import { z } from 'zod';

// ─── 类型定义 ───────────────────────────────────────────────

export interface SkeletonResult {
  title: string;
  setup: string | null;
  develop: string | null;
  turn: string | null;
  resolve: string | null;
  ratios: [number, number, number, number] | null;
  emotionCurve: number[] | null;
  hook: string | null;
  qualityScore: number;
}

export interface PlotResult {
  title: string;
  content: string;
  materialType: string; // encounter | foreshadow | highlight | task
  tags: string[];
  qualityScore: number;
  sourceSnippet: string | null;
}

export interface ChapterAnalysisResult {
  skeleton: SkeletonResult | null;
  plots: PlotResult[];
}

// ─── Zod 校验 schema ────────────────────────────────────────

const ratiosSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional();

// ─── Prompt（移植自 Python benchmark_analyze.py）────────────

const BENCH_SYSTEM_PROMPT = (
  '你是资深网文结构分析师，擅长把章节拆解为可跨作品复用的抽象结构骨架与情节模式。' +
  '所有产出必须抽象化，禁止出现原文专名（人名/地名/功法名/门派名）。只输出 JSON。'
);

function buildBenchPrompt(chapterIdx: number, chapterTitle: string, chapterText: string, maxPlots: number): string {
  return `拆解下方小说章节，输出两部分：A 章级骨架 skeleton，B 情节模式 plots（0-${maxPlots}条，宁缺毋滥）。

A. skeleton 字段:
- title(≤30字,本章结构功能抽象,如「低谷受辱→逆袭铺垫」)
- setup / develop / turn / resolve(起/承/转/合,各≤60字抽象描述,某段缺失则null)
- ratios([起,承,转,合]4个0-1小数,合计1,缺失段为0)
- emotion_curve(4-8个0-10整数,按章节推进的情绪张力曲线,首→尾)
- hook(≤80字|null,章末钩子/悬念手法)
- quality_score(1-10)

B. plots 每条字段:
- title(≤30字,抽象禁专名) · content(≤150字,触发→经过→结果,抽象化可跨世界观复用)
- material_type(encounter奇遇|foreshadow伏笔手法|highlight人物高光|task任务链,选最贴合的一类)
- tags(2-5个) · quality_score(1-10) · source_snippet(≤80字原句|null)

输出严格JSON:
{"skeleton":{"title":"","setup":"","develop":"","turn":"","resolve":"","ratios":[0.2,0.3,0.3,0.2],"emotion_curve":[3,5,2,8],"hook":"","quality_score":8},"plots":[...]}

【第${chapterIdx}章 ${chapterTitle}】
${chapterText}`;
}

// ─── Agent 实现 ─────────────────────────────────────────────

export class BenchmarkBookAnalyzerAgent extends BaseAgent {
  private maxPlots: number;
  private maxChapterChars: number;

  constructor(maxPlots = 3, maxChapterChars = 7000) {
    super('BenchmarkBookAnalyzer', 3);
    this.maxPlots = maxPlots;
    this.maxChapterChars = maxChapterChars;
  }

  /**
   * 拆解单章正文
   * @param chapterIdx 章节序号（1 起）
   * @param chapterTitle 章节标题
   * @param chapterText 章节正文（已清洗）
   * @returns 骨架 + 情节模式；失败返回 { skeleton: null, plots: [] }
   */
  async analyzeChapter(
    chapterIdx: number,
    chapterTitle: string,
    chapterText: string,
  ): Promise<ChapterAnalysisResult> {
    // 截断超长章节
    const text = chapterText.length > this.maxChapterChars
      ? chapterText.slice(0, this.maxChapterChars)
      : chapterText;

    if (text.length < 300) {
      this.log(`第${chapterIdx}章 正文过短（${text.length}字），跳过`);
      return { skeleton: null, plots: [] };
    }

    const user = buildBenchPrompt(chapterIdx, chapterTitle.trim(), text, this.maxPlots);
    const messages = this.buildMessages(BENCH_SYSTEM_PROMPT, user);

    try {
      const response = await this.callWithRetry(messages, {
        temperature: 0.3,
        maxTokens: 8192,
      });
      const parsed = this.parseJsonResponse<any>(response);
      return this.validateResult(parsed, chapterIdx);
    } catch (err: any) {
      this.log(`第${chapterIdx}章 拆解失败（降级为空）: ${err?.message || err}`, 'warn');
      return { skeleton: null, plots: [] };
    }
  }

  /** 校验并规范化 LLM 输出 */
  private validateResult(raw: any, _chapterIdx: number): ChapterAnalysisResult {
    const skeleton = this.validateSkeleton(raw?.skeleton);
    const plots = this.validatePlots(raw?.plots);
    return { skeleton, plots };
  }

  private validateSkeleton(raw: any): SkeletonResult | null {
    if (!raw || typeof raw !== 'object') return null;
    const title = this.clipStr(raw.title, 200);
    if (!title) return null;

    const setup = this.clipStr(raw.setup, 300);
    const develop = this.clipStr(raw.develop, 300);
    const turn = this.clipStr(raw.turn, 300);
    const resolve = this.clipStr(raw.resolve, 300);

    // 如果四段全空，骨架无效
    if (!setup && !develop && !turn && !resolve) return null;

    const ratios = this.validateRatios(raw.ratios);
    const emotionCurve = this.validateEmotionCurve(raw.emotion_curve);
    const hook = this.clipStr(raw.hook, 500);
    const qualityScore = this.normQuality(raw.quality_score);

    return { title, setup, develop, turn, resolve, ratios, emotionCurve, hook, qualityScore };
  }

  private validatePlots(raw: any): PlotResult[] {
    if (!Array.isArray(raw)) return [];
    const validTypes = new Set(['encounter', 'foreshadow', 'highlight', 'task']);
    const results: PlotResult[] = [];

    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const title = this.clipStr(item.title, 200);
      const content = this.clipStr(item.content, 4000);
      if (!title || !content || content.length < 20) continue;

      let materialType = this.clipStr(item.material_type, 20) ?? '';
      if (!validTypes.has(materialType)) materialType = 'encounter';

      const tags = Array.isArray(item.tags)
        ? item.tags.map((t: any) => String(t)).filter(Boolean).slice(0, 5)
        : [];

      const qualityScore = this.normQuality(item.quality_score);
      const sourceSnippet = this.clipStr(item.source_snippet, 300);

      results.push({ title: title!, content: content!, materialType, tags, qualityScore, sourceSnippet });
    }

    return results;
  }

  private validateRatios(raw: any): [number, number, number, number] | null {
    if (!Array.isArray(raw) || raw.length !== 4) return null;
    const nums = raw.map((n: any) => {
      const v = Number(n);
      return isNaN(v) ? 0 : Math.max(0, Math.min(1, v));
    });
    return [nums[0], nums[1], nums[2], nums[3]];
  }

  private validateEmotionCurve(raw: any): number[] | null {
    if (!Array.isArray(raw) || raw.length < 2) return null;
    return raw
      .map((n: any) => {
        const v = Math.round(Number(n));
        return isNaN(v) ? 0 : Math.max(0, Math.min(10, v));
      })
      .slice(0, 8);
  }

  private clipStr(val: any, maxLen: number): string | null {
    if (val == null) return null;
    const s = String(val).trim();
    if (!s) return null;
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  }

  private normQuality(val: any): number {
    const v = Math.round(Number(val));
    if (isNaN(v)) return 0;
    return Math.max(0, Math.min(10, v));
  }
}
