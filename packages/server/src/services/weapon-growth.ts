/**
 * 武器养成服务 - 让自定义武器接入成长工坊框架（融合/变异/强化/进化）
 * 设计：品级数学与校验复用 growth.ts；叙事走 GrowthAgent（best-effort，失败不阻断确定性升阶）；
 * 特质结构走确定性合并/保留（不做脆弱的 LLM→词条ID 映射）；全程写入 entity_growth_record 留痕可回退。
 * entity_type 固定为 'weapon'，与 skill/magic_item 共用记录表与血缘树。
 */
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { growthAgent, gradeIndex, nextGrade, type GrowthEntity } from '../agents/growth.js';
import { getTrait, getForm, SOAK_TRAITS, FORGE_TRAITS } from '../data/weapon-catalog.js';
import { refreshWeaponLore } from './weapon-refresh.js';

type WeaponRow = typeof schema.customWeapon.$inferSelect;

/** 把武器行适配成 GrowthEntity（供 GrowthAgent 读取品级/叙事） */
function weaponToGrowthEntity(row: WeaponRow): GrowthEntity {
  const formInfo = getForm(row.type);
  const traitNames = [...(row.forgeTraits as string[]), ...(row.soakTraits as string[])]
    .map(id => getTrait(id)?.name).filter(Boolean).join('、');
  return {
    id: row.id,
    name: row.name,
    grade: row.grade,
    gradeLevel: row.gradeLevel,
    itemType: formInfo?.form.name || row.type,
    coreAbilities: `门类形制：${formInfo?.category.name || row.category}·${formInfo?.form.name || row.type}；核心方向：${(row.coreDirection as string[]).join('、')}；特质：${traitNames || '无'}`,
    effects: [],
    description: traitNames,
    growthType: row.growthType,
    baseEntityId: row.baseEntityId ?? undefined,
    sourceEntityIds: (row.sourceEntityIds || []) as number[],
    evolutionStage: row.evolutionStage ?? undefined,
    isEvolved: row.isEvolved,
  };
}

/** 合并两把武器的特质池（去重 + 冲突互斥），用于融合 */
function mergeTraits(aIds: string[], bIds: string[]): string[] {
  const usedTags = new Set<string>();
  const out: string[] = [];
  for (const id of [...aIds, ...bIds]) {
    if (out.includes(id)) continue;
    const t = getTrait(id);
    if (!t) { out.push(id); continue; }
    if (t.conflictTags.some(tag => usedTags.has(tag))) continue;
    out.push(id);
    t.conflictTags.forEach(tag => usedTags.add(tag));
  }
  return out;
}

async function writeRecord(
  projectId: number, entityId: number, operationType: string,
  sourceEntityIds: number[], before: any, after: any, result: string, note?: string,
) {
  return creativeDb.insert(schema.entityGrowthRecord).values({
    projectId, entityType: 'weapon', entityId, operationType,
    sourceEntityIds, beforeSnapshot: before, afterSnapshot: after,
    result, operatorNote: note,
  }).returning();
}

/** 强化：同阶升层/跨阶。品级运算是确定性数学，立即落库并返回；
 *  叙事走后台 fire-and-forget（narrateUpgrade 按既定结果生成，不阻塞响应）。 */
