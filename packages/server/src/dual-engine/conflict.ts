/**
 * 冲突三要素编排服务（PRD v1.3 §8.3 欲望前置工作流 + 分阶段重生成）
 *
 * - 存储复用 generation_task（taskType='conflict_generation'）+ pipeline_checkpoint + generation_log
 * - 三阶段：phase1_desire(1) → phase2_resistance(2) → phase3_cost(3)
 * - 联动规则（§8.3）：phase1 重生成连带 phase2+3；phase2 重生成连带 phase3（invalidateStepsFrom 自动满足）
 * - 情绪曲线（§8.5）由 computeEmotionCurve 零token推导
 */
import { eq, and } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import {
  markStepRunning, markStepCompleted, markStepFailed, invalidateStepsFrom, getCompletedStepData,
} from '../pipeline/checkpoint.js';
import { ConflictGeneratorAgent, assembleFullScene } from '../agents/conflict-generator.js';
import {
  scoreConflict, refineConflictWithLlm, conflictSuggestions, computeEmotionCurve, resolveDesireType,
} from './quality.js';
import { EngineError, toEngineError } from './errors.js';
import type { ConflictConfig } from './schemas.js';
import type { ConflictResult } from './types.js';

export const CONFLICT_STEP_ORDER: Record<string, number> = {
  phase1_desire: 1, phase2_resistance: 2, phase3_cost: 3,
};

const REGEN_STEP_ORDER: Record<string, number> = { desire: 1, resistance: 2, cost: 3 };

async function createTask(projectId: number, config: ConflictConfig): Promise<number> {
  const rows = await creativeDb.insert(schema.generationTask).values({
    projectId,
    taskType: 'conflict_generation',
    status: 'running',
    inputSnapshot: config,
    startedAt: new Date(),
  }).returning({ id: schema.generationTask.id });
  return rows[0].id;
}

async function updateTaskFinal(
  taskId: number, status: string, result: Partial<ConflictResult>, tokens: number, error?: string
): Promise<void> {
  await creativeDb.update(schema.generationTask).set({
    status,
    outputText: result.full_scene ?? null,
    auditReport: {
      desire_phase: result.desire_phase,
      resistance_phase: result.resistance_phase,
      cost_phase: result.cost_phase,
      emotion_curve: result.emotion_curve,
      quality_score: result.quality_score,
      suggestions: result.suggestions,
      resolved_desire_type: result.resolved_desire_type,
    },
    tokensUsed: tokens,
    errorMessage: error ?? null,
    completedAt: status === 'completed' ? new Date() : null,
  }).where(eq(schema.generationTask.id, taskId));
}

async function logGen(projectId: number, taskId: number, action: string, detail: any): Promise<void> {
  await creativeDb.insert(schema.generationLog).values({
    projectId, taskId, agentName: 'ConflictGeneratorAgent', action, detail,
  });
}

/**
 * 从指定阶段序号开始执行冲突三阶段（前置阶段产物从 checkpoint 恢复）。
 * 供全新生成 / 分阶段重生成 / 组合工作流 Step1 复用。
 */
