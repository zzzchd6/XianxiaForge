/**
 * 自定义武器路由 - 3步点选+随机创建，CRUD + 随机引擎 + 命名模块
 * 挂载前缀由 index.ts 添加：/api
 * 路径：/projects/:id/custom-weapons...
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { creativeDb, zhuxianDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import * as zhuxianSchema from '../db/zhuxian-schema.js';
import { randomWeapon, applyAutoDisguise, batchStreetWeapons, type WeaponLock } from '../services/weapon-random.js';
import { namingAgent } from '../agents/naming.js';
import { weaponLoreAgent } from '../agents/weapon-lore.js';
import { weaponSenseCardAgent, type SenseCardInput } from '../agents/weapon-sense-card.js';
import { traitNamingAgent } from '../agents/trait-naming.js';
import { forgeSmartMatchAgent } from '../agents/forge-smart-match.js';
import { buildWeaponContext, validateWeapon } from '../services/forge-smart-match.js';
import { listProjectEntities, importFromProject } from '../services/cross-project-import.js';
import { exportWeapons, importWeapons } from '../services/module-file-io.js';
import {
  CATEGORIES, MATERIALS, FORGE_TRAITS, SOAK_TRAITS, ATTACH_TRAITS, CAVITY_TRAITS,
  SOUL_REFINE_LEVELS, GRADES, CAVITY_LIMIT,
} from '../data/weapon-catalog.js';
import {
  upgradeWeapon, evolveWeapon, mutateWeapon, fuseWeapon,
  confirmWeapon, weaponHistory, revertWeapon, recraftWeapon,
} from '../services/weapon-growth.js';
import {
  composeTraits, randomDirections, wrapClassicTraits,
  type SelectedDirections, type WeaponBase,
} from '../services/trait-composer.js';
import { TRAIT_CATEGORIES, TEMPERAMENTS, PAST_TYPES, TABOOS, getDefaultTemperament, getDefaultPastType, getDefaultTaboos } from '../data/trait-directions.js';
import { addScar, addCustomScar, removeScar, listScars, SCAR_DEFINITIONS } from '../services/weapon-scar.js';
import { scanAndCreateBonds, getWeaponBonds } from '../services/weapon-bond.js';
import { demonizeWeapon, purifyWeapon } from '../services/weapon-demonize.js';
import { computeCounter } from '../services/weapon-counter.js';
import { tryTriggerRelic } from '../services/weapon-relic.js';
import type { GeneratedTrait } from '../services/trait-composer.js';

const app = new Hono();

// ============ Zod schemas ============

const weaponFormSchema = z.object({
  name: z.string().min(1).max(32),
  category: z.string().min(1),
  type: z.string().min(1),
  grade: z.string().default('凡造'),
  fakeGrade: z.string().nullable().optional(),
  baseMaterial: z.string().min(1),
  forgeTraits: z.array(z.string()).default([]),
  soakTraits: z.array(z.string()).default([]),
  attachTraits: z.array(z.string()).default([]),
  cavityTraits: z.array(z.string()).default([]),
  soulRefineLevel: z.string().default('none'),
  coreDirection: z.array(z.string()).default([]),
  linkedCharacterIds: z.array(z.number()).default([]),
  // 方向组合式特质系统（7.30）
  selectedDirections: z.any().optional(),
  generatedTraits: z.any().optional(),
  temperament: z.string().optional(),
  pastType: z.string().optional(),
  taboos: z.array(z.string()).optional(),
  reverseMode: z.boolean().optional(),
});

// ============ 1. 列表 ============

/** GET /projects/:id/custom-weapons - 项目下所有未删除自定义武器（支持 ?entityStatus=official|draft 筛选） */
app.get('/projects/:id/custom-weapons', async (c) => {
  const projectId = Number(c.req.param('id'));
  const statusFilter = c.req.query('entityStatus');
  const conds = [
    eq(schema.customWeapon.projectId, projectId),
    eq(schema.customWeapon.isDeleted, false),
  ];
  if (statusFilter === 'draft' || statusFilter === 'official') {
    conds.push(eq(schema.customWeapon.entityStatus, statusFilter));
  }
  const rows = await creativeDb
    .select()
    .from(schema.customWeapon)
    .where(and(...conds))
    .orderBy(desc(schema.customWeapon.createdAt));
  return c.json({ success: true, data: rows });
});

// ============ 1b. 词条配置库（前端点选数据，须先于 /:wid 注册） ============

/** GET /projects/:id/custom-weapons/catalog - 门类/形制/材质/特质/祭炼/品级配置 + 方向组合系统 */
app.get('/projects/:id/custom-weapons/catalog', async (c) => {
  return c.json({
    success: true,
    data: {
      categories: CATEGORIES,
      materials: MATERIALS,
      forgeTraits: FORGE_TRAITS,
      soakTraits: SOAK_TRAITS,
      attachTraits: ATTACH_TRAITS,
      cavityTraits: CAVITY_TRAITS,
      soulRefineLevels: SOUL_REFINE_LEVELS,
      grades: GRADES,
      cavityLimit: CAVITY_LIMIT,
      // 方向组合式特质系统（7.30）
      traitDirections: TRAIT_CATEGORIES,
      temperaments: TEMPERAMENTS,
      pastTypes: PAST_TYPES,
      taboos: TABOOS,
    },
  });
});

// ============ 2. 详情 ============

/** GET /projects/:id/custom-weapons/:wid - 单把武器详情 */
app.get('/projects/:id/custom-weapons/:wid', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const [row] = await creativeDb
    .select()
    .from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.id, wid), eq(schema.customWeapon.projectId, projectId)));
  if (!row) return c.json({ success: false, error: '武器不存在' }, 404);
  return c.json({ success: true, data: row });
});

