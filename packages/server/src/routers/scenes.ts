/**
 * 场景脚本路由（原"场景小纲"）
 * 挂载于 /api/projects/:id/outlines/:outlineId/scenes
 * 提供场景节点CRUD、关联管理、排序、连线等能力
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { creativeDb, zhuxianDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import * as zhuxianSchema from '../db/zhuxian-schema.js';
import * as retriever from '../rag/retriever.js';
import { checkRhythmHealth, computeSceneIntensity, checkSceneIntensityHealth } from '../rag/conflict-score.js';
import { chatCompletion } from '../llm/client.js';
import { writeBackKeyEvent } from '../services/outline-writeback.js';
import { getSelectedDirectionChain } from '../services/direction.service.js';
import { getDirection, getCategory } from '../services/direction-catalog.js';

const app = new Hono();

// ============ Zod 校验 ============

const createSceneSchema = z.object({
  title: z.string().min(1, '场景标题不能为空'),
  timeSetting: z.string().optional(),
  locationDesc: z.string().optional(),
  coreEvent: z.string().optional(),
  effectAndResult: z.string().optional(),
  foreshadowingNote: z.string().optional(),
  sceneType: z.enum(['key', 'transition', 'foreshadow']).default('transition'),
  isKeyPlot: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  metadata: z.any().optional(),
  // 施工卡增强字段（需求3）
  coreBeat: z.string().optional(),
  stateChange: z.any().optional(),
  sceneHookType: z.string().max(20).optional(),
  rhythmAnchor: z.string().max(20).optional(),
  scenePlotFingerprint: z.string().max(30).optional(),
  payoffSetup: z.string().optional(),
  // PRD-B薄增量：分支三字段（规划期分支路径）
  nodeType: z.enum(['linear', 'branch_point']).default('linear'),
  branchGroupId: z.string().max(60).nullable().optional(),
  pathLabel: z.string().max(60).nullable().optional(),
});

const updateSceneSchema = createSceneSchema.partial();

const addCharacterSchema = z.object({
  characterId: z.number().int(),
  appearanceType: z.enum(['protagonist', 'core_support', 'mention']).default('core_support'),
  roleNote: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

const addElementSchema = z.object({
  elementType: z.enum(['location', 'skill', 'item', 'monster', 'material', 'daily_item', 'foreshadow_template']),
  elementId: z.number().int(),
  elementNote: z.string().optional(),
  foreshadowDirection: z.enum(['plant', 'payoff']).optional(),
  elementSource: z.enum(['native', 'custom']).default('native'),
  sortOrder: z.number().int().default(0),
});

const addRelationSchema = z.object({
  targetNodeId: z.number().int(),
  relationType: z.enum(['causal', 'sequential', 'foreshadow_echo']).default('sequential'),
  description: z.string().optional(),
});

const reorderSchema = z.object({
  nodeIds: z.array(z.number().int()).min(1),
});

// ============ 场景节点 CRUD ============

/** GET /projects/:id/outlines/:outlineId/scenes - 获取卷下全部场景节点（含关联） */
app.get('/projects/:id/outlines/:outlineId/scenes', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const outlineId = Number(c.req.param('outlineId'));
    if (isNaN(projectId) || isNaN(outlineId)) {
      return c.json({ success: false, error: '无效的参数' }, 400);
    }

    // 查询节点列表
    const nodes = await creativeDb
      .select()
      .from(schema.sceneNode)
      .where(and(
        eq(schema.sceneNode.projectId, projectId),
        eq(schema.sceneNode.outlineId, outlineId),
      ))
      .orderBy(asc(schema.sceneNode.sortOrder));

    if (nodes.length === 0) {
      return c.json({ success: true, data: [] });
    }

    const nodeIds = nodes.map((n) => n.id);

    // 批量查询关联数据
    const [characters, elements, relations] = await Promise.all([
      creativeDb
        .select()
        .from(schema.sceneNodeCharacter)
        .where(inArray(schema.sceneNodeCharacter.sceneNodeId, nodeIds)),
      creativeDb
        .select()
        .from(schema.sceneNodeElement)
        .where(inArray(schema.sceneNodeElement.sceneNodeId, nodeIds)),
      creativeDb
        .select()
        .from(schema.sceneNodeRelation)
        .where(inArray(schema.sceneNodeRelation.sourceNodeId, nodeIds)),
    ]);

    // 组装完整节点数据
    const enrichedNodes = nodes.map((node) => ({
      ...node,
      characters: characters.filter((ch) => ch.sceneNodeId === node.id),
      elements: elements.filter((el) => el.sceneNodeId === node.id),
      relations: relations.filter((rel) => rel.sourceNodeId === node.id),
    }));

    return c.json({ success: true, data: enrichedNodes });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /projects/:id/outlines/:outlineId/scenes - 创建场景节点 */
app.post('/projects/:id/outlines/:outlineId/scenes', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const outlineId = Number(c.req.param('outlineId'));
    if (isNaN(projectId) || isNaN(outlineId)) {
      return c.json({ success: false, error: '无效的参数' }, 400);
    }

    // 验证卷大纲存在
    const [outline] = await creativeDb
      .select()
      .from(schema.storyOutline)
      .where(and(
        eq(schema.storyOutline.id, outlineId),
        eq(schema.storyOutline.projectId, projectId),
      ))
      .limit(1);

    if (!outline) {
      return c.json({ success: false, error: '卷大纲不存在' }, 404);
    }

    const body = await c.req.json();
    const parsed = createSceneSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    // 如果没有指定 sortOrder，自动追加到末尾
    let sortOrder = parsed.data.sortOrder;
    if (!body.sortOrder && body.sortOrder !== 0) {
      const [lastNode] = await creativeDb
        .select({ sortOrder: schema.sceneNode.sortOrder })
        .from(schema.sceneNode)
        .where(eq(schema.sceneNode.outlineId, outlineId))
        .orderBy(asc(schema.sceneNode.sortOrder))
        .limit(1);
      // 取最大值+1（简单实现，后续可优化）
      const allNodes = await creativeDb
        .select({ sortOrder: schema.sceneNode.sortOrder })
        .from(schema.sceneNode)
        .where(eq(schema.sceneNode.outlineId, outlineId));
      sortOrder = allNodes.length > 0
        ? Math.max(...allNodes.map((n) => n.sortOrder)) + 1
        : 0;
    }

    const [node] = await creativeDb
      .insert(schema.sceneNode)
      .values({
        projectId,
        outlineId,
        title: parsed.data.title,
        timeSetting: parsed.data.timeSetting || null,
        locationDesc: parsed.data.locationDesc || null,
        coreEvent: parsed.data.coreEvent || null,
        effectAndResult: parsed.data.effectAndResult || null,
        foreshadowingNote: parsed.data.foreshadowingNote || null,
        sceneType: parsed.data.sceneType,
        isKeyPlot: parsed.data.isKeyPlot,
        sortOrder,
        metadata: parsed.data.metadata || null,
        coreBeat: parsed.data.coreBeat || null,
        stateChange: parsed.data.stateChange || null,
        sceneHookType: parsed.data.sceneHookType || null,
        rhythmAnchor: parsed.data.rhythmAnchor || null,
        scenePlotFingerprint: parsed.data.scenePlotFingerprint || null,
        payoffSetup: parsed.data.payoffSetup || null,
        nodeType: parsed.data.nodeType,
        branchGroupId: parsed.data.branchGroupId ?? null,
        pathLabel: parsed.data.pathLabel ?? null,
      })
      .returning();

    return c.json({ success: true, data: node }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /projects/:id/outlines/:outlineId/scenes/:sceneId - 更新场景节点 */
app.put('/projects/:id/outlines/:outlineId/scenes/:sceneId', async (c) => {
  try {
    const sceneId = Number(c.req.param('sceneId'));
    if (isNaN(sceneId)) {
      return c.json({ success: false, error: '无效的场景ID' }, 400);
    }

    const body = await c.req.json();
    const parsed = updateSceneSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.timeSetting !== undefined) updateData.timeSetting = parsed.data.timeSetting;
    if (parsed.data.locationDesc !== undefined) updateData.locationDesc = parsed.data.locationDesc;
    if (parsed.data.coreEvent !== undefined) updateData.coreEvent = parsed.data.coreEvent;
    if (parsed.data.effectAndResult !== undefined) updateData.effectAndResult = parsed.data.effectAndResult;
    if (parsed.data.foreshadowingNote !== undefined) updateData.foreshadowingNote = parsed.data.foreshadowingNote;
    if (parsed.data.sceneType !== undefined) updateData.sceneType = parsed.data.sceneType;
    if (parsed.data.isKeyPlot !== undefined) updateData.isKeyPlot = parsed.data.isKeyPlot;
    if (parsed.data.sortOrder !== undefined) updateData.sortOrder = parsed.data.sortOrder;
    if (parsed.data.metadata !== undefined) updateData.metadata = parsed.data.metadata;
    if (parsed.data.coreBeat !== undefined) updateData.coreBeat = parsed.data.coreBeat;
    if (parsed.data.stateChange !== undefined) updateData.stateChange = parsed.data.stateChange;
    if (parsed.data.sceneHookType !== undefined) updateData.sceneHookType = parsed.data.sceneHookType;
    if (parsed.data.rhythmAnchor !== undefined) updateData.rhythmAnchor = parsed.data.rhythmAnchor;
    if (parsed.data.scenePlotFingerprint !== undefined) updateData.scenePlotFingerprint = parsed.data.scenePlotFingerprint;
    if (parsed.data.payoffSetup !== undefined) updateData.payoffSetup = parsed.data.payoffSetup;
    if (parsed.data.nodeType !== undefined) updateData.nodeType = parsed.data.nodeType;
    if (parsed.data.branchGroupId !== undefined) updateData.branchGroupId = parsed.data.branchGroupId;
    if (parsed.data.pathLabel !== undefined) updateData.pathLabel = parsed.data.pathLabel;

    const [updated] = await creativeDb
      .update(schema.sceneNode)
      .set(updateData)
      .where(eq(schema.sceneNode.id, sceneId))
      .returning();

    if (!updated) {
      return c.json({ success: false, error: '场景节点不存在' }, 404);
    }

    // 反写卷大纲：把场景脚本的最新内容写回对应章节的 keyEvents 条目
    // （按 metadata.chapterNumber 匹配；无章节号或匹配不到则优雅跳过，失败不阻断场景保存）
    try {
      const chapterNumber = (updated.metadata as any)?.chapterNumber;
      await writeBackKeyEvent(
        creativeDb,
        updated.outlineId,
        chapterNumber,
        updated.title,
        updated.coreEvent,
      );
    } catch (e: any) {
      console.warn(`[场景脚本] 反写卷大纲失败（不影响场景保存）: ${e.message}`);
    }

    return c.json({ success: true, data: updated });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /projects/:id/outlines/:outlineId/scenes/:sceneId - 删除场景节点 */
app.delete('/projects/:id/outlines/:outlineId/scenes/:sceneId', async (c) => {
  try {
    const sceneId = Number(c.req.param('sceneId'));
    if (isNaN(sceneId)) {
      return c.json({ success: false, error: '无效的场景ID' }, 400);
    }

    const [deleted] = await creativeDb
      .delete(schema.sceneNode)
      .where(eq(schema.sceneNode.id, sceneId))
      .returning();

    if (!deleted) {
      return c.json({ success: false, error: '场景节点不存在' }, 404);
    }

    return c.json({ success: true, data: { message: '场景节点已删除，关联数据已级联清理' } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /projects/:id/outlines/:outlineId/scenes/reorder - 批量更新排序 */
app.put('/projects/:id/outlines/:outlineId/scenes/reorder', async (c) => {
  try {
    const outlineId = Number(c.req.param('outlineId'));
    if (isNaN(outlineId)) {
      return c.json({ success: false, error: '无效的参数' }, 400);
    }

    const body = await c.req.json();
    const parsed = reorderSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    // 按传入顺序更新 sortOrder
    const updates = parsed.data.nodeIds.map((nodeId, index) =>
      creativeDb
        .update(schema.sceneNode)
        .set({ sortOrder: index, updatedAt: new Date() })
        .where(and(
          eq(schema.sceneNode.id, nodeId),
          eq(schema.sceneNode.outlineId, outlineId),
        ))
    );

    await Promise.all(updates);

    return c.json({ success: true, data: { message: '排序已更新' } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 人物关联 ============

/** POST /projects/:id/outlines/:outlineId/scenes/:sceneId/characters - 添加人物关联 */
app.post('/projects/:id/outlines/:outlineId/scenes/:sceneId/characters', async (c) => {
  try {
    const sceneId = Number(c.req.param('sceneId'));
    if (isNaN(sceneId)) {
      return c.json({ success: false, error: '无效的场景ID' }, 400);
    }

    const body = await c.req.json();
    const parsed = addCharacterSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const [assoc] = await creativeDb
      .insert(schema.sceneNodeCharacter)
      .values({
        sceneNodeId: sceneId,
        characterId: parsed.data.characterId,
        appearanceType: parsed.data.appearanceType,
        roleNote: parsed.data.roleNote || null,
        sortOrder: parsed.data.sortOrder,
      })
      .returning();

    return c.json({ success: true, data: assoc }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /projects/:id/outlines/:outlineId/scenes/:sceneId/characters/:assocId - 移除人物关联 */
app.delete('/projects/:id/outlines/:outlineId/scenes/:sceneId/characters/:assocId', async (c) => {
  try {
    const assocId = Number(c.req.param('assocId'));
    if (isNaN(assocId)) {
      return c.json({ success: false, error: '无效的关联ID' }, 400);
    }

    await creativeDb
      .delete(schema.sceneNodeCharacter)
      .where(eq(schema.sceneNodeCharacter.id, assocId));

    return c.json({ success: true, data: { message: '人物关联已移除' } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 世界观要素关联 ============

/** POST /projects/:id/outlines/:outlineId/scenes/:sceneId/elements - 添加要素关联 */
app.post('/projects/:id/outlines/:outlineId/scenes/:sceneId/elements', async (c) => {
  try {
    const sceneId = Number(c.req.param('sceneId'));
    if (isNaN(sceneId)) {
      return c.json({ success: false, error: '无效的场景ID' }, 400);
    }

    const body = await c.req.json();
    const parsed = addElementSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const [assoc] = await creativeDb
      .insert(schema.sceneNodeElement)
      .values({
        sceneNodeId: sceneId,
        elementType: parsed.data.elementType,
        elementId: parsed.data.elementId,
        elementNote: parsed.data.elementNote || null,
        foreshadowDirection: parsed.data.foreshadowDirection || null,
        elementSource: parsed.data.elementSource,
        sortOrder: parsed.data.sortOrder,
      })
      .returning();

    return c.json({ success: true, data: assoc }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /projects/:id/outlines/:outlineId/scenes/:sceneId/elements/:assocId - 移除要素关联 */
app.delete('/projects/:id/outlines/:outlineId/scenes/:sceneId/elements/:assocId', async (c) => {
  try {
    const assocId = Number(c.req.param('assocId'));
    if (isNaN(assocId)) {
      return c.json({ success: false, error: '无效的关联ID' }, 400);
    }

    await creativeDb
      .delete(schema.sceneNodeElement)
      .where(eq(schema.sceneNodeElement.id, assocId));

    return c.json({ success: true, data: { message: '要素关联已移除' } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /projects/:id/outlines/:outlineId/scenes/:sceneId/characters/:assocId - 修改人物关联（备注/出场类型） */
app.put('/projects/:id/outlines/:outlineId/scenes/:sceneId/characters/:assocId', async (c) => {
  try {
    const assocId = Number(c.req.param('assocId'));
    if (isNaN(assocId)) return c.json({ success: false, error: '无效的关联ID' }, 400);

    const body = await c.req.json();
    const updateData: Record<string, any> = {};
    if (body.roleNote !== undefined) updateData.roleNote = body.roleNote;
    if (body.appearanceType !== undefined) updateData.appearanceType = body.appearanceType;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (Object.keys(updateData).length === 0) {
      return c.json({ success: false, error: '没有可更新的字段' }, 400);
    }

    const [updated] = await creativeDb
      .update(schema.sceneNodeCharacter)
      .set(updateData)
      .where(eq(schema.sceneNodeCharacter.id, assocId))
      .returning();

    if (!updated) return c.json({ success: false, error: '人物关联不存在' }, 404);
    return c.json({ success: true, data: updated });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /projects/:id/outlines/:outlineId/scenes/:sceneId/elements/:assocId - 修改要素关联（备注） */
app.put('/projects/:id/outlines/:outlineId/scenes/:sceneId/elements/:assocId', async (c) => {
  try {
    const assocId = Number(c.req.param('assocId'));
    if (isNaN(assocId)) return c.json({ success: false, error: '无效的关联ID' }, 400);

    const body = await c.req.json();
    const updateData: Record<string, any> = {};
    if (body.elementNote !== undefined) updateData.elementNote = body.elementNote;
    if (body.foreshadowDirection !== undefined) updateData.foreshadowDirection = body.foreshadowDirection;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (Object.keys(updateData).length === 0) {
      return c.json({ success: false, error: '没有可更新的字段' }, 400);
    }

    const [updated] = await creativeDb
      .update(schema.sceneNodeElement)
      .set(updateData)
      .where(eq(schema.sceneNodeElement.id, assocId))
      .returning();

    if (!updated) return c.json({ success: false, error: '要素关联不存在' }, 404);
    return c.json({ success: true, data: updated });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 智能匹配素材 ============

/** POST /projects/:id/outlines/:outlineId/scenes/:sceneId/match-materials - 智能匹配素材
 *  扫描节点的标题/时间/地点/核心事件等文本，从诛仙库实体名目录中找出出现过的
 *  人物/地点/功法/法宝/妖兽，返回候选清单（排除已关联的），供前端手动确认添加。
 */
app.post('/projects/:id/outlines/:outlineId/scenes/:sceneId/match-materials', async (c) => {
  try {
    const sceneId = Number(c.req.param('sceneId'));
    if (isNaN(sceneId)) return c.json({ success: false, error: '无效的场景ID' }, 400);

    // 1. 读取节点
    const [node] = await creativeDb
      .select()
      .from(schema.sceneNode)
      .where(eq(schema.sceneNode.id, sceneId))
      .limit(1);
    if (!node) return c.json({ success: false, error: '场景节点不存在' }, 404);

    // 2. 拼接待扫描文本
    const text = [
      node.title, node.timeSetting, node.locationDesc,
      node.coreEvent, node.effectAndResult, node.foreshadowingNote,
    ].filter(Boolean).join(' ');

    const empty = { characters: [], locations: [], skills: [], items: [], monsters: [], materials: [], dailyItems: [] };
    if (!text.trim()) return c.json({ success: true, data: empty });

    // 3. 读取已关联的人物/要素，匹配时排除，避免重复推荐
    const projectId = Number(c.req.param('id'));
    const [existingChars, existingEls] = await Promise.all([
      creativeDb.select().from(schema.sceneNodeCharacter).where(eq(schema.sceneNodeCharacter.sceneNodeId, sceneId)),
      creativeDb.select().from(schema.sceneNodeElement).where(eq(schema.sceneNodeElement.sceneNodeId, sceneId)),
    ]);
    const linkedCharIds = new Set(existingChars.map((x) => x.characterId));
    // 键含来源判别（兼容旧数据：缺省视为 native）
    const linkedElKeys = new Set(existingEls.map((x) => `${x.elementType}:${x.elementSource || 'native'}:${x.elementId}`));

    // 4. 实体名目录（带缓存）+ 妖兽/灵材/信物（目录未含，单独查）
    const dir = await retriever.getEntityNameDirectory();
    const [monsterRows, materialRows, dailyItemRows] = await Promise.all([
      zhuxianDb
        .select({ id: zhuxianSchema.novelMonsterLib.id, name: zhuxianSchema.novelMonsterLib.name })
        .from(zhuxianSchema.novelMonsterLib)
        .where(eq(zhuxianSchema.novelMonsterLib.isDeleted, false)),
      zhuxianDb
        .select({ id: zhuxianSchema.novelMaterialLib.id, name: zhuxianSchema.novelMaterialLib.name })
        .from(zhuxianSchema.novelMaterialLib)
        .where(eq(zhuxianSchema.novelMaterialLib.isDeleted, false)),
      zhuxianDb
        .select({ id: zhuxianSchema.novelDailyItemLib.id, name: zhuxianSchema.novelDailyItemLib.name })
        .from(zhuxianSchema.novelDailyItemLib)
        .where(eq(zhuxianSchema.novelDailyItemLib.isDeleted, false)),
    ]);
    // 按名去重，保留最小 id
    const dedupeByName = (rows: { id: number; name: string | null }[]) => {
      const byName = new Map<string, { id: number; name: string }>();
      for (const r of rows) {
        if (!r.name) continue;
        const ex = byName.get(r.name);
        if (!ex || r.id < ex.id) byName.set(r.name, { id: r.id, name: r.name });
      }
      return Array.from(byName.values());
    };
    const monsters = dedupeByName(monsterRows);
    const materials = dedupeByName(materialRows);
    const dailyItems = dedupeByName(dailyItemRows);

    // 5. 子串匹配（名字长度>=2，各类设上限，命中项附带来源判别）
    type Candidate = { id: number; name: string; source: 'native' | 'custom' };
    const match = (entries: { id: number; name: string }[], cap: number, source: 'native' | 'custom'): Candidate[] => {
      const out: Candidate[] = [];
      for (const e of entries) {
        if (e.name && e.name.length >= 2 && text.includes(e.name)) {
          out.push({ id: e.id, name: e.name, source });
          if (out.length >= cap) break;
        }
      }
      return out;
    };

    // 5b. 项目自定义武器（合流进 items 候选，source='custom'）
    const customWeaponRows = !isNaN(projectId)
      ? await creativeDb
          .select({ id: schema.customWeapon.id, name: schema.customWeapon.name })
          .from(schema.customWeapon)
          .where(and(eq(schema.customWeapon.projectId, projectId), eq(schema.customWeapon.isDeleted, false)))
      : [];

    // 5c. 项目自定义功法（合流进 skills 候选，source='custom'）
    const customTechniqueRows = !isNaN(projectId)
      ? await creativeDb
          .select({ id: schema.customTechnique.id, name: schema.customTechnique.name })
          .from(schema.customTechnique)
          .where(and(eq(schema.customTechnique.projectId, projectId), eq(schema.customTechnique.isDeleted, false)))
      : [];

    const data = {
      characters: match(dir.characters, 12, 'native').filter((x) => !linkedCharIds.has(x.id)),
      locations: match(dir.locations, 8, 'native').filter((x) => !linkedElKeys.has(`location:native:${x.id}`)),
      skills: [
        ...match(dir.skills, 8, 'native').filter((x) => !linkedElKeys.has(`skill:native:${x.id}`)),
        ...match(customTechniqueRows, 8, 'custom').filter((x) => !linkedElKeys.has(`skill:custom:${x.id}`)),
      ],
      items: [
        ...match(dir.items, 8, 'native').filter((x) => !linkedElKeys.has(`item:native:${x.id}`)),
        ...match(customWeaponRows, 8, 'custom').filter((x) => !linkedElKeys.has(`item:custom:${x.id}`)),
      ],
      monsters: match(monsters, 8, 'native').filter((x) => !linkedElKeys.has(`monster:native:${x.id}`)),
      materials: match(materials, 8, 'native').filter((x) => !linkedElKeys.has(`material:native:${x.id}`)),
      dailyItems: match(dailyItems, 8, 'native').filter((x) => !linkedElKeys.has(`daily_item:native:${x.id}`)),
    };

    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 节点间连线关系 ============

/** POST /projects/:id/outlines/:outlineId/scenes/:sceneId/relations - 创建连线 */
app.post('/projects/:id/outlines/:outlineId/scenes/:sceneId/relations', async (c) => {
  try {
    const sourceNodeId = Number(c.req.param('sceneId'));
    if (isNaN(sourceNodeId)) {
      return c.json({ success: false, error: '无效的场景ID' }, 400);
    }

    const body = await c.req.json();
    const parsed = addRelationSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    // 防止自连接
    if (sourceNodeId === parsed.data.targetNodeId) {
      return c.json({ success: false, error: '不能连接到自身' }, 400);
    }

    const [relation] = await creativeDb
      .insert(schema.sceneNodeRelation)
      .values({
        sourceNodeId,
        targetNodeId: parsed.data.targetNodeId,
        relationType: parsed.data.relationType,
        description: parsed.data.description || null,
      })
      .returning();

    return c.json({ success: true, data: relation }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /projects/:id/outlines/:outlineId/scenes/:sceneId/relations/:relationId - 删除连线 */
app.delete('/projects/:id/outlines/:outlineId/scenes/:sceneId/relations/:relationId', async (c) => {
  try {
    const relationId = Number(c.req.param('relationId'));
    if (isNaN(relationId)) {
      return c.json({ success: false, error: '无效的关系ID' }, 400);
    }

    await creativeDb
      .delete(schema.sceneNodeRelation)
      .where(eq(schema.sceneNodeRelation.id, relationId));

    return c.json({ success: true, data: { message: '连线已删除' } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 从章节导入场景节点 ============

/**
 * POST /projects/:id/outlines/:outlineId/scenes/import-from-chapters
 * 将章节数据导入为场景节点（反向同步，修复"同步章节拿不到数据"的断链）
 * 数据源优先级：chapter_plan（解析 sceneBreakdown）> story_outline.key_events
 * body: { replace?: boolean } replace=true 时先清空本卷已有场景节点
 */
app.post('/projects/:id/outlines/:outlineId/scenes/import-from-chapters', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const outlineId = Number(c.req.param('outlineId'));
    if (isNaN(projectId) || isNaN(outlineId)) {
      return c.json({ success: false, error: '无效的参数' }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const replace = body.replace === true;

    // 1. 优先取 chapter_plan（结构化程度更高）
    const plans = await creativeDb
      .select()
      .from(schema.chapterPlan)
      .where(and(
        eq(schema.chapterPlan.projectId, projectId),
        eq(schema.chapterPlan.outlineId, outlineId),
      ))
      .orderBy(asc(schema.chapterPlan.chapterNo));

    // 2. chapter_plan 为空时回退到卷大纲 key_events
    let sourceNodes: Array<Partial<typeof schema.sceneNode.$inferInsert>> = [];
    let sourceLabel = '';

    if (plans.length > 0) {
      sourceLabel = '章节计划';
      let sortIdx = 0;
      for (const plan of plans) {
        const sb = plan.sceneBreakdown as any;
        const scenes: any[] = Array.isArray(sb) ? sb : [];
        if (scenes.length > 0) {
          for (const sc of scenes) {
            if (typeof sc === 'string') {
              // 字符串数组格式（OutlineEditor 按行拆分）
              sourceNodes.push({
                projectId, outlineId, sortOrder: sortIdx++,
                title: sc.slice(0, 100), coreEvent: sc,
                sceneType: 'transition', isKeyPlot: false, aiStatus: 'manual',
              });
            } else if (sc && typeof sc === 'object') {
              // 对象数组格式（sync-chapters / 分支衍生写入）
              sourceNodes.push({
                projectId, outlineId, sortOrder: sortIdx++,
                title: sc.sceneTitle || sc.title || sc.name || plan.title,
                timeSetting: sc.timeSetting || null,
                locationDesc: sc.location || sc.locationDesc || null,
                coreEvent: sc.coreEvent || plan.intent || null,
                effectAndResult: sc.effect || sc.effectAndResult || null,
                coreBeat: sc.coreBeat || null,
                stateChange: sc.stateChange || {},
                sceneHookType: sc.hookType || sc.sceneHookType || null,
                sceneType: 'transition', isKeyPlot: false, aiStatus: 'manual',
              });
            }
          }
        } else {
          // 无场景分解：整章作为一个节点
          sourceNodes.push({
            projectId, outlineId, sortOrder: sortIdx++,
            title: plan.title, coreEvent: plan.intent || plan.title,
            coreBeat: plan.intent || null,
            sceneType: 'transition', isKeyPlot: false, aiStatus: 'manual',
            metadata: { fromChapterNo: plan.chapterNo },
          });
        }
      }
    } else {
      // 回退：卷大纲 key_events（AI生成大纲的章节列表存于此 jsonb）
      const [outline] = await creativeDb
        .select()
        .from(schema.storyOutline)
        .where(and(
          eq(schema.storyOutline.id, outlineId),
          eq(schema.storyOutline.projectId, projectId),
        ))
        .limit(1);

      const keyEvents = (outline?.keyEvents as any) || [];
      if (!Array.isArray(keyEvents) || keyEvents.length === 0) {
        return c.json({ success: false, error: '本卷暂无章节计划，也无大纲关键事件，无法导入。请先生成卷级大纲或添加章节计划。' }, 400);
      }

      sourceLabel = '大纲关键事件';
      sourceNodes = keyEvents.map((ev: any, i: number) => ({
        projectId, outlineId, sortOrder: i,
        title: ev.title || `第${ev.chapterNumber ?? i + 1}章`,
        coreEvent: ev.intent || null,
        coreBeat: ev.intent || null,
        sceneType: 'transition', isKeyPlot: false, aiStatus: 'manual',
        metadata: {
          fromKeyEvent: true,
          chapterNumber: ev.chapterNumber ?? i + 1,
          conflictType: ev.conflictType || null,
          targetEmotion: ev.targetEmotion || null,
        },
      }));
    }

    if (sourceNodes.length === 0) {
      return c.json({ success: false, error: '没有可导入的章节数据' }, 400);
    }

    // 3. replace 模式：先清空本卷已有场景节点（级联删除关联）
    if (replace) {
      await creativeDb
        .delete(schema.sceneNode)
        .where(and(
          eq(schema.sceneNode.projectId, projectId),
          eq(schema.sceneNode.outlineId, outlineId),
        ));
    } else {
      // 追加模式：sortOrder 以已有节点数量为偏移，保证递增不冲突
      const existing = await creativeDb
        .select({ id: schema.sceneNode.id })
        .from(schema.sceneNode)
        .where(and(
          eq(schema.sceneNode.projectId, projectId),
          eq(schema.sceneNode.outlineId, outlineId),
        ));
      const offset = existing.length;
      sourceNodes = sourceNodes.map((n) => ({ ...n, sortOrder: (n.sortOrder || 0) + offset }));
    }

    // 4. 批量插入
    const inserted = await creativeDb
      .insert(schema.sceneNode)
      .values(sourceNodes as any)
      .returning();

    return c.json({
      success: true,
      data: {
        imported: inserted.length,
        source: sourceLabel,
        replace,
        nodes: inserted,
      },
    }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 同步为章节计划 ============

/** POST /projects/:id/outlines/:outlineId/scenes/sync-chapters - 将场景节点同步为章节计划 */
app.post('/projects/:id/outlines/:outlineId/scenes/sync-chapters', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const outlineId = Number(c.req.param('outlineId'));
    if (isNaN(projectId) || isNaN(outlineId)) {
      return c.json({ success: false, error: '无效的参数' }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const nodeIds: number[] = body.nodeIds || [];
    const replaceExisting = body.replaceExisting === true;

    // 获取选中的节点（或全部），补上 projectId 过滤
    let nodes;
    if (nodeIds.length > 0) {
      nodes = await creativeDb
        .select()
        .from(schema.sceneNode)
        .where(and(
          eq(schema.sceneNode.projectId, projectId),
          eq(schema.sceneNode.outlineId, outlineId),
          inArray(schema.sceneNode.id, nodeIds),
        ))
        .orderBy(asc(schema.sceneNode.sortOrder));
    } else {
      nodes = await creativeDb
        .select()
        .from(schema.sceneNode)
        .where(and(
          eq(schema.sceneNode.projectId, projectId),
          eq(schema.sceneNode.outlineId, outlineId),
        ))
        .orderBy(asc(schema.sceneNode.sortOrder));
    }

    if (nodes.length === 0) {
      return c.json({ success: false, error: '没有可同步的场景节点。请先在场景脚本中"AI生成"或"新增节点"，或点击"从章节导入"。' }, 400);
    }

    // 获取卷大纲信息
    const [outline] = await creativeDb
      .select()
      .from(schema.storyOutline)
      .where(eq(schema.storyOutline.id, outlineId))
      .limit(1);

    // replaceExisting：先清空本卷已有章节计划，保证重复同步幂等
    if (replaceExisting) {
      await creativeDb
        .delete(schema.chapterPlan)
        .where(and(
          eq(schema.chapterPlan.projectId, projectId),
          eq(schema.chapterPlan.outlineId, outlineId),
        ));
    }

    // chapterNo 从本卷已有最大值接续（replaceExisting 时从1开始）
    let chapterNoBase = 0;
    if (!replaceExisting) {
      const existingPlans = await creativeDb
        .select({ chapterNo: schema.chapterPlan.chapterNo })
        .from(schema.chapterPlan)
        .where(and(
          eq(schema.chapterPlan.projectId, projectId),
          eq(schema.chapterPlan.outlineId, outlineId),
        ));
      chapterNoBase = existingPlans.reduce((m, p) => Math.max(m, p.chapterNo || 0), 0);
    }

    // 预取：项目全部章节计划 + 已选定分支选项，用于同步时自动关联分支来源
    // （让同步产出的章节计划与手动选择分支体系对齐，生成时 Writer 才能收到走向约束）
    const allPlans = await creativeDb
      .select({
        id: schema.chapterPlan.id,
        chapterNo: schema.chapterPlan.chapterNo,
        povCharacterIds: schema.chapterPlan.povCharacterIds,
        requiredEntityIds: schema.chapterPlan.requiredEntityIds,
      })
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.projectId, projectId));

    const selectedOptions = await creativeDb
      .select({
        id: schema.chapterBranchOption.id,
        sourceChapterPlanId: schema.chapterBranchOption.sourceChapterPlanId,
      })
      .from(schema.chapterBranchOption)
      .where(and(
        eq(schema.chapterBranchOption.projectId, projectId),
        eq(schema.chapterBranchOption.isSelected, true),
      ));

    // planId -> 该计划已选定的分支选项ID
    const optionByPlanId = new Map<number, number>();
    for (const opt of selectedOptions) {
      if (opt.sourceChapterPlanId != null) optionByPlanId.set(opt.sourceChapterPlanId, opt.id);
    }

    // chapterNo -> 活跃路径上的计划（即"拥有已选定分支"的那个计划）
    // 同一章号可能存在多个计划（分支平行替代），只取带已选定分支的活跃计划
    const activePlanByChapter = new Map<number, { planId: number; optionId: number; povCharacterIds: any; requiredEntityIds: any }>();
    for (const p of allPlans) {
      const optionId = optionByPlanId.get(p.id);
      if (optionId != null && p.chapterNo != null && !activePlanByChapter.has(p.chapterNo)) {
        activePlanByChapter.set(p.chapterNo, {
          planId: p.id,
          optionId,
          povCharacterIds: p.povCharacterIds,
          requiredEntityIds: p.requiredEntityIds,
        });
      }
    }

    // 为每个节点生成章节计划
    const createdPlans = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const targetChapterNo = chapterNoBase + i + 1;
      const sceneBreakdown = [{
        sceneTitle: node.title,
        timeSetting: node.timeSetting,
        location: node.locationDesc,
        coreEvent: node.coreEvent,
        effect: node.effectAndResult,
      }];

      const values: any = {
        projectId,
        outlineId,
        volumeNo: outline?.volumeNo || 1,
        chapterNo: targetChapterNo,
        title: node.title,
        intent: node.coreEvent || node.title,
        targetWordCount: 3000,
        sceneBreakdown,
        emotionTarget: null,
        conflictTarget: node.sceneType === 'key' ? 4 : 3,
        status: 'planned',
      };

      // 自动关联分支来源：若前一章存在已选定分支（活跃路径），则本章继承其走向约束与 POV 配置
      const prevActive = activePlanByChapter.get(targetChapterNo - 1);
      if (prevActive) {
        values.branchSourceOptionId = prevActive.optionId;
        values.branchParentChapterId = prevActive.planId;
        values.povCharacterIds = Array.isArray(prevActive.povCharacterIds) ? prevActive.povCharacterIds : [];
        values.requiredEntityIds = prevActive.requiredEntityIds ?? {};
      }

      const [plan] = await creativeDb
        .insert(schema.chapterPlan)
        .values(values)
        .returning();

      createdPlans.push(plan);
    }

    return c.json({ success: true, data: createdPlans }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 对话修改日志 ============

/** GET /projects/:id/outlines/:outlineId/scenes/edit-logs - 获取修改日志 */
app.get('/projects/:id/outlines/:outlineId/scenes/edit-logs', async (c) => {
  try {
    const outlineId = Number(c.req.param('outlineId'));
    if (isNaN(outlineId)) {
      return c.json({ success: false, error: '无效的参数' }, 400);
    }

    const logs = await creativeDb
      .select()
      .from(schema.sceneEditLog)
      .where(eq(schema.sceneEditLog.outlineId, outlineId))
      .orderBy(asc(schema.sceneEditLog.createdAt));

    return c.json({ success: true, data: logs });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /projects/:id/outlines/:outlineId/scenes/edit-logs/:logId/rollback - 回滚修改 */
app.post('/projects/:id/outlines/:outlineId/scenes/edit-logs/:logId/rollback', async (c) => {
  try {
    const logId = Number(c.req.param('logId'));
    if (isNaN(logId)) {
      return c.json({ success: false, error: '无效的日志ID' }, 400);
    }

    const [log] = await creativeDb
      .select()
      .from(schema.sceneEditLog)
      .where(eq(schema.sceneEditLog.id, logId))
      .limit(1);

    if (!log) {
      return c.json({ success: false, error: '日志不存在' }, 404);
    }

    if (log.applyStatus !== 'applied') {
      return c.json({ success: false, error: '只能回滚已应用的修改' }, 400);
    }

    const before: any[] = Array.isArray(log.snapshotBefore) ? log.snapshotBefore : [];
    const after: any[] = Array.isArray(log.snapshotAfter) ? log.snapshotAfter : [];
    const beforeIds = new Set(before.map((n) => n.id));
    const afterIds = new Set(after.map((n) => n.id));

    // 1. 删除"新增"的节点（在after中但不在before中）
    const addedIds = after.filter((n) => !beforeIds.has(n.id)).map((n) => n.id);
    if (addedIds.length) {
      await creativeDb
        .delete(schema.sceneNode)
        .where(inArray(schema.sceneNode.id, addedIds));
    }

    // 2. 恢复"被删除"的节点（在before中但不在after中）
    const deletedNodes = before.filter((n) => !afterIds.has(n.id));
    if (deletedNodes.length) {
      await creativeDb.insert(schema.sceneNode).values(
        deletedNodes.map((n) => ({
          id: n.id,
          projectId: log.projectId,
          outlineId: log.outlineId,
          title: n.title || '恢复场景',
          timeSetting: n.timeSetting ?? null,
          locationDesc: n.locationDesc ?? null,
          coreEvent: n.coreEvent ?? null,
          effectAndResult: n.effectAndResult ?? null,
          foreshadowingNote: n.foreshadowingNote ?? null,
          sceneType: n.sceneType || 'transition',
          isKeyPlot: !!n.isKeyPlot,
          sortOrder: n.sortOrder ?? 0,
        }))
      );
    }

    // 3. 恢复"被修改"的节点字段 + sortOrder
    for (const bNode of before) {
      if (!afterIds.has(bNode.id)) continue; // 已在上一步恢复
      const aNode = after.find((n) => n.id === bNode.id);
      if (!aNode) continue;
      const needsRestore =
        aNode.title !== bNode.title || aNode.sortOrder !== bNode.sortOrder ||
        aNode.sceneType !== bNode.sceneType || aNode.timeSetting !== bNode.timeSetting ||
        aNode.locationDesc !== bNode.locationDesc || aNode.coreEvent !== bNode.coreEvent ||
        aNode.effectAndResult !== bNode.effectAndResult || aNode.foreshadowingNote !== bNode.foreshadowingNote ||
        aNode.isKeyPlot !== bNode.isKeyPlot;
      if (needsRestore) {
        await creativeDb
          .update(schema.sceneNode)
          .set({
            title: bNode.title,
            timeSetting: bNode.timeSetting ?? null,
            locationDesc: bNode.locationDesc ?? null,
            coreEvent: bNode.coreEvent ?? null,
            effectAndResult: bNode.effectAndResult ?? null,
            foreshadowingNote: bNode.foreshadowingNote ?? null,
            sceneType: bNode.sceneType || 'transition',
            isKeyPlot: !!bNode.isKeyPlot,
            sortOrder: bNode.sortOrder ?? 0,
            updatedAt: new Date(),
          })
          .where(eq(schema.sceneNode.id, bNode.id));
      }
    }

    // 标记为已回滚
    await creativeDb
      .update(schema.sceneEditLog)
      .set({ applyStatus: 'rolled_back' })
      .where(eq(schema.sceneEditLog.id, logId));

    return c.json({ success: true, data: { message: '回滚成功，数据已恢复', restoredDeleted: deletedNodes.length, removedAdded: addedIds.length } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 一致性校验辅助 ============

/** 时段排序（同一天内的先后），用于同日时间倒退检测 */
const PHASE_RULES: [RegExp, number][] = [
  [/清晨|凌晨|破晓|黎明|天刚亮/, 1],
  [/上午|早上|早晨|辰时|巳时|朝食/, 2],
  [/午时|正午|中午|午间|日头当空/, 3],
  [/午后|下午|未时|申时|日偏西/, 4],
  [/傍晚|黄昏|日落|酉时|夕阳/, 5],
  [/深夜|夜晚|夜里|夜间|晚上|戌时|亥时|入夜|月上/, 6],
];

/** 中文/阿拉伯数字转 number（支持到九十九，足够"第N日"场景） */
function cnNum(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s === '十') return 10;
  const tenIdx = s.indexOf('十');
  if (tenIdx >= 0) {
    const tens = tenIdx === 0 ? 1 : (digits[s[tenIdx - 1]] ?? NaN);
    const ones = tenIdx === s.length - 1 ? 0 : (digits[s[tenIdx + 1]] ?? NaN);
    if (Number.isNaN(tens) || Number.isNaN(ones)) return null;
    return tens * 10 + ones;
  }
  let n = 0;
  for (const ch of s) {
    if (!(ch in digits)) return null;
    n = n * 10 + digits[ch];
  }
  return s.length ? n : null;
}

/** 解析时间描述，尽量提取"绝对日序"与"时段序"（提不到返回 null，保守不误报） */
function parseTimeSetting(text: string | null | undefined): { day: number | null; phase: number | null } {
  if (!text) return { day: null, phase: null };
  let day: number | null = null;
  const dayMatch = text.match(/第\s*([一二三四五六七八九十两零\d]+)\s*日/);
  if (dayMatch) day = cnNum(dayMatch[1]);
  let phase: number | null = null;
  for (const [re, ord] of PHASE_RULES) {
    if (re.test(text)) { phase = ord; break; }
  }
  return { day, phase };
}

/** 提取地点区域前缀（"大竹峰·山门石阶" → "大竹峰"），无明确分隔返回 null（不判断） */
function regionOf(locDesc: string | null | undefined): string | null {
  if (!locDesc) return null;
  const sep = locDesc.search(/[·・]/);
  if (sep > 0) return locDesc.slice(0, sep).trim();
  return null;
}

type IssueLevel = 'error' | 'warning' | 'info';
type IssueDimension = 'timeline' | 'location' | 'structure' | 'character' | 'combat' | '故事引擎相关性' | '场景有效性' | '节奏健康度' | '场景强度';
interface ValidateIssue {
  level: IssueLevel;
  dimension: IssueDimension;
  nodeId?: number;
  message: string;
}

/** POST /projects/:id/outlines/:outlineId/scenes/validate - 大纲一致性深度校验 */
app.post('/projects/:id/outlines/:outlineId/scenes/validate', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const outlineId = Number(c.req.param('outlineId'));
    if (isNaN(projectId) || isNaN(outlineId)) {
      return c.json({ success: false, error: '无效的参数' }, 400);
    }

    const nodes = await creativeDb
      .select()
      .from(schema.sceneNode)
      .where(and(
        eq(schema.sceneNode.projectId, projectId),
        eq(schema.sceneNode.outlineId, outlineId),
      ))
      .orderBy(asc(schema.sceneNode.sortOrder));

    if (nodes.length === 0) {
      return c.json({
        success: true,
        data: {
          valid: false, totalNodes: 0, keyPlotCount: 0, errorCount: 0, warningCount: 1,
          issues: [{ level: 'warning', dimension: 'structure', message: '暂无场景节点' }],
        },
      });
    }

    const issues: ValidateIssue[] = [];

    // ===== 维度1：时间线（硬校验）=====
    // 绝对日序倒流 = error；同日时段倒退 = warning（时段解析较模糊故降级）
    let lastDay: number | null = null;
    let lastDayTitle = '';
    let lastDayPhase: number | null = null;
    for (const node of nodes) {
      const { day, phase } = parseTimeSetting(node.timeSetting);
      if (day == null) continue;
      if (lastDay != null && day < lastDay) {
        issues.push({
          level: 'error', dimension: 'timeline', nodeId: node.id,
          message: `时间倒流：「${node.title}」发生在第${day}日，却排在第${lastDay}日的「${lastDayTitle}」之后`,
        });
      } else if (lastDay != null && day === lastDay && phase != null && lastDayPhase != null && phase < lastDayPhase) {
        issues.push({
          level: 'warning', dimension: 'timeline', nodeId: node.id,
          message: `同日时间疑似倒退：「${node.title}」与「${lastDayTitle}」同在第${day}日，但时段更靠前`,
        });
      }
      lastDay = day;
      lastDayTitle = node.title;
      lastDayPhase = phase;
    }

    // ===== 维度2：地点跳转（粗粒度告警）=====
    let lastRegion: string | null = null;
    for (const node of nodes) {
      const region = regionOf(node.locationDesc);
      if (!region) continue;
      if (lastRegion && region !== lastRegion) {
        issues.push({
          level: 'warning', dimension: 'location', nodeId: node.id,
          message: `跨区域跳转：「${node.title}」从「${lastRegion}」转到「${region}」，确认行程衔接是否有交代`,
        });
      }
      lastRegion = region;
    }

    // ===== 维度3：结构/节奏（保留原有检查）=====
    const keyNodes = nodes.filter((n) => n.sceneType === 'key' || n.isKeyPlot);
    if (keyNodes.length === 0) {
      issues.push({ level: 'warning', dimension: 'structure', message: '没有标记任何关键剧情场景，建议至少标记1个' });
    }
    const keyRatio = keyNodes.length / nodes.length;
    if (keyRatio > 0.6) {
      issues.push({ level: 'info', dimension: 'structure', message: `关键剧情占比 ${(keyRatio * 100).toFixed(0)}%，节奏可能过于紧凑` });
    }
    for (const node of nodes) {
      if (!node.coreEvent || node.coreEvent.trim().length < 5) {
        issues.push({ level: 'warning', dimension: 'structure', nodeId: node.id, message: `「${node.title}」缺少核心事件描述` });
      }
    }
    const noLocation = nodes.filter((n) => !n.locationDesc || n.locationDesc.trim() === '');
    if (noLocation.length > nodes.length * 0.5) {
      issues.push({ level: 'info', dimension: 'structure', message: `${noLocation.length}个场景缺少地点描述` });
    }
    for (let i = 1; i < nodes.length; i++) {
      if (nodes[i].sceneType === nodes[i - 1].sceneType && nodes[i].sceneType === 'transition') {
        issues.push({ level: 'info', dimension: 'structure', nodeId: nodes[i].id, message: `「${nodes[i].title}」与前一个场景同为过渡类型，考虑合并或调整` });
      }
    }
    if (nodes.length < 3) {
      issues.push({ level: 'warning', dimension: 'structure', message: '场景数量少于3个，可能不足以支撑一卷内容' });
    }
    if (nodes.length > 20) {
      issues.push({ level: 'info', dimension: 'structure', message: `场景数量较多（${nodes.length}个），确认是否需要拆分多卷` });
    }

    // ===== 维度4：人物出场（数据缺失提醒）=====
    const nodeIds = nodes.map((n) => n.id);
    const charAssoc = await creativeDb
      .select({ id: schema.sceneNodeCharacter.id })
      .from(schema.sceneNodeCharacter)
      .where(inArray(schema.sceneNodeCharacter.sceneNodeId, nodeIds))
      .limit(1);
    if (charAssoc.length === 0) {
      issues.push({
        level: 'warning', dimension: 'character',
        message: `本卷${nodes.length}个场景均未关联人物，无法校验人物出场一致性（可在场景节点添加人物关联）`,
      });
    }

    // ===== 维度5：战力（暂不支持提醒）=====
    issues.push({ level: 'info', dimension: 'combat', message: '战力一致性校验需结构化修为/妖兽等级数据，当前暂未启用' });

    // ===== 维度6：故事引擎相关性（R5，纯规则零token）=====
    try {
      const [proj] = await creativeDb
        .select({ storyEngineType: schema.creativeProject.storyEngineType })
        .from(schema.creativeProject)
        .where(eq(schema.creativeProject.id, projectId))
        .limit(1);
      if (proj?.storyEngineType) {
        const engineKeywords: Record<string, string[]> = {
          upgrade: ['突破', '晋升', '炼化', '斗法', '修炼', '进阶', '蜕变', '觉醒', '境界'],
          revenge: ['复仇', '报复', '雪恨', '清算', '追杀', '讨回', '血债'],
          mystery: ['线索', '真相', '谜', '追查', '揭露', '暗线', '悬疑', '秘密'],
          romance: ['情感', '心动', '告白', '分离', '重逢', '误会', '守护', '牵挂'],
          survival: ['逃生', '危机', '求生', '围困', '突围', '绝境', '搏命'],
          exploration: ['探索', '秘境', '遗迹', '发现', '未知', '冒险', '新大陆'],
        };
        const keywords = engineKeywords[proj.storyEngineType] || [];
        if (keywords.length) {
          let weakStreak = 0;
          let weakStart = '';
          for (const node of nodes) {
            const text = `${node.coreEvent || ''} ${node.title || ''}`;
            const related = keywords.some((kw) => text.includes(kw));
            if (!related) {
              if (weakStreak === 0) weakStart = node.title;
              weakStreak++;
            } else {
              weakStreak = 0;
            }
            if (weakStreak >= 3) {
              issues.push({
                level: 'warning', dimension: '故事引擎相关性', nodeId: node.id,
                message: `从「${weakStart}」起连续${weakStreak}个场景与故事引擎「${proj.storyEngineType}」弱相关，确认是否偏离主线`,
              });
              weakStreak = 0;
            }
          }
        }
      }
    } catch {
      // 故事引擎校验失败不阻断
    }

    // ===== 维度7：场景有效性·三有原则（R7，纯规则零token）=====
    const actionWords = ['决定', '尝试', '计划', '追求', '争取', '对抗', '挑战', '寻找', '阻止', '保护', '攻击', '逃离', '谈判', '说服', '偷', '抢', '救', '杀', '闯', '破'];
    const obstacleWords = ['但是', '然而', '却', '阻', '困', '难', '敌', '反对', '失败', '意外', '突然', '危机', '伏击', '背叛', '陷阱'];
    const changeWords = ['改变', '获得', '失去', '突破', '晋升', '死亡', '离开', '加入', '转变', '觉醒', '崩溃', '决裂', '结盟', '暴露', '真相'];
    const noChangeWords = ['结束', '继续', '如此', '罢了', '而已'];

    let noChangeStreak = 0;
    let noChangeStart = '';
    for (const node of nodes) {
      const event = node.coreEvent || '';
      const effect = node.effectAndResult || '';
      const fullText = `${event} ${effect}`;

      // 有目标：包含主动动作词
      const hasGoal = actionWords.some((w) => event.includes(w));
      if (!hasGoal && event.length > 0) {
        issues.push({
          level: 'warning', dimension: '场景有效性', nodeId: node.id,
          message: `「${node.title}」缺少明确目标：核心事件中没有主动动作，只有状态描述`,
        });
      }

      // 有阻碍：包含对抗/困难词
      const hasObstacle = obstacleWords.some((w) => fullText.includes(w));
      if (!hasObstacle && event.length > 5) {
        issues.push({
          level: 'warning', dimension: '场景有效性', nodeId: node.id,
          message: `「${node.title}」缺少阻碍：只有"发生了什么"，没有对抗/困难/意外`,
        });
      }

      // 有变化：effect_and_result 非空且包含变化词
      const hasChange = effect.trim().length > 0 && changeWords.some((w) => effect.includes(w));
      const isNoChange = !effect.trim() || noChangeWords.some((w) => effect.includes(w));
      if (isNoChange) {
        issues.push({
          level: 'warning', dimension: '场景有效性', nodeId: node.id,
          message: `「${node.title}」缺少变化：场景结束后局面/关系/信息没有明确改变`,
        });
        if (noChangeStreak === 0) noChangeStart = node.title;
        noChangeStreak++;
      } else {
        noChangeStreak = 0;
      }
      if (noChangeStreak >= 2) {
        issues.push({
          level: 'info', dimension: '场景有效性', nodeId: node.id,
          message: `从「${noChangeStart}」起连续${noChangeStreak}个场景缺少变化，可考虑合并`,
        });
        noChangeStreak = 0;
      }
    }

    // ---- 维度8: 节奏健康度（天命P0#1，纯规则零LLM） ----
    try {
      const volumeChapters = await creativeDb
        .select({
          chapterNo: schema.chapterPlan.chapterNo,
          title: schema.chapterPlan.title,
          isPeak: schema.chapterPlan.isPeak,
          chapterType: schema.chapterPlan.chapterType,
        })
        .from(schema.chapterPlan)
        .where(and(
          eq(schema.chapterPlan.projectId, projectId),
          eq(schema.chapterPlan.volumeNo, nodes[0] ? (await creativeDb.select({ volumeNo: schema.storyOutline.volumeNo }).from(schema.storyOutline).where(eq(schema.storyOutline.id, outlineId)).limit(1))[0]?.volumeNo ?? 1 : 1),
        ))
        .orderBy(asc(schema.chapterPlan.chapterNo));

      if (volumeChapters.length >= 3) {
        const rhythm = checkRhythmHealth(volumeChapters.map(ch => ({
          chapterNo: ch.chapterNo,
          isPeak: ch.isPeak ?? false,
          chapterType: ch.chapterType,
        })));
        for (const ri of rhythm.issues) {
          issues.push({ level: ri.level, dimension: '节奏健康度', message: ri.message });
        }

        // 峰值禁区：峰值章前后2章内禁止 buffer_dialog 类型（豁免：标题含"遗音/记忆残片"）
        const PEAK_SAFE_SPACING = 2;
        const peakNos = volumeChapters.filter(ch => ch.isPeak).map(ch => ch.chapterNo);
        for (const ch of volumeChapters) {
          if (ch.chapterType === 'buffer_dialog') {
            const nearPeak = peakNos.some(pn => Math.abs(ch.chapterNo - pn) <= PEAK_SAFE_SPACING && ch.chapterNo !== pn);
            const exempt = (ch.title || '').includes('遗音') || (ch.title || '').includes('记忆残片');
            if (nearPeak && !exempt) {
              issues.push({
                level: 'error',
                dimension: '节奏健康度',
                message: `峰值禁区：第${ch.chapterNo}章为「缓冲-对话」类型，但距峰值章不足${PEAK_SAFE_SPACING}章。峰值章前后${PEAK_SAFE_SPACING}章内禁止缓冲-对话（豁免：标题含"遗音/记忆残片"前缀）`,
              });
            }
          }
        }
      }
    } catch { /* 节奏校验失败不阻断 */ }

    // ---- 维度9: 场景强度（v1.4 PRD-A，纯规则零LLM，可解释评分） ----
    const intensitySummaries: Array<{ nodeId: number; title: string; score: number; level: string; breakdown: Array<{ factor: string; contribution: number }> }> = [];
    try {
      // 每个场景的人物出场数（强度因子之一）
      const charRows = nodeIds.length
        ? await creativeDb
            .select({ sceneNodeId: schema.sceneNodeCharacter.sceneNodeId })
            .from(schema.sceneNodeCharacter)
            .where(inArray(schema.sceneNodeCharacter.sceneNodeId, nodeIds))
        : [];
      const charCountMap = new Map<number, number>();
      for (const r of charRows) {
        charCountMap.set(r.sceneNodeId, (charCountMap.get(r.sceneNodeId) || 0) + 1);
      }

      const intensityEntries = nodes.map((node) => {
        const result = computeSceneIntensity({
          title: node.title,
          coreEvent: node.coreEvent,
          effectAndResult: node.effectAndResult,
          sceneType: node.sceneType,
          isKeyPlot: node.isKeyPlot,
          sceneHookType: node.sceneHookType,
          coreBeat: node.coreBeat,
          characterCount: charCountMap.get(node.id) || 0,
        });
        intensitySummaries.push({ nodeId: node.id, title: node.title, score: result.score, level: result.level, breakdown: result.breakdown });
        return { nodeId: node.id, title: node.title, result, hasHook: !!node.sceneHookType };
      });

      for (const hi of checkSceneIntensityHealth(intensityEntries)) {
        issues.push({ level: hi.level, dimension: '场景强度', nodeId: hi.nodeId, message: hi.message });
      }
    } catch { /* 强度校验失败不阻断 */ }

    // 排序：error > warning > info
    const levelRank: Record<IssueLevel, number> = { error: 0, warning: 1, info: 2 };
    issues.sort((a, b) => levelRank[a.level] - levelRank[b.level]);

    const errorCount = issues.filter((i) => i.level === 'error').length;
    const warningCount = issues.filter((i) => i.level === 'warning').length;

    return c.json({
      success: true,
      data: {
        valid: errorCount === 0,
        totalNodes: nodes.length,
        keyPlotCount: keyNodes.length,
        errorCount,
        warningCount,
        issues,
        /** 每场景强度评分明细（第9维度，可解释：含得分因子分解） */
        sceneIntensity: intensitySummaries,
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 导出 ============

/** GET /projects/:id/outlines/:outlineId/scenes/export - 导出场景大纲 */
app.get('/projects/:id/outlines/:outlineId/scenes/export', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const outlineId = Number(c.req.param('outlineId'));
    if (isNaN(projectId) || isNaN(outlineId)) {
      return c.json({ success: false, error: '无效的参数' }, 400);
    }

    const format = c.req.query('format') || 'json'; // json | markdown

    // 获取卷大纲
    const [outline] = await creativeDb
      .select()
      .from(schema.storyOutline)
      .where(eq(schema.storyOutline.id, outlineId))
      .limit(1);

    // 获取场景节点（含关联）
    const nodes = await creativeDb
      .select()
      .from(schema.sceneNode)
      .where(and(
        eq(schema.sceneNode.projectId, projectId),
        eq(schema.sceneNode.outlineId, outlineId),
      ))
      .orderBy(asc(schema.sceneNode.sortOrder));

    const nodeIds = nodes.map((n) => n.id);
    const [characters, elements] = nodeIds.length > 0 ? await Promise.all([
      creativeDb.select().from(schema.sceneNodeCharacter).where(inArray(schema.sceneNodeCharacter.sceneNodeId, nodeIds)),
      creativeDb.select().from(schema.sceneNodeElement).where(inArray(schema.sceneNodeElement.sceneNodeId, nodeIds)),
    ]) : [[], []];

    if (format === 'markdown') {
      // Markdown格式导出
      let md = `# 场景脚本：第${outline?.volumeNo || '?'}卷·${outline?.title || '未知'}\n\n`;
      md += `> ${outline?.synopsis || ''}\n\n`;
      md += `---\n\n`;

      nodes.forEach((node, i) => {
        const typeLabel = node.sceneType === 'key' ? '🔴关键' : node.sceneType === 'foreshadow' ? '🔵伏笔' : '⚪过渡';
        md += `## ${i + 1}. ${node.title} ${node.isKeyPlot ? '⭐' : ''}\n\n`;
        md += `- **类型**：${typeLabel}\n`;
        if (node.timeSetting) md += `- **时间**：${node.timeSetting}\n`;
        if (node.locationDesc) md += `- **地点**：${node.locationDesc}\n`;
        if (node.coreEvent) md += `- **核心事件**：${node.coreEvent}\n`;
        if (node.effectAndResult) md += `- **作用与结果**：${node.effectAndResult}\n`;
        if (node.foreshadowingNote) md += `- **伏笔**：${node.foreshadowingNote}\n`;

        const nodeChars = characters.filter((ch) => ch.sceneNodeId === node.id);
        if (nodeChars.length > 0) {
          md += `- **出场人物**：${nodeChars.map((ch) => ch.roleNote || `#${ch.characterId}`).join('、')}\n`;
        }
        const nodeEls = elements.filter((el) => el.sceneNodeId === node.id);
        if (nodeEls.length > 0) {
          md += `- **相关要素**：${nodeEls.map((el) => el.elementNote || el.elementType).join('、')}\n`;
        }
        md += '\n';
      });

      return c.json({ success: true, data: { format: 'markdown', content: md } });
    }

    // JSON格式导出
    const enrichedNodes = nodes.map((node) => ({
      ...node,
      characters: characters.filter((ch) => ch.sceneNodeId === node.id),
      elements: elements.filter((el) => el.sceneNodeId === node.id),
    }));

    return c.json({
      success: true,
      data: {
        format: 'json',
        content: {
          volume: { id: outline?.id, volumeNo: outline?.volumeNo, title: outline?.title, synopsis: outline?.synopsis },
          scenes: enrichedNodes,
          exportedAt: new Date().toISOString(),
        },
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ AI 场景生成 ============

/** POST /projects/:id/outlines/:outlineId/scenes/generate - AI生成场景节点 */
app.post('/projects/:id/outlines/:outlineId/scenes/generate', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const outlineId = Number(c.req.param('outlineId'));
    if (isNaN(projectId) || isNaN(outlineId)) {
      return c.json({ success: false, error: '无效的参数' }, 400);
    }

    // 获取卷大纲
    const [outline] = await creativeDb
      .select()
      .from(schema.storyOutline)
      .where(and(
        eq(schema.storyOutline.id, outlineId),
        eq(schema.storyOutline.projectId, projectId),
      ))
      .limit(1);

    if (!outline) {
      return c.json({ success: false, error: '卷大纲不存在' }, 404);
    }

    // 获取项目LLM配置
    const [project] = await creativeDb
      .select()
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, projectId))
      .limit(1);

    const body = await c.req.json().catch(() => ({}));
    const sceneCount = body.sceneCount || 8;
    const extraGuidance = body.guidance || '';

    // 构建prompt
    const systemPrompt = `你是一位专业的小说分镜策划师，擅长将卷级大纲拆解为具体的场景节点。
每个场景节点是一部小说中最小的叙事单元，包含明确的时间、地点、核心事件和叙事作用。

请根据卷大纲信息，生成${sceneCount}个左右的场景节点。

输出格式要求（严格JSON数组）：
[
  {
    "title": "场景标题（简洁有力，如：张小凡初遇碧瑶）",
    "timeSetting": "时间设定（如：三日后黄昏）",
    "locationDesc": "地点描述（如：青云门·通天峰）",
    "coreEvent": "核心事件（50-100字，描述本场景发生的关键事件）",
    "effectAndResult": "作用与结果（本场景对整体剧情的推动作用）",
    "foreshadowingNote": "伏笔关联（如有，描述埋下或回收的伏笔）",
    "sceneType": "key|transition|foreshadow（场景类型）",
    "isKeyPlot": true/false（是否为重点剧情）
  }
]

注意：
- 场景之间要有清晰的因果链和节奏感
- 关键剧情场景（key）占比约30-40%
- 过渡场景（transition）用于衔接和铺垫
- 伏笔场景（foreshadow）用于埋线或回收
- 只输出JSON数组，不要其他文字`;

    const userParts: string[] = [];
    userParts.push(`卷标题：第${outline.volumeNo}卷·${outline.title}`);
    userParts.push(`卷概要：${outline.synopsis || '（无）'}`);
    if (outline.keyEvents && Array.isArray(outline.keyEvents) && outline.keyEvents.length > 0) {
      userParts.push(`关键事件：\n${outline.keyEvents.map((e: any, i: number) => `${i + 1}. ${typeof e === 'string' ? e : e.title || JSON.stringify(e)}`).join('\n')}`);
    }
    if (outline.characterArcs && Array.isArray(outline.characterArcs) && outline.characterArcs.length > 0) {
      userParts.push(`人物弧线：\n${outline.characterArcs.map((a: any) => `- ${typeof a === 'string' ? a : JSON.stringify(a)}`).join('\n')}`);
    }

    // 已选定分支走向链：前文已通过分支选择确定的方向，场景须沿此延续
    const directionChain = await getSelectedDirectionChain(projectId).catch(() => []);
    if (directionChain.length > 0) {
      const chainLines = [...directionChain]
        .sort((a, b) => a.chapterNo - b.chapterNo)
        .map((n) => `第${n.chapterNo}章 → ${getDirection(n.mainDirection)?.name || n.mainDirection || '未分类'}${n.category ? '（' + (getCategory(n.category)?.name || n.category) + '）' : ''}`);
      userParts.push(`【已确定剧情走向 - 前文已通过分支选择确定，场景须沿此方向延续，不得矛盾或回溯】\n${chainLines.join('\n')}`);
    }

    if (extraGuidance) {
      userParts.push(`额外指导：${extraGuidance}`);
    }

    const llmConfig = project?.llmConfig as any;
    const result = await chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userParts.join('\n\n') },
      ],
      { temperature: 0.85, maxTokens: 8192, configOverride: llmConfig }
    );

    // 解析AI生成的场景
    let scenes: any[];
    try {
      const jsonMatch = result.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : result;
      scenes = JSON.parse(jsonStr.trim());
      if (!Array.isArray(scenes)) throw new Error('not array');
    } catch {
      return c.json({ success: false, error: 'AI输出解析失败，请重试', raw: result }, 500);
    }

    // 获取当前最大sortOrder
    const existingNodes = await creativeDb
      .select({ sortOrder: schema.sceneNode.sortOrder })
      .from(schema.sceneNode)
      .where(eq(schema.sceneNode.outlineId, outlineId));
    let nextOrder = existingNodes.length > 0
      ? Math.max(...existingNodes.map((n) => n.sortOrder)) + 1
      : 0;

    // 批量插入场景节点
    const createdNodes = [];
    for (const scene of scenes) {
      const [node] = await creativeDb
        .insert(schema.sceneNode)
        .values({
          projectId,
          outlineId,
          title: scene.title || '未命名场景',
          timeSetting: scene.timeSetting || null,
          locationDesc: scene.locationDesc || null,
          coreEvent: scene.coreEvent || null,
          effectAndResult: scene.effectAndResult || null,
          foreshadowingNote: scene.foreshadowingNote || null,
          sceneType: ['key', 'transition', 'foreshadow'].includes(scene.sceneType) ? scene.sceneType : 'transition',
          isKeyPlot: !!scene.isKeyPlot,
          sortOrder: nextOrder++,
          aiStatus: 'generated',
        })
        .returning();
      createdNodes.push(node);
    }

    // 记录编辑日志
    await creativeDb.insert(schema.sceneEditLog).values({
      projectId,
      outlineId,
      userInstruction: `AI生成场景（${scenes.length}个）`,
      parsedPlan: { action: 'generate', count: scenes.length },
      applyStatus: 'applied',
      operationType: 'ai_generate',
    });

    return c.json({ success: true, data: createdNodes }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: `场景生成失败: ${error.message}` }, 500);
  }
});

// ============ AI 对话修改 ============

/** POST /projects/:id/outlines/:outlineId/scenes/chat - 对话式修改场景 */
app.post('/projects/:id/outlines/:outlineId/scenes/chat', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const outlineId = Number(c.req.param('outlineId'));
    if (isNaN(projectId) || isNaN(outlineId)) {
      return c.json({ success: false, error: '无效的参数' }, 400);
    }

    const body = await c.req.json();
    const userMessage = body.message;
    if (!userMessage || typeof userMessage !== 'string') {
      return c.json({ success: false, error: '请输入修改指令' }, 400);
    }

    // 获取当前场景节点
    const currentNodes = await creativeDb
      .select()
      .from(schema.sceneNode)
      .where(and(
        eq(schema.sceneNode.projectId, projectId),
        eq(schema.sceneNode.outlineId, outlineId),
      ))
      .orderBy(asc(schema.sceneNode.sortOrder));

    // 获取项目LLM配置
    const [project] = await creativeDb
      .select()
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, projectId))
      .limit(1);

    // 构建当前场景上下文
    const sceneContext = currentNodes.map((n, i) =>
      `[${i + 1}] ID=${n.id} | ${n.title} | 类型:${n.sceneType} | ${n.coreEvent || '无描述'}`
    ).join('\n');

    const systemPrompt = `你是一位小说场景编排助手。用户会给你当前的场景节点列表和修改指令，你需要输出结构化的操作计划。

当前场景节点：
${sceneContext || '（暂无场景节点）'}

根据用户指令，输出JSON操作计划。支持的操作类型：
- add: 新增场景节点
- update: 修改现有节点
- delete: 删除节点
- reorder: 调整顺序

输出格式（严格JSON）：
{
  "summary": "对用户的回复说明（做了什么）",
  "operations": [
    {
      "type": "add",
      "position": 1,
      "data": { "title": "...", "coreEvent": "...", "sceneType": "transition", "isKeyPlot": false, "timeSetting": "", "locationDesc": "", "effectAndResult": "", "foreshadowingNote": "" }
    },
    {
      "type": "update",
      "nodeId": 123,
      "data": { "title": "新标题", "coreEvent": "新描述" }
    },
    {
      "type": "delete",
      "nodeId": 456
    },
    {
      "type": "reorder",
      "nodeIds": [3, 1, 2]
    }
  ]
}

注意：
- nodeId 必须使用实际的节点ID
- 只输出JSON，不要其他文字
- 如果用户指令不明确，在summary中说明并给出建议
- operations可以为空数组（如用户只是询问）`;

    const llmConfig = project?.llmConfig as any;
    const result = await chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      { temperature: 0.7, maxTokens: 4096, configOverride: llmConfig }
    );

    // 解析操作计划
    let plan: any;
    try {
      const jsonMatch = result.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : result;
      plan = JSON.parse(jsonStr.trim());
    } catch {
      // 解析失败时，将原始回复作为summary返回
      return c.json({ success: true, data: { summary: result, operations: [], applied: false } });
    }

    const summary = plan.summary || '操作完成';
    const operations = plan.operations || [];

    // 记录修改前快照（完整字段，供回滚恢复）
    const snapshotBefore = currentNodes.map((n) => ({
      id: n.id, title: n.title, timeSetting: n.timeSetting, locationDesc: n.locationDesc,
      coreEvent: n.coreEvent, effectAndResult: n.effectAndResult, foreshadowingNote: n.foreshadowingNote,
      sceneType: n.sceneType, isKeyPlot: n.isKeyPlot, sortOrder: n.sortOrder,
    }));

    // 执行操作
    let nextOrder = currentNodes.length > 0
      ? Math.max(...currentNodes.map((n) => n.sortOrder)) + 1
      : 0;

    for (const op of operations) {
      try {
        if (op.type === 'add' && op.data) {
          const position = op.position ?? nextOrder;
          await creativeDb.insert(schema.sceneNode).values({
            projectId,
            outlineId,
            title: op.data.title || '新场景',
            timeSetting: op.data.timeSetting || null,
            locationDesc: op.data.locationDesc || null,
            coreEvent: op.data.coreEvent || null,
            effectAndResult: op.data.effectAndResult || null,
            foreshadowingNote: op.data.foreshadowingNote || null,
            sceneType: ['key', 'transition', 'foreshadow'].includes(op.data.sceneType) ? op.data.sceneType : 'transition',
            isKeyPlot: !!op.data.isKeyPlot,
            sortOrder: position,
            aiStatus: 'ai_modified',
          });
          nextOrder++;
        } else if (op.type === 'update' && op.nodeId && op.data) {
          const updateData: Record<string, any> = { updatedAt: new Date(), aiStatus: 'ai_modified' };
          if (op.data.title !== undefined) updateData.title = op.data.title;
          if (op.data.timeSetting !== undefined) updateData.timeSetting = op.data.timeSetting;
          if (op.data.locationDesc !== undefined) updateData.locationDesc = op.data.locationDesc;
          if (op.data.coreEvent !== undefined) updateData.coreEvent = op.data.coreEvent;
          if (op.data.effectAndResult !== undefined) updateData.effectAndResult = op.data.effectAndResult;
          if (op.data.foreshadowingNote !== undefined) updateData.foreshadowingNote = op.data.foreshadowingNote;
          if (op.data.sceneType !== undefined) updateData.sceneType = op.data.sceneType;
          if (op.data.isKeyPlot !== undefined) updateData.isKeyPlot = op.data.isKeyPlot;
          await creativeDb
            .update(schema.sceneNode)
            .set(updateData)
            .where(eq(schema.sceneNode.id, op.nodeId));
        } else if (op.type === 'delete' && op.nodeId) {
          await creativeDb
            .delete(schema.sceneNode)
            .where(eq(schema.sceneNode.id, op.nodeId));
        } else if (op.type === 'reorder' && Array.isArray(op.nodeIds)) {
          for (let i = 0; i < op.nodeIds.length; i++) {
            await creativeDb
              .update(schema.sceneNode)
              .set({ sortOrder: i, updatedAt: new Date() })
              .where(eq(schema.sceneNode.id, op.nodeIds[i]));
          }
        }
      } catch (opErr: any) {
        // 单个操作失败不中断整体
        console.error(`Scene chat op failed: ${op.type}`, opErr.message);
      }
    }

    // 记录修改后快照
    const afterNodes = await creativeDb
      .select()
      .from(schema.sceneNode)
      .where(eq(schema.sceneNode.outlineId, outlineId))
      .orderBy(asc(schema.sceneNode.sortOrder));
    const snapshotAfter = afterNodes.map((n) => ({
      id: n.id, title: n.title, timeSetting: n.timeSetting, locationDesc: n.locationDesc,
      coreEvent: n.coreEvent, effectAndResult: n.effectAndResult, foreshadowingNote: n.foreshadowingNote,
      sceneType: n.sceneType, isKeyPlot: n.isKeyPlot, sortOrder: n.sortOrder,
    }));

    // 写入编辑日志
    await creativeDb.insert(schema.sceneEditLog).values({
      projectId,
      outlineId,
      userInstruction: userMessage,
      parsedPlan: plan,
      snapshotBefore,
      snapshotAfter,
      applyStatus: 'applied',
      operationType: 'ai_chat',
    });

    return c.json({ success: true, data: { summary, operations, applied: true } });
  } catch (error: any) {
    return c.json({ success: false, error: `对话修改失败: ${error.message}` }, 500);
  }
});

export default app;
