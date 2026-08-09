/**
 * 自定义功法路由 - 3步点选+随机创建，CRUD + 随机引擎 + 命名模块 + 详解Skill
 * 挂载前缀由 index.ts 添加：/api
 * 路径：/projects/:id/custom-techniques...
 * 核心设定：功法无品级，不接入6档成长；演化走推演深化/跨界融合/绝境异变（阶段4）。
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { creativeDb, zhuxianDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import * as zhuxianSchema from '../db/zhuxian-schema.js';
import { randomTechnique, type TechniqueLock } from '../services/technique-random.js';
import { namingAgent } from '../agents/naming.js';
import { techniqueLoreAgent } from '../agents/technique-lore.js';
import { forgeSmartMatchAgent } from '../agents/forge-smart-match.js';
import { buildTechniqueContext, validateTechnique } from '../services/forge-smart-match.js';
import { listProjectEntities, importFromProject } from '../services/cross-project-import.js';
import { exportTechniques, importTechniques } from '../services/module-file-io.js';
import { generateBacklashText, generateDaoInsights } from '../services/ux-gen.js';
import {
  DAO_RULES, DAO_COMPAT_LABELS, GUIDANCE_LEVELS, STYLE_TYPES, CORE_TRAITS,
  PRACTICE_PATHS, ABILITIES, BACKLASHES, INHERITANCES, THRESHOLDS, BODY_MARKS,
  USAGE_SKILLS, EVOLUTIONS, INHERENT_CONFLICTS, DAO_REALMS,
  SKILL_TIER_LABELS, EVOLUTION_TYPE_LABELS, CONFLICT_TYPE_LABELS,
  compatWithMain,
} from '../data/technique-catalog.js';

const app = new Hono();

// ============ Zod schemas ============

const techniqueFormSchema = z.object({
  name: z.string().min(1).max(32),
  mainDao: z.string().min(1),
  assistDao: z.array(z.string()).default([]),
  guidanceDepth: z.string().min(1),
  fakeDepth: z.string().nullable().optional(),
  styleType: z.string().min(1),
  threshold: z.array(z.string()).default([]),
  coreTraits: z.array(z.string()).default([]),
  practicePath: z.string().min(1),
  bodyMark: z.any().default({}),
  usageSkills: z.array(z.string()).default([]),
  abilities: z.array(z.string()).default([]),
  backlash: z.array(z.string()).default([]),
  backlashText: z.string().nullable().optional(),
  insightRenames: z.array(z.object({ id: z.string(), newName: z.string() })).default([]),
  inheritance: z.string().min(1),
  evolution: z.array(z.string()).default([]),
  inherentConflict: z.string().nullable().optional(),
  coreDirection: z.array(z.string()).default([]),
  fitMonk: z.array(z.string()).default([]),
  description: z.string().nullable().optional(),
  linkedCharacterIds: z.array(z.number()).default([]),
});

// ============ 1. 列表 ============

/** GET /projects/:id/custom-techniques - 项目下所有未删除自定义功法（支持 ?entityStatus=official|draft 筛选） */
app.get('/projects/:id/custom-techniques', async (c) => {
  const projectId = Number(c.req.param('id'));
  const statusFilter = c.req.query('entityStatus');
  const conds = [
    eq(schema.customTechnique.projectId, projectId),
    eq(schema.customTechnique.isDeleted, false),
  ];
  if (statusFilter === 'draft' || statusFilter === 'official') {
    conds.push(eq(schema.customTechnique.entityStatus, statusFilter));
  }
  const rows = await creativeDb
    .select()
    .from(schema.customTechnique)
    .where(and(...conds))
    .orderBy(desc(schema.customTechnique.createdAt));
  return c.json({ success: true, data: rows });
});

// ============ 1b. 词条配置库（前端点选数据，须先于 /:tid 注册） ============

