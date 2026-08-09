/**
 * 天命克制自动计算服务（PRD§4.3）
 * 战斗场景自动计算双方武器/功法/人物的克制关系。
 * 在原道则生克基础上，新增特质克制权重（占40%）。
 * 零token，全规则驱动。
 */
import type { GeneratedTrait } from './trait-composer.js';

// ============================================================
// 特质克制表
// ============================================================

interface CounterRule {
  /** 克制方特质关键词 */
  attacker: string[];
  /** 被克制方特质关键词 */
  defender: string[];
  /** 克制描述 */
  desc: string;
  /** 克制强度 0-1 */
  strength: number;
}

const COUNTER_RULES: CounterRule[] = [
  { attacker: ['破甲', '削甲', '重锋', '吹毛断甲'], defender: ['重甲', '护体', '坚韧', '盾'], desc: '破甲克制重甲防御', strength: 0.8 },
  { attacker: ['雷', '电弧', '雷痕', '藏雷'], defender: ['金属', '阴邪', '鬼', '魂'], desc: '雷属性克制金属/阴邪', strength: 0.7 },
  { attacker: ['腐蚀', '魔染', '噬', '血祭'], defender: ['护甲', '再生', '愈合', '生死肌'], desc: '腐蚀克制再生/护甲', strength: 0.7 },
  { attacker: ['轻身', '疾风', '藏锋', '快'], defender: ['重', '锤', '慢', '笨重'], desc: '轻灵克制重武器', strength: 0.6 },
  { attacker: ['火', '焰', '焚', '灼'], defender: ['冰', '寒', '冻', '水'], desc: '火克冰寒', strength: 0.7 },
  { attacker: ['冰', '寒', '冻', '封'], defender: ['火', '焰', '焚', '灼'], desc: '冰克火焰', strength: 0.7 },
  { attacker: ['魂', '神魂', '震荡', '灵魂'], defender: ['肉身', '体修', '金刚'], desc: '魂攻克制体修', strength: 0.6 },
  { attacker: ['毒', '蛊', '瘴'], defender: ['再生', '愈合', '净化'], desc: '毒克制再生', strength: 0.6 },
];

// ============================================================
// 计算函数
// ============================================================

export interface CounterResult {
  /** A对B的克制分 0-1 */
  aOverB: number;
  /** B对A的克制分 0-1 */
  bOverA: number;
  /** 优势方 'A' | 'B' | 'none' */
  advantage: 'A' | 'B' | 'none';
  /** 触发的克制规则描述 */
  rules: string[];
  /** 战斗建议（供Writer参考） */
  suggestion: string;
}

/**
 * 计算两把武器的特质克制关系
 */
export function computeCounter(
  traitsA: GeneratedTrait[],
  traitsB: GeneratedTrait[],
): CounterResult {
  let aScore = 0;
  let bScore = 0;
  const rules: string[] = [];

  const namesA = traitsA.map((t) => `${t.name}${t.desc}`).join(' ');
  const namesB = traitsB.map((t) => `${t.name}${t.desc}`).join(' ');

  for (const rule of COUNTER_RULES) {
    const aHasAttacker = rule.attacker.some((k) => namesA.includes(k));
    const bHasDefender = rule.defender.some((k) => namesB.includes(k));
    const bHasAttacker = rule.attacker.some((k) => namesB.includes(k));
    const aHasDefender = rule.defender.some((k) => namesA.includes(k));

    if (aHasAttacker && bHasDefender) {
      aScore += rule.strength;
      rules.push(`A→B：${rule.desc}`);
    }
    if (bHasAttacker && aHasDefender) {
      bScore += rule.strength;
      rules.push(`B→A：${rule.desc}`);
    }
  }

  // 归一化到 0-1
  const maxScore = Math.max(aScore, bScore, 1);
  const aNorm = aScore / maxScore;
  const bNorm = bScore / maxScore;

  let advantage: 'A' | 'B' | 'none' = 'none';
  if (aNorm - bNorm > 0.2) advantage = 'A';
  else if (bNorm - aNorm > 0.2) advantage = 'B';

  let suggestion = '双方势均力敌，战斗取决于临场发挥。';
  if (advantage === 'A') suggestion = 'A方武器特质克制B方，战斗中A方占优，B方需以巧破力或寻找破绽。';
  else if (advantage === 'B') suggestion = 'B方武器特质克制A方，战斗中B方占优，A方需以巧破力或寻找破绽。';

  return { aOverB: aNorm, bOverA: bNorm, advantage, rules, suggestion };
}
