/**
 * 四模块文件导入导出通用服务（14-SRS US-23~US-26）
 *
 * 众生百态 / 铸器天工 / 道法自然 / 山河舆图 四模块共用：
 *   - 导出：strip 系统字段 + ID→名称转换（人物关系/路径连接）+ 法宝特质 ID→名称 + 地图 bgImage 置 null
 *   - 导入：按 name 冲突检测，skip / overwrite（地图额外 merge）策略；名称→ID 反查；层级二次更新
 *
 * 复用约定：
 *   - 系统字段清洗集合 SYS_FIELDS（参考 cross-project-import.ts 的 OVERRIDDEN）
 *   - 人物 ID 负数约定：自定义人物对外为负数ID（=-dbId），诛仙库人物为全局正数ID
 *   - character_technique_variant / character_martial_lore 的 characterId 存正数内部ID（FK）
 *   - 地图层级重映射模式（参考 export.ts:506-557）：parent 置空插入 → 二次更新
 */
import { and, eq, inArray, or } from 'drizzle-orm';
import { creativeDb, zhuxianDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import * as zhuxianSchema from '../db/zhuxian-schema.js';
import { getTrait, FORGE_TRAITS, SOAK_TRAITS, ATTACH_TRAITS, CAVITY_TRAITS } from '../data/weapon-catalog.js';

export interface ExportItem {
  name: string;
  type: string;
  data: Record<string, any>;
}

export interface FileImportResult {
  imported: number;
  skipped: number;
  overwritten: number;
  merged: number;
  failed: number;
  warnings: string[];
  errors: { name: string; error: string }[];
}

export type CharConflictStrategy = 'skip' | 'overwrite';
export type MapConflictStrategy = 'skip' | 'overwrite' | 'merge';

/** 导出/导入时统一剔除的系统字段 */
const SYS_FIELDS = [
  'id', 'projectId', 'createdAt', 'updatedAt',
  'sourceRef', 'baseEntityId', 'sourceEntityIds',
  'entityStatus', 'chapterUpdates', 'isDeleted',
];

function cleanRow(row: Record<string, any>, extra: string[] = []): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SYS_FIELDS.includes(k) || extra.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function newResult(): FileImportResult {
  return { imported: 0, skipped: 0, overwritten: 0, merged: 0, failed: 0, warnings: [], errors: [] };
}

// ============================================================
// 法宝特质 ID↔名称映射（US-24）
// ============================================================

/** 特质 ID 数组 → 名称数组（未知 ID 丢弃并警告） */
function traitIdsToNames(ids: any, warn: (m: string) => void, ctx: string): string[] {
  const arr = Array.isArray(ids) ? ids : [];
  const out: string[] = [];
  for (const id of arr) {
    const t = getTrait(String(id));
    if (t) out.push(t.name);
    else warn(`${ctx}：未知特质ID ${id} 已丢弃`);
  }
  return out;
}

/** selectedDirections 叶子数组 ID→名称 / 名称→ID 双向转换 */
function mapSelectedDirections(sd: any, dir: 'toName' | 'toId', warn: (m: string) => void, ctx: string): any {
  if (!sd || typeof sd !== 'object' || Array.isArray(sd)) return sd ?? {};
  const out: Record<string, any> = {};
  for (const [group, val] of Object.entries(sd)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const inner: Record<string, any> = {};
      for (const [sub, arr] of Object.entries(val as Record<string, any>)) {
        inner[sub] = Array.isArray(arr) ? mapTraitLeaf(arr, dir, warn, ctx) : arr;
      }
      out[group] = inner;
    } else if (Array.isArray(val)) {
      out[group] = mapTraitLeaf(val, dir, warn, ctx);
    } else {
      out[group] = val;
    }
  }
  return out;
}

function mapTraitLeaf(arr: any[], dir: 'toName' | 'toId', warn: (m: string) => void, ctx: string): any[] {
  if (dir === 'toName') return traitIdsToNames(arr, warn, ctx);
  // 名称→ID（未知名称丢弃并警告）
  const out: any[] = [];
  for (const name of arr) {
    const id = resolveTraitName(String(name));
    if (id) out.push(id);
    else warn(`${ctx}：未知特质名称「${name}」已丢弃`);
  }
  return out;
}

/** 按名称反查特质ID：遍历四个特质池建立索引（一次性） */
let traitNameLookup: Map<string, string> | null = null;
function resolveTraitName(name: string): string | null {
  if (!traitNameLookup) {
    traitNameLookup = new Map();
    for (const t of [...FORGE_TRAITS, ...SOAK_TRAITS, ...ATTACH_TRAITS, ...CAVITY_TRAITS]) {
      if (!traitNameLookup.has(t.name)) traitNameLookup.set(t.name, t.id);
    }
  }
  return traitNameLookup.get(name) ?? null;
}

