/**
 * 成长工坊路由（模块9）- 功法/法宝融合、变异、强化、进化 + 历史回退
 * 统一处理 skill / magic_item 两种实体类型
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { growthAgent, validateGrowthResult, type GrowthEntity, type EntityEffect } from '../agents/growth.js';

const app = new Hono();

// ============ 辅助函数 ============

function getTable(entityType: string) {
  return entityType === 'magic_item' ? schema.customMagicItemLib : schema.customSkillLib;
}

function rowToGrowthEntity(row: any, entityType: string): GrowthEntity {
  return {
    id: row.id,
    name: row.name,
    grade: row.grade,
    gradeLevel: row.gradeLevel,
    skillType: entityType === 'skill' ? row.skillType : undefined,
    itemType: entityType === 'magic_item' ? row.itemType : undefined,
    coreEffect: row.coreEffect || row.coreAbilities,
    coreAbilities: row.coreAbilities || row.coreEffect,
    effects: (row.effects || []) as EntityEffect[],
    sideEffects: row.sideEffects,
    description: row.description,
    growthType: row.growthType,
    baseEntityId: row.baseEntityId,
    sourceEntityIds: (row.sourceEntityIds || []) as number[],
    evolutionStage: row.evolutionStage,
    isEvolved: row.isEvolved,
  };
}

function growthEntityToInsert(entity: GrowthEntity, projectId: number, entityType: string) {
  const base: any = {
    projectId,
    name: entity.name,
    grade: entity.grade,
    gradeLevel: entity.gradeLevel,
    effects: entity.effects,
    sideEffects: entity.sideEffects,
    description: entity.description,
    growthType: entity.growthType,
    baseEntityId: entity.baseEntityId,
    sourceEntityIds: entity.sourceEntityIds || [],
    evolutionStage: entity.evolutionStage,
    isEvolved: entity.isEvolved || false,
  };
  if (entityType === 'skill') {
    base.skillType = entity.skillType;
    base.coreEffect = entity.coreEffect;
  } else {
    base.itemType = entity.itemType;
    base.coreAbilities = entity.coreAbilities;
  }
  return base;
}

// ============ 1. 实体列表 ============

/** GET /projects/:id/workshop?type=skill|magic_item - 自定义实体列表 */
app.get('/projects/:id/workshop', async (c) => {
  const projectId = Number(c.req.param('id'));
  const type = c.req.query('type') || 'skill';
  const table = getTable(type);

  const rows = await creativeDb
    .select()
    .from(table)
    .where(and(eq(table.projectId, projectId), eq(table.isDeleted, false)))
    .orderBy(desc(table.createdAt));

  return c.json({ success: true, data: rows });
});

// ============ 2. 创建基础实体 ============

const createEntitySchema = z.object({
  entityType: z.enum(['skill', 'magic_item']),
  name: z.string().min(1),
  grade: z.string().default('凡造'),
  gradeLevel: z.number().int().min(1).max(3).default(1),
  skillType: z.string().optional(),
  itemType: z.string().optional(),
  coreEffect: z.string().optional(),
  coreAbilities: z.string().optional(),
  effects: z.array(z.object({
    name: z.string(),
    type: z.enum(['element', 'spacetime', 'soul', 'body', 'curse', 'domain']),
    rarity: z.enum(['normal', 'rare', 'legendary']),
    description: z.string(),
    strength: z.number().min(1).max(100),
  })).default([]),
  sideEffects: z.string().optional(),
  description: z.string().optional(),
  linkedCharacterIds: z.array(z.number()).default([]),
});

/** POST /projects/:id/workshop - 创建基础自定义实体 */
app.post('/projects/:id/workshop', async (c) => {
  const projectId = Number(c.req.param('id'));
  const body = await c.req.json();
  const parsed = createEntitySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || '参数错误' }, 400);
  }

  const { entityType, ...data } = parsed.data;
  const table = getTable(entityType);

  const insertData: any = {
    projectId,
    name: data.name,
    grade: data.grade,
    gradeLevel: data.gradeLevel,
    effects: data.effects,
    sideEffects: data.sideEffects,
    description: data.description,
    linkedCharacterIds: data.linkedCharacterIds,
    growthType: 'base',
  };
  if (entityType === 'skill') {
    insertData.skillType = data.skillType;
    insertData.coreEffect = data.coreEffect;
  } else {
    insertData.itemType = data.itemType;
    insertData.coreAbilities = data.coreAbilities;
  }

  const [row] = await creativeDb.insert(table).values(insertData).returning();
  return c.json({ success: true, data: row }, 201);
});

