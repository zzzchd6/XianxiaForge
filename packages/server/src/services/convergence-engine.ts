/**
 * 汇合引擎（动态叙事引擎 v2.1 · 第三层：1+1>2 的核心）
 *
 * 分支弧接近完成时：
 *   1. 收集弧内章节编年史 + 新元素 + 目标里程碑 mustHappen
 *   2. LLM 生成汇合方案（汇合章节 + 后续计划重写）
 *   3. 全自动重写后续 chapterPlan（首个后续 planned 章转为汇合章，其余重写路径），
 *      每次重写记录 before/after 到 plan_rewrite_log，支持整体回滚
 *   4. writeBackKeyEvent 反写卷大纲；目标里程碑置 active
 */
import { eq, and, asc, gt, desc } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { chatCompletion } from '../llm/client.js';
import { writeBackKeyEvent } from './outline-writeback.js';
import { getArcWithProgress, getActiveArc } from './branch-arc-service.js';
import { getNextMilestone } from './milestone-service.js';

/** 单次重写上限（防 token 爆炸） */
const MAX_REWRITES = 40;

interface ConvergencePlan {
  convergence: { planId: number; title: string; intent: string };
  rewrites: { planId: number; title: string; intent: string }[];
}

/** 宽松 JSON 对象解析（兼容 ```json 围栏） */
function parseJsonObject(text: string): any {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('LLM 输出未包含 JSON 对象');
  return JSON.parse(t.slice(start, end + 1));
}

/**
 * 执行汇合：把分支弧的后果带入主线，全自动重写后续计划。
 * @param arcId 分支弧 ID
 * @param opts.manual 是否作者手动触发（仅影响日志描述）
 */
