/**
 * 山河舆图 - 地点/路径路由（10-需求规格说明书 US-1/US-4/US-5）
 * 挂载前缀由 index.ts 添加：/api
 * 路径：/projects/:id/custom-locations... 与 /projects/:id/custom-location-links...
 *
 * 约定：
 * - entityStatus: official(用户创建/确认) / draft(诛仙库导入或AI提取待确认)
 * - 拖拽仅传 x/y 不触发转正；编辑弹窗保存传 confirm=true 转正；另有显式 confirm 端点
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, inArray, or } from 'drizzle-orm';
import { creativeDb, zhuxianDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import * as zhuxianSchema from '../db/zhuxian-schema.js';
import { estimateTravel, formatTravelTime, type TravelMode } from '../services/travel-time.js';
import { getOrCreateDefaultMap, edgeCoordinate, mapDangerLevel, guessLocationType } from '../services/custom-map-helpers.js';
import { exportMaps, importMaps } from '../services/module-file-io.js';
import { chatCompletion } from '../llm/client.js';

const app = new Hono();

const LOCATION_TYPES = ['sect', 'city', 'secret_realm', 'danger', 'teleport', 'battlefield', 'generic'] as const;
const DANGER_LEVELS = ['safe', 'normal', 'danger', 'deadly'] as const;
const LINK_TYPES = ['main_road', 'path', 'teleport', 'secret_path'] as const;

const createLocationSchema = z.object({
  mapId: z.number().optional(),
  name: z.string().trim().min(1).max(64),
  x: z.number(),
  y: z.number(),
  locationType: z.enum(LOCATION_TYPES).optional(),
  dangerLevel: z.enum(DANGER_LEVELS).optional(),
  description: z.string().max(5000).optional().nullable(),
  affiliatedFaction: z.string().max(64).optional().nullable(),
  parentLocationId: z.number().nullable().optional(),
  linkedMapId: z.number().nullable().optional(),
  entityStatus: z.enum(['official', 'draft']).optional(),
});

const updateLocationSchema = createLocationSchema.partial().extend({
  /** 显式转正（编辑保存时前端传 true） */
  confirm: z.boolean().optional(),
});

// ============ 地点 CRUD ============

/** GET /projects/:id/custom-locations?mapId=&entityStatus= - 地点列表 */
app.get('/projects/:id/custom-locations', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
  const mapId = Number(c.req.query('mapId'));
  const statusFilter = c.req.query('entityStatus');
  const conds = [
    eq(schema.customLocation.projectId, projectId),
    eq(schema.customLocation.isDeleted, false),
  ];
  if (!isNaN(mapId) && mapId > 0) conds.push(eq(schema.customLocation.mapId, mapId));
  if (statusFilter === 'draft' || statusFilter === 'official') {
    conds.push(eq(schema.customLocation.entityStatus, statusFilter));
  }
  const rows = await creativeDb
    .select()
    .from(schema.customLocation)
    .where(and(...conds))
    .orderBy(schema.customLocation.mapId, schema.customLocation.id);
  return c.json({ success: true, data: rows });
});

/** POST /projects/:id/custom-locations - 新建地点（mapId 缺省落默认地图） */
app.post('/projects/:id/custom-locations', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
  const parsed = createLocationSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);

  let mapId = parsed.data.mapId;
  if (!mapId) mapId = (await getOrCreateDefaultMap(projectId)).id;

  // 同地图内重名提示（PRD Q4：提示但允许）
  const [dup] = await creativeDb
    .select({ id: schema.customLocation.id })
    .from(schema.customLocation)
    .where(and(
      eq(schema.customLocation.projectId, projectId),
      eq(schema.customLocation.mapId, mapId),
      eq(schema.customLocation.name, parsed.data.name),
      eq(schema.customLocation.isDeleted, false)
    ))
    .limit(1);

  const [row] = await creativeDb
    .insert(schema.customLocation)
    .values({
      projectId,
      mapId,
      name: parsed.data.name,
      x: parsed.data.x,
      y: parsed.data.y,
      locationType: parsed.data.locationType ?? 'generic',
      dangerLevel: parsed.data.dangerLevel ?? 'normal',
      description: parsed.data.description ?? null,
      affiliatedFaction: parsed.data.affiliatedFaction ?? null,
      parentLocationId: parsed.data.parentLocationId ?? null,
      linkedMapId: parsed.data.linkedMapId ?? null,
      entityStatus: parsed.data.entityStatus ?? 'official',
    })
    .returning();
  return c.json({ success: true, data: row, duplicate: !!dup });
});