/** GET /projects/:id/custom-techniques/catalog - 道则/深度/体例/特质/神通/反噬等全配置 */
app.get('/projects/:id/custom-techniques/catalog', async (c) => {
  return c.json({
    success: true,
    data: {
      daoRules: DAO_RULES,
      daoRealms: DAO_REALMS,
      compatLabels: DAO_COMPAT_LABELS,
      guidanceLevels: GUIDANCE_LEVELS,
      styleTypes: STYLE_TYPES,
      coreTraits: CORE_TRAITS,
      practicePaths: PRACTICE_PATHS,
      abilities: ABILITIES,
      backlashes: BACKLASHES,
      inheritances: INHERITANCES,
      thresholds: THRESHOLDS,
      bodyMarks: BODY_MARKS,
      usageSkills: USAGE_SKILLS,
      evolutions: EVOLUTIONS,
      inherentConflicts: INHERENT_CONFLICTS,
      skillTierLabels: SKILL_TIER_LABELS,
      evolutionTypeLabels: EVOLUTION_TYPE_LABELS,
      conflictTypeLabels: CONFLICT_TYPE_LABELS,
    },
  });
});

/** GET /projects/:id/custom-techniques/compat/:mainDao - 给定主修道则的辅修兼容标注 */
app.get('/projects/:id/custom-techniques/compat/:mainDao', async (c) => {
  const mainDao = c.req.param('mainDao');
  return c.json({ success: true, data: compatWithMain(mainDao as any) });
});

// ============ 2. 详情 ============

/** GET /projects/:id/custom-techniques/:tid - 单部功法详情 */
app.get('/projects/:id/custom-techniques/:tid', async (c) => {
  const projectId = Number(c.req.param('id'));
  const tid = Number(c.req.param('tid'));
  const [row] = await creativeDb
    .select()
    .from(schema.customTechnique)
    .where(and(eq(schema.customTechnique.id, tid), eq(schema.customTechnique.projectId, projectId)));
  if (!row) return c.json({ success: false, error: '功法不存在' }, 404);
  return c.json({ success: true, data: row });
});

// ============ 3. 随机（确定性，零 token） ============

const randomSchema = z.object({
  base: z.any().optional(),
  locked: z.any().optional(),
});

/** POST /projects/:id/custom-techniques/random - 骰子随机完整功法（锁定字段保留） */
app.post('/projects/:id/custom-techniques/random', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = randomSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);
  const draft = randomTechnique(parsed.data.base, parsed.data.locked as TechniqueLock | undefined);
  return c.json({ success: true, data: draft });
});

// ============ 4. 随机名号（LLM 命名模块） ============

const randomNameSchema = z.object({
  mainDao: z.string().min(1),
  guidanceDepth: z.enum(['rudimentary', 'complete', 'essential']),
  styleType: z.enum(['cultivate', 'attack', 'defense', 'assist', 'special']).optional(),
  count: z.number().int().min(1).max(5).default(1),
});

/** POST /projects/:id/custom-techniques/random-name - 按道则+深度+体例生成功法名号 */
app.post('/projects/:id/custom-techniques/random-name', async (c) => {
  const body = await c.req.json();
  const parsed = randomNameSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);
  const { mainDao, guidanceDepth, styleType, count } = parsed.data;
  try {
    const names = await namingAgent.techniqueName(mainDao, guidanceDepth, styleType, count);
    return c.json({ success: true, data: { names } });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || '命名失败' }, 500);
  }
});

// ============ 4.5 智能匹配 ============

/** POST /projects/:id/custom-techniques/smart-match - 文字描述→功法参数智能匹配 */
app.post('/projects/:id/custom-techniques/smart-match', async (c) => {
  try {
    const { description } = await c.req.json();
    if (typeof description !== 'string' || description.trim().length < 5) {
      return c.json({ success: false, error: '请提供至少 5 个字的描述' }, 400);
    }
    const raw = await forgeSmartMatchAgent.match('technique', description.trim(), buildTechniqueContext());
    const result = validateTechnique(raw);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 4.6 天机独悟：运用方向+神通招式名预览生成（13-SRS US-20e） ============

const insightDirectionsSchema = z.object({
  mainDao: z.string().min(1),
  assistDao: z.array(z.string()).default([]),
  coreTraits: z.array(z.string()).default([]),
  abilities: z.array(z.object({
    id: z.string(),
    name: z.string(),
    daoRealm: z.string(),
  })).optional(),
});

/** POST /projects/:id/custom-techniques/insight-directions - 道则组合「天机独悟」预览生成（不落库） */
app.post('/projects/:id/custom-techniques/insight-directions', async (c) => {
  try {
    const parsed = insightDirectionsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);
    const data = await generateDaoInsights(parsed.data);
    return c.json({ success: true, data });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || '天机独悟生成失败' }, 500);
  }
});

