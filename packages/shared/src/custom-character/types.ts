// ═══════════════════════════════════════════════════════════════════════════════
// 自定义人物模块 - 类型定义与性格/定位常量
// ═══════════════════════════════════════════════════════════════════════════════

import type { RaceCategoryId } from './race-config.js';
import type { Gender } from './name-config.js';

/** 五档模糊体感定位key */
export type PositionKey = 'chenjie' | 'tongtu' | 'dazhe' | 'zhelong' | 'tianyou';

/** 定位配置：rank用于扮猪吃虎时比较档次高低（伪装定位必须低于真实定位） */
export interface PositionInfo {
  key: PositionKey;
  name: string;
  desc: string;
  rank: number;
}

/** 五档定位（无数字无硬等级，仅体感描述） */
export const POSITION_OPTIONS: PositionInfo[] = [
  { key: 'chenjie', name: '尘芥', desc: '凡俗/刚入门，在修士眼中如尘如芥，对应小弟子、路人、主角成长起点', rank: 1 },
  { key: 'tongtu', name: '同途', desc: '正经入道的修士，平辈论交互称同途，对应队友、普通反派、行走江湖的散修', rank: 2 },
  { key: 'dazhe', name: '达者', desc: '修为名望有成，达者为先，小辈见了称前辈，对应师父、引路人、前期BOSS', rank: 3 },
  { key: 'zhelong', name: '蛰龙', desc: '蛰伏不出的一方巨擘，不动则已一动惊人，对应门派老祖宗、隐世BOSS、镇派人物', rank: 4 },
  { key: 'tianyou', name: '天游', desc: '传说级人物，逍遥天地见首不见尾，对应最终BOSS、金手指提供者、传说级存在', rank: 5 },
];

/** 按key查定位 */
export function findPosition(key: string): PositionInfo | undefined {
  return POSITION_OPTIONS.find((p) => p.key === key);
}

/** 内在性格（单选，决定核心三观） */
export const INNER_PERSONALITY_OPTIONS = ['无私', '正直', '中庸', '狂邪', '利己', '邪恶'] as const;
export type InnerPersonality = (typeof INNER_PERSONALITY_OPTIONS)[number];

/** 内在性格对立场值的偏移：正面-15（偏浩然正气），邪派+15（偏邪异诡道） */
export const INNER_PERSONALITY_STANCE_SHIFT: Record<InnerPersonality, number> = {
  无私: -15,
  正直: -15,
  中庸: 0,
  狂邪: 15,
  利己: 15,
  邪恶: 15,
};

/** 外在性格（多选2-3个，决定日常行为，接入OOC审计） */
export const OUTER_PERSONALITY_OPTIONS = [
  '义气', '护短', '孤僻', '爱家', '好名', '贪权', '睚眦必报', '任我随性', '情种', '尊师重道',
  '忠孝', '谨慎', '跳脱', '腹黑', '话痨', '高冷', '贪财', '好酒', '多疑', '果决',
] as const;

/** 外在性格多选限制 */
export const OUTER_PERSONALITY_MIN = 2;
export const OUTER_PERSONALITY_MAX = 3;

/** 正向天赋选择约束：至少3个、至多8个（4大类×每类最多2个） */
export const TALENT_MIN_COUNT = 3;
export const TALENT_MAX_COUNT = 8;
export const TALENT_MAX_PER_CATEGORY = 2;
/** @deprecated 已改为区间约束，保留供旧脚本兼容，等于 TALENT_MIN_COUNT */
export const TALENT_REQUIRED_COUNT = TALENT_MIN_COUNT;

/** 立场刻度文案（0=浩然正气 50=随心所欲 100=邪异诡道） */
export const STANCE_LABELS = { low: '浩然正气', mid: '随心所欲', high: '邪异诡道' } as const;

/** 立场值转文案 */
export function stanceLabel(stance: number): string {
  if (stance <= 33) return STANCE_LABELS.low;
  if (stance >= 67) return STANCE_LABELS.high;
  return STANCE_LABELS.mid;
}

/** 自定义人物（对外形态：id为负数，展示层与选择器直接使用） */
export interface CustomCharacter {
  /** 对外ID：数据库自增ID取负，用于与诛仙库正数ID区分 */
  id: number;
  projectId: number;
  name: string;
  gender: Gender;
  raceCategory: RaceCategoryId;
  raceSub: string;
  position: PositionKey;
  /** 对外伪装定位（扮猪吃虎），必须低于真实定位档次 */
  fakePosition: PositionKey | null;
  /** 立场：0=浩然正气 50=随心所欲 100=邪异诡道 */
  stance: number;
  innerPersonality: InnerPersonality;
  outerPersonality: string[];
  /** 先天禀赋名称数组：3-8个正向+0/1个缺陷 */
  talents: string[];
  /** 擅长标签（种族/天赋自动生成） */
  strengths: string[];
  /** 短板标签（种族/天赋自动生成） */
  weaknesses: string[];
  /** LLM生成的人物小传 */
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 随机接口的锁定配置：true=锁定（随机时保持不变） */
export interface RandomLocks {
  race?: boolean;
  position?: boolean;
  name?: boolean;
  gender?: boolean;
  stance?: boolean;
  innerPersonality?: boolean;
  outerPersonality?: boolean;
  talents?: boolean;
}

/** 创建/更新人物的表单数据 */
export interface CustomCharacterForm {
  name: string;
  gender: Gender;
  raceCategory: RaceCategoryId;
  raceSub: string;
  position: PositionKey;
  fakePosition?: PositionKey | null;
  stance: number;
  innerPersonality: InnerPersonality;
  outerPersonality: string[];
  talents: string[];
}

/** 随机接口返回的人物草稿（未入库，无ID） */
export type CustomCharacterDraft = CustomCharacterForm & {
  strengths: string[];
  weaknesses: string[];
};
