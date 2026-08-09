/**
 * 人物功法个人变种规则引擎（确定性零token，附录N「千人千面法则」）
 *
 * 四大影响因子（全部可追溯至人物自身属性，无凭空强化）：
 *  1. 道则亲和因子 ← 人物天赋·圣体魔躯类（talents category='body'）
 *  2. 心性性格因子 ← 内在性格 innerPersonality + 外在性格 outerPersonality[]
 *  3. 出身经历因子 ← 人物天赋·宿世出身类（talents category='origin'）
 *  4. 种族特质因子 ← raceCategory + raceSub
 *
 * 铁律：
 *  - 边界不变：变种不新增基础功法未含道则能力，仅调整权重/偏向/代价/运用方式
 *  - 代价对等：每项增益偏向必伴随对应代价偏向
 *  - 程度分级：稀有度 common(60)/remarkable(30)/rare(10)，属性越特殊差异越大
 */

import {
  getDao, getCoreTrait, getAbility, getBacklash, type DaoId,
} from '../data/technique-catalog.js';

// ============================================================
// 类型
// ============================================================

export type VariantRarity = 'common' | 'remarkable' | 'rare';

export interface VariantDraft {
  variantName: string;
  rarity: VariantRarity;
  daoWeightOffset: { mainDao: string; assistDao: string[]; note: string };
  traitOffset: { id: string; name: string; change: string; derived?: boolean }[];
  abilityVariant: { baseId: string; baseName: string; variantName: string; change: string }[];
  backlashOffset: { id: string; name: string; change: string }[];
  bodyMark: { appearance: string; aura: string; behavior: string; breath: string };
  exclusiveSkill: string[];
  cultivationEffect: { speed: string; bottleneck: string; risk: string; note: string };
  /** 因子溯源摘要（供审计「属性溯源校验」与前端展示） */
  factorTrace: string[];
}

/** 人物四因子原始输入（custom_character 行 + 解析后的天赋分类） */
export interface VariantCharacterInput {
  name: string;
  raceCategory: string;
  raceSub: string;
  innerPersonality: string;
  outerPersonality: string[];
  /** 圣体魔躯类天赋名（category='body'） */
  bodyTalents: string[];
  /** 宿世出身类天赋名（category='origin'） */
  originTalents: string[];
}

/** 基础功法原始输入（custom_technique 行） */
export interface VariantTechniqueInput {
  name: string;
  mainDao: string;
  assistDao: string[];
  styleType: string;
  coreTraits: string[];
  abilities: string[];
  backlash: string[];
  bodyMark?: { appearance?: string; aura?: string; behavior?: string; breath?: string };
}

export interface VariantLock {
  rarity?: VariantRarity;
  /** 锁定出身偏向（保留上次出身因子产出） */
  originBias?: boolean;
}

// ============================================================
// 道则关键词分类器（用于把圣体魔躯天赋归到对应道则）
// ============================================================

const DAO_KEYWORDS: Record<DaoId, string[]> = {
  gengjin: ['庚金', '金', '锋', '剑', '锐', '剑骨'],
  kunearth: ['坤土', '厚土', '玄黄', '岳', '山', '重力', '不动明王'],
  thunder: ['雷', '电', '霆', '紫霄', '紫极'],
  mingshi: ['魔', '蚀', '冥', '腐朽', '毒', '秽', '幽', '梦魇'],
  void: ['虚空', '空', '界', '宇', '玄空', '空间'],
  suishi: ['岁时', '时', '光阴', '宙', '因果'],
  xingzhi: ['不坏', '金刚', '长生', '形质', '肉身', '躯'],
  lingqi: ['灵气', '五行', '灵根', '元素', '道胎'],
  shenhun: ['神魂', '魂', '神识', '幻海', '天韵', '灵体'],
};

/** 通用道胎关键词（全道则加速，无单项极端强化） */
const GENERAL_DAO_KEYWORDS = ['先天道胎', '元素之体', '道胎', '万法道胎'];

