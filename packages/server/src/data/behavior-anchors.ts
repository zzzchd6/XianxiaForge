/**
 * 仙侠行为锚点库（双引擎 PRD v1.3 §7.8，评审确认存储方案）
 *
 * 三层冰山 Step 3（行为锚点生成）的预制素材库：
 * 每种真实情绪对应一组"下意识动作/微表情"锚点，与表层台词形成反差。
 * 使用方式：生成时按情绪类型匹配 2-3 个候选锚点注入 Prompt，
 * 再由 LLM 结合具体场景微调，保证不重复、不违和。
 *
 * 参照 data/trait-directions.ts 模式：接口定义 + 常量数组导出。
 * 新增题材库（如都市/玄幻）仅需新增导出文件，不改核心代码。
 */

// ============================================================
// 类型
// ============================================================

/** 情绪键（用于程序匹配） */
export type BehaviorEmotionKey =
  | 'tension'      // 紧张/害怕
  | 'attraction'   // 心动/在意
  | 'rage'         // 愤怒/杀意
  | 'concealment'  // 隐瞒/撒谎
  | 'worry'        // 心疼/担忧
  | 'sorrow'       // 失落/难过
  | 'surprise';    // 惊喜/激动

export interface BehaviorAnchorGroup {
  /** 情绪键 */
  key: BehaviorEmotionKey;
  /** 真实情绪（展示用） */
  emotion: string;
  /** 表层台词方向（与真实情绪的反差面） */
  surfaceDirection: string;
  /** 预制行为锚点（下意识动作/微表情，仙侠语境） */
  anchors: string[];
  /** 情绪关键词（用于从真实情绪文本反向匹配锚点组） */
  matchWords: string[];
}

// ============================================================
// 仙侠行为锚点库（§7.8 全表）
// ============================================================

export const XIANXIA_BEHAVIOR_ANCHORS: BehaviorAnchorGroup[] = [
  {
    key: 'tension',
    emotion: '紧张/害怕',
    surfaceDirection: '强装镇定',
    anchors: [
      '指尖无意识摩挲剑柄',
      '呼吸节奏乱了',
      '灵力波动不稳',
      '掌心悄悄捏了张符',
    ],
    matchWords: ['紧张', '害怕', '恐惧', '不安', '忐忑', '慌乱', '惊慌', '畏惧'],
  },
  {
    key: 'attraction',
    emotion: '心动/在意',
    surfaceDirection: '故作冷淡',
    anchors: [
      '眼神下意识追着对方走',
      '御剑时不自觉放慢速度等对方',
      '袖中手指蜷了蜷',
    ],
    matchWords: ['心动', '在意', '喜欢', '倾慕', '牵挂', '惦记', '舍不得', '情愫'],
  },
  {
    key: 'rage',
    emotion: '愤怒/杀意',
    surfaceDirection: '客气微笑',
    anchors: [
      '袖中手指掐了个法诀',
      '周身灵气温度骤降',
      '眼底闪过一道冷光',
      '剑鞘微微震颤',
    ],
    matchWords: ['愤怒', '杀意', '怒火', '恨意', '嫉恨', '恼怒', '愤恨', '怨毒'],
  },
  {
    key: 'concealment',
    emotion: '隐瞒/撒谎',
    surfaceDirection: '言之凿凿',
    anchors: [
      '说话时避开对方眼睛',
      '下意识摸了摸怀中藏着的某物',
      '语速比平时快了半分',
    ],
    matchWords: ['隐瞒', '撒谎', '心虚', '藏着', '掩饰', '不敢承认', '有秘密', '欺瞒'],
  },
  {
    key: 'worry',
    emotion: '心疼/担忧',
    surfaceDirection: '嘴硬训斥',
    anchors: [
      '嘴上骂得凶，手却先递了颗疗伤丹过去',
      '目光在对方伤口上停了三息才移开',
    ],
    matchWords: ['心疼', '担忧', '担心', '护短', '挂念', '不忍', '怜惜'],
  },
  {
    key: 'sorrow',
    emotion: '失落/难过',
    surfaceDirection: '说没事',
    anchors: [
      '垂在身侧的手攥了又松',
      '低头看着自己的鞋尖',
      '喉结动了动，把话咽了回去',
    ],
    matchWords: ['失落', '难过', '悲伤', '委屈', '酸涩', '怅然', '落寞', '心灰'],
  },
  {
    key: 'surprise',
    emotion: '惊喜/激动',
    surfaceDirection: '故作平静',
    anchors: [
      '瞳孔微微一缩',
      '握着剑的手紧了紧',
      '呼吸顿了一拍',
      '嘴角压了又压还是翘了起来',
    ],
    matchWords: ['惊喜', '激动', '振奋', '狂喜', '雀跃', '意外之喜', '喜出望外'],
  },
];

/** 库名 → 锚点库映射（schema 中 behavior_anchor_library 字段对应） */
export const BEHAVIOR_ANCHOR_LIBRARIES: Record<string, BehaviorAnchorGroup[]> = {
  xianxia_default: XIANXIA_BEHAVIOR_ANCHORS,
};

/**
 * 从真实情绪描述文本匹配锚点组（关键词命中；无命中返回 null 由 LLM 自由发挥）
 */
export function matchAnchorGroup(emotionText: string, library = 'xianxia_default'): BehaviorAnchorGroup | null {
  const lib = BEHAVIOR_ANCHOR_LIBRARIES[library] ?? XIANXIA_BEHAVIOR_ANCHORS;
  let best: { group: BehaviorAnchorGroup; hits: number } | null = null;
  for (const group of lib) {
    const hits = group.matchWords.filter((w) => emotionText.includes(w)).length;
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { group, hits };
    }
  }
  return best?.group ?? null;
}