// ============================================================
// US-23 众生百态（人物 + 8 张关联子表）
// ============================================================

/** 导出人物：主表 + 声音/知识/记忆卡/成长阶段/状态快照/功法变种/武学档案/关系 */
export async function exportCharacters(projectId: number, ids: number[]): Promise<ExportItem[]> {
  const dbIds = ids.map((x) => Math.abs(Number(x))).filter((x) => Number.isInteger(x) && x > 0);
  if (!dbIds.length) return [];

  const chars = await creativeDb
    .select()
    .from(schema.customCharacter)
    .where(and(
      eq(schema.customCharacter.projectId, projectId),
      eq(schema.customCharacter.isDeleted, false),
      inArray(schema.customCharacter.id, dbIds),
    ));
  if (!chars.length) return [];

  const extIds = chars.map((c) => -c.id);
  const [voiceRows, knowledgeRows, memoryRows, growthRows, snapshotRows, variantRows, martialRows, relationRows] =
    await Promise.all([
      creativeDb.select().from(schema.characterVoiceConfig)
        .where(and(eq(schema.characterVoiceConfig.projectId, projectId), inArray(schema.characterVoiceConfig.characterId, extIds))),
      creativeDb.select().from(schema.characterKnowledge)
        .where(and(eq(schema.characterKnowledge.projectId, projectId), inArray(schema.characterKnowledge.characterId, extIds))),
      creativeDb.select().from(schema.characterMemoryCard)
        .where(and(eq(schema.characterMemoryCard.projectId, projectId), inArray(schema.characterMemoryCard.characterId, extIds))),
      creativeDb.select().from(schema.characterGrowthStage)
        .where(and(eq(schema.characterGrowthStage.projectId, projectId), inArray(schema.characterGrowthStage.characterId, extIds))),
      creativeDb.select().from(schema.characterStateSnapshot)
        .where(and(eq(schema.characterStateSnapshot.projectId, projectId), inArray(schema.characterStateSnapshot.characterId, extIds))),
      creativeDb.select().from(schema.characterTechniqueVariant)
        .where(and(eq(schema.characterTechniqueVariant.projectId, projectId), inArray(schema.characterTechniqueVariant.characterId, dbIds), eq(schema.characterTechniqueVariant.isDeleted, false))),
      creativeDb.select().from(schema.characterMartialLore)
        .where(and(eq(schema.characterMartialLore.projectId, projectId), inArray(schema.characterMartialLore.characterId, dbIds), eq(schema.characterMartialLore.isDeleted, false))),
      creativeDb.select().from(schema.customCharacterRelation)
        .where(and(
          eq(schema.customCharacterRelation.projectId, projectId),
          or(inArray(schema.customCharacterRelation.charAId, extIds), inArray(schema.customCharacterRelation.charBId, extIds)),
        )),
    ]);

  // ID→名称索引（负数=自定义人物，正数=诛仙库人物）
  const nameById = new Map<number, string>();
  for (const c of chars) nameById.set(-c.id, c.name);
  const posIds = new Set<number>();
  for (const r of relationRows) {
    if (r.charAId > 0) posIds.add(r.charAId);
    if (r.charBId > 0) posIds.add(r.charBId);
  }
  if (posIds.size) {
    const libChars = await zhuxianDb
      .select({ id: zhuxianSchema.novelCharacterLib.id, name: zhuxianSchema.novelCharacterLib.name })
      .from(zhuxianSchema.novelCharacterLib)
      .where(inArray(zhuxianSchema.novelCharacterLib.id, [...posIds]));
    for (const r of libChars) nameById.set(r.id, r.name);
  }
  const resolveName = (id: number | null | undefined) => (id == null ? null : nameById.get(id) ?? null);

  // 功法/武器名称索引（变种与武学档案的 ID→名称）
  const techIds = [...new Set([
    ...variantRows.map((r) => r.baseTechniqueId).filter((x): x is number => x != null),
    ...martialRows.map((r) => r.techniqueId).filter((x): x is number => x != null),
  ])];
  const weaponIds = [...new Set(martialRows.map((r) => r.weaponId).filter((x): x is number => x != null))];
  const techNameById = new Map<number, string>();
  const weaponNameById = new Map<number, string>();
  if (techIds.length) {
    const rows = await creativeDb.select({ id: schema.customTechnique.id, name: schema.customTechnique.name })
      .from(schema.customTechnique).where(inArray(schema.customTechnique.id, techIds));
    for (const r of rows) techNameById.set(r.id, r.name);
  }
  if (weaponIds.length) {
    const rows = await creativeDb.select({ id: schema.customWeapon.id, name: schema.customWeapon.name })
      .from(schema.customWeapon).where(inArray(schema.customWeapon.id, weaponIds));
    for (const r of rows) weaponNameById.set(r.id, r.name);
  }

  const items: ExportItem[] = [];
  for (const c of chars) {
    const extId = -c.id;
    const warnings: string[] = [];
    const relations = relationRows
      .filter((r) => r.charAId === extId || r.charBId === extId)
      .map((r) => ({
        ...cleanRow(r, ['charAId', 'charBId', 'weaponId']),
        charAName: resolveName(r.charAId),
        charBName: resolveName(r.charBId),
        weaponName: r.weaponId != null ? weaponNameById.get(r.weaponId) ?? null : null,
      }));
    items.push({
      name: c.name,
      type: 'character',
      data: {
        character: cleanRow(c),
        voiceConfig: voiceRows.filter((r) => r.characterId === extId).map((r) => cleanRow(r, ['characterId'])),
        knowledge: knowledgeRows.filter((r) => r.characterId === extId).map((r) => cleanRow(r, ['characterId'])),
        memoryCards: memoryRows.filter((r) => r.characterId === extId).map((r) => cleanRow(r, ['characterId'])),
        growthStages: growthRows.filter((r) => r.characterId === extId).map((r) => cleanRow(r, ['characterId'])),
        stateSnapshots: snapshotRows.filter((r) => r.characterId === extId).map((r) => cleanRow(r, ['characterId', 'taskId'])),
        variants: variantRows.filter((r) => r.characterId === c.id).map((r) => ({
          ...cleanRow(r, ['characterId', 'baseTechniqueId', 'version']),
          baseTechniqueName: r.baseTechniqueId != null ? techNameById.get(r.baseTechniqueId) ?? null : null,
        })),
        martialLore: martialRows.filter((r) => r.characterId === c.id).map((r) => ({
          ...cleanRow(r, ['characterId', 'techniqueId', 'weaponId', 'version']),
          techniqueName: r.techniqueId != null ? techNameById.get(r.techniqueId) ?? null : null,
          weaponName: r.weaponId != null ? weaponNameById.get(r.weaponId) ?? null : null,
        })),
        relations,
        warnings,
      },
    });
  }
  return items;
}

