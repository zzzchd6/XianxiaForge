/**
 * 因果链服务层（阶段4）
 *
 * 职责：
 *   - 因果线 CRUD + 五态生命周期流转（planted→foreshadowed→triggered→resolved/expired）
 *   - 为 Writer 构建待回收因果上下文块
 *   - 为 Auditor / health-check 提供因果统计
 *
 * 红线：因果链异常不阻断生成主流程（调用方 try/catch 降级）。
 */
import { eq, and, lte, inArray, desc, sql } from 'drizzle-orm';
import { creativeDb } from '../../db/index.js';
import * as schema from '../../db/creative-schema.js';

// ─── 类型 ───────────────────────────────────────────────────────────────────────

export type CausalStatus = 'planted' | 'foreshadowed' | 'triggered' | 'resolved' | 'expired';

export interface CreateCausalChainInput {
  projectId: number;
  sourceType: 'branch' | 'event' | 'manual';
  sourceId?: number | null;
  sourceChapterNo: number;
  causeType: string;
  causeDescription: string;
  effectType?: string | null;
  effectDescription?: string | null;
  targetChapterMin?: number | null;
  targetChapterMax?: number | null;
  priority?: number;
  strength?: number;
  directionCode?: string | null;
  parentChainId?: number | null;
  tags?: string[];
}

export interface CausalChainStats {
  total: number;
  planted: number;
  foreshadowed: number;
  triggered: number;
  resolved: number;
  expired: number;
  /** 逾期未兑现（status in planted/foreshadowed 且 target_chapter_max < currentChapter） */
  overdue: number;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────────

/** 创建因果线（埋因） */
export async function createCausalChain(db: any, input: CreateCausalChainInput) {
  const [row] = await db
    .insert(schema.causalChain)
    .values({
      projectId: input.projectId,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      sourceChapterNo: input.sourceChapterNo,
      causeType: input.causeType,
      causeDescription: input.causeDescription,
      effectType: input.effectType ?? null,
      effectDescription: input.effectDescription ?? null,
      targetChapterMin: input.targetChapterMin ?? null,
      targetChapterMax: input.targetChapterMax ?? null,
      priority: input.priority ?? 5,
      strength: input.strength ?? 50,
      directionCode: input.directionCode ?? null,
      parentChainId: input.parentChainId ?? null,
      tags: input.tags ?? [],
      status: 'planted',
    })
    .returning();
  return row;
}

/** 查询因果线列表（支持状态/章节过滤） */
export async function getCausalChains(
  projectId: number,
  opts?: { status?: CausalStatus[]; upToChapter?: number; limit?: number },
) {
  const conditions = [eq(schema.causalChain.projectId, projectId)];
  if (opts?.status?.length) {
    conditions.push(inArray(schema.causalChain.status, opts.status));
  }
  if (opts?.upToChapter != null) {
    conditions.push(lte(schema.causalChain.sourceChapterNo, opts.upToChapter));
  }
  return creativeDb
    .select()
    .from(schema.causalChain)
    .where(and(...conditions))
    .orderBy(desc(schema.causalChain.priority), desc(schema.causalChain.sourceChapterNo))
    .limit(opts?.limit ?? 100);
}

/** 获取单条因果线 */
export async function getCausalChainById(id: number) {
  const [row] = await creativeDb
    .select()
    .from(schema.causalChain)
    .where(eq(schema.causalChain.id, id));
  return row ?? null;
}

// ─── 生命周期流转 ─────────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<CausalStatus, CausalStatus[]> = {
  planted: ['foreshadowed', 'triggered', 'resolved', 'expired'],
  foreshadowed: ['triggered', 'resolved', 'expired'],
  triggered: ['resolved', 'expired'],
  resolved: [],
  expired: [],
};

/** 更新因果线状态（校验合法流转） */
export async function updateCausalChainStatus(
  db: any,
  id: number,
  newStatus: CausalStatus,
  extra?: { resolvedChapterNo?: number; resolvedTaskId?: number; resolutionNote?: string },
) {
  const [current] = await db
    .select({ status: schema.causalChain.status })
    .from(schema.causalChain)
    .where(eq(schema.causalChain.id, id));
  if (!current) throw new Error(`因果线 #${id} 不存在`);
  const allowed = VALID_TRANSITIONS[current.status as CausalStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error(`非法状态流转: ${current.status} → ${newStatus}`);
  }
  const patch: any = { status: newStatus, updatedAt: new Date() };
  if (newStatus === 'resolved') {
    patch.resolvedChapterNo = extra?.resolvedChapterNo ?? null;
    patch.resolvedTaskId = extra?.resolvedTaskId ?? null;
    patch.resolutionNote = extra?.resolutionNote ?? null;
  }
  const [updated] = await db
    .update(schema.causalChain)
    .set(patch)
    .where(eq(schema.causalChain.id, id))
    .returning();
  return updated;
}

