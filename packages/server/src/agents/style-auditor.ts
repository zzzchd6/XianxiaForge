/**
 * 文风校验Agent（需求13）
 * 100% 复用文风引擎配置（StyleContext），对已生成章节做专项文风审计。
 * 7 个维度：心智模型 / 描写比例 / 核心意象 / 禁用词 / 视角规则 / 反模式 / 句式规则。
 * - 禁用词走本地精确匹配（scanForbiddenWords，零 token、无误判）
 * - 其余 6 维交 LLM 低温判定，输出结构化报告（含违规原文片段 excerpt 供前端定位）
 * 综合得分 = 各激活维度分项得分的均值（确定性、可追溯）。
 */
import { BaseAgent } from './base.js';
import { scanForbiddenWords } from '../rag/style.js';
import { scanAIFlavor, classifyOpening } from '../rag/ai-flavor-detector.js';
import type { StyleContext, StyleAuditReport, StyleIssue, LlmConfig } from '../types.js';
import type { ChatOptions, UsageInfo } from '../llm/client.js';

/** 维度名常量（与前端展示/入库保持一致） */
export const STYLE_DIMENSIONS = {
  mentalModel: '心智模型',
  descriptionRatio: '描写比例',
  coreImagery: '核心意象',
  forbiddenWords: '禁用词',
  perspective: '视角规则',
  antiPattern: '反模式',
  sentence: '句式规则',
  aiFlavor: 'AI味程度',
} as const;

/** LLM 负责判定的维度（禁用词由本地处理） */
const LLM_DIMENSIONS = [
  STYLE_DIMENSIONS.mentalModel,
  STYLE_DIMENSIONS.descriptionRatio,
  STYLE_DIMENSIONS.coreImagery,
  STYLE_DIMENSIONS.perspective,
  STYLE_DIMENSIONS.antiPattern,
  STYLE_DIMENSIONS.sentence,
];

/** 正文超长时截取（保留首尾，描写比例按样本估算仍具代表性） */
function trimContent(content: string, max = 12000): string {
  if (content.length <= max) return content;
  const head = content.slice(0, 7000);
  const tail = content.slice(-5000);
  return `${head}\n\n…（中段省略 ${content.length - 12000} 字）…\n\n${tail}`;
}

export class StyleAuditorAgent extends BaseAgent {
  constructor() {
    super('StyleAuditorAgent');
  }

