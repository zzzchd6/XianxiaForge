/**
 * 热点嗅探路由（由独立工具并入，挂载 /api/hotspot）
 * 抓取榜单 → LLM 提炼剧情素材模板 → 推送入创作库 plot_material_* 四表（全局素材）。
 * 响应信封统一为 monorepo 的 { success, data } / { success: false, error }。
 */
import { Hono } from 'hono';
import { query, queryOne } from '../hotspot/db.js';
import { listSources, getAdapter } from '../hotspot/sources/registry.js';
import { runCrawl } from '../hotspot/crawler.js';
import { runAnalyze } from '../hotspot/analyzer.js';

const app = new Hono();

// ============ 抓取 ============

/** 榜单源列表 */
app.get('/sources', (c) => {
  return c.json({ success: true, data: listSources() });
});

/** 触发抓取 body: { sources: string[], limit?: number } */
app.post('/crawl', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const sources: string[] = Array.isArray(body.sources) ? body.sources : [];
  const limit = Number(body.limit) > 0 ? Number(body.limit) : 30;
  if (sources.length === 0) {
    return c.json({ success: false, error: '请至少选择一个榜单源' }, 400);
  }
  const unknown = sources.filter((s) => !getAdapter(s));
  if (unknown.length) {
    return c.json({ success: false, error: `未知榜单源: ${unknown.join(', ')}` }, 400);
  }
  const result = await runCrawl(sources, limit);
  return c.json({ success: true, data: result });
});

/** 批次列表 */
app.get('/batches', async (c) => {
  const rows = await query(
    `SELECT b.id, b.source_names, b.status, b.item_count, b.note, b.started_at, b.finished_at,
            (SELECT count(*) FROM hotspot_insight i WHERE i.batch_id=b.id) AS insight_count
     FROM hotspot_crawl_batch b ORDER BY b.id DESC LIMIT 50`,
  );
  return c.json({ success: true, data: rows });
});

/** 某批次的书目 */
app.get('/batches/:id/novels', async (c) => {
  const id = Number(c.req.param('id'));
  const rows = await query(
    `SELECT id, source, rank, title, author, category, tags, intro, word_count, popularity, url
     FROM hotspot_raw_novel WHERE batch_id=$1 ORDER BY source, rank NULLS LAST`,
    [id],
  );
  return c.json({ success: true, data: rows });
});

// ============ 分析 ============

/** 触发分析 body: { batchId: number } */
app.post('/analyze', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const batchId = Number(body.batchId);
  if (!batchId) return c.json({ success: false, error: '缺少 batchId' }, 400);
  try {
    const result = await runAnalyze(batchId);
    return c.json({ success: true, data: result });
  } catch (e) {
    return c.json({ success: false, error: (e as Error).message }, 400);
  }
});

