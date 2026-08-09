/**
 * 影响体系 DB 服务层（需求：分支影响体系）
 *
 * 职责：
 *   - 读取影响定义白名单（全局预设 + 项目自定义，仅启用项）
 *   - 读取人物/世界最新已确认影响快照（按章节继承）
 *   - 分支选定后应用影响变更（事务内）：生成新快照(pending) + 写变更历史
 *   - buildImpactContext：为生成管线组装影响上下文块
 *
 * 红线：影响计算异常不阻断分支选择主流程（调用方 try/catch 降级）。
 */
import { eq, and, desc, lte, isNull, isNotNull, or, inArray } from 'drizzle-orm';
import { creativeDb, zhuxianDb } from '../../db/index.js';
import * as schema from '../../db/creative-schema.js';
import * as zschema from '../../db/zhuxian-schema.js';
import {
  buildInitialState,
  computeNextState,
  filterChangesByWhitelist,
  type ImpactDef,
  type ImpactChange,
  type ImpactState,
} from './engine.js';
import {
  buildAutoLinksFromDirection,
  suggestImpactsForDirection,
  recommendDirectionsFromState,
  type DirectionImpactSuggestion,
  type DirectionRecommendation,
} from './impact-mapping.js';

/** 将 impact_definition 行映射为计算视图 */
function toImpactDef(row: any): ImpactDef {
  return {
    impactKey: row.impactKey,
    name: row.name,
    domain: row.domain,
    category: row.category,
    valueType: row.valueType,
    minValue: row.minValue ?? 0,
    maxValue: row.maxValue ?? 100,
    defaultValue: row.defaultValue ?? 0,
    decayPerChapter: row.decayPerChapter ?? 0,
    mutexGroup: row.mutexGroup ?? null,
    priority: row.priority ?? 1,
    thresholdEvents: Array.isArray(row.thresholdEvents) ? row.thresholdEvents : null,
    description: row.description ?? null,
  };
}

/** 读取项目可用影响定义（全局预设 + 项目自定义，仅启用） */
export async function getActiveImpactDefs(db: any, projectId: number): Promise<ImpactDef[]> {
  const rows = await db
    .select()
    .from(schema.impactDefinition)
    .where(and(
      or(isNull(schema.impactDefinition.projectId), eq(schema.impactDefinition.projectId, projectId)),
      eq(schema.impactDefinition.isActive, true),
    ));
  return rows.map(toImpactDef);
}

/** 读取人物最新已确认影响快照状态（chapter_no <= upToChapter），无则返回初始状态 */
export async function getCharacterImpactState(
  db: any, projectId: number, characterId: number, upToChapter: number, defs: ImpactDef[]
): Promise<ImpactState> {
  const [snap] = await db
    .select()
    .from(schema.characterImpactSnapshot)
    .where(and(
      eq(schema.characterImpactSnapshot.projectId, projectId),
      eq(schema.characterImpactSnapshot.characterId, characterId),
      lte(schema.characterImpactSnapshot.chapterNo, upToChapter),
      eq(schema.characterImpactSnapshot.status, 'confirmed'),
    ))
    .orderBy(desc(schema.characterImpactSnapshot.chapterNo))
    .limit(1);
  if (!snap) return buildInitialState(defs);
  return {
    numericValues: (snap.numericValues as Record<string, number>) ?? {},
    tagStates: (snap.tagStates as any[]) ?? [],
  };
}

/** 读取世界（区域/全局）最新已确认影响快照状态 */
export async function getWorldImpactState(
  db: any, projectId: number, region: string | null, upToChapter: number, defs: ImpactDef[]
): Promise<ImpactState> {
  const conditions = [
    eq(schema.worldImpactSnapshot.projectId, projectId),
    lte(schema.worldImpactSnapshot.chapterNo, upToChapter),
    eq(schema.worldImpactSnapshot.status, 'confirmed'),
  ];
  if (region) conditions.push(eq(schema.worldImpactSnapshot.region, region));
  else conditions.push(isNull(schema.worldImpactSnapshot.region));
  const [snap] = await db
    .select()
    .from(schema.worldImpactSnapshot)
    .where(and(...conditions))
    .orderBy(desc(schema.worldImpactSnapshot.chapterNo))
    .limit(1);
  if (!snap) return buildInitialState(defs.filter((d) => d.domain === 'world'));
  return {
    numericValues: (snap.numericValues as Record<string, number>) ?? {},
    tagStates: (snap.tagStates as any[]) ?? [],
  };
}

