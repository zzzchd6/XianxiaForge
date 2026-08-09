/**
 * 管线检查点服务（架构升级 Epic1：节点化+断点续跑）
 * - 主管线关键步骤（build_context/writer/audit_revise/save）+ 后验更新各步骤（post_*）
 *   执行前后写 pipeline_checkpoint，失败可从首个未完成步骤恢复
 * - 重试/跳过/指定步骤重跑均通过 GenerationOptions.resumeFrom 驱动 runner 跳步
 */
import { eq, and, asc, gte, isNull } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';

/** 主管线步骤定义（stepOrder 升序即执行顺序） */
export const MAIN_PIPELINE_STEPS = [
  { name: 'step1_build_context', order: 10, label: '构建上下文' },
  { name: 'step2_writer', order: 20, label: 'Writer 写作' },
  { name: 'step3_audit_revise', order: 30, label: '审计与回炉修订' },
  { name: 'step4_save_result', order: 40, label: '保存章节' },
  { name: 'step5_post_update', order: 50, label: '后验更新' },
] as const;

export type CheckpointStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/** 标记步骤开始（running），同 task+step 已存在则刷新状态 */
export async function markStepRunning(taskId: number | null, stepName: string, stepOrder: number): Promise<void> {
  await upsertCheckpoint(taskId, stepName, stepOrder, { status: 'running', errorMessage: null });
}

/** 标记步骤完成并保存产出数据 */
export async function markStepCompleted(
  taskId: number | null,
  stepName: string,
  stepOrder: number,
  stepData?: any,
  tokens?: { input: number; output: number }
): Promise<void> {
  await upsertCheckpoint(taskId, stepName, stepOrder, {
    status: 'completed',
    stepData: stepData ?? null,
    errorMessage: null,
    ...(tokens ? { tokenInput: tokens.input, tokenOutput: tokens.output } : {}),
  });
}

/** 标记步骤失败 */
export async function markStepFailed(taskId: number | null, stepName: string, stepOrder: number, errorMessage: string): Promise<void> {
  await upsertCheckpoint(taskId, stepName, stepOrder, { status: 'failed', errorMessage });
}

/** 标记步骤跳过（用户手动跳过失败步骤时） */
export async function markStepSkipped(taskId: number | null, stepName: string, stepOrder: number): Promise<void> {
  await upsertCheckpoint(taskId, stepName, stepOrder, { status: 'skipped', errorMessage: null });
}

/** 读取任务的检查点列表（按 stepOrder 升序） */
export async function getCheckpoints(taskId: number) {
  return creativeDb
    .select()
    .from(schema.pipelineCheckpoint)
    .where(eq(schema.pipelineCheckpoint.taskId, taskId))
    .orderBy(asc(schema.pipelineCheckpoint.stepOrder));
}

/** 读取已完成步骤的产出（断点续跑恢复用），返回 stepName -> stepData 映射 */
export async function getCompletedStepData(taskId: number): Promise<Map<string, any>> {
  const rows = await creativeDb
    .select({ stepName: schema.pipelineCheckpoint.stepName, stepData: schema.pipelineCheckpoint.stepData, status: schema.pipelineCheckpoint.status })
    .from(schema.pipelineCheckpoint)
    .where(and(eq(schema.pipelineCheckpoint.taskId, taskId), eq(schema.pipelineCheckpoint.status, 'completed')));
  const map = new Map<string, any>();
  for (const r of rows) map.set(r.stepName, r.stepData);
  return map;
}

/** 定位首个未完成的主管线步骤（重试起点）；全部完成返回 null */
export async function getFirstIncompleteStep(taskId: number): Promise<{ name: string; order: number; label: string } | null> {
  const rows = await getCheckpoints(taskId);
  const byName = new Map(rows.map((r) => [r.stepName, r.status]));
  for (const step of MAIN_PIPELINE_STEPS) {
    const st = byName.get(step.name);
    if (st !== 'completed' && st !== 'skipped') return { ...step };
  }
  return null;
}

/** 删除指定步骤及之后的检查点（从某一步重新开始时清理旧产出，post_* order>=100 随 step5 一并失效） */
export async function invalidateStepsFrom(taskId: number, stepOrder: number): Promise<void> {
  await creativeDb
    .delete(schema.pipelineCheckpoint)
    .where(and(
      eq(schema.pipelineCheckpoint.taskId, taskId),
      gte(schema.pipelineCheckpoint.stepOrder, stepOrder)
    ));
}

/** 累加某步骤的 token 用量（增量写入） */
export async function addStepTokens(taskId: number | null, stepName: string, totalTokens: number): Promise<void> {
  if (!taskId) return;
  await creativeDb.execute(
    `UPDATE pipeline_checkpoint SET token_output = token_output + ${totalTokens}, updated_at = now() WHERE task_id = ${taskId} AND step_name = '${stepName}'`
  );
}

/**
 * upsert：同 task+step 存在则更新，否则插入。
 * 不用 onConflictDoUpdate：task_id 可空（手动触发后验更新时），唯一约束对 NULL 不生效。
 */
async function upsertCheckpoint(
  taskId: number | null,
  stepName: string,
  stepOrder: number,
  patch: Partial<{
    status: CheckpointStatus;
    stepData: any;
    errorMessage: string | null;
    tokenInput: number;
    tokenOutput: number;
  }>
): Promise<void> {
  const values: Record<string, any> = {
    status: patch.status ?? 'pending',
    updatedAt: new Date(),
  };
  if (patch.stepData !== undefined) values.stepData = patch.stepData;
  if (patch.errorMessage !== undefined) values.errorMessage = patch.errorMessage;
  if (patch.tokenInput !== undefined) values.tokenInput = patch.tokenInput;
  if (patch.tokenOutput !== undefined) values.tokenOutput = patch.tokenOutput;

  const where = taskId == null
    ? and(isNull(schema.pipelineCheckpoint.taskId), eq(schema.pipelineCheckpoint.stepName, stepName))
    : and(eq(schema.pipelineCheckpoint.taskId, taskId), eq(schema.pipelineCheckpoint.stepName, stepName));

  const updated = await creativeDb
    .update(schema.pipelineCheckpoint)
    .set(values)
    .where(where)
    .returning({ id: schema.pipelineCheckpoint.id });

  if (updated.length === 0) {
    await creativeDb.insert(schema.pipelineCheckpoint).values({
      taskId,
      stepName,
      stepOrder,
      ...values,
    });
  }
}
