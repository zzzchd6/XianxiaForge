/**
 * 自定义武器确定性随机引擎
 * 设计原则：除名号外全程零 LLM、零 token，结果可控可复现。
 * 权重规则（需求五.1）：普通60% / 高级30% / 稀有10%。
 * 冲突互斥（需求五.2）：按 conflictTags 组互斥，随机时自动跳过冲突项。
 * 形制过滤：按词条 fit 文本与形制/门类做宽松关键词匹配（含"所有/全/通用"恒适配）。
 */
import {
  CATEGORIES, MATERIALS, FORGE_TRAITS, SOAK_TRAITS, ATTACH_TRAITS, CAVITY_TRAITS,
  GRADES, CAVITY_LIMIT, getFormsByCategory, getForm,
  type WeaponTrait, type Rarity,
} from '../data/weapon-catalog.js';

/** 随机产出的武器草稿（与 custom_weapon 入库字段对齐） */
export interface WeaponDraft {
  name: string;
  category: string;
  type: string;
  grade: string;
  fakeGrade: string | null;
  baseMaterial: string;
  forgeTraits: string[];
  soakTraits: string[];
  attachTraits: string[];
  cavityTraits: string[];
  soulRefineLevel: string;
  coreDirection: string[];
}

/** 锁定字段：true 表示保留传入值不随机 */
export type WeaponLock = Partial<Record<
  'category' | 'type' | 'grade' | 'baseMaterial' | 'forgeTraits' | 'soakTraits' | 'attachTraits' | 'cavityTraits' | 'soulRefineLevel' | 'name',
  boolean
>>;

const RARITY_WEIGHT: Record<Rarity, number> = { normal: 60, rare: 30, legendary: 10 };

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 按稀有度权重从词条池中抽一个 */
function weightedPickTrait(pool: WeaponTrait[]): WeaponTrait {
  const total = pool.reduce((s, t) => s + RARITY_WEIGHT[t.rarity], 0);
  let r = Math.random() * total;
  for (const t of pool) {
    r -= RARITY_WEIGHT[t.rarity];
    if (r <= 0) return t;
  }
  return pool[pool.length - 1];
}

/** 形制适配判定（宽松关键词匹配，防止过滤过严导致空池） */
function traitFits(trait: WeaponTrait, formName: string, categoryName: string): boolean {
  const fit = trait.fit;
  if (!fit) return true;
  if (/所有|全部|通用|全修士|实体兵器|手持|灵气|近战/.test(fit)) return true;
  // 取形制名与门类名的关键字符（去掉"·"分隔的通用词）
  const keys = new Set<string>();
  for (const seg of `${formName}${categoryName}`.split(/[·、，,\s]/)) {
    if (seg.length >= 1) keys.add(seg);
  }
  for (const k of keys) {
    if (k && fit.includes(k)) return true;
  }
  // 单字关键词兜底（剑/刀/枪/棍/鞭/弓/针/幡/钟/镜/盾/佩/葫/旗/盘/符/弩/爪/晶/壶/钉/钱/笔/丹/牌/傀）
  const chars = '剑刀枪棍鞭弓针幡钟镜盾佩葫旗盘符弩爪晶壶钉钱笔丹牌傀刺锤棒扇';
  for (const ch of chars) {
    if (formName.includes(ch) && fit.includes(ch)) return true;
  }
  return false;
}

/** 从池中随机选 n 个互不冲突、适配形制的词条 */
function pickTraits(
  pool: WeaponTrait[], n: number, formName: string, categoryName: string, usedTags: Set<string>,
): string[] {
  let eligible = pool.filter(t => traitFits(t, formName, categoryName));
  if (eligible.length === 0) eligible = pool; // 兜底：过滤过严则放开
  const chosen: string[] = [];
  const guard = eligible.slice();
  let attempts = 0;
  while (chosen.length < n && guard.length > 0 && attempts < n * 20) {
    attempts++;
    const t = weightedPickTrait(guard);
    const conflict = t.conflictTags.some(tag => usedTags.has(tag));
    if (conflict || chosen.includes(t.id)) {
      // 移除该项避免反复抽到
      const idx = guard.indexOf(t);
      if (idx >= 0) guard.splice(idx, 1);
      continue;
    }
    chosen.push(t.id);
    t.conflictTags.forEach(tag => usedTags.add(tag));
    const idx = guard.indexOf(t);
    if (idx >= 0) guard.splice(idx, 1);
  }
  return chosen;
}

/** 底蕴层级加权随机（越高越稀有） */
function randomGrade(): string {
  const weights = [30, 26, 18, 13, 9, 4]; // 凡造..神蕴
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < GRADES.length; i++) {
    r -= weights[i];
    if (r <= 0) return GRADES[i];
  }
  return GRADES[0];
}