// ============ 3. 随机（确定性，零 token） ============

const randomSchema = z.object({
  base: z.any().optional(),
  locked: z.any().optional(),
  // 方向组合式特质系统扩展
  directions: z.any().optional(),
  temperament: z.string().optional(),
  pastType: z.string().optional(),
  taboos: z.array(z.string()).optional(),
  reverseMode: z.boolean().optional(),
  // S级：路边摊批量 + 自动伪装
  batch: z.number().int().min(1).max(50).optional(),
  junkRatio: z.number().min(0).max(1).optional(),
  autoDisguise: z.boolean().optional(),
});

/** POST /projects/:id/custom-weapons/random - 骰子随机完整武器（锁定字段保留）+ 方向组合特质 + 批量路边摊 */
app.post('/projects/:id/custom-weapons/random', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = randomSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);
  const { batch, junkRatio, autoDisguise } = parsed.data;

  // ---- 批量路边摊模式 ----
  if (batch && batch > 1) {
    const items = batchStreetWeapons({ batch, junkRatio });
    const results = items.map((item) => {
      const weaponBase: WeaponBase = {
        category: item.category, type: item.type, grade: item.grade,
        baseMaterial: item.baseMaterial,
      };
      // junk 档强制注入「做旧埋锈」方向
      const directions: SelectedDirections = randomDirections(weaponBase);
      if (item.tierLabel === 'junk' && directions.forge) {
        if (!directions.forge.includes('forge.texture.rust_hide')) {
          directions.forge.push('forge.texture.rust_hide');
        }
      }
      const composed = composeTraits(directions, weaponBase);
      return {
        ...item,
        selectedDirections: directions,
        generatedTraits: composed.traits,
        stackInfo: { count: composed.stackCount, label: composed.stackLabel, rareProb: composed.rareProb, flawProb: composed.flawProb },
      };
    });
    return c.json({ success: true, data: results, batch: true });
  }

  // ---- 单把随机模式 ----
  let draft = randomWeapon(parsed.data.base, parsed.data.locked as WeaponLock | undefined);

  // 歪嘴龙王自动伪装（默认开启，autoDisguise=false 可关闭）
  if (autoDisguise !== false) {
    draft = applyAutoDisguise(draft);
  }

  // 诛仙遗珍彩蛋（0.1%概率，覆盖普通结果）
  const relicRoll = tryTriggerRelic();
  if (relicRoll.triggered && relicRoll.draft && relicRoll.traits) {
    return c.json({
      success: true,
      data: {
        ...relicRoll.draft,
        generatedTraits: relicRoll.traits,
        selectedDirections: {},
        stackInfo: { count: relicRoll.traits.length, label: '遗珍', rareProb: 1, flawProb: 0 },
        easterEgg: { vaguePast: relicRoll.relic!.vaguePast, unlockHint: relicRoll.relic!.unlockHint },
      },
    });
  }

  // 方向组合特质生成
  const weaponBase: WeaponBase = {
    category: draft.category, type: draft.type, grade: draft.grade,
    baseMaterial: draft.baseMaterial,
  };
  const directions: SelectedDirections = parsed.data.directions ?? randomDirections(weaponBase);
  const composed = composeTraits(directions, weaponBase);

  return c.json({
    success: true,
    data: {
      ...draft,
      selectedDirections: directions,
      generatedTraits: composed.traits,
      temperament: parsed.data.temperament ?? undefined,
      pastType: parsed.data.pastType ?? undefined,
      taboos: parsed.data.taboos ?? [],
      reverseMode: parsed.data.reverseMode ?? false,
      stackInfo: { count: composed.stackCount, label: composed.stackLabel, rareProb: composed.rareProb, flawProb: composed.flawProb },
      disabledDirections: composed.disabledDirections,
      conflicts: composed.conflicts,
    },
  });
});

// ============ 3b. 单独生成特质（方向选完后实时预览） ============

const generateTraitsSchema = z.object({
  directions: z.any(),
  category: z.string().min(1),
  type: z.string().min(1),
  grade: z.string().default('凡造'),
  baseMaterial: z.string().min(1),
  mainDao: z.string().optional(),
});

/** POST /projects/:id/custom-weapons/generate-traits - 按方向实时预览生成特质 */
app.post('/projects/:id/custom-weapons/generate-traits', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = generateTraitsSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);
  const { directions, category, type, grade, baseMaterial, mainDao } = parsed.data;
  const weaponBase: WeaponBase = { category, type, grade, baseMaterial, mainDao };
  const result = composeTraits(directions as SelectedDirections, weaponBase);
  return c.json({ success: true, data: result });
});

// ============ 4. 随机名号（LLM 命名模块） ============

const randomNameSchema = z.object({
  category: z.string().min(1),
  type: z.string().min(1),
  grade: z.string().optional(),
  count: z.number().int().min(1).max(5).default(1),
});

/** POST /projects/:id/custom-weapons/random-name - 按门类形制生成武器名号 */
app.post('/projects/:id/custom-weapons/random-name', async (c) => {
  const body = await c.req.json();
  const parsed = randomNameSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);
  const { category, type, grade, count } = parsed.data;
  try {
    const names = await namingAgent.weaponName(category, type, grade, count);
    return c.json({ success: true, data: { names } });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || '命名失败' }, 500);
  }
});