export async function upgradeWeapon(projectId: number, wid: number) {
  const [row] = await creativeDb.select().from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.id, wid), eq(schema.customWeapon.projectId, projectId)));
  if (!row) return { success: false, error: '武器不存在' };
  if (row.grade === '神蕴') return { success: false, error: '已达神蕴，无法强化' };

  const isCrossGrade = row.gradeLevel >= 3;
  const successRate = isCrossGrade ? 0.5 : 0.8;
  const upgraded = Math.random() < successRate;
  let newGrade = row.grade, newGradeLevel = row.gradeLevel;
  if (upgraded) {
    if (row.gradeLevel >= 3) { const ng = nextGrade(row.grade); if (ng) { newGrade = ng; newGradeLevel = 1; } }
    else newGradeLevel = row.gradeLevel + 1;
  } else if (isCrossGrade && row.gradeLevel > 1) {
    newGradeLevel = row.gradeLevel - 1;
  }

  const defaultNarrative = upgraded ? '强化成功，器身灵光更盛。' : '强化失败，器身微损。';
  const before = { grade: row.grade, gradeLevel: row.gradeLevel };

  // 确定性升阶立即落库
  await creativeDb.update(schema.customWeapon)
    .set({ grade: newGrade, gradeLevel: newGradeLevel, updatedAt: new Date() })
    .where(eq(schema.customWeapon.id, wid));
  const [rec] = await writeRecord(projectId, wid, 'upgrade', [wid], before,
    { grade: newGrade, gradeLevel: newGradeLevel }, upgraded ? 'success' : 'fail', defaultNarrative);

  // 品级变更后自动刷新五感卡（fire-and-forget，不阻断响应）
  refreshWeaponLore(projectId, wid, { module: 'upgrade' }).catch(() => {});

  // 后台补叙事：按既定结果生成，完成后回写记录（失败则保留默认文案）
  const entity = weaponToGrowthEntity(row);
  growthAgent.narrateUpgrade(entity, upgraded, newGrade, newGradeLevel)
    .then(async (narrative) => {
      if (narrative && rec?.id) {
        await creativeDb.update(schema.entityGrowthRecord)
          .set({ operatorNote: narrative })
          .where(eq(schema.entityGrowthRecord.id, rec.id));
      }
    })
    .catch(() => { /* 叙事生成失败不阻断，保留默认文案 */ });

  return { success: true, upgraded, newGrade, newGradeLevel, narrative: defaultNarrative };
}

/** 进化：道纹巅峰以上 → +1大阶终极形态，返回预览（confirm 入库），原武器保留 */
export async function evolveWeapon(projectId: number, wid: number) {
  const [row] = await creativeDb.select().from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.id, wid), eq(schema.customWeapon.projectId, projectId)));
  if (!row) return { success: false, error: '武器不存在' };
  const targetGrade = nextGrade(row.grade);
  if (!targetGrade) return { success: false, error: '已达最高底蕴，无法进化' };
  if (gradeIndex(row.grade) < 3 || row.gradeLevel < 3) {
    return { success: false, error: '进化需道纹巅峰（道纹第3层）以上武器' };
  }

  const preview: any = {
    projectId, name: `${row.name}·觉醒`, category: row.category, type: row.type,
    grade: targetGrade, gradeLevel: 1, fakeGrade: row.fakeGrade, baseMaterial: row.baseMaterial,
    forgeTraits: row.forgeTraits, soakTraits: row.soakTraits, attachTraits: row.attachTraits,
    cavityTraits: row.cavityTraits, soulRefineLevel: row.soulRefineLevel, coreDirection: row.coreDirection,
    linkedCharacterIds: row.linkedCharacterIds, growthType: 'evolution',
    baseEntityId: row.baseEntityId || row.id, sourceEntityIds: [row.id],
    evolutionStage: '觉醒', isEvolved: true,
  };

  let narrative = `器身剧震，${row.name}蜕变为${targetGrade}终极形态。`;
  let breakthroughScene: string | undefined;
  try {
    const res = await growthAgent.evolution(weaponToGrowthEntity(row));
    if (res.narrative) narrative = res.narrative;
    if (res.breakthroughScene) breakthroughScene = res.breakthroughScene;
    if (res.entity?.name) preview.name = res.entity.name;
  } catch { /* best-effort */ }
  preview.breakthroughNarrative = breakthroughScene;

  await writeRecord(projectId, wid, 'evolution', [wid], row, preview, 'success', narrative);
  return { success: true, preview, narrative, breakthroughScene, confirmed: false };
}

