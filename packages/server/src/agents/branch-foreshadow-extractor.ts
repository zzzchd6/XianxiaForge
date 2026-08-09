/**
 * 分支衍生伏笔抽取Agent（分支衍生伏笔与前置回填系统 P0）
 *
 * 用户选定剧情分支后，从分支走向中抽取 2-3 条可前置埋设的伏笔线索，
 * 落库为 source_type='branch' / is_confirmed=false 的待确认伏笔。
 *
 * 设计：
 *   - 低温度（0.3）保证结构化输出稳定
 *   - 必出 1 条 t1 核心转折伏笔 + 1-2 条 t2 细节暗示伏笔
 *   - 每条含标题/描述/埋设线索关键词(hint_clue)/优先级/DNA四元组
 *   - 解析失败返回空数组（best-effort，绝不阻断分支选定主流程）
 */
import { BaseAgent } from './base.js';
import type { LlmConfig } from '../types.js';
import type { ChatOptions, UsageInfo } from '../llm/client.js';

/** 分支选项输入（来自 chapter_branch_option） */
export interface BranchOptionInput {
  optionTitle: string;
  optionDescription: string;
  nextChapterIntent: string;
  impactTags: string[];
  mainDirection?: string | null;
}

/** 抽取出的单条分支衍生伏笔（字段对齐 foreshadow_thread） */
export interface BranchDerivedForeshadow {
  title: string;
  description: string;
  /** 埋设线索关键词（首个最具辨识度，顿号分隔，供零LLM扫描命中） */
  hintClue: string;
  /** 伏笔分级：t1核心转折 / t2细节暗示 */
  tier: 't1' | 't2';
  /** 优先级：high / normal / low */
  priority: 'high' | 'normal' | 'low';
  dnaSubject?: string;
  dnaAction?: string;
  dnaObject?: string;
  dnaEmotion?: string;
}

/** Agent 原始输出 */
interface ExtractorRawOutput {
  foreshadows?: Array<Partial<BranchDerivedForeshadow>>;
}

export class BranchForeshadowExtractorAgent extends BaseAgent {
  constructor() {
    super('BranchForeshadowExtractorAgent');
  }

  /**
   * 从分支走向抽取伏笔
   * @param option 选定的分支选项详情
   * @param sourceChapterNo 分支来源章号（用于日志与约束）
   */
  async extract(
    option: BranchOptionInput,
    sourceChapterNo: number,
    llmConfig?: LlmConfig,
    onUsage?: (usage: UsageInfo, model: string) => void
  ): Promise<BranchDerivedForeshadow[]> {
    const { systemPrompt, userPrompt } = this.buildPrompt(option, sourceChapterNo);
    const messages = this.buildMessages(systemPrompt, userPrompt);

    const options: ChatOptions = {
      temperature: 0.3,
      maxTokens: 2048,
      configOverride: llmConfig,
      onUsage,
    };

    this.log(`开始从第${sourceChapterNo}章分支「${option.optionTitle}」抽取衍生伏笔...`);
    const response = await this.callWithRetry(messages, options);

    let raw: ExtractorRawOutput;
    try {
      raw = this.parseJsonResponse<ExtractorRawOutput>(response);
    } catch (error: any) {
      this.log(`分支伏笔抽取JSON解析失败: ${error.message}`, 'warn');
      return [];
    }

    const list = Array.isArray(raw.foreshadows) ? raw.foreshadows : [];
    const normalized = this.normalize(list);
    this.log(`分支伏笔抽取完成：${normalized.length}条`);
    return normalized;
  }

  /** 规范化 + 校验：剔除无效条目，约束最多 3 条，确保至少字段齐全 */
  private normalize(list: Array<Partial<BranchDerivedForeshadow>>): BranchDerivedForeshadow[] {
    const result: BranchDerivedForeshadow[] = [];
    for (const item of list) {
      const title = (item.title || '').trim();
      if (!title) continue;
      const tier = item.tier === 't1' ? 't1' : 't2';
      const priority = item.priority === 'high' || item.priority === 'low' ? item.priority : 'normal';
      result.push({
        title: title.slice(0, 120),
        description: (item.description || '').trim().slice(0, 500),
        hintClue: (item.hintClue || '').trim().slice(0, 200),
        tier,
        priority,
        dnaSubject: item.dnaSubject?.trim().slice(0, 100) || undefined,
        dnaAction: item.dnaAction?.trim().slice(0, 50) || undefined,
        dnaObject: item.dnaObject?.trim().slice(0, 100) || undefined,
        dnaEmotion: item.dnaEmotion?.trim().slice(0, 50) || undefined,
      });
      if (result.length >= 3) break;
    }
    return result;
  }

  private buildPrompt(
    option: BranchOptionInput,
    sourceChapterNo: number
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `你是专业的小说伏笔设计专家。请基于以下剧情分支走向，提取2-3条可前置埋设的伏笔线索，用于在更早的章节自然铺垫，避免分支转折突兀。

要求：
1. 必须包含1条核心主线伏笔（tier=t1），对应分支的核心走向转折；可选1-2条细节暗示伏笔（tier=t2），对应影响标签或关键细节。
2. 每条伏笔包含：标题(title)、详细描述(description)、埋设线索关键词(hint_clue)、优先级(priority)、DNA四元组(dnaSubject主体/dnaAction动作/dnaObject客体/dnaEmotion情绪)。
3. hint_clue 提供3-5个关键词，用顿号"、"分隔，最具辨识度的关键词放最前面（用于在正文中自动识别是否已埋入）。
4. 伏笔要隐晦、可落地，适合前置章节自然插入，不能剧透分支结果。
5. 严格按JSON格式输出，禁止任何多余说明文字。

输出格式（严格JSON）：
{
  "foreshadows": [
    {
      "title": "伏笔名称（简洁）",
      "description": "埋了什么、预期如何呼应分支走向（50-100字）",
      "hintClue": "关键词1、关键词2、关键词3",
      "tier": "t1",
      "priority": "high",
      "dnaSubject": "主体（角色/实体）",
      "dnaAction": "动作（发现/获得/失去/背叛...）",
      "dnaObject": "客体（物品/秘密/人物...）",
      "dnaEmotion": "核心情绪（悬念/震惊/悲伤...）"
    }
  ]
}`;

    const userParts: string[] = [];
    userParts.push(`【分支来源】第${sourceChapterNo}章选定分支`);
    userParts.push(`分支标题：${option.optionTitle}`);
    userParts.push(`分支描述：${option.optionDescription}`);
    userParts.push(`下一章核心走向：${option.nextChapterIntent}`);
    if (option.mainDirection) userParts.push(`叙事方向：${option.mainDirection}`);
    if (option.impactTags?.length) userParts.push(`影响标签：${option.impactTags.join('、')}`);
    userParts.push('\n请严格按照JSON格式输出2-3条伏笔。');

    return { systemPrompt, userPrompt: userParts.join('\n') };
  }
}

export const branchForeshadowExtractorAgent = new BranchForeshadowExtractorAgent();
