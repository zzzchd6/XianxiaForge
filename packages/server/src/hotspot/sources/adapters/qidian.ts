/** 起点中文网 月票榜（页面解析） */
import * as cheerio from 'cheerio';
import { fetchText, type RawNovel, type SourceAdapter } from '../types.js';

const RANK_URL = 'https://www.qidian.com/rank/yuepiao/';

export const qidianAdapter: SourceAdapter = {
  name: 'qidian_yuepiao',
  label: '起点·月票榜',
  kind: 'page',
  description: '起点中文网月票排行榜（站点反爬较严，可能抓不到数据，降级备用）',
  async fetchRanking(limit: number): Promise<RawNovel[]> {
    const html = await fetchText(RANK_URL, { timeoutMs: 15000 });
    const $ = cheerio.load(html);
    const list: RawNovel[] = [];

    // 起点榜单列表项通常为 .rank-list li 或 .book-img-text li
    const items = $('.rank-list li, .book-img-text ul li, #rank-view-list li');
    items.each((idx, el) => {
      if (list.length >= limit) return;
      const $el = $(el);
      const title =
        $el.find('h3 a, h4 a, .book-mid-info h2 a, .name a').first().text().trim() ||
        $el.find('a[data-eid], a[title]').first().attr('title')?.trim() ||
        '';
      if (!title) return;
      const author =
        $el.find('.author a.name, .author .name, p.author a').first().text().trim() ||
        $el.find('.author a').first().text().trim() ||
        undefined;
      const category =
        $el.find('.author a.go-sub-type, .author .go-sub-type, a[data-typeid]').first().text().trim() ||
        undefined;
      const intro = $el.find('.intro, p.intro').first().text().trim() || undefined;
      const tags: string[] = [];
      $el.find('.tag span, .book-tags span, .tags span').each((_, t) => {
        const tx = $(t).text().trim();
        if (tx) tags.push(tx);
      });
      const href = $el.find('h3 a, h4 a, .name a, .book-mid-info h2 a').first().attr('href') || '';
      const url = href ? (href.startsWith('http') ? href : `https:${href.startsWith('//') ? '' : '//'}${href.replace(/^https?:/, '')}`) : undefined;

      list.push({
        rank: idx + 1,
        title,
        author,
        category,
        intro,
        tags: tags.length ? tags : undefined,
        url,
        raw: { source: 'qidian_yuepiao' },
      });
    });

    return list;
  },
};