/** 默认关系初始值（无快照时） */
const DEFAULT_RELATION_VALUES: Record<string, number> = { affection: 50, trust: 50, respect: 50, intimacy: 50 };

/** 读取两人最新已确认关系快照状态（约定 charAId < charBId） */
export async function getRelationState(
  db: any, projectId: number, charAId: number, charBId: number, upToChapter: number,
): Promise<Record<string, number>> {
  const a = Math.min(charAId, charBId);
  const b = Math.max(charAId, charBId);
  const [snap] = await db
    .select()
    .from(schema.relationImpactSnapshot)
    .where(and(
      eq(schema.relationImpactSnapshot.projectId, projectId),
      eq(schema.relationImpactSnapshot.charAId, a),
      eq(schema.relationImpactSnapshot.charBId, b),
      lte(schema.relationImpactSnapshot.chapterNo, upToChapter),
      eq(schema.relationImpactSnapshot.status, 'confirmed'),
    ))
    .orderBy(desc(schema.relationImpactSnapshot.chapterNo))
    .limit(1);
  if (!snap) return { ...DEFAULT_RELATION_VALUES };
  return { ...DEFAULT_RELATION_VALUES, ...((snap.relationValues as Record<string, number>) ?? {}) };
}

/** best-effort 批量取人物名（诛仙库），失败返回空映射 */
async function getCharacterNames(ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    if (!ids.length) return map;
    const rows = await zhuxianDb
      .select({ id: zschema.novelCharacterLib.id, name: zschema.novelCharacterLib.name })
      .from(zschema.novelCharacterLib)
      .where(inArray(zschema.novelCharacterLib.id, ids));
    for (const r of rows) map.set(Number(r.id), r.name);
  } catch (e: any) {
    console.warn(`[影响体系] 人物名采集失败（降级）: ${e?.message || e}`);
  }
  return map;
}

/**
 * 解析影响体系的"目标人物"（预览与实际应用共用，保证 预览=实际）。
 * 优先用章节计划的 POV 人物；POV 为空时回落到项目级"默认影响对象"
 *   （creative_project.default_impact_character_ids，通常为主角）。
 * best-effort：读取默认对象失败降级为空数组，绝不阻断预览/分支选择。
 */
export async function resolveImpactTargetCharacters(
  projectId: number,
  povCharacterIds: number[],
): Promise<number[]> {
  if (povCharacterIds.length) return povCharacterIds;
  try {
    const [proj] = await creativeDb
      .select({ defaultImpactCharacterIds: schema.creativeProject.defaultImpactCharacterIds })
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, projectId))
      .limit(1);
    const ids = Array.isArray(proj?.defaultImpactCharacterIds)
      ? (proj!.defaultImpactCharacterIds as number[]).map(Number)
      : [];
    if (ids.length) return ids;
  } catch (e: any) {
    console.warn(`[影响体系] 默认影响对象读取失败（继续兜底）: ${e?.message || e}`);
  }
  // 第三级兜底：从章节状态快照取已出场人物（按 char_id 升序前3），保证人物域影响有落点
  try {
    const rows = await creativeDb
      .selectDistinct({ characterId: schema.characterStateSnapshot.characterId })
      .from(schema.characterStateSnapshot)
      .where(and(
        eq(schema.characterStateSnapshot.projectId, projectId),
        isNotNull(schema.characterStateSnapshot.characterId),
      ))
      .orderBy(schema.characterStateSnapshot.characterId)
      .limit(3);
    return rows.map((r) => Number(r.characterId)).filter((x) => Number.isFinite(x));
  } catch (e: any) {
    console.warn(`[影响体系] 快照出场人物兜底读取失败（降级为空）: ${e?.message || e}`);
    return [];
  }
}

/** 应用结果摘要 */
export interface ApplyImpactsResult {
  applied: number;
  characterSnapshotIds: number[];
  worldSnapshotIds: number[];
  relationSnapshotIds: number[];
}

