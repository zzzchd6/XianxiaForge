/**
 * 走火入魔魔改服务（PRD§4.1）
 * 触发条件：StateExtractor 识别到强行越阶/被魔污染/精神崩溃 → 10%概率触发
 * 魔改逻辑：固定参数（煞气/血祭/邪性嗜血），保留原有一半特质，另一半替换为魔性特质
 * 净化后恢复原特质，留下「魔痕」烙印。
 */
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { eq, and } from 'drizzle-orm';
import type { GeneratedTrait } from './trait-composer.js';
import { refreshWeaponLore } from './weapon-refresh.js';
import { addScar } from './weapon-scar.js';

// ============================================================
// 魔性特质池（确定性，零token）
// ============================================================

const DEMON_TRAITS: Omit<GeneratedTrait, 'id'>[] = [
  { type: 'infuse', name: '噬魂', desc: '器身缠绕黑气，击中活物时吞噬一缕神魂', isRare: false, flaw: '用多了主人也会头晕，分不清敌我', sourceDirections: [], isClassic: false, classicId: null },
  { type: 'infuse', name: '血祭', desc: '以主人精血为引，威力暴增但每次都要见血', isRare: false, flaw: '三日不饮血就反噬主人', sourceDirections: [], isClassic: false, classicId: null },
  { type: 'forge', name: '煞骨', desc: '器身浮现黑色骨纹，硬度倍增但散发阴寒', isRare: false, flaw: '贴身携带会侵蚀经脉', sourceDirections: [], isClassic: false, classicId: null },
  { type: 'enchant', name: '厉鬼缠', desc: '有怨灵缠绕器身，夜间自行嗡鸣，对阴邪之物有感应', isRare: false, flaw: '容易引来孤魂野鬼', sourceDirections: [], isClassic: false, classicId: null },
  { type: 'hidden', name: '魔种', desc: '内藏一颗魔种，关键时刻可爆发一次毁灭性攻击', isRare: true, flaw: '爆发后武器休眠七日，主人减寿一年', sourceDirections: [], isClassic: false, classicId: null },
];

let demonCounter = 0;
function demonId(): string {
  return `demon_${Date.now().toString(36)}_${(demonCounter++).toString(36)}`;
}

// ============================================================
// 服务函数
// ============================================================

export interface DemonizeResult {
  success: boolean;
  error?: string;
  replacedCount?: number;
  keptCount?: number;
  newTraits?: GeneratedTrait[];
}

/**
 * 对武器执行魔改：保留一半特质，另一半替换为魔性特质，添加魔染烙印
 */
export async function demonizeWeapon(projectId: number, wid: number): Promise<DemonizeResult> {
  const [row] = await creativeDb.select().from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.id, wid), eq(schema.customWeapon.projectId, projectId)));
  if (!row) return { success: false, error: '武器不存在' };

  const traits = (row.generatedTraits as GeneratedTrait[]) || [];
  if (traits.length === 0) return { success: false, error: '武器无特质，无法魔改' };

  // 保留前半，替换后半
  const halfIdx = Math.ceil(traits.length / 2);
  const kept = traits.slice(0, halfIdx);
  const replaceCount = traits.length - halfIdx;

  // 从魔性池中随机选（不重复）
  const pool = [...DEMON_TRAITS];
  const newTraits: GeneratedTrait[] = [];
  for (let i = 0; i < Math.min(replaceCount, pool.length); i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const picked = pool.splice(idx, 1)[0];
    newTraits.push({ ...picked, id: demonId() });
  }

  const merged = [...kept, ...newTraits];

  // 保存原始特质快照（用于净化恢复）
  const before = { generatedTraits: traits };
  await creativeDb.update(schema.customWeapon)
    .set({ generatedTraits: merged as any, updatedAt: new Date() })
    .where(eq(schema.customWeapon.id, wid));

  // 写入成长记录
  await creativeDb.insert(schema.entityGrowthRecord).values({
    projectId, entityType: 'weapon', entityId: wid, operationType: 'demonize',
    sourceEntityIds: [wid], beforeSnapshot: before as any, afterSnapshot: { generatedTraits: merged } as any,
    result: 'success', operatorNote: `走火入魔：保留${kept.length}项，魔化${newTraits.length}项`,
  });

  // 添加魔染烙印
  await addScar(projectId, wid, 'scar_demon');

  // 刷新五感卡（魔性版本）
  refreshWeaponLore(projectId, wid, { module: 'demonize' }).catch(() => {});

  return { success: true, replacedCount: newTraits.length, keptCount: kept.length, newTraits: merged };
}

/**
 * 净化：恢复魔改前的特质，留下「魔痕」烙印
 */
export async function purifyWeapon(projectId: number, wid: number) {
  // 找到最近的 demonize 记录
  const [rec] = await creativeDb.select().from(schema.entityGrowthRecord)
    .where(and(
      eq(schema.entityGrowthRecord.entityType, 'weapon'),
      eq(schema.entityGrowthRecord.entityId, wid),
      eq(schema.entityGrowthRecord.projectId, projectId),
      eq(schema.entityGrowthRecord.operationType, 'demonize'),
    ))
    .orderBy(schema.entityGrowthRecord.id)
    .limit(1);

  if (!rec) return { success: false, error: '无魔改记录，无需净化' };

  const before = rec.beforeSnapshot as any;
  if (!before?.generatedTraits) return { success: false, error: '快照数据异常' };

  await creativeDb.update(schema.customWeapon)
    .set({ generatedTraits: before.generatedTraits, updatedAt: new Date() })
    .where(eq(schema.customWeapon.id, wid));

  // 添加自定义「魔痕」烙印（净化后残留）
  const { addCustomScar } = await import('./weapon-scar.js');
  await addCustomScar(projectId, wid, '魔痕', '净化后残留的魔气痕迹，偶尔会闪过一丝黑气', '阴气重的地方会隐隐作痛');

  refreshWeaponLore(projectId, wid, { module: 'purify' }).catch(() => {});

  return { success: true, message: '净化完成，恢复原特质，留下魔痕烙印' };
}
