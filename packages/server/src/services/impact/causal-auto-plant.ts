/**
 * 因果链自动埋因引擎（纯规则，零 LLM）
 *
 * 职责：
 *   - 从分支选项的 mainDirection → impactModules → category 推断 causeType
 *   - 生成 CreateCausalChainInput（保底 1 条因果线）
 *   - 供 select-branch 事务后 best-effort 调用 + 存量补种脚本复用
 *
 * 设计原则：
 *   - 纯函数（给定选项即可计算），零 LLM，确定性输出
 *   - 失败返回空数组（调用方 try/catch 降级）
 *   - 红线：因果链异常不阻断分支选择/生成主流程
 */
import { getDirection } from '../direction-catalog.js';
import { MODULE_IMPACT_MAP } from './impact-mapping.js';
import type { CreateCausalChainInput } from './causal-chain.service.js';

// ─── category → causeType 映射 ─────────────────────────────────────────────────

/** 影响模块 category → 因果类别映射（一个 category 可能对应多个 causeType，取首个） */
const CATEGORY_CAUSE_MAP: Record<string, { causeType: string; effectHint: string }> = {
  karma:         { causeType: 'grudge',   effectHint: '因果业障累积，日后必有了结' },
  fate:          { causeType: 'prophecy', effectHint: '命运轨迹偏移，未来将有转折' },
  qualification: { causeType: 'secret',   effectHint: '隐藏资质/秘密暴露风险渐增' },
  faction:       { causeType: 'promise',  effectHint: '势力关系变动，盟约/承诺待兑现' },
  base:          { causeType: 'prophecy', effectHint: '世界观层面变化，后续将有回响' },
  inner:         { causeType: 'promise',  effectHint: '心境变化，自我承诺待兑现' },
};

/** 方向大类 → 默认 priority（越大越紧急） */
const CATEGORY_PRIORITY: Record<string, number> = {
  karma: 7,
  fate: 7,
  faction: 6,
  qualification: 5,
  inner: 5,
  base: 4,
};

// ─── 分支选项输入（最小字段集） ─────────────────────────────────────────────────

export interface BranchOptionForCausal {
  id: number;
  optionTitle: string;
  optionDescription?: string | null;
  mainDirection?: string | null;
  impactTags?: string[] | null;
  sourceChapterPlanId?: number | null;
}

// ─── 核心推断函数 ─────────────────────────────────────────────────────────────

/**
 * 从分支选项推断因果线（纯规则，保底 1 条）。
 *
 * 推断逻辑：
 *   1. 取 mainDirection → getDirection → impactModules
 *   2. 遍历 impactModules → MODULE_IMPACT_MAP[module].category → CATEGORY_CAUSE_MAP
 *   3. 取首个命中的 category 生成因果线（去重，最多 2 条）
 *   4. 无方向/无命中时，用 impactTags 首项兜底生成 1 条通用因果线
 *
 * @param option 选定的分支选项
 * @param projectId 项目ID
 * @param sourceChapterNo 分支来源章号（因发生的章节）
 * @returns CreateCausalChainInput[]（0-2 条，通常 1 条）
 */
export function inferCausalFromBranch(
  option: BranchOptionForCausal,
  projectId: number,
  sourceChapterNo: number,
): CreateCausalChainInput[] {
  const results: CreateCausalChainInput[] = [];
  const seenCauseTypes = new Set<string>();

  const dir = getDirection(option.mainDirection);
  if (dir) {
    for (const moduleName of dir.impactModules) {
      const rule = MODULE_IMPACT_MAP[moduleName];
      if (!rule?.category) continue;
      const mapping = CATEGORY_CAUSE_MAP[rule.category];
      if (!mapping || seenCauseTypes.has(mapping.causeType)) continue;
      seenCauseTypes.add(mapping.causeType);

      const priority = CATEGORY_PRIORITY[rule.category] ?? 5;
      const strength = Math.min(90, Math.max(20, rule.baseDelta * 10));
      const targetMax = sourceChapterNo + Math.min(12, Math.max(3, 12 - priority));

      results.push({
        projectId,
        sourceType: 'branch',
        sourceId: option.id,
        sourceChapterNo,
        causeType: mapping.causeType,
        causeDescription: `第${sourceChapterNo}章选择「${option.optionTitle}」(${dir.name}·${moduleName})`,
        effectType: mapping.causeType === 'grudge' ? 'repay' : 'fulfill',
        effectDescription: mapping.effectHint,
        targetChapterMin: sourceChapterNo + 2,
        targetChapterMax: targetMax,
        priority,
        strength,
        directionCode: option.mainDirection ?? null,
        tags: Array.isArray(option.impactTags) ? (option.impactTags as string[]).slice(0, 5) : [],
      });

      // 最多 2 条（多模块方向如 growth_realm 有 2 个 impactModules）
      if (results.length >= 2) break;
    }
  }

  // 兜底：无方向或无命中时，用 impactTags 首项生成通用因果线
  if (!results.length) {
    const tags = Array.isArray(option.impactTags) ? (option.impactTags as string[]) : [];
    const tagHint = tags.length ? `（${tags.slice(0, 3).join('、')}）` : '';
    results.push({
      projectId,
      sourceType: 'branch',
      sourceId: option.id,
      sourceChapterNo,
      causeType: 'promise',
      causeDescription: `第${sourceChapterNo}章选择「${option.optionTitle}」${tagHint}`,
      effectType: 'fulfill',
      effectDescription: '剧情走向已确定，后续章节需承接此选择',
      targetChapterMin: sourceChapterNo + 2,
      targetChapterMax: sourceChapterNo + 8,
      priority: 5,
      strength: 40,
      directionCode: option.mainDirection ?? null,
      tags: tags.slice(0, 5),
    });
  }

  return results;
}
