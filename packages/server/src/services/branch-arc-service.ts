/**
 * 分支弧服务（动态叙事引擎 v2.1 · 第二层：选择的血肉）
 *
 * - 选定分支选项时创建 BranchArc（从 chapter_branch_option 的新字段带入弧信息）
 * - 进度追踪（弧内章节数 N / estimatedLength M）+ 硬性上限 5 章（一次性豁免 +2）
 * - 新元素登记（characters/locations/foreshadows/items → newElements jsonb）
 * - 废弃分支（状态回滚复用 rollbackBranchImpacts）
 * - 提拔分支元素为主线（伏笔/任务确认生效；自定义实体 draft→official）
 */
import { eq, and, desc, asc } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { rollbackBranchImpacts } from './impact/impact.service.js';

/** 分支弧硬性上限（可一次性豁免延长 2 章 → 封顶 7） */
export const ARC_HARD_LIMIT = 5;
export const ARC_ABS_LIMIT = 7;

/** optionType → branchType 映射（存量 normal/encounter 继续有效） */
export function mapOptionTypeToBranchType(optionType: string | null | undefined): string {
  switch (optionType) {
    case 'encounter': return 'consequence';
    case 'detour': return 'detour';
    case 'divergence': return 'divergence';
    case 'approach': return 'approach';
    default: return 'approach';
  }
}

/** 从选定的分支选项创建分支弧，并把衍生章节挂到弧上。幂等：同源章节已有 active 弧则复用。 */
export async function createArcFromOption(
  txOrDb: any,
  option: any,
  sourcePlan: any,
  derivedPlanId: number,
  sourceMilestoneId: number | null,
): Promise<{ arcId: number; isNew: boolean }> {
  const db = txOrDb;

  // 同源章节已有 active 弧（覆盖式重选场景）：直接复用并重新指向衍生章
  const [existing] = await db
    .select()
    .from(schema.branchArc)
    .where(and(
      eq(schema.branchArc.projectId, sourcePlan.projectId),
      eq(schema.branchArc.sourceChapterId, sourcePlan.id),
      eq(schema.branchArc.status, 'active'),
    ))
    .limit(1);
  if (existing) {
    await db
      .update(schema.chapterPlan)
      .set({ branchArcId: existing.id })
      .where(eq(schema.chapterPlan.id, derivedPlanId));
    return { arcId: existing.id, isNew: false };
  }

  const [arc] = await db.insert(schema.branchArc).values({
    projectId: sourcePlan.projectId,
    sourceChapterId: sourcePlan.id,
    sourceMilestoneId,
    title: (option.optionTitle || '').slice(0, 200),
    premise: option.branchPremise ?? null,
    branchType: mapOptionTypeToBranchType(option.optionType),
    estimatedLength: Math.max(1, Math.min(ARC_HARD_LIMIT, Number(option.estimatedLength) || 2)),
    status: 'active',
    convergeToMilestoneId: option.convergeToMilestoneId ?? null,
    newElements: {},
    stateSnapshot: {
      sourceChapterNo: sourcePlan.chapterNo,
      impactTags: Array.isArray(option.impactTags) ? option.impactTags : [],
      createdAt: new Date().toISOString(),
    },
  }).returning();

  await db
    .update(schema.chapterPlan)
    .set({ branchArcId: arc.id })
    .where(eq(schema.chapterPlan.id, derivedPlanId));

  return { arcId: arc.id, isNew: true };
}

/** 项目弧列表（新→旧） */
export async function listArcs(projectId: number) {
  return creativeDb
    .select()
    .from(schema.branchArc)
    .where(eq(schema.branchArc.projectId, projectId))
    .orderBy(desc(schema.branchArc.id));
}

/** 弧详情 + 进度（弧内章节数 / 章节明细） */
export async function getArcWithProgress(arcId: number) {
  const [arc] = await creativeDb
    .select()
    .from(schema.branchArc)
    .where(eq(schema.branchArc.id, arcId))
    .limit(1);
  if (!arc) return null;
  const chapters = await creativeDb
    .select({
      id: schema.chapterPlan.id,
      chapterNo: schema.chapterPlan.chapterNo,
      title: schema.chapterPlan.title,
      status: schema.chapterPlan.status,
      isConvergence: schema.chapterPlan.isConvergence,
    })
    .from(schema.chapterPlan)
    .where(eq(schema.chapterPlan.branchArcId, arcId))
    .orderBy(asc(schema.chapterPlan.chapterNo));
  const progress = chapters.filter((c) => !c.isConvergence).length;
  const limit = Math.min(ARC_ABS_LIMIT, Math.max(arc.estimatedLength ?? 2, ARC_HARD_LIMIT));
  return {
    ...arc,
    chapters,
    progress,
    estimatedLength: arc.estimatedLength ?? 2,
    hardLimit: ARC_HARD_LIMIT,
    atHardLimit: progress >= ARC_HARD_LIMIT && arc.status === 'active',
    overEstimate: progress >= (arc.estimatedLength ?? 2),
    shouldConverge: arc.status === 'active' && progress >= (arc.estimatedLength ?? 2),
    maxPossible: limit,
  };
}

/** 当前项目进行中的分支弧（至多一个 active） */
export async function getActiveArc(projectId: number) {
  const [arc] = await creativeDb
    .select()
    .from(schema.branchArc)
    .where(and(eq(schema.branchArc.projectId, projectId), eq(schema.branchArc.status, 'active')))
    .orderBy(desc(schema.branchArc.id))
    .limit(1);
  return arc ?? null;
}

