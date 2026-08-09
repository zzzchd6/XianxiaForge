/**
 * 因果羁绊自动匹配服务（PRD§3.2）
 * 三维度评分：特质适配(30%) + 前尘关联(30%) + 器性相投(30%) + 稀有加成(10%)
 * 总分≥80自动生成羁绊，存入 custom_character_relation（entityType='weapon_bond'）。
 * 零token，全规则驱动。
 */
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { eq, and } from 'drizzle-orm';
import type { GeneratedTrait } from './trait-composer.js';

// ============================================================
// 类型
// ============================================================

export interface BondResult {
  score: number;
  bondType: string;
  description: string;
  charId: number;
  weaponId: number;
}

export type BondType = '天选' | '宿敌' | '因果' | '契合' | '相冲';

// ============================================================
// 器性↔性格 映射
// ============================================================

/** 器性ID → 适配的内在性格 */
const TEMPERAMENT_FIT: Record<string, string[]> = {
  stern: ['正直', '无私'],
  playful: ['狂邪', '中庸'],
  lazy: ['中庸', '利己'],
  bloodthirsty: ['邪恶', '狂邪'],
  rigid: ['正直', '无私'],
  tsundere: ['狂邪', '中庸'],
  timid: ['利己', '中庸'],
  obsessed: ['无私', '正直'],
};

/** 器性ID → 相冲的内在性格 */
const TEMPERAMENT_CLASH: Record<string, string[]> = {
  stern: ['邪恶', '利己'],
  playful: ['正直'],
  lazy: ['无私'],
  bloodthirsty: ['无私', '正直'],
  rigid: ['狂邪', '邪恶'],
  tsundere: ['正直'],
  timid: ['狂邪', '邪恶'],
  obsessed: ['利己', '邪恶'],
};

// ============================================================
// 评分函数
// ============================================================

/**
 * 计算人物与武器的羁绊分数
 */
export function computeBondScore(
  char: { talents: string[]; innerPersonality: string; name: string },
  weapon: { generatedTraits: GeneratedTrait[]; temperament?: string; pastMemory?: string; name: string },
): { score: number; bondType: BondType; reasons: string[] } {
  let traitScore = 0;
  let pastScore = 0;
  let tempScore = 0;
  const reasons: string[] = [];

  // 1. 特质适配（满分30）
  const traits = weapon.generatedTraits || [];
  const talentSet = new Set(char.talents.map((t) => t.toLowerCase()));
  let matchCount = 0;
  let conflictCount = 0;
  for (const t of traits) {
    const nameLower = t.name.toLowerCase();
    // 天赋名与特质名有交集 → 匹配
    for (const talent of talentSet) {
      if (nameLower.includes(talent) || talent.includes(nameLower)) {
        matchCount++;
        break;
      }
    }
    // 带 flaw 且性格邪恶 → 冲突适配（宿敌）
    if (t.flaw && (char.innerPersonality === '邪恶' || char.innerPersonality === '利己')) {
      conflictCount++;
    }
  }
  if (matchCount >= 2) { traitScore = 30; reasons.push(`天赋与${matchCount}项特质共鸣`); }
  else if (matchCount === 1) { traitScore = 20; reasons.push('天赋与1项特质共鸣'); }
  else if (conflictCount >= 2) { traitScore = 25; reasons.push(`特质与性格形成${conflictCount}处对冲`); }
  else if (traits.length > 0) { traitScore = 10; }

  // 2. 前尘关联（满分30）
  const past = weapon.pastMemory || '';
  if (past && char.name && past.includes(char.name)) {
    pastScore = 30;
    reasons.push('前尘记忆中提及此人物');
  } else if (past && past.length > 20) {
    // 有前尘但无直接关联 → 基础分
    pastScore = 10;
  }

  // 3. 器性相投（满分30）
  const temp = weapon.temperament || '';
  if (temp && TEMPERAMENT_FIT[temp]?.includes(char.innerPersonality)) {
    tempScore = 30;
    reasons.push('器性与性格高度契合');
  } else if (temp && TEMPERAMENT_CLASH[temp]?.includes(char.innerPersonality)) {
    tempScore = 25;
    reasons.push('器性与性格相冲（宿敌/相冲羁绊）');
  } else if (temp) {
    tempScore = 10;
  }

  // 4. 稀有加成（满分10）
  const rareCount = traits.filter((t) => t.isRare).length;
  const rareBonus = Math.min(rareCount * 5, 10);
  if (rareBonus > 0) reasons.push(`含${rareCount}项稀有特质`);

  const total = traitScore + pastScore + tempScore + rareBonus;

  // 判定羁绊类型
  let bondType: BondType = '契合';
  if (traitScore >= 30 && tempScore >= 30) bondType = '天选';
  else if (conflictCount >= 2 || (tempScore >= 25 && TEMPERAMENT_CLASH[temp]?.includes(char.innerPersonality))) bondType = '宿敌';
  else if (pastScore >= 30) bondType = '因果';
  else if (tempScore >= 25 && TEMPERAMENT_CLASH[temp]?.includes(char.innerPersonality)) bondType = '相冲';

  return { score: total, bondType, reasons };
}

