/**
 * 方向组合式特质生成引擎（零token，确定性规则驱动）
 *
 * 核心公式：具体特质 = 选中方向效果 × 形制适配 × 材质适配 × 道则适配
 * 输入：selectedDirections（按类分组的选中方向ID）+ weaponBase（category/type/grade/baseMaterial/mainDao?）
 * 输出：GeneratedTrait[]（含稀有/瑕疵标记）
 *
 * 铁律：
 *  - 零token：全部本地计算，LLM仅后续润色命名
 *  - 冲突互斥：维度内冲突 + 形制不适配 + 道则不适配
 *  - 代价对等：灵质浸养/外附加持/窍藏内嵌必带副作用/限制/代价
 *  - 可追溯：每个特质 sourceDirections 完整记录来源
 */

import {
  getDirection, getAllDirections, FORM_CLASS_MAP, RARE_COMBINATIONS, FLAW_RULES,
  getStackTier, TRAIT_CATEGORIES,
  type TraitCategory, type TraitDirection,
} from '../data/trait-directions.js';
import { getForm, getMaterial, getTrait } from '../data/weapon-catalog.js';

// ============================================================
// 类型
// ============================================================

export interface GeneratedTrait {
  id: string
  type: TraitCategory
  name: string
  desc: string
  isRare: boolean
  flaw: string | null
  sourceDirections: string[]
  isClassic: boolean
  classicId: string | null
  /** 烙印标记（剧情事件留下的永久痕迹） */
  isScar?: boolean
}

export interface WeaponBase {
  category: string
  type: string
  grade: string
  baseMaterial: string
  /** 主道则ID（可选，来自 technique-catalog DaoId；无则跳过道则适配） */
  mainDao?: string
}

/** 用户选中的方向（按类→维度→方向ID数组） */
export type SelectedDirections = Partial<Record<TraitCategory, string[]>>

export interface ComposeResult {
  traits: GeneratedTrait[]
  stackCount: number
  stackLabel: string
  rareProb: number
  flawProb: number
  /** 被灰掉的方向（形制/道则不适配） */
  disabledDirections: string[]
  /** 冲突校验错误（若有） */
  conflicts: string[]
}

// ============================================================
// 形制适配模板
// ============================================================

const FORM_ADAPT: Record<string, (effect: string, formName: string) => string> = {
  '重兵器': (e, f) => `${f}沉重，${e}`,
  '轻兵器': (e, f) => `${f}轻灵，${e}`,
  '软兵器': (e, f) => `${f}柔韧，${e}`,
  '暗器': (e, f) => `${f}隐蔽，${e}`,
  '法器': (e, f) => `${f}灵韵，${e}`,
  '盾牌': (e, f) => `${f}厚重，${e}`,
}

// ============================================================
// 材质适配修饰
// ============================================================

const MATERIAL_ADAPT: Record<string, string> = {
  normal: '凡铁所铸',
  rare: '灵材锻就',
  legendary: '神料天成',
}

// ============================================================
// 道则适配后缀
// ============================================================

const DAO_ADAPT: Record<string, string> = {
  gengjin: '，金属嗡鸣破空',
  kunearth: '，坤土厚重沉实',
  thunder: '，雷火电弧缠绕',
  mingshi: '，冥蚀腐蚀侵蚀',
  void: '，虚空扭曲撕裂',
  suishi: '，岁月侵蚀斑驳',
  xingzhi: '，形质变幻莫测',
  lingqi: '，灵气流转不息',
  shenhun: '，神魂震荡共鸣',
}

// ============================================================
// 核心：组合生成
// ============================================================

let idCounter = 0
function genId(): string {
  return `gt_${Date.now().toString(36)}_${(idCounter++).toString(36)}`
}

/**
 * 校验选中方向的合法性（冲突检测）
 */
export function validateDirections(selected: SelectedDirections, weapon: WeaponBase): string[] {
  const conflicts: string[] = []
  const allSelected = Object.values(selected).flat()
  const selectedSet = new Set(allSelected)

  for (const dirId of allSelected) {
    const dir = getDirection(dirId)
    if (!dir) { conflicts.push(`未知方向: ${dirId}`); continue }
    // 维度内互斥
    if (dir.conflictDirs) {
      for (const cId of dir.conflictDirs) {
        if (selectedSet.has(cId)) {
          const cDir = getDirection(cId)
          conflicts.push(`「${dir.label}」与「${cDir?.label ?? cId}」互斥`)
        }
      }
    }
  }
  return [...new Set(conflicts)]
}

/**
 * 获取被禁用的方向（形制/道则不适配）
 */
export function getDisabledDirections(weapon: WeaponBase): string[] {
  const formClass = FORM_CLASS_MAP[weapon.type] ?? ''
  const disabled: string[] = []
  for (const dir of getAllDirections()) {
    if (dir.unfitFormClasses?.includes(formClass)) { disabled.push(dir.id); continue }
    if (weapon.mainDao && dir.unfitDaos?.includes(weapon.mainDao)) { disabled.push(dir.id) }
  }
  return disabled
}

/**
 * 核心组合生成函数
 */