  /**
   * 文风校验主方法
   * @param content 章节正文
   * @param style 文风引擎配置（StyleContext）
   * @param chapterMeta 章节元信息（用于提示词）
   * @param crossChapterCtx 跨章上下文（PRD v1.1：开头模板化/明喻重复检测）
   */
  async auditStyle(
    content: string,
    style: StyleContext,
    chapterMeta: { chapterNumber?: number; title?: string },
    llmConfig?: LlmConfig,
    onUsage?: (usage: UsageInfo, model: string) => void,
    crossChapterCtx?: {
      previousOpenings?: Array<{ chapterNo: number; type: string }>;
      previousSimileImageries?: string[];
    }
  ): Promise<StyleAuditReport> {
    const dimensionScores: Record<string, number> = {};
    const issues: StyleIssue[] = [];

    // ---- 1. 禁用词本地精确匹配（零 token） ----
    if (style.forbiddenWords?.length) {
      const hits = scanForbiddenWords(content, style.forbiddenWords);
      for (const w of hits) {
        issues.push({
          dimension: STYLE_DIMENSIONS.forbiddenWords,
          severity: 'critical',
          description: `正文出现禁用词「${w}」`,
          suggestion: `删除或替换禁用词「${w}」，改用符合「${style.styleName || '设定'}」文风的表达`,
          excerpt: w,
        });
      }
      // 每个禁用词扣 20 分，封底 0
      dimensionScores[STYLE_DIMENSIONS.forbiddenWords] = Math.max(0, 100 - hits.length * 20);
    }

    // ---- 1.5 去AI味本地扫描（零 token） ----
    const aiFlavorScan = scanAIFlavor(content);
    if (aiFlavorScan.overallLevel !== 'green') {
      const parts: string[] = [];
      if (aiFlavorScan.metaNarrationCount) parts.push(`元叙述${aiFlavorScan.metaNarrationCount}处`);
      if (aiFlavorScan.repetitiveStarters) parts.push(`句首重复${aiFlavorScan.repetitiveStarters}组`);
      if (aiFlavorScan.sentenceUniformity > 0.6) parts.push(`句式均匀度${(aiFlavorScan.sentenceUniformity * 100).toFixed(0)}%`);
      if (aiFlavorScan.routineConnectorCount) parts.push(`套路连接词${aiFlavorScan.routineConnectorCount}处`);
      if (aiFlavorScan.universalAdjectiveCount) parts.push(`万能形容词${aiFlavorScan.universalAdjectiveCount}处`);
      if (aiFlavorScan.objectiveStatementCount) parts.push(`客观陈述腔${aiFlavorScan.objectiveStatementCount}处`);
      if (aiFlavorScan.fillerAdverbCount) parts.push(`凑字副词${aiFlavorScan.fillerAdverbCount}处`);
      issues.push({
        dimension: STYLE_DIMENSIONS.aiFlavor,
        severity: aiFlavorScan.overallLevel === 'red' ? 'major' : 'minor',
        description: `检测到AI写作痕迹：${parts.join('，') || '综合指标偏高'}`,
        suggestion: '打散均匀句群、减少解释腔、用具体描写替代抽象判断词、删除套路化连接词和万能形容词',
        excerpt: aiFlavorScan.signatureHits[0]?.phrase || aiFlavorScan.metaNarrationHits[0]?.phrase,
      });
    }
    // 去AI味得分：绿=95，黄=70，红=40
    dimensionScores[STYLE_DIMENSIONS.aiFlavor] = aiFlavorScan.overallLevel === 'green' ? 95
      : aiFlavorScan.overallLevel === 'yellow' ? 70 : 40;

    // ---- 1.6 跨章检测：开头模板化（PRD v1.1） ----
    if (crossChapterCtx?.previousOpenings?.length) {
      const currentOpening = classifyOpening(content);
      if (currentOpening !== 'other') {
        const sameTypeCount = crossChapterCtx.previousOpenings.filter(
          o => o.type === currentOpening,
        ).length;
        if (sameTypeCount >= 2) {
          issues.push({
            dimension: STYLE_DIMENSIONS.antiPattern,
            severity: 'major',
            description: `本章开头类型为「${currentOpening}」，与前面${sameTypeCount}章重复。4章开头结构必须不同：环境/对话/动作/内心独白至少各来一次。`,
            suggestion: '改用其他开头类型：对话/动作/内心独白/环境，避免与前面章节雷同。',
            excerpt: content.trim().split('\n').find(l => l.trim().length > 3)?.trim().slice(0, 30),
            aiFlavorType: 'uniform_rhythm',
          });
        }
      }
    }

    // ---- 1.7 单章检测："不是A是B"句式密集（PRD v1.1） ----
    if (aiFlavorScan.notAButBCount > 1) {
      issues.push({
        dimension: STYLE_DIMENSIONS.antiPattern,
        severity: aiFlavorScan.notAButBCount >= 4 ? 'major' : 'minor',
        description: `"不是A，是B"句式本章出现${aiFlavorScan.notAButBCount}次，超过上限（每章最多保留1处）。`,
        suggestion: '保留最有力的一处，其余改为动作描写或复杂心理活动。',
        excerpt: aiFlavorScan.notAButBHits[0]?.phrase,
        aiFlavorType: 'explanatory_dialogue',
      });
    }

    // ---- 1.8 明喻检测（PRD v1.1）：密度过高（单章）+ 意象重复（跨章） ----
    const simileDensity = content.length > 0
      ? aiFlavorScan.simileCount / (content.length / 1000)
      : 0;
    if (simileDensity > 5) {
      issues.push({
        dimension: STYLE_DIMENSIONS.antiPattern,
        severity: 'minor',
        description: `本章明喻密度${simileDensity.toFixed(1)}/千字，过高（标准≤5.0/千字，即总量需减少50%）。`,
        suggestion: '砍掉一半明喻，改用借代、通感或白描。',
        aiFlavorType: 'adjective_stack',
      });
    }

    if (crossChapterCtx?.previousSimileImageries?.length && aiFlavorScan.simileImageries?.length) {
      const prevSet = new Set(crossChapterCtx.previousSimileImageries);
      const repeated = aiFlavorScan.simileImageries.filter(s => prevSet.has(s.imagery));
      for (const r of repeated) {
        issues.push({
          dimension: STYLE_DIMENSIONS.antiPattern,
          severity: 'major',
          description: `比喻意象「${r.imagery}」在前面章节已使用过，同一意象全书只能出现1次。`,
          suggestion: '更换为角色独有的、带体温的感官描写，或用借代/通感/白描替代。',
          excerpt: r.phrase,
          aiFlavorType: 'cliche_metaphor',
        });
      }
    }

    // ---- 2. 判定哪些 LLM 维度有配置、需要校验 ----
    const activeLlmDims = this.collectActiveDimensions(style);

    if (activeLlmDims.length) {
      const { systemPrompt, userPrompt } = this.buildStylePrompt(
        trimContent(content),
        style,
        activeLlmDims,
        chapterMeta
      );
      const messages = this.buildMessages(systemPrompt, userPrompt);
      const options: ChatOptions = {
        temperature: 0.3, // 低温保证判定稳定
        maxTokens: 4096,
        configOverride: llmConfig,
        onUsage,
      };

      this.log(`开始文风校验第${chapterMeta.chapterNumber ?? '?'}章（LLM维度${activeLlmDims.length}个）...`);
      try {
        const response = await this.callWithRetry(messages, options);
        const parsed = this.parseJsonResponse<{
          dimensionScores?: Record<string, number>;
          issues?: any[];
        }>(response);

        // 合并 LLM 维度得分
        if (parsed.dimensionScores && typeof parsed.dimensionScores === 'object') {
          for (const dim of activeLlmDims) {
            const raw = parsed.dimensionScores[dim];
            if (typeof raw === 'number') {
              dimensionScores[dim] = Math.max(0, Math.min(100, Math.round(raw)));
            }
          }
        }
        // 合并 LLM 问题
        if (Array.isArray(parsed.issues)) {
          for (const it of parsed.issues) {
            if (!it || typeof it.description !== 'string') continue;
            const severity = ['critical', 'major', 'minor'].includes(it.severity) ? it.severity : 'minor';
            issues.push({
              dimension: typeof it.dimension === 'string' ? it.dimension : '风格',
              severity,
              description: it.description,
              suggestion: typeof it.suggestion === 'string' ? it.suggestion : '',
              excerpt: typeof it.excerpt === 'string' && it.excerpt.trim() ? it.excerpt.trim() : undefined,
              aiFlavorType: typeof it.aiFlavorType === 'string' && ['empty_summary', 'cliche_atmosphere', 'adjective_stack', 'explanatory_dialogue', 'uniform_rhythm', 'cliche_metaphor', 'parallel_padding', 'psych_overload'].includes(it.aiFlavorType) ? it.aiFlavorType : undefined,
            });
          }
        }
      } catch (error: any) {
        this.log(`LLM文风校验失败，仅保留本地禁用词结果: ${error.message}`, 'warn');
      }
    }

    // 未得分的激活维度补默认 80（避免缺项拉低均值时失真）
    for (const dim of activeLlmDims) {
      if (typeof dimensionScores[dim] !== 'number') dimensionScores[dim] = 80;
    }

    // ---- 3. 综合得分 = 各激活维度得分均值 ----
    const scoreVals = Object.values(dimensionScores);
    const overallScore = scoreVals.length
      ? Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length)
      : 80;

