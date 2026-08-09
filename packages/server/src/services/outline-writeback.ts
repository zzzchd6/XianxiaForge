/**
 * 卷大纲 keyEvents 反写服务
 *
 * 剧情分支选定与场景脚本编辑都会改变某一章的实际走向，本服务负责把最新走向
 * 反写回卷大纲 keyEvents 中对应章节的条目，保证【卷级大纲】始终跟随真实剧情。
 *
 * 反写策略（与用户确认）：覆盖更新 title/intent，同时把首次被覆盖前的原值备份到
 * originalTitle/originalIntent（只备份一次，保留最初的大纲原文，后续覆盖不污染备份）。
 * 按 chapterNumber 匹配条目，匹配不到则优雅跳过（不阻断主流程）。
 */
import { eq } from 'drizzle-orm';
import * as schema from '../db/creative-schema.js';

/** keyEvents 单条目的实际结构（jsonb，宽松类型） */
export interface KeyEventEntry {
  title?: string;
  intent?: string;
  chapterNumber?: number;
  conflictType?: string;
  targetEmotion?: string;
  /** 反写覆盖前的原始标题备份（仅首次覆盖时写入） */
  originalTitle?: string;
  /** 反写覆盖前的原始意图备份（仅首次覆盖时写入） */
  originalIntent?: string;
  [key: string]: unknown;
}

/**
 * 将指定章节的最新走向反写回卷大纲 keyEvents。
 *
 * @param txOrDb drizzle 实例或事务句柄（select/update 兼容即可）
 * @param outlineId 卷大纲 ID（为空则跳过）
 * @param chapterNumber 目标章节号（按此匹配 keyEvents 条目）
 * @param newTitle 新标题（覆盖条目 title）
 * @param newIntent 新意图（为空则保留条目原 intent）
 * @returns 是否成功匹配并反写了条目
 */
export async function writeBackKeyEvent(
  txOrDb: any,
  outlineId: number | null | undefined,
  chapterNumber: number | null | undefined,
  newTitle: string,
  newIntent?: string | null,
): Promise<boolean> {
  if (!outlineId || chapterNumber == null) return false;

  const [outline] = await txOrDb
    .select({ id: schema.storyOutline.id, keyEvents: schema.storyOutline.keyEvents })
    .from(schema.storyOutline)
    .where(eq(schema.storyOutline.id, outlineId))
    .limit(1);
  if (!outline) return false;

  const keyEvents: KeyEventEntry[] = Array.isArray(outline.keyEvents)
    ? (outline.keyEvents as KeyEventEntry[])
    : [];
  const entry = keyEvents.find((e) => e && e.chapterNumber === chapterNumber);
  if (!entry) return false;

  // 只备份一次最初原值，避免二次覆盖把备份污染为中间值
  if (entry.originalTitle === undefined) entry.originalTitle = entry.title;
  if (entry.originalIntent === undefined) entry.originalIntent = entry.intent;

  entry.title = newTitle;
  if (newIntent) entry.intent = newIntent;

  await txOrDb
    .update(schema.storyOutline)
    .set({ keyEvents, updatedAt: new Date() })
    .where(eq(schema.storyOutline.id, outlineId));
  return true;
}
