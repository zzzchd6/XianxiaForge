/**
 * 独立润色路由（架构升级 Epic3）
 * POST /api/projects/:pid/chapters/:cid/polish — 对已生成章节独立润色（与生成流程解耦）
 * 流程：自审（30维审计）→ AI味检测（审计反模式/AI味维度 + 禁用词扫描）→ 针对性润色（按级别）→ 最终复核
 * 返回 diff 供前端展示，用户确认后前端调用既有 PUT /chapters/:id/content 落库新版本
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { buildContextForChapter } from '../rag/context-builder.js';
import { scanForbiddenWords } from '../rag/style.js';
import { auditorAgent } from '../agents/auditor.js';
import { reviserAgent } from '../agents/reviser.js';
import type { LlmConfig } from '../types.js';

const app = new Hono();

const polishSchema = z.object({
  level: z.enum(['light', 'medium', 'deep']).default('medium'),
});

/** 润色级别 → 修订指令（复用 ReviserAgent.reviseWithInstruction 的指令式润色） */
const LEVEL_INSTRUCTIONS: Record<'light' | 'medium' | 'deep', string> = {
  light: `轻度润色：只修正语病、错别字、标点错误和明显不通顺的句子。
严格保持原文内容、结构、段落顺序不变，不做任何表达优化或改写。
修改量控制在最小范围。`,
  medium: `中度润色：在保持情节、结构不变的前提下优化表达。
重点处理以下 AI 味反模式（命中即改）：
- empty_summary 空泛总结型：把"心中五味杂陈""感慨万千"类总结句改成具体的身体动作、手势、停顿或物件变化
- cliche_atmosphere 套路氛围型：删掉"空气仿佛凝固""时间仿佛静止"类套话，换成具体感官细节
- adjective_stack 形容词堆叠：连续三个以上形容词的描写压缩为一两个精准词
- explanatory_dialogue 解说型对话：删掉角色互相解释设定/动机的台词，改为动作与潜台词
- uniform_rhythm 节奏单一：调整长短句分布，关键处用短句提速，铺垫处用长句放缓
同时修正语病与禁用词，保持原作叙事视角。`,
  deep: `深度润色：允许重写表现力薄弱的整段文字（占比不超过全文三分之一）。
在情节事实、人物言行逻辑不变的前提下：
1. 重写空洞的心理描写与氛围渲染，改为具体可感的场景细节
2. 强化对话潜台词，删除直白的情绪说明
3. 优化段落衔接与叙事节奏，增强画面感与沉浸感
4. 清除全部 AI 味反模式（empty_summary/cliche_atmosphere/adjective_stack/explanatory_dialogue/uniform_rhythm）
保持原作文风基调与叙事视角，不得引入本书禁用词。`,
};

/** 段落级 diff（LCS），供前端渲染对比 */
function buildParagraphDiff(original: string, polished: string) {
  const a = original.split(/\n+/).filter((s) => s.trim());
  const b = polished.split(/\n+/).filter((s) => s.trim());
  const n = a.length;
  const m = b.length;
  // LCS 动态规划（章节段落数量级可控）
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const diff: Array<{ type: 'same' | 'removed' | 'added'; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      diff.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: 'removed', text: a[i] });
      i++;
    } else {
      diff.push({ type: 'added', text: b[j] });
      j++;
    }
  }
  while (i < n) diff.push({ type: 'removed', text: a[i++] });
  while (j < m) diff.push({ type: 'added', text: b[j++] });

  const changed = diff.filter((d) => d.type !== 'same').length;
  return { diff, changedParagraphs: changed, totalParagraphs: Math.max(n, m) };
}