/** 导入人物文件（含 8 张关联子表）。overwrite=全量替换（删旧关联行后重新插入） */
export async function importCharacters(
  projectId: number,
  items: any[],
  strategy: CharConflictStrategy,
): Promise<FileImportResult> {
  const out = newResult();
  const relationDedup = new Set<string>();

  // 目标项目索引
  const [existChars, existTechs, existWeapons] = await Promise.all([
    creativeDb.select({ id: schema.customCharacter.id, name: schema.customCharacter.name })
      .from(schema.customCharacter)
      .where(and(eq(schema.customCharacter.projectId, projectId), eq(schema.customCharacter.isDeleted, false))),
    creativeDb.select({ id: schema.customTechnique.id, name: schema.customTechnique.name })
      .from(schema.customTechnique)
      .where(and(eq(schema.customTechnique.projectId, projectId), eq(schema.customTechnique.isDeleted, false))),
    creativeDb.select({ id: schema.customWeapon.id, name: schema.customWeapon.name })
      .from(schema.customWeapon)
      .where(and(eq(schema.customWeapon.projectId, projectId), eq(schema.customWeapon.isDeleted, false))),
  ]);
  const charByName = new Map(existChars.map((r) => [r.name, r.id]));
  const techIdByName = new Map(existTechs.map((r) => [r.name, r.id]));
  const weaponIdByName = new Map(existWeapons.map((r) => [r.name, r.id]));
  let libNameCache: Map<string, number> | null = null;

  /** 人物名 → 对外ID（自定义人物=-dbId，诛仙库人物=+id），找不到返回 null */
  const resolveCharByName = async (name: string | null | undefined): Promise<number | null> => {
    if (!name) return null;
    if (charByName.has(name)) return -charByName.get(name)!;
    if (!libNameCache) {
      libNameCache = new Map();
      const rows = await zhuxianDb
        .select({ id: zhuxianSchema.novelCharacterLib.id, name: zhuxianSchema.novelCharacterLib.name })
        .from(zhuxianSchema.novelCharacterLib);
      for (const r of rows) if (!libNameCache.has(r.name)) libNameCache.set(r.name, r.id);
    }
    return libNameCache.get(name) ?? null;
  };

  for (const item of items) {
    const data = item?.data ?? {};
    const cdata = data.character ?? {};
    const name = String(item?.name ?? cdata.name ?? '').trim();
    if (!name || !cdata.name) {
      out.failed++;
      out.errors.push({ name: name || '(未命名人物)', error: '缺少人物名称' });
      continue;
    }
    try {
      const existingId = charByName.get(name);
      if (existingId && strategy === 'skip') { out.skipped++; continue; }

      if (existingId) {
        // 全量替换：更新主表 + 删除全部旧关联行
        await creativeDb.update(schema.customCharacter)
          .set({ ...cleanRow(cdata), updatedAt: new Date() })
          .where(eq(schema.customCharacter.id, existingId));
        await Promise.all([
          creativeDb.delete(schema.characterVoiceConfig).where(eq(schema.characterVoiceConfig.characterId, -existingId)),
          creativeDb.delete(schema.characterKnowledge).where(eq(schema.characterKnowledge.characterId, -existingId)),
          creativeDb.delete(schema.characterMemoryCard).where(eq(schema.characterMemoryCard.characterId, -existingId)),
          creativeDb.delete(schema.characterGrowthStage).where(eq(schema.characterGrowthStage.characterId, -existingId)),
          creativeDb.delete(schema.characterStateSnapshot).where(eq(schema.characterStateSnapshot.characterId, -existingId)),
          creativeDb.delete(schema.characterTechniqueVariant).where(eq(schema.characterTechniqueVariant.characterId, existingId)),
          creativeDb.delete(schema.characterMartialLore).where(eq(schema.characterMartialLore.characterId, existingId)),
          creativeDb.delete(schema.customCharacterRelation).where(
            or(eq(schema.customCharacterRelation.charAId, -existingId), eq(schema.customCharacterRelation.charBId, -existingId)),
          ),
        ]);
        charByName.set(name, existingId);
      } else {
        const [row] = await creativeDb.insert(schema.customCharacter)
          .values({ ...cleanRow(cdata), projectId, isDeleted: false } as any)
          .returning();
        charByName.set(name, row.id);
        out.imported++;
      }
      const dbId = charByName.get(name)!;
      if (existingId) out.overwritten++;

      // ---- 关联子表插入 ----
      const voiceRows = (data.voiceConfig ?? []).map((r: any) => ({ ...cleanRow(r), projectId, characterId: -dbId }));
      if (voiceRows.length) await creativeDb.insert(schema.characterVoiceConfig).values(voiceRows as any);

      const knowledgeRows = (data.knowledge ?? []).map((r: any) => ({ ...cleanRow(r), projectId, characterId: -dbId }));
      if (knowledgeRows.length) await creativeDb.insert(schema.characterKnowledge).values(knowledgeRows as any);

      const memoryRows = (data.memoryCards ?? []).map((r: any) => ({ ...cleanRow(r), projectId, characterId: -dbId }));
      if (memoryRows.length) await creativeDb.insert(schema.characterMemoryCard).values(memoryRows as any);

      const growthRows = (data.growthStages ?? []).map((r: any) => ({ ...cleanRow(r, ['characterName']), projectId, characterId: -dbId, characterName: name }));
      if (growthRows.length) await creativeDb.insert(schema.characterGrowthStage).values(growthRows as any);

      const snapshotRows = (data.stateSnapshots ?? []).map((r: any) => ({ ...cleanRow(r, ['taskId']), projectId, characterId: -dbId, taskId: null }));
      if (snapshotRows.length) await creativeDb.insert(schema.characterStateSnapshot).values(snapshotRows as any);

      // 功法变种：baseTechniqueName 反查不到 → 跳过该行
      const variantRows: any[] = [];
      for (const r of data.variants ?? []) {
        const baseId = r.baseTechniqueName ? techIdByName.get(String(r.baseTechniqueName)) : null;
        if (!baseId) {
          out.warnings.push(`人物「${name}」功法变种「${r.variantName ?? ''}」：目标项目不存在功法「${r.baseTechniqueName}」，已跳过`);
          continue;
        }
        variantRows.push({ ...cleanRow(r, ['baseTechniqueName']), projectId, characterId: dbId, baseTechniqueId: baseId, isDeleted: false });
      }
      if (variantRows.length) await creativeDb.insert(schema.characterTechniqueVariant).values(variantRows as any);

      // 武学档案：technique/weapon 反查不到 → 置 null
      const martialRows: any[] = [];
      for (const r of data.martialLore ?? []) {
        const techniqueId = r.techniqueName ? techIdByName.get(String(r.techniqueName)) ?? null : null;
        const weaponId = r.weaponName ? weaponIdByName.get(String(r.weaponName)) ?? null : null;
        if (r.techniqueName && !techniqueId) out.warnings.push(`人物「${name}」武学档案：功法「${r.techniqueName}」未找到，已置空`);
        if (r.weaponName && !weaponId) out.warnings.push(`人物「${name}」武学档案：法宝「${r.weaponName}」未找到，已置空`);
        martialRows.push({ ...cleanRow(r, ['techniqueName', 'weaponName']), projectId, characterId: dbId, techniqueId, weaponId, isDeleted: false });
      }
      if (martialRows.length) await creativeDb.insert(schema.characterMartialLore).values(martialRows as any);

      // 关系：两端名称反查，任一端找不到 → 丢弃该关系
      for (const r of data.relations ?? []) {
        const key = [String(r.charAName ?? ''), String(r.charBName ?? '')].sort().join('|') + '|' + String(r.relType ?? '') + '|' + String(r.entityType ?? 'character');
        if (relationDedup.has(key)) continue;
        const [aId, bId] = await Promise.all([resolveCharByName(r.charAName), resolveCharByName(r.charBName)]);
        if (aId == null || bId == null) {
          out.warnings.push(`人物「${name}」关系「${r.charAName} ↔ ${r.charBName}」：${aId == null ? `「${r.charAName}」` : `「${r.charBName}」`}未找到，已丢弃`);
          continue;
        }
        let weaponId: number | null = null;
        if (r.entityType === 'weapon_bond' && r.weaponName) {
          weaponId = weaponIdByName.get(String(r.weaponName)) ?? null;
          if (!weaponId) {
            out.warnings.push(`人物「${name}」人兵羁绊：法宝「${r.weaponName}」未找到，已丢弃该关系`);
            continue;
          }
        }
        relationDedup.add(key);
        await creativeDb.insert(schema.customCharacterRelation).values({
          ...cleanRow(r, ['charAName', 'charBName', 'weaponName']),
          projectId, charAId: aId, charBId: bId, weaponId,
        } as any);
      }
    } catch (e: any) {
      out.failed++;
      out.errors.push({ name, error: e?.message ?? String(e) });
    }
  }
  return out;
}