/** 方向自动映射上下文（无手工影响链接时按主方向生成影响变更） */
export interface ImpactAutoMapContext {
  /** 分支选项主方向编码 */
  mainDirection?: string | null;
  /** character 域自动映射的目标人物ID（通常为来源章 POV 人物） */
  characterIds?: number[];
}

/**
 * 应用某分支选项的影响变更（在调用方事务内执行，db 传 tx）。
 * 流程（PRD 3.5）：读链接 → 白名单过滤 → 按目标分组 → 逐项计算新值 →
 *   生成新快照(pending) → 写 impact_history。
 * 若该选项无手工绑定的影响链接且提供了 autoMap（主方向），则按 方向→影响 自动映射
 *   生成虚拟链接（手工链接永远优先，自动映射仅兜底；产物为 pending 快照可复核）。
 * @param db 数据库句柄（creativeDb 或事务 tx）
 * @param chapterNo 影响生效章节号（衍生下一章的章节号，快照按此对齐）
 * @param autoMap 方向自动映射上下文（可选）
 */
export async function applyBranchImpacts(
  db: any,
  projectId: number,
  branchOptionId: number,
  volumeNo: number,
  chapterNo: number,
  autoMap?: ImpactAutoMapContext,
): Promise<ApplyImpactsResult> {
  const result: ApplyImpactsResult = { applied: 0, characterSnapshotIds: [], worldSnapshotIds: [], relationSnapshotIds: [] };

  const defs = await getActiveImpactDefs(db, projectId);
  if (!defs.length) return result;

  let links = await db
    .select()
    .from(schema.branchImpactLink)
    .where(eq(schema.branchImpactLink.branchOptionId, branchOptionId))
    .orderBy(schema.branchImpactLink.sortOrder);
  // 方向→影响 自动映射兜底（手工链接优先）
  if (!links.length && autoMap?.mainDirection) {
    links = buildAutoLinksFromDirection(autoMap.mainDirection, defs, autoMap.characterIds ?? []);
  }
  if (!links.length) return result;

  // 白名单过滤（影响项必须存在于启用定义）
  const toChange = (l: any): ImpactChange => ({
    impactKey: l.impactKey,
    changeType: l.changeType,
    changeValue: l.changeValue,
    tagKey: l.tagKey,
    tagName: l.tagKey ? defs.find((d) => d.impactKey === l.impactKey)?.name : undefined,
    tagDuration: l.tagDuration,
  });
  const validLinks = links.filter((l: any) => defs.some((d) => d.impactKey === l.impactKey));
  if (!validLinks.length) return result;

  // 按目标分组
  const charLinks = new Map<number, any[]>();
  const worldLinks = new Map<string, any[]>(); // key = region || ''
  const relLinks = new Map<string, any[]>(); // key = `${charAId}:${charBId}`
  for (const l of validLinks) {
    if (l.targetType === 'character' && l.targetId != null) {
      const cid = Number(l.targetId);
      if (!charLinks.has(cid)) charLinks.set(cid, []);
      charLinks.get(cid)!.push(l);
    } else if (l.targetType === 'world') {
      const key = l.region ?? '';
      if (!worldLinks.has(key)) worldLinks.set(key, []);
      worldLinks.get(key)!.push(l);
    } else if (l.targetType === 'relation' && l.charAId != null && l.charBId != null) {
      const a = Math.min(Number(l.charAId), Number(l.charBId));
      const b = Math.max(Number(l.charAId), Number(l.charBId));
      const key = `${a}:${b}`;
      if (!relLinks.has(key)) relLinks.set(key, []);
      relLinks.get(key)!.push(l);
    }
  }

  const charNames = await getCharacterNames([...charLinks.keys()]);

  // ---- 人物目标 ----
  for (const [cid, ls] of charLinks) {
    const prev = await getCharacterImpactState(db, projectId, cid, chapterNo - 1, defs);
    const changes = filterChangesByWhitelist(ls.map(toChange), defs);
    const next = computeNextState(prev, changes, defs);
    const [inserted] = await db
      .insert(schema.characterImpactSnapshot)
      .values({
        projectId,
        characterId: cid,
        characterName: charNames.get(cid) ?? `人物${cid}`,
        volumeNo,
        chapterNo,
        numericValues: next.numericValues,
        tagStates: next.tagStates,
        status: 'pending',
        source: 'branch',
      })
      .returning();
    result.characterSnapshotIds.push(inserted.id);
    await db.insert(schema.impactHistory).values({
      projectId,
      sourceType: 'branch',
      sourceId: branchOptionId,
      chapterNo,
      snapshotBefore: { target: `character:${cid}`, ...prev },
      snapshotAfter: { target: `character:${cid}`, ...next },
      operatorNote: `分支选项#${branchOptionId}选择应用`,
    });
    result.applied += changes.length;
  }

  // ---- 世界目标 ----
  for (const [regionKey, ls] of worldLinks) {
    const region = regionKey || null;
    const worldDefs = defs; // 世界快照仅应用 world 域定义，但保留全部以便阈值判断
    const prev = await getWorldImpactState(db, projectId, region, chapterNo - 1, worldDefs);
    const changes = filterChangesByWhitelist(ls.map(toChange), worldDefs);
    const next = computeNextState(prev, changes, worldDefs);
    const [inserted] = await db
      .insert(schema.worldImpactSnapshot)
      .values({
        projectId,
        volumeNo,
        chapterNo,
        region,
        numericValues: next.numericValues,
        tagStates: next.tagStates,
        status: 'pending',
        source: 'branch',
      })
      .returning();
    result.worldSnapshotIds.push(inserted.id);
    await db.insert(schema.impactHistory).values({
      projectId,
      sourceType: 'branch',
      sourceId: branchOptionId,
      chapterNo,
      snapshotBefore: { target: `world:${regionKey || 'global'}`, ...prev },
      snapshotAfter: { target: `world:${regionKey || 'global'}`, ...next },
      operatorNote: `分支选项#${branchOptionId}选择应用`,
    });
    result.applied += changes.length;
  }

  // ---- 关系目标（阶段4） ----
  if (relLinks.size) {
    const allRelCharIds = new Set<number>();
    for (const key of relLinks.keys()) {
      const [a, b] = key.split(':').map(Number);
      allRelCharIds.add(a);
      allRelCharIds.add(b);
    }
    const relNames = await getCharacterNames([...allRelCharIds]);
    for (const [pairKey, ls] of relLinks) {
      const [a, b] = pairKey.split(':').map(Number);
      const prev = await getRelationState(db, projectId, a, b, chapterNo - 1);
      const delta: Record<string, number> = {};
      for (const l of ls) {
        const dim = l.impactKey.replace(/^relation\./, '') || 'affection';
        delta[dim] = (delta[dim] ?? 0) + (l.changeValue ?? 0);
      }
      const nextValues: Record<string, number> = { ...prev };
      for (const [k, v] of Object.entries(delta)) {
        nextValues[k] = Math.max(0, Math.min(100, (nextValues[k] ?? 50) + v));
      }
      const [inserted] = await db
        .insert(schema.relationImpactSnapshot)
        .values({
          projectId,
          charAId: a,
          charBId: b,
          charAName: relNames.get(a) ?? `人物${a}`,
          charBName: relNames.get(b) ?? `人物${b}`,
          volumeNo,
          chapterNo,
          relType: null,
          relationValues: nextValues,
          relationDelta: delta,
          status: 'pending',
          source: 'branch',
        })
        .returning();
      result.relationSnapshotIds.push(inserted.id);
      await db.insert(schema.impactHistory).values({
        projectId,
        sourceType: 'branch',
        sourceId: branchOptionId,
        chapterNo,
        snapshotBefore: { target: `relation:${pairKey}`, values: prev },
        snapshotAfter: { target: `relation:${pairKey}`, values: nextValues },
        operatorNote: `分支选项#${branchOptionId}关系影响`,
      });
      result.applied += Object.keys(delta).length;
    }
  }

  return result;
}

