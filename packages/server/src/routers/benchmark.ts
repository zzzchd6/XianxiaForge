/**
 * 对标素材路由（开源借鉴 PRD v1.1 M5 / US-03，拆文体系第一步）
 * - GET    /api/projects/:id/benchmark-materials              素材列表（pinned 优先）
 * - POST   /api/projects/:id/benchmark-materials              手动添加单条素材
 * - DELETE /api/projects/:id/benchmark-materials/:mid         软删除素材
 * - PATCH  /api/projects/:id/benchmark-materials/:mid/pin     置顶/取消置顶
 * - POST   /api/projects/:id/benchmark/analyze                拆文 agent：LLM 拆解对标书文本并批量入库
 * - POST   /api/projects/:id/benchmark/analyze-book           整本拆文：上传 TXT → 异步拆解 → SSE 进度
 * - GET    /api/benchmark/stream/:taskId                      SSE 流式获取整本拆文进度
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import {
  BENCHMARK_TYPES,
  listBenchmarkMaterials,
  insertBenchmarkMaterial,
  deleteBenchmarkMaterial,
  toggleBenchmarkPin,
  analyzeBenchmarkText,
} from '../services/benchmark.js';
import { runBenchmarkBookTask, type BenchmarkStreamEvent } from '../services/benchmark-worker.js';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { eq } from 'drizzle-orm';

const app = new Hono();

const addMaterialSchema = z.object({
  sourceBookTitle: z.string().min(1).max(200),
  materialType: z.enum(BENCHMARK_TYPES),
  title: z.string().min(1).max(200),
  contentMd: z.string().min(1),
  tags: z.array(z.string()).max(6).optional(),
  pinned: z.boolean().optional(),
});

/** 素材列表 */
app.get('/projects/:id/benchmark-materials', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (!projectId) return c.json({ success: false, error: '缺少项目ID' }, 400);
    const rows = await listBenchmarkMaterials(projectId);
    return c.json({ success: true, data: rows });
  } catch (error: any) {
    return c.json({ success: false, error: `查询对标素材失败: ${error.message}` }, 500);
  }
});

/** 手动添加单条素材 */
app.post('/projects/:id/benchmark-materials', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (!projectId) return c.json({ success: false, error: '缺少项目ID' }, 400);
    const body = await c.req.json();
    const parsed = addMaterialSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const id = await insertBenchmarkMaterial(projectId, parsed.data);
    return c.json({ success: true, data: { id } }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: `添加对标素材失败: ${error.message}` }, 500);
  }
});

/** 软删除素材 */
app.delete('/projects/:id/benchmark-materials/:mid', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const mid = Number(c.req.param('mid'));
    const ok = await deleteBenchmarkMaterial(projectId, mid);
    if (!ok) return c.json({ success: false, error: '素材不存在' }, 404);
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ success: false, error: `删除对标素材失败: ${error.message}` }, 500);
  }
});

/** 置顶/取消置顶 */
app.patch('/projects/:id/benchmark-materials/:mid/pin', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const mid = Number(c.req.param('mid'));
    const body = await c.req.json().catch(() => ({}));
    const pinned = Boolean(body.pinned);
    const ok = await toggleBenchmarkPin(projectId, mid, pinned);
    if (!ok) return c.json({ success: false, error: '素材不存在' }, 404);
    return c.json({ success: true, data: { id: mid, pinned } });
  } catch (error: any) {
    return c.json({ success: false, error: `置顶操作失败: ${error.message}` }, 500);
  }
});

const analyzeSchema = z.object({
  sourceBookTitle: z.string().min(1).max(200),
  text: z.string().min(100),
});

/** 拆文 agent：拆解对标书文本 → 批量入库（失败不影响已入库部分） */
app.post('/projects/:id/benchmark/analyze', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (!projectId) return c.json({ success: false, error: '缺少项目ID' }, 400);
    const body = await c.req.json();
    const parsed = analyzeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败（text 至少100字）', details: parsed.error.issues }, 400);
    }
    const materials = await analyzeBenchmarkText(parsed.data.sourceBookTitle, parsed.data.text);
    if (!materials.length) {
      return c.json({ success: false, error: '拆文未产出有效素材，请更换文本或重试' }, 422);
    }
    const inserted: { id: number; title: string; materialType: string }[] = [];
    for (const m of materials) {
      try {
        const id = await insertBenchmarkMaterial(projectId, m);
        inserted.push({ id, title: m.title, materialType: m.materialType });
      } catch (e) {
        console.warn(`[benchmark] 素材入库失败「${m.title}」:`, (e as Error)?.message || e);
      }
    }
    return c.json({ success: true, data: { analyzed: materials.length, inserted } });
  } catch (error: any) {
    return c.json({ success: false, error: `拆文分析失败: ${error.message}` }, 500);
  }
});

// ─── 整本拆文（v1.5+）──────────────────────────────────────

/** 活跃 SSE 流（taskId -> controller） */
const activeBenchmarkStreams = new Map<number, ReadableStreamDefaultController<string>>();

