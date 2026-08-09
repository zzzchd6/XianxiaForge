/**
 * 任务链台账路由
 * 以"任务线"为粒度的全局生命周期追踪：CRUD + 状态流转 + 确认生效
 * 状态流转支持手动（active/progressing/completed/failed/abandoned）
 * 风格完全镜像 foreshadow.ts：zod 校验、try/catch、{ success, data } 响应格式
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as creative from '../db/creative-schema.js';

const app = new Hono();

/** 创建任务线入参校验 */
const taskCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  progressClue: z.string().optional(),
  status: z.enum(['active', 'progressing', 'completed', 'failed', 'abandoned']).default('active'),
  priority: z.enum(['high', 'normal', 'low']).default('normal'),
  tier: z.enum(['t1', 't2', 't3']).default('t3'),
  startChapter: z.number().int().optional(),
  targetChapter: z.number().int().optional(),
  referencedMaterialIds: z.array(z.number().int()).optional(),
  relatedCharacterIds: z.array(z.number().int()).optional(),
  taskType: z.enum(['main', 'side', 'hidden', 'fortune']).optional(),
  sourceType: z.enum(['manual', 'scene', 'branch', 'auto']).default('manual'),
  isConfirmed: z.boolean().optional(),
});

/** 更新任务线入参校验（全部字段可选，含状态手动流转） */
const taskUpdateSchema = taskCreateSchema.partial();

/** 优先级排序权重：high 最靠前 */
const PRIORITY_ORDER = sql`CASE ${creative.taskArc.priority} WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 ELSE 3 END`;
/** 分级排序权重：t1 战略级最靠前 */
const TIER_ORDER = sql`CASE ${creative.taskArc.tier} WHEN 't1' THEN 0 WHEN 't2' THEN 1 WHEN 't3' THEN 2 ELSE 3 END`;

/** GET /api/projects/:pid/tasks?status= 列表（支持 status 可选过滤），按 priority/tier/createdAt 排序 */
app.get('/projects/:pid/tasks', async (c) => {
  try {
    const projectId = Number(c.req.param('pid'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const status = c.req.query('status');

    const conds = [eq(creative.taskArc.projectId, projectId)];
    if (status) conds.push(eq(creative.taskArc.status, status));

    const rows = await creativeDb
      .select()
      .from(creative.taskArc)
      .where(and(...conds))
      .orderBy(PRIORITY_ORDER, TIER_ORDER, creative.taskArc.createdAt);

    const summary = {
      total: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      progressing: rows.filter((r) => r.status === 'progressing').length,
      completed: rows.filter((r) => r.status === 'completed').length,
      failed: rows.filter((r) => r.status === 'failed').length,
      abandoned: rows.filter((r) => r.status === 'abandoned').length,
      unconfirmed: rows.filter((r) => !r.isConfirmed).length,
    };

    return c.json({ success: true, data: rows, summary });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:pid/tasks 创建任务线 */
app.post('/projects/:pid/tasks', async (c) => {
  try {
    const projectId = Number(c.req.param('pid'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const parsed = taskCreateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const d = parsed.data;

    const [row] = await creativeDb
      .insert(creative.taskArc)
      .values({
        projectId,
        title: d.title,
        description: d.description ?? null,
        progressClue: d.progressClue ?? null,
        status: d.status,
        priority: d.priority,
        tier: d.tier,
        startChapter: d.startChapter ?? null,
        targetChapter: d.targetChapter ?? null,
        referencedMaterialIds: d.referencedMaterialIds ?? [],
        relatedCharacterIds: d.relatedCharacterIds ?? [],
        taskType: d.taskType ?? null,
        sourceType: d.sourceType,
        isConfirmed: d.isConfirmed ?? true,
      })
      .returning();

    return c.json({ success: true, data: row }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/projects/:pid/tasks/:taskId 更新（部分字段，含状态手动流转） */
app.put('/projects/:pid/tasks/:taskId', async (c) => {
  try {
    const projectId = Number(c.req.param('pid'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const taskId = Number(c.req.param('taskId'));
    if (isNaN(taskId)) return c.json({ success: false, error: '无效的任务ID' }, 400);

    const parsed = taskUpdateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const d = parsed.data;
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (d.title !== undefined) updateData.title = d.title;
    if (d.description !== undefined) updateData.description = d.description;
    if (d.progressClue !== undefined) updateData.progressClue = d.progressClue;
    if (d.status !== undefined) updateData.status = d.status;
    if (d.priority !== undefined) updateData.priority = d.priority;
    if (d.tier !== undefined) updateData.tier = d.tier;
    if (d.startChapter !== undefined) updateData.startChapter = d.startChapter;
    if (d.targetChapter !== undefined) updateData.targetChapter = d.targetChapter;
    if (d.referencedMaterialIds !== undefined) updateData.referencedMaterialIds = d.referencedMaterialIds;
    if (d.relatedCharacterIds !== undefined) updateData.relatedCharacterIds = d.relatedCharacterIds;
    if (d.taskType !== undefined) updateData.taskType = d.taskType;
    if (d.sourceType !== undefined) updateData.sourceType = d.sourceType;
    if (d.isConfirmed !== undefined) updateData.isConfirmed = d.isConfirmed;

    const [row] = await creativeDb
      .update(creative.taskArc)
      .set(updateData)
      .where(
        and(
          eq(creative.taskArc.id, taskId),
          eq(creative.taskArc.projectId, projectId)
        )
      )
      .returning();

    if (!row) return c.json({ success: false, error: '任务线不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /api/projects/:pid/tasks/:taskId/confirm
 * 确认任务线生效（is_confirmed=false → true），确认后才会注入写作上下文。
 */
app.post('/projects/:pid/tasks/:taskId/confirm', async (c) => {
  try {
    const projectId = Number(c.req.param('pid'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const taskId = Number(c.req.param('taskId'));
    if (isNaN(taskId)) return c.json({ success: false, error: '无效的任务ID' }, 400);

    const [task] = await creativeDb
      .select()
      .from(creative.taskArc)
      .where(
        and(
          eq(creative.taskArc.id, taskId),
          eq(creative.taskArc.projectId, projectId)
        )
      )
      .limit(1);
    if (!task) return c.json({ success: false, error: '任务线不存在' }, 404);
    if (task.isConfirmed) {
      return c.json({ success: false, error: '该任务已确认' }, 400);
    }

    const [row] = await creativeDb
      .update(creative.taskArc)
      .set({ isConfirmed: true, updatedAt: new Date() })
      .where(eq(creative.taskArc.id, taskId))
      .returning();

    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * DELETE /api/projects/:pid/tasks/:taskId 删除任务线
 * 镜像 foreshadow 的删除方式：task_arc 表无 is_deleted 软删字段，故采用硬删 delete。
 */
app.delete('/projects/:pid/tasks/:taskId', async (c) => {
  try {
    const projectId = Number(c.req.param('pid'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const taskId = Number(c.req.param('taskId'));
    if (isNaN(taskId)) return c.json({ success: false, error: '无效的任务ID' }, 400);

    const [row] = await creativeDb
      .delete(creative.taskArc)
      .where(
        and(
          eq(creative.taskArc.id, taskId),
          eq(creative.taskArc.projectId, projectId)
        )
      )
      .returning();

    if (!row) return c.json({ success: false, error: '任务线不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
