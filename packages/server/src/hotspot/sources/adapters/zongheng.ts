/** 纵横中文网 排行榜（新版 Nuxt SSR 页面，解析 window.__NUXT__ payload） */
import vm from 'node:vm';
import { fetchText, matchXianxiaGenre, type RawNovel, type SourceAdapter } from '../types.js';

interface NuxtBook {
  bookId?: number | string;
  bookName?: string;
  authorName?: string;
  description?: string;
  serialStatus?: string;
  totalWords?: number | string;
  number?: number | string;
  numberDesc?: string;
  rankNo?: number | string;
  cateName?: string;
  cateFineName?: string;
}

/** 从纵横榜单页 HTML 中提取 __NUXT__ 里的书目数组 */
function extractNuxtBooks(html: string): NuxtBook[] {
  const start = html.indexOf('window.__NUXT__=');
  if (start < 0) throw new Error('页面中未找到 __NUXT__ 数据（可能被反爬拦截）');
  const end = html.indexOf('</script>', start);
  const expr = html.slice(start + 'window.__NUXT__='.length, end).replace(/;\s*$/, '');
  // payload 是 (function(a,b,...){return {...}})(...) 形式，在无全局的沙箱里求值
  const data = vm.runInNewContext(expr, Object.create(null), { timeout: 3000 });

  // 深度遍历，找第一个元素带 bookName 的数组
  let found: NuxtBook[] = [];
  const walk = (o: unknown): void => {
    if (found.length || !o || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      if (o.length && o[0] && typeof o[0] === 'object' && 'bookName' in (o[0] as object)) {
        found = o as NuxtBook[];
        return;
      }
      for (const it of o) walk(it);
      return;
    }
    for (const k of Object.keys(o as Record<string, unknown>)) walk((o as Record<string, unknown>)[k]);
  };
  walk(data);
  return found;
}

function toRawNovels(books: NuxtBook[], limit: number, source: string): RawNovel[] {
  return books.map((b, idx) => ({
    rank: Number(b.rankNo) || idx + 1,
    title: String(b.bookName ?? '').trim(),
    author: b.authorName ? String(b.authorName).trim() : undefined,
    category: (b.cateFineName || b.cateName || '').trim() || undefined,
    intro: b.description ? String(b.description).trim() : undefined,
    tags: b.serialStatus ? [String(b.serialStatus)] : undefined,
    wordCount: b.totalWords != null ? String(b.totalWords) : undefined,
    popularity: b.numberDesc || (b.number != null ? String(b.number) : undefined),
    url: b.bookId ? `https://www.zongheng.com/detail/${b.bookId}` : undefined,
    raw: { ...b, source },
  }))
    .filter((n) => n.title)
    // 只保留仙侠/玄幻题材（剔除都市/历史/奇闻异事等），过滤后为空则降级返回空
    .filter((n) => matchXianxiaGenre(n.category, n.tags))
    .slice(0, limit);
}

export const zonghengAdapter: SourceAdapter = {
  name: 'zongheng_yuepiao',
  label: '纵横·月票榜',
  kind: 'page',
  description: '纵横中文网月票排行榜（解析 SSR 数据）',
  async fetchRanking(limit: number): Promise<RawNovel[]> {
    const html = await fetchText('https://www.zongheng.com/rank?nav=monthly-ticket', { timeoutMs: 20000 });
    return toRawNovels(extractNuxtBooks(html), limit, 'zongheng_yuepiao');
  },
};

export const zonghengHotAdapter: SourceAdapter = {
  name: 'zongheng_renqi',
  label: '纵横·人气榜',
  kind: 'page',
  description: '纵横中文网人气排行榜（解析 SSR 数据）',
  async fetchRanking(limit: number): Promise<RawNovel[]> {
    const html = await fetchText('https://www.zongheng.com/rank?nav=default', { timeoutMs: 20000 });
    return toRawNovels(extractNuxtBooks(html), limit, 'zongheng_renqi');
  },
};
