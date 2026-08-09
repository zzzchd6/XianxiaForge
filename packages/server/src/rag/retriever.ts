/**
 * RAG检索服务 - 从诛仙库检索世界观上下文
 * 列名与 zhuxian-schema.ts 完全对应
 */
import { eq, and, inArray, ilike, desc, sql } from 'drizzle-orm';
import { zhuxianDb } from '../db/index.js';
import * as schema from '../db/zhuxian-schema.js';

/**
 * 按ID批量查询人物设定
 */
export async function getCharactersByIds(ids: number[]) {
  if (!ids.length) return [];
  return zhuxianDb
    .select()
    .from(schema.novelCharacterLib)
    .where(
      and(
        inArray(schema.novelCharacterLib.id, ids),
        eq(schema.novelCharacterLib.isDeleted, false)
      )
    );
}

/**
 * 按名字查询人物（模糊匹配）
 * ilike 模糊匹配会命中同名重复记录，按精确名去重（保留 id 最小的主条目）
 */
export async function getCharactersByName(names: string[]) {
  if (!names.length) return [];
  const conditions = names.map((name) =>
    ilike(schema.novelCharacterLib.name, `%${name}%`)
  );
  const rows = await zhuxianDb
    .select()
    .from(schema.novelCharacterLib)
    .where(
      and(
        sql`(${sql.join(conditions, sql` OR `)})`,
        eq(schema.novelCharacterLib.isDeleted, false)
      )
    )
    .limit(20);

  const byName = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = row.name;
    const existing = byName.get(key);
    if (!existing || row.id < existing.id) {
      byName.set(key, row);
    }
  }
  return Array.from(byName.values());
}

/**
 * 查询人物关系（lib_character_relation 无 is_deleted 列）
 */
export async function getCharacterRelations(characterId: number) {
  return zhuxianDb
    .select()
    .from(schema.libCharacterRelation)
    .where(
      sql`(${eq(schema.libCharacterRelation.charAId, characterId)} OR ${eq(schema.libCharacterRelation.charBId, characterId)})`
    );
}

/**
 * 查询人物关系并解析对方姓名（用于详情展示）
 * 返回每条关系的对方ID/姓名、关系类型、互动次数与方向（out=我→对方）
 */
export async function getCharacterRelationsResolved(characterId: number) {
  const rels = await zhuxianDb
    .select({
      relId: schema.libCharacterRelation.relId,
      charAId: schema.libCharacterRelation.charAId,
      charBId: schema.libCharacterRelation.charBId,
      relType: schema.libCharacterRelation.relType,
      interactCount: schema.libCharacterRelation.interactCount,
    })
    .from(schema.libCharacterRelation)
    .where(
      sql`(${eq(schema.libCharacterRelation.charAId, characterId)} OR ${eq(schema.libCharacterRelation.charBId, characterId)})`
    );

  const otherIds = Array.from(
    new Set(rels.map((r) => (r.charAId === characterId ? r.charBId : r.charAId)).filter(Boolean))
  ) as number[];
  const others = otherIds.length ? await getCharactersByIds(otherIds) : [];
  const nameMap = new Map(others.map((o) => [o.id, o.name]));

  return rels
    .map((r) => {
      const otherId = (r.charAId === characterId ? r.charBId : r.charAId) as number;
      return {
        relType: r.relType || '',
        interactCount: r.interactCount || 0,
        otherId,
        otherName: nameMap.get(otherId) || `人物#${otherId}`,
        direction: r.charAId === characterId ? 'out' : 'in',
      };
    })
    .sort((a, b) => (b.interactCount || 0) - (a.interactCount || 0));
}

/**
 * 按ID批量查询门派
 */
export async function getFactionsByIds(ids: number[]) {
  if (!ids.length) return [];
  return zhuxianDb
    .select()
    .from(schema.novelFactionLib)
    .where(
      and(
        inArray(schema.novelFactionLib.id, ids),
        eq(schema.novelFactionLib.isDeleted, false)
      )
    );
}

/**
 * 按名字查询地点
 * ilike 模糊匹配会命中同名重复记录，按精确名去重（保留 id 最小的主条目）
 */
