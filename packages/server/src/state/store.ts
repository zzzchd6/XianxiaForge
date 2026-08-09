/**
 * 全局状态追踪 - 数据访问层
 * 提供人物状态快照、时间线里程碑、已生成章节摘要的查询辅助函数
 */
import { eq, and, lt, desc, asc, inArray } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { getDirection } from '../services/direction-catalog.js';
import type { CharacterStateContext, TimelineMilestoneContext, BranchContext, ForeshadowContext, GrowthStageContext, ActiveTaskContext } from '../types.js';

/**
 * 获取项目下每个角色的最新生效状态快照（v1.4 第三期：修复 confirmed=0 空转）
 * 生效范围：confirmed（人工确认）+ auto_confirmed（自动抽取自动生效，用户可否决）
 * 策略：拉取全部生效快照按 chapterNo 降序，JS 端按角色去重保留最新一条
 * 角色标识优先用 characterId，缺失时退回 characterName
 */
export async function getLatestConfirmedSnapshots(
  projectId: number
): Promise<CharacterStateContext[]> {
  const rows = await creativeDb
    .select()
    .from(schema.characterStateSnapshot)
    .where(
      and(
        eq(schema.characterStateSnapshot.projectId, projectId),
        inArray(schema.characterStateSnapshot.status, ['confirmed', 'auto_confirmed'])
      )
    )
    .orderBy(desc(schema.characterStateSnapshot.chapterNo));

  const seen = new Set<string>();
  const result: CharacterStateContext[] = [];
  for (const r of rows) {
    const key = r.characterId != null ? `id:${r.characterId}` : `name:${r.characterName ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      characterId: r.characterId ?? undefined,
      characterName: r.characterName ?? undefined,
      asOfChapter: r.chapterNo,
      location: r.location ?? undefined,
      realm: r.realm ?? undefined,
      injury: r.injury ?? undefined,
      mentalState: r.mentalState ?? undefined,
      possessedItems: Array.isArray(r.possessedItems) ? (r.possessedItems as string[]) : undefined,
    });
  }
  return result;
}

/**
 * 获取项目下生效的时间线里程碑（按章节号升序，取最近 limit 条）
 * 生效范围：confirmed + auto_confirmed（自动抽取自动生效）
 * 先按 chapterNo 降序取 limit 条，再反转为升序供上下文阅读
 */
export async function getConfirmedTimeline(
  projectId: number,
  limit: number = 15
): Promise<TimelineMilestoneContext[]> {
  const rows = await creativeDb
    .select()
    .from(schema.timelineMilestone)
    .where(
      and(
        eq(schema.timelineMilestone.projectId, projectId),
        inArray(schema.timelineMilestone.status, ['confirmed', 'auto_confirmed'])
      )
    )
    .orderBy(desc(schema.timelineMilestone.chapterNo), desc(schema.timelineMilestone.sortOrder))
    .limit(limit);

  return rows
    .reverse()
    .map((r) => ({
      chapterNo: r.chapterNo,
      storyTime: r.storyTime ?? undefined,
      title: r.title,
      description: r.description ?? undefined,
      importance: r.importance ?? undefined,
    }));
}

/**
 * 获取项目下"已选定"分支选项的 ID 集合（isSelected=true）。
 * 活跃分支判定的统一入口：分支衍生计划的 branchSourceOptionId 若在此集合中，
 * 说明该计划处于当前活跃叙事路径上；否则为"已废弃分支"的衍生计划。
 */
export async function getSelectedOptionIds(projectId: number): Promise<Set<number>> {
  const rows = await creativeDb
    .select({ id: schema.chapterBranchOption.id })
    .from(schema.chapterBranchOption)
    .where(
      and(
        eq(schema.chapterBranchOption.projectId, projectId),
        eq(schema.chapterBranchOption.isSelected, true)
      )
    );
  return new Set(rows.map((r) => r.id));
}

/**
 * 判断某个章节计划是否处于活跃叙事路径上。
 * 活跃 = 主线计划（branchSourceOptionId 为空）或 已选定分支的衍生计划。
 */
function isActivePlan(
  p: { branchSourceOptionId: number | null },
  selectedOptionIds: Set<number>
): boolean {
  if (p.branchSourceOptionId == null) return true; // 主线计划
  return selectedOptionIds.has(p.branchSourceOptionId); // 已选定分支衍生计划
}

/**
 * 计算项目"活跃分支路径"上的章节号集合（时间线分支感知过滤用）
 *
 * 活跃计划定义：
 *   - 无 branchParentChapterId 的主线/初始章节，或
 *   - branchSourceOptionId 指向的分支选项当前为已选定（isSelected=true）
 * 由"已废弃分支"（选项未被选中）衍生的章节视为另一条世界线，不在活跃路径上。
 *
 * @returns activeSet 活跃章节号集合；activePath 升序数组（供前端展示）
 */
export async function getActiveBranchChapterNos(
  projectId: number
): Promise<{ activeSet: Set<number>; activePath: number[] }> {
  const plans = await creativeDb
    .select({
      chapterNo: schema.chapterPlan.chapterNo,
      branchParentChapterId: schema.chapterPlan.branchParentChapterId,
      branchSourceOptionId: schema.chapterPlan.branchSourceOptionId,
    })
    .from(schema.chapterPlan)
    .where(eq(schema.chapterPlan.projectId, projectId));

  // 已选定分支选项的 ID 集合（branchSourceOptionId 指向选项 ID，须与选项 ID 比对而非来源计划 ID）
  const selectedOptionIds = await getSelectedOptionIds(projectId);

  const activeSet = new Set<number>();
  for (const p of plans) {
    if (p.chapterNo == null) continue;
    const isMainline = p.branchParentChapterId == null;
    const isSelectedBranch = p.branchSourceOptionId != null && selectedOptionIds.has(p.branchSourceOptionId);
    if (isMainline || isSelectedBranch) activeSet.add(p.chapterNo);
  }

  const activePath = [...activeSet].sort((a, b) => a - b);
  return { activeSet, activePath };
}

/**
 * 对一组章节号，逐章号返回"活跃路径上的那个章节计划"（计划级解析）。
 *
 * 背景：选定分支后，同一章号可能并存两个计划——主线计划（已被替代）与分支衍生计划（活跃）。
 * 章号级集合（getActiveBranchChapterNos）无法区分二者；凡需要拿到"正确的那个计划"的场景
 * （如回填埋设推荐章节、展示章节标题/正文状态）必须用本函数做计划级选择。
 *
 * 选择优先级（每个章号）：
 *   1. 已选定分支的衍生计划（branchSourceOptionId ∈ selectedOptionIds）——当前活跃路径
 *   2. 主线计划（branchSourceOptionId 为空）——无分支或分支废弃时的有效路径
 *   3. 已废弃分支的衍生计划不选（视为另一条世界线）
 *
 * @returns Map<chapterNo, 活跃计划>；某章号若无活跃计划（仅废弃分支计划）则不含该键
 */
export async function getActivePlansByChapterNos(
  projectId: number,
  chapterNos: number[]
): Promise<Map<number, typeof schema.chapterPlan.$inferSelect>> {
  const result = new Map<number, typeof schema.chapterPlan.$inferSelect>();
  if (!chapterNos.length) return result;

  const plans = await creativeDb
    .select()
    .from(schema.chapterPlan)
    .where(
      and(
        eq(schema.chapterPlan.projectId, projectId),
        inArray(schema.chapterPlan.chapterNo, chapterNos)
      )
    );

  const selectedOptionIds = await getSelectedOptionIds(projectId);

  for (const p of plans) {
    if (p.chapterNo == null) continue;
    if (!isActivePlan(p, selectedOptionIds)) continue; // 跳过已废弃分支计划
    const existing = result.get(p.chapterNo);
    if (!existing) {
      result.set(p.chapterNo, p);
    } else {
      // 同章号冲突：已选定分支计划优先于主线计划（分支是主线在该章的活跃替代）
      const existingIsBranch = existing.branchSourceOptionId != null;
      const currentIsBranch = p.branchSourceOptionId != null;
      if (currentIsBranch && !existingIsBranch) result.set(p.chapterNo, p);
    }
  }
  return result;
}

/**
 * 获取本项目尚未回收的伏笔线（模块2）
 * 范围：状态为 pending(待埋入) 或 planted(已埋设) 的伏笔线
 * 排序：优先级 high>normal>low，同级按埋设章节升序（早埋的优先呼应），取最近 limit 条
 */
export async function getUnresolvedForeshadows(
  projectId: number,
  limit: number = 12
): Promise<ForeshadowContext[]> {
  const rows = await creativeDb
    .select()
    .from(schema.foreshadowThread)
    .where(
      and(
        eq(schema.foreshadowThread.projectId, projectId),
        inArray(schema.foreshadowThread.status, ['pending', 'planted']),
        // 仅注入已确认生效的伏笔；分支衍生伏笔默认未确认，确认前不影响写作上下文
        eq(schema.foreshadowThread.isConfirmed, true)
      )
    )
    .orderBy(asc(schema.foreshadowThread.plantChapter), asc(schema.foreshadowThread.id))
    .limit(limit * 3);

  // 优先级权重：high=0 normal=1 low=2，权重小者优先
  const weight = (p?: string | null) => (p === 'high' ? 0 : p === 'low' ? 2 : 1);
  return rows
    .sort((a, b) => weight(a.priority) - weight(b.priority))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description ?? undefined,
      hintClue: r.hintClue ?? undefined,
      status: r.status,
      priority: r.priority ?? undefined,
      plantChapter: r.plantChapter ?? undefined,
      resolveChapter: r.resolveChapter ?? undefined,
      tier: r.tier ?? undefined,
      dnaSubject: r.dnaSubject ?? undefined,
      dnaAction: r.dnaAction ?? undefined,
      dnaObject: r.dnaObject ?? undefined,
      dnaEmotion: r.dnaEmotion ?? undefined,
      referencedMaterialId: r.referencedMaterialId ?? undefined,
    }));
}

/**
 * 伏笔状态自动流转（模块2，零LLM确定性规则）
 * 章节正文定稿后调用，扫描本项目 pending/planted 伏笔线，依据标题/埋设线索是否出现在正文中自动推进状态：
 *  - pending（待埋入）且命中 → planted（已埋设），并记录埋设章节号为当前章
 *  - planted（已埋设）且计划回收章等于当前章且命中 → resolved（已回收）
 * 匹配保守：线索词（hintClue）优先，其次标题（长度>=2），仅在正文明确出现时触发，避免误判。
 * @returns 本次流转计数 { planted, resolved }
 */
export async function autoUpdateForeshadowFromContent(
  projectId: number,
  chapterNo: number,
  content: string
): Promise<{ planted: number; resolved: number }> {
  const result = { planted: 0, resolved: 0 };
  if (!content || content.trim().length < 2) return result;

  const rows = await creativeDb
    .select()
    .from(schema.foreshadowThread)
    .where(
      and(
        eq(schema.foreshadowThread.projectId, projectId),
        inArray(schema.foreshadowThread.status, ['pending', 'planted'])
      )
    );

  for (const r of rows) {
    const clue = (r.hintClue || '').trim();
    const title = (r.title || '').trim();
    const appears =
      (clue.length >= 2 && content.includes(clue)) ||
      (title.length >= 2 && content.includes(title));
    if (!appears) continue;

    if (r.status === 'pending') {
      await creativeDb
        .update(schema.foreshadowThread)
        .set({ status: 'planted', plantChapter: r.plantChapter ?? chapterNo, updatedAt: new Date() })
        .where(eq(schema.foreshadowThread.id, r.id));
      result.planted++;
    } else if (r.status === 'planted' && r.resolveChapter != null && r.resolveChapter === chapterNo) {
      await creativeDb
        .update(schema.foreshadowThread)
        .set({ status: 'resolved', updatedAt: new Date() })
        .where(eq(schema.foreshadowThread.id, r.id));
      result.resolved++;
    }
  }

  return result;
}

/**
 * 获取本项目进行中的任务线（素材深度融入·第2层）
 * 范围：状态为 active(待推进) 或 progressing(推进中) 且已确认生效的任务
 * 排序：优先级 high>normal>low，同级按分级 t1>t2>t3，再按开始章节升序，取最近 limit 条
 * 降级保护：任何异常均返回空数组，绝不阻断写作主流程
 */
export async function getActiveTasks(
  projectId: number,
  limit: number = 12
): Promise<ActiveTaskContext[]> {
  try {
    const rows = await creativeDb
      .select()
      .from(schema.taskArc)
      .where(
        and(
          eq(schema.taskArc.projectId, projectId),
          inArray(schema.taskArc.status, ['active', 'progressing']),
          // 仅注入已确认生效的任务；未确认任务不影响写作上下文
          eq(schema.taskArc.isConfirmed, true)
        )
      )
      .orderBy(asc(schema.taskArc.startChapter), asc(schema.taskArc.id))
      .limit(limit * 3);

    // 优先级权重：high=0 normal=1 low=2，权重小者优先
    const priorityWeight = (p?: string | null) => (p === 'high' ? 0 : p === 'low' ? 2 : 1);
    // 分级权重：t1=0 t2=1 t3=2，权重小者优先
    const tierWeight = (t?: string | null) => (t === 't1' ? 0 : t === 't2' ? 1 : 2);
    return rows
      .sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority) || tierWeight(a.tier) - tierWeight(b.tier))
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description ?? undefined,
        progressClue: r.progressClue ?? undefined,
        status: r.status,
        priority: r.priority ?? undefined,
        tier: r.tier ?? undefined,
        startChapter: r.startChapter ?? undefined,
        targetChapter: r.targetChapter ?? undefined,
        referencedMaterialIds: Array.isArray(r.referencedMaterialIds) ? (r.referencedMaterialIds as number[]) : undefined,
        relatedCharacterIds: Array.isArray(r.relatedCharacterIds) ? (r.relatedCharacterIds as number[]) : undefined,
      }));
  } catch (e: any) {
    console.warn(`[store] getActiveTasks 降级返回空数组: ${e?.message || e}`);
    return [];
  }
}

/**
 * 任务状态自动流转（素材深度融入·第2层，零LLM确定性规则）
 * 章节正文定稿后调用，扫描本项目 active/progressing 任务，依据进度线索/标题是否出现在正文中自动推进状态：
 *  - 命中且当前章已达目标章（chapterNo >= targetChapter）→ completed（已完成）
 *  - 否则 active（待推进）且命中 → progressing（推进中），并记录开始章节号为当前章
 * 匹配保守：进度线索（progressClue）优先，其次标题（长度>=2），仅在正文明确出现时触发，避免误判。
 * best-effort：任何异常静默吞掉，绝不阻断写作主流程。
 * @returns 本次流转计数 { progressing, completed }
 */
export async function autoUpdateTaskFromContent(
  projectId: number,
  chapterNo: number,
  content: string
): Promise<{ progressing: number; completed: number }> {
  const result = { progressing: 0, completed: 0 };
  try {
    if (!content || content.trim().length < 2) return result;

    const rows = await creativeDb
      .select()
      .from(schema.taskArc)
      .where(
        and(
          eq(schema.taskArc.projectId, projectId),
          inArray(schema.taskArc.status, ['active', 'progressing'])
        )
      );

    for (const r of rows) {
      const clue = (r.progressClue || '').trim();
      const title = (r.title || '').trim();
      const appears =
        (clue.length >= 2 && content.includes(clue)) ||
        (title.length >= 2 && content.includes(title));
      if (!appears) continue;

      const reachedTarget = r.targetChapter != null && chapterNo >= r.targetChapter;
      if (reachedTarget) {
        await creativeDb
          .update(schema.taskArc)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(eq(schema.taskArc.id, r.id));
        result.completed++;
      } else if (r.status === 'active') {
        await creativeDb
          .update(schema.taskArc)
          .set({ status: 'progressing', startChapter: r.startChapter ?? chapterNo, updatedAt: new Date() })
          .where(eq(schema.taskArc.id, r.id));
        result.progressing++;
      }
    }
  } catch (e: any) {
    console.warn(`[store] autoUpdateTaskFromContent 静默降级: ${e?.message || e}`);
  }

  return result;
}

/**
 * 获取本项目已生成章节的摘要（修复：原先误读诛仙源库）
 * 取 isCurrent=true 且 chapterNo < currentChapterNo 的章节，按章节号降序取 limit 条
 * 摘要 = 标题 + 章节意图 + 正文前 ~300 字
 */
export async function getGeneratedChapterSummaries(
  projectId: number,
  currentChapterNo: number,
  limit: number = 3
): Promise<string[]> {
  const rows = await creativeDb
    .select({
      chapterNo: schema.generatedChapter.chapterNo,
      title: schema.generatedChapter.title,
      content: schema.generatedChapter.content,
      intent: schema.chapterPlan.intent,
    })
    .from(schema.generatedChapter)
    .leftJoin(
      schema.chapterPlan,
      eq(schema.generatedChapter.chapterPlanId, schema.chapterPlan.id)
    )
    .where(
      and(
        eq(schema.generatedChapter.projectId, projectId),
        eq(schema.generatedChapter.isCurrent, true),
        lt(schema.generatedChapter.chapterNo, currentChapterNo)
      )
    )
    .orderBy(desc(schema.generatedChapter.chapterNo))
    .limit(limit);

  return rows
    .reverse()
    .map((r) => {
      const parts: string[] = [];
      parts.push(`第${r.chapterNo}章 ${r.title ?? ''}`);
      if (r.intent) parts.push(`意图：${r.intent}`);
      if (r.content) {
        const excerpt = r.content.replace(/\s+/g, ' ').slice(0, 300);
        parts.push(`内容：${excerpt}${r.content.length > 300 ? '…' : ''}`);
      }
      return parts.join(' | ');
    });
}

/** 待落库的人物状态（名字态，可带解析到的characterId） */
export interface PersistCharacterState {
  characterId?: number;
  characterName: string;
  location?: string;
  realm?: string;
  injury?: string;
  mentalState?: string;
  possessedItems?: string[];
}

/** 待落库的时间线里程碑 */
export interface PersistTimeline {
  storyTime?: string;
  title: string;
  description?: string;
  importance?: string;
}

/** 待落库人物关键经历（记忆卡，v1.4 第三期；名字态，ID 在落库时解析） */
export interface PersistMemory {
  characterName: string;
  eventSummary: string;
  emotionalImpact?: string;
  importance?: string;
}

/** 待落库任务（13-SRS US-21a 征途录自动数据；按标题去重，跨章同名任务仅流转状态） */
export interface PersistTask {
  title: string;
  description?: string;
  characterNames?: string[];
  taskType?: string;
  status?: string;
  priority?: string;
}

/** 抽取态任务 status → task_arc 状态机映射（pending=刚接到尚未启动→active） */
const TASK_STATUS_MAP: Record<string, string> = {
  pending: 'active',
  progressing: 'progressing',
  completed: 'completed',
  failed: 'failed',
};

/**
 * 将一次抽取结果以 auto_confirmed（自动生效，低置信，用户可否决）状态写入创作库
 * v1.4 第三期修复：旧机制写 pending 依赖人工确认，导致 confirmed=0 状态注入长期空转；
 * 现改为自动进入可用状态，用户可在时间线页否决（转 rejected）或确认为 confirmed。
 * source='auto' 表示来自LLM抽取；taskId 关联生成任务（可选）
 * 记忆卡：characterId 为 NOT NULL，仅落库能解析到 ID（诛仙库正数/自定义人物负数）的经历
 */
export async function persistExtraction(
  projectId: number,
  volumeNo: number | null,
  chapterNo: number,
  characters: PersistCharacterState[],
  timeline: PersistTimeline[],
  taskId?: number,
  memories?: PersistMemory[],
  tasks?: PersistTask[]
): Promise<{ snapshots: number; milestones: number; memoryCards: number; tasks: number }> {
  let snapshots = 0;
  let milestones = 0;
  let memoryCards = 0;
  let taskCount = 0;

  // 重复生成同一章时，先清理该章已有的 auto 旧抽取结果（pending/auto_confirmed），避免冗余累积
  // 仅清理 source='auto' 且未被人工确认/否决的；manual/confirmed/rejected 数据绝不触碰
  await creativeDb
    .delete(schema.characterStateSnapshot)
    .where(
      and(
        eq(schema.characterStateSnapshot.projectId, projectId),
        eq(schema.characterStateSnapshot.chapterNo, chapterNo),
        eq(schema.characterStateSnapshot.source, 'auto'),
        inArray(schema.characterStateSnapshot.status, ['pending', 'auto_confirmed'])
      )
    );
  await creativeDb
    .delete(schema.timelineMilestone)
    .where(
      and(
        eq(schema.timelineMilestone.projectId, projectId),
        eq(schema.timelineMilestone.chapterNo, chapterNo),
        eq(schema.timelineMilestone.source, 'auto'),
        inArray(schema.timelineMilestone.status, ['pending', 'auto_confirmed'])
      )
    );
  // 记忆卡：重复抽取同章时清理该章 auto 旧卡（enabled 视为可否决开关，人工否决的卡绝不触碰）
  await creativeDb
    .delete(schema.characterMemoryCard)
    .where(
      and(
        eq(schema.characterMemoryCard.projectId, projectId),
        eq(schema.characterMemoryCard.chapterNo, chapterNo),
        eq(schema.characterMemoryCard.source, 'auto'),
        eq(schema.characterMemoryCard.enabled, true)
      )
    );

  if (characters.length) {
    await creativeDb.insert(schema.characterStateSnapshot).values(
      characters.map((c) => ({
        projectId,
        characterId: c.characterId ?? null,
        characterName: c.characterName,
        volumeNo,
        chapterNo,
        location: c.location ?? null,
        realm: c.realm ?? null,
        injury: c.injury ?? null,
        mentalState: c.mentalState ?? null,
        possessedItems: c.possessedItems ?? [],
        status: 'auto_confirmed',
        source: 'auto',
        taskId: taskId ?? null,
      }))
    );
    snapshots = characters.length;
  }

  if (timeline.length) {
    await creativeDb.insert(schema.timelineMilestone).values(
      timeline.map((t, idx) => ({
        projectId,
        volumeNo,
        chapterNo,
        storyTime: t.storyTime ?? null,
        title: t.title,
        description: t.description ?? null,
        importance: t.importance ?? 'normal',
        status: 'auto_confirmed',
        source: 'auto',
        taskId: taskId ?? null,
        sortOrder: idx,
      }))
    );
    milestones = timeline.length;
  }

  // 记忆卡落库：名字→ID 解析（诛仙库正数 ID + 自定义人物负数 ID）
  if (memories?.length) {
    try {
      const nameToId = new Map<string, number>();
      // 自定义人物（负数约定）：按项目内名字解析
      const customs = await creativeDb
        .select({ id: schema.customCharacter.id, name: schema.customCharacter.name })
        .from(schema.customCharacter)
        .where(eq(schema.customCharacter.projectId, projectId));
      for (const cc of customs) {
        if (cc.name && !nameToId.has(cc.name)) nameToId.set(cc.name, -cc.id);
      }
      // 诛仙库人物（正数）：复用状态抽取已解析的 ID
      for (const ch of characters) {
        if (ch.characterId != null && ch.characterName && !nameToId.has(ch.characterName)) {
          nameToId.set(ch.characterName, ch.characterId);
        }
      }

      const values = memories
        .filter((m) => {
          const id = nameToId.get(m.characterName);
          return id != null && (m.eventSummary || '').trim().length > 0;
        })
        .map((m) => ({
          projectId,
          characterId: nameToId.get(m.characterName)!,
          eventSummary: m.eventSummary.trim(),
          chapterNo,
          emotionalImpact: m.emotionalImpact ?? null,
          importance: m.importance === 'high' ? 'high' : 'normal',
          source: 'auto' as const,
          enabled: true,
        }));

      if (values.length) {
        await creativeDb.insert(schema.characterMemoryCard).values(values);
        memoryCards = values.length;
      }
    } catch (e: any) {
      // 记忆卡为增量能力，异常不阻断状态/时间线落库
      console.warn(`[store] 记忆卡落库降级跳过: ${e?.message || e}`);
    }
  }

  // 任务落库（13-SRS US-21a）：按标题去重 upsert，同名任务跨章仅状态向前流转，不重复新建
  if (tasks?.length) {
    try {
      // 名字→ID 映射：自定义人物负数 + 本章状态抽取已解析的诛仙库正数 ID
      const nameToId = new Map<string, number>();
      const customs = await creativeDb
        .select({ id: schema.customCharacter.id, name: schema.customCharacter.name })
        .from(schema.customCharacter)
        .where(eq(schema.customCharacter.projectId, projectId));
      for (const cc of customs) {
        if (cc.name && !nameToId.has(cc.name)) nameToId.set(cc.name, -cc.id);
      }
      for (const ch of characters) {
        if (ch.characterId != null && ch.characterName && !nameToId.has(ch.characterName)) {
          nameToId.set(ch.characterName, ch.characterId);
        }
      }

      for (const t of tasks) {
        const title = (t.title || '').trim();
        if (!title) continue;
        const newStatus = TASK_STATUS_MAP[t.status ?? ''] ?? 'active';
        const priority = ['high', 'normal', 'low'].includes(t.priority ?? '') ? (t.priority as string) : 'normal';
        const taskType = ['main', 'side', 'hidden', 'fortune'].includes(t.taskType ?? '') ? (t.taskType as string) : null;
        const relatedIds = Array.from(new Set(
          (t.characterNames ?? []).map((n) => nameToId.get(n)).filter((id): id is number => id != null)
        ));

        const [existing] = await creativeDb
          .select()
          .from(schema.taskArc)
          .where(and(eq(schema.taskArc.projectId, projectId), eq(schema.taskArc.title, title)))
          .limit(1);

        if (existing) {
          // 状态只能向前：completed/failed 覆盖任意；progressing 仅覆盖 active；其余不回退
          let nextStatus = existing.status;
          if (newStatus === 'completed' || newStatus === 'failed') nextStatus = newStatus;
          else if (newStatus === 'progressing' && existing.status === 'active') nextStatus = 'progressing';
          const mergedIds = Array.from(new Set([
            ...((existing.relatedCharacterIds as number[]) ?? []),
            ...relatedIds,
          ]));
          await creativeDb
            .update(schema.taskArc)
            .set({ status: nextStatus, relatedCharacterIds: mergedIds, updatedAt: new Date() })
            .where(eq(schema.taskArc.id, existing.id));
        } else {
          await creativeDb.insert(schema.taskArc).values({
            projectId,
            title,
            description: (t.description || '').trim() || null,
            status: newStatus,
            priority,
            tier: taskType === 'main' ? 't1' : taskType === 'side' ? 't2' : 't3',
            taskType,
            startChapter: chapterNo,
            relatedCharacterIds: relatedIds,
            sourceType: 'auto',
            isConfirmed: true,
          });
          taskCount++;
        }
      }
    } catch (e: any) {
      // 任务为增量能力，异常不阻断状态/时间线/记忆卡落库
      console.warn(`[store] 任务落库降级跳过: ${e?.message || e}`);
    }
  }

  return { snapshots, milestones, memoryCards, tasks: taskCount };
}

/**
 * 构建剧情分支上下文（需求12）
 * 当章节计划由分支选项衍生时（branch_source_option_id 非空），加载选定的分支选项，
 * 并沿 branch_parent_chapter_id 链回溯，把历代分支选项的 impact_tags 按时间正序累积为历史栈。
 * 任一环节缺失（选项被删/非分支章节）返回 undefined，不阻断生成主流程。
 * @param branchSourceOptionId 本章计划来源的分支选项ID
 * @param branchParentChapterId 父章节计划ID（用于回溯影响标签）
 */
export async function getBranchContext(
  branchSourceOptionId: number | null | undefined,
  branchParentChapterId: number | null | undefined
): Promise<BranchContext | undefined> {
  if (!branchSourceOptionId) return undefined;

  // 加载本章来源的分支选项
  const [option] = await creativeDb
    .select()
    .from(schema.chapterBranchOption)
    .where(eq(schema.chapterBranchOption.id, branchSourceOptionId))
    .limit(1);

  if (!option) return undefined;

  // 沿父章节链回溯历代分支选项的影响标签（含当前选项），回溯深度上限 10 防环
  const tagGroups: string[][] = [];
  tagGroups.push(Array.isArray(option.impactTags) ? (option.impactTags as string[]) : []);

  let parentId = branchParentChapterId ?? null;
  let depth = 0;
  while (parentId && depth < 10) {
    const [parentPlan] = await creativeDb
      .select({
        branchSourceOptionId: schema.chapterPlan.branchSourceOptionId,
        branchParentChapterId: schema.chapterPlan.branchParentChapterId,
      })
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.id, parentId))
      .limit(1);

    if (!parentPlan?.branchSourceOptionId) break;

    const [parentOption] = await creativeDb
      .select({ impactTags: schema.chapterBranchOption.impactTags })
      .from(schema.chapterBranchOption)
      .where(eq(schema.chapterBranchOption.id, parentPlan.branchSourceOptionId))
      .limit(1);

    if (!parentOption) break;
    tagGroups.push(Array.isArray(parentOption.impactTags) ? (parentOption.impactTags as string[]) : []);

    parentId = parentPlan.branchParentChapterId ?? null;
    depth++;
  }

  // tagGroups[0]=当前选项，越往后越久远；反转为时间正序（最早在前）后展平
  tagGroups.reverse();
  const impactTagsHistory = Array.from(new Set(tagGroups.flat().filter(Boolean)));

  // 解析本章主方向（方向体系）：供 Writer 贴合方向、Auditor 审查方向匹配度
  const dirCode = (option as any).mainDirection ?? null;
  const dirDef = dirCode ? getDirection(dirCode) : null;

  return {
    selectedOptionTitle: option.optionTitle,
    selectedOptionDescription: option.optionDescription,
    nextChapterIntent: option.nextChapterIntent,
    nextSceneHint: option.nextSceneHint ?? undefined,
    impactTagsHistory,
    mainDirection: dirCode ?? undefined,
    mainDirectionName: dirDef?.name,
    mainDirectionDefinition: dirDef?.definition,
  };
}

/**
 * 获取指定章节号匹配的人物成长阶段（模块3）
 * 匹配规则：chapter_start <= chapterNo <= chapter_end（边界为NULL视为无限制）
 * 每个人物只取匹配到的最高 stage_no（同一人物多阶段重叠时取最新）
 */
export async function getGrowthStagesForChapter(
  projectId: number,
  chapterNo: number
): Promise<GrowthStageContext[]> {
  const rows = await creativeDb
    .select()
    .from(schema.characterGrowthStage)
    .where(eq(schema.characterGrowthStage.projectId, projectId))
    .orderBy(asc(schema.characterGrowthStage.characterId), desc(schema.characterGrowthStage.stageNo));

  // JS端过滤：章节号落在 [chapterStart, chapterEnd] 区间内（NULL视为无限制）
  const matched = rows.filter((r) => {
    const start = r.chapterStart ?? -Infinity;
    const end = r.chapterEnd ?? Infinity;
    return chapterNo >= start && chapterNo <= end;
  });

  // 每个人物只保留最高stageNo（已按stageNo降序，取第一条）
  const seen = new Set<string>();
  const result: GrowthStageContext[] = [];
  for (const r of matched) {
    const key = String(r.characterId ?? r.characterName ?? r.id);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      characterId: r.characterId ?? undefined,
      characterName: r.characterName ?? undefined,
      stageNo: r.stageNo,
      name: r.name,
      traits: Array.isArray(r.traits) ? (r.traits as string[]) : [],
      description: r.description ?? undefined,
      stageType: r.stageType ?? undefined,
      isKeyNode: r.isKeyNode ?? false,
    });
  }

  return result;
}

/**
 * 获取涉及指定人物的自定义关系（模块8，优先级高于原生关系）
 * 返回 is_active=true 且 charAId 或 charBId 在给定ID列表中的关系
 */
export async function getCustomRelations(
  projectId: number,
  characterIds: number[]
): Promise<{ charAId: number; charBId: number; relType: string; description?: string; interactPattern?: string }[]> {
  if (!characterIds.length) return [];

  const rows = await creativeDb
    .select()
    .from(schema.customCharacterRelation)
    .where(
      and(
        eq(schema.customCharacterRelation.projectId, projectId),
        eq(schema.customCharacterRelation.isActive, true)
      )
    );

  // JS端过滤：至少一端在出场人物中
  const idSet = new Set(characterIds);
  return rows
    .filter((r) => idSet.has(r.charAId) || idSet.has(r.charBId))
    .map((r) => ({
      charAId: r.charAId,
      charBId: r.charBId,
      relType: r.relType || '自定义关系',
      description: r.description ?? undefined,
      interactPattern: r.interactPattern ?? undefined,
    }));
}
