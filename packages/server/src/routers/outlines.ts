/**
 * 大纲管理路由
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { chatCompletion } from '../llm/client.js';
import * as retriever from '../rag/retriever.js';
import { getSelectedDirectionChain } from '../services/direction.service.js';
import { getDirection, getCategory } from '../services/direction-catalog.js';
import { recallBranchMaterials, MATERIAL_LABELS } from '../services/branch-context.js';
import type { PlotMaterialHit } from '../rag/plot-material-retriever.js';

const app = new Hono();

/** 素材表全名 → basedOnMaterials 类型短名（LLM 回标用） */
const SHORT_BY_TABLE: Record<string, string> = {
  plot_material_encounter: 'encounter',
  plot_material_foreshadow: 'foreshadow',
  plot_material_highlight: 'highlight',
  plot_material_task: 'task',
};
/** basedOnMaterials 类型短名 → 素材表全名（落库 pinnedMaterialIds 用，与正文生成消费格式一致） */
const TABLE_BY_SHORT: Record<string, string> = {
  encounter: 'plot_material_encounter',
  foreshadow: 'plot_material_foreshadow',
  highlight: 'plot_material_highlight',
  task: 'plot_material_task',
};

/**
 * 将 LLM 回标的 basedOnMaterials（[{table,id}]，table 为类型短名）校验并解析为落库结构。
 * 只保留确实召回到的素材（防 LLM 幻觉出不存在的 {table,id}），并把 table 归一为素材表全名。
 * 等价于 branch-context.resolveSourceMaterials 的过滤逻辑，但同时校验 table+id（避免跨表 id 撞号误配）。
 */
function resolveOutlineMaterials(
  basedOnMaterials: unknown,
  recalled: PlotMaterialHit[],
): Array<{ table: string; id: number }> {
  if (!Array.isArray(basedOnMaterials) || basedOnMaterials.length === 0) return [];
  // 召回结果的有效 {全名表:id} 集合
  const valid = new Set(recalled.map((m) => `${m.table}:${Number(m.id)}`));
  const out: Array<{ table: string; id: number }> = [];
  const seen = new Set<string>();
  for (const raw of basedOnMaterials) {
    if (!raw || typeof raw !== 'object') continue;
    const { table, id } = raw as { table?: unknown; id?: unknown };
    const fullTable = typeof table === 'string' ? (TABLE_BY_SHORT[table] || table) : '';
    const numId = Number(id);
    if (!fullTable || !Number.isInteger(numId)) continue;
    const key = `${fullTable}:${numId}`;
    if (!valid.has(key) || seen.has(key)) continue; // 幻觉ID或重复，丢弃
    seen.add(key);
    out.push({ table: fullTable, id: numId });
  }
  return out;
}

// 创建大纲验证
const createOutlineSchema = z.object({
  title: z.string().min(1).max(255),
  synopsis: z.string().min(1),
  volumeNo: z.number().int().min(1).default(1),
  sortOrder: z.number().int().default(0),
  status: z.enum(['draft', 'confirmed', 'writing']).default('draft'),
  keyEvents: z.any().optional(),
  characterArcs: z.any().optional(),
  foreshadowing: z.any().optional(),
  worldBuildingNotes: z.any().optional(),
});

// 更新大纲验证
const updateOutlineSchema = createOutlineSchema.partial();

// AI生成大纲验证（模式归一化 PRD：mode 缺省 one-shot，完全兼容现有调用；stepwise 承接雪花法分步）
const generateOutlineSchema = z.object({
  premise: z.string().min(1, '请提供故事前提'),
  genre: z.string().optional(),
  volumeCount: z.number().int().min(1).max(20).default(3),
  chaptersPerVolume: z.number().int().min(1).max(50).default(10),
  mainCharacters: z.array(z.string()).optional(),
  keyConflicts: z.array(z.string()).optional(),
  // 16-SRS P2-1：前端弹窗四模块资产勾选（可选，传入时仅注入选中资产）
  characterIds: z.array(z.number().int()).optional(),
  weaponIds: z.array(z.number().int()).optional(),
  techniqueIds: z.array(z.number().int()).optional(),
  locationIds: z.array(z.number().int()).optional(),
  // 模式归一化 PRD REQ-2：mode 分流（stepwise 必带 step）
  mode: z.enum(['one-shot', 'stepwise']).default('one-shot'),
  step: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  theme: z.string().optional(),
  characters: z.array(z.any()).optional(),
  volumes: z.array(z.any()).optional(),
});

// ============================================================
// 16-SRS P0-1：四模块世界观资产加载（大纲生成注入）
// 红线：任何查询失败/资产为空均降级跳过注入，绝不阻断大纲生成。
// ============================================================
interface WorldAssetChar {
  id: number;
  name: string;
  gender: string;
  position: string;
  desc: string;
}
interface WorldAssetSimple {
  id: number;
  name: string;
  desc: string;
}
interface WorldAssets {
  characters: WorldAssetChar[];
  weapons: WorldAssetSimple[];
  techniques: WorldAssetSimple[];
  locations: WorldAssetSimple[];
}

