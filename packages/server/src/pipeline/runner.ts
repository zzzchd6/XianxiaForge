/**
 * 管线编排器 - 协调Writer/Auditor/Reviser完成章节生成
 * 参考InkOS PipelineRunner，简化版
 */
import { eq, and } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { buildContextForChapter, trimToTokenBudget } from '../rag/context-builder.js';
import type { RagRecallConfig } from '../rag/plot-material-retriever.js';
import { scanForbiddenWords } from '../rag/style.js';
import { runQualityGate } from '../rag/quality-gate.js';
import * as retriever from '../rag/retriever.js';
import { writerAgent } from '../agents/writer.js';
import { auditorAgent } from '../agents/auditor.js';
import { reviserAgent } from '../agents/reviser.js';
import { STYLE_PRESETS, getAgentModel } from '../routers/settings.js';
import { maybeAutoConverge } from '../services/convergence-engine.js';
import { MAIN_PIPELINE_STEPS, markStepRunning, markStepCompleted, markStepFailed, markStepSkipped, getCompletedStepData } from './checkpoint.js';
import { runPostUpdateWorkflow } from '../workflows/postUpdate.js';
import { checkDebtGate, DebtGateBlockedError } from '../services/debt-gate.js';
import type { EntityMaintainResult } from '../services/custom-entity-pipeline.js';
import type { AuditReport, ContextPackage, GenerationOptions, GenerationStreamEvent, LlmConfig, RetrievalInfo, TaskStatus } from '../types.js';

/** 活跃任务流存储（taskId -> ReadableStream控制器） */
const activeStreams = new Map<number, {
  controller: ReadableStreamDefaultController<string> | null;
  cancelled: boolean;
}>();

/**
 * 生成章节主管线
 * @param existingTaskId 如果提供，则复用已有任务记录（避免重复创建）
 */
