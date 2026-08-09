/**
 * 冲突值量化算法（天命系统移植）
 * 公式：冲突值 = 基础分(1) + Σ(权重 × 触发次数)
 * 评级：★~★★★★★（≥16=5星峰值，≥12=4星峰值，≥8=3星，≥5=2星，其余1星）
 */

export interface ConflictFactor {
  key: string;
  name: string;
  weight: number;
  perUnit?: boolean; // true=按数量累加，false=0/1触发
}

export const CONFLICT_FACTORS: ConflictFactor[] = [
  { key: 'core_character_state_change', name: '核心角色状态根本性改变', weight: 8 },
  { key: 'tier1_foreshadow', name: 'Tier-1战略级伏笔回收/埋设', weight: 8 },
  { key: 'tier2_foreshadow', name: 'Tier-2战役级伏笔回收/埋设', weight: 5 },
  { key: 'singularity_event', name: '奇点事件发生', weight: 5 },
  { key: 'core_character_count', name: '核心角色参与', weight: 2, perUnit: true },
  { key: 'important_entity_change', name: '重要实体状态改变', weight: 3 },
];

export const BASE_SCORE = 1;

export interface ConflictRating {
  stars: string;
  label: string;
  threshold: number;
  isPeak: boolean;
}

export const CONFLICT_RATINGS: ConflictRating[] = [
  { stars: '★★★★★', label: '核心峰值', threshold: 16, isPeak: true },
  { stars: '★★★★☆', label: '重要冲突', threshold: 12, isPeak: true },
  { stars: '★★★☆☆', label: '中度冲突', threshold: 8, isPeak: false },
  { stars: '★★☆☆☆', label: '次要冲突', threshold: 5, isPeak: false },
  { stars: '★☆☆☆☆', label: '低冲突', threshold: 0, isPeak: false },
];

export interface ConflictScoreResult {
  score: number;
  rating: ConflictRating;
  breakdown: Array<{ factor: string; count: number; contribution: number }>;
}

/** 计算冲突值 */
export function computeConflictScore(triggers: Record<string, number>): ConflictScoreResult {
  let score = BASE_SCORE;
  const breakdown: ConflictScoreResult['breakdown'] = [];

  for (const f of CONFLICT_FACTORS) {
    const count = Math.max(0, Math.floor(triggers[f.key] || 0));
    const contribution = f.weight * count;
    if (contribution > 0) {
      breakdown.push({ factor: f.name, count, contribution });
    }
    score += contribution;
  }

  const rating = scoreToRating(score);
  return { score, rating, breakdown };
}

/** 分值→评级映射 */
export function scoreToRating(score: number): ConflictRating {
  for (const r of CONFLICT_RATINGS) {
    if (score >= r.threshold) return r;
  }
  return CONFLICT_RATINGS[CONFLICT_RATINGS.length - 1];
}

// ============================================================
// 场景强度评分（v1.4 PRD-A：第9个校验维度，纯规则零LLM，自含计算逻辑）
// 公式：强度分 = 基础分(1) + Σ(因子命中贡献)，评级：高/中/低三档
// ============================================================

export interface SceneIntensityFactor {
  key: string;
  name: string;
  weight: number;
  perUnit?: boolean; // true=按数量累加（有上限），false=0/1触发
  maxUnits?: number;
}

export const SCENE_INTENSITY_FACTORS: SceneIntensityFactor[] = [
  { key: 'irreversible_event', name: '不可逆事件（死亡/毁灭/决裂/逐出）', weight: 4 },
  { key: 'character_state_change', name: '人物根本性状态改变（突破/黑化/觉醒/背叛）', weight: 4 },
  { key: 'combat_conflict', name: '战斗/对抗/危机冲突', weight: 3 },
  { key: 'key_scene', name: '关键剧情场景（key类型或重点标记）', weight: 2 },
  { key: 'foreshadow_payoff', name: '伏笔回收/真相揭露', weight: 2 },
  { key: 'effect_change', name: '结果面明确变化（得失/阵营/暴露）', weight: 1 },
  { key: 'character_count', name: '核心人物出场规模', weight: 1, perUnit: true, maxUnits: 3 },
];

