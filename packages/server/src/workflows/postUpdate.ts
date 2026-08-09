/**
 * 后验更新独立工作流（架构升级 Epic2）
 * - 原 runner.ts 的 10 个后置处理块迁移于此，每步独立封装、显式记录状态（pipeline_checkpoint post_*）
 * - 支持生成后自动执行（autoPostUpdate，默认 true）与手动触发（POST /api/projects/:pid/post-update）
 * - 单步失败记录 failed 状态并继续后续步骤，禁止静默降级（NFR-6）
 */
import { eq, and, desc } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { markStepRunning, markStepCompleted, markStepFailed } from '../pipeline/checkpoint.js';
import { stateExtractorAgent } from '../agents/extractor.js';
import { persistExtraction, autoUpdateForeshadowFromContent, autoUpdateTaskFromContent } from '../state/store.js';
import { scanPlotDuplication, checkHookRotation } from '../rag/continuity-scanner.js';
import { expireOverdueChains } from '../services/impact/causal-chain.service.js';
import { getBranchConfig, getAgentModel } from '../routers/settings.js';
import { recallBranchMaterials, gatherBranchWorldview, gatherWorkshopEntities } from '../services/branch-context.js';
import { branchGeneratorAgent } from '../agents/branch.js';
import { runQuotePipeline } from '../services/quote-service.js';
import { processChapterEntities, resolveEntityMaintainConfig, type EntityMaintainResult } from '../services/custom-entity-pipeline.js';
import { detectTeleport } from '../services/teleport-detector.js';
import type { LlmConfig } from '../types.js';

/** 后验步骤定义（order 从 100 起，与主管线 step1-5 的 10-50 区分） */
export const POST_UPDATE_STEPS = [
  { name: 'post_state_extract', order: 100, label: '人物状态快照抽取' },
  { name: 'post_foreshadow_flow', order: 101, label: '伏笔状态流转' },
  { name: 'post_task_flow', order: 102, label: '任务状态流转' },
  { name: 'post_plot_duplication', order: 103, label: '桥段重复度扫描' },
  { name: 'post_hook_rotation', order: 104, label: '章末钩子轮换检测' },
  { name: 'post_causal_expire', order: 105, label: '因果链逾期过期' },
  { name: 'post_branch_generate', order: 106, label: '剧情分支生成' },
  { name: 'post_quote_extract', order: 107, label: '金句提取' },
  { name: 'post_entity_extract', order: 108, label: '自定义实体维护' },
  { name: 'post_teleport_check', order: 109, label: '防瞬移检测' },
] as const;

/** 后验步骤→任务角色映射（开源借鉴 PRD v1.1 M3：按角色分流模型）；未列出的步骤零 token */
const POST_STEP_ROLES: Record<string, string> = {
  post_state_extract: 'extractor',
  post_branch_generate: 'branch',
  post_quote_extract: 'quote',
};

export interface PostUpdateContext {
  /** 关联生成任务（手动触发时可为 null） */
  taskId: number | null;
  projectId: number;
  planId: number;
  volumeNo: number;
  chapterNo: number;
  title: string;
  intent: string | null;
  content: string;
  sourceBookId: number;
  povCharacterIds: number[];
  hookType: string | null;
  generationConfig: Record<string, any>;
  llmConfig?: LlmConfig;
  onUsage?: (usage: { totalTokens: number }, model: string) => void;
  emitEvent?: (type: string, data: any) => void;
}

export interface PostUpdateStepResult {
  step: string;
  label: string;
  status: 'completed' | 'failed' | 'skipped';
  message: string;
}

/** 本地日志（taskId 为 null 时不落库） */
async function logGen(taskId: number | null, step: string, level: string, message: string): Promise<void> {
  if (!taskId) return;
  await creativeDb.insert(schema.generationLog).values({
    taskId,
    agentName: level,
    action: step,
    detail: { message },
  }).catch(() => {});
}

/**
 * 执行后验更新工作流
 * @param disabledSteps 被禁用的步骤名列表（generationConfig.postUpdateDisabledSteps）
 * @returns 每步执行结果 + 实体维护产出（供主管线 complete 事件使用）
 */
