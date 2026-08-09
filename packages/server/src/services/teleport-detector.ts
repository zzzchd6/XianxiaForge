/**
 * 防瞬移检测（10-需求规格说明书-山河舆图 US-5）
 *
 * 章节生成后：比较本章与上一章状态快照中同一人物的 location 文本，
 * 将文本按子串匹配到 custom_location，用飞行方式估算最短旅行时间；
 * 超过阈值（默认 1 日）视为"疑似瞬移"，产生提醒（best-effort，不阻断生成）。
 *
 * 若两地之间存在传送阵路径（link_type=teleport），estimateTravel 会给出
 * 很短的时间，自然不触发告警 —— 即"有传送设定就不算瞬移"。
 */
import { eq, and, desc, notInArray } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { estimateTravel, formatTravelTime } from './travel-time.js';

export interface TeleportWarningItem {
  characterName: string;
  fromLocation: string;
  toLocation: string;
  /** 飞行最短旅行时间（分钟） */
  minutes: number;
  /** 人类可读时间（如"约七日"） */
  display: string;
  /** true=无路径连通，按直线距离估算（可能是新地点未连路径） */
  estimated: boolean;
}

/** 飞行超过该分钟数视为疑似瞬移（默认 1 日） */
const THRESHOLD_MINUTES = 24 * 60;

/** 在位置文本中匹配已建档地点名（取匹配最长的，避免"青云山"误匹配"青云山脉深处"时的歧义） */
function matchLocation(
  text: string,
  locations: { id: number; name: string }[]
): { id: number; name: string } | null {
  let best: { id: number; name: string } | null = null;
  for (const loc of locations) {
    if (loc.name && text.includes(loc.name)) {
      if (!best || loc.name.length > best.name.length) best = loc;
    }
  }
  return best;
}

/**
 * 检测本章是否存在疑似瞬移。
 * 返回告警条目数组；无异常或数据不足时返回空数组。
 */
export async function detectTeleport(
  projectId: number,
  chapterNo: number
): Promise<TeleportWarningItem[]> {
  const warnings: TeleportWarningItem[] = [];

  // 1. 本章快照（排除已否决）
  const current = await creativeDb
    .select({
      characterName: schema.characterStateSnapshot.characterName,
      location: schema.characterStateSnapshot.location,
    })
    .from(schema.characterStateSnapshot)
    .where(and(
      eq(schema.characterStateSnapshot.projectId, projectId),
      eq(schema.characterStateSnapshot.chapterNo, chapterNo),
      notInArray(schema.characterStateSnapshot.status, ['rejected'])
    ));
  if (!current.length) return warnings;

  // 2. 上一章快照：仅比对连续章节（chapterNo-1），避免跨章时间跨度误报
  const [prevChapter] = await creativeDb
    .selectDistinct({ chapterNo: schema.characterStateSnapshot.chapterNo })
    .from(schema.characterStateSnapshot)
    .where(and(
      eq(schema.characterStateSnapshot.projectId, projectId),
      eq(schema.characterStateSnapshot.chapterNo, chapterNo - 1)
    ))
    .limit(1);
  if (!prevChapter) return warnings;

  const previous = await creativeDb
    .select({
      characterName: schema.characterStateSnapshot.characterName,
      location: schema.characterStateSnapshot.location,
    })
    .from(schema.characterStateSnapshot)
    .where(and(
      eq(schema.characterStateSnapshot.projectId, projectId),
      eq(schema.characterStateSnapshot.chapterNo, prevChapter.chapterNo),
      notInArray(schema.characterStateSnapshot.status, ['rejected'])
    ))
    .orderBy(desc(schema.characterStateSnapshot.id));
  if (!previous.length) return warnings;

  // 上一章每人最新一条位置
  const prevLocByName = new Map<string, string>();
  for (const p of previous) {
    if (p.characterName && p.location && !prevLocByName.has(p.characterName)) {
      prevLocByName.set(p.characterName, p.location);
    }
  }
  if (!prevLocByName.size) return warnings;

  // 3. 项目已建档地点（official + draft 都参与匹配）
  const locations = await creativeDb
    .select({ id: schema.customLocation.id, name: schema.customLocation.name })
    .from(schema.customLocation)
    .where(and(
      eq(schema.customLocation.projectId, projectId),
      eq(schema.customLocation.isDeleted, false)
    ));
  if (!locations.length) return warnings;

  // 4. 逐人物比对
  const checked = new Set<string>();
  for (const cur of current) {
    if (!cur.characterName || !cur.location || checked.has(cur.characterName)) continue;
    checked.add(cur.characterName);
    const prevLocText = prevLocByName.get(cur.characterName);
    if (!prevLocText) continue;

    const from = matchLocation(prevLocText, locations);
    const to = matchLocation(cur.location, locations);
    if (!from || !to || from.id === to.id) continue;

    const est = await estimateTravel(projectId, from.id, to.id, 'fly');
    if (!est) continue;
    if (est.minutes >= THRESHOLD_MINUTES) {
      warnings.push({
        characterName: cur.characterName,
        fromLocation: from.name,
        toLocation: to.name,
        minutes: est.minutes,
        display: formatTravelTime(est.minutes),
        estimated: est.estimated,
      });
    }
  }
  return warnings;
}
