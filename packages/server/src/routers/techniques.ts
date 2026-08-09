import { Hono } from 'hono';
import { creativeDb } from '../db/index.js';
import { techniqueAtom, chapterTechniqueMap, infoPoint } from '../db/creative-schema.js';
import { eq, and, sql } from 'drizzle-orm';

const app = new Hono();

// GET /techniques - 获取技法列表（支持按分类/层级/状态筛选）
app.get('/techniques', async (c) => {
  const { category, level, status } = c.req.query();
  const conditions = [];
  if (category) conditions.push(eq(techniqueAtom.category, category));
  if (level) conditions.push(eq(techniqueAtom.level, level));
  conditions.push(eq(techniqueAtom.status, status || 'active'));

  const rows = conditions.length > 0
    ? await creativeDb.select().from(techniqueAtom).where(and(...conditions)).orderBy(techniqueAtom.sortOrder)
    : await creativeDb.select().from(techniqueAtom).orderBy(techniqueAtom.sortOrder);

  return c.json(rows);
});

// GET /techniques/:techniqueId - 获取单个技法详情
app.get('/techniques/:techniqueId', async (c) => {
  const tid = c.req.param('techniqueId');
  const rows = await creativeDb.select().from(techniqueAtom).where(eq(techniqueAtom.techniqueId, tid));
  if (rows.length === 0) return c.json({ error: '技法不存在' }, 404);
  return c.json(rows[0]);
});

// PUT /techniques/:techniqueId - 更新技法参数/开关
app.put('/techniques/:techniqueId', async (c) => {
  const tid = c.req.param('techniqueId');
  const body = await c.req.json();
  const allowed: Record<string, unknown> = {};
  if (body.status !== undefined) allowed.status = body.status;
  if (body.generationGuidance !== undefined) allowed.generationGuidance = body.generationGuidance;
  if (body.coreRules !== undefined) allowed.coreRules = body.coreRules;
  if (body.autoFixTemplate !== undefined) allowed.autoFixTemplate = body.autoFixTemplate;
  if (body.sortOrder !== undefined) allowed.sortOrder = body.sortOrder;
  allowed.updatedAt = new Date();

  const rows = await creativeDb.update(techniqueAtom).set(allowed).where(eq(techniqueAtom.techniqueId, tid)).returning();
  if (rows.length === 0) return c.json({ error: '技法不存在' }, 404);
  return c.json(rows[0]);
});

// POST /techniques/recommend - 根据章节类型推荐技法（V1：返回全部 active principle，按 sort_order）
app.post('/techniques/recommend', async (c) => {
  const body = await c.req.json();
  const _chapterType = body.chapterType || 'progression';
  // V1：返回所有 active principle 技法（弱推荐，不做 scene_type 路由）
  const rows = await creativeDb.select().from(techniqueAtom)
    .where(and(eq(techniqueAtom.status, 'active'), eq(techniqueAtom.level, 'principle')))
    .orderBy(techniqueAtom.sortOrder);
  return c.json(rows);
});

// GET /chapters/:chapterPlanId/techniques - 获取本章已启用技法
app.get('/chapters/:chapterPlanId/techniques', async (c) => {
  const planId = Number(c.req.param('chapterPlanId'));
  const rows = await creativeDb.select().from(chapterTechniqueMap)
    .where(eq(chapterTechniqueMap.chapterPlanId, planId));
  return c.json(rows);
});

// PUT /chapters/:chapterPlanId/techniques - 设置本章启用技法
app.put('/chapters/:chapterPlanId/techniques', async (c) => {
  const planId = Number(c.req.param('chapterPlanId'));
  const body = await c.req.json() as { projectId: number; techniqueIds: string[] };

  // 先删除旧关联
  await creativeDb.delete(chapterTechniqueMap).where(eq(chapterTechniqueMap.chapterPlanId, planId));
  // 插入新关联
  if (body.techniqueIds?.length > 0) {
    const values = body.techniqueIds.map(tid => ({
      projectId: body.projectId,
      chapterPlanId: planId,
      techniqueId: tid,
      enabled: true,
    }));
    await creativeDb.insert(chapterTechniqueMap).values(values);
  }
  const rows = await creativeDb.select().from(chapterTechniqueMap).where(eq(chapterTechniqueMap.chapterPlanId, planId));
  return c.json(rows);
});

// GET /chapters/:chapterPlanId/infopoints - 获取本章信息点清单
app.get('/chapters/:chapterPlanId/infopoints', async (c) => {
  const planId = Number(c.req.param('chapterPlanId'));
  const rows = await creativeDb.select().from(infoPoint)
    .where(eq(infoPoint.chapterPlanId, planId))
    .orderBy(infoPoint.sortOrder);
  return c.json(rows);
});

// PUT /chapters/:chapterPlanId/infopoints - 更新本章信息点清单（全量替换）
app.put('/chapters/:chapterPlanId/infopoints', async (c) => {
  const planId = Number(c.req.param('chapterPlanId'));
  const body = await c.req.json() as { projectId: number; points: Array<{ content: string; importance: string; function: string }> };

  await creativeDb.delete(infoPoint).where(eq(infoPoint.chapterPlanId, planId));
  if (body.points?.length > 0) {
    const values = body.points.map((p, i) => ({
      projectId: body.projectId,
      chapterPlanId: planId,
      content: p.content,
      importance: p.importance || 'secondary',
      function: p.function || 'plot',
      sortOrder: i,
    }));
    await creativeDb.insert(infoPoint).values(values);
  }
  const rows = await creativeDb.select().from(infoPoint).where(eq(infoPoint.chapterPlanId, planId)).orderBy(infoPoint.sortOrder);
  return c.json(rows);
});

export default app;
