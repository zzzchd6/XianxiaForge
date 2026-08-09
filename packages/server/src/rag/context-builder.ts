/**
 * 上下文构建器 - 为写作Agent组装完整的创作上下文
 * 参考InkOS的Composer设计
 */
import * as retriever from './retriever.js';
import { buildStyleContext } from './style.js';
import { recallPlotMaterials, recallMaterialsByQuery, fetchPinnedMaterials, recallDeterministicMaterials, type RagRecallConfig, type PinnedMaterialRef, type PlotMaterialHit } from './plot-material-retriever.js';
import { getCollectedQuotes } from '../pipeline/quote-extractor.js';
import { buildImpactContext, buildRelationContext } from '../services/impact/impact.service.js';
import { getNextMilestone } from '../services/milestone-service.js';
import { getActiveArc, getArcWithProgress } from '../services/branch-arc-service.js';
import { retrieveBenchmarkMaterials } from '../services/benchmark.js';
import { buildCausalContext, formatCausalContextBlock } from '../services/impact/causal-chain.service.js';
import { creativeDb } from '../db/index.js';
import * as creativeSchema from '../db/creative-schema.js';
import { getTrait, getForm, getMaterial } from '../data/weapon-catalog.js';
import {
  getDao, getGuidance, getCoreTrait, getAbility, getBacklash, DAO_REALMS, hasClash,
} from '../data/technique-catalog.js';
import { eq, and, inArray, or, isNull, sql, desc } from 'drizzle-orm';
import { findPosition, findRaceCategory, findRaceSub, findTalentByName, stanceLabel } from '@novel-studio/shared';
import {
  getLatestConfirmedSnapshots,
  getConfirmedTimeline,
  getGeneratedChapterSummaries,
  getBranchContext,
  getUnresolvedForeshadows,
  getActiveTasks,
  getGrowthStagesForChapter,
  getCustomRelations,
} from '../state/store.js';
import type {
  ContextPackage,
  CharacterContext,
  FactionContext,
  LocationContext,
  SkillContext,
  ItemContext,
  RelationContext,
  SceneContext,
  ChapterPlanContext,
  EntityIdSet,
  RetrievalInfo,
  GrowthStageContext,
  CustomEntityContext,
  ForeshadowContext,
  ForeshadowTechniqueContext,
  GrowthHighlightContext,
  PlotMaterialContext,
  HardFactsContext,
  CharacterStateContext,
  TimelineMilestoneContext,
} from '../types.js';

/** 上下文构建结果：上下文包 + 检索元信息 */
export interface ContextBuildResult {
  context: ContextPackage;
  retrieval: RetrievalInfo;
}

/** 实体ID解析结构 */
interface RequiredEntityIds {
  characters?: number[];
  factions?: number[];
  locations?: string[];
  skills?: number[];
  items?: number[];
}

/**
 * 为章节构建完整上下文
 */
