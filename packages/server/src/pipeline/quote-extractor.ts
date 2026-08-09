/**
 * 名场面+金句自动提取（模块11）
 * 需求11升级：提取只负责"挑候选"，评分/二次校验/美化/去重/入库由 services/quote-service.ts 编排。
 * 评分标准见 agents/quote-judge.ts，美化见 agents/quote-polisher.ts。
 */
import { chatCompletion } from '../llm/client.js';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';

interface ExtractedQuote {
  characterName?: string;
  quoteText: string;
  sceneDesc?: string;
}

/**
 * 从章节正文提取金句候选（不评分、不入库，宁缺毋滥）
 * @param projectId 项目ID（保留参数，供未来按项目配置风格）
 * @param content 章节正文
 * @param title 章节标题（可选）
 * @returns 候选列表（最多10条，后续由judge评分过滤）
 */
export async function extractQuoteCandidates(
  projectId: number,
  content: string,
  title?: string
): Promise<ExtractedQuote[]> {
  // 正文过短则跳过
  if (!content || content.length < 500) return [];

  // 截取前8000字避免token过长
  const trimmed = content.slice(0, 8000);

  const systemPrompt = `你是一位资深小说编辑，负责从章节中挑出"金句候选"。注意：你只负责挑候选，后续还有严苛评审，所以宁缺毋滥。

【什么是金句（至少满足3条）】
①有记忆点：读完能记住，想转述给别人
②有画面感：一读脑子里就有图
③有哲理：说得通透，让人想抄下来
④有情感张力：戳心、热血、怅然，能调动情绪
⑤有韵律感：读起来顺口，抑扬顿挫
⑥有人物烙印：这话只能从这个人物嘴里说出来
⑦有传播性：适合做签名档、书评标题

【以下绝对不是金句，不要挑】
- 日常对话："我们走吧""你来了""多谢"
- 情节交代："他走到门口""三日后到达京城"
- 普通叙述："今天天气很好""他修为很高"
- 重复啰嗦、脱离上下文看不懂的

输出严格JSON数组（最多10项，没有够格的句子就输出空数组[]），每项格式：
{"characterName":"说话人物名(无则null)","quoteText":"金句原文(10-50字,逐字照抄正文)","sceneDesc":"所在场景简述(20字内)"}
不要打分，不要输出任何其他文字。`;

  const userPrompt = `章节标题：${title || '未知'}
正文：
${trimmed}`;

  const raw = await chatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0.2, maxTokens: 1500 }
  );

  // 解析JSON
  const jsonStr = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  let quotes: ExtractedQuote[];
  try {
    quotes = JSON.parse(jsonStr);
  } catch {
    return []; // 解析失败静默跳过
  }

  if (!Array.isArray(quotes)) return [];

  return quotes
    .filter((q) => q && q.quoteText && q.quoteText.trim().length >= 8)
    .slice(0, 10)
    .map((q) => ({
      characterName: q.characterName || undefined,
      quoteText: q.quoteText.trim(),
      sceneDesc: q.sceneDesc || undefined,
    }));
}

/**
 * 获取项目已收藏的金句（供ContextComposer可选注入）
 * 人物感知召回：优先返回 characterNames 命中的金句（本章POV/出场人物），
 * 不足 limit 时再按 qualityScore 降序用全局收藏补足。最多返回 limit 条。
 * @param projectId 项目ID
 * @param characterNames 本章相关人物名（可空，空则退化为全局TopN）
 * @param limit 返回上限
 */
export async function getCollectedQuotes(
  projectId: number,
  characterNames?: string[],
  limit: number = 10
): Promise<{ characterName?: string; quoteText: string }[]> {
  const { eq, and, desc, inArray, sql } = await import('drizzle-orm');
  const names = (characterNames || []).filter((n): n is string => !!n && n.trim().length > 0);
  // 人物命中优先（0），其余靠后（1），组内按质量分降序；无人物参数时仅按质量分降序
  const orderByClauses = names.length
    ? [
        sql`CASE WHEN ${inArray(schema.projectQuoteLib.characterName, names)} THEN 0 ELSE 1 END`,
        desc(schema.projectQuoteLib.qualityScore),
      ]
    : [desc(schema.projectQuoteLib.qualityScore)];

  const collected = await creativeDb
    .select({
      characterName: schema.projectQuoteLib.characterName,
      quoteText: schema.projectQuoteLib.quoteText,
    })
    .from(schema.projectQuoteLib)
    .where(
      and(
        eq(schema.projectQuoteLib.projectId, projectId),
        eq(schema.projectQuoteLib.isCollected, true)
      )
    )
    .orderBy(...orderByClauses)
    .limit(limit);

  return collected.map((r) => ({
    characterName: r.characterName ?? undefined,
    quoteText: r.quoteText,
  }));
}

/** 批量导入候选金句（LLM预筛结果，未入库） */
export interface QuoteCandidate {
  quoteText: string;
  characterName?: string;
  sceneDesc?: string;
  qualityScore?: number;
}

/**
 * 从用户粘贴的参考文本中提取可借鉴的金句（批量导入·LLM预筛）
 * 只做挑选与轻量整理，不入库；最终由用户在前端审阅勾选后导入。
 * @param text 粘贴的参考文本（其他小说片段）
 * @returns 候选金句列表（最多20条）
 */
export async function extractQuotesFromPastedText(text: string): Promise<QuoteCandidate[]> {
  if (!text || text.trim().length < 20) return [];

  // 截取前12000字避免token过长
  const trimmed = text.slice(0, 12000);

  const systemPrompt = `你是一位小说编辑，负责从用户粘贴的参考文本中挑选值得借鉴的精彩金句与名场面台词。
输出严格JSON数组（最多20项），每项格式：
{"characterName":"说话人物名(根据上下文推断,推断不出则null)","quoteText":"金句原文(10-60字,保留原文措辞,仅去除多余修饰)","sceneDesc":"所在场景简述(20字内)","qualityScore":60-95整数}
优先挑选：①人物经典台词/内心独白 ②画面感强的名场面描写 ③有哲理或情感张力的句子。
不要输出任何其他文字。`;

  const raw = await chatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `参考文本：\n${trimmed}` },
    ],
    { temperature: 0.3, maxTokens: 2000 }
  );

  const jsonStr = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
  let quotes: QuoteCandidate[];
  try {
    quotes = JSON.parse(jsonStr);
  } catch {
    return [];
  }

  if (!Array.isArray(quotes)) return [];
  return quotes
    .filter((q) => q && q.quoteText && q.quoteText.trim())
    .slice(0, 20)
    .map((q) => ({
      quoteText: q.quoteText.trim(),
      characterName: q.characterName || undefined,
      sceneDesc: q.sceneDesc || undefined,
      qualityScore: typeof q.qualityScore === 'number' ? q.qualityScore : undefined,
    }));
}