/** 加载四模块世界观资产（显式ID选择优先；未选择时全量带上限：人物20/其他各10） */
export async function loadWorldAssets(
  projectId: number,
  sel: { characterIds?: number[]; weaponIds?: number[]; techniqueIds?: number[]; locationIds?: number[] },
): Promise<WorldAssets> {
  const empty: WorldAssets = { characters: [], weapons: [], techniques: [], locations: [] };
  const trunc = (s: string | null | undefined, n = 40) => (s ? s.trim().slice(0, n) : '');

  // 人物（众生百态）
  try {
    const explicit = (sel.characterIds || []).filter((id) => Number.isInteger(id));
    const rows = explicit.length
      ? await creativeDb
          .select({ id: schema.customCharacter.id, name: schema.customCharacter.name, gender: schema.customCharacter.gender, position: schema.customCharacter.position, description: schema.customCharacter.description })
          .from(schema.customCharacter)
          .where(and(eq(schema.customCharacter.projectId, projectId), eq(schema.customCharacter.isDeleted, false), inArray(schema.customCharacter.id, explicit)))
      : await creativeDb
          .select({ id: schema.customCharacter.id, name: schema.customCharacter.name, gender: schema.customCharacter.gender, position: schema.customCharacter.position, description: schema.customCharacter.description })
          .from(schema.customCharacter)
          .where(and(eq(schema.customCharacter.projectId, projectId), eq(schema.customCharacter.isDeleted, false)))
          .orderBy(schema.customCharacter.createdAt)
          .limit(20);
    empty.characters = rows.map((r) => ({ id: r.id, name: r.name, gender: r.gender || 'unknown', position: r.position || '', desc: trunc(r.description) }));
  } catch (e: any) {
    console.warn(`[大纲资产] 人物查询失败（降级跳过）: ${e?.message || e}`);
  }

  // 武器（铸器天工）：weapon_lore.intro 优先，降级 name+grade+category+temperament 组合
  try {
    const explicit = (sel.weaponIds || []).filter((id) => Number.isInteger(id));
    const rows = explicit.length
      ? await creativeDb
          .select({ id: schema.customWeapon.id, name: schema.customWeapon.name, grade: schema.customWeapon.grade, category: schema.customWeapon.category, temperament: schema.customWeapon.temperament })
          .from(schema.customWeapon)
          .where(and(eq(schema.customWeapon.projectId, projectId), eq(schema.customWeapon.isDeleted, false), inArray(schema.customWeapon.id, explicit)))
      : await creativeDb
          .select({ id: schema.customWeapon.id, name: schema.customWeapon.name, grade: schema.customWeapon.grade, category: schema.customWeapon.category, temperament: schema.customWeapon.temperament })
          .from(schema.customWeapon)
          .where(and(eq(schema.customWeapon.projectId, projectId), eq(schema.customWeapon.isDeleted, false)))
          .orderBy(schema.customWeapon.createdAt)
          .limit(10);
    let introByWeapon = new Map<number, string>();
    if (rows.length) {
      try {
        const lores = await creativeDb
          .select({ weaponId: schema.weaponLore.weaponId, intro: schema.weaponLore.intro })
          .from(schema.weaponLore)
          .where(and(inArray(schema.weaponLore.weaponId, rows.map((r) => r.id)), eq(schema.weaponLore.isCurrent, true)));
        introByWeapon = new Map(lores.map((l) => [l.weaponId, l.intro]));
      } catch {
        /* lore 查询失败降级：用组合字段 */
      }
    }
    empty.weapons = rows.map((r) => {
      const intro = introByWeapon.get(r.id);
      const desc = intro ? trunc(intro) : [r.grade, r.category, r.temperament].filter(Boolean).join('，');
      return { id: r.id, name: r.name, desc };
    });
  } catch (e: any) {
    console.warn(`[大纲资产] 武器查询失败（降级跳过）: ${e?.message || e}`);
  }

  // 功法（道法自然）
  try {
    const explicit = (sel.techniqueIds || []).filter((id) => Number.isInteger(id));
    const rows = explicit.length
      ? await creativeDb
          .select({ id: schema.customTechnique.id, name: schema.customTechnique.name, description: schema.customTechnique.description })
          .from(schema.customTechnique)
          .where(and(eq(schema.customTechnique.projectId, projectId), eq(schema.customTechnique.isDeleted, false), inArray(schema.customTechnique.id, explicit)))
      : await creativeDb
          .select({ id: schema.customTechnique.id, name: schema.customTechnique.name, description: schema.customTechnique.description })
          .from(schema.customTechnique)
          .where(and(eq(schema.customTechnique.projectId, projectId), eq(schema.customTechnique.isDeleted, false)))
          .orderBy(schema.customTechnique.createdAt)
          .limit(10);
    empty.techniques = rows.map((r) => ({ id: r.id, name: r.name, desc: trunc(r.description) }));
  } catch (e: any) {
    console.warn(`[大纲资产] 功法查询失败（降级跳过）: ${e?.message || e}`);
  }

  // 地点（山河舆图）
  try {
    const explicit = (sel.locationIds || []).filter((id) => Number.isInteger(id));
    const rows = explicit.length
      ? await creativeDb
          .select({ id: schema.customLocation.id, name: schema.customLocation.name, description: schema.customLocation.description })
          .from(schema.customLocation)
          .where(and(eq(schema.customLocation.projectId, projectId), eq(schema.customLocation.isDeleted, false), inArray(schema.customLocation.id, explicit)))
      : await creativeDb
          .select({ id: schema.customLocation.id, name: schema.customLocation.name, description: schema.customLocation.description })
          .from(schema.customLocation)
          .where(and(eq(schema.customLocation.projectId, projectId), eq(schema.customLocation.isDeleted, false)))
          .orderBy(schema.customLocation.createdAt)
          .limit(10);
    empty.locations = rows.map((r) => ({ id: r.id, name: r.name, desc: trunc(r.description) }));
  } catch (e: any) {
    console.warn(`[大纲资产] 地点查询失败（降级跳过）: ${e?.message || e}`);
  }

  return empty;
}

/** 将四模块资产拼成硬约束注入块（四类全空返回 null，跳过注入） */
export function buildWorldAssetsBlock(assets: WorldAssets): string | null {
  const sections: string[] = [];
  if (assets.characters.length) {
    sections.push('人物：\n' + assets.characters.map((c) => {
      const parts = [c.gender === 'female' ? '女' : c.gender === 'male' ? '男' : '性别未知'];
      if (c.position) parts.push(`${c.position}定位`);
      if (c.desc) parts.push(c.desc);
      return `  · ${c.name}：${parts.join('，')}`;
    }).join('\n'));
  }
  if (assets.weapons.length) {
    sections.push('武器：\n' + assets.weapons.map((w) => `  · ${w.name}：${w.desc || '（无描述）'}`).join('\n'));
  }
  if (assets.techniques.length) {
    sections.push('功法：\n' + assets.techniques.map((t) => `  · ${t.name}：${t.desc || '（无描述）'}`).join('\n'));
  }
  if (assets.locations.length) {
    sections.push('地点：\n' + assets.locations.map((l) => `  · ${l.name}：${l.desc || '（无描述）'}`).join('\n'));
  }
  if (!sections.length) return null;
  return `\n【世界观资产（本项目已有设定，大纲不得与之矛盾，前几章尤其要自然引入；与用户前提冲突时以用户前提为准，只约束设定不约束剧情）】\n${sections.join('\n')}`;
}