/** 变异：返回随机异变预览（换部分浸养特质 + 品级±1），confirm 入库 */
export async function mutateWeapon(projectId: number, wid: number) {
  const [row] = await creativeDb.select().from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.id, wid), eq(schema.customWeapon.projectId, projectId)));
  if (!row) return { success: false, error: '武器不存在' };

  // 确定性品级±1
  const idx = gradeIndex(row.grade);
  const roll = Math.random();
  let newGrade = row.grade;
  if (roll < 0.2 && idx < 5) newGrade = nextGrade(row.grade) || row.grade;
  else if (roll > 0.9 && idx > 0) newGrade = (['凡造', '灵淬', '宝胎', '道纹', '仙蜕', '神蕴'] as const)[idx - 1];

  // 确定性异变：随机替换一项浸养特质
  const soak = [...(row.soakTraits as string[])];
  if (soak.length > 0 && Math.random() < 0.6) {
    const candidate = SOAK_TRAITS.filter(t => !soak.includes(t.id));
    if (candidate.length) soak[0] = candidate[Math.floor(Math.random() * candidate.length)].id;
  }

  const preview: any = {
    projectId, name: `异变·${row.name}`, category: row.category, type: row.type,
    grade: newGrade, gradeLevel: row.gradeLevel, fakeGrade: row.fakeGrade, baseMaterial: row.baseMaterial,
    forgeTraits: row.forgeTraits, soakTraits: soak, attachTraits: row.attachTraits,
    cavityTraits: row.cavityTraits, soulRefineLevel: row.soulRefineLevel, coreDirection: row.coreDirection,
    linkedCharacterIds: row.linkedCharacterIds, growthType: 'mutation',
    baseEntityId: row.baseEntityId || row.id, sourceEntityIds: [row.id],
  };

  let narrative = `${row.name}发生异变，底蕴流转为${newGrade}。`;
  try {
    const res = await growthAgent.mutation(weaponToGrowthEntity(row));
    if (res.narrative) narrative = res.narrative;
    if (res.entity?.name) preview.name = res.entity.name;
  } catch { /* best-effort */ }

  await writeRecord(projectId, wid, 'mutation', [wid], row, preview, 'success', narrative);
  return { success: true, preview, narrative, confirmed: false };
}

/** 融合：两把武器 → 新武器预览（特质池合并 + 品级取高/+1），confirm 入库 */
export async function fuseWeapon(projectId: number, aId: number, bId: number) {
  const [a] = await creativeDb.select().from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.id, aId), eq(schema.customWeapon.projectId, projectId)));
  const [b] = await creativeDb.select().from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.id, bId), eq(schema.customWeapon.projectId, projectId)));
  if (!a || !b) return { success: false, error: '源武器不存在' };

  const higher = gradeIndex(a.grade) >= gradeIndex(b.grade) ? a : b;
  let newGrade = higher.grade;
  if (Math.random() < 0.3) newGrade = nextGrade(newGrade) || newGrade;
  if (gradeIndex(newGrade) > 4) newGrade = '仙蜕'; // 融合上限仙蜕

  const preview: any = {
    projectId, name: `${a.name}·${b.name}融合体`, category: higher.category, type: higher.type,
    grade: newGrade, gradeLevel: 1, fakeGrade: null, baseMaterial: higher.baseMaterial,
    forgeTraits: mergeTraits(a.forgeTraits as string[], b.forgeTraits as string[]).slice(0, 4),
    soakTraits: mergeTraits(a.soakTraits as string[], b.soakTraits as string[]).slice(0, 2),
    attachTraits: mergeTraits(a.attachTraits as string[], b.attachTraits as string[]).slice(0, 3),
    cavityTraits: mergeTraits(a.cavityTraits as string[], b.cavityTraits as string[]).slice(0, 4),
    soulRefineLevel: 'none', coreDirection: higher.coreDirection,
    linkedCharacterIds: [], growthType: 'fusion', sourceEntityIds: [aId, bId],
  };

  let narrative = `两器相融，${a.name}与${b.name}合为一体，底蕴${newGrade}。`;
  let breakthroughScene: string | undefined;
  try {
    const res = await growthAgent.fusion(weaponToGrowthEntity(a), weaponToGrowthEntity(b));
    if (res.narrative) narrative = res.narrative;
    if (res.breakthroughScene) breakthroughScene = res.breakthroughScene;
    if (res.entity?.name) preview.name = res.entity.name;
  } catch { /* best-effort */ }
  preview.breakthroughNarrative = breakthroughScene;

  await writeRecord(projectId, aId, 'fusion', [aId, bId], { a, b }, preview, 'success', narrative);
  return { success: true, preview, narrative, breakthroughScene, confirmed: false };
}

