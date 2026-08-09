/**
 * 叙事债务聚合服务（架构升级 Epic4）
 * 聚合 foreshadow_thread + causal_chain + task_arc 三表，产出债务总览/健康度/回收建议
 * 接口设计预留 Epic9「世界状态总览」复用（getNarrativeDebtSummary 可整体嵌入世界状态面板）
 */
import { eq, and } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';

export interface DebtRecommendation {
  /** 债务来源类型 */
  type: 'foreshadow' | 'causal_chain' | 'task_arc';
  id: number;
  title: string;
  priority: string;
  /** 逾期章数（未逾期为 0） */
  overdueChapters: number;
  /** 计划兑现/完成章节 */
  dueChapter: number | null;
  reason: string;
}

export interface NarrativeDebtResult {
  currentChapterNo: number;
  foreshadowSummary: {
    total: number;
    byStatus: Record<string, number>;
    overdueCount: number;
    unresolvedCount: number;
  };
  causalChainSummary: {
    total: number;
    byStatus: Record<string, number>;
    debtTypeCount: number;
    overdueCount: number;
    openCount: number;
  };
  taskArcSummary: {
    total: number;
    byStatus: Record<string, number>;
    overdueCount: number;
    openCount: number;
  };
  /** 债务健康度 0-100，越高越健康 */
  healthScore: number;
  healthGrade: 'excellent' | 'good' | 'warning' | 'critical';
  recommendations: DebtRecommendation[];
}

const PRIORITY_WEIGHT: Record<string, number> = { high: 3, normal: 2, low: 1 };

/** 项目当前进度章号（已生成的最大章节号） */
export async function getCurrentChapterNo(projectId: number): Promise<number> {
  const rows = await creativeDb
    .select({ chapterNo: schema.chapterPlan.chapterNo })
    .from(schema.chapterPlan)
    .where(and(eq(schema.chapterPlan.projectId, projectId), eq(schema.chapterPlan.status, 'generated')));
  return rows.reduce((max, r) => Math.max(max, r.chapterNo ?? 0), 0);
}