/** POST /projects/:id/custom-weapons/smart-match - 文字描述→参数智能匹配 */
app.post('/projects/:id/custom-weapons/smart-match', async (c) => {
  try {
    const { description } = await c.req.json();
    if (typeof description !== 'string' || description.trim().length < 5) {
      return c.json({ success: false, error: '请提供至少 5 个字的描述' }, 400);
    }
    const raw = await forgeSmartMatchAgent.match('weapon', description.trim(), buildWeaponContext());
    const result = validateWeapon(raw);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 5. 创建 ============

/** POST /projects/:id/custom-weapons - 保存武器入库 */
app.post('/projects/:id/custom-weapons', async (c) => {
  const projectId = Number(c.req.param('id'));
  const body = await c.req.json();
  const parsed = weaponFormSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || '参数错误' }, 400);
  }
  const d = parsed.data;

  // 保存时批量润色特质命名（LLM，best-effort）
  let namedTraits = d.generatedTraits ?? [];
  if (Array.isArray(namedTraits) && namedTraits.length > 0) {
    try {
      const nameMap = await traitNamingAgent.nameTraits({
        weaponName: d.name,
        category: d.category,
        grade: d.grade,
        traits: namedTraits as GeneratedTrait[],
      });
      if (Object.keys(nameMap).length > 0) {
        namedTraits = (namedTraits as GeneratedTrait[]).map((t) =>
          nameMap[t.id] ? { ...t, name: nameMap[t.id] } : t
        );
      }
    } catch { /* 命名失败不阻塞保存 */ }
  }

  const [row] = await creativeDb.insert(schema.customWeapon).values({
    projectId,
    name: d.name,
    category: d.category,
    type: d.type,
    grade: d.grade,
    fakeGrade: d.fakeGrade ?? null,
    baseMaterial: d.baseMaterial,
    forgeTraits: d.forgeTraits,
    soakTraits: d.soakTraits,
    attachTraits: d.attachTraits,
    cavityTraits: d.cavityTraits,
    soulRefineLevel: d.soulRefineLevel,
    coreDirection: d.coreDirection,
    linkedCharacterIds: d.linkedCharacterIds,
    growthType: 'base',
    // 方向组合式特质系统
    selectedDirections: d.selectedDirections ?? {},
    generatedTraits: namedTraits,
    temperament: d.temperament ?? null,
    pastType: d.pastType ?? null,
    taboos: d.taboos ?? [],
    reverseMode: d.reverseMode ?? false,
  }).returning();
  return c.json({ success: true, data: row }, 201);
});

// ============ 6. 更新 ============

/** PUT /projects/:id/custom-weapons/:wid - 更新武器 */
app.put('/projects/:id/custom-weapons/:wid', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const body = await c.req.json();
  const parsed = weaponFormSchema.partial().safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);

  const patch: any = { ...parsed.data, updatedAt: new Date() };
  delete (patch as any).linkedCharacterIds;
  if (parsed.data.linkedCharacterIds) patch.linkedCharacterIds = parsed.data.linkedCharacterIds;
  // 用户编辑保存后草稿自动转正（09-自动维护 US-4）
  patch.entityStatus = 'official';

  const [row] = await creativeDb
    .update(schema.customWeapon)
    .set(patch)
    .where(and(eq(schema.customWeapon.id, wid), eq(schema.customWeapon.projectId, projectId)))
    .returning();
  if (!row) return c.json({ success: false, error: '武器不存在' }, 404);
  return c.json({ success: true, data: row });
});

// ============ 7. 软删除 ============

/** DELETE /projects/:id/custom-weapons/:wid - 软删除 */
app.delete('/projects/:id/custom-weapons/:wid', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const [row] = await creativeDb
    .update(schema.customWeapon)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(and(eq(schema.customWeapon.id, wid), eq(schema.customWeapon.projectId, projectId)))
    .returning();
  if (!row) return c.json({ success: false, error: '武器不存在' }, 404);
  return c.json({ success: true, data: { id: wid } });
});

// ============ 8. 养成：强化（原地升阶） ============

/** POST /projects/:id/custom-weapons/:wid/upgrade */
app.post('/projects/:id/custom-weapons/:wid/upgrade', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const res = await upgradeWeapon(projectId, wid);
  if (!res.success) return c.json({ success: false, error: res.error }, 400);
  return c.json({ success: true, data: res });
});

// ============ 9. 养成：进化（预览，confirm 入库） ============

/** POST /projects/:id/custom-weapons/:wid/evolution */
app.post('/projects/:id/custom-weapons/:wid/evolution', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const res = await evolveWeapon(projectId, wid);
  if (!res.success) return c.json({ success: false, error: res.error }, 400);
  return c.json({ success: true, data: res });
});

// ============ 10. 养成：变异（预览） ============

/** POST /projects/:id/custom-weapons/:wid/mutation */
app.post('/projects/:id/custom-weapons/:wid/mutation', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const res = await mutateWeapon(projectId, wid);
  if (!res.success) return c.json({ success: false, error: res.error }, 400);
  return c.json({ success: true, data: res });
});

// ============ 11. 养成：融合（预览） ============

const fuseSchema = z.object({ entityAId: z.number().int().min(1), entityBId: z.number().int().min(1) });

/** POST /projects/:id/custom-weapons/fusion */
app.post('/projects/:id/custom-weapons/fusion', async (c) => {
  const projectId = Number(c.req.param('id'));
  const body = await c.req.json();
  const parsed = fuseSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);
  const res = await fuseWeapon(projectId, parsed.data.entityAId, parsed.data.entityBId);
  if (!res.success) return c.json({ success: false, error: res.error }, 400);
  return c.json({ success: true, data: res });
});

// ============ 12. 养成：确认入库 ============

