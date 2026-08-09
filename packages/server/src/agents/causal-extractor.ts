/**
 * 因果链 LLM 增强抽取Agent（可选增强，规则保底之上的语义补充）
 *
 * 用户选定剧情分支后，在规则推断的保底因果线之外，
 * 由 LLM 从分支描述中抽取 0-1 条语义更丰富的因果线（sourceType='branch'）。
 *
 * 设计：
 *   - 低温度（0.3）保证结构化输出稳定
 *   - 最多产出 1 条（避免与规则保底重复）
 *   - 解析失败返回空数组（best-effort，绝不阻断分支选定主流程）
 *   - 受 generation_config.causalConfig.llmEnhance 开关控制（默认 true）
 */
import { BaseAgent } from './base.js';
import type { LlmConfig } from '../types.js';
import type { ChatOptions, UsageInfo } from '../llm/client.js';

/** LLM 抽取出的因果线条目 */
export interface CausalExtractorOutput {
  causeType: string;
  causeDescription: string;
  effectType: string;
  effectDescription: string;
  /** 预期兑现窗口（距来源章的偏移章数，3-12） */
  targetOffset: number;
  /** 因果强度 0-100 */
  strength: number;
  /** 优先级 1-10 */
  priority: number;
}

interface ExtractorRawOutput {
  causalChains?: Array<Partial<CausalExtractorOutput>>;
}

const VALID_CAUSE_TYPES = new Set(['secret', 'debt', 'betrayal', 'prophecy', 'promise', 'grudge']);
const VALID_EFFECT_TYPES = new Set(['reveal', 'repay', 'revenge', 'fulfill', 'break']);

export class CausalExtractorAgent extends BaseAgent {
  constructor() {
    super('CausalExtractorAgent');
  }

  /**
   * 从分支走向抽取语义因果线（0-1 条）
   * @param optionTitle 分支标题
   * @param optionDescription 分支描述
   * @param impactTags 影响标签
   * @param sourceChapterNo 来源章号
   */
  async extract(
    optionTitle: string,
    optionDescription: string,
    impactTags: string[],
    sourceChapterNo: number,
    llmConfig?: LlmConfig,
    onUsage?: (usage: UsageInfo, model: string) => void,
  ): Promise<CausalExtractorOutput[]> {
    const { systemPrompt, userPrompt } = this.buildPrompt(optionTitle, optionDescription, impactTags, sourceChapterNo);
    const messages = this.buildMessages(systemPrompt, userPrompt);

    const options: ChatOptions = {
      temperature: 0.3,
      maxTokens: 1024,
      configOverride: llmConfig,
      onUsage,
    };

    this.log(`开始从第${sourceChapterNo}章分支「${optionTitle}」抽取因果线...`);
    const response = await this.callWithRetry(messages, options);

    let raw: ExtractorRawOutput;
    try {
      raw = this.parseJsonResponse<ExtractorRawOutput>(response);
    } catch (error: any) {
      this.log(`因果线LLM抽取JSON解析失败: ${error.message}`, 'warn');
      return [];
    }

    const list = Array.isArray(raw.causalChains) ? raw.causalChains : [];
    const normalized = this.normalize(list);
    this.log(`因果线LLM抽取完成：${normalized.length}条`);
    return normalized;
  }

  private normalize(list: Array<Partial<CausalExtractorOutput>>): CausalExtractorOutput[] {
    const result: CausalExtractorOutput[] = [];
    for (const item of list) {
      const causeType = VALID_CAUSE_TYPES.has(item.causeType ?? '') ? item.causeType! : 'promise';
      const effectType = VALID_EFFECT_TYPES.has(item.effectType ?? '') ? item.effectType! : 'fulfill';
      const causeDescription = (item.causeDescription || '').trim();
      if (!causeDescription) continue;
      result.push({
        causeType,
        causeDescription: causeDescription.slice(0, 200),
        effectType,
        effectDescription: (item.effectDescription || '').trim().slice(0, 200),
        targetOffset: Math.min(12, Math.max(3, item.targetOffset ?? 6)),
        strength: Math.min(100, Math.max(10, item.strength ?? 50)),
        priority: Math.min(10, Math.max(1, item.priority ?? 5)),
      });
      // 最多 1 条（规则已保底，LLM 仅增强）
      if (result.length >= 1) break;
    }
    return result;
  }

  private buildPrompt(
    optionTitle: string,
    optionDescription: string,
    impactTags: string[],
    sourceChapterNo: number,
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `你是专业的小说因果线设计专家。请基于以下剧情分支走向，判断是否隐含一条值得追踪的因果线（即"种因"——当前选择将在未来章节产生后果/兑现）。

要求：
1. 仅当分支走向确实隐含明确的因果关系时才输出（如：秘密→暴露、恩情→报答、背叛→复仇、预言→应验、承诺→兑现、结怨→了结）。若分支仅是日常/过渡/无明确因果，输出空数组。
2. 最多输出 1 条因果线。
3. causeType 取值：secret(秘密)/debt(恩情)/betrayal(背叛)/prophecy(预言)/promise(承诺)/grudge(结怨)
4. effectType 取值：reveal(揭露)/repay(报答)/revenge(复仇)/fulfill(兑现)/break(打破)
5. targetOffset 为预期兑现距当前章的偏移（3-12章），strength 为因果强度（0-100），priority 为优先级（1-10）。
6. 严格按JSON格式输出，禁止任何多余说明文字。

输出格式（严格JSON）：
{
  "causalChains": [
    {
      "causeType": "grudge",
      "causeDescription": "因的具体描述（30-60字）",
      "effectType": "repay",
      "effectDescription": "预期果的描述（20-40字）",
      "targetOffset": 6,
      "strength": 60,
      "priority": 7
    }
  ]
}

若无明确因果关系，输出：{"causalChains": []}`;

    const userParts: string[] = [];
    userParts.push(`【分支来源】第${sourceChapterNo}章选定分支`);
    userParts.push(`分支标题：${optionTitle}`);
    userParts.push(`分支描述：${optionDescription}`);
    if (impactTags.length) userParts.push(`影响标签：${impactTags.join('、')}`);
    userParts.push('\n请判断是否隐含因果线，严格按JSON格式输出。');

    return { systemPrompt, userPrompt: userParts.join('\n') };
  }
}

export const causalExtractorAgent = new CausalExtractorAgent();
