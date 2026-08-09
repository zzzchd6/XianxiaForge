/**
 * 方向 ↔ 影响 联动映射（需求：剧情方向与分支影响体系 阶段3 联动）
 *
 * 两个方向的联动：
 *   1. 方向 → 影响 自动映射：分支选项主方向的 impactModules → 默认影响模块 + 基准幅度。
 *      用于"未手工绑定影响链接的分支选项"在选择时自动生成影响变更（pending 快照，可复核）。
 *   2. 影响 → 方向 推荐：根据当前影响状态（数值）给出弱方向提示（如伤势≥60推荐休整），不强制。
 *
 * 设计原则：
 *   - 纯函数（给定 defs/state 即可计算），零 LLM，可单测。
 *   - 手工绑定的 branch_impact_link 永远优先于方向自动映射（用户显式配置不被覆盖）。
 *   - 自动映射保守：每个模块只取最匹配的 1 个影响定义、基准幅度温和，产物为 pending 快照。
 */
import { getDirection } from '../direction-catalog.js';
import type { ImpactDef } from './engine.js';

// ============================================================
// 1. 方向 → 影响 自动映射
// ============================================================

/** 模块 → 影响 映射规则 */
export interface ModuleImpactRule {
  /** 匹配影响定义的 domain（缺省=不限） */
  domain?: string;
  /** 匹配影响定义的 category（缺省=不限） */
  category?: string;
  /** 优先命中的 impactKey（更具体，命中则优先于 domain/category 泛配） */
  preferKeys?: string[];
  /** 基准幅度（add 变更量，正数） */
  baseDelta: number;
  /** 变更类型（当前仅 add） */
  changeType: 'add';
}

/**
 * 方向字典 impactModules（中文模块名）→ 影响映射规则。
 * 模块名与 direction-catalog.ts 中 DirectionDef.impactModules 严格对应。
 * category 取值与 impact_definition.category 对齐（base/fate/qualification/faction/inner/karma）。
 */
export const MODULE_IMPACT_MAP: Record<string, ModuleImpactRule> = {
  '根骨资质': { domain: 'character', category: 'qualification', preferKeys: ['character.gen_gu', 'character.wu_xing'], baseDelta: 5, changeType: 'add' },
  '劫数瓶颈': { domain: 'character', category: 'qualification', preferKeys: ['character.ping_jing'], baseDelta: 8, changeType: 'add' },
  '命格气运': { domain: 'character', category: 'fate', preferKeys: ['character.qi_yun'], baseDelta: 5, changeType: 'add' },
  '宗门势力': { domain: 'character', category: 'faction', preferKeys: ['character.sheng_wang'], baseDelta: 5, changeType: 'add' },
  '人际网络': { domain: 'character', category: 'faction', preferKeys: ['character.sheng_wang'], baseDelta: 3, changeType: 'add' },
  '因果业障': { domain: 'character', category: 'karma', preferKeys: ['character.ye_zhang'], baseDelta: 5, changeType: 'add' },
  '世界观域': { domain: 'world', category: 'base', preferKeys: ['world.ling_qi'], baseDelta: 5, changeType: 'add' },
  '道具收获': { domain: 'character', category: 'qualification', preferKeys: ['character.gen_gu'], baseDelta: 3, changeType: 'add' },
};

/** 方向影响建议条目（单条自动映射结果） */
export interface DirectionImpactSuggestion {
  impactKey: string;
  /** 影响定义显示名 */
  name: string;
  domain: string;
  changeType: 'add';
  changeValue: number;
  /** 来源模块名（方向字典 impactModules 中的中文模块） */
  module: string;
  targetType: 'character' | 'world';
  /** character 域时的目标人物ID列表；world 域为空 */
  targetCharacterIds: number[];
  /** 前端展示文案 */
  displayText: string;
}

/**
 * 方向 → 影响 自动映射（纯函数）。
 * 对方向 impactModules 中的每个模块，按 preferKeys 优先、domain/category 泛配兜底的顺序
 * 取最匹配的 1 个启用影响定义，生成基准幅度的 add 建议。同一 impactKey 去重。
 * @param directionCode 主方向编码
 * @param defs 启用影响定义白名单
 * @param characterIds character 域建议的目标人物ID（通常为 POV 人物）
 */
export function suggestImpactsForDirection(
  directionCode: string,
  defs: ImpactDef[],
  characterIds: number[],
): DirectionImpactSuggestion[] {
  const dir = getDirection(directionCode);
  if (!dir) return [];
  const suggestions: DirectionImpactSuggestion[] = [];
  const seenKeys = new Set<string>();
  for (const moduleName of dir.impactModules) {
    const rule = MODULE_IMPACT_MAP[moduleName];
    if (!rule) continue;
    const candidates = defs.filter((d) =>
      (rule.domain ? d.domain === rule.domain : true) &&
      (rule.category ? d.category === rule.category : true)
    );
    const def = candidates.find((d) => rule.preferKeys?.includes(d.impactKey)) ?? candidates[0];
    if (!def || seenKeys.has(def.impactKey)) continue;
    seenKeys.add(def.impactKey);
    const isWorld = def.domain === 'world';
    suggestions.push({
      impactKey: def.impactKey,
      name: def.name,
      domain: def.domain,
      changeType: 'add',
      changeValue: rule.baseDelta,
      module: moduleName,
      targetType: isWorld ? 'world' : 'character',
      targetCharacterIds: isWorld ? [] : characterIds,
      displayText: `${dir.name}·${moduleName} → ${def.name}+${rule.baseDelta}`,
    });
  }
  return suggestions;
}

