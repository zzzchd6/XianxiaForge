/**
 * 诛仙遗珍彩蛋（PRD§5.1）
 * 随机武器时 0.1% 概率触发，产出与诛仙原著关联的彩蛋武器。
 * 强度与同品质普通武器一致，仅为情怀彩蛋。
 * 零token，全预设数据。
 */
import type { GeneratedTrait } from './trait-composer.js';
import type { WeaponDraft } from './weapon-random.js';

// ============================================================
// 诛仙遗珍预设池
// ============================================================

interface ZhuxianRelic {
  name: string;
  category: string;
  type: string;
  grade: string;
  baseMaterial: string;
  coreDirection: string[];
  traits: Omit<GeneratedTrait, 'id'>[];
  /** 模糊前尘描述（五感卡 pastMemory 用） */
  vaguePast: string;
  /** 解锁条件提示（对应道则亲和满点的人物绑定后显示） */
  unlockHint: string;
  /** 真实身份（解锁后显示） */
  trueIdentity: string;
}

const RELICS: ZhuxianRelic[] = [
  {
    name: '锈铁残片',
    category: 'martial',
    type: 'sword_straight',
    grade: '道纹',
    baseMaterial: 'unknown_alloy',
    coreDirection: ['庚金', '杀伐'],
    traits: [
      { type: 'forge', name: '肃杀残韵', desc: '锈迹下隐有肃杀之气，靠近时皮肤刺痛', isRare: true, flaw: '杀气太重，心志不坚者握之即狂', sourceDirections: [], isClassic: false, classicId: null },
      { type: 'infuse', name: '古意', desc: '材质年代不可考，灵气探测显示至少万年', isRare: false, flaw: null, sourceDirections: [], isClassic: false, classicId: null },
    ],
    vaguePast: '一块锈铁，隐隐有肃杀之气，似乎在哪里见过。据传是上古大战遗落的碎片，但无人能证实。',
    unlockHint: '需庚金道则亲和满点的人物绑定',
    trueIdentity: '诛仙剑碎片——上古诛仙阵四剑之一的残片，剑意犹存',
  },
  {
    name: '碧绿残珠',
    category: 'taoist',
    type: 'orb',
    grade: '仙蜕',
    baseMaterial: 'spirit_jade',
    coreDirection: ['灵木', '生生'],
    traits: [
      { type: 'hidden', name: '生灭轮转', desc: '珠内隐有生灭之力，可催发万物亦可令其枯萎', isRare: true, flaw: '每次使用折损持有者寿元', sourceDirections: [], isClassic: false, classicId: null },
      { type: 'enchant', name: '碧光', desc: '夜间散发幽幽碧光，对邪祟有天然压制', isRare: false, flaw: null, sourceDirections: [], isClassic: false, classicId: null },
    ],
    vaguePast: '一颗碧绿珠子，触手温润，内有流光转动。来历不明，似与某位上古大人物有关。',
    unlockHint: '需灵木道则亲和满点的人物绑定',
    trueIdentity: '天琊神珠残魄——碧瑶所持天琊神珠碎裂后残留的一缕珠魄',
  },
  {
    name: '焦黑短棍',
    category: 'demonic',
    type: 'staff_short',
    grade: '道纹',
    baseMaterial: 'thunder_wood',
    coreDirection: ['雷火', '刚猛'],
    traits: [
      { type: 'forge', name: '雷焦', desc: '表面焦黑如遭天雷，但坚硬异常，隐有电弧游走', isRare: false, flaw: '雷雨天会引雷，不可在户外久持', sourceDirections: [], isClassic: false, classicId: null },
      { type: 'infuse', name: '噬灵', desc: '能吞噬周围灵气自行修复，但速度极慢', isRare: false, flaw: null, sourceDirections: [], isClassic: false, classicId: null },
    ],
    vaguePast: '一截焦黑短棍，像是被天雷劈过的烧火棍。但细看之下，纹路中似有雷纹流转，绝非凡物。',
    unlockHint: '需雷火道则亲和满点的人物绑定',
    trueIdentity: '天雷棍残段——上古雷部正神遗落人间的法器残段',
  },
];

// ============================================================
// 触发逻辑
// ============================================================

let relicCounter = 0;
function relicTraitId(): string {
  return `relic_${Date.now().toString(36)}_${(relicCounter++).toString(36)}`;
}

export interface RelicResult {
  triggered: boolean;
  relic?: ZhuxianRelic;
  draft?: WeaponDraft;
  traits?: GeneratedTrait[];
}

/**
 * 尝试触发诛仙遗珍彩蛋（0.1%概率）
 * 在 randomWeapon 之后调用，若触发则覆盖结果。
 */
export function tryTriggerRelic(rand: () => number = Math.random): RelicResult {
  if (rand() >= 0.001) return { triggered: false };

  const relic = RELICS[Math.floor(rand() * RELICS.length)];
  const traits: GeneratedTrait[] = relic.traits.map((t) => ({ ...t, id: relicTraitId() }));

  const draft: WeaponDraft = {
    name: relic.name,
    category: relic.category,
    type: relic.type,
    grade: relic.grade,
    fakeGrade: '凡造', // 自动最高伪装
    baseMaterial: relic.baseMaterial,
    forgeTraits: [],
    soakTraits: [],
    attachTraits: [],
    cavityTraits: [],
    soulRefineLevel: 'none',
    coreDirection: relic.coreDirection,
  };

  return { triggered: true, relic, draft, traits };
}

export { RELICS, type ZhuxianRelic };