// ============================================================
// 模式归一化 PRD REQ-1：公共服务（one-shot 与 stepwise 共用）
//   buildOutlineContext：资产/分支链/素材/engine 上下文构建 + 回标索引
//   saveOutlineVolumes：统一落库（清旧→插卷含 arcs→插章含回标）
// ============================================================
export interface AssetSel {
  characterIds?: number[];
  weaponIds?: number[];
  techniqueIds?: number[];
  locationIds?: number[];
}
export interface OutlineContextOpts {
  /** 显式资产勾选（不传=全量带上限） */
  sel?: AssetSel;
  /** 是否注入资产块 */
  assets?: boolean;
  /** 资产块范围：all=四类全量；chars-locations=仅人物+地点（stepwise step2） */
  assetScope?: 'all' | 'chars-locations';
  /** 是否注入已选定分支走向链 */
  directionChain?: boolean;
  /** 是否召回并注入剧情素材 */
  materials?: boolean;
  /** 是否注入故事引擎约束 */
  engine?: boolean;
  /** 素材召回查询语（materials=true 时使用） */
  recallQuery?: string;
}
export interface OutlineContext {
  worldAssets: WorldAssets;
  assetsBlock: string | null;
  directionBlock: string | null;
  materialsBlock: string | null;
  engineBlock: string | null;
  /** 回标用名称→实体索引（只允许命中本次注入的资产名，防 LLM 幻觉） */
  byName: {
    charByName: Map<string, WorldAssetChar>;
    weaponByName: Map<string, WorldAssetSimple>;
    techniqueByName: Map<string, WorldAssetSimple>;
    locationByName: Map<string, WorldAssetSimple>;
  };
  recalledMaterials: PlotMaterialHit[];
}

/** 构建大纲生成上下文（注入块 + 回标索引）。任何子项失败均降级跳过，绝不阻断。 */
export async function buildOutlineContext(
  projectId: number,
  project: { genre?: string | null; storyEngineType?: string | null; storyEngineDesc?: string | null },
  opts: OutlineContextOpts,
): Promise<OutlineContext> {
  const worldAssets = opts.assets
    ? await loadWorldAssets(projectId, opts.sel || {})
    : { characters: [], weapons: [], techniques: [], locations: [] };

  let assetsBlock: string | null = null;
  if (opts.assets) {
    assetsBlock = opts.assetScope === 'chars-locations'
      ? buildWorldAssetsBlock({ characters: worldAssets.characters, weapons: [], techniques: [], locations: worldAssets.locations })
      : buildWorldAssetsBlock(worldAssets);
  }

  // 已选定分支走向链：前文已通过分支选择确定的方向，新大纲须在此基础上延续
  let directionBlock: string | null = null;
  if (opts.directionChain) {
    const directionChain = await getSelectedDirectionChain(projectId).catch(() => []);
    if (directionChain.length > 0) {
      const chainLines = [...directionChain]
        .sort((a, b) => a.chapterNo - b.chapterNo)
        .map((n) => `第${n.chapterNo}章 → ${getDirection(n.mainDirection)?.name || n.mainDirection || '未分类'}${n.category ? '（' + (getCategory(n.category)?.name || n.category) + '）' : ''}`);
      directionBlock = `\n【已确定剧情走向 - 以下章节已通过分支选择确定方向，新大纲须在此基础上延续】\n${chainLines.join('\n')}\n注意：新规划的卷章须与上述已确定走向衔接，不得矛盾或回溯。`;
    }
  }

  // 剧情素材召回（四类：奇遇/伏笔/高光/任务）：失败/为空均降级跳过
  let recalledMaterials: PlotMaterialHit[] = [];
  let materialsBlock: string | null = null;
  if (opts.materials) {
    try {
      recalledMaterials = await recallBranchMaterials(projectId, opts.recallQuery || '');
    } catch (e: any) {
      console.warn(`[大纲素材] 召回失败（降级跳过）: ${e?.message || e}`);
    }
    if (recalledMaterials.length > 0) {
      const parts: string[] = [];
      parts.push('\n【剧情素材库（可选）- 按需为章节选用，服务主线、勿被素材牵着走】');
      parts.push('以下素材按类型分组、带#编号。若某章借鉴了某素材，在该章 basedOnMaterials 回填 {"table":"<类型短名>","id":<#编号>}（类型短名见各组括号标注）。可不选，不选填 []。标注要诚实，只填真正用到的。');
      const byType = new Map<string, PlotMaterialHit[]>();
      for (const m of recalledMaterials) {
        if (!byType.has(m.table)) byType.set(m.table, []);
        byType.get(m.table)!.push(m);
      }
      for (const [table, hits] of byType) {
        parts.push(`[${MATERIAL_LABELS[table] || table}｜类型短名 ${SHORT_BY_TABLE[table] || table}]`);
        hits.forEach((m) => {
          const lines = [`  #${m.id} ${m.title}`, `     核心情节：${m.corePlot}`];
          if (m.triggerCondition) lines.push(`     触发条件：${m.triggerCondition}`);
          if (m.reward) lines.push(`     机缘收益：${m.reward}`);
          if (m.costOrRisk) lines.push(`     代价风险：${m.costOrRisk}`);
          if (m.emotionalBeat) lines.push(`     情绪节拍：${m.emotionalBeat}`);
          parts.push(lines.join('\n'));
        });
      }
      materialsBlock = parts.join('\n');
    }
  }

  // 故事引擎约束（若项目配置了故事引擎）
  let engineBlock: string | null = null;
  if (opts.engine && (project.storyEngineType || project.storyEngineDesc)) {
    engineBlock = [
      `\n【故事引擎约束】`,
      `本书核心故事引擎：${project.storyEngineType || '未分类'} —— ${project.storyEngineDesc || ''}`,
      `本卷所有核心冲突、关键事件、卷末高潮，都必须服务于这个故事引擎。`,
      `卷目标必须是引擎推进中的一个阶段性里程碑。`,
      `卷末必须有一个明确的兑现点，让读者感觉"这一卷值了"。`,
    ].join('\n');
  }

  return {
    worldAssets,
    assetsBlock,
    directionBlock,
    materialsBlock,
    engineBlock,
    byName: {
      charByName: new Map(worldAssets.characters.map((c) => [c.name, c])),
      weaponByName: new Map(worldAssets.weapons.map((w) => [w.name, w])),
      techniqueByName: new Map(worldAssets.techniques.map((t) => [t.name, t])),
      locationByName: new Map(worldAssets.locations.map((l) => [l.name, l])),
    },
    recalledMaterials,
  };
}

/**
 * 统一落库（one-shot 与 stepwise finalize 共用）：
 * 清旧 planned 章节计划与旧大纲 → 逐卷插 story_outline（含 characterArcs）
 * → 逐章插 chapter_plan（含 pinnedMaterialIds/requiredEntityIds/povCharacterIds 回标）。
 */
