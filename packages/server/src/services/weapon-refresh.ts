/**
 * weapon-refresh.ts — 统一武器刷新服务（7.31）
 *
 * 所有对武器的修改（强化/进化/烙印/魔改/重铸）最终调用 refreshWeaponLore()：
 * 1. 读取武器最新 generatedTraits + 控制项
 * 2. 调用 weaponSenseCardAgent.generate() 重新生成五感卡（含器灵）
 * 3. 更新 weapon_lore 行
 * 4. best-effort 同步钩子到伏笔台账
 * 5. 返回更新后的 lore 行
 */
import { eq, and } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { weaponSenseCardAgent, type SenseCardInput } from '../agents/weapon-sense-card.js';
import { wrapClassicTraits } from './trait-composer.js';
import { getDefaultTemperament, getDefaultPastType, getDefaultTaboos } from '../data/trait-directions.js';

export interface RefreshOpts {
  /** 仅重生成指定模块（省略则全量） */
  module?: string;
  /** 跳过伏笔同步（局部刷新时避免重复写入） */
  skipForeshadow?: boolean;
}

/**
 * 统一刷新武器五感卡 + 器灵 + 伏笔同步
 */
export async function refreshWeaponLore(projectId: number, wid: number, opts?: RefreshOpts) {
  const [weapon] = await creativeDb
    .select()
    .from(schema.customWeapon)
    .where(and(eq(schema.customWeapon.id, wid), eq(schema.customWeapon.projectId, projectId)));
  if (!weapon) throw new Error(`武器不存在: ${wid}`);

  // 组装特质列表
  const traits = ((weapon.generatedTraits as any[])?.length
    ? weapon.generatedTraits
    : wrapClassicTraits(
        (weapon.forgeTraits || []) as string[],
        (weapon.soakTraits || []) as string[],
        (weapon.attachTraits || []) as string[],
        (weapon.cavityTraits || []) as string[],
      )) as any[];

  const temperament = weapon.temperament ?? getDefaultTemperament(weapon.category, weapon.type);
  const pastType = weapon.pastType ?? getDefaultPastType(weapon.grade, weapon.category);
  const taboos = (weapon.taboos as string[])?.length ? weapon.taboos as string[] : getDefaultTaboos(temperament);

  const input: SenseCardInput = {
    weaponName: weapon.name,
    category: weapon.category,
    type: weapon.type,
    grade: weapon.grade,
    baseMaterial: weapon.baseMaterial,
    traits,
    temperament,
    pastType,
    taboos,
    reverseMode: weapon.reverseMode ?? false,
  };

  const result = await weaponSenseCardAgent.generate(input, { module: opts?.module });

  // 查找当前生效 lore 行
  const [currentLore] = await creativeDb
    .select()
    .from(schema.weaponLore)
    .where(and(eq(schema.weaponLore.weaponId, wid), eq(schema.weaponLore.isCurrent, true)));

  if (currentLore) {
    const patch: any = { updatedAt: new Date() };
    if (result.realSkill !== undefined) patch.realSkill = result.realSkill;
    if (result.weirdTrait !== undefined) patch.weirdTrait = result.weirdTrait;
    if (result.pastMemory !== undefined) patch.pastMemory = result.pastMemory;
    if (result.jianghuNickname !== undefined) patch.jianghuNickname = result.jianghuNickname;
    if (result.jianghuHeihua !== undefined) patch.jianghuHeihua = result.jianghuHeihua;
    if (result.rules !== undefined) patch.rules = result.rules;
    if (result.hooks !== undefined) patch.hooks = result.hooks;
    if (result.famousScenes !== undefined) patch.famousScenes = result.famousScenes;
    if ((result as any).spirit !== undefined) patch.spirit = (result as any).spirit;
    const [updated] = await creativeDb
      .update(schema.weaponLore)
      .set(patch)
      .where(eq(schema.weaponLore.id, currentLore.id))
      .returning();

    if (!opts?.skipForeshadow && !opts?.module && result.hooks?.length) {
      await syncHooks(projectId, wid, weapon.name, result.hooks);
    }
    return updated;
  } else {
    const [row] = await creativeDb
      .insert(schema.weaponLore)
      .values({
        projectId, weaponId: wid, name: weapon.name, intro: '', moves: [], isCurrent: true,
        realSkill: result.realSkill ?? '',
        weirdTrait: result.weirdTrait ?? '',
        pastMemory: result.pastMemory ?? '',
        jianghuNickname: result.jianghuNickname ?? '',
        jianghuHeihua: result.jianghuHeihua ?? '',
        rules: result.rules ?? '',
        hooks: result.hooks ?? [],
        famousScenes: result.famousScenes ?? [],
        spirit: (result as any).spirit ?? '',
      })
      .returning();

    if (!opts?.skipForeshadow && result.hooks?.length) {
      await syncHooks(projectId, wid, weapon.name, result.hooks);
    }
    return row;
  }
}

async function syncHooks(
  projectId: number, weaponId: number, weaponName: string,
  hooks: Array<{ type: string; title: string; content: string }>,
) {
  try {
    const typeLabel: Record<string, string> = { seek: '寻亲', eerie: '灵异', conflict: '风波' };
    for (const h of hooks) {
      if (!h.content) continue;
      await creativeDb.insert(schema.foreshadowThread).values({
        projectId,
        title: `【${weaponName}·${typeLabel[h.type] ?? h.type}】${h.title || h.content.slice(0, 20)}`,
        description: h.content,
        status: 'pending',
        priority: 'normal',
        tier: 't3',
        sourceType: 'manual',
        isConfirmed: true,
        dnaSubject: weaponName,
        dnaAction: '钩子',
        dnaEmotion: '悬念',
      });
    }
  } catch {
    // best-effort
  }
}
