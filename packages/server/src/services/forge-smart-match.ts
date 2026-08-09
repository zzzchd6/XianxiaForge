/**
 * 三工坊智能匹配服务（WS4）
 *
 * 职责：
 * 1. 从真实 config 模块拼装「可选枚举上下文」（单一事实来源，杜绝硬编码漂移）；
 * 2. 对 LLM 返回的参数做防御性校验——只保留落在合法枚举内的值，数组字段裁剪到约束上限，
 *    确定性规则（每类天赋上限、辅修不重复主修、忌讳≤2 等）在此兜底，不依赖 LLM 自觉。
 */
import {
  RACE_CONFIG, POSITION_OPTIONS, INNER_PERSONALITY_OPTIONS, OUTER_PERSONALITY_OPTIONS,
  TALENT_CONFIG, FLAW_OPTIONS, TALENT_MAX_PER_CATEGORY,
} from '@xianxiaforge/shared';
import { CATEGORIES, GRADES, MATERIALS } from '../data/weapon-catalog.js';
import { TEMPERAMENTS, PAST_TYPES, TABOOS } from '../data/trait-directions.js';
import {
  DAO_RULES, GUIDANCE_LEVELS, STYLE_TYPES, PRACTICE_PATHS, INHERITANCES, CORE_TRAITS,
} from '../data/technique-catalog.js';

// ============================================================
// 人物
// ============================================================

export function buildCharacterContext(): string {
  const race = RACE_CONFIG.map((c) =>
    `${c.id}${c.name}: ` + c.subs.map((s) => `${s.id}=${s.name}`).join(', ')
  ).join('\n');
  const pos = POSITION_OPTIONS.map((p) => `${p.key}=${p.name}`).join(', ');
  const talents = TALENT_CONFIG.map((c) =>
    `[${c.id}${c.name}] ` + c.entries.map((e) => e.name).join('、')
  ).join('\n');
  return `种族大类与小类（raceCategory / raceSub，raceSub 必须属于所选大类）:\n${race}
定位（position）: ${pos}
内在性格（innerPersonality，中文单选）: ${INNER_PERSONALITY_OPTIONS.join(' / ')}
外在性格（outerPersonality，中文多选）: ${OUTER_PERSONALITY_OPTIONS.join('、')}
天赋（talents，从下列名称中选，每类最多${TALENT_MAX_PER_CATEGORY}个）:\n${talents}
可选缺陷（talents 中最多含1个）: ${FLAW_OPTIONS.join('、')}`;
}

export function validateCharacter(raw: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  const catIds = new Set(RACE_CONFIG.map((c) => c.id));
  if (typeof raw.name === 'string' && raw.name.trim()) out.name = raw.name.trim().slice(0, 64);
  out.gender = raw.gender === 'female' ? 'female' : 'male';
  if (catIds.has(raw.raceCategory)) out.raceCategory = raw.raceCategory;
  const cat = RACE_CONFIG.find((c) => c.id === out.raceCategory);
  if (cat && cat.subs.some((s) => s.id === raw.raceSub)) out.raceSub = raw.raceSub;
  if (POSITION_OPTIONS.some((p) => p.key === raw.position)) out.position = raw.position;
  const stance = Number(raw.stance);
  out.stance = Number.isFinite(stance) ? Math.max(0, Math.min(100, Math.round(stance))) : 50;
  if ((INNER_PERSONALITY_OPTIONS as readonly string[]).includes(raw.innerPersonality)) out.innerPersonality = raw.innerPersonality;
  if (Array.isArray(raw.outerPersonality)) {
    const valid = [...new Set(raw.outerPersonality.filter((x: any) => (OUTER_PERSONALITY_OPTIONS as readonly string[]).includes(x)))];
    out.outerPersonality = valid.slice(0, 3);
  }
  if (Array.isArray(raw.talents)) {
    // 合法天赋名集合 + 缺陷名集合
    const talentCat = new Map<string, string>();
    for (const c of TALENT_CONFIG) for (const e of c.entries) talentCat.set(e.name, c.id);
    const flawSet = new Set(FLAW_OPTIONS as readonly string[]);
    const perCat: Record<string, number> = {};
    const picked: string[] = [];
    let flawPicked = 0;
    for (const t of raw.talents) {
      if (typeof t !== 'string' || picked.includes(t)) continue;
      if (flawSet.has(t)) { if (flawPicked < 1) { picked.push(t); flawPicked++; } continue; }
      const cid = talentCat.get(t);
      if (!cid) continue;
      if ((perCat[cid] || 0) >= TALENT_MAX_PER_CATEGORY) continue;
      perCat[cid] = (perCat[cid] || 0) + 1;
      picked.push(t);
      if (picked.length >= 9) break;
    }
    out.talents = picked;
  }
  return out;
}

