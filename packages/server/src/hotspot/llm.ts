/**
 * LLM 客户端（OpenAI-compatible），复用 novel-studio 根 .env 的 LLM_* 配置。
 * 提供带 JSON 解析与重试的聊天补全封装（容忍 ```json 围栏、噪声、max_tokens 截断）。
 */
import OpenAI from 'openai';

const llm = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
  apiKey: process.env.LLM_API_KEY || '',
});

function llmModel(): string {
  return process.env.LLM_MODEL || 'deepseek-chat';
}
function llmMaxTokens(): number {
  return Number(process.env.LLM_MAX_TOKENS ?? '8192');
}
function llmTemperature(): number {
  return Number(process.env.LLM_TEMPERATURE ?? '0.8');
}

/** 从 LLM 回复中稳健提取 JSON（容忍 ```json 代码块、前后噪声、max_tokens 截断） */
export function extractJson(text: string): any {
  if (!text) throw new Error('空回复');
  // 去除 markdown 代码围栏
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  if (fence) s = fence[1].trim();
  // 尝试直接解析
  try {
    return JSON.parse(s);
  } catch {
    // 截取第一个 { 或 [ 到最后一个 } 或 ]
    const start = s.search(/[[{]/);
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        // 输出被 max_tokens 截断时打捞完整的顶层对象
        const salvaged = salvageJsonArray(s.slice(start));
        if (salvaged.length) return salvaged;
      }
    }
    throw new Error('无法解析 JSON: ' + s.slice(0, 200));
  }
}

/**
 * 打捞截断的 JSON 数组：用字符串状态+括号深度扫描顶层对象边界，
 * 逐个 JSON.parse 完整对象，丢弃末尾残缺部分（同番茄适配器的括号边界法）。
 */
function salvageJsonArray(s: string): any[] {
  const items: any[] = [];
  if (!s.startsWith('[')) return items;
  let depth = 0;
  let objStart = -1;
  let inStr = false;
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') i++; // 跳过转义字符
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          items.push(JSON.parse(s.slice(objStart, i + 1)));
        } catch {
          // 单个对象坏掉则跳过，不影响其余
        }
        objStart = -1;
      }
    }
  }
  return items;
}

/**
 * 调用 LLM 并返回解析后的 JSON，失败自动重试。
 * minItems：期望数组的最低条数，截断打捞后条数不足视为本次失败继续重试；
 * 多次尝试中保留条数最多的一次结果兜底返回，避免全部作废。
 */
export async function chatJson(
  systemPrompt: string,
  userPrompt: string,
  retries = 2,
  minItems = 0,
): Promise<any> {
  let lastErr: unknown;
  let best: any[] | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await llm.chat.completions.create({
        model: llmModel(),
        temperature: llmTemperature(),
        max_tokens: llmMaxTokens(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      const choice = resp.choices[0];
      const content = choice?.message?.content ?? '';
      console.log(
        `[hotspot-llm] 第 ${attempt + 1} 次响应: finish=${choice?.finish_reason ?? '?'} 长度=${content.length}字`,
      );
      const parsed = extractJson(content);
      if (minItems > 0 && Array.isArray(parsed)) {
        if (!best || parsed.length > best.length) best = parsed;
        if (parsed.length < minItems) {
          throw new Error(`解析成功但仅 ${parsed.length} 条，低于下限 ${minItems}，重试`);
        }
      }
      return parsed;
    } catch (e) {
      lastErr = e;
      console.warn(`[hotspot-llm] 第 ${attempt + 1} 次调用失败: ${(e as Error).message}`);
    }
  }
  // 全部尝试未达标：有打捞结果就用条数最多的一次
  if (best && best.length > 0) {
    console.warn(`[hotspot-llm] 重试耗尽，使用最佳打捞结果（${best.length} 条）`);
    return best;
  }
  throw lastErr;
}
