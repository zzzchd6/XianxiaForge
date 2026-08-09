/**
 * 用量统计路由（开源借鉴 PRD v1.1 M3 / US-10）
 * - GET /api/usage/summary?projectId&days：按日 token 趋势 + 按任务角色拆分 + 成本估算
 * 数据源：generation_task.tokensUsed（任务级）+ pipeline_checkpoint.token_input/token_output（步骤级）
 */
import { Hono } from 'hono';
import { eq, and, gte } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';

const app = new Hono();

/** 步骤名→任务角色映射（用于按角色拆分展示） */
const STEP_ROLE_MAP: Record<string, string> = {
  step1_build_context: 'context',
  step2_writer: 'writer',
  step3_audit_revise: 'auditor/reviser',
  step4_save_result: 'save',
  step5_post_update: 'post(汇总)',
  post_state_extract: 'extractor',
  post_branch_generate: 'branch',
  post_quote_extract: 'quote',
};

/** 默认成本估算单价（元/1k token）；仅为面板估算参考 */
const DEFAULT_PRICE = { input: 0.002, output: 0.008 };

/** GET /api/usage/summary - 用量汇总（趋势/角色拆分/成本估算） */
app.get('/usage/summary', async (c) => {
  try {
    const projectIdRaw = c.req.query('projectId');
    const days = Math.min(365, Math.max(1, Number(c.req.query('days') ?? 30) || 30));
    const since = new Date(Date.now() - days * 86400_000);

    // 1. 任务级：按日 token 趋势（generation_task）
    const taskWhere = projectIdRaw
      ? and(gte(schema.generationTask.createdAt, since), eq(schema.generationTask.projectId, Number(projectIdRaw)))
      : gte(schema.generationTask.createdAt, since);
    const tasks = await creativeDb
      .select({
        id: schema.generationTask.id,
        projectId: schema.generationTask.projectId,
        tokensUsed: schema.generationTask.tokensUsed,
        llmModel: schema.generationTask.llmModel,
        status: schema.generationTask.status,
        createdAt: schema.generationTask.createdAt,
      })
      .from(schema.generationTask)
      .where(taskWhere);

    const byDay: Record<string, { date: string; tokens: number; taskCount: number }> = {};
    const byModel: Record<string, number> = {};
    for (const t of tasks) {
      const day = (t.createdAt ?? new Date()).toISOString().slice(0, 10);
      const tokens = t.tokensUsed || 0;
      byDay[day] ??= { date: day, tokens: 0, taskCount: 0 };
      byDay[day].tokens += tokens;
      byDay[day].taskCount += 1;
      if (t.llmModel) byModel[t.llmModel] = (byModel[t.llmModel] || 0) + tokens;
    }

    // 2. 步骤级：按任务角色拆分（pipeline_checkpoint join generation_task）
    const cpRows = await creativeDb
      .select({
        stepName: schema.pipelineCheckpoint.stepName,
        tokenInput: schema.pipelineCheckpoint.tokenInput,
        tokenOutput: schema.pipelineCheckpoint.tokenOutput,
        taskId: schema.pipelineCheckpoint.taskId,
        createdAt: schema.generationTask.createdAt,
        projectId: schema.generationTask.projectId,
      })
      .from(schema.pipelineCheckpoint)
      .innerJoin(schema.generationTask, eq(schema.pipelineCheckpoint.taskId, schema.generationTask.id))
      .where(
        projectIdRaw
          ? and(gte(schema.generationTask.createdAt, since), eq(schema.generationTask.projectId, Number(projectIdRaw)))
          : gte(schema.generationTask.createdAt, since)
      );

    const byRole: Record<string, { role: string; steps: string[]; input: number; output: number; total: number }> = {};
    for (const r of cpRows) {
      const role = STEP_ROLE_MAP[r.stepName] ?? r.stepName;
      byRole[role] ??= { role, steps: [], input: 0, output: 0, total: 0 };
      const e = byRole[role];
      if (!e.steps.includes(r.stepName)) e.steps.push(r.stepName);
      e.input += r.tokenInput || 0;
      e.output += r.tokenOutput || 0;
      e.total += (r.tokenInput || 0) + (r.tokenOutput || 0);
    }

    // 3. 成本估算（默认单价；step5_post_update 为其子步骤汇总，避免重复计费需剔除）
    let sumInput = 0;
    let sumOutput = 0;
    for (const [role, e] of Object.entries(byRole)) {
      if (role === 'post(汇总)') continue;
      sumInput += e.input;
      sumOutput += e.output;
    }
    const estimatedCost = Number(((sumInput / 1000) * DEFAULT_PRICE.input + (sumOutput / 1000) * DEFAULT_PRICE.output).toFixed(4));

    return c.json({
      success: true,
      data: {
        days,
        totals: {
          taskCount: tasks.length,
          tokensUsed: tasks.reduce((s, t) => s + (t.tokensUsed || 0), 0),
          checkpointInput: sumInput,
          checkpointOutput: sumOutput,
          estimatedCost,
          pricePerK: DEFAULT_PRICE,
        },
        byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
        byModel: Object.entries(byModel).map(([model, tokens]) => ({ model, tokens })),
        byRole: Object.values(byRole).sort((a, b) => b.total - a.total),
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: `查询用量失败: ${error.message}` }, 500);
  }
});

export default app;
