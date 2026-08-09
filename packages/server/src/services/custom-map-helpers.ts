/**
 * 山河舆图辅助函数（10-需求规格说明书）
 * - 默认地图获取/自动创建（US-8 提取管线与诛仙库导入共用）
 * - 新地点默认坐标：地图边缘环绕分布（避免堆叠在中心）
 */
import { eq, and } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';

export type CustomMapRow = typeof schema.customMap.$inferSelect;

/** 获取项目第一张地图；不存在则自动创建「主图」 */
export async function getOrCreateDefaultMap(projectId: number): Promise<CustomMapRow> {
  const [map] = await creativeDb
    .select()
    .from(schema.customMap)
    .where(and(eq(schema.customMap.projectId, projectId), eq(schema.customMap.isDeleted, false)))
    .orderBy(schema.customMap.sortOrder, schema.customMap.id)
    .limit(1);
  if (map) return map;
  const [created] = await creativeDb
    .insert(schema.customMap)
    .values({ projectId, name: '主图', description: '系统自动创建的默认地图' })
    .returning();
  return created;
}

/**
 * 边缘环绕坐标：第 index 个新地点放在地图边缘（顺时针绕 perimeter），
 * 避免新草稿堆在地图中心遮挡已有地点。
 */
export function edgeCoordinate(
  index: number,
  map: { minX: number; minY: number; maxX: number; maxY: number }
): { x: number; y: number } {
  const pad = 90;
  const w = map.maxX - map.minX - pad * 2;
  const h = map.maxY - map.minY - pad * 2;
  const perimeter = 2 * (w + h);
  // 每个新地点错开步长，避免与上一个导入的重叠
  let d = (index * 137) % perimeter;
  const x0 = map.minX + pad;
  const y0 = map.minY + pad;
  if (d < w) return { x: Math.round(x0 + d), y: y0 };
  d -= w;
  if (d < h) return { x: map.maxX - pad, y: Math.round(y0 + d) };
  d -= h;
  if (d < w) return { x: Math.round(map.maxX - pad - d), y: map.maxY - pad };
  d -= w;
  return { x: x0, y: Math.round(map.maxY - pad - d) };
}

/** 诛仙库中文危险等级 → custom_location.danger_level 枚举（模糊匹配） */
export function mapDangerLevel(zhuxianDanger: string | null | undefined): 'safe' | 'normal' | 'danger' | 'deadly' {
  const s = (zhuxianDanger || '').trim();
  if (!s) return 'normal';
  if (/九死|绝地|禁地|死地|极凶|必死/.test(s)) return 'deadly';
  if (/凶|险|危|恶/.test(s)) return 'danger';
  if (/安|平|祥和|繁华/.test(s)) return 'safe';
  return 'normal';
}

/** 诛仙库地点类型猜测 → location_type（依据名称/层级关键词） */
export function guessLocationType(row: { name: string; level?: string | null; entityType?: string | null }): string {
  const text = `${row.name}${row.level || ''}${row.entityType || ''}`;
  if (/传送/.test(text)) return 'teleport';
  if (/秘境|洞天|福地|遗迹|古窟|秘境内部/.test(text)) return 'secret_realm';
  if (/宗|门|派|峰|观|寺|殿/.test(text)) return 'sect';
  if (/城|镇|村|坊|集市|京|州/.test(text)) return 'city';
  if (/战场|古战|废墟/.test(text)) return 'battlefield';
  if (/渊|沼|谷|岭|荒|漠|毒|魔|凶/.test(text)) return 'danger';
  return 'generic';
}
