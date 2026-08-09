/**
 * 三层冰山编排服务（PRD v1.3 §7.3 三步工作流 + 分步重生成联动）
 *
 * - 存储复用 generation_task（taskType='iceberg_dialogue'）+ pipeline_checkpoint + generation_log
 * - 三步：step1_truth(1) → step2_surface(2) → step3_behavior(3)
 * - 分步重生成：invalidateStepsFrom() 失效起点及之后步骤，从该步续跑（§7.3 联动规则自动满足）
 */
import { eq, and } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import {
  markStepRunning, markStepCompleted, markStepFailed, invalidateStepsFrom, getCompletedStepData,
} from '../pipeline/checkpoint.js';
import { IcebergDialogueAgent, assembleFullDialogue } from '../agents/iceberg-dialogue.js';
import { scoreIceberg, refineIcebergWithLlm, icebergSuggestions } from './quality.js';
import { EngineError, toEngineError } from './errors.js';
import type { IcebergConfig } from './schemas.js';
import type { IcebergResult, TruthLayerCharacter, SurfaceLine, BehaviorAnchorLine } from './types.js';

export const ICEBERG_STEP_ORDER: Record<string, number> = {
  step1_truth: 1, step2_surface: 2, step3_behavior: 3,
};

/** 重生成入口 step 名 → checkpoint 步骤序号（联动：从该步起全部失效重跑） */
const REGEN_STEP_ORDER: Record<string, number> = { truth: 1, surface: 2, behavior: 3 };

async function createTask(projectId: number, config: IcebergConfig): Promise<number> {
  const rows = await creativeDb.insert(schema.generationTask).values({
    projectId,
    taskType: 'iceberg_dialogue',
    status: 'running',
    inputSnapshot: config,
    startedAt: new Date(),
  }).returning({ id: schema.generationTask.id });
  return rows[0].id;
}

async function updateTaskFinal(
  taskId: number, status: string, result: Partial<IcebergResult>, tokens: number, error?: string
): Promise<void> {
  await creativeDb.update(schema.generationTask).set({
    status,
    outputText: result.full_dialogue ?? null,
    auditReport: {
      truth_layer: result.truth_layer,
      surface_layer: result.surface_layer,
      behavior_layer: result.behavior_layer,
      quality_score: result.quality_score,
      suggestions: result.suggestions,
    },
    tokensUsed: tokens,
    errorMessage: error ?? null,
    completedAt: status === 'completed' ? new Date() : null,
  }).where(eq(schema.generationTask.id, taskId));
}

async function logGen(projectId: number, taskId: number, action: string, detail: any): Promise<void> {
  await creativeDb.insert(schema.generationLog).values({
    projectId, taskId, agentName: 'IcebergDialogueAgent', action, detail,
  });
}

/**
 * 从指定步骤序号开始执行冰山三步（已完成的前置步骤产物从 checkpoint 恢复）
 */