/** 确定性名号生成（零 token 模板拼接，LLM 精修走 /random-name） */
const NAME_PREFIX: Record<string, string[]> = {
  martial: ['玄铁', '百炼', '破军', '寒锋', '龙纹', '啸风'],
  taoist: ['太清', '玄元', '紫霄', '灵宝', '三清', '混元'],
  demonic: ['噬血', '九幽', '煞魂', '阴煞', '血灵', '万鬼'],
  strange: ['天机', '混沌', '星陨', '造化', '乾坤', '无极'],
  array: ['周天', '八卦', '九宫', '天罡', '河图', '洛书'],
};
const NAME_SUFFIX: Record<string, string[]> = {
  sword: ['剑', '锋', '刃'], blade: ['刀', '刃'], spear: ['枪', '矛'], staff: ['棍', '杖'],
  default: ['印', '钟', '镜', '葫', '盾', '佩', '幡', '珠', '旗', '盘', '符', '弩', '爪', '壶', '钱', '笔', '傀'],
};

export function generateName(category: string, type: string): string {
  const pre = pick(NAME_PREFIX[category] || NAME_PREFIX.strange);
  let sufPool = NAME_SUFFIX.default;
  if (type.includes('sword')) sufPool = NAME_SUFFIX.sword;
  else if (type.includes('blade')) sufPool = NAME_SUFFIX.blade;
  else if (type.includes('spear')) sufPool = NAME_SUFFIX.spear;
  else if (type.includes('staff')) sufPool = NAME_SUFFIX.staff;
  return pre + pick(sufPool);
}

/**
 * 生成一把完整随机武器。locked 中标记 true 的字段保留 base 中的值。
 */
export function randomWeapon(base?: Partial<WeaponDraft>, locked?: WeaponLock): WeaponDraft {
  const L = locked || {};
  const b = base || {};

  // 门类 + 形制
  let category = b.category;
  if (!L.category || !category) category = pick(CATEGORIES).id;
  let forms = getFormsByCategory(category!);
  let type = b.type;
  if (!L.type || !type || !forms.some(f => f.id === type)) type = pick(forms).id;
  const formInfo = getForm(type!);
  const formName = formInfo?.form.name || '';
  const categoryName = formInfo?.category.name || '';
  const coreDirection = formInfo?.form.coreDirection || [];

  // 底蕴
  let grade = b.grade;
  if (!L.grade || !grade) grade = randomGrade();

  // 材质（按形制宽松过滤）
  let baseMaterial = b.baseMaterial;
  if (!L.baseMaterial || !baseMaterial) {
    const matPool = MATERIALS.filter(m => traitFits({ ...m, conflictTags: [] } as any, formName, categoryName));
    baseMaterial = (matPool.length ? pick(matPool) : pick(MATERIALS)).id;
  }

  // 冲突标签全局共享（浸养与改锻之间也互斥）
  const usedTags = new Set<string>();

  // 胎体改锻 2-4
  let forgeTraits = b.forgeTraits;
  if (!L.forgeTraits || !forgeTraits) {
    const n = 2 + Math.floor(Math.random() * 3); // 2..4
    forgeTraits = pickTraits(FORGE_TRAITS, n, formName, categoryName, usedTags);
  } else {
    forgeTraits.forEach(id => { const t = FORGE_TRAITS.find(x => x.id === id); t?.conflictTags.forEach(tag => usedTags.add(tag)); });
  }

  // 灵质浸养 1-2
  let soakTraits = b.soakTraits;
  if (!L.soakTraits || !soakTraits) {
    const n = 1 + Math.floor(Math.random() * 2); // 1..2
    soakTraits = pickTraits(SOAK_TRAITS, n, formName, categoryName, usedTags);
  } else {
    soakTraits.forEach(id => { const t = SOAK_TRAITS.find(x => x.id === id); t?.conflictTags.forEach(tag => usedTags.add(tag)); });
  }

  // 外附加持 2-3
  let attachTraits = b.attachTraits;
  if (!L.attachTraits || !attachTraits) {
    const n = 2 + Math.floor(Math.random() * 2); // 2..3
    attachTraits = pickTraits(ATTACH_TRAITS, n, formName, categoryName, new Set());
  }

  // 窍藏内嵌（数量按底蕴上限）
  let cavityTraits = b.cavityTraits;
  if (!L.cavityTraits || !cavityTraits) {
    const limit = CAVITY_LIMIT[grade!] ?? 1;
    const n = 1 + Math.floor(Math.random() * limit); // 1..limit
    cavityTraits = pickTraits(CAVITY_TRAITS, Math.min(n, limit), formName, categoryName, new Set());
  }

  // 本命祭炼（随机默认无）
  let soulRefineLevel = b.soulRefineLevel;
  if (!L.soulRefineLevel || !soulRefineLevel) soulRefineLevel = 'none';

  // 名号
  let name = b.name;
  if (!L.name || !name) name = generateName(category!, type!);

  return {
    name: name!,
    category: category!,
    type: type!,
    grade: grade!,
    fakeGrade: b.fakeGrade ?? null,
    baseMaterial: baseMaterial!,
    forgeTraits: forgeTraits || [],
    soakTraits: soakTraits || [],
    attachTraits: attachTraits || [],
    cavityTraits: cavityTraits || [],
    soulRefineLevel: soulRefineLevel!,
    coreDirection,
  };
}

