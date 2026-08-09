/**
 * 叙事体检路由（天命P2#7）
 * GET /api/projects/:id/health?volumeNo= 执行体检并返回报告
 */
import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as creative from '../db/creative-schema.js';
import { runHealthCheck } from '../services/health-check.js';

const app = new Hono();

/** 待办中心：超期伏笔阈值（埋设后敞开超过 N 章未回收即视为超期） */
const TODO_OVERDUE_THRESHOLD = 10;

/**
 * 计算项目当前创作进度章节号（与 foreshadow.ts 同思路）：
 * 优先取已生成章节(isCurrent)的最大章节号，缺省退回章节计划最大章节号，再缺省为 0
 */
async function getTodoCurrentChapter(projectId: number): Promise<number> {
  const [gen] = await creativeDb
    .select({ chapterNo: creative.generatedChapter.chapterNo })
    .from(creative.generatedChapter)
    .where(
      and(
        eq(creative.generatedChapter.projectId, projectId),
        eq(creative.generatedChapter.isCurrent, true)
      )
    )
    .orderBy(desc(creative.generatedChapter.chapterNo))
    .limit(1);
  if (gen) return gen.chapterNo ?? 0;

  const [plan] = await creativeDb
    .select({ chapterNo: creative.chapterPlan.chapterNo })
    .from(creative.chapterPlan)
    .where(eq(creative.chapterPlan.projectId, projectId))
    .orderBy(desc(creative.chapterPlan.chapterNo))
    .limit(1);
  return plan?.chapterNo ?? 0;
}

/** GET /api/projects/:id/health?volumeNo= 执行叙事体检 */
app.get('/projects/:id/health', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const volumeNoParam = c.req.query('volumeNo');
    const volumeNo = volumeNoParam ? Number(volumeNoParam) : null;

    const report = await runHealthCheck(projectId, volumeNo && !isNaN(volumeNo) ? volumeNo : null);
    return c.json({ success: true, data: report });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * GET /api/projects/:id/health/todo 全局待办中心聚合
 * 汇总当前项目需关注事项：
 *  1. overdueForeshadows  超期伏笔（status='planted' 且敞开 >= 10 章，按 chaptersOpen 降序取前5）
 *  2. highPriorityPending 高优先级待埋入伏笔（status='pending' AND priority='high'，全部）
 *  3. failedTasks         最近5条生成失败任务（status='failed'）
 */
app.get('/projects/:id/health/todo', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const currentChapter = await getTodoCurrentChapter(projectId);

    // 1. 超期伏笔：已埋设且敞开章节数 >= 阈值，按敞开数降序取前5
    const overdueRows = await creativeDb
      .select({
        id: creative.foreshadowThread.id,
        title: creative.foreshadowThread.title,
        plantChapter: creative.foreshadowThread.plantChapter,
        tier: creative.foreshadowThread.tier,
        chaptersOpen: sql<number>`greatest(0, ${currentChapter} - coalesce(${creative.foreshadowThread.plantChapter}, ${currentChapter}))`,
      })
      .from(creative.foreshadowThread)
      .where(
        and(
          eq(creative.foreshadowThread.projectId, projectId),
          eq(creative.foreshadowThread.status, 'planted'),
          sql`greatest(0, ${currentChapter} - coalesce(${creative.foreshadowThread.plantChapter}, ${currentChapter})) >= ${TODO_OVERDUE_THRESHOLD}`
        )
      )
      .orderBy(desc(sql`greatest(0, ${currentChapter} - coalesce(${creative.foreshadowThread.plantChapter}, ${currentChapter}))`))
      .limit(5);

    const overdueForeshadows = overdueRows.map((r) => ({
      id: r.id,
      title: r.title,
      plantChapter: r.plantChapter,
      chaptersOpen: Number(r.chaptersOpen),
      tier: r.tier ?? 't3',
    }));

    // 2. 高优先级待埋入伏笔：全部返回
    const pendingRows = await creativeDb
      .select({
        id: creative.foreshadowThread.id,
        title: creative.foreshadowThread.title,
        priority: creative.foreshadowThread.priority,
      })
      .from(creative.foreshadowThread)
      .where(
        and(
          eq(creative.foreshadowThread.projectId, projectId),
          eq(creative.foreshadowThread.status, 'pending'),
          eq(creative.foreshadowThread.priority, 'high')
        )
      )
      .orderBy(creative.foreshadowThread.id);

    const highPriorityPending = pendingRows.map((r) => ({
      id: r.id,
      title: r.title,
      priority: r.priority,
    }));

    // 3. 生成失败任务：最近5条
    const failedRows = await creativeDb
      .select({
        id: creative.generationTask.id,
        chapterPlanId: creative.generationTask.chapterPlanId,
        error: creative.generationTask.errorMessage,
        createdAt: creative.generationTask.createdAt,
      })
      .from(creative.generationTask)
      .where(
        and(
          eq(creative.generationTask.projectId, projectId),
          eq(creative.generationTask.status, 'failed')
        )
      )
      .orderBy(desc(creative.generationTask.createdAt))
      .limit(5);

    const failedTasks = failedRows.map((r) => ({
      id: r.id,
      chapterPlanId: r.chapterPlanId,
      error: r.error,
      createdAt: r.createdAt,
    }));

    const totalCount = overdueForeshadows.length + highPriorityPending.length + failedTasks.length;

    return c.json({
      success: true,
      data: { overdueForeshadows, highPriorityPending, failedTasks, totalCount },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:id/health/score-trend 故事心电图：各章文风审计得分趋势 */
app.get('/projects/:id/health/score-trend', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const rows = await creativeDb
      .select({
        chapterNo: creative.chapterPlan.chapterNo,
        title: creative.chapterPlan.title,
        score: creative.styleAuditRecord.overallScore,
        createdAt: creative.styleAuditRecord.createdAt,
      })
      .from(creative.styleAuditRecord)
      .innerJoin(creative.chapterPlan, eq(creative.chapterPlan.id, creative.styleAuditRecord.chapterPlanId))
      .where(eq(creative.chapterPlan.projectId, projectId))
      .orderBy(creative.chapterPlan.chapterNo);

    const points = rows.map((r) => ({
      chapterNo: r.chapterNo,
      title: r.title,
      score: r.score,
      createdAt: r.createdAt,
    }));

    return c.json({ success: true, data: { points } });
  } catch {
    // 表不存在或查询出错时返回空数组，前端不渲染
    return c.json({ success: true, data: { points: [] } });
  }
});

/** POST /api/projects/:id/health/self-check-audit - 自查清单定向审计（FUNC-08） */
app.post('/projects/:id/health/self-check-audit', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const body = await c.req.json().catch(() => ({}));
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text || text.length < 50) {
      return c.json({ success: false, error: '正文过短（至少50字）' }, 400);
    }

    // 构造简易 ContextPackage（仅填充人物名，其余留空）
    const context = {
      characters: (body?.characterNames as string[] || []).map((n: string) => ({
        name: n, personality: '', coreSkills: [], faction: '',
        currentRealm: '', currentStatus: '', isCustom: false,
      })),
      factions: [], locations: [], skills: [], items: [], relations: [],
      style: undefined, worldviewContext: '', collectedQuotes: undefined,
    };

    const { auditorAgent } = await import('../agents/auditor.js');
    const report = await auditorAgent.auditChapter(text, context as any);

    return c.json({ success: true, data: report });
  } catch (error: any) {
    console.error('[self-check-audit]', error);
    return c.json({ success: false, error: `审计失败: ${error.message}` }, 500);
  }
});

export default app;
