/**
 * 三层冰山台词生成 Agent（PRD v1.3 模块一，§7.3 三步工作流 / §7.6 Prompt 模板）
 *
 * 三步顺序强制：Step1 真相层（温度0.3）→ Step2 表层台词（0.75）→ Step3 行为锚点（0.75）
 * JSON 解析失败自动重试 1 次（温度调低，§10.1.6 LLM_OUTPUT_PARSE_ERROR）
 */
import { BaseAgent } from './base.js';
import type { ChatOptions } from '../llm/client.js';
import { EngineError } from '../dual-engine/errors.js';
import { matchAnchorGroup } from '../data/behavior-anchors.js';
import type { IcebergConfig, DisguiseStrategy, DialogueLength } from '../dual-engine/schemas.js';
import type { TruthLayerCharacter, SurfaceLine, BehaviorAnchorLine } from '../dual-engine/types.js';

const DISGUISE_LABELS: Record<DisguiseStrategy, string> = {
  auto: '由你自行设计最符合角色身份的反差方式（反话/转移话题/客套/轻描淡写均可）',
  irony: '反话——嘴上说的与心里想的相反',
  diversion: '转移话题——回避真实意图，顾左右而言他',
  politeness: '客套——用礼节性的疏离话术掩盖真实情绪',
  understatement: '轻描淡写——把天大的事说得云淡风轻',
};

const LENGTH_LABELS: Record<DialogueLength, string> = {
  short: '3-5轮',
  medium: '6-10轮',
  long: '10轮以上',
};

function formatCharacters(config: IcebergConfig): string {
  return config.characters
    .map((c) => `- ${c.name}（${c.identity}）${c.relationship ? `，与对方的关系：${c.relationship}` : ''}`)
    .join('\n');
}

export class IcebergDialogueAgent extends BaseAgent {
  constructor() {
    super('IcebergDialogueAgent');
  }

  /**
   * 带 JSON 解析容错的调用：解析失败 → 降温重试 1 次 → 仍失败抛 422 并附原始输出
   */
  private async callJson<T>(system: string, user: string, options: ChatOptions): Promise<{ data: T; tokens: number }> {
    let tokens = 0;
    const opts: ChatOptions = { ...options, onUsage: (u) => { tokens = u.totalTokens; } };
    let rawText = '';
    try {
      rawText = await this.callWithRetry(this.buildMessages(system, user), opts);
      return { data: this.parseJsonResponse<T>(rawText), tokens };
    } catch (error: any) {
      if (!String(error?.message).includes('无法从LLM回复中解析JSON')) throw error;
    }
    // 降温重试 1 次
    this.log('JSON 解析失败，降温重试 1 次…', 'warn');
    try {
      rawText = await this.callWithRetry(this.buildMessages(system, user), {
        ...opts, temperature: Math.max(0.1, (options.temperature ?? 0.7) * 0.4),
      });
      return { data: this.parseJsonResponse<T>(rawText), tokens };
    } catch {
      throw new EngineError('LLM_OUTPUT_PARSE_ERROR', 422, 'LLM 输出 JSON 解析失败（已降温重试）', { rawOutput: rawText.slice(0, 2000) });
    }
  }

  /**
   * Step 1：真相层生成（温度 0.3）。全部角色已预设 true_intent+true_emotion 时跳过 LLM。
   */
  async generateTruthLayer(config: IcebergConfig): Promise<{ characters: TruthLayerCharacter[]; tokens: number }> {
    const allPreset = config.characters.every((c) => c.true_intent && c.true_emotion);
    if (allPreset) {
      this.log('所有角色已预设真实意图/情绪，跳过 Step1 LLM 调用');
      return {
        characters: config.characters.map((c) => ({
          name: c.name,
          true_intent: c.true_intent!,
          true_emotion: c.true_emotion!,
          core_tension: `${c.true_emotion}，却必须掩饰`,
        })),
        tokens: 0,
      };
    }

    const system = '你是一位资深仙侠小说编剧，擅长设计角色的潜台词与内心张力。只输出 JSON，不要输出任何其他内容。';
    const user = `请分析以下场景，确定每个角色的真实意图和真实情绪。

【场景】：${config.scene}
【角色列表】：
${formatCharacters(config)}
【冲突背景】：${config.conflict_context}

请输出每个角色的：
1. 真实意图：角色心底真正想要的/想隐瞒的是什么
2. 真实情绪：角色此刻的真实情绪是什么
3. 核心矛盾：角色的真实意图与表层表现之间的张力是什么

${config.characters.some((c) => c.true_intent) ? `注意：以下角色已有预设意图，请保留并补齐其余角色：${config.characters.filter((c) => c.true_intent).map((c) => `${c.name}（意图：${c.true_intent}）`).join('；')}` : ''}

输出格式：JSON
{
  "characters": [
    {
      "name": "角色名",
      "true_intent": "真实意图",
      "true_emotion": "真实情绪",
      "core_tension": "核心矛盾"
    }
  ]
}`;
    const { data, tokens } = await this.callJson<{ characters: TruthLayerCharacter[] }>(system, user, {
      temperature: 0.3, maxTokens: 1500,
    });
    if (!Array.isArray(data.characters) || data.characters.length === 0) {
      throw new EngineError('LLM_OUTPUT_PARSE_ERROR', 422, '真相层输出缺少 characters 数组');
    }
    return { characters: data.characters, tokens };
  }