// ============================================================
// 歪嘴龙王自动伪装（PRD§2.2）
// ============================================================

const GRADE_INDEX: Record<string, number> = Object.fromEntries(GRADES.map((g, i) => [g, i]));

/**
 * 对已生成的武器草稿应用自动伪装逻辑：
 * - 真实品质≥宝胎时，10%概率触发伪装
 * - 伪装为低1-2档品质（神蕴最高伪装为道纹，禁止伪装成凡造）
 * - 返回修改后的 draft（fakeGrade 被填充）
 */
export function applyAutoDisguise(draft: WeaponDraft, rand: () => number = Math.random): WeaponDraft {
  const gi = GRADE_INDEX[draft.grade] ?? 0;
  if (gi < 2) return draft; // 凡造/灵淬不伪装
  if (rand() >= 0.10) return draft; // 90%不触发

  // 伪装为低1-2档，但不低于灵淬（index 1）
  const drop = 1 + Math.floor(rand() * 2); // 1 or 2
  let fakeIdx = gi - drop;
  if (fakeIdx < 1) fakeIdx = 1; // 最低灵淬
  // 神蕴(5)最高伪装为道纹(3)
  if (gi === 5 && fakeIdx > 3) fakeIdx = 3;

  return { ...draft, fakeGrade: GRADES[fakeIdx] };
}

// ============================================================
// 路边摊淘宝批量生成（PRD§2.1）
// ============================================================

export interface StreetBatchOptions {
  batch: number;       // 10/20/50
  junkRatio?: number;  // 垃圾率，默认0.9
}

export interface StreetWeaponResult extends WeaponDraft {
  /** 是否带伪装 */
  disguised: boolean;
  /** 品质档位标签 */
  tierLabel: 'junk' | 'mid' | 'high' | 'supreme';
}

/**
 * 路边摊品质概率分布：
 * 90% 凡造/灵淬（junk）→ 自动做旧+伪装低1-2档
 * 9%  宝胎（mid）→ 无伪装
 * 0.9% 道纹（high）→ 50%伪装
 * 0.1% 仙蜕/神蕴（supreme）→ 自动最高伪装（凡造）
 */
export function batchStreetWeapons(opts: StreetBatchOptions, rand: () => number = Math.random): StreetWeaponResult[] {
  const { batch } = opts;
  const results: StreetWeaponResult[] = [];

  for (let i = 0; i < batch; i++) {
    const roll = rand();
    let grade: string;
    let tierLabel: StreetWeaponResult['tierLabel'];
    let forceDisguise: string | null = null;

    if (roll < 0.90) {
      // 90% 凡造/灵淬
      grade = rand() < 0.6 ? '凡造' : '灵淬';
      tierLabel = 'junk';
      // 自动伪装为低1-2档（凡造无法再低，灵淬伪装为凡造）
      const gi = GRADE_INDEX[grade];
      const drop = 1 + Math.floor(rand() * 2);
      const fakeIdx = Math.max(0, gi - drop);
      forceDisguise = GRADES[fakeIdx];
    } else if (roll < 0.99) {
      // 9% 宝胎
      grade = '宝胎';
      tierLabel = 'mid';
    } else if (roll < 0.999) {
      // 0.9% 道纹，50%伪装
      grade = '道纹';
      tierLabel = 'high';
      if (rand() < 0.5) forceDisguise = '灵淬';
    } else {
      // 0.1% 仙蜕/神蕴，自动最高伪装（凡造）
      grade = rand() < 0.7 ? '仙蜕' : '神蕴';
      tierLabel = 'supreme';
      forceDisguise = '凡造';
    }

    const draft = randomWeapon({ grade }, { grade: true });
    results.push({
      ...draft,
      fakeGrade: forceDisguise ?? draft.fakeGrade,
      disguised: !!forceDisguise,
      tierLabel,
    });
  }
  return results;
}