/** 确认入库：把预览武器正式写入 custom_weapon */
export async function confirmWeapon(preview: any) {
  const [row] = await creativeDb.insert(schema.customWeapon).values({
    projectId: preview.projectId, name: preview.name, category: preview.category, type: preview.type,
    grade: preview.grade, gradeLevel: preview.gradeLevel ?? 1, fakeGrade: preview.fakeGrade ?? null,
    baseMaterial: preview.baseMaterial, forgeTraits: preview.forgeTraits || [], soakTraits: preview.soakTraits || [],
    attachTraits: preview.attachTraits || [], cavityTraits: preview.cavityTraits || [],
    soulRefineLevel: preview.soulRefineLevel || 'none', coreDirection: preview.coreDirection || [],
    linkedCharacterIds: preview.linkedCharacterIds || [], growthType: preview.growthType || 'base',
    baseEntityId: preview.baseEntityId, sourceEntityIds: preview.sourceEntityIds || [],
    evolutionStage: preview.evolutionStage, isEvolved: preview.isEvolved || false,
    breakthroughNarrative: preview.breakthroughNarrative,
  }).returning();
  // 新武器入库后自动生成五感卡（fire-and-forget）
  if (row) refreshWeaponLore(row.projectId, row.id, { module: 'confirm' }).catch(() => {});
  return row;
}

/** 成长历史 */
export async function weaponHistory(projectId: number, wid: number) {
  return creativeDb.select().from(schema.entityGrowthRecord)
    .where(and(
      eq(schema.entityGrowthRecord.entityType, 'weapon'),
      eq(schema.entityGrowthRecord.entityId, wid),
      eq(schema.entityGrowthRecord.projectId, projectId),
    ))
    .orderBy(desc(schema.entityGrowthRecord.createdAt));
}

/** 回退到操作前快照（仅 upgrade 这类原地修改可还原 grade/gradeLevel） */
export async function revertWeapon(projectId: number, recordId: number) {
  const [rec] = await creativeDb.select().from(schema.entityGrowthRecord)
    .where(and(eq(schema.entityGrowthRecord.id, recordId), eq(schema.entityGrowthRecord.projectId, projectId)));
  if (!rec || rec.entityType !== 'weapon') return { success: false, error: '记录不存在' };
  const before = rec.beforeSnapshot as any;
  if (before && before.grade) {
    await creativeDb.update(schema.customWeapon)
      .set({ grade: before.grade, gradeLevel: before.gradeLevel ?? 1, updatedAt: new Date() })
      .where(eq(schema.customWeapon.id, rec.entityId));
  }
  return { success: true, data: { revertedTo: before } };
}

/** 重铸：保留选中特质，其余方向重新随机（PRD§3.5） */
export async function recraftWeapon(projectId: number, wid: number, keepTraitIds: string[]) {
  const [row] = await creativeDb.select().from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.id, wid), eq(schema.customWeapon.projectId, projectId)));
  if (!row) return { success: false, error: '武器不存在' };

  const oldTraits = (row.generatedTraits as any[]) || [];
  const keepSet = new Set(keepTraitIds);
  const kept = oldTraits.filter((t: any) => keepSet.has(t.id));

  // 重新随机方向并组合（排除保留特质占用的方向）
  const { randomDirections, composeTraits } = await import('./trait-composer.js');
  const weaponBase = {
    category: row.category, type: row.type, grade: row.grade, baseMaterial: row.baseMaterial,
  };
  const newDirs = randomDirections(weaponBase);
  const composed = composeTraits(newDirs, weaponBase);

  // 合并：保留 + 新生成（去重同名）
  const keptNames = new Set(kept.map((t: any) => t.name));
  const fresh = composed.traits.filter((t) => !keptNames.has(t.name));
  const merged = [...kept, ...fresh];

  const before = { generatedTraits: oldTraits };

  // 落库
  await creativeDb.update(schema.customWeapon)
    .set({ generatedTraits: merged as any, updatedAt: new Date() })
    .where(eq(schema.customWeapon.id, wid));

  await writeRecord(projectId, wid, 'recraft', [wid], before,
    { generatedTraits: merged }, 'success', `重铸完成：保留${kept.length}项，新生成${fresh.length}项`);

  // 刷新五感卡
  refreshWeaponLore(projectId, wid, { module: 'recraft' }).catch(() => {});

  return { success: true, kept: kept.length, fresh: fresh.length, traits: merged };
}
