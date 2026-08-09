/**
 * 双引擎 API 路由（PRD v1.3 §10.1）
 *
 * - POST /api/v1/dialogue/iceberg              三层冰山生成
 * - POST /api/v1/dialogue/iceberg/regenerate   冰山分步重生成（§7.3 联动）
 * - POST /api/v1/conflict/generate             冲突三要素生成
 * - POST /api/v1/conflict/regenerate           冲突分阶段重生成（§8.3 联动）
 * - POST /api/v1/conflict/compose              双引擎组合生成（五步工作流）
 * - POST /api/v1/validate                      独立校验打分（场景 D 编辑体检）
 * - GET  /api/v1/outline/conflict-draft        大纲联动预填草稿（场景 C，§10.3）
 * - GET  /api/v1/outline/iceberg-draft         冰山台词预填草稿（v1.5.1 新增）
 *
 * 错误码（§10.1.6）：400 INVALID_CONFIG / 502 LLM_UNAVAILABLE / 422 LLM_OUTPUT_PARSE_ERROR
 *                    / 200 VALIDATION_FAILED / 429 RATE_LIMITED / 404 NOT_FOUND
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { runIceberg, regenerateIceberg } from '../dual-engine/iceberg.js';
import { runConflict, regenerateConflict } from '../dual-engine/conflict.js';
import { runCompose } from '../dual-engine/composer.js';
import { buildConflictDraft, buildIcebergDraft, resolvePovNames } from '../dual-engine/outline-mapping.js';
import { scoreIceberg, scoreConflict, crossValidateCompose, computeEmotionCurve, resolveDesireType } from '../dual-engine/quality.js';
import {
  icebergGenerateRequestSchema, conflictGenerateRequestSchema, composeGenerateRequestSchema,
  icebergRegenerateSchema, conflictRegenerateSchema, validateSchema,
  icebergConfigSchema, conflictConfigSchema,
} from '../dual-engine/schemas.js';
import { EngineError, toEngineError } from '../dual-engine/errors.js';
import type { SurfaceLine, BehaviorAnchorLine } from '../dual-engine/types.js';

const app = new Hono();

/** 统一错误响应（EngineError → HTTP 状态码 + 错误码字符串） */
function fail(c: Context, error: any) {
  const e = error instanceof EngineError ? error : toEngineError(error);
  return c.json({
    success: false,
    code: e.code,
    error: e.message,
    ...(e.data ? { details: e.data } : {}),
  }, e.status as any);
}

/** 参数校验失败 → 400 INVALID_CONFIG（字段级明细） */
function invalidConfig(c: Context, zodError: z.ZodError) {
  return c.json({
    success: false,
    code: 'INVALID_CONFIG',
    error: '参数校验失败',
    details: zodError.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  }, 400);
}

// ============================================================
// §10.1.1 三层冰山台词生成
// ============================================================
app.post('/v1/dialogue/iceberg', async (c) => {
  try {
    const parsed = icebergGenerateRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return invalidConfig(c, parsed.error);
    const result = await runIceberg(parsed.data.projectId, parsed.data.config);
    return c.json({ success: true, data: result });
  } catch (error) {
    return fail(c, error);
  }
});

// ============================================================
// §10.1.2 分步重生成
// ============================================================
app.post('/v1/dialogue/iceberg/regenerate', async (c) => {
  try {
    const parsed = icebergRegenerateSchema.safeParse(await c.req.json());
    if (!parsed.success) return invalidConfig(c, parsed.error);
    const result = await regenerateIceberg(parsed.data.request_id, parsed.data.step, parsed.data.overrides);
    return c.json({ success: true, data: result });
  } catch (error) {
    return fail(c, error);
  }
});

// ============================================================
// §10.1.3 冲突三要素生成（+ 分阶段重生成）
// ============================================================
app.post('/v1/conflict/generate', async (c) => {
  try {
    const parsed = conflictGenerateRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return invalidConfig(c, parsed.error);
    const result = await runConflict(parsed.data.projectId, parsed.data.config);
    return c.json({ success: true, data: result });
  } catch (error) {
    return fail(c, error);
  }
});

app.post('/v1/conflict/regenerate', async (c) => {
  try {
    const parsed = conflictRegenerateSchema.safeParse(await c.req.json());
    if (!parsed.success) return invalidConfig(c, parsed.error);
    const result = await regenerateConflict(parsed.data.request_id, parsed.data.step, parsed.data.overrides);
    return c.json({ success: true, data: result });
  } catch (error) {
    return fail(c, error);
  }
});

// ============================================================
// §10.1.4 双引擎组合生成
// ============================================================
app.post('/v1/conflict/compose', async (c) => {
  try {
    const parsed = composeGenerateRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return invalidConfig(c, parsed.error);
    const result = await runCompose(parsed.data.projectId, parsed.data.config);
    // 交叉校验未通过且重试耗尽 → 200 + VALIDATION_FAILED（附当前最优结果 + 失败项清单）
    const code = result.cross_validation.passed ? undefined : 'VALIDATION_FAILED';
    return c.json({ success: true, code, data: result });
  } catch (error) {
    return fail(c, error);
  }
});

// ============================================================
// §10.1.5 校验打分（独立调用，场景 D 编辑体检）
// ============================================================