/** POST /projects/:id/custom-weapons/confirm - 把预览武器正式入库 */
app.post('/projects/:id/custom-weapons/confirm', async (c) => {
  const projectId = Number(c.req.param('id'));
  const body = await c.req.json();
  const preview = body.preview || body;
  preview.projectId = projectId;
  const row = await confirmWeapon(preview);
  return c.json({ success: true, data: row }, 201);
});

// ============ 13. 养成：历史 ============

/** GET /projects/:id/custom-weapons/:wid/history */
app.get('/projects/:id/custom-weapons/:wid/history', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const rows = await weaponHistory(projectId, wid);
  return c.json({ success: true, data: rows });
});

// ============ 14. 养成：回退 ============

/** POST /projects/:id/custom-weapons/revert/:recordId */
app.post('/projects/:id/custom-weapons/revert/:recordId', async (c) => {
  const projectId = Number(c.req.param('id'));
  const recordId = Number(c.req.param('recordId'));
  const res = await revertWeapon(projectId, recordId);
  if (!res.success) return c.json({ success: false, error: res.error }, 400);
  return c.json({ success: true, data: res.data });
});

// ============ 15. 文案生成Skill：生成武器名号/化名/简介/招式 ============

/** POST /projects/:id/custom-weapons/:wid/generate-lore - 调用文案Skill生成并入库（新版本置为当前） */
app.post('/projects/:id/custom-weapons/:wid/generate-lore', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const [weapon] = await creativeDb
    .select()
    .from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.id, wid), eq(schema.customWeapon.projectId, projectId)));
  if (!weapon) return c.json({ success: false, error: '武器不存在' }, 404);

  try {
    const lore = await weaponLoreAgent.generateLore({
      category: weapon.category,
      type: weapon.type,
      grade: weapon.grade,
      fakeGrade: weapon.fakeGrade,
      baseMaterial: weapon.baseMaterial,
      forgeTraits: (weapon.forgeTraits || []) as string[],
      soakTraits: (weapon.soakTraits || []) as string[],
      attachTraits: (weapon.attachTraits || []) as string[],
      cavityTraits: (weapon.cavityTraits || []) as string[],
      soulRefineLevel: weapon.soulRefineLevel,
      coreDirection: (weapon.coreDirection || []) as string[],
      generatedTraits: (weapon.generatedTraits || []) as any[],
    });

    const [row] = await creativeDb.transaction(async (tx) => {
      await tx
        .update(schema.weaponLore)
        .set({ isCurrent: false, updatedAt: new Date() })
        .where(and(eq(schema.weaponLore.weaponId, wid), eq(schema.weaponLore.isCurrent, true)));
      return tx
        .insert(schema.weaponLore)
        .values({
          projectId,
          weaponId: wid,
          name: lore.name,
          fakeName: lore.fakeName ?? null,
          intro: lore.intro,
          moves: lore.moves,
          isCurrent: true,
        })
        .returning();
    });

    return c.json({ success: true, data: row }, 201);
  } catch (e: any) {
    return c.json({ success: false, error: e.message || '文案生成失败' }, 500);
  }
});

/** GET /projects/:id/custom-weapons/:wid/lore - 获取武器文案（当前版本 + 历史版本） */
app.get('/projects/:id/custom-weapons/:wid/lore', async (c) => {
  const wid = Number(c.req.param('wid'));
  const rows = await creativeDb
    .select()
    .from(schema.weaponLore)
    .where(eq(schema.weaponLore.weaponId, wid))
    .orderBy(desc(schema.weaponLore.createdAt));
  const current = rows.find((r) => r.isCurrent) || rows[0] || null;
  return c.json({ success: true, data: { current, history: rows } });
});

/** POST /projects/:id/custom-weapons/lore/:loreId/set-current - 切换生效文案版本 */
app.post('/projects/:id/custom-weapons/lore/:loreId/set-current', async (c) => {
  const projectId = Number(c.req.param('id'));
  const loreId = Number(c.req.param('loreId'));
  const [target] = await creativeDb
    .select()
    .from(schema.weaponLore)
    .where(and(eq(schema.weaponLore.id, loreId), eq(schema.weaponLore.projectId, projectId)));
  if (!target) return c.json({ success: false, error: '文案不存在' }, 404);

  await creativeDb.transaction(async (tx) => {
    await tx
      .update(schema.weaponLore)
      .set({ isCurrent: false, updatedAt: new Date() })
      .where(eq(schema.weaponLore.weaponId, target.weaponId));
    await tx
      .update(schema.weaponLore)
      .set({ isCurrent: true, updatedAt: new Date() })
      .where(eq(schema.weaponLore.id, loreId));
  });
  return c.json({ success: true, data: { id: loreId } });
});

// ============ 16. 五感兵器卡生成（LLM） ============

const senseCardSchema = z.object({
  module: z.string().optional(),
  temperament: z.string().optional(),
  pastType: z.string().optional(),
  taboos: z.array(z.string()).optional(),
  reverseMode: z.boolean().optional(),
});