export async function saveOutlineVolumes(
  projectId: number,
  volumes: any[],
  ctx?: { byName?: OutlineContext['byName']; recalledMaterials?: PlotMaterialHit[] },
): Promise<{ savedOutlines: any[]; createdPlanCount: number }> {
  const charByName = ctx?.byName?.charByName ?? new Map<string, WorldAssetChar>();
  const weaponByName = ctx?.byName?.weaponByName ?? new Map<string, WorldAssetSimple>();
  const techniqueByName = ctx?.byName?.techniqueByName ?? new Map<string, WorldAssetSimple>();
  const locationByName = ctx?.byName?.locationByName ?? new Map<string, WorldAssetSimple>();
  const recalledMaterials = ctx?.recalledMaterials ?? [];

  // 删除主线章节计划（status='planned'），保留分支衍生章和已生成章
  await creativeDb
    .delete(schema.chapterPlan)
    .where(
      and(
        eq(schema.chapterPlan.projectId, projectId),
        eq(schema.chapterPlan.status, 'planned')
      )
    );
  await creativeDb
    .delete(schema.storyOutline)
    .where(eq(schema.storyOutline.projectId, projectId));

  const savedOutlines: any[] = [];
  let createdPlanCount = 0;
  for (const volume of volumes) {
    const [outline] = await creativeDb
      .insert(schema.storyOutline)
      .values({
        projectId,
        title: volume.title || `第${volume.volumeNumber}卷`,
        synopsis: volume.summary || '',
        volumeNo: volume.volumeNumber || 1,
        sortOrder: volume.volumeNumber || 1,
        status: 'draft',
        keyEvents: volume.chapters || null,
        characterArcs: volume.characterArcs || null,
      })
      .returning();
    savedOutlines.push(outline);

    // 将本卷章节数据物化为章节计划（chapter_plan），供生成控制台使用
    const chapters = Array.isArray(volume.chapters) ? volume.chapters : [];
    for (const ch of chapters) {
      if (!ch || !ch.title) continue;
      // 回标剧情素材：LLM 回标的 basedOnMaterials 过滤幻觉ID后写入 pinnedMaterialIds（复用正文字段，供生成时强制注入）
      const pinnedMaterialIds = resolveOutlineMaterials(ch.basedOnMaterials, recalledMaterials);

      // 16-SRS P1-1：LLM 回标的 entities 按名称精确匹配本次注入的资产 → required_entity_ids
      // 人物/武器/功法用负数ID（负数ID约定：context-builder 负数=创作库自定义实体），地点用名称。
      // 匹配失败的名称静默丢弃（LLM 幻觉防御）并记日志。
      const reqIds: { characters: number[]; locations: string[]; items: number[]; skills: number[] } = {
        characters: [], locations: [], items: [], skills: [],
      };
      const ents = ch.entities;
      if (ents && typeof ents === 'object') {
        const dropped: string[] = [];
        const pickNames = (v: unknown): string[] =>
          Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];
        for (const n of pickNames((ents as any).characters)) {
          const hit = charByName.get(n);
          if (hit && !reqIds.characters.includes(-hit.id)) reqIds.characters.push(-hit.id);
          else if (!hit) dropped.push(n);
        }
        for (const n of pickNames((ents as any).weapons)) {
          const hit = weaponByName.get(n);
          if (hit && !reqIds.items.includes(-hit.id)) reqIds.items.push(-hit.id);
          else if (!hit) dropped.push(n);
        }
        for (const n of pickNames((ents as any).techniques)) {
          const hit = techniqueByName.get(n);
          if (hit && !reqIds.skills.includes(-hit.id)) reqIds.skills.push(-hit.id);
          else if (!hit) dropped.push(n);
        }
        for (const n of pickNames((ents as any).locations)) {
          const hit = locationByName.get(n);
          if (hit && !reqIds.locations.includes(hit.name)) reqIds.locations.push(hit.name);
          else if (!hit) dropped.push(n);
        }
        if (dropped.length) {
          console.warn(`[大纲实体回标] 第${outline.volumeNo}卷第${Number(ch.chapterNumber) || 0}章 丢弃未匹配名称: ${dropped.join('、')}`);
        }
      }
      const hasReqIds = reqIds.characters.length || reqIds.locations.length || reqIds.items.length || reqIds.skills.length;
      // POV锚定：本章回标人物唯一时写入 pov_character_ids（custom_character 无 major/minor 字段，以唯一性为判据）
      const povCharacterIds = reqIds.characters.length === 1 ? reqIds.characters : [];

      await creativeDb.insert(schema.chapterPlan).values({
        projectId,
        outlineId: outline.id,
        volumeNo: outline.volumeNo,
        chapterNo: Number(ch.chapterNumber) || 0,
        title: String(ch.title),
        intent: ch.intent || null,
        emotionTarget: ch.targetEmotion || null,
        pinnedMaterialIds,
        requiredEntityIds: hasReqIds ? reqIds : {},
        povCharacterIds,
        status: 'planned',
      });
      createdPlanCount++;
    }
  }
  return { savedOutlines, createdPlanCount };
}

// 天机推演验证
const divineSchema = z.object({
  /** 用户可选的引导方向（如"偏向战斗""偏向感情线"） */
  direction: z.string().optional(),
  /** 生成几个走向 */
  count: z.number().min(1).max(5).default(3),
});

/** 解析"天机推演"LLM输出为结构化走向数组（解析失败返回空数组） */
function parseDivineOutput(raw: string): Array<{
  title: string;
  chapters: Array<{ chapterNo: number; title: string; summary: string }>;
}> {
  const directions: Array<{
    title: string;
    chapters: Array<{ chapterNo: number; title: string; summary: string }>;
  }> = [];
  // 走向标题头：兼容"走向一/走向1"、半角/全角冒号、可选方括号
  const headerRe = /走向\s*[0-9一二三四五六七八九十]+\s*[:：]\s*(.+)/g;
  const headers: Array<{ index: number; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(raw)) !== null) {
    headers.push({ index: m.index, title: m[1].trim().replace(/^\[|\]$/g, '').trim() });
  }
  if (headers.length === 0) return directions;

  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index;
    const end = i + 1 < headers.length ? headers[i + 1].index : raw.length;
    const block = raw.slice(start, end);
    const chapters: Array<{ chapterNo: number; title: string; summary: string }> = [];
    for (const line of block.split('\n')) {
      // 章节行：- 第N章 [章标题]：概要（兼容可选括号与全/半角冒号）
      const cm = line.match(
        /第\s*(\d+)\s*章?\s*[「\[【]?\s*([^」\]】:：]+?)\s*[」\]】]?\s*[:：]\s*(.+)/
      );
      if (cm) {
        chapters.push({
          chapterNo: Number(cm[1]),
          title: cm[2].trim(),
          summary: cm[3].trim(),
        });
      }
    }
    directions.push({ title: headers[i].title, chapters });
  }
  return directions;
}

