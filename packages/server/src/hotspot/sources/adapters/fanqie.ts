/**
 * 番茄小说 男频玄幻/仙侠榜单聚合适配器。
 * 遍历多个男频玄幻分类榜（/rank/1_1_{catId}），解析页面内嵌 JSON 中的书目对象，
 * 合并去重后返回。单类失败跳过（best-effort），不影响其它分类。
 */
import { fetchText, sleep, type RawNovel, type SourceAdapter } from '../types.js';
import { decodeFanqieText } from './fanqie-font.js';

/** 男频玄幻/仙侠分类：中文名 → 番茄分类 id */
const MALE_XUANHUAN_CATEGORIES: Array<{ name: string; id: number }> = [
  { name: '东方仙侠', id: 1140 },
  { name: '传统玄幻', id: 258 },
  { name: '西方奇幻', id: 1141 },
  { name: '玄幻脑洞', id: 257 },
  { name: '都市修真', id: 124 },
  { name: '都市高武', id: 1014 },
];

/** 每个分类抓取的条数 */
const PER_CATEGORY = 10;

interface FanqieBook {
  bookName: string;
  author?: string;
  abstract?: string;
  wordNumber?: string;
  bookId?: string;
  readCount?: string;
  creationStatus?: string;
}

/**
 * 从番茄榜单页 HTML 内嵌 JSON 中抽取书目。
 * 每本书是一个完整 JSON 对象，但字段顺序每次随机打乱：
 * 以 "bookName" 为锚点，带字符串状态回溯/前扫括号边界，整个对象 JSON.parse。
 */
function extractFanqieBooks(html: string): FanqieBook[] {
  const books: FanqieBook[] = [];
  const seen = new Set<string>();
  const re = /"bookName":"/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html))) {
    // 回溯本对象起点 '{'（锚点处于对象顶层，中途遇 '}' 先抵消嵌套）
    let depth = 0;
    let start = -1;
    for (let i = m.index; i >= 0 && i > m.index - 4000; i--) {
      const c = html[i];
      if (c === '}') depth++;
      else if (c === '{') {
        if (depth === 0) { start = i; break; }
        depth--;
      }
    }
    if (start < 0) continue;
    // 前扫到对象结束 '}'，跳过字符串内的花括号
    let end = -1;
    depth = 0;
    let inStr = false;
    for (let i = start; i < html.length && i < start + 8000; i++) {
      const c = html[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) continue;
    try {
      const obj = JSON.parse(html.slice(start, end + 1)) as Record<string, unknown>;
      if (typeof obj.bookName !== 'string' || !obj.bookName) continue;
      const key = String(obj.bookId ?? obj.bookName);
      if (seen.has(key)) continue;
      seen.add(key);
      books.push({
        bookName: obj.bookName,
        author: typeof obj.author === 'string' ? obj.author : undefined,
        abstract: typeof obj.abstract === 'string' ? obj.abstract : undefined,
        wordNumber: obj.wordNumber != null ? String(obj.wordNumber) : undefined,
        bookId: obj.bookId != null ? String(obj.bookId) : undefined,
        readCount: obj.readCount != null ? String(obj.readCount) : (obj.read_count != null ? String(obj.read_count) : undefined),
        creationStatus: obj.creationStatus != null ? String(obj.creationStatus) : undefined,
      });
    } catch {
      // 单个对象解析失败跳过
    }
    re.lastIndex = end + 1;
  }
  return books;
}

function toRawNovels(books: FanqieBook[], categoryName: string): RawNovel[] {
  return books
    .slice(0, PER_CATEGORY)
    .map((b, idx) => {
      const status = b.creationStatus === '0' ? '连载中' : b.creationStatus ? '完结' : undefined;
      return {
        rank: idx + 1,
        // 番茄有字体反爬（PUA 码点替换常用字），书名/作者/简介均需解码还原
        title: decodeFanqieText(b.bookName).trim(),
        author: b.author ? decodeFanqieText(b.author).trim() || undefined : undefined,
        category: categoryName,
        tags: [categoryName, ...(status ? [status] : [])],
        intro: b.abstract ? decodeFanqieText(b.abstract.replace(/\\n/g, '\n')).trim() || undefined : undefined,
        wordCount: b.wordNumber || undefined,
        popularity: b.readCount || undefined,
        url: b.bookId ? `https://fanqienovel.com/page/${b.bookId}` : undefined,
        raw: { ...b, source: 'fanqie_male_xuanhuan', category: categoryName },
      } as RawNovel;
    })
    .filter((n) => n.title);
}

export const fanqieMaleAdapter: SourceAdapter = {
  name: 'fanqie_male_xuanhuan',
  label: '番茄·男频玄幻/仙侠',
  kind: 'page',
  description: '番茄小说男频玄幻/仙侠全类榜单（东方仙侠/传统玄幻/西方奇幻/都市修真等）',
  async fetchRanking(limit: number): Promise<RawNovel[]> {
    const merged: RawNovel[] = [];
    const seen = new Set<string>();

    for (const cat of MALE_XUANHUAN_CATEGORIES) {
      if (merged.length >= limit) break;
      try {
        const html = await fetchText(`https://fanqienovel.com/rank/1_1_${cat.id}`, { timeoutMs: 20000 });
        const novels = toRawNovels(extractFanqieBooks(html), cat.name);
        for (const n of novels) {
          const key = `${n.title}__${n.author ?? ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(n);
        }
      } catch {
        // 单类失败跳过，不影响其它分类
      }
      await sleep(600);
    }

    // 重新编号排名并截断
    return merged.slice(0, limit).map((n, i) => ({ ...n, rank: i + 1 }));
  },
};