export async function buildContextForChapter(
  chapterPlan: {
    id: number;
    chapterNumber: number;
    volumeNo?: number | null;
    title: string;
    intent: string;
    targetWordCount: number | null;
    targetEmotion: string | null;
    conflictType: string | null;
    sceneBreakdown: string | null;
    requiredEntityIds: unknown;
    povCharacterIds?: number[] | null;
    /** 关键剧情锚点（模块1）：本章必须按序覆盖的强制事件数组 */
    mustHaveEvents?: string[] | null;
    /** 分支溯源：本章来源的分支选项ID（需求12，空=非分支衍生） */
    branchSourceOptionId?: number | null;
    /** 分支溯源：父章节计划ID（需求12，用于回溯影响标签历史栈） */
    branchParentChapterId?: number | null;
    /** 章末钩子类型（需求6） */
    hookType?: string | null;
    /** 钩子强度（需求6） */
    hookIntensity?: string | null;
    /** 冲突值分值（天命P0#1） */
    conflictScore?: number | null;
    /** 冲突星级（天命P0#1） */
    conflictRating?: string | null;
    /** 是否峰值章节（天命P0#1） */
    isPeak?: boolean | null;
    /** 章节类型（天命P1#4） */
    chapterType?: string | null;
    /** 手动固定的剧情素材引用（二期RAG人工干预，jsonb 数组：[{table, id}]） */
    pinnedMaterialIds?: unknown;
  },
  project: {
    id: number;
    title: string;
    genre: string;
    styleGuide: string | null;
  },
  rules: string[],
  ragConfig?: RagRecallConfig,
  /** v1.4 生成功能开关（来自 project.generation_config，控制声音/知识注入等新特性） */
  generationFlags?: Record<string, any>
): Promise<ContextBuildResult> {
  // 解析需要的实体ID（显式声明 = 章节计划"人物下发"）
  const entityIds = parseEntityIds(chapterPlan.requiredEntityIds);

  // 记录显式声明的实体（合并前快照，用于区分来源）
  const explicit: EntityIdSet = {
    characters: [...(entityIds.characters || [])],
    factions: [...(entityIds.factions || [])],
    locations: [...(entityIds.locations || [])],
    skills: [...(entityIds.skills || [])],
    items: [...(entityIds.items || [])],
  };

  // 自动关联：根据章节标题/意图/场景分解中提到的名字，从诛仙库匹配实体
  // （requiredEntityIds 为空时也能拉取到相关设定）
  const chapterText = [chapterPlan.title, chapterPlan.intent, chapterPlan.sceneBreakdown]
    .filter(Boolean)
    .join(' ');
  const linked = await autoLinkEntities(chapterText, project.id);

  // 记录自动关联新增的实体（去掉显式已有的，得到"纯自动关联"部分）
  const autoLinked: EntityIdSet = {
    characters: linked.characters.filter((id) => !explicit.characters.includes(id)),
    factions: linked.factions.filter((id) => !explicit.factions.includes(id)),
    locations: linked.locations.filter((n) => !explicit.locations.includes(n)),
    skills: linked.skills.filter((id) => !explicit.skills.includes(id)),
    items: linked.items.filter((id) => !explicit.items.includes(id)),
  };

  // 合并显式声明 + 自动关联（去重）
  entityIds.characters = mergeIds(entityIds.characters, linked.characters);
  entityIds.factions = mergeIds(entityIds.factions, linked.factions);
  entityIds.locations = mergeNames(entityIds.locations, linked.locations);
  entityIds.skills = mergeIds(entityIds.skills, linked.skills);
  entityIds.items = mergeIds(entityIds.items, linked.items);

  // POV视角人物也并入出场人物，确保其设定一定被加载（供Writer锚定/Auditor参照）
  const povIds = Array.isArray(chapterPlan.povCharacterIds) ? chapterPlan.povCharacterIds : [];
  if (povIds.length) {
    entityIds.characters = mergeIds(entityIds.characters, povIds);
  }

  // 组装 RAG 查询文本（title + intent + 场景前200字 + 情绪/冲突/类型）
  const ragQueryParts: string[] = [chapterPlan.title, chapterPlan.intent];
  if (chapterPlan.sceneBreakdown) {
    ragQueryParts.push(chapterPlan.sceneBreakdown.slice(0, 200));
  }
  if (chapterPlan.targetEmotion) ragQueryParts.push(chapterPlan.targetEmotion);
  if (chapterPlan.conflictType) ragQueryParts.push(chapterPlan.conflictType);
  if (chapterPlan.chapterType) ragQueryParts.push(chapterPlan.chapterType);
  const ragQueryText = ragQueryParts.filter(Boolean).join('。');

  // 负数ID分流：正数=诛仙库原生人物，负数=创作库自定义人物（custom_character）
  const allCharacterIds = entityIds.characters || [];
  const zhuxianCharIds = allCharacterIds.filter((id) => id > 0);
  const customCharIds = allCharacterIds.filter((id) => id < 0);

  // 并行获取所有上下文数据
  const [characters, factions, locations, skills, items, relations, prevSummaries, scenes, style, stateSnapshots, timelineMilestones, distillMap, techniqueDistillMap, branchContext, foreshadows, activeTasks, growthStages, customRelations, customEntities, ragRecall, customCharacters, customLocations, benchmarkRows] =
    await Promise.all([
      // 获取核心人物设定（仅诛仙库正数ID）
      zhuxianCharIds.length
        ? retriever.getCharactersByIds(zhuxianCharIds)
        : Promise.resolve([]),
      // 获取门派设定
      entityIds.factions?.length
        ? retriever.getFactionsByIds(entityIds.factions)
        : Promise.resolve([]),
      // 获取地点设定
      entityIds.locations?.length
        ? retriever.getLocationsByNames(entityIds.locations)
        : Promise.resolve([]),
      // 获取功法设定
      entityIds.skills?.length
        ? retriever.getSkillsByIds(entityIds.skills)
        : Promise.resolve([]),
      // 获取法宝设定
      entityIds.items?.length
        ? retriever.getMagicItemsByIds(entityIds.items)
        : Promise.resolve([]),
      // 获取人物关系（取前3个诛仙库核心人物的关系）
      getRelationsForCharacters(zhuxianCharIds.slice(0, 3)),
      // 获取前文摘要（本项目已生成的最近3章，修复原先误读诛仙源库的问题）
      getGeneratedChapterSummaries(project.id, chapterPlan.chapterNumber, 3),
      // 获取相关场景（暂用空数组，需要embedding才能做向量检索）
      Promise.resolve([] as any[]),
      // 获取作者风格铁律（诛仙库风格层，bookId=1）
      buildStyleContext(1, {
        targetEmotion: chapterPlan.targetEmotion,
        conflictType: chapterPlan.conflictType,
      }),
      // 获取本项目已确认的人物状态快照（全局状态追踪）
      getLatestConfirmedSnapshots(project.id),
      // 获取本项目已确认的时间线里程碑（全局状态追踪）
      getConfirmedTimeline(project.id, 15),
      // 获取出场人物的蒸馏数据（心智模型/决策启发式/人生阶段，诛仙库）
      zhuxianCharIds.length
        ? retriever.getCharacterDistillations(zhuxianCharIds)
        : Promise.resolve(new Map()),
      // 获取涉及功法的蒸馏数据（属性/招式/关系，诛仙库）
      entityIds.skills?.length
        ? retriever.getTechniqueDistillations(entityIds.skills)
        : Promise.resolve(new Map()),
      // 获取剧情分支上下文（本章由分支选项衍生时，回溯影响标签历史栈；需求12）
      getBranchContext(chapterPlan.branchSourceOptionId, chapterPlan.branchParentChapterId),
      // 获取本项目尚未回收的伏笔线（pending/planted，模块2）
      getUnresolvedForeshadows(project.id),
      // 获取本项目进行中的任务线（active/progressing，素材深度融入·第2层）
      getActiveTasks(project.id),
      // 获取本项目按当前章节号匹配的人物成长阶段（模块3）
      getGrowthStagesForChapter(project.id, chapterPlan.chapterNumber),
      // 获取本项目自定义人物关系（模块8，优先级高于原生）
      getCustomRelations(project.id, entityIds.characters || []),
      // 获取本项目自定义功法/法宝（模块9，关联到出场人物的自定义实体）
      getCustomEntitiesForCharacters(project.id, entityIds.characters || []),
      // 二期RAG：语义召回剧情素材/领域知识/参考文风（降级不阻断）；手动固定素材强制注入
      recallPlotMaterials(ragQueryText, project.id, {
        ...(ragConfig || { enabled: false }),
        pinnedRefs: parsePinnedMaterialRefs(chapterPlan.pinnedMaterialIds),
      }),
      // 获取本项目自定义人物（负数ID，创作库 custom_character）
      getCustomCharactersByIds(project.id, customCharIds),
      // 获取本项目自定义地点（10-山河舆图：章节文本提及的地点注入环境描述）
      getCustomLocationsForChapter(project.id, chapterText),
      // 开源借鉴 PRD v1.1 M5：对标素材召回（pinned>语义>关键字，内部全降级不阻断）
      retrieveBenchmarkMaterials(project.id, ragQueryText, 3),
    ]);

  // 动态叙事引擎双轨上下文（12-SRS：下一个待达成里程碑 + 活跃分支弧，降级不阻断）
  let narrativeBlock: string | null = null;
  try {
    const [nextMs, activeArc] = await Promise.all([
      getNextMilestone(project.id),
      getActiveArc(project.id),
    ]);
    const lines: string[] = [];
    if (nextMs) {
      lines.push(`【叙事里程碑】下一个待达成里程碑「${nextMs.label}」${nextMs.importance === 'critical' ? '（关键节点，必须发生）' : ''}${nextMs.description ? '：' + nextMs.description : ''}`);
      const musts = Array.isArray(nextMs.mustHappen) ? (nextMs.mustHappen as unknown[]).map(String).filter(Boolean) : [];
      if (musts.length) lines.push(`必须达成的要素: ${musts.join('；')}`);
      lines.push('本章剧情应向该里程碑自然推进，但不得突兀跳步直接达成。');
    }
    if (activeArc) {
      const arcInfo = await getArcWithProgress(activeArc.id);
      if (arcInfo) {
        lines.push(`【分支弧】当前活跃分支弧「${activeArc.title}」（已写${arcInfo.progress}/${arcInfo.estimatedLength ?? 2}章）${activeArc.premise ? '：' + activeArc.premise : ''}`);
        if (arcInfo.shouldConverge) {
          lines.push('本章应开始收束该分支弧，向主线里程碑汇合，避免继续发散。');
        } else {
          lines.push('本章须沿该分支弧设定展开，保持分支剧情连贯，勿无故回到主线。');
        }
      }
    }
    if (lines.length) narrativeBlock = '\n' + lines.join('\n');
  } catch (e: any) {
    console.warn(`[叙事引擎] 双轨上下文构建失败（降级不注入）: ${e?.message || e}`);
  }

  // 1B 确定性触发召回：按章节类型/场景关键词硬触发奇遇/任务素材（bypass 语义阈值），
  // 与语义召回结果合并去重，保证推进/关键章必有奇遇/任务素材浮现。降级不阻断。
  let deterministicMaterials: PlotMaterialHit[] = [];
  try {
    deterministicMaterials = await recallDeterministicMaterials({
      projectId: project.id,
      chapterType: chapterPlan.chapterType || undefined,
      intentText: [chapterPlan.intent, chapterPlan.sceneBreakdown, chapterPlan.targetEmotion]
        .filter(Boolean)
        .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
        .join('；'),
    });
  } catch (e: any) {
    console.warn(`[RAG] 确定性触发召回异常降级: ${e?.message || e}`);
  }
  const mergedPlotMaterials = mergePlotMaterials(ragRecall.materials, deterministicMaterials);

  // 解析POV视角人物姓名（优先用已加载人物，缺失的查实体名目录兜底；自定义人物负数ID也在此解析）
  let povCharacterNames: string[] = [];
  if (povIds.length) {
    const nameById = new Map<number, string>(characters.map((c) => [c.id, c.name]));
    for (const cc of customCharacters) nameById.set(cc.id, cc.name);
    const missing = povIds.filter((id) => id > 0 && !nameById.has(id));
    if (missing.length) {
      try {
        const dir = await retriever.getEntityNameDirectory();
        for (const c of dir.characters) nameById.set(c.id, c.name);
      } catch {
        // 名目录加载失败不阻断，仅用已加载人物解析
      }
    }
    povCharacterNames = povIds
      .map((id) => nameById.get(id))
      .filter((n): n is string => !!n);
  }

  // 模块11：人物感知金句召回——优先取本章POV/出场人物的收藏金句，不足则全局补足。
  // 降级红线：任何异常返回空数组（不注入），绝不阻断生成主流程。
  let collectedQuotes: { characterName?: string; quoteText: string }[] = [];
  // FUNC-01：冰山台词参考（从 characterKnowledge 取 infoLevel='iceberg' 的条目，最近5条）
  let icebergDialogues: { characterName?: string; snippet: string; chapterNo?: number }[] = [];
  try {
    const relevantNames = Array.from(
      new Set([
        ...povCharacterNames,
        ...characters.map((c) => c.name).filter((n): n is string => !!n),
        ...customCharacters.map((c) => c.name),
      ])
    );
    collectedQuotes = await getCollectedQuotes(project.id, relevantNames);
  } catch (e: any) {
    console.warn(`[金句召回] 人物感知召回失败（降级为空）: ${e?.message || e}`);
  }
  // 冰山台词取数（独立 try/catch，降级不阻断）
  try {
    const allCharIds = [...allCharacterIds];
    if (allCharIds.length) {
      const { eq, and, desc, inArray } = await import('drizzle-orm');
      const negIds = allCharIds.filter((id) => id < 0).map((id) => Math.abs(id));
      if (negIds.length) {
        const rows = await creativeDb
          .select({
            characterId: creativeSchema.characterKnowledge.characterId,
            content: creativeSchema.characterKnowledge.knowledgeContent,
            chapterNo: creativeSchema.characterKnowledge.acquiredChapter,
          })
          .from(creativeSchema.characterKnowledge)
          .where(
            and(
              eq(creativeSchema.characterKnowledge.projectId, project.id),
              eq(creativeSchema.characterKnowledge.infoLevel, 'iceberg'),
              eq(creativeSchema.characterKnowledge.enabled, true),
              inArray(creativeSchema.characterKnowledge.characterId, negIds),
            )
          )
          .orderBy(desc(creativeSchema.characterKnowledge.createdAt))
          .limit(5);
        const nameById = new Map<number, string>();
        for (const cc of customCharacters) nameById.set(cc.id, cc.name);
        icebergDialogues = rows.map((r) => ({
          characterName: nameById.get(r.characterId),
          snippet: r.content.slice(0, 300),
          chapterNo: r.chapterNo ?? undefined,
        }));
      }
    }
  } catch (e: any) {
    console.warn(`[冰山台词召回] 取数失败（降级为空）: ${e?.message || e}`);
  }

  // v1.4 PRD-A：角色声音配置 + 已知信息清单取数（受开关控制，降级不阻断，控体量防 token 预算挤兑）
  let voiceBlock: string | null = null;
  let knowledgeBlock: string | null = null;
  try {
    const nameById = new Map<number, string>();
    for (const c of characters) if (c.name) nameById.set(c.id, c.name);
    for (const cc of customCharacters) nameById.set(cc.id, cc.name);
    if (generationFlags?.characterVoiceEnabled === true && allCharacterIds.length) {
      const voices = await getCharacterVoiceConfigs(project.id, allCharacterIds);
      voiceBlock = buildVoiceContextBlock(voices, nameById);
    }
    if (generationFlags?.characterKnowledgeEnabled === true && allCharacterIds.length) {
      const knowledge = await getCharacterKnowledgeEntries(project.id, allCharacterIds, chapterPlan.chapterNumber);
      knowledgeBlock = buildKnowledgeContextBlock(knowledge, nameById);
      // 记忆卡随知识开关一同注入（每人≤3条，high优先），附加在知识块之后
      const memoryBlock = buildMemoryContextBlock(
        await getCharacterMemoryCards(project.id, allCharacterIds),
        nameById
      );
      if (memoryBlock) {
        knowledgeBlock = knowledgeBlock ? `${knowledgeBlock}\n\n${memoryBlock}` : memoryBlock;
      }
    }
  } catch (e: any) {
    console.warn(`[v1.4心智] 声音/知识取数失败（降级不注入）: ${e?.message || e}`);
  }

  // 模块8：合并自定义关系（优先级高于原生关系，同一对人物自定义覆盖原生）
  const mergedRelations: RelationContext[] = [];
  const customPairKeys = new Set(customRelations.map((r) => `${r.charAId}-${r.charBId}`));
  // 先加入原生关系（排除已被自定义覆盖的对）
  for (const r of relations) {
    const key1 = `${r.charAId}-${r.charBId}`;
    const key2 = `${r.charBId}-${r.charAId}`;
    if (!customPairKeys.has(key1) && !customPairKeys.has(key2)) {
      mergedRelations.push({ ...r, source: 'native' });
    }
  }
  // 再加入自定义关系
  for (const r of customRelations) {
    mergedRelations.push({
      charAId: r.charAId,
      charBId: r.charBId,
      relType: r.relType,
      description: r.description,
      interactPattern: r.interactPattern,
      source: 'custom',
    });
  }

  // B1：上一章成长阶段（用于阶段跃迁比对，首章无上一章则为空）
  const prevGrowthStages = chapterPlan.chapterNumber > 1
    ? await getGrowthStagesForChapter(project.id, chapterPlan.chapterNumber - 1)
    : [];

  // 素材联动（均带全降级保护，召回失败返回空数组不阻断写作）：
  //  - A1+A2 伏笔手法联动：本章需埋设/回收的伏笔 → 定向召回伏笔手法（绑定项强制取回）
  //  - B1+B2 成长高光联动：本章阶段跃迁/关键节点 → 定向召回高光素材
  const [foreshadowTechniques, growthHighlights, impactContext, relationCtx, causalItems] = await Promise.all([
    buildForeshadowTechniques(foreshadows, chapterPlan.chapterNumber, project.id),
    buildGrowthHighlights(growthStages, prevGrowthStages, project.id),
    buildImpactContext(project.id, povIds, chapterPlan.chapterNumber, chapterPlan.volumeNo ?? 1),
    buildRelationContext(project.id, povIds, chapterPlan.chapterNumber),
    buildCausalContext(project.id, chapterPlan.chapterNumber),
  ]);

  // 成长弧光三向联动（阶段跃迁×影响 + 关系升华×关系状态），依赖上面 Promise.all 的结果
  const growthLinkageText = buildGrowthLinkageBlock(growthStages, prevGrowthStages, impactContext, relationCtx.text);

  // 组装ContextPackage（诛仙库人物 + 自定义人物合并）
  const contextPackage: ContextPackage = {
    characters: [...characters.map((c) => {
      const distill = distillMap.get(c.id);
      // 模块3：匹配当前章节号对应的成长阶段（优先按characterId，退回按名字）
      const gs = growthStages.find(
        (g) => g.characterId === c.id || (g.characterName && g.characterName === c.name)
      );
      return {
        id: c.id,
        name: c.name,
        allTitles: c.allTitles || undefined,
        personality: c.personality || undefined,
        faction: c.faction || undefined,
        realm: c.realm || undefined,
        coreSkills: c.coreSkills || undefined,
        growthLine: c.growthLine || undefined,
        writingProfile: c.writingProfile || undefined,
        mentalModels: distill?.mentalModels.length ? distill.mentalModels : undefined,
        heuristics: distill?.heuristics.length ? distill.heuristics : undefined,
        lifeStages: distill?.lifeStages.length ? distill.lifeStages : undefined,
        currentGrowthStage: gs ? { name: gs.name, traits: gs.traits, description: gs.description } : undefined,
      };
    }), ...customCharacters],
    factions: factions.map((f) => ({
      id: f.id,
      name: f.name,
      camp: f.camp || undefined,
      headquarters: f.headquarters || undefined,
      leader: f.leader || undefined,
      cultivationFeature: f.cultivationFeature || undefined,
    })),
    locations: [...locations.map((l) => ({
      id: l.id,
      name: l.name,
      level: l.level || undefined,
      environment: l.environment || undefined,
      relatedFaction: l.relatedFaction || undefined,
      keyEvents: l.keyEvents || undefined,
    })), ...customLocations.filter((cl) => !locations.some((l) => l.name === cl.name))],
    skills: skills.map((s) => {
      const distill = techniqueDistillMap.get(s.id);
      return {
        id: s.id,
        name: s.name,
        grade: s.grade || undefined,
        skillType: s.skillType || undefined,
        coreEffect: s.coreEffect || undefined,
        threshold: s.threshold || undefined,
        attributes: distill?.attributes?.length ? distill.attributes : undefined,
        moves: distill?.moves?.length ? distill.moves : undefined,
        relations: distill?.relations?.length ? distill.relations : undefined,
      };
    }),
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      grade: i.grade || undefined,
      coreAbilities: i.coreAbilities || undefined,
      owners: i.owners || undefined,
    })),
    relations: mergedRelations,
    prevSummaries,
    scenes: scenes.map((s: any) => ({
      id: s.id,
      sceneNo: s.sceneNo,
      coreEvent: s.coreEvent || undefined,
      emotionMainType: s.emotionMainType || undefined,
      conflictLevel: s.conflictLevel || undefined,
    })),
    chapterPlan: {
      id: chapterPlan.id,
      chapterNumber: chapterPlan.chapterNumber,
      volumeNo: chapterPlan.volumeNo ?? undefined,
      title: chapterPlan.title,
      intent: chapterPlan.intent,
      targetWordCount: chapterPlan.targetWordCount || 3000,
      targetEmotion: chapterPlan.targetEmotion || undefined,
      conflictType: chapterPlan.conflictType || undefined,
      sceneBreakdown: chapterPlan.sceneBreakdown || undefined,
      povCharacterIds: povIds.length ? povIds : undefined,
      povCharacterNames: povCharacterNames.length ? povCharacterNames : undefined,
      mustHaveEvents: Array.isArray(chapterPlan.mustHaveEvents)
        ? chapterPlan.mustHaveEvents.filter((e) => typeof e === 'string' && e.trim())
        : undefined,
      hookType: chapterPlan.hookType || undefined,
      hookIntensity: chapterPlan.hookIntensity || undefined,
      conflictScore: chapterPlan.conflictScore ?? undefined,
      conflictRating: chapterPlan.conflictRating || undefined,
      isPeak: chapterPlan.isPeak ?? undefined,
      chapterType: chapterPlan.chapterType || undefined,
    },
    rules,
    style,
    stateSnapshots,
    timelineMilestones,
    foreshadows: foreshadows.length ? foreshadows : undefined,
    activeTasks: activeTasks.length ? activeTasks : undefined,
    growthStages: growthStages.length ? growthStages : undefined,
    collectedQuotes: collectedQuotes.length ? collectedQuotes : undefined,
    // FUNC-01：冰山台词参考（从 characterKnowledge 取 infoLevel='iceberg' 的条目）
    icebergDialogues: icebergDialogues.length ? icebergDialogues : undefined,
    customEntities: customEntities.length ? customEntities : undefined,
    resonanceEffects: detectResonanceEffects(customEntities, characters),
    branchContext,
    // 动态叙事引擎：里程碑 + 分支弧双轨参照（12-SRS，非空即注入）
    narrativeContext: narrativeBlock ? { text: narrativeBlock } : undefined,
    // 二期RAG：素材召回结果。固定素材在降级时也会注入，故 materials 非空即注入；
    // 1B 确定性触发素材已合并进 mergedPlotMaterials（pinned 优先、确定性次之、语义补足）。
    // 领域知识/参考文风仅自动召回，降级时为空不注入。
    plotMaterials: mergedPlotMaterials.length ? mergedPlotMaterials : undefined,
    // 开源借鉴 PRD v1.1 M5：对标素材（拆文资产），非空即注入；pinned 必须融入，其余借鉴节奏/文风
    benchmarkMaterials: benchmarkRows.length
      ? benchmarkRows.map((b) => ({
          id: b.id,
          sourceBookTitle: b.source_book_title,
          materialType: b.material_type,
          title: b.title,
          contentMd: b.content_md,
          tags: b.tags?.length ? b.tags : undefined,
          pinned: b.pinned,
        }))
      : undefined,
    domainKnowledge: !ragRecall.degraded && ragRecall.domain.length ? ragRecall.domain : undefined,
    stylePresetRag: !ragRecall.degraded && ragRecall.style ? ragRecall.style : undefined,
    // 素材联动：伏笔手法联动(A1+A2) 与 成长高光联动(B1+B2)，非空即注入
    foreshadowTechniques: foreshadowTechniques.length ? foreshadowTechniques : undefined,
    growthHighlights: growthHighlights.length ? growthHighlights : undefined,
    // 成长弧光三向联动（阶段跃迁×影响 + 关系升华×关系状态）
    growthLinkageContext: growthLinkageText ? { text: growthLinkageText } : undefined,
    // 分支影响体系：人物影响块或世界观块任一非空即注入（影响快照为数值单一权威）
    impactContext: impactContext.characterBlocks.length || impactContext.worldBlock
      ? { characterBlocks: impactContext.characterBlocks, worldBlock: impactContext.worldBlock }
      : undefined,
    // 阶段4：人物关系状态（两两关系维度非空即注入）
    relationContext: relationCtx.text ? { text: relationCtx.text } : undefined,
    // 阶段4：待回收因果线（有未兑现因果即注入）
    causalContext: causalItems.length ? { text: formatCausalContextBlock(causalItems) } : undefined,
    // P0：硬性事实约束（在 contextPackage 组装完毕后填充，见下方）
    hardFacts: undefined,
    // v1.4：生成功能开关透传（Writer 三节结构等 prompt 块据此启用）
    generationFlags: generationFlags || undefined,
    // v1.4 PRD-A：声音/已知信息块（非空即注入，取数端已按开关把关）
    voiceContext: voiceBlock ? { text: voiceBlock } : undefined,
    knowledgeContext: knowledgeBlock ? { text: knowledgeBlock } : undefined,
  };

  // P0：硬性事实约束——复用已组装的人物/状态/时间线（类型安全的 CharacterContext[]）
  // 15-SRS P0-4：另注入有 chapterUpdates 记录但未被 autoLink 命中的自定义人物（跨章连续性）
  const narrativeRows = await getNarrativeFactsForChapter(project.id);
  contextPackage.hardFacts = buildHardFacts(
    contextPackage.characters,
    stateSnapshots,
    timelineMilestones,
    narrativeRows,
  );

  // 组装检索元信息（供前端展示"本次检索到了什么、来源是什么"）
  const retrieval: RetrievalInfo = {
    explicit,
    autoLinked,
    counts: {
      characters: contextPackage.characters.length,
      factions: contextPackage.factions.length,
      locations: contextPackage.locations.length,
      skills: contextPackage.skills.length,
      items: contextPackage.items.length,
      relations: contextPackage.relations.length,
      prevSummaries: contextPackage.prevSummaries.length,
    },
    estimatedTokens: estimateTokens(serializeContext(contextPackage)),
  };

  return { context: contextPackage, retrieval };
}

