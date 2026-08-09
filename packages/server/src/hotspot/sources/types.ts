/** 榜单源适配器统一契约与数据结构 */

/** 抓取到的单本书目（统一字段） */
export interface RawNovel {
  rank?: number;
  title: string;
  author?: string;
  category?: string;
  tags?: string[];
  intro?: string;
  wordCount?: string;
  popularity?: string;
  url?: string;
  /** 原始补充字段 */
  raw?: Record<string, unknown>;
}

/** 榜单源适配器接口（可插拔） */
export interface SourceAdapter {
  /** 唯一名称（用于前端选择与去重） */
  name: string;
  /** 展示名 */
  label: string;
  /** 类型：page=HTML页面解析 / api=开放接口 */
  kind: 'page' | 'api';
  /** 榜单描述 */
  description?: string;
  /** 抓取榜单，返回统一书目数组 */
  fetchRanking(limit: number): Promise<RawNovel[]>;
}

/** 通用 fetch 封装：带 UA、超时、文本返回（支持 gb18030 等非 UTF-8 编码） */
export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; charset?: string } = {},
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...opts.headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (opts.charset) {
      const buf = await res.arrayBuffer();
      return new TextDecoder(opts.charset).decode(buf);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 通用 fetch JSON */
export async function fetchJson<T = any>(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const text = await fetchText(url, opts);
  return JSON.parse(text) as T;
}

/** 请求间隔，降低被限流概率 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 仙侠/玄幻题材分类关键词白名单（用于按题材过滤，剔除现代言情/都市日常等） */
export const XIANXIA_CATEGORY_KEYWORDS = [
  '玄幻', '奇幻', '仙侠', '修真', '修仙', '武侠', '幻想', '异世', '东方', '洪荒', '灵异',
];

/**
 * 判断一本书是否属于仙侠/玄幻题材。
 * 命中 category 或任一 tag 含白名单关键词即视为命中。
 */
export function matchXianxiaGenre(category?: string, tags?: string[]): boolean {
  const hay = [category ?? '', ...(tags ?? [])].join(' ');
  if (!hay.trim()) return false;
  return XIANXIA_CATEGORY_KEYWORDS.some((k) => hay.includes(k));
}