/** 解析完整对话文本（格式：角色名："台词"（行为描写））为 surface/behavior 层 */
function parseDialogueText(content: string): { surface: SurfaceLine[]; behavior: BehaviorAnchorLine[] } {
  const surface: SurfaceLine[] = [];
  const behavior: BehaviorAnchorLine[] = [];
  const re = /^(.+?)：[""「](.+?)[""」](?:（(.+?)）)?/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    surface.push({ speaker: m[1].trim(), line: m[2].trim() });
    behavior.push({ speaker: m[1].trim(), action: (m[3] || '').trim() });
  }
  return { surface, behavior };
}

app.post('/v1/validate', async (c) => {
  try {
    const parsed = validateSchema.safeParse(await c.req.json());
    if (!parsed.success) return invalidConfig(c, parsed.error);
    const { module, content, config } = parsed.data;

    if (module === 'dialogue') {
      const { surface, behavior } = parseDialogueText(content);
      if (surface.length === 0) {
        return c.json({ success: false, code: 'INVALID_CONFIG', error: '未从文本中解析出对话（格式：角色名："台词"（行为描写））' }, 400);
      }
      // 若提供了冰山配置且角色带预设意图，可做偏差度校验；否则用空真相层（偏差度维度降级）
      const cfgParsed = config ? icebergConfigSchema.safeParse(config) : null;
      const truthLayer = cfgParsed?.success
        ? cfgParsed.data.characters
            .filter((ch) => ch.true_intent)
            .map((ch) => ({ name: ch.name, true_intent: ch.true_intent!, true_emotion: ch.true_emotion || '', core_tension: '' }))
        : [];
      const report = scoreIceberg({ truthLayer, surfaceLayer: surface, behaviorLayer: behavior });
      return c.json({ success: true, data: { module, quality_score: report, parsed_lines: surface.length } });
    }

    if (module === 'conflict') {
      const cfgParsed = config ? conflictConfigSchema.safeParse(config) : null;
      if (!cfgParsed?.success) {
        return c.json({ success: false, code: 'INVALID_CONFIG', error: 'conflict 模块校验需提供合法的冲突配置（config 字段）' }, 400);
      }
      const cfg = cfgParsed.data;
      const phases = content.split(/\n{2,}/);
      const report = scoreConflict({
        config: cfg,
        desirePhase: phases[0] ?? content,
        resistancePhase: phases[1] ?? '',
        costPhase: phases[2] ?? '',
        resolvedDesireType: resolveDesireType(cfg),
      });
      return c.json({ success: true, data: { module, quality_score: report, emotion_curve: computeEmotionCurve(cfg) } });
    }

    // compose：交叉校验（需冲突配置）
    const cfgParsed = config ? conflictConfigSchema.safeParse(config) : null;
    if (!cfgParsed?.success) {
      return c.json({ success: false, code: 'INVALID_CONFIG', error: 'compose 模块校验需提供合法的冲突配置（config 字段）' }, 400);
    }
    const cfg = cfgParsed.data;
    const report = await crossValidateCompose(content, cfg, computeEmotionCurve(cfg), 70);
    return c.json({ success: true, data: { module, quality_score: report } });
  } catch (error) {
    return fail(c, error);
  }
});

// ============================================================
// 大纲联动草稿（场景 C，§10.3 手动触发）
// ============================================================
app.get('/v1/outline/conflict-draft', async (c) => {
  try {
    const projectId = Number(c.req.query('projectId'));
    const chapterPlanId = Number(c.req.query('chapterPlanId'));
    const sceneNodeId = c.req.query('sceneNodeId') ? Number(c.req.query('sceneNodeId')) : undefined;
    if (!projectId || !chapterPlanId) {
      return c.json({ success: false, code: 'INVALID_CONFIG', error: '缺少 projectId / chapterPlanId 参数' }, 400);
    }
    const draft = await buildConflictDraft(projectId, chapterPlanId, sceneNodeId);
    return c.json({ success: true, data: draft });
  } catch (error) {
    return fail(c, error);
  }
});

// 冰山台词预填草稿（v1.5.1）
app.get('/v1/outline/iceberg-draft', async (c) => {
  try {
    const projectId = Number(c.req.query('projectId'));
    const chapterPlanId = Number(c.req.query('chapterPlanId'));
    const sceneNodeId = c.req.query('sceneNodeId') ? Number(c.req.query('sceneNodeId')) : undefined;
    if (!projectId || !chapterPlanId) {
      return c.json({ success: false, code: 'INVALID_CONFIG', error: '缺少参数' }, 400);
    }
    const [plan] = await creativeDb.select().from(schema.chapterPlan)
      .where(and(eq(schema.chapterPlan.id, chapterPlanId), eq(schema.chapterPlan.projectId, projectId)))
      .limit(1);
    if (!plan) return c.json({ success: false, error: '章节不存在' }, 404);
    let node: any = null;
    if (sceneNodeId) {
      const [n] = await creativeDb.select().from(schema.sceneNode)
        .where(and(eq(schema.sceneNode.id, sceneNodeId), eq(schema.sceneNode.projectId, projectId)))
        .limit(1);
      if (n) node = n;
    }
    const povNames = await resolvePovNames(projectId, (plan.povCharacterIds ?? []) as number[]);
    const draft = buildIcebergDraft(plan, node, povNames);
    const { _missing, ...config } = draft;
    return c.json({ success: true, data: { source: { chapterPlanId, sceneNodeId }, config, missing: _missing } });
  } catch (error) {
    return fail(c, error);
  }
});

export const dualEngineRouter = app;
