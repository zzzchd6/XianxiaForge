/**
 * 毒句式欠账门路由（开源借鉴 PRD v1.1 M1，P0）
 * - GET    /api/projects/:id/debt-gate/check?chapterPlanId=xx  预览上一章 blocking 欠账清单
 * - GET    /api/projects/:id/deslop-whitelist                  白名单列表
 * - POST   /api/projects/:id/deslop-whitelist                  新增白名单
 * - DELETE /api/projects/:id/deslop-whitelist/:wid             删除白名单
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { checkDebtGate } from '../services/debt-gate.js';

const app = new Hono();

/** 预览欠账清单（生成前前端弹窗/提示用） */
app.get('/projects/:id/debt-gate/check', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const chapterPlanId = Number(c.req.query('chapterPlanId') ?? 0);
    if (!projectId || !chapterPlanId) {
      return c.json({ success: false, error: '缺少 chapterPlanId' }, 400);
    }

    const [plan] = await creativeDb
      .select({
        projectId: schema.chapterPlan.projectId,
        volumeNo: schema.chapterPlan.volumeNo,
        chapterNo: schema.chapterPlan.chapterNo,
      })
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.id, chapterPlanId))
      .limit(1);
    if (!plan) return c.json({ success: false, error: '章节计划不存在' }, 404);
    if (plan.projectId !== projectId) return c.json({ success: false, error: '章节不属于该项目' }, 400);

    const [project] = await creativeDb
      .select({ generationConfig: schema.creativeProject.generationConfig })
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, projectId))
      .limit(1);
    if (!project) return c.json({ success: false, error: '项目不存在' }, 404);

    const result = await checkDebtGate(
      projectId,
      plan.volumeNo,
      plan.chapterNo,
      (project.generationConfig ?? {}) as Record<string, any>,
    );
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: `欠账门检查失败: ${error.message}` }, 500);
  }
});

/** 白名单列表 */
app.get('/projects/:id/deslop-whitelist', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const rows = await creativeDb
      .select()
      .from(schema.deslopWhitelist)
      .where(eq(schema.deslopWhitelist.projectId, projectId))
      .orderBy(desc(schema.deslopWhitelist.id));
    return c.json({ success: true, data: rows });
  } catch (error: any) {
    return c.json({ success: false, error: `查询白名单失败: ${error.message}` }, 500);
  }
});

const addWhitelistSchema = z.object({
  pattern: z.string().min(1).max(200),
  reason: z.string().max(500).optional(),
});

/** 新增白名单（pattern 子串命中 issue 原文/规则名即豁免） */
app.post('/projects/:id/deslop-whitelist', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const body = await c.req.json();
    const parsed = addWhitelistSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const pattern = parsed.data.pattern.trim();

    // 同项目去重
    const [dup] = await creativeDb
      .select({ id: schema.deslopWhitelist.id })
      .from(schema.deslopWhitelist)
      .where(and(
        eq(schema.deslopWhitelist.projectId, projectId),
        eq(schema.deslopWhitelist.pattern, pattern),
      ))
      .limit(1);
    if (dup) return c.json({ success: false, error: '该豁免词已存在' }, 409);

    const [row] = await creativeDb
      .insert(schema.deslopWhitelist)
      .values({ projectId, pattern, reason: parsed.data.reason ?? null })
      .returning();
    return c.json({ success: true, data: row }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: `新增白名单失败: ${error.message}` }, 500);
  }
});

/** 删除白名单 */
app.delete('/projects/:id/deslop-whitelist/:wid', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const wid = Number(c.req.param('wid'));
    const deleted = await creativeDb
      .delete(schema.deslopWhitelist)
      .where(and(
        eq(schema.deslopWhitelist.id, wid),
        eq(schema.deslopWhitelist.projectId, projectId),
      ))
      .returning({ id: schema.deslopWhitelist.id });
    if (!deleted.length) return c.json({ success: false, error: '白名单条目不存在' }, 404);
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ success: false, error: `删除白名单失败: ${error.message}` }, 500);
  }
});

export default app;