/** GET /api/projects/:id/outlines - 大纲列表 */
app.get('/projects/:id/outlines', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }

    const outlines = await creativeDb
      .select()
      .from(schema.storyOutline)
      .where(eq(schema.storyOutline.projectId, projectId))
      .orderBy(schema.storyOutline.volumeNo, schema.storyOutline.sortOrder);

    // 携带各卷章节计划，并解析POV视角人物姓名（供前端展示）
    let nameById = new Map<number, string>();
    try {
      const dir = await retriever.getEntityNameDirectory();
      nameById = new Map(dir.characters.map((c) => [c.id, c.name]));
    } catch {
      // 名目录加载失败不阻断，POV人名留空
    }
    // 自定义人物（负数ID）：名称带★前缀，与前端人物选择器约定一致
    try {
      const customRows = await creativeDb
        .select({ id: schema.customCharacter.id, name: schema.customCharacter.name })
        .from(schema.customCharacter)
        .where(and(
          eq(schema.customCharacter.projectId, projectId),
          eq(schema.customCharacter.isDeleted, false)
        ));
      for (const r of customRows) nameById.set(-Number(r.id), `★${r.name}`);
    } catch {
      // 自定义人物加载失败不阻断
    }

    const outlineIds = outlines.map((o) => o.id);
    const plans = outlineIds.length
      ? await creativeDb
          .select()
          .from(schema.chapterPlan)
          .where(inArray(schema.chapterPlan.outlineId, outlineIds))
          .orderBy(schema.chapterPlan.chapterNo)
      : [];

    const plansByOutline = new Map<number, any[]>();
    for (const p of plans) {
      if (p.outlineId == null) continue;
      const povIds = Array.isArray(p.povCharacterIds) ? (p.povCharacterIds as number[]) : [];
      const enriched = {
        ...p,
        povCharacterNames: povIds
          .map((id) => nameById.get(id))
          .filter((n): n is string => !!n),
      };
      const list = plansByOutline.get(p.outlineId) || [];
      list.push(enriched);
      plansByOutline.set(p.outlineId, list);
    }

    const data = outlines.map((o) => ({ ...o, chapters: plansByOutline.get(o.id) || [] }));

    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:id/outlines - 创建大纲 */
app.post('/projects/:id/outlines', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }

    // 验证项目存在
    const [project] = await creativeDb
      .select()
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, projectId))
      .limit(1);

    if (!project) {
      return c.json({ success: false, error: '项目不存在' }, 404);
    }

    const body = await c.req.json();
    const parsed = createOutlineSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const [outline] = await creativeDb
      .insert(schema.storyOutline)
      .values({
        projectId,
        title: parsed.data.title,
        synopsis: parsed.data.synopsis,
        volumeNo: parsed.data.volumeNo,
        sortOrder: parsed.data.sortOrder,
        status: parsed.data.status,
        keyEvents: parsed.data.keyEvents || null,
        characterArcs: parsed.data.characterArcs || null,
        foreshadowing: parsed.data.foreshadowing || null,
        worldBuildingNotes: parsed.data.worldBuildingNotes || null,
      })
      .returning();

    return c.json({ success: true, data: outline }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/outlines/:id 及 /api/projects/:pid/outlines/:id - 更新大纲 */
const updateOutlineHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的大纲ID' }, 400);
    }

    const body = await c.req.json();
    const parsed = updateOutlineSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.synopsis !== undefined) updateData.synopsis = parsed.data.synopsis;
    if (parsed.data.volumeNo !== undefined) updateData.volumeNo = parsed.data.volumeNo;
    if (parsed.data.sortOrder !== undefined) updateData.sortOrder = parsed.data.sortOrder;
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
    if (parsed.data.keyEvents !== undefined) updateData.keyEvents = parsed.data.keyEvents;
    if (parsed.data.characterArcs !== undefined) updateData.characterArcs = parsed.data.characterArcs;
    if (parsed.data.foreshadowing !== undefined) updateData.foreshadowing = parsed.data.foreshadowing;
    if (parsed.data.worldBuildingNotes !== undefined) updateData.worldBuildingNotes = parsed.data.worldBuildingNotes;

    const [updated] = await creativeDb
      .update(schema.storyOutline)
      .set(updateData)
      .where(eq(schema.storyOutline.id, id))
      .returning();

    if (!updated) {
      return c.json({ success: false, error: '大纲不存在' }, 404);
    }

    return c.json({ success: true, data: updated });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
};
app.put('/outlines/:id', updateOutlineHandler);
app.put('/projects/:pid/outlines/:id', updateOutlineHandler);

/** DELETE /api/outlines/:id 及 /api/projects/:pid/outlines/:id - 删除大纲（级联清理章节计划与场景脚本） */
const deleteOutlineHandler = async (c: any) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的大纲ID' }, 400);
    }

    // 级联删除：
    // - chapter_plan.outline_id 的FK为 set null，不显式删会产生孤儿计划，故应用层先删；
    //   其下 generated_chapter/generation_task 的FK为 set null（已生成正文保留），
    //   分支选项/风格审计/信息点等FK为 cascade，由DB自动清理。
    // - scene_node / scene_edit_log 的FK为 cascade，DB自动清理；应用层补删兼容FK缺失的库。
    const result = await creativeDb.transaction(async (tx) => {
      const plans = await tx
        .delete(schema.chapterPlan)
        .where(eq(schema.chapterPlan.outlineId, id))
        .returning({ id: schema.chapterPlan.id });
      // 场景节点：先查节点再删子表再删节点，兼容FK缺失/无cascade的库
      const scenes = await tx
        .select({ id: schema.sceneNode.id })
        .from(schema.sceneNode)
        .where(eq(schema.sceneNode.outlineId, id));
      if (scenes.length > 0) {
        const nodeIds = scenes.map((s) => s.id);
        // 子表（人物关联/世界观要素/节点关系）
        await tx
          .delete(schema.sceneNodeCharacter)
          .where(inArray(schema.sceneNodeCharacter.sceneNodeId, nodeIds));
        await tx
          .delete(schema.sceneNodeElement)
          .where(inArray(schema.sceneNodeElement.sceneNodeId, nodeIds));
        await tx
          .delete(schema.sceneNodeRelation)
          .where(inArray(schema.sceneNodeRelation.sourceNodeId, nodeIds));
        await tx
          .delete(schema.sceneNode)
          .where(eq(schema.sceneNode.outlineId, id));
      }
      await tx
        .delete(schema.sceneEditLog)
        .where(eq(schema.sceneEditLog.outlineId, id));
      const [deleted] = await tx
        .delete(schema.storyOutline)
        .where(eq(schema.storyOutline.id, id))
        .returning();
      return { deleted, planCount: plans.length, sceneCount: scenes.length };
    });

    if (!result.deleted) {
      return c.json({ success: false, error: '大纲不存在' }, 404);
    }

    const extras: string[] = [];
    if (result.planCount > 0) extras.push(`${result.planCount}条章节计划`);
    if (result.sceneCount > 0) extras.push(`${result.sceneCount}个场景节点`);
    const msg = extras.length ? `大纲已删除（同时清理${extras.join('、')}）` : '大纲已删除';
    return c.json({ success: true, message: msg });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
};
app.delete('/outlines/:id', deleteOutlineHandler);
app.delete('/projects/:pid/outlines/:id', deleteOutlineHandler);

