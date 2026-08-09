/**
 * 淘宝生成引擎 - 十连淘货核心逻辑
 *
 * 全面武器化：count 件全部为秘宝（武器），纯规则生成，零 token。
 * 秘宝：复用 randomWeapon / weapon-relic，三档品阶（有灵/传承/遗珍）。
 */
import { randomLocation } from '../data/trinket-catalog.js';
import { randomWeapon } from './weapon-random.js';
import { randomDirections, composeTraits, type WeaponBase, type SelectedDirections } from './trait-composer.js';
import { RELICS } from './weapon-relic.js';

// ============================================================
// 类型
// ============================================================

export interface HuntConfig {
  count: number;          // 生成数量（默认10）
  fakeRatio: number;      // 打眼比例（默认0.1）
}

export interface HuntSecretResult {
  tempId: number;
  itemType: 'secret';
  secretTier: 'spirit' | 'legacy' | 'relic';
  displayName: string;       // 外观代称
  appearance: string;
  trueName: string;          // 存库但不返回前端
  fullData: any;             // 完整武器数据
  isFake: boolean;
  fakeReveal: string | null;
  huntLocation: string;
}

export type HuntItemResult = HuntSecretResult;

export interface HuntResult {
  location: string;
  items: HuntItemResult[];
  secretCount: number;
}

// ============================================================
// 秘宝外观代称生成（规则，零token）
// ============================================================

const SECRET_APPEARANCES = [
  '锈得粘在鞘里的短铁条',
  '裹着三层油布的长条物件',
  '缺了口的黑铁疙瘩',
  '缠满旧布条的棍状物',
  '沉得不正常的木匣子',
  '表面全是泥垢的铜管',
  '用麻绳捆了七八道的布包',
  '看着像烧火棍的东西',
  '灰扑扑的石片，边缘锋利',
  '一截枯木，但拿在手里发烫',
] as const;

function randomAppearance(): string {
  return SECRET_APPEARANCES[Math.floor(Math.random() * SECRET_APPEARANCES.length)];
}

// ============================================================
// 核心：生成一批淘货武器
// ============================================================

export async function generateHunt(config: HuntConfig): Promise<HuntResult> {
  const { count, fakeRatio } = config;
  const location = randomLocation();

  const items: HuntItemResult[] = [];
  let tempId = 1;

  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    let tier: 'spirit' | 'legacy' | 'relic';
    let fullData: any;
    let trueName: string;

    if (roll < 0.01) {
      // 彩蛋遗珍 1%
      tier = 'relic';
      const relic = RELICS[Math.floor(Math.random() * RELICS.length)];
      trueName = relic.trueIdentity;
      fullData = { relic, type: 'relic' };
    } else if (roll < 0.1) {
      // 传承秘宝 9%
      tier = 'legacy';
      const base: WeaponBase = {
        category: ['武道兵刃', '玄门法宝', '奇物异宝'][Math.floor(Math.random() * 3)],
        type: ['sword', 'dao', 'spear', 'fan', 'ring'][Math.floor(Math.random() * 5)],
        grade: '道纹',
        baseMaterial: ['star_essence', 'lightning_wood', 'jade', 'black_iron'][Math.floor(Math.random() * 4)],
      };
      const dirs: SelectedDirections = randomDirections(base);
      const composed = composeTraits(dirs, base);
      const weapon = randomWeapon(base);
      fullData = { ...weapon, selectedDirections: dirs, generatedTraits: composed.traits, type: 'weapon' };
      trueName = weapon.name || '未命名秘宝';
    } else {
      // 有灵秘宝 90%
      tier = 'spirit';
      const base: WeaponBase = {
        category: ['武道兵刃', '玄门法宝', '邪道魔兵', '奇物异宝'][Math.floor(Math.random() * 4)],
        type: ['sword', 'dao', 'spear', 'hammer', 'whip', 'fan'][Math.floor(Math.random() * 6)],
        grade: Math.random() < 0.6 ? '灵淬' : '宝胎',
        baseMaterial: ['iron', 'copper', 'jade', 'bone', 'wood'][Math.floor(Math.random() * 5)],
      };
      const dirs: SelectedDirections = randomDirections(base);
      const composed = composeTraits(dirs, base);
      const weapon = randomWeapon(base);
      fullData = { ...weapon, selectedDirections: dirs, generatedTraits: composed.traits, type: 'weapon' };
      trueName = weapon.name || '未命名秘宝';
    }

    const isFake = Math.random() < fakeRatio;
    const fakeReveals = [
      '这东西是邪物，用久了会侵蚀心智',
      '这是个残次品，核心禁制是断的，随时可能炸',
      '这是春宫书里夹的道具，正经人用不了',
      '这是仿品，真品在某个大人物手里',
      '这东西被诅咒过，前主人就是被它害死的',
    ];

    items.push({
      tempId,
      itemType: 'secret',
      secretTier: tier,
      displayName: randomAppearance(),
      appearance: '灰扑扑的不起眼物件，拿在手里却有种说不清的感觉。',
      trueName,
      fullData,
      isFake,
      fakeReveal: isFake ? fakeReveals[Math.floor(Math.random() * fakeReveals.length)] : null,
      huntLocation: location,
    });
    tempId++;
  }

  return { location, items, secretCount: items.length };
}
