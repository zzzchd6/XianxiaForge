/**
 * 章节管理路由
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, lt, desc, inArray, sql } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import * as retriever from '../rag/retriever.js';
import { reviserAgent } from '../agents/reviser.js';
import { branchGeneratorAgent } from '../agents/branch.js';
import { styleAuditorAgent } from '../agents/style-auditor.js';
import { auditorAgent } from '../agents/auditor.js';
import { buildContextForChapter } from '../rag/context-builder.js';
import { buildStyleContext } from '../rag/style.js';
import { scanAIFlavor, classifyOpening } from '../rag/ai-flavor-detector.js';
import { recallBranchMaterials, gatherBranchWorldview, gatherWorkshopEntities } from '../services/branch-context.js';
import { writeBackKeyEvent } from '../services/outline-writeback.js';
import { scanAndAdvanceUnlock } from '../services/treasure-unlock.js';
import { getBranchConfig } from './settings.js';
import { DIRECTION_CATALOG, getCategory } from '../services/direction-catalog.js';
import { applyBranchImpacts, rollbackBranchImpacts, resolveImpactTargetCharacters } from '../services/impact/impact.service.js';
import { listMilestones, getLastReachedMilestone } from '../services/milestone-service.js';
import { createArcFromOption } from '../services/branch-arc-service.js';
import { branchForeshadowExtractorAgent } from '../agents/branch-foreshadow-extractor.js';
import { causalExtractorAgent } from '../agents/causal-extractor.js';
import { inferCausalFromBranch } from '../services/impact/causal-auto-plant.js';
import { createCausalChain } from '../services/impact/causal-chain.service.js';

const app = new Hono();

// 创建章节计划验证
const createChapterSchema = z.object({
  chapterNo: z.number().int().min(1),
  title: z.string().min(1).max(255),
  intent: z.string().min(1),
  targetWordCount: z.number().int().min(500).max(20000).default(3000),
  emotionTarget: z.string().max(100).optional(),
  conflictTarget: z.number().int().min(1).max(10).optional(),
  sceneBreakdown: z.any().optional(),
  mustHaveEvents: z.array(z.string().min(1).max(200)).max(20).optional(),
  povCharacterIds: z.array(z.number().int()).optional(),
  povCharacterNames: z.array(z.string()).optional(),
  requiredEntityIds: z.object({
    characters: z.array(z.number()).optional(),
    factions: z.array(z.number()).optional(),
    locations: z.array(z.string()).optional(),
    skills: z.array(z.number()).optional(),
    items: z.array(z.number()).optional(),
  }).optional(),
  outlineId: z.number().int().optional(),
  volumeNo: z.number().int().min(1).default(1),
  plotFingerprint: z.string().max(30).optional(),
  hookType: z.string().max(20).optional(),
  hookIntensity: z.string().max(10).optional(),
  conflictScore: z.number().int().optional(),
  conflictRating: z.string().max(10).optional(),
  isPeak: z.boolean().optional(),
  singularityEvent: z.boolean().optional(),
  chapterType: z.string().max(30).optional(),
  // 手动固定的剧情素材引用（二期RAG人工干预）：[{table, id}]
  pinnedMaterialIds: z.array(z.object({
    table: z.string(),
    id: z.coerce.number().int(),
  })).max(20).optional(),
});

// 更新章节计划验证
const updateChapterSchema = createChapterSchema.partial().extend({
  status: z.enum(['planned', 'writing', 'generated', 'reviewed', 'finalized']).optional(),
});

// 手动编辑内容验证
const editContentSchema = z.object({
  content: z.string().min(1),
});

/**
 * 解析POV视角人物：合并显式ID + 按姓名解析的ID（同名取最小ID，去重）
 * 姓名解析失败时不阻断，仅返回显式ID部分。
 * 同时支持自定义人物（custom_character）：按姓名匹配返回负数ID。
 */
async function resolvePovCharacterIds(
  projectId: number,
  explicitIds: number[] | undefined,
  names: string[] | undefined
): Promise<number[]> {
  const ids = new Set<number>(explicitIds || []);
  const cleanNames = (names || []).map((n) => n.trim()).filter(Boolean);
  if (cleanNames.length) {
    // 诛仙库人物（正数ID）
    try {
      const dir = await retriever.getEntityNameDirectory();
      for (const name of cleanNames) {
        const matched = dir.characters
          .filter((c) => c.name === name)
          .map((c) => c.id)
          .sort((a, b) => a - b)[0];
        if (matched != null) ids.add(matched);
      }
    } catch {
      // 名目录加载失败不阻断，仅保留显式ID
    }
    // 本项目自定义人物（负数ID）
    try {
      const customRows = await creativeDb
        .select({ id: schema.customCharacter.id, name: schema.customCharacter.name })
        .from(schema.customCharacter)
        .where(and(
          eq(schema.customCharacter.projectId, projectId),
          eq(schema.customCharacter.isDeleted, false)
        ));
      for (const name of cleanNames) {
        const matched = customRows.find((r) => r.name === name);
        if (matched) ids.add(-Number(matched.id));
      }
    } catch {
      // 自定义人物加载失败不阻断
    }
  }
  return Array.from(ids);
}

/** GET /api/projects/:id/chapters - 章节计划列表 */
app.get('/projects/:id/chapters', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }

    const chapters = await creativeDb
      .select()
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.projectId, projectId))
      .orderBy(schema.chapterPlan.volumeNo, schema.chapterPlan.chapterNo);

    return c.json({ success: true, data: chapters });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:id/chapters - 创建章节计划 */