/**
 * 解析required_entity_ids字段
 */
/** 解析章节计划手动固定的素材引用（jsonb [{table,id}] → PinnedMaterialRef[]，过滤非法元素） */
function parsePinnedMaterialRefs(raw: unknown): PinnedMaterialRef[] {
  if (!Array.isArray(raw)) return [];
  const refs: PinnedMaterialRef[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const { table, id } = item as { table?: unknown; id?: unknown };
      if (typeof table === 'string' && Number.isInteger(id)) {
        refs.push({ table, id: id as number });
      }
    }
  }
  return refs;
}

/**
 * 1B 合并语义召回与确定性触发召回的剧情素材。
 * 优先级：pinned（作者固定）> deterministic（确定性触发）> 语义召回；按 table:id 去重，总数上限 8。
 */
function mergePlotMaterials(semantic: PlotMaterialHit[], deterministic: PlotMaterialHit[]): PlotMaterialHit[] {
  const BUDGET = 8;
  const seen = new Set<string>();
  const out: PlotMaterialHit[] = [];
  const push = (m: PlotMaterialHit) => {
    const key = `${m.table}:${m.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };
  // pinned 最先（语义召回里已含 pinned，且排在前面）
  for (const m of semantic) if (m.pinned) push(m);
  // 确定性触发素材次之
  for (const m of deterministic) push(m);
  // 语义召回剩余补足
  for (const m of semantic) push(m);
  return out.slice(0, BUDGET);
}

/**
 * A1+A2：伏笔写作联动
 * 对本章需要埋设(plantChapter==本章)或回收(resolveChapter==本章)的伏笔，
 * 定向召回「伏笔手法」素材（plot_material_foreshadow）供 Writer 参考。
 *  - A2：伏笔已绑定 referencedMaterialId → 强制取回该手法（pinned，不受阈值/召回开关影响）
 *  - A1：再用 标题+描述+DNA 组装查询语义召回 topN 条补足（去重绑定项）
 * 全降级保护：召回失败返回空 techniques，绝不阻断写作。
 */
async function buildForeshadowTechniques(
  foreshadows: ForeshadowContext[],
  chapterNo: number,
  projectId: number
): Promise<ForeshadowTechniqueContext[]> {
  // 仅处理本章有动作的伏笔：埋设章==本章 或 回收章==本章
  const active = foreshadows.filter(
    (f) => f.plantChapter === chapterNo || f.resolveChapter === chapterNo
  );
  if (!active.length) return [];

  const results: ForeshadowTechniqueContext[] = [];
  for (const f of active) {
    const action: 'plant' | 'resolve' = f.resolveChapter === chapterNo ? 'resolve' : 'plant';
    const techniques: PlotMaterialContext[] = [];
    const seenIds = new Set<number>();

    // A2：绑定手法强制取回
    if (f.referencedMaterialId) {
      const bound = await fetchPinnedMaterials(
        [{ table: 'plot_material_foreshadow', id: f.referencedMaterialId }],
        projectId
      );
      for (const b of bound) {
        techniques.push(b);
        seenIds.add(b.id);
      }
    }

    // A1：语义召回补足（标题+描述+DNA 组装查询）
    const queryParts: (string | undefined)[] = [f.title, f.description];
    if (f.dnaSubject || f.dnaAction || f.dnaObject) {
      queryParts.push(`${f.dnaSubject || ''}${f.dnaAction || ''}${f.dnaObject || ''}`);
    }
    if (f.dnaEmotion) queryParts.push(f.dnaEmotion);
    const queryText = queryParts.filter(Boolean).join(' ');
    const recalled = await recallMaterialsByQuery(queryText, 'plot_material_foreshadow', projectId, 2);
    for (const r of recalled) {
      if (seenIds.has(r.id)) continue;
      techniques.push(r);
      seenIds.add(r.id);
    }

    results.push({ foreshadowId: f.id, foreshadowTitle: f.title, action, techniques });
  }
  return results;
}

/**
 * B1+B2：成长高光联动
 * 比对每个人物「本章」与「上一章」匹配到的成长阶段：
 *  - B1：阶段发生跃迁（stageNo 不同，含上一章无阶段→本章有阶段）→ 过渡/高光时刻
 *  - B2：本章阶段被作者标记为关键节点(isKeyNode) → 强制视为高光时刻
 * 命中即定向召回「高光」素材（plot_material_highlight）供 Writer 参考。全降级保护。
 */
async function buildGrowthHighlights(
  currentStages: GrowthStageContext[],
  prevStages: GrowthStageContext[],
  projectId: number
): Promise<GrowthHighlightContext[]> {
  if (!currentStages.length) return [];

  // 上一章阶段按人物key索引（characterId 优先，退回 characterName）
  const prevByKey = new Map<string, GrowthStageContext>();
  for (const p of prevStages) {
    prevByKey.set(String(p.characterId ?? p.characterName ?? ''), p);
  }

  const results: GrowthHighlightContext[] = [];
  for (const cur of currentStages) {
    const key = String(cur.characterId ?? cur.characterName ?? '');
    const prev = prevByKey.get(key);
    const isTransition = !prev || prev.stageNo !== cur.stageNo;
    const isKeyNode = cur.isKeyNode === true;
    if (!isTransition && !isKeyNode) continue;

    // 查询文本：人物名 + 阶段名 + 阶段类型 + 特质 + 描述（增强语义匹配精度）
    const queryParts: (string | undefined)[] = [cur.characterName, cur.name, cur.stageType];
    if (cur.traits?.length) queryParts.push(cur.traits.join('、'));
    if (cur.description) queryParts.push(cur.description);
    const queryText = queryParts.filter(Boolean).join(' ');
    const highlights = await recallMaterialsByQuery(queryText, 'plot_material_highlight', projectId, 2);

    results.push({
      characterName: cur.characterName,
      characterId: cur.characterId,
      fromStage: prev?.name,
      toStage: cur.name,
      isKeyNode,
      highlights,
    });
  }
  return results;
}

/**
 * 成长弧光三向联动（纯文本块）：
 *  1. 阶段跃迁 × 影响数值：当检测到阶段跃迁时，将该人物当前影响快照数值并列展示
 *  2. 关系升华 × 关系状态：当 stage_type='关系升华' 的阶段生效时，追加当前关系状态文本
 * 全降级保护：任何异常返回 null（不注入）。
 */
function buildGrowthLinkageBlock(
  currentStages: GrowthStageContext[],
  prevStages: GrowthStageContext[],
  impactContext: { characterBlocks: { characterName: string; text: string }[]; worldBlock: string | null },
  relationText: string | null,
): string | null {
  try {
    if (!currentStages.length) return null;

    const prevByKey = new Map<string, GrowthStageContext>();
    for (const p of prevStages) {
      prevByKey.set(String(p.characterId ?? p.characterName ?? ''), p);
    }

    const lines: string[] = [];

    for (const cur of currentStages) {
      const key = String(cur.characterId ?? cur.characterName ?? '');
      const prev = prevByKey.get(key);
      const isTransition = !prev || prev.stageNo !== cur.stageNo;

      // 联动1：阶段跃迁 × 影响数值
      if (isTransition) {
        const impactBlock = impactContext.characterBlocks.find(
          (b) => b.characterName === cur.characterName
        );
        const impactHint = impactBlock ? ` | 当前影响：${impactBlock.text.replace(/\n/g, '，')}` : '';
        lines.push(`★ ${cur.characterName ?? '主角'} 阶段跃迁「${prev?.name ?? '无'}→${cur.name}」[${cur.stageType ?? ''}]${impactHint}`);
      }

      // 联动2：关系升华 × 关系状态
      if (cur.stageType === '关系升华' && relationText) {
        lines.push(`★ ${cur.characterName ?? '主角'} 处于「关系升华」阶段 | 当前关系状态：${relationText.replace(/\n/g, ' ')}`);
      }
    }

    return lines.length ? lines.join('\n') : null;
  } catch {
    return null;
  }
}

function parseEntityIds(raw: unknown): RequiredEntityIds {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  return {
    characters: Array.isArray(obj.characters) ? obj.characters as number[] : [],
    factions: Array.isArray(obj.factions) ? obj.factions as number[] : [],
    locations: Array.isArray(obj.locations) ? obj.locations as string[] : [],
    skills: Array.isArray(obj.skills) ? obj.skills as number[] : [],
    items: Array.isArray(obj.items) ? obj.items as number[] : [],
  };
}

/** 合并两个ID数组并去重 */
function mergeIds(a: number[] | undefined, b: number[]): number[] {
  return Array.from(new Set([...(a || []), ...b]));
}

/** 合并两个名称数组并去重 */
function mergeNames(a: string[] | undefined, b: string[]): string[] {
  return Array.from(new Set([...(a || []), ...b]));
}

/** 自动关联结果 */
interface AutoLinkResult {
  characters: number[];
  factions: number[];
  locations: string[];
  skills: number[];
  items: number[];
}

/**
 * 自动实体关联：扫描章节文本中出现的实体名字，返回对应ID
 * 只匹配长度>=2的名字，避免误伤；各类实体设置数量上限防止上下文过载
 * 15-SRS P0-3：人物匹配同时覆盖本项目 custom_character（命中推负数ID，走既有负数分流链路）
 */
async function autoLinkEntities(chapterText: string, projectId: number): Promise<AutoLinkResult> {
  const result: AutoLinkResult = { characters: [], factions: [], locations: [], skills: [], items: [] };
  if (!chapterText || chapterText.trim().length < 2) return result;

  try {
    const dir = await retriever.getEntityNameDirectory();

    // 人物：上限10个
    for (const c of dir.characters) {
      if (c.name && c.name.length >= 2 && chapterText.includes(c.name)) {
        result.characters.push(c.id);
        if (result.characters.length >= 10) break;
      }
    }
    // 15-SRS P0-3：自定义人物（与诛仙库人物共用上限10个），命中推 -(realId)
    if (result.characters.length < 10) {
      try {
        const customRows = await creativeDb
          .select({ id: creativeSchema.customCharacter.id, name: creativeSchema.customCharacter.name })
          .from(creativeSchema.customCharacter)
          .where(and(
            eq(creativeSchema.customCharacter.projectId, projectId),
            eq(creativeSchema.customCharacter.isDeleted, false),
          ));
        for (const c of customRows) {
          if (result.characters.length >= 10) break;
          if (c.name && c.name.length >= 2 && chapterText.includes(c.name)) {
            result.characters.push(-c.id);
          }
        }
      } catch {
        // 自定义人物查询失败不阻断（降级为仅诛仙库匹配）
      }
    }
    // 门派：上限5个
    for (const f of dir.factions) {
      if (f.name && f.name.length >= 2 && chapterText.includes(f.name)) {
        result.factions.push(f.id);
        if (result.factions.length >= 5) break;
      }
    }
    // 地点：上限5个（按名称检索）
    for (const l of dir.locations) {
      if (l.name && l.name.length >= 2 && chapterText.includes(l.name)) {
        result.locations.push(l.name);
        if (result.locations.length >= 5) break;
      }
    }
    // 功法：上限5个
    for (const s of dir.skills) {
      if (s.name && s.name.length >= 2 && chapterText.includes(s.name)) {
        result.skills.push(s.id);
        if (result.skills.length >= 5) break;
      }
    }
    // 法宝：上限5个
    for (const i of dir.items) {
      if (i.name && i.name.length >= 2 && chapterText.includes(i.name)) {
        result.items.push(i.id);
        if (result.items.length >= 5) break;
      }
    }
  } catch {
    // 自动关联失败不阻断生成，返回空结果
  }

  return result;
}

/**
 * 获取多个人物的关系
 */
async function getRelationsForCharacters(characterIds: number[]): Promise<RelationContext[]> {
  if (!characterIds.length) return [];

  const allRelations = await Promise.all(
    characterIds.map((id) => retriever.getCharacterRelations(id))
  );

  // 去重并转换格式
  const seen = new Set<string>();
  const relations: RelationContext[] = [];

  for (const rels of allRelations) {
    for (const r of rels) {
      const key = `${r.charAId}-${r.charBId}-${r.relType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relations.push({
        charAId: r.charAId!,
        charBId: r.charBId!,
        relType: r.relType || '',
        interactCount: r.interactCount || undefined,
      });
    }
  }

  return relations;
}

