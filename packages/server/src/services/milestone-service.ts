/**
 * 叙事里程碑服务（动态叙事引擎 v2.1 · 第一层：故事的骨架）
 *
 * - 从卷大纲 keyEvents 提取里程碑（critical=卷首尾关键事件，major=其余）
 * - CRUD / 排序 / 状态流转（upcoming → active → reached / skipped）
 * - getNextMilestone：供 Writer 双轨注入「下一个里程碑方向」
 *
 * 与 timeline_milestone 共存各管各的：timeline 管世界时间线（绑 chapterNo），
 * 本服务管叙事结构（不硬绑章节号，targetChapterFrom/To 仅为预估范围）。
 */
import { eq, and, asc } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import type { KeyEventEntry } from './outline-writeback.js';

export type MilestoneStatus = 'upcoming' | 'active' | 'reached' | 'skipped';
export type MilestoneImportance = 'critical' | 'major' | 'minor';

/** keyEvents 单条目的宽松结构（与 outline-writeback 共享语义） */
type KeyEvent = KeyEventEntry;

/**
 * 从项目全部卷大纲的 keyEvents 提取叙事里程碑（幂等：已存在同 outline+label 的跳过）。
 * critical 判定：每卷首、尾两个 keyEvent 视为关键里程碑；其余 major。
 * chapterNumber 仅映射为预估章节范围（from=chapterNumber, to=chapterNumber+1），不硬绑定。
 */
export async function extractMilestonesFromOutlines(
  projectId: number,
  outlineId?: number,
): Promise<{ created: number; skipped: number }> {
  const outlines = await creativeDb
    .select()
    .from(schema.storyOutline)
    .where(
      outlineId
        ? and(eq(schema.storyOutline.projectId, projectId), eq(schema.storyOutline.id, outlineId))
        : eq(schema.storyOutline.projectId, projectId),
    );

  const existing = await creativeDb
    .select({ outlineId: schema.narrativeMilestone.outlineId, label: schema.narrativeMilestone.label })
    .from(schema.narrativeMilestone)
    .where(eq(schema.narrativeMilestone.projectId, projectId));
  const existSet = new Set(existing.map((e) => `${e.outlineId ?? ''}|${e.label}`));

  // 排序基数：沿用现有最大 sortOrder
  const allMilestones = await creativeDb
    .select({ sortOrder: schema.narrativeMilestone.sortOrder })
    .from(schema.narrativeMilestone)
    .where(eq(schema.narrativeMilestone.projectId, projectId));
  let order = allMilestones.length ? Math.max(...allMilestones.map((m) => m.sortOrder ?? 0)) + 1 : 0;

  let created = 0;
  let skipped = 0;

  for (const outline of outlines) {
    const events = (Array.isArray(outline.keyEvents) ? outline.keyEvents : []) as KeyEvent[];
    if (!events.length) continue;
    // 卷内按 chapterNumber 排序，首尾判 critical
    const sorted = [...events].sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
    const criticalIdx = new Set<number>();
    if (sorted.length > 0) criticalIdx.add(0);
    if (sorted.length > 1) criticalIdx.add(sorted.length - 1);

    for (let i = 0; i < sorted.length; i++) {
      const ev = sorted[i];
      const label = (ev.title || '').trim().slice(0, 200);
      if (!label) continue;
      const key = `${outline.id}|${label}`;
      if (existSet.has(key)) { skipped++; continue; }
      existSet.add(key);

      const chNo = typeof ev.chapterNumber === 'number' ? ev.chapterNumber : null;
      await creativeDb.insert(schema.narrativeMilestone).values({
        projectId,
        outlineId: outline.id,
        label,
        description: typeof ev.intent === 'string' ? ev.intent : null,
        mustHappen: ev.intent ? [ev.intent] : [],
        keyCharacterIds: [],
        targetChapterFrom: chNo,
        targetChapterTo: chNo != null ? chNo + 1 : null,
        status: 'upcoming',
        importance: criticalIdx.has(i) ? 'critical' : 'major',
        sortOrder: order++,
      });
      created++;
    }
  }

  return { created, skipped };
}