/** POST /projects/:id/custom-weapons/:wid/generate-sense-card - 生成/重生成五感兵器卡 */
app.post('/projects/:id/custom-weapons/:wid/generate-sense-card', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const body = await c.req.json().catch(() => ({}));
  const parsed = senseCardSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误' }, 400);

  const [weapon] = await creativeDb
    .select()
    .from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.id, wid), eq(schema.customWeapon.projectId, projectId)));
  if (!weapon) return c.json({ success: false, error: '武器不存在' }, 404);

  // 组装特质列表：优先 generatedTraits，否则包装旧四列
  const traits = ((weapon.generatedTraits as any[])?.length
    ? weapon.generatedTraits
    : wrapClassicTraits(
        (weapon.forgeTraits || []) as string[],
        (weapon.soakTraits || []) as string[],
        (weapon.attachTraits || []) as string[],
        (weapon.cavityTraits || []) as string[],
      )) as any[];

  const input: SenseCardInput = {
    weaponName: weapon.name,
    category: weapon.category,
    type: weapon.type,
    grade: weapon.grade,
    baseMaterial: weapon.baseMaterial,
    traits,
    temperament: parsed.data.temperament ?? weapon.temperament ?? getDefaultTemperament(weapon.category, weapon.type),
    pastType: parsed.data.pastType ?? weapon.pastType ?? getDefaultPastType(weapon.grade, weapon.category),
    taboos: parsed.data.taboos ?? (weapon.taboos as string[]) ?? getDefaultTaboos(parsed.data.temperament ?? weapon.temperament ?? ''),
    reverseMode: parsed.data.reverseMode ?? weapon.reverseMode ?? false,
  };

  try {
    const result = await weaponSenseCardAgent.generate(input, { module: parsed.data.module });

    // 查找当前生效 lore 行
    const [currentLore] = await creativeDb
      .select()
      .from(schema.weaponLore)
      .where(and(eq(schema.weaponLore.weaponId, wid), eq(schema.weaponLore.isCurrent, true)));

    if (currentLore) {
      // 更新已有 lore 行的五感卡字段
      const patch: any = { updatedAt: new Date() };
      if (result.realSkill !== undefined) patch.realSkill = result.realSkill;
      if (result.weirdTrait !== undefined) patch.weirdTrait = result.weirdTrait;
      if (result.pastMemory !== undefined) patch.pastMemory = result.pastMemory;
      if (result.jianghuNickname !== undefined) patch.jianghuNickname = result.jianghuNickname;
      if (result.jianghuHeihua !== undefined) patch.jianghuHeihua = result.jianghuHeihua;
      if (result.rules !== undefined) patch.rules = result.rules;
      if (result.hooks !== undefined) patch.hooks = result.hooks;
      if (result.famousScenes !== undefined) patch.famousScenes = result.famousScenes;
      if (result.spirit !== undefined) patch.spirit = result.spirit;
      const [updated] = await creativeDb
        .update(schema.weaponLore)
        .set(patch)
        .where(eq(schema.weaponLore.id, currentLore.id))
        .returning();
      // best-effort 同步钩子到伏笔台账（仅全量生成时）
      if (!parsed.data.module && result.hooks?.length) {
        await syncHooksToForeshadow(projectId, wid, weapon.name, result.hooks);
      }
      return c.json({ success: true, data: updated });
    } else {
      // 无 lore 行则新建
      const [row] = await creativeDb
        .insert(schema.weaponLore)
        .values({
          projectId,
          weaponId: wid,
          name: weapon.name,
          intro: '',
          moves: [],
          isCurrent: true,
          realSkill: result.realSkill ?? '',
          weirdTrait: result.weirdTrait ?? '',
          pastMemory: result.pastMemory ?? '',
          jianghuNickname: result.jianghuNickname ?? '',
          jianghuHeihua: result.jianghuHeihua ?? '',
          rules: result.rules ?? '',
          hooks: result.hooks ?? [],
          famousScenes: result.famousScenes ?? [],
          spirit: result.spirit ?? '',
        })
        .returning();
      if (result.hooks?.length) {
        await syncHooksToForeshadow(projectId, wid, weapon.name, result.hooks);
      }
      return c.json({ success: true, data: row }, 201);
    }
  } catch (e: any) {
    return c.json({ success: false, error: e.message || '五感卡生成失败' }, 500);
  }
});

/** 将剧情钩子同步到伏笔台账（best-effort，失败不影响主流程） */
async function syncHooksToForeshadow(
  projectId: number,
  weaponId: number,
  weaponName: string,
  hooks: Array<{ type: string; title: string; content: string }>,
) {
  try {
    const typeLabel: Record<string, string> = { seek: '寻亲', eerie: '灵异', conflict: '风波' };
    for (const h of hooks) {
      if (!h.content) continue;
      await creativeDb.insert(schema.foreshadowThread).values({
        projectId,
        title: `【${weaponName}·${typeLabel[h.type] ?? h.type}】${h.title || h.content.slice(0, 20)}`,
        description: h.content,
        status: 'pending',
        priority: 'normal',
        tier: 't3',
        sourceType: 'manual',
        isConfirmed: true,
        dnaSubject: weaponName,
        dnaAction: '钩子',
        dnaEmotion: '悬念',
      });
    }
  } catch {
    // best-effort，不阻断主流程
  }
}

// ============ 17. 老武器补全五感卡（兼容旧数据） ============