/**
 * 估算文本token数（中文按1.5字/token）
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 按优先级裁剪上下文到token预算内
 * 必须保留：章节意图 + 核心人物 + 作者规则
 * 可压缩：次要人物、场景描述
 * 可丢弃：扩展背景
 */
export function trimToTokenBudget(context: ContextPackage, maxTokens: number): ContextPackage {
  // 先估算当前总token数
  const fullText = serializeContext(context);
  const currentTokens = estimateTokens(fullText);

  // 如果未超预算，直接返回
  if (currentTokens <= maxTokens) {
    return context;
  }

  // 第一步：丢弃扩展背景（scenes）
  let trimmed = { ...context, scenes: [] as SceneContext[] };
  if (estimateTokens(serializeContext(trimmed)) <= maxTokens) {
    return trimmed;
  }

  // 第二步：压缩次要人物（只保留前3个核心人物的详细信息）
  const coreCharacters = trimmed.characters.slice(0, 3);
  const minorCharacters = trimmed.characters.slice(3).map((c) => ({
    ...c,
    growthLine: undefined,
    writingProfile: undefined,
    coreSkills: undefined,
    mentalModels: undefined,
    heuristics: undefined,
    lifeStages: undefined,
  }));
  trimmed = { ...trimmed, characters: [...coreCharacters, ...minorCharacters] };
  if (estimateTokens(serializeContext(trimmed)) <= maxTokens) {
    return trimmed;
  }

  // 第三步：压缩前文摘要（只保留最近1章）
  trimmed = { ...trimmed, prevSummaries: trimmed.prevSummaries.slice(0, 1) };
  if (estimateTokens(serializeContext(trimmed)) <= maxTokens) {
    return trimmed;
  }

  // 第四步：压缩地点和门派描述
  trimmed = {
    ...trimmed,
    locations: trimmed.locations.map((l) => ({ ...l, environment: undefined, keyEvents: undefined })),
    factions: trimmed.factions.map((f) => ({ ...f, cultivationFeature: undefined })),
  };

  return trimmed;
}