/** 回滚结果摘要 */
export interface RollbackImpactsResult {
  deletedCharacterSnapshots: number;
  deletedWorldSnapshots: number;
  deletedRelationSnapshots: number;
  deletedHistory: number;
}

/**
 * 回滚某章节上由分支选择产生的影响（在调用方事务内执行，db 传 tx）。
 * 用于"覆盖式重选分支"：在应用新选项的影响前，先清理上一次选择留下的
 *   pending 快照与对应 impact_history，避免重复/孤儿快照。
 * 仅回滚 status='pending' 且 source='branch' 的快照（confirmed 为权威状态，绝不回滚）。
 * @param prevOptionId 上一次选定的分支选项ID（用于精确删除其 impact_history）
 * @param chapterNo 影响生效章节号（衍生下一章章节号）
 */
export async function rollbackBranchImpacts(
  db: any,
  projectId: number,
  prevOptionId: number,
  chapterNo: number,
): Promise<RollbackImpactsResult> {
  const delChar = await db
    .delete(schema.characterImpactSnapshot)
    .where(and(
      eq(schema.characterImpactSnapshot.projectId, projectId),
      eq(schema.characterImpactSnapshot.chapterNo, chapterNo),
      eq(schema.characterImpactSnapshot.source, 'branch'),
      eq(schema.characterImpactSnapshot.status, 'pending'),
    ))
    .returning({ id: schema.characterImpactSnapshot.id });
  const delWorld = await db
    .delete(schema.worldImpactSnapshot)
    .where(and(
      eq(schema.worldImpactSnapshot.projectId, projectId),
      eq(schema.worldImpactSnapshot.chapterNo, chapterNo),
      eq(schema.worldImpactSnapshot.source, 'branch'),
      eq(schema.worldImpactSnapshot.status, 'pending'),
    ))
    .returning({ id: schema.worldImpactSnapshot.id });
  const delRel = await db
    .delete(schema.relationImpactSnapshot)
    .where(and(
      eq(schema.relationImpactSnapshot.projectId, projectId),
      eq(schema.relationImpactSnapshot.chapterNo, chapterNo),
      eq(schema.relationImpactSnapshot.source, 'branch'),
      eq(schema.relationImpactSnapshot.status, 'pending'),
    ))
    .returning({ id: schema.relationImpactSnapshot.id });
  const delHist = await db
    .delete(schema.impactHistory)
    .where(and(
      eq(schema.impactHistory.projectId, projectId),
      eq(schema.impactHistory.sourceType, 'branch'),
      eq(schema.impactHistory.sourceId, prevOptionId),
      eq(schema.impactHistory.chapterNo, chapterNo),
    ))
    .returning({ id: schema.impactHistory.id });
  return {
    deletedCharacterSnapshots: delChar.length,
    deletedWorldSnapshots: delWorld.length,
    deletedRelationSnapshots: delRel.length,
    deletedHistory: delHist.length,
  };
}