    this.log(`文风校验完成，综合得分: ${overallScore}，问题数: ${issues.length}`);
    return { overallScore, dimensionScores, issues };
  }

  /** 依据 StyleContext 实际配置，判定哪些 LLM 维度需要校验 */
  private collectActiveDimensions(style: StyleContext): string[] {
    const active: string[] = [];
    if ((style.mentalModels?.length || style.decisionHeuristics?.length)) active.push(STYLE_DIMENSIONS.mentalModel);
    if (style.descriptionRatio && Object.keys(style.descriptionRatio).length) active.push(STYLE_DIMENSIONS.descriptionRatio);
    if (style.coreImagery?.length) active.push(STYLE_DIMENSIONS.coreImagery);
    if (style.perspectiveRules?.length) active.push(STYLE_DIMENSIONS.perspective);
    if (style.antiPatterns?.length) active.push(STYLE_DIMENSIONS.antiPattern);
    if (style.sentenceRules && Object.keys(style.sentenceRules).length) active.push(STYLE_DIMENSIONS.sentence);
    return active;
  }

  /** 构建文风校验 prompt（仅注入激活维度的配置） */
  private buildStylePrompt(
    content: string,
    style: StyleContext,
    activeDims: string[],
    chapterMeta: { chapterNumber?: number; title?: string }
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `你是一位专精文风质检的资深小说编辑。你的任务是依据给定的「文风引擎配置」，对章节正文做专项文风审计，精准定位不符合设定的文风问题。

你只审查以下被激活的维度（配置中未提供的维度不审查）：
- ${STYLE_DIMENSIONS.mentalModel}：正文整体气质是否契合设定的心智模型与决策启发（如凡人视角、以情御文、悲剧底色等创作原则）
- ${STYLE_DIMENSIONS.descriptionRatio}：场景/动作/对话/心理四类描写占比是否严重偏离设定阈值（任一项偏差超过15%视为异常）
- ${STYLE_DIMENSIONS.coreImagery}：设定的核心意象是否被合理化用，有无缺失或堆砌滥用
- ${STYLE_DIMENSIONS.perspective}：是否符合设定的视角规则（如第三人称有限视角、不跳心、上帝视角占比）
- ${STYLE_DIMENSIONS.antiPattern}（去AI味五分型+天命三类）：是否出现以下八类 AI 味表达，命中时在 issue 中标注 aiFlavorType 字段：
  A. empty_summary 空泛总结型：用"心中五味杂陈""感慨万千"等总结替代现场动作
  B. cliche_atmosphere 套话氛围型："空气凝固""气氛微妙"等没人制造的套话气氛
  C. adjective_stack 形容词堆叠型："清冷、危险、深邃"等标签堆砌立人
  D. explanatory_dialogue 解释腔对白型：人物借对话轮流讲解设定给读者听
  E. uniform_rhythm 平均工整型：所有句子差不多长、都很完整、没有轻重节奏
  F. cliche_metaphor 比喻陈词滥调：眼睛像星星、笑容像阳光、心情像过山车、时间如流水、心如刀绞等被用滥的比喻
  G. parallel_padding 排比堆砌：缺乏内在逻辑递进的三段式排比，为凑字数而堆砌
  H. psych_overload 大段心理分析：紧张/战斗/恐怖场景中违反"感官优先于思考"原则的长段心理独白
  同时检查设定的其他反模式/避免写法
- ${STYLE_DIMENSIONS.sentence}：是否符合设定的句式规则（如高潮短句、开篇短句等）

输出格式要求（严格JSON，不要输出任何额外文字）：
{
  "dimensionScores": { "维度名": 0-100整数 },
  "issues": [
    {
      "dimension": "维度名",
      "severity": "critical|major|minor",
      "description": "问题描述",
      "suggestion": "修改建议",
      "excerpt": "正文中对应的违规原文片段（尽量逐字摘录，便于定位；无明确片段可省略）",
      "aiFlavorType": "仅反模式维度命中时填写：empty_summary|cliche_atmosphere|adjective_stack|explanatory_dialogue|uniform_rhythm|cliche_metaphor|parallel_padding|psych_overload（其他维度省略此字段）"
    }
  ]
}

要求：
- dimensionScores 必须为每个被激活维度各给一个 0-100 整数分
- severity：critical=严重违背文风必须改，major=明显问题建议改，minor=小瑕疵可选改
- excerpt 务必从正文逐字摘录，便于在原文中定位；若为整体性问题（如描写比例失衡）可省略 excerpt
- 只报确实存在的问题，不要过度挑剔；无问题的维度给高分且不必硬凑 issue`;

    const userParts: string[] = [];
    userParts.push('【待校验章节】');
    userParts.push(
      chapterMeta.chapterNumber
        ? `第${chapterMeta.chapterNumber}章${chapterMeta.title ? ' - ' + chapterMeta.title : ''}`
        : '章节正文'
    );
    userParts.push(content);

    userParts.push('\n【文风引擎配置（校验标准）】');
    if (style.styleName) userParts.push(`风格名称：${style.styleName}`);
    if (activeDims.includes(STYLE_DIMENSIONS.mentalModel)) {
      if (style.mentalModels?.length) userParts.push(`心智模型：\n- ${style.mentalModels.join('\n- ')}`);
      if (style.decisionHeuristics?.length) userParts.push(`决策启发：\n- ${style.decisionHeuristics.join('\n- ')}`);
    }
    if (activeDims.includes(STYLE_DIMENSIONS.descriptionRatio) && style.descriptionRatio) {
      const r = style.descriptionRatio;
      userParts.push(
        `目标描写比例：场景${r.scene ?? '-'}% / 动作${r.action ?? '-'}% / 对话${r.dialogue ?? '-'}% / 心理${r.psychology ?? '-'}%`
      );
    }
    if (activeDims.includes(STYLE_DIMENSIONS.coreImagery) && style.coreImagery?.length) {
      userParts.push(`核心意象词库：${style.coreImagery.join('、')}`);
    }
    if (activeDims.includes(STYLE_DIMENSIONS.perspective) && style.perspectiveRules?.length) {
      userParts.push(`视角规则：\n- ${style.perspectiveRules.join('\n- ')}`);
    }
    if (activeDims.includes(STYLE_DIMENSIONS.antiPattern) && style.antiPatterns?.length) {
      userParts.push(`反模式（严禁写法）：\n- ${style.antiPatterns.join('\n- ')}`);
    }
    if (activeDims.includes(STYLE_DIMENSIONS.sentence) && style.sentenceRules) {
      const sr = Object.entries(style.sentenceRules)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join('；');
      userParts.push(`句式规则：${sr}`);
    }

    userParts.push('\n请输出严格JSON的校验结果。');

    return { systemPrompt, userPrompt: userParts.join('\n') };
  }
}

export const styleAuditorAgent = new StyleAuditorAgent();