/**
 * 将上下文序列化为文本（用于token估算）
 */
function serializeContext(context: ContextPackage): string {
  const parts: string[] = [];

  parts.push(`章节意图: ${context.chapterPlan.intent}`);
  parts.push(`规则: ${context.rules.join('\n')}`);

  if (context.style) {
    const s = context.style;
    if (s.forbiddenWords?.length) parts.push(`禁用词: ${s.forbiddenWords.join('、')}`);
    if (s.coreImagery?.length) parts.push(`意象: ${s.coreImagery.join('、')}`);
    if (s.descriptionRatio) parts.push(`描写比例: ${JSON.stringify(s.descriptionRatio)}`);
    if (s.sentenceRules) parts.push(`句式: ${JSON.stringify(s.sentenceRules)}`);
    if (s.perspectiveRules?.length) parts.push(`视角: ${s.perspectiveRules.join('；')}`);
    if (s.antiPatterns?.length) parts.push(`反模式: ${s.antiPatterns.join('；')}`);
    if (s.mentalModels?.length) parts.push(`心智模型: ${s.mentalModels.join('；')}`);
    if (s.matchedSceneFlavor?.length) parts.push(`本章风味: ${s.matchedSceneFlavor.join('；')}`);
  }

  for (const c of context.characters) {
    parts.push(`人物[${c.name}]: ${c.personality || ''} ${c.faction || ''} ${c.realm || ''} ${(c.coreSkills || []).join(',')}`);
    if (c.mentalModels?.length) parts.push(`心智[${c.name}]: ${c.mentalModels.join('；')}`);
    if (c.heuristics?.length) parts.push(`处事[${c.name}]: ${c.heuristics.join('；')}`);
    if (c.lifeStages?.length) parts.push(`阶段[${c.name}]: ${c.lifeStages.join('；')}`);
  }
  for (const f of context.factions) {
    parts.push(`门派[${f.name}]: ${f.camp || ''} ${f.headquarters || ''} ${f.cultivationFeature || ''}`);
  }
  for (const l of context.locations) {
    parts.push(`地点[${l.name}]: ${l.environment || ''} ${l.relatedFaction || ''}`);
  }
  for (const s of context.skills) {
    parts.push(`功法[${s.name}]: ${s.grade || ''} ${s.coreEffect || ''}`);
    if (s.attributes?.length) parts.push(`功法属性[${s.name}]: ${s.attributes.join('；')}`);
    if (s.moves?.length) parts.push(`招式[${s.name}]: ${s.moves.join('；')}`);
    if (s.relations?.length) parts.push(`功法关系[${s.name}]: ${s.relations.join('；')}`);
  }
  for (const i of context.items) {
    parts.push(`法宝[${i.name}]: ${i.grade || ''} ${i.coreAbilities || ''}`);
  }
  for (const r of context.relations) {
    const src = r.source === 'custom' ? '(自定义)' : '';
    parts.push(`关系${src}: ${r.charAId}-${r.charBId}: ${r.relType}${r.description ? ' ' + r.description : ''}${r.interactPattern ? ' 互动=' + r.interactPattern : ''}`);
  }
  parts.push(...context.prevSummaries);
  for (const s of context.scenes) {
    parts.push(`场景: ${s.coreEvent || ''} ${s.emotionMainType || ''} ${s.conflictLevel || ''}`);
  }
  if (context.stateSnapshots?.length) {
    for (const st of context.stateSnapshots) {
      parts.push(
        `状态[${st.characterName || st.characterId}]@第${st.asOfChapter}章: 位置=${st.location || ''} 境界=${st.realm || ''} 伤势=${st.injury || ''} 心态=${st.mentalState || ''} 持有=${(st.possessedItems || []).join(',')}`
      );
    }
  }
  if (context.timelineMilestones?.length) {
    for (const t of context.timelineMilestones) {
      parts.push(`时间线[第${t.chapterNo}章 ${t.storyTime || ''}]: ${t.title} ${t.description || ''}`);
    }
  }
  if (context.foreshadows?.length) {
    for (const f of context.foreshadows) {
      const state = f.status === 'pending' ? '待埋入' : '已埋设';
      let line = `伏笔[${state} ${f.title}]: ${f.description || ''} 线索=${f.hintClue || ''}`;
      if (f.dnaSubject || f.dnaAction || f.dnaObject) {
        line += ` DNA=[${f.dnaSubject || '?'}-${f.dnaAction || '?'}-${f.dnaObject || '?'}]`;
        if (f.dnaEmotion) line += ` 情绪=${f.dnaEmotion}`;
      }
      if (f.tier && f.tier !== 't3') line += ` 分级=${f.tier}`;
      parts.push(line);
    }
  }
  if (context.growthStages?.length) {
    for (const g of context.growthStages) {
      parts.push(`成长阶段[${g.characterName || g.characterId} 第${g.stageNo}阶段「${g.name}」]: 特质=${g.traits.join('、')} ${g.description || ''}`);
    }
  }
  if (context.customEntities?.length) {
    for (const e of context.customEntities) {
      // 新道则功法体系：无品级，按指引深度+道则渲染
      if (e.entityType === 'technique') {
        parts.push(`自定义功法[${e.name}] 指引=${e.guidanceDepth || '—'} 道则=${e.daoComposition || '—'}: ${e.coreEffect || ''}`);
        if (e.realmAbilities) parts.push(`神通[${e.name}]: ${e.realmAbilities}`);
        if (e.effects?.length) {
          const traitStr = e.effects.map((ef) => ef.name).join('、');
          parts.push(`本源特质[${e.name}]: ${traitStr}`);
        }
        if (e.backlashSummary) parts.push(`反噬[${e.name}]: ${e.backlashSummary}`);
        if (e.description) parts.push(`功法详解[${e.name}]: ${e.description}`);
        if (e.moves?.length) {
          const moveStr = e.moves.map((m, i) => `${i + 1}.「${m.name}」${m.desc}`).join('；');
          parts.push(`招式[${e.name}]: ${moveStr}`);
        }
        continue;
      }
      const typeLabel = e.entityType === 'skill' ? '自定义功法' : e.entityType === 'weapon' ? '自定义武器' : '自定义法宝';
      const gradeStr = e.grade ? `${e.grade}第${e.gradeLevel ?? 1}层${e.isEvolved ? '(进化)' : ''}` : '';
      parts.push(`${typeLabel}[${e.name}] ${gradeStr}: ${e.coreEffect || ''}`);
      if (e.effects?.length) {
        const effStr = e.effects.map((ef) => `${ef.name}(${ef.rarity === 'legendary' ? '传说' : ef.rarity === 'rare' ? '稀有' : '普通'}:${ef.description})`).join('；');
        parts.push(`特效[${e.name}]: ${effStr}`);
      }
      if (e.sideEffects) parts.push(`副作用[${e.name}]: ${e.sideEffects}`);
      if (e.fakeName) parts.push(`对外化名[${e.name}]: ${e.fakeName}`);
      if (e.intro) parts.push(`简介[${e.name}]: ${e.intro}`);
      if (e.moves?.length) {
        const moveStr = e.moves.map((m, i) => `${i + 1}.「${m.name}」${m.desc}`).join('；');
        parts.push(`招式[${e.name}]: ${moveStr}`);
      }
      // 方向组合式特质系统（7.30）
      if (e.generatedTraitSummary) parts.push(`生成特质[${e.name}]: ${e.generatedTraitSummary}`);
      if (e.jianghuNickname) parts.push(`江湖外号[${e.name}]: ${e.jianghuNickname}`);
      if (e.realSkill) parts.push(`真本事[${e.name}]: ${e.realSkill}`);
      if (e.weirdTrait) parts.push(`怪毛病[${e.name}]: ${e.weirdTrait}`);
      if (e.weaponRules) parts.push(`专属规矩[${e.name}]: ${e.weaponRules}`);
    }
  }
  if (context.branchContext) {
    const b = context.branchContext;
    parts.push(`分支走向[${b.selectedOptionTitle}]: ${b.selectedOptionDescription}`);
    parts.push(`分支下一章意图: ${b.nextChapterIntent}`);
    if (b.impactTagsHistory?.length) parts.push(`影响标签历史: ${b.impactTagsHistory.join('、')}`);
  }

  return parts.join('\n');
}

/**
 * 模块9：获取关联到出场人物的自定义功法/法宝
 * 查询 linkedCharacterIds 与本章人物ID有交集的自定义实体
 */
/**
 * 获取本项目自定义人物（负数ID分流，创作库 custom_character）
 * 映射为 CharacterContext 并标记 source:'custom'；只用五档定位名+职能描述，不映射具体境界。
 * 降级红线：查询失败返回空数组，不阻断生成主流程。
 */