function classifyDao(text: string): DaoId | null {
  let best: DaoId | null = null;
  let bestScore = 0;
  (Object.keys(DAO_KEYWORDS) as DaoId[]).forEach((dao) => {
    const score = DAO_KEYWORDS[dao].reduce((s, kw) => s + (text.includes(kw) ? kw.length : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = dao;
    }
  });
  return bestScore > 0 ? best : null;
}

// ============================================================
// 心性性格因子映射
// ============================================================

interface PersonalityBias {
  bias: string;
  cost: string;
  trace: string;
}

const INNER_PERSONALITY_MAP: Record<string, PersonalityBias> = {
  无私: { bias: '守御属性增幅，护友类效果强化，可替人分担反噬', cost: '自身承受反噬概率+15%', trace: '内在·无私' },
  正直: { bias: '守御属性增幅，护友类效果强化，可替人分担反噬', cost: '自身承受反噬概率+15%', trace: '内在·正直' },
  中庸: { bias: '攻防趋于均衡，无明显偏向', cost: '爆发与续航均不突出', trace: '内在·中庸' },
  狂邪: { bias: '爆发属性增幅，损人利己效果强化，可转嫁部分反噬', cost: '长期道基损耗风险+20%', trace: '内在·狂邪' },
  利己: { bias: '爆发属性增幅，损人利己效果强化，可转嫁部分反噬', cost: '长期道基损耗风险+20%', trace: '内在·利己' },
  邪恶: { bias: '爆发属性增幅，损人利己效果强化，可转嫁部分反噬', cost: '长期道基损耗风险+20%', trace: '内在·邪恶' },
};

const OUTER_PERSONALITY_MAP: Record<string, PersonalityBias> = {
  杀伐果断: { bias: '攻伐爆发提升，破甲/致死效果强化', cost: '续航减弱，反噬更集中', trace: '外在·杀伐果断' },
  谨慎沉稳: { bias: '防御/续航稳定性提升，失控概率大幅降低', cost: '爆发上限降低，反应略减', trace: '外在·谨慎沉稳' },
  孤僻隐忍: { bias: '隐匿/偷袭效果强化，气息收敛能力提升', cost: '正面硬碰威力减弱', trace: '外在·孤僻隐忍' },
  跳脱随性: { bias: '招式灵活度提升，变招加快，偏门技巧更多', cost: '功法稳定性降低，失误概率略增', trace: '外在·跳脱随性' },
  贪财好酒: { bias: '资源类辅助效果强化，特定状态下额外加成', cost: '心性反噬加重，易因外物乱心', trace: '外在·贪财好酒' },
};

// ============================================================
// 出身经历因子映射（关键词 → 偏向 + 专属运用技巧）
// ============================================================

interface OriginBias {
  bias: string;
  skills: string[];
  trace: string;
}

const ORIGIN_RULES: { keywords: string[]; bias: string; skills: string[]; label: string }[] = [
  { keywords: ['武将', '军伍', '军旅', '战阵', '镖局'], bias: '杀伐破甲偏向，军阵适配性强，群战效果提升', skills: ['军阵聚气', '破阵冲锋', '连斩续航'], label: '军伍出身' },
  { keywords: ['书香', '儒门', '读书', '诗书'], bias: '操控精细度提升，续航绵长，意境加成', skills: ['以意御气', '文气镇心', '卸力化劲'], label: '书香门第' },
  { keywords: ['乞丐', '流浪', '街头'], bias: '隐匿求生偏向，闪避与续航能力强化', skills: ['敛息藏气', '就地取材', '残躯续战'], label: '流浪出身' },
  { keywords: ['世家', '宗门', '嫡传', '道童', '三清'], bias: '根基扎实，功法体系完整，进阶路径清晰', skills: ['正统调息', '宗门合击', '典籍推演'], label: '世家嫡传' },
  { keywords: ['工匠', '医者', '医药', '百工', '炼器'], bias: '精微操控偏向，对器物/肉身的细节操控更强', skills: ['循经点穴', '拆器卸力', '以气疗伤'], label: '工匠医者' },
  { keywords: ['猎户', '渔家', '渔', '水乡'], bias: '追踪伏击偏向，野外环境适配性极强', skills: ['借地形掩护', '追踪气脉', '预判轨迹'], label: '猎户渔家' },
  { keywords: ['转世', '遗脉', '前世', '因果', '锦鲤'], bias: '功法契合度高，易触碰先辈遗留感悟', skills: ['残忆悟道', '前世招式', '血脉共鸣'], label: '转世遗脉' },
];

function resolveOriginBias(originTalents: string[]): OriginBias | null {
  for (const t of originTalents) {
    for (const rule of ORIGIN_RULES) {
      if (rule.keywords.some((kw) => t.includes(kw))) {
        return { bias: rule.bias, skills: rule.skills, trace: `出身·${rule.label}（${t}）` };
      }
    }
  }
  return null;
}

// ============================================================
// 种族特质因子映射
// ============================================================

interface RaceBias {
  bias: string;
  feature: string;
  trace: string;
}

const RACE_CATEGORY_MAP: Record<string, RaceBias> = {
  human: { bias: '兼容性最强，无极端偏向，可适配所有变种方向', feature: '创新能力最强，更易推演深化出新招式', trace: '种族·人族' },
  demon_race: { bias: '炼体类功法大幅强化，肉身偏向妖化；术法类精度略降', feature: '可催发半妖形态，功法附带种族天赋', trace: '种族·妖族' },
  demon_king_race: { bias: '攻伐/邪道功法威力强化，反噬方式偏向心神侵蚀', feature: '魔气自带压制效果，正道功法抗性提升', trace: '种族·魔族' },
  ghost_race: { bias: '神魂/阴属性功法强化，隐匿与穿墙能力天然适配', feature: '阴寒气息更重，阳属性克制伤害加深', trace: '种族·鬼族' },
  spirit_race: { bias: '灵气/五行功法亲和度高，修炼速度快；肉身强度偏弱', feature: '天生与道则共鸣，进阶瓶颈更少', trace: '种族·灵族' },
  divine_race: { bias: '功法上限更高，道境突破概率提升；进阶速度偏慢', feature: '自带血脉威压，低阶修士易被震慑', trace: '种族·神族后裔' },
  hybrid_race: { bias: '双族天赋叠加，变种更具独特性；冲突风险升高', feature: '同时拥有两族特征，也承受两族短板', trace: '种族·混血种' },
};

// ============================================================
// 稀有度骰子（60/30/10）
// ============================================================

function rollRarity(rand: () => number): VariantRarity {
  const r = rand() * 100;
  if (r < 60) return 'common';
  if (r < 90) return 'remarkable';
  return 'rare';
}

const RARITY_LABEL: Record<VariantRarity, string> = {
  common: '普通变种',
  remarkable: '显著变种',
  rare: '稀有异变',
};

// ============================================================
// 变种命名（确定性：基础名 + 风格前缀/后缀）
// ============================================================

const STYLE_PREFIX: Record<string, string[]> = {
  attack: ['破阵', '隐锋', '裂空', '诛'],
  defense: ['镇岳', '守御', '磐石', '护'],
  cultivate: ['养气', '归元', '玄', '太'],
  assist: ['通玄', '辅元', '灵', '妙'],
  special: ['诡', '幽', '奇', '秘'],
};

function buildVariantName(baseName: string, styleType: string, rand: () => number): string {
  // 基础名多为《XX诀/经/典/功》，取核心二字插前缀
  const core = baseName.replace(/[《》]/g, '');
  const prefixes = STYLE_PREFIX[styleType] || STYLE_PREFIX.special;
  const prefix = prefixes[Math.floor(rand() * prefixes.length)];
  // 若核心含「诀/经/典/功/法」，前缀插于其前
  const m = core.match(/^(.*?)(诀|经|典|功|法|录|卷)$/);
  if (m) return `${prefix}${m[1]}${m[2]}`;
  return `${prefix}${core}`;
}

// ============================================================
// 主引擎
// ============================================================

export interface GenerateOptions {
  lock?: VariantLock;
  /** 可注入的随机源（默认 Math.random），便于确定性测试 */
  rand?: () => number;
}

export function generateVariant(
  character: VariantCharacterInput,
  technique: VariantTechniqueInput,
  options: GenerateOptions = {}
): VariantDraft {
  const rand = options.rand || Math.random;
  const lock = options.lock || {};
  const factorTrace: string[] = [];

  const techniqueDaos = new Set<string>([technique.mainDao, ...technique.assistDao]);
  const mainDaoName = getDao(technique.mainDao as DaoId)?.name.replace('道则', '') || technique.mainDao;

  // ---- 稀有度 ----
  const rarity = lock.rarity || rollRarity(rand);
  // 稀有度决定偏移项数：common 1-2 / remarkable 3-4 / rare 全开+衍生
  const budget = rarity === 'common' ? 2 : rarity === 'remarkable' ? 4 : 99;

  // ---- 因子1：道则亲和（圣体魔躯） ----
  let speedBonus = 0;
  let backlashRelief = false;
  let derivedTrait: { id: string; name: string; change: string; derived: boolean } | null = null;
  const generalDao = character.bodyTalents.some((t) => GENERAL_DAO_KEYWORDS.some((kw) => t.includes(kw)));
  if (generalDao) {
    speedBonus += 15;
    factorTrace.push('道则亲和·通用道胎（全道则修炼速度+15%，反噬概率-10%）');
  }
  for (const t of character.bodyTalents) {
    const dao = classifyDao(t);
    if (dao && techniqueDaos.has(dao)) {
      speedBonus += 20;
      backlashRelief = true;
      const daoName = getDao(dao)?.name.replace('道则', '') || dao;
      factorTrace.push(`道则亲和·${t}（契合${daoName}道则，特质强化/修炼速度+20%/反噬减轻）`);
      // 对应道则强化：rare 或 显著时新增微衍生特质
      if (!derivedTrait && (rarity !== 'common' || rand() < 0.3)) {
        derivedTrait = {
          id: `derived_${dao}`,
          name: `${daoName}自生`,
          change: `${daoName}之力自发凝聚，无需刻意催动即可小幅增益`,
          derived: true,
        };
      }
    } else if (dao === 'mingshi' && !techniqueDaos.has('mingshi')) {
      factorTrace.push(`道则亲和·${t}（魔躯修非冥蚀正道功法，修炼难度+30%，反噬加重）`);
      speedBonus -= 30;
    }
  }

  // ---- 因子2：心性性格 ----
  const personalityBiases: PersonalityBias[] = [];
  const inner = INNER_PERSONALITY_MAP[character.innerPersonality];
  if (inner && budget >= 1) personalityBiases.push(inner);
  for (const o of character.outerPersonality) {
    const ob = OUTER_PERSONALITY_MAP[o];
    if (ob) personalityBiases.push(ob);
  }

  // ---- 因子3：出身经历 ----
  const origin = resolveOriginBias(character.originTalents);
  if (origin) factorTrace.push(origin.trace);

  // ---- 因子4：种族特质 ----
  const race = RACE_CATEGORY_MAP[character.raceCategory];
  if (race) factorTrace.push(`${race.trace}（${race.bias}）`);

  // ============================================================
  // 组装产出字段
  // ============================================================

  // 道则权重偏移（不新增道则，仅主辅占比微调）
  const assistNames = technique.assistDao.map((d) => getDao(d as DaoId)?.name.replace('道则', '') || d);
  let daoNote = '维持基础功法主辅道则配比';
  if (technique.assistDao.length && (rarity !== 'common')) {
    daoNote = `主修${mainDaoName}占比提升、辅修${assistNames.join('、')}占比降低，偏向纯${mainDaoName}输出`;
  }
  const daoWeightOffset = { mainDao: technique.mainDao, assistDao: technique.assistDao, note: daoNote };

  // 本源特质偏移（原有特质强弱调整 + 可选衍生）
  const traitOffset: VariantDraft['traitOffset'] = [];
  for (const tid of technique.coreTraits) {
    const trait = getCoreTrait(tid);
    if (!trait) continue;
    if (backlashRelief || rarity !== 'common') {
      traitOffset.push({ id: tid, name: trait.name, change: '强度提升，运转更为凝练' });
    }
  }
  if (derivedTrait && rarity !== 'common') traitOffset.push(derivedTrait);

  // 神通变种（表现形式/偏向改变，不新增道则外神通）
  const abilityVariant: VariantDraft['abilityVariant'] = [];
  const styleVerb: Record<string, string> = {
    attack: '范围扩大、破甲提升',
    defense: '护体范围扩展、更趋稳固',
    cultivate: '运转更绵长、续航增强',
    assist: '增益范围扩大、更精微',
    special: '角度诡谲、出其不意',
  };
  const verb = styleVerb[technique.styleType] || '运用更趋精纯';
  for (const aid of technique.abilities.slice(0, rarity === 'common' ? 1 : 3)) {
    const ab = getAbility(aid);
    if (!ab) continue;
    abilityVariant.push({
      baseId: aid,
      baseName: ab.name,
      variantName: ab.name.replace(/斩|击|刺|诀|术/, '变') || `${ab.name}·变`,
      change: verb,
    });
  }

  // 反噬偏移（增益对等代价）
  const backlashOffset: VariantDraft['backlashOffset'] = [];
  for (const bid of technique.backlash) {
    const b = getBacklash(bid);
    if (!b) continue;
    if (backlashRelief) {
      backlashOffset.push({ id: bid, name: b.name, change: '触发概率降低，程度减轻（体质契合）' });
    } else if (personalityBiases.length) {
      backlashOffset.push({ id: bid, name: b.name, change: '反噬更集中，爆发后代价前置' });
    }
  }
  // 代价对等：有增益偏向但基础功法无反噬时，补一条心性/道基代价
  if (personalityBiases.length && !backlashOffset.length) {
    backlashOffset.push({ id: 'derived_cost', name: '心性反噬', change: personalityBiases[0].cost });
  }

  // 专属身体印记（基础印记 + 人物专属）
  const baseMark = technique.bodyMark || {};
  const raceFeature = race?.feature || '';
  const bodyMark = {
    appearance: [baseMark.appearance, origin ? `${origin.trace.replace('出身·', '')}烙印` : ''].filter(Boolean).join('，'),
    aura: [baseMark.aura, raceFeature ? `气息带${raceFeature}` : ''].filter(Boolean).join('，'),
    behavior: baseMark.behavior || '',
    breath: baseMark.breath || '',
  };

  // 专属运用技巧（出身背景 + 种族，rare 可叠加）
  const exclusiveSkill: string[] = [];
  if (origin) exclusiveSkill.push(origin.skills[0]);
  if (rarity === 'rare' && origin && origin.skills[1]) exclusiveSkill.push(origin.skills[1]);
  if (rarity !== 'common' && raceFeature) exclusiveSkill.push(race.feature);

  // 修炼适配效果
  const speedStr = speedBonus > 0 ? `+${speedBonus}%` : speedBonus < 0 ? `${speedBonus}%` : '持平';
  const cultivationEffect = {
    speed: speedStr,
    bottleneck: backlashRelief || race?.bias.includes('瓶颈') ? '瓶颈减少' : '与基础功法相当',
    risk: backlashRelief ? '反噬减轻' : personalityBiases.length ? '反噬略增（心性使然）' : '与基础功法相当',
    note: [
      personalityBiases.map((p) => p.bias).join('；'),
      origin?.bias || '',
      race?.bias || '',
    ].filter(Boolean).join('；'),
  };

  // 心性/出身/种族 trace 补全
  for (const p of personalityBiases) factorTrace.push(`心性·${p.trace}（${p.bias}｜代价：${p.cost}）`);

  const variantName = buildVariantName(technique.name, technique.styleType, rand);

  return {
    variantName,
    rarity,
    daoWeightOffset,
    traitOffset,
    abilityVariant,
    backlashOffset,
    bodyMark,
    exclusiveSkill,
    cultivationEffect,
    factorTrace,
  };
}

export const RARITY_WEIGHTS = { common: 60, remarkable: 30, rare: 10 };
export { RARITY_LABEL };

// ============================================================
// 变种一致性校验（附录N 第五节，零token不变式检查）
// ============================================================

export interface VariantIssue {
  rule: '道则边界' | '代价对等' | '属性溯源';
  severity: 'major' | 'minor';
  message: string;
}

/**
 * 校验变种草稿是否满足三大不变式。生成引擎本身已保证这些约束，
 * 此函数作为安全网在落库前/审计时复核，杜绝越界强化。
 */
export function validateVariant(draft: VariantDraft, technique: VariantTechniqueInput): VariantIssue[] {
  const issues: VariantIssue[] = [];
  const baseDaos = new Set<string>([technique.mainDao, ...technique.assistDao]);

  // 1. 道则边界：不得新增基础功法未含道则
  const offsetDaos = [draft.daoWeightOffset.mainDao, ...draft.daoWeightOffset.assistDao];
  for (const d of offsetDaos) {
    if (d && !baseDaos.has(d)) {
      issues.push({ rule: '道则边界', severity: 'major', message: `变种引入了基础功法未含的道则「${d}」，突破道则边界。` });
    }
  }
  for (const t of draft.traitOffset) {
    if (t.derived && t.id.startsWith('derived_')) {
      const dao = t.id.replace('derived_', '');
      if (!baseDaos.has(dao)) {
        issues.push({ rule: '道则边界', severity: 'major', message: `衍生特质「${t.name}」对应道则「${dao}」不在基础功法道则集合内。` });
      }
    }
  }

  // 2. 代价对等：有增益偏向必须有代价偏向
  const hasGain = draft.traitOffset.length > 0 || draft.abilityVariant.length > 0 || draft.exclusiveSkill.length > 0;
  const hasCost = draft.backlashOffset.length > 0;
  if (hasGain && !hasCost) {
    issues.push({ rule: '代价对等', severity: 'major', message: '变种存在增益偏向但无任何反噬/代价偏移，违反代价对等原则。' });
  }

  // 3. 属性溯源：差异必须可追溯至人物属性
  if (!draft.factorTrace.length) {
    issues.push({ rule: '属性溯源', severity: 'minor', message: '变种无任何因子溯源记录，差异来源不明。' });
  }

  return issues;
}
