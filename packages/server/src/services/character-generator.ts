/**
 * 自定义人物随机生成服务（纯函数，无副作用）
 * 权重口径唯一来源：@novel-studio/shared 的附录A/B/C配置库
 *   1. randomName —— 按附录B规则生成姓名（精品成名40%/组内拼字35%/单字15%/辈分字10%，定位/立场风格轻度倾斜，道号/称号后缀，禁用字过滤）
 *   2. randomCharacter —— 按锁定配置随机整卡（种族/定位/姓名/立场/性格/天赋）
 *   3. buildFallbackBio —— LLM 小传生成失败时的模板拼接兜底
 */
import {
  RACE_CONFIG,
  findRaceCategory,
  findRaceSub,
  resolveNameRule,
  FORBIDDEN_NAME_CHARS,
  SURNAME_TIER_WEIGHTS,
  TALENT_CONFIG,
  TALENT_RARITY_WEIGHTS,
  FLAW_OPTIONS,
  FLAW_PROB,
  findTalentByName,
  POSITION_OPTIONS,
  findPosition,
  INNER_PERSONALITY_OPTIONS,
  INNER_PERSONALITY_STANCE_SHIFT,
  OUTER_PERSONALITY_OPTIONS,
  OUTER_PERSONALITY_MIN,
  OUTER_PERSONALITY_MAX,
  TALENT_MIN_COUNT,
  TALENT_MAX_PER_CATEGORY,
  stanceLabel,
  type RaceCategoryId,
  type Gender,
  type PositionKey,
  type NameStyleId,
  type ResolvedNameRule,
  type InnerPersonality,
  type TalentRarity,
  type RandomLocks,
  type CustomCharacterForm,
  type CustomCharacterDraft,
} from '@novel-studio/shared';

// ─── 基础随机工具 ─────────────────────────────────────────────────────────────

/** 从数组随机取一个 */
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 从数组随机取 n 个（不重复） */
function pickN<T>(arr: readonly T[], n: number): T[] {
  const pool = [...arr];
  const result: T[] = [];
  while (result.length < n && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(idx, 1)[0]);
  }
  return result;
}

/** 概率命中 */
function roll(prob: number): boolean {
  return Math.random() < prob;
}

/** 限制到 [min, max] */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 过滤禁用字（配置库已剔除大部分，运行时兜底再过滤一次） */
function filterForbidden(chars: readonly string[]): string[] {
  const filtered = chars.filter((c) => ![...c].some((ch) => FORBIDDEN_NAME_CHARS.includes(ch)));
  return filtered.length > 0 ? [...filtered] : [...chars];
}

// ─── 姓名生成（附录B） ────────────────────────────────────────────────────────