/** POST /api/projects/:id/outlines/generate - AI生成大纲 */
app.post('/projects/:id/outlines/generate', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }

    const [project] = await creativeDb
      .select()
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, projectId))
      .limit(1);

    if (!project) {
      return c.json({ success: false, error: '项目不存在' }, 404);
    }

    const body = await c.req.json();
    const parsed = generateOutlineSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const sel: AssetSel = {
      characterIds: parsed.data.characterIds,
      weaponIds: parsed.data.weaponIds,
      techniqueIds: parsed.data.techniqueIds,
      locationIds: parsed.data.locationIds,
    };

    // ===== 模式归一化 PRD REQ-2：mode='stepwise' 承接雪花法分步生成（按步注入） =====
    if (parsed.data.mode === 'stepwise') {
      const step = parsed.data.step;
      if (!step) {
        return c.json({ success: false, error: 'stepwise 模式必须提供 step(2|3|4|5)' }, 400);
      }
      // 按步注入强度：step2 人物+地点；step3 完整人物库+资产块；step4 全量（资产+分支链+engine）；step5 全量（+素材）
      const ctx = await buildOutlineContext(projectId, project, {
        sel,
        assets: true,
        assetScope: step === 2 ? 'chars-locations' : 'all',
        directionChain: step >= 4,
        materials: step === 5,
        engine: step >= 4,
        recallQuery: step === 5
          ? [parsed.data.premise, parsed.data.genre || project.genre, parsed.data.theme].filter(Boolean).join('；')
          : undefined,
      });

      let systemPrompt = '';
      const userParts: string[] = [`故事前提: ${parsed.data.premise}`];
      if (parsed.data.genre || project.genre) userParts.push(`类型: ${parsed.data.genre || project.genre}`);
      if (parsed.data.theme) userParts.push(`主题与核心冲突: ${parsed.data.theme}`);
      if (parsed.data.characters?.length) {
        userParts.push(`人物概要: ${parsed.data.characters.map((ch: any) => `${ch.name}（${ch.role || ''}：${ch.motivation || ''}）`).join('；')}`);
      }
      if (parsed.data.volumes?.length) {
        userParts.push(`卷结构: ${parsed.data.volumes.map((v: any) => `第${v.volumeNumber}卷《${v.title}》${v.summary ? '：' + v.summary : ''}`).join('；')}`);
      }

      switch (step) {
        case 2:
          systemPrompt = `你是小说策划编辑。根据故事前提，产出「主题与核心冲突」段落。
输出严格JSON：{"theme": "150-300字段落：本书主题立意 + 核心冲突（谁要什么、被什么阻挡、代价是什么）"}
只输出JSON。`;
          break;
        case 3:
          systemPrompt = `你是小说策划编辑。根据前提与主题，产出主要人物概要（3-6人）。
若上下文注入了【世界观资产】人物列表，新人物须与已有角色设定不冲突（不重名、不抢定位），可优先考虑已有角色是否适合承担相应功能。
输出严格JSON：{"characters": [{"name":"姓名","role":"定位（主角/反派/导师/挚友等）","motivation":"核心动机","arc":"成长弧"}]}
只输出JSON。`;
          break;
        case 4:
          userParts.push(`规划卷数: ${parsed.data.volumeCount}`);
          systemPrompt = `你是小说策划编辑。根据前提/主题/人物，产出卷结构（不含章节）。
输出严格JSON：{"volumes": [{"volumeNumber":1,"title":"卷名","summary":"本卷概述100-200字（含本卷目标与卷末高潮）"}]}
只输出JSON。`;
          break;
        case 5:
          userParts.push(`每卷章节数: ${parsed.data.chaptersPerVolume}`);
          systemPrompt = `你是小说策划编辑。基于已确认的卷结构，为每卷产出章节计划。
输出严格JSON：{"volumes": [{"volumeNumber":1,"title":"卷名","summary":"本卷概述","chapters":[{"chapterNumber":1,"title":"章节标题","intent":"本章核心意图50-100字","targetEmotion":"目标情绪","basedOnMaterials":[{"table":"encounter","id":123}],"entities":{"characters":["人物名"],"weapons":["武器名"],"techniques":["功法名"],"locations":["地点名"]}}]}]}
chapterNumber 为全书连续编号。
basedOnMaterials 为本章借鉴的剧情素材：table 取 encounter/foreshadow/highlight/task，id 为素材#编号。须服务主线、按需选用、可不选（不选填 []），只填真正用到的。
entities 为本章计划出场/涉及的自定义资产名：只能从【世界观资产】块列出的名字里选，未注入的名字不许编造；无该类资产填 []；未提供世界观资产块时全部填 []。
只输出JSON。`;
          break;
      }

      if (ctx.assetsBlock) userParts.push(ctx.assetsBlock);
      if (ctx.directionBlock) userParts.push(ctx.directionBlock);
      if (ctx.materialsBlock) userParts.push(ctx.materialsBlock);
      if (ctx.engineBlock) userParts.push(ctx.engineBlock);

      const stepResult = await chatCompletion(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userParts.join('\n') },
        ],
        // step5 对齐 one-shot 上限 16384（PRD §8 风险缓解），其余步保持 8192
        { temperature: 0.9, maxTokens: step === 5 ? 16384 : 8192, configOverride: project.llmConfig as any, timeout: 300000 },
      );

      let stepData: any;
      try {
        const fence = stepResult.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        stepData = JSON.parse((fence ? fence[1] : stepResult).trim());
      } catch {
        return c.json({ success: false, error: '生成内容解析失败，请重试', raw: stepResult }, 422);
      }
      // injectedCharacters 供前端 step3 展示「已注入 N 位已有角色」提示
      return c.json({ success: true, data: stepData, injectedCharacters: ctx.worldAssets.characters.length });
    }

    // ===== one-shot（缺省；契约与行为不变，改调公共服务） =====
    // 构建大纲生成prompt
    const systemPrompt = `你是一位专业的小说策划编辑，擅长构建完整的小说大纲。
请根据用户提供的故事前提，生成一份结构完整的小说大纲。

输出格式要求（严格JSON）：
{
  "volumes": [
    {
      "volumeNumber": 1,
      "title": "卷名",
      "summary": "本卷概述（100-200字）",
      "characterArcs": ["角色A在本卷的成长变化", "角色B的情感线发展"],
      "chapters": [
        {
          "chapterNumber": 1,
          "title": "章节标题",
          "intent": "本章核心意图（50-100字）",
          "targetEmotion": "目标情绪",
          "conflictType": "冲突类型",
          "basedOnMaterials": [{"table": "encounter", "id": 123}],
          "entities": {"characters": ["人物名"], "weapons": ["武器名"], "techniques": ["功法名"], "locations": ["地点名"]}
        }
      ]
    }
  ]
}

注意：
- characterArcs 是本卷中主要角色的成长/变化弧线，每卷2-4条
- basedOnMaterials 为本章借鉴的剧情素材：table 取 encounter/foreshadow/highlight/task，id 为素材#编号。须服务主线、按需选用、可不选（不选填 []），只填真正用到的，勿被素材牵着走
- entities 为本章计划出场/涉及的自定义资产名：只能从【世界观资产】块列出的名字里选，未注入的名字不许编造；无该类资产填 []；未提供世界观资产块时全部填 []
- 只输出JSON，不要其他文字`;

    const userParts: string[] = [];
    userParts.push(`故事前提: ${parsed.data.premise}`);
    userParts.push(`类型: ${parsed.data.genre || project.genre}`);
    userParts.push(`卷数: ${parsed.data.volumeCount}`);
    userParts.push(`每卷章节数: ${parsed.data.chaptersPerVolume}`);
    if (parsed.data.mainCharacters?.length) {
      userParts.push(`主要人物: ${parsed.data.mainCharacters.join('、')}`);
    }
    if (parsed.data.keyConflicts?.length) {
      userParts.push(`核心冲突: ${parsed.data.keyConflicts.join('、')}`);
    }

    // 模式归一化 PRD REQ-1：上下文构建改调公共服务（注入顺序与原版一致：资产→分支链→素材→engine）
    const recallQuery = [
      parsed.data.premise,
      parsed.data.genre || project.genre,
      parsed.data.mainCharacters?.join('、'),
      parsed.data.keyConflicts?.join('、'),
    ].filter(Boolean).join('；');
    const ctx = await buildOutlineContext(projectId, project, {
      sel,
      assets: true,
      directionChain: true,
      materials: true,
      engine: true,
      recallQuery,
    });
    if (ctx.assetsBlock) userParts.push(ctx.assetsBlock);
    if (ctx.directionBlock) userParts.push(ctx.directionBlock);
    if (ctx.materialsBlock) userParts.push(ctx.materialsBlock);
    if (ctx.engineBlock) userParts.push(ctx.engineBlock);

    const llmConfig = project.llmConfig as any;
    const result = await chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userParts.join('\n') },
      ],
      { temperature: 0.9, maxTokens: 16384, configOverride: llmConfig, timeout: 300000 }
    );

    // 解析AI生成的大纲
    let outlineData: any;
    try {
      const jsonMatch = result.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : result;
      outlineData = JSON.parse(jsonStr.trim());
    } catch {
      // 如果解析失败，先清除旧主线章节计划和旧大纲再插入 fallback 单条
      await creativeDb
        .delete(schema.chapterPlan)
        .where(
          and(
            eq(schema.chapterPlan.projectId, projectId),
            eq(schema.chapterPlan.status, 'planned')
          )
        );
      await creativeDb
        .delete(schema.storyOutline)
        .where(eq(schema.storyOutline.projectId, projectId));
      const [outline] = await creativeDb
        .insert(schema.storyOutline)
        .values({
          projectId,
          title: 'AI生成大纲',
          synopsis: result,
          volumeNo: 1,
          status: 'draft',
        })
        .returning();
      return c.json({ success: true, data: outline, raw: true });
    }

    // 模式归一化 PRD REQ-1：落库改调公共服务（清旧→插卷含 arcs→插章含回标，与原版逐项一致）
    const { savedOutlines, createdPlanCount } = await saveOutlineVolumes(
      projectId,
      outlineData.volumes || [],
      { byName: ctx.byName, recalledMaterials: ctx.recalledMaterials },
    );

    return c.json({ success: true, data: savedOutlines, createdPlanCount });
  } catch (error: any) {
    return c.json({ success: false, error: `大纲生成失败: ${error.message}` }, 500);
  }
});