// ============================================================
// 数据库操作
// ============================================================

/**
 * 扫描项目中所有人物×武器组合，自动生成/更新羁绊
 */
export async function scanAndCreateBonds(projectId: number): Promise<BondResult[]> {
  const [chars, weapons] = await Promise.all([
    creativeDb.select().from(schema.customCharacter)
      .where(and(eq(schema.customCharacter.projectId, projectId), eq(schema.customCharacter.isDeleted, false))),
    creativeDb.select().from(schema.customWeapon)
      .where(and(eq(schema.customWeapon.projectId, projectId), eq(schema.customWeapon.isDeleted, false))),
  ]);

  const results: BondResult[] = [];

  for (const char of chars) {
    for (const weapon of weapons) {
      // 读取武器五感卡获取 temperament/pastMemory
      const [lore] = await creativeDb.select().from(schema.weaponLore)
        .where(and(
          eq(schema.weaponLore.weaponId, weapon.id),
          eq(schema.weaponLore.projectId, projectId),
          eq(schema.weaponLore.isCurrent, true),
        ));

      const weaponData = {
        generatedTraits: (weapon.generatedTraits as GeneratedTrait[]) || [],
        temperament: (weapon as any).temperament || undefined,
        pastMemory: lore?.pastMemory || undefined,
        name: weapon.name,
      };

      const { score, bondType, reasons } = computeBondScore(
        { talents: (char.talents as string[]) || [], innerPersonality: char.innerPersonality, name: char.name },
        weaponData,
      );

      if (score >= 80) {
        // 去重：检查是否已存在
        const [existing] = await creativeDb.select().from(schema.customCharacterRelation)
          .where(and(
            eq(schema.customCharacterRelation.projectId, projectId),
            eq(schema.customCharacterRelation.entityType, 'weapon_bond'),
            eq(schema.customCharacterRelation.charBId, char.id),
            eq(schema.customCharacterRelation.weaponId, weapon.id),
          ));

        const desc = `${bondType}羁绊（${score}分）：${reasons.join('；')}`;

        if (existing) {
          // 更新分数和描述
          await creativeDb.update(schema.customCharacterRelation)
            .set({ relLevel: score, description: desc, relType: bondType, updatedAt: new Date() } as any)
            .where(eq(schema.customCharacterRelation.id, existing.id));
        } else {
          await creativeDb.insert(schema.customCharacterRelation).values({
            projectId,
            charAId: weapon.id, // 武器作为A方
            charBId: char.id,  // 人物作为B方
            relType: bondType,
            relLevel: score,
            description: desc,
            entityType: 'weapon_bond',
            weaponId: weapon.id,
            isActive: true,
          });
        }

        results.push({ score, bondType, description: desc, charId: char.id, weaponId: weapon.id });
      }
    }
  }

  return results;
}

/**
 * 查询某武器的所有羁绊
 */
export async function getWeaponBonds(projectId: number, wid: number) {
  return creativeDb.select().from(schema.customCharacterRelation)
    .where(and(
      eq(schema.customCharacterRelation.projectId, projectId),
      eq(schema.customCharacterRelation.entityType, 'weapon_bond'),
      eq(schema.customCharacterRelation.weaponId, wid),
      eq(schema.customCharacterRelation.isActive, true),
    ));
}