const polishHandler = async (c: any) => {
  try {
    const cid = Number(c.req.param('cid'));
    if (isNaN(cid)) return c.json({ success: false, error: '无效的章节ID' }, 400);

    const parsed = polishSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const level = parsed.data.level;

    // 1. 加载当前版本正文
    const [chapter] = await creativeDb
      .select()
      .from(schema.generatedChapter)
      .where(and(
        eq(schema.generatedChapter.chapterPlanId, cid),
        eq(schema.generatedChapter.isCurrent, true),
      ))
      .limit(1);
    if (!chapter?.content) {
      return c.json({ success: false, error: '该章节尚无生成内容，无法润色' }, 404);
    }

    const [plan] = await creativeDb
      .select()
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.id, cid))
      .limit(1);
    if (!plan) return c.json({ success: false, error: '章节计划不存在' }, 404);

    const [project] = await creativeDb
      .select()
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, plan.projectId))
      .limit(1);
    if (!project) return c.json({ success: false, error: '项目不存在' }, 404);

    // 2. 构建上下文（跳过RAG，控制成本）
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
    }, [], { enabled: false }, (project.generationConfig as any) || {});
    const context = built.context;
    const llmConfig = (project.llmConfig || undefined) as LlmConfig | undefined;

    // 3. 自审（30维审计）
    const auditReport = await auditorAgent.auditChapter(chapter.content, context, llmConfig);

    // 4. AI味检测：审计维度命中 + 禁用词确定性扫描
    const forbiddenHits = scanForbiddenWords(chapter.content, context.style?.forbiddenWords);
    const aiFlavorHints = auditReport.issues
      .filter((it) => /AI味|套路|堆叠|空泛|解说|节奏单一|氛围|总结/.test(it.dimension || '') || /AI味|套路|堆叠|空泛/.test(it.description || ''))
      .map((it) => `[${it.dimension}] ${it.description}`);
    const aiFlavorReport = {
      forbiddenHits,
      aiFlavorHints,
      summary: forbiddenHits.length || aiFlavorHints.length
        ? `命中禁用词${forbiddenHits.length}处、疑似AI味问题${aiFlavorHints.length}处`
        : '未检测到明显AI味问题',
    };

    // 5. 针对性润色（按级别组装指令，附自审问题与AI味检测结果）
    const extra: string[] = [];
    if (aiFlavorReport.forbiddenHits.length) {
      extra.push(`必须清除的禁用词：${aiFlavorReport.forbiddenHits.join('、')}`);
    }
    if (aiFlavorHints.length) {
      extra.push(`审计发现的疑似AI味问题（重点处理）：\n${aiFlavorHints.slice(0, 10).join('\n')}`);
    }
    const criticalIssues = auditReport.issues.filter((it) => it.severity === 'critical' || it.severity === 'major');
    if (criticalIssues.length && level !== 'light') {
      extra.push(`审计发现的内容问题（顺带修正）：\n${criticalIssues.slice(0, 8).map((it) => `- [${it.dimension}] ${it.description}`).join('\n')}`);
    }
    const instruction = LEVEL_INSTRUCTIONS[level] + (extra.length ? `\n\n【补充要求】\n${extra.join('\n')}` : '');

    const revision = await reviserAgent.reviseWithInstruction(chapter.content, instruction, undefined, context, llmConfig);
    const polishedText = revision.revisedContent;

    // 6. 最终复核（轻量：禁用词复检 + 字数变化；避免再跑一次30维审计的成本）
    const finalForbidden = scanForbiddenWords(polishedText, context.style?.forbiddenWords);
    const finalAuditScore = auditReport.overallScore; // 自审得分（复核不再消耗一次完整审计）

    const { diff, changedParagraphs, totalParagraphs } = buildParagraphDiff(chapter.content, polishedText);

    return c.json({
      success: true,
      data: {
        chapterPlanId: cid,
        level,
        originalText: chapter.content,
        polishedText,
        diff,
        changedParagraphs,
        totalParagraphs,
        auditScore: finalAuditScore,
        auditIssues: auditReport.issues.length,
        aiFlavorReport,
        finalForbiddenHits: finalForbidden,
        revisionNotes: revision.revisionNotes,
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: `润色失败: ${error.message}` }, 500);
  }
};

app.post('/projects/:pid/chapters/:cid/polish', polishHandler);
app.post('/chapters/:cid/polish', polishHandler);

export default app;
