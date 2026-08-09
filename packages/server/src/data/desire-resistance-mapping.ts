/**
 * 仙侠七寸映射表（双引擎 PRD v1.3 §8.8）+ 代价五级升级链（§8.7）
 *
 * 冲突引擎 Phase 2（阻力降临）的核心素材：
 * 欲望类型 → 七寸（主角最在乎的）→ 对应阻力设计方向，
 * 确保阻力精准打在欲望的核心上，而不是随便的刁难。
 *
 * 参照 data/trait-directions.ts 模式：接口定义 + 常量数组导出。
 * 新增题材映射表仅需新增导出文件，不改核心代码。
 */

// ============================================================
// 类型
// ============================================================

/** 欲望类型键（与 §11.2 desire_type 枚举一一对应） */
export type DesireTypeKey =
  | 'power'       // 求道/变强
  | 'dignity'     // 尊严/认可
  | 'protection'  // 保护/情义
  | 'revenge'     // 复仇/执念
  | 'freedom'     // 自由/自主
  | 'promise';    // 承诺/信义

export interface DesireResistanceEntry {
  /** 欲望类型键 */
  desireType: DesireTypeKey;
  /** 欲望类型（展示用） */
  label: string;
  /** 七寸：主角最在乎的 */
  sevenInch: string;
  /** 对应阻力设计方向（候选清单） */
  resistanceDesigns: string[];
  /** 仙侠示例 */
  xianxiaExample: string;
  /** 欲望关键词（用于从欲望描述文本反向推断欲望类型，auto 模式用） */
  matchWords: string[];
}

// ============================================================
// 仙侠七寸映射表（§8.8 全表）
// ============================================================

export const XIANXIA_DESIRE_RESISTANCE_MAPPING: DesireResistanceEntry[] = [
  {
    desireType: 'power',
    label: '求道/变强',
    sevenInch: '道心/修为/天赋',
    resistanceDesigns: [
      '废掉修为',
      '被污蔑走火入魔',
      '道心被质疑',
      '灵根被废',
    ],
    xianxiaExample: '当众被测出是"废灵根"，修炼十年一场空',
    matchWords: ['变强', '修为', '修炼', '求道', '突破', '天赋', '灵根', '功法', '机缘', '境界'],
  },
  {
    desireType: 'dignity',
    label: '尊严/认可',
    sevenInch: '宗门地位/他人眼光/道号',
    resistanceDesigns: [
      '当众逐出师门',
      '被从族谱除名',
      '所有人都唾弃',
      '道号被收回',
    ],
    xianxiaExample: '宗门大典上被当众剥去内门弟子身份，从云端跌入泥里',
    matchWords: ['尊严', '认可', '地位', '颜面', '名声', '道号', '身份', '看得起', '尊重', '证明'],
  },
  {
    desireType: 'protection',
    label: '保护/情义',
    sevenInch: '想保护的人/师门/兄弟',
    resistanceDesigns: [
      '当着他的面伤害他想保护的人',
      '逼他亲手伤害',
      '用在乎的人要挟',
    ],
    xianxiaExample: '反派当着主角的面，一掌拍碎了他小师妹的灵根',
    matchWords: ['保护', '守护', '师门', '兄弟', '师妹', '师兄', '在乎的人', '情义', '救人', '护住'],
  },
  {
    desireType: 'revenge',
    label: '复仇/执念',
    sevenInch: '复仇机会/仇人下落/真相',
    resistanceDesigns: [
      '仇人就在眼前却动不了',
      '被反咬一口成了凶手',
      '唯一线索被毁',
    ],
    xianxiaExample: '好不容易找到杀父仇人，却发现自己修为被封，连剑都握不住',
    matchWords: ['复仇', '报仇', '仇人', '执念', '真相', '血债', '杀父', '恨', '讨回公道'],
  },
  {
    desireType: 'freedom',
    label: '自由/自主',
    sevenInch: '选择权/命运掌控',
    resistanceDesigns: [
      '被当成棋子',
      '被迫做不想做的事',
      '命运被别人安排',
    ],
    xianxiaExample: '被宗门强行安排联姻，对方是他最讨厌的人，拒绝就是背叛宗门',
    matchWords: ['自由', '自主', '选择', '命运', '掌控', '联姻', '安排', '棋子', '束缚', '挣脱'],
  },
  {
    desireType: 'promise',
    label: '承诺/信义',
    sevenInch: '承诺过的事/别人的信任',
    resistanceDesigns: [
      '被污蔑背信弃义',
      '无法兑现承诺',
      '信任的人背叛他',
    ],
    xianxiaExample: '他答应过师父要守住宗门，结果所有人都认为是他通敌卖了宗门',
    matchWords: ['承诺', '信义', '答应', '托付', '信任', '约定', '誓言', '嘱托', '守约'],
  },
];

/** 映射表名 → 映射表（schema 中 seven_inch_mapping 字段对应） */
export const SEVEN_INCH_MAPPINGS: Record<string, DesireResistanceEntry[]> = {
  xianxia_default: XIANXIA_DESIRE_RESISTANCE_MAPPING,
};

/** 按欲望类型键取七寸条目 */
export function getSevenInchEntry(
  desireType: DesireTypeKey | undefined,
  mapping = 'xianxia_default'
): DesireResistanceEntry | null {
  if (!desireType) return null;
  const table = SEVEN_INCH_MAPPINGS[mapping] ?? XIANXIA_DESIRE_RESISTANCE_MAPPING;
  return table.find((e) => e.desireType === desireType) ?? null;
}

/**
 * 从欲望描述文本推断欲望类型（desire_type=auto 时用，关键词命中最多者）
 */
export function inferDesireType(desireText: string, mapping = 'xianxia_default'): DesireTypeKey | null {
  const table = SEVEN_INCH_MAPPINGS[mapping] ?? XIANXIA_DESIRE_RESISTANCE_MAPPING;
  let best: { key: DesireTypeKey; hits: number } | null = null;
  for (const entry of table) {
    const hits = entry.matchWords.filter((w) => desireText.includes(w)).length;
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { key: entry.desireType, hits };
    }
  }
  return best?.key ?? null;
}

// ============================================================
// 代价五级升级链（§8.7）
// ============================================================

export interface CostLevelEntry {
  /** 等级（schema cost.cost_level 枚举值） */
  level: 'Lv1' | 'Lv2' | 'Lv3' | 'Lv4' | 'Lv5';
  /** 代价类型 */
  name: string;
  /** 仙侠示例 */
  xianxiaExample: string;
  /** 痛感星级（1-5） */
  pain: number;
}

export const COST_LEVEL_CHAIN: CostLevelEntry[] = [
  { level: 'Lv1', name: '即时损失', xianxiaExample: '输了一场比试 / 被扣了月例', pain: 1 },
  { level: 'Lv2', name: '面子损失', xianxiaExample: '当众丢脸 / 被人嘲笑', pain: 2 },
  { level: 'Lv3', name: '尊严损失', xianxiaExample: '被逐出师门 / 道号被收回', pain: 3 },
  { level: 'Lv4', name: '不可逆损失', xianxiaExample: '修为被废 / 灵根受损 / 错过唯一机缘', pain: 4 },
  { level: 'Lv5', name: '存在性损失', xianxiaExample: '道心破碎 / 被从世上抹去', pain: 5 },
];

/** 代价等级 → 条目 */
export function getCostLevel(level: string): CostLevelEntry | null {
  return COST_LEVEL_CHAIN.find((c) => c.level === level) ?? null;
}