app.post('/projects/:id/chapters', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }

    // 验证项目存在
    const [project] = await creativeDb
      .select()
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, projectId))
      .limit(1);

    if (!project) {
      return c.json({ success: false, error: '项目不存在' }, 404);
    }

    const body = await c.req.json();
    const parsed = createChapterSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const povCharacterIds = await resolvePovCharacterIds(
      projectId,
      parsed.data.povCharacterIds,
      parsed.data.povCharacterNames
    );

    // 奇点事件配额校验（天命P1#5）
    const isSingularity = parsed.data.chapterType === 'singularity' || parsed.data.singularityEvent === true;
    if (isSingularity) {
      const genConfig = (project.generationConfig as any) || {};
      const quota = genConfig.singularity_quota_per_volume ?? 3;
      const volumeNo = parsed.data.volumeNo ?? 1;
      const existingSingularity = await creativeDb
        .select({ id: schema.chapterPlan.id })
        .from(schema.chapterPlan)
        .where(and(
          eq(schema.chapterPlan.projectId, projectId),
          eq(schema.chapterPlan.volumeNo, volumeNo),
          eq(schema.chapterPlan.singularityEvent, true),
        ));
      if (existingSingularity.length >= quota) {
        return c.json({
          success: false,
          error: `本卷奇点事件配额已满（${existingSingularity.length}/${quota}）。每卷最多${quota}个奇点事件，防止战力体系崩坏。`,
        }, 400);
      }
    }

    const [chapter] = await creativeDb
      .insert(schema.chapterPlan)
      .values({
        projectId,
        chapterNo: parsed.data.chapterNo,
        title: parsed.data.title,
        intent: parsed.data.intent,
        targetWordCount: parsed.data.targetWordCount,
        emotionTarget: parsed.data.emotionTarget || null,
        conflictTarget: parsed.data.conflictTarget || null,
        sceneBreakdown: parsed.data.sceneBreakdown || null,
        mustHaveEvents: parsed.data.mustHaveEvents || [],
        povCharacterIds,
        requiredEntityIds: parsed.data.requiredEntityIds || null,
        outlineId: parsed.data.outlineId || null,
        volumeNo: parsed.data.volumeNo || 1,
        plotFingerprint: parsed.data.plotFingerprint || null,
        hookType: parsed.data.hookType || null,
        hookIntensity: parsed.data.hookIntensity || null,
        conflictScore: parsed.data.conflictScore ?? null,
        conflictRating: parsed.data.conflictRating || null,
        isPeak: parsed.data.isPeak ?? false,
        singularityEvent: parsed.data.singularityEvent ?? false,
        chapterType: parsed.data.chapterType || 'progression',
        pinnedMaterialIds: parsed.data.pinnedMaterialIds || [],
      })
      .returning();

    return c.json({ success: true, data: chapter }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:pid/chapters/by-entity - 查询引用了某实体的章节列表 */
app.get('/projects/:pid/chapters/by-entity', async (c) => {
  try {
    const projectId = Number(c.req.param('pid'));
    if (isNaN(projectId)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }

    const entityId = Number(c.req.query('entityId'));
    if (isNaN(entityId)) {
      return c.json({ success: false, error: 'entityId 参数必填且为数字' }, 400);
    }

    const entityType = c.req.query('entityType') || 'character';
    const validTypes = ['character', 'faction', 'skill', 'item'];
    if (!validTypes.includes(entityType)) {
      return c.json({ success: false, error: `不支持的 entityType: ${entityType}` }, 400);
    }

    let rows: any[];
    if (entityType === 'character') {
      rows = await creativeDb.execute(sql`
        SELECT id, chapter_no, title, status, volume_no
        FROM chapter_plan
        WHERE project_id = ${projectId}
          AND (${entityId}::bigint = ANY(pov_character_ids)
               OR required_entity_ids->'characters' @> to_jsonb(${entityId}::bigint))
        ORDER BY chapter_no
      `);
    } else {
      const key = entityType; // 'faction' | 'skill' | 'item'
      rows = await creativeDb.execute(sql`
        SELECT id, chapter_no, title, status, volume_no
        FROM chapter_plan
        WHERE project_id = ${projectId}
          AND required_entity_ids->${sql.raw(`'${key}'`)} @> to_jsonb(${entityId}::bigint)
        ORDER BY chapter_no
      `);
    }

    const data = (rows as any[]).map((r: any) => ({
      id: Number(r.id),
      chapterNo: r.chapter_no,
      title: r.title,
      status: r.status,
      volumeNo: r.volume_no,
    }));

    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/chapters/:id - 更新章节计划 */
const updateChapterHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的章节ID' }, 400);
    }

    const body = await c.req.json();
    const parsed = updateChapterSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (parsed.data.chapterNo !== undefined) updateData.chapterNo = parsed.data.chapterNo;
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.intent !== undefined) updateData.intent = parsed.data.intent;
    if (parsed.data.targetWordCount !== undefined) updateData.targetWordCount = parsed.data.targetWordCount;
    if (parsed.data.emotionTarget !== undefined) updateData.emotionTarget = parsed.data.emotionTarget;
    if (parsed.data.conflictTarget !== undefined) updateData.conflictTarget = parsed.data.conflictTarget;
    if (parsed.data.sceneBreakdown !== undefined) updateData.sceneBreakdown = parsed.data.sceneBreakdown;
    if (parsed.data.mustHaveEvents !== undefined) updateData.mustHaveEvents = parsed.data.mustHaveEvents;
    if (parsed.data.povCharacterIds !== undefined || parsed.data.povCharacterNames !== undefined) {
      // 解析所属项目ID：优先取路径参数 pid（/projects/:pid/chapters/:id），否则按章节ID反查
      let ownerProjectId = Number(c.req.param('pid'));
      if (isNaN(ownerProjectId)) {
        const [ownerRow] = await creativeDb
          .select({ projectId: schema.chapterPlan.projectId })
          .from(schema.chapterPlan)
          .where(eq(schema.chapterPlan.id, id))
          .limit(1);
        ownerProjectId = ownerRow ? Number(ownerRow.projectId) : NaN;
      }
      updateData.povCharacterIds = await resolvePovCharacterIds(
        ownerProjectId,
        parsed.data.povCharacterIds,
        parsed.data.povCharacterNames
      );
    }
    if (parsed.data.requiredEntityIds !== undefined) updateData.requiredEntityIds = parsed.data.requiredEntityIds;
    if (parsed.data.outlineId !== undefined) updateData.outlineId = parsed.data.outlineId;
    if (parsed.data.volumeNo !== undefined) updateData.volumeNo = parsed.data.volumeNo;
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
    if (parsed.data.plotFingerprint !== undefined) updateData.plotFingerprint = parsed.data.plotFingerprint;
    if (parsed.data.hookType !== undefined) updateData.hookType = parsed.data.hookType;
    if (parsed.data.hookIntensity !== undefined) updateData.hookIntensity = parsed.data.hookIntensity;
    if (parsed.data.conflictScore !== undefined) updateData.conflictScore = parsed.data.conflictScore;
    if (parsed.data.conflictRating !== undefined) updateData.conflictRating = parsed.data.conflictRating;
    if (parsed.data.isPeak !== undefined) updateData.isPeak = parsed.data.isPeak;
    if (parsed.data.singularityEvent !== undefined) updateData.singularityEvent = parsed.data.singularityEvent;
    if (parsed.data.chapterType !== undefined) updateData.chapterType = parsed.data.chapterType;
    if (parsed.data.pinnedMaterialIds !== undefined) updateData.pinnedMaterialIds = parsed.data.pinnedMaterialIds;

    const [updated] = await creativeDb
      .update(schema.chapterPlan)
      .set(updateData)
      .where(eq(schema.chapterPlan.id, id))
      .returning();

    if (!updated) {
      return c.json({ success: false, error: '章节不存在' }, 404);
    }

    return c.json({ success: true, data: updated });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
};
app.put('/chapters/:id', updateChapterHandler);
app.put('/projects/:pid/chapters/:id', updateChapterHandler);

/** GET /api/chapters/:id/content - 获取已生成内容 */
const getContentHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的章节ID' }, 400);
    }

    // 获取当前版本的内容
    const [chapter] = await creativeDb
      .select()
      .from(schema.generatedChapter)
      .where(
        and(
          eq(schema.generatedChapter.chapterPlanId, id),
          eq(schema.generatedChapter.isCurrent, true)
        )
      )
      .limit(1);

    if (!chapter) {
      return c.json({ success: false, error: '该章节尚无生成内容' }, 404);
    }

    return c.json({ success: true, data: chapter });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
};
app.get('/chapters/:id/content', getContentHandler);
app.get('/projects/:pid/chapters/:id/content', getContentHandler);

