/**
 * 伏笔台账路由
 * 以"伏笔线"为粒度的全局生命周期追踪：CRUD + 场景关联 + 超期未回收提醒 + 从场景note提升
 * 状态流转为纯手动（planted/resolved/abandoned），超期由服务端按章节跨度计算高亮，不自动改状态
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as creative from '../db/creative-schema.js';
import { chatCompletion } from '../llm/client.js';
import { recallMaterialsByQuery } from '../rag/plot-material-retriever.js';
import { reviserAgent } from '../agents/reviser.js';
import { getActivePlansByChapterNos } from '../state/store.js';

const app = new Hono();

/** 默认超期阈值：埋设后超过 N 章仍未回收即视为超期 */
const DEFAULT_OVERDUE_THRESHOLD = 10;

const threadCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  hintClue: z.string().optional(),
  status: z.enum(['pending', 'planted', 'resolved', 'abandoned']).default('planted'),
  priority: z.enum(['high', 'normal', 'low']).default('normal'),
  plantChapter: z.number().int().optional(),
  resolveChapter: z.number().int().optional(),
  sceneIds: z.array(z.number().int()).optional(),
  sourceSceneId: z.number().int().optional(),
  tier: z.enum(['t1', 't2', 't3']).optional(),
  dnaSubject: z.string().max(100).optional(),
  dnaAction: z.string().max(50).optional(),
  dnaObject: z.string().max(100).optional(),
  dnaEmotion: z.string().max(50).optional(),
  referencedMaterialId: z.number().int().nullable().optional(),
});

const threadUpdateSchema = threadCreateSchema.partial();

/**
 * 计算项目当前创作进度章节号：
 * 优先取已生成章节(isCurrent)的最大章节号，缺省退回章节计划最大章节号，再缺省为 0
 */
async function getCurrentChapter(projectId: number): Promise<number> {
  const [gen] = await creativeDb
    .select({ chapterNo: creative.generatedChapter.chapterNo })
    .from(creative.generatedChapter)
    .where(
      and(
        eq(creative.generatedChapter.projectId, projectId),
        eq(creative.generatedChapter.isCurrent, true)
      )
    )
    .orderBy(desc(creative.generatedChapter.chapterNo))
    .limit(1);
  if (gen) return gen.chapterNo ?? 0;

  const [plan] = await creativeDb
    .select({ chapterNo: creative.chapterPlan.chapterNo })
    .from(creative.chapterPlan)
    .where(eq(creative.chapterPlan.projectId, projectId))
    .orderBy(desc(creative.chapterPlan.chapterNo))
    .limit(1);
  return plan?.chapterNo ?? 0;
}

/**
 * 解析分支衍生伏笔的"分支来源章号"：
 * sourceBranchOptionId → chapter_branch_option.sourceChapterPlanId → chapter_plan.chapterNo
 * 任一环节缺失返回 null。推荐埋设章必须 ≤ 此章号（伏笔须在分支发生前埋下）。
 */
async function getBranchSourceChapterNo(thread: any): Promise<number | null> {
  if (!thread.sourceBranchOptionId) return null;
  const [opt] = await creativeDb
    .select({ sourceChapterPlanId: creative.chapterBranchOption.sourceChapterPlanId })
    .from(creative.chapterBranchOption)
    .where(eq(creative.chapterBranchOption.id, thread.sourceBranchOptionId))
    .limit(1);
  if (!opt?.sourceChapterPlanId) return null;
  const [plan] = await creativeDb
    .select({ chapterNo: creative.chapterPlan.chapterNo })
    .from(creative.chapterPlan)
    .where(eq(creative.chapterPlan.id, opt.sourceChapterPlanId))
    .limit(1);
  return plan?.chapterNo ?? null;
}

/** 为伏笔线计算超期标记与已敞开章节数 */
function enrichThread(
  thread: any,
  currentChapter: number,
  threshold: number
): any {
  const plant = thread.plantChapter ?? null;
  const resolve = thread.resolveChapter ?? null;
  const chaptersOpen = plant != null ? Math.max(0, currentChapter - plant) : null;

  let overdue = false;
  if (thread.status === 'planted') {
    // 已过计划回收章仍未回收
    if (resolve != null && currentChapter > resolve) overdue = true;
    // 或埋设后敞开超过阈值
    else if (plant != null && chaptersOpen != null && chaptersOpen >= threshold) overdue = true;
  }

  return { ...thread, chaptersOpen, overdue, currentChapter };
}