// ============ 3. 融合 ============

const fusionSchema = z.object({
  entityType: z.enum(['skill', 'magic_item']),
  entityAId: z.number().int().min(1),
  entityBId: z.number().int().min(1),
});

/** POST /projects/:id/workshop/fusion - 融合两个实体 */
app.post('/projects/:id/workshop/fusion', async (c) => {
  const projectId = Number(c.req.param('id'));
  const body = await c.req.json();
  const parsed = fusionSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);

  const { entityType, entityAId, entityBId } = parsed.data;
  const table = getTable(entityType);

  const [rowA] = await creativeDb.select().from(table).where(and(eq(table.id, entityAId), eq(table.projectId, projectId)));
  const [rowB] = await creativeDb.select().from(table).where(and(eq(table.id, entityBId), eq(table.projectId, projectId)));
  if (!rowA || !rowB) return c.json({ success: false, error: '源实体不存在' }, 404);

  const entityA = rowToGrowthEntity(rowA, entityType);
  const entityB = rowToGrowthEntity(rowB, entityType);

  const result = await growthAgent.fusion(entityA, entityB);

  // 记录操作（无论成功失败）
  await creativeDb.insert(schema.entityGrowthRecord).values({
    projectId,
    entityType,
    entityId: entityAId,
    operationType: 'fusion',
    sourceEntityIds: [entityAId, entityBId],
    beforeSnapshot: { entityA: rowA, entityB: rowB },
    afterSnapshot: result.entity || {},
    result: result.success ? 'success' : 'fail',
    operatorNote: result.validationErrors?.join('; ') || result.narrative,
  });

  if (!result.success) {
    return c.json({ success: true, data: { preview: result.entity, validationErrors: result.validationErrors, narrative: result.narrative, breakthroughScene: result.breakthroughScene, confirmed: false } });
  }

  // 预览模式：返回结果但不入库，等 confirm
  return c.json({ success: true, data: { preview: result.entity, narrative: result.narrative, breakthroughScene: result.breakthroughScene, confirmed: false } });
});

// ============ 4. 变异 ============

const mutationSchema = z.object({
  entityType: z.enum(['skill', 'magic_item']),
  entityId: z.number().int().min(1),
});

/** POST /projects/:id/workshop/mutation - 变异 */
app.post('/projects/:id/workshop/mutation', async (c) => {
  const projectId = Number(c.req.param('id'));
  const body = await c.req.json();
  const parsed = mutationSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);

  const { entityType, entityId } = parsed.data;
  const table = getTable(entityType);

  const [row] = await creativeDb.select().from(table).where(and(eq(table.id, entityId), eq(table.projectId, projectId)));
  if (!row) return c.json({ success: false, error: '实体不存在' }, 404);

  const entity = rowToGrowthEntity(row, entityType);
  const result = await growthAgent.mutation(entity);

  await creativeDb.insert(schema.entityGrowthRecord).values({
    projectId,
    entityType,
    entityId,
    operationType: 'mutation',
    sourceEntityIds: [entityId],
    beforeSnapshot: row,
    afterSnapshot: result.entity || {},
    result: result.success ? 'success' : 'fail',
    operatorNote: result.validationErrors?.join('; ') || result.narrative,
  });

  return c.json({ success: true, data: { preview: result.entity, validationErrors: result.validationErrors, narrative: result.narrative, confirmed: false } });
});

// ============ 5. 强化 ============

const upgradeSchema = z.object({
  entityType: z.enum(['skill', 'magic_item']),
  entityId: z.number().int().min(1),
});

