/**
 * 分支生成上下文采集服务
 * 为 BranchGeneratorAgent 提供两类输入：
 *   1. 四类剧情素材定向召回（奇遇/伏笔手法/人物高光/任务链），供分支借鉴并回标来源；
 *   2. 世界观快照（人物/宗门规制/岁时节令/文风心智模型），供"后续大概率怎么发展"推演。
 *
 * 红线：全部 best-effort，任一采集失败降级为空，绝不阻断分支生成主流程。
 */
import { inArray, eq, and } from 'drizzle-orm';
import { zhuxianDb, creativeDb } from '../db/index.js';
import * as zschema from '../db/zhuxian-schema.js';
import * as cschema from '../db/creative-schema.js';
import { recallMaterialsByQuery, type PlotMaterialHit } from '../rag/plot-material-retriever.js';
import { searchFactionRules, searchSeasonEvents, getStyleGlobalConfig } from '../rag/retriever.js';

/** 素材表 → 中文标注 */
export const MATERIAL_LABELS: Record<string, string> = {
  plot_material_encounter: '奇遇',
  plot_material_foreshadow: '伏笔手法',
  plot_material_highlight: '人物高光',
  plot_material_task: '任务链',
};

/** 分支生成需要召回的四类素材表 */
const BRANCH_MATERIAL_TABLES = [
  'plot_material_encounter',
  'plot_material_foreshadow',
  'plot_material_highlight',
  'plot_material_task',
] as const;

/** 分支选项借鉴的素材引用（落库到 chapter_branch_option.source_materials） */
export interface BranchSourceMaterial {
  table: string;
  id: number;
  title: string;
  label: string;
}

/** 世界观快照（供推演） */
export interface BranchWorldview {
  characters: { id: number; name: string; faction?: string; realm?: string; personality?: string }[];
  factionRules: { ruleName: string; ruleType?: string; ruleContent?: string }[];
  seasonEvents: { eventName: string; eventType?: string; cycleDescription?: string; atmosphere?: string }[];
  styleName?: string;
  mentalModels?: string[];
  decisionHeuristics?: string[];
}

/**
 * 定向召回四类剧情素材（每类 topN=2），合并返回。
 * 每条 hit 自带 table 与 id，供 LLM basedOn 回标与落库。
 */
export async function recallBranchMaterials(
  projectId: number,
  query: string,
  topNPerType = 2,
): Promise<PlotMaterialHit[]> {
  const all: PlotMaterialHit[] = [];
  for (const table of BRANCH_MATERIAL_TABLES) {
    try {
      const hits = await recallMaterialsByQuery(query, table, projectId, topNPerType, 0.3);
      all.push(...hits);
    } catch (e: any) {
      console.warn(`[分支素材] ${table} 召回失败（降级跳过）: ${e?.message || e}`);
    }
  }
  return all;
}

/**
 * 采集世界观快照：POV 人物 + 宗门规制 + 岁时节令 + 文风心智模型。
 * 规制/节令按"是否提及 POV 人物名"轻量优先排序后截取，全部失败降级为空。
 */