/** POST /projects/:id/custom-weapons/:wid/complete-sense-card - 为旧武器补全五感卡 */
app.post('/projects/:id/custom-weapons/:wid/complete-sense-card', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));

  const [weapon] = await creativeDb
    .select()
    .from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.id, wid), eq(schema.customWeapon.projectId, projectId)));
  if (!weapon) return c.json({ success: false, error: '武器不存在' }, 404);

  // 包装旧四列特质
  const traits = wrapClassicTraits(
    (weapon.forgeTraits || []) as string[],
    (weapon.soakTraits || []) as string[],
    (weapon.attachTraits || []) as string[],
    (weapon.cavityTraits || []) as string[],
  );

  const temperament = weapon.temperament ?? getDefaultTemperament(weapon.category, weapon.type);
  const pastType = weapon.pastType ?? getDefaultPastType(weapon.grade, weapon.category);
  const taboos = (weapon.taboos as string[])?.length ? weapon.taboos as string[] : getDefaultTaboos(temperament);

  try {
    const result = await weaponSenseCardAgent.generate({
      weaponName: weapon.name,
      category: weapon.category,
      type: weapon.type,
      grade: weapon.grade,
      baseMaterial: weapon.baseMaterial,
      traits,
      temperament,
      pastType,
      taboos,
      reverseMode: weapon.reverseMode ?? false,
    });

    // 同时更新武器行的控制项默认值
    await creativeDb
      .update(schema.customWeapon)
      .set({ temperament, pastType, taboos, updatedAt: new Date() })
      .where(eq(schema.customWeapon.id, wid));

    // 查找或创建 lore 行
    const [currentLore] = await creativeDb
      .select()
      .from(schema.weaponLore)
      .where(and(eq(schema.weaponLore.weaponId, wid), eq(schema.weaponLore.isCurrent, true)));

    if (currentLore) {
      const [updated] = await creativeDb
        .update(schema.weaponLore)
        .set({
          realSkill: result.realSkill ?? '',
          weirdTrait: result.weirdTrait ?? '',
          pastMemory: result.pastMemory ?? '',
          jianghuNickname: result.jianghuNickname ?? '',
          jianghuHeihua: result.jianghuHeihua ?? '',
          rules: result.rules ?? '',
          hooks: result.hooks ?? [],
          famousScenes: result.famousScenes ?? [],
          spirit: result.spirit ?? '',
          updatedAt: new Date(),
        })
        .where(eq(schema.weaponLore.id, currentLore.id))
        .returning();
      if (result.hooks?.length) await syncHooksToForeshadow(projectId, wid, weapon.name, result.hooks);
      return c.json({ success: true, data: updated });
    } else {
      const [row] = await creativeDb
        .insert(schema.weaponLore)
        .values({
          projectId, weaponId: wid, name: weapon.name, intro: '', moves: [], isCurrent: true,
          realSkill: result.realSkill ?? '',
          weirdTrait: result.weirdTrait ?? '',
          pastMemory: result.pastMemory ?? '',
          jianghuNickname: result.jianghuNickname ?? '',
          jianghuHeihua: result.jianghuHeihua ?? '',
          rules: result.rules ?? '',
          hooks: result.hooks ?? [],
          famousScenes: result.famousScenes ?? [],
          spirit: result.spirit ?? '',
        })
        .returning();
      if (result.hooks?.length) await syncHooksToForeshadow(projectId, wid, weapon.name, result.hooks);
      return c.json({ success: true, data: row }, 201);
    }
  } catch (e: any) {
    return c.json({ success: false, error: e.message || '五感卡补全失败' }, 500);
  }
});

// ============ 18. 烙印系统（PRD§3.1） ============

/** GET /projects/:id/custom-weapons/scars/definitions - 烙印定义列表 */
app.get('/projects/:id/custom-weapons/scars/definitions', (c) => {
  return c.json({ success: true, data: SCAR_DEFINITIONS });
});

/** GET /projects/:id/custom-weapons/:wid/scars - 武器烙印列表 */
app.get('/projects/:id/custom-weapons/:wid/scars', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const scars = await listScars(projectId, wid);
  return c.json({ success: true, data: scars });
});

/** POST /projects/:id/custom-weapons/:wid/scars - 添加烙印 */
app.post('/projects/:id/custom-weapons/:wid/scars', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const body = await c.req.json().catch(() => ({}));
  // 支持预定义烙印（scarDefId）或自定义烙印（name+desc+flaw）
  if (body.scarDefId) {
    const res = await addScar(projectId, wid, body.scarDefId);
    return c.json(res, res.success ? 200 : 400);
  }
  if (body.name && body.desc) {
    const res = await addCustomScar(projectId, wid, body.name, body.desc, body.flaw);
    return c.json(res, res.success ? 201 : 400);
  }
  return c.json({ success: false, error: '需要 scarDefId 或 name+desc' }, 400);
});

/** DELETE /projects/:id/custom-weapons/:wid/scars/:traitId - 删除烙印 */
app.delete('/projects/:id/custom-weapons/:wid/scars/:traitId', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const traitId = c.req.param('traitId');
  const res = await removeScar(projectId, wid, traitId);
  return c.json(res, res.success ? 200 : 404);
});

// ============ 19. 因果羁绊（PRD§3.2） ============

/** POST /projects/:id/custom-weapons/bonds/scan - 扫描并自动生成羁绊 */
app.post('/projects/:id/custom-weapons/bonds/scan', async (c) => {
  const projectId = Number(c.req.param('id'));
  const results = await scanAndCreateBonds(projectId);
  return c.json({ success: true, data: results, count: results.length });
});

/** GET /projects/:id/custom-weapons/:wid/bonds - 武器羁绊列表 */
app.get('/projects/:id/custom-weapons/:wid/bonds', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const bonds = await getWeaponBonds(projectId, wid);
  return c.json({ success: true, data: bonds });
});

// ============ 20. 武器重铸（PRD§3.5） ============

const recraftSchema = z.object({
  keepTraitIds: z.array(z.string()).min(0),
});

/** POST /projects/:id/custom-weapons/:wid/recraft - 重铸（保留选中特质） */
app.post('/projects/:id/custom-weapons/:wid/recraft', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const body = await c.req.json().catch(() => ({}));
  const parsed = recraftSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '参数错误：需要 keepTraitIds 数组' }, 400);
  const res = await recraftWeapon(projectId, wid, parsed.data.keepTraitIds);
  return c.json(res, res.success ? 200 : 400);
});