/** GET /api/projects/:id/foreshadow?status=&overdueOnly=&threshold= 列表 */
app.get('/projects/:id/foreshadow', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const status = c.req.query('status');
    const sourceType = c.req.query('sourceType');
    const overdueOnly = c.req.query('overdueOnly') === 'true';
    const threshold = Number(c.req.query('threshold')) || DEFAULT_OVERDUE_THRESHOLD;

    const conds = [eq(creative.foreshadowThread.projectId, projectId)];
    if (status) conds.push(eq(creative.foreshadowThread.status, status));
    if (sourceType) conds.push(eq(creative.foreshadowThread.sourceType, sourceType));

    const rows = await creativeDb
      .select()
      .from(creative.foreshadowThread)
      .where(and(...conds))
      .orderBy(creative.foreshadowThread.plantChapter, creative.foreshadowThread.id);

    const currentChapter = await getCurrentChapter(projectId);
    let data = rows.map((r) => enrichThread(r, currentChapter, threshold));
    if (overdueOnly) data = data.filter((d) => d.overdue);

    const summary = {
      total: data.length,
      pending: data.filter((d) => d.status === 'pending').length,
      planted: data.filter((d) => d.status === 'planted').length,
      resolved: data.filter((d) => d.status === 'resolved').length,
      abandoned: data.filter((d) => d.status === 'abandoned').length,
      overdue: data.filter((d) => d.overdue).length,
      branchDerived: data.filter((d) => d.sourceType === 'branch').length,
      unconfirmed: data.filter((d) => d.sourceType === 'branch' && !d.isConfirmed).length,
      pendingBackfill: data.filter(
        (d) => d.sourceType === 'branch' && d.isConfirmed && (d.status === 'pending' || d.status === 'planted') && !d.backfillMethod
      ).length,
      currentChapter,
      threshold,
    };

    return c.json({ success: true, data, summary });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:id/foreshadow/overdue?threshold= 超期未回收提醒 */
app.get('/projects/:id/foreshadow/overdue', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const threshold = Number(c.req.query('threshold')) || DEFAULT_OVERDUE_THRESHOLD;
    const rows = await creativeDb
      .select()
      .from(creative.foreshadowThread)
      .where(
        and(
          eq(creative.foreshadowThread.projectId, projectId),
          eq(creative.foreshadowThread.status, 'planted')
        )
      )
      .orderBy(creative.foreshadowThread.plantChapter);

    const currentChapter = await getCurrentChapter(projectId);
    const overdue = rows
      .map((r) => enrichThread(r, currentChapter, threshold))
      .filter((d) => d.overdue)
      // 敞得越久越靠前
      .sort((a, b) => (b.chaptersOpen ?? 0) - (a.chaptersOpen ?? 0));

    return c.json({ success: true, data: overdue, summary: { count: overdue.length, currentChapter, threshold } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** 草蛇灰线：单条规则检测产出的问题项 */
interface DetectionIssue {
  threadId: number;
  threadTitle: string;
  /** 规则标识 */
  rule: string;
  severity: 'critical' | 'warning' | 'info';
  /** 人类可读描述 */
  message: string;
}

/** 各 tier 的超期阈值（埋设后敞开超过 N 章未回收即视为超期） */
const TIER_OVERDUE_THRESHOLD: Record<string, number> = { t1: 15, t2: 10, t3: 7 };

/**
 * GET /api/projects/:id/foreshadow/detection
 * 草蛇灰线·伏笔健康检测（纯规则零LLM）。
 * 对项目全部伏笔运行以下规则，返回问题清单：
 *  1. tier_overdue        已埋设且按 tier 分级超期（t1=critical / t2=warning / t3=info）
 *  2. past_resolve_chapter 已埋设且当前章已超过计划回收章（critical）
 *  3. no_hint_clue        已埋设但缺少埋设线索关键词（info）
 *  4. high_priority_stale 高优先级但仍处待埋入状态（warning）
 *  5. plant_cluster       同一章集中埋设 >=4 个伏笔（info）
 */
app.get('/projects/:id/foreshadow/detection', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const rows = await creativeDb
      .select()
      .from(creative.foreshadowThread)
      .where(eq(creative.foreshadowThread.projectId, projectId))
      .orderBy(creative.foreshadowThread.plantChapter, creative.foreshadowThread.id);

    const currentChapter = await getCurrentChapter(projectId);
    const issues: DetectionIssue[] = [];

    for (const t of rows) {
      const title = t.title;

      // 规则1：tier_overdue —— 已埋设且按 tier 分级超期
      if (t.status === 'planted' && t.plantChapter != null) {
        const tier = t.tier ?? 't3';
        const threshold = TIER_OVERDUE_THRESHOLD[tier] ?? TIER_OVERDUE_THRESHOLD.t3;
        const chaptersOpen = Math.max(0, currentChapter - t.plantChapter);
        if (chaptersOpen >= threshold) {
          const severity: DetectionIssue['severity'] =
            tier === 't1' ? 'critical' : tier === 't2' ? 'warning' : 'info';
          issues.push({
            threadId: t.id,
            threadTitle: title,
            rule: 'tier_overdue',
            severity,
            message: `「${title}」已敞开 ${chaptersOpen} 章未回收（${tier} 阈值 ${threshold} 章）`,
          });
        }
      }

      // 规则2：past_resolve_chapter —— 已埋设且当前章已超过计划回收章
      if (t.status === 'planted' && t.resolveChapter != null && currentChapter > t.resolveChapter) {
        issues.push({
          threadId: t.id,
          threadTitle: title,
          rule: 'past_resolve_chapter',
          severity: 'critical',
          message: `「${title}」计划第 ${t.resolveChapter} 章回收，当前已到第 ${currentChapter} 章`,
        });
      }

      // 规则3：no_hint_clue —— 已埋设但缺少埋设线索关键词
      if (t.status === 'planted' && (!t.hintClue || t.hintClue === '')) {
        issues.push({
          threadId: t.id,
          threadTitle: title,
          rule: 'no_hint_clue',
          severity: 'info',
          message: `「${title}」缺少埋设线索关键词，读者可能无法感知伏笔存在`,
        });
      }

      // 规则4：high_priority_stale —— 高优先级但仍处待埋入状态
      if (t.priority === 'high' && t.status === 'pending') {
        issues.push({
          threadId: t.id,
          threadTitle: title,
          rule: 'high_priority_stale',
          severity: 'warning',
          message: `「${title}」为高优先级伏笔但尚未埋入`,
        });
      }
    }

    // 规则5：plant_cluster —— 同一章集中埋设过多伏笔（>=4个）
    const clusterCount = new Map<number, number>();
    for (const t of rows) {
      if (t.plantChapter != null) {
        clusterCount.set(t.plantChapter, (clusterCount.get(t.plantChapter) ?? 0) + 1);
      }
    }
    for (const [plantChapter, count] of [...clusterCount.entries()].sort((a, b) => a[0] - b[0])) {
      if (count >= 4) {
        issues.push({
          threadId: 0,
          threadTitle: `第${plantChapter}章`,
          rule: 'plant_cluster',
          severity: 'info',
          message: `第 ${plantChapter} 章集中埋设了 ${count} 个伏笔，节奏可能过密`,
        });
      }
    }

    return c.json({
      success: true,
      data: { issues, scannedCount: rows.length, currentChapter },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:id/foreshadow 创建伏笔线 */
app.post('/projects/:id/foreshadow', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const parsed = threadCreateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const d = parsed.data;

    const [row] = await creativeDb
      .insert(creative.foreshadowThread)
      .values({
        projectId,
        title: d.title,
        description: d.description ?? null,
        hintClue: d.hintClue ?? null,
        status: d.status,
        priority: d.priority,
        plantChapter: d.plantChapter ?? null,
        resolveChapter: d.resolveChapter ?? null,
        sceneIds: d.sceneIds ?? [],
        sourceSceneId: d.sourceSceneId ?? null,
        tier: d.tier ?? 't3',
        dnaSubject: d.dnaSubject ?? null,
        dnaAction: d.dnaAction ?? null,
        dnaObject: d.dnaObject ?? null,
        dnaEmotion: d.dnaEmotion ?? null,
        referencedMaterialId: d.referencedMaterialId ?? null,
      })
      .returning();

    return c.json({ success: true, data: row }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /api/projects/:id/foreshadow/promote
 * 从某场景节点的 foreshadowing_note 一键提升为伏笔线
 * body: { sceneNodeId: number, title?: string, plantChapter?: number, priority?: 'high'|'normal'|'low' }
 */
app.post('/projects/:id/foreshadow/promote', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const body = await c.req.json();
    const sceneNodeId = Number(body.sceneNodeId);
    if (isNaN(sceneNodeId)) {
      return c.json({ success: false, error: '缺少有效的 sceneNodeId' }, 400);
    }

    const [node] = await creativeDb
      .select()
      .from(creative.sceneNode)
      .where(eq(creative.sceneNode.id, sceneNodeId))
      .limit(1);
    if (!node) return c.json({ success: false, error: '场景节点不存在' }, 404);

    const note = (node.foreshadowingNote || '').trim();
    if (!note) {
      return c.json({ success: false, error: '该场景节点没有伏笔备注，无法提升' }, 400);
    }

    const [row] = await creativeDb
      .insert(creative.foreshadowThread)
      .values({
        projectId,
        title: body.title || note.slice(0, 30),
        description: note,
        status: 'planted',
        priority: ['high', 'normal', 'low'].includes(body.priority) ? body.priority : 'normal',
        plantChapter: Number.isInteger(body.plantChapter) ? body.plantChapter : null,
        resolveChapter: null,
        sceneIds: [sceneNodeId],
        sourceSceneId: sceneNodeId,
        sourceType: 'scene',
      })
      .returning();

    return c.json({ success: true, data: row }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/foreshadow/:fid 更新（含状态流转/场景关联/回收章） */
app.put('/foreshadow/:fid', async (c) => {
  try {
    const id = Number(c.req.param('fid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的伏笔ID' }, 400);

    const parsed = threadUpdateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const d = parsed.data;
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (d.title !== undefined) updateData.title = d.title;
    if (d.description !== undefined) updateData.description = d.description;
    if (d.hintClue !== undefined) updateData.hintClue = d.hintClue;
    if (d.status !== undefined) updateData.status = d.status;
    if (d.priority !== undefined) updateData.priority = d.priority;
    if (d.plantChapter !== undefined) updateData.plantChapter = d.plantChapter;
    if (d.resolveChapter !== undefined) updateData.resolveChapter = d.resolveChapter;
    if (d.sceneIds !== undefined) updateData.sceneIds = d.sceneIds;
    if (d.sourceSceneId !== undefined) updateData.sourceSceneId = d.sourceSceneId;
    if (d.tier !== undefined) updateData.tier = d.tier;
    if (d.dnaSubject !== undefined) updateData.dnaSubject = d.dnaSubject;
    if (d.dnaAction !== undefined) updateData.dnaAction = d.dnaAction;
    if (d.dnaObject !== undefined) updateData.dnaObject = d.dnaObject;
    if (d.dnaEmotion !== undefined) updateData.dnaEmotion = d.dnaEmotion;
    if (d.referencedMaterialId !== undefined) updateData.referencedMaterialId = d.referencedMaterialId;

    const [row] = await creativeDb
      .update(creative.foreshadowThread)
      .set(updateData)
      .where(eq(creative.foreshadowThread.id, id))
      .returning();

    if (!row) return c.json({ success: false, error: '伏笔线不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /api/foreshadow/:fid/extract-dna
 * 自动提取伏笔载体DNA四元组（主体-动作-客体-情绪）
 * 双关卡验证模型第一关：结构化标签提取
 */
app.post('/foreshadow/:fid/extract-dna', async (c) => {
  try {
    const id = Number(c.req.param('fid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的伏笔ID' }, 400);

    const [thread] = await creativeDb
      .select()
      .from(creative.foreshadowThread)
      .where(eq(creative.foreshadowThread.id, id))
      .limit(1);
    if (!thread) return c.json({ success: false, error: '伏笔线不存在' }, 404);

    const context = `伏笔名称：${thread.title}\n伏笔描述：${thread.description || '无'}\n线索：${thread.hintClue || '无'}`;

    const response = await chatCompletion([
      {
        role: 'system',
        content: `你是叙事结构分析师。请从给定的伏笔信息中提取「载体DNA」四元组。
载体DNA格式：[主体]-[动作]-[客体]，外加核心情绪标签。

输出严格JSON（不要输出其他文字）：
{
  "dnaSubject": "主体（角色名或实体名，如'张小凡'、'青云门'）",
  "dnaAction": "动作（如'发现'、'获得'、'失去'、'背叛'、'觉醒'）",
  "dnaObject": "客体（物品/秘密/人物，如'嗜血珠'、'身世真相'）",
  "dnaEmotion": "核心情绪（如'悬念'、'震惊'、'悲伤'、'恐惧'、'期待'）"
}

要求：
- 每个字段不超过20字
- 动作必须是动词或动宾短语
- 情绪必须是单一情绪词，不要复合描述`,
      },
      { role: 'user', content: context },
    ], { temperature: 0.2, maxTokens: 256 });

    // 解析JSON
    let dna: { dnaSubject?: string; dnaAction?: string; dnaObject?: string; dnaEmotion?: string } = {};
    try {
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) dna = JSON.parse(jsonMatch[0]);
    } catch { /* 解析失败则返回空 */ }

    if (!dna.dnaSubject && !dna.dnaAction && !dna.dnaObject) {
      return c.json({ success: false, error: 'DNA提取失败，LLM未返回有效结构' }, 500);
    }

    // 存回数据库
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (dna.dnaSubject) updateData.dnaSubject = dna.dnaSubject.slice(0, 100);
    if (dna.dnaAction) updateData.dnaAction = dna.dnaAction.slice(0, 50);
    if (dna.dnaObject) updateData.dnaObject = dna.dnaObject.slice(0, 100);
    if (dna.dnaEmotion) updateData.dnaEmotion = dna.dnaEmotion.slice(0, 50);

    const [row] = await creativeDb
      .update(creative.foreshadowThread)
      .set(updateData)
      .where(eq(creative.foreshadowThread.id, id))
      .returning();

    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * GET /api/foreshadow/:fid/suggest-techniques?topN=
 * 为某条伏笔推荐可绑定的「伏笔手法」素材（A2）
 * 用伏笔标题+描述+DNA组装查询，定向语义召回 plot_material_foreshadow，供前端绑定选择器展示推荐。
 * 召回失败降级返回空数组（不阻断）。
 */
app.get('/foreshadow/:fid/suggest-techniques', async (c) => {
  try {
    const id = Number(c.req.param('fid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的伏笔ID' }, 400);
    const topN = Math.min(Number(c.req.query('topN')) || 5, 20);

    const [thread] = await creativeDb
      .select()
      .from(creative.foreshadowThread)
      .where(eq(creative.foreshadowThread.id, id))
      .limit(1);
    if (!thread) return c.json({ success: false, error: '伏笔线不存在' }, 404);

    const queryParts: (string | null | undefined)[] = [thread.title, thread.description];
    if (thread.dnaSubject || thread.dnaAction || thread.dnaObject) {
      queryParts.push(`${thread.dnaSubject || ''}${thread.dnaAction || ''}${thread.dnaObject || ''}`);
    }
    if (thread.dnaEmotion) queryParts.push(thread.dnaEmotion);
    const queryText = queryParts.filter(Boolean).join(' ');

    const techniques = await recallMaterialsByQuery(
      queryText,
      'plot_material_foreshadow',
      thread.projectId,
      topN
    );

    return c.json({ success: true, data: techniques });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * GET /api/foreshadow/:fid/suggest-plant-chapters
 * 为分支衍生伏笔推荐埋设章节（纯规则零LLM）。
 * 规则（PRD §4.2.3）：t1 提前 3/2/1 章（3 个推荐位），t2 提前 2/1 章（2 个），t3 提前 1 章（1 个）。
 * 推荐章号必须 ≤ 分支来源章号，且 ≥ 1。匹配已有章节计划标记 planned/generated，升序返回。
 */
app.get('/foreshadow/:fid/suggest-plant-chapters', async (c) => {
  try {
    const id = Number(c.req.param('fid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的伏笔ID' }, 400);

    const [thread] = await creativeDb
      .select()
      .from(creative.foreshadowThread)
      .where(eq(creative.foreshadowThread.id, id))
      .limit(1);
    if (!thread) return c.json({ success: false, error: '伏笔线不存在' }, 404);
    if (thread.sourceType !== 'branch') {
      return c.json({ success: false, error: '仅分支衍生伏笔支持智能推荐埋设章' }, 400);
    }
    const resolveChapter = thread.resolveChapter;
    if (!resolveChapter) {
      return c.json({ success: false, error: '该伏笔缺少计划回收章，无法推荐埋设位置' }, 400);
    }

    const sourceChapterNo = await getBranchSourceChapterNo(thread);
    const upperBound = sourceChapterNo ?? resolveChapter - 1;

    const offsets = thread.tier === 't1' ? [3, 2, 1] : thread.tier === 't2' ? [2, 1] : [1];
    const uniqueNos = Array.from(
      new Set(offsets.map((off) => resolveChapter - off).filter((n) => n >= 1 && n <= upperBound))
    ).sort((a, b) => a - b);

    if (!uniqueNos.length) {
      return c.json({ success: true, data: { suggestions: [], upperBound, resolveChapter, tier: thread.tier } });
    }

    // 计划级活跃路径解析（Bug 修复）：选定分支后同一章号会并存"主线计划(已被替代)"与
    // "分支衍生计划(活跃)"两个计划。若按章号直接 new Map 会因键覆盖取到主线旧计划，
    // 导致展示旧章节标题、误判回填方式、并把回填写到已废弃的死计划上。
    // 这里统一取活跃路径上的计划：已选定分支计划优先，其次主线计划，排除已废弃分支计划。
    const planByNo = await getActivePlansByChapterNos(thread.projectId, uniqueNos);

    const planIds = [...planByNo.values()].map((p) => p.id);
    const generatedMap = new Map<number, number>();
    if (planIds.length) {
      const gens = await creativeDb
        .select({
          id: creative.generatedChapter.id,
          chapterPlanId: creative.generatedChapter.chapterPlanId,
        })
        .from(creative.generatedChapter)
        .where(
          and(
            inArray(creative.generatedChapter.chapterPlanId, planIds),
            eq(creative.generatedChapter.isCurrent, true)
          )
        );
      for (const g of gens) if (g.chapterPlanId) generatedMap.set(g.chapterPlanId, g.id);
    }

    const suggestions = uniqueNos.map((no) => {
      const plan = planByNo.get(no);
      const generatedChapterId = plan ? generatedMap.get(plan.id) ?? null : null;
      const hasContent = generatedChapterId != null;
      return {
        chapterNo: no,
        chapterPlanId: plan?.id ?? null,
        generatedChapterId,
        title: plan?.title ?? null,
        status: plan?.status ?? 'no_plan',
        hasContent,
        suggestedMethod: hasContent ? 'revise' : plan ? 'anchor' : 'unavailable',
      };
    });

    return c.json({
      success: true,
      data: { suggestions, upperBound, resolveChapter, tier: thread.tier },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /api/foreshadow/:fid/confirm
 * 确认分支衍生伏笔（is_confirmed=false → true）。仅对分支衍生且未确认的伏笔有效。
 */
app.post('/foreshadow/:fid/confirm', async (c) => {
  try {
    const id = Number(c.req.param('fid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的伏笔ID' }, 400);

    const [thread] = await creativeDb
      .select()
      .from(creative.foreshadowThread)
      .where(eq(creative.foreshadowThread.id, id))
      .limit(1);
    if (!thread) return c.json({ success: false, error: '伏笔线不存在' }, 404);
    if (thread.sourceType !== 'branch') {
      return c.json({ success: false, error: '仅分支衍生伏笔需要确认' }, 400);
    }
    if (thread.isConfirmed) {
      return c.json({ success: false, error: '该伏笔已确认' }, 400);
    }

    const [row] = await creativeDb
      .update(creative.foreshadowThread)
      .set({ isConfirmed: true, updatedAt: new Date() })
      .where(eq(creative.foreshadowThread.id, id))
      .returning();

    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /api/foreshadow/:fid/backfill-anchor
 * 锚点回填：将伏笔作为关键剧情锚点追加到目标"待生成"章节计划的 must_have_events，
 * 后续 Writer 生成时强制融入。body: { chapterPlanId }
 * 校验：分支衍生 + 已确认 + 目标为 planned（无正文）+ 目标章号 < 回收章 且 ≤ 分支来源章。事务化。
 */
app.post('/foreshadow/:fid/backfill-anchor', async (c) => {
  try {
    const id = Number(c.req.param('fid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的伏笔ID' }, 400);
    const body = await c.req.json();
    const chapterPlanId = Number(body.chapterPlanId);
    if (isNaN(chapterPlanId)) return c.json({ success: false, error: '缺少有效的 chapterPlanId' }, 400);

    const [thread] = await creativeDb
      .select()
      .from(creative.foreshadowThread)
      .where(eq(creative.foreshadowThread.id, id))
      .limit(1);
    if (!thread) return c.json({ success: false, error: '伏笔线不存在' }, 404);
    if (thread.sourceType !== 'branch') return c.json({ success: false, error: '仅分支衍生伏笔支持回填' }, 400);
    if (!thread.isConfirmed) return c.json({ success: false, error: '请先确认该伏笔再回填' }, 400);

    const [plan] = await creativeDb
      .select()
      .from(creative.chapterPlan)
      .where(eq(creative.chapterPlan.id, chapterPlanId))
      .limit(1);
    if (!plan) return c.json({ success: false, error: '目标章节计划不存在' }, 404);
    if (plan.projectId !== thread.projectId) return c.json({ success: false, error: '目标章节不属于同一项目' }, 400);

    // 目标章必须尚无正文（planned），否则应走 revise
    const [existingGen] = await creativeDb
      .select({ id: creative.generatedChapter.id })
      .from(creative.generatedChapter)
      .where(
        and(
          eq(creative.generatedChapter.chapterPlanId, chapterPlanId),
          eq(creative.generatedChapter.isCurrent, true)
        )
      )
      .limit(1);
    if (existingGen) return c.json({ success: false, error: '目标章节已有正文，请改用"修订回填"' }, 400);

    const sourceChapterNo = await getBranchSourceChapterNo(thread);
    const upperBound = sourceChapterNo ?? (thread.resolveChapter ? thread.resolveChapter - 1 : Infinity);
    if (plan.chapterNo > upperBound) {
      return c.json({ success: false, error: `目标章号(${plan.chapterNo})须 ≤ 分支来源章(${upperBound})` }, 400);
    }
    if (thread.resolveChapter && plan.chapterNo >= thread.resolveChapter) {
      return c.json({ success: false, error: `目标章号(${plan.chapterNo})须早于回收章(${thread.resolveChapter})` }, 400);
    }

    const anchorText = `[伏笔埋设]${thread.title}:${thread.hintClue || thread.description || ''}`;
    const events: string[] = Array.isArray(plan.mustHaveEvents) ? [...(plan.mustHaveEvents as string[])] : [];
    if (!events.includes(anchorText)) events.push(anchorText);

    const result = await creativeDb.transaction(async (tx) => {
      const [updatedPlan] = await tx
        .update(creative.chapterPlan)
        .set({ mustHaveEvents: events, updatedAt: new Date() })
        .where(eq(creative.chapterPlan.id, chapterPlanId))
        .returning();
      const [updatedThread] = await tx
        .update(creative.foreshadowThread)
        .set({
          plantChapter: plan.chapterNo,
          backfillMethod: 'anchor',
          backfillTargetChapterId: chapterPlanId,
          status: 'planted',
          updatedAt: new Date(),
        })
        .where(eq(creative.foreshadowThread.id, id))
        .returning();
      return { updatedPlan, updatedThread };
    });

    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /api/foreshadow/:fid/backfill-revise
 * 修订回填：对"已生成"目标章节调用 ReviserAgent 将伏笔自然融入正文，仅返回预览不自动落库。
 * body: { chapterId, intensity: 'light'|'medium'|'strong' }（chapterId 为 generated_chapter.id）
 */
app.post('/foreshadow/:fid/backfill-revise', async (c) => {
  try {
    const id = Number(c.req.param('fid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的伏笔ID' }, 400);
    const body = await c.req.json();
    const chapterId = Number(body.chapterId);
    const intensity = ['light', 'medium', 'strong'].includes(body.intensity) ? body.intensity : 'medium';
    if (isNaN(chapterId)) return c.json({ success: false, error: '缺少有效的 chapterId' }, 400);

    const [thread] = await creativeDb
      .select()
      .from(creative.foreshadowThread)
      .where(eq(creative.foreshadowThread.id, id))
      .limit(1);
    if (!thread) return c.json({ success: false, error: '伏笔线不存在' }, 404);
    if (thread.sourceType !== 'branch') return c.json({ success: false, error: '仅分支衍生伏笔支持回填' }, 400);
    if (!thread.isConfirmed) return c.json({ success: false, error: '请先确认该伏笔再回填' }, 400);

    const [chapter] = await creativeDb
      .select()
      .from(creative.generatedChapter)
      .where(
        and(
          eq(creative.generatedChapter.id, chapterId),
          eq(creative.generatedChapter.isCurrent, true)
        )
      )
      .limit(1);
    if (!chapter) return c.json({ success: false, error: '目标章节不存在或非当前版本' }, 404);
    if (!chapter.content) return c.json({ success: false, error: '目标章节无正文内容' }, 400);

    // 章号约束：须 ≤ 分支来源章 且 < 回收章
    const [plan] = chapter.chapterPlanId
      ? await creativeDb
          .select({ chapterNo: creative.chapterPlan.chapterNo })
          .from(creative.chapterPlan)
          .where(eq(creative.chapterPlan.id, chapter.chapterPlanId))
          .limit(1)
      : [null];
    const sourceChapterNo = await getBranchSourceChapterNo(thread);
    const upperBound = sourceChapterNo ?? (thread.resolveChapter ? thread.resolveChapter - 1 : Infinity);
    if (plan && plan.chapterNo > upperBound) {
      return c.json({ success: false, error: `目标章号(${plan.chapterNo})须 ≤ 分支来源章(${upperBound})` }, 400);
    }
    if (plan && thread.resolveChapter && plan.chapterNo >= thread.resolveChapter) {
      return c.json({ success: false, error: `目标章号(${plan.chapterNo})须早于回收章(${thread.resolveChapter})` }, 400);
    }

    const intensityText =
      intensity === 'light'
        ? '以极轻的笔触埋入，仅用一两处细节或对话暗示，几乎不打断原有节奏'
        : intensity === 'strong'
          ? '较明显地铺设，安排一段具体情节或关键对话，让读者能清晰感知到这条线索'
          : '自然地融入，通过一到两处情节或对话埋设，兼顾存在感与节奏';

    const instruction = `【伏笔回填任务】请在本章正文中埋设以下伏笔线索，为后续剧情（第${thread.resolveChapter ?? '?'}章「${thread.title}」）做铺垫。

伏笔标题：${thread.title}
伏笔描述：${thread.description || '（无）'}
埋设线索关键词：${thread.hintClue || '（无）'}
载体DNA：${[thread.dnaSubject, thread.dnaAction, thread.dnaObject, thread.dnaEmotion].filter(Boolean).join(' / ') || '（无）'}

埋设强度：${intensityText}

要求：
- 伏笔须自然嵌入现有情节，不得生硬插入或破坏原文连贯性与文风
- 只埋设、不回收（不要在本章揭示伏笔真相或给出解释）
- 尽量复用原文已有的人物、场景、道具作为载体
- 未涉及的部分保持原样不动`;

    const result = await reviserAgent.reviseWithInstruction(chapter.content, instruction);

    return c.json({
      success: true,
      data: {
        revisedContent: result.revisedContent,
        revisionNotes: result.revisionNotes,
        originalContent: chapter.content,
        chapterId,
        chapterPlanId: chapter.chapterPlanId ?? null,
        intensity,
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /api/foreshadow/:fid/mark-planted
 * 修订回填确认后，将伏笔标记为已埋设并记录回填方式/目标章。
 * body: { backfillMethod?: 'revise', backfillTargetChapterId?: number, plantChapter?: number }
 */
app.post('/foreshadow/:fid/mark-planted', async (c) => {
  try {
    const id = Number(c.req.param('fid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的伏笔ID' }, 400);
    const body = await c.req.json().catch(() => ({}));

    const [thread] = await creativeDb
      .select()
      .from(creative.foreshadowThread)
      .where(eq(creative.foreshadowThread.id, id))
      .limit(1);
    if (!thread) return c.json({ success: false, error: '伏笔线不存在' }, 404);

    const updateData: Record<string, any> = { status: 'planted', updatedAt: new Date() };
    if (body.backfillMethod) updateData.backfillMethod = body.backfillMethod;
    if (Number.isInteger(body.backfillTargetChapterId)) updateData.backfillTargetChapterId = body.backfillTargetChapterId;
    if (Number.isInteger(body.plantChapter)) updateData.plantChapter = body.plantChapter;

    const [row] = await creativeDb
      .update(creative.foreshadowThread)
      .set(updateData)
      .where(eq(creative.foreshadowThread.id, id))
      .returning();

    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /api/foreshadow/:fid 删除伏笔线 */
app.delete('/foreshadow/:fid', async (c) => {
  try {
    const id = Number(c.req.param('fid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的伏笔ID' }, 400);

    const [row] = await creativeDb
      .delete(creative.foreshadowThread)
      .where(eq(creative.foreshadowThread.id, id))
      .returning();

    if (!row) return c.json({ success: false, error: '伏笔线不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