/** 按权重抽一个 */
function pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((s, it) => s + weight(it), 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

/** 取名时的人设提示（可选，用于风格轻度倾斜） */
export interface NameHints {
  position?: PositionKey;
  stance?: number;
}

/** 人设→偏好风格：高定位→古朴/华贵；邪异→幽邃/凌厉；正道→清雅/古朴（仅2倍权重，不绝对） */
function preferredStyles(hints: NameHints): Set<NameStyleId> {
  const prefer = new Set<NameStyleId>();
  const rank = hints.position ? findPosition(hints.position)?.rank ?? 0 : 0;
  if (rank >= 4) {
    prefer.add('archaic');
    prefer.add('noble');
  }
  if (typeof hints.stance === 'number') {
    if (hints.stance >= 67) {
      prefer.add('dark');
      prefer.add('fierce');
    } else if (hints.stance <= 33) {
      prefer.add('elegant');
      prefer.add('archaic');
    }
  }
  return prefer;
}

/** 抽姓：小类自定义姓池直接用；否则按常见70%/冷门25%/稀有复姓5%抽层 */
function pickSurname(rule: ResolvedNameRule): string {
  if (rule.subSurnamesOverridden) return pick(filterForbidden(rule.surnames));
  const tiers = rule.surnameTiers;
  const r = Math.random();
  let pool: string[];
  if (r < SURNAME_TIER_WEIGHTS.rare && tiers.rare.length > 0) pool = tiers.rare;
  else if (r < SURNAME_TIER_WEIGHTS.rare + SURNAME_TIER_WEIGHTS.uncommon && tiers.uncommon.length > 0) pool = tiers.uncommon;
  else pool = tiers.common.length > 0 ? tiers.common : rule.surnames;
  return pick(filterForbidden(pool));
}

/** 组内拼双字：同风格字组内搭配（偏好组2倍权重）；小类自定义字池时退化为扁平池拼字 */
function pickDoubleChars(rule: ResolvedNameRule, gender: Gender, surname: string, charPool: string[], prefer: Set<NameStyleId>): string {
  if (!rule.subCharsOverridden) {
    const groups = Object.entries(rule.charGroups[gender])
      .filter(([, chars]) => (chars?.length ?? 0) >= 2) as [NameStyleId, string[]][];
    if (groups.length > 0) {
      const [, chars] = pickWeighted(groups, ([style, cs]) => cs.length * (prefer.has(style) ? 2 : 1));
      const pool = filterForbidden(chars).filter((c) => c !== surname);
      if (pool.length >= 2) {
        const [a, b] = pickN(pool, 2);
        return a + b;
      }
    }
  }
  const pool = charPool.filter((c) => c !== surname);
  const [a, b] = pickN(pool.length >= 2 ? pool : charPool, 2);
  return a + (b ?? '');
}

/** 名主体：精品成名/组内拼字/单字/辈分字 四选一（硬规则：名不撞姓、双字不同字） */
function rollGivenName(rule: ResolvedNameRule, gender: Gender, surname: string, charPool: string[], prefer: Set<NameStyleId>): string {
  const curatedPool = rule.curatedNames[gender].filter(([n]) => !n.includes(surname));
  const weights = [
    ['curated', curatedPool.length > 0 ? rule.curatedProb : 0],
    ['double', rule.doubleCharProb],
    ['single', rule.singleCharProb],
    ['generation', rule.generationChars.length > 0 ? rule.generationCharProb : 0],
  ] as const;
  const branch = pickWeighted(weights, ([, w]) => w)[0];

  if (branch === 'curated') {
    return pickWeighted(curatedPool, ([, style]) => (prefer.has(style) ? 2 : 1))[0];
  }
  if (branch === 'single') {
    const pool = charPool.filter((c) => c !== surname);
    return pick(pool.length > 0 ? pool : charPool);
  }
  if (branch === 'generation') {
    const pool = charPool.filter((c) => c !== surname);
    return pick(filterForbidden(rule.generationChars)) + pick(pool.length > 0 ? pool : charPool);
  }
  return pickDoubleChars(rule, gender, surname, charPool, prefer);
}

/**
 * 按附录B v2规则随机生成姓名
 * 姓：分层抽取（常见70%/冷门25%/稀有复姓5%）；名：精品成名40%/组内拼字35%/单字15%/辈分字10%；
 * 再按概率追加道号/称号后缀（互斥，道号优先）；传入 hints 时按定位/立场做风格轻度倾斜
 */
export function randomName(raceCategory: RaceCategoryId, raceSub: string, gender: Gender, hints: NameHints = {}): string {
  const rule = resolveNameRule(raceCategory, raceSub);
  const surname = pickSurname(rule);
  const charPool = filterForbidden(gender === 'male' ? rule.maleChars : rule.femaleChars);
  const prefer = preferredStyles(hints);
  const given = rollGivenName(rule, gender, surname, charPool, prefer);

  let name = surname + given;

  // 道号/称号后缀（互斥，道号优先），如 沧溟子、虎力大王、萧清仙子
  const daoSuffixes = gender === 'male' ? rule.maleDaoSuffixes : rule.femaleDaoSuffixes;
  const titleSuffixes = gender === 'male' ? rule.maleTitleSuffixes : rule.femaleTitleSuffixes;
  if (daoSuffixes.length > 0 && roll(rule.daoNameProb)) {
    name += pick(daoSuffixes);
  } else if (titleSuffixes.length > 0 && roll(rule.titleProb)) {
    name += pick(titleSuffixes);
  }
  return name;
}

// ─── 天赋随机（附录C） ────────────────────────────────────────────────────────

/** 按稀有度权重从单个分类抽一条天赋（排除已选） */
function pickTalentFromCategory(categoryId: string, exclude: Set<string>): string | null {
  const category = TALENT_CONFIG.find((c) => c.id === categoryId);
  if (!category) return null;
  // 先按权重定稀有度，再在该稀有度池中等概率抽取；池空则降级到全池
  const r = Math.random();
  let rarity: TalentRarity;
  if (r < TALENT_RARITY_WEIGHTS.rare) rarity = 'rare';
  else if (r < TALENT_RARITY_WEIGHTS.rare + TALENT_RARITY_WEIGHTS.advanced) rarity = 'advanced';
  else rarity = 'common';

  let pool = category.entries.filter((e) => e.rarity === rarity && !exclude.has(e.name));
  if (pool.length === 0) pool = category.entries.filter((e) => !exclude.has(e.name));
  if (pool.length === 0) return null;
  return pick(pool).name;
}

/**
 * 随机一组天赋：默认出最少档（3个正向，每分类≤2）+ 30%概率附带1个小缺陷；
 * 用户可在向导中手动加选至每类2个，总上限 TALENT_MAX_COUNT
 */
export function randomTalents(): string[] {
  const selected = new Set<string>();
  const categoryCount: Record<string, number> = {};
  let guard = 0;
  while (selected.size < TALENT_MIN_COUNT && guard++ < 100) {
    const category = pick(TALENT_CONFIG);
    if ((categoryCount[category.id] ?? 0) >= TALENT_MAX_PER_CATEGORY) continue;
    const name = pickTalentFromCategory(category.id, selected);
    if (!name) continue;
    selected.add(name);
    categoryCount[category.id] = (categoryCount[category.id] ?? 0) + 1;
  }
  const talents = [...selected];
  if (roll(FLAW_PROB)) talents.push(pick(FLAW_OPTIONS));
  return talents;
}

/** 分类骰子：在指定分类内按稀有度权重随机一条（排除已选） */
export function randomTalentInCategory(categoryId: string, exclude: string[] = []): string | null {
  return pickTalentFromCategory(categoryId, new Set(exclude));
}

// ─── 整卡随机 ─────────────────────────────────────────────────────────────────

/**
 * 按锁定配置随机人物草稿：locks 中为 true 的字段保持 current 原值不变
 * current 缺失且未锁定的字段全部重新随机
 */
export function randomCharacter(locks: RandomLocks = {}, current: Partial<CustomCharacterForm> = {}): CustomCharacterDraft {
  // 种族（大类+小类绑定随机）
  let raceCategory: RaceCategoryId;
  let raceSub: string;
  if (locks.race && current.raceCategory && current.raceSub && findRaceSub(current.raceCategory, current.raceSub)) {
    raceCategory = current.raceCategory;
    raceSub = current.raceSub;
  } else {
    const category = pick(RACE_CONFIG);
    raceCategory = category.id;
    raceSub = pick(category.subs).id;
  }
  const sub = findRaceSub(raceCategory, raceSub)!;

  // 性别
  const gender: Gender = locks.gender && current.gender ? current.gender : pick(['male', 'female'] as const);

  // 定位（真实定位随机；伪装定位不随机，保持锁定语义之外由用户手动配置）
  const position: PositionKey = locks.position && current.position && findPosition(current.position)
    ? current.position
    : pick(POSITION_OPTIONS).key;
  // 伪装定位仅在仍低于真实定位时保留，否则清空
  let fakePosition: PositionKey | null = current.fakePosition ?? null;
  if (fakePosition) {
    const realRank = findPosition(position)?.rank ?? 0;
    const fakeRank = findPosition(fakePosition)?.rank ?? 0;
    if (fakeRank >= realRank) fakePosition = null;
  }

  // 内在性格 + 立场（立场随机后叠加内在性格偏移，与前端联动口径一致）
  const innerPersonality: InnerPersonality = locks.innerPersonality && current.innerPersonality
    ? current.innerPersonality
    : pick(INNER_PERSONALITY_OPTIONS);
  let stance: number;
  if (locks.stance && typeof current.stance === 'number') {
    stance = clamp(current.stance, 0, 100);
  } else {
    stance = clamp(Math.floor(Math.random() * 101) + INNER_PERSONALITY_STANCE_SHIFT[innerPersonality], 0, 100);
  }

  // 姓名（依赖最终种族+性别，并按定位/立场做风格轻度倾斜）
  const name = locks.name && current.name ? current.name : randomName(raceCategory, raceSub, gender, { position, stance });

  // 外在性格（2-3个）
  const outerPersonality = locks.outerPersonality && current.outerPersonality?.length
    ? current.outerPersonality
    : pickN(OUTER_PERSONALITY_OPTIONS, OUTER_PERSONALITY_MIN + (roll(0.5) ? 1 : 0));

  // 天赋（3正向每类≤2 + 30%缺陷）
  const talents = locks.talents && current.talents?.length ? current.talents : randomTalents();

  return {
    name,
    gender,
    raceCategory,
    raceSub,
    position,
    fakePosition,
    stance,
    innerPersonality,
    outerPersonality,
    talents,
    strengths: [...sub.strengths],
    weaknesses: [...sub.weaknesses],
  };
}

// ─── 小传兜底模板 ─────────────────────────────────────────────────────────────

/**
 * LLM 小传生成失败时的模板拼接兜底（保证入库不中断，后续可编辑重生成）
 */
export function buildFallbackBio(draft: CustomCharacterDraft): string {
  const category = findRaceCategory(draft.raceCategory);
  const sub = findRaceSub(draft.raceCategory, draft.raceSub);
  const pos = findPosition(draft.position);
  const fakePos = draft.fakePosition ? findPosition(draft.fakePosition) : null;

  const positiveTalents = draft.talents.filter((t) => findTalentByName(t));
  const flaws = draft.talents.filter((t) => !findTalentByName(t));
  const talentDesc = positiveTalents
    .map((t) => {
      const found = findTalentByName(t);
      return found ? `「${t}」——${found.entry.desc}` : `「${t}」`;
    })
    .join('');

  const parts = [
    `${draft.name}，${category?.name ?? ''}${sub ? `·${sub.name}` : ''}出身。${sub?.desc ?? ''}`,
    `其人实力定位为「${pos?.name ?? ''}」，${pos?.desc.split('，')[0] ?? ''}。`,
    fakePos ? `平日刻意收敛锋芒，对外只以「${fakePos.name}」的姿态示人，扮猪吃虎。` : '',
    `立场${stanceLabel(draft.stance)}（${draft.stance}/100），内里${draft.innerPersonality}，外在待人${draft.outerPersonality.join('、')}。`,
    talentDesc ? `身负先天禀赋：${talentDesc}` : '',
    flaws.length > 0 ? `美中不足的是有些${flaws.join('、')}的小毛病。` : '',
    sub ? `所擅者，${sub.strengths.join('、')}；所短者，${sub.weaknesses.join('、')}。` : '',
  ];
  return parts.filter(Boolean).join('');
}