/** 豁免延长：一次性 +2（封顶 ARC_ABS_LIMIT） */
export async function extendArc(arcId: number, extra = 2) {
  const [arc] = await creativeDb.select().from(schema.branchArc).where(eq(schema.branchArc.id, arcId)).limit(1);
  if (!arc) return null;
  const next = Math.min(ARC_ABS_LIMIT, (arc.estimatedLength ?? 2) + extra);
  const [row] = await creativeDb
    .update(schema.branchArc)
    .set({ estimatedLength: next })
    .where(eq(schema.branchArc.id, arcId))
    .returning();
  return row;
}

/** 废弃分支：标记 abandoned + 回滚影响快照（best-effort） */
export async function abandonArc(arcId: number): Promise<{ ok: boolean; error?: string }> {
  const [arc] = await creativeDb.select().from(schema.branchArc).where(eq(schema.branchArc.id, arcId)).limit(1);
  if (!arc) return { ok: false, error: '分支弧不存在' };
  if (arc.status !== 'active') return { ok: false, error: `分支弧已处于 ${arc.status} 状态` };

  await creativeDb.update(schema.branchArc).set({ status: 'abandoned' }).where(eq(schema.branchArc.id, arcId));

  // 状态回滚：复用 rollbackBranchImpacts（按来源章分支选项回滚 pending 快照/历史）
  try {
    const snap: any = arc.stateSnapshot ?? {};
    if (arc.sourceChapterId) {
      const [srcPlan] = await creativeDb
        .select({ chapterNo: schema.chapterPlan.chapterNo })
        .from(schema.chapterPlan)
        .where(eq(schema.chapterPlan.id, arc.sourceChapterId))
        .limit(1);
      const [opt] = await creativeDb
        .select({ id: schema.chapterBranchOption.id })
        .from(schema.chapterBranchOption)
        .where(and(
          eq(schema.chapterBranchOption.sourceChapterPlanId, arc.sourceChapterId!),
          eq(schema.chapterBranchOption.isSelected, true),
        ))
        .limit(1);
      if (srcPlan && opt) {
        await rollbackBranchImpacts(creativeDb, arc.projectId, opt.id, srcPlan.chapterNo + 1);
      }
    }
    void snap;
  } catch (e: any) {
    return { ok: true, error: `已废弃，但状态回滚失败（可人工检查影响快照）: ${e?.message || e}` };
  }
  return { ok: true };
}

export type NewElementKind = 'characters' | 'locations' | 'foreshadows' | 'items';

/** 登记弧内新元素（去重追加） */
export async function registerNewElement(
  arcId: number,
  kind: NewElementKind,
  ref: { id?: number; table?: string; name: string },
) {
  const [arc] = await creativeDb.select().from(schema.branchArc).where(eq(schema.branchArc.id, arcId)).limit(1);
  if (!arc) return null;
  const elements: Record<string, any[]> = { characters: [], locations: [], foreshadows: [], items: [], ...(arc.newElements as any) };
  const list = Array.isArray(elements[kind]) ? elements[kind] : [];
  if (!list.some((x) => x.name === ref.name && (x.id ?? null) === (ref.id ?? null))) {
    list.push(ref);
  }
  elements[kind] = list;
  const [row] = await creativeDb
    .update(schema.branchArc)
    .set({ newElements: elements })
    .where(eq(schema.branchArc.id, arcId))
    .returning();
  return row;
}

/**
 * 提拔分支元素为主线：
 * - foreshadows：伏笔线确认生效（isConfirmed=true）+ 优先级提升
 * - tasks（items 复用）：任务线确认生效
 * - characters/locations：自定义实体 draft → official（主线可引用）
 */
export async function promoteElement(
  kind: NewElementKind,
  ref: { id?: number; table?: string; name: string },
): Promise<{ ok: boolean; message: string }> {
  if (!ref.id) return { ok: false, message: '缺少元素 ID，无法提拔' };
  try {
    if (kind === 'foreshadows') {
      await creativeDb
        .update(schema.foreshadowThread)
        .set({ isConfirmed: true, priority: 'high', updatedAt: new Date() })
        .where(eq(schema.foreshadowThread.id, ref.id));
      return { ok: true, message: '伏笔已提拔为主线关键（确认生效+高优先级）' };
    }
    if (kind === 'items') {
      await creativeDb
        .update(schema.taskArc)
        .set({ isConfirmed: true, priority: 'high', updatedAt: new Date() })
        .where(eq(schema.taskArc.id, ref.id));
      return { ok: true, message: '任务线已提拔为主线关键（确认生效+高优先级）' };
    }
    if (kind === 'characters') {
      await creativeDb
        .update(schema.customCharacter)
        .set({ entityStatus: 'official', updatedAt: new Date() })
        .where(eq(schema.customCharacter.id, ref.id));
      return { ok: true, message: '人物已提拔为主线正式实体' };
    }
    // locations
    await creativeDb
      .update(schema.customLocation)
      .set({ entityStatus: 'official', updatedAt: new Date() })
      .where(eq(schema.customLocation.id, ref.id));
    return { ok: true, message: '地点已提拔为主线正式实体' };
  } catch (e: any) {
    return { ok: false, message: `提拔失败: ${e?.message || e}` };
  }
}
