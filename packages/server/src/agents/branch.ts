/**
 * 分支生成Agent - 章节生成完成后，基于本章正文产出若干"下一章走向选项"（需求12 章间分支）
 * 中温度（0.8）保证走向有创意但可控；输出结构化JSON，解析失败返回空数组（best-effort，不阻断主流程）
 *
 * 二期增强：
 *   - 注入四类剧情素材（奇遇/伏笔手法/人物高光/任务链），选项经 basedOn 回标借鉴来源（供前端标注）；
 *   - 注入世界观快照（人物/宗门规制/岁时节令/文风心智模型），额外产出 prediction（后续大概率怎么发展）。
 */
import { BaseAgent } from './base.js';
import type { LlmConfig } from '../types.js';
import type { ChatOptions, UsageInfo } from '../llm/client.js';
import type { PlotMaterialHit } from '../rag/plot-material-retriever.js';
import { MATERIAL_LABELS, resolveSourceMaterials, GROWTH_TYPE_LABELS, type BranchSourceMaterial, type BranchWorldview, type WorkshopEntityRef } from '../services/branch-context.js';
import {
  DIRECTION_CATALOG,
  getDirection,
  isDirectionEnabled,
  resolveEnabledCategories,
  inferDirectionFromText,
} from '../services/direction-catalog.js';

/** 定向生成的方向约束目标（主方向 + 0-2 次方向） */
export interface DirectionTarget {
  /** 指定的主方向编码（如 growth_realm） */
  main?: string;
  /** 指定的次方向编码数组（0-2） */
  secondary?: string[];
}

/** 方向生成选项（generateBranches 可选入参） */
export interface DirectionGenOptions {
  /** 定向生成的方向约束；缺省 = 自动模式（LLM 自由打标 + 规则保底） */
  targetDirections?: DirectionTarget;
  /** 项目启用的大类编码数组（缺省 = 默认前6大类） */
  enabledCategories?: string[];
}

/** 单个分支选项（LLM原始产出） */
export interface GeneratedBranchOption {
  /** 选项标题（简短概括走向） */
  title: string;
  /** 选项描述（给玩家看的剧情预览） */
  description: string;
  /** 选定后预设的下一章核心意图 */
  nextChapterIntent: string;
  /** 下一章场景提示（结构化） */
  nextSceneHint?: {
    sceneTitle?: string;
    location?: string;
    coreEvent?: string;
    effect?: string;
  };
  /** 影响标签（标记本走向对后续剧情的长线影响） */
  impactTags?: string[];
  /** 分支类型：normal=常规走向 / encounter=奇遇走向 / detour=绕路 / divergence=重大分歧 */
  optionType?: 'normal' | 'encounter' | 'detour' | 'divergence';
  /** 本选项借鉴的素材ID列表（LLM回标，对应注入素材的 #id） */
  basedOn?: number[];
  /** 主方向编码（方向体系，LLM 打标） */
  mainDirection?: string | null;
  /** 次方向编码数组（0-2，方向体系） */
  secondaryDirections?: string[];
  /** 方向匹配度评分 0-100（方向体系） */
  directionMatchScore?: number | null;
  // ---- 分支弧提议字段（动态叙事引擎 v2.1）----
  /** 分支核心假设（"如果硬闯山门会怎样"） */
  branchPremise?: string;
  /** 预计弧长度（1-5 章） */
  estimatedLength?: number;
  /** 分支核心冲突 */
  coreConflict?: string;
  /** 弧类型：approach/detour/consequence/divergence */
  arcType?: 'approach' | 'detour' | 'consequence' | 'divergence';
  /** 汇合目标里程碑 ID（从注入的里程碑列表中选） */
  convergeToMilestoneId?: number | null;
}

/** 附加了已解析素材来源与方向标签的分支选项（用于落库与前端标注） */
export interface EnrichedBranchOption extends GeneratedBranchOption {
  /** 校验后的素材引用 [{table,id,title,label}] */
  sourceMaterials: BranchSourceMaterial[];
  /** 校验/兜底后的主方向编码（null=未分类） */
  mainDirection: string | null;
  /** 校验/兜底后的次方向编码数组（0-2） */
  secondaryDirections: string[];
  /** 校验/兜底后的方向匹配度评分 */
  directionMatchScore: number;
}

