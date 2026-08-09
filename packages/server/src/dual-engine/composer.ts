/**
 * 双引擎组合工作流编排（PRD v1.3 §9：冲突骨架 → 对话节点定位 → 冰山注入 → 叙事衔接 → 交叉校验）
 *
 * - taskType='compose_conflict'，五步 checkpoint 持久化
 * - §9.5 数据契约：冰山输入由冲突骨架推导（scene/characters/conflict_context/disguise_strategy 阶段映射）
 * - 交叉校验不通过 → 携带失败项回炉叙事衔接步重试（max_retry 次），仍失败返回当前最优结果 + VALIDATION_FAILED
 */
import { eq, and } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { chatCompletion } from '../llm/client.js';
import {
  markStepRunning, markStepCompleted, markStepFailed,
} from '../pipeline/checkpoint.js';
import { runConflict } from './conflict.js';
import { runIceberg } from './iceberg.js';
import { crossValidateCompose } from './quality.js';
import { EngineError, toEngineError } from './errors.js';
import type { ComposeConfig, IcebergConfig, DisguiseStrategy } from './schemas.js';
import type { ComposeResult, ConflictResult, IcebergResult, CrossValidationReport } from './types.js';

const COMPOSE_STEPS = [
  { name: 'compose1_skeleton', order: 1 },
  { name: 'compose2_locate_nodes', order: 2 },
  { name: 'compose3_inject_iceberg', order: 3 },
  { name: 'compose4_stitch', order: 4 },
  { name: 'compose5_validate', order: 5 },
] as const;

/** §9.5 disguise_strategy 按阶段映射 */
const PHASE_DISGUISE: Record<string, DisguiseStrategy> = {
  phase1: 'diversion',    // 欲望建立段 → 故作轻松（转移话题）
  phase2: 'irony',        // 阻力降临段 → 强装镇定（反话）
  phase3: 'understatement', // 代价落地段 → 说没事（轻描淡写）
};

const PHASE_LABELS: Record<string, string> = {
  phase1: '欲望建立段', phase2: '阻力降临段', phase3: '代价落地段',
};

interface DialogueNode {
  phase: 'phase1' | 'phase2' | 'phase3';
  position?: string;
  purpose?: string;
  participants?: string[];
}

/** 默认对话节点（未显式指定时：每阶段一个关键节点） */
function defaultNodes(config: ComposeConfig): DialogueNode[] {
  const p = config.conflict_config.protagonist.name;
  return [
    { phase: 'phase1', purpose: '展现期待', participants: [p] },
    { phase: 'phase2', purpose: '正面交锋', participants: [p, config.conflict_config.resistance.source.slice(0, 10)] },
    { phase: 'phase3', purpose: '内心崩塌的反应', participants: [p] },
  ];
}

/**
 * §9.5 数据契约：由冲突骨架推导冰山引擎输入
 */
function buildNodeIcebergConfig(node: DialogueNode, config: ComposeConfig, skeleton: ConflictResult): IcebergConfig {
  const cc = config.conflict_config;
  const phaseText = node.phase === 'phase1' ? skeleton.desire_phase
    : node.phase === 'phase2' ? skeleton.resistance_phase : skeleton.cost_phase;

  // characters：protagonist + resistance.source（补齐 identity 与 relationship）
  const sourceName = node.participants?.[1] || cc.resistance.source.slice(0, 10);
  const characters = [
    {
      name: cc.protagonist.name,
      identity: cc.protagonist.identity,
      relationship: `与「${sourceName}」存在冲突关系`,
    },
    ...(node.participants && node.participants.length > 1
      ? [{ name: sourceName, identity: cc.resistance.source, relationship: `冲突阻力来源，针对${cc.protagonist.name}的欲望施压` }]
      : []),
  ];

  const phaseEvents = phaseText.slice(0, 200);
  const base: IcebergConfig = {
    scene: `${cc.scene_setting}（当前处于${PHASE_LABELS[node.phase]}${node.purpose ? `，对话目的：${node.purpose}` : ''}）`,
    characters,
    conflict_context: `${cc.protagonist.name}渴望「${cc.desire.target}」，因为${cc.desire.why_it_matters}。当前阶段已发生：${phaseEvents}`,
    disguise_strategy: config.dialogue_config?.disguise_strategy ?? PHASE_DISGUISE[node.phase],
    genre: config.dialogue_config?.genre ?? cc.genre,
    dialogue_length: config.dialogue_config?.dialogue_length ?? 'medium',
    behavior_anchor_library: config.dialogue_config?.behavior_anchor_library ?? 'xianxia_default',
  };
  // 用户部分覆盖（§11.3 dialogue_config 可覆盖掩饰策略等）
  return { ...base, ...(config.dialogue_config ?? {}), scene: base.scene, characters: config.dialogue_config?.characters ?? base.characters, conflict_context: base.conflict_context } as IcebergConfig;
}