export async function getLocationsByNames(names: string[]) {
  if (!names.length) return [];
  const conditions = names.map((name) =>
    ilike(schema.novelLocationLib.name, `%${name}%`)
  );
  const rows = await zhuxianDb
    .select()
    .from(schema.novelLocationLib)
    .where(
      and(
        sql`(${sql.join(conditions, sql` OR `)})`,
        eq(schema.novelLocationLib.isDeleted, false)
      )
    )
    .limit(20);

  const byName = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = row.name;
    const existing = byName.get(key);
    if (!existing || row.id < existing.id) {
      byName.set(key, row);
    }
  }
  return Array.from(byName.values());
}

/**
 * 按ID批量查询功法
 */
export async function getSkillsByIds(ids: number[]) {
  if (!ids.length) return [];
  return zhuxianDb
    .select()
    .from(schema.novelSkillLib)
    .where(
      and(
        inArray(schema.novelSkillLib.id, ids),
        eq(schema.novelSkillLib.isDeleted, false)
      )
    );
}

/**
 * 按ID批量查询法宝
 */
export async function getMagicItemsByIds(ids: number[]) {
  if (!ids.length) return [];
  return zhuxianDb
    .select()
    .from(schema.novelMagicItemLib)
    .where(
      and(
        inArray(schema.novelMagicItemLib.id, ids),
        eq(schema.novelMagicItemLib.isDeleted, false)
      )
    );
}

/**
 * 获取最近N章的章节分析
 */
export async function getRecentChapterAnalyses(bookId: number, limit: number = 3) {
  return zhuxianDb
    .select()
    .from(schema.chapterAnalysis)
    .where(
      and(
        eq(schema.chapterAnalysis.bookId, bookId),
        eq(schema.chapterAnalysis.isDeleted, false)
      )
    )
    .orderBy(desc(schema.chapterAnalysis.chapterNo))
    .limit(limit);
}

/**
 * 向量相似场景检索（pgvector cosine距离）
 */
export async function getSimilarScenes(embedding: number[], limit: number = 5) {
  const vectorStr = `[${embedding.join(',')}]`;
  return zhuxianDb
    .select({
      id: schema.sceneAnalysis.id,
      bookId: schema.sceneAnalysis.bookId,
      chapterId: schema.sceneAnalysis.chapterId,
      sceneNo: schema.sceneAnalysis.sceneNo,
      sceneSeqInChapter: schema.sceneAnalysis.sceneSeqInChapter,
      coreEvent: schema.sceneAnalysis.coreEvent,
      sceneLocation: schema.sceneAnalysis.sceneLocation,
      emotionMainType: schema.sceneAnalysis.emotionMainType,
      conflictLevel: schema.sceneAnalysis.conflictLevel,
      sceneFunction: schema.sceneAnalysis.sceneFunction,
      similarity: sql<number>`1 - (${schema.sceneAnalysis.sceneEmb} <=> ${vectorStr}::vector)`.as('similarity'),
    })
    .from(schema.sceneAnalysis)
    .where(eq(schema.sceneAnalysis.isDeleted, false))
    .orderBy(sql`${schema.sceneAnalysis.sceneEmb} <=> ${vectorStr}::vector`)
    .limit(limit);
}

/**
 * 按情节功能查询情节单元
 */
export async function getPlotUnitsByFunction(bookId: number, unitFunction: string) {
  return zhuxianDb
    .select()
    .from(schema.plotUnit)
    .where(
      and(
        eq(schema.plotUnit.bookId, bookId),
        eq(schema.plotUnit.unitFunction, unitFunction),
        eq(schema.plotUnit.isDeleted, false)
      )
    )
    .limit(10);
}

/**
 * 按ID查询妖兽
 */
export async function getMonstersByIds(ids: number[]) {
  if (!ids.length) return [];
  return zhuxianDb
    .select()
    .from(schema.novelMonsterLib)
    .where(
      and(
        inArray(schema.novelMonsterLib.id, ids),
        eq(schema.novelMonsterLib.isDeleted, false)
      )
    );
}

/**
 * 全局搜索人物（分页）
 */