// ============================================================
// 模式归一化 PRD REQ-2：stepwise-draft 草稿读写 + finalize 同构落库
// （语义迁移自 snowflake.ts；snowflake_draft 字段保留，旧草稿可续进）
// ============================================================

/** GET 读取分步草稿（续进） */
app.get('/projects/:id/outlines/stepwise-draft', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const [project] = await creativeDb
      .select({ snowflakeDraft: schema.creativeProject.snowflakeDraft })
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, projectId))
      .limit(1);
    if (!project) return c.json({ success: false, error: '项目不存在' }, 404);
    return c.json({ success: true, data: project.snowflakeDraft ?? null });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT 保存分步草稿（整体覆盖；中途退出可续进） */
app.put('/projects/:id/outlines/stepwise-draft', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const body = await c.req.json();
    await creativeDb
      .update(schema.creativeProject)
      .set({ snowflakeDraft: body, updatedAt: new Date() })
      .where(eq(schema.creativeProject.id, projectId));
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

const finalizeSchema = z.object({
  premise: z.string().min(1),
  theme: z.string().optional(),
  characters: z.array(z.any()).optional(),
  // 资产勾选（可选；传入时 finalize 回标仅命中选中资产）
  characterIds: z.array(z.number().int()).optional(),
  weaponIds: z.array(z.number().int()).optional(),
  techniqueIds: z.array(z.number().int()).optional(),
  locationIds: z.array(z.number().int()).optional(),
  volumes: z.array(z.object({
    volumeNumber: z.number().optional(),
    title: z.string().min(1),
    summary: z.string().optional(),
    characterArcs: z.any().optional(),
    chapters: z.array(z.object({
      chapterNumber: z.number().optional(),
      title: z.string().min(1),
      intent: z.string().optional(),
      targetEmotion: z.string().optional(),
      basedOnMaterials: z.any().optional(),
      entities: z.any().optional(),
    })).default([]),
  })).min(1),
});

/** POST 分步完成落库：升级为 saveOutlineVolumes 同构落库（characterArcs/pinnedMaterialIds/requiredEntityIds/povCharacterIds 全齐），随后清空草稿 */
app.post('/projects/:id/outlines/finalize', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    const [project] = await creativeDb
      .select()
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, projectId))
      .limit(1);
    if (!project) return c.json({ success: false, error: '项目不存在' }, 404);

    const body = await c.req.json();
    const parsed = finalizeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    // 重新加载资产与素材召回用于回标（与 one-shot 幻觉防御同语义：未匹配名称静默丢弃）
    const ctx = await buildOutlineContext(projectId, project, {
      sel: {
        characterIds: parsed.data.characterIds,
        weaponIds: parsed.data.weaponIds,
        techniqueIds: parsed.data.techniqueIds,
        locationIds: parsed.data.locationIds,
      },
      assets: true,
      materials: true,
      recallQuery: [parsed.data.premise, project.genre, parsed.data.theme].filter(Boolean).join('；'),
    });

    const { savedOutlines, createdPlanCount } = await saveOutlineVolumes(
      projectId,
      parsed.data.volumes,
      { byName: ctx.byName, recalledMaterials: ctx.recalledMaterials },
    );

    // 清空草稿（已落库）
    await creativeDb
      .update(schema.creativeProject)
      .set({ snowflakeDraft: null, updatedAt: new Date() })
      .where(eq(schema.creativeProject.id, projectId));

    return c.json({ success: true, data: savedOutlines, createdPlanCount });
  } catch (error: any) {
    return c.json({ success: false, error: `落库失败: ${error.message}` }, 500);
  }
});