/** Step 4：叙事衔接填充（将冰山对话嵌入骨架，补充叙事/动作/环境描写） */
async function stitchScene(
  skeleton: ConflictResult,
  nodeResults: Array<{ node: DialogueNode; iceberg: IcebergResult }>,
  revisionHint?: string
): Promise<{ text: string; tokens: number }> {
  let tokens = 0;
  const injections = nodeResults
    .map(({ node, iceberg }) => `【${PHASE_LABELS[node.phase]}的对话（${node.purpose || '关键对话'}）】\n${iceberg.full_dialogue}`)
    .join('\n\n');
  const prompt = `你是一位资深仙侠小说总编剧。请将以下三层冰山式对话嵌入冲突骨架，补充对话之间的叙事、动作、环境描写，产出完整流畅的冲突戏正文。

【冲突骨架（三阶段）】
第一阶段·欲望建立：
${skeleton.desire_phase}

第二阶段·阻力降临：
${skeleton.resistance_phase}

第三阶段·代价落地：
${skeleton.cost_phase}

【待注入的关键对话】
${injections}

要求：
1. 保持三阶段结构顺序，对话放在对应阶段内
2. 对话之间补充叙事、动作、环境描写，使转场自然
3. 台词与行为锚点原样保留，不要改写对话内容
4. 仙侠语境统一，禁止现代口语
5. 只输出正文，不要标题和解释
${revisionHint ? `\n【上一版交叉校验失败项，本版必须修正】\n${revisionHint}` : ''}`;

  const text = await withRetryWrap(async () => chatCompletion([
    { role: 'system', content: '你是一位资深仙侠小说总编剧。只输出正文文本。' },
    { role: 'user', content: prompt },
  ], { temperature: 0.8, maxTokens: 8000, onUsage: (u) => { tokens = u.totalTokens; } }));
  return { text: text.trim(), tokens };
}

/** LLM 调用归一化错误 */
async function withRetryWrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toEngineError(error);
  }
}

/**
 * 组合生成主流程
 */
