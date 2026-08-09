/**
 * 生成任务队列执行器（需求8）
 * - 数据库为队列真相源，内存 worker 循环消费（重启可恢复）
 * - 并发数可配（默认1=顺序，保证后章吃到前章摘要）
 * - 原子认领（pending→running 状态翻转）防重复执行
 * - 失败指数退避重试（默认3次：30s/120s/480s）
 */
import { eq, and, inArray } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { generateChapter } from './runner.js';
import type { GenerationOptions } from '../types.js';

/** 队列并发数（环境变量 QUEUE_CONCURRENCY，默认1顺序） */
export const QUEUE_CONCURRENCY = Math.max(1, Number(process.env.QUEUE_CONCURRENCY) || 1);
/** 轮询间隔 */
const POLL_INTERVAL_MS = 2000;

/** 指数退避基数（毫秒）：第n次重试等待 BACKOFF_BASE * 4^(n-1) */
const BACKOFF_BASE_MS = 30_000;

let workerTimer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
/** 正在执行的任务ID集合（内存态，配合DB状态双重防重） */
const inFlight = new Set<number>();

/** 生成批次号 */
export function makeBatchId(): string {
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 计算第 retryCount 次重试所需等待毫秒数 */
function backoffMs(retryCount: number): number {
  return BACKOFF_BASE_MS * Math.pow(4, Math.max(0, retryCount - 1));
}

/**
 * 入队：创建一个 pending 任务，等待 worker 消费
 */
export async function enqueueTask(
  chapterPlanId: number,
  opts: {
    projectId: number;
    position?: number;
    batchId?: string;
    maxRetries?: number;
    queueOptions?: GenerationOptions;
  }
): Promise<number> {
  const [task] = await creativeDb
    .insert(schema.generationTask)
    .values({
      projectId: opts.projectId,
      chapterPlanId,
      taskType: 'chapter',
      status: 'pending',
      currentStep: 'queued',
      position: opts.position ?? 0,
      batchId: opts.batchId ?? null,
      maxRetries: opts.maxRetries ?? 3,
      retryCount: 0,
      queueOptions: opts.queueOptions ?? null,
    })
    .returning();
  return task.id;
}

/**
 * 原子认领：仅当任务仍为 pending 时翻转为 running，返回是否认领成功
 */
async function claimTask(taskId: number): Promise<boolean> {
  const rows = await creativeDb
    .update(schema.generationTask)
    .set({ status: 'running', currentStep: 'starting', startedAt: new Date() })
    .where(and(eq(schema.generationTask.id, taskId), eq(schema.generationTask.status, 'pending')))
    .returning({ id: schema.generationTask.id });
  return rows.length > 0;
}

/** worker 主循环：领取不超过并发上限的任务执行 */
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    while (inFlight.size < QUEUE_CONCURRENCY) {
      const candidates = await creativeDb
        .select()
        .from(schema.generationTask)
        .where(eq(schema.generationTask.status, 'pending'))
        .orderBy(schema.generationTask.position, schema.generationTask.createdAt, schema.generationTask.id)
        .limit(20);

      const now = Date.now();
      const next = candidates.find((t) => {
        if (inFlight.has(t.id)) return false;
        const rc = t.retryCount || 0;
        if (rc > 0 && t.completedAt) {
          // 重试退避：距上次失败不足等待时间则跳过
          if (now - new Date(t.completedAt).getTime() < backoffMs(rc)) return false;
        }
        return true;
      });

      if (!next) break;

      const claimed = await claimTask(next.id);
      if (!claimed) continue; // 被其它流程抢先，跳过

      inFlight.add(next.id);
      void runTask(next.id);
    }
  } finally {
    ticking = false;
  }
}

