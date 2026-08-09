/**
 * 动态叙事引擎路由（12-需求规格说明书 v2.1）
 * - 叙事里程碑 CRUD / 从大纲提取 / 重排
 * - 分支弧管理：列表 / 详情+进度 / 手动汇合 / 豁免延长 / 废弃 / 提拔元素 / 审计日志 / 回滚
 *
 * 挂载：app.route('/api', narrativeRouter)（路径自带 /projects/:pid 前缀）
 * 注意：字面路径（extract/reorder）注册在 /:id 通配之前，避免被截获。
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  extractMilestonesFromOutlines,
  listMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  reorderMilestones,
} from '../services/milestone-service.js';
import {
  listArcs,
  getArcWithProgress,
  extendArc,
  abandonArc,
  promoteElement,
  ARC_HARD_LIMIT,
  ARC_ABS_LIMIT,
  type NewElementKind,
} from '../services/branch-arc-service.js';
import { convergeArc, rollbackArcRewrites, listRewriteLogs } from '../services/convergence-engine.js';

const app = new Hono();

const statusEnum = z.enum(['upcoming', 'active', 'reached', 'skipped']);
const importanceEnum = z.enum(['critical', 'major', 'minor']);
const kindEnum = z.enum(['characters', 'locations', 'foreshadows', 'items']);

// ============================================================
// 里程碑
// ============================================================

/** GET /api/projects/:pid/narrative/milestones */
app.get('/projects/:pid/narrative/milestones', async (c) => {
  try {
    const pid = Number(c.req.param('pid'));
    if (isNaN(pid)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const rows = await listMilestones(pid);
    return c.json({ success: true, data: rows });
  } catch (e: any) {
    return c.json({ success: false, error: `查询里程碑失败: ${e.message}` }, 500);
  }
});

/** POST /api/projects/:pid/narrative/milestones/extract — 从卷大纲 keyEvents 提取（幂等） */
app.post('/projects/:pid/narrative/milestones/extract', async (c) => {
  try {
    const pid = Number(c.req.param('pid'));
    if (isNaN(pid)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const outlineId = Number(body?.outlineId) || undefined;
    const res = await extractMilestonesFromOutlines(pid, outlineId);
    return c.json({ success: true, data: res }, 201);
  } catch (e: any) {
    return c.json({ success: false, error: `提取里程碑失败: ${e.message}` }, 500);
  }
});

/** POST /api/projects/:pid/narrative/milestones/reorder — 批量重排 */
app.post('/projects/:pid/narrative/milestones/reorder', async (c) => {
  try {
    const pid = Number(c.req.param('pid'));
    const body = await c.req.json().catch(() => ({}));
    const parsed = z.object({ orderedIds: z.array(z.number()).min(1).max(200) }).safeParse(body);
    if (!parsed.success || isNaN(pid)) return c.json({ success: false, error: '参数无效' }, 400);
    await reorderMilestones(pid, parsed.data.orderedIds);
    return c.json({ success: true, data: { reordered: parsed.data.orderedIds.length } });
  } catch (e: any) {
    return c.json({ success: false, error: `重排失败: ${e.message}` }, 500);
  }
});

/** POST /api/projects/:pid/narrative/milestones — 手动新增 */
app.post('/projects/:pid/narrative/milestones', async (c) => {
  try {
    const pid = Number(c.req.param('pid'));
    const body = await c.req.json().catch(() => ({}));
    const parsed = z.object({
      label: z.string().min(1).max(200),
      description: z.string().max(2000).nullable().optional(),
      mustHappen: z.array(z.string()).max(20).optional(),
      keyCharacterIds: z.array(z.number()).max(30).optional(),
      targetChapterFrom: z.number().int().nullable().optional(),
      targetChapterTo: z.number().int().nullable().optional(),
      importance: importanceEnum.optional(),
      outlineId: z.number().nullable().optional(),
    }).safeParse(body);
    if (!parsed.success || isNaN(pid)) return c.json({ success: false, error: '参数无效' }, 400);
    const row = await createMilestone(pid, parsed.data);
    return c.json({ success: true, data: row }, 201);
  } catch (e: any) {
    return c.json({ success: false, error: `创建里程碑失败: ${e.message}` }, 500);
  }
});

/** PUT /api/projects/:pid/narrative/milestones/:mid */
app.put('/projects/:pid/narrative/milestones/:mid', async (c) => {
  try {
    const mid = Number(c.req.param('mid'));
    const body = await c.req.json().catch(() => ({}));
    const parsed = z.object({
      label: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).nullable().optional(),
      mustHappen: z.array(z.string()).max(20).optional(),
      keyCharacterIds: z.array(z.number()).max(30).optional(),
      targetChapterFrom: z.number().int().nullable().optional(),
      targetChapterTo: z.number().int().nullable().optional(),
      status: statusEnum.optional(),
      importance: importanceEnum.optional(),
      sortOrder: z.number().int().optional(),
    }).safeParse(body);
    if (!parsed.success || isNaN(mid)) return c.json({ success: false, error: '参数无效' }, 400);
    const row = await updateMilestone(mid, parsed.data);
    if (!row) return c.json({ success: false, error: '里程碑不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (e: any) {
    return c.json({ success: false, error: `更新里程碑失败: ${e.message}` }, 500);
  }
});

/** DELETE /api/projects/:pid/narrative/milestones/:mid */
app.delete('/projects/:pid/narrative/milestones/:mid', async (c) => {
  try {
    const mid = Number(c.req.param('mid'));
    if (isNaN(mid)) return c.json({ success: false, error: '参数无效' }, 400);
    await deleteMilestone(mid);
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: `删除里程碑失败: ${e.message}` }, 500);
  }
});

// ============================================================
// 分支弧
// ============================================================

/** GET /api/projects/:pid/narrative/arcs */
app.get('/projects/:pid/narrative/arcs', async (c) => {
  try {
    const pid = Number(c.req.param('pid'));
    if (isNaN(pid)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const rows = await listArcs(pid);
    return c.json({ success: true, data: rows });
  } catch (e: any) {
    return c.json({ success: false, error: `查询分支弧失败: ${e.message}` }, 500);
  }
});

/** GET /api/projects/:pid/narrative/arcs/:aid — 详情 + 进度 */
app.get('/projects/:pid/narrative/arcs/:aid', async (c) => {
  try {
    const aid = Number(c.req.param('aid'));
    if (isNaN(aid)) return c.json({ success: false, error: '参数无效' }, 400);
    const row = await getArcWithProgress(aid);
    if (!row) return c.json({ success: false, error: '分支弧不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (e: any) {
    return c.json({ success: false, error: `查询分支弧失败: ${e.message}` }, 500);
  }
});

/** POST /api/projects/:pid/narrative/arcs/:aid/converge — 手动触发汇合 */
app.post('/projects/:pid/narrative/arcs/:aid/converge', async (c) => {
  try {
    const aid = Number(c.req.param('aid'));
    if (isNaN(aid)) return c.json({ success: false, error: '参数无效' }, 400);
    const res = await convergeArc(aid, { manual: true });
    if (!res.ok) return c.json({ success: false, error: res.error }, 422);
    return c.json({ success: true, data: res });
  } catch (e: any) {
    return c.json({ success: false, error: `汇合失败: ${e.message}` }, 500);
  }
});

/** POST /api/projects/:pid/narrative/arcs/:aid/extend — 豁免延长（一次性 +2，封顶7） */
app.post('/projects/:pid/narrative/arcs/:aid/extend', async (c) => {
  try {
    const aid = Number(c.req.param('aid'));
    if (isNaN(aid)) return c.json({ success: false, error: '参数无效' }, 400);
    const row = await extendArc(aid, 2);
    if (!row) return c.json({ success: false, error: '分支弧不存在' }, 404);
    if ((row.estimatedLength ?? 0) >= ARC_ABS_LIMIT) {
      return c.json({ success: true, data: row, warning: `已达绝对上限 ${ARC_ABS_LIMIT} 章，不可再延长` });
    }
    return c.json({ success: true, data: row });
  } catch (e: any) {
    return c.json({ success: false, error: `延长失败: ${e.message}` }, 500);
  }
});

/** POST /api/projects/:pid/narrative/arcs/:aid/abandon — 废弃分支（状态回滚） */
app.post('/projects/:pid/narrative/arcs/:aid/abandon', async (c) => {
  try {
    const aid = Number(c.req.param('aid'));
    if (isNaN(aid)) return c.json({ success: false, error: '参数无效' }, 400);
    const res = await abandonArc(aid);
    if (!res.ok) return c.json({ success: false, error: res.error }, 422);
    return c.json({ success: true, data: res });
  } catch (e: any) {
    return c.json({ success: false, error: `废弃失败: ${e.message}` }, 500);
  }
});

/** POST /api/projects/:pid/narrative/arcs/:aid/promote — 提拔分支元素为主线 */
app.post('/projects/:pid/narrative/arcs/:aid/promote', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z.object({
      kind: kindEnum,
      ref: z.object({
        id: z.number().optional(),
        table: z.string().optional(),
        name: z.string().min(1).max(200),
      }),
    }).safeParse(body);
    if (!parsed.success) return c.json({ success: false, error: '参数无效' }, 400);
    const res = await promoteElement(parsed.data.kind as NewElementKind, parsed.data.ref);
    if (!res.ok) return c.json({ success: false, error: res.message }, 422);
    return c.json({ success: true, data: { message: res.message } });
  } catch (e: any) {
    return c.json({ success: false, error: `提拔失败: ${e.message}` }, 500);
  }
});

/** GET /api/projects/:pid/narrative/arcs/:aid/rewrite-logs — 重写审计日志 */
app.get('/projects/:pid/narrative/arcs/:aid/rewrite-logs', async (c) => {
  try {
    const aid = Number(c.req.param('aid'));
    if (isNaN(aid)) return c.json({ success: false, error: '参数无效' }, 400);
    const rows = await listRewriteLogs(aid);
    return c.json({ success: true, data: rows });
  } catch (e: any) {
    return c.json({ success: false, error: `查询审计日志失败: ${e.message}` }, 500);
  }
});

/** POST /api/projects/:pid/narrative/arcs/:aid/rollback — 回滚汇合重写 */
app.post('/projects/:pid/narrative/arcs/:aid/rollback', async (c) => {
  try {
    const aid = Number(c.req.param('aid'));
    if (isNaN(aid)) return c.json({ success: false, error: '参数无效' }, 400);
    const res = await rollbackArcRewrites(aid);
    return c.json({ success: true, data: res });
  } catch (e: any) {
    return c.json({ success: false, error: `回滚失败: ${e.message}` }, 500);
  }
});

export { ARC_HARD_LIMIT };
export default app;