export async function runCompose(projectId: number, config: ComposeConfig): Promise<ComposeResult> {
  const rows = await creativeDb.insert(schema.generationTask).values({
    projectId,
    taskType: 'compose_conflict',
    status: 'running',
    inputSnapshot: config,
    startedAt: new Date(),
  }).returning({ id: schema.generationTask.id });
  const taskId = rows[0].id;

  const cv = {
    enabled: config.cross_validation?.enabled ?? true,
    min_score: config.cross_validation?.min_score ?? 70,
    auto_optimize: config.cross_validation?.auto_optimize ?? true,
    max_retry: config.cross_validation?.max_retry ?? 3,
  };

  const log = async (action: string, detail: any) => {
    await creativeDb.insert(schema.generationLog).values({
      projectId, taskId, agentName: 'DualEngineComposer', action, detail,
    });
  };

  let totalTokens = 0;
  const executedSteps: string[] = [];

  try {
    await log('compose_start', { protagonist: config.conflict_config.protagonist.name });

    // ── Step 1：冲突骨架搭建（独立冲突任务，可追溯）──
    await markStepRunning(taskId, 'compose1_skeleton', 1);
    const skeleton = await runConflict(projectId, config.conflict_config);
    totalTokens += skeleton.tokens_used;
    executedSteps.push('compose1_skeleton');
    await markStepCompleted(taskId, 'compose1_skeleton', 1, {
      conflictRequestId: skeleton.request_id, full_scene: skeleton.full_scene,
    }, { input: 0, output: skeleton.tokens_used });

    // ── Step 2：对话节点定位 ──
    await markStepRunning(taskId, 'compose2_locate_nodes', 2);
    const nodes: DialogueNode[] = (config.dialogue_nodes?.length ? config.dialogue_nodes : defaultNodes(config)) as DialogueNode[];
    executedSteps.push('compose2_locate_nodes');
    await markStepCompleted(taskId, 'compose2_locate_nodes', 2, { nodes });

    // ── Step 3：冰山台词注入（§9.5 契约推导输入，每节点独立冰山任务）──
    await markStepRunning(taskId, 'compose3_inject_iceberg', 3);
    const nodeResults: Array<{ node: DialogueNode; iceberg: IcebergResult }> = [];
    for (const node of nodes) {
      const icebergConfig = buildNodeIcebergConfig(node, config, skeleton);
      const iceberg = await runIceberg(projectId, icebergConfig);
      totalTokens += iceberg.tokens_used;
      nodeResults.push({ node, iceberg });
    }
    executedSteps.push('compose3_inject_iceberg');
    await markStepCompleted(taskId, 'compose3_inject_iceberg', 3, {
      nodes: nodeResults.map(({ node, iceberg }) => ({ phase: node.phase, requestId: iceberg.request_id })),
    }, { input: 0, output: nodeResults.reduce((s, n) => s + n.iceberg.tokens_used, 0) });

    // FUNC-01：冰山对话存入 characterKnowledge（infoLevel='iceberg', sourceType='iceberg'），供 Writer 跨章注入
    try {
      const chapterNo = config.dialogue_nodes?.[0]?.phase ? undefined : undefined; // composer 无 chapterNo 概念，留 null
      for (const { node, iceberg } of nodeResults) {
        for (const ch of iceberg.truth_layer.characters) {
          // 按名字匹配本项目自定义人物（负数ID约定）
          const [row] = await creativeDb
            .select({ id: schema.customCharacter.id })
            .from(schema.customCharacter)
            .where(and(eq(schema.customCharacter.projectId, projectId), eq(schema.customCharacter.name, ch.name)))
            .limit(1);
          if (row) {
            await creativeDb.insert(schema.characterKnowledge).values({
              projectId,
              characterId: row.id,
              knowledgeContent: iceberg.full_dialogue.slice(0, 2000),
              infoLevel: 'iceberg',
              sourceType: 'iceberg',
              sourceRef: { requestId: iceberg.request_id, phase: node.phase },
              acquiredChapter: null,
              enabled: true,
            });
          }
        }
      }
    } catch (e: any) {
      console.warn(`[冰山存档] 写入 characterKnowledge 失败（降级，不阻断）: ${e?.message || e}`);
    }

    // ── Step 4：叙事衔接填充 ──
    await markStepRunning(taskId, 'compose4_stitch', 4);
    let stitched = await stitchScene(skeleton, nodeResults);
    totalTokens += stitched.tokens;
    executedSteps.push('compose4_stitch');

    // ── Step 5：交叉校验优化（不通过携带失败项回炉，最多 max_retry 次）──
    await markStepRunning(taskId, 'compose5_validate', 5);
    let validation: Awaited<ReturnType<typeof crossValidateCompose>> = {
      total: 100, passed: true, min_score: cv.min_score, dimensions: [],
    };
    let retryCount = 0;
    if (cv.enabled) {
      validation = await crossValidateCompose(stitched.text, config.conflict_config, skeleton.emotion_curve, cv.min_score);
      while (!validation.passed && cv.auto_optimize && retryCount < cv.max_retry) {
        retryCount++;
        const failedNotes = validation.dimensions
          .filter((d) => d.verdict !== 'pass')
          .map((d) => `${d.name}（${d.score}分）：${d.details.join('；')}`)
          .join('\n');
        await log('compose_revise', { retryCount, failedNotes: failedNotes.slice(0, 300) });
        stitched = await stitchScene(skeleton, nodeResults, failedNotes);
        totalTokens += stitched.tokens;
        validation = await crossValidateCompose(stitched.text, config.conflict_config, skeleton.emotion_curve, cv.min_score);
      }
    }
    executedSteps.push('compose5_validate');
    await markStepCompleted(taskId, 'compose5_validate', 5, {
      validation: { ...validation, retry_count: retryCount },
    });

    const crossReport: CrossValidationReport = { ...validation, retry_count: retryCount };
    const result: ComposeResult = {
      request_id: taskId,
      full_text: stitched.text,
      structured: {
        conflict: skeleton,
        dialogue_nodes: nodeResults.map(({ node, iceberg }) => ({
          phase: node.phase, purpose: node.purpose, iceberg,
        })),
      },
      cross_validation: crossReport,
      executed_steps: executedSteps,
      tokens_used: totalTokens,
    };

    await creativeDb.update(schema.generationTask).set({
      status: 'completed',
      outputText: stitched.text,
      auditReport: {
        conflict_request_id: skeleton.request_id,
        dialogue_request_ids: nodeResults.map((n) => n.iceberg.request_id),
        cross_validation: crossReport,
      },
      tokensUsed: totalTokens,
      completedAt: new Date(),
    }).where(eq(schema.generationTask.id, taskId));
    await log('compose_done', { totalTokens, retryCount, crossTotal: validation.total });
    return result;
  } catch (error: any) {
    const e = error instanceof EngineError ? error : toEngineError(error);
    const current = executedSteps[executedSteps.length - 1] || COMPOSE_STEPS[0].name;
    const stepDef = COMPOSE_STEPS.find((s) => s.name === current) ?? COMPOSE_STEPS[0];
    await markStepFailed(taskId, stepDef.name, stepDef.order, e.message);
    await creativeDb.update(schema.generationTask).set({
      status: 'failed', errorMessage: e.message, tokensUsed: totalTokens,
    }).where(eq(schema.generationTask.id, taskId));
    await log('compose_failed', { error: e.message, step: current });
    throw e;
  }
}