async function runIcebergFromStep(
  projectId: number, taskId: number, config: IcebergConfig, fromOrder: number
): Promise<IcebergResult> {
  const agent = new IcebergDialogueAgent();
  const completed = await getCompletedStepData(taskId);
  let tokens = 0;
  const executedSteps: string[] = [];

  let truthLayer: TruthLayerCharacter[] = completed.get('step1_truth')?.characters ?? null;
  let surfaceLayer: SurfaceLine[] = completed.get('step2_surface')?.dialogue ?? null;
  let behaviorLayer: BehaviorAnchorLine[] = completed.get('step3_behavior')?.behavior_anchors ?? null;

  try {
    // ── Step 1：真相层 ──
    if (fromOrder <= 1) {
      await markStepRunning(taskId, 'step1_truth', 1);
      const r = await agent.generateTruthLayer(config);
      truthLayer = r.characters;
      tokens += r.tokens;
      executedSteps.push('step1_truth');
      await markStepCompleted(taskId, 'step1_truth', 1, { characters: r.characters }, { input: 0, output: r.tokens });
    }
    if (!truthLayer) throw new EngineError('INVALID_CONFIG', 400, '缺少真相层产物，无法继续');

    // ── Step 2：表层台词 ──
    if (fromOrder <= 2) {
      await markStepRunning(taskId, 'step2_surface', 2);
      const r = await agent.generateSurfaceLayer(config, truthLayer);
      surfaceLayer = r.dialogue;
      tokens += r.tokens;
      executedSteps.push('step2_surface');
      await markStepCompleted(taskId, 'step2_surface', 2, { dialogue: r.dialogue }, { input: 0, output: r.tokens });
    }
    if (!surfaceLayer) throw new EngineError('INVALID_CONFIG', 400, '缺少表层台词产物，无法继续');

    // ── Step 3：行为锚点 ──
    if (fromOrder <= 3) {
      await markStepRunning(taskId, 'step3_behavior', 3);
      const r = await agent.generateBehaviorLayer(config, truthLayer, surfaceLayer);
      behaviorLayer = r.behaviorAnchors;
      tokens += r.tokens;
      executedSteps.push('step3_behavior');
      await markStepCompleted(taskId, 'step3_behavior', 3, { behavior_anchors: r.behaviorAnchors }, { input: 0, output: r.tokens });
    }
    if (!behaviorLayer) throw new EngineError('INVALID_CONFIG', 400, '缺少行为锚点产物，无法继续');

    // ── 整合 + 质量校验（规则初筛 + 灰区 LLM 精判）──
    const fullDialogue = assembleFullDialogue(surfaceLayer, behaviorLayer);
    let quality = scoreIceberg({ truthLayer, surfaceLayer, behaviorLayer });
    if (quality.dimensions.some((d) => d.verdict === 'gray')) {
      quality = await refineIcebergWithLlm(quality, { truthLayer, surfaceLayer, behaviorLayer });
    }
    const suggestions = icebergSuggestions(quality);

    const result: IcebergResult = {
      request_id: taskId,
      truth_layer: { characters: truthLayer },
      surface_layer: surfaceLayer,
      behavior_layer: behaviorLayer,
      full_dialogue: fullDialogue,
      quality_score: quality,
      suggestions,
      executed_steps: executedSteps,
      tokens_used: tokens,
    };

    await updateTaskFinal(taskId, 'completed', result, tokens);
    await logGen(projectId, taskId, 'iceberg_generate_done', { executedSteps, qualityTotal: quality.total, tokens });
    return result;
  } catch (error: any) {
    const e = error instanceof EngineError ? error : toEngineError(error);
    const current = executedSteps[executedSteps.length - 1];
    if (current) await markStepFailed(taskId, current, ICEBERG_STEP_ORDER[current] ?? fromOrder, e.message);
    await updateTaskFinal(taskId, 'failed', {} as any, tokens, e.message);
    await logGen(projectId, taskId, 'iceberg_generate_failed', { error: e.message, step: current });
    throw e;
  }
}

/** 全新生成 */
export async function runIceberg(projectId: number, config: IcebergConfig): Promise<IcebergResult> {
  const taskId = await createTask(projectId, config);
  await logGen(projectId, taskId, 'iceberg_generate_start', { scene: config.scene.slice(0, 50) });
  return runIcebergFromStep(projectId, taskId, config, 1);
}

/**
 * 分步重生成（§7.3 联动规则）：
 * truth → 连带重跑 surface+behavior；surface → 连带重跑 behavior；behavior → 仅自身
 */
export async function regenerateIceberg(
  requestId: number, step: 'truth' | 'surface' | 'behavior', overrides?: Partial<IcebergConfig>
): Promise<IcebergResult> {
  const [task] = await creativeDb.select().from(schema.generationTask)
    .where(and(eq(schema.generationTask.id, requestId), eq(schema.generationTask.taskType, 'iceberg_dialogue')))
    .limit(1);
  if (!task) throw new EngineError('NOT_FOUND', 404, `冰山生成记录 ${requestId} 不存在`);

  const config: IcebergConfig = { ...(task.inputSnapshot as IcebergConfig), ...overrides };
  const fromOrder = REGEN_STEP_ORDER[step];
  await invalidateStepsFrom(requestId, fromOrder);
  await creativeDb.update(schema.generationTask)
    .set({ status: 'running', inputSnapshot: config, errorMessage: null })
    .where(eq(schema.generationTask.id, requestId));
  await logGen(task.projectId, requestId, 'iceberg_regenerate', { step, fromOrder, hasOverrides: !!overrides });
  return runIcebergFromStep(task.projectId, requestId, config, fromOrder);
}