// ============================================================
// US-24 铸器天工（custom_weapon + weapon_lore）
// ============================================================

export async function exportWeapons(projectId: number, ids: number[]): Promise<ExportItem[]> {
  if (!ids.length) return [];
  const weapons = await creativeDb
    .select()
    .from(schema.customWeapon)
    .where(and(
      eq(schema.customWeapon.projectId, projectId),
      eq(schema.customWeapon.isDeleted, false),
      inArray(schema.customWeapon.id, ids.map((x) => Math.abs(Number(x)))),
    ));
  if (!weapons.length) return [];
  const wIds = weapons.map((w) => w.id);
  const loreRows = await creativeDb
    .select()
    .from(schema.weaponLore)
    .where(and(inArray(schema.weaponLore.weaponId, wIds), eq(schema.weaponLore.projectId, projectId)));

  const items: ExportItem[] = [];
  for (const w of weapons) {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    const ctx = `法宝「${w.name}」`;
    items.push({
      name: w.name,
      type: 'weapon',
      data: {
        weapon: {
          ...cleanRow(w, ['linkedCharacterIds', 'forgeTraits', 'soakTraits', 'attachTraits', 'cavityTraits', 'selectedDirections']),
          linkedCharacterIds: [],
          forgeTraits: traitIdsToNames(w.forgeTraits, warn, ctx),
          soakTraits: traitIdsToNames(w.soakTraits, warn, ctx),
          attachTraits: traitIdsToNames(w.attachTraits, warn, ctx),
          cavityTraits: traitIdsToNames(w.cavityTraits, warn, ctx),
          selectedDirections: mapSelectedDirections(w.selectedDirections, 'toName', warn, ctx),
        },
        lore: loreRows.filter((l) => l.weaponId === w.id).map((l) => cleanRow(l, ['weaponId'])),
        warnings,
      },
    });
  }
  return items;
}