export async function generateChapter(
  chapterPlanId: number,
  options: GenerationOptions = {},
  onEvent?: (event: GenerationStreamEvent) => void,
  existingTaskId?: number
): Promise<{ taskId: number; content: string }> {
  let taskId = 0;
  let currentMainStep = '';

  try {
    // 1. 加载chapterPlan + project
    const [plan] = await creativeDb
      .select()
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.id, chapterPlanId))
      .limit(1);

    if (!plan) {
      throw new Error(`章节计划不存在: id=${chapterPlanId}`);
    }

    const [project] = await creativeDb
      .select()
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, plan.projectId))
      .limit(1);

    if (!project) {
      throw new Error(`项目不存在: id=${plan.projectId}`);
    }

    // 复用已有任务或创建新任务
    if (existingTaskId) {
      taskId = existingTaskId;
      await creativeDb
        .update(schema.generationTask)
        .set({ status: 'running', currentStep: 'initializing', startedAt: new Date() })
        .where(eq(schema.generationTask.id, taskId));
    } else {
      const [task] = await creativeDb
        .insert(schema.generationTask)
        .values({
          projectId: project.id,
          chapterPlanId: plan.id,
          taskType: 'chapter',
          status: 'running',
          currentStep: 'initializing',
          startedAt: new Date(),
        })
        .returning();
      taskId = task.id;
    }
    activeStreams.set(taskId, { controller: null, cancelled: false });

    const emitEvent = (type: GenerationStreamEvent['type'], data: any) => {
      const event: GenerationStreamEvent = { type, data, timestamp: Date.now() };
      onEvent?.(event);
    };

    // token用量收集器（汇总写作/审计/修订的消耗）
    let totalTokens = 0;
    let usedModel: string | null = null;
    /** 按主管线步骤累计 input/output token（写入 pipeline_checkpoint，开源借鉴 PRD v1.1 M3） */
    const stepTokenAcc: Record<string, { input: number; output: number }> = {};
    const onUsage = (usage: { totalTokens: number; promptTokens?: number; completionTokens?: number }, model: string) => {
      totalTokens += usage.totalTokens || 0;
      usedModel = model;
      if (currentMainStep) {
        const acc = stepTokenAcc[currentMainStep] ??= { input: 0, output: 0 };
        acc.input += usage.promptTokens || 0;
        acc.output += usage.completionTokens || (usage.totalTokens || 0);
      }
    };

    // Epic1 断点续跑：resumeFrom 为重新开始的步骤，其之前的步骤用 checkpoint 产出恢复（不重复消耗 LLM token）
    const resumeOrder = options.resumeFrom
      ? (MAIN_PIPELINE_STEPS.find((s) => s.name === options.resumeFrom)?.order ?? 0)
      : Infinity;
    const doneData = Number.isFinite(resumeOrder) ? await getCompletedStepData(taskId) : new Map<string, any>();
    const shouldSkip = (stepName: string) =>
      (MAIN_PIPELINE_STEPS.find((s) => s.name === stepName)?.order ?? Infinity) < resumeOrder && doneData.has(stepName);

    emitEvent('status', { step: 'loading', message: '加载章节计划和项目配置...' });

    // 奇点事件配额二次校验（天命P1#5，防止并发绕过路由层校验）
    if (plan.singularityEvent || plan.chapterType === 'singularity') {
      const genConfig = (project.generationConfig as any) || {};
      const quota = genConfig.singularity_quota_per_volume ?? 3;
      const existingSingularity = await creativeDb
        .select({ id: schema.chapterPlan.id })
        .from(schema.chapterPlan)
        .where(and(
          eq(schema.chapterPlan.projectId, project.id),
          eq(schema.chapterPlan.volumeNo, plan.volumeNo),
          eq(schema.chapterPlan.singularityEvent, true),
        ));
      // 排除自身（更新场景）
      const others = existingSingularity.filter(r => r.id !== plan.id);
      if (others.length >= quota) {
        throw new Error(`本卷奇点事件配额已满（${others.length}/${quota}），无法生成奇点章节。`);
      }
    }

    // 2. 构建上下文
    await updateTaskStatus(taskId, 'running', 'building_context');
    emitEvent('status', { step: 'building_context', message: '构建创作上下文...' });
    currentMainStep = 'step1_build_context';
    await markStepRunning(taskId, 'step1_build_context', 10);

    // 获取作者规则
    const rules = await creativeDb
      .select()
      .from(schema.authorRules)
      .where(eq(schema.authorRules.projectId, project.id));

    const ruleTexts = rules
      .filter((r) => r.isActive)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .map((r) => r.ruleContent);

    // 二期RAG：从 generationConfig 读取素材召回配置（默认开启）
    const genCfg = (project.generationConfig as any) || {};
    const ragConfig: RagRecallConfig = {
      enabled: genCfg.ragRecallEnabled !== false,
      topN: genCfg.ragTopN || undefined,
      minScore: genCfg.ragMinScore ?? undefined,
      stylePresetName: genCfg.ragStylePresetName || undefined,
    };

    // 用户控制台覆盖目标字数（优先于章节计划默认值）
    if (options.targetWords) {
      plan.targetWordCount = options.targetWords;
    }

    const built = await buildContextForChapter({
      id: plan.id,
      chapterNumber: plan.chapterNo,
      volumeNo: plan.volumeNo,
      title: plan.title,
      intent: plan.intent || '',
      targetWordCount: plan.targetWordCount,
      targetEmotion: plan.emotionTarget,
      conflictType: plan.conflictTarget != null ? String(plan.conflictTarget) : null,
      sceneBreakdown: plan.sceneBreakdown ? JSON.stringify(plan.sceneBreakdown) : null,
      requiredEntityIds: plan.requiredEntityIds,
      povCharacterIds: Array.isArray(plan.povCharacterIds) ? (plan.povCharacterIds as number[]) : null,
      mustHaveEvents: Array.isArray(plan.mustHaveEvents) ? (plan.mustHaveEvents as string[]) : null,
      branchSourceOptionId: plan.branchSourceOptionId ?? null,
      branchParentChapterId: plan.branchParentChapterId ?? null,
      hookType: plan.hookType ?? null,
      hookIntensity: plan.hookIntensity ?? null,
      conflictScore: plan.conflictScore ?? null,
      conflictRating: plan.conflictRating ?? null,
      isPeak: plan.isPeak ?? null,
      chapterType: plan.chapterType ?? null,
      pinnedMaterialIds: plan.pinnedMaterialIds ?? null,
    }, {
      id: project.id,
      title: project.title,
      genre: project.genre || '',
      styleGuide: null,
    }, ruleTexts, ragConfig, genCfg);

    let context = built.context;

    // 裁剪到token预算（默认12000 tokens给上下文）
    context = trimToTokenBudget(context, 12000);

    // 模块7：临时文风档位覆盖（仅本次任务生效，不修改全局配置）
    if (options.stylePreset) {
      const preset = STYLE_PRESETS.find((p) => p.id === options.stylePreset);
      if (preset) {
        context = {
          ...context,
          style: {
            ...context.style,
            ...preset.overrides,
            styleName: `${context.style?.styleName || '萧鼎仙侠'}·${preset.name}`,
          },
        };
        emitEvent('status', { step: 'style_preset', message: `文风档位：${preset.name}` });
      }
    }

    // 持久化检索素材快照（含来源：显式下发/自动关联），并推送给前端展示
    const inputSnapshot = await buildInputSnapshot(context, built.retrieval);
    await creativeDb
      .update(schema.generationTask)
      .set({ inputSnapshot })
      .where(eq(schema.generationTask.id, taskId));
    emitEvent('context', inputSnapshot);
    await markStepCompleted(taskId, 'step1_build_context', 10, { estimatedTokens: built.retrieval?.estimatedTokens ?? null });

    // 检查是否被取消
    if (isCancelled(taskId)) {
      await updateTaskStatus(taskId, 'cancelled', 'cancelled');
      emitEvent('status', { step: 'cancelled', message: '任务已取消' });
      return { taskId, content: '' };
    }

    // 2.5 欠账门（开源借鉴PRD M1，写前拦截）：上一章 blocking 级 AI 味未清即阻断；forceContinue 二次确认后放行
    if (!shouldSkip('step2_writer') && !options.forceContinue) {
      const debt = await checkDebtGate(project.id, plan.volumeNo, plan.chapterNo, genCfg);
      if (debt.blocked) {
        await logGeneration(taskId, 'debt_gate', 'warn',
          `欠账门拦截：上一章「${debt.prevChapter?.title ?? ''}」残留 ${debt.issues.length} 处 blocking 级 AI 味（豁免 ${debt.exemptedCount} 处）`);
        throw new DebtGateBlockedError(debt);
      }
      if (debt.skippedReason === 'inline_skip') {
        await logGeneration(taskId, 'debt_gate', 'info', '欠账门：上一章含行内豁免标记（去味:跳过），放行');
      }
    } else if (options.forceContinue) {
      await logGeneration(taskId, 'debt_gate', 'warn', '欠账门：作者已二次确认强制继续，跳过上一章 blocking 检查');
    }

    // 3. Writer写作
    await updateTaskStatus(taskId, 'running', 'writing');

    const llmConfig = (options.llmConfig || project.llmConfig || undefined) as LlmConfig | undefined;
    // 混合模型策略（开源借鉴 PRD v1.1 M3）：按任务角色分流（writer/auditor/reviser 各自可配专属模型），
    // 未配置的角色回退全局模型；用户显式指定的模型优先。
    const resolveRoleConfig = (role: string): LlmConfig | undefined => {
      if (options.llmConfig?.model) return llmConfig;
      const m = getAgentModel(role);
      return m ? { ...llmConfig, model: m } : llmConfig;
    };
    const writerLlmConfig = resolveRoleConfig('writer');
    const genConfigEarly = (project.generationConfig || {}) as Record<string, any>;
    const oreFoundryEnabled = genConfigEarly.oreFoundryEnabled === true;
    const originalTargetWordCount = context.chapterPlan.targetWordCount;

    let content: string;
    if (shouldSkip('step2_writer')) {
      // 断点续跑：恢复已完成的写作产出，不重复消耗 LLM token
      content = doneData.get('step2_writer')?.content || '';
      emitEvent('status', { step: 'writing', message: '写作步骤已完成，从检查点恢复初稿...' });
      emitEvent('token', { content });
    } else {
      emitEvent('status', { step: 'writing', message: 'AI正在写作...' });
      currentMainStep = 'step2_writer';
      await markStepRunning(taskId, 'step2_writer', 20);
      if (oreFoundryEnabled) {
        // 精修初稿模式：第一阶段扩展到4500-5500字
        context.chapterPlan.targetWordCount = 5000;
        emitEvent('status', { step: 'writing', message: '精修初稿模式：扩展写作中（目标5000字）...' });
      }
      content = await writerAgent.writeChapter(context, writerLlmConfig, onUsage);
      // 恢复原始目标字数
      if (oreFoundryEnabled) {
        context.chapterPlan.targetWordCount = originalTargetWordCount;
      }
      emitEvent('token', { content });
      await markStepCompleted(taskId, 'step2_writer', 20, { content }, stepTokenAcc['step2_writer']);
    }

    // 检查是否被取消
    if (isCancelled(taskId)) {
      // 保存已生成内容
      await saveGeneratedContent(taskId, plan.id, content, null, null, {
        projectId: project.id, volumeNo: plan.volumeNo, chapterNo: plan.chapterNo, title: plan.title,
      });
      await updateTaskStatus(taskId, 'cancelled', 'cancelled');
      emitEvent('status', { step: 'cancelled', message: '任务已取消，已保存已生成内容' });
      return { taskId, content };
    }

    // step3_audit_revise checkpoint 范围：预校验 + 审计回炉 + 禁用词复核 + 精修压缩
    let auditReport: AuditReport | null = null;
    const genConfig = (project.generationConfig || {}) as Record<string, any>;
    if (shouldSkip('step3_audit_revise')) {
      // 断点续跑：恢复审计/修订后的定稿
      const d3 = doneData.get('step3_audit_revise') || {};
      if (typeof d3.content === 'string' && d3.content) content = d3.content;
      emitEvent('status', { step: 'auditing', message: '审计/修订步骤已完成，从检查点恢复定稿...' });
      emitEvent('token', { content });
    } else {
    currentMainStep = 'step3_audit_revise';
    await markStepRunning(taskId, 'step3_audit_revise', 30);
    // 3.5 本地质量预校验（零 token，快速拦截确定性问题）
    const preCheck = runQualityGate(content, {
      povNames: context.chapterPlan.povCharacterNames,
      forbiddenWords: context.style?.forbiddenWords,
      hardFacts: context.hardFacts,
    });
    if (!preCheck.passed) {
      emitEvent('pre_check', preCheck);
      await logGeneration(taskId, 'pre_quality_gate', 'warn',
        `本地预校验未通过: ${preCheck.issues.map(i => `${i.type}×${i.count}`).join(', ')}`);
      // 若有 critical 问题（如禁用词），直接进入修订，不浪费 LLM 审计 token
      const criticalPre = preCheck.issues.filter(i => i.severity === 'critical');
      if (criticalPre.length > 0 && !options.skipRevision) {
        await updateTaskStatus(taskId, 'revising', 'pre_check_revision');
        emitEvent('status', { step: 'revising', message: `本地预校验发现${criticalPre.length}个严重问题，先行修订...` });
        const preAudit = {
          overallScore: 60,
          issues: criticalPre.map(i => ({
            severity: 'critical' as const,
            dimension: i.type,
            description: i.message,
            suggestion: '请修正后重新检查',
          })),
        };
        const revisionResult = await reviserAgent.reviseChapter(content, preAudit as any, context, resolveRoleConfig('reviser'), onUsage);
        content = revisionResult.revisedContent;
      }
    }

    // 4. 审计 + 质量门槛回炉循环
    const qualityGateMinScore: number = genConfig.qualityGateMinScore ?? 85;
    const maxRewriteRounds: number = genConfig.maxRewriteRounds ?? 2;
    let rewriteRound = 0;

    if (!options.skipAudit) {
      do {
        await updateTaskStatus(taskId, 'auditing', `auditing_round_${rewriteRound}`);
        emitEvent('status', { step: 'auditing', message: rewriteRound === 0 ? '正在审计章节质量...' : `第${rewriteRound + 1}轮审计中...` });

        auditReport = await auditorAgent.auditChapter(content, context, resolveRoleConfig('auditor'), onUsage);

        // 把确定性扫描命中的禁用词作为权威 critical 问题并入报告（去重），触发修订清除
        const forbiddenHits = scanForbiddenWords(content, context.style?.forbiddenWords);
        for (const w of forbiddenHits) {
          const already = auditReport.issues.some(
            (i) => i.dimension === '风格一致性' && i.description.includes(w)
          );
          if (!already) {
            auditReport.issues.unshift({
              severity: 'critical',
              dimension: '风格一致性',
              description: `正文出现禁用词「${w}」`,
              suggestion: `删除或替换禁用词「${w}」，保持语义连贯`,
            });
          }
        }

        emitEvent('audit', { ...auditReport, round: rewriteRound });

        // 质量门槛判定：总分达标 且 无critical问题
        const criticalCount = auditReport.issues.filter(i => i.severity === 'critical').length;
        const passed = auditReport.overallScore >= qualityGateMinScore && criticalCount === 0;

        if (passed) break; // 达标，退出循环

        // 未达标，执行修订
        rewriteRound++;
        if (rewriteRound > maxRewriteRounds || options.skipRevision) {
          await logGeneration(taskId, 'quality_gate', 'warn',
            `达到最大回炉次数(${maxRewriteRounds})或跳过修订，最终得分${auditReport.overallScore}，门槛${qualityGateMinScore}`);
          break;
        }

        await updateTaskStatus(taskId, 'revising', `revising_round_${rewriteRound}`);
        emitEvent('status', {
          step: 'revising',
          message: `第${rewriteRound}轮未达标（${auditReport.overallScore}分/${qualityGateMinScore}分，critical×${criticalCount}），正在回炉修订...`,
        });

        const revisionResult = await reviserAgent.reviseChapter(content, auditReport, context, resolveRoleConfig('reviser'), onUsage);
        content = revisionResult.revisedContent;
        (auditReport as any).revisionNotes = revisionResult.revisionNotes;
      } while (true);

      if (rewriteRound > 0) {
        await logGeneration(taskId, 'quality_gate', 'info',
          `质量门槛回炉完成：共${rewriteRound}轮修订，最终得分${auditReport?.overallScore ?? 'N/A'}`);
      }
    } else {
      // 跳过审计时仍做禁用词兜底告警
      const forbiddenHits = scanForbiddenWords(content, context.style?.forbiddenWords);
      if (forbiddenHits.length) {
        await logGeneration(taskId, 'forbidden_words', 'warn', `正文出现禁用词: ${forbiddenHits.join('、')}`);
      }
    }

    // 修订后复核禁用词（兜底告警，确保"禁用词零出现"可观测）
    const finalHits = scanForbiddenWords(content, context.style?.forbiddenWords);
    if (finalHits.length) {
      await logGeneration(taskId, 'forbidden_words', 'warn', `修订后仍存在禁用词: ${finalHits.join('、')}`);
    }

    // 5.4 精修初稿压缩（天命P2#8 Ore Foundry 第二阶段）
    if (oreFoundryEnabled && content.length > originalTargetWordCount * 1.1) {
      await updateTaskStatus(taskId, 'running', 'condensing');
      emitEvent('status', { step: 'condensing', message: `精修压缩中：${content.length}字 → 目标${originalTargetWordCount}字...` });
      const condensed = await reviserAgent.condenseToTarget(content, originalTargetWordCount, resolveRoleConfig('reviser'), onUsage);
      content = condensed.content;
      emitEvent('token', { content });
      await logGeneration(taskId, 'ore_foundry', 'info', `精修压缩完成：${condensed.notes.join('；')}`);
    }
    await markStepCompleted(taskId, 'step3_audit_revise', 30, { content, overallScore: auditReport?.overallScore ?? null }, stepTokenAcc['step3_audit_revise']);
    }

    // 5.5 组装章信息仪表盘（天命P1#6）
    const dashboard: Record<string, any> = {
      chapterInfo: {
        volumeNo: plan.volumeNo,
        chapterNo: plan.chapterNo,
        title: plan.title,
        chapterType: plan.chapterType || 'progression',
        conflictRating: plan.conflictRating || null,
        isPeak: plan.isPeak ?? false,
      },
      wordCount: content.length,
      styleScore: auditReport?.overallScore ?? null,
      characters: (built.context.characters || []).map((ch: any) => ch.name).filter(Boolean),
      foreshadow: {
        planted: (built.context.foreshadows || []).filter((f: any) => f.status === 'planted').length,
        pending: (built.context.foreshadows || []).filter((f: any) => f.status === 'pending').length,
      },
      hookType: plan.hookType || null,
      hookIntensity: plan.hookIntensity || null,
      generatedAt: new Date().toISOString(),
    };

    // 6. 保存generated_chapter
    if (shouldSkip('step4_save_result')) {
      emitEvent('status', { step: 'save', message: '章节已保存过，跳过重复保存...' });
    } else {
      currentMainStep = 'step4_save_result';
      await markStepRunning(taskId, 'step4_save_result', 40);
      await saveGeneratedContent(taskId, plan.id, content, auditReport, null, {
        projectId: project.id, volumeNo: plan.volumeNo, chapterNo: plan.chapterNo, title: plan.title,
        dashboard,
      });

      // 7. 更新chapter_plan状态
      await creativeDb
        .update(schema.chapterPlan)
        .set({ status: 'generated', updatedAt: new Date() })
        .where(eq(schema.chapterPlan.id, plan.id));
      await markStepCompleted(taskId, 'step4_save_result', 40, { wordCount: content.length });
    }

    // 7.5 后验更新独立工作流（架构升级 Epic2：原 10 个后置处理块迁移至 workflows/postUpdate.ts）
    // 由 generationConfig.autoPostUpdate 控制（默认 true，向后兼容）；关闭后可通过 POST /api/projects/:pid/post-update 手动触发
    let entitiesFound: EntityMaintainResult | undefined;
    const autoPostUpdate = genConfig.autoPostUpdate !== false;
    currentMainStep = 'step5_post_update';
    if (shouldSkip('step5_post_update')) {
      emitEvent('status', { step: 'post_update', message: '后验更新已完成，跳过...' });
    } else if (!autoPostUpdate) {
      await markStepSkipped(taskId, 'step5_post_update', 50);
      await logGeneration(taskId, 'post_update', 'info', '自动后验更新已关闭（autoPostUpdate=false），可在章节详情/生成控制台手动触发');
      emitEvent('status', { step: 'post_update', message: '自动后验更新已关闭，可手动触发' });
    } else {
      await markStepRunning(taskId, 'step5_post_update', 50);
      emitEvent('status', { step: 'post_update', message: '正在运行后验更新工作流...' });
      const postResult = await runPostUpdateWorkflow({
        taskId,
        projectId: project.id,
        planId: plan.id,
        volumeNo: plan.volumeNo,
        chapterNo: plan.chapterNo,
        title: plan.title,
        intent: plan.intent,
        content,
        sourceBookId: project.sourceBookId ?? 1,
        povCharacterIds: Array.isArray(plan.povCharacterIds) ? (plan.povCharacterIds as number[]).map(Number) : [],
        hookType: plan.hookType ?? null,
        generationConfig: genConfig,
        llmConfig,
        onUsage,
        emitEvent: (type, data) => emitEvent(type as GenerationStreamEvent['type'], data),
      }, Array.isArray(genConfig.postUpdateDisabledSteps) ? genConfig.postUpdateDisabledSteps : []);
      entitiesFound = postResult.entitiesFound;
      const failedSteps = postResult.results.filter((r) => r.status === 'failed');
      if (failedSteps.length) {
        await logGeneration(taskId, 'post_update', 'warn', `后验更新完成（${failedSteps.length}步失败）：${failedSteps.map((f) => f.label).join('、')}（可手动重跑）`);
      }
      await markStepCompleted(taskId, 'step5_post_update', 50, {
        summary: postResult.results.map((r) => ({ step: r.step, status: r.status })),
      }, postResult.tokens);
    }

    // 8. 完成任务（写入token用量和模型）
    await creativeDb
      .update(schema.generationTask)
      .set({ tokensUsed: totalTokens, llmModel: usedModel })
      .where(eq(schema.generationTask.id, taskId));
    await updateTaskStatus(taskId, 'completed', 'completed');

    // 动态叙事引擎：章节生成完成后检查分支弧是否到达汇合时机（fire-and-forget，失败降级不阻断）
    void (async () => {
      try {
        const r = await maybeAutoConverge(project.id);
        if (r.triggered) {
          console.log(`[叙事引擎] 自动汇合已触发: ${r.reason ?? ''}`);
        } else if (r.reason) {
          console.log(`[叙事引擎] 汇合检查: ${r.reason}`);
        }
      } catch (e: any) {
        console.warn(`[叙事引擎] 自动汇合检查失败（降级）: ${e?.message || e}`);
      }
    })();

    emitEvent('complete', {
      taskId,
      wordCount: content.length,
      auditScore: auditReport?.overallScore ?? null,
      tokensUsed: totalTokens,
      entitiesFound: entitiesFound ?? null,
    });

    // 记录日志
    await logGeneration(taskId, 'complete', 'info', `章节生成完成，字数: ${content.length}`);

    return { taskId, content };
  } catch (error: any) {
    // 欠账门拦截：专用终态（debt_gate_blocked），不标记步骤失败，前端据 error 前缀弹拦截清单
    if (error instanceof DebtGateBlockedError) {
      if (taskId) {
        await updateTaskStatus(taskId, 'failed', 'debt_gate_blocked', error.message);
        onEvent?.({ type: 'error', data: { message: error.message, code: 'DEBT_GATE_BLOCKED' }, timestamp: Date.now() });
      }
      throw error;
    }
    // 错误恢复：记录状态，不丢失已生成内容；标记失败步骤（可从该步骤重试）
    if (taskId) {
      const failedStep = MAIN_PIPELINE_STEPS.find((s) => s.name === currentMainStep);
      if (failedStep) {
        await markStepFailed(taskId, failedStep.name, failedStep.order, error.message).catch(() => {});
      }
      await updateTaskStatus(taskId, 'failed', 'error', error.message);
      await logGeneration(taskId, 'error', 'error', `生成失败: ${error.message}`);
      onEvent?.({ type: 'error', data: { message: error.message }, timestamp: Date.now() });
    }
    throw error;
  } finally {
    activeStreams.delete(taskId);
  }
}

