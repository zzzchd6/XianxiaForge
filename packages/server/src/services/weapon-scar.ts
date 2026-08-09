/**
 * 武器烙印服务（PRD§3.1）
 * 烙印 = 特殊特质，存入 generated_traits 数组，isScar=true 标记。
 * 触发来源：StateExtractor 章节解析 / 手动添加。
 * 添加/删除后自动调用 refreshWeaponLore 更新五感卡。
 */
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { eq, and } from 'drizzle-orm';
import type { GeneratedTrait } from './trait-composer.js';
import { refreshWeaponLore } from './weapon-refresh.js';

// ============================================================
// 烙印定义表
// ============================================================

export interface ScarDefinition {
  id: string;
  name: string;
  trigger: string;
  traitName: string;
  traitDesc: string;
  flaw: string;
}

export const SCAR_DEFINITIONS: ScarDefinition[] = [
  {
    id: 'scar_thunder',
    name: '雷痕',
    trigger: '武器扛过雷劫',
    traitName: '雷痕',
    traitDesc: '器身隐有电弧游走，对雷属性伤害抗性极强，雷雨天会自行嗡鸣',
    flaw: '雷雨天自己响，容易招雷，雨天藏不住',
  },
  {
    id: 'scar_slaughter',
    name: '杀纹',
    trigger: '武器杀过百人',
    traitName: '杀纹',
    traitDesc: '器身浮现暗红纹路，对活物伤害倍增，带凶性',
    flaw: '见了血就兴奋，容易带动主人杀性，久握眼红',
  },
  {
    id: 'scar_demon',
    name: '魔染',
    trigger: '武器被魔修污染',
    traitName: '魔染',
    traitDesc: '器身缠绕黑气，威力暴增三成，带浓郁魔气',
    flaw: '会引魔气侵体，用多了容易入魔，正道修士排斥',
  },
  {
    id: 'scar_reforge',
    name: '重痕',
    trigger: '武器被强者打碎重铸',
    traitName: '重痕',
    traitDesc: '器身有愈合裂痕，比原来更坚韧，旧伤处隐有光泽',
    flaw: '旧伤处碰到极寒/极热会疼，极端环境下可能再次裂开',
  },
];

// ============================================================
// 服务函数
// ============================================================

let scarCounter = 0;
function scarId(): string {
  return `scar_${Date.now().toString(36)}_${(scarCounter++).toString(36)}`;
}

/** 获取武器当前 generatedTraits（jsonb 数组） */
async function getTraits(projectId: number, wid: number): Promise<GeneratedTrait[] | null> {
  const [row] = await creativeDb.select({ generatedTraits: schema.customWeapon.generatedTraits })
    .from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.id, wid), eq(schema.customWeapon.projectId, projectId)));
  if (!row) return null;
  return (row.generatedTraits as GeneratedTrait[]) || [];
}

/** 添加烙印（幂等：同 scarDef.id 不重复添加） */
export async function addScar(projectId: number, wid: number, scarDefId: string) {
  const def = SCAR_DEFINITIONS.find((d) => d.id === scarDefId);
  if (!def) return { success: false, error: `未知烙印类型: ${scarDefId}` };

  const traits = await getTraits(projectId, wid);
  if (traits === null) return { success: false, error: '武器不存在' };

  // 幂等检查
  if (traits.some((t) => t.isScar && t.classicId === scarDefId)) {
    return { success: true, message: '烙印已存在', scar: def.name };
  }

  const scarTrait: GeneratedTrait = {
    id: scarId(),
    type: 'forge',
    name: def.traitName,
    desc: def.traitDesc,
    isRare: false,
    flaw: def.flaw,
    sourceDirections: [],
    isClassic: false,
    classicId: scarDefId,
    isScar: true,
  };

  const updated = [...traits, scarTrait];
  await creativeDb.update(schema.customWeapon)
    .set({ generatedTraits: updated as any, updatedAt: new Date() })
    .where(eq(schema.customWeapon.id, wid));

  // 自动刷新五感卡
  refreshWeaponLore(projectId, wid, { module: 'scar' }).catch(() => {});

  return { success: true, scar: def.name, trait: scarTrait };
}

/** 手动添加自定义烙印 */
export async function addCustomScar(projectId: number, wid: number, name: string, desc: string, flaw?: string) {
  const traits = await getTraits(projectId, wid);
  if (traits === null) return { success: false, error: '武器不存在' };

  const scarTrait: GeneratedTrait = {
    id: scarId(),
    type: 'forge',
    name,
    desc,
    isRare: false,
    flaw: flaw || null,
    sourceDirections: [],
    isClassic: false,
    classicId: null,
    isScar: true,
  };

  const updated = [...traits, scarTrait];
  await creativeDb.update(schema.customWeapon)
    .set({ generatedTraits: updated as any, updatedAt: new Date() })
    .where(eq(schema.customWeapon.id, wid));

  refreshWeaponLore(projectId, wid, { module: 'scar' }).catch(() => {});
  return { success: true, trait: scarTrait };
}

/** 删除烙印 */
export async function removeScar(projectId: number, wid: number, traitId: string) {
  const traits = await getTraits(projectId, wid);
  if (traits === null) return { success: false, error: '武器不存在' };

  const idx = traits.findIndex((t) => t.id === traitId && t.isScar);
  if (idx < 0) return { success: false, error: '烙印不存在' };

  const updated = traits.filter((_, i) => i !== idx);
  await creativeDb.update(schema.customWeapon)
    .set({ generatedTraits: updated as any, updatedAt: new Date() })
    .where(eq(schema.customWeapon.id, wid));

  refreshWeaponLore(projectId, wid, { module: 'scar' }).catch(() => {});
  return { success: true };
}

/** 列出武器所有烙印 */
export async function listScars(projectId: number, wid: number) {
  const traits = await getTraits(projectId, wid);
  if (traits === null) return [];
  return traits.filter((t) => t.isScar);
}
