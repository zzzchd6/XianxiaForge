/**
 * 世界观库（novel_db）Drizzle ORM Schema
 * 列名与 192.168.0.120:5432/novel_db 实际数据库完全一致。
 *
 * 定位升级（2026-08-01）：原"诛仙库（只读）"升级为"世界观库（多书、可写）"。
 * - 诛仙三书（book_id=1/2/3）source_type='system'，只读保护，禁删禁改实体；
 * - 用户新建书 source_type='user'，可读写、可批量引入/文本抽取入库。
 * RAG 管线（embedding/文风/心智模型等）仍读本库，默认锁定 book_id=1。
 */
import {
  pgTable,
  bigserial,
  serial,
  text,
  varchar,
  integer,
  smallint,
  bigint,
  numeric,
  jsonb,
  timestamp,
  boolean,
  customType,
} from 'drizzle-orm/pg-core';

/** 自定义 vector(512) 类型 */
export const vector512 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(512)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value.replace(/[\[\]]/g, '').split(',').map(Number);
  },
});

/** 小说书籍表 - PK: book_id */
export const novelBook = pgTable('novel_book', {
  bookId: bigserial('book_id', { mode: 'number' }).primaryKey(),
  bookName: varchar('book_name', { length: 255 }).notNull(),
  author: varchar('author', { length: 255 }),
  source: varchar('source', { length: 255 }),
  totalWordCount: bigint('total_word_count', { mode: 'number' }),
  totalChapter: integer('total_chapter'),
  createTime: timestamp('create_time', { withTimezone: true }),
  updateTime: timestamp('update_time', { withTimezone: true }),
  tags: jsonb('tags'),
  description: text('description'),
  sourceType: varchar('source_type', { length: 20 }).default('system'),
  coverUrl: varchar('cover_url', { length: 500 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
});

/** 小说章节表 - PK: chapter_id */
export const novelChapter = pgTable('novel_chapter', {
  chapterId: bigserial('chapter_id', { mode: 'number' }).primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }).notNull(),
  chapterNo: integer('chapter_no'),
  chapterTitle: varchar('chapter_title', { length: 255 }),
  rawContent: text('raw_content'),
  cleanContent: text('clean_content'),
  wordCount: integer('word_count'),
  createTime: timestamp('create_time', { withTimezone: true }),
  volumeNo: integer('volume_no'),
  analyzed: boolean('analyzed'),
  updateTime: timestamp('update_time', { withTimezone: true }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
});

/** 人物库 - PK: id */
export const novelCharacterLib = pgTable('novel_character_lib', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  name: varchar('name', { length: 255 }).notNull(),
  allTitles: text('all_titles').array(),
  faction: text('faction'),
  realm: varchar('realm', { length: 100 }),
  combatType: varchar('combat_type', { length: 100 }),
  coreSkills: text('core_skills').array(),
  personality: text('personality'),
  growthLine: text('growth_line').array(),
  plotTags: text('plot_tags').array(),
  entityType: varchar('entity_type', { length: 50 }),
  source: varchar('source', { length: 255 }),
  embedding: vector512('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  writingProfile: jsonb('writing_profile'),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
  exclusiveItems: jsonb('exclusive_items'),
});

/** 门派库 - PK: id (serial4) */
export const novelFactionLib = pgTable('novel_faction_lib', {
  id: serial('id').primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  name: varchar('name', { length: 255 }).notNull(),
  camp: varchar('camp', { length: 100 }),
  headquarters: text('headquarters'),
  leader: varchar('leader', { length: 255 }),
  townTreasure: text('town_treasure'),
  cultivationFeature: text('cultivation_feature'),
  forceRelations: text('force_relations').array(),
  entityType: varchar('entity_type', { length: 50 }),
  source: varchar('source', { length: 255 }),
  embedding: vector512('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
});

/** 地点库 - PK: id (serial4) */
export const novelLocationLib = pgTable('novel_location_lib', {
  id: serial('id').primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  name: varchar('name', { length: 255 }).notNull(),
  level: varchar('level', { length: 100 }),
  parentRegion: varchar('parent_region', { length: 255 }),
  relatedFaction: text('related_faction'),
  environment: text('environment'),
  keyEvents: text('key_events').array(),
  dangerLevel: varchar('danger_level', { length: 100 }),
  specialFunctions: text('special_functions'),
  entityType: varchar('entity_type', { length: 50 }),
  source: varchar('source', { length: 255 }),
  embedding: vector512('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
  verifyStatus: varchar('verify_status', { length: 50 }),
});

/** 法宝库 - PK: id (serial4) */
export const novelMagicItemLib = pgTable('novel_magic_item_lib', {
  id: serial('id').primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  name: varchar('name', { length: 255 }).notNull(),
  grade: varchar('grade', { length: 100 }),
  system: varchar('system', { length: 100 }),
  owners: text('owners').array(),
  appearance: text('appearance'),
  coreAbilities: text('core_abilities'),
  useLimit: text('use_limit'),
  evolution: text('evolution'),
  relatedPlots: text('related_plots').array(),
  entityType: varchar('entity_type', { length: 50 }),
  source: varchar('source', { length: 255 }),
  embedding: vector512('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
  verifyStatus: varchar('verify_status', { length: 50 }),
});

/** 妖兽库 - PK: id (serial4) */
export const novelMonsterLib = pgTable('novel_monster_lib', {
  id: serial('id').primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  name: varchar('name', { length: 255 }).notNull(),
  level: varchar('level', { length: 100 }),
  race: varchar('race', { length: 100 }),
  coreAbilities: text('core_abilities').array(),
  habitat: text('habitat'),
  combatLevel: varchar('combat_level', { length: 100 }),
  relatedPlot: text('related_plot'),
  entityType: varchar('entity_type', { length: 50 }),
  source: varchar('source', { length: 255 }),
  embedding: vector512('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
  verifyStatus: varchar('verify_status', { length: 50 }),
});

/** 功法库 - PK: id (serial4) */
export const novelSkillLib = pgTable('novel_skill_lib', {
  id: serial('id').primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  name: varchar('name', { length: 255 }).notNull(),
  grade: varchar('grade', { length: 100 }),
  faction: text('faction'),
  skillType: varchar('skill_type', { length: 100 }),
  threshold: text('threshold'),
  coreEffect: text('core_effect'),
  counter: text('counter'),
  famousUsage: text('famous_usage').array(),
  entityType: varchar('entity_type', { length: 50 }),
  source: varchar('source', { length: 255 }),
  embedding: vector512('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
  verifyStatus: varchar('verify_status', { length: 50 }),
});

/** 人物关系表 - PK: rel_id（无 is_deleted） */
export const libCharacterRelation = pgTable('lib_character_relation', {
  relId: bigserial('rel_id', { mode: 'number' }).primaryKey(),
  charAId: bigint('char_a_id', { mode: 'number' }),
  charBId: bigint('char_b_id', { mode: 'number' }),
  relType: varchar('rel_type', { length: 100 }),
  interactCount: integer('interact_count'),
  createdAt: timestamp('created_at', { withTimezone: true }),
});

/** 门派成员表 - PK: id（无 is_deleted） */
export const libFactionMember = pgTable('lib_faction_member', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  factionId: integer('faction_id'),
  charId: bigint('char_id', { mode: 'number' }),
  position: varchar('position', { length: 100 }),
});

/** 章节分析表 - PK: id */
export const chapterAnalysis = pgTable('chapter_analysis', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  volumeNo: integer('volume_no'),
  chapterNo: integer('chapter_no'),
  chapterTitle: varchar('chapter_title', { length: 255 }),
  corePlot: text('core_plot'),
  plotTimeline: text('plot_timeline'),
  sceneList: jsonb('scene_list'),
  charAppear: jsonb('char_appear'),
  charRelationChange: text('char_relation_change'),
  foreshadow: text('foreshadow'),
  worldSetting: jsonb('world_setting'),
  theme: text('theme'),
  writingStyleTag: text('writing_style_tag').array(),
  conflictLevel: integer('conflict_level'),
  chapterEmbId: bigint('chapter_emb_id', { mode: 'number' }),
  createTime: timestamp('create_time', { withTimezone: true }),
  chapterId: bigint('chapter_id', { mode: 'number' }),
  originalVolumeNo: integer('original_volume_no'),
  verifyStatus: varchar('verify_status', { length: 50 }),
  algorithmVersion: varchar('algorithm_version', { length: 50 }),
  batchId: varchar('batch_id', { length: 100 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
});

/** 场景分析表 - PK: id */
export const sceneAnalysis = pgTable('scene_analysis', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  chapterId: bigint('chapter_id', { mode: 'number' }),
  sceneNo: integer('scene_no'),
  sceneSeqInChapter: text('scene_seq_in_chapter'),
  sceneLocation: text('scene_location'),
  sceneTime: text('scene_time'),
  sceneWeather: text('scene_weather'),
  timeDuration: text('time_duration'),
  sceneFunction: text('scene_function'),
  plotWeight: text('plot_weight'),
  conflictLevel: integer('conflict_level'),
  hasTurningPoint: boolean('has_turning_point'),
  coreEvent: text('core_event'),
  foreshadowing: jsonb('foreshadowing'),
  emotionScore: smallint('emotion_score'),
  emotionMainType: text('emotion_main_type'),
  narrativePerspective: text('narrative_perspective'),
  avgSentenceLength: numeric('avg_sentence_length'),
  writingTags: text('writing_tags').array(),
  interactionType: text('interaction_type'),
  coreCharCount: smallint('core_char_count'),
  entityOccur: jsonb('entity_occur'),
  wordCount: integer('word_count'),
  analyzed: boolean('analyzed'),
  verifyStatus: text('verify_status'),
  analyzeVersion: text('analyze_version'),
  sceneEmb: vector512('scene_emb'),
  createTime: timestamp('create_time', { withTimezone: true }),
  updateTime: timestamp('update_time', { withTimezone: true }),
  actionRatio: numeric('action_ratio'),
  dialogueRatio: numeric('dialogue_ratio'),
  descriptionRatio: numeric('description_ratio'),
  startPos: integer('start_pos'),
  endPos: integer('end_pos'),
  batchId: varchar('batch_id', { length: 100 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
});

/** 情节单元表 - PK: unit_id */
export const plotUnit = pgTable('plot_unit', {
  unitId: bigserial('unit_id', { mode: 'number' }).primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  chapterId: bigint('chapter_id', { mode: 'number' }),
  sceneId: bigint('scene_id', { mode: 'number' }),
  unitFunction: text('unit_function'),
  conflictLevel: integer('conflict_level'),
  emotionScore: smallint('emotion_score'),
  emotionCurve: text('emotion_curve'),
  wordCount: integer('word_count'),
  createTime: timestamp('create_time', { withTimezone: true }),
  updateTime: timestamp('update_time', { withTimezone: true }),
  coreCharIds: bigint('core_char_ids', { mode: 'number' }).array(),
  supportCharIds: bigint('support_char_ids', { mode: 'number' }).array(),
  extraCharIds: bigint('extra_char_ids', { mode: 'number' }).array(),
  verifyStatus: varchar('verify_status', { length: 50 }),
  algorithmVersion: varchar('algorithm_version', { length: 50 }),
  batchId: varchar('batch_id', { length: 100 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
});

/** 丹药灵材毒物库 - PK: id (serial4) */
export const novelMaterialLib = pgTable('novel_material_lib', {
  id: serial('id').primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  name: varchar('name', { length: 255 }).notNull(),
  itemType: varchar('item_type', { length: 100 }),
  grade: varchar('grade', { length: 100 }),
  coreEffect: text('core_effect'),
  sideEffect: text('side_effect'),
  origin: varchar('origin', { length: 255 }),
  usageScene: text('usage_scene').array(),
  entityType: varchar('entity_type', { length: 50 }),
  source: varchar('source', { length: 255 }),
  embedding: vector512('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
});

/** 日常物品与信物库 - PK: id */
export const novelDailyItemLib = pgTable('novel_daily_item_lib', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  name: varchar('name', { length: 255 }).notNull(),
  itemType: varchar('item_type', { length: 100 }),
  grade: varchar('grade', { length: 100 }),
  relatedFaction: varchar('related_faction', { length: 255 }),
  appearance: text('appearance'),
  material: varchar('material', { length: 255 }),
  usageScene: text('usage_scene').array(),
  emotionalTag: text('emotional_tag').array(),
  entityType: varchar('entity_type', { length: 50 }),
  source: varchar('source', { length: 255 }),
  embedding: vector512('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
});

/** 宗门规制库 - PK: id */
export const novelFactionRuleLib = pgTable('novel_faction_rule_lib', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  factionId: bigint('faction_id', { mode: 'number' }),
  factionName: varchar('faction_name', { length: 255 }),
  ruleType: varchar('rule_type', { length: 100 }),
  ruleName: varchar('rule_name', { length: 255 }),
  ruleContent: text('rule_content'),
  severity: varchar('severity', { length: 50 }),
  enforcement: text('enforcement'),
  relatedPlots: text('related_plots').array(),
  entityType: varchar('entity_type', { length: 50 }),
  source: varchar('source', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
});

/** 岁时节令与宗门事件库 - PK: id */
export const novelSeasonEventLib = pgTable('novel_season_event_lib', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  eventType: varchar('event_type', { length: 100 }),
  eventName: varchar('event_name', { length: 255 }).notNull(),
  cycleDescription: varchar('cycle_description', { length: 255 }),
  relatedFaction: varchar('related_faction', { length: 255 }),
  traditions: text('traditions').array(),
  atmosphere: text('atmosphere'),
  relatedPlots: text('related_plots').array(),
  entityType: varchar('entity_type', { length: 50 }),
  source: varchar('source', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
});

/** 全局文风配置表 - PK: config_id（一书一条有效） */
export const styleGlobalConfig = pgTable('style_global_config', {
  configId: bigserial('config_id', { mode: 'number' }).primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  styleName: text('style_name'),
  mentalModels: text('mental_models').array(),
  decisionHeuristics: text('decision_heuristics').array(),
  descriptionRatio: jsonb('description_ratio'),
  coreImagery: text('core_imagery').array(),
  forbiddenWords: text('forbidden_words').array(),
  sentenceRules: jsonb('sentence_rules'),
  perspectiveRules: text('perspective_rules').array(),
  antiPatterns: text('anti_patterns').array(),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
  createTime: timestamp('create_time', { withTimezone: true }),
  updateTime: timestamp('update_time', { withTimezone: true }),
});

/** 场景参数文风映射表 - PK: mapping_id */
export const styleSceneMapping = pgTable('style_scene_mapping', {
  mappingId: bigserial('mapping_id', { mode: 'number' }).primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  mappingType: text('mapping_type'),
  triggerKey: text('trigger_key'),
  resultValue: jsonb('result_value'),
  description: text('description'),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
  createTime: timestamp('create_time', { withTimezone: true }),
  updateTime: timestamp('update_time', { withTimezone: true }),
});

/** 人物心智模型表 - PK: model_id（纵表，一人多条） */
export const characterMentalModel = pgTable('character_mental_model', {
  modelId: bigserial('model_id', { mode: 'number' }).primaryKey(),
  charId: bigint('char_id', { mode: 'number' }),
  bookId: bigint('book_id', { mode: 'number' }),
  distillSource: varchar('distill_source', { length: 50 }),
  modelName: varchar('model_name', { length: 100 }),
  oneLiner: text('one_liner'),
  evidenceJson: jsonb('evidence_json'),
  application: text('application'),
  limitation: text('limitation'),
  sortOrder: integer('sort_order'),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
  createTime: timestamp('create_time', { withTimezone: true }),
  updateTime: timestamp('update_time', { withTimezone: true }),
});

/** 人物决策启发式表 - PK: heuristic_id（纵表，一人多条） */
export const characterHeuristic = pgTable('character_heuristic', {
  heuristicId: bigserial('heuristic_id', { mode: 'number' }).primaryKey(),
  charId: bigint('char_id', { mode: 'number' }),
  bookId: bigint('book_id', { mode: 'number' }),
  distillSource: varchar('distill_source', { length: 50 }),
  ruleName: varchar('rule_name', { length: 100 }),
  scenario: text('scenario'),
  ruleText: text('rule_text'),
  exampleText: text('example_text'),
  sortOrder: integer('sort_order'),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
  createTime: timestamp('create_time', { withTimezone: true }),
  updateTime: timestamp('update_time', { withTimezone: true }),
});

/** 人物人生阶段表 - PK: stage_id（纵表，按时间排序） */
export const characterLifeStage = pgTable('character_life_stage', {
  stageId: bigserial('stage_id', { mode: 'number' }).primaryKey(),
  charId: bigint('char_id', { mode: 'number' }),
  bookId: bigint('book_id', { mode: 'number' }),
  distillSource: varchar('distill_source', { length: 50 }),
  stageName: varchar('stage_name', { length: 100 }),
  eventsText: text('events_text'),
  personalityState: text('personality_state'),
  sortOrder: integer('sort_order'),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
  createTime: timestamp('create_time', { withTimezone: true }),
  updateTime: timestamp('update_time', { withTimezone: true }),
});

/** 功法属性蒸馏表 - PK: id（纵表，一功法多条属性） */
export const techniqueAttribute = pgTable('technique_attribute', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  skillId: bigint('skill_id', { mode: 'number' }),
  distillSource: varchar('distill_source', { length: 50 }),
  grade: varchar('grade', { length: 100 }),
  element: varchar('element', { length: 100 }),
  difficulty: varchar('difficulty', { length: 255 }),
  effect: text('effect'),
  evidenceJson: jsonb('evidence_json'),
  sortOrder: integer('sort_order'),
  bookId: bigint('book_id', { mode: 'number' }),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
  createdAt: timestamp('created_at'),
});

/** 功法招式蒸馏表 - PK: id（纵表，一功法多招） */
export const techniqueMove = pgTable('technique_move', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  skillId: bigint('skill_id', { mode: 'number' }),
  distillSource: varchar('distill_source', { length: 50 }),
  moveName: varchar('move_name', { length: 100 }),
  effect: text('effect'),
  requirement: text('requirement'),
  evidenceJson: jsonb('evidence_json'),
  sortOrder: integer('sort_order'),
  bookId: bigint('book_id', { mode: 'number' }),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
  createdAt: timestamp('created_at'),
});

/** 功法关系蒸馏表 - PK: id（纵表，功法间克制/互补/同宗等关系） */
export const techniqueRelation = pgTable('technique_relation', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  skillId: bigint('skill_id', { mode: 'number' }),
  distillSource: varchar('distill_source', { length: 50 }),
  targetTechnique: varchar('target_technique', { length: 255 }),
  relationType: varchar('relation_type', { length: 50 }),
  description: text('description'),
  evidenceJson: jsonb('evidence_json'),
  sortOrder: integer('sort_order'),
  bookId: bigint('book_id', { mode: 'number' }),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
  createdAt: timestamp('created_at'),
});

/** 功法蒸馏归档表 - PK: id（zaomeng 输出原始 JSON 归档） */
export const techniqueDistillArchive = pgTable('technique_distill_archive', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  skillId: bigint('skill_id', { mode: 'number' }),
  distillSource: varchar('distill_source', { length: 50 }),
  distillVersion: varchar('distill_version', { length: 50 }),
  contentJson: jsonb('content_json'),
  bookId: bigint('book_id', { mode: 'number' }),
  verifyStatus: varchar('verify_status', { length: 50 }),
  isDeleted: boolean('is_deleted').default(false),
  version: integer('version'),
  createdAt: timestamp('created_at'),
});

/** 段落表 - PK: para_id（章节切分段落，按 para_seq 排序） */
export const novelParagraph = pgTable('novel_paragraph', {
  paraId: bigserial('para_id', { mode: 'number' }).primaryKey(),
  chapterId: bigint('chapter_id', { mode: 'number' }),
  paraSeq: integer('para_seq').notNull(),
  paraText: text('para_text'),
  paraType: text('para_type'),
  createTime: timestamp('create_time', { withTimezone: true }),
});

/** 章节向量表 - PK: id（章级语义向量，供相似章节检索） */
export const chapterEmbedding = pgTable('chapter_embedding', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }),
  chapterNo: integer('chapter_no'),
  chapterTitle: text('chapter_title'),
  content: text('content'),
  embedding: vector512('embedding'),
});

/** 场景人物动作表 - PK: id（场景内某人物的动作/戏份明细） */
export const sceneCharacterAction = pgTable('scene_character_action', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  sceneId: bigint('scene_id', { mode: 'number' }).notNull(),
  charId: bigint('char_id', { mode: 'number' }).notNull(),
  action: text('action'),
  lineCount: integer('line_count'),
  roleType: varchar('role_type', { length: 20 }),
});

/** 场景指标表 - PK: id（场景量化指标，KV 纵表） */
export const sceneMetric = pgTable('scene_metric', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  sceneId: bigint('scene_id', { mode: 'number' }).notNull(),
  metricName: varchar('metric_name', { length: 50 }).notNull(),
  metricValue: numeric('metric_value').notNull(),
});

/** 人物蒸馏归档表 - PK: distill_id（各Skill输出原始JSON归档，按来源区分） */
export const characterDistillArchive = pgTable('character_distill_archive', {
  distillId: bigserial('distill_id', { mode: 'number' }).primaryKey(),
  charId: bigint('char_id', { mode: 'number' }).notNull(),
  bookId: bigint('book_id', { mode: 'number' }).notNull(),
  distillSource: varchar('distill_source', { length: 30 }).notNull(),
  distillVersion: varchar('distill_version', { length: 20 }).notNull(),
  contentJson: jsonb('content_json').notNull(),
  verifyStatus: varchar('verify_status', { length: 50 }).notNull(),
  isDeleted: boolean('is_deleted').notNull().default(false),
  version: integer('version').notNull().default(1),
  createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
  updateTime: timestamp('update_time', { withTimezone: true }).notNull().defaultNow(),
});

/** 跨书引入日志表 - PK: id（记录源→目标实体映射，承载关系重建与来源追溯） */
export const entityImportLog = pgTable('entity_import_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  batchId: varchar('batch_id', { length: 40 }).notNull(),
  sourceBookId: bigint('source_book_id', { mode: 'number' }).notNull(),
  targetBookId: bigint('target_book_id', { mode: 'number' }).notNull(),
  entityType: varchar('entity_type', { length: 30 }).notNull(),
  sourceEntityId: bigint('source_entity_id', { mode: 'number' }).notNull(),
  targetEntityId: bigint('target_entity_id', { mode: 'number' }),
  status: varchar('status', { length: 20 }).notNull().default('success'),
  errorMessage: text('error_message'),
  createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
});

/** 世界观批量导入任务表 - PK: id（文本抽取任务，book_id 为主作用域，project_id 仅溯源可空） */
export const worldBatchImport = pgTable('world_batch_import', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  bookId: bigint('book_id', { mode: 'number' }).notNull(),
  projectId: bigint('project_id', { mode: 'number' }),
  sourceText: text('source_text').notNull(),
  entityTypes: jsonb('entity_types'),
  status: varchar('status', { length: 30 }).notNull().default('pending'),
  result: jsonb('result'),
  createdCount: integer('created_count').default(0),
  failedCount: integer('failed_count').default(0),
  createTime: timestamp('create_time', { withTimezone: true }).notNull().defaultNow(),
  completedTime: timestamp('completed_time', { withTimezone: true }),
});
