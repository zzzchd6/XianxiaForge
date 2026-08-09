/**
 * 自定义功法确定性随机引擎
 * 设计原则：除名号精修与功法详解外全程零 LLM、零 token，结果可控可复现。
 *
 * 权重规则（需求五.1）：
 *  - 指引深度：入门60 / 完整30 / 直指10（取 GUIDANCE_LEVELS.weight）
 *  - 辅修兼容：高:中:冲 = 60:35:5（COMPAT_WEIGHT，G1 定稿）
 *  - 稀有特质/先天矛盾：基础60 / 进阶30 / 稀有10（RARITY_WEIGHT）
 *  - 先天矛盾触发：10%（CONFLICT_TRIGGER_RATE）
 *  - 反噬：入门30%随机1项；完整及以上100%≥1项；对冲100%高风险+长期风险
 *
 * 冲突互斥（需求五.2）：核心特质按 conflictTags 组互斥，随机自动跳过冲突项。
 * 道则边界（核心设定）：所有自动填充字段严格限定在主+辅道则集合内，不越界。
 */
import {
  DAO_IDS, GUIDANCE_LEVELS, STYLE_TYPES, CORE_TRAITS, PRACTICE_PATHS,
  ABILITIES, BACKLASHES, INHERITANCES, THRESHOLDS, BODY_MARKS, USAGE_SKILLS,
  EVOLUTIONS, INHERENT_CONFLICTS, DAO_REALMS,
  COMPAT_WEIGHT, RARITY_WEIGHT, CONFLICT_TRIGGER_RATE,
  daoCompat, hasClash, generateTechniqueName,
  getDao, getStyle,
  type DaoId, type GuidanceDepth, type StyleType, type DaoCompat, type Rarity,
  type CoreTrait, type BodyMark,
} from '../data/technique-catalog.js';

/** 随机产出的功法草稿（与 custom_technique 入库字段对齐） */
export interface TechniqueDraft {
  name: string;
  mainDao: DaoId;
  assistDao: DaoId[];
  guidanceDepth: GuidanceDepth;
  fakeDepth: GuidanceDepth | null;
  styleType: StyleType;
  threshold: string[];
  coreTraits: string[];
  practicePath: string;
  bodyMark: BodyMark;
  usageSkills: string[];
  abilities: string[];
  backlash: string[];
  inheritance: string;
  evolution: string[];
  inherentConflict: string | null;
  coreDirection: string[];
  fitMonk: string[];
  /** 是否含对冲融合（前端/审计提示用，不入库） */
  isClash: boolean;
}

/** 锁定字段：true 表示保留传入值不随机 */
export type TechniqueLock = Partial<Record<
  | 'mainDao' | 'assistDao' | 'guidanceDepth' | 'styleType' | 'coreTraits'
  | 'practicePath' | 'usageSkills' | 'abilities' | 'backlash' | 'inheritance'
  | 'evolution' | 'inherentConflict' | 'name',
  boolean
>>;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 按权重表从候选中抽一个（权重与候选同序） */
function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** 指引深度加权随机（60/30/10） */
function randomGuidance(): GuidanceDepth {
  return weightedPick(
    GUIDANCE_LEVELS.map(g => g.id),
    GUIDANCE_LEVELS.map(g => g.weight),
  );
}

/**
 * 辅修道则加权随机（0-3门）：
 * 先按 COMPAT_WEIGHT 抽一个兼容档位，再从该档位候选中取；对冲档命中后强制收束（不再追加）。
 */