// ============ 5. 创建 ============

/** POST /projects/:id/custom-techniques - 保存功法入库（可选自动生成详解） */
app.post('/projects/:id/custom-techniques', async (c) => {
  const projectId = Number(c.req.param('id'));
  const body = await c.req.json();
  const genDesc = body?.generateDescription !== false; // 默认生成
  const parsed = techniqueFormSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || '参数错误' }, 400);
  }
  const d = parsed.data;

  // 详解+招式：优先用前端传入详解，否则调用 LLM Skill 一次生成详解与配套招式（失败降级，不阻断入库）
  let description = d.description ?? null;
  let moves: any[] = [];
  if (!description && genDesc) {
    try {
      const lore = await techniqueLoreAgent.generate({
        name: d.name,
        mainDao: d.mainDao,
        assistDao: d.assistDao,
        guidanceDepth: d.guidanceDepth as any,
        fakeDepth: d.fakeDepth,
        styleType: d.styleType as any,
        coreTraits: d.coreTraits,
        practicePath: d.practicePath,
        bodyMark: d.bodyMark,
        usageSkills: d.usageSkills,
        abilities: d.abilities,
        backlash: d.backlash,
        inheritance: d.inheritance,
        evolution: d.evolution,
        inherentConflict: d.inherentConflict,
      });
      description = lore.description;
      moves = lore.moves;
    } catch {
      description = null;
      moves = [];
    }
  }

  // 反噬代价动态生成（13-SRS US-20d）：前端未传入则后台 LLM 生成回写，不阻塞秒回
  const needBacklash = !d.backlashText;

  const [row] = await creativeDb.insert(schema.customTechnique).values({
    projectId,
    name: d.name,
    mainDao: d.mainDao,
    assistDao: d.assistDao,
    guidanceDepth: d.guidanceDepth,
    fakeDepth: d.fakeDepth ?? null,
    styleType: d.styleType,
    threshold: d.threshold,
    coreTraits: d.coreTraits,
    practicePath: d.practicePath,
    bodyMark: d.bodyMark,
    usageSkills: d.usageSkills,
    abilities: d.abilities,
    backlash: d.backlash,
    backlashText: d.backlashText ?? null,
    insightRenames: d.insightRenames,
    inheritance: d.inheritance,
    evolution: d.evolution,
    inherentConflict: d.inherentConflict ?? null,
    coreDirection: d.coreDirection,
    fitMonk: d.fitMonk,
    description,
    moves,
    linkedCharacterIds: d.linkedCharacterIds,
    growthType: 'base',
  }).returning();

  // 后台生成反噬描述（fire-and-forget，失败静默；下次可点「重生成反噬」补救）
  if (needBacklash) {
    generateBacklashText({
      name: d.name,
      mainDao: d.mainDao,
      assistDao: d.assistDao,
      practicePath: d.practicePath,
      coreTraits: d.coreTraits,
    })
      .then((text) => creativeDb
        .update(schema.customTechnique)
        .set({ backlashText: text, updatedAt: new Date() })
        .where(eq(schema.customTechnique.id, row.id)))
      .catch(() => { /* 降级：保持 null，可手动重生成 */ });
  }

  return c.json({ success: true, data: row }, 201);
});

// ============ 6. 更新 ============

/** PUT /projects/:id/custom-techniques/:tid - 更新功法 */
app.put('/projects/:id/custom-techniques/:tid', async (c) => {
  const projectId = Number(c.req.param('id'));
  const tid = Number(c.req.param('tid'));
  const body = await c.req.json();
  const parsed = techniqueFormSchema.partial().safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);

  const patch: any = { ...parsed.data, updatedAt: new Date() };
  delete patch.linkedCharacterIds;
  if (parsed.data.linkedCharacterIds) patch.linkedCharacterIds = parsed.data.linkedCharacterIds;
  // 用户编辑保存后草稿自动转正（09-自动维护 US-4）
  patch.entityStatus = 'official';

  const [row] = await creativeDb
    .update(schema.customTechnique)
    .set(patch)
    .where(and(eq(schema.customTechnique.id, tid), eq(schema.customTechnique.projectId, projectId)))
    .returning();
  if (!row) return c.json({ success: false, error: '功法不存在' }, 404);
  return c.json({ success: true, data: row });
});