/** PUT /api/chapters/:id/content - 手动编辑内容 */
const editContentHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的章节ID' }, 400);
    }

    const body = await c.req.json();
    const parsed = editContentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    // 查询章节计划以获取projectId等元信息
    const [plan] = await creativeDb
      .select()
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.id, id))
      .limit(1);

    // 将当前版本标记为非当前
    await creativeDb
      .update(schema.generatedChapter)
      .set({ isCurrent: false })
      .where(eq(schema.generatedChapter.chapterPlanId, id));

    // 计算新版本号
    const existingVersions = await creativeDb
      .select({ version: schema.generatedChapter.version })
      .from(schema.generatedChapter)
      .where(eq(schema.generatedChapter.chapterPlanId, id));

    const nextVersion = existingVersions.length > 0
      ? Math.max(...existingVersions.map((v) => v.version)) + 1
      : 1;

    // 插入新版本（手动编辑）
    const [newChapter] = await creativeDb
      .insert(schema.generatedChapter)
      .values({
        projectId: plan?.projectId,
        chapterPlanId: id,
        taskId: null,
        volumeNo: plan?.volumeNo ?? 1,
        chapterNo: plan?.chapterNo ?? 1,
        title: plan?.title || '',
        version: nextVersion,
        content: parsed.data.content,
        wordCount: parsed.data.content.length,
        isCurrent: true,
      })
      .returning();

    // 更新章节计划状态
    await creativeDb
      .update(schema.chapterPlan)
      .set({ status: 'finalized', updatedAt: new Date() })
      .where(eq(schema.chapterPlan.id, id));

    // 异步触发秘宝解锁扫描（不阻塞响应）
    if (plan?.projectId && parsed.data.content.length > 50) {
      scanAndAdvanceUnlock(plan.projectId, parsed.data.content, plan.chapterNo ?? 1)
        .catch(() => {}); // best-effort
    }

    return c.json({ success: true, data: newChapter });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
};
app.put('/chapters/:id/content', editContentHandler);
app.put('/projects/:pid/chapters/:id/content', editContentHandler);

/** GET /api/chapters/:id/versions - 版本历史 */
const getVersionsHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的章节ID' }, 400);
    }

    const versions = await creativeDb
      .select()
      .from(schema.generatedChapter)
      .where(eq(schema.generatedChapter.chapterPlanId, id))
      .orderBy(desc(schema.generatedChapter.version));

    return c.json({ success: true, data: versions });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
};
app.get('/chapters/:id/versions', getVersionsHandler);
app.get('/projects/:pid/chapters/:id/versions', getVersionsHandler);

/** DELETE /api/chapters/:id - 删除章节计划 */
const deleteChapterHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的章节ID' }, 400);
    }

    await creativeDb
      .delete(schema.chapterPlan)
      .where(eq(schema.chapterPlan.id, id));

    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
};
app.delete('/chapters/:id', deleteChapterHandler);
app.delete('/projects/:pid/chapters/:id', deleteChapterHandler);

/** POST /api/chapters/:id/revise - 对话式AI修订（返回修订结果，不自动保存） */
const reviseChapterHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的章节ID' }, 400);
    }

    const body = await c.req.json();
    const reviseSchema = z.object({
      instruction: z.string().min(1).max(2000),
      selectedText: z.string().max(5000).optional(),
    });
    const parsed = reviseSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    // 获取当前版本内容
    const [chapter] = await creativeDb
      .select({
        content: schema.generatedChapter.content,
        projectId: schema.generatedChapter.projectId,
      })
      .from(schema.generatedChapter)
      .where(and(
        eq(schema.generatedChapter.chapterPlanId, id),
        eq(schema.generatedChapter.isCurrent, true)
      ))
      .limit(1);

    if (!chapter?.content) {
      return c.json({ success: false, error: '该章节没有可修订的内容' }, 404);
    }

    // 调用对话式修订
    const result = await reviserAgent.reviseWithInstruction(
      chapter.content,
      parsed.data.instruction,
      parsed.data.selectedText
    );

    return c.json({
      success: true,
      data: {
        revisedContent: result.revisedContent,
        revisionNotes: result.revisionNotes,
        originalContent: chapter.content,
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: `修订失败: ${error.message}` }, 500);
  }
};
app.post('/chapters/:id/revise', reviseChapterHandler);
app.post('/projects/:pid/chapters/:id/revise', reviseChapterHandler);

// ============ 交互式剧情抉择（需求12：章间分支） ============

