/**
 * 抓取编排：创建批次 → 逐源抓取 → 去重入库 hotspot_raw_novel → 更新批次状态。
 * 单源失败不影响其它源（降级），错误记录到批次 note。
 */
import { query, queryOne } from './db.js';
import { getAdapter } from './sources/registry.js';
import { sleep, type RawNovel } from './sources/types.js';

export interface CrawlResult {
  batchId: number;
  itemCount: number;
  status: string;
  note: string;
  perSource: Array<{ source: string; count: number; error?: string }>;
}

/** 执行一次抓取任务 */
export async function runCrawl(sourceNames: string[], limit = 30): Promise<CrawlResult> {
  const batch = await queryOne<{ id: number }>(
    `INSERT INTO hotspot_crawl_batch (source_names, status) VALUES ($1, 'running') RETURNING id`,
    [JSON.stringify(sourceNames)],
  );
  const batchId = batch!.id;

  const perSource: CrawlResult['perSource'] = [];
  const notes: string[] = [];
  let total = 0;

  for (const name of sourceNames) {
    const adapter = getAdapter(name);
    if (!adapter) {
      perSource.push({ source: name, count: 0, error: '未知榜单源' });
      notes.push(`${name}: 未知榜单源`);
      continue;
    }
    try {
      const novels = await adapter.fetchRanking(limit);
      const inserted = await saveNovels(batchId, adapter.name, novels);
      total += inserted;
      perSource.push({ source: name, count: inserted });
      if (novels.length === 0) notes.push(`${name}: 抓取到 0 条（可能页面结构变动或被拦截）`);
    } catch (e) {
      const msg = (e as Error).message;
      perSource.push({ source: name, count: 0, error: msg });
      notes.push(`${name}: 抓取失败 - ${msg}`);
    }
    await sleep(800); // 源间间隔
  }

  const anySuccess = perSource.some((p) => p.count > 0);
  const anyFail = perSource.some((p) => p.error || p.count === 0);
  const status = anySuccess ? (anyFail ? 'partial' : 'completed') : 'failed';
  const note = notes.join('; ') || '全部成功';

  await query(
    `UPDATE hotspot_crawl_batch SET status=$1, item_count=$2, note=$3, finished_at=now() WHERE id=$4`,
    [status, total, note, batchId],
  );

  return { batchId, itemCount: total, status, note, perSource };
}

/** 批量入库书目，批次内去重（依赖唯一索引 ON CONFLICT DO NOTHING） */
async function saveNovels(batchId: number, source: string, novels: RawNovel[]): Promise<number> {
  let count = 0;
  for (const n of novels) {
    const res = await query<{ id: number }>(
      `INSERT INTO hotspot_raw_novel
        (batch_id, source, rank, title, author, category, tags, intro, word_count, popularity, url, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (batch_id, source, title, COALESCE(author, '')) DO NOTHING
       RETURNING id`,
      [
        batchId,
        source,
        n.rank ?? null,
        n.title,
        n.author ?? null,
        n.category ?? null,
        JSON.stringify(n.tags ?? []),
        n.intro ?? null,
        n.wordCount ?? null,
        n.popularity ?? null,
        n.url ?? null,
        JSON.stringify(n.raw ?? {}),
      ],
    );
    if (res.length) count++;
  }
  return count;
}
