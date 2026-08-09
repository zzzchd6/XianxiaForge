/** 晋江文学城 月度金榜（页面解析，GB18030 编码） */
import * as cheerio from 'cheerio';
import { fetchText, type RawNovel, type SourceAdapter } from '../types.js';

const RANK_URL = 'https://www.jjwxc.net/topten.php?orderstr=7&t=0';

export const jjwxcAdapter: SourceAdapter = {
  name: 'jjwxc_yuebang',
  label: '晋江·月度金榜',
  kind: 'page',
  description: '晋江文学城月度金榜（女频言情为主，与仙侠题材不对齐，降级备用）',
  async fetchRanking(limit: number): Promise<RawNovel[]> {
    const html = await fetchText(RANK_URL, { timeoutMs: 20000, charset: 'gb18030' });
    const $ = cheerio.load(html);
    const list: RawNovel[] = [];

    $('tr').each((_, tr) => {
      if (list.length >= limit) return;
      const $tr = $(tr);
      const bookA = $tr.find('a[href*="onebook.php"]').first();
      if (!bookA.length) return;
      const title = bookA.text().trim();
      if (!title) return;

      const author = $tr.find('a[href*="oneauthor.php"]').first().text().trim() || undefined;
      // rel 属性带完整简介（含 <br>），转为纯文本
      const rel = bookA.attr('rel') ?? '';
      const intro = rel ? cheerio.load(`<p>${rel.replace(/<br\s*\/?>/gi, '\n')}</p>`)('p').text().trim() : undefined;

      const tds = $tr.find('td').map((__, td) => $(td).text().trim()).get();
      // 典型列：0排名 1作者 2书名 3分类(原创-言情-近代现代-爱情) 4状态 5字数 6积分 7时间
      const rank = Number(tds[0]) || list.length + 1;
      const category = tds.find((t) => /原创|衍生/.test(t) && t.includes('-'));
      const status = tds.find((t) => /^(完结|连载(中)?|暂停)$/.test(t));
      const wordCount = tds.find((t) => /^\d{4,9}$/.test(t.replace(/[,\s]/g, '')));
      const popularity = tds.find((t) => /^[\d,]{7,}$/.test(t.replace(/\s/g, '')));

      const href = bookA.attr('href') ?? '';
      list.push({
        rank,
        title,
        author,
        category,
        tags: [
          ...(category ? category.split('-').map((s) => s.trim()).filter(Boolean) : []),
          ...(status ? [status] : []),
        ],
        intro,
        wordCount: wordCount?.replace(/[,\s]/g, ''),
        popularity: popularity?.replace(/\s/g, ''),
        url: href ? new URL(href, 'https://www.jjwxc.net/').href : undefined,
        raw: { source: 'jjwxc_yuebang', tds },
      });
    });

    return list;
  },
};