/** PUT /projects/:id/custom-locations/:locId - 更新（拖拽仅传x/y；confirm=true 转正） */
app.put('/projects/:id/custom-locations/:locId', async (c) => {
  const projectId = Number(c.req.param('id'));
  const locId = Number(c.req.param('locId'));
  if (isNaN(projectId) || isNaN(locId)) return c.json({ success: false, error: '无效的ID' }, 400);
  const parsed = updateLocationSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);

  const { confirm, ...fields } = parsed.data;
  const patch: Record<string, any> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) patch[k] = v;
  }
  if (confirm) patch.entityStatus = 'official';

  const [row] = await creativeDb
    .update(schema.customLocation)
    .set(patch)
    .where(and(eq(schema.customLocation.id, locId), eq(schema.customLocation.projectId, projectId), eq(schema.customLocation.isDeleted, false)))
    .returning();
  if (!row) return c.json({ success: false, error: '地点不存在' }, 404);
  return c.json({ success: true, data: row });
});

/** POST /projects/:id/custom-locations/:locId/confirm - 草稿转正（用户确认坐标/设定） */
app.post('/projects/:id/custom-locations/:locId/confirm', async (c) => {
  const projectId = Number(c.req.param('id'));
  const locId = Number(c.req.param('locId'));
  if (isNaN(projectId) || isNaN(locId)) return c.json({ success: false, error: '无效的ID' }, 400);
  const [row] = await creativeDb
    .update(schema.customLocation)
    .set({ entityStatus: 'official', updatedAt: new Date() })
    .where(and(eq(schema.customLocation.id, locId), eq(schema.customLocation.projectId, projectId), eq(schema.customLocation.isDeleted, false)))
    .returning();
  if (!row) return c.json({ success: false, error: '地点不存在' }, 404);
  return c.json({ success: true, data: row });
});

/** DELETE /projects/:id/custom-locations/:locId - 软删除（关联路径一并软删） */
app.delete('/projects/:id/custom-locations/:locId', async (c) => {
  const projectId = Number(c.req.param('id'));
  const locId = Number(c.req.param('locId'));
  if (isNaN(projectId) || isNaN(locId)) return c.json({ success: false, error: '无效的ID' }, 400);
  await creativeDb
    .update(schema.customLocation)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(and(eq(schema.customLocation.id, locId), eq(schema.customLocation.projectId, projectId)));
  // 关联该地点的路径一并软删
  await creativeDb
    .update(schema.customLocationLink)
    .set({ isDeleted: true })
    .where(and(
      eq(schema.customLocationLink.projectId, projectId),
      eq(schema.customLocationLink.isDeleted, false),
      or(
        eq(schema.customLocationLink.fromLocationId, locId),
        eq(schema.customLocationLink.toLocationId, locId)
      )
    ));
  // 子地点的 parentLocationId 置空
  await creativeDb
    .update(schema.customLocation)
    .set({ parentLocationId: null, updatedAt: new Date() })
    .where(and(
      eq(schema.customLocation.projectId, projectId),
      eq(schema.customLocation.parentLocationId, locId),
      eq(schema.customLocation.isDeleted, false)
    ));
  return c.json({ success: true });
});

// ============ 诛仙库导入（多选导入：候选列表 + 勾选导入） ============

