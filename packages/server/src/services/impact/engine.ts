/**
 * 影响计算引擎（需求：分支影响体系 3.4）
 *
 * 纯函数、零 LLM、相同输入必有相同输出（可复现）。
 * 计算规则（PRD 3.4.1）：
 *   1. 数值运算：新值 = clamp(旧值 + 变化量, min_value, max_value)
 *   2. 继承规则：新章节完全继承上一章最新已确认快照
 *   3. 衰减规则：每章结束 值 = max(min_value, 值 - decay_per_chapter)
 *   4. 标签互斥：同互斥组仅保留优先级最高者
 *   5. 标签续期：已存在标签再次触发时，剩余时长取 max(剩余, 新时长)
 *   6. 阈值触发：数值变更后扫描阈值配置，达标且未生效则自动加标签
 *   7. 临时标签按章递减时长，归零自动移除（P1#3）
 */

/** 影响定义（impact_definition 行的计算视图） */
export interface ImpactDef {
  impactKey: string;
  name: string;
  domain: string;
  category: string;
  valueType: string; // 'numeric' | 'tag'
  minValue: number;
  maxValue: number;
  defaultValue: number;
  decayPerChapter: number;
  mutexGroup: string | null;
  priority: number;
  thresholdEvents: { threshold: number; tagKey: string; tagName: string; once?: boolean }[] | null;
  description: string | null;
}

/** 标签状态 */
export interface TagState {
  tagKey: string;
  tagName: string;
  /** 剩余章数，-1=永久 */
  remainChapters: number;
  priority: number;
  mutexGroup?: string | null;
}

/** 单条影响变更（branch_impact_link 行的计算视图） */
export interface ImpactChange {
  impactKey: string;
  changeType: 'add' | 'set' | 'add_tag' | 'remove_tag';
  changeValue?: number | null;
  tagKey?: string | null;
  tagName?: string | null;
  /** 标签持续章数，-1=永久 */
  tagDuration?: number | null;
}

/** 一个实体（人物/世界区域）的影响状态 */
export interface ImpactState {
  numericValues: Record<string, number>;
  tagStates: TagState[];
}

/** 数值截断到定义上下限 */
export function clampValue(def: ImpactDef, value: number): number {
  return Math.max(def.minValue, Math.min(def.maxValue, value));
}

/** 由定义集合构建初始状态（chapter_no=0 bootstrap 用） */
export function buildInitialState(defs: ImpactDef[]): ImpactState {
  const numericValues: Record<string, number> = {};
  for (const d of defs) {
    if (d.valueType === 'numeric') numericValues[d.impactKey] = d.defaultValue;
  }
  return { numericValues, tagStates: [] };
}

/** 深拷贝状态（避免改动入参） */
export function cloneState(state: ImpactState): ImpactState {
  return {
    numericValues: { ...state.numericValues },
    tagStates: state.tagStates.map((t) => ({ ...t })),
  };
}

/**
 * 添加标签（含互斥 + 续期规则）。
 * - 互斥：同 mutexGroup 仅保留 priority 最高者（新标签 priority 更高则替换，否则忽略）
 * - 续期：同 tagKey 已存在时，剩余时长取 max(剩余, 新时长)
 */
export function addTag(tagStates: TagState[], tag: TagState): TagState[] {
  // 续期：同 tagKey
  const existingIdx = tagStates.findIndex((t) => t.tagKey === tag.tagKey);
  if (existingIdx >= 0) {
    const existing = tagStates[existingIdx];
    const renewed = { ...existing };
    if (tag.remainChapters === -1) renewed.remainChapters = -1;
    else if (renewed.remainChapters !== -1) renewed.remainChapters = Math.max(renewed.remainChapters, tag.remainChapters);
    renewed.priority = Math.max(renewed.priority, tag.priority);
    const next = [...tagStates];
    next[existingIdx] = renewed;
    return next;
  }
  // 互斥：同 mutexGroup
  if (tag.mutexGroup) {
    const rivalIdx = tagStates.findIndex((t) => t.mutexGroup === tag.mutexGroup);
    if (rivalIdx >= 0) {
      const rival = tagStates[rivalIdx];
      if (rival.priority >= tag.priority) {
        return tagStates; // 已有更高/同优先级互斥标签，忽略新标签
      }
      // 新标签优先级更高，替换
      const next = tagStates.filter((_, i) => i !== rivalIdx);
      return [...next, tag];
    }
  }
  return [...tagStates, tag];
}

/** 移除标签（按 tagKey） */
export function removeTag(tagStates: TagState[], tagKey: string): TagState[] {
  return tagStates.filter((t) => t.tagKey !== tagKey);
}

/** 互斥组全局解析：每组仅保留 priority 最高者（防御性，处理跨变更的互斥冲突） */
export function resolveMutexTags(tagStates: TagState[]): TagState[] {
  const byGroup = new Map<string, TagState[]>();
  const noGroup: TagState[] = [];
  for (const t of tagStates) {
    if (t.mutexGroup) {
      if (!byGroup.has(t.mutexGroup)) byGroup.set(t.mutexGroup, []);
      byGroup.get(t.mutexGroup)!.push(t);
    } else {
      noGroup.push(t);
    }
  }
  const winners: TagState[] = [];
  for (const group of byGroup.values()) {
    group.sort((a, b) => b.priority - a.priority);
    winners.push(group[0]);
  }
  return [...noGroup, ...winners];
}