/** 灵感列表 query: batchId, type?, status? */
app.get('/insights', async (c) => {
  const batchId = Number(c.req.query('batchId'));
  const type = c.req.query('type');
  const status = c.req.query('status');
  const conds: string[] = [];
  const params: any[] = [];
  if (batchId) {
    params.push(batchId);
    conds.push(`batch_id=$${params.length}`);
  }
  if (type) {
    params.push(type);
    conds.push(`insight_type=$${params.length}`);
  }
  if (status) {
    params.push(status);
    conds.push(`status=$${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await query(
    `SELECT id, batch_id, insight_type, title, content, payload, score, status, source_novel_ids, created_at
     FROM hotspot_insight ${where} ORDER BY score DESC, id DESC`,
    params,
  );
  return c.json({ success: true, data: rows });
});

/** 更新灵感状态 body: { status: 'kept'|'discarded'|'new' } */
app.patch('/insights/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const status = String(body.status ?? '');
  if (!['kept', 'discarded', 'new'].includes(status)) {
    return c.json({ success: false, error: '非法状态' }, 400);
  }
  const rows = await query(
    `UPDATE hotspot_insight SET status=$1 WHERE id=$2 AND status <> 'pushed' RETURNING id, status`,
    [status, id],
  );
  if (!rows.length) return c.json({ success: false, error: '条目不存在或已推送' }, 400);
  return c.json({ success: true, data: rows[0] });
});

// ============ 推送入库 ============

const ALLOWED_TABLES = [
  'plot_material_encounter',
  'plot_material_foreshadow',
  'plot_material_highlight',
  'plot_material_task',
] as const;
type TargetTable = (typeof ALLOWED_TABLES)[number];

/** 素材型灵感类型 → 默认目标表 */
const TYPE_TO_TABLE: Record<string, TargetTable> = {
  encounter: 'plot_material_encounter',
  foreshadow: 'plot_material_foreshadow',
  highlight: 'plot_material_highlight',
  task: 'plot_material_task',
};

/** 向量服务地址（与 rag/plot-material-retriever 同源同契约） */
const EMBEDDING_SERVER_BASE = (process.env.EMBEDDING_SERVER_URL || 'http://127.0.0.1:8600').replace(/\/v1\/?$/, '');

/** 调 embedding_server 向量化，返回 pgvector 字面量字符串；失败抛错由调用方降级 */
async function embedText(text: string): Promise<string> {
  const res = await fetch(`${EMBEDDING_SERVER_BASE}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: [text] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`embedding_server /embed HTTP ${res.status}`);
  const body = (await res.json()) as { embeddings?: number[][] };
  const vec = body.embeddings?.[0];
  if (!vec || vec.length !== 512) {
    throw new Error(`embedding 维度异常: ${vec?.length ?? 'null'}（期望512）`);
  }
  return `[${vec.join(',')}]`;
}

/**
 * 推送素材型灵感入剧情素材库
 * body: { targetTable?: TargetTable } —— 缺省按 insight_type 映射；trend 等非素材类型拒绝
 */
app.post('/insights/:id/push', async (c) => {
  const insightId = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));

  const insight = await queryOne<{
    id: number;
    batch_id: number;
    insight_type: string;
    title: string;
    content: string | null;
    payload: Record<string, any>;
    score: number;
    status: string;
  }>(
    `SELECT id, batch_id, insight_type, title, content, payload, score, status
     FROM hotspot_insight WHERE id=$1`,
    [insightId],
  );
  if (!insight) return c.json({ success: false, error: '灵感条目不存在' }, 404);

  const defaultTable = TYPE_TO_TABLE[insight.insight_type];
  if (!defaultTable) {
    return c.json({ success: false, error: `类型 ${insight.insight_type} 为趋势参考，不可推送素材库` }, 400);
  }
  const targetTable = (body.targetTable ? String(body.targetTable) : defaultTable) as TargetTable;
  if (!ALLOWED_TABLES.includes(targetTable)) {
    return c.json({ success: false, error: `目标表非法，仅支持 ${ALLOWED_TABLES.join('/')}` }, 400);
  }

  const p = insight.payload ?? {};
  const corePlot = insight.content?.trim() || insight.title;
  const tags: string[] = Array.isArray(p.tags) ? p.tags.map(String) : [];
  const sourceWork: string = String(p.source_work ?? '').trim();
  const qualityScore = Math.max(0, Math.min(10, Math.round((insight.score ?? 50) / 10)));

  // 按来源书名回查本批次简介片段作 source_snippet（溯源用，红线：永不进写作上下文）
  let sourceSnippet: string | null = null;
  if (sourceWork) {
    const src = await queryOne<{ intro: string | null }>(
      `SELECT intro FROM hotspot_raw_novel WHERE batch_id=$1 AND title=$2 LIMIT 1`,
      [insight.batch_id, sourceWork],
    );
    if (src?.intro) sourceSnippet = src.intro.slice(0, 200);
  }

  // 向量化（降级：失败则无向量入库，等 backfill 脚本补齐）
  let embedding: string | null = null;
  let embedNote = '';
  try {
    embedding = await embedText(`${insight.title}\n${corePlot}\n标签:${tags.join('、')}`);
  } catch (e) {
    embedNote = `；embedding_server 不可达（${(e as Error).message}），待向量化`;
  }

  let targetId: number | null = null;
  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO ${targetTable}
         (project_id, title, core_plot, trigger_condition, reward, cost_or_risk,
          emotional_beat, applicable_scene_type, tags, quality_score,
          source_work, source_snippet, embedding, is_deleted)
       VALUES (NULL,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::vector,false)
       RETURNING id`,
      [
        insight.title,
        corePlot,
        p.trigger_condition || null,
        p.reward || null,
        p.cost_or_risk || null,
        p.emotional_beat || null,
        p.applicable_scene_type || null,
        tags,
        qualityScore,
        sourceWork ? `《${sourceWork}》(热点嗅探)` : '热点嗅探',
        sourceSnippet,
        embedding,
      ],
    );
    targetId = row!.id;
  } catch (e) {
    return c.json({ success: false, error: `写入素材表失败：${(e as Error).message}` }, 500);
  }

  // 记录推送日志 + 标记 insight 为 pushed
  await query(
    `INSERT INTO hotspot_push_log (insight_id, target_table, target_project_id, target_id, note)
     VALUES ($1,$2,NULL,$3,$4)`,
    [insightId, targetTable, targetId, `推送到 ${targetTable}（全局素材）${embedNote}`],
  );
  await query(`UPDATE hotspot_insight SET status='pushed' WHERE id=$1`, [insightId]);

  return c.json({
    success: true,
    data: { insightId, targetTable, targetId, embedded: embedding !== null },
  });
});

/** 某灵感的推送历史 */
app.get('/insights/:id/push-log', async (c) => {
  const insightId = Number(c.req.param('id'));
  const rows = await query(
    `SELECT id, target_table, target_project_id, target_id, note, pushed_at
     FROM hotspot_push_log WHERE insight_id=$1 ORDER BY id DESC`,
    [insightId],
  );
  return c.json({ success: true, data: rows });
});

export default app;