/** GET /api/chapters/:id/branch-options - 获取某章已产出的分支选项 */
const getBranchOptionsHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的章节ID' }, 400);
    }

    // 方向筛选（可选）：direction=精确主方向编码；category=大类编码（展开为该类全部细分方向）
    const directionFilter = c.req.query('direction');
    const categoryFilter = c.req.query('category');
    const conditions = [eq(schema.chapterBranchOption.sourceChapterPlanId, id)];
    if (directionFilter) {
      conditions.push(eq(schema.chapterBranchOption.mainDirection, directionFilter));
    } else if (categoryFilter && getCategory(categoryFilter)) {
      const codes = DIRECTION_CATALOG.filter((d) => d.category === categoryFilter).map((d) => d.code);
      conditions.push(inArray(schema.chapterBranchOption.mainDirection, codes));
    }

    const options = await creativeDb
      .select()
      .from(schema.chapterBranchOption)
      .where(and(...conditions))
      .orderBy(schema.chapterBranchOption.id);

    // 统计每个选项已衍生的伏笔线索数量（分支衍生伏笔系统），供前端选项卡片展示
    const countByOption = new Map<number, number>();
    try {
      const optionIds = options.map((o) => o.id);
      if (optionIds.length) {
        const fsRows = await creativeDb
          .select({ sourceBranchOptionId: schema.foreshadowThread.sourceBranchOptionId })
          .from(schema.foreshadowThread)
          .where(inArray(schema.foreshadowThread.sourceBranchOptionId, optionIds));
        for (const r of fsRows) {
          if (r.sourceBranchOptionId != null) {
            countByOption.set(r.sourceBranchOptionId, (countByOption.get(r.sourceBranchOptionId) ?? 0) + 1);
          }
        }
      }
    } catch (e: any) {
      console.warn(`[分支伏笔] 统计衍生伏笔数量失败（降级为0）: ${e?.message || e}`);
    }
    const optionsWithCount = options.map((o) => ({
      ...o,
      derivedForeshadowCount: countByOption.get(o.id) ?? 0,
    }));

    // 附带随分支生成的后续发展推演（存于章节计划）
    const [plan] = await creativeDb
      .select({ branchPrediction: schema.chapterPlan.branchPrediction })
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.id, id))
      .limit(1);

    return c.json({ success: true, data: { options: optionsWithCount, prediction: plan?.branchPrediction || null } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
};
app.get('/chapters/:id/branch-options', getBranchOptionsHandler);
app.get('/projects/:pid/chapters/:id/branch-options', getBranchOptionsHandler);

/** POST /api/chapters/:id/generate-branches - 基于当前正文手动产出/刷新分支选项 */
const generateBranchesHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的章节ID' }, 400);
    }

    const [plan] = await creativeDb
      .select()
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.id, id))
      .limit(1);
    if (!plan) {
      return c.json({ success: false, error: '章节计划不存在' }, 404);
    }

    // 取当前版本的生成内容
    const [chapter] = await creativeDb
      .select({ content: schema.generatedChapter.content })
      .from(schema.generatedChapter)
      .where(and(
        eq(schema.generatedChapter.chapterPlanId, id),
        eq(schema.generatedChapter.isCurrent, true),
      ))
      .limit(1);
    if (!chapter?.content) {
      return c.json({ success: false, error: '该章节尚无生成内容，无法产出分支' }, 400);
    }

    const { branchOptionCount } = getBranchConfig();

    // 召回四类剧情素材（best-effort，失败降级为空，不阻断分支生成）
    const recallQuery = plan.intent || plan.title || `第${plan.chapterNo}章`;
    const materials = await recallBranchMaterials(plan.projectId, recallQuery);

    // 汇聚世界观设定（人物/宗门规制/岁时节令/文风心智），用于后续发展推演
    const [project] = await creativeDb
      .select({
        sourceBookId: schema.creativeProject.sourceBookId,
        generationConfig: schema.creativeProject.generationConfig,
      })
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, plan.projectId))
      .limit(1);
    const worldview = await gatherBranchWorldview(
      project?.sourceBookId ?? 1,
      Array.isArray(plan.povCharacterIds) ? (plan.povCharacterIds as number[]).map(Number) : [],
    );

    // 成长工坊实体（自定义功法/法宝），供分支剧情实名引用（best-effort，空则跳过注入）
    const workshopEntities = await gatherWorkshopEntities(plan.projectId);

    // 动态叙事引擎：注入未达成的叙事里程碑，引导分支围绕故事骨架展开（best-effort）
    let narrativeMilestones: { id: number; label: string; description?: string | null; importance?: string | null }[] = [];
    try {
      const ms = await listMilestones(plan.projectId);
      narrativeMilestones = ms
        .filter((m) => m.status === 'upcoming' || m.status === 'active')
        .slice(0, 8)
        .map((m) => ({ id: m.id, label: m.label, description: m.description, importance: m.importance }));
    } catch (e: any) {
      console.warn(`[叙事引擎] 里程碑加载失败（降级，不注入）: ${e?.message || e}`);
    }

    // 方向体系：解析定向生成约束（可选）与项目启用大类
    const body = await c.req.json().catch(() => ({}));
    const targetDirections = body?.targetDirections && typeof body.targetDirections === 'object'
      ? {
          main: typeof body.targetDirections.main === 'string' ? body.targetDirections.main : undefined,
          secondary: Array.isArray(body.targetDirections.secondary)
            ? body.targetDirections.secondary.filter((s: any) => typeof s === 'string').slice(0, 2)
            : undefined,
        }
      : undefined;
    const enabledCategories = Array.isArray(body?.enabledCategories)
      ? body.enabledCategories.filter((s: any) => typeof s === 'string')
      : ((project as any)?.generationConfig?.directionConfig?.enabledCategories) ?? undefined;

    const { options: branches, prediction } = await branchGeneratorAgent.generateBranches(
      chapter.content,
      { chapterNumber: plan.chapterNo, title: plan.title, intent: plan.intent || undefined },
      branchOptionCount,
      materials,
      worldview,
      { targetDirections, enabledCategories },
      workshopEntities,
      undefined,
      undefined,
      narrativeMilestones,
    );
    if (!branches.length) {
      return c.json({ success: false, error: '分支生成失败，请重试' }, 500);
    }

    // 覆盖本章旧的未选定选项（保留已选定的选择链）
    await creativeDb
      .delete(schema.chapterBranchOption)
      .where(and(
        eq(schema.chapterBranchOption.sourceChapterPlanId, id),
        eq(schema.chapterBranchOption.isSelected, false),
      ));

    const inserted = await creativeDb
      .insert(schema.chapterBranchOption)
      .values(branches.map((b) => ({
        projectId: plan.projectId,
        sourceChapterPlanId: id,
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
        // 动态叙事引擎：分支弧提议字段
        branchPremise: b.branchPremise ?? null,
        estimatedLength: b.estimatedLength ?? 2,
        coreConflict: b.coreConflict ?? null,
        convergeToMilestoneId: b.convergeToMilestoneId ?? null,
        isSelected: false,
      })))
      .returning();

    // 落库后续发展推演（世界观推演结论）
    if (prediction) {
      await creativeDb
        .update(schema.chapterPlan)
        .set({ branchPrediction: prediction })
        .where(eq(schema.chapterPlan.id, id));
    }

    return c.json({ success: true, data: { options: inserted, prediction: prediction || null } }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: `分支生成失败: ${error.message}` }, 500);
  }
};
app.post('/chapters/:id/generate-branches', generateBranchesHandler);
app.post('/projects/:pid/chapters/:id/generate-branches', generateBranchesHandler);