const INTENSITY_IRREVERSIBLE_WORDS = ['死亡', '身死', '陨落', '殒命', '覆灭', '毁灭', '崩塌', '决裂', '逐出', '除名', '废黜', '血祭', '献祭', '灭门'];
const INTENSITY_STATE_CHANGE_WORDS = ['突破', '觉醒', '黑化', '背叛', '叛出', '顿悟', '废掉', '废去修为', '夺舍', '重生', '身份暴露', '真相大白'];
const INTENSITY_COMBAT_WORDS = ['战斗', '斗法', '激战', '厮杀', '对决', '围攻', '追杀', '伏击', '危机', '绝境', '生死', '搏命', '决战', '血战', '出手', '交锋'];
const INTENSITY_PAYOFF_WORDS = ['回收', '揭晓', '揭开', '真相', '谜底', '秘密曝光', '身世之谜', '伏笔'];
const INTENSITY_EFFECT_CHANGE_WORDS = ['改变', '获得', '失去', '转变', '倒向', '暴露', '结盟', '决裂', '易主', '逆转'];

export type SceneIntensityLevel = 'high' | 'medium' | 'low';

export interface SceneIntensityInput {
  title?: string | null;
  coreEvent?: string | null;
  effectAndResult?: string | null;
  sceneType?: string | null;
  isKeyPlot?: boolean | null;
  sceneHookType?: string | null;
  coreBeat?: string | null;
  characterCount?: number;
}

export interface SceneIntensityResult {
  score: number;
  level: SceneIntensityLevel;
  breakdown: Array<{ factor: string; contribution: number }>;
}

/** 强度分→档位映射（≥10高，≥6中，其余低） */
export function intensityLevelOf(score: number): SceneIntensityLevel {
  if (score >= 10) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
}

/**
 * 计算单个场景节点的强度分（纯规则，可解释：每项命中都有明细）
 */
export function computeSceneIntensity(node: SceneIntensityInput): SceneIntensityResult {
  const event = `${node.title || ''} ${node.coreEvent || ''} ${node.coreBeat || ''}`;
  const effect = node.effectAndResult || '';
  const fullText = `${event} ${effect}`;

  let score = 1;
  const breakdown: SceneIntensityResult['breakdown'] = [];
  const hit = (key: string, cond: boolean, extraUnits = 1) => {
    if (!cond) return;
    const f = SCENE_INTENSITY_FACTORS.find((x) => x.key === key)!;
    const units = f.perUnit ? Math.min(extraUnits, f.maxUnits ?? 1) : 1;
    const contribution = f.weight * units;
    score += contribution;
    breakdown.push({ factor: f.name, contribution });
  };

  hit('irreversible_event', INTENSITY_IRREVERSIBLE_WORDS.some((w) => fullText.includes(w)));
  hit('character_state_change', INTENSITY_STATE_CHANGE_WORDS.some((w) => fullText.includes(w)));
  hit('combat_conflict', INTENSITY_COMBAT_WORDS.some((w) => fullText.includes(w)));
  hit('key_scene', node.sceneType === 'key' || node.isKeyPlot === true);
  hit('foreshadow_payoff', node.sceneType === 'foreshadow' || INTENSITY_PAYOFF_WORDS.some((w) => fullText.includes(w)));
  hit('effect_change', effect.trim().length > 0 && INTENSITY_EFFECT_CHANGE_WORDS.some((w) => effect.includes(w)));
  hit('character_count', (node.characterCount ?? 0) > 0, node.characterCount ?? 0);

  return { score, level: intensityLevelOf(score), breakdown };
}

export interface SceneIntensityVolumeIssue {
  level: 'warning' | 'info';
  message: string;
  nodeId?: number;
}

/**
 * 卷级场景强度节奏校验：连续低强度告警、高强度占比、高强度场景缺钩子提示
 * @param entries 按 sortOrder 排序的场景强度结果
 */
export function checkSceneIntensityHealth(
  entries: Array<{ nodeId: number; title: string; result: SceneIntensityResult; hasHook: boolean }>
): SceneIntensityVolumeIssue[] {
  const issues: SceneIntensityVolumeIssue[] = [];

  // 1. 连续低强度告警（≥3个连续低强度场景，读者可能弃读）
  let lowStreak = 0;
  let lowStart = '';
  for (const e of entries) {
    if (e.result.level === 'low') {
      if (lowStreak === 0) lowStart = e.title;
      lowStreak++;
      if (lowStreak === 3) {
        issues.push({
          level: 'warning', nodeId: e.nodeId,
          message: `从「${lowStart}」起连续${lowStreak}个低强度场景（强度分<6），节奏可能偏平，建议插入冲突或变化`,
        });
      }
    } else {
      lowStreak = 0;
    }
  }

  // 2. 高强度占比过高（>50%则全程紧绷，缺少张弛）
  const highCount = entries.filter((e) => e.result.level === 'high').length;
  if (entries.length >= 4 && highCount / entries.length > 0.5) {
    issues.push({
      level: 'info',
      message: `高强度场景占比${Math.round((highCount / entries.length) * 100)}%（${highCount}/${entries.length}），全程紧绷缺少张弛，建议穿插缓冲场景`,
    });
  }

  // 3. 高强度场景缺钩子提示（高强度场是天然埋钩位）
  for (const e of entries) {
    if (e.result.level === 'high' && !e.hasHook) {
      issues.push({
        level: 'info', nodeId: e.nodeId,
        message: `「${e.title}」为高强度场景（强度分${e.result.score}）但未设置场景钩子，建议利用此处埋设悬念/危机钩子`,
      });
    }
  }

  return issues;
}

