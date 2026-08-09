/**
 * 生成任务路由 - 入队/批量入队、SSE流、取消、队列状态、历史
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc, inArray } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { cancelGeneration } from '../pipeline/runner.js';
import { enqueueTask, makeBatchId, getQueueStatus } from '../pipeline/queue.js';
import { MAIN_PIPELINE_STEPS, getCheckpoints, getFirstIncompleteStep, invalidateStepsFrom, markStepSkipped } from '../pipeline/checkpoint.js';
import type { GenerationOptions } from '../types.js';

const app = new Hono();

// 启动生成验证
const startGenerationSchema = z.object({
  chapterPlanId: z.coerce.number().int().min(1),
  targetWords: z.number().int().min(500).max(20000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  autoRevise: z.boolean().optional(),
  skipAudit: z.boolean().optional(),
  skipRevision: z.boolean().optional(),
  stylePreset: z.string().optional(),
  forceContinue: z.boolean().optional(),
  llmConfig: z.object({
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(100).max(32000).optional(),
  }).optional(),
});

/** POST /api/generation/start - 单章入队（返回taskId，前端通过SSE获取进度） */
app.post('/start', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = startGenerationSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    // 验证章节计划存在
    const [plan] = await creativeDb
      .select()
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.id, parsed.data.chapterPlanId))
      .limit(1);

    if (!plan) {
      return c.json({ success: false, error: '章节计划不存在' }, 404);
    }

    // 入队：创建 pending 任务，由队列 worker 消费
    // 合并顶层 temperature 到 llmConfig（顶层优先）
    const mergedLlmConfig = parsed.data.temperature != null
      ? { ...parsed.data.llmConfig, temperature: parsed.data.temperature }
      : parsed.data.llmConfig;
    // autoRevise=false 等价于 skipRevision=true
    const skipRevision = parsed.data.skipRevision ?? (parsed.data.autoRevise === false ? true : undefined);
    const queueOptions: GenerationOptions = {
      skipAudit: parsed.data.skipAudit,
      skipRevision,
      stylePreset: parsed.data.stylePreset,
      llmConfig: mergedLlmConfig,
      targetWords: parsed.data.targetWords,
      forceContinue: parsed.data.forceContinue,
    };
    const taskId = await enqueueTask(parsed.data.chapterPlanId, {
      projectId: plan.projectId,
      position: 0,
      queueOptions,
    });

    return c.json({
      success: true,
      data: {
        taskId,
        streamUrl: `/api/generation/stream/${taskId}`,
      },
    }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: `启动生成失败: ${error.message}` }, 500);
  }
});

// 批量生成验证
const batchGenerationSchema = z.object({
  chapterPlanIds: z.array(z.coerce.number().int().min(1)).min(1).max(50),
  skipAudit: z.boolean().optional(),
  skipRevision: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  forceContinue: z.boolean().optional(),
  llmConfig: z.object({
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(100).max(32000).optional(),
  }).optional(),
});

/** POST /api/generation/batch - 批量入队（按章节号排序，共享batchId） */
app.post('/batch', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = batchGenerationSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const { chapterPlanIds, skipAudit, skipRevision, maxRetries, llmConfig, forceContinue } = parsed.data;

    // 验证所有章节计划存在，并获取排序信息
    const plans = await creativeDb
      .select({
        id: schema.chapterPlan.id,
        projectId: schema.chapterPlan.projectId,
        volumeNo: schema.chapterPlan.volumeNo,
        chapterNo: schema.chapterPlan.chapterNo,
      })
      .from(schema.chapterPlan)
      .where(inArray(schema.chapterPlan.id, chapterPlanIds));

    if (plans.length !== chapterPlanIds.length) {
      const foundIds = new Set(plans.map((p) => p.id));
      const missing = chapterPlanIds.filter((id) => !foundIds.has(id));
      return c.json({ success: false, error: `章节计划不存在: ${missing.join(', ')}` }, 404);
    }

    // 按卷号+章节号排序，保证顺序生成
    plans.sort((a, b) => (a.volumeNo - b.volumeNo) || (a.chapterNo - b.chapterNo));

    const batchId = makeBatchId();
    const queueOptions: GenerationOptions = { skipAudit, skipRevision, llmConfig, forceContinue };
    const taskIds: number[] = [];

    for (let i = 0; i < plans.length; i++) {
      const taskId = await enqueueTask(plans[i].id, {
        projectId: plans[i].projectId,
        position: i,
        batchId,
        maxRetries: maxRetries ?? 3,
        queueOptions,
      });
      taskIds.push(taskId);
    }

    return c.json({
      success: true,
      data: { batchId, taskIds, count: taskIds.length },
    }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: `批量入队失败: ${error.message}` }, 500);
  }
});