async function getCustomCharactersByIds(projectId: number, negativeIds: number[]): Promise<CharacterContext[]> {
  if (!negativeIds.length) return [];
  try {
    const dbIds = negativeIds.map((id) => Math.abs(id));
    const rows = await creativeDb
      .select()
      .from(creativeSchema.customCharacter)
      .where(and(
        eq(creativeSchema.customCharacter.projectId, projectId),
        inArray(creativeSchema.customCharacter.id, dbIds),
        eq(creativeSchema.customCharacter.isDeleted, false)
      ));
    // 批量加载人物武学档案（功法×武器融合小传）：一人可有多条搭配（多对多），
    // 按 characterId 分组为数组（原 Map 写法每人只留一条，会截断），并附功法/武器名称供写作引用
    let loresByChar = new Map<number, any[]>();
    let techNameById = new Map<number, string>();
    let wpnNameById = new Map<number, string>();
    try {
      const loreRows = await creativeDb
        .select()
        .from(creativeSchema.characterMartialLore)
        .where(and(
          eq(creativeSchema.characterMartialLore.projectId, projectId),
          inArray(creativeSchema.characterMartialLore.characterId, dbIds),
          eq(creativeSchema.characterMartialLore.isDeleted, false)
        ));
      for (const l of loreRows) {
        const cid = Number(l.characterId);
        if (!loresByChar.has(cid)) loresByChar.set(cid, []);
        loresByChar.get(cid)!.push(l);
      }
      const techIds = Array.from(new Set(loreRows.map((l) => Number(l.techniqueId)).filter((id) => id > 0)));
      const wpnIds = Array.from(new Set(loreRows.map((l) => Number(l.weaponId)).filter((id) => id > 0)));
      if (techIds.length) {
        const techRows = await creativeDb
          .select({ id: creativeSchema.customTechnique.id, name: creativeSchema.customTechnique.name })
          .from(creativeSchema.customTechnique)
          .where(inArray(creativeSchema.customTechnique.id, techIds));
        techNameById = new Map(techRows.map((t) => [Number(t.id), t.name]));
      }
      if (wpnIds.length) {
        const wpnRows = await creativeDb
          .select({ id: creativeSchema.customWeapon.id, name: creativeSchema.customWeapon.name })
          .from(creativeSchema.customWeapon)
          .where(inArray(creativeSchema.customWeapon.id, wpnIds));
        wpnNameById = new Map(wpnRows.map((w) => [Number(w.id), w.name]));
      }
    } catch { /* 武学档案加载失败不阻断 */ }
    return rows.map((row) => {
      const category = findRaceCategory(row.raceCategory);
      const sub = findRaceSub(row.raceCategory, row.raceSub);
      const pos = findPosition(row.position);
      const fakePos = row.fakePosition ? findPosition(row.fakePosition) : null;
      const talents = ((row.talents as string[]) ?? []).map((t) => {
        const found = findTalentByName(t);
        return found ? `${t}：${found.entry.desc}` : `${t}（小缺陷）`;
      });
      const charLores = loresByChar.get(Number(row.id)) ?? [];
      return {
        id: -row.id,
        name: row.name,
        gender: (row.gender === 'female' ? 'female' : 'male') as 'male' | 'female',
        source: 'custom' as const,
        faction: category && sub ? `${category.name}·${sub.name}` : undefined,
        personality: `内在${row.innerPersonality}`,
        position: pos ? `${pos.name}（${pos.desc}）` : row.position,
        fakePosition: fakePos ? `${fakePos.name}（${fakePos.desc}）` : undefined,
        stance: `${stanceLabel(row.stance)}（${row.stance}/100，0=浩然正气 100=邪异诡道）`,
        outerPersonality: (row.outerPersonality as string[]) ?? [],
        talents,
        strengths: (row.strengths as string[]) ?? [],
        weaknesses: (row.weaknesses as string[]) ?? [],
        bio: row.description ?? undefined,
        martialLores: charLores.length ? charLores.map((l) => ({
          techniqueName: l.techniqueId != null ? techNameById.get(Number(l.techniqueId)) : undefined,
          weaponName: l.weaponId != null ? wpnNameById.get(Number(l.weaponId)) : undefined,
          biography: l.biography ?? undefined,
          fusedMoves: ((l.fusedMoves as any[]) ?? []),
        })) : undefined,
      };
    });
  } catch (e: any) {
    console.warn(`[自定义人物] 上下文加载失败（降级为空）: ${e?.message || e}`);
    return [];
  }
}

/**
 * 自定义地点上下文（10-山河舆图）：按章节文本（标题/意图/场景分解）子串匹配
 * custom_location 名称，注入环境描述供 Writer 保持场景一致性。
 * 降级红线：查询失败返回空数组，不阻断生成主流程。
 */
async function getCustomLocationsForChapter(projectId: number, chapterText: string): Promise<LocationContext[]> {
  if (!chapterText) return [];
  try {
    const rows = await creativeDb
      .select()
      .from(creativeSchema.customLocation)
      .where(and(
        eq(creativeSchema.customLocation.projectId, projectId),
        eq(creativeSchema.customLocation.isDeleted, false)
      ));
    const hits = rows.filter((r) => r.name && r.name.length >= 2 && chapterText.includes(r.name));
    // 长名优先避免子串误配，最多注入5条防上下文过载
    hits.sort((a, b) => b.name.length - a.name.length);
    return hits.slice(0, 5).map((r) => ({
      id: -r.id,
      name: r.name,
      environment: r.description ?? undefined,
      relatedFaction: r.affiliatedFaction ?? undefined,
    }));
  } catch {
    return [];
  }
}

async function getCustomEntitiesForCharacters(projectId: number, characterIds: number[]): Promise<CustomEntityContext[]> {
  if (!characterIds.length) return [];

  const results: CustomEntityContext[] = [];

  try {
    // 查询自定义法宝
    const customItems = await creativeDb
      .select()
      .from(creativeSchema.customMagicItemLib)
      .where(and(
        eq(creativeSchema.customMagicItemLib.projectId, projectId),
        eq(creativeSchema.customMagicItemLib.isDeleted, false),
      ));

    for (const row of customItems) {
      const linked = (row.linkedCharacterIds || []) as number[];
      if (linked.some((id) => characterIds.includes(id))) {
        results.push({
          id: row.id,
          entityType: 'magic_item',
          name: row.name,
          grade: row.grade,
          gradeLevel: row.gradeLevel,
          coreEffect: row.coreAbilities || undefined,
          effects: (row.effects || []) as CustomEntityContext['effects'],
          sideEffects: row.sideEffects || undefined,
          growthType: row.growthType,
          evolutionStage: row.evolutionStage || undefined,
          isEvolved: row.isEvolved,
          breakthroughNarrative: row.breakthroughNarrative || undefined,
          linkedCharacterIds: linked,
        });
      }
    }

    // 查询自定义武器（特质ID解析为特效条目，type=首要冲突标签供确定性扫描）
    const customWeapons = await creativeDb
      .select()
      .from(creativeSchema.customWeapon)
      .where(and(
        eq(creativeSchema.customWeapon.projectId, projectId),
        eq(creativeSchema.customWeapon.isDeleted, false),
      ));

    const rarityStrength: Record<string, number> = { normal: 1, rare: 2, legendary: 3 };
    for (const row of customWeapons) {
      const linked = (row.linkedCharacterIds || []) as number[];
      if (!linked.some((id) => characterIds.includes(id))) continue;

      // 旧四列特质（经典传承）
      const traitIds = [
        ...((row.forgeTraits || []) as string[]),
        ...((row.soakTraits || []) as string[]),
        ...((row.attachTraits || []) as string[]),
        ...((row.cavityTraits || []) as string[]),
      ];
      const effects = traitIds
        .map((tid) => getTrait(tid))
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map((t) => ({
          name: t.name,
          type: t.conflictTags[0] || '',
          rarity: t.rarity,
          description: t.desc,
          strength: rarityStrength[t.rarity] ?? 1,
        }));

      // 方向组合式生成特质（新系统，优先级高于旧四列）
      const genTraits = (row.generatedTraits || []) as any[];
      const flaws: string[] = [];
      if (genTraits.length) {
        for (const gt of genTraits) {
          if (!gt.name) continue;
          effects.push({
            name: gt.name,
            type: gt.type || '',
            rarity: gt.isRare ? 'rare' : 'normal',
            description: gt.desc || '',
            strength: gt.isRare ? 2 : 1,
          });
          if (gt.flaw) flaws.push(gt.flaw);
        }
      }

      const formHit = getForm(row.type);
      const matHit = getMaterial(row.baseMaterial);
      const dirs = ((row.coreDirection || []) as string[]).join('、');
      const coreEffect = [
        formHit ? `形制[${formHit.form.name}]` : '',
        matHit ? `材质[${matHit.name}]` : '',
        dirs ? `核心方向[${dirs}]` : '',
      ].filter(Boolean).join(' ');

      // 生成式特质摘要（含稀有/瑕疵标记）
      const generatedTraitSummary = genTraits.length
        ? genTraits.map((gt) => {
            let s = gt.name;
            if (gt.isRare) s += '(✨稀有)';
            if (gt.flaw) s += `(⚠️${gt.flaw})`;
            return s;
          }).join('；')
        : undefined;

      results.push({
        id: row.id,
        entityType: 'weapon',
        name: row.name,
        grade: row.grade,
        gradeLevel: row.gradeLevel,
        coreEffect: coreEffect || undefined,
        effects,
        sideEffects: undefined,
        growthType: row.growthType,
        evolutionStage: row.evolutionStage || undefined,
        isEvolved: row.isEvolved,
        breakthroughNarrative: row.breakthroughNarrative || undefined,
        linkedCharacterIds: linked,
        generatedTraitSummary,
        weaponFlaws: flaws.length ? flaws : undefined,
      });
    }

    // 附加当前生效文案（化名/简介/招式）供写作与审计引用
    const weaponEntries = results.filter((r) => r.entityType === 'weapon');
    if (weaponEntries.length) {
      const weaponIds = weaponEntries.map((r) => r.id);
      const lores = await creativeDb
        .select()
        .from(creativeSchema.weaponLore)
        .where(and(
          inArray(creativeSchema.weaponLore.weaponId, weaponIds),
          eq(creativeSchema.weaponLore.isCurrent, true),
        ));
      const loreByWeapon = new Map(lores.map((l) => [Number(l.weaponId), l]));
      for (const w of weaponEntries) {
        const l = loreByWeapon.get(w.id);
        if (l) {
          w.fakeName = l.fakeName || undefined;
          w.intro = l.intro;
          w.moves = (l.moves || []) as { name: string; desc: string }[];
          // 五感兵器卡字段（方向组合式特质系统 7.30）
          w.realSkill = (l as any).realSkill || undefined;
          w.weirdTrait = (l as any).weirdTrait || undefined;
          w.weaponRules = (l as any).rules || undefined;
          w.jianghuNickname = (l as any).jianghuNickname || undefined;
        }
      }
    }

    // 查询自定义功法（九大道则体系，无品级；特质ID解析为本源特质条目）
    const customTechniques = await creativeDb
      .select()
      .from(creativeSchema.customTechnique)
      .where(and(
        eq(creativeSchema.customTechnique.projectId, projectId),
        eq(creativeSchema.customTechnique.isDeleted, false),
      ));

    // 预取个人变种（千人千面）+ 人物名映射，供功法实体附带变种摘要
    const variantRows = await creativeDb
      .select()
      .from(creativeSchema.characterTechniqueVariant)
      .where(and(
        eq(creativeSchema.characterTechniqueVariant.projectId, projectId),
        eq(creativeSchema.characterTechniqueVariant.isDeleted, false),
      ));
    const charNameRows = characterIds.length
      ? await creativeDb
          .select({ id: creativeSchema.customCharacter.id, name: creativeSchema.customCharacter.name })
          .from(creativeSchema.customCharacter)
          .where(inArray(creativeSchema.customCharacter.id, characterIds.map((id) => Math.abs(id))))
      : [];
    const charNameMap = new Map<number, string>(charNameRows.map((r) => [Number(r.id), r.name]));
    const RARITY_CN: Record<string, string> = { common: '普通', remarkable: '显著', rare: '稀有异变' };

    const rarityStrengthT: Record<string, number> = { normal: 1, rare: 2, legendary: 3 };
    for (const row of customTechniques) {
      const linked = (row.linkedCharacterIds || []) as number[];
      if (!linked.some((id) => characterIds.includes(id))) continue;

      const mainDaoName = getDao(row.mainDao)?.name.replace('道则', '') || row.mainDao;
      const assistNames = ((row.assistDao || []) as string[]).map((d) => getDao(d)?.name.replace('道则', '') || d);
      const daoComposition = assistNames.length ? `${mainDaoName} + ${assistNames.join('、')}` : mainDaoName;

      // 本源特质 → effects（type 取首个冲突标签供确定性扫描）
      const effects = ((row.coreTraits || []) as string[])
        .map((tid) => getCoreTrait(tid))
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map((t) => ({
          name: t.name,
          type: t.conflictTags[0] || '',
          rarity: t.rarity,
          description: t.desc,
          strength: rarityStrengthT[t.rarity] ?? 1,
        }));

      // 分道境神通摘要
      const abilityIds = (row.abilities || []) as string[];
      const realmParts: string[] = [];
      for (const realm of DAO_REALMS) {
        const names = abilityIds
          .map((id) => getAbility(id))
          .filter((a): a is NonNullable<ReturnType<typeof getAbility>> => !!a && a.daoRealm === realm)
          .map((a) => a.name);
        if (names.length) realmParts.push(`${realm}境[${names.join('、')}]`);
      }
      const realmAbilities = realmParts.join('；');

      // 反噬摘要（含风险等级）
      const backlashSummary = ((row.backlash || []) as string[])
        .map((id) => getBacklash(id))
        .filter((b): b is NonNullable<typeof b> => Boolean(b))
        .map((b) => `${b.name}(${b.risk})`)
        .join('、');

      const styleName = row.styleType;
      const dirs = ((row.coreDirection || []) as string[]).join('、');
      const coreEffect = [
        `体例[${styleName}]`,
        `行功[${row.practicePath}]`,
        dirs ? `核心方向[${dirs}]` : '',
      ].filter(Boolean).join(' ');

      // 个人变种摘要（千人千面）：仅取当前出场人物且绑定本功法的变种
      // linkedCharacterIds 为负数对外ID，variant.characterId 为正数数据库ID，取负匹配
      const relVariants = variantRows.filter(
        (v) => Number(v.baseTechniqueId) === Number(row.id) && linked.includes(-Number(v.characterId))
      );
      const variantSummary = relVariants.length
        ? relVariants
            .map((v) => {
              const cname = charNameMap.get(Number(v.characterId)) || `人物${v.characterId}`;
              const eff = (v.cultivationEffect || {}) as any;
              const base = `${cname}→《${v.variantName}》(${RARITY_CN[v.rarity] || v.rarity}变种${v.version > 1 ? `·v${v.version}` : ''}) 修炼${eff.speed || '持平'}/${eff.risk || '—'}；专属技巧[${((v.exclusiveSkill || []) as string[]).join('、') || '无'}]`;
              // 追加个人化变种详解摘要（千人千面血肉层），供写手发挥
              const descExcerpt = v.description ? `；详解：${String(v.description).slice(0, 120)}…` : '';
              return base + descExcerpt;
            })
            .join('；')
        : undefined;

      results.push({
        id: row.id,
        entityType: 'technique',
        name: row.name,
        coreEffect,
        effects,
        growthType: row.growthType,
        linkedCharacterIds: linked,
        daoComposition,
        guidanceDepth: getGuidance(row.guidanceDepth)?.name || row.guidanceDepth,
        realmAbilities: realmAbilities || undefined,
        backlashSummary: backlashSummary || undefined,
        description: row.description || undefined,
        moves: ((row.moves || []) as any[]).length ? (row.moves as any) : undefined,
        daoIds: [row.mainDao, ...((row.assistDao || []) as string[])],
        isClash: hasClash(row.mainDao as any, (row.assistDao || []) as any) || Boolean(row.inherentConflict),
        guidanceDepthId: row.guidanceDepth,
        variantSummary,
      });
    }
  } catch {
    // 自定义实体查询失败不阻断主流程
  }

  return results;
}