/**
 * 自动过期：将 target_chapter_max < currentChapter 且仍为 planted/foreshadowed 的因果线标记为 expired。
 * 在章节生成完成后调用（best-effort）。
 */
export async function expireOverdueChains(db: any, projectId: number, currentChapter: number) {
  const overdue = await db
    .update(schema.causalChain)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(and(
      eq(schema.causalChain.projectId, projectId),
      inArray(schema.causalChain.status, ['planted', 'foreshadowed']),
      lte(schema.causalChain.targetChapterMax, currentChapter),
    ))
    .returning({ id: schema.causalChain.id });
  return overdue.length;
}

// ─── Writer 上下文构建 ─────────────────────────────────────────────────────────────

export interface CausalContextItem {
  id: number;
  causeType: string;
  causeDescription: string;
  effectType: string | null;
  effectDescription: string | null;
  sourceChapterNo: number;
  strength: number;
  priority: number;
  status: CausalStatus;
  /** 距离最晚兑现章的剩余章数（负数=已逾期） */
  chaptersRemaining: number | null;
}

/**
 * 构建当前章节的因果上下文（供 Writer prompt 注入）。
 * 返回 planted/foreshadowed/triggered 状态、且 targetChapterMin <= chapterNo 的因果线，
 * 按 priority DESC + strength DESC 排序，最多 5 条。
 */
export async function buildCausalContext(
  projectId: number,
  chapterNo: number,
): Promise<CausalContextItem[]> {
  try {
    const rows = await creativeDb
      .select()
      .from(schema.causalChain)
      .where(and(
        eq(schema.causalChain.projectId, projectId),
        inArray(schema.causalChain.status, ['planted', 'foreshadowed', 'triggered']),
      ))
      .orderBy(desc(schema.causalChain.priority), desc(schema.causalChain.strength))
      .limit(20);

    return rows
      .filter((r: any) => r.targetChapterMin == null || r.targetChapterMin <= chapterNo)
      .slice(0, 5)
      .map((r: any) => ({
        id: r.id,
        causeType: r.causeType,
        causeDescription: r.causeDescription,
        effectType: r.effectType,
        effectDescription: r.effectDescription,
        sourceChapterNo: r.sourceChapterNo,
        strength: r.strength,
        priority: r.priority,
        status: r.status as CausalStatus,
        chaptersRemaining: r.targetChapterMax != null ? r.targetChapterMax - chapterNo : null,
      }));
  } catch (e: any) {
    console.warn(`[因果链] buildCausalContext 失败（降级为空）: ${e?.message || e}`);
    return [];
  }
}

/** 格式化因果上下文为 prompt 文本块 */
export function formatCausalContextBlock(items: CausalContextItem[]): string | null {
  if (!items.length) return null;
  const lines = items.map((it) => {
    const urgency = it.chaptersRemaining != null
      ? (it.chaptersRemaining <= 0 ? '【已逾期!】' : `余${it.chaptersRemaining}章`)
      : '';
    const effect = it.effectDescription ? `→预期:${it.effectDescription}` : '';
    return `- [${it.causeType}] ${it.causeDescription} ${effect} (第${it.sourceChapterNo}章埋下,强度${it.strength},${urgency})`;
  });
  return lines.join('\n');
}

// ─── 统计（供 health-check / Auditor） ─────────────────────────────────────────────

/** 因果链统计 */
export async function getCausalStats(projectId: number, currentChapter?: number): Promise<CausalChainStats> {
  const rows = await creativeDb
    .select({
      status: schema.causalChain.status,
      targetChapterMax: schema.causalChain.targetChapterMax,
    })
    .from(schema.causalChain)
    .where(eq(schema.causalChain.projectId, projectId));

  const stats: CausalChainStats = { total: rows.length, planted: 0, foreshadowed: 0, triggered: 0, resolved: 0, expired: 0, overdue: 0 };
  for (const r of rows as any[]) {
    const s = r.status as CausalStatus;
    if (s in stats) (stats as any)[s]++;
    if ((s === 'planted' || s === 'foreshadowed') && currentChapter != null && r.targetChapterMax != null && r.targetChapterMax < currentChapter) {
      stats.overdue++;
    }
  }
  return stats;
}