export async function convergeArc(
  arcId: number,
  opts: { manual?: boolean } = {},
): Promise<{ ok: boolean; error?: string; convergencePlanId?: number; rewritten?: number; milestoneLabel?: string }> {
  const arcInfo = await getArcWithProgress(arcId);
  if (!arcInfo) return { ok: false, error: '分支弧不存在' };
  if (arcInfo.status !== 'active') return { ok: false, error: `分支弧已处于 ${arcInfo.status} 状态` };
  if (!arcInfo.chapters.length) return { ok: false, error: '分支弧内暂无章节，无法汇合' };

  // 目标里程碑：弧指定的汇合点，缺省取下一个待到达里程碑
  let milestone: any = null;
  if (arcInfo.convergeToMilestoneId) {
    const [m] = await creativeDb
      .select()
      .from(schema.narrativeMilestone)
      .where(eq(schema.narrativeMilestone.id, arcInfo.convergeToMilestoneId))
      .limit(1);
    milestone = m ?? null;
  }
  if (!milestone) milestone = await getNextMilestone(arcInfo.projectId);

  // 弧编年史
  const chronicle = arcInfo.chapters.map((c: any) => `第${c.chapterNo}章《${c.title}》`).join('、');

  // 后续待重写计划：chapterNo > 弧内最大章节号 且 status='planned'（全部后续未完成计划）
  const lastChapterNo = Math.max(...arcInfo.chapters.map((c: any) => c.chapterNo));
  const followUps = await creativeDb
    .select({
      id: schema.chapterPlan.id,
      chapterNo: schema.chapterPlan.chapterNo,
      volumeNo: schema.chapterPlan.volumeNo,
      title: schema.chapterPlan.title,
      intent: schema.chapterPlan.intent,
      outlineId: schema.chapterPlan.outlineId,
    })
    .from(schema.chapterPlan)
    .where(and(
      eq(schema.chapterPlan.projectId, arcInfo.projectId),
      eq(schema.chapterPlan.status, 'planned'),
      gt(schema.chapterPlan.chapterNo, lastChapterNo),
    ))
    .orderBy(asc(schema.chapterPlan.chapterNo))
    .limit(MAX_REWRITES);
  if (!followUps.length) return { ok: false, error: '后续没有可重写的 planned 章节计划（汇合需要至少一章承接）' };

  const newElements: any = arcInfo.newElements ?? {};
  const elementDesc = ['characters', 'locations', 'foreshadows', 'items']
    .map((k) => (newElements[k]?.length ? `${k}: ${newElements[k].map((e: any) => e.name).join('、')}` : ''))
    .filter(Boolean)
    .join('；') || '（无）';

  const systemPrompt = `你是一位仙侠长篇的总架构师。一条分支弧即将汇合回主线里程碑，你需要设计"汇合章节"并重写后续章节计划，让分支中发生的一切真正算数。

要求：
- 汇合章节（第一条计划）：主角带着分支经历自然过渡到里程碑场景，不能生硬跳转；分支中的关键经历必须被提及。
- 后续计划重写：保留后续里程碑方向不变，重写里程碑之间的路径以融入分支后果；分支产生的新伏笔应安排在后续回收；人物关系变化要体现在后续走向里。
- 只修改 title 和 intent，章节数量与章节号不变，不增删计划。
- 严格基于提供的信息设计，不虚构未提供的人物与设定。

输出格式（严格JSON，不要输出JSON以外任何文字）：
{
  "convergence": { "planId": <第一条计划的planId>, "title": "汇合章标题", "intent": "汇合章核心写作意图（含分支遗产与里程碑衔接，80-200字）" },
  "rewrites": [ { "planId": <计划ID>, "title": "新标题", "intent": "新意图（融入分支后果）" } ]
}`;

  const userParts: string[] = [];
  userParts.push(`【分支弧】「${arcInfo.title}」${arcInfo.premise ? `（前提：${arcInfo.premise}）` : ''}`);
  userParts.push(`弧内章节编年史：${chronicle}`);
  userParts.push(`分支产生的新元素：${elementDesc}`);
  if (milestone) {
    userParts.push(`\n【汇合目标里程碑】「${milestone.label}」${milestone.description ? `：${milestone.description}` : ''}`);
    const must = Array.isArray(milestone.mustHappen) ? milestone.mustHappen : [];
    if (must.length) userParts.push(`必须发生：${must.join('；')}`);
  } else {
    userParts.push('\n【汇合目标里程碑】（项目暂无里程碑，按故事自然走向收束分支）');
  }
  userParts.push(`\n【后续待重写计划（第一条将作为汇合章）】`);
  followUps.forEach((p, i) => {
    userParts.push(`- planId=${p.id} 第${p.chapterNo}章《${p.title}》${i === 0 ? '（← 汇合章候选）' : ''}${p.intent ? `：${String(p.intent).slice(0, 120)}` : ''}`);
  });
  userParts.push(`\n请输出汇合方案JSON（rewrites 只包含除汇合章外的其余计划，共${followUps.length - 1}条）。`);

  let llmOut: ConvergencePlan;
  try {
    const resp = await chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userParts.join('\n') },
      ],
      { temperature: 0.7, maxTokens: 4096 },
    );
    const parsed = parseJsonObject(resp);
    const validIds = new Set(followUps.map((p) => p.id));
    if (!parsed.convergence || !validIds.has(Number(parsed.convergence.planId))) {
      return { ok: false, error: 'LLM 汇合方案无效（缺少合法的 convergence.planId）' };
    }
    llmOut = {
      convergence: {
        planId: Number(parsed.convergence.planId),
        title: String(parsed.convergence.title || followUps[0].title).slice(0, 200),
        intent: String(parsed.convergence.intent || ''),
      },
      rewrites: Array.isArray(parsed.rewrites)
        ? parsed.rewrites
            .filter((r: any) => r && validIds.has(Number(r.planId)) && Number(r.planId) !== Number(parsed.convergence.planId))
            .map((r: any) => ({ planId: Number(r.planId), title: String(r.title || '').slice(0, 200), intent: String(r.intent || '') }))
        : [],
    };
  } catch (e: any) {
    return { ok: false, error: `汇合方案生成失败: ${e?.message || e}` };
  }

  // 事务落库：重写计划 + 审计日志 + 弧状态 + 大纲反写
  const byId = new Map(followUps.map((p) => [p.id, p]));
  const result = await creativeDb.transaction(async (tx) => {
    const applyRewrite = async (planId: number, title: string, intent: string, isConvergence: boolean, branchArcId: number | null) => {
      const before = byId.get(planId)!;
      const beforeSnapshot = { title: before.title, intent: before.intent, isConvergence: false };
      const afterSnapshot = { title, intent, isConvergence };
      await tx.insert(schema.planRewriteLog).values({
        projectId: arcInfo.projectId,
        branchArcId: arcId,
        action: opts.manual ? 'convergence_manual' : 'convergence',
        planId,
        beforeSnapshot,
        afterSnapshot,
      });
      await tx
        .update(schema.chapterPlan)
        .set({
          title,
          intent: intent || before.intent,
          isConvergence,
          branchArcId: isConvergence ? arcId : branchArcId,
          updatedAt: new Date(),
        })
        .where(eq(schema.chapterPlan.id, planId));
      return before;
    };

    // 汇合章
    const convPlan = await applyRewrite(
      llmOut.convergence.planId,
      llmOut.convergence.title,
      llmOut.convergence.intent,
      true,
      null,
    );
    // 其余重写（汇合章之后的路径）
    for (const r of llmOut.rewrites) {
      if (r.title || r.intent) await applyRewrite(r.planId, r.title || byId.get(r.planId)!.title, r.intent, false, null);
    }

    // 弧状态收敛
    await tx
      .update(schema.branchArc)
      .set({ status: 'converged', convergedAtChapter: convPlan.chapterNo })
      .where(eq(schema.branchArc.id, arcId));

    // 目标里程碑置 active（故事正朝它推进）
    if (milestone) {
      await tx
        .update(schema.narrativeMilestone)
        .set({ status: 'active', updatedAt: new Date() })
        .where(and(eq(schema.narrativeMilestone.id, milestone.id), eq(schema.narrativeMilestone.status, 'upcoming')));
    }

    // 卷大纲反写：汇合章的走向写回 keyEvents
    await writeBackKeyEvent(tx, convPlan.outlineId, convPlan.chapterNo, llmOut.convergence.title, llmOut.convergence.intent);

    return convPlan;
  });

  return {
    ok: true,
    convergencePlanId: result.id,
    rewritten: llmOut.rewrites.length,
    milestoneLabel: milestone?.label ?? null as any,
  };
}