/** POST /projects/:id/workshop/upgrade - 强化（直接执行，有成功率） */
app.post('/projects/:id/workshop/upgrade', async (c) => {
  const projectId = Number(c.req.param('id'));
  const body = await c.req.json();
  const parsed = upgradeSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);

  const { entityType, entityId } = parsed.data;
  const table = getTable(entityType);

  const [row] = await creativeDb.select().from(table).where(and(eq(table.id, entityId), eq(table.projectId, projectId)));
  if (!row) return c.json({ success: false, error: '实体不存在' }, 404);

  const entity = rowToGrowthEntity(row, entityType);
  const result = await growthAgent.upgrade(entity);

  // 强化直接在原实体上操作（成功或失败都更新）
  const updateData: any = {
    grade: result.newGrade,
    gradeLevel: result.newGradeLevel,
    updatedAt: new Date(),
  };
  if (result.upgraded && result.entity) {
    updateData.effects = result.entity.effects;
    updateData.sideEffects = result.entity.sideEffects;
    if (entityType === 'skill') updateData.coreEffect = result.entity.coreEffect;
    else updateData.coreAbilities = result.entity.coreAbilities;
  }

  await creativeDb.update(table).set(updateData).where(eq(table.id, entityId));

  await creativeDb.insert(schema.entityGrowthRecord).values({
    projectId,
    entityType,
    entityId,
    operationType: 'upgrade',
    sourceEntityIds: [entityId],
    beforeSnapshot: row,
    afterSnapshot: { ...row, ...updateData },
    result: result.upgraded ? 'success' : 'fail',
    operatorNote: result.narrative,
  });

  return c.json({ success: true, data: { upgraded: result.upgraded, newGrade: result.newGrade, newGradeLevel: result.newGradeLevel, narrative: result.narrative, entity: { ...row, ...updateData } } });
});

// ============ 6. 进化 ============

const evolutionSchema = z.object({
  entityType: z.enum(['skill', 'magic_item']),
  entityId: z.number().int().min(1),
});

/** POST /projects/:id/workshop/evolution - 进化（预览，需confirm） */
app.post('/projects/:id/workshop/evolution', async (c) => {
  const projectId = Number(c.req.param('id'));
  const body = await c.req.json();
  const parsed = evolutionSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);

  const { entityType, entityId } = parsed.data;
  const table = getTable(entityType);

  const [row] = await creativeDb.select().from(table).where(and(eq(table.id, entityId), eq(table.projectId, projectId)));
  if (!row) return c.json({ success: false, error: '实体不存在' }, 404);

  const entity = rowToGrowthEntity(row, entityType);
  const result = await growthAgent.evolution(entity);

  if (!result.success && result.validationErrors) {
    return c.json({ success: false, error: result.validationErrors.join('; ') }, 400);
  }

  await creativeDb.insert(schema.entityGrowthRecord).values({
    projectId,
    entityType,
    entityId,
    operationType: 'evolution',
    sourceEntityIds: [entityId],
    beforeSnapshot: row,
    afterSnapshot: result.entity || {},
    result: 'success',
    operatorNote: result.narrative,
  });

  return c.json({ success: true, data: { preview: result.entity, narrative: result.narrative, breakthroughScene: result.breakthroughScene, confirmed: false } });
});

// ============ 7. 确认预览结果入库 ============

const confirmSchema = z.object({
  entityType: z.enum(['skill', 'magic_item']),
  entity: z.object({
    name: z.string(),
    grade: z.string(),
    gradeLevel: z.number(),
    skillType: z.string().optional(),
    itemType: z.string().optional(),
    coreEffect: z.string().optional(),
    coreAbilities: z.string().optional(),
    effects: z.array(z.any()),
    sideEffects: z.string().optional(),
    description: z.string().optional(),
    growthType: z.string(),
    baseEntityId: z.number().optional(),
    sourceEntityIds: z.array(z.number()).optional(),
    evolutionStage: z.string().optional(),
    isEvolved: z.boolean().optional(),
  }),
  linkedCharacterIds: z.array(z.number()).default([]),
  breakthroughNarrative: z.string().optional(),
});