// ============ 21. 套装道号生成（PRD§3.3） ============

/** POST /projects/:id/custom-weapons/:wid/dao-title - 生成套装道号+大招 */
app.post('/projects/:id/custom-weapons/:wid/dao-title', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const body = await c.req.json().catch(() => ({}));
  const charId = body.charId as number;
  if (!charId) return c.json({ success: false, error: '需要 charId' }, 400);

  // 读取武器+人物+五感卡
  const [weapon] = await creativeDb.select().from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.id, wid), eq(schema.customWeapon.projectId, projectId)));
  const [char] = await creativeDb.select().from(schema.customCharacter)
    .where(and(eq(schema.customCharacter.id, charId), eq(schema.customCharacter.projectId, projectId)));
  if (!weapon || !char) return c.json({ success: false, error: '武器或人物不存在' }, 404);

  const [lore] = await creativeDb.select().from(schema.weaponLore)
    .where(and(eq(schema.weaponLore.weaponId, wid), eq(schema.weaponLore.projectId, projectId), eq(schema.weaponLore.isCurrent, true)));

  // 调用 LLM 生成道号+大招（温度0.4，短文本）
  const { chatCompletion } = await import('../llm/client.js');
  const traits = ((weapon.generatedTraits as any[]) || []).map((t: any) => t.name).join('、');
  const prompt = `基于以下设定，生成一个套装道号（2-4字）和一个大招名+效果描述（50字内）。
人物：${char.name}，性格${char.innerPersonality}
武器：${weapon.name}，器性${lore?.jianghuNickname || '未知'}，特质：${traits || '无'}
要求：道号结合武器外号/器性元素，大招结合武器核心特质。直接输出JSON：{"daoTitle":"...","comboAbility":"..."}`;

  try {
    const text = await chatCompletion([
      { role: 'system', content: '你是仙侠设定生成器，输出纯JSON，无解释。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.4, maxTokens: 200 });
    const parsed = JSON.parse(text.replace(/```json?|```/g, '').trim());
    const daoTitle = parsed.daoTitle || '';
    const comboAbility = parsed.comboAbility || '';

    // 写入人物表
    await creativeDb.update(schema.customCharacter)
      .set({ daoTitle, comboAbility, updatedAt: new Date() } as any)
      .where(eq(schema.customCharacter.id, charId));

    return c.json({ success: true, data: { daoTitle, comboAbility } });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || '道号生成失败' }, 500);
  }
});

// ============ 22. 走火入魔魔改/净化（PRD§4.1） ============

/** POST /projects/:id/custom-weapons/:wid/demonize - 魔改武器 */
app.post('/projects/:id/custom-weapons/:wid/demonize', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const res = await demonizeWeapon(projectId, wid);
  return c.json(res, res.success ? 200 : 400);
});

/** POST /projects/:id/custom-weapons/:wid/purify - 净化武器 */
app.post('/projects/:id/custom-weapons/:wid/purify', async (c) => {
  const projectId = Number(c.req.param('id'));
  const wid = Number(c.req.param('wid'));
  const res = await purifyWeapon(projectId, wid);
  return c.json(res, res.success ? 200 : 400);
});

// ============ 23. 天命克制计算（PRD§4.3） ============

const counterSchema = z.object({
  weaponAId: z.number(),
  weaponBId: z.number(),
});

/** POST /projects/:id/custom-weapons/counter - 计算两武器克制关系 */
app.post('/projects/:id/custom-weapons/counter', async (c) => {
  const projectId = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const parsed = counterSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: '需要 weaponAId + weaponBId' }, 400);

  const [wA, wB] = await Promise.all([
    creativeDb.select({ generatedTraits: schema.customWeapon.generatedTraits, name: schema.customWeapon.name })
      .from(schema.customWeapon)
      .where(and(eq(schema.customWeapon.id, parsed.data.weaponAId), eq(schema.customWeapon.projectId, projectId))),
    creativeDb.select({ generatedTraits: schema.customWeapon.generatedTraits, name: schema.customWeapon.name })
      .from(schema.customWeapon)
      .where(and(eq(schema.customWeapon.id, parsed.data.weaponBId), eq(schema.customWeapon.projectId, projectId))),
  ]);

  if (!wA[0] || !wB[0]) return c.json({ success: false, error: '武器不存在' }, 404);

  const result = computeCounter(
    (wA[0].generatedTraits as GeneratedTrait[]) || [],
    (wB[0].generatedTraits as GeneratedTrait[]) || [],
  );

  return c.json({
    success: true,
    data: {
      weaponA: wA[0].name,
      weaponB: wB[0].name,
      ...result,
    },
  });
});

// ============ 24. 老数据自动迁移（PRD§七） ============