/** 聚合叙事债务总览（Epic9 世界状态总览可直接复用本函数） */
export async function getNarrativeDebtSummary(projectId: number): Promise<NarrativeDebtResult> {
  const currentChapterNo = await getCurrentChapterNo(projectId);

  const [foreshadows, chains, arcs] = await Promise.all([
    creativeDb.select().from(schema.foreshadowThread).where(eq(schema.foreshadowThread.projectId, projectId)),
    creativeDb.select().from(schema.causalChain).where(eq(schema.causalChain.projectId, projectId)),
    creativeDb.select().from(schema.taskArc).where(eq(schema.taskArc.projectId, projectId)),
  ]);

  // ---- 伏笔 ----
  const fByStatus: Record<string, number> = {};
  for (const f of foreshadows) fByStatus[f.status] = (fByStatus[f.status] || 0) + 1;
  const fOverdue = foreshadows.filter(
    (f) => f.status === 'planted' && f.resolveChapter != null && f.resolveChapter < currentChapterNo
  );
  const fUnresolved = foreshadows.filter((f) => f.status === 'pending' || f.status === 'planted');

  // ---- 因果链 ----
  const cByStatus: Record<string, number> = {};
  for (const ch of chains) cByStatus[ch.status] = (cByStatus[ch.status] || 0) + 1;
  const cOpen = chains.filter((ch) => ch.status !== 'resolved' && ch.status !== 'expired');
  const cOverdue = cOpen.filter((ch) => ch.targetChapterMax != null && ch.targetChapterMax < currentChapterNo);
  const cDebtType = chains.filter((ch) => ch.causeType === 'debt');

  // ---- 任务弧 ----
  const tByStatus: Record<string, number> = {};
  for (const a of arcs) tByStatus[a.status] = (tByStatus[a.status] || 0) + 1;
  const tOpen = arcs.filter((a) => a.status === 'active' || a.status === 'progressing');
  const tOverdue = tOpen.filter((a) => a.targetChapter != null && a.targetChapter < currentChapterNo);

  // ---- 健康度评分：基于逾期比例 + 平均逾期章数 ----
  const totalOpen = fUnresolved.length + cOpen.length + tOpen.length;
  const totalOverdue = fOverdue.length + cOverdue.length + tOverdue.length;
  const overdueChaptersList: number[] = [
    ...fOverdue.map((f) => currentChapterNo - (f.resolveChapter ?? currentChapterNo)),
    ...cOverdue.map((ch) => currentChapterNo - (ch.targetChapterMax ?? currentChapterNo)),
    ...tOverdue.map((a) => currentChapterNo - (a.targetChapter ?? currentChapterNo)),
  ];
  const overdueRatio = totalOpen > 0 ? totalOverdue / totalOpen : 0;
  const avgOverdue = overdueChaptersList.length
    ? overdueChaptersList.reduce((s, n) => s + n, 0) / overdueChaptersList.length
    : 0;
  const healthScore = Math.round(
    Math.max(0, Math.min(100, 100 - overdueRatio * 60 - Math.min(avgOverdue, 10) * 3))
  );
  const healthGrade = healthScore >= 85 ? 'excellent' : healthScore >= 70 ? 'good' : healthScore >= 50 ? 'warning' : 'critical';

  // ---- 回收建议：优先级权重 + 逾期程度加权排序 ----
  const recommendations: DebtRecommendation[] = [];
  for (const f of foreshadows.filter((x) => x.status === 'pending' || x.status === 'planted')) {
    const overdue = f.resolveChapter != null ? Math.max(0, currentChapterNo - f.resolveChapter) : 0;
    recommendations.push({
      type: 'foreshadow',
      id: f.id,
      title: f.title,
      priority: f.priority || 'normal',
      overdueChapters: overdue,
      dueChapter: f.resolveChapter,
      reason: overdue > 0 ? `已逾期${overdue}章（计划第${f.resolveChapter}章回收）` : f.resolveChapter != null ? `计划第${f.resolveChapter}章回收` : '未设回收章节',
    });
  }
  for (const ch of cOpen) {
    const overdue = ch.targetChapterMax != null ? Math.max(0, currentChapterNo - ch.targetChapterMax) : 0;
    recommendations.push({
      type: 'causal_chain',
      id: ch.id,
      title: ch.causeDescription?.slice(0, 60) || `因果链#${ch.id}`,
      priority: ch.priority >= 7 ? 'high' : ch.priority >= 4 ? 'normal' : 'low',
      overdueChapters: overdue,
      dueChapter: ch.targetChapterMax,
      reason: overdue > 0 ? `已逾期${overdue}章（兑现窗口至第${ch.targetChapterMax}章）` : ch.targetChapterMax != null ? `兑现窗口至第${ch.targetChapterMax}章` : '未设兑现窗口',
    });
  }
  for (const a of tOpen) {
    const overdue = a.targetChapter != null ? Math.max(0, currentChapterNo - a.targetChapter) : 0;
    recommendations.push({
      type: 'task_arc',
      id: a.id,
      title: a.title,
      priority: a.priority || 'normal',
      overdueChapters: overdue,
      dueChapter: a.targetChapter,
      reason: overdue > 0 ? `已逾期${overdue}章（目标第${a.targetChapter}章完成）` : a.targetChapter != null ? `目标第${a.targetChapter}章完成` : '未设目标章节',
    });
  }

  recommendations.sort((x, y) => {
    // 逾期项优先；其次优先级权重；再次截止章近的优先
    if (x.overdueChapters !== y.overdueChapters) return y.overdueChapters - x.overdueChapters;
    const pw = (PRIORITY_WEIGHT[y.priority] || 2) - (PRIORITY_WEIGHT[x.priority] || 2);
    if (pw !== 0) return pw;
    return (x.dueChapter ?? Infinity) - (y.dueChapter ?? Infinity);
  });

  return {
    currentChapterNo,
    foreshadowSummary: {
      total: foreshadows.length,
      byStatus: fByStatus,
      overdueCount: fOverdue.length,
      unresolvedCount: fUnresolved.length,
    },
    causalChainSummary: {
      total: chains.length,
      byStatus: cByStatus,
      debtTypeCount: cDebtType.length,
      overdueCount: cOverdue.length,
      openCount: cOpen.length,
    },
    taskArcSummary: {
      total: arcs.length,
      byStatus: tByStatus,
      overdueCount: tOverdue.length,
      openCount: tOpen.length,
    },
    healthScore,
    healthGrade,
    recommendations: recommendations.slice(0, 20),
  };
}