/** 分支生成Agent原始输出 */
interface BranchRawOutput {
  options?: GeneratedBranchOption[];
  /** 基于世界观的"后续大概率怎么发展"简要推演 */
  prediction?: string;
}

/** 分支生成结果：选项列表 + 世界观推演 */
export interface BranchGenerationResult {
  options: EnrichedBranchOption[];
  prediction: string;
}

export class BranchGeneratorAgent extends BaseAgent {
  constructor() {
    super('BranchGeneratorAgent');
  }

  /**
   * 基于章节正文生成下一章走向选项 + 后续发展推演
   * @param content 本章正文
   * @param chapterMeta 章节元信息（章节号/标题/意图）
   * @param optionCount 期望产出的选项数量（2-4）
   * @param materials 注入的四类剧情素材（带 id/table，供借鉴与回标）
   * @param worldview 世界观快照（人物/宗门规制/岁时节令/文风），供推演
   * @param directionOpts 方向体系选项（定向生成的方向约束 + 项目启用大类），缺省=自动模式
   */
  async generateBranches(
    content: string,
    chapterMeta: { chapterNumber: number; title: string; intent?: string },
    optionCount: number,
    materials: PlotMaterialHit[],
    worldview: BranchWorldview,
    directionOpts?: DirectionGenOptions,
    workshopEntities?: WorkshopEntityRef[],
    llmConfig?: LlmConfig,
    onUsage?: (usage: UsageInfo, model: string) => void,
    milestones?: { id: number; label: string; description?: string | null; importance?: string | null }[],
  ): Promise<BranchGenerationResult> {
    const count = Math.max(2, Math.min(4, optionCount || 3));
    const mats = Array.isArray(materials) ? materials : [];
    const hasEncounter = mats.some((m) => m.table === 'plot_material_encounter');
    const enabledSet = resolveEnabledCategories(directionOpts?.enabledCategories);
    const target = directionOpts?.targetDirections;
    const msList = Array.isArray(milestones) ? milestones : [];
    const { systemPrompt, userPrompt } = this.buildPrompt(content, chapterMeta, count, mats, worldview, target, enabledSet, workshopEntities, msList);
    const messages = this.buildMessages(systemPrompt, userPrompt);

    const options: ChatOptions = {
      temperature: 0.8, // 走向需有创意但可控
      maxTokens: 2048,
      configOverride: llmConfig,
      onUsage,
    };

    this.log(`开始生成第${chapterMeta.chapterNumber}章的${count}个剧情分支（素材${mats.length}条）...`);
    const response = await this.callWithRetry(messages, options);

    let raw: BranchRawOutput;
    try {
      raw = this.parseJsonResponse<BranchRawOutput>(response);
    } catch (error: any) {
      this.log(`分支生成JSON解析失败: ${error.message}`, 'warn');
      return { options: [], prediction: '' };
    }

    const list = Array.isArray(raw.options) ? raw.options : [];
    // 校验并规整每个选项，剔除缺字段者；basedOn 解析为落库结构（过滤幻觉ID）
    const valid: EnrichedBranchOption[] = list
      .filter((o) => o && typeof o.title === 'string' && typeof o.nextChapterIntent === 'string')
      .map((o) => {
        const dir = this.resolveDirection(o, target, enabledSet);
        return {
          title: o.title.trim().slice(0, 200),
          description: typeof o.description === 'string' ? o.description.trim() : o.title.trim(),
          nextChapterIntent: o.nextChapterIntent.trim(),
          nextSceneHint: o.nextSceneHint && typeof o.nextSceneHint === 'object' ? o.nextSceneHint : undefined,
          impactTags: Array.isArray(o.impactTags)
            ? o.impactTags.filter((t): t is string => typeof t === 'string').slice(0, 6)
            : [],
          optionType: o.optionType === 'encounter' ? 'encounter' as const
            : o.optionType === 'detour' ? 'detour' as const
            : o.optionType === 'divergence' ? 'divergence' as const
            : 'normal' as const,
          basedOn: Array.isArray(o.basedOn) ? o.basedOn.map((x) => Number(x)).filter((x) => Number.isFinite(x)) : [],
          sourceMaterials: resolveSourceMaterials(o.basedOn, mats),
          mainDirection: dir.mainDirection,
          secondaryDirections: dir.secondaryDirections,
          directionMatchScore: dir.directionMatchScore,
          // ---- 分支弧提议字段（动态叙事引擎）：无效值降级为缺省，不阻断主流程 ----
          branchPremise: typeof o.branchPremise === 'string' ? o.branchPremise.trim().slice(0, 500) : undefined,
          estimatedLength: Number.isFinite(Number(o.estimatedLength)) ? Math.max(1, Math.min(5, Number(o.estimatedLength))) : 2,
          coreConflict: typeof o.coreConflict === 'string' ? o.coreConflict.trim().slice(0, 500) : undefined,
          arcType: ['approach', 'detour', 'consequence', 'divergence'].includes(o.arcType as string) ? o.arcType : undefined,
          convergeToMilestoneId: msList.some((m) => m.id === Number(o.convergeToMilestoneId)) ? Number(o.convergeToMilestoneId) : (msList[0]?.id ?? null),
        };
      })
      .slice(0, count);

    // 保底：注入了奇遇素材但 LLM 未产出奇遇类选项时，将最后一个选项标记为奇遇，确保至少一个奇遇走向
    if (hasEncounter && valid.length && !valid.some((v) => v.optionType === 'encounter')) {
      valid[valid.length - 1].optionType = 'encounter';
      this.log('LLM 未标记奇遇选项，已将末位选项保底标记为 encounter', 'warn');
    }

    const prediction = typeof raw.prediction === 'string' ? raw.prediction.trim().slice(0, 500) : '';

    this.log(`分支生成完成：有效选项${valid.length}个（奇遇${valid.filter((v) => v.optionType === 'encounter').length}个），推演${prediction ? '已产出' : '为空'}`);
    return { options: valid, prediction };
  }