/** GET /api/generation/queue - 队列状态概览 */
app.get('/queue', async (c) => {
  try {
    const status = await getQueueStatus();
    return c.json({ success: true, data: status });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/generation/stream/:taskId - SSE流式获取生成进度 */
app.get('/stream/:taskId', async (c) => {
  const taskId = Number(c.req.param('taskId'));
  if (isNaN(taskId)) {
    return c.json({ success: false, error: '无效的任务ID' }, 400);
  }

  // 验证任务存在
  const [task] = await creativeDb
    .select()
    .from(schema.generationTask)
    .where(eq(schema.generationTask.id, taskId))
    .limit(1);

  if (!task) {
    return c.json({ success: false, error: '任务不存在' }, 404);
  }

  // 如果任务已完成，直接返回结果
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // 先下发检索素材快照（如果有），让前端能看到本次调用了哪些诛仙库资料
        if (task.inputSnapshot) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'context', data: task.inputSnapshot, timestamp: Date.now() })}\n\n`));
        }
        // 任务成功完成时，补发剧情分支选项（需求12）
        if (task.status === 'completed' && task.chapterPlanId) {
          const branchOptions = await creativeDb
            .select()
            .from(schema.chapterBranchOption)
            .where(eq(schema.chapterBranchOption.sourceChapterPlanId, task.chapterPlanId));
          if (branchOptions.length) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'branch_ready', data: { chapterPlanId: task.chapterPlanId, options: branchOptions }, timestamp: Date.now() })}\n\n`));
          }
        }
        const event = {
          type: task.status === 'completed' ? 'complete' : 'error',
          data: { taskId, status: task.status, error: task.errorMessage },
          timestamp: Date.now(),
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': 'http://localhost:5173',
      },
    });
  }

  // 任务正在运行中，创建SSE流
  // 注意：实际的流式数据由pipeline/runner中的generateChapterStream管理
  // 这里提供一个轮询式的SSE端点，定期检查任务状态
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let lastLogId = 0;
      let attempts = 0;
      let contextSent = false;
      let branchSent = false;
      const maxAttempts = 600; // 最多轮询10分钟（每秒一次）

      while (attempts < maxAttempts) {
        attempts++;

        // 查询任务最新状态
        const [currentTask] = await creativeDb
          .select()
          .from(schema.generationTask)
          .where(eq(schema.generationTask.id, taskId))
          .limit(1);

        if (!currentTask) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', data: { message: '任务不存在' }, timestamp: Date.now() })}\n\n`));
          break;
        }

        // 发送状态更新
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', data: { step: currentTask.currentStep, status: currentTask.status }, timestamp: Date.now() })}\n\n`));

        // 检索素材快照就绪后下发一次（构建上下文完成后、写作完成前即可看到）
        if (!contextSent && currentTask.inputSnapshot) {
          contextSent = true;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'context', data: currentTask.inputSnapshot, timestamp: Date.now() })}\n\n`));
        }

        // 查询新日志
        const logs = await creativeDb
          .select()
          .from(schema.generationLog)
          .where(eq(schema.generationLog.taskId, taskId))
          .orderBy(desc(schema.generationLog.id))
          .limit(5);

        for (const log of logs.reverse()) {
          if (log.id > lastLogId) {
            lastLogId = log.id;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', data: { log: (log.detail as any)?.message || log.action, step: log.action }, timestamp: Date.now() })}\n\n`));
          }
        }

        // 检查是否完成
        if (currentTask.status === 'completed') {
          // 补发剧情分支选项（需求12），先于 complete 事件
          if (!branchSent && currentTask.chapterPlanId) {
            branchSent = true;
            const branchOptions = await creativeDb
              .select()
              .from(schema.chapterBranchOption)
              .where(eq(schema.chapterBranchOption.sourceChapterPlanId, currentTask.chapterPlanId));
            if (branchOptions.length) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'branch_ready', data: { chapterPlanId: currentTask.chapterPlanId, options: branchOptions }, timestamp: Date.now() })}\n\n`));
            }
          }

          // 获取生成内容
          const [chapter] = await creativeDb
            .select()
            .from(schema.generatedChapter)
            .where(eq(schema.generatedChapter.taskId, taskId))
            .limit(1);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', data: { taskId, wordCount: chapter?.wordCount, content: chapter?.content }, timestamp: Date.now() })}\n\n`));
          break;
        }

        if (currentTask.status === 'failed' || currentTask.status === 'cancelled') {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', data: { message: currentTask.errorMessage || '任务已取消', status: currentTask.status }, timestamp: Date.now() })}\n\n`));
          break;
        }

        // 等待1秒后继续轮询
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': 'http://localhost:5173',
    },
  });
});