export function composeTraits(selected: SelectedDirections, weapon: WeaponBase, rand: () => number = Math.random): ComposeResult {
  const formInfo = getForm(weapon.type)
  const matInfo = getMaterial(weapon.baseMaterial)
  const formName = formInfo?.form?.name ?? weapon.type
  const formClass = FORM_CLASS_MAP[weapon.type] ?? '轻兵器'
  const matRarity = matInfo?.rarity ?? 'normal'
  const matLabel = MATERIAL_ADAPT[matRarity] ?? ''
  const daoSuffix = weapon.mainDao ? (DAO_ADAPT[weapon.mainDao] ?? '') : ''
  const formAdaptFn = FORM_ADAPT[formClass] ?? FORM_ADAPT['轻兵器']

  const allSelected = Object.values(selected).flat()
  const stackCount = allSelected.length
  const tier = getStackTier(stackCount)

  const traits: GeneratedTrait[] = []

  // 逐方向生成特质
  for (const [catId, dirIds] of Object.entries(selected)) {
    if (!dirIds?.length) continue
    const category = catId as TraitCategory
    for (const dirId of dirIds) {
      const dir = getDirection(dirId)
      if (!dir) continue
      // 组合描述
      let desc = dir.baseEffect
      desc = formAdaptFn(desc, formName)
      // 材质/道则修饰插入形制前缀之后，避免前缀视觉重复（BUG-01）
      if (matLabel || daoSuffix) {
        const commaIdx = desc.indexOf('，')
        if (commaIdx > 0) {
          const prefix = desc.slice(0, commaIdx)       // "重剑沉重"
          const suffix = desc.slice(commaIdx + 1)      // "挥砍时力量倍增"
          const mid: string[] = []
          if (matLabel) mid.push(matLabel)
          if (daoSuffix) mid.push(daoSuffix)
          desc = `${prefix}，${mid.join('，')}，${suffix}`
        } else {
          if (matLabel) desc = `${matLabel}，${desc}`
          if (daoSuffix) desc = `${desc}${daoSuffix}`
        }
      }

      traits.push({
        id: genId(),
        type: category,
        name: dir.label, // 占位名，后续LLM润色
        desc,
        isRare: false,
        flaw: null,
        sourceDirections: [dirId],
        isClassic: false,
        classicId: null,
      })
    }
  }

  // 稀有组合检测（weightBoost 倍率加成）
  const selectedSet = new Set(allSelected)
  for (const rare of RARE_COMBINATIONS) {
    if (rare.requiredDirs.every((d) => selectedSet.has(d))) {
      const prob = Math.min(tier.rareProb * (rare.weightBoost ?? 1), 1)
      if (rand() < prob) {
        traits.push({
          id: genId(),
          type: 'forge', // 稀有特质归类为forge（结构层面）
          name: rare.name,
          desc: rare.effect,
          isRare: true,
          flaw: rare.cost,
          sourceDirections: rare.requiredDirs,
          isClassic: false,
          classicId: null,
        })
        break // 一次最多触发一个稀有
      }
    }
  }

  // 瑕疵生成
  if (rand() < tier.flawProb && traits.length > 0) {
    for (const rule of FLAW_RULES) {
      if (selectedSet.has(rule.directionId) && stackCount >= rule.minStack) {
        // 找到对应特质附加瑕疵
        const target = traits.find((t) => t.sourceDirections.includes(rule.directionId))
        if (target && !target.flaw) {
          target.flaw = rule.flaw
          break
        }
      }
    }
  }

  return {
    traits,
    stackCount,
    stackLabel: tier.label,
    rareProb: tier.rareProb,
    flawProb: tier.flawProb,
    disabledDirections: getDisabledDirections(weapon),
    conflicts: validateDirections(selected, weapon),
  }
}

/**
 * 将旧固定特质ID数组包装为 GeneratedTrait（兼容老数据）
 */
export function wrapClassicTraits(forgeIds: string[], soakIds: string[], attachIds: string[], cavityIds: string[]): GeneratedTrait[] {
  const wrap = (ids: string[], type: TraitCategory): GeneratedTrait[] =>
    ids.map((id) => {
      const t = getTrait(id)
      return {
        id: `classic_${id}`,
        type,
        name: t?.name ?? id,
        desc: t?.desc ?? '',
        isRare: (t?.rarity ?? 'normal') !== 'normal',
        flaw: null,
        sourceDirections: [],
        isClassic: true,
        classicId: id,
      }
    })
  return [
    ...wrap(forgeIds, 'forge'),
    ...wrap(soakIds, 'infuse'),
    ...wrap(attachIds, 'enchant'),
    ...wrap(cavityIds, 'hidden'),
  ]
}

/**
 * 随机方向选择（用于 randomWeapon 无用户指定时自动选）
 */
export function randomDirections(weapon: WeaponBase, rand: () => number = Math.random): SelectedDirections {
  const disabled = new Set(getDisabledDirections(weapon))
  const result: SelectedDirections = {}

  for (const cat of TRAIT_CATEGORIES) {
    const catDirs: string[] = []
    for (const dim of cat.dimensions) {
      const eligible = dim.directions.filter((d) => !disabled.has(d.id))
      if (!eligible.length) continue

      if (dim.selectRule === 'required1') {
        // 必选1个
        catDirs.push(eligible[Math.floor(rand() * eligible.length)].id)
      } else if (dim.selectRule === 'single') {
        // 单选（70%概率选一个，30%跳过）
        if (rand() < 0.7) catDirs.push(eligible[Math.floor(rand() * eligible.length)].id)
      } else if (dim.selectRule === 'max1') {
        if (rand() < 0.5) catDirs.push(eligible[Math.floor(rand() * eligible.length)].id)
      } else if (dim.selectRule === 'max2') {
        const n = rand() < 0.3 ? 2 : rand() < 0.7 ? 1 : 0
        const pool = [...eligible]
        for (let i = 0; i < n && pool.length; i++) {
          const idx = Math.floor(rand() * pool.length)
          const picked = pool.splice(idx, 1)[0]
          // 检查冲突
          const conflict = picked.conflictDirs?.some((c) => catDirs.includes(c))
          if (!conflict) catDirs.push(picked.id)
        }
      }
    }
    if (catDirs.length) result[cat.id] = catDirs
  }
  return result
}