// ============================================================
// 法宝
// ============================================================

export function buildWeaponContext(): string {
  const cats = CATEGORIES.map((c) =>
    `${c.id}${c.name}: ` + c.forms.map((f) => `${f.id}=${f.name}`).join(', ')
  ).join('\n');
  const mats = MATERIALS.map((m) => `${m.id}=${m.name}`).join(', ');
  const temp = TEMPERAMENTS.map((t) => `${t.id}=${t.label.replace(/[^\u4e00-\u9fa5]/g, '')}`).join(', ');
  const past = PAST_TYPES.map((p) => `${p.id}=${p.label.replace(/[^\u4e00-\u9fa5]/g, '')}`).join(', ');
  const taboos = TABOOS.map((t) => `${t.id}=${t.label.replace(/[^\u4e00-\u9fa5]/g, '')}`).join(', ');
  return `门类与形制（category / type，type 必须属于所选门类）:\n${cats}
底蕴（grade，中文）: ${GRADES.join(' / ')}
材质（baseMaterial）: ${mats}
器性（temperament）: ${temp}
前尘（pastType）: ${past}
忌讳（taboos，最多2个）: ${taboos}`;
}

export function validateWeapon(raw: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  if (typeof raw.name === 'string' && raw.name.trim()) out.name = raw.name.trim().slice(0, 32);
  const cat = CATEGORIES.find((c) => c.id === raw.category);
  if (cat) {
    out.category = cat.id;
    if (cat.forms.some((f) => f.id === raw.type)) out.type = raw.type;
  }
  if ((GRADES as readonly string[]).includes(raw.grade)) out.grade = raw.grade;
  if (MATERIALS.some((m) => m.id === raw.baseMaterial)) out.baseMaterial = raw.baseMaterial;
  if (TEMPERAMENTS.some((t) => t.id === raw.temperament)) out.temperament = raw.temperament;
  if (PAST_TYPES.some((p) => p.id === raw.pastType)) out.pastType = raw.pastType;
  if (Array.isArray(raw.taboos)) {
    out.taboos = [...new Set(raw.taboos.filter((x: any) => TABOOS.some((t) => t.id === x)))].slice(0, 2);
  }
  out.reverseMode = raw.reverseMode === true;
  return out;
}

// ============================================================
// 功法
// ============================================================

export function buildTechniqueContext(): string {
  const daos = DAO_RULES.map((d) => `${d.id}=${d.name}(${d.essence})`).join(', ');
  const styles = STYLE_TYPES.map((s) => `${s.id}=${s.name}`).join(', ');
  const depths = GUIDANCE_LEVELS.map((g) => `${g.id}=${g.name}`).join(', ');
  const paths = PRACTICE_PATHS.map((p) => `${p.id}=${p.name}`).join(', ');
  const inhs = INHERITANCES.map((i) => `${i.id}=${i.name}`).join(', ');
  const traits = CORE_TRAITS.map((t) => `${t.id}=${t.name}`).join(', ');
  return `九大道则（mainDao / assistDao）: ${daos}
体例（styleType）: ${styles}
传承完备度（guidanceDepth）: ${depths}
行功路线（practicePath）: ${paths}
传承方式（inheritance）: ${inhs}
本源特质（coreTraits，2-3个）: ${traits}`;
}

export function validateTechnique(raw: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  const daoIds = new Set(DAO_RULES.map((d) => d.id));
  if (typeof raw.name === 'string' && raw.name.trim()) out.name = raw.name.trim().slice(0, 32);
  if (daoIds.has(raw.mainDao)) out.mainDao = raw.mainDao;
  if (Array.isArray(raw.assistDao)) {
    out.assistDao = [...new Set(raw.assistDao.filter((x: any) => daoIds.has(x) && x !== out.mainDao))].slice(0, 3);
  }
  if (STYLE_TYPES.some((s) => s.id === raw.styleType)) out.styleType = raw.styleType;
  if (GUIDANCE_LEVELS.some((g) => g.id === raw.guidanceDepth)) out.guidanceDepth = raw.guidanceDepth;
  if (PRACTICE_PATHS.some((p) => p.id === raw.practicePath)) out.practicePath = raw.practicePath;
  if (INHERITANCES.some((i) => i.id === raw.inheritance)) out.inheritance = raw.inheritance;
  if (Array.isArray(raw.coreTraits)) {
    out.coreTraits = [...new Set(raw.coreTraits.filter((x: any) => CORE_TRAITS.some((t) => t.id === x)))].slice(0, 3);
  }
  return out;
}
