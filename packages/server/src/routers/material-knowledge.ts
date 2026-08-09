/**
 * 素材知识库路由（挂载 /api/material-kb）
 * 管理「素材清洗」(sucaiqingxi) Python 旁路产出的两类知识：
 *   - style_preset        文风预设（蒸馏自原作文本）
 *   - plot_domain_knowledge 领域知识（术语/规则/雷区/表达/案例）
 * 仅浏览/搜索/软删除（is_deleted=TRUE），不修改表结构。
 * ETL 触发经 HTTP 代理到 Python GUI 服务（默认 127.0.0.1:8610，MATERIAL_GUI_URL 可覆盖），
 * Python 侧负责拉起 distill_style.py / extract_domain_knowledge.py / extract_materials.py 子进程。
 */
import { Hono, type Context } from 'hono';
import { creativeClient } from '../db/index.js';
import { recallPlotMaterials } from '../rag/plot-material-retriever.js';

const app = new Hono();

const GUI_BASE = (process.env.MATERIAL_GUI_URL || 'http://127.0.0.1:8610').replace(/\/$/, '');

// ============ 文风预设 ============

/** 列表（支持按预设名/作者搜索） */
app.get('/style-presets', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const conds: string[] = ['NOT is_deleted'];
  const params: any[] = [];
  if (q) {
    params.push(`%${q}%`, `%${q}%`);
    conds.push(`(style_name ILIKE $${params.length - 1} OR author ILIKE $${params.length})`);
  }
  const rows = await creativeClient.unsafe(
    `SELECT id, project_id, style_name, author, quality_score, confidence,
            sample_word_count, verify_status, "version",
            COALESCE(array_length(mental_models,1),0) AS n_mind,
            COALESCE(array_length(core_imagery,1),0) AS n_img,
            to_char(update_time,'YYYY-MM-DD HH24:MI') AS update_time
     FROM style_preset WHERE ${conds.join(' AND ')}
     ORDER BY update_time DESC LIMIT 200`,
    params,
  );
  return c.json({ success: true, data: rows });
});

/** 详情（六维风格 + 统计） */
app.get('/style-presets/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const rows = await creativeClient.unsafe(
    `SELECT id, style_name, author, source_works, mental_models, decision_heuristics,
            description_ratio, sentence_rules, core_imagery, forbidden_words,
            perspective_rules, anti_patterns, local_stats, ext,
            confidence, quality_score, sample_word_count, verify_status, "version",
            to_char(update_time,'YYYY-MM-DD HH24:MI') AS update_time
     FROM style_preset WHERE id=$1`,
    [id],
  );
  if (!rows.length) return c.json({ success: false, error: '不存在' }, 404);
  return c.json({ success: true, data: rows[0] });
});

/** 软删除 */
app.delete('/style-presets/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const rows = await creativeClient.unsafe(
    `UPDATE style_preset SET is_deleted=TRUE, update_time=NOW() WHERE id=$1 AND NOT is_deleted RETURNING id`,
    [id],
  );
  return c.json({ success: true, data: { deleted: rows.length } });
});

// ============ 领域知识 ============

/** 列表（支持关键词/类型/领域过滤） */
app.get('/domain-knowledge', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const ktype = (c.req.query('type') || '').trim();
  const domain = (c.req.query('domain') || '').trim();
  const conds: string[] = ['NOT is_deleted'];
  const params: any[] = [];
  if (q) {
    params.push(`%${q}%`, `%${q}%`);
    conds.push(`(title ILIKE $${params.length - 1} OR content ILIKE $${params.length})`);
  }
  if (ktype) {
    params.push(ktype);
    conds.push(`knowledge_type=$${params.length}`);
  }
  if (domain) {
    params.push(`%${domain}%`);
    conds.push(`applicable_domain ILIKE $${params.length}`);
  }
  const rows = await creativeClient.unsafe(
    `SELECT id, project_id, knowledge_type, applicable_domain, title,
            LEFT(content, 120) AS preview, tags, quality_score, source_book,
            to_char(created_at,'YYYY-MM-DD HH24:MI') AS created_at
     FROM plot_domain_knowledge WHERE ${conds.join(' AND ')}
     ORDER BY created_at DESC LIMIT 300`,
    params,
  );
  return c.json({ success: true, data: rows });
});