function randomAssist(mainDao: DaoId): DaoId[] {
  const count = Math.floor(Math.random() * 4); // 0..3
  const chosen: DaoId[] = [];
  const candidates = DAO_IDS.filter(d => d !== mainDao);
  for (let i = 0; i < count; i++) {
    const pool = candidates.filter(d => !chosen.includes(d));
    if (pool.length === 0) break;
    // 按兼容档位分组
    const groups: Record<DaoCompat, DaoId[]> = { high: [], mid: [], clash: [] };
    for (const d of pool) groups[daoCompat(mainDao, d)].push(d);
    const tiers = (['high', 'mid', 'clash'] as DaoCompat[]).filter(t => groups[t].length > 0);
    const tier = weightedPick(tiers, tiers.map(t => COMPAT_WEIGHT[t]));
    const dao = pick(groups[tier]);
    chosen.push(dao);
    // 命中对冲：极高风险，不再叠加更多辅修
    if (tier === 'clash') break;
  }
  return chosen;
}

/** 核心特质：按道则集合过滤 + conflictTags 互斥，选 2-3 项 */
function randomCoreTraits(daoSet: DaoId[]): string[] {
  const fits = (t: CoreTrait) => t.fitDao.length === 0 || t.fitDao.some(d => daoSet.includes(d));
  let eligible = CORE_TRAITS.filter(fits);
  if (eligible.length === 0) eligible = CORE_TRAITS.slice();
  const n = 2 + Math.floor(Math.random() * 2); // 2..3
  const chosen: string[] = [];
  const usedTags = new Set<string>();
  const guard = eligible.slice();
  let attempts = 0;
  while (chosen.length < n && guard.length > 0 && attempts < n * 20) {
    attempts++;
    const t = weightedPick(guard, guard.map(x => RARITY_WEIGHT[x.rarity as Rarity] ?? 60));
    const conflict = t.conflictTags.some(tag => usedTags.has(tag));
    const idx = guard.indexOf(t);
    if (conflict || chosen.includes(t.id)) {
      if (idx >= 0) guard.splice(idx, 1);
      continue;
    }
    chosen.push(t.id);
    t.conflictTags.forEach(tag => usedTags.add(tag));
    if (idx >= 0) guard.splice(idx, 1);
  }
  return chosen;
}

/** 适配门槛：按道则集合 + 指引深度 + 体例自动生成（4类各取1） */
function autoThreshold(daoSet: DaoId[], depth: GuidanceDepth, styleType: StyleType, isClash: boolean): string[] {
  const res: string[] = [];
  // 亲和：直指→高等；完整→中等；入门→低等；含辅修→双道亲和；对冲→双道亲和
  if (isClash || daoSet.length > 1) res.push('affinity_dual');
  else if (depth === 'essential') res.push('affinity_high');
  else if (depth === 'complete') res.push('affinity_mid');
  else res.push('affinity_low');
  // 体质：含形质/坤土/炼体倾向→强韧；含神魂/直指本源→神魂稳固；否则寻常
  if (daoSet.includes('xingzhi') || daoSet.includes('kunearth')) res.push('body_strong');
  else if (daoSet.includes('shenhun') || depth === 'essential') res.push('body_soul_stable');
  else res.push('body_normal');
  // 心性：攻伐→杀伐果断；防御/修炼→沉稳坚韧；特殊→隐忍内敛；辅助→沉稳坚韧
  if (styleType === 'attack') res.push('mind_fierce');
  else if (styleType === 'special') res.push('mind_hidden');
  else res.push('mind_calm');
  // 资源：20%特殊环境，10%珍稀材料，其余常规
  const rr = Math.random();
  if (rr < 0.10) res.push('res_costly');
  else if (rr < 0.30) res.push('res_special');
  else res.push('res_normal');
  // 校验所有ID合法
  const valid = new Set(THRESHOLDS.map(t => t.id));
  return res.filter(id => valid.has(id));
}

/** 身体印记：取主修道则印记（主道为根骨之主） */
function autoBodyMark(mainDao: DaoId): BodyMark {
  return BODY_MARKS[mainDao];
}