export async function importWeapons(
  projectId: number,
  items: any[],
  strategy: CharConflictStrategy,
): Promise<FileImportResult> {
  const out = newResult();
  const existRows = await creativeDb
    .select({ id: schema.customWeapon.id, name: schema.customWeapon.name })
    .from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.projectId, projectId), eq(schema.customWeapon.isDeleted, false)));
  const byName = new Map(existRows.map((r) => [r.name, r.id]));

  for (const item of items) {
    const data = item?.data ?? {};
    const wdata = data.weapon ?? {};
    const name = String(item?.name ?? wdata.name ?? '').trim();
    if (!name || !wdata.name) {
      out.failed++;
      out.errors.push({ name: name || '(未命名法宝)', error: '缺少法宝名称' });
      continue;
    }
    try {
      const warn = (m: string) => out.warnings.push(m);
      const ctx = `法宝「${name}」`;
      const values: Record<string, any> = {
        ...cleanRow(wdata, ['forgeTraits', 'soakTraits', 'attachTraits', 'cavityTraits', 'selectedDirections', 'linkedCharacterIds']),
        linkedCharacterIds: [],
        forgeTraits: mapTraitLeaf(wdata.forgeTraits ?? [], 'toId', warn, ctx),
        soakTraits: mapTraitLeaf(wdata.soakTraits ?? [], 'toId', warn, ctx),
        attachTraits: mapTraitLeaf(wdata.attachTraits ?? [], 'toId', warn, ctx),
        cavityTraits: mapTraitLeaf(wdata.cavityTraits ?? [], 'toId', warn, ctx),
        selectedDirections: mapSelectedDirections(wdata.selectedDirections, 'toId', warn, ctx),
        projectId,
        isDeleted: false,
      };
      const loreRows = (data.lore ?? []).map((l: any) => ({ ...cleanRow(l), projectId }));

      const existingId = byName.get(name);
      if (existingId && strategy === 'skip') { out.skipped++; continue; }
      if (existingId) {
        await creativeDb.update(schema.customWeapon).set({ ...values, updatedAt: new Date() }).where(eq(schema.customWeapon.id, existingId));
        await creativeDb.delete(schema.weaponLore).where(eq(schema.weaponLore.weaponId, existingId));
        if (loreRows.length) await creativeDb.insert(schema.weaponLore).values(loreRows.map((l: any) => ({ ...l, weaponId: existingId })) as any);
        out.overwritten++;
      } else {
        const [row] = await creativeDb.insert(schema.customWeapon).values(values as any).returning();
        byName.set(name, row.id);
        if (loreRows.length) await creativeDb.insert(schema.weaponLore).values(loreRows.map((l: any) => ({ ...l, weaponId: row.id })) as any);
        out.imported++;
      }
    } catch (e: any) {
      out.failed++;
      out.errors.push({ name, error: e?.message ?? String(e) });
    }
  }
  return out;
}

