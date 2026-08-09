/**
 * 因果链路由（阶段4）
 * CRUD + 生命周期流转 + 统计 + 待回收查询。
 * 红线：查询类 best-effort，异常降级不抛 500 阻断前端。
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { creativeDb } from '../db/index.js';
import {
  createCausalChain,
  getCausalChains,
  getCausalChainById,
  updateCausalChainStatus,
  expireOverdueChains,
  buildCausalContext,
  formatCausalContextBlock,
  getCausalStats,
  type CausalStatus,
  type CreateCausalChainInput,
} from '../services/impact/causal-chain.service.js';

const app = new Hono();

const createSchema = z.object({
  sourceType: z.enum(['branch', 'event', 'manual']),
  sourceId: z.number().int().optional(),
  sourceChapterNo: z.number().int().min(1),
  causeType: z.string().min(1).max(32),
  causeDescription: z.string().min(1),
  effectType: z.string().max(32).optional(),
  effectDescription: z.string().optional(),
  targetChapterMin: z.number().int().optional(),
  targetChapterMax: z.number().int().optional(),
  priority: z.number().int().min(1).max(10).default(5),
  strength: z.number().int().min(0).max(100).default(50),
  directionCode: z.string().max(32).optional(),
  parentChainId: z.number().int().optional(),
  tags: z.array(z.string()).default([]),
});

const statusSchema = z.object({
  status: z.enum(['planted', 'foreshadowed', 'triggered', 'resolved', 'expired']),
  resolvedChapterNo: z.number().int().optional(),
  resolvedTaskId: z.number().int().optional(),
  resolutionNote: z.string().optional(),
});

/** GET /api/projects/:id/causal-chains?status=&upToChapter=&limit= */
app.get('/projects/:id/causal-chains', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const statusRaw = c.req.query('status');
    const status = statusRaw ? statusRaw.split(',').filter(Boolean) as CausalStatus[] : undefined;
    const upToRaw = c.req.query('upToChapter');
    const upToChapter = upToRaw && !isNaN(Number(upToRaw)) ? Number(upToRaw) : undefined;
    const limitRaw = c.req.query('limit');
    const limit = limitRaw && !isNaN(Number(limitRaw)) ? Math.min(Number(limitRaw), 200) : 100;
    const rows = await getCausalChains(id, { status, upToChapter, limit });
    return c.json({ success: true, data: rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:id/causal-chains/context?chapterNo= - Writer 因果上下文（预览用） */
app.get('/projects/:id/causal-chains/context', async (c) => {
  const id = Number(c.req.param('id'));
  if (isNaN(id)) return c.json({ success: true, data: { items: [], text: null } });
  const chapterNoRaw = c.req.query('chapterNo');
  const chapterNo = chapterNoRaw && !isNaN(Number(chapterNoRaw)) ? Number(chapterNoRaw) : 999999;
  const items = await buildCausalContext(id, chapterNo);
  const text = formatCausalContextBlock(items);
  return c.json({ success: true, data: { items, text } });
});

/** GET /api/projects/:id/causal-chains/stats?chapterNo= - 因果链统计 */
app.get('/projects/:id/causal-chains/stats', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const chapterNoRaw = c.req.query('chapterNo');
    const currentChapter = chapterNoRaw && !isNaN(Number(chapterNoRaw)) ? Number(chapterNoRaw) : undefined;
    const stats = await getCausalStats(id, currentChapter);
    return c.json({ success: true, data: stats });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:id/causal-chains/:chainId */
app.get('/projects/:id/causal-chains/:chainId', async (c) => {
  try {
    const chainId = Number(c.req.param('chainId'));
    if (isNaN(chainId)) return c.json({ success: false, error: '无效ID' }, 400);
    const row = await getCausalChainById(chainId);
    if (!row) return c.json({ success: false, error: '因果线不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:id/causal-chains - 创建因果线 */
app.post('/projects/:id/causal-chains', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const body = createSchema.parse(await c.req.json());
    const input: CreateCausalChainInput = { ...body, projectId: id };
    const row = await createCausalChain(creativeDb, input);
    return c.json({ success: true, data: row }, 201);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({ success: false, error: `参数校验失败: ${error.errors.map((e) => e.message).join('；')}` }, 400);
    }
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/projects/:id/causal-chains/:chainId/status - 生命周期流转 */
app.put('/projects/:id/causal-chains/:chainId/status', async (c) => {
  try {
    const chainId = Number(c.req.param('chainId'));
    if (isNaN(chainId)) return c.json({ success: false, error: '无效ID' }, 400);
    const body = statusSchema.parse(await c.req.json());
    const updated = await updateCausalChainStatus(creativeDb, chainId, body.status, {
      resolvedChapterNo: body.resolvedChapterNo,
      resolvedTaskId: body.resolvedTaskId,
      resolutionNote: body.resolutionNote,
    });
    return c.json({ success: true, data: updated });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({ success: false, error: `参数校验失败: ${error.errors.map((e) => e.message).join('；')}` }, 400);
    }
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:id/causal-chains/expire - 手动触发过期扫描 */
app.post('/projects/:id/causal-chains/expire', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const currentChapter = body.currentChapter ?? 999999;
    const count = await expireOverdueChains(creativeDb, id, currentChapter);
    return c.json({ success: true, data: { expired: count } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