/** 典型运用技巧：从主+辅道则池中选 3-5 项，尽量覆盖不同层级 */
function randomUsageSkills(daoSet: DaoId[]): string[] {
  const pool = USAGE_SKILLS.filter(s => daoSet.includes(s.dao));
  if (pool.length === 0) return [];
  const n = Math.min(3 + Math.floor(Math.random() * 3), pool.length); // 3..5
  const guard = pool.slice();
  const chosen: string[] = [];
  while (chosen.length < n && guard.length > 0) {
    const idx = Math.floor(Math.random() * guard.length);
    chosen.push(guard[idx].id);
    guard.splice(idx, 1);
  }
  return chosen;
}

/** 分道境配套神通：四档各取适配项，总数 6-8 */
function randomAbilities(daoSet: DaoId[]): string[] {
  const fits = (fitDao: DaoId[]) => fitDao.length === 0 || fitDao.some(d => daoSet.includes(d));
  const chosen: string[] = [];
  // 目标每档 2 项（入微/化境/合道/超脱），超脱池小允许 1 项
  const perRealm: Record<string, number> = { '入微': 2, '化境': 2, '合道': 2, '超脱': 1 };
  for (const realm of DAO_REALMS) {
    const realmPool = ABILITIES.filter(a => a.daoRealm === realm);
    const fitPool = realmPool.filter(a => fits(a.fitDao));
    const source = fitPool.length > 0 ? fitPool : realmPool;
    const want = perRealm[realm] ?? 1;
    const guard = source.slice();
    let got = 0;
    while (got < want && guard.length > 0) {
      const idx = Math.floor(Math.random() * guard.length);
      const a = guard[idx];
      if (!chosen.includes(a.id)) { chosen.push(a.id); got++; }
      guard.splice(idx, 1);
    }
  }
  // 总数上限 8
  return chosen.slice(0, 8);
}

/**
 * 反噬代价：
 *  - 入门指引：30% 随机 1 项常态反噬，否则无
 *  - 完整/直指：100% ≥1 项（1-2 常态 + 0-1 强行催动）
 *  - 对冲融合：强制 ≥1 高风险（强行催动）+ ≥1 长期风险
 */
function randomBacklash(depth: GuidanceDepth, isClash: boolean): string[] {
  const normal = BACKLASHES.filter(b => b.category === 'normal');
  const forced = BACKLASHES.filter(b => b.category === 'forced');
  const longterm = BACKLASHES.filter(b => b.category === 'longterm');
  const chosen: string[] = [];
  const addRandom = (pool: typeof BACKLASHES, n: number) => {
    const guard = pool.filter(b => !chosen.includes(b.id));
    for (let i = 0; i < n && guard.length > 0; i++) {
      const idx = Math.floor(Math.random() * guard.length);
      chosen.push(guard[idx].id);
      guard.splice(idx, 1);
    }
  };

  if (isClash) {
    // 对冲：1-2常态 + 1强行催动(高风险) + 1长期风险
    addRandom(normal, 1 + Math.floor(Math.random() * 2));
    addRandom(forced, 1);
    addRandom(longterm, 1);
    return chosen;
  }
  if (depth === 'rudimentary') {
    if (Math.random() < 0.30) addRandom(normal, 1);
    return chosen;
  }
  // complete / essential
  addRandom(normal, 1 + Math.floor(Math.random() * 2)); // 1-2
  if (Math.random() < 0.5) addRandom(forced, 1);
  return chosen;
}

/** 演化方向：3类各取 0-1，共 2-3 个 */
function randomEvolution(): string[] {
  const types = ['deepen', 'crossover', 'crisis'] as const;
  const chosen: string[] = [];
  for (const t of types) {
    const pool = EVOLUTIONS.filter(e => e.type === t && !chosen.includes(e.id));
    if (pool.length > 0 && Math.random() < 0.8) chosen.push(pick(pool).id);
  }
  // 保底至少 2 个
  while (chosen.length < 2) {
    const rest = EVOLUTIONS.filter(e => !chosen.includes(e.id));
    if (rest.length === 0) break;
    chosen.push(pick(rest).id);
  }
  return chosen.slice(0, 3);
}

/**
 * 生成一部完整随机功法。locked 中标记 true 的字段保留 base 中的值。
 */
