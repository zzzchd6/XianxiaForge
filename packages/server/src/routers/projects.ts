/**
 * 项目管理路由
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc, and } from 'drizzle-orm';
import { creativeDb, creativeClient } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { getSelectedDirectionChain, computeDirectionStats, checkConsecutiveDirection } from '../services/direction.service.js';
import { runPostUpdateWorkflow, POST_UPDATE_STEPS } from '../workflows/postUpdate.js';
import { getNarrativeDebtSummary } from '../services/narrativeDebt.js';
import type { LlmConfig } from '../types.js';

const app = new Hono();

// 创建项目验证
const createProjectSchema = z.object({
  title: z.string().min(1).max(255),
  genre: z.string().max(100).optional().default('玄幻'),
  description: z.string().optional(),
  llmConfig: z.object({
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(100).max(32000).optional(),
  }).optional(),
});

// 更新项目验证
const updateProjectSchema = createProjectSchema.partial().extend({
  status: z.enum(['planning', 'writing', 'reviewing', 'completed', 'archived']).optional(),
  storyEngineType: z.string().max(32).nullable().optional(),
  storyEngineDesc: z.string().nullable().optional(),
  generationConfig: z.record(z.any()).optional(),
  defaultImpactCharacterIds: z.array(z.number().int()).optional(),
});

/** GET /api/projects - 项目列表 */
app.get('/', async (c) => {
  try {
    const projects = await creativeDb
      .select()
      .from(schema.creativeProject)
      .orderBy(schema.creativeProject.createdAt);
    return c.json({ success: true, data: projects });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects - 创建项目 */
app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const [project] = await creativeDb
      .insert(schema.creativeProject)
      .values({
        title: parsed.data.title,
        genre: parsed.data.genre,
        description: parsed.data.description || null,
        llmConfig: parsed.data.llmConfig || null,
      })
      .returning();

    return c.json({ success: true, data: project }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:id - 项目详情 */
app.get('/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }

    const [project] = await creativeDb
      .select()
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, id))
      .limit(1);

    if (!project) {
      return c.json({ success: false, error: '项目不存在' }, 404);
    }

    // 获取关联的规则
    const rules = await creativeDb
      .select()
      .from(schema.authorRules)
      .where(eq(schema.authorRules.projectId, id));

    return c.json({ success: true, data: { ...project, rules } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:id/creation-stats?days=365 - 创作统计（模块14 热力图） */
app.get('/:id/creation-stats', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }
    const days = Math.min(Math.max(Number(c.req.query('days')) || 365, 1), 1000);

    // 按日期聚合每日字数与章节数（仅统计当前版本，避免重复计数历史版本）
    const rows = await creativeClient.unsafe(
      `SELECT to_char(created_at, 'YYYY-MM-DD') AS date,
              COALESCE(SUM(word_count), 0)::int AS words,
              COUNT(*)::int AS chapters
       FROM generated_chapter
       WHERE project_id = $1 AND is_current = true
         AND created_at >= (CURRENT_DATE - ($2 || ' days')::interval)
       GROUP BY 1 ORDER BY 1`,
      [id, days]
    );

    const daily = rows.map((r: any) => ({
      date: r.date,
      words: Number(r.words) || 0,
      chapters: Number(r.chapters) || 0,
    }));

    // 汇总与连续创作天数计算
    const byDate = new Map<string, number>(daily.map((d: any) => [d.date, d.words]));
    const totalWords = daily.reduce((s: number, d: any) => s + d.words, 0);
    const totalChapters = daily.reduce((s: number, d: any) => s + d.chapters, 0);
    const activeDays = daily.filter((d: any) => d.words > 0).length;

    // 从最近有创作的日期往回数连续天数
    const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
    let currentStreak = 0;
    const cursor = new Date();
    // 若今天尚无创作，从昨天起算（保持连续链不断）
    if (!byDate.get(fmt(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (byDate.get(fmt(cursor))) {
      currentStreak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    // 最长连续天数
    let longestStreak = 0;
    let run = 0;
    const sortedDates = daily.map((d: any) => d.date).sort();
    let prev: Date | null = null;
    for (const ds of sortedDates) {
      const cur = new Date(ds);
      if (prev && (cur.getTime() - prev.getTime()) === 86400000) {
        run++;
      } else {
        run = 1;
      }
      longestStreak = Math.max(longestStreak, run);
      prev = cur;
    }

    return c.json({
      success: true,
      data: {
        daily,
        summary: { totalWords, totalChapters, activeDays, currentStreak, longestStreak, days },
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/projects/:id - 更新项目 */
app.put('/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }

    const body = await c.req.json();
    const parsed = updateProjectSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.genre !== undefined) updateData.genre = parsed.data.genre;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.llmConfig !== undefined) updateData.llmConfig = parsed.data.llmConfig;
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
    if (parsed.data.storyEngineType !== undefined) updateData.storyEngineType = parsed.data.storyEngineType;
    if (parsed.data.storyEngineDesc !== undefined) updateData.storyEngineDesc = parsed.data.storyEngineDesc;
    if (parsed.data.generationConfig !== undefined) updateData.generationConfig = parsed.data.generationConfig;
    if (parsed.data.defaultImpactCharacterIds !== undefined) updateData.defaultImpactCharacterIds = parsed.data.defaultImpactCharacterIds;

    const [updated] = await creativeDb
      .update(schema.creativeProject)
      .set(updateData)
      .where(eq(schema.creativeProject.id, id))
      .returning();

    if (!updated) {
      return c.json({ success: false, error: '项目不存在' }, 404);
    }

    return c.json({ success: true, data: updated });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /api/projects/:id - 删除项目 */
app.delete('/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }

    const [deleted] = await creativeDb
      .delete(schema.creativeProject)
      .where(eq(schema.creativeProject.id, id))
      .returning();

    if (!deleted) {
      return c.json({ success: false, error: '项目不存在' }, 404);
    }

    return c.json({ success: true, message: '项目已删除' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:id/direction-stats?volumeNo= - 方向分布统计（按卷/全量） */
app.get('/:id/direction-stats', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }
    const volumeNoRaw = c.req.query('volumeNo');
    const volumeNo = volumeNoRaw !== undefined && volumeNoRaw !== '' ? Number(volumeNoRaw) : undefined;

    // 读取项目方向配置（启用大类）
    const [project] = await creativeDb
      .select({ generationConfig: schema.creativeProject.generationConfig })
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, id))
      .limit(1);
    if (!project) {
      return c.json({ success: false, error: '项目不存在' }, 404);
    }
    const directionConfig = ((project.generationConfig as any)?.directionConfig) ?? {};

    const chain = await getSelectedDirectionChain(id);
    const stats = computeDirectionStats(chain, {
      volumeNo: volumeNo !== undefined && !isNaN(volumeNo) ? volumeNo : undefined,
      enabledCategories: directionConfig.enabledCategories,
    });
    return c.json({ success: true, data: stats });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:id/direction-check?chapterNo= - 连续方向校验 */
app.get('/:id/direction-check', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }
    const chapterNo = Number(c.req.query('chapterNo'));
    if (isNaN(chapterNo)) {
      return c.json({ success: false, error: 'chapterNo 参数无效' }, 400);
    }

    const [project] = await creativeDb
      .select({ generationConfig: schema.creativeProject.generationConfig })
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, id))
      .limit(1);
    if (!project) {
      return c.json({ success: false, error: '项目不存在' }, 404);
    }
    const directionConfig = ((project.generationConfig as any)?.directionConfig) ?? {};
    const maxAllowed = Number(directionConfig.maxConsecutiveSameDirection) || 3;

    const chain = await getSelectedDirectionChain(id);
    const check = checkConsecutiveDirection(chain, chapterNo, maxAllowed);
    return c.json({ success: true, data: check });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:id/post-update - 手动触发后验更新工作流（架构升级 Epic2） */
app.post('/:id/post-update', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }

    const [project] = await creativeDb
      .select()
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, id))
      .limit(1);
    if (!project) {
      return c.json({ success: false, error: '项目不存在' }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const chapterPlanId = typeof body?.chapterPlanId === 'number' ? body.chapterPlanId : undefined;

    // 定位目标章节：指定 chapterPlanId 或项目最新已生成章节
    const chapters = chapterPlanId
      ? await creativeDb
          .select()
          .from(schema.generatedChapter)
          .where(and(eq(schema.generatedChapter.chapterPlanId, chapterPlanId), eq(schema.generatedChapter.isCurrent, true)))
          .limit(1)
      : await creativeDb
          .select()
          .from(schema.generatedChapter)
          .where(and(eq(schema.generatedChapter.projectId, id), eq(schema.generatedChapter.isCurrent, true)))
          .orderBy(desc(schema.generatedChapter.chapterNo))
          .limit(1);

    const chapter = chapters[0];
    if (!chapter || !chapter.chapterPlanId) {
      return c.json({ success: false, error: '未找到已生成的章节正文，无法运行后验更新' }, 404);
    }

    const [plan] = await creativeDb
      .select()
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.id, chapter.chapterPlanId))
      .limit(1);
    if (!plan) {
      return c.json({ success: false, error: '章节计划不存在' }, 404);
    }

    // 关联最近一次生成任务（供日志/检查点写入，无则为 null）
    const [lastTask] = await creativeDb
      .select({ id: schema.generationTask.id })
      .from(schema.generationTask)
      .where(eq(schema.generationTask.chapterPlanId, plan.id))
      .orderBy(desc(schema.generationTask.id))
      .limit(1);

    const genConfig = (project.generationConfig || {}) as Record<string, any>;
    const result = await runPostUpdateWorkflow({
      taskId: lastTask?.id ?? null,
      projectId: project.id,
      planId: plan.id,
      volumeNo: plan.volumeNo,
      chapterNo: plan.chapterNo,
      title: plan.title,
      intent: plan.intent,
      content: chapter.content ?? '',
      sourceBookId: project.sourceBookId ?? 1,
      povCharacterIds: Array.isArray(plan.povCharacterIds) ? (plan.povCharacterIds as number[]).map(Number) : [],
      hookType: plan.hookType ?? null,
      generationConfig: genConfig,
      llmConfig: (project.llmConfig || undefined) as LlmConfig | undefined,
    }, Array.isArray(body?.disabledSteps) ? body.disabledSteps : (Array.isArray(genConfig.postUpdateDisabledSteps) ? genConfig.postUpdateDisabledSteps : []));

    return c.json({
      success: true,
      data: {
        chapterPlanId: plan.id,
        chapterNo: plan.chapterNo,
        title: plan.title,
        steps: POST_UPDATE_STEPS,
        results: result.results,
        failedCount: result.results.filter((r) => r.status === 'failed').length,
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: `后验更新失败: ${error.message}` }, 500);
  }
});

/** GET /api/projects/:id/narrative-debt - 叙事债务总览（架构升级 Epic4） */
app.get('/:id/narrative-debt', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }
    const [project] = await creativeDb
      .select({ id: schema.creativeProject.id })
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, id))
      .limit(1);
    if (!project) {
      return c.json({ success: false, error: '项目不存在' }, 404);
    }
    const data = await getNarrativeDebtSummary(id);
    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