/** POST /api/projects/:id/outlines/divine - 天机推演：推演未来剧情走向 */
app.post('/projects/:id/outlines/divine', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }

    const [project] = await creativeDb
      .select()
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, projectId))
      .limit(1);

    if (!project) {
      return c.json({ success: false, error: '项目不存在' }, 404);
    }

    const body = await c.req.json();
    const parsed = divineSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const { direction, count } = parsed.data;

    // 1. 最近的章节计划（按 chapterNo 降序取最近5章，再按升序排列供prompt阅读）
    const recentPlans = await creativeDb
      .select({
        chapterNo: schema.chapterPlan.chapterNo,
        title: schema.chapterPlan.title,
        summary: schema.chapterPlan.intent,
      })
      .from(schema.chapterPlan)
      .where(eq(schema.chapterPlan.projectId, projectId))
      .orderBy(desc(schema.chapterPlan.chapterNo))
      .limit(5);
    const recentChapters = [...recentPlans].sort((a, b) => a.chapterNo - b.chapterNo);

    // 2. 人物列表（取前10个主要角色的姓名）
    const characterRows = await creativeDb
      .select({ name: schema.customCharacter.name })
      .from(schema.customCharacter)
      .where(eq(schema.customCharacter.projectId, projectId))
      .limit(10);
    const characterNames = characterRows.map((r) => r.name).filter(Boolean);

    // 3. 拼装prompt
    const prompt = `你是一位仙侠小说的剧情策划师。基于以下已有剧情，推演 ${count} 个可能的未来走向。

## 最近剧情
${recentChapters.map((ch) => `第${ch.chapterNo}章 ${ch.title}: ${ch.summary || ''}`).join('\n') || '（暂无章节计划）'}

## 主要角色
${characterNames.join('、') || '（暂未设定）'}

${direction ? `## 引导方向\n${direction}\n` : ''}
请生成 ${count} 个不同的剧情走向，每个走向包含 2-3 章概要。格式：
---
走向一：[标题]
- 第N章 [章标题]：[一句话概要]
- 第N+1章 [章标题]：[一句话概要]
---
走向二：...

要求：各走向之间差异明显（如一个偏战斗、一个偏情感、一个偏阴谋），保持仙侠风格。`;

    const llmConfig = project.llmConfig as any;
    const raw = await chatCompletion(
      [{ role: 'user', content: prompt }],
      { temperature: 0.9, maxTokens: 2000, configOverride: llmConfig }
    );

    // 4. 解析LLM输出（解析失败时directions为空数组，raw保留原文）
    const directions = parseDivineOutput(raw);

    return c.json({ success: true, data: { raw, directions } });
  } catch (error: any) {
    return c.json({ success: false, error: `天机推演失败: ${error.message}` }, 500);
  }
});

/** POST /api/projects/:id/outlines/divine/adopt - 采纳推演结果为卷大纲（v1.5.1） */
app.post('/projects/:id/outlines/divine/adopt', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '缺少项目ID' }, 400);

    const body = await c.req.json();
    const { direction } = body;
    if (!direction || !Array.isArray(direction.chapters) || !direction.chapters.length) {
      return c.json({ success: false, error: '缺少有效的推演结果（direction.chapters 数组）' }, 400);
    }

    // 计算新卷号
    const vols = await creativeDb
      .select({ volumeNo: schema.storyOutline.volumeNo })
      .from(schema.storyOutline)
      .where(eq(schema.storyOutline.projectId, projectId));
    const maxVol = vols.reduce((m, v) => Math.max(m, v.volumeNo), 0);
    const nextVol = maxVol + 1;

    // 构造 volumes 数组（追加模式：新卷号=MAX+1）
    const volumes = [{
      volumeNo: nextVol,
      title: direction.title || `第${nextVol}卷（来自推演）`,
      synopsis: direction.chapters.map((ch: any) => ch.summary || ch.title || '').join('；'),
      chapterPlans: direction.chapters.map((ch: any, i: number) => ({
        chapterNo: ch.chapterNo || i + 1,
        title: ch.title || `第${i + 1}章`,
        summary: ch.summary || '',
      })),
    }];

    const { savedOutlines, createdPlanCount } = await saveOutlineVolumes(
      projectId, volumes
    );

    return c.json({
      success: true,
      data: { createdPlans: createdPlanCount, volumeNo: nextVol, outlineIds: savedOutlines.map((o: any) => o.id) },
    });
  } catch (error: any) {
    return c.json({ success: false, error: `采纳失败: ${error.message}` }, 500);
  }
});

export default app;