/** POST /api/chapters/:id/select-branch/:optionId - 选定走向并衍生下一章计划（覆盖式重选） */
const selectBranchHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    const optionId = Number(c.req.param('optionId'));
    if (isNaN(id) || isNaN(optionId)) {
      return c.json({ success: false, error: '无效的参数' }, 400);
    }

    // 来源章节计划
    const [plan] = await creativeDb
      .select()
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.id, id))
      .limit(1);
    if (!plan) {
      return c.json({ success: false, error: '章节计划不存在' }, 404);
    }

    // 校验选项归属于本章
    const [option] = await creativeDb
      .select()
      .from(schema.chapterBranchOption)
      .where(and(
        eq(schema.chapterBranchOption.id, optionId),
        eq(schema.chapterBranchOption.sourceChapterPlanId, id),
      ))
      .limit(1);
    if (!option) {
      return c.json({ success: false, error: '分支选项不存在或不属于该章节' }, 404);
    }

    // 覆盖式重选保护：若已衍生的下一章已脱离 planned（已生成/定稿），拒绝静默覆盖
    const existingChildren = await creativeDb
      .select()
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.branchParentChapterId, id));
    const generatedChild = existingChildren.find((ch) => ch.status !== 'planned');
    if (generatedChild) {
      return c.json({
        success: false,
        error: `下一章（第${generatedChild.chapterNo}章「${generatedChild.title}」）已处于"${generatedChild.status}"状态，如需改选请先删除或处理该章节`,
      }, 409);
    }

    // 上一次选定的分支选项（用于重选时回滚其影响快照/历史）
    const [prevSelected] = await creativeDb
      .select({ id: schema.chapterBranchOption.id })
      .from(schema.chapterBranchOption)
      .where(and(
        eq(schema.chapterBranchOption.sourceChapterPlanId, id),
        eq(schema.chapterBranchOption.isSelected, true),
      ))
      .limit(1);

    // 据选项衍生下一章计划（继承卷号/POV/实体下发，章节号+1）
    const hint: any = option.nextSceneHint || {};
    const sceneBreakdown = [{
      sceneTitle: hint.sceneTitle || option.optionTitle,
      location: hint.location || null,
      coreEvent: hint.coreEvent || option.nextChapterIntent,
      effect: hint.effect || null,
    }];

    // 事务包裹：删旧衍生章 + 标记选中 + 插入新衍生章，任一失败整体回滚，
    // 避免"选项已标记选中但衍生章未创建"的半提交脏状态
    const newPlan = await creativeDb.transaction(async (tx) => {
      // 删除旧的待生成衍生章节计划（覆盖式）
      if (existingChildren.length) {
        await tx
          .delete(schema.chapterPlan)
          .where(eq(schema.chapterPlan.branchParentChapterId, id));
      }

      // 标记选定状态：本章来源选项中仅所选一项为 true
      await tx
        .update(schema.chapterBranchOption)
        .set({ isSelected: false })
        .where(eq(schema.chapterBranchOption.sourceChapterPlanId, id));
      await tx
        .update(schema.chapterBranchOption)
        .set({ isSelected: true })
        .where(eq(schema.chapterBranchOption.id, optionId));

      const [inserted] = await tx
        .insert(schema.chapterPlan)
        .values({
          projectId: plan.projectId,
          outlineId: plan.outlineId ?? null,
          volumeNo: plan.volumeNo,
          chapterNo: plan.chapterNo + 1,
          title: option.optionTitle,
          intent: option.nextChapterIntent,
          targetWordCount: plan.targetWordCount ?? 3000,
          sceneBreakdown,
          povCharacterIds: Array.isArray(plan.povCharacterIds) ? (plan.povCharacterIds as number[]) : [],
          requiredEntityIds: plan.requiredEntityIds ?? {},
          branchSourceOptionId: optionId,
          branchParentChapterId: id,
          status: 'planned',
        })
        .returning();

      // 反写卷大纲：把选定的分支走向写回下一章的 keyEvents 条目（覆盖+备份原文），
      // 保证【卷级大纲】跟随真实剧情；匹配不到条目时优雅跳过
      await writeBackKeyEvent(
        tx,
        inserted.outlineId ?? plan.outlineId,
        inserted.chapterNo,
        option.optionTitle,
        option.nextChapterIntent,
      );

      // 影响体系：先回滚上一次选择留下的 pending 快照/历史（覆盖式重选，避免重复/孤儿快照），
      //   再应用本选项绑定的影响变更（写入 pending 快照 + impact_history）。
      // 无手工链接时按主方向自动映射兜底（POV 人物为目标）。
      // best-effort：纯逻辑异常 catch 降级不阻断分支选择；SQL 级错误会中止事务整体回滚（PRD 3.5 原子性）。
      try {
        await rollbackBranchImpacts(tx, plan.projectId, prevSelected?.id ?? optionId, inserted.chapterNo);
        // 目标人物兜底：POV 为空时回落项目"默认影响对象"（主角），与影响预览保持一致
        const impactTargetIds = await resolveImpactTargetCharacters(
          plan.projectId,
          Array.isArray(plan.povCharacterIds) ? (plan.povCharacterIds as number[]).map(Number) : []
        );
        await applyBranchImpacts(tx, plan.projectId, optionId, inserted.volumeNo, inserted.chapterNo, {
          mainDirection: option.mainDirection,
          characterIds: impactTargetIds,
        });
      } catch (e: any) {
        console.warn(`[影响体系] 分支影响回滚/应用失败（降级，不阻断分支选择）: ${e?.message || e}`);
      }

      // 动态叙事引擎：为选定分支创建/复用分支弧（幂等；best-effort 不阻断分支选择）
      try {
        const sourceMs = await getLastReachedMilestone(plan.projectId);
        await createArcFromOption(tx, option, plan, inserted.id, sourceMs?.id ?? null);
      } catch (e: any) {
        console.warn(`[叙事引擎] 分支弧创建失败（降级，不阻断分支选择）: ${e?.message || e}`);
      }

      return inserted;
    });

    // 分支衍生伏笔抽取 + 因果链自动埋因（后台异步 fire-and-forget）：
    // 这两步均为 best-effort 增强（各含 1-2 次 LLM 调用，串行约 1 分钟），
    // 与分支选定主流程无强依赖，故在事务提交后立即返回响应，后台 detached 执行，
    // 任何失败仅降级（console.warn），绝不阻断/拖慢分支选择。前端通过 invalidateQueries
    // 自动刷新伏笔/因果列表，无需等待本响应携带条数。
    void (async () => {
      // —— 分支衍生伏笔抽取：从走向中抽取 2-3 条可前置埋设的伏笔线索，落库为待确认伏笔 ——
      try {
        const extracted = await branchForeshadowExtractorAgent.extract(
          {
            optionTitle: option.optionTitle,
            optionDescription: option.optionDescription,
            nextChapterIntent: option.nextChapterIntent,
            impactTags: Array.isArray(option.impactTags) ? (option.impactTags as string[]) : [],
            mainDirection: option.mainDirection,
          },
          plan.chapterNo
        );
        let planted = 0;
        for (const f of extracted) {
          const [row] = await creativeDb
            .insert(schema.foreshadowThread)
            .values({
              projectId: plan.projectId,
              title: f.title,
              description: f.description ?? null,
              hintClue: f.hintClue ?? null,
              status: 'pending',
              priority: f.priority,
              tier: f.tier,
              plantChapter: null,
              resolveChapter: newPlan.chapterNo,
              sceneIds: [],
              dnaSubject: f.dnaSubject ?? null,
              dnaAction: f.dnaAction ?? null,
              dnaObject: f.dnaObject ?? null,
              dnaEmotion: f.dnaEmotion ?? null,
              sourceType: 'branch',
              sourceBranchOptionId: optionId,
              isConfirmed: false,
            })
            .returning();
          if (row) planted++;
        }
        if (planted) {
          console.log(`[分支伏笔] 第${plan.chapterNo}章分支「${option.optionTitle}」衍生${planted}条待确认伏笔`);
        }
      } catch (e: any) {
        console.warn(`[分支伏笔] 衍生伏笔抽取失败（降级，不阻断分支选择）: ${e?.message || e}`);
      }

      // —— 因果链自动埋因：规则保底 1 条 + LLM 可选增强 0-1 条 ——
      try {
        let planted = 0;
        const ruleInputs = inferCausalFromBranch(
          { id: optionId, optionTitle: option.optionTitle, optionDescription: option.optionDescription, mainDirection: option.mainDirection, impactTags: Array.isArray(option.impactTags) ? (option.impactTags as string[]) : [] },
          plan.projectId,
          plan.chapterNo,
        );
        for (const input of ruleInputs) {
          const row = await createCausalChain(creativeDb, input);
          if (row) planted++;
        }

        // LLM 增强（受 generation_config.causalConfig.llmEnhance 控制，默认 true）
        const [projRow] = await creativeDb
          .select({ generationConfig: schema.creativeProject.generationConfig })
          .from(schema.creativeProject)
          .where(eq(schema.creativeProject.id, plan.projectId))
          .limit(1);
        const causalCfg = (projRow?.generationConfig as any)?.causalConfig;
        const llmEnhance = causalCfg?.llmEnhance !== false;
        if (llmEnhance) {
          try {
            const llmOutputs = await causalExtractorAgent.extract(
              option.optionTitle,
              option.optionDescription ?? '',
              Array.isArray(option.impactTags) ? (option.impactTags as string[]) : [],
              plan.chapterNo,
            );
            for (const out of llmOutputs) {
              const row = await createCausalChain(creativeDb, {
                projectId: plan.projectId,
                sourceType: 'branch',
                sourceId: optionId,
                sourceChapterNo: plan.chapterNo,
                causeType: out.causeType,
                causeDescription: out.causeDescription,
                effectType: out.effectType,
                effectDescription: out.effectDescription,
                targetChapterMin: plan.chapterNo + 2,
                targetChapterMax: plan.chapterNo + out.targetOffset,
                priority: out.priority,
                strength: out.strength,
                directionCode: option.mainDirection ?? null,
                tags: Array.isArray(option.impactTags) ? (option.impactTags as string[]).slice(0, 5) : [],
              });
              if (row) planted++;
            }
          } catch (llmErr: any) {
            console.warn(`[因果链] LLM增强抽取失败（降级为仅规则结果）: ${llmErr?.message || llmErr}`);
          }
        }

        if (planted) {
          console.log(`[因果链] 第${plan.chapterNo}章分支「${option.optionTitle}」埋入${planted}条因果线`);
        }
      } catch (e: any) {
        console.warn(`[因果链] 自动埋因失败（降级，不阻断分支选择）: ${e?.message || e}`);
      }
    })();

    return c.json({ success: true, data: { option, nextChapterPlan: newPlan, derivedForeshadows: [], derivedCausalChains: [] } }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: `选定分支失败: ${error.message}` }, 500);
  }
};
app.post('/chapters/:id/select-branch/:optionId', selectBranchHandler);
app.post('/projects/:pid/chapters/:id/select-branch/:optionId', selectBranchHandler);

