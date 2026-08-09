/**
 * 冲突三要素生成 Agent（PRD v1.3 模块二，§8.3 欲望前置工作流 / §8.6 Prompt 模板）
 *
 * 三阶段顺序强制：Phase1 欲望建立（300-500字）→ Phase2 阻力降临（500-800字）→ Phase3 代价落地（200-300字）
 * 输出为纯文本段落；七寸映射表（§8.8）在 Phase2 Prompt 中作为阻力设计方向注入。
 */
import { BaseAgent } from './base.js';
import type { ChatOptions } from '../llm/client.js';
import { EngineError } from '../dual-engine/errors.js';
import { getSevenInchEntry, type DesireTypeKey } from '../data/desire-resistance-mapping.js';
import type { ConflictConfig } from '../dual-engine/schemas.js';

const RESISTANCE_TYPE_LABELS: Record<string, string> = {
  rejection: '拒绝',
  humiliation: '羞辱',
  negation_of_effort: '否定努力',
  negation_of_desire: '否定欲望',
  physical: '物理打击',
};

const PRECISION_LABELS: Record<string, string> = {
  auto: '由你把握，务必打在欲望七寸上',
  high: '极高——阻力必须分毫不差地命中主角最在乎的东西',
  medium: '中等——阻力应基本对准欲望核心',
  low: '宽松——阻力方向大致相关即可',
};

export class ConflictGeneratorAgent extends BaseAgent {
  constructor() {
    super('ConflictGeneratorAgent');
  }

  /** 纯文本调用（输出非 JSON，无需解析；空输出视为失败重试 1 次） */
  private async callText(user: string, options: ChatOptions): Promise<{ text: string; tokens: number }> {
    let tokens = 0;
    const opts: ChatOptions = { ...options, onUsage: (u) => { tokens = u.totalTokens; } };
    const system = '你是一位资深仙侠小说冲突设计师。只输出正文文本，不要输出标题、序号、解释或其他任何附加内容。';
    for (let attempt = 1; attempt <= 2; attempt++) {
      const text = (await this.callWithRetry(this.buildMessages(system, user), opts)).trim();
      if (text.length > 20) return { text, tokens };
      if (attempt === 1) this.log('阶段输出过短，重试 1 次…', 'warn');
    }
    throw new EngineError('LLM_OUTPUT_PARSE_ERROR', 422, '冲突阶段文本生成失败（输出为空）');
  }

  /** Phase 1：欲望建立 */
  async generateDesirePhase(config: ConflictConfig, words: number): Promise<{ text: string; tokens: number }> {
    const user = `请写一段"欲望建立"的文字，让读者共情主角的渴望。

【主角】：${config.protagonist.name}（${config.protagonist.identity}${config.protagonist.current_status ? `，现状：${config.protagonist.current_status}` : ''}）
【具体渴望】：${config.desire.target}
【为什么在乎】：${config.desire.why_it_matters}
【场景】：${config.scene_setting}

要求：
1. 用一个具体的场景来展现欲望，不要抽象描述
2. 写出主角的期待感——小动作、内心独白、默默准备
3. 让读者产生"这次应该能成吧"的预判
4. 仙侠语境，使用修为、宗门、法器等元素
5. 字数：约${words}字`;
    return this.callText(user, { temperature: 0.75, maxTokens: words * 3 });
  }

  /** Phase 2：阻力降临（注入七寸映射方向） */
  async generateResistancePhase(
    config: ConflictConfig, desirePhase: string, words: number, resolvedDesireType: DesireTypeKey | null
  ): Promise<{ text: string; tokens: number }> {
    const entry = getSevenInchEntry(resolvedDesireType ?? undefined, config.seven_inch_mapping);
    const sevenInchHint = entry
      ? `\n【七寸参考】该欲望类型的七寸是：${entry.sevenInch}；可选阻力设计方向：${entry.resistanceDesigns.join(' / ')}；仙侠示例：${entry.xianxiaExample}（参考方向，结合本场景变化使用，不要照抄）`
      : '';

    const user = `请写一段"阻力降临"的文字，精准打碎刚刚建立的期待。

【主角】：${config.protagonist.name}（${config.protagonist.identity}）
【具体渴望】：${config.desire.target}
【阻力来源】：${config.resistance.source}
【阻力类型】：${RESISTANCE_TYPE_LABELS[config.resistance.type] || config.resistance.type}
【七寸精准度】：${PRECISION_LABELS[config.resistance.precision]}${sevenInchHint}
【场景】：${config.scene_setting}

【前文】：
${desirePhase}

要求：
1. 阻力必须精准打在欲望的"七寸"上——主角最在乎什么就毁掉什么
2. 当众/公开场合，放大羞辱感
3. 拉踩对比：拿别人和主角比，踩一捧一
4. 否定努力：主角拼尽全力得到的，被一句话抹掉
5. 仙侠语境：修为被废、道心被质疑、宗门除名等
6. 字数：约${words}字`;
    return this.callText(user, { temperature: 0.8, maxTokens: words * 3 });
  }

  /** Phase 3：代价落地 */
  async generateCostPhase(
    config: ConflictConfig, desirePhase: string, resistancePhase: string, words: number
  ): Promise<{ text: string; tokens: number }> {
    const user = `请写一段"代价落地"的文字，让读者知道"输不起"。

【主角】：${config.protagonist.name}（${config.protagonist.identity}）
【失去什么】：${config.cost.what_is_lost}
【不可逆程度】：${config.cost.irreversibility}
【情感重量】：${config.cost.emotional_weight}/5

【前文】：
${desirePhase}
${resistancePhase}

要求：
1. 代价必须是"输不起"的级别，不能是不痛不痒的
2. 不是"丢脸"，是"永远失去尊严/道心/机会"
3. 写出主角的内心崩塌瞬间
4. 让读者的共情达到峰值
5. 仙侠语境：道心破碎、修为尽废、寿元受损等
6. 字数：约${words}字`;
    return this.callText(user, { temperature: 0.8, maxTokens: words * 3 });
  }
}

/** 拼接完整冲突场景文本（三阶段按顺序） */
export function assembleFullScene(desirePhase: string, resistancePhase: string, costPhase: string): string {
  return `${desirePhase}\n\n${resistancePhase}\n\n${costPhase}`;
}