/**
 * 回滚某分支弧触发的全部计划重写（按审计日志恢复 before 快照）。
 * 回滚后弧状态退回 active（可重新汇合）。
 */
export async function rollbackArcRewrites(arcId: number): Promise<{ restored: number }> {
  const logs = await creativeDb
    .select()
    .from(schema.planRewriteLog)
    .where(and(eq(schema.planRewriteLog.branchArcId, arcId), eq(schema.planRewriteLog.rolledBack, false)))
    .orderBy(desc(schema.planRewriteLog.id));

  if (!logs.length) return { restored: 0 };

  await creativeDb.transaction(async (tx) => {
    for (const log of logs) {
      const before: any = log.beforeSnapshot ?? {};
      await tx
        .update(schema.chapterPlan)
        .set({
          title: before.title,
          intent: before.intent ?? null,
          isConvergence: false,
          branchArcId: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.chapterPlan.id, log.planId));
      await tx
        .update(schema.planRewriteLog)
        .set({ rolledBack: true })
        .where(eq(schema.planRewriteLog.id, log.id));
    }
    await tx
      .update(schema.branchArc)
      .set({ status: 'active', convergedAtChapter: null })
      .where(eq(schema.branchArc.id, arcId));
  });

  return { restored: logs.length };
}

/** 列出某弧的重写审计日志（前端查看 before/after） */
export async function listRewriteLogs(arcId: number) {
  return creativeDb
    .select()
    .from(schema.planRewriteLog)
    .where(eq(schema.planRewriteLog.branchArcId, arcId))
    .orderBy(desc(schema.planRewriteLog.id));
}

/**
 * 自动汇合探测（章节生成完成后 best-effort 调用）：
 * 若当前 active 弧进度已达 estimatedLength，自动触发汇合。
 * 达硬性上限 5 章时不强制汇合（需作者确认豁免），仅返回提示。
 */
export async function maybeAutoConverge(projectId: number): Promise<{ triggered: boolean; reason?: string }> {
  const arc = await getActiveArc(projectId);
  if (!arc) return { triggered: false };
  const info = await getArcWithProgress(arc.id);
  if (!info) return { triggered: false };
  if (info.progress < (info.estimatedLength ?? 2)) return { triggered: false };
  if (info.progress >= 5) {
    return { triggered: false, reason: `分支弧「${arc.title}」已达${info.progress}章（硬性上限5章），请手动汇合或豁免延长` };
  }
  const res = await convergeArc(arc.id);
  if (!res.ok) return { triggered: false, reason: res.error };
  return { triggered: true, reason: `分支弧「${arc.title}」已自动汇合到里程碑${res.milestoneLabel ? `「${res.milestoneLabel}」` : ''}，后续大纲已更新` };
}
