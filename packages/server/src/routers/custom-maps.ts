/**
 * 山河舆图 - 地图CRUD路由（10-需求规格说明书 US-1/US-3）
 * 挂载前缀由 index.ts 添加：/api
 * 路径：/projects/:id/custom-maps...
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';

const app = new Hono();

const createSchema = z.object({
  name: z.string().trim().min(1).max(64),
  // nullable：前端未填描述时会传 null（创建地图时必带该字段）
  description: z.string().max(2000).nullable().optional(),
  bgImage: z.string().optional().nullable(),
  bgOpacity: z.number().min(0).max(1).optional(),
  minX: z.number().optional(),
  minY: z.number().optional(),
  maxX: z.number().optional(),
  maxY: z.number().optional(),
  parentMapId: z.number().nullable().optional(),
});

const updateSchema = createSchema.partial();

/** GET /projects/:id/custom-maps - 项目下所有未删除地图 */
app.get('/projects/:id/custom-maps', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
  const rows = await creativeDb
    .select()
    .from(schema.customMap)
    .where(and(eq(schema.customMap.projectId, projectId), eq(schema.customMap.isDeleted, false)))
    .orderBy(schema.customMap.sortOrder, schema.customMap.id);
  return c.json({ success: true, data: rows });
});

/** POST /projects/:id/custom-maps - 新建地图 */
app.post('/projects/:id/custom-maps', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
  const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
  const [row] = await creativeDb
    .insert(schema.customMap)
    .values({
      projectId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      bgImage: parsed.data.bgImage ?? null,
      bgOpacity: parsed.data.bgOpacity ?? 0.7,
      minX: parsed.data.minX ?? 0,
      minY: parsed.data.minY ?? 0,
      maxX: parsed.data.maxX ?? 2000,
      maxY: parsed.data.maxY ?? 1500,
      parentMapId: parsed.data.parentMapId ?? null,
    })
    .returning();
  return c.json({ success: true, data: row });
});

/** PUT /projects/:id/custom-maps/:mapId - 更新（含底图dataURL/透明度/坐标范围/重命名） */
app.put('/projects/:id/custom-maps/:mapId', async (c) => {
  const projectId = Number(c.req.param('id'));
  const mapId = Number(c.req.param('mapId'));
  if (isNaN(projectId) || isNaN(mapId)) return c.json({ success: false, error: '无效的ID' }, 400);
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);

  const patch: Record<string, any> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) patch[k] = v;
  }
  const [row] = await creativeDb
    .update(schema.customMap)
    .set(patch)
    .where(and(eq(schema.customMap.id, mapId), eq(schema.customMap.projectId, projectId), eq(schema.customMap.isDeleted, false)))
    .returning();
  if (!row) return c.json({ success: false, error: '地图不存在' }, 404);
  return c.json({ success: true, data: row });
});

/** DELETE /projects/:id/custom-maps/:mapId - 软删除（级联地点由前端确认后调用） */
app.delete('/projects/:id/custom-maps/:mapId', async (c) => {
  const projectId = Number(c.req.param('id'));
  const mapId = Number(c.req.param('mapId'));
  if (isNaN(projectId) || isNaN(mapId)) return c.json({ success: false, error: '无效的ID' }, 400);

  // 保底：至少留一张地图
  const remaining = await creativeDb
    .select({ id: schema.customMap.id })
    .from(schema.customMap)
    .where(and(eq(schema.customMap.projectId, projectId), eq(schema.customMap.isDeleted, false)));
  if (remaining.length <= 1) return c.json({ success: false, error: '至少保留一张地图' }, 400);

  await creativeDb
    .update(schema.customMap)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(and(eq(schema.customMap.id, mapId), eq(schema.customMap.projectId, projectId)));
  // 该地图下地点一并软删
  await creativeDb
    .update(schema.customLocation)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(and(eq(schema.customLocation.mapId, mapId), eq(schema.customLocation.projectId, projectId)));
  return c.json({ success: true });
});

export default app;

