/**
 * 金句质量评审Agent（需求11 US-1）
 * 对候选金句做五维评分 + "是否值得入库"二次校验，对抗LLM打分膨胀。
 * 打分纪律写死在prompt里：普通佳句60-75，真正出彩80-89，传世级90+。
 * total由本地按五维求和计算，不信任LLM给出的总分。
 */
import { BaseAgent } from './base.js';

/** 五维评分（各20分，总分100） */
export interface QuoteScores {
  /** 意境/画面感 */
  imagery: number;
  /** 韵律/节奏 */
  rhythm: number;
  /** 哲理深度 */
  philosophy: number;
  /** 情感张力 */
  emotion: number;
  /** 传播性/记忆点 */
  viral: number;
  /** 总分（本地求和） */
  total: number;
}

export interface JudgeCandidate {
  quoteText: string;
  characterName?: string;
  sceneDesc?: string;
}

export interface JudgeVerdict {
  /** 是否值得收入金句库（≥80分且非普通对话/叙述） */
  worthy: boolean;
  scores: QuoteScores;
  /** 一句话评审理由 */
  reason: string;
}

class QuoteJudgeAgent extends BaseAgent {
  constructor() {
    super('QuoteJudgeAgent', 2);
  }

  /**
   * 批量评审候选金句（一次LLM调用）
   * @param candidates 候选列表（建议≤10条）
   */
  async evaluate(candidates: JudgeCandidate[]): Promise<JudgeVerdict[]> {
    if (candidates.length === 0) return [];

    const systemPrompt = `你是一位极其严苛的网文金句评审。只有真正值得被读者摘抄、做签名档、写进书评的句子才算金句。

【金句标准（至少满足3条）】
①有记忆点：读完能记住，想转述给别人
②有画面感：一读脑子里就有图
③有哲理：说得通透，让人想抄下来
④有情感张力：戳心、热血、怅然，能调动情绪
⑤有韵律感：读起来顺口，抑扬顿挫
⑥有人物烙印：这话只能从这个人物嘴里说出来
⑦有传播性：适合做签名档、书评标题

【以下不是金句，一律worthy=false】
- 日常对话："我们走吧""你来了""多谢"
- 情节交代："他走到门口""三日后到达京城"
- 普通叙述："今天天气很好""他修为很高"
- 脱离上下文看不懂的、重复啰嗦的

【五维评分（各维度0-20分）】
imagery 意境画面 / rhythm 韵律节奏 / philosophy 哲理深度 / emotion 情感张力 / viral 传播记忆点

【打分纪律（严格执行，禁止膨胀）】
- 平庸、普通对话、叙述句：worthy=false，各维3-8分
- 尚可的句子但谈不上出彩：worthy=false，各维8-12分
- 真正出彩的佳句：worthy=true，各维13-17分
- 传世级（本书门面句）：worthy=true，各维18-20分
- 宁缺毋滥：拿不准就打低分。10条候选里worthy=true的通常不超过3条

输出严格JSON数组，与输入顺序一一对应，每项格式：
{"worthy":true/false,"scores":{"imagery":0-20,"rhythm":0-20,"philosophy":0-20,"emotion":0-20,"viral":0-20},"reason":"15字内理由"}
不要输出任何其他文字。`;

    const userPrompt = `候选金句列表：
${candidates
  .map(
    (c, i) =>
      `${i + 1}. 「${c.quoteText}」${c.characterName ? `（人物：${c.characterName}）` : ''}${c.sceneDesc ? `（场景：${c.sceneDesc}）` : ''}`
  )
  .join('\n')}`;

    const raw = await this.callWithRetry(this.buildMessages(systemPrompt, userPrompt), {
      temperature: 0.1,
      // 批量评分输出较长；若走思考模型 reasoning token 也计入上限，预算给足防截断
      maxTokens: 4096,
    });

    const parsed = this.parseJsonResponse<any[]>(raw);
    if (!Array.isArray(parsed)) return [];

    return candidates.map((_, i) => {
      const r = parsed[i] || {};
      const scores = normalizeScores(r.scores);
      return {
        worthy: r.worthy === true,
        scores,
        reason: typeof r.reason === 'string' ? r.reason.slice(0, 60) : '',
      };
    });
  }
}

/** 归一化五维分数并本地求和（防LLM总分膨胀） */
function normalizeScores(raw: any): QuoteScores {
  const clamp = (v: any) => {
    const n = typeof v === 'number' && isFinite(v) ? Math.round(v) : 0;
    return Math.max(0, Math.min(20, n));
  };
  const s = raw && typeof raw === 'object' ? raw : {};
  const imagery = clamp(s.imagery);
  const rhythm = clamp(s.rhythm);
  const philosophy = clamp(s.philosophy);
  const emotion = clamp(s.emotion);
  const viral = clamp(s.viral);
  return { imagery, rhythm, philosophy, emotion, viral, total: imagery + rhythm + philosophy + emotion + viral };
}

export const quoteJudgeAgent = new QuoteJudgeAgent();

/** 由总分计算质量分级 */
export function gradeOfTotal(total: number): 'legendary' | 'good' | 'candidate' {
  if (total >= 90) return 'legendary';
  if (total >= 80) return 'good';
  return 'candidate';
}