/** GET /projects/:id/custom-locations/import-zhuxian/candidates - 诛仙库候选清单（含已导入标记） */
app.get('/projects/:id/custom-locations/import-zhuxian/candidates', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
  try {
    const zhuxianLocs = await zhuxianDb
      .select()
      .from(zhuxianSchema.novelLocationLib)
      .where(eq(zhuxianSchema.novelLocationLib.isDeleted, false))
      .limit(500);

    // 已导入判定：名称重复 或 metadata.zhuxianId 已存在
    const existing = await creativeDb
      .select({ name: schema.customLocation.name, metadata: schema.customLocation.metadata })
      .from(schema.customLocation)
      .where(and(eq(schema.customLocation.projectId, projectId), eq(schema.customLocation.isDeleted, false)));
    const nameSet = new Set(existing.map((r) => r.name));
    const idSet = new Set(
      existing.map((r) => (r.metadata as any)?.zhuxianId).filter((v) => typeof v === 'number')
    );

    const candidates = zhuxianLocs.map((zl) => ({
      zhuxianId: zl.id,
      name: (zl.name || '').trim(),
      level: zl.level ?? null,
      parentRegion: zl.parentRegion ?? null,
      dangerLevel: zl.dangerLevel ?? null,
      relatedFaction: zl.relatedFaction ?? null,
      environment: zl.environment ? String(zl.environment).slice(0, 120) : null,
      imported: nameSet.has((zl.name || '').trim()) || idSet.has(zl.id as number),
    }));
    return c.json({ success: true, data: candidates });
  } catch (error: any) {
    return c.json({ success: false, error: `获取候选失败: ${error.message}` }, 500);
  }
});

/** POST /projects/:id/custom-locations/import-zhuxian - 按勾选的诛仙库 ID 导入为草稿 */
app.post('/projects/:id/custom-locations/import-zhuxian', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
  const parsed = z
    .object({ zhuxianIds: z.array(z.number()).min(1).max(500), mapId: z.number().optional() })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
  try {
    const map = parsed.data.mapId
      ? (await creativeDb
          .select()
          .from(schema.customMap)
          .where(and(eq(schema.customMap.id, parsed.data.mapId), eq(schema.customMap.isDeleted, false)))).find((m) => m.projectId === projectId)
        ?? (await getOrCreateDefaultMap(projectId))
      : await getOrCreateDefaultMap(projectId);

    const zhuxianLocs = await zhuxianDb
      .select()
      .from(zhuxianSchema.novelLocationLib)
      .where(and(eq(zhuxianSchema.novelLocationLib.isDeleted, false), inArray(zhuxianSchema.novelLocationLib.id, parsed.data.zhuxianIds)));
    if (!zhuxianLocs.length) return c.json({ success: true, data: { imported: 0 } });

    const existing = await creativeDb
      .select({ name: schema.customLocation.name })
      .from(schema.customLocation)
      .where(and(eq(schema.customLocation.projectId, projectId), eq(schema.customLocation.isDeleted, false)));
    const nameSet = new Set(existing.map((r) => r.name));

    let imported = 0;
    for (const zl of zhuxianLocs) {
      const name = (zl.name || '').trim().slice(0, 64);
      if (!name || nameSet.has(name)) continue;
      nameSet.add(name);
      const pos = edgeCoordinate(imported, map);
      try {
        await creativeDb.insert(schema.customLocation).values({
          projectId,
          mapId: map.id,
          name,
          x: pos.x,
          y: pos.y,
          locationType: guessLocationType(zl as any),
          dangerLevel: mapDangerLevel(zl.dangerLevel),
          description: zl.environment ?? null,
          affiliatedFaction: zl.relatedFaction ? String(zl.relatedFaction).slice(0, 64) : null,
          entityStatus: 'draft',
          metadata: {
            zhuxianId: zl.id,
            level: zl.level ?? null,
            parentRegion: zl.parentRegion ?? null,
            keyEvents: Array.isArray(zl.keyEvents) ? zl.keyEvents.slice(0, 5) : [],
          },
        });
        imported++;
      } catch {
        // 单条失败跳过
      }
    }
    return c.json({ success: true, data: { imported, mapId: map.id } });
  } catch (error: any) {
    // 诛仙库不可达等异常降级
    return c.json({ success: false, error: `导入失败: ${error.message}` }, 500);
  }
});