/**
 * 模块9二期：特效共鸣检测（纯规则，零LLM）
 * 当同一人物拥有2个以上自定义实体且共享相同特效类型时，触发共鸣加成
 */
const RESONANCE_TEMPLATES: Record<string, string> = {
  element: '元素共鸣：{entities}中的元素之力相互激荡，形成元素风暴领域，攻击附带范围性元素灼烧，威力提升三成',
  spacetime: '时空共鸣：{entities}的时空之力彼此呼应，撕裂空间壁障，短距瞬移冷却大幅缩短，时空裂隙持续时间翻倍',
  soul: '神魂共鸣：{entities}的神魂之力交织成网，神识感知范围扩展数倍，精神攻击附带连锁震荡效果',
  body: '体魄共鸣：{entities}的体魄强化叠加共振，肉身防御形成层叠护甲，受伤时自动激发再生之力',
  curse: '诅咒共鸣：{entities}的诅咒之力互相催化，诅咒效果叠加蔓延，被命中者持续受到侵蚀且难以净化',
  domain: '领域共鸣：{entities}的领域之力融合共振，展开复合领域，领域内己方全属性增幅、敌方全属性压制',
};

function detectResonanceEffects(
  customEntities: CustomEntityContext[],
  characters: { id: number; name: string }[]
): { characterName: string; entities: string[]; resonanceType: string; description: string }[] | undefined {
  if (customEntities.length < 2 || characters.length === 0) return undefined;

  const charNameMap = new Map<number, string>(characters.map((c) => [c.id, c.name]));
  const results: { characterName: string; entities: string[]; resonanceType: string; description: string }[] = [];

  // 按人物分组：每个人物关联了哪些实体
  for (const char of characters) {
    const charEntities = customEntities.filter(
      (e) => e.linkedCharacterIds?.includes(char.id)
    );
    if (charEntities.length < 2) continue;

    // 统计各特效类型出现次数
    const typeCount = new Map<string, string[]>(); // type → entity names
    for (const ent of charEntities) {
      for (const eff of ent.effects) {
        if (!typeCount.has(eff.type)) typeCount.set(eff.type, []);
        const names = typeCount.get(eff.type)!;
        if (!names.includes(ent.name)) names.push(ent.name);
      }
    }

    // 找出被2个以上实体共享的特效类型
    for (const [type, entityNames] of typeCount) {
      if (entityNames.length >= 2) {
        const template = RESONANCE_TEMPLATES[type];
        if (template) {
          results.push({
            characterName: char.name,
            entities: entityNames,
            resonanceType: type,
            description: template.replace('{entities}', entityNames.join('、')),
          });
        }
      }
    }
  }

  return results.length ? results : undefined;
}

// ============================================================
// 硬性事实约束构建（P0：从现有数据提取不可违反事实）
// ============================================================

/** 15-SRS P0-4：跨章叙事事实回流行（曾在某章被提取确认出场的自定义人物） */
export interface NarrativeFactRow {
  name: string;
  gender: string | null;
  description: string | null;
  entityStatus: string | null;
  chapterUpdates: unknown;
}

/** 回流注入上限（防 token 膨胀，15-SRS P0-4） */
const NARRATIVE_FACT_LIMIT = 15;

/**
 * 15-SRS P0-4：查本项目 chapterUpdates 非空（=曾被提取确认出场）的自定义人物。
 * 这类人物当章未被提及（autoLink 不会命中），但其已确认事实对后续章节一致性仍重要。
 * 降级红线：查询失败返回空数组，不阻断生成主流程。
 */
export async function getNarrativeFactsForChapter(projectId: number): Promise<NarrativeFactRow[]> {
  try {
    const rows = await creativeDb
      .select({
        name: creativeSchema.customCharacter.name,
        gender: creativeSchema.customCharacter.gender,
        description: creativeSchema.customCharacter.description,
        entityStatus: creativeSchema.customCharacter.entityStatus,
        chapterUpdates: creativeSchema.customCharacter.chapterUpdates,
      })
      .from(creativeSchema.customCharacter)
      .where(and(
        eq(creativeSchema.customCharacter.projectId, projectId),
        eq(creativeSchema.customCharacter.isDeleted, false),
        sql`jsonb_array_length(${creativeSchema.customCharacter.chapterUpdates}) > 0`,
      ))
      .orderBy(desc(creativeSchema.customCharacter.updatedAt))
      .limit(NARRATIVE_FACT_LIMIT);
    return rows.map((r) => ({
      name: r.name,
      gender: r.gender,
      description: r.description,
      entityStatus: r.entityStatus,
      chapterUpdates: r.chapterUpdates,
    }));
  } catch (e: any) {
    console.warn(`[叙事事实回流] 查询失败（降级跳过）: ${e?.message || e}`);
    return [];
  }
}

/**
 * 从已加载的人物/状态快照/时间线中提取硬性事实约束。
 * 不新建表——全部复用 buildContextForChapter 已加载的数据。
 * 15-SRS P0-4：narrativeRows 注入跨章连续性事实（排除已 autoLink 命中的人物）。
 * 降级红线：任何异常返回 undefined（不注入），绝不阻断生成主流程。
 */