export function randomTechnique(base?: Partial<TechniqueDraft>, locked?: TechniqueLock): TechniqueDraft {
  const L = locked || {};
  const b = base || {};

  // 主修道则
  let mainDao = b.mainDao;
  if (!L.mainDao || !mainDao) mainDao = pick(DAO_IDS);

  // 辅修道则
  let assistDao = b.assistDao;
  if (!L.assistDao || !assistDao) assistDao = randomAssist(mainDao!);
  const daoSet: DaoId[] = [mainDao!, ...assistDao!];
  const isClash = hasClash(mainDao!, assistDao!);

  // 指引深度
  let guidanceDepth = b.guidanceDepth;
  if (!L.guidanceDepth || !guidanceDepth) guidanceDepth = randomGuidance();

  // 体例
  let styleType = b.styleType;
  if (!L.styleType || !styleType) styleType = pick(STYLE_TYPES).id;

  // 核心特质
  let coreTraits = b.coreTraits;
  if (!L.coreTraits || !coreTraits) coreTraits = randomCoreTraits(daoSet);

  // 行功路线（对冲倾向融合共生/逆势反修）
  let practicePath = b.practicePath;
  if (!L.practicePath || !practicePath) {
    if (isClash && Math.random() < 0.6) practicePath = pick(['fusion', 'reverse']);
    else practicePath = pick(PRACTICE_PATHS).id;
  }

  // 适配门槛（自动）
  const threshold = autoThreshold(daoSet, guidanceDepth!, styleType!, isClash);

  // 身体印记（自动）
  const bodyMark = autoBodyMark(mainDao!);

  // 运用技巧
  let usageSkills = b.usageSkills;
  if (!L.usageSkills || !usageSkills) usageSkills = randomUsageSkills(daoSet);

  // 配套神通
  let abilities = b.abilities;
  if (!L.abilities || !abilities) abilities = randomAbilities(daoSet);

  // 反噬代价
  let backlash = b.backlash;
  if (!L.backlash || !backlash) backlash = randomBacklash(guidanceDepth!, isClash);

  // 传承方式
  let inheritance = b.inheritance;
  if (!L.inheritance || !inheritance) inheritance = pick(INHERITANCES).id;

  // 演化方向
  let evolution = b.evolution;
  if (!L.evolution || !evolution) evolution = randomEvolution();

  // 先天矛盾（10% 触发）
  let inherentConflict = b.inherentConflict ?? null;
  if (!L.inherentConflict) {
    inherentConflict = Math.random() < CONFLICT_TRIGGER_RATE ? pick(INHERENT_CONFLICTS).id : null;
  }

  // 核心方向 + 适配修士（自动）
  const style = getStyle(styleType!);
  const coreDirection = style?.coreDirection || [];
  const mainDaoRule = getDao(mainDao!);
  const fitMonk: string[] = [];
  if (mainDaoRule?.fitMonk) fitMonk.push(...mainDaoRule.fitMonk.split(/[、，,]/).map(s => s.trim()).filter(Boolean));
  if (style?.fitMonkHint) fitMonk.push(style.fitMonkHint);

  // 名号
  let name = b.name;
  if (!L.name || !name) name = generateTechniqueName(mainDao!, guidanceDepth!, styleType!);

  // 藏拙隐法默认不开
  const fakeDepth = b.fakeDepth ?? null;

  return {
    name: name!,
    mainDao: mainDao!,
    assistDao: assistDao!,
    guidanceDepth: guidanceDepth!,
    fakeDepth,
    styleType: styleType!,
    threshold,
    coreTraits: coreTraits!,
    practicePath: practicePath!,
    bodyMark,
    usageSkills: usageSkills!,
    abilities: abilities!,
    backlash: backlash!,
    inheritance: inheritance!,
    evolution: evolution!,
    inherentConflict,
    coreDirection,
    fitMonk: Array.from(new Set(fitMonk)),
    isClash,
  };
}