// ============ 章节文风校验（需求13） ============

/** 取章节计划 + 当前正文 + 项目文风配置，校验前置条件 */
async function loadStyleAuditInput(id: number) {
  const [plan] = await creativeDb
    .select()
    .from(schema.chapterPlan)
    .where(eq(schema.chapterPlan.id, id))
    .limit(1);
  if (!plan) return { error: '章节计划不存在', status: 404 } as const;

  const [chapter] = await creativeDb
    .select({ content: schema.generatedChapter.content })
    .from(schema.generatedChapter)
    .where(and(
      eq(schema.generatedChapter.chapterPlanId, id),
      eq(schema.generatedChapter.isCurrent, true),
    ))
    .limit(1);
  if (!chapter?.content) return { error: '该章节尚无生成内容，无法校验文风', status: 400 } as const;

  // 文风配置按项目来源书隔离，缺省回退诛仙书=1（与生成管线一致）
  const [project] = await creativeDb
    .select({ sourceBookId: schema.creativeProject.sourceBookId })
    .from(schema.creativeProject)
    .where(eq(schema.creativeProject.id, plan.projectId))
    .limit(1);
  const bookId = project?.sourceBookId ?? 1;

  const style = await buildStyleContext(bookId, {
    targetEmotion: (plan as any).emotionTarget ?? null,
    conflictType: (plan as any).conflictTarget != null ? String((plan as any).conflictTarget) : null,
  });
  if (!style) return { error: '该项目尚未配置文风引擎，无法校验', status: 400 } as const;

  return { plan, content: chapter.content, style };
}

/** POST /api/chapters/:id/audit-style - 触发章节文风校验并入库 */
const auditStyleHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的章节ID' }, 400);

    const input = await loadStyleAuditInput(id);
    if ('error' in input) return c.json({ success: false, error: input.error }, input.status as any);

    const { plan, content, style } = input;

    // ---- 加载跨章上下文（PRD v1.1：开头模板化 + 明喻重复检测） ----
    const crossChapterCtx: {
      previousOpenings: Array<{ chapterNo: number; type: string }>;
      previousSimileImageries: string[];
    } = { previousOpenings: [], previousSimileImageries: [] };

    if (typeof plan.volumeNo === 'number' && typeof plan.chapterNo === 'number') {
      const siblingPlans = await creativeDb
        .select({ id: schema.chapterPlan.id, chapterNo: schema.chapterPlan.chapterNo })
        .from(schema.chapterPlan)
        .where(and(
          eq(schema.chapterPlan.projectId, plan.projectId),
          eq(schema.chapterPlan.volumeNo, plan.volumeNo),
          lt(schema.chapterPlan.chapterNo, plan.chapterNo),
        ))
        .orderBy(desc(schema.chapterPlan.chapterNo))
        .limit(5);

      for (const sp of siblingPlans) {
        const [prevCh] = await creativeDb
          .select({ content: schema.generatedChapter.content })
          .from(schema.generatedChapter)
          .where(and(
            eq(schema.generatedChapter.chapterPlanId, sp.id),
            eq(schema.generatedChapter.isCurrent, true),
          ))
          .limit(1);
        if (prevCh?.content) {
          crossChapterCtx.previousOpenings.push({
            chapterNo: sp.chapterNo,
            type: classifyOpening(prevCh.content),
          });
          const prevScan = scanAIFlavor(prevCh.content);
          for (const s of prevScan.simileImageries) {
            crossChapterCtx.previousSimileImageries.push(s.imagery);
          }
        }
      }
    }

    const report = await styleAuditorAgent.auditStyle(content, style, {
      chapterNumber: plan.chapterNo,
      title: plan.title,
    }, undefined, undefined, crossChapterCtx);

    const [record] = await creativeDb
      .insert(schema.styleAuditRecord)
      .values({
        projectId: plan.projectId,
        chapterPlanId: id,
        generationTaskId: null,
        configSnapshot: style as any,
        overallScore: report.overallScore,
        dimensionScores: report.dimensionScores,
        issues: report.issues,
        issueCount: report.issues.length,
        status: 'completed',
      })
      .returning();

    return c.json({ success: true, data: record }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: `文风校验失败: ${error.message}` }, 500);
  }
};
app.post('/chapters/:id/audit-style', auditStyleHandler);
app.post('/projects/:pid/chapters/:id/audit-style', auditStyleHandler);

// ============ 29维质量审计（手动触发） ============

/** POST /api/chapters/:id/audit-quality - 手动触发29维质量审计 */
const auditQualityHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的章节ID' }, 400);

    // 1. 加载当前版本的生成内容
    const [chapter] = await creativeDb
      .select({ content: schema.generatedChapter.content })
      .from(schema.generatedChapter)
      .where(and(
        eq(schema.generatedChapter.chapterPlanId, id),
        eq(schema.generatedChapter.isCurrent, true),
      ))
      .limit(1);

    if (!chapter?.content) {
      return c.json({ success: false, error: '该章节尚无生成内容，无法审计' }, 404);
    }

    // 2. 加载章节计划
    const [plan] = await creativeDb
      .select()
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.id, id))
      .limit(1);

    if (!plan) {
      return c.json({ success: false, error: '章节计划不存在' }, 404);
    }

    // 3. 加载项目
    const [project] = await creativeDb
      .select()
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, plan.projectId))
      .limit(1);

    if (!project) {
      return c.json({ success: false, error: '项目不存在' }, 404);
    }

    // 4. 构建上下文（跳过RAG以节省时间/token）
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

    // 5. 调用30维审计（v1.4：含认知越界条件维度）
    const auditReport = await auditorAgent.auditChapter(chapter.content, context);

    // 6. 返回审计报告
    return c.json({ success: true, data: auditReport });
  } catch (error: any) {
    return c.json({ success: false, error: `质量审计失败: ${error.message}` }, 500);
  }
};
app.post('/chapters/:id/audit-quality', auditQualityHandler);
app.post('/projects/:pid/chapters/:id/audit-quality', auditQualityHandler);

/** GET /api/chapters/:id/style-audits - 历史校验记录列表 */
const listStyleAuditsHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的章节ID' }, 400);

    const records = await creativeDb
      .select()
      .from(schema.styleAuditRecord)
      .where(eq(schema.styleAuditRecord.chapterPlanId, id))
      .orderBy(desc(schema.styleAuditRecord.createdAt));

    return c.json({ success: true, data: records });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
};
app.get('/chapters/:id/style-audits', listStyleAuditsHandler);
app.get('/projects/:pid/chapters/:id/style-audits', listStyleAuditsHandler);

/** GET /api/chapters/:id/style-audits/:aid - 单条校验记录详情 */
const getStyleAuditHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    const aid = Number(c.req.param('aid'));
    if (isNaN(id) || isNaN(aid)) return c.json({ success: false, error: '无效的参数' }, 400);

    const [record] = await creativeDb
      .select()
      .from(schema.styleAuditRecord)
      .where(and(
        eq(schema.styleAuditRecord.id, aid),
        eq(schema.styleAuditRecord.chapterPlanId, id),
      ))
      .limit(1);
    if (!record) return c.json({ success: false, error: '校验记录不存在' }, 404);

    return c.json({ success: true, data: record });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
};
app.get('/chapters/:id/style-audits/:aid', getStyleAuditHandler);
app.get('/projects/:pid/chapters/:id/style-audits/:aid', getStyleAuditHandler);