export function buildHardFacts(
  characters: CharacterContext[],
  stateSnapshots: CharacterStateContext[] | undefined,
  timelineMilestones: TimelineMilestoneContext[] | undefined,
  narrativeRows?: NarrativeFactRow[],
): HardFactsContext | undefined {
  try {
    // ── 人物事实 ──
    const characterFacts: HardFactsContext['characterFacts'] = [];
    for (const char of characters) {
      const fact: HardFactsContext['characterFacts'][number] = { name: char.name };

      // 性别/代词（自定义人物有显式 gender 字段）
      if (char.gender) {
        fact.gender = char.gender;
        fact.pronoun = char.gender === 'female' ? '她' : '他';
      }

      // 境界：优先取状态快照最新确认值，退回人物设定里的 realm
      const snapshot = stateSnapshots?.find(
        (s) => s.characterName === char.name || (s.characterId != null && s.characterId === char.id)
      );
      if (snapshot?.realm) {
        fact.realm = snapshot.realm;
      } else if (char.realm) {
        fact.realm = char.realm;
      }

      // 关键背景事实（从 personality 提取不可变描述，限 2 条避免 token 膨胀）
      const keyFacts: string[] = [];
      if (char.personality) {
        // 取 personality 的前 80 字作为关键背景（通常包含核心设定）
        const brief = char.personality.slice(0, 80).trim();
        if (brief) keyFacts.push(brief);
      }
      if (keyFacts.length) fact.keyFacts = keyFacts;

      // 至少有一项有效信息才加入
      if (fact.gender || fact.realm || fact.keyFacts?.length) {
        characterFacts.push(fact);
      }
    }

    // ── 15-SRS P0-4：跨章叙事事实回流（未出现在当章但有历史记录的人物） ──
    if (narrativeRows?.length) {
      // 排除已被 autoLink 加载/已注入事实的人物（以已加载人物名单为准）
      const existingNames = new Set([...characters.map((c) => c.name), ...characterFacts.map((f) => f.name)]);
      let injected = 0;
      for (const row of narrativeRows) {
        if (injected >= NARRATIVE_FACT_LIMIT) break;
        if (!row.name || existingNames.has(row.name)) continue; // 排除已 autoLink 注入的
        const fact: HardFactsContext['characterFacts'][number] = { name: row.name };
        if (row.gender === 'male' || row.gender === 'female') {
          fact.gender = row.gender;
          fact.pronoun = row.gender === 'female' ? '她' : '他';
        }
        const keyFacts: string[] = [];
        const desc = (row.description || '').slice(0, 50).trim();
        if (desc) keyFacts.push(`描写：${desc}`);
        const updates = Array.isArray(row.chapterUpdates) ? (row.chapterUpdates as Array<{ chapterNo?: number; updateText?: string }>) : [];
        const latest = updates.length ? updates[updates.length - 1] : undefined;
        if (latest?.updateText) {
          keyFacts.push(`第${latest.chapterNo ?? '?'}章确认动态：${String(latest.updateText).slice(0, 60)}`);
        }
        if (keyFacts.length) fact.keyFacts = keyFacts;
        // 只约束强事实（姓名/性别/最近一条动态）；draft 标注待确认
        if (fact.gender || fact.keyFacts?.length) {
          if (row.entityStatus === 'draft') fact.pending = true;
          characterFacts.push(fact);
          existingNames.add(row.name);
          injected++;
        }
      }
    }

    // ── 时间锚点（取 importance='key' 或前 3 章的已确认里程碑） ──
    const timeAnchors: HardFactsContext['timeAnchors'] = [];
    if (timelineMilestones?.length) {
      for (const ms of timelineMilestones) {
        if (ms.importance === 'key' || ms.chapterNo <= 3) {
          timeAnchors.push({
            chapterNo: ms.chapterNo,
            storyTime: ms.storyTime,
            title: ms.title,
          });
        }
      }
      // 限制最多 5 条锚点
      if (timeAnchors.length > 5) timeAnchors.length = 5;
    }

    // 如果没有任何有效事实，不注入
    if (!characterFacts.length && !timeAnchors.length) return undefined;

    // ── 序列化为 Writer prompt 文本 ──
    const lines: string[] = [];
    if (characterFacts.length) {
      lines.push('■ 人物事实：');
      for (const f of characterFacts) {
        const parts: string[] = [];
        if (f.gender) parts.push(`${f.gender === 'female' ? '女' : '男'}，全文用"${f.pronoun}"${f.pending ? '（待确认）' : ''}`);
        if (f.realm) parts.push(`境界：${f.realm}`);
        if (f.keyFacts?.length) parts.push(...f.keyFacts);
        lines.push(`  · ${f.name}：${parts.join('。')}`);
      }
    }
    if (timeAnchors.length) {
      lines.push('■ 时间锚点（不可出现矛盾的时间表述）：');
      for (const a of timeAnchors) {
        const time = a.storyTime ? `（${a.storyTime}）` : '';
        lines.push(`  · 第${a.chapterNo}章${time}：${a.title}`);
      }
    }

    return {
      characterFacts,
      timeAnchors,
      serialized: lines.join('\n'),
    };
  } catch (e: any) {
    console.warn(`[硬约束] 构建失败（降级跳过）: ${e?.message || e}`);
    return undefined;
  }
}

// ============================================================
// v1.4 PRD-A：角色声音配置 + 已知信息清单（取数与块组装）
// 体量控制：每人声音摘要≤5行、知识条目≤8条，防止 12000 token 预算挤兑
// ============================================================

/** 取本章出场人物的声音配置（仅 enabled，负数ID约定直接存于 character_id） */
export async function getCharacterVoiceConfigs(projectId: number, characterIds: number[]) {
  if (!characterIds.length) return [];
  return creativeDb
    .select()
    .from(creativeSchema.characterVoiceConfig)
    .where(and(
      eq(creativeSchema.characterVoiceConfig.projectId, projectId),
      eq(creativeSchema.characterVoiceConfig.enabled, true),
      inArray(creativeSchema.characterVoiceConfig.characterId, characterIds),
    ));
}

/** 组装声音上下文块（每人≤1行摘要+1条示例台词，无配置返回 null） */
export function buildVoiceContextBlock(
  voices: Awaited<ReturnType<typeof getCharacterVoiceConfigs>>,
  nameById: Map<number, string>
): string | null {
  if (!voices.length) return null;
  const lines: string[] = [];
  for (const v of voices) {
    const name = nameById.get(v.characterId) || `人物#${v.characterId}`;
    const parts: string[] = [];
    if (v.speechStyle) parts.push(v.speechStyle);
    if (v.toneBase) parts.push(`语气基调：${v.toneBase}`);
    if (v.catchphrases) parts.push(`口头禅：${v.catchphrases}`);
    if (v.addressHabit) parts.push(`称呼习惯：${v.addressHabit}`);
    if (!parts.length) continue;
    let line = `◆ ${name}：${parts.join('；')}`;
    const quotes = Array.isArray(v.exampleQuotes) ? (v.exampleQuotes as string[]) : [];
    if (quotes.length) line += `（示例台词：「${quotes[0]}」）`;
    const forbidden = Array.isArray(v.forbiddenExpressions) ? (v.forbiddenExpressions as string[]) : [];
    if (forbidden.length) line += `；绝不说：${forbidden.slice(0, 3).join('、')}`;
    lines.push(line);
  }
  return lines.length ? lines.join('\n') : null;
}

/** 取本章出场人物的已知信息（仅 enabled，且获知章节≤当前章；每人最多8条，core优先） */
export async function getCharacterKnowledgeEntries(projectId: number, characterIds: number[], chapterNo: number) {
  if (!characterIds.length) return [];
  const rows = await creativeDb
    .select()
    .from(creativeSchema.characterKnowledge)
    .where(and(
      eq(creativeSchema.characterKnowledge.projectId, projectId),
      eq(creativeSchema.characterKnowledge.enabled, true),
      inArray(creativeSchema.characterKnowledge.characterId, characterIds),
      or(
        isNull(creativeSchema.characterKnowledge.acquiredChapter),
        // 获知章节≤当前章才注入（信息差的时间边界）
        sql`${creativeSchema.characterKnowledge.acquiredChapter} <= ${chapterNo}`,
      ),
    ));
  // 每人限 8 条，core 优先
  const byChar = new Map<number, typeof rows>();
  for (const r of rows) {
    const arr = byChar.get(r.characterId) || [];
    arr.push(r);
    byChar.set(r.characterId, arr);
  }
  const levelRank: Record<string, number> = { core: 0, secret: 1, common: 2 };
  const result: typeof rows = [];
  for (const arr of byChar.values()) {
    arr.sort((a, b) => (levelRank[a.infoLevel] ?? 3) - (levelRank[b.infoLevel] ?? 3));
    result.push(...arr.slice(0, 8));
  }
  return result;
}

/** 组装已知信息上下文块（按人物分组，无数据返回 null） */
export function buildKnowledgeContextBlock(
  entries: Awaited<ReturnType<typeof getCharacterKnowledgeEntries>>,
  nameById: Map<number, string>
): string | null {
  if (!entries.length) return null;
  const byChar = new Map<number, typeof entries>();
  for (const e of entries) {
    const arr = byChar.get(e.characterId) || [];
    arr.push(e);
    byChar.set(e.characterId, arr);
  }
  const levelLabel: Record<string, string> = { core: '核心', secret: '隐秘', common: '普通' };
  const lines: string[] = [];
  for (const [charId, arr] of byChar) {
    const name = nameById.get(charId) || `人物#${charId}`;
    lines.push(`◆ ${name} 知道：`);
    for (const e of arr) {
      const tag = levelLabel[e.infoLevel] || '普通';
      lines.push(`  - [${tag}] ${e.knowledgeContent}`);
    }
  }
  lines.push('注意：以上清单之外的具体事实，对应人物一概不知；未列出的人物不做知识限制。');
  return lines.join('\n');
}

/** 取本章出场人物的记忆卡（仅 enabled；每人最多3条，high优先、新章优先） */
export async function getCharacterMemoryCards(projectId: number, characterIds: number[]) {
  if (!characterIds.length) return [];
  const rows = await creativeDb
    .select()
    .from(creativeSchema.characterMemoryCard)
    .where(and(
      eq(creativeSchema.characterMemoryCard.projectId, projectId),
      eq(creativeSchema.characterMemoryCard.enabled, true),
      inArray(creativeSchema.characterMemoryCard.characterId, characterIds)
    ));

  const byChar = new Map<number, typeof rows>();
  for (const r of rows) {
    const arr = byChar.get(r.characterId) || [];
    arr.push(r);
    byChar.set(r.characterId, arr);
  }
  const result: typeof rows = [];
  for (const arr of byChar.values()) {
    arr.sort((a, b) => {
      const imp = (x: typeof a) => (x.importance === 'high' ? 0 : x.importance === 'low' ? 2 : 1);
      return imp(a) - imp(b) || (b.chapterNo ?? 0) - (a.chapterNo ?? 0);
    });
    result.push(...arr.slice(0, 3));
  }
  return result;
}

/** 组装记忆卡上下文块（按人物分组，无数据返回 null） */
export function buildMemoryContextBlock(
  cards: Awaited<ReturnType<typeof getCharacterMemoryCards>>,
  nameById: Map<number, string>
): string | null {
  if (!cards.length) return null;
  const byChar = new Map<number, typeof cards>();
  for (const c of cards) {
    const arr = byChar.get(c.characterId) || [];
    arr.push(c);
    byChar.set(c.characterId, arr);
  }
  const lines: string[] = ['【人物经历记忆（自动抽取，低置信，行为与情绪反应应受其影响）】'];
  for (const [charId, arr] of byChar) {
    const name = nameById.get(charId) || `人物#${charId}`;
    lines.push(`◆ ${name}：`);
    for (const c of arr) {
      let line = `  - 第${c.chapterNo ?? '?'}章：${c.eventSummary}`;
      if (c.emotionalImpact) line += `（情绪印记：${c.emotionalImpact}）`;
      lines.push(line);
    }
  }
  return lines.join('\n');
}