// ============================================================
// US-25 道法自然（custom_technique 单表）
// ============================================================

export async function exportTechniques(projectId: number, ids: number[]): Promise<ExportItem[]> {
  if (!ids.length) return [];
  const rows = await creativeDb
    .select()
    .from(schema.customTechnique)
    .where(and(
      eq(schema.customTechnique.projectId, projectId),
      eq(schema.customTechnique.isDeleted, false),
      inArray(schema.customTechnique.id, ids.map((x) => Math.abs(Number(x)))),
    ));
  return rows.map((r) => ({
    name: r.name,
    type: 'technique',
    data: { technique: { ...cleanRow(r, ['linkedCharacterIds']), linkedCharacterIds: [] } },
  }));
}

export async function importTechniques(
  projectId: number,
  items: any[],
  strategy: CharConflictStrategy,
): Promise<FileImportResult> {
  const out = newResult();
  const existRows = await creativeDb
    .select({ id: schema.customTechnique.id, name: schema.customTechnique.name })
    .from(schema.customTechnique)
    .where(and(eq(schema.customTechnique.projectId, projectId), eq(schema.customTechnique.isDeleted, false)));
  const byName = new Map(existRows.map((r) => [r.name, r.id]));

  for (const item of items) {
    const tdata = item?.data?.technique ?? {};
    const name = String(item?.name ?? tdata.name ?? '').trim();
    if (!name || !tdata.name) {
      out.failed++;
      out.errors.push({ name: name || '(未命名功法)', error: '缺少功法名称' });
      continue;
    }
    try {
      const values: Record<string, any> = {
        ...cleanRow(tdata, ['linkedCharacterIds']),
        linkedCharacterIds: [],
        projectId,
        isDeleted: false,
      };
      const existingId = byName.get(name);
      if (existingId && strategy === 'skip') { out.skipped++; continue; }
      if (existingId) {
        await creativeDb.update(schema.customTechnique).set({ ...values, updatedAt: new Date() }).where(eq(schema.customTechnique.id, existingId));
        out.overwritten++;
      } else {
        await creativeDb.insert(schema.customTechnique).values(values as any);
        byName.set(name, -1);
        out.imported++;
      }
    } catch (e: any) {
      out.failed++;
      out.errors.push({ name, error: e?.message ?? String(e) });
    }
  }
  return out;
}

// ============================================================
// US-26 山河舆图（custom_map + custom_location + custom_location_link）
// ============================================================