export async function runPostUpdateWorkflow(
  ctx: PostUpdateContext,
  disabledSteps: string[] = []
): Promise<{ results: PostUpdateStepResult[]; entitiesFound?: EntityMaintainResult; tokens: { input: number; output: number } }> {
  const results: PostUpdateStepResult[] = [];
  let entitiesFound: EntityMaintainResult | undefined;
  const emit = (type: string, data: any) => ctx.emitEvent?.(type, data);
  /** 全部后验步骤的 token 合计（写入 step5_post_update checkpoint） */
  const totalTokens = { input: 0, output: 0 };

  for (const step of POST_UPDATE_STEPS) {
    if (disabledSteps.includes(step.name)) {
      results.push({ step: step.name, label: step.label, status: 'skipped', message: '配置已禁用该步骤' });
      continue;
    }
    await markStepRunning(ctx.taskId, step.name, step.order);
    try {
      // 每步独立累计 token（写 pipeline_checkpoint token_input/token_output）
      const stepAcc = { input: 0, output: 0 };
      const stepCtx: PostUpdateContext = {
        ...ctx,
        onUsage: (usage, model) => {
          const u = usage as { totalTokens: number; promptTokens?: number; completionTokens?: number };
          stepAcc.input += u.promptTokens || 0;
          stepAcc.output += u.completionTokens || (u.totalTokens || 0);
          ctx.onUsage?.(usage, model);
        },
      };
      // 按角色分流模型（extractor/branch/quote），未配置回退全局
      const role = POST_STEP_ROLES[step.name];
      const roleModel = role ? getAgentModel(role) : undefined;
      if (roleModel) stepCtx.llmConfig = { ...(ctx.llmConfig ?? {}), model: roleModel };

      const message = await runSingleStep(step.name, stepCtx, (e) => { entitiesFound = e; });
      await markStepCompleted(ctx.taskId, step.name, step.order, { message }, stepAcc);
      totalTokens.input += stepAcc.input;
      totalTokens.output += stepAcc.output;
      await logGen(ctx.taskId, step.name, 'info', message);
      results.push({ step: step.name, label: step.label, status: 'completed', message });
    } catch (e: any) {
      const message = `${step.label}失败: ${e?.message || e}`;
      await markStepFailed(ctx.taskId, step.name, step.order, message);
      await logGen(ctx.taskId, step.name, 'warn', message);
      results.push({ step: step.name, label: step.label, status: 'failed', message });
      emit('post_update_step_failed', { step: step.name, message });
    }
    emit('post_update_step', { step: step.name, label: step.label, status: results[results.length - 1].status });
  }

  return { results, entitiesFound, tokens: totalTokens };
}

