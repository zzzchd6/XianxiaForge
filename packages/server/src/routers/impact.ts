/**
 * 分支影响体系路由（需求：分支影响体系）
 * 提供影响定义白名单管理、人物/世界影响状态查询、分支影响 ⚡ 预览、影响链接与变更历史。
 * 设计决策：独立数值表 + 单一权威（影响快照为数值状态唯一权威来源）。
 * 红线：查询/预览类接口 best-effort，异常降级不抛 500 阻断前端面板。
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc, isNull, isNotNull, or, sql } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import {
  getActiveImpactDefs,
  getCharacterImpactState,
  getWorldImpactState,
  getRelationState,
  previewBranchImpacts,
  resolveImpactTargetCharacters,
  suggestImpactsForDirectionAsync,
  recommendDirections,
  buildRelationContext,
} from '../services/impact/impact.service.js';

const app = new Hono();

// ============================================================
// 影响定义白名单管理
// ============================================================

const defCreateSchema = z.object({
  impactKey: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  domain: z.enum(['character', 'world', 'relation', 'rule']),
  category: z.string().min(1).max(32),
  valueType: z.enum(['numeric', 'tag']).default('numeric'),
  minValue: z.number().int().default(0),
  maxValue: z.number().int().default(100),
  defaultValue: z.number().int().default(0),
  decayPerChapter: z.number().int().default(0),
  grade: z.string().max(16).optional(),
  mutexGroup: z.string().max(64).optional(),
  priority: z.number().int().default(1),
  thresholdEvents: z.array(z.any()).optional(),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});

const defUpdateSchema = defCreateSchema.partial();

/** GET /api/projects/:id/impact/definitions - 项目可用影响定义（全局预设 + 项目自定义，含禁用项） */
app.get('/projects/:id/impact/definitions', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const rows = await creativeDb
      .select()
      .from(schema.impactDefinition)
      .where(or(
        isNull(schema.impactDefinition.projectId),
        eq(schema.impactDefinition.projectId, id),
      ))
      .orderBy(schema.impactDefinition.domain, schema.impactDefinition.category, schema.impactDefinition.id);
    return c.json({ success: true, data: rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:id/impact/definitions - 新建项目自定义影响定义 */
app.post('/projects/:id/impact/definitions', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const body = defCreateSchema.parse(await c.req.json());
    const [inserted] = await creativeDb
      .insert(schema.impactDefinition)
      .values({ ...body, projectId: id })
      .returning();
    return c.json({ success: true, data: inserted }, 201);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({ success: false, error: `参数校验失败: ${error.errors.map((e) => e.message).join('；')}` }, 400);
    }
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/impact/definitions/:defId - 更新影响定义 */
app.put('/impact/definitions/:defId', async (c) => {
  try {
    const defId = Number(c.req.param('defId'));
    if (isNaN(defId)) return c.json({ success: false, error: '无效的定义ID' }, 400);
    const body = defUpdateSchema.parse(await c.req.json());
    const [updated] = await creativeDb
      .update(schema.impactDefinition)
      .set(body)
      .where(eq(schema.impactDefinition.id, defId))
      .returning();
    if (!updated) return c.json({ success: false, error: '影响定义不存在' }, 404);
    return c.json({ success: true, data: updated });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return c.json({ success: false, error: `参数校验失败: ${error.errors.map((e) => e.message).join('；')}` }, 400);
    }
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /api/impact/definitions/:defId - 删除影响定义（仅项目自定义，全局预设禁删） */
app.delete('/impact/definitions/:defId', async (c) => {
  try {
    const defId = Number(c.req.param('defId'));
    if (isNaN(defId)) return c.json({ success: false, error: '无效的定义ID' }, 400);
    const [existing] = await creativeDb
      .select()
      .from(schema.impactDefinition)
      .where(eq(schema.impactDefinition.id, defId))
      .limit(1);
    if (!existing) return c.json({ success: false, error: '影响定义不存在' }, 404);
    if (existing.projectId == null) {
      return c.json({ success: false, error: '全局预设定义不可删除，可选择禁用' }, 400);
    }
    await creativeDb.delete(schema.impactDefinition).where(eq(schema.impactDefinition.id, defId));
    return c.json({ success: true, data: { deleted: defId } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================
// 影响状态查询（单一权威：最新已确认快照）
// ============================================================

/** GET /api/projects/:id/impact/character-state?characterId=&chapterNo= - 人物影响状态 */
app.get('/projects/:id/impact/character-state', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const characterId = Number(c.req.query('characterId'));
    const chapterNoRaw = c.req.query('chapterNo');
    if (isNaN(id) || isNaN(characterId)) {
      return c.json({ success: false, error: 'projectId/characterId 参数无效' }, 400);
    }
    const chapterNo = chapterNoRaw !== undefined && chapterNoRaw !== '' && !isNaN(Number(chapterNoRaw))
      ? Number(chapterNoRaw)
      : 999999;
    const defs = await getActiveImpactDefs(creativeDb, id);
    const state = await getCharacterImpactState(creativeDb, id, characterId, chapterNo, defs);
    return c.json({ success: true, data: state });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:id/impact/world-state?region=&chapterNo= - 世界（区域/全局）影响状态 */
app.get('/projects/:id/impact/world-state', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const regionRaw = c.req.query('region');
    const region = regionRaw !== undefined && regionRaw !== '' ? regionRaw : null;
    const chapterNoRaw = c.req.query('chapterNo');
    const chapterNo = chapterNoRaw !== undefined && chapterNoRaw !== '' && !isNaN(Number(chapterNoRaw))
      ? Number(chapterNoRaw)
      : 999999;
    const defs = await getActiveImpactDefs(creativeDb, id);
    const state = await getWorldImpactState(creativeDb, id, region, chapterNo, defs);
    return c.json({ success: true, data: state });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================
// 分支影响预览 / 链接 / 历史
// ============================================================

/** GET /api/projects/:id/impact/links/:optionId - 分支选项绑定的影响链接明细（含隐藏项，供编辑） */
app.get('/projects/:id/impact/links/:optionId', async (c) => {
  try {
    const optionId = Number(c.req.param('optionId'));
    if (isNaN(optionId)) return c.json({ success: false, error: '无效的分支选项ID' }, 400);
    const rows = await creativeDb
      .select()
      .from(schema.branchImpactLink)
      .where(eq(schema.branchImpactLink.branchOptionId, optionId))
      .orderBy(schema.branchImpactLink.sortOrder);
    return c.json({ success: true, data: rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:id/impact/branch-options/:optionId/preview?chapterNo= - ⚡ 影响前后对比预览（不落库） */
app.get('/projects/:id/impact/branch-options/:optionId/preview', async (c) => {
  const id = Number(c.req.param('id'));
  const optionId = Number(c.req.param('optionId'));
  if (isNaN(id) || isNaN(optionId)) {
    return c.json({ success: true, data: [] });
  }
  // chapterNo 缺省 = 来源章+1；预览 best-effort，异常返回空数组不阻断面板
  const chapterNoRaw = c.req.query('chapterNo');
  let chapterNo = chapterNoRaw !== undefined && chapterNoRaw !== '' && !isNaN(Number(chapterNoRaw))
    ? Number(chapterNoRaw)
    : 0;
  // 方向自动映射上下文（与实际应用保持一致）：主方向 + 来源章 POV 人物
  let mainDirection: string | null = null;
  let povCharacterIds: number[] = [];
  const [opt] = await creativeDb
    .select({
      sourceChapterPlanId: schema.chapterBranchOption.sourceChapterPlanId,
      mainDirection: schema.chapterBranchOption.mainDirection,
    })
    .from(schema.chapterBranchOption)
    .where(eq(schema.chapterBranchOption.id, optionId))
    .limit(1);
  mainDirection = opt?.mainDirection ?? null;
  if (opt?.sourceChapterPlanId) {
    const [plan] = await creativeDb
      .select({
        chapterNo: schema.chapterPlan.chapterNo,
        povCharacterIds: schema.chapterPlan.povCharacterIds,
      })
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.id, opt.sourceChapterPlanId))
      .limit(1);
    if (!chapterNo) chapterNo = (plan?.chapterNo ?? 0) + 1;
    povCharacterIds = Array.isArray(plan?.povCharacterIds) ? (plan!.povCharacterIds as number[]).map(Number) : [];
  }
  // 目标人物兜底：POV 为空时回落项目"默认影响对象"（主角），与实际应用保持一致
  const targetCharacterIds = await resolveImpactTargetCharacters(id, povCharacterIds);
  const items = await previewBranchImpacts(id, optionId, chapterNo, {
    mainDirection,
    characterIds: targetCharacterIds,
  });
  return c.json({ success: true, data: items });
});

/** GET /api/projects/:id/impact/target-candidates - 候选影响对象人物（状态快照已出场人物，供项目设置选择默认影响对象） */
app.get('/projects/:id/impact/target-candidates', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: true, data: [] });
    const rows = await creativeDb.execute(
      sql`SELECT DISTINCT ON (character_id) character_id, character_name
          FROM character_state_snapshot
          WHERE project_id = ${id} AND character_id IS NOT NULL
          ORDER BY character_id, id DESC`
    ) as any[];
    const data = rows.map((r) => ({
      characterId: Number(r.character_id),
      characterName: r.character_name ?? `人物${r.character_id}`,
    }));
    return c.json({ success: true, data });
  } catch {
    return c.json({ success: true, data: [] });
  }
});

/** GET /api/projects/:id/impact/history?limit= - 影响变更历史（倒序） */
app.get('/projects/:id/impact/history', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const limitRaw = c.req.query('limit');
    const limit = limitRaw && !isNaN(Number(limitRaw)) ? Math.min(Number(limitRaw), 200) : 50;
    const rows = await creativeDb
      .select()
      .from(schema.impactHistory)
      .where(eq(schema.impactHistory.projectId, id))
      .orderBy(desc(schema.impactHistory.id))
      .limit(limit);
    return c.json({ success: true, data: rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================
// 方向 ↔ 影响 联动（阶段3）
// ============================================================

/** GET /api/projects/:id/impact/suggest?directionCode=&characterIds=1,2 - 方向→影响 自动映射建议（基准幅度，不落库） */
app.get('/projects/:id/impact/suggest', async (c) => {
  const id = Number(c.req.param('id'));
  const directionCode = c.req.query('directionCode') ?? '';
  if (isNaN(id) || !directionCode) {
    return c.json({ success: true, data: [] });
  }
  const idsRaw = c.req.query('characterIds') ?? '';
  const characterIds = idsRaw
    ? idsRaw.split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0)
    : [];
  const suggestions = await suggestImpactsForDirectionAsync(id, directionCode, characterIds);
  return c.json({ success: true, data: suggestions });
});

/** GET /api/projects/:id/impact/direction-recommend?characterIds=1,2&chapterNo= - 影响→方向 弱推荐（不强制） */
app.get('/projects/:id/impact/direction-recommend', async (c) => {
  const id = Number(c.req.param('id'));
  if (isNaN(id)) return c.json({ success: true, data: [] });
  const idsRaw = c.req.query('characterIds') ?? '';
  const characterIds = idsRaw
    ? idsRaw.split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0)
    : [];
  const chapterNoRaw = c.req.query('chapterNo');
  const upToChapter = chapterNoRaw && !isNaN(Number(chapterNoRaw)) ? Number(chapterNoRaw) : 999999;
  const recs = await recommendDirections(id, characterIds, upToChapter);
  return c.json({ success: true, data: recs });
});

// ============================================================
// 关系影响（阶段4）
// ============================================================

/** GET /api/projects/:id/impact/relation-state?charAId=&charBId=&chapterNo= - 两人关系状态 */
app.get('/projects/:id/impact/relation-state', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const charAId = Number(c.req.query('charAId'));
    const charBId = Number(c.req.query('charBId'));
    if (isNaN(id) || isNaN(charAId) || isNaN(charBId)) {
      return c.json({ success: false, error: 'projectId/charAId/charBId 参数无效' }, 400);
    }
    const chapterNoRaw = c.req.query('chapterNo');
    const chapterNo = chapterNoRaw && !isNaN(Number(chapterNoRaw)) ? Number(chapterNoRaw) : 999999;
    const state = await getRelationState(creativeDb, id, charAId, charBId, chapterNo);
    return c.json({ success: true, data: state });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:id/impact/relation-context?characterIds=1,2,3&chapterNo= - 出场人物关系上下文 */
app.get('/projects/:id/impact/relation-context', async (c) => {
  const id = Number(c.req.param('id'));
  if (isNaN(id)) return c.json({ success: true, data: { pairs: [], text: null } });
  const idsRaw = c.req.query('characterIds') ?? '';
  const characterIds = idsRaw
    ? idsRaw.split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0)
    : [];
  const chapterNoRaw = c.req.query('chapterNo');
  const chapterNo = chapterNoRaw && !isNaN(Number(chapterNoRaw)) ? Number(chapterNoRaw) : 999999;
  const ctx = await buildRelationContext(id, characterIds, chapterNo);
  return c.json({ success: true, data: ctx });
});

export default app;