// ============ 7. 软删除 ============

/** DELETE /projects/:id/custom-techniques/:tid - 软删除 */
app.delete('/projects/:id/custom-techniques/:tid', async (c) => {
  const projectId = Number(c.req.param('id'));
  const tid = Number(c.req.param('tid'));
  const [row] = await creativeDb
    .update(schema.customTechnique)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(and(eq(schema.customTechnique.id, tid), eq(schema.customTechnique.projectId, projectId)))
    .returning();
  if (!row) return c.json({ success: false, error: '功法不存在' }, 404);
  return c.json({ success: true, data: { id: tid } });
});

// ============ 8. 详解生成Skill（对已入库功法补生成/重生成） ============

/** POST /projects/:id/custom-techniques/:tid/generate-description - 调用Skill生成详解并回写 */
app.post('/projects/:id/custom-techniques/:tid/generate-description', async (c) => {
  const projectId = Number(c.req.param('id'));
  const tid = Number(c.req.param('tid'));
  const [t] = await creativeDb
    .select()
    .from(schema.customTechnique)
    .where(and(eq(schema.customTechnique.id, tid), eq(schema.customTechnique.projectId, projectId)));
  if (!t) return c.json({ success: false, error: '功法不存在' }, 404);

  try {
    const lore = await techniqueLoreAgent.generate({
      name: t.name,
      mainDao: t.mainDao,
      assistDao: (t.assistDao || []) as string[],
      guidanceDepth: t.guidanceDepth as any,
      fakeDepth: t.fakeDepth,
      styleType: t.styleType as any,
      coreTraits: (t.coreTraits || []) as string[],
      practicePath: t.practicePath,
      bodyMark: t.bodyMark as any,
      usageSkills: (t.usageSkills || []) as string[],
      abilities: (t.abilities || []) as string[],
      backlash: (t.backlash || []) as string[],
      inheritance: t.inheritance,
      evolution: (t.evolution || []) as string[],
      inherentConflict: t.inherentConflict,
    });
    const [row] = await creativeDb
      .update(schema.customTechnique)
      .set({ description: lore.description, moves: lore.moves, updatedAt: new Date() })
      .where(eq(schema.customTechnique.id, tid))
      .returning();
    return c.json({ success: true, data: row });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || '详解生成失败' }, 500);
  }
});

// ============ 8.5 反噬代价重生成（13-SRS US-20d，对已入库功法） ============

/** POST /projects/:id/custom-techniques/:tid/generate-backlash - 重生成反噬描述并回写 */
app.post('/projects/:id/custom-techniques/:tid/generate-backlash', async (c) => {
  const projectId = Number(c.req.param('id'));
  const tid = Number(c.req.param('tid'));
  const [t] = await creativeDb
    .select()
    .from(schema.customTechnique)
    .where(and(eq(schema.customTechnique.id, tid), eq(schema.customTechnique.projectId, projectId)));
  if (!t) return c.json({ success: false, error: '功法不存在' }, 404);

  try {
    const text = await generateBacklashText({
      name: t.name,
      mainDao: t.mainDao,
      assistDao: (t.assistDao || []) as string[],
      practicePath: t.practicePath,
      coreTraits: (t.coreTraits || []) as string[],
    });
    const [row] = await creativeDb
      .update(schema.customTechnique)
      .set({ backlashText: text, updatedAt: new Date() })
      .where(eq(schema.customTechnique.id, tid))
      .returning();
    return c.json({ success: true, data: row });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || '反噬描述生成失败' }, 500);
  }
});

// ============ 9. 从诛仙库导入功法 ============

const importTechniqueSchema = z.object({ worldSkillId: z.number() });

function mapGradeToDepth(grade: string | null): string {
  if (!grade) return 'complete';
  if (grade.includes('入门')) return 'rudimentary';
  if (grade.includes('精通')) return 'complete';
  if (grade.includes('大成')) return 'essential';
  return 'complete';
}