/** 单步执行分发，返回该步骤的结果摘要 */
async function runSingleStep(
  stepName: string,
  ctx: PostUpdateContext,
  setEntities: (e: EntityMaintainResult) => void
): Promise<string> {
  const emit = (type: string, data: any) => ctx.emitEvent?.(type, data);

  switch (stepName) {
    // 1. 人物状态快照抽取（character_state_snapshot / timeline / memory_card）
    case 'post_state_extract': {
      emit('status', { step: 'extracting_state', message: '正在抽取本章状态快照...' });
      const extraction = await stateExtractorAgent.extract(
        ctx.content,
        { chapterNumber: ctx.chapterNo, title: ctx.title, intent: ctx.intent || undefined },
        ctx.llmConfig,
        ctx.onUsage
      );
      const persisted = await persistExtraction(
        ctx.projectId, ctx.volumeNo, ctx.chapterNo,
        extraction.characters, extraction.timeline, ctx.taskId ?? undefined, extraction.memories, extraction.tasks
      );
      const msg = `人物${persisted.snapshots}条/时间线${persisted.milestones}条/记忆卡${persisted.memoryCards}条/任务${persisted.tasks}条（自动生效）`;
      emit('status', { step: 'state_extracted', message: `已抽取状态快照${persisted.snapshots}条、时间线${persisted.milestones}条、记忆卡${persisted.memoryCards}条、新任务${persisted.tasks}条（自动生效，可否决）` });
      return msg;
    }

    // 2. 伏笔状态流转（零LLM确定性规则）
    case 'post_foreshadow_flow': {
      const flow = await autoUpdateForeshadowFromContent(ctx.projectId, ctx.chapterNo, ctx.content);
      if (flow.planted || flow.resolved) {
        emit('status', { step: 'foreshadow_flowed', message: `伏笔自动流转：新埋设${flow.planted}条、回收${flow.resolved}条` });
        return `新埋设${flow.planted}条、回收${flow.resolved}条`;
      }
      return '无流转';
    }

    // 3. 任务状态流转（素材深度融入·第2层，零LLM确定性规则）
    case 'post_task_flow': {
      const flow = await autoUpdateTaskFromContent(ctx.projectId, ctx.chapterNo, ctx.content);
      if (flow.progressing || flow.completed) {
        emit('status', { step: 'task_flowed', message: `任务自动流转：新推进${flow.progressing}条、完成${flow.completed}条` });
        return `新推进${flow.progressing}条、完成${flow.completed}条`;
      }
      return '无流转';
    }

    // 4. 桥段重复度扫描（近15章分布）
    case 'post_plot_duplication': {
      const recentChapters = await creativeDb
        .select({ chapterNo: schema.chapterPlan.chapterNo, fingerprint: schema.chapterPlan.plotFingerprint })
        .from(schema.chapterPlan)
        .where(and(
          eq(schema.chapterPlan.projectId, ctx.projectId),
          eq(schema.chapterPlan.status, 'generated'),
        ))
        .orderBy(desc(schema.chapterPlan.chapterNo))
        .limit(15);
      if (recentChapters.length >= 10) {
        const dupResult = scanPlotDuplication(
          recentChapters.map(c => ({ chapterNo: c.chapterNo, fingerprint: c.fingerprint || 'unknown' }))
        );
        if (dupResult.warnings.length > 0) {
          emit('plot_duplication_warning', dupResult);
          return dupResult.suggestion;
        }
      }
      return '无重复风险';
    }

    // 5. 章末钩子轮换检测
    case 'post_hook_rotation': {
      if (!ctx.hookType) return '本章无钩子类型，跳过';
      const recentHooks = await creativeDb
        .select({ hookType: schema.chapterPlan.hookType })
        .from(schema.chapterPlan)
        .where(and(
          eq(schema.chapterPlan.projectId, ctx.projectId),
          eq(schema.chapterPlan.status, 'generated'),
        ))
        .orderBy(desc(schema.chapterPlan.chapterNo))
        .limit(5);
      const hookList = recentHooks.map(h => h.hookType).filter(Boolean) as string[];
      const rotation = checkHookRotation(hookList);
      if (rotation.repetitive) {
        emit('hook_rotation_warning', rotation);
        return `钩子类型过于单一（近5章中"${rotation.dominantType}"占比过高），建议下一章切换`;
      }
      return '钩子轮换正常';
    }

    // 6. 因果链逾期自动过期
    case 'post_causal_expire': {
      const expiredCount = await expireOverdueChains(creativeDb, ctx.projectId, ctx.chapterNo);
      return expiredCount > 0 ? `因果链自动过期${expiredCount}条（逾期未兑现）` : '无逾期因果链';
    }

    // 7. 剧情分支生成（仅全局开启分支功能时执行）
    case 'post_branch_generate': {
      const { branchEnabled, branchOptionCount } = getBranchConfig();
      if (!branchEnabled) return '分支功能未开启，跳过';
      // 若本章已有被选定的分支，保留其选择链，不重新生成
      const [existingSelected] = await creativeDb
        .select({ id: schema.chapterBranchOption.id })
        .from(schema.chapterBranchOption)
        .where(and(
          eq(schema.chapterBranchOption.sourceChapterPlanId, ctx.planId),
          eq(schema.chapterBranchOption.isSelected, true),
        ))
        .limit(1);
      if (existingSelected) return '已有被选定分支，保留不重生成';

      emit('status', { step: 'generating_branches', message: '正在生成剧情分支选项...' });
      const recallQuery = ctx.intent || ctx.title || `第${ctx.chapterNo}章`;
      const materials = await recallBranchMaterials(ctx.projectId, recallQuery);
      const worldview = await gatherBranchWorldview(ctx.sourceBookId, ctx.povCharacterIds);
      const workshopEntities = await gatherWorkshopEntities(ctx.projectId);

      const { options: branches, prediction } = await branchGeneratorAgent.generateBranches(
        ctx.content,
        { chapterNumber: ctx.chapterNo, title: ctx.title, intent: ctx.intent || undefined },
        branchOptionCount,
        materials,
        worldview,
        { enabledCategories: ctx.generationConfig?.directionConfig?.enabledCategories ?? undefined },
        workshopEntities,
        ctx.llmConfig,
        ctx.onUsage
      );

      if (!branches.length) return '未产出分支选项';

      // 覆盖本章旧的未选定选项（重新生成时刷新），保留已选定的
      await creativeDb
        .delete(schema.chapterBranchOption)
        .where(and(
          eq(schema.chapterBranchOption.sourceChapterPlanId, ctx.planId),
          eq(schema.chapterBranchOption.isSelected, false),
        ));

      const inserted = await creativeDb
        .insert(schema.chapterBranchOption)
        .values(branches.map((b) => ({
          projectId: ctx.projectId,
          sourceChapterPlanId: ctx.planId,
          optionTitle: b.title,
          optionDescription: b.description,
          nextChapterIntent: b.nextChapterIntent,
          nextSceneHint: b.nextSceneHint ?? {},
          impactTags: b.impactTags ?? [],
          optionType: b.optionType ?? 'normal',
          sourceMaterials: b.sourceMaterials ?? [],
          mainDirection: b.mainDirection ?? null,
          secondaryDirections: b.secondaryDirections ?? [],
          directionMatchScore: b.directionMatchScore ?? null,
          isSelected: false,
        })))
        .returning();

      if (prediction) {
        await creativeDb
          .update(schema.chapterPlan)
          .set({ branchPrediction: prediction })
          .where(eq(schema.chapterPlan.id, ctx.planId));
      }

      emit('branch_ready', { chapterPlanId: ctx.planId, options: inserted, prediction });
      return `已生成${inserted.length}个剧情分支选项${prediction ? '（含发展推演）' : ''}`;
    }

    // 8. 金句提取+评审+美化（同步等待以便记录明确状态）
    case 'post_quote_extract': {
      const r = await runQuotePipeline(ctx.projectId, ctx.planId, ctx.content, ctx.title);
      return `金句入库${r.stored}条（美化${r.polished}条）/待打磨候选${r.candidates}条`;
    }

    // 9. 自定义实体自动维护（新人物/武器/功法建草稿，已有人物追加 chapter_updates）
    case 'post_entity_extract': {
      const entityCfg = resolveEntityMaintainConfig(ctx.generationConfig);
      if (!entityCfg.enabled) return '实体维护未开启，跳过';
      emit('status', { step: 'extracting_entities', message: '正在扫描本章实体...' });
      const entityResult = await processChapterEntities(
        ctx.projectId, ctx.volumeNo, ctx.chapterNo, ctx.content, entityCfg, ctx.llmConfig
      );
      if (entityResult.newCharacters || entityResult.newWeapons || entityResult.newTechniques || entityResult.newLocations || entityResult.updates || entityResult.conflicts.length) {
        setEntities(entityResult);
        emit('entities_extracted', entityResult);
        // 15-SRS P2-1：跨章新旧事实冲突推审计流（realm 倒退 major / item 消失 minor）
        if (entityResult.conflicts.length) {
          emit('entity_conflict_warning', { conflicts: entityResult.conflicts });
        }
        const conflictNote = entityResult.conflicts.length
          ? `；事实冲突${entityResult.conflicts.length}条：${entityResult.conflicts.map((c) => c.message).join('；')}`
          : '';
        return `新人物${entityResult.newCharacters}/新武器${entityResult.newWeapons}/新功法${entityResult.newTechniques}/新地点${entityResult.newLocations}/动态更新${entityResult.updates}（草稿待确认）${conflictNote}`;
      }
      return '未发现新实体';
    }

    // 10. 防瞬移检测（仅提醒不阻断）
    case 'post_teleport_check': {
      const warnings = await detectTeleport(ctx.projectId, ctx.chapterNo);
      if (warnings.length) {
        emit('teleport_warning', { warnings });
        return `疑似瞬移：${warnings.map((w) => `${w.characterName} ${w.fromLocation}→${w.toLocation}（飞行${w.display}）`).join('；')}`;
      }
      return '无瞬移风险';
    }

    default:
      throw new Error(`未知后验步骤: ${stepName}`);
  }
}