/** 列表（按 sortOrder） */
export async function listMilestones(projectId: number) {
  return creativeDb
    .select()
    .from(schema.narrativeMilestone)
    .where(eq(schema.narrativeMilestone.projectId, projectId))
    .orderBy(asc(schema.narrativeMilestone.sortOrder), asc(schema.narrativeMilestone.id));
}

/** 手动新增 */
export async function createMilestone(
  projectId: number,
  data: {
    label: string;
    description?: string | null;
    mustHappen?: string[];
    keyCharacterIds?: number[];
    targetChapterFrom?: number | null;
    targetChapterTo?: number | null;
    importance?: MilestoneImportance;
    outlineId?: number | null;
  },
) {
  const rows = await listMilestones(projectId);
  const nextOrder = rows.length ? Math.max(...rows.map((m) => m.sortOrder ?? 0)) + 1 : 0;
  const [row] = await creativeDb.insert(schema.narrativeMilestone).values({
    projectId,
    outlineId: data.outlineId ?? null,
    label: data.label.trim().slice(0, 200),
    description: data.description ?? null,
    mustHappen: data.mustHappen ?? [],
    keyCharacterIds: data.keyCharacterIds ?? [],
    targetChapterFrom: data.targetChapterFrom ?? null,
    targetChapterTo: data.targetChapterTo ?? null,
    status: 'upcoming',
    importance: data.importance ?? 'major',
    sortOrder: nextOrder,
  }).returning();
  return row;
}

/** 更新（含状态流转与排序） */
export async function updateMilestone(
  id: number,
  patch: Partial<{
    label: string;
    description: string | null;
    mustHappen: string[];
    keyCharacterIds: number[];
    targetChapterFrom: number | null;
    targetChapterTo: number | null;
    status: MilestoneStatus;
    importance: MilestoneImportance;
    sortOrder: number;
  }>,
) {
  const [row] = await creativeDb
    .update(schema.narrativeMilestone)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.narrativeMilestone.id, id))
    .returning();
  return row ?? null;
}

export async function deleteMilestone(id: number) {
  await creativeDb.delete(schema.narrativeMilestone).where(eq(schema.narrativeMilestone.id, id));
}

/** 批量重排：按传入 id 顺序重写 sortOrder */
export async function reorderMilestones(projectId: number, orderedIds: number[]) {
  let order = 0;
  for (const id of orderedIds) {
    await creativeDb
      .update(schema.narrativeMilestone)
      .set({ sortOrder: order++, updatedAt: new Date() })
      .where(and(eq(schema.narrativeMilestone.id, id), eq(schema.narrativeMilestone.projectId, projectId)));
  }
}

/**
 * 取「下一个待到达里程碑」：按 sortOrder 找第一个 upcoming/active。
 * 供 Writer/Auditor 双轨注入与分支弧默认汇合目标。
 */
export async function getNextMilestone(projectId: number) {
  const rows = await creativeDb
    .select()
    .from(schema.narrativeMilestone)
    .where(eq(schema.narrativeMilestone.projectId, projectId))
    .orderBy(asc(schema.narrativeMilestone.sortOrder), asc(schema.narrativeMilestone.id));
  return rows.find((m) => m.status === 'active' || m.status === 'upcoming') ?? null;
}

/** 取最近一个已到达/进行中的里程碑（分支弧的 sourceMilestone 兜底） */
export async function getLastReachedMilestone(projectId: number) {
  const rows = await creativeDb
    .select()
    .from(schema.narrativeMilestone)
    .where(eq(schema.narrativeMilestone.projectId, projectId))
    .orderBy(asc(schema.narrativeMilestone.sortOrder), asc(schema.narrativeMilestone.id));
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].status === 'reached' || rows[i].status === 'active') return rows[i];
  }
  return null;
}