/**
 * 流式生成章节（SSE）
 */
export async function generateChapterStream(
  chapterPlanId: number,
  options: GenerationOptions = {}
): Promise<{ taskId: number; stream: ReadableStream<string> }> {
  // 先创建任务获取taskId
  const [plan] = await creativeDb
    .select()
    .from(schema.chapterPlan)
    .where(eq(schema.chapterPlan.id, chapterPlanId))
    .limit(1);

  if (!plan) {
    throw new Error(`章节计划不存在: id=${chapterPlanId}`);
  }

  const [task] = await creativeDb
    .insert(schema.generationTask)
    .values({
      projectId: plan.projectId,
      chapterPlanId: plan.id,
      taskType: 'chapter',
      status: 'pending',
      currentStep: 'queued',
    })
    .returning();

  const taskId = task.id;

  // 创建SSE流
  const stream = new ReadableStream<string>({
    start(controller) {
      activeStreams.set(taskId, { controller, cancelled: false });

      // 异步执行生成管线（复用同一个taskId，避免前端轮询的任务与实际执行的任务不一致）
      generateChapter(chapterPlanId, options, (event) => {
        if (isCancelled(taskId)) return;
        const sseData = `data: ${JSON.stringify(event)}\n\n`;
        try {
          controller.enqueue(sseData);
        } catch {
          // 流已关闭
        }
      }, taskId)
        .then(() => {
          try {
            controller.close();
          } catch {
            // 已关闭
          }
        })
        .catch((err) => {
          try {
            controller.enqueue(`data: ${JSON.stringify({ type: 'error', data: { message: err.message }, timestamp: Date.now() })}\n\n`);
            controller.close();
          } catch {
            // 已关闭
          }
        });
    },
    cancel() {
      // 客户端断开时取消任务
      const state = activeStreams.get(taskId);
      if (state) {
        state.cancelled = true;
      }
    },
  });

  return { taskId, stream };
}