/** POST /projects/:id/workshop/confirm - 确认预览结果，正式入库 */
app.post('/projects/:id/workshop/confirm', async (c) => {
  const projectId = Number(c.req.param('id'));
  const body = await c.req.json();
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);

  const { entityType, entity, linkedCharacterIds, breakthroughNarrative } = parsed.data;
  const table = getTable(entityType);

  const insertData = growthEntityToInsert(entity as GrowthEntity, projectId, entityType);
  insertData.linkedCharacterIds = linkedCharacterIds;
  if (breakthroughNarrative) insertData.breakthroughNarrative = breakthroughNarrative;

  const [row] = await creativeDb.insert(table).values(insertData).returning();
  return c.json({ success: true, data: row }, 201);
});

// ============ 8. 成长历史 ============

/** GET /projects/:id/workshop/history?entityType=&entityId= - 成长历史 */
app.get('/projects/:id/workshop/history', async (c) => {
  const projectId = Number(c.req.param('id'));
  const entityType = c.req.query('entityType');
  const entityId = c.req.query('entityId');

  let query = creativeDb
    .select()
    .from(schema.entityGrowthRecord)
    .where(eq(schema.entityGrowthRecord.projectId, projectId))
    .orderBy(desc(schema.entityGrowthRecord.createdAt));

  const rows = await query;
  const filtered = rows.filter(r =>
    (!entityType || r.entityType === entityType) &&
    (!entityId || r.entityId === Number(entityId))
  );

  return c.json({ success: true, data: filtered });
});

// ============ 9. 回退到指定快照 ============

/** POST /projects/:id/workshop/revert/:recordId - 回退 */
app.post('/projects/:id/workshop/revert/:recordId', async (c) => {
  const projectId = Number(c.req.param('id'));
  const recordId = Number(c.req.param('recordId'));

  const [record] = await creativeDb
    .select()
    .from(schema.entityGrowthRecord)
    .where(and(eq(schema.entityGrowthRecord.id, recordId), eq(schema.entityGrowthRecord.projectId, projectId)));

  if (!record) return c.json({ success: false, error: '记录不存在' }, 404);

  const table = getTable(record.entityType);
  const before = record.beforeSnapshot as any;

  // 回退：将实体恢复到操作前状态
  const restoreData: any = {
    name: before.name,
    grade: before.grade,
    gradeLevel: before.gradeLevel,
    effects: before.effects,
    sideEffects: before.sideEffects,
    description: before.description,
    updatedAt: new Date(),
  };
  if (record.entityType === 'skill') {
    restoreData.coreEffect = before.coreEffect;
    restoreData.skillType = before.skillType;
  } else {
    restoreData.coreAbilities = before.coreAbilities;
    restoreData.itemType = before.itemType;
  }

  await creativeDb.update(table).set(restoreData).where(eq(table.id, record.entityId));

  return c.json({ success: true, data: { reverted: true, entityId: record.entityId } });
});

// ============ 9.5 融合树（成长路径可视化） ============

/** GET /projects/:id/workshop/tree?entityType=&entityId= - 获取实体的完整成长血缘树 */
app.get('/projects/:id/workshop/tree', async (c) => {
  const projectId = Number(c.req.param('id'));
  const entityType = c.req.query('entityType') || 'skill';
  const entityId = Number(c.req.query('entityId'));
  if (!entityId) return c.json({ success: false, error: '缺少entityId' }, 400);

  const table = getTable(entityType);

  // 加载该项目所有同类型实体（含已删除的，因为树需要追溯来源）
  const allRows = await creativeDb
    .select()
    .from(table)
    .where(eq(table.projectId, projectId));

  const rowMap = new Map<number, any>();
  for (const r of allRows) rowMap.set(r.id, r);

  // 递归构建树（深度上限10防循环）
  interface TreeNode {
    id: number;
    name: string;
    grade: string;
    gradeLevel: number;
    growthType: string;
    isEvolved: boolean;
    isDeleted: boolean;
    children: TreeNode[];
  }

  function buildNode(id: number, depth: number): TreeNode | null {
    if (depth > 10) return null;
    const row = rowMap.get(id);
    if (!row) return null;
    const sourceIds = (row.sourceEntityIds || []) as number[];
    const children = sourceIds
      .map((sid) => buildNode(sid, depth + 1))
      .filter((n): n is TreeNode => n !== null);
    return {
      id: row.id,
      name: row.name,
      grade: row.grade,
      gradeLevel: row.gradeLevel,
      growthType: row.growthType,
      isEvolved: row.isEvolved || false,
      isDeleted: row.isDeleted || false,
      children,
    };
  }

  const tree = buildNode(entityId, 0);
  if (!tree) return c.json({ success: false, error: '实体不存在' }, 404);

  // 同时返回该实体的所有后代（谁以它为源）
  const descendants: { id: number; name: string; grade: string; growthType: string }[] = [];
  for (const r of allRows) {
    const srcIds = (r.sourceEntityIds || []) as number[];
    if (srcIds.includes(entityId) && r.id !== entityId) {
      descendants.push({ id: r.id, name: r.name, grade: r.grade, growthType: r.growthType });
    }
  }

  return c.json({ success: true, data: { tree, descendants } });
});