export async function runConflictFromStep(
  projectId: number, taskId: number, config: ConflictConfig, fromOrder: number
): Promise<ConflictResult> {
  const agent = new ConflictGeneratorAgent();
  const completed = await getCompletedStepData(taskId);
  const words = {
    p1: config.phase_length?.phase1_words ?? 400,
    p2: config.phase_length?.phase2_words ?? 600,
    p3: config.phase_length?.phase3_words ?? 250,
  };
  const resolvedDesireType = resolveDesireType(config);
  let tokens = 0;
  const executedSteps: string[] = [];

  let desirePhase: string = completed.get('phase1_desire')?.text ?? null;
  let resistancePhase: string = completed.get('phase2_resistance')?.text ?? null;
  let costPhase: string = completed.get('phase3_cost')?.text ?? null;

  try {
    if (fromOrder <= 1) {
      await markStepRunning(taskId, 'phase1_desire', 1);
      const r = await agent.generateDesirePhase(config, words.p1);
      desirePhase = r.text;
      tokens += r.tokens;
      executedSteps.push('phase1_desire');
      await markStepCompleted(taskId, 'phase1_desire', 1, { text: r.text }, { input: 0, output: r.tokens });
    }
    if (!desirePhase) throw new EngineError('INVALID_CONFIG', 400, '缺少欲望建立段产物，无法继续');

    if (fromOrder <= 2) {
      await markStepRunning(taskId, 'phase2_resistance', 2);
      const r = await agent.generateResistancePhase(config, desirePhase, words.p2, resolvedDesireType);
      resistancePhase = r.text;
      tokens += r.tokens;
      executedSteps.push('phase2_resistance');
      await markStepCompleted(taskId, 'phase2_resistance', 2, { text: r.text }, { input: 0, output: r.tokens });
    }
    if (!resistancePhase) throw new EngineError('INVALID_CONFIG', 400, '缺少阻力降临段产物，无法继续');

    if (fromOrder <= 3) {
      await markStepRunning(taskId, 'phase3_cost', 3);
      const r = await agent.generateCostPhase(config, desirePhase, resistancePhase, words.p3);
      costPhase = r.text;
      tokens += r.tokens;
      executedSteps.push('phase3_cost');
      await markStepCompleted(taskId, 'phase3_cost', 3, { text: r.text }, { input: 0, output: r.tokens });
    }
    if (!costPhase) throw new EngineError('INVALID_CONFIG', 400, '缺少代价落地段产物，无法继续');

    // ── 情绪曲线 + 质量校验（规则初筛 + 灰区 LLM 精判）──
    const emotionCurve = computeEmotionCurve(config);
    let quality = scoreConflict({
      config, desirePhase, resistancePhase, costPhase, resolvedDesireType,
    });
    if (quality.dimensions.some((d) => d.verdict === 'gray')) {
      quality = await refineConflictWithLlm(quality, {
        config, desirePhase, resistancePhase, costPhase, resolvedDesireType,
      });
    }
    const suggestions = conflictSuggestions(quality);

    const result: ConflictResult = {
      request_id: taskId,
      desire_phase: desirePhase,
      resistance_phase: resistancePhase,
      cost_phase: costPhase,
      full_scene: assembleFullScene(desirePhase, resistancePhase, costPhase),
      emotion_curve: emotionCurve,
      quality_score: quality,
      suggestions,
      resolved_desire_type: resolvedDesireType,
      executed_steps: executedSteps,
      tokens_used: tokens,
    };

    await updateTaskFinal(taskId, 'completed', result, tokens);
    await logGen(projectId, taskId, 'conflict_generate_done', {
      executedSteps, qualityTotal: quality.total, desireType: resolvedDesireType, tokens,
    });
    return result;
  } catch (error: any) {
    const e = error instanceof EngineError ? error : toEngineError(error);
    const current = executedSteps[executedSteps.length - 1];
    if (current) await markStepFailed(taskId, current, CONFLICT_STEP_ORDER[current] ?? fromOrder, e.message);
    await updateTaskFinal(taskId, 'failed', {} as any, tokens, e.message);
    await logGen(projectId, taskId, 'conflict_generate_failed', { error: e.message, step: current });
    throw e;
  }
}

/** 全新生成 */
export async function runConflict(projectId: number, config: ConflictConfig): Promise<ConflictResult> {
  const taskId = await createTask(projectId, config);
  await logGen(projectId, taskId, 'conflict_generate_start', {
    protagonist: config.protagonist.name, desire: config.desire.target.slice(0, 50),
  });
  return runConflictFromStep(projectId, taskId, config, 1);
}

/**
 * 分阶段重生成（§8.3 联动规则）：
 * desire → 连带重跑 resistance+cost；resistance → 连带重跑 cost；cost → 仅自身
 */
export async function regenerateConflict(
  requestId: number, step: 'desire' | 'resistance' | 'cost', overrides?: Partial<ConflictConfig>
): Promise<ConflictResult> {
  const [task] = await creativeDb.select().from(schema.generationTask)
    .where(and(eq(schema.generationTask.id, requestId), eq(schema.generationTask.taskType, 'conflict_generation')))
    .limit(1);
  if (!task) throw new EngineError('NOT_FOUND', 404, `冲突生成记录 ${requestId} 不存在`);

  // overrides 为 partial，深层对象（desire/resistance/cost）按顶层合并
  const snapshot = task.inputSnapshot as ConflictConfig;
  const config: ConflictConfig = { ...snapshot, ...overrides };
  const fromOrder = REGEN_STEP_ORDER[step];
  await invalidateStepsFrom(requestId, fromOrder);
  await creativeDb.update(schema.generationTask)
    .set({ status: 'running', inputSnapshot: config, errorMessage: null })
    .where(eq(schema.generationTask.id, requestId));
  await logGen(task.projectId, requestId, 'conflict_regenerate', { step, fromOrder, hasOverrides: !!overrides });
  return runConflictFromStep(task.projectId, requestId, config, fromOrder);
}