export async function searchCharacters(options: {
  bookId?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) {
  const { bookId, keyword, page = 1, pageSize = 20 } = options;
  const conditions = [eq(schema.novelCharacterLib.isDeleted, false)];

  if (bookId) {
    conditions.push(eq(schema.novelCharacterLib.bookId, bookId));
  }
  if (keyword) {
    conditions.push(
      sql`(${ilike(schema.novelCharacterLib.name, `%${keyword}%`)} OR ${schema.novelCharacterLib.allTitles}::text ILIKE ${'%' + keyword + '%'})`
    );
  }

  return zhuxianDb
    .select()
    .from(schema.novelCharacterLib)
    .where(and(...conditions))
    .orderBy(schema.novelCharacterLib.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

/**
 * 全局搜索门派（分页）
 */
export async function searchFactions(options: {
  bookId?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) {
  const { bookId, keyword, page = 1, pageSize = 20 } = options;
  const conditions = [eq(schema.novelFactionLib.isDeleted, false)];

  if (bookId) {
    conditions.push(eq(schema.novelFactionLib.bookId, bookId));
  }
  if (keyword) {
    conditions.push(ilike(schema.novelFactionLib.name, `%${keyword}%`));
  }

  return zhuxianDb
    .select()
    .from(schema.novelFactionLib)
    .where(and(...conditions))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

/**
 * 全局搜索地点（分页）
 */
export async function searchLocations(options: {
  bookId?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) {
  const { bookId, keyword, page = 1, pageSize = 20 } = options;
  const conditions = [eq(schema.novelLocationLib.isDeleted, false)];

  if (bookId) {
    conditions.push(eq(schema.novelLocationLib.bookId, bookId));
  }
  if (keyword) {
    conditions.push(ilike(schema.novelLocationLib.name, `%${keyword}%`));
  }

  return zhuxianDb
    .select()
    .from(schema.novelLocationLib)
    .where(and(...conditions))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

/**
 * 全局搜索功法（分页）
 */
export async function searchSkills(options: {
  bookId?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) {
  const { bookId, keyword, page = 1, pageSize = 20 } = options;
  const conditions = [eq(schema.novelSkillLib.isDeleted, false)];

  if (bookId) {
    conditions.push(eq(schema.novelSkillLib.bookId, bookId));
  }
  if (keyword) {
    conditions.push(ilike(schema.novelSkillLib.name, `%${keyword}%`));
  }

  return zhuxianDb
    .select()
    .from(schema.novelSkillLib)
    .where(and(...conditions))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

/**
 * 全局搜索法宝（分页）
 */
export async function searchMagicItems(options: {
  bookId?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) {
  const { bookId, keyword, page = 1, pageSize = 20 } = options;
  const conditions = [eq(schema.novelMagicItemLib.isDeleted, false)];

  if (bookId) {
    conditions.push(eq(schema.novelMagicItemLib.bookId, bookId));
  }
  if (keyword) {
    conditions.push(ilike(schema.novelMagicItemLib.name, `%${keyword}%`));
  }

  return zhuxianDb
    .select()
    .from(schema.novelMagicItemLib)
    .where(and(...conditions))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

/**
 * 全局搜索妖兽（分页）
 */
export async function searchMonsters(options: {
  bookId?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) {
  const { bookId, keyword, page = 1, pageSize = 20 } = options;
  const conditions = [eq(schema.novelMonsterLib.isDeleted, false)];

  if (bookId) {
    conditions.push(eq(schema.novelMonsterLib.bookId, bookId));
  }
  if (keyword) {
    conditions.push(ilike(schema.novelMonsterLib.name, `%${keyword}%`));
  }

  return zhuxianDb
    .select()
    .from(schema.novelMonsterLib)
    .where(and(...conditions))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

/**
 * 全局搜索丹药灵材毒物（分页，可按 item_type 过滤）
 */
export async function searchMaterials(options: {
  bookId?: number;
  keyword?: string;
  itemType?: string;
  page?: number;
  pageSize?: number;
}) {
  const { bookId, keyword, itemType, page = 1, pageSize = 20 } = options;
  const conditions = [eq(schema.novelMaterialLib.isDeleted, false)];
  if (bookId) conditions.push(eq(schema.novelMaterialLib.bookId, bookId));
  if (itemType) conditions.push(eq(schema.novelMaterialLib.itemType, itemType));
  if (keyword) conditions.push(ilike(schema.novelMaterialLib.name, `%${keyword}%`));

  return zhuxianDb
    .select()
    .from(schema.novelMaterialLib)
    .where(and(...conditions))
    .orderBy(schema.novelMaterialLib.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

/**
 * 全局搜索日常物品与信物（分页，可按 item_type 过滤）
 */
export async function searchDailyItems(options: {
  bookId?: number;
  keyword?: string;
  itemType?: string;
  page?: number;
  pageSize?: number;
}) {
  const { bookId, keyword, itemType, page = 1, pageSize = 20 } = options;
  const conditions = [eq(schema.novelDailyItemLib.isDeleted, false)];
  if (bookId) conditions.push(eq(schema.novelDailyItemLib.bookId, bookId));
  if (itemType) conditions.push(eq(schema.novelDailyItemLib.itemType, itemType));
  if (keyword) {
    conditions.push(
      sql`(${ilike(schema.novelDailyItemLib.name, `%${keyword}%`)} OR ${schema.novelDailyItemLib.emotionalTag}::text ILIKE ${'%' + keyword + '%'})`
    );
  }

  return zhuxianDb
    .select()
    .from(schema.novelDailyItemLib)
    .where(and(...conditions))
    .orderBy(schema.novelDailyItemLib.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

/**
 * 全局搜索宗门规制（分页，可按 rule_type 过滤）
 */
export async function searchFactionRules(options: {
  bookId?: number;
  keyword?: string;
  ruleType?: string;
  page?: number;
  pageSize?: number;
}) {
  const { bookId, keyword, ruleType, page = 1, pageSize = 50 } = options;
  const conditions = [eq(schema.novelFactionRuleLib.isDeleted, false)];
  if (bookId) conditions.push(eq(schema.novelFactionRuleLib.bookId, bookId));
  if (ruleType) conditions.push(eq(schema.novelFactionRuleLib.ruleType, ruleType));
  if (keyword) {
    conditions.push(
      sql`(${ilike(schema.novelFactionRuleLib.ruleName, `%${keyword}%`)} OR ${ilike(schema.novelFactionRuleLib.ruleContent, `%${keyword}%`)})`
    );
  }

  return zhuxianDb
    .select()
    .from(schema.novelFactionRuleLib)
    .where(and(...conditions))
    .orderBy(schema.novelFactionRuleLib.ruleType, schema.novelFactionRuleLib.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

/**
 * 全局搜索岁时节令与宗门事件（分页，可按 event_type 过滤）
 */
export async function searchSeasonEvents(options: {
  bookId?: number;
  keyword?: string;
  eventType?: string;
  page?: number;
  pageSize?: number;
}) {
  const { bookId, keyword, eventType, page = 1, pageSize = 50 } = options;
  const conditions = [eq(schema.novelSeasonEventLib.isDeleted, false)];
  if (bookId) conditions.push(eq(schema.novelSeasonEventLib.bookId, bookId));
  if (eventType) conditions.push(eq(schema.novelSeasonEventLib.eventType, eventType));
  if (keyword) conditions.push(ilike(schema.novelSeasonEventLib.eventName, `%${keyword}%`));

  return zhuxianDb
    .select()
    .from(schema.novelSeasonEventLib)
    .where(and(...conditions))
    .orderBy(schema.novelSeasonEventLib.eventType, schema.novelSeasonEventLib.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

/**
 * 获取某书的全局文风配置（一书一条有效）
 */
export async function getStyleGlobalConfig(bookId: number) {
  const rows = await zhuxianDb
    .select()
    .from(schema.styleGlobalConfig)
    .where(and(eq(schema.styleGlobalConfig.bookId, bookId), eq(schema.styleGlobalConfig.isDeleted, false)))
    .limit(1);
  return rows[0] || null;
}

/**
 * 获取某书的场景参数文风映射（按 mapping_type 分组返回）
 */
export async function getStyleSceneMappings(bookId: number) {
  return zhuxianDb
    .select()
    .from(schema.styleSceneMapping)
    .where(and(eq(schema.styleSceneMapping.bookId, bookId), eq(schema.styleSceneMapping.isDeleted, false)))
    .orderBy(schema.styleSceneMapping.mappingType, schema.styleSceneMapping.mappingId);
}

/**
 * 获取某人物的全部心智模型（按 sort_order 排序）
 */
export async function getCharacterMentalModels(charId: number) {
  return zhuxianDb
    .select()
    .from(schema.characterMentalModel)
    .where(and(eq(schema.characterMentalModel.charId, charId), eq(schema.characterMentalModel.isDeleted, false)))
    .orderBy(schema.characterMentalModel.sortOrder, schema.characterMentalModel.modelId);
}

/**
 * 获取某人物的全部决策启发式（按 sort_order 排序）
 */
export async function getCharacterHeuristics(charId: number) {
  return zhuxianDb
    .select()
    .from(schema.characterHeuristic)
    .where(and(eq(schema.characterHeuristic.charId, charId), eq(schema.characterHeuristic.isDeleted, false)))
    .orderBy(schema.characterHeuristic.sortOrder, schema.characterHeuristic.heuristicId);
}

/**
 * 获取某人物的全部人生阶段（按 sort_order 排序）
 */
export async function getCharacterLifeStages(charId: number) {
  return zhuxianDb
    .select()
    .from(schema.characterLifeStage)
    .where(and(eq(schema.characterLifeStage.charId, charId), eq(schema.characterLifeStage.isDeleted, false)))
    .orderBy(schema.characterLifeStage.sortOrder, schema.characterLifeStage.stageId);
}

/**
 * 获取某功法的全部属性蒸馏（按 sort_order 排序）
 */
export async function getTechniqueAttributes(skillId: number) {
  return zhuxianDb
    .select()
    .from(schema.techniqueAttribute)
    .where(and(eq(schema.techniqueAttribute.skillId, skillId), eq(schema.techniqueAttribute.isDeleted, false)))
    .orderBy(schema.techniqueAttribute.sortOrder, schema.techniqueAttribute.id);
}

/**
 * 获取某功法的全部招式蒸馏（按 sort_order 排序）
 */
export async function getTechniqueMoves(skillId: number) {
  return zhuxianDb
    .select()
    .from(schema.techniqueMove)
    .where(and(eq(schema.techniqueMove.skillId, skillId), eq(schema.techniqueMove.isDeleted, false)))
    .orderBy(schema.techniqueMove.sortOrder, schema.techniqueMove.id);
}

/**
 * 获取某功法的全部功法关系蒸馏（克制/互补/同宗等，按 sort_order 排序）
 */
export async function getTechniqueRelations(skillId: number) {
  return zhuxianDb
    .select()
    .from(schema.techniqueRelation)
    .where(and(eq(schema.techniqueRelation.skillId, skillId), eq(schema.techniqueRelation.isDeleted, false)))
    .orderBy(schema.techniqueRelation.sortOrder, schema.techniqueRelation.id);
}

/**
 * 获取某功法的蒸馏原始 JSON 归档（zaomeng 输出）
 */
export async function getTechniqueDistillArchive(skillId: number) {
  return zhuxianDb
    .select()
    .from(schema.techniqueDistillArchive)
    .where(and(eq(schema.techniqueDistillArchive.skillId, skillId), eq(schema.techniqueDistillArchive.isDeleted, false)))
    .orderBy(schema.techniqueDistillArchive.id);
}

/** 批量人物蒸馏结果（轻量、可直接注入 prompt） */
export interface CharacterDistillation {
  charId: number;
  /** 心智模型 one_liner 列表 */
  mentalModels: string[];
  /** 决策启发式（"规则名：规则内容"） */
  heuristics: string[];
  /** 人生阶段（"阶段名：性格状态"） */
  lifeStages: string[];
}

/**
 * 批量获取多个人物的蒸馏数据（心智模型/决策启发式/人生阶段）
 * 用 3 次 inArray 查询代替 N×3 次单人物查询，按 charId 分组返回轻量字符串。
 * 仅取 one_liner / rule_name+rule_text / stage_name+personality_state，控制 token。
 */
export async function getCharacterDistillations(charIds: number[]): Promise<Map<number, CharacterDistillation>> {
  const result = new Map<number, CharacterDistillation>();
  if (!charIds.length) return result;

  const ensure = (id: number): CharacterDistillation => {
    let d = result.get(id);
    if (!d) {
      d = { charId: id, mentalModels: [], heuristics: [], lifeStages: [] };
      result.set(id, d);
    }
    return d;
  };

  const [models, heuristics, stages] = await Promise.all([
    zhuxianDb
      .select({
        charId: schema.characterMentalModel.charId,
        oneLiner: schema.characterMentalModel.oneLiner,
      })
      .from(schema.characterMentalModel)
      .where(and(inArray(schema.characterMentalModel.charId, charIds), eq(schema.characterMentalModel.isDeleted, false)))
      .orderBy(schema.characterMentalModel.charId, schema.characterMentalModel.sortOrder),
    zhuxianDb
      .select({
        charId: schema.characterHeuristic.charId,
        ruleName: schema.characterHeuristic.ruleName,
        ruleText: schema.characterHeuristic.ruleText,
      })
      .from(schema.characterHeuristic)
      .where(and(inArray(schema.characterHeuristic.charId, charIds), eq(schema.characterHeuristic.isDeleted, false)))
      .orderBy(schema.characterHeuristic.charId, schema.characterHeuristic.sortOrder),
    zhuxianDb
      .select({
        charId: schema.characterLifeStage.charId,
        stageName: schema.characterLifeStage.stageName,
        personalityState: schema.characterLifeStage.personalityState,
      })
      .from(schema.characterLifeStage)
      .where(and(inArray(schema.characterLifeStage.charId, charIds), eq(schema.characterLifeStage.isDeleted, false)))
      .orderBy(schema.characterLifeStage.charId, schema.characterLifeStage.sortOrder),
  ]);

  for (const m of models) {
    if (m.charId == null || !m.oneLiner) continue;
    ensure(m.charId).mentalModels.push(m.oneLiner);
  }
  for (const h of heuristics) {
    if (h.charId == null) continue;
    const text = [h.ruleName, h.ruleText].filter(Boolean).join('：');
    if (text) ensure(h.charId).heuristics.push(text);
  }
  for (const s of stages) {
    if (s.charId == null) continue;
    const text = [s.stageName, s.personalityState].filter(Boolean).join('：');
    if (text) ensure(s.charId).lifeStages.push(text);
  }

  return result;
}

/** 批量功法蒸馏结果（轻量、可直接注入 prompt） */
export interface TechniqueDistillation {
  skillId: number;
  /** 功法属性（"品阶：效果"） */
  attributes: string[];
  /** 招式（"招式名：效果"） */
  moves: string[];
  /** 功法关系（"关系类型 目标功法：描述"） */
  relations: string[];
}

/**
 * 批量获取多个功法的蒸馏数据（属性/招式/关系）
 * 用 3 次 inArray 查询代替 N×3 次单功法查询，按 skillId 分组返回轻量字符串。
 * 仅取核心字段，控制 token。
 */
export async function getTechniqueDistillations(skillIds: number[]): Promise<Map<number, TechniqueDistillation>> {
  const result = new Map<number, TechniqueDistillation>();
  if (!skillIds.length) return result;

  const ensure = (id: number): TechniqueDistillation => {
    let d = result.get(id);
    if (!d) {
      d = { skillId: id, attributes: [], moves: [], relations: [] };
      result.set(id, d);
    }
    return d;
  };

  const [attributes, moves, relations] = await Promise.all([
    zhuxianDb
      .select({
        skillId: schema.techniqueAttribute.skillId,
        grade: schema.techniqueAttribute.grade,
        effect: schema.techniqueAttribute.effect,
      })
      .from(schema.techniqueAttribute)
      .where(and(inArray(schema.techniqueAttribute.skillId, skillIds), eq(schema.techniqueAttribute.isDeleted, false)))
      .orderBy(schema.techniqueAttribute.skillId, schema.techniqueAttribute.sortOrder),
    zhuxianDb
      .select({
        skillId: schema.techniqueMove.skillId,
        moveName: schema.techniqueMove.moveName,
        effect: schema.techniqueMove.effect,
      })
      .from(schema.techniqueMove)
      .where(and(inArray(schema.techniqueMove.skillId, skillIds), eq(schema.techniqueMove.isDeleted, false)))
      .orderBy(schema.techniqueMove.skillId, schema.techniqueMove.sortOrder),
    zhuxianDb
      .select({
        skillId: schema.techniqueRelation.skillId,
        relationType: schema.techniqueRelation.relationType,
        targetTechnique: schema.techniqueRelation.targetTechnique,
        description: schema.techniqueRelation.description,
      })
      .from(schema.techniqueRelation)
      .where(and(inArray(schema.techniqueRelation.skillId, skillIds), eq(schema.techniqueRelation.isDeleted, false)))
      .orderBy(schema.techniqueRelation.skillId, schema.techniqueRelation.sortOrder),
  ]);

  for (const a of attributes) {
    if (a.skillId == null) continue;
    const text = [a.grade, a.effect].filter(Boolean).join('：');
    if (text) ensure(a.skillId).attributes.push(text);
  }
  for (const m of moves) {
    if (m.skillId == null) continue;
    const text = [m.moveName, m.effect].filter(Boolean).join('：');
    if (text) ensure(m.skillId).moves.push(text);
  }
  for (const r of relations) {
    if (r.skillId == null) continue;
    const prefix = [r.relationType, r.targetTechnique].filter(Boolean).join(' ');
    const text = [prefix, r.description].filter(Boolean).join('：');
    if (text) ensure(r.skillId).relations.push(text);
  }

  return result;
}

/**
 * 获取某门派的成员（含人物名）
 */
export async function getFactionMembers(factionId: number) {
  return zhuxianDb
    .select({
      id: schema.libFactionMember.id,
      charId: schema.libFactionMember.charId,
      position: schema.libFactionMember.position,
      charName: schema.novelCharacterLib.name,
      charRealm: schema.novelCharacterLib.realm,
    })
    .from(schema.libFactionMember)
    .leftJoin(schema.novelCharacterLib, eq(schema.libFactionMember.charId, schema.novelCharacterLib.id))
    .where(eq(schema.libFactionMember.factionId, factionId));
}

/** 实体名单条目（id + 名字） */
export interface EntityNameEntry {
  id: number;
  name: string;
}

/** 全量实体名单（用于自动关联） */
export interface EntityNameDirectory {
  characters: EntityNameEntry[];
  factions: EntityNameEntry[];
  locations: EntityNameEntry[];
  skills: EntityNameEntry[];
  items: EntityNameEntry[];
}

/** 实体名单缓存（5分钟TTL，世界观库很少变动） */
let entityNameCache: { data: EntityNameDirectory; expiresAt: number } | null = null;
const ENTITY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 获取全量实体名单（带缓存）
 * 用于根据章节文本自动匹配出场实体
 */
export async function getEntityNameDirectory(): Promise<EntityNameDirectory> {
  if (entityNameCache && Date.now() < entityNameCache.expiresAt) {
    return entityNameCache.data;
  }

  const [chars, facs, locs, skls, its] = await Promise.all([
    zhuxianDb
      .select({ id: schema.novelCharacterLib.id, name: schema.novelCharacterLib.name })
      .from(schema.novelCharacterLib)
      .where(eq(schema.novelCharacterLib.isDeleted, false)),
    zhuxianDb
      .select({ id: schema.novelFactionLib.id, name: schema.novelFactionLib.name })
      .from(schema.novelFactionLib)
      .where(eq(schema.novelFactionLib.isDeleted, false)),
    zhuxianDb
      .select({ id: schema.novelLocationLib.id, name: schema.novelLocationLib.name })
      .from(schema.novelLocationLib)
      .where(eq(schema.novelLocationLib.isDeleted, false)),
    zhuxianDb
      .select({ id: schema.novelSkillLib.id, name: schema.novelSkillLib.name })
      .from(schema.novelSkillLib)
      .where(eq(schema.novelSkillLib.isDeleted, false)),
    zhuxianDb
      .select({ id: schema.novelMagicItemLib.id, name: schema.novelMagicItemLib.name })
      .from(schema.novelMagicItemLib)
      .where(eq(schema.novelMagicItemLib.isDeleted, false)),
  ]);

  const data: EntityNameDirectory = {
    characters: dedupeByName(chars.map((c) => ({ id: c.id, name: c.name }))),
    factions: dedupeByName(facs.map((f) => ({ id: f.id, name: f.name }))),
    locations: dedupeByName(locs.map((l) => ({ id: l.id, name: l.name }))),
    skills: dedupeByName(skls.map((s) => ({ id: s.id, name: s.name }))),
    items: dedupeByName(its.map((i) => ({ id: i.id, name: i.name }))),
  };

  entityNameCache = { data, expiresAt: Date.now() + ENTITY_CACHE_TTL_MS };
  return data;
}

/**
 * 按名字去重，同名只保留 id 最小的一条（主条目/首批分析，通常字段更完整）。
 * 诛仙库因多批分析存在重名记录（如"张小凡"有 id=2 与 id=177 两条），
 * 若不去重会导致同一实体被重复拉入写作上下文，浪费 token。
 */
function dedupeByName(entries: EntityNameEntry[]): EntityNameEntry[] {
  const byName = new Map<string, EntityNameEntry>();
  for (const e of entries) {
    if (!e.name) continue;
    const existing = byName.get(e.name);
    if (!existing || e.id < existing.id) {
      byName.set(e.name, e);
    }
  }
  return Array.from(byName.values());
}