/** 执行单个任务，处理成功/失败重试/取消 */
async function runTask(taskId: number) {
  try {
    const [task] = await creativeDb
      .select()
      .from(schema.generationTask)
      .where(eq(schema.generationTask.id, taskId))
      .limit(1);
    if (!task || !task.chapterPlanId) {
      await creativeDb
        .update(schema.generationTask)
        .set({ status: 'failed', currentStep: 'error', errorMessage: '任务无效或缺少章节计划', completedAt: new Date() })
        .where(eq(schema.generationTask.id, taskId));
      return;
    }

    const options = (task.queueOptions as GenerationOptions | null) || {};
    // 进度写 generation_log，供 /stream/:taskId 轮询展示
    const onEvent = (event: { type: string; data: any }) => {
      if (event.type === 'status') {
        void creativeDb.insert(schema.generationLog).values({
          taskId,
          agentName: 'queue',
          action: event.data?.step || 'status',
          detail: { message: event.data?.message || event.data?.step || '' },
        }).catch(() => {});
      }
    };

    await generateChapter(task.chapterPlanId, options, onEvent, taskId);

    // generateChapter 内部已设终态；读取最终状态决定是否重试
    const [final] = await creativeDb
      .select()
      .from(schema.generationTask)
      .where(eq(schema.generationTask.id, taskId))
      .limit(1);
    if (final?.status === 'failed') {
      await scheduleRetryOrFail(taskId, final.retryCount || 0, final.maxRetries ?? 3, final.errorMessage || '生成失败');
    }
  } catch (e: any) {
    // 欠账门拦截不自动重试（generateChapter 内已置 failed/debt_gate_blocked 终态，等作者清理/豁免/强制继续）
    if (String(e?.message || '').startsWith('DEBT_GATE_BLOCKED:')) {
      inFlight.delete(taskId);
      return;
    }
    const [cur] = await creativeDb
      .select()
      .from(schema.generationTask)
      .where(eq(schema.generationTask.id, taskId))
      .limit(1);
    await scheduleRetryOrFail(taskId, cur?.retryCount || 0, cur?.maxRetries ?? 3, e?.message || '生成失败');
  } finally {
    inFlight.delete(taskId);
  }
}

/** 失败处理：未达上限则回到 pending 等待退避重试，否则终态 failed */
async function scheduleRetryOrFail(taskId: number, retryCount: number, maxRetries: number, errorMessage: string) {
  const nextRetry = retryCount + 1;
  if (nextRetry < maxRetries) {
    const waitSec = Math.round(backoffMs(nextRetry) / 1000);
    await creativeDb
      .update(schema.generationTask)
      .set({
        status: 'pending',
        currentStep: 'retry_wait',
        retryCount: nextRetry,
        errorMessage: `${errorMessage}（第${nextRetry}次重试，约${waitSec}s后）`,
        completedAt: new Date(),
      })
      .where(eq(schema.generationTask.id, taskId));
  } else {
    await creativeDb
      .update(schema.generationTask)
      .set({
        status: 'failed',
        currentStep: 'error',
        retryCount: nextRetry,
        errorMessage,
        completedAt: new Date(),
      })
      .where(eq(schema.generationTask.id, taskId));
  }
}

/**
 * 重启恢复：把卡在 running/auditing/revising 的任务重置为 pending 重新入队
 * （pending 任务本就留在库中，worker 启动后自动消费，含历史孤儿任务）
 */
export async function recoverStaleTasks(): Promise<number> {
  const stale = await creativeDb
    .update(schema.generationTask)
    .set({ status: 'pending', currentStep: 'queued' })
    .where(inArray(schema.generationTask.status, ['running', 'auditing', 'revising']))
    .returning({ id: schema.generationTask.id });
  return stale.length;
}

/** 启动队列 worker（幂等） */
export function startQueueWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
  console.log(`[Queue] 队列执行器已启动，并发数=${QUEUE_CONCURRENCY}`);
}

/** 停止队列 worker */
export function stopQueueWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

/** 队列状态概览 */
export async function getQueueStatus() {
  const running = await creativeDb
    .select({ id: schema.generationTask.id, chapterPlanId: schema.generationTask.chapterPlanId, currentStep: schema.generationTask.currentStep })
    .from(schema.generationTask)
    .where(eq(schema.generationTask.status, 'running'));
  const pending = await creativeDb
    .select({ id: schema.generationTask.id, chapterPlanId: schema.generationTask.chapterPlanId, position: schema.generationTask.position, retryCount: schema.generationTask.retryCount })
    .from(schema.generationTask)
    .where(eq(schema.generationTask.status, 'pending'))
    .orderBy(schema.generationTask.position, schema.generationTask.createdAt, schema.generationTask.id);
  return {
    concurrency: QUEUE_CONCURRENCY,
    inFlight: inFlight.size,
    runningCount: running.length,
    pendingCount: pending.length,
    running,
    pending,
  };
}
