/**
 * 大纲联动：chapter_plan / scene_node → 冲突生成器参数映射（PRD v1.3 §10.3）
 *
 * 手动触发模式：用户在大纲中选择章节/场景节点，调用本映射得到预填草稿，
 * 前端表单补齐缺失项后再调用冲突生成。不做自动触发。
 *
 * 人物ID解析沿用项目负数约定：正数=诛仙库 novel_character_lib，负数=自定义人物 custom_character（取绝对值）。
 */
import { and, eq, inArray } from 'drizzle-orm';
import { creativeDb, zhuxianDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import * as zhuxianSchema from '../db/zhuxian-schema.js';
import { EngineError } from './errors.js';
import type { ConflictConfig } from './schemas.js';

/** 预填草稿（config 为部分填充，missing 列出需用户补齐的字段） */
export interface OutlineConflictDraft {
  source: { chapterPlanId: number; sceneNodeId?: number };
  config: Partial<ConflictConfig>;
  missing: string[];
}

interface PlanLike {
  chapterNo: number;
  title: string;
  intent: string | null;
  emotionTarget: string | null;
  conflictTarget: number | null;
  povCharacterIds: number[] | null;
  plotFingerprint: string | null;
}

interface NodeLike {
  title: string;
  coreBeat: string | null;
  coreEvent: string | null;
  locationDesc: string | null;
  stateChange: any;
}

/** 桥段指纹 → 阻力类型建议 */
const FINGERPRINT_RESISTANCE: Record<string, ConflictConfig['resistance']['type']> = {
  faceoff: 'humiliation',
  crisis: 'physical',
  reveal: 'negation_of_desire',
  dialogue: 'rejection',
};

/**
 * 纯映射函数（可单测）：章节计划 + 场景节点 + POV人名 → 冲突配置预填
 */
export function mapOutlineToConflictParams(
  plan: PlanLike, node: NodeLike | null, povNames: string[]
): OutlineConflictDraft['config'] & { _missing: string[] } {
  const missing: string[] = [];
  const highConflict = (plan.conflictTarget ?? 0) >= 4;

  const protagonistName = povNames[0] || '';
  if (!protagonistName) missing.push('protagonist.name（视角人物未配置，请手动填写主角）');

  const desireTarget = node?.coreBeat || node?.coreEvent || plan.intent || '';
  if (!desireTarget) missing.push('desire.target（无核心节拍/章节意图，请手动填写具体渴望）');

  const whyItMatters = plan.emotionTarget ? `本章情绪目标：${plan.emotionTarget}` : '';
  if (!whyItMatters) missing.push('desire.why_it_matters（无情绪目标，请手动填写为什么在乎）');

  // 代价从场景状态变化提取
  let whatIsLost = '';
  if (node?.stateChange && typeof node.stateChange === 'object') {
    const parts = Object.values(node.stateChange).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (parts.length > 0) whatIsLost = parts.join('；');
  }
  if (!whatIsLost) missing.push('cost.what_is_lost（无状态变化信息，请手动填写失去什么）');

  const resistanceType = FINGERPRINT_RESISTANCE[plan.plotFingerprint || ''] ?? 'negation_of_effort';

  return {
    protagonist: { name: protagonistName, identity: '', current_status: undefined },
    desire: {
      target: desireTarget,
      why_it_matters: whyItMatters,
    },
    resistance: {
      source: '',
      type: resistanceType,
      precision: highConflict ? 'high' : 'auto',
    },
    cost: {
      what_is_lost: whatIsLost,
      irreversibility: highConflict ? 'irreversible' : 'partially_reversible',
      emotional_weight: highConflict ? 4 : 3,
    },
    scene_setting: node
      ? `${node.locationDesc || '未指定地点'}·${node.title}`
      : `第${plan.chapterNo}章 ${plan.title}`,
    _missing: missing,
  };
}

/** 解析 POV 人物姓名（正数=诛仙库，负数=自定义人物） */
export async function resolvePovNames(projectId: number, povIds: number[]): Promise<string[]> {
  const posIds = povIds.filter((id) => id > 0);
  const negIds = povIds.filter((id) => id < 0).map((id) => Math.abs(id));
  const nameById = new Map<number, string>();

  if (posIds.length > 0) {
    try {
      const rows = await zhuxianDb
        .select({ id: zhuxianSchema.novelCharacterLib.id, name: zhuxianSchema.novelCharacterLib.name })
        .from(zhuxianSchema.novelCharacterLib)
        .where(inArray(zhuxianSchema.novelCharacterLib.id, posIds));
      for (const r of rows) nameById.set(r.id, r.name);
    } catch {
      // 诛仙库不可用时降级为空
    }
  }
  if (negIds.length > 0) {
    const rows = await creativeDb
      .select({ id: schema.customCharacter.id, name: schema.customCharacter.name })
      .from(schema.customCharacter)
      .where(and(
        eq(schema.customCharacter.projectId, projectId),
        eq(schema.customCharacter.isDeleted, false),
        inArray(schema.customCharacter.id, negIds)
      ));
    for (const r of rows) nameById.set(-r.id, r.name);
  }
  return povIds.map((id) => nameById.get(id) || '').filter(Boolean);
  }

  /** 冰山台词预填草稿 */
  export interface OutlineIcebergDraft {
  source: { chapterPlanId: number; sceneNodeId?: number };
  config: Partial<IcebergConfig>;
  missing: string[];
  }

  interface IcebergConfig {
  scene_context: { setting: string; characters: string[]; mood: string };
  truth_layer: { what_they_really_mean: string; why_they_hide_it: string };
  surface_layer: { what_they_say: string; subtext: string };
  }

  /**
  * 从章节计划自动推导冰山台词参数。
  * 真相层=章节意图映射为隐藏动机，表面层=角色从已有对白风格推导。
  */
  export function buildIcebergDraft(
  plan: PlanLike, node: NodeLike | null, povNames: string[]
  ): OutlineIcebergDraft['config'] & { _missing: string[] } {
  const missing: string[] = [];

  const protagonist = povNames[0] || '';
  if (!protagonist) missing.push('主角未配置');

  const setting = node
  ? `${node.locationDesc || '未指定地点'}·${node.title}`
  : `第${plan.chapterNo}章 ${plan.title}`;

  const mood = plan.emotionTarget || '';
  if (!mood) missing.push('情绪基调未设置');

  const truth = plan.intent
  ? `角色真正想做的是：${plan.intent}`
  : '';
  if (!truth) missing.push('真相层：章节意图缺失');

  const whyHide = plan.conflictTarget && plan.conflictTarget >= 4
  ? '高冲突场景，角色选择隐藏真实意图以避免冲突升级'
  : plan.emotionTarget
  ? `角色在此情绪下（${plan.emotionTarget}）选择不完全表达真实想法`
  : '';
  if (!whyHide) missing.push('隐藏动机：请根据场景补充');

  const surfaceHint = plan.plotFingerprint === 'dialogue'
  ? '对话为主的场景，表面台词应体现试探与回避'
  : '角色说出口的话与内心真实想法形成张力';

  return {
  scene_context: {
  setting,
  characters: povNames.slice(0, 3),
  mood: mood || '待确认',
  },
  truth_layer: {
  what_they_really_mean: truth || '待确认',
  why_they_hide_it: whyHide || '待补充',
  },
  surface_layer: {
  what_they_say: '', // LLM 生成
  subtext: surfaceHint,
  },
  _missing: missing,
  };
  }

/**
 * 构建冲突参数预填草稿（路由层入口）
 */
export async function buildConflictDraft(
  projectId: number, chapterPlanId: number, sceneNodeId?: number
): Promise<OutlineConflictDraft> {
  const [plan] = await creativeDb.select().from(schema.chapterPlan)
    .where(and(eq(schema.chapterPlan.id, chapterPlanId), eq(schema.chapterPlan.projectId, projectId)))
    .limit(1);
  if (!plan) throw new EngineError('NOT_FOUND', 404, `章节计划 ${chapterPlanId} 不存在`);

  let node: NodeLike | null = null;
  if (sceneNodeId) {
    const [n] = await creativeDb.select().from(schema.sceneNode)
      .where(and(eq(schema.sceneNode.id, sceneNodeId), eq(schema.sceneNode.projectId, projectId)))
      .limit(1);
    if (!n) throw new EngineError('NOT_FOUND', 404, `场景节点 ${sceneNodeId} 不存在`);
    node = n;
  }

  const povNames = await resolvePovNames(projectId, (plan.povCharacterIds ?? []) as number[]);
  const mapped = mapOutlineToConflictParams(plan, node, povNames);
  const { _missing, ...config } = mapped;

  return {
    source: { chapterPlanId, sceneNodeId },
    config,
    missing: _missing,
  };
}
