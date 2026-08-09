/**
 * 状态提取Agent - 从已生成章节正文中抽取人物状态快照、时间线里程碑与人物关键经历（记忆卡）
 * 低温度（0.2）保证抽取稳定；输出结构化JSON，名字→ID由本模块解析
 * 抽取结果落库为 auto_confirmed/auto（自动生效，低置信，用户可否决），不直接覆盖已确认状态
 */
import { BaseAgent } from './base.js';
import { getEntityNameDirectory } from '../rag/retriever.js';
import type { LlmConfig } from '../types.js';
import type { ChatOptions, UsageInfo } from '../llm/client.js';

/** 单个人物状态抽取结果（名字态，尚未解析ID） */
export interface ExtractedCharacterState {
  characterName: string;
  location?: string;
  realm?: string;
  injury?: string;
  mentalState?: string;
  possessedItems?: string[];
}

/** 单条时间线里程碑抽取结果 */
export interface ExtractedTimeline {
  storyTime?: string;
  title: string;
  description?: string;
  importance?: string;
}

/** 单条人物关键经历抽取结果（v1.4 第三期记忆卡） */
export interface ExtractedMemory {
  characterName: string;
  eventSummary: string;
  emotionalImpact?: string;
  importance?: string;
}

/** 单条任务抽取结果（13-SRS US-21a 征途录自动数据） */
export interface ExtractedTask {
  title: string;
  description?: string;
  /** 关联角色姓名（名字态，落库时解析ID） */
  characterNames?: string[];
  /** 任务类型: main(主线) / side(支线) / hidden(隐藏) / fortune(机缘) */
  taskType?: string;
  /** 任务状态: progressing(进行中) / completed(已完成) / failed(失败放弃) / pending(未接/待启动) */
  status?: string;
  /** 优先级: high / normal / low */
  priority?: string;
}

/** 状态提取Agent原始输出 */
interface ExtractorRawOutput {
  characters?: ExtractedCharacterState[];
  timeline?: ExtractedTimeline[];
  memories?: ExtractedMemory[];
  tasks?: ExtractedTask[];
}

/** 解析后的人物状态（附带解析到的characterId） */
export interface ResolvedCharacterState extends ExtractedCharacterState {
  characterId?: number;
}

/** 状态提取最终结果 */
export interface ExtractionResult {
  characters: ResolvedCharacterState[];
  timeline: ExtractedTimeline[];
  memories: ExtractedMemory[];
  tasks: ExtractedTask[];
}

export class StateExtractorAgent extends BaseAgent {
  constructor() {
    super('StateExtractorAgent');
  }

  /**
   * 从章节正文抽取状态
   * @param content 章节正文
   * @param chapterMeta 章节元信息（章节号/标题/意图），用于约束抽取范围
   */
  async extract(
    content: string,
    chapterMeta: { chapterNumber: number; title: string; intent?: string },
    llmConfig?: LlmConfig,
    onUsage?: (usage: UsageInfo, model: string) => void
  ): Promise<ExtractionResult> {
    const { systemPrompt, userPrompt } = this.buildPrompt(content, chapterMeta);
    const messages = this.buildMessages(systemPrompt, userPrompt);

    const options: ChatOptions = {
      temperature: 0.2, // 抽取任务需高确定性
      maxTokens: 2048,
      configOverride: llmConfig,
      onUsage,
    };

    this.log(`开始抽取第${chapterMeta.chapterNumber}章状态...`);
    const response = await this.callWithRetry(messages, options);

    let raw: ExtractorRawOutput;
    try {
      raw = this.parseJsonResponse<ExtractorRawOutput>(response);
    } catch (error: any) {
      this.log(`状态抽取JSON解析失败: ${error.message}`, 'warn');
      return { characters: [], timeline: [], memories: [], tasks: [] };
    }

    const characters = Array.isArray(raw.characters) ? raw.characters : [];
    const timeline = Array.isArray(raw.timeline) ? raw.timeline : [];
    const memories = Array.isArray(raw.memories) ? raw.memories : [];
    const tasks = Array.isArray(raw.tasks)
      ? raw.tasks.filter((t) => t && typeof t.title === 'string' && t.title.trim())
      : [];

    // 名字→ID 解析
    const resolvedCharacters = await this.resolveCharacterIds(characters);

    this.log(
      `抽取完成：人物状态${resolvedCharacters.length}条，时间线${timeline.length}条，记忆${memories.length}条，任务${tasks.length}条`
    );
    return { characters: resolvedCharacters, timeline, memories, tasks };
  }