// ============ 文本抽取地点（同众生百态模式：LLM 抽取候选 → 预览 → 批量落草稿） ============

/** 从 LLM 输出中稳健提取 JSON 数组（兼容 ```json 围栏与前后多余文字） */
function parseJsonArray(raw: string): any[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) throw new Error('LLM 未返回有效 JSON 数组');
  const arr = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error('LLM 返回非数组');
  return arr;
}

const extractedLocationSchema = z.object({
  name: z.string().min(1).max(64),
  locationType: z.enum(LOCATION_TYPES).optional(),
  dangerLevel: z.enum(DANGER_LEVELS).optional(),
  description: z.string().max(5000).optional(),
  affiliatedFaction: z.string().max(64).optional(),
});

/** POST /projects/:id/custom-locations/extract-from-text - 从文本抽取地点候选（不入库） */
app.post('/projects/:id/custom-locations/extract-from-text', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
  const body = z.object({ text: z.string().min(10) }).safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ success: false, error: '参数验证失败', details: body.error.issues }, 400);
  try {
    const systemPrompt = `你是一位仙侠小说世界观分析师。从用户给出的设定/章节文本中，抽取其中出现的地点/场所，输出结构化 JSON 数组。
每个元素字段：
- name: 地点名称（字符串，必填）
- locationType: 类型，只能是 sect(宗门)/city(城池)/secret_realm(秘境)/danger(险地)/teleport(传送阵)/battlefield(战场)/generic(通用) 之一，无法判断填 generic
- dangerLevel: 危险等级，只能是 safe(安全)/normal(寻常)/danger(凶险)/deadly(绝地) 之一，无法判断填 normal
- description: 一句话地点描述（50字内，含地形氛围特征）
- affiliatedFaction: 所属势力（如「青云门」，无则省略该字段）
要求：
1. 只输出 JSON 数组，不要任何解释、标题或代码围栏外的文字
2. 笼统提及但无具体名称的场景（如「路上」「屋内」）不要抽取；同一地点只出现一次
3. 严格基于文本，不要虚构文本中没有的地点`;

    const raw = await chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `文本：\n${body.data.text.slice(0, 12000)}` },
      ],
      { temperature: 0.2, maxTokens: 4096 }
    );

    const arr = parseJsonArray(raw);
    const candidates: z.infer<typeof extractedLocationSchema>[] = [];
    const seen = new Set<string>();
    for (const item of arr) {
      const p = extractedLocationSchema.safeParse(item);
      if (p.success && p.data.name.trim() && !seen.has(p.data.name.trim())) {
        seen.add(p.data.name.trim());
        candidates.push(p.data);
      }
    }
    if (candidates.length === 0) {
      return c.json({ success: false, error: '未能从文本中抽取到有效地点' }, 422);
    }
    return c.json({ success: true, data: { candidates } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /projects/:id/custom-locations/batch-create-from-candidates - 确认候选后批量落草稿 */
app.post('/projects/:id/custom-locations/batch-create-from-candidates', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
  const parsed = z
    .object({
      candidates: z.array(extractedLocationSchema).min(1).max(50),
      mapId: z.number().optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
  try {
    const map = parsed.data.mapId
      ? (await creativeDb
          .select()
          .from(schema.customMap)
          .where(and(eq(schema.customMap.id, parsed.data.mapId), eq(schema.customMap.isDeleted, false)))).find((m) => m.projectId === projectId)
        ?? (await getOrCreateDefaultMap(projectId))
      : await getOrCreateDefaultMap(projectId);

    const result = { created: 0, failed: 0, errors: [] as { name: string; error: string }[] };
    for (let i = 0; i < parsed.data.candidates.length; i++) {
      const cand = parsed.data.candidates[i];
      try {
        const pos = edgeCoordinate(i, map);
        await creativeDb.insert(schema.customLocation).values({
          projectId,
          mapId: map.id,
          name: cand.name.trim(),
          x: pos.x,
          y: pos.y,
          locationType: cand.locationType ?? 'generic',
          dangerLevel: cand.dangerLevel ?? 'normal',
          description: cand.description?.trim() || null,
          affiliatedFaction: cand.affiliatedFaction?.trim() || null,
          entityStatus: 'draft',
          metadata: { source: 'text_extract' },
        });
        result.created++;
      } catch (e: any) {
        result.failed++;
        result.errors.push({ name: cand.name, error: e.message });
      }
    }
    return c.json({ success: true, data: { ...result, mapId: map.id } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 批量删除（左侧导航一键删除） ============

/** POST /projects/:id/custom-locations/batch-delete - 批量软删（关联路径一并软删，子地点父指针置空） */
app.post('/projects/:id/custom-locations/batch-delete', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
  const parsed = z.object({ ids: z.array(z.number()).min(1).max(500) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
  const ids = parsed.data.ids;
  const res = await creativeDb
    .update(schema.customLocation)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(and(inArray(schema.customLocation.id, ids), eq(schema.customLocation.projectId, projectId)));
  // 关联路径一并软删
  await creativeDb
    .update(schema.customLocationLink)
    .set({ isDeleted: true })
    .where(and(
      eq(schema.customLocationLink.projectId, projectId),
      eq(schema.customLocationLink.isDeleted, false),
      or(
        inArray(schema.customLocationLink.fromLocationId, ids),
        inArray(schema.customLocationLink.toLocationId, ids)
      )
    ));
  // 子地点父指针置空
  await creativeDb
    .update(schema.customLocation)
    .set({ parentLocationId: null, updatedAt: new Date() })
    .where(and(
      eq(schema.customLocation.projectId, projectId),
      inArray(schema.customLocation.parentLocationId, ids),
      eq(schema.customLocation.isDeleted, false)
    ));
  return c.json({ success: true, data: { deleted: Array.isArray(res) ? res.length : ids.length } });
});

// ============ 距离估算（US-5） ============

/** GET /projects/:id/custom-locations/distance?from=&to=&mode=fly - 最短路径与旅行时间 */
app.get('/projects/:id/custom-locations/distance', async (c) => {
  const projectId = Number(c.req.param('id'));
  const from = Number(c.req.query('from'));
  const to = Number(c.req.query('to'));
  const mode = (c.req.query('mode') || 'fly') as TravelMode;
  if (isNaN(projectId) || isNaN(from) || isNaN(to)) return c.json({ success: false, error: '参数无效' }, 400);
  if (!['walk', 'fly', 'ship', 'teleport'].includes(mode)) return c.json({ success: false, error: '旅行方式无效' }, 400);

  const est = await estimateTravel(projectId, from, to, mode);
  if (!est) return c.json({ success: false, error: '地点不存在' }, 404);

  // 附带途经地点名
  const names = await creativeDb
    .select({ id: schema.customLocation.id, name: schema.customLocation.name })
    .from(schema.customLocation)
    .where(inArray(schema.customLocation.id, est.path));
  const nameMap = new Map(names.map((n) => [n.id, n.name]));

  return c.json({
    success: true,
    data: {
      ...est,
      pathNames: est.path.map((id) => nameMap.get(id) ?? `#${id}`),
      display: formatTravelTime(est.minutes),
    },
  });
});

// ============ 路径（location link）CRUD（US-4） ============

const createLinkSchema = z.object({
  fromLocationId: z.number(),
  toLocationId: z.number(),
  linkType: z.enum(LINK_TYPES).optional(),
  travelTimeWalk: z.number().int().nullable().optional(),
  travelTimeFly: z.number().int().nullable().optional(),
  travelTimeShip: z.number().int().nullable().optional(),
  travelTimeTeleport: z.number().int().nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
});

/** GET /projects/:id/custom-location-links - 项目下所有未删除路径 */
app.get('/projects/:id/custom-location-links', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
  const rows = await creativeDb
    .select()
    .from(schema.customLocationLink)
    .where(and(eq(schema.customLocationLink.projectId, projectId), eq(schema.customLocationLink.isDeleted, false)));
  return c.json({ success: true, data: rows });
});

/** POST /projects/:id/custom-location-links - 新建路径（重复边直接复用更新） */
app.post('/projects/:id/custom-location-links', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
  const parsed = createLinkSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
  const { fromLocationId, toLocationId } = parsed.data;
  if (fromLocationId === toLocationId) return c.json({ success: false, error: '起终点不能相同' }, 400);

  // 重复边（双向）→ 更新已有路径
  const dups = await creativeDb
    .select()
    .from(schema.customLocationLink)
    .where(and(
      eq(schema.customLocationLink.projectId, projectId),
      eq(schema.customLocationLink.isDeleted, false),
      or(
        and(eq(schema.customLocationLink.fromLocationId, fromLocationId), eq(schema.customLocationLink.toLocationId, toLocationId)),
        and(eq(schema.customLocationLink.fromLocationId, toLocationId), eq(schema.customLocationLink.toLocationId, fromLocationId))
      )
    ))
    .limit(1);
  const existingLink = dups[0];
  if (existingLink) {
    const [row] = await creativeDb
      .update(schema.customLocationLink)
      .set({
        linkType: parsed.data.linkType ?? existingLink.linkType as any,
        travelTimeWalk: parsed.data.travelTimeWalk ?? existingLink.travelTimeWalk,
        travelTimeFly: parsed.data.travelTimeFly ?? existingLink.travelTimeFly,
        travelTimeShip: parsed.data.travelTimeShip ?? existingLink.travelTimeShip,
        travelTimeTeleport: parsed.data.travelTimeTeleport ?? existingLink.travelTimeTeleport,
        description: parsed.data.description !== undefined ? parsed.data.description : existingLink.description,
      })
      .where(eq(schema.customLocationLink.id, existingLink.id))
      .returning();
    return c.json({ success: true, data: row });
  }

  const [row] = await creativeDb
    .insert(schema.customLocationLink)
    .values({
      projectId,
      fromLocationId,
      toLocationId,
      linkType: parsed.data.linkType ?? 'path',
      travelTimeWalk: parsed.data.travelTimeWalk ?? null,
      travelTimeFly: parsed.data.travelTimeFly ?? null,
      travelTimeShip: parsed.data.travelTimeShip ?? null,
      travelTimeTeleport: parsed.data.travelTimeTeleport ?? 0,
      description: parsed.data.description ?? null,
    })
    .returning();
  return c.json({ success: true, data: row });
});

/** DELETE /projects/:id/custom-location-links/:linkId - 软删除路径 */
app.delete('/projects/:id/custom-location-links/:linkId', async (c) => {
  const projectId = Number(c.req.param('id'));
  const linkId = Number(c.req.param('linkId'));
  if (isNaN(projectId) || isNaN(linkId)) return c.json({ success: false, error: '无效的ID' }, 400);
  await creativeDb
    .update(schema.customLocationLink)
    .set({ isDeleted: true })
    .where(and(eq(schema.customLocationLink.id, linkId), eq(schema.customLocationLink.projectId, projectId)));
  return c.json({ success: true });
});

// ============================================================
// 文件导出/导入（14-SRS US-26 山河舆图）
// ============================================================

const fileExportMapSchema = z.object({ ids: z.array(z.number()).min(1), locationIds: z.array(z.number()).optional() });

/** POST /api/projects/:id/custom-locations/export - 导出地图（含地点/路径，不含底图）为 JSON items */
app.post('/projects/:id/custom-locations/export', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const parsed = fileExportMapSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    const items = await exportMaps(projectId, parsed.data.ids, parsed.data.locationIds);
    return c.json({ success: true, data: { items } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

const fileImportMapSchema = z.object({
  items: z.array(z.any()).min(1),
  conflictStrategy: z.enum(['skip', 'overwrite', 'merge']).default('skip'),
});

/** POST /api/projects/:id/custom-locations/import-file - 从 JSON 文件导入地图（跳过/覆盖/合并） */
app.post('/projects/:id/custom-locations/import-file', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const parsed = fileImportMapSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    const result = await importMaps(projectId, parsed.data.items, parsed.data.conflictStrategy);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;