/** 影响预览条目（单个目标的前后状态对比，供前端 ⚡ 预览渲染） */
export interface ImpactPreviewItem {
  targetType: 'character' | 'world' | 'relation';
  targetId: number | null;
  characterName?: string;
  region?: string | null;
  /** 关系预览字段（targetType='relation'时） */
  charAId?: number;
  charBId?: number;
  charAName?: string;
  charBName?: string;
  relationBefore?: Record<string, number>;
  relationAfter?: Record<string, number>;
  relationDelta?: Record<string, number>;
  /** 变更前数值/标签 */
  before: ImpactState;
  /** 变更后数值/标签 */
  after: ImpactState;
  /** 本选项作用的有效变更数 */
  changeCount: number;
}

/**
 * 预览某分支选项的影响（只计算不落库，供前端 ⚡ 影响预览）。
 * 与 applyBranchImpacts 共用白名单过滤 + 分组 + computeNextState 逻辑，保证预览=实际。
 * 同样支持 方向→影响 自动映射兜底（无手工链接且提供 autoMap 时），确保预览与实际一致。
 * best-effort：任何异常降级为空数组，绝不阻断分支面板渲染。
 * @param chapterNo 假定影响生效章节号（通常为来源章+1）
 * @param autoMap 方向自动映射上下文（可选，与 applyBranchImpacts 保持一致）
 */