  /**
   * 将抽取到的人物名字解析为诛仙库characterId（解析不到则留空，仅保留名字）
   */
  private async resolveCharacterIds(
    characters: ExtractedCharacterState[]
  ): Promise<ResolvedCharacterState[]> {
    if (!characters.length) return [];
    try {
      const dir = await getEntityNameDirectory();
      const nameToId = new Map<string, number>();
      for (const c of dir.characters) {
        if (c.name && !nameToId.has(c.name)) nameToId.set(c.name, c.id);
      }
      return characters.map((c) => ({
        ...c,
        characterId: nameToId.get(c.characterName),
      }));
    } catch {
      // 解析失败不阻断，返回无ID的结果
      return characters.map((c) => ({ ...c }));
    }
  }

  private buildPrompt(
    content: string,
    meta: { chapterNumber: number; title: string; intent?: string }
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `你是一位严谨的小说设定档案管理员。你的任务是从一个章节的正文中，抽取"截至本章结束时"的人物状态与时间线事件，用于长篇连载的一致性追踪。

抽取原则：
- 只抽取本章正文明确写到或可直接推断的信息，不要臆测、不要补全设定。
- 人物状态是"本章结束后"的快照：若本章未提及某人物的某项，该字段留空（不要填旧值）。
- 只收录本章实际出场或被明确提及的人物。
- 时间线只收录本章发生的关键事件，不要罗列琐碎细节。
- 记忆（memories）只收录对该人物有情感/认知意义的关键经历（重大得失、冲击、承诺、背叛等），每人最多2条，琐碎日常不收录。
- 任务（tasks）收录本章明确写到的角色任务/委托/使命/誓言/目标：新接到的、正在推进的、完成的、失败或放弃的；同一任务只在状态有变化或首次出现时收录，琐碎日常目标不收录。

输出格式（严格JSON）：
{
  "characters": [
    {
      "characterName": "人物姓名",
      "location": "本章结束时所在地点（无则省略）",
      "realm": "修为境界（本章有变化或明确提及时填写，否则省略）",
      "injury": "伤势/身体状况（无则省略）",
      "mentalState": "心理/情绪状态（无则省略）",
      "possessedItems": ["本章明确持有/获得的法宝或物品"]
    }
  ],
  "timeline": [
    {
      "storyTime": "故事内时间（如'三日后黄昏'，无则省略）",
      "title": "事件简述（10字以内）",
      "description": "事件说明（一句话）",
      "importance": "key|normal（关键剧情为key，其余为normal）"
    }
  ],
  "memories": [
    {
      "characterName": "经历该事件的人物姓名",
      "eventSummary": "关键经历一句话摘要（含事件与结果）",
      "emotionalImpact": "该经历对人物的情绪/认知影响（无则省略）",
      "importance": "high|normal（重大转折为high，其余为normal）"
    }
  ],
  "tasks": [
    {
      "title": "任务名称（10字以内动宾短语，如'查清草庙村真相'）",
      "description": "任务内容与缘由一句话说明（无则省略）",
      "characterNames": ["承接/关联该任务的人物姓名"],
      "taskType": "main|side|hidden|fortune（主线/支线/隐藏/机缘）",
      "status": "progressing|completed|failed|pending（进行中/已完成/失败放弃/未接或刚接到尚未启动）",
      "priority": "high|normal|low（无明确依据时normal）"
    }
  ]
}

注意：
- 没有可抽取内容时，对应数组返回空数组 []。
- possessedItems 只填名字字符串数组。
- tasks 的 title 需保持稳定措辞（同一任务跨章出现时便于去重匹配），不要每章换说法。
- 不要输出JSON以外的任何文字。`;

    const userParts: string[] = [];
    userParts.push(`【章节信息】第${meta.chapterNumber}章 - ${meta.title}`);
    if (meta.intent) userParts.push(`章节意图: ${meta.intent}`);
    userParts.push('\n【章节正文】');
    userParts.push(content);
    userParts.push('\n请严格按照JSON格式输出抽取结果。');

    return { systemPrompt, userPrompt: userParts.join('\n') };
  }
}

export const stateExtractorAgent = new StateExtractorAgent();
