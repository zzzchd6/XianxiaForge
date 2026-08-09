/**
 * 旅行时间计算服务（10-山河舆图 US-4/US-5）
 *
 * 地点为节点、custom_location_link 为边的无向图，边权=对应旅行方式的分钟数。
 * 边缺失该方式时间时，按直线距离×方式速率系数估算。
 * 无任何路径时退化为直线距离估算。
 */
import { eq, and } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';

export type TravelMode = 'walk' | 'fly' | 'ship' | 'teleport';

/** 直线距离→分钟的速率系数（每坐标单位的分钟数，抽象单位） */
const DISTANCE_FACTOR: Record<TravelMode, number> = {
  walk: 1.0,
  fly: 0.1,
  ship: 0.5,
  teleport: 0.01,
};

export interface TravelEstimate {
  /** 预计分钟数 */
  minutes: number;
  /** 途经地点ID序列（含起终点） */
  path: number[];
  /** 是否无路径、纯直线估算 */
  estimated: boolean;
  /** 直线距离（坐标单位） */
  straightDistance: number;
}

/** 人类可读时间描述（约X日/约X个时辰） */
export function formatTravelTime(minutes: number): string {
  if (minutes <= 1) return '瞬间';
  if (minutes < 60) return `约${Math.round(minutes)}分钟`;
  if (minutes < 720) return `约${Math.round(minutes / 60)}个时辰`;
  return `约${Math.round(minutes / 1440)}日`;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

interface LocNode {
  id: number;
  x: number;
  y: number;
}

interface LinkEdge {
  fromId: number;
  toId: number;
  linkType: string;
  travelTimeWalk: number | null;
  travelTimeFly: number | null;
  travelTimeShip: number | null;
  travelTimeTeleport: number | null;
}

const MODE_FIELD: Record<TravelMode, keyof Pick<LinkEdge, 'travelTimeWalk' | 'travelTimeFly' | 'travelTimeShip' | 'travelTimeTeleport'>> = {
  walk: 'travelTimeWalk',
  fly: 'travelTimeFly',
  ship: 'travelTimeShip',
  teleport: 'travelTimeTeleport',
};

/**
 * 计算两地点间最短旅行时间（Dijkstra）。
 * 图范围：同一项目全部未删除地点与路径（跨地图也连通，简化处理）。
 */
export async function estimateTravel(
  projectId: number,
  fromId: number,
  toId: number,
  mode: TravelMode = 'fly'
): Promise<TravelEstimate | null> {
  const [locs, links] = await Promise.all([
    creativeDb
      .select({ id: schema.customLocation.id, x: schema.customLocation.x, y: schema.customLocation.y })
      .from(schema.customLocation)
      .where(and(eq(schema.customLocation.projectId, projectId), eq(schema.customLocation.isDeleted, false))),
    creativeDb
      .select()
      .from(schema.customLocationLink)
      .where(and(eq(schema.customLocationLink.projectId, projectId), eq(schema.customLocationLink.isDeleted, false))),
  ]);

  const fromLoc = locs.find((l) => l.id === fromId);
  const toLoc = locs.find((l) => l.id === toId);
  if (!fromLoc || !toLoc) return null;

  const straight = dist(fromLoc.x, fromLoc.y, toLoc.x, toLoc.y);

  // 邻接表
  const nodes = new Map<number, LocNode>(locs.map((l) => [l.id, l]));
  const adj = new Map<number, { to: number; weight: number }[]>();
  const push = (a: number, b: number, w: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, weight: w });
  };

  for (const raw of links) {
    const lk: LinkEdge = {
      fromId: (raw as any).fromLocationId,
      toId: (raw as any).toLocationId,
      linkType: (raw as any).linkType ?? 'path',
      travelTimeWalk: (raw as any).travelTimeWalk ?? null,
      travelTimeFly: (raw as any).travelTimeFly ?? null,
      travelTimeShip: (raw as any).travelTimeShip ?? null,
      travelTimeTeleport: (raw as any).travelTimeTeleport ?? null,
    };
    const a = nodes.get(lk.fromId);
    const b = nodes.get(lk.toId);
    if (!a || !b) continue;
    const direct = dist(a.x, a.y, b.x, b.y);
    let w: number | null = lk[MODE_FIELD[mode]];
    // 传送类型：无显式时间则按 1 分钟
    if (mode === 'teleport' && lk.linkType === 'teleport' && w == null) w = 1;
    if (w == null) {
      // 该方式未设置时间：非传送边按直线距离换算；传送边对非传送方式不可用则用飞行系数
      w = Math.max(1, Math.round(direct * (mode === 'teleport' ? DISTANCE_FACTOR.fly : DISTANCE_FACTOR[mode])));
    }
    push(lk.fromId, lk.toId, w);
    push(lk.toId, lk.fromId, w);
  }

  // Dijkstra
  const distMap = new Map<number, number>();
  const prev = new Map<number, number>();
  const visited = new Set<number>();
  distMap.set(fromId, 0);
  // 地点规模 <1000，简单 O(n^2) 足够
  for (;;) {
    let cur: number | null = null;
    let best = Infinity;
    for (const [id, d] of distMap) {
      if (!visited.has(id) && d < best) { best = d; cur = id; }
    }
    if (cur === null) break;
    if (cur === toId) break;
    visited.add(cur);
    for (const edge of adj.get(cur) || []) {
      const nd = best + edge.weight;
      if (nd < (distMap.get(edge.to) ?? Infinity)) {
        distMap.set(edge.to, nd);
        prev.set(edge.to, cur);
      }
    }
  }

  if (distMap.has(toId)) {
    // 回溯路径
    const path: number[] = [toId];
    let cur = toId;
    while (prev.has(cur)) {
      cur = prev.get(cur)!;
      path.unshift(cur);
    }
    return { minutes: distMap.get(toId)!, path, estimated: false, straightDistance: Math.round(straight) };
  }

  // 无路径：直线距离估算
  return {
    minutes: Math.max(1, Math.round(straight * DISTANCE_FACTOR[mode])),
    path: [fromId, toId],
    estimated: true,
    straightDistance: Math.round(straight),
  };
}