/** POST /projects/:id/custom-weapons/migrate - 批量补全五感卡（后台fire-and-forget） */
app.post('/projects/:id/custom-weapons/migrate', async (c) => {
  const projectId = Number(c.req.param('id'));

  // 找出所有没有五感卡的武器
  const weapons = await creativeDb.select({ id: schema.customWeapon.id, name: schema.customWeapon.name })
    .from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.projectId, projectId), eq(schema.customWeapon.isDeleted, false)));

  let needMigrate = 0;
  for (const w of weapons) {
    const [lore] = await creativeDb.select({ id: schema.weaponLore.id })
      .from(schema.weaponLore)
      .where(and(eq(schema.weaponLore.weaponId, w.id), eq(schema.weaponLore.projectId, projectId), eq(schema.weaponLore.isCurrent, true)));
    if (!lore) needMigrate++;
  }

  if (needMigrate === 0) return c.json({ success: true, message: '所有武器已有五感卡，无需迁移', migrated: 0 });

  // 后台逐个补全（不阻塞响应）
  const { refreshWeaponLore } = await import('../services/weapon-refresh.js');
  for (const w of weapons) {
    const [lore] = await creativeDb.select({ id: schema.weaponLore.id })
      .from(schema.weaponLore)
      .where(and(eq(schema.weaponLore.weaponId, w.id), eq(schema.weaponLore.projectId, projectId), eq(schema.weaponLore.isCurrent, true)));
    if (!lore) {
      refreshWeaponLore(projectId, w.id, { module: 'migrate' }).catch(() => {});
    }
  }

  return c.json({ success: true, message: `已启动${needMigrate}把武器的五感卡补全（后台执行）`, migrated: needMigrate });
});

// ============ 25. 从诛仙库导入法宝 ============

const importWeaponSchema = z.object({ worldItemId: z.number() });

function mapGradeToTier(grade: string | null): string {
  if (!grade) return '宝胎';
  if (grade.includes('凡')) return '凡造';
  if (grade.includes('灵')) return '灵淬';
  if (grade.includes('宝')) return '宝胎';
  if (grade.includes('道') || grade.includes('仙')) return '道纹';
  if (grade.includes('神')) return '神蕴';
  return '宝胎';
}

function mapSystemToCategory(system: string | null): string {
  if (!system) return 'martial';
  if (system.includes('剑')) return 'martial';
  if (system.includes('道') || system.includes('法')) return 'taoist';
  if (system.includes('魔')) return 'demonic';
  if (system.includes('奇')) return 'strange';
  return 'martial';
}

/** POST /projects/:id/custom-weapons/import - 从诛仙库导入法宝快照 */
app.post('/projects/:id/custom-weapons/import', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const parsed = importWeaponSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const { worldItemId } = parsed.data;

    // 1. 从诛仙库读取源法宝
    const [src] = await zhuxianDb
      .select()
      .from(zhuxianSchema.novelMagicItemLib)
      .where(eq(zhuxianSchema.novelMagicItemLib.id, worldItemId));
    if (!src) return c.json({ success: false, error: '诛仙库中未找到该法宝' }, 404);

    // 2. 字段映射
    const grade = mapGradeToTier(src.grade);
    const category = mapSystemToCategory(src.system);
    const coreDirection = src.coreAbilities
      ? src.coreAbilities.split(/[，、]/).map((s) => s.trim()).filter(Boolean)
      : [];
    const taboos = src.useLimit ? [src.useLimit] : [];

    // 3. 插入 creativeDb
    const [row] = await creativeDb
      .insert(schema.customWeapon)
      .values({
        projectId,
        name: src.name,
        category,
        type: 'sword',
        grade,
        gradeLevel: 1,
        baseMaterial: '玄铁',
        forgeTraits: [],
        soakTraits: [],
        attachTraits: [],
        cavityTraits: [],
        soulRefineLevel: 'none',
        coreDirection,
        taboos,
        growthType: 'base',
        generatedTraits: [],
        sourceRef: { type: 'world_item', id: worldItemId, name: src.name, bookId: src.bookId ?? null },
      })
      .returning();

    // 4. fire-and-forget：后台刷新五感卡
    const { refreshWeaponLore } = await import('../services/weapon-refresh.js');
    refreshWeaponLore(projectId, row.id, { module: 'import' }).catch(() => {});

    return c.json({ success: true, data: row }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:id/custom-weapons/import/sources?sourceProjectId= - 源项目可引入法宝清单 */
app.get('/projects/:id/custom-weapons/import/sources', async (c) => {
  try {
    const sourceProjectId = Number(c.req.query('sourceProjectId'));
    if (isNaN(sourceProjectId)) return c.json({ success: false, error: '无效的源项目ID' }, 400);
    const data = await listProjectEntities(schema.customWeapon, sourceProjectId);
    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

const importFromProjectWeaponSchema = z.object({
  sourceProjectId: z.number(),
  ids: z.array(z.number()).min(1),
  skipDuplicates: z.boolean().optional(),
});

/** POST /api/projects/:id/custom-weapons/import-from-project - 从其他项目引入法宝 */
app.post('/projects/:id/custom-weapons/import-from-project', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const parsed = importFromProjectWeaponSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const result = await importFromProject({
      table: schema.customWeapon,
      sourceProjectId: parsed.data.sourceProjectId,
      targetProjectId: projectId,
      ids: parsed.data.ids,
      skipDuplicates: parsed.data.skipDuplicates,
      sourceRefType: 'project_weapon',
    });
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================
// 文件导出/导入（14-SRS US-24）
// ============================================================

const fileExportWeaponSchema = z.object({ ids: z.array(z.number()).min(1) });

/** POST /api/projects/:id/custom-weapons/export - 导出法宝（含 weapon_lore）为 JSON items */
app.post('/projects/:id/custom-weapons/export', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const parsed = fileExportWeaponSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    const items = await exportWeapons(projectId, parsed.data.ids);
    return c.json({ success: true, data: { items } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

const fileImportWeaponSchema = z.object({
  items: z.array(z.any()).min(1),
  conflictStrategy: z.enum(['skip', 'overwrite']).default('skip'),
});

/** POST /api/projects/:id/custom-weapons/import-file - 从 JSON 文件导入法宝 */
app.post('/projects/:id/custom-weapons/import-file', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const parsed = fileImportWeaponSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    const result = await importWeapons(projectId, parsed.data.items, parsed.data.conflictStrategy);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