/** 临时标签时长递减并移除到期者（每章结束执行） */
export function tickTagDurations(tagStates: TagState[]): TagState[] {
  return tagStates
    .map((t) => (t.remainChapters === -1 ? t : { ...t, remainChapters: t.remainChapters - 1 }))
    .filter((t) => t.remainChapters === -1 || t.remainChapters > 0);
}

/** 数值衰减（每章结束执行） */
export function applyDecay(numericValues: Record<string, number>, defs: ImpactDef[]): Record<string, number> {
  const next = { ...numericValues };
  for (const d of defs) {
    if (d.valueType !== 'numeric' || d.decayPerChapter <= 0) continue;
    if (next[d.impactKey] !== undefined) {
      next[d.impactKey] = Math.max(d.minValue, next[d.impactKey] - d.decayPerChapter);
    }
  }
  return next;
}

/**
 * 阈值触发扫描：数值达标且对应标签未生效 → 自动加标签。
 * once=true 的阈值事件仅在标签不存在时触发（不重复）。
 */
export function checkThresholds(state: ImpactState, defs: ImpactDef[]): TagState[] {
  let tags = state.tagStates;
  for (const d of defs) {
    if (!d.thresholdEvents?.length) continue;
    const value = state.numericValues[d.impactKey];
    if (value === undefined) continue;
    for (const ev of d.thresholdEvents) {
      if (value < ev.threshold) continue;
      const exists = tags.some((t) => t.tagKey === ev.tagKey);
      if (exists) continue;
      tags = addTag(tags, {
        tagKey: ev.tagKey,
        tagName: ev.tagName,
        remainChapters: -1, // 阈值标签默认永久（随数值状态存在）
        priority: d.priority,
        mutexGroup: d.mutexGroup,
      });
    }
  }
  return tags;
}

/**
 * 计算下一章节某实体的影响状态（核心入口）。
 * 顺序：继承 → 数值变更(clamp) → 标签变更 → 数值衰减 → 标签时长递减 → 互斥解析 → 阈值触发 → 互斥再解析
 * @param prev 上一章已确认状态（无则传 buildInitialState 结果）
 * @param changes 本章节作用于该实体的影响变更列表（已按白名单过滤）
 * @param defs 影响定义集合
 */
export function computeNextState(prev: ImpactState, changes: ImpactChange[], defs: ImpactDef[]): ImpactState {
  const defByKey = new Map(defs.map((d) => [d.impactKey, d]));
  const state = cloneState(prev);

  // 1) 章节过渡：先对继承自上一章的状态做自然演化（标签时长递减 + 数值衰减）。
  //    必须先于本章变更执行——本章新加的标签按完整时长生效、set 的数值落在目标值，
  //    避免新变更被立即递减/衰减导致 off-by-one。
  state.tagStates = tickTagDurations(state.tagStates);
  state.numericValues = applyDecay(state.numericValues, defs);

  // 2) 数值变更（add/set，clamp 截断）+ 标签变更
  for (const ch of changes) {
    const def = defByKey.get(ch.impactKey);
    if (!def) continue; // 白名单外影响项，忽略
    if (ch.changeType === 'add' || ch.changeType === 'set') {
      const cur = state.numericValues[ch.impactKey] ?? def.defaultValue;
      const delta = Number(ch.changeValue) || 0;
      const raw = ch.changeType === 'set' ? delta : cur + delta;
      state.numericValues[ch.impactKey] = clampValue(def, raw);
    } else if (ch.changeType === 'add_tag') {
      if (!ch.tagKey) continue;
      state.tagStates = addTag(state.tagStates, {
        tagKey: ch.tagKey,
        tagName: ch.tagName ?? ch.tagKey,
        remainChapters: ch.tagDuration ?? -1,
        priority: def.priority,
        mutexGroup: def.mutexGroup,
      });
    } else if (ch.changeType === 'remove_tag') {
      if (!ch.tagKey) continue;
      state.tagStates = removeTag(state.tagStates, ch.tagKey);
    }
  }

  // 3) 互斥解析
  state.tagStates = resolveMutexTags(state.tagStates);

  // 4) 阈值触发
  state.tagStates = checkThresholds(state, defs);

  // 5) 阈值新标签可能引入互斥冲突，再解析一次
  state.tagStates = resolveMutexTags(state.tagStates);

  return state;
}

/**
 * 影响变更白名单过滤：仅保留 impactKey 存在于启用定义中的变更。
 * （PRD 2.4.1 代码侧双重保底 / 3.5 影响项白名单校验）
 */
export function filterChangesByWhitelist(changes: ImpactChange[], defs: ImpactDef[]): ImpactChange[] {
  const keys = new Set(defs.map((d) => d.impactKey));
  return changes.filter((c) => keys.has(c.impactKey));
}