export async function previewBranchImpacts(
  projectId: number,
  branchOptionId: number,
  chapterNo: number,
  autoMap?: ImpactAutoMapContext,
): Promise<ImpactPreviewItem[]> {
  const items: ImpactPreviewItem[] = [];
  try {
    const defs = await getActiveImpactDefs(creativeDb, projectId);
    if (!defs.length) return items;

    let links = await creativeDb
      .select()
      .from(schema.branchImpactLink)
      .where(eq(schema.branchImpactLink.branchOptionId, branchOptionId))
      .orderBy(schema.branchImpactLink.sortOrder);
    // 方向→影响 自动映射兜底（手工链接优先），与 applyBranchImpacts 保持一致
    if (!links.length && autoMap?.mainDirection) {
      links = buildAutoLinksFromDirection(autoMap.mainDirection, defs, autoMap.characterIds ?? []);
    }
    const toChange = (l: any): ImpactChange => ({
      impactKey: l.impactKey,
      changeType: l.changeType,
      changeValue: l.changeValue,
      tagKey: l.tagKey,
      tagName: l.tagKey ? defs.find((d) => d.impactKey === l.impactKey)?.name : undefined,
      tagDuration: l.tagDuration,
    });
    const validLinks = links.filter((l: any) => defs.some((d) => d.impactKey === l.impactKey));
    if (!validLinks.length) return items;

    const charLinks = new Map<number, any[]>();
    const worldLinks = new Map<string, any[]>();
    const relLinks = new Map<string, any[]>();
    for (const l of validLinks) {
      if (l.targetType === 'character' && l.targetId != null) {
        const cid = Number(l.targetId);
        if (!charLinks.has(cid)) charLinks.set(cid, []);
        charLinks.get(cid)!.push(l);
      } else if (l.targetType === 'world') {
        const key = l.region ?? '';
        if (!worldLinks.has(key)) worldLinks.set(key, []);
        worldLinks.get(key)!.push(l);
      } else if (l.targetType === 'relation' && l.charAId != null && l.charBId != null) {
        const a = Math.min(Number(l.charAId), Number(l.charBId));
        const b = Math.max(Number(l.charAId), Number(l.charBId));
        const key = `${a}:${b}`;
        if (!relLinks.has(key)) relLinks.set(key, []);
        relLinks.get(key)!.push(l);
      }
    }

    const charNames = await getCharacterNames([...charLinks.keys()]);
    for (const [cid, ls] of charLinks) {
      const prev = await getCharacterImpactState(creativeDb, projectId, cid, chapterNo - 1, defs);
      const changes = filterChangesByWhitelist(ls.map(toChange), defs);
      const next = computeNextState(prev, changes, defs);
      items.push({
        targetType: 'character',
        targetId: cid,
        characterName: charNames.get(cid) ?? `人物${cid}`,
        before: prev,
        after: next,
        changeCount: changes.length,
      });
    }
    for (const [regionKey, ls] of worldLinks) {
      const region = regionKey || null;
      const prev = await getWorldImpactState(creativeDb, projectId, region, chapterNo - 1, defs);
      const changes = filterChangesByWhitelist(ls.map(toChange), defs);
      const next = computeNextState(prev, changes, defs);
      items.push({
        targetType: 'world',
        targetId: null,
        region,
        before: prev,
        after: next,
        changeCount: changes.length,
      });
    }
    // 关系预览（阶段4）
    if (relLinks.size) {
      const allRelIds = new Set<number>();
      for (const key of relLinks.keys()) {
        const [a, b] = key.split(':').map(Number);
        allRelIds.add(a); allRelIds.add(b);
      }
      const relNames = await getCharacterNames([...allRelIds]);
      for (const [pairKey, ls] of relLinks) {
        const [a, b] = pairKey.split(':').map(Number);
        const before = await getRelationState(creativeDb, projectId, a, b, chapterNo - 1);
        const delta: Record<string, number> = {};
        for (const l of ls) {
          const dim = l.impactKey.replace(/^relation\./, '') || 'affection';
          delta[dim] = (delta[dim] ?? 0) + (l.changeValue ?? 0);
        }
        const after: Record<string, number> = { ...before };
        for (const [k, v] of Object.entries(delta)) {
          after[k] = Math.max(0, Math.min(100, (after[k] ?? 50) + v));
        }
        items.push({
          targetType: 'relation',
          targetId: null,
          charAId: a, charBId: b,
          charAName: relNames.get(a) ?? `人物${a}`,
          charBName: relNames.get(b) ?? `人物${b}`,
          relationBefore: before,
          relationAfter: after,
          relationDelta: delta,
          before: { numericValues: before, tagStates: [] },
          after: { numericValues: after, tagStates: [] },
          changeCount: Object.keys(delta).length,
        });
      }
    }
  } catch (e: any) {
    console.warn(`[影响体系] 影响预览失败（降级）: ${e?.message || e}`);
    return [];
  }
  return items;
}