/** 临时文件目录 */
const TMP_DIR = resolve(process.cwd(), 'tmp', 'benchmark-uploads');

/** POST /api/projects/:id/benchmark/analyze-book — 上传 TXT，创建整本拆文任务 */
app.post('/projects/:id/benchmark/analyze-book', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (!projectId) return c.json({ success: false, error: '缺少项目ID' }, 400);

    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    const sourceBookTitle = (formData.get('sourceBookTitle') as string || '').trim();
    const maxChapters = Number(formData.get('maxChapters') || '5');

    if (!file || typeof (file as any).arrayBuffer !== 'function') {
      return c.json({ success: false, error: '缺少上传文件（字段名 file）' }, 400);
    }
    if (!sourceBookTitle) {
      return c.json({ success: false, error: '缺少对标书名' }, 400);
    }

    // 文件大小限制 100MB
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > 100 * 1024 * 1024) {
      return c.json({ success: false, error: '文件超过 100MB 限制' }, 400);
    }

    // 保存到临时目录
    mkdirSync(TMP_DIR, { recursive: true });
    const fileName = `bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
    const filePath = join(TMP_DIR, fileName);
    writeFileSync(filePath, buffer, 'utf-8');

    // 创建 generation_task
    const [task] = await creativeDb
      .insert(schema.generationTask)
      .values({
        projectId,
        taskType: 'benchmark_analysis',
        status: 'running',
        currentStep: 'starting',
        inputSnapshot: { sourceBookTitle, filePath, maxChapters, fileName },
        startedAt: new Date(),
      })
      .returning();

    const taskId = task.id;

    // 创建 SSE 流，异步启动 worker
    const stream = new ReadableStream<string>({
      start(controller) {
        activeBenchmarkStreams.set(taskId, controller);

        // 推送初始事件
        controller.enqueue(`data: ${JSON.stringify({ type: 'status', data: { message: '任务已创建，开始处理...' }, timestamp: Date.now() })}\n\n`);

        // 异步执行 worker
        runBenchmarkBookTask(
          taskId,
          { sourceBookTitle, filePath, maxChapters },
          projectId,
          (event: BenchmarkStreamEvent) => {
            try {
              controller.enqueue(`data: ${JSON.stringify({ ...event, timestamp: Date.now() })}\n\n`);
            } catch {
              // 流已关闭
            }
          },
        )
          .then(async (result) => {
            // 更新任务状态
            await creativeDb
              .update(schema.generationTask)
              .set({
                status: 'completed',
                currentStep: 'done',
                completedAt: new Date(),
                outputText: JSON.stringify(result),
              })
              .where(eq(schema.generationTask.id, taskId));
            try { controller.close(); } catch { /* 已关闭 */ }
          })
          .catch(async (err) => {
            // 更新任务状态为失败
            await creativeDb
              .update(schema.generationTask)
              .set({
                status: 'failed',
                currentStep: 'error',
                errorMessage: err?.message || String(err),
                completedAt: new Date(),
              })
              .where(eq(schema.generationTask.id, taskId));
            try {
              controller.enqueue(`data: ${JSON.stringify({ type: 'error', data: { message: err?.message || String(err) }, timestamp: Date.now() })}\n\n`);
              controller.close();
            } catch { /* 已关闭 */ }
          })
          .finally(() => {
            activeBenchmarkStreams.delete(taskId);
          });
      },
      cancel() {
        activeBenchmarkStreams.delete(taskId);
      },
    });

    // 直接返回 SSE 流（Content-Type: text/event-stream）
    return new Response(stream as any, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Task-Id': String(taskId),
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: `整本拆文启动失败: ${error.message}` }, 500);
  }
});

/** GET /api/benchmark/stream/:taskId — 获取已创建任务的 SSE 流（断线重连用） */
app.get('/benchmark/stream/:taskId', async (c) => {
  const taskId = Number(c.req.param('taskId'));
  if (isNaN(taskId)) return c.json({ success: false, error: '无效的任务ID' }, 400);

  // 检查任务状态
  const [task] = await creativeDb
    .select()
    .from(schema.generationTask)
    .where(eq(schema.generationTask.id, taskId))
    .limit(1);

  if (!task) return c.json({ success: false, error: '任务不存在' }, 404);

  // 如果已有活跃流，返回错误（不支持多客户端同时监听同一任务）
  if (activeBenchmarkStreams.has(taskId)) {
    return c.json({ success: false, error: '该任务已有活跃的SSE连接' }, 409);
  }

  // 如果任务已完成/失败，返回最终状态
  if (task.status && ['completed', 'failed', 'cancelled'].includes(task.status)) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const event = task.status === 'completed'
          ? { type: 'complete', data: JSON.parse(task.outputText || '{}'), timestamp: Date.now() }
          : { type: 'error', data: { message: task.errorMessage || '任务失败' }, timestamp: Date.now() };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        controller.close();
      },
    });
    return new Response(stream as any, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }

  return c.json({ success: false, error: '任务正在运行但无活跃SSE流（可能是服务重启）' }, 409);
});

export default app;
