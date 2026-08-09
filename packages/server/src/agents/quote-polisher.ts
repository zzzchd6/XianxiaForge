/**
 * 金句美化Agent（需求11 US-2）
 * 对金句生成3个梯度美化版本（保守润色/平衡打磨/深度升华），每版附修改说明。
 * 原则：不改原意、不堆砌辞藻、符合人物口吻、保留口语感；宁可不改也不要改坏。
 */
import { BaseAgent } from './base.js';

export type PolishStyle = 'conservative' | 'balanced' | 'deep';

export interface PolishVersion {
  style: PolishStyle;
  /** 美化后的文本 */
  text: string;
  /** 修改说明：改了哪几个字、为什么改、用了什么典 */
  note: string;
}

class QuotePolisherAgent extends BaseAgent {
  constructor() {
    super('QuotePolisherAgent', 2);
  }

  /**
   * 美化一条金句，返回3个梯度版本
   * @param text 原句
   * @param meta 上下文（人物/场景，用于贴合口吻）
   */
  async polish(
    text: string,
    meta?: { characterName?: string; sceneDesc?: string }
  ): Promise<PolishVersion[]> {
    const systemPrompt = `你是一位古典文学功底深厚的小说润色大师，负责打磨金句。

【美化维度】
①平仄韵律：声调抑扬顿挫，避免三连平/三连仄
②节奏感：句式长短有致，朗朗上口
③意象升级：用具象替代抽象（"他很厉害"→"他一剑出，万山低眉"）
④用典化古：化用古诗词/典故增加底蕴，是"化用"不是"引用"，绝不生硬堆砌
⑤哲理提炼：道理类句子说得更深刻通透
⑥情感浓度：抒情类句子增强感染力
⑦简洁有力：删冗余字，一字不可易

【铁律】
- 不改变原句核心意思，只润色表达
- 不是越华丽越好，恰到好处；宁可不改也不要改坏
- 符合人物身份：粗人不说酸话，仙人不说俗话
- 台词要像人说的，不要全是骈文

【三个版本梯度】
- conservative 保守润色：改3-5个字，微调韵律，基本保留原句
- balanced 平衡打磨：改5-10个字，升级意象，调整节奏（推荐版）
- deep 深度升华：可重写半句，提炼哲理，化用典故

输出严格JSON数组（3项，顺序为conservative/balanced/deep），每项格式：
{"style":"conservative|balanced|deep","text":"美化后文本","note":"40字内修改说明：改了哪里、为何改、用了什么典"}
不要输出任何其他文字。`;

    const userPrompt = `${meta?.characterName ? `说话人物：${meta.characterName}\n` : ''}${
      meta?.sceneDesc ? `所在场景：${meta.sceneDesc}\n` : ''
    }原句：「${text}」`;

    const raw = await this.callWithRetry(this.buildMessages(systemPrompt, userPrompt), {
      temperature: 0.7,
      // 预算给足：若走思考模型（如项目级配置覆盖为 glm-5.2），reasoning token 也计入上限，
      // 预算不足会导致 JSON 截断 →「美化未返回有效版本」
      maxTokens: 4096,
    });

    const parsed = this.parseJsonResponse<any[]>(raw);
    if (!Array.isArray(parsed)) return [];

    const styles: PolishStyle[] = ['conservative', 'balanced', 'deep'];
    const result: PolishVersion[] = [];
    for (const style of styles) {
      // 优先按style字段匹配，找不到再按顺序兜底
      const item =
        parsed.find((p) => p && p.style === style && typeof p.text === 'string') ||
        parsed[styles.indexOf(style)];
      if (item && typeof item.text === 'string' && item.text.trim()) {
        result.push({
          style,
          text: item.text.trim(),
          note: typeof item.note === 'string' ? item.note.slice(0, 120) : '',
        });
      }
    }
    return result;
  }
}

export const quotePolisherAgent = new QuotePolisherAgent();