/** POST /api/chapters/:id/style-audits/:aid/revise - 基于校验结果一键修订（返回预览，不自动保存） */
const reviseStyleAuditHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    const aid = Number(c.req.param('aid'));
    if (isNaN(id) || isNaN(aid)) return c.json({ success: false, error: '无效的参数' }, 400);

    const [record] = await creativeDb
      .select()
      .from(schema.styleAuditRecord)
      .where(and(
        eq(schema.styleAuditRecord.id, aid),
        eq(schema.styleAuditRecord.chapterPlanId, id),
      ))
      .limit(1);
    if (!record) return c.json({ success: false, error: '校验记录不存在' }, 404);

    const [chapter] = await creativeDb
      .select({ content: schema.generatedChapter.content })
      .from(schema.generatedChapter)
      .where(and(
        eq(schema.generatedChapter.chapterPlanId, id),
        eq(schema.generatedChapter.isCurrent, true),
      ))
      .limit(1);
    if (!chapter?.content) return c.json({ success: false, error: '该章节没有可修订的内容' }, 404);

    // 可选：前端传入被忽略问题的展示索引，一键修订时跳过
    const body = await c.req.json().catch(() => ({}));
    const ignoredIndices = new Set<number>(
      Array.isArray(body?.ignoredIndices)
        ? body.ignoredIndices.filter((n: any) => Number.isInteger(n))
        : [],
    );

    // 仅取 critical/major 问题合成修订指令（排除被忽略的）
    const issues = Array.isArray(record.issues) ? (record.issues as any[]) : [];
    const actionable = issues
      .filter((_, idx) => !ignoredIndices.has(idx))
      .filter((i) => i.severity === 'critical' || i.severity === 'major');
    if (!actionable.length) {
      return c.json({ success: false, error: '无需修订，所有文风问题均为minor级别' }, 400);
    }

    const lines = actionable.map((i, idx) => {
      const parts = [`${idx + 1}. [${i.dimension}] ${i.description}`];
      if (i.aiFlavorType) parts.push(`   AI味分型：${i.aiFlavorType}`);
      if (i.excerpt) parts.push(`   原文片段：${i.excerpt}`);
      if (i.suggestion) parts.push(`   修改建议：${i.suggestion}`);
      return parts.join('\n');
    });
    const instruction =
      `请严格按照以下文风校验问题修订本章，仅修正列出的文风问题，保持剧情、人物、情节逻辑与原文完全一致，不要改动未涉及的内容：\n\n${lines.join('\n\n')}`;

    const result = await reviserAgent.reviseWithInstruction(chapter.content, instruction);

    return c.json({
      success: true,
      data: {
        revisedContent: result.revisedContent,
        revisionNotes: result.revisionNotes,
        originalContent: chapter.content,
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: `文风修订失败: ${error.message}` }, 500);
  }
};
app.post('/chapters/:id/style-audits/:aid/revise', reviseStyleAuditHandler);
app.post('/projects/:pid/chapters/:id/style-audits/:aid/revise', reviseStyleAuditHandler);

/** POST /api/chapters/:id/fix-issue - 修复单条审计问题（质量/文风），返回预览不自动保存 */
const fixIssueSchema = z.object({
  auditType: z.enum(['quality', 'style']),
  issue: z.object({
    dimension: z.string().optional(),
    severity: z.string().optional(),
    description: z.string().optional(),
    suggestion: z.string().optional(),
    excerpt: z.string().optional(),
    aiFlavorType: z.string().optional(),
  }),
});
const fixIssueHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的参数' }, 400);
    const parsed = fixIssueSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    const { auditType, issue } = parsed.data;

    const [chapter] = await creativeDb
      .select({ content: schema.generatedChapter.content })
      .from(schema.generatedChapter)
      .where(and(
        eq(schema.generatedChapter.chapterPlanId, id),
        eq(schema.generatedChapter.isCurrent, true),
      ))
      .limit(1);
    if (!chapter?.content) return c.json({ success: false, error: '该章节没有可修订的内容' }, 404);

    const parts = [`[${issue.dimension ?? '未命名维度'}] ${issue.description ?? ''}`];
    if (issue.aiFlavorType) parts.push(`AI味分型：${issue.aiFlavorType}`);
    if (issue.excerpt) parts.push(`原文片段：${issue.excerpt}`);
    if (issue.suggestion) parts.push(`修改建议：${issue.suggestion}`);
    const scope = auditType === 'style' ? '文风问题' : '质量问题';
    const instruction =
      `请严格按照以下单条${scope}修订本章，只修正这一个问题，保持剧情、人物、情节逻辑及其余文字与原文完全一致，不要改动任何未涉及的内容：\n\n${parts.join('\n')}`;

    const result = await reviserAgent.reviseWithInstruction(chapter.content, instruction);
    return c.json({
      success: true,
      data: {
        revisedContent: result.revisedContent,
        revisionNotes: result.revisionNotes,
        originalContent: chapter.content,
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: `修复失败: ${error.message}` }, 500);
  }
};
app.post('/chapters/:id/fix-issue', fixIssueHandler);
app.post('/projects/:pid/chapters/:id/fix-issue', fixIssueHandler);

/** POST /api/chapters/:id/fix-all-quality - 质量审计一键修复，返回预览不自动保存 */
const fixAllQualitySchema = z.object({
  issues: z.array(z.object({
    dimension: z.string().optional(),
    severity: z.string().optional(),
    description: z.string().optional(),
    suggestion: z.string().optional(),
  })),
  ignoredIndices: z.array(z.number()).optional(),
});
const fixAllQualityHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的参数' }, 400);
    const parsed = fixAllQualitySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);

    const ignored = new Set<number>((parsed.data.ignoredIndices ?? []).filter((n) => Number.isInteger(n)));
    const candidates = (parsed.data.issues ?? []).filter((_, idx) => !ignored.has(idx));
    // 优先修 critical/major；没有时降级修 minor（info 为提醒类不修）
    const important = candidates.filter((i) => i.severity === 'critical' || i.severity === 'major');
    const actionable = important.length ? important : candidates.filter((i) => i.severity === 'minor');
    if (!actionable.length) {
      return c.json({ success: false, error: '无可修复的质量问题（均为info提醒类或已被忽略）' }, 400);
    }

    const [chapter] = await creativeDb
      .select({ content: schema.generatedChapter.content })
      .from(schema.generatedChapter)
      .where(and(
        eq(schema.generatedChapter.chapterPlanId, id),
        eq(schema.generatedChapter.isCurrent, true),
      ))
      .limit(1);
    if (!chapter?.content) return c.json({ success: false, error: '该章节没有可修订的内容' }, 404);

    const lines = actionable.map((i, idx) => {
      const parts = [`${idx + 1}. [${i.dimension ?? ''}] ${i.description ?? ''}`];
      if (i.suggestion) parts.push(`   修改建议：${i.suggestion}`);
      return parts.join('\n');
    });
    const instruction =
      `请严格按照以下质量审计问题修订本章，仅修正列出的问题，保持剧情、人物、情节逻辑与原文完全一致，不要改动未涉及的内容：\n\n${lines.join('\n\n')}`;

    const result = await reviserAgent.reviseWithInstruction(chapter.content, instruction);
    return c.json({
      success: true,
      data: {
        revisedContent: result.revisedContent,
        revisionNotes: result.revisionNotes,
        originalContent: chapter.content,
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: `质量修订失败: ${error.message}` }, 500);
  }
};
app.post('/chapters/:id/fix-all-quality', fixAllQualityHandler);
app.post('/projects/:pid/chapters/:id/fix-all-quality', fixAllQualityHandler);

