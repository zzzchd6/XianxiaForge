/**
 * 方向统计与校验服务（需求：剧情方向体系 2.4.3）
 *
 * 职责：
 *   - 连续方向校验：回溯已选定分支链，统计连续同方向（大类）数量，超阈值告警
 *   - 方向分布统计：按卷/全量统计各大类占比 + 均衡度评分
 *
 * 设计：DB 取数（async）与统计计算（sync 纯函数）分离，便于复用与测试。
 * 统计口径：仅统计"已选定"（isSelected=true）的分支——它们构成真实叙事路径。
 */
import { eq, and, desc } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import {
  DIRECTION_CATEGORIES,
  getDirection,
  getCategory,
  resolveEnabledCategories,
  type DirectionCategoryCode,
} from './direction-catalog.js';

/** 已选定分支链节点（按章节号倒序） */
export interface DirectionChainNode {
  chapterNo: number;
  volumeNo: number;
  mainDirection: string | null;
  category: DirectionCategoryCode | null;
}

/**
 * 拉取项目已选定分支的方向链（按章节号倒序）。
 * 每个已选定分支对应一章的真实走向。
 */
export async function getSelectedDirectionChain(projectId: number): Promise<DirectionChainNode[]> {
  const rows = await creativeDb
    .select({
      chapterNo: schema.chapterPlan.chapterNo,
      volumeNo: schema.chapterPlan.volumeNo,
      mainDirection: schema.chapterBranchOption.mainDirection,
    })
    .from(schema.chapterBranchOption)
    .innerJoin(schema.chapterPlan, eq(schema.chapterBranchOption.sourceChapterPlanId, schema.chapterPlan.id))
    .where(and(
      eq(schema.chapterBranchOption.projectId, projectId),
      eq(schema.chapterBranchOption.isSelected, true),
    ))
    .orderBy(desc(schema.chapterPlan.chapterNo));

  return rows.map((r) => {
    const dir = r.mainDirection ? getDirection(r.mainDirection) : undefined;
    return {
      chapterNo: r.chapterNo,
      volumeNo: r.volumeNo,
      mainDirection: r.mainDirection,
      category: (dir?.category ?? null) as DirectionCategoryCode | null,
    };
  });
}

/** 方向分布统计结果 */
export interface DirectionStats {
  /** 参与统计的已选定分支总数 */
  total: number;
  /** 未分类（mainDirection 为空）数量 */
  unclassified: number;
  /** 按大类的分布 */
  byCategory: { code: string; name: string; count: number; percent: number }[];
  /** 按细分方向的分布 */
  byDirection: { code: string; name: string; category: string; count: number }[];
  /** 均衡度评分 0-100（与启用大类均匀分布的偏离度），无数据时为 null */
  balanceScore: number | null;
}

/**
 * 计算方向分布统计（纯函数）。
 * @param chain 已选定分支方向链
 * @param opts.volumeNo 仅统计指定卷（缺省=全量）
 * @param opts.enabledCategories 项目启用的大类编码（用于均衡度计算，缺省=默认前6大类）
 */
export function computeDirectionStats(
  chain: DirectionChainNode[],
  opts?: { volumeNo?: number; enabledCategories?: string[] }
): DirectionStats {
  const nodes = opts?.volumeNo != null ? chain.filter((n) => n.volumeNo === opts.volumeNo) : chain;
  const total = nodes.length;
  const unclassified = nodes.filter((n) => !n.category).length;

  const catCount = new Map<string, number>();
  const dirCount = new Map<string, number>();
  for (const n of nodes) {
    if (!n.category) continue;
    catCount.set(n.category, (catCount.get(n.category) ?? 0) + 1);
    if (n.mainDirection) dirCount.set(n.mainDirection, (dirCount.get(n.mainDirection) ?? 0) + 1);
  }

  const classified = total - unclassified;
  const byCategory = DIRECTION_CATEGORIES
    .filter((c) => catCount.has(c.code))
    .map((c) => {
      const count = catCount.get(c.code) ?? 0;
      return { code: c.code, name: c.name, count, percent: classified ? Math.round((count / classified) * 1000) / 10 : 0 };
    })
    .sort((a, b) => b.count - a.count);

  const byDirection = [...dirCount.entries()]
    .map(([code, count]) => {
      const def = getDirection(code);
      return { code, name: def?.name ?? code, category: def?.category ?? '', count };
    })
    .sort((a, b) => b.count - a.count);

  // 均衡度：与启用大类均匀分布的总变异距离 → 0-100 分
  let balanceScore: number | null = null;
  if (classified > 0) {
    const enabled = [...resolveEnabledCategories(opts?.enabledCategories)];
    const ideal = 1 / enabled.length;
    let dev = 0;
    // 启用大类：|实际占比 - 理想占比|
    for (const code of enabled) {
      const actual = (catCount.get(code) ?? 0) / classified;
      dev += Math.abs(actual - ideal);
    }
    // 出现但不在启用列表的大类：理想占比为0
    for (const [code, count] of catCount) {
      if (!enabled.includes(code)) dev += count / classified;
    }
    balanceScore = Math.max(0, Math.min(100, Math.round(100 * (1 - dev / 2))));
  }

  return { total, unclassified, byCategory, byDirection, balanceScore };
}

/** 连续方向校验结果 */
export interface ConsecutiveCheck {
  /** 校验的锚点章节号 */
  chapterNo: number;
  /** 锚点章的大类编码（无则为 null） */
  category: string | null;
  categoryName: string | null;
  /** 以锚点章结尾、连续同大类的章节数（含锚点章） */
  consecutiveCount: number;
  /** 允许的上限（来自配置 maxConsecutiveSameDirection） */
  maxAllowed: number;
  /** 是否达到/超过上限（需要提示） */
  warning: boolean;
}

/**
 * 连续方向校验（纯函数）：从锚点章节向前回溯，统计连续同大类数量。
 * @param chain 已选定分支方向链（倒序，getSelectedDirectionChain 的返回值）
 * @param chapterNo 锚点章节号（通常为当前/下一章）
 * @param maxAllowed 连续同方向上限（配置，默认3）
 */
export function checkConsecutiveDirection(
  chain: DirectionChainNode[],
  chapterNo: number,
  maxAllowed = 3
): ConsecutiveCheck {
  // 仅取 <= chapterNo 的章节（倒序排列）
  const path = chain.filter((n) => n.chapterNo <= chapterNo);
  const anchor = path[0];
  if (!anchor || !anchor.category) {
    return { chapterNo, category: null, categoryName: null, consecutiveCount: 0, maxAllowed, warning: false };
  }
  let count = 0;
  for (const n of path) {
    if (n.category === anchor.category) count++;
    else break;
  }
  return {
    chapterNo,
    category: anchor.category,
    categoryName: getCategory(anchor.category)?.name ?? null,
    consecutiveCount: count,
    maxAllowed,
    warning: count >= maxAllowed,
  };
}