// ============ 10. 实体详情（含成长信息） ============

/** GET /projects/:id/workshop/:entityType/:entityId - 实体详情+成长信息 */
app.get('/projects/:id/workshop/:entityType/:entityId', async (c) => {
  const projectId = Number(c.req.param('id'));
  const entityType = c.req.param('entityType');
  const entityId = Number(c.req.param('entityId'));
  const table = getTable(entityType);

  const [row] = await creativeDb.select().from(table).where(and(eq(table.id, entityId), eq(table.projectId, projectId)));
  if (!row) return c.json({ success: false, error: '实体不存在' }, 404);

  // 计算可用成长方式
  const entity = rowToGrowthEntity(row, entityType);
  const canEvolve = (entity.grade === '道纹' && entity.gradeLevel >= 3) ||
    ['仙蜕'].includes(entity.grade);
  const upgradeSuccessRate = entity.gradeLevel >= 3 ? 50 : 80;

  const history = await creativeDb
    .select()
    .from(schema.entityGrowthRecord)
    .where(and(
      eq(schema.entityGrowthRecord.entityType, entityType),
      eq(schema.entityGrowthRecord.entityId, entityId),
    ))
    .orderBy(desc(schema.entityGrowthRecord.createdAt));

  return c.json({
    success: true,
    data: {
      entity: row,
      growthInfo: {
        canFusion: true,
        canMutation: true,
        canUpgrade: entity.grade !== '神蕴',
        canEvolve,
        upgradeSuccessRate,
        growthHistory: history,
      },
    },
  });
});

// ============ 11. 更新实体（关联人物等） ============

/** PUT /projects/:id/workshop/:entityType/:entityId - 更新实体 */
app.put('/projects/:id/workshop/:entityType/:entityId', async (c) => {
  const projectId = Number(c.req.param('id'));
  const entityType = c.req.param('entityType');
  const entityId = Number(c.req.param('entityId'));
  const table = getTable(entityType);
  const body = await c.req.json();

  const allowed: any = { updatedAt: new Date() };
  if (body.linkedCharacterIds !== undefined) allowed.linkedCharacterIds = body.linkedCharacterIds;
  if (body.name !== undefined) allowed.name = body.name;
  if (body.description !== undefined) allowed.description = body.description;
  if (body.sideEffects !== undefined) allowed.sideEffects = body.sideEffects;

  const [row] = await creativeDb.update(table).set(allowed).where(and(eq(table.id, entityId), eq(table.projectId, projectId))).returning();
  if (!row) return c.json({ success: false, error: '实体不存在' }, 404);
  return c.json({ success: true, data: row });
});

// ============ 12. 软删除实体 ============

/** DELETE /projects/:id/workshop/:entityType/:entityId - 软删除 */
app.delete('/projects/:id/workshop/:entityType/:entityId', async (c) => {
  const projectId = Number(c.req.param('id'));
  const entityType = c.req.param('entityType');
  const entityId = Number(c.req.param('entityId'));
  const table = getTable(entityType);

  await creativeDb.update(table).set({ isDeleted: true, updatedAt: new Date() }).where(and(eq(table.id, entityId), eq(table.projectId, projectId)));
  return c.json({ success: true, data: { deleted: true } });
});

export default app;