/** GET /api/projects/:pid/export?format=txt|md&volumeNo= - 整书/按卷导出 */
app.get('/projects/:pid/export', async (c) => {
  try {
    const pid = Number(c.req.param('pid'));
    if (isNaN(pid)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }

    const format = c.req.query('format') || 'txt';
    if (!['txt', 'md'].includes(format)) {
      return c.json({ success: false, error: 'format 仅支持 txt 或 md' }, 400);
    }
    const volumeNo = c.req.query('volumeNo') ? Number(c.req.query('volumeNo')) : undefined;
    // 阅读路径章节（chapter_plan.id 列表）：传入则沿用户实际分支路径导出，否则导出主线
    const chapterIdsParam = c.req.query('chapterIds');

    // 获取项目标题
    const [project] = await creativeDb
      .select({ title: schema.creativeProject.title })
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, pid))
      .limit(1);
    if (!project) {
      return c.json({ success: false, error: '项目不存在' }, 404);
    }

    type ExportChapter = { volumeNo: number | null; chapterNo: number | null; title: string | null; content: string | null };
    let chapters: ExportChapter[];

    if (chapterIdsParam) {
      // 分支路径：chapterIds 是 chapter_plan.id，按列表顺序逐个解析其当前版本（保序，不重排）
      const planIds = chapterIdsParam.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
      chapters = [];
      for (const planId of planIds) {
        const conds = [
          eq(schema.generatedChapter.chapterPlanId, planId),
          eq(schema.generatedChapter.projectId, pid),
          eq(schema.generatedChapter.isCurrent, true),
        ];
        if (volumeNo !== undefined) conds.push(eq(schema.generatedChapter.volumeNo, volumeNo));
        const [ch] = await creativeDb
          .select({
            volumeNo: schema.generatedChapter.volumeNo,
            chapterNo: schema.generatedChapter.chapterNo,
            title: schema.generatedChapter.title,
            content: schema.generatedChapter.content,
          })
          .from(schema.generatedChapter)
          .where(and(...conds))
          .limit(1);
        if (ch) chapters.push(ch);
      }
    } else {
      // 主线：当前版本章节，按卷/章排序
      const conditions = [
        eq(schema.generatedChapter.projectId, pid),
        eq(schema.generatedChapter.isCurrent, true),
      ];
      if (volumeNo !== undefined) {
        conditions.push(eq(schema.generatedChapter.volumeNo, volumeNo));
      }
      chapters = await creativeDb
        .select({
          volumeNo: schema.generatedChapter.volumeNo,
          chapterNo: schema.generatedChapter.chapterNo,
          title: schema.generatedChapter.title,
          content: schema.generatedChapter.content,
        })
        .from(schema.generatedChapter)
        .where(and(...conditions))
        .orderBy(schema.generatedChapter.volumeNo, schema.generatedChapter.chapterNo);
    }

    if (chapters.length === 0) {
      return c.json({ success: false, error: '没有可导出的章节内容' }, 404);
    }

    // 组装文本
    let text = '';
    if (format === 'md') {
      text += `# ${project.title}\n\n`;
      if (volumeNo !== undefined) {
        text += `> 第${volumeNo}卷\n\n`;
      }
      let lastVol = -1;
      for (const ch of chapters) {
        if (volumeNo === undefined && ch.volumeNo !== lastVol) {
          lastVol = ch.volumeNo!;
          text += `## 第${ch.volumeNo}卷\n\n`;
        }
        text += `### 第${ch.chapterNo}章 ${ch.title}\n\n`;
        text += (ch.content || '').trim() + '\n\n';
      }
    } else {
      // TXT: 纯文本，章节间空行分隔
      let lastVol = -1;
      for (const ch of chapters) {
        if (volumeNo === undefined && ch.volumeNo !== lastVol) {
          lastVol = ch.volumeNo!;
          text += `\n${'='.repeat(40)}\n  第${ch.volumeNo}卷\n${'='.repeat(40)}\n\n`;
        }
        text += `第${ch.chapterNo}章 ${ch.title}\n\n`;
        text += (ch.content || '').trim() + '\n\n';
      }
      text = text.trimStart();
    }

    // 文件名
    const volSuffix = volumeNo !== undefined ? `_第${volumeNo}卷` : '';
    const filename = `${project.title}${volSuffix}.${format}`;
    const encodedFilename = encodeURIComponent(filename);

    return new Response(text, {
      headers: {
        'Content-Type': format === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`,
        'Access-Control-Allow-Origin': 'http://localhost:5173',
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 单场景视角切换（模块6） ============

const perspectiveSchema = z.object({
  selectedText: z.string().min(1),
  targetCharacterName: z.string().min(1),
  targetCharacterId: z.number().int().optional(),
});

/** POST /api/chapters/:id/rewrite-perspective - 段落视角重写（不覆盖原文） */
const rewritePerspectiveHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的章节ID' }, 400);

    const parsed = perspectiveSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const { selectedText, targetCharacterName, targetCharacterId } = parsed.data;

    // 获取当前版本内容
    const [chapter] = await creativeDb
      .select({
        content: schema.generatedChapter.content,
        perspectiveVersions: schema.generatedChapter.perspectiveVersions,
      })
      .from(schema.generatedChapter)
      .where(and(
        eq(schema.generatedChapter.chapterPlanId, id),
        eq(schema.generatedChapter.isCurrent, true)
      ))
      .limit(1);

    if (!chapter?.content) {
      return c.json({ success: false, error: '该章节没有可操作的内容' }, 404);
    }

    // 构造视角重写指令
    const instruction = `将选中段落切换为「${targetCharacterName}」的视角重写。要求：
1. 保持事件、场景、对话内容不变
2. 将心理活动、感知、情绪切换为${targetCharacterName}的内在体验
3. 信息感知受限于${targetCharacterName}的视角（不知道其他人物的内心）
4. 语言风格贴合${targetCharacterName}的性格特征
5. 字数与原文相当，不要大幅扩写或缩减`;

    const result = await reviserAgent.reviseWithInstruction(
      chapter.content,
      instruction,
      selectedText
    );

    // 保存到 perspective_versions（追加，不覆盖原文）
    const versions: any[] = Array.isArray(chapter.perspectiveVersions) ? [...(chapter.perspectiveVersions as any[])] : [];
    const newVersion = {
      targetCharacterName,
      targetCharacterId: targetCharacterId ?? null,
      originalText: selectedText,
      rewrittenText: result.revisedContent,
      createdAt: new Date().toISOString(),
    };
    versions.push(newVersion);

    // 更新 perspective_versions 字段（找到当前版本的 generated_chapter 行）
    await creativeDb
      .update(schema.generatedChapter)
      .set({ perspectiveVersions: versions })
      .where(and(
        eq(schema.generatedChapter.chapterPlanId, id),
        eq(schema.generatedChapter.isCurrent, true)
      ));

    return c.json({
      success: true,
      data: {
        rewrittenText: result.revisedContent,
        originalText: selectedText,
        targetCharacterName,
        versionIndex: versions.length - 1,
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: `视角重写失败: ${error.message}` }, 500);
  }
};
app.post('/chapters/:id/rewrite-perspective', rewritePerspectiveHandler);
app.post('/projects/:pid/chapters/:id/rewrite-perspective', rewritePerspectiveHandler);

export default app;