export async function exportMaps(projectId: number, ids: number[], locationIds?: number[]): Promise<ExportItem[]> {
  if (!ids.length) return [];
  const maps = await creativeDb
    .select()
    .from(schema.customMap)
    .where(and(
      eq(schema.customMap.projectId, projectId),
      eq(schema.customMap.isDeleted, false),
      inArray(schema.customMap.id, ids.map((x) => Math.abs(Number(x)))),
    ));
  if (!maps.length) return [];
  const mapIds = maps.map((m) => m.id);
  const [allLocations, links, allMaps] = await Promise.all([
    creativeDb.select().from(schema.customLocation)
      .where(and(eq(schema.customLocation.projectId, projectId), inArray(schema.customLocation.mapId, mapIds), eq(schema.customLocation.isDeleted, false))),
    creativeDb.select().from(schema.customLocationLink)
      .where(and(eq(schema.customLocationLink.projectId, projectId), eq(schema.customLocationLink.isDeleted, false))),
    creativeDb.select({ id: schema.customMap.id, name: schema.customMap.name })
      .from(schema.customMap)
      .where(and(eq(schema.customMap.projectId, projectId), eq(schema.customMap.isDeleted, false))),
  ]);
  // 可选地点粒度过滤（未传时导出全部地点）
  const locFilter = locationIds && locationIds.length
    ? new Set(locationIds.map((x) => Math.abs(Number(x))))
    : null;
  const locations = locFilter ? allLocations.filter((l) => locFilter.has(l.id)) : allLocations;
  const locNameById = new Map(locations.map((l) => [l.id, l.name]));
  const mapNameById = new Map(allMaps.map((m) => [m.id, m.name]));
  const locIdSet = new Set(locations.map((l) => l.id));

  return maps.map((m) => ({
    name: m.name,
    type: 'map',
    data: {
      map: {
        ...cleanRow(m, ['bgImage', 'parentMapId']),
        bgImage: null, // 不导出底图（base64 过大）
        parentMapName: m.parentMapId != null ? mapNameById.get(m.parentMapId) ?? null : null,
      },
      locations: locations
        .filter((l) => l.mapId === m.id)
        .map((l) => ({
          ...cleanRow(l, ['mapId', 'parentLocationId', 'linkedMapId']),
          parentLocationName: l.parentLocationId != null ? locNameById.get(l.parentLocationId) ?? null : null,
          linkedMapName: l.linkedMapId != null ? mapNameById.get(l.linkedMapId) ?? null : null,
        })),
      links: links
        .filter((r) => locIdSet.has(r.fromLocationId) && locIdSet.has(r.toLocationId) &&
          locations.some((l) => l.id === r.fromLocationId && l.mapId === m.id))
        .map((r) => ({
          ...cleanRow(r, ['fromLocationId', 'toLocationId']),
          fromName: locNameById.get(r.fromLocationId) ?? null,
          toName: locNameById.get(r.toLocationId) ?? null,
        })),
    },
  }));
}

/** 坐标按源/目标地图范围等比缩放（范围为 0 或与源一致时原样保留） */
function scaleCoord(v: number, srcMin: number, srcMax: number, dstMin: number, dstMax: number): number {
  const srcSpan = srcMax - srcMin;
  const dstSpan = dstMax - dstMin;
  if (!srcSpan || !dstSpan || (srcMin === dstMin && srcMax === dstMax)) return v;
  return dstMin + ((v - srcMin) / srcSpan) * dstSpan;
}

