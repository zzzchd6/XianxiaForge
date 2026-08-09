/**
 * 全局状态追踪路由
 * 人物状态快照 + 时间线里程碑 的 CRUD、引导初始化(bootstrap)、LLM抽取(extract)、人工确认(confirm)
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, inArray } from 'drizzle-orm';
import { creativeDb, zhuxianDb } from '../db/index.js';
import * as creative from '../db/creative-schema.js';
import * as zhuxian from '../db/zhuxian-schema.js';
import { stateExtractorAgent } from '../agents/extractor.js';
import { persistExtraction, getActiveBranchChapterNos } from '../state/store.js';

const app = new Hono();

// ---------- 校验 schema ----------
const snapshotCreateSchema = z.object({
  characterId: z.number().int().optional(),
  characterName: z.string().min(1),
  volumeNo: z.number().int().optional(),
  chapterNo: z.number().int().default(0),
  location: z.string().optional(),
  realm: z.string().optional(),
  injury: z.string().optional(),
  mentalState: z.string().optional(),
  possessedItems: z.array(z.string()).optional(),
  status: z.enum(['pending', 'confirmed', 'auto_confirmed', 'rejected']).default('pending'),
});

const snapshotUpdateSchema = snapshotCreateSchema.partial();

const timelineCreateSchema = z.object({
  volumeNo: z.number().int().optional(),
  chapterNo: z.number().int().default(0),
  storyTime: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  importance: z.enum(['key', 'normal']).default('normal'),
  status: z.enum(['pending', 'confirmed', 'auto_confirmed', 'rejected']).default('pending'),
  sortOrder: z.number().int().optional(),
});

const timelineUpdateSchema = timelineCreateSchema.partial();

// ---------- 人物状态快照 ----------

/** GET /api/projects/:id/state/snapshots?status= 列表 */
app.get('/projects/:id/state/snapshots', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const status = c.req.query('status');
    const conds = [eq(creative.characterStateSnapshot.projectId, projectId)];
    if (status) conds.push(eq(creative.characterStateSnapshot.status, status));

    const rows = await creativeDb
      .select()
      .from(creative.characterStateSnapshot)
      .where(and(...conds))
      .orderBy(creative.characterStateSnapshot.chapterNo, creative.characterStateSnapshot.id);

    return c.json({ success: true, data: rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:id/state/snapshots 手动创建 */
app.post('/projects/:id/state/snapshots', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const parsed = snapshotCreateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const d = parsed.data;

    const [row] = await creativeDb
      .insert(creative.characterStateSnapshot)
      .values({
        projectId,
        characterId: d.characterId ?? null,
        characterName: d.characterName,
        volumeNo: d.volumeNo ?? null,
        chapterNo: d.chapterNo,
        location: d.location ?? null,
        realm: d.realm ?? null,
        injury: d.injury ?? null,
        mentalState: d.mentalState ?? null,
        possessedItems: d.possessedItems ?? [],
        status: d.status,
        source: 'manual',
      })
      .returning();

    return c.json({ success: true, data: row }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/state/snapshots/:sid 更新 */
app.put('/state/snapshots/:sid', async (c) => {
  try {
    const id = Number(c.req.param('sid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的快照ID' }, 400);

    const parsed = snapshotUpdateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const d = parsed.data;
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (d.characterId !== undefined) updateData.characterId = d.characterId;
    if (d.characterName !== undefined) updateData.characterName = d.characterName;
    if (d.volumeNo !== undefined) updateData.volumeNo = d.volumeNo;
    if (d.chapterNo !== undefined) updateData.chapterNo = d.chapterNo;
    if (d.location !== undefined) updateData.location = d.location;
    if (d.realm !== undefined) updateData.realm = d.realm;
    if (d.injury !== undefined) updateData.injury = d.injury;
    if (d.mentalState !== undefined) updateData.mentalState = d.mentalState;
    if (d.possessedItems !== undefined) updateData.possessedItems = d.possessedItems;
    if (d.status !== undefined) updateData.status = d.status;

    const [row] = await creativeDb
      .update(creative.characterStateSnapshot)
      .set(updateData)
      .where(eq(creative.characterStateSnapshot.id, id))
      .returning();

    if (!row) return c.json({ success: false, error: '快照不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/state/snapshots/:sid/confirm 确认 */
app.post('/state/snapshots/:sid/confirm', async (c) => {
  try {
    const id = Number(c.req.param('sid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的快照ID' }, 400);

    const [row] = await creativeDb
      .update(creative.characterStateSnapshot)
      .set({ status: 'confirmed', updatedAt: new Date() })
      .where(eq(creative.characterStateSnapshot.id, id))
      .returning();

    if (!row) return c.json({ success: false, error: '快照不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/state/snapshots/:sid/reject 否决（v1.4 第三期：自动生效的抽取结果可否决，否决后不再进上下文） */
app.post('/state/snapshots/:sid/reject', async (c) => {
  try {
    const id = Number(c.req.param('sid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的快照ID' }, 400);

    const [row] = await creativeDb
      .update(creative.characterStateSnapshot)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(creative.characterStateSnapshot.id, id))
      .returning();

    if (!row) return c.json({ success: false, error: '快照不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ---------- 时间线里程碑 ----------

/** GET /api/projects/:id/state/timeline?status=&branchAware= 列表 */
app.get('/projects/:id/state/timeline', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const status = c.req.query('status');
    const branchAware = c.req.query('branchAware') !== 'false';
    const conds = [eq(creative.timelineMilestone.projectId, projectId)];
    if (status) conds.push(eq(creative.timelineMilestone.status, status));

    let rows = await creativeDb
      .select()
      .from(creative.timelineMilestone)
      .where(and(...conds))
      .orderBy(creative.timelineMilestone.chapterNo, creative.timelineMilestone.sortOrder);

    // 分支感知过滤：source='auto' 的里程碑仅保留活跃分支路径上的章节
    // （manual/bootstrap 为用户手动创建，不属于任何分支，永不过滤）
    let branchPath: number[] = [];
    if (branchAware) {
      try {
        const { activeSet, activePath } = await getActiveBranchChapterNos(projectId);
        branchPath = activePath;
        rows = rows.filter((r) => r.source !== 'auto' || activeSet.has(r.chapterNo));
      } catch {
        // 活跃路径计算失败时降级为不过滤，保证时间线始终可用
      }
    }

    return c.json({ success: true, data: { milestones: rows, branchPath } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:id/state/timeline 手动创建 */
app.post('/projects/:id/state/timeline', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const parsed = timelineCreateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const d = parsed.data;

    const [row] = await creativeDb
      .insert(creative.timelineMilestone)
      .values({
        projectId,
        volumeNo: d.volumeNo ?? null,
        chapterNo: d.chapterNo,
        storyTime: d.storyTime ?? null,
        title: d.title,
        description: d.description ?? null,
        importance: d.importance,
        status: d.status,
        source: 'manual',
        sortOrder: d.sortOrder ?? 0,
      })
      .returning();

    return c.json({ success: true, data: row }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/state/timeline/:tid 更新 */
app.put('/state/timeline/:tid', async (c) => {
  try {
    const id = Number(c.req.param('tid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的时间线ID' }, 400);

    const parsed = timelineUpdateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const d = parsed.data;
    const updateData: Record<string, any> = {};
    if (d.volumeNo !== undefined) updateData.volumeNo = d.volumeNo;
    if (d.chapterNo !== undefined) updateData.chapterNo = d.chapterNo;
    if (d.storyTime !== undefined) updateData.storyTime = d.storyTime;
    if (d.title !== undefined) updateData.title = d.title;
    if (d.description !== undefined) updateData.description = d.description;
    if (d.importance !== undefined) updateData.importance = d.importance;
    if (d.status !== undefined) updateData.status = d.status;
    if (d.sortOrder !== undefined) updateData.sortOrder = d.sortOrder;

    const [row] = await creativeDb
      .update(creative.timelineMilestone)
      .set(updateData)
      .where(eq(creative.timelineMilestone.id, id))
      .returning();

    if (!row) return c.json({ success: false, error: '时间线不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/state/timeline/:tid/confirm 确认 */
app.post('/state/timeline/:tid/confirm', async (c) => {
  try {
    const id = Number(c.req.param('tid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的时间线ID' }, 400);

    const [row] = await creativeDb
      .update(creative.timelineMilestone)
      .set({ status: 'confirmed' })
      .where(eq(creative.timelineMilestone.id, id))
      .returning();

    if (!row) return c.json({ success: false, error: '时间线不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/state/timeline/:tid/reject 否决（自动生效的抽取里程碑可否决） */
app.post('/state/timeline/:tid/reject', async (c) => {
  try {
    const id = Number(c.req.param('tid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的时间线ID' }, 400);

    const [row] = await creativeDb
      .update(creative.timelineMilestone)
      .set({ status: 'rejected' })
      .where(eq(creative.timelineMilestone.id, id))
      .returning();

    if (!row) return c.json({ success: false, error: '时间线不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ---------- 引导初始化 ----------

/**
 * POST /api/projects/:id/state/bootstrap
 * 从诛仙人物库 + 卷大纲引导初始状态（chapterNo=0, pending, source=bootstrap）
 * body: { characterIds?: number[] } 可选，缺省时收集章节计划中引用的人物
 */
app.post('/projects/:id/state/bootstrap', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const body = await c.req.json().catch(() => ({}));
    let characterIds: number[] = Array.isArray(body.characterIds) ? body.characterIds : [];

    // 缺省：从章节计划的 requiredEntityIds.characters + povCharacterIds 收集
    if (!characterIds.length) {
      const plans = await creativeDb
        .select({
          requiredEntityIds: creative.chapterPlan.requiredEntityIds,
          povCharacterIds: creative.chapterPlan.povCharacterIds,
        })
        .from(creative.chapterPlan)
        .where(eq(creative.chapterPlan.projectId, projectId));

      const idSet = new Set<number>();
      for (const p of plans) {
        const req = p.requiredEntityIds as any;
        if (req && Array.isArray(req.characters)) req.characters.forEach((n: number) => idSet.add(n));
        if (Array.isArray(p.povCharacterIds)) (p.povCharacterIds as number[]).forEach((n) => idSet.add(n));
      }
      characterIds = [...idSet];
    }

    let seededSnapshots = 0;
    if (characterIds.length) {
      const chars = await zhuxianDb
        .select()
        .from(zhuxian.novelCharacterLib)
        .where(
          and(
            inArray(zhuxian.novelCharacterLib.id, characterIds),
            eq(zhuxian.novelCharacterLib.isDeleted, false)
          )
        );

      if (chars.length) {
        await creativeDb.insert(creative.characterStateSnapshot).values(
          chars.map((ch) => ({
            projectId,
            characterId: ch.id,
            characterName: ch.name,
            volumeNo: null,
            chapterNo: 0,
            location: null,
            realm: ch.realm ?? null,
            injury: null,
            mentalState: null,
            possessedItems: Array.isArray(ch.exclusiveItems) ? (ch.exclusiveItems as string[]) : [],
            status: 'pending',
            source: 'bootstrap',
          }))
        );
        seededSnapshots = chars.length;
      }
    }

    // 时间线：从卷大纲 keyEvents 引导
    let seededMilestones = 0;
    const outlines = await creativeDb
      .select()
      .from(creative.storyOutline)
      .where(eq(creative.storyOutline.projectId, projectId));

    const milestoneValues: any[] = [];
    for (const o of outlines) {
      const events = Array.isArray(o.keyEvents) ? (o.keyEvents as any[]) : [];
      events.forEach((ev, idx) => {
        const title = typeof ev === 'string' ? ev : ev?.title || ev?.name || '';
        if (!title) return;
        milestoneValues.push({
          projectId,
          volumeNo: o.volumeNo,
          chapterNo: 0,
          storyTime: null,
          title,
          description: typeof ev === 'object' ? ev?.description ?? null : null,
          importance: 'normal',
          status: 'pending',
          source: 'bootstrap',
          sortOrder: idx,
        });
      });
    }
    if (milestoneValues.length) {
      await creativeDb.insert(creative.timelineMilestone).values(milestoneValues);
      seededMilestones = milestoneValues.length;
    }

    return c.json({
      success: true,
      data: { seededSnapshots, seededMilestones, characterIds },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ---------- LLM 抽取 ----------

/**
 * POST /api/projects/:id/state/extract
 * 对指定章节的已生成正文运行状态抽取，结果以 pending 落库
 * body: { chapterNo: number }
 */
app.post('/projects/:id/state/extract', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const body = await c.req.json();
    const chapterNo = Number(body.chapterNo);
    if (isNaN(chapterNo)) {
      return c.json({ success: false, error: '缺少有效的 chapterNo' }, 400);
    }

    // 找到该章当前版本的已生成内容
    const [gen] = await creativeDb
      .select()
      .from(creative.generatedChapter)
      .where(
        and(
          eq(creative.generatedChapter.projectId, projectId),
          eq(creative.generatedChapter.chapterNo, chapterNo),
          eq(creative.generatedChapter.isCurrent, true)
        )
      )
      .limit(1);

    if (!gen || !gen.content) {
      return c.json({ success: false, error: `第${chapterNo}章暂无已生成内容` }, 404);
    }

    // 取章节计划的标题/意图作为抽取约束
    let title = gen.title ?? `第${chapterNo}章`;
    let intent: string | undefined;
    if (gen.chapterPlanId) {
      const [plan] = await creativeDb
        .select()
        .from(creative.chapterPlan)
        .where(eq(creative.chapterPlan.id, gen.chapterPlanId))
        .limit(1);
      if (plan) {
        title = plan.title;
        intent = plan.intent ?? undefined;
      }
    }

    const result = await stateExtractorAgent.extract(gen.content, {
      chapterNumber: chapterNo,
      title,
      intent,
    });

    const persisted = await persistExtraction(
      projectId,
      gen.volumeNo ?? null,
      chapterNo,
      result.characters,
      result.timeline,
      undefined,
      result.memories,
      result.tasks
    );

    return c.json({ success: true, data: { ...persisted, extraction: result } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