/** POST /api/generation/cancel/:taskId - 取消生成 */
app.post('/cancel/:taskId', async (c) => {
  try {
    const taskId = Number(c.req.param('taskId'));
    if (isNaN(taskId)) {
      return c.json({ success: false, error: '无效的任务ID' }, 400);
    }

    const cancelled = await cancelGeneration(taskId);
    if (cancelled) {
      return c.json({ success: true, message: '任务已取消' });
    } else {
      return c.json({ success: false, error: '无法取消该任务（可能已完成或不存在）' }, 400);
    }
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/generation/tasks - 任务历史（含章节标题摘要） */
app.get('/tasks', async (c) => {
  try {
    const page = Number(c.req.query('page') || '1');
    const pageSize = Number(c.req.query('pageSize') || '20');
    const status = c.req.query('status');

    const baseQuery = creativeDb
      .select({
        task: schema.generationTask,
        chapterTitle: schema.chapterPlan.title,
        volumeNo: schema.chapterPlan.volumeNo,
        chapterNo: schema.chapterPlan.chapterNo,
      })
      .from(schema.generationTask)
      .leftJoin(schema.chapterPlan, eq(schema.generationTask.chapterPlanId, schema.chapterPlan.id))
      .orderBy(desc(schema.generationTask.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const rows = status
      ? await creativeDb
          .select({
            task: schema.generationTask,
            chapterTitle: schema.chapterPlan.title,
            volumeNo: schema.chapterPlan.volumeNo,
            chapterNo: schema.chapterPlan.chapterNo,
          })
          .from(schema.generationTask)
          .leftJoin(schema.chapterPlan, eq(schema.generationTask.chapterPlanId, schema.chapterPlan.id))
          .where(eq(schema.generationTask.status, status))
          .orderBy(desc(schema.generationTask.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize)
      : await baseQuery;

    // 展平为任务对象 + 章节摘要字段
    const tasks = rows.map((row) => ({
      ...row.task,
      chapterTitle: row.chapterTitle,
      volumeNo: row.volumeNo,
      chapterNo: row.chapterNo,
    }));

    return c.json({ success: true, data: tasks });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/generation/tasks/:id - 任务详情 */
app.get('/tasks/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的任务ID' }, 400);
    }

    const [task] = await creativeDb
      .select()
      .from(schema.generationTask)
      .where(eq(schema.generationTask.id, id))
      .limit(1);

    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }

    // 获取关联日志
    const logs = await creativeDb
      .select()
      .from(schema.generationLog)
      .where(eq(schema.generationLog.taskId, id))
      .orderBy(schema.generationLog.createdAt);

    // 获取生成结果
    const [chapter] = await creativeDb
      .select()
      .from(schema.generatedChapter)
      .where(eq(schema.generatedChapter.taskId, id))
      .limit(1);

    return c.json({
      success: true,
      data: {
        ...task,
        logs,
        result: chapter || null,
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/generation/tasks/:id/checkpoints - 管线检查点列表（Epic1 断点续跑） */
app.get('/tasks/:id/checkpoints', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的任务ID' }, 400);
    const checkpoints = await getCheckpoints(id);
    return c.json({ success: true, data: { mainSteps: MAIN_PIPELINE_STEPS, checkpoints } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * 将任务重置为 pending 并携带 resumeFrom 重新入队（队列 worker 会自动消费）
 */
async function reenqueueWithResume(taskId: number, resumeFrom: string): Promise<void> {
  const [task] = await creativeDb
    .select()
    .from(schema.generationTask)
    .where(eq(schema.generationTask.id, taskId))
    .limit(1);
  const queueOptions = { ...((task?.queueOptions as GenerationOptions | null) || {}), resumeFrom };
  await creativeDb
    .update(schema.generationTask)
    .set({ status: 'pending', currentStep: 'queued', errorMessage: null, completedAt: null, queueOptions })
    .where(eq(schema.generationTask.id, taskId));
}

/** POST /api/generation/tasks/:id/retry - 从失败/指定步骤重试（Epic1，保留已完成步骤产出） */
app.post('/tasks/:id/retry', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的任务ID' }, 400);

    const [task] = await creativeDb
      .select()
      .from(schema.generationTask)
      .where(eq(schema.generationTask.id, id))
      .limit(1);
    if (!task) return c.json({ success: false, error: '任务不存在' }, 404);
    if (task.status === 'running' || task.status === 'pending' || task.status === 'auditing' || task.status === 'revising') {
      return c.json({ success: false, error: '任务正在执行中，无法重试' }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const fromStep = typeof body?.fromStep === 'string' ? body.fromStep : undefined;

    let resumeFrom: string;
    if (fromStep) {
      const step = MAIN_PIPELINE_STEPS.find((s) => s.name === fromStep);
      if (!step) return c.json({ success: false, error: `未知步骤: ${fromStep}` }, 400);
      // 从指定步骤重新开始：失效该步骤及之后的检查点
      await invalidateStepsFrom(id, step.order);
      resumeFrom = step.name;
    } else {
      const first = await getFirstIncompleteStep(id);
      if (!first) return c.json({ success: false, error: '所有步骤均已完成，无需重试' }, 400);
      resumeFrom = first.name;
    }

    await reenqueueWithResume(id, resumeFrom);
    return c.json({ success: true, data: { taskId: id, resumeFrom, streamUrl: `/api/generation/stream/${id}` } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/generation/tasks/:id/skip-step - 跳过失败步骤继续执行（Epic1） */
app.post('/tasks/:id/skip-step', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的任务ID' }, 400);

    const [task] = await creativeDb
      .select()
      .from(schema.generationTask)
      .where(eq(schema.generationTask.id, id))
      .limit(1);
    if (!task) return c.json({ success: false, error: '任务不存在' }, 404);
    if (task.status === 'running' || task.status === 'pending' || task.status === 'auditing' || task.status === 'revising') {
      return c.json({ success: false, error: '任务正在执行中' }, 400);
    }

    // 定位首个失败/中断的主管线步骤，标记跳过后从下一步继续
    const checkpoints = await getCheckpoints(id);
    const byName = new Map(checkpoints.map((cp) => [cp.stepName, cp.status]));
    const failedIdx = MAIN_PIPELINE_STEPS.findIndex((s) => {
      const st = byName.get(s.name);
      return st === 'failed' || st === 'running';
    });
    if (failedIdx === -1) return c.json({ success: false, error: '没有可跳过的失败步骤' }, 400);

    const failedStep = MAIN_PIPELINE_STEPS[failedIdx];
    await markStepSkipped(id, failedStep.name, failedStep.order);
    const nextStep = MAIN_PIPELINE_STEPS[failedIdx + 1];
    if (!nextStep) {
      return c.json({ success: false, error: '失败步骤已是最后一步，请直接重试' }, 400);
    }
    await invalidateStepsFrom(id, nextStep.order);
    await reenqueueWithResume(id, nextStep.name);
    return c.json({ success: true, data: { taskId: id, skippedStep: failedStep.name, resumeFrom: nextStep.name } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