export async function importMaps(
  projectId: number,
  items: any[],
  strategy: MapConflictStrategy,
): Promise<FileImportResult> {
  const out = newResult();
  const existMaps = await creativeDb
    .select()
    .from(schema.customMap)
    .where(and(eq(schema.customMap.projectId, projectId), eq(schema.customMap.isDeleted, false)));
  const mapIdByName = new Map(existMaps.map((m) => [m.name, m.id]));
  const mapRowByName = new Map(existMaps.map((m) => [m.name, m]));

  for (const item of items) {
    const data = item?.data ?? {};
    const mdata = data.map ?? {};
    const name = String(item?.name ?? mdata.name ?? '').trim();
    if (!name || !mdata.name) {
      out.failed++;
      out.errors.push({ name: name || '(未命名地图)', error: '缺少地图名称' });
      continue;
    }
    try {
      const existing = mapRowByName.get(name);
      if (existing && strategy === 'skip') { out.skipped++; continue; }

      // 1. 确定目标地图行（新建 / 复用）
      let targetMapId: number;
      let targetRange: { minX: number; minY: number; maxX: number; maxY: number };
      const srcRange = {
        minX: Number(mdata.minX ?? 0), minY: Number(mdata.minY ?? 0),
        maxX: Number(mdata.maxX ?? 2000), maxY: Number(mdata.maxY ?? 1500),
      };
      const mapValues = cleanRow(mdata, ['bgImage', 'parentMapName', 'sortOrder']);

      if (existing) {
        targetMapId = existing.id;
        targetRange = { minX: existing.minX, minY: existing.minY, maxX: existing.maxX, maxY: existing.maxY };
        if (strategy === 'overwrite') {
          // 覆盖：更新地图字段 + 删旧地点（路径级联删除）
          await creativeDb.update(schema.customMap)
            .set({ ...mapValues, bgImage: null, parentMapId: null, updatedAt: new Date() })
            .where(eq(schema.customMap.id, existing.id));
          await creativeDb.delete(schema.customLocation).where(eq(schema.customLocation.mapId, existing.id));
          out.overwritten++;
        } else {
          out.merged++;
        }
      } else {
        // 新建地图：parentMapName 先置空，全部地图导入后二次更新
        const [row] = await creativeDb.insert(schema.customMap).values({
          ...mapValues,
          name,
          bgImage: null,
          parentMapId: null,
          minX: srcRange.minX, minY: srcRange.minY, maxX: srcRange.maxX, maxY: srcRange.maxY,
          projectId,
          isDeleted: false,
        } as any).returning();
        targetMapId = row.id;
        targetRange = srcRange;
        mapIdByName.set(name, row.id);
        mapRowByName.set(name, row);
        out.imported++;
      }

      // 2. 插入地点（坐标等比缩放；parentLocationId 置空→二次更新）
      const locSrcNames = new Map<string, number>(); // 源地点名 → 新地点ID
      const locParentPatch: { newId: number; parentName: string }[] = [];
      const locInsertedNames: string[] = [];
      for (const l of data.locations ?? []) {
        const locName = String(l?.name ?? '').trim();
        if (!locName) continue;
        // 合并模式下同名地点跳过（保留目标项目已有地点）
        if (existing && strategy === 'merge') {
          const dup = await creativeDb.select({ id: schema.customLocation.id })
            .from(schema.customLocation)
            .where(and(
              eq(schema.customLocation.mapId, targetMapId),
              eq(schema.customLocation.name, locName),
              eq(schema.customLocation.isDeleted, false),
            ))
            .limit(1);
          if (dup.length) {
            locSrcNames.set(locName, dup[0].id);
            out.warnings.push(`地图「${name}」地点「${locName}」已存在，合并时保留原地点`);
            continue;
          }
        }
        const x = scaleCoord(Number(l.x ?? 0), srcRange.minX, srcRange.maxX, targetRange.minX, targetRange.maxX);
        const y = scaleCoord(Number(l.y ?? 0), srcRange.minY, srcRange.maxY, targetRange.minY, targetRange.maxY);
        const linkedMapId = l.linkedMapName ? mapIdByName.get(String(l.linkedMapName)) ?? null : null;
        const [newLoc] = await creativeDb.insert(schema.customLocation).values({
          ...cleanRow(l, ['parentLocationName', 'linkedMapName', 'x', 'y']),
          name: locName,
          x, y,
          mapId: targetMapId,
          parentLocationId: null,
          linkedMapId,
          projectId,
          isDeleted: false,
        } as any).returning();
        locSrcNames.set(locName, newLoc.id);
        locInsertedNames.push(locName);
        if (l.parentLocationName) locParentPatch.push({ newId: newLoc.id, parentName: String(l.parentLocationName) });
      }

      // 2.5 二次更新 parentLocationId（含合并模式下指向已有地点的父级）
      if (locParentPatch.length) {
        const allNames = [...new Set(locParentPatch.map((p) => p.parentName))];
        const parentRows = await creativeDb
          .select({ id: schema.customLocation.id, name: schema.customLocation.name })
          .from(schema.customLocation)
          .where(and(eq(schema.customLocation.mapId, targetMapId), inArray(schema.customLocation.name, allNames), eq(schema.customLocation.isDeleted, false)));
        const parentIdByName = new Map(parentRows.map((r) => [r.name, r.id]));
        for (const p of locParentPatch) {
          const pid = parentIdByName.get(p.parentName);
          if (pid != null) {
            await creativeDb.update(schema.customLocation)
              .set({ parentLocationId: pid, updatedAt: new Date() })
              .where(eq(schema.customLocation.id, p.newId));
          } else {
            out.warnings.push(`地图「${name}」地点父级「${p.parentName}」未找到，已置空`);
          }
        }
      }

      // 3. 插入路径连接（两端按名称反查，找不到则丢弃）
      for (const r of data.links ?? []) {
        const fromId = r.fromName ? locSrcNames.get(String(r.fromName)) : null;
        const toId = r.toName ? locSrcNames.get(String(r.toName)) : null;
        if (!fromId || !toId) {
          out.warnings.push(`地图「${name}」路径「${r.fromName} → ${r.toName}」：地点未找到，已丢弃`);
          continue;
        }
        await creativeDb.insert(schema.customLocationLink).values({
          ...cleanRow(r, ['fromName', 'toName']),
          fromLocationId: fromId,
          toLocationId: toId,
          projectId,
          isDeleted: false,
        } as any);
      }

      // 4. 新建地图的 parentMapName 二次更新
      if (!existing && mdata.parentMapName) {
        const pid = mapIdByName.get(String(mdata.parentMapName));
        if (pid != null && pid !== targetMapId) {
          await creativeDb.update(schema.customMap)
            .set({ parentMapId: pid, updatedAt: new Date() })
            .where(eq(schema.customMap.id, targetMapId));
        }
      }
    } catch (e: any) {
      out.failed++;
      out.errors.push({ name, error: e?.message ?? String(e) });
    }
  }
  return out;
}