// ============================================================
// 生成管线上下文注入（3.6.1 ContextComposer 扩展）
// ============================================================

/** 影响上下文块（注入 ContextPackage.impactContext） */
export interface ImpactContextBlock {
  /** 人物影响块（出场人物设定末尾） */
  characterBlocks: { characterId: number; characterName: string; text: string }[];
  /** 世界观影响块（场景设定开头） */
  worldBlock: string | null;
  /** 原始数据（供前端/调试） */
  raw: { characters: any[]; world: any | null };
}

/** 格式化单个数值属性为 "名称 值" */
function formatNumeric(numericValues: Record<string, number>, defs: ImpactDef[]): string[] {
  const defByKey = new Map(defs.map((d) => [d.impactKey, d]));
  return Object.entries(numericValues)
    .filter(([, v]) => typeof v === 'number')
    .map(([key, v]) => `${defByKey.get(key)?.name ?? key} ${v}`);
}

/** 格式化标签为 "标签名(剩余N章|永久)" */
function formatTags(tagStates: any[]): string[] {
  return tagStates.map((t) =>
    t.remainChapters === -1 ? `${t.tagName}` : `${t.tagName}(余${t.remainChapters}章)`
  );
}

/**
 * 构建章节生成的影响上下文（best-effort，失败降级为空块）。
 * @param characterIds 出场人物ID列表
 * @param chapterNo 当前生成章节号
 */
export async function buildImpactContext(
  projectId: number,
  characterIds: number[],
  chapterNo: number,
  volumeNo: number,
): Promise<ImpactContextBlock> {
  const empty: ImpactContextBlock = { characterBlocks: [], worldBlock: null, raw: { characters: [], world: null } };
  try {
    const defs = await getActiveImpactDefs(creativeDb, projectId);
    if (!defs.length) return empty;

    // 人物影响块
    const characterBlocks: { characterId: number; characterName: string; text: string }[] = [];
    const rawChars: any[] = [];
    const names = await getCharacterNames(characterIds);
    for (const cid of characterIds) {
      const state = await getCharacterImpactState(creativeDb, projectId, cid, chapterNo, defs);
      const hasData = Object.keys(state.numericValues).length > 0 || state.tagStates.length > 0;
      if (!hasData) continue;
      const name = names.get(cid) ?? `人物${cid}`;
      const lines: string[] = [];
      const nums = formatNumeric(state.numericValues, defs);
      if (nums.length) lines.push(`属性：${nums.join('，')}`);
      const tags = formatTags(state.tagStates);
      if (tags.length) lines.push(`生效状态：${tags.join('、')}`);
      if (lines.length) {
        characterBlocks.push({ characterId: cid, characterName: name, text: lines.join('；') });
        rawChars.push({ characterId: cid, characterName: name, ...state });
      }
    }

    // 世界观影响块（全局 + 本卷区域）
    let worldBlock: string | null = null;
    let rawWorld: any = null;
    const worldState = await getWorldImpactState(creativeDb, projectId, null, chapterNo, defs);
    const wNums = formatNumeric(worldState.numericValues, defs);
    const wTags = formatTags(worldState.tagStates);
    if (wNums.length || wTags.length) {
      const parts: string[] = [];
      if (wNums.length) parts.push(`天地状态：${wNums.join('，')}`);
      if (wTags.length) parts.push(`世界规则：${wTags.join('、')}`);
      worldBlock = parts.join('；');
      rawWorld = worldState;
    }

    return { characterBlocks, worldBlock, raw: { characters: rawChars, world: rawWorld } };
  } catch (e: any) {
    console.warn(`[影响体系] buildImpactContext 失败（降级为空）: ${e?.message || e}`);
    return empty;
  }
}

// ============================================================
// 方向 ↔ 影响 联动（阶段3）
// ============================================================

/**
 * 方向 → 影响 建议（异步包装：读启用定义后调用纯函数映射）。
 * best-effort：异常降级为空数组。
 */