/**
 * 取消生成任务
 */
export async function cancelGeneration(taskId: number): Promise<boolean> {
  const state = activeStreams.get(taskId);
  if (state) {
    state.cancelled = true;
    await updateTaskStatus(taskId, 'cancelled', 'cancelled');
    return true;
  }

  // 尝试更新数据库中的任务状态
  const [task] = await creativeDb
    .select()
    .from(schema.generationTask)
    .where(eq(schema.generationTask.id, taskId))
    .limit(1);

  if (task && (task.status === 'running' || task.status === 'pending')) {
    await updateTaskStatus(taskId, 'cancelled', 'cancelled');
    return true;
  }

  return false;
}

/**
 * 检查任务是否被取消
 */
function isCancelled(taskId: number): boolean {
  const state = activeStreams.get(taskId);
  return state?.cancelled ?? false;
}

/**
 * 更新任务状态
 */
async function updateTaskStatus(
  taskId: number,
  status: TaskStatus,
  currentStep: string,
  errorMessage?: string
): Promise<void> {
  const updateData: Record<string, any> = {
    status,
    currentStep,
  };

  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    updateData.completedAt = new Date();
  }
  if (errorMessage) {
    updateData.errorMessage = errorMessage;
  }

  await creativeDb
    .update(schema.generationTask)
    .set(updateData)
    .where(eq(schema.generationTask.id, taskId));
}