function mapSkillTypeToStyle(skillType: string | null): string {
  if (!skillType) return 'attack';
  if (skillType.includes('攻击')) return 'attack';
  if (skillType.includes('防御')) return 'defense';
  if (skillType.includes('辅助')) return 'assist';
  if (skillType.includes('修炼')) return 'cultivate';
  return 'attack';
}

/** POST /projects/:id/custom-techniques/import - 从诛仙库导入功法快照 */
app.post('/projects/:id/custom-techniques/import', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const parsed = importTechniqueSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const { worldSkillId } = parsed.data;

    // 1. 从诛仙库读取源功法
    const [src] = await zhuxianDb
      .select()
      .from(zhuxianSchema.novelSkillLib)
      .where(eq(zhuxianSchema.novelSkillLib.id, worldSkillId));
    if (!src) return c.json({ success: false, error: '诛仙库中未找到该功法' }, 404);

    // 2. 字段映射
    const guidanceDepth = mapGradeToDepth(src.grade);
    const styleType = mapSkillTypeToStyle(src.skillType);
    const description = src.coreEffect ?? null;
    const moves = ((src.famousUsage as string[]) ?? []).map((item) => ({ name: item, desc: '', tier: 'core' }));

    // 3. 插入 creativeDb
    const [row] = await creativeDb
      .insert(schema.customTechnique)
      .values({
        projectId,
        name: src.name,
        mainDao: 'sword_dao',
        assistDao: [],
        guidanceDepth,
        styleType,
        threshold: [],
        coreTraits: [],
        practicePath: 'orthodox',
        bodyMark: {},
        usageSkills: [],
        abilities: [],
        backlash: [],
        inheritance: 'jade_slip',
        evolution: [],
        coreDirection: [],
        fitMonk: [],
        description,
        moves,
        growthType: 'base',
        sourceRef: { type: 'world_skill', id: worldSkillId, name: src.name, bookId: src.bookId ?? null },
      })
      .returning();

    return c.json({ success: true, data: row }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:id/custom-techniques/import/sources?sourceProjectId= - 源项目可引入功法清单 */
app.get('/projects/:id/custom-techniques/import/sources', async (c) => {
  try {
    const sourceProjectId = Number(c.req.query('sourceProjectId'));
    if (isNaN(sourceProjectId)) return c.json({ success: false, error: '无效的源项目ID' }, 400);
    const data = await listProjectEntities(schema.customTechnique, sourceProjectId);
    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

const importFromProjectTechniqueSchema = z.object({
  sourceProjectId: z.number(),
  ids: z.array(z.number()).min(1),
  skipDuplicates: z.boolean().optional(),
});

/** POST /api/projects/:id/custom-techniques/import-from-project - 从其他项目引入功法 */
app.post('/projects/:id/custom-techniques/import-from-project', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const parsed = importFromProjectTechniqueSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const result = await importFromProject({
      table: schema.customTechnique,
      sourceProjectId: parsed.data.sourceProjectId,
      targetProjectId: projectId,
      ids: parsed.data.ids,
      skipDuplicates: parsed.data.skipDuplicates,
      sourceRefType: 'project_technique',
    });
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================
// 文件导出/导入（14-SRS US-25）
// ============================================================

const fileExportTechniqueSchema = z.object({ ids: z.array(z.number()).min(1) });

/** POST /api/projects/:id/custom-techniques/export - 导出功法为 JSON items */
app.post('/projects/:id/custom-techniques/export', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const parsed = fileExportTechniqueSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    const items = await exportTechniques(projectId, parsed.data.ids);
    return c.json({ success: true, data: { items } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

const fileImportTechniqueSchema = z.object({
  items: z.array(z.any()).min(1),
  conflictStrategy: z.enum(['skip', 'overwrite']).default('skip'),
});

/** POST /api/projects/:id/custom-techniques/import-file - 从 JSON 文件导入功法 */
app.post('/projects/:id/custom-techniques/import-file', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const parsed = fileImportTechniqueSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    const result = await importTechniques(projectId, parsed.data.items, parsed.data.conflictStrategy);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