/**
 * 将方向影响建议展开为 branch_impact_link 同构的"虚拟链接"行，
 * 供 applyBranchImpacts / previewBranchImpacts 在无手工链接时复用既有分组/计算逻辑。
 * character 域按目标人物逐一展开；world 域展开为单条全局（region=null）。
 */
export function buildAutoLinksFromDirection(
  directionCode: string,
  defs: ImpactDef[],
  characterIds: number[],
): any[] {
  const suggestions = suggestImpactsForDirection(directionCode, defs, characterIds);
  const virtualLinks: any[] = [];
  let sortOrder = 0;
  for (const s of suggestions) {
    if (s.targetType === 'character') {
      for (const cid of s.targetCharacterIds) {
        virtualLinks.push({
          targetType: 'character',
          targetId: cid,
          region: null,
          impactKey: s.impactKey,
          changeType: s.changeType,
          changeValue: s.changeValue,
          tagKey: null,
          tagDuration: null,
          displayText: s.displayText,
          sortOrder: sortOrder++,
        });
      }
    } else {
      virtualLinks.push({
        targetType: 'world',
        targetId: null,
        region: null,
        impactKey: s.impactKey,
        changeType: s.changeType,
        changeValue: s.changeValue,
        tagKey: null,
        tagDuration: null,
        displayText: s.displayText,
        sortOrder: sortOrder++,
      });
    }
  }
  return virtualLinks;
}

// ============================================================
// 2. 影响 → 方向 推荐（弱提示，不强制）
// ============================================================

/** 影响 → 方向 推荐规则 */
export interface ImpactDirectionRule {
  /** 触发推荐的影响项 key */
  impactKey: string;
  /** 触发条件（对当前数值） */
  condition: (v: number) => boolean;
  /** 推荐的方向编码 */
  directionCode: string;
  /** 推荐理由文案 */
  reason: string;
}

/**
 * 影响状态 → 方向推荐规则表（修仙题材启发式，弱提示）。
 * 阈值为产品默认，后续可配置化（阶段4 DB 化）。
 */
export const IMPACT_DIRECTION_RULES: ImpactDirectionRule[] = [
  { impactKey: 'character.shang_shi', condition: (v) => v >= 60, directionCode: 'buffer_rest', reason: '伤势较重，宜休整疗伤' },
  { impactKey: 'character.dao_shang', condition: (v) => v >= 60, directionCode: 'buffer_rest', reason: '道伤未愈，宜静养恢复' },
  { impactKey: 'character.xin_mo', condition: (v) => v >= 60, directionCode: 'growth_mind', reason: '心魔滋长，宜心境提升' },
  { impactKey: 'character.dao_xin', condition: (v) => v <= 30, directionCode: 'growth_mind', reason: '道心动摇，宜坚定信念' },
  { impactKey: 'character.ping_jing', condition: (v) => v >= 60, directionCode: 'growth_realm', reason: '瓶颈松动，可尝试突破' },
  { impactKey: 'character.ye_zhang', condition: (v) => v >= 60, directionCode: 'mainplot_karma', reason: '业障深重，宜因果了结' },
  { impactKey: 'character.qi_yun', condition: (v) => v <= 30, directionCode: 'explore_secret', reason: '气运低迷，宜寻觅机缘' },
  { impactKey: 'character.tian_qian', condition: (v) => v >= 60, directionCode: 'buffer_rest', reason: '天谴临身，宜避劫潜修' },
];

/** 方向推荐条目 */
export interface DirectionRecommendation {
  directionCode: string;
  directionName: string;
  /** 所属大类编码 */
  category: string | null;
  /** 触发推荐的影响项 key */
  impactKey: string;
  /** 当前数值 */
  currentValue: number;
  /** 推荐理由 */
  reason: string;
}

/**
 * 影响 → 方向 推荐（纯函数）。
 * 遍历规则表，对满足阈值的影响项产出弱方向提示。同一方向去重（保留首个命中理由）。
 * @param numericValues 当前影响数值集合 {impactKey: number}
 */
export function recommendDirectionsFromState(
  numericValues: Record<string, number>,
): DirectionRecommendation[] {
  const recs: DirectionRecommendation[] = [];
  const seenDirs = new Set<string>();
  for (const rule of IMPACT_DIRECTION_RULES) {
    const v = numericValues[rule.impactKey];
    if (typeof v !== 'number' || !rule.condition(v)) continue;
    if (seenDirs.has(rule.directionCode)) continue;
    seenDirs.add(rule.directionCode);
    const dir = getDirection(rule.directionCode);
    recs.push({
      directionCode: rule.directionCode,
      directionName: dir?.name ?? rule.directionCode,
      category: dir?.category ?? null,
      impactKey: rule.impactKey,
      currentValue: v,
      reason: rule.reason,
    });
  }
  return recs;
}