// ============================================================
// 节奏健康度校验（纯规则零 LLM）
// ============================================================

export interface RhythmIssue {
  level: 'warning' | 'error';
  message: string;
}

export interface RhythmHealthResult {
  healthy: boolean;
  issues: RhythmIssue[];
  bufferRatio: number; // 缓冲章占比
  peakCount: number;
}

/** 峰值安全间距常量 */
export const PEAK_SAFE_SPACING = 2;

/**
 * 卷级节奏健康度校验
 * @param chapters 按章序排列的章节数据（需含 isPeak / chapterType 信息）
 */
export function checkRhythmHealth(
  chapters: Array<{ chapterNo: number; isPeak: boolean; chapterType?: string | null }>
): RhythmHealthResult {
  const issues: RhythmIssue[] = [];
  const sorted = [...chapters].sort((a, b) => a.chapterNo - b.chapterNo);

  // 1. 连续峰值告警
  let consecutivePeaks = 0;
  for (const ch of sorted) {
    if (ch.isPeak) {
      consecutivePeaks++;
      if (consecutivePeaks === 2) {
        issues.push({ level: 'warning', message: `第${ch.chapterNo - 1}-${ch.chapterNo}章连续峰值，建议插入缓冲章` });
      } else if (consecutivePeaks >= 3) {
        issues.push({ level: 'error', message: `第${ch.chapterNo - 2}-${ch.chapterNo}章连续${consecutivePeaks}个峰值，严重节奏失衡` });
      }
    } else {
      consecutivePeaks = 0;
    }
  }

  // 2. 峰值间距校验
  const peakChapters = sorted.filter(c => c.isPeak);
  for (let i = 1; i < peakChapters.length; i++) {
    const gap = peakChapters[i].chapterNo - peakChapters[i - 1].chapterNo;
    if (gap <= PEAK_SAFE_SPACING) {
      issues.push({ level: 'warning', message: `第${peakChapters[i - 1].chapterNo}章与第${peakChapters[i].chapterNo}章峰值间距仅${gap}章（安全间距${PEAK_SAFE_SPACING}章）` });
    }
  }

  // 3. 缓冲比健康度
  const bufferTypes = ['buffer_price', 'buffer_dialog', 'buffer_clue'];
  const bufferCount = sorted.filter(c => c.chapterType && bufferTypes.includes(c.chapterType)).length;
  const bufferRatio = sorted.length > 0 ? bufferCount / sorted.length : 0;
  if (sorted.length >= 5) {
    if (bufferRatio < 0.25) {
      issues.push({ level: 'warning', message: `缓冲章占比${(bufferRatio * 100).toFixed(0)}%偏低（建议30%-40%），读者可能疲劳` });
    } else if (bufferRatio > 0.45) {
      issues.push({ level: 'warning', message: `缓冲章占比${(bufferRatio * 100).toFixed(0)}%偏高（建议30%-40%），节奏可能拖沓` });
    }
  }

  // 4. 张弛节奏：连续4章非缓冲
  let consecutiveNonBuffer = 0;
  for (const ch of sorted) {
    const isBuffer = ch.chapterType ? bufferTypes.includes(ch.chapterType) : !ch.isPeak;
    if (!isBuffer) {
      consecutiveNonBuffer++;
      if (consecutiveNonBuffer === 4) {
        issues.push({ level: 'warning', message: `第${ch.chapterNo - 3}-${ch.chapterNo}章连续4章非缓冲，建议插入缓冲章调节节奏` });
      }
    } else {
      consecutiveNonBuffer = 0;
    }
  }

  return {
    healthy: !issues.some(i => i.level === 'error'),
    issues,
    bufferRatio: Math.round(bufferRatio * 100) / 100,
    peakCount: peakChapters.length,
  };
}