export async function gatherBranchWorldview(
  bookId: number,
  povCharacterIds: number[],
): Promise<BranchWorldview> {
  const wv: BranchWorldview = { characters: [], factionRules: [], seasonEvents: [] };

  // 1. POV 人物
  try {
    if (povCharacterIds.length) {
      const rows = await zhuxianDb
        .select({
          id: zschema.novelCharacterLib.id,
          name: zschema.novelCharacterLib.name,
          faction: zschema.novelCharacterLib.faction,
          realm: zschema.novelCharacterLib.realm,
          personality: zschema.novelCharacterLib.personality,
        })
        .from(zschema.novelCharacterLib)
        .where(inArray(zschema.novelCharacterLib.id, povCharacterIds))
        .limit(6);
      wv.characters = rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        faction: r.faction || undefined,
        realm: r.realm || undefined,
        personality: r.personality ? String(r.personality).slice(0, 120) : undefined,
      }));
    }
  } catch (e: any) {
    console.warn(`[分支世界观] 人物采集失败（降级为空）: ${e?.message || e}`);
  }

  const charNames = wv.characters.map((c) => c.name).filter((n) => n && n.length >= 2);
  const mentionsChar = (text: string | undefined | null) =>
    !!text && charNames.some((n) => text.includes(n));

  // 2. 宗门规制（提及 POV 人物的优先，最多4条）
  try {
    const rules = await searchFactionRules({ bookId, pageSize: 30 });
    wv.factionRules = rules
      .map((r) => ({
        ruleName: r.ruleName || '',
        ruleType: r.ruleType || undefined,
        ruleContent: r.ruleContent ? String(r.ruleContent).slice(0, 100) : undefined,
        _prio: mentionsChar(r.ruleName) || mentionsChar(r.ruleContent) ? 0 : 1,
      }))
      .sort((a, b) => a._prio - b._prio)
      .slice(0, 4)
      .map(({ _prio, ...rest }) => rest);
  } catch (e: any) {
    console.warn(`[分支世界观] 宗门规制采集失败（降级为空）: ${e?.message || e}`);
  }

  // 3. 岁时节令（提及 POV 人物的优先，最多3条）
  try {
    const events = await searchSeasonEvents({ bookId, pageSize: 30 });
    wv.seasonEvents = events
      .map((ev) => ({
        eventName: ev.eventName || '',
        eventType: ev.eventType || undefined,
        cycleDescription: ev.cycleDescription || undefined,
        atmosphere: ev.atmosphere ? String(ev.atmosphere).slice(0, 80) : undefined,
        _prio: mentionsChar(ev.eventName) || mentionsChar(ev.relatedFaction) ? 0 : 1,
      }))
      .sort((a, b) => a._prio - b._prio)
      .slice(0, 3)
      .map(({ _prio, ...rest }) => rest);
  } catch (e: any) {
    console.warn(`[分支世界观] 岁时节令采集失败（降级为空）: ${e?.message || e}`);
  }

  // 4. 文风心智模型（styleName + mentalModels + decisionHeuristics）
  try {
    const style = await getStyleGlobalConfig(bookId);
    if (style) {
      wv.styleName = style.styleName || undefined;
      wv.mentalModels = Array.isArray(style.mentalModels)
        ? (style.mentalModels as string[]).slice(0, 4)
        : undefined;
      wv.decisionHeuristics = Array.isArray(style.decisionHeuristics)
        ? (style.decisionHeuristics as string[]).slice(0, 4)
        : undefined;
    }
  } catch (e: any) {
    console.warn(`[分支世界观] 文风采集失败（降级为空）: ${e?.message || e}`);
  }

  return wv;
}

/**
 * 将 LLM 回标的 basedOn 素材ID 校验并解析为落库结构。
 * 只保留确实注入过的素材（防 LLM 幻觉出不存在的ID）。
 */
export function resolveSourceMaterials(
  basedOnIds: unknown,
  injected: PlotMaterialHit[],
): BranchSourceMaterial[] {
  if (!Array.isArray(basedOnIds)) return [];
  const byId = new Map<number, PlotMaterialHit>();
  for (const m of injected) byId.set(Number(m.id), m);
  const out: BranchSourceMaterial[] = [];
  const seen = new Set<number>();
  for (const raw of basedOnIds) {
    const id = Number(raw);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    const hit = byId.get(id);
    if (!hit) continue; // 幻觉ID，丢弃
    seen.add(id);
    out.push({ table: hit.table, id, title: hit.title, label: MATERIAL_LABELS[hit.table] || hit.table });
  }
  return out;
}

/** 成长工坊实体引用（注入分支生成 prompt，供剧情实名引用法宝；旧功法已退役，功法能力由自定义功法模块提供） */
export interface WorkshopEntityRef {
  type: 'magic_item';
  name: string;
  grade: string;
  /** 成长来源：base/fusion/mutation/upgrade/evolution */
  growthType: string;
  coreEffect?: string;
}

/** 成长来源 → 中文标注 */
const GROWTH_TYPE_LABELS: Record<string, string> = {
  base: '原生', fusion: '融合', mutation: '变异', upgrade: '强化', evolution: '进化',
};
export { GROWTH_TYPE_LABELS };

/**
 * 采集项目成长工坊实体（法宝），供分支生成注入。
 * 旧自定义功法已退役（由自定义功法模块取代），故此处仅采集法宝。
 * 红线：best-effort，查询失败降级为空数组，绝不阻断分支生成。
 */
export async function gatherWorkshopEntities(
  projectId: number,
  limitPerType = 6,
): Promise<WorkshopEntityRef[]> {
  const out: WorkshopEntityRef[] = [];
  try {
    const items = await creativeDb
      .select({
        name: cschema.customMagicItemLib.name,
        grade: cschema.customMagicItemLib.grade,
        growthType: cschema.customMagicItemLib.growthType,
        coreAbilities: cschema.customMagicItemLib.coreAbilities,
      })
      .from(cschema.customMagicItemLib)
      .where(and(eq(cschema.customMagicItemLib.projectId, projectId), eq(cschema.customMagicItemLib.isDeleted, false)))
      .limit(limitPerType);
    for (const it of items) {
      out.push({ type: 'magic_item', name: it.name, grade: it.grade, growthType: it.growthType, coreEffect: it.coreAbilities || undefined });
    }
  } catch (e: any) {
    console.warn(`[分支工坊] 法宝采集失败（降级为空）: ${e?.message || e}`);
  }
  return out;
}