  /**
   * 方向解析：白名单校验 + 定向强制修正 + 规则兜底（2.4.1 代码侧双重保底、2.4.2 自动打标）
   * - 定向生成模式（target.main 有效）：主方向强制取指定值，保证约束生效；次方向在 LLM 产出基础上补入指定次方向。
   * - 自动模式：LLM 主方向经字典+启用大类白名单校验，无效则用关键词规则推断；score<60 → 未分类(null)。
   */
  private resolveDirection(
    o: GeneratedBranchOption,
    target: DirectionTarget | undefined,
    enabledSet: Set<string>
  ): { mainDirection: string | null; secondaryDirections: string[]; directionMatchScore: number } {
    const text = `${o.title ?? ''} ${o.description ?? ''} ${o.nextChapterIntent ?? ''}`;
    const rawScore = Number(o.directionMatchScore);
    const llmScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : null;

    // 定向生成模式：主方向强制取指定值（约束必须生效）
    if (target?.main && getDirection(target.main) && isDirectionEnabled(target.main, enabledSet)) {
      const main = target.main;
      const secondary = this.sanitizeSecondary(o.secondaryDirections, main, enabledSet);
      for (const s of target.secondary ?? []) {
        if (secondary.length >= 2) break;
        if (s !== main && getDirection(s) && isDirectionEnabled(s, enabledSet) && !secondary.includes(s)) {
          secondary.push(s);
        }
      }
      return { mainDirection: main, secondaryDirections: secondary.slice(0, 2), directionMatchScore: llmScore ?? 80 };
    }

    // 自动模式：LLM 打标 → 白名单校验
    let main = typeof o.mainDirection === 'string' ? o.mainDirection.trim() : null;
    if (main && (!getDirection(main) || !isDirectionEnabled(main, enabledSet))) {
      main = null;
    }

    // 兜底：LLM 未给出有效主方向 → 关键词规则推断
    if (!main) {
      const inferred = inferDirectionFromText(text);
      const llmSec = this.sanitizeSecondary(o.secondaryDirections, inferred.mainDirection, enabledSet);
      const merged = [...llmSec];
      for (const s of inferred.secondaryDirections) {
        if (merged.length >= 2) break;
        if (s !== inferred.mainDirection && !merged.includes(s)) merged.push(s);
      }
      return { mainDirection: inferred.mainDirection, secondaryDirections: merged.slice(0, 2), directionMatchScore: inferred.directionMatchScore };
    }

    const secondary = this.sanitizeSecondary(o.secondaryDirections, main, enabledSet);
    return { mainDirection: main, secondaryDirections: secondary.slice(0, 2), directionMatchScore: llmScore ?? 70 };
  }