  /**
   * Step 2：表层台词生成（温度 0.75）
   */
  async generateSurfaceLayer(
    config: IcebergConfig, truthLayer: TruthLayerCharacter[]
  ): Promise<{ dialogue: SurfaceLine[]; tokens: number }> {
    const system = '你是一位资深仙侠小说编剧，擅长写"话里有话"的潜台词对话。只输出 JSON，不要输出任何其他内容。';
    const user = `请根据角色的真实意图，生成一段对话。

【场景】：${config.scene}
【角色列表】：
${formatCharacters(config)}
【冲突背景】：${config.conflict_context}

【角色真实意图】：
${JSON.stringify(truthLayer, null, 2)}

【掩饰策略】：${DISGUISE_LABELS[config.disguise_strategy]}

要求：
1. 角色说出来的话必须与真实意图有偏差，可以是反话、转移话题、客套、轻描淡写等
2. 绝对不能让角色直接说出真实意图
3. 台词要符合角色身份和仙侠语境
4. 对话长度：${LENGTH_LABELS[config.dialogue_length]}

输出格式：JSON
{
  "dialogue": [
    {
      "speaker": "角色名",
      "line": "台词内容"
    }
  ]
}`;
    const { data, tokens } = await this.callJson<{ dialogue: SurfaceLine[] }>(system, user, {
      temperature: 0.75, maxTokens: 3000,
    });
    if (!Array.isArray(data.dialogue) || data.dialogue.length === 0) {
      throw new EngineError('LLM_OUTPUT_PARSE_ERROR', 422, '表层台词输出缺少 dialogue 数组');
    }
    return { dialogue: data.dialogue, tokens };
  }

  /**
   * Step 3：行为锚点生成（温度 0.75）
   * 先从行为锚点库按情绪匹配候选注入 Prompt（§7.8 使用方式），再由 LLM 结合场景微调。
   */
  async generateBehaviorLayer(
    config: IcebergConfig, truthLayer: TruthLayerCharacter[], surfaceLayer: SurfaceLine[]
  ): Promise<{ behaviorAnchors: BehaviorAnchorLine[]; tokens: number }> {
    // 按角色真实情绪匹配锚点库候选
    const anchorHints = truthLayer
      .map((ch) => {
        const group = matchAnchorGroup(ch.true_emotion, config.behavior_anchor_library);
        if (!group) return null;
        return `- ${ch.name}（真实情绪：${ch.true_emotion}）可参考的方向：${group.anchors.slice(0, 3).join(' / ')}`;
      })
      .filter(Boolean)
      .join('\n');

    const system = '你是一位资深仙侠小说编剧，擅长用下意识的微动作暴露角色内心。只输出 JSON，不要输出任何其他内容。';
    const user = `请为以下每句台词配上一个行为锚点（下意识动作/微表情）。

【角色真实意图】：
${JSON.stringify(truthLayer, null, 2)}

【对话内容】：
${JSON.stringify(surfaceLayer, null, 2)}

${anchorHints ? `【行为锚点库候选（参考方向，需结合场景微调，不要照抄重复）】：\n${anchorHints}\n` : ''}
要求：
1. 每个行为锚点必须暴露角色的真实意图，与表层台词形成反差
2. 行为锚点必须是下意识的、不自觉的动作，不是刻意做出来的
3. 仙侠语境：优先使用与修为、灵力、法器、御剑等相关的动作描写
4. 每个行为锚点控制在25字以内，简洁有力
5. behavior_anchors 数组与对话逐句一一对应（同顺序、同数量）

输出格式：JSON
{
  "behavior_anchors": [
    {
      "speaker": "角色名",
      "action": "行为描写"
    }
  ]
}`;
    const { data, tokens } = await this.callJson<{ behavior_anchors: BehaviorAnchorLine[] }>(system, user, {
      temperature: 0.75, maxTokens: 3000,
    });
    if (!Array.isArray(data.behavior_anchors) || data.behavior_anchors.length === 0) {
      throw new EngineError('LLM_OUTPUT_PARSE_ERROR', 422, '行为锚点输出缺少 behavior_anchors 数组');
    }
    return { behaviorAnchors: data.behavior_anchors, tokens };
  }
}

/** 整合台词+行为描写为完整对话文本（§7.5 输出格式） */
export function assembleFullDialogue(surfaceLayer: SurfaceLine[], behaviorLayer: BehaviorAnchorLine[]): string {
  return surfaceLayer
    .map((s, i) => {
      const b = behaviorLayer[i];
      return b && b.action ? `${s.speaker}："${s.line}"（${b.action}）` : `${s.speaker}："${s.line}"`;
    })
    .join('\n');
}