/** 详情 */
app.get('/domain-knowledge/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const rows = await creativeClient.unsafe(
    `SELECT id, knowledge_type, applicable_domain, title, content, tags,
            quality_score, source_book, source_snippet,
            to_char(created_at,'YYYY-MM-DD HH24:MI') AS created_at
     FROM plot_domain_knowledge WHERE id=$1`,
    [id],
  );
  if (!rows.length) return c.json({ success: false, error: '不存在' }, 404);
  return c.json({ success: true, data: rows[0] });
});

/** 软删除 */
app.delete('/domain-knowledge/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const rows = await creativeClient.unsafe(
    `UPDATE plot_domain_knowledge SET is_deleted=TRUE WHERE id=$1 AND NOT is_deleted RETURNING id`,
    [id],
  );
  return c.json({ success: true, data: { deleted: rows.length } });
});

// ============ ETL 代理（Python GUI 服务 8610） ============

/** 代理封装：不可达时返回 503 + 明确提示 */
async function proxyGui(c: Context, path: string, init?: RequestInit) {
  try {
    const res = await fetch(`${GUI_BASE}/api${path}`, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return c.json({ success: false, error: (body as any).error || `Python ETL 服务 HTTP ${res.status}` }, 400);
    }
    return c.json({ success: true, data: body });
  } catch (e) {
    return c.json(
      {
        success: false,
        error: `Python ETL 服务（${GUI_BASE}）不可达，请先启动：.venv\\Scripts\\python.exe gui_server.py（${(e as Error).message}）`,
      },
      503,
    );
  }
}

/** Python 侧健康检查 */
app.get('/etl/health', (c) => proxyGui(c, '/health'));

/** 触发蒸馏任务 kind: style/domain/material */
app.post('/etl/run/:kind', async (c) => {
  const kind = c.req.param('kind');
  if (!['style', 'domain', 'material'].includes(kind)) {
    return c.json({ success: false, error: '未知任务类型，仅支持 style/domain/material' }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  return proxyGui(c, `/run/${kind}`, { method: 'POST', body: JSON.stringify(body) });
});

/** 任务列表 */
app.get('/etl/tasks', (c) => proxyGui(c, '/tasks'));

/** 任务日志（增量轮询 ?offset=N） */
app.get('/etl/task/:tid', (c) => {
  const offset = c.req.query('offset') || '0';
  return proxyGui(c, `/task/${c.req.param('tid')}?offset=${offset}`);
});

/** 服务端 .txt 文件浏览（供选择蒸馏语料） */
app.get('/etl/browse', (c) => {
  const dir = c.req.query('dir');
  return proxyGui(c, `/browse${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`);
});

// ============ RAG 检索测试台 ============

/**
 * POST /recall-test
 * 手动测试 RAG 素材召回效果（供前端「检索测试」面板调用）。
 * body: { query: string, projectId?: number, topN?: number, minScore?: number }
 */
app.post('/recall-test', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const query = (body.query || '').trim();
    if (!query) {
      return c.json({ success: false, error: 'query 不能为空' }, 400);
    }
    const projectId = Number(body.projectId) || 1;
    const topN = Math.min(Math.max(Number(body.topN) || 5, 1), 20);
    const minScore = Number(body.minScore) || 0.2;

    const result = await recallPlotMaterials(query, projectId, {
      enabled: true,
      topN: { materials: topN, domain: topN, style: 1 },
      minScore,
    });

    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message || '检索失败' }, 500);
  }
});

export default app;