/**
 * 保存生成的章节内容
 */
async function saveGeneratedContent(
  taskId: number,
  chapterPlanId: number,
  content: string,
  auditReport: any,
  revisionNotes: string[] | null,
  meta?: { projectId?: number; volumeNo?: number; chapterNo?: number; title?: string; dashboard?: any }
): Promise<void> {
  // 将之前的版本标记为非当前
  await creativeDb
    .update(schema.generatedChapter)
    .set({ isCurrent: false })
    .where(eq(schema.generatedChapter.chapterPlanId, chapterPlanId));

  // 计算版本号
  const existingVersions = await creativeDb
    .select({ version: schema.generatedChapter.version })
    .from(schema.generatedChapter)
    .where(eq(schema.generatedChapter.chapterPlanId, chapterPlanId));

  const nextVersion = existingVersions.length > 0
    ? Math.max(...existingVersions.map((v) => v.version)) + 1
    : 1;

  await creativeDb.insert(schema.generatedChapter).values({
    projectId: meta?.projectId,
    chapterPlanId,
    taskId,
    volumeNo: meta?.volumeNo ?? 1,
    chapterNo: meta?.chapterNo ?? 1,
    title: meta?.title || '',
    version: nextVersion,
    content,
    wordCount: content.length,
    isCurrent: true,
    status: 'draft',
    dashboard: meta?.dashboard ?? null,
  });

  // auditReport和revisionNotes属于generationTask，更新到任务记录上
  if (auditReport) {
    await creativeDb
      .update(schema.generationTask)
      .set({
        auditReport,
        revisionNotes: revisionNotes ? JSON.stringify(revisionNotes) : null,
      })
      .where(eq(schema.generationTask.id, taskId));
  }
}