  /** 次方向数组白名单过滤：剔除无效/未启用/与主方向重复者，上限2个 */
  private sanitizeSecondary(raw: unknown, main: string | null, enabledSet: Set<string>): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const s of raw) {
      if (typeof s !== 'string') continue;
      const code = s.trim();
      if (!code || code === main) continue;
      if (!getDirection(code) || !isDirectionEnabled(code, enabledSet)) continue;
      if (!out.includes(code)) out.push(code);
      if (out.length >= 2) break;
    }
    return out;
  }

  private buildPrompt(
    content: string,
    meta: { chapterNumber: number; title: string; intent?: string },
    count: number,
    materials: PlotMaterialHit[],
    worldview: BranchWorldview,
    target: DirectionTarget | undefined,
    enabledSet: Set<string>,
    workshopEntities?: WorkshopEntityRef[],
    milestones?: { id: number; label: string; description?: string | null; importance?: string | null }[]
  ): { systemPrompt: string; userPrompt: string } {
    const hasEncounter = materials.some((m) => m.table === 'plot_material_encounter');
    const hasMaterials = materials.length > 0;
    const workshopRefs = Array.isArray(workshopEntities) ? workshopEntities : [];
    const msList = Array.isArray(milestones) ? milestones : [];
    const hasMilestones = msList.length > 0;

    const encounterRule = hasEncounter
      ? `\n- 重要：${count}个选项中建议有1个是"奇遇走向"（optionType 设为 "encounter"）——主角因机缘巧合获得奇遇（如意外传承、隐藏机缘、逆天宝物、神秘指点等），需自然借鉴下方奇遇素材，结合本章情境改编，不能生搬硬套。其余选项 optionType 设为 "normal"。`
      : '';

    const basedOnRule = hasMaterials
      ? `\n- 素材借鉴标注：每个选项可借鉴0-多条下方提供的剧情素材（奇遇/伏笔手法/人物高光/任务链）。若借鉴了某素材，必须在该选项的 basedOn 数组中回填其 #编号（整数）。未借鉴任何素材则 basedOn 为空数组。标注要诚实，只填真正用到的。`
      : '';

    const optionTypeFormat = hasEncounter
      ? `\n      "optionType": "normal 或 encounter（奇遇走向填 encounter）",`
      : '';
    const basedOnFormat = hasMaterials
      ? `\n      "basedOn": [借鉴的素材#编号，如 [123, 456]，未借鉴填 []],`
      : '';

    // ---- 动态叙事引擎：分支弧提议字段（有里程碑时额外要求汇合目标）----
    const arcFormat = `\n      "branchPremise": "分支核心假设（一句话，如：如果硬闯山门会怎样）",
      "estimatedLength": 2,
      "coreConflict": "这个分支弧的核心冲突（选择后要面对什么）",
      "arcType": "approach 或 detour 或 consequence 或 divergence",${hasMilestones ? `\n      "convergeToMilestoneId": 汇合目标里程碑ID（从下方【叙事里程碑】中选一个最合理的，填整数）,` : ''}`;

    // ---- 方向体系：注入启用方向字典 + 打标/定向约束规则 + 输出格式字段 ----
    const enabledDirections = DIRECTION_CATALOG.filter((d) => enabledSet.has(d.category));
    const directionListText = enabledDirections.map((d) => `${d.code}(${d.name})`).join('、');
    const targetMainDef = target?.main ? getDirection(target.main) : undefined;
    const isWorkshopTarget = targetMainDef?.category === 'workshop' && workshopRefs.length > 0;
    const workshopConstraint = isWorkshopTarget
      ? `\n- 【工坊联动约束】本次定向为「功法法宝」成长方向：选项剧情须围绕下方【成长工坊实体】中的功法/法宝展开（融合/变异/强化/进化/获得），并在 title 或 description 中实名引用至少一个工坊实体名称，不得虚构不存在的功法法宝名。`
      : '';
    const directionRule = targetMainDef
      ? `\n- 【方向约束】本次为定向生成：所有${count}个选项的主方向 mainDirection 必须统一填 "${targetMainDef.code}"（${targetMainDef.name}——${targetMainDef.definition}）。各选项在统一主方向下仍须保持具体剧情的实质差异（同向不同事，避免换汤不换药）。${target?.secondary?.length ? `次方向 secondaryDirections 请包含 ${target.secondary.map((s) => `"${s}"`).join('、')}。` : ''}${workshopConstraint}`
      : `\n- 方向打标：为每个选项从下方【启用方向字典】中选择1个最契合的主方向填入 mainDirection（填编码），可再附0-2个与主方向不同大类的次方向填入 secondaryDirections（编码数组），并给出 directionMatchScore（该走向与主方向契合度，0-100整数）。`;
    const directionFormat = `\n      "mainDirection": "主方向编码（取自启用方向字典）",\n      "secondaryDirections": ["次方向编码，0-2个"],\n      "directionMatchScore": 85,`;

    const systemPrompt = `你是一位擅长多线叙事的小说策划。你的任务是基于一个章节的结尾，为读者设计${count}个差异明显、各具吸引力的"下一章走向选项"，并结合世界观给出"后续大概率怎么发展"的简要推演。

设计原则：
- 每个选项必须承接本章结尾的情境，是本章结束后自然可能发生的走向，不能凭空跳跃。
- ${count}个选项之间要有实质性差异（如：进取/退守、追查/隐忍、结盟/独行），避免换汤不换药。
- 每个选项都要有清晰的戏剧张力和后续发展空间，不能是死胡同。
- nextChapterIntent 是选定该走向后下一章的写作核心意图，要具体可执行。
- 【分支弧思维】每个选项不是"下一章换个写法"，而是一个完整的小故事弧提议：选择后主角会经历什么、核心冲突如何展开、最终如何到达下一个里程碑。branchPremise 用一句话点明假设，coreConflict 写明弧的核心冲突，estimatedLength 估 1-5 章（默认 2，重大分歧可到 4-5）。arcType：approach=不同方式去同一目标 / detour=顺路绕一下再回来 / consequence=选择带来不同后果 / divergence=重大分歧可能改变后续走向。
- impactTags 标记该走向的长线影响（如"黑化线""失去挚友""获得传承"），0-3个，用于后续剧情一致性追踪，可为空数组。${encounterRule}${basedOnRule}${directionRule}
- prediction（后续发展推演）：结合下方世界观设定（人物性格与关系、宗门规制、岁时节令、文风心智模型），推断不按任何特定分支、故事自然演进时大概率会怎么发展，80-150字简要概括，帮助读者理解大势走向。

输出格式（严格JSON，不要输出JSON以外任何文字）：
{
  "options": [
    {
      "title": "选项标题（10字以内，概括走向）",
      "description": "走向预览（1-2句，给读者看的剧情暗示，不剧透结局）",
      "nextChapterIntent": "选定后下一章的核心写作意图（具体）",
      "nextSceneHint": {
        "sceneTitle": "下一章开场场景标题",
        "location": "场景地点",
        "coreEvent": "核心事件",
        "effect": "作用与结果"
      },
      "impactTags": ["长线影响标签"],${optionTypeFormat}${basedOnFormat}${directionFormat}${arcFormat}
    }
  ],
  "prediction": "基于世界观的后续大概率发展概括（80-150字）"
}`;

    const userParts: string[] = [];
    userParts.push(`【本章信息】第${meta.chapterNumber}章 - ${meta.title}`);
    if (meta.intent) userParts.push(`本章意图: ${meta.intent}`);

    // 叙事里程碑（动态叙事引擎：供分支弧选择汇合目标）
    if (hasMilestones) {
      userParts.push('\n【叙事里程碑 - 故事必须到达的关键事件，分支弧最终要汇合到其中之一】');
      msList.forEach((m) => {
        userParts.push(`  - #${m.id} 「${m.label}」${m.importance ? `[${m.importance}]` : ''}${m.description ? `：${String(m.description).slice(0, 100)}` : ''}`);
      });
    }

    // 世界观设定（供推演与让分支符合设定）
    const wvLines: string[] = [];
    if (worldview.characters.length) {
      wvLines.push('人物：');
      worldview.characters.forEach((c) => {
        const attrs = [c.faction, c.realm].filter(Boolean).join('，');
        wvLines.push(`  - ${c.name}${attrs ? `（${attrs}）` : ''}${c.personality ? `：${c.personality}` : ''}`);
      });
    }
    if (worldview.factionRules.length) {
      wvLines.push('宗门规制：');
      worldview.factionRules.forEach((r) => {
        wvLines.push(`  - ${r.ruleType ? `[${r.ruleType}] ` : ''}${r.ruleName}${r.ruleContent ? `：${r.ruleContent}` : ''}`);
      });
    }
    if (worldview.seasonEvents.length) {
      wvLines.push('岁时节令：');
      worldview.seasonEvents.forEach((ev) => {
        const desc = [ev.cycleDescription, ev.atmosphere].filter(Boolean).join('，');
        wvLines.push(`  - ${ev.eventName}${desc ? `：${desc}` : ''}`);
      });
    }
    if (worldview.styleName || worldview.mentalModels?.length || worldview.decisionHeuristics?.length) {
      wvLines.push('文风心智：');
      if (worldview.styleName) wvLines.push(`  - 风格：${worldview.styleName}`);
      if (worldview.mentalModels?.length) wvLines.push(`  - 心智模型：${worldview.mentalModels.join('；')}`);
      if (worldview.decisionHeuristics?.length) wvLines.push(`  - 决策启发：${worldview.decisionHeuristics.join('；')}`);
    }
    if (wvLines.length) {
      userParts.push('\n【世界观设定 - 供推演与让分支符合设定】');
      userParts.push(wvLines.join('\n'));
    }

    // 启用方向字典（供方向打标/定向约束选择编码）
    if (enabledDirections.length) {
      userParts.push('\n【启用方向字典 - mainDirection/secondaryDirections 只能取以下编码】');
      userParts.push(directionListText);
    }

    // 剧情素材参考（按类型分组，带#编号供 basedOn 回标）
    if (hasMaterials) {
      userParts.push('\n【剧情素材参考 - 可借鉴改编，借鉴后在选项 basedOn 回填#编号】');
      const byType = new Map<string, PlotMaterialHit[]>();
      for (const m of materials) {
        if (!byType.has(m.table)) byType.set(m.table, []);
        byType.get(m.table)!.push(m);
      }
      for (const [table, hits] of byType) {
        userParts.push(`[${MATERIAL_LABELS[table] || table}]`);
        hits.forEach((m) => {
          const lines = [`  #${m.id} ${m.title}`, `     核心情节：${m.corePlot}`];
          if (m.triggerCondition) lines.push(`     触发条件：${m.triggerCondition}`);
          if (m.reward) lines.push(`     机缘收益：${m.reward}`);
          if (m.costOrRisk) lines.push(`     代价风险：${m.costOrRisk}`);
          if (m.emotionalBeat) lines.push(`     情绪节拍：${m.emotionalBeat}`);
          userParts.push(lines.join('\n'));
        });
      }
    }

    // 成长工坊实体（法宝，供剧情实名引用；定向工坊方向时强约束。功法能力由自定义功法模块提供，不经此处）
    if (workshopRefs.length) {
      userParts.push('\n【成长工坊实体 - 本作自定义法宝，剧情涉及法宝成长时须实名引用】');
      workshopRefs.forEach((e) => {
        const typeLabel = '法宝';
        const growthLabel = GROWTH_TYPE_LABELS[e.growthType] || e.growthType;
        userParts.push(`  - [${typeLabel}] ${e.name}（${e.grade}·${growthLabel}）${e.coreEffect ? `：${String(e.coreEffect).slice(0, 60)}` : ''}`);
      });
    }

    userParts.push('\n【本章正文（请基于结尾情境设计走向）】');
    // 控制输入长度，重点取结尾部分（走向由结尾决定），兼顾开头背景
    const trimmed = content.length > 6000
      ? `${content.slice(0, 1500)}\n…（中略）…\n${content.slice(-4000)}`
      : content;
    userParts.push(trimmed);
    userParts.push(`\n请严格输出${count}个走向选项及prediction的JSON${hasEncounter ? '（建议其中1个为 encounter 奇遇走向）' : ''}。`);

    return { systemPrompt, userPrompt: userParts.join('\n') };
  }
}

export const branchGeneratorAgent = new BranchGeneratorAgent();