export async function suggestImpactsForDirectionAsync(
  projectId: number,
  directionCode: string,
  characterIds: number[],
): Promise<DirectionImpactSuggestion[]> {
  try {
    const defs = await getActiveImpactDefs(creativeDb, projectId);
    if (!defs.length) return [];
    return suggestImpactsForDirection(directionCode, defs, characterIds);
  } catch (e: any) {
    console.warn(`[影响体系] 方向影响建议失败（降级）: ${e?.message || e}`);
    return [];
  }
}

/**
 * 影响 → 方向 推荐（弱提示，不强制）。
 * 聚合指定人物的最新已确认影响数值（取各人物数值最大者作为风险口径）+ 全局世界数值，
 * 遍历 IMPACT_DIRECTION_RULES 产出方向建议。best-effort：异常降级为空数组。
 * @param characterIds 参与评估的人物ID列表（缺省则仅评估世界状态）
 * @param upToChapter 评估截止章节（缺省 999999 = 最新）
 */
export async function recommendDirections(
  projectId: number,
  characterIds: number[],
  upToChapter = 999999,
): Promise<DirectionRecommendation[]> {
  try {
    const defs = await getActiveImpactDefs(creativeDb, projectId);
    if (!defs.length) return [];

    // 聚合数值：同一 impactKey 取所有人物中的最大值（风险口径），世界数值直接并入
    const merged: Record<string, number> = {};
    for (const cid of characterIds) {
      const state = await getCharacterImpactState(creativeDb, projectId, cid, upToChapter, defs);
      for (const [k, v] of Object.entries(state.numericValues)) {
        if (typeof v !== 'number') continue;
        merged[k] = merged[k] === undefined ? v : Math.max(merged[k], v);
      }
    }
    const worldState = await getWorldImpactState(creativeDb, projectId, null, upToChapter, defs);
    for (const [k, v] of Object.entries(worldState.numericValues)) {
      if (typeof v !== 'number') continue;
      if (merged[k] === undefined) merged[k] = v;
    }

    return recommendDirectionsFromState(merged);
  } catch (e: any) {
    console.warn(`[影响体系] 方向推荐失败（降级）: ${e?.message || e}`);
    return [];
  }
}

// ============================================================
// 关系上下文构建（阶段4）
// ============================================================

const RELATION_DIM_LABELS: Record<string, string> = {
  affection: '好感', trust: '信任', respect: '敬重', intimacy: '亲密',
};

export interface RelationContextBlock {
  pairs: { charAId: number; charBId: number; charAName: string; charBName: string; values: Record<string, number> }[];
  text: string | null;
}

/**
 * 构建出场人物之间的关系上下文（供 Writer prompt 注入【人物关系状态】块）。
 * 对 characterIds 中所有两两组合读取最新 confirmed 关系快照。
 * best-effort：异常降级为空。
 */
export async function buildRelationContext(
  projectId: number,
  characterIds: number[],
  chapterNo: number,
): Promise<RelationContextBlock> {
  const empty: RelationContextBlock = { pairs: [], text: null };
  try {
    if (characterIds.length < 2) return empty;
    const names = await getCharacterNames(characterIds);
    const pairs: RelationContextBlock['pairs'] = [];
    for (let i = 0; i < characterIds.length; i++) {
      for (let j = i + 1; j < characterIds.length; j++) {
        const a = Math.min(characterIds[i], characterIds[j]);
        const b = Math.max(characterIds[i], characterIds[j]);
        const values = await getRelationState(creativeDb, projectId, a, b, chapterNo);
        // 跳过全默认值（无实际关系数据）
        const isDefault = Object.entries(values).every(([k, v]) => v === DEFAULT_RELATION_VALUES[k]);
        if (isDefault) continue;
        pairs.push({
          charAId: a, charBId: b,
          charAName: names.get(a) ?? `人物${a}`,
          charBName: names.get(b) ?? `人物${b}`,
          values,
        });
      }
    }
    if (!pairs.length) return empty;
    const lines = pairs.map((p) => {
      const dims = Object.entries(p.values)
        .map(([k, v]) => `${RELATION_DIM_LABELS[k] ?? k} ${v}`)
        .join('，');
      return `◆ ${p.charAName} ↔ ${p.charBName}：${dims}`;
    });
    return { pairs, text: lines.join('\n') };
  } catch (e: any) {
    console.warn(`[影响体系] buildRelationContext 失败（降级为空）: ${e?.message || e}`);
    return empty;
  }
}