/**
 * 记录生成日志
 */
async function logGeneration(
  taskId: number,
  step: string,
  level: string,
  message: string,
  metadata?: any
): Promise<void> {
  await creativeDb.insert(schema.generationLog).values({
    taskId,
    agentName: level,
    action: step,
    detail: { message, ...metadata },
  });
}

/**
 * 构建检索素材快照（写入 generation_task.input_snapshot，并推送前端）
 * 记录本次生成从诛仙库检索到的全部素材及其来源（显式下发 / 自动关联），
 * 并把人物关系的双方ID解析为姓名，便于前端直观展示。
 */
async function buildInputSnapshot(
  context: ContextPackage,
  retrieval: RetrievalInfo
): Promise<Record<string, any>> {
  // 解析关系双方姓名：优先用上下文里已有的人物，缺失的再批量查库
  const nameMap = new Map<number, string>(context.characters.map((c) => [c.id, c.name]));
  const missingIds = Array.from(
    new Set(context.relations.flatMap((r) => [r.charAId, r.charBId]))
  ).filter((id) => !nameMap.has(id));

  if (missingIds.length) {
    try {
      const extra = await retriever.getCharactersByIds(missingIds);
      for (const c of extra) nameMap.set(c.id, c.name);
    } catch {
      // 名称解析失败不阻断，前端会回退显示 人物#id
    }
  }

  const relationsResolved = context.relations.map((r) => ({
    charAId: r.charAId,
    charBId: r.charBId,
    charAName: nameMap.get(r.charAId) || `人物#${r.charAId}`,
    charBName: nameMap.get(r.charBId) || `人物#${r.charBId}`,
    relType: r.relType,
    interactCount: r.interactCount,
  }));

  return {
    retrievedAt: new Date().toISOString(),
    explicit: retrieval.explicit,
    autoLinked: retrieval.autoLinked,
    counts: retrieval.counts,
    estimatedTokens: retrieval.estimatedTokens,
    characters: context.characters,
    factions: context.factions,
    locations: context.locations,
    skills: context.skills,
    items: context.items,
    relations: relationsResolved,
    prevSummaries: context.prevSummaries,
  };
}
