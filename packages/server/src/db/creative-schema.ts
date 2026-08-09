/**
 * 创作库 Drizzle ORM Schema
 * 完全对齐数据库实际列定义（7张表）
 */
import {
  pgTable,
  bigserial,
  bigint,
  text,
  integer,
  varchar,
  jsonb,
  timestamp,
  boolean,
  numeric,
  real,
} from 'drizzle-orm/pg-core';

/** 创作项目表 */
export const creativeProject = pgTable('creative_project', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  genre: text('genre'),
  sourceBookId: bigint('source_book_id', { mode: 'number' }).default(1),
  status: varchar('status', { length: 20 }).notNull().default('planning'),
  llmConfig: jsonb('llm_config').default({}),
  generationConfig: jsonb('generation_config').default({}),
  /** 默认影响对象人物ID数组（影响体系：章节 POV 为空时的兜底作用目标，通常为主角） */
  defaultImpactCharacterIds: bigint('default_impact_character_ids', { mode: 'number' }).array().default([]),
  /** 故事引擎类型（R5，如 upgrade/revenge/mystery/romance） */
  storyEngineType: varchar('story_engine_type', { length: 32 }),
  /** 故事引擎描述（R5，核心驱动力的自然语言说明） */
  storyEngineDesc: text('story_engine_desc'),
  /** 雪花法渐进大纲中间态草稿（开源借鉴 PRD v1.1 M7，finalize 后置空） */
  snowflakeDraft: jsonb('snowflake_draft'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 故事大纲表（卷级） */
export const storyOutline = pgTable('story_outline', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  volumeNo: integer('volume_no').notNull(),
  title: text('title').notNull(),
  synopsis: text('synopsis'),
  keyEvents: jsonb('key_events').default([]), // @deprecated 2026-08-07 前端不展示，仅后端保留用于场景导入降级路径（scenes.ts:674）
  characterArcs: jsonb('character_arcs').default([]), // @deprecated 2026-08-07 前端不展示，用户弧线已迁移至 growth_stage 系统
  foreshadowing: jsonb('foreshadowing').default([]),
  worldBuildingNotes: text('world_building_notes'),
  sortOrder: integer('sort_order').default(0),
  status: varchar('status', { length: 20 }).default('draft'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 章节计划表 */
export const chapterPlan = pgTable('chapter_plan', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  outlineId: bigint('outline_id', { mode: 'number' }).references(() => storyOutline.id, { onDelete: 'set null' }),
  volumeNo: integer('volume_no').notNull(),
  chapterNo: integer('chapter_no').notNull(),
  title: text('title').notNull(),
  intent: text('intent'),
  povCharacterIds: bigint('pov_character_ids', { mode: 'number' }).array().default([]),
  targetWordCount: integer('target_word_count').default(3000),
  sceneBreakdown: jsonb('scene_breakdown').default([]),
  /** 关键剧情锚点（模块1）：本章必须发生的强制事件数组，空=不启用 */
  mustHaveEvents: jsonb('must_have_events').default([]),
  requiredEntityIds: jsonb('required_entity_ids').default({}),
  emotionTarget: text('emotion_target'),
  conflictTarget: integer('conflict_target').default(3),
  prevChapterSummary: text('prev_chapter_summary'),
  status: varchar('status', { length: 20 }).default('planned'),
  /** 本章计划由哪个分支选项衍生而来（chapter_branch_option.id），空=非分支衍生 */
  branchSourceOptionId: bigint('branch_source_option_id', { mode: 'number' }),
  /** 分支来源父章节的 chapter_plan.id（用于回溯影响标签历史栈），空=非分支衍生 */
  branchParentChapterId: bigint('branch_parent_chapter_id', { mode: 'number' }),
  /** 本章核心桥段类型（需求4）：faceoff/puzzle/showcase/dialogue/relation/daily/upgrade/crisis/reveal */
  plotFingerprint: varchar('plot_fingerprint', { length: 30 }),
  /** 章末钩子类型（需求6）：suspense/emotion/turn/crisis/reveal */
  hookType: varchar('hook_type', { length: 20 }),
  /** 钩子强度（需求6）：light/medium/heavy */
  hookIntensity: varchar('hook_intensity', { length: 10 }),
  /** 冲突值分值（天命P0#1）：计算得出的量化分值 */
  conflictScore: integer('conflict_score'),
  /** 冲突星级（天命P0#1）：1star~5star */
  conflictRating: varchar('conflict_rating', { length: 10 }),
  /** 是否峰值章节（天命P0#1）：≥4星 */
  isPeak: boolean('is_peak').default(false),
  /** 是否奇点事件（天命P0#1） */
  singularityEvent: boolean('singularity_event').default(false),
  /** 章节类型（天命P1#4）：climax/progression/revelation/buffer_price/buffer_dialog/buffer_clue/singularity */
  chapterType: varchar('chapter_type', { length: 30 }).default('progression'),
  /** 手动固定的剧情素材引用数组（二期RAG人工干预）：元素形如 {table, id}，table∈{plot_material_encounter/foreshadow/highlight/task}，空=不固定 */
  pinnedMaterialIds: jsonb('pinned_material_ids').default([]),
  /** 随分支生成的"后续大概率怎么发展"世界观推演（基于人物/宗门规制/岁时节令/文风），空=未生成 */
  branchPrediction: text('branch_prediction'),
  /** 所属分支弧（动态叙事引擎）：关联 branch_arc.id，空=非分支弧章节 */
  branchArcId: bigint('branch_arc_id', { mode: 'number' }),
  /** 是否为汇合章节（动态叙事引擎）：分支弧汇合到里程碑的过渡章 */
  isConvergence: boolean('is_convergence').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 生成任务表 */
export const generationTask = pgTable('generation_task', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  chapterPlanId: bigint('chapter_plan_id', { mode: 'number' }).references(() => chapterPlan.id, { onDelete: 'set null' }),
  taskType: varchar('task_type', { length: 20 }).notNull().default('chapter'),
  status: varchar('status', { length: 20 }).default('pending'),
  currentStep: varchar('current_step', { length: 50 }),
  inputSnapshot: jsonb('input_snapshot'),
  outputText: text('output_text'),
  auditReport: jsonb('audit_report'),
  revisionNotes: jsonb('revision_notes'),
  errorMessage: text('error_message'),
  llmModel: varchar('llm_model', { length: 100 }),
  tokensUsed: integer('tokens_used'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  position: integer('position').default(0),
  retryCount: integer('retry_count').default(0),
  maxRetries: integer('max_retries').default(3),
  batchId: varchar('batch_id', { length: 50 }),
  queueOptions: jsonb('queue_options'),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 生成章节表（支持多版本） */
export const generatedChapter = pgTable('generated_chapter', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).references(() => creativeProject.id, { onDelete: 'cascade' }),
  chapterPlanId: bigint('chapter_plan_id', { mode: 'number' }).references(() => chapterPlan.id, { onDelete: 'set null' }),
  taskId: bigint('task_id', { mode: 'number' }),
  volumeNo: integer('volume_no'),
  chapterNo: integer('chapter_no'),
  title: text('title'),
  content: text('content'),
  wordCount: integer('word_count').default(0),
  version: integer('version').notNull().default(1),
  parentVersionId: bigint('parent_version_id', { mode: 'number' }),
  qualityScore: jsonb('quality_score'),
  isCurrent: boolean('is_current').default(true),
  status: varchar('status', { length: 20 }).default('draft'),
  /** 段落多视角重写版本（模块6，jsonb 数组：[{excerpt,characterId,characterName,rewritten,createdAt}]，不覆盖原文） */
  perspectiveVersions: jsonb('perspective_versions').default([]),
  /** 章信息仪表盘（天命P1#6）：结构化元数据 */
  dashboard: jsonb('dashboard'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 作者规则表 */
export const authorRules = pgTable('author_rules', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  ruleType: varchar('rule_type', { length: 20 }).notNull().default('soft'),
  ruleContent: text('rule_content').notNull(),
  priority: integer('priority').default(0),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 生成日志表 */
export const generationLog = pgTable('generation_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).references(() => creativeProject.id, { onDelete: 'set null' }),
  taskId: bigint('task_id', { mode: 'number' }).references(() => generationTask.id, { onDelete: 'set null' }),
  agentName: varchar('agent_name', { length: 50 }),
  action: varchar('action', { length: 100 }),
  detail: jsonb('detail'),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 管线检查点表（架构升级 Epic1：节点化+断点续跑，每步骤状态/产出/token 用量） */
export const pipelineCheckpoint = pgTable('pipeline_checkpoint', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** 关联生成任务（后验更新独立工作流手动触发时可为空） */
  taskId: bigint('task_id', { mode: 'number' }).references(() => generationTask.id, { onDelete: 'cascade' }),
  /** 步骤标识（如 step3_writer / post_state_extract） */
  stepName: varchar('step_name', { length: 64 }).notNull(),
  /** 步骤序号（重试时按此定位首个未完成步骤） */
  stepOrder: integer('step_order').notNull().default(0),
  /** 该步骤产出数据（断点续跑恢复用，如正文/审计报告） */
  stepData: jsonb('step_data'),
  /** pending/running/completed/failed/skipped */
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  tokenInput: integer('token_input').notNull().default(0),
  tokenOutput: integer('token_output').notNull().default(0),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================================
// 场景脚本（Scene Script，原"场景小纲"）扩展表
// ============================================================

/** 去AI味豁免词表（开源借鉴PRD M1：项目级 whitelist，命中 pattern 的表达不判 blocking） */
export const deslopWhitelist = pgTable('deslop_whitelist', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 豁免的词/句式（子串匹配命中原文即豁免） */
  pattern: text('pattern').notNull(),
  /** 豁免理由 */
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

/** 场景节点主表 - 承载7类核心要素，归属卷大纲 */
export const sceneNode = pgTable('scene_node', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  outlineId: bigint('outline_id', { mode: 'number' }).notNull().references(() => storyOutline.id, { onDelete: 'cascade' }),
  /** 排序权重，越小越靠前 */
  sortOrder: integer('sort_order').notNull().default(0),
  /** 场景标题 */
  title: text('title').notNull(),
  /** 时间描述（如"三日后黄昏"） */
  timeSetting: text('time_setting'),
  /** 地点描述（关联诛仙库地点ID存于 scene_node_element） */
  locationDesc: text('location_desc'),
  /** 核心事件 */
  coreEvent: text('core_event'),
  /** 作用与结果 */
  effectAndResult: text('effect_and_result'),
  /** 伏笔关联说明 */
  foreshadowingNote: text('foreshadowing_note'),
  /** 场景类型: key(关键剧情) / transition(过渡) / foreshadow(伏笔) */
  sceneType: varchar('scene_type', { length: 20 }).notNull().default('transition'),
  /** 重点剧情标记: true=重点 */
  isKeyPlot: boolean('is_key_plot').notNull().default(false),
  /** AI生成状态: manual / generated / refined */
  aiStatus: varchar('ai_status', { length: 20 }).default('manual'),
  // === 施工卡增强字段（需求3） ===
  /** 核心节拍：这一场必须发生的一件事 */
  coreBeat: text('core_beat'),
  /** 状态变化：出场状态→结束状态（人物/情绪/认知/物品） */
  stateChange: jsonb('state_change').default({}),
  /** 场景钩子类型：suspense/emotion/turn/crisis/reveal */
  sceneHookType: varchar('scene_hook_type', { length: 20 }),
  /** 节奏锚点位置：opening/midpoint/closing */
  rhythmAnchor: varchar('rhythm_anchor', { length: 20 }),
  /** 桥段指纹：faceoff/puzzle/showcase/dialogue/relation/daily/upgrade */
  scenePlotFingerprint: varchar('scene_plot_fingerprint', { length: 30 }),
  /** 中段回报预埋：本场景埋下什么后续回报的种子 */
  payoffSetup: text('payoff_setup'),
  // === PRD-B薄增量：规划期分支三字段（对齐章节级 chapter_branch_option，不新建边表） ===
  /** 节点类型: linear(线性主线) / branch_point(分支点)，暂不做 merge_point */
  nodeType: varchar('node_type', { length: 20 }).notNull().default('linear'),
  /** 分支组ID：同一分支点下的多条预备路径共享此标识 */
  branchGroupId: varchar('branch_group_id', { length: 60 }),
  /** 路径标签：分支组内本节点所属路径的显示名（如"A线·隐忍"） */
  pathLabel: varchar('path_label', { length: 60 }),
  /** 扩展元数据 */
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 场景-人物关联表 - 多对多，区分出场类型 */
export const sceneNodeCharacter = pgTable('scene_node_character', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  sceneNodeId: bigint('scene_node_id', { mode: 'number' }).notNull().references(() => sceneNode.id, { onDelete: 'cascade' }),
  /** 诛仙库人物ID (novel_character_lib.char_id) */
  characterId: bigint('character_id', { mode: 'number' }).notNull(),
  /** 出场类型: protagonist(主角) / core_support(核心配角) / mention(提及) */
  appearanceType: varchar('appearance_type', { length: 20 }).notNull().default('core_support'),
  /** 本场景中的人物行为/状态备注 */
  roleNote: text('role_note'),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 场景-世界观要素关联表 - 统一管理地点/功法/法宝/妖兽 */
export const sceneNodeElement = pgTable('scene_node_element', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  sceneNodeId: bigint('scene_node_id', { mode: 'number' }).notNull().references(() => sceneNode.id, { onDelete: 'cascade' }),
  /** 要素类型: location / skill / item / monster / foreshadow_template */
  elementType: varchar('element_type', { length: 30 }).notNull(),
  /** 要素ID：element_source=native 时为诛仙库对应表主键，=custom 时为创作库自定义表主键 */
  elementId: bigint('element_id', { mode: 'number' }).notNull(),
  /** 要素来源: native(诛仙库原生) / custom(创作库自定义)，默认 native */
  elementSource: varchar('element_source', { length: 16 }).notNull().default('native'),
  /** 要素在本场景中的作用说明 */
  elementNote: text('element_note'),
  /** 伏笔方向: plant(埋设) / payoff(回收)，仅 foreshadow_template 类型使用 */
  foreshadowDirection: varchar('foreshadow_direction', { length: 10 }),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 节点间关系表 - 存储连线（因果/顺承/伏笔呼应） */
export const sceneNodeRelation = pgTable('scene_node_relation', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** 源节点 */
  sourceNodeId: bigint('source_node_id', { mode: 'number' }).notNull().references(() => sceneNode.id, { onDelete: 'cascade' }),
  /** 目标节点 */
  targetNodeId: bigint('target_node_id', { mode: 'number' }).notNull().references(() => sceneNode.id, { onDelete: 'cascade' }),
  /** 关系类型: causal(因果) / sequential(顺承) / foreshadow_echo(伏笔呼应) */
  relationType: varchar('relation_type', { length: 20 }).notNull().default('sequential'),
  /** 关系说明 */
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 场景脚本对话修改日志 - 记录自然语言指令与数据快照，支持版本回滚 */
export const sceneEditLog = pgTable('scene_edit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  outlineId: bigint('outline_id', { mode: 'number' }).notNull().references(() => storyOutline.id, { onDelete: 'cascade' }),
  /** 用户原始指令 */
  userInstruction: text('user_instruction').notNull(),
  /** AI解析后的结构化修改方案 */
  parsedPlan: jsonb('parsed_plan'),
  /** 修改前数据快照 */
  snapshotBefore: jsonb('snapshot_before'),
  /** 修改后数据快照 */
  snapshotAfter: jsonb('snapshot_after'),
  /** 应用状态: pending(待确认) / applied(已应用) / rolled_back(已回滚) */
  applyStatus: varchar('apply_status', { length: 20 }).notNull().default('pending'),
  /** 操作类型: add_node / delete_node / modify_field / reorder / add_relation / polish */
  operationType: varchar('operation_type', { length: 30 }),
  createdAt: timestamp('created_at').defaultNow(),
  appliedAt: timestamp('applied_at'),
});

// ============================================================
// 全局状态追踪（State Tracking）扩展表
// ============================================================

/** 人物状态快照表 - 按章记录人物的位置/修为/伤势/心境/持有物品
 *  v1.4 第三期：LLM 抽取结果自动生效（auto_confirmed，低置信）用户可否决，confirmed+auto_confirmed 进上下文 */
export const characterStateSnapshot = pgTable('character_state_snapshot', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 诛仙库人物ID（novel_character_lib.char_id），无法解析时可为空 */
  characterId: bigint('character_id', { mode: 'number' }),
  /** 人物名（冗余存储，便于展示与注入，避免跨库 join） */
  characterName: text('character_name'),
  volumeNo: integer('volume_no'),
  /** 状态所属章节号；0 表示卷首/初始引导快照 */
  chapterNo: integer('chapter_no').notNull().default(0),
  /** 当前位置 */
  location: text('location'),
  /** 修为境界 */
  realm: text('realm'),
  /** 伤势状况 */
  injury: text('injury'),
  /** 心境/心理状态 */
  mentalState: text('mental_state'),
  /** 持有物品（字符串数组） */
  possessedItems: jsonb('possessed_items').default([]),
  /** 其他补充状态 */
  extraState: jsonb('extra_state').default({}),
  /** 确认状态: pending(待确认) / confirmed(已确认) / auto_confirmed(自动生效可否决) / rejected(已否决) */
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  /** 来源: bootstrap(引导) / extracted(LLM提取) / manual(手工) */
  source: varchar('source', { length: 20 }).notNull().default('manual'),
  /** 产生该快照的生成任务ID（提取来源时记录） */
  taskId: bigint('task_id', { mode: 'number' }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 全局时间线里程碑表 - 记录贯穿全书的关键事件与故事时间 */
export const timelineMilestone = pgTable('timeline_milestone', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  volumeNo: integer('volume_no'),
  /** 里程碑发生章节号；0 表示卷首之前 */
  chapterNo: integer('chapter_no').notNull().default(0),
  /** 故事内时间描述（如"三日后黄昏""七脉会武次日"） */
  storyTime: text('story_time'),
  /** 里程碑标题 */
  title: text('title').notNull(),
  /** 里程碑描述 */
  description: text('description'),
  /** 重要程度: key(关键) / normal(普通) */
  importance: varchar('importance', { length: 20 }).default('normal'),
  /** 确认状态: pending(待确认) / confirmed(已确认) / auto_confirmed(自动生效可否决) / rejected(已否决) */
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  /** 来源: bootstrap(引导) / extracted(LLM提取) / manual(手工) */
  source: varchar('source', { length: 20 }).notNull().default('manual'),
  taskId: bigint('task_id', { mode: 'number' }),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 伏笔台账表 - 以"伏笔线"为粒度的全局生命周期追踪（防埋多忘多） */
export const foreshadowThread = pgTable('foreshadow_thread', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 伏笔名称 */
  title: text('title').notNull(),
  /** 伏笔描述（埋了什么、预期如何回收） */
  description: text('description'),
  /** 伏笔线索（模块2）：埋设时留给后文回收的暗示线索 */
  hintClue: text('hint_clue'),
  /** 状态: pending(待埋入) / planted(已埋设) / resolved(已回收) / abandoned(已废弃) */
  status: varchar('status', { length: 20 }).notNull().default('planted'),
  /** 优先级: high(高) / normal(中) / low(低) */
  priority: varchar('priority', { length: 10 }).notNull().default('normal'),
  /** 埋设章节号 */
  plantChapter: integer('plant_chapter'),
  /** 计划/实际回收章节号 */
  resolveChapter: integer('resolve_chapter'),
  /** 关联场景节点ID数组（jsonb number[]） */
  sceneIds: jsonb('scene_ids').default([]),
  /** 来源场景节点ID（从某节点 foreshadowing_note 提升而来时记录） */
  sourceSceneId: bigint('source_scene_id', { mode: 'number' }),
  /** 伏笔分级（天命P0#1）：t1战略级/t2战役级/t3普通 */
  tier: varchar('tier', { length: 10 }).default('t3'),
  /** 载体DNA（天命P0#3）：主体（角色/实体） */
  dnaSubject: varchar('dna_subject', { length: 100 }),
  /** 载体DNA：动作（发现/获得/失去/背叛...） */
  dnaAction: varchar('dna_action', { length: 50 }),
  /** 载体DNA：客体（物品/秘密/人物...） */
  dnaObject: varchar('dna_object', { length: 100 }),
  /** 载体DNA：核心情绪（悬念/震惊/悲伤...） */
  dnaEmotion: varchar('dna_emotion', { length: 50 }),
  /** 作者手动绑定的伏笔手法素材ID（A2，引用 plot_material_foreshadow.id，写作时强制取用） */
  referencedMaterialId: bigint('referenced_material_id', { mode: 'number' }),
  /** 来源类型（分支衍生体系）：manual手动创建 / scene场景提升 / branch分支衍生 */
  sourceType: varchar('source_type', { length: 20 }).notNull().default('manual'),
  /** 来源分支选项ID（仅 source_type='branch' 时有值，关联 chapter_branch_option.id） */
  sourceBranchOptionId: bigint('source_branch_option_id', { mode: 'number' }),
  /** 是否已确认生效（分支衍生默认 false，确认后才会注入写作上下文） */
  isConfirmed: boolean('is_confirmed').notNull().default(true),
  /** 回填方式（分支衍生体系）：anchor锚点回填 / revise修订回填 */
  backfillMethod: varchar('backfill_method', { length: 20 }),
  /** 回填目标章节计划ID（关联 chapter_plan.id） */
  backfillTargetChapterId: bigint('backfill_target_chapter_id', { mode: 'number' }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 任务链台账表 - 以"任务"为粒度的跨章状态机追踪（active→progressing→completed/failed/abandoned），与伏笔台账同级 */
export const taskArc = pgTable('task_arc', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 任务标题 */
  title: text('title').notNull(),
  /** 任务描述（要达成什么、为何重要） */
  description: text('description'),
  /** 进度线索：推进/完成判定用的关键词，正文出现该子串视为任务被推进 */
  progressClue: text('progress_clue'),
  /** 状态: active(待推进) / progressing(推进中) / completed(已完成) / failed(已失败) / abandoned(已废弃) */
  status: varchar('status', { length: 16 }).notNull().default('active'),
  /** 优先级: high(高) / normal(中) / low(低) */
  priority: varchar('priority', { length: 8 }).notNull().default('normal'),
  /** 任务分级: t1战略级 / t2战役级 / t3普通 */
  tier: varchar('tier', { length: 4 }).notNull().default('t3'),
  /** 任务类型: main(主线) / side(支线) / hidden(隐藏) / fortune(机缘)（13-SRS US-21a，手动创建可为空） */
  taskType: varchar('task_type', { length: 12 }),
  /** 任务开始章节号 */
  startChapter: integer('start_chapter'),
  /** 目标/计划完成章节号 */
  targetChapter: integer('target_chapter'),
  /** 关联剧情素材ID数组（jsonb number[]，引用 plot_material_* 系列） */
  referencedMaterialIds: jsonb('referenced_material_ids').default([]),
  /** 关联角色ID数组（jsonb number[]） */
  relatedCharacterIds: jsonb('related_character_ids').default([]),
  /** 来源类型: manual(手动创建) / scene(场景提升) / branch(分支衍生) / auto(章节自动提取，13-SRS US-21a) */
  sourceType: varchar('source_type', { length: 10 }).notNull().default('manual'),
  /** 是否已确认生效（确认后才会注入写作上下文） */
  isConfirmed: boolean('is_confirmed').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================================
// 交互式剧情抉择系统（Interactive Story Decision）扩展表
// ============================================================

/** 章间分支选项表 - 某章生成完成后由 BranchGeneratorAgent 产出的"下一章走向选项"
 *  玩家选定其一后，据此衍生出下一章计划（chapter_plan.branch_source_option_id 回指本表） */
export const chapterBranchOption = pgTable('chapter_branch_option', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 产生本选项的来源章节计划ID（该章生成完成后产出分支） */
  sourceChapterPlanId: bigint('source_chapter_plan_id', { mode: 'number' }).notNull().references(() => chapterPlan.id, { onDelete: 'cascade' }),
  /** 选项标题（简短概括走向，如"追查黑衣人"） */
  optionTitle: varchar('option_title', { length: 200 }).notNull(),
  /** 选项描述（走向说明，给玩家看的剧情预览） */
  optionDescription: text('option_description').notNull(),
  /** 选定后预设的下一章核心意图（写入衍生章节计划的 intent） */
  nextChapterIntent: text('next_chapter_intent').notNull(),
  /** 下一章场景提示（结构化，写入衍生章节计划的 scene_breakdown） */
  nextSceneHint: jsonb('next_scene_hint').default({}),
  /** 影响标签（如["黑化线","失去挚友"]），沿分支链累积形成历史栈 */
  impactTags: jsonb('impact_tags').default([]),
  /** 分支类型：normal=常规走向 / encounter=奇遇走向（借鉴奇遇素材库产出） */
  optionType: varchar('option_type', { length: 20 }).default('normal'),
  /** 本选项借鉴的剧情素材引用数组：[{table, id, title, label}]，table∈{plot_material_encounter/foreshadow/highlight/task} */
  sourceMaterials: jsonb('source_materials').default([]),
  /** 主方向编码（方向体系，如 growth_realm），存量数据为 NULL 时前端展示"未分类" */
  mainDirection: varchar('main_direction', { length: 32 }),
  /** 次方向编码数组（方向体系，最多2个，如 ["item_magic","relation_up"]） */
  secondaryDirections: jsonb('secondary_directions'),
  /** 方向匹配度评分 0-100（LLM 对分支内容与指定方向契合度的自评） */
  directionMatchScore: integer('direction_match_score'),
  /** 是否被玩家选定（同一来源章仅一个为 true） */
  isSelected: boolean('is_selected').notNull().default(false),
  /** 分支核心假设（动态叙事引擎）：如"如果硬闯山门会怎样" */
  branchPremise: text('branch_premise'),
  /** 预计分支弧章节数（动态叙事引擎）：默认 2，硬性上限 5（可一次性豁免+2） */
  estimatedLength: integer('estimated_length').default(2),
  /** 分支核心冲突描述（动态叙事引擎） */
  coreConflict: text('core_conflict'),
  /** 汇合目标里程碑（动态叙事引擎）：关联 narrative_milestone.id */
  convergeToMilestoneId: bigint('converge_to_milestone_id', { mode: 'number' }),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 叙事里程碑表（动态叙事引擎）——故事的骨架：不绑定具体章节号的关键事件锚点。
 *  与 timeline_milestone 共存各管各的：timeline 管世界时间线（绑 chapterNo），本表管叙事结构 */
export const narrativeMilestone = pgTable('narrative_milestone', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 来源卷大纲（从 keyEvents 提取时回指），手动创建可空 */
  outlineId: bigint('outline_id', { mode: 'number' }).references(() => storyOutline.id, { onDelete: 'set null' }),
  /** 里程碑标签（如"初入青云""七脉会武"） */
  label: varchar('label', { length: 200 }).notNull(),
  /** 里程碑核心事件描述 */
  description: text('description'),
  /** 必须发生的具体情节数组（不可省略） */
  mustHappen: jsonb('must_happen').default([]),
  /** 必须在场的人物 ID 数组 */
  keyCharacterIds: bigint('key_character_ids', { mode: 'number' }).array().default([]),
  /** 预计章节范围起点（仅预估，不硬绑定） */
  targetChapterFrom: integer('target_chapter_from'),
  /** 预计章节范围终点 */
  targetChapterTo: integer('target_chapter_to'),
  /** 状态：upcoming(未到达) / active(进行中) / reached(已到达) / skipped(已跳过) */
  status: varchar('status', { length: 20 }).default('upcoming'),
  /** 重要度：critical(必须到达) / major(建议到达) / minor(可选) */
  importance: varchar('importance', { length: 20 }).default('major'),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 分支弧表（动态叙事引擎）——选择的血肉：选中分支后开启的完整小故事弧（开头-发展-高潮-汇合） */
export const branchArc = pgTable('branch_arc', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 从哪章分出（chapter_plan.id） */
  sourceChapterId: bigint('source_chapter_id', { mode: 'number' }),
  /** 在哪个里程碑之后分出 */
  sourceMilestoneId: bigint('source_milestone_id', { mode: 'number' }),
  /** 分支弧标题 */
  title: varchar('title', { length: 200 }).notNull(),
  /** 分支核心假设（"如果硬闯山门会怎样"） */
  premise: text('premise'),
  /** 分支类型：approach/detour/consequence/divergence */
  branchType: varchar('branch_type', { length: 20 }).default('approach'),
  /** 预计章节数（默认 2，硬性上限 5，可一次性豁免+2） */
  estimatedLength: integer('estimated_length').default(2),
  /** 状态：active(进行中) / converged(已汇合) / abandoned(已废弃) */
  status: varchar('status', { length: 20 }).default('active'),
  /** 最终要汇合到的里程碑（narrative_milestone.id） */
  convergeToMilestoneId: bigint('converge_to_milestone_id', { mode: 'number' }),
  /** 汇合时的章节号 */
  convergedAtChapter: bigint('converged_at_chapter', { mode: 'number' }),
  /** 分支弧内产生的新元素：{characters:[], locations:[], foreshadows:[], items:[]} */
  newElements: jsonb('new_elements').default({}),
  /** 分支开始时的状态快照（用于对比/回滚） */
  stateSnapshot: jsonb('state_snapshot'),
  createdAt: timestamp('created_at').defaultNow(),
});

/** chapterPlan 重写审计日志（动态叙事引擎）——汇合引擎全自动重写后续计划时记录 before/after，支持回滚 */
export const planRewriteLog = pgTable('plan_rewrite_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 触发重写的分支弧（可空） */
  branchArcId: bigint('branch_arc_id', { mode: 'number' }).references(() => branchArc.id, { onDelete: 'set null' }),
  /** 重发动作：convergence(汇合重写) 等 */
  action: varchar('action', { length: 20 }).notNull().default('convergence'),
  /** 被重写的 chapter_plan.id */
  planId: bigint('plan_id', { mode: 'number' }).notNull(),
  /** 重写前快照 */
  beforeSnapshot: jsonb('before_snapshot').notNull(),
  /** 重写后快照 */
  afterSnapshot: jsonb('after_snapshot').notNull(),
  /** 是否已回滚 */
  rolledBack: boolean('rolled_back').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 文风校验记录表（需求13） */
export const styleAuditRecord = pgTable('style_audit_record', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 关联章节计划ID（章节稳定身份，跨版本不变） */
  chapterPlanId: bigint('chapter_plan_id', { mode: 'number' }).notNull().references(() => chapterPlan.id, { onDelete: 'cascade' }),
  /** 关联生成任务ID（如从生成流程触发，可空） */
  generationTaskId: bigint('generation_task_id', { mode: 'number' }),
  /** 校验时的文风引擎配置快照（StyleContext，用于历史追溯） */
  configSnapshot: jsonb('config_snapshot').notNull(),
  /** 综合文风得分（百分制） */
  overallScore: integer('overall_score').notNull(),
  /** 各维度分项得分（jsonb，键为维度名） */
  dimensionScores: jsonb('dimension_scores').notNull(),
  /** 问题列表（StyleIssue[]，含 dimension/severity/description/suggestion/excerpt） */
  issues: jsonb('issues').notNull(),
  /** 问题总数量 */
  issueCount: integer('issue_count').notNull(),
  /** 状态：completed / failed */
  status: varchar('status', { length: 20 }).notNull().default('completed'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============================================================
// 体验增强·第二批（模块3/8/11）扩展表
// ============================================================

/** 人物成长弧光卡点表（模块3）- 项目级，为核心人物设定分阶段成长节点
 *  character_id 引用诛仙库人物ID（只读，不建外键）；生成时按章节号匹配阶段注入特质 */
export const characterGrowthStage = pgTable('character_growth_stage', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 诛仙库人物ID（只读引用） */
  characterId: bigint('character_id', { mode: 'number' }),
  /** 冗余人物名（兜底展示） */
  characterName: text('character_name'),
  /** 阶段序号 */
  stageNo: integer('stage_no').notNull().default(1),
  /** 阶段名（如"少年自卑期"） */
  name: text('name').notNull(),
  /** 章节区间起 */
  chapterStart: integer('chapter_start'),
  /** 章节区间止 */
  chapterEnd: integer('chapter_end'),
  /** 阶段特质数组（jsonb string[]） */
  traits: jsonb('traits').default([]),
  /** 阶段描述 */
  description: text('description'),
  /** 阶段类型（B2）：境界突破/心境转变/能力觉醒/关系升华 */
  stageType: varchar('stage_type', { length: 20 }),
  /** 是否为作者标记的关键节点（B2，命中即强制召回高光素材） */
  isKeyNode: boolean('is_key_node').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 自定义人物关系表（模块8）- 关系动态推演结果，不修改原生 lib_character_relation
 *  char_a_id/char_b_id 引用诛仙库人物ID（只读，不建外键）；RAG 检索优先级高于原生关系 */
export const customCharacterRelation = pgTable('custom_character_relation', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  charAId: bigint('char_a_id', { mode: 'number' }).notNull(),
  charBId: bigint('char_b_id', { mode: 'number' }).notNull(),
  /** 关系类型（如"仇敌""挚友""师徒"） */
  relType: text('rel_type'),
  /** 关系强度等级 */
  relLevel: integer('rel_level').default(0),
  /** 关系描述 */
  description: text('description'),
  /** 互动模式 */
  interactPattern: text('interact_pattern'),
  /** 触发关系变化的事件 */
  sourceEvent: text('source_event'),
  /** 是否生效 */
  isActive: boolean('is_active').notNull().default(true),
  /** 实体类型：character(默认char↔char) / weapon_bond(char↔weapon)（7.31） */
  entityType: varchar('entity_type', { length: 20 }).notNull().default('character'),
  /** 武器ID（entity_type='weapon_bond'时填写，charBId存人物ID） */
  weaponId: bigint('weapon_id', { mode: 'number' }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 项目金句/名场面素材库表（模块11）- 章节生成后自动提取归档
 *  character_id 引用诛仙库人物ID（可空，名场面无特定人物） */
export const projectQuoteLib = pgTable('project_quote_lib', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 来源章节（generated_chapter.id） */
  chapterId: bigint('chapter_id', { mode: 'number' }),
  /** 诛仙库人物ID（可空） */
  characterId: bigint('character_id', { mode: 'number' }),
  /** 冗余人物名 */
  characterName: text('character_name'),
  /** 金句/名场面文本 */
  quoteText: text('quote_text').notNull(),
  /** 名场面描述 */
  sceneDesc: text('scene_desc'),
  /** 质量分（总分，与scores.total一致） */
  qualityScore: integer('quality_score'),
  /** 原始文本（美化前，回写正文时定位原句） */
  originalText: text('original_text'),
  /** 当前选中的美化版本（推荐版） */
  polishedText: text('polished_text'),
  /** 3个美化版本 [{style,text,note}] style=conservative/balanced/deep */
  polishedVersions: jsonb('polished_versions').default([]),
  /** 五维评分 {imagery,rhythm,philosophy,emotion,viral,total} 各20分 */
  scores: jsonb('scores').default({}),
  /** 质量分级：legendary传世级(≥90)/good精品级(80-89)/candidate待打磨(70-79) */
  grade: varchar('grade', { length: 16 }).default('good'),
  /** 美化状态：none未处理/polished已美化/applied已应用正文 */
  polishStatus: varchar('polish_status', { length: 16 }).default('none'),
  /** 应用到正文的时间 */
  appliedAt: timestamp('applied_at'),
  /** 是否收藏 */
  isCollected: boolean('is_collected').notNull().default(false),
  /** 来源：auto=章节生成自动提取 / manual=手动录入 / import=批量导入 */
  sourceType: varchar('source_type', { length: 20 }).notNull().default('auto'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============ 模块9：功法/法宝成长工坊 ============

/** 自定义功法库（模块9）- 项目级自定义功法，支持融合/变异/强化/进化四大成长路径
 *  grade 品级：凡造/灵淬/宝胎/道纹/仙蜕/神蕴；grade_level 品级内层数 1-3（初期/中期/巅峰）
 *  effects jsonb: [{name, type(element|spacetime|soul|body|curse|domain), rarity(normal|rare|legendary), description, strength}] */
export const customSkillLib = pgTable('custom_skill_lib', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** 品级：凡造/灵淬/宝胎/道纹/仙蜕/神蕴 */
  grade: varchar('grade', { length: 20 }).notNull().default('凡造'),
  /** 品级内层数 1-3（初期/中期/巅峰） */
  gradeLevel: integer('grade_level').notNull().default(1),
  /** 功法类型（攻击/防御/辅助/身法/心法等） */
  skillType: varchar('skill_type', { length: 50 }),
  /** 核心效果描述 */
  coreEffect: text('core_effect'),
  /** 特效列表 jsonb [{name, type, rarity, description, strength}] */
  effects: jsonb('effects').notNull().default([]),
  /** 副作用/反噬描述 */
  sideEffects: text('side_effects'),
  /** 功法简介 */
  description: text('description'),
  /** 成长来源：base/fusion/mutation/upgrade/evolution */
  growthType: varchar('growth_type', { length: 20 }).notNull().default('base'),
  /** 基础原型ID（追溯最初来源，可指向诛仙库novel_skill_lib.id或本表id） */
  baseEntityId: bigint('base_entity_id', { mode: 'number' }),
  /** 来源实体ID数组（融合/变异/进化溯源） */
  sourceEntityIds: jsonb('source_entity_ids').default([]),
  /** 进化阶段标记（觉醒/化境/圆满等） */
  evolutionStage: varchar('evolution_stage', { length: 30 }),
  /** 是否为进化形态 */
  isEvolved: boolean('is_evolved').notNull().default(false),
  /** 关联人物ID数组（诛仙库人物ID） */
  linkedCharacterIds: jsonb('linked_character_ids').default([]),
  /** 突破叙事片段（融合/进化时生成的300-500字场景，供写作引用） */
  breakthroughNarrative: text('breakthrough_narrative'),
  /** 软删除 */
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 自定义法宝库（模块9）- 结构与 custom_skill_lib 对称 */
export const customMagicItemLib = pgTable('custom_magic_item_lib', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** 品级：凡造/灵淬/宝胎/道纹/仙蜕/神蕴 */
  grade: varchar('grade', { length: 20 }).notNull().default('凡造'),
  /** 品级内层数 1-3 */
  gradeLevel: integer('grade_level').notNull().default(1),
  /** 法宝类型（攻击/防御/辅助/飞行/储物等） */
  itemType: varchar('item_type', { length: 50 }),
  /** 核心能力描述 */
  coreAbilities: text('core_abilities'),
  /** 特效列表 jsonb [{name, type, rarity, description, strength}] */
  effects: jsonb('effects').notNull().default([]),
  /** 副作用/反噬描述 */
  sideEffects: text('side_effects'),
  /** 法宝简介 */
  description: text('description'),
  /** 成长来源：base/fusion/mutation/upgrade/evolution */
  growthType: varchar('growth_type', { length: 20 }).notNull().default('base'),
  /** 基础原型ID */
  baseEntityId: bigint('base_entity_id', { mode: 'number' }),
  /** 来源实体ID数组 */
  sourceEntityIds: jsonb('source_entity_ids').default([]),
  /** 进化阶段标记 */
  evolutionStage: varchar('evolution_stage', { length: 30 }),
  /** 是否为进化形态 */
  isEvolved: boolean('is_evolved').notNull().default(false),
  /** 关联人物ID数组 */
  linkedCharacterIds: jsonb('linked_character_ids').default([]),
  /** 突破叙事片段（融合/进化时生成的300-500字场景，供写作引用） */
  breakthroughNarrative: text('breakthrough_narrative'),
  /** 软删除 */
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 实体成长操作记录表（模块9）- 全量追溯所有成长操作，支持一键回退 */
export const entityGrowthRecord = pgTable('entity_growth_record', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 实体类型：skill / magic_item */
  entityType: varchar('entity_type', { length: 20 }).notNull(),
  /** 目标实体ID（custom_skill_lib.id 或 custom_magic_item_lib.id） */
  entityId: bigint('entity_id', { mode: 'number' }).notNull(),
  /** 操作类型：fusion/mutation/upgrade/evolution */
  operationType: varchar('operation_type', { length: 20 }).notNull(),
  /** 参与操作的源实体ID列表 jsonb number[] */
  sourceEntityIds: jsonb('source_entity_ids').default([]),
  /** 操作前实体完整数据快照 */
  beforeSnapshot: jsonb('before_snapshot').notNull(),
  /** 操作后实体完整数据快照 */
  afterSnapshot: jsonb('after_snapshot').notNull(),
  /** 结果：success/fail */
  result: varchar('result', { length: 20 }).notNull(),
  /** 操作备注 */
  operatorNote: text('operator_note'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============ 自定义武器模块 ============

/** 自定义武器表 - 项目级自定义小说武器，3步点选+随机创建，接入素材池合流与一致性审计。
 *  grade 底蕴层级：凡造/灵淬/宝胎/道纹/仙蜕/神蕴（6档）；fake_grade 为敛藏锋芒的伪装底蕴。
 *  四类特质均为 jsonb 字符串数组（存词条ID，详情由 weapon-catalog 解析）：
 *  forge_traits 胎体改锻 / soak_traits 灵质浸养 / attach_traits 外附加持 / cavity_traits 窍藏内嵌。
 *  成长工坊接入字段（growth_type/base_entity_id/source_entity_ids/linked_character_ids 等）
 *  与 custom_skill_lib/custom_magic_item_lib 对齐，使武器可接入融合/变异/强化/进化养成体系。 */
export const customWeapon = pgTable('custom_weapon', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 武器名号 */
  name: varchar('name', { length: 32 }).notNull(),
  /** 武器门类ID（martial/taoist/demonic/strange/array） */
  category: varchar('category', { length: 32 }).notNull(),
  /** 细分形制ID */
  type: varchar('type', { length: 32 }).notNull(),
  /** 真实底蕴层级：凡造/灵淬/宝胎/道纹/仙蜕/神蕴 */
  grade: varchar('grade', { length: 16 }).notNull().default('凡造'),
  /** 底蕴内层数 1-3（初期/中期/巅峰），用于强化/进化养成机制 */
  gradeLevel: integer('grade_level').notNull().default(1),
  /** 对外伪装底蕴（敛藏锋芒用，null 表示不伪装） */
  fakeGrade: varchar('fake_grade', { length: 16 }),
  /** 基础材质ID */
  baseMaterial: varchar('base_material', { length: 32 }).notNull(),
  /** 胎体改锻特质ID数组（结构永久特质） */
  forgeTraits: jsonb('forge_traits').notNull().default([]),
  /** 灵质浸养特质ID数组（属性永久特质） */
  soakTraits: jsonb('soak_traits').notNull().default([]),
  /** 外附加持特质ID数组（临时可替换） */
  attachTraits: jsonb('attach_traits').notNull().default([]),
  /** 窍藏内嵌特质ID数组（触发式隐藏特质） */
  cavityTraits: jsonb('cavity_traits').notNull().default([]),
  /** 本命祭炼层级：none/soul_mark/blood_merge/dao_resonance */
  soulRefineLevel: varchar('soul_refine_level', { length: 16 }).notNull().default('none'),
  /** 核心方向标签数组（根据门类形制自动生成） */
  coreDirection: jsonb('core_direction').notNull().default([]),
  /** 成长来源：base/fusion/mutation/upgrade/evolution */
  growthType: varchar('growth_type', { length: 20 }).notNull().default('base'),
  /** 基础原型ID（追溯最初来源） */
  baseEntityId: bigint('base_entity_id', { mode: 'number' }),
  /** 来源实体ID数组（融合/变异/进化溯源） */
  sourceEntityIds: jsonb('source_entity_ids').default([]),
  /** 进化阶段标记 */
  evolutionStage: varchar('evolution_stage', { length: 30 }),
  /** 是否为进化形态 */
  isEvolved: boolean('is_evolved').notNull().default(false),
  /** 关联人物ID数组（诛仙库人物ID，生成时按此注入） */
  linkedCharacterIds: jsonb('linked_character_ids').default([]),
  /** 突破叙事片段（养成时生成，供写作引用） */
  breakthroughNarrative: text('breakthrough_narrative'),
  /** 用户选中的方向（按四类特质分组 {forge:{blade:[],weight:[]...}, infuse:{...}, ...}） */
  selectedDirections: jsonb('selected_directions').notNull().default({}),
  /** 系统生成的具体特质数组 [{id,type,name,desc,isRare,flaw,sourceDirections,isClassic,classicId}] */
  generatedTraits: jsonb('generated_traits').notNull().default([]),
  /** 器性（刚直肃杀/跳脱嗜酒/慵懒怕事/邪性嗜血/古板守旧/傲娇嘴硬/胆小怕疼/痴念深重） */
  temperament: varchar('temperament', { length: 16 }),
  /** 前尘类型（名将战陨/情人殉情/高人坐化/匠人遗作/邪人祭炼/天生地养） */
  pastType: varchar('past_type', { length: 16 }),
  /** 专属忌讳数组 */
  taboos: jsonb('taboos').notNull().default([]),
  /** 反差感模式开关 */
  reverseMode: boolean('reverse_mode').notNull().default(false),
  /** 引用来源（世界观法宝快照）：{type, id, name, bookId} */
  sourceRef: jsonb('source_ref'),
  /** 实体状态：official=用户正式创建 / draft=AI自动提取待补充（09-自定义实体自动维护） */
  entityStatus: varchar('entity_status', { length: 16 }).notNull().default('official'),
  /** 章节动态数组 [{chapterNo, volumeNo, updateText, category, extractedAt}]（自动追踪追加） */
  chapterUpdates: jsonb('chapter_updates').notNull().default([]),
  /** 软删除 */
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 武器文案表（文案生成Skill产出：名号/化名/简介/招式，一对多可存多版本） */
export const weaponLore = pgTable('weapon_lore', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 所属武器ID */
  weaponId: bigint('weapon_id', { mode: 'number' }).notNull().references(() => customWeapon.id, { onDelete: 'cascade' }),
  /** 生成名号 */
  name: varchar('name', { length: 32 }).notNull(),
  /** 对外化名（敛藏锋芒用，null 表示无） */
  fakeName: varchar('fake_name', { length: 32 }),
  /** 一句话简介 */
  intro: text('intro').notNull(),
  /** 配套招式数组 [{name, desc}] */
  moves: jsonb('moves').notNull().default([]),
  /** 五感卡·真本事（特质串成的画面感描写） */
  realSkill: text('real_skill'),
  /** 五感卡·怪毛病（核心记忆点，接地气小毛病） */
  weirdTrait: text('weird_trait'),
  /** 五感卡·前尘影事（可当伏笔的具体小细节） */
  pastMemory: text('past_memory'),
  /** 五感卡·江湖外号 */
  jianghuNickname: varchar('jianghu_nickname', { length: 64 }),
  /** 五感卡·江湖黑话 */
  jianghuHeihua: text('jianghu_heihua'),
  /** 五感卡·专属规矩 */
  rules: text('rules'),
  /** 五感卡·剧情钩子数组 [{type,title,content}] */
  hooks: jsonb('hooks').notNull().default([]),
  /** 五感卡·名场面草稿数组 [{type,content}] */
  famousScenes: jsonb('famous_scenes').notNull().default([]),
  /** 器灵设定（方向组合式特质系统扩展 7.31） */
  spirit: text('spirit'),
  /** 当前生效版本 */
  isCurrent: boolean('is_current').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================================
// 分支影响体系（需求：分支影响体系）
// 设计决策：独立数值表 + 单一权威（影响快照为数值状态唯一权威来源）。
// 关系影响快照（relation_impact_snapshot）与因果链表（causal_chain）
// 与现有机制重叠，按评审决策延后至阶段4（扩展现有表）。
// ============================================================

/** 影响定义表（系统白名单：所有可用影响项的元数据，支持全局预设 + 项目自定义） */
export const impactDefinition = pgTable('impact_definition', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** 归属项目ID，空=全局预设 */
  projectId: bigint('project_id', { mode: 'number' }).references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 唯一标识，如 character.dao_xin */
  impactKey: varchar('impact_key', { length: 64 }).notNull().unique(),
  /** 显示名称 */
  name: varchar('name', { length: 64 }).notNull(),
  /** 作用域：character/world/relation/rule */
  domain: varchar('domain', { length: 32 }).notNull(),
  /** 细分类：base/fate/qualification/faction/inner/karma */
  category: varchar('category', { length: 32 }).notNull(),
  /** 值类型：numeric数值型 / tag标签型 */
  valueType: varchar('value_type', { length: 16 }).notNull(),
  /** 数值下限 */
  minValue: integer('min_value').notNull().default(0),
  /** 数值上限 */
  maxValue: integer('max_value').notNull().default(100),
  /** 初始默认值 */
  defaultValue: integer('default_value').notNull().default(0),
  /** 每章自然衰减值 */
  decayPerChapter: integer('decay_per_chapter').notNull().default(0),
  /** 标签品级：heaven/earth/ren */
  grade: varchar('grade', { length: 16 }),
  /** 互斥组名 */
  mutexGroup: varchar('mutex_group', { length: 64 }),
  /** 冲突优先级 */
  priority: integer('priority').notNull().default(1),
  /** 阈值触发配置 jsonb [{threshold, tagKey, tagName, once}] */
  thresholdEvents: jsonb('threshold_events'),
  /** 效果描述（注入写作上下文） */
  description: text('description'),
  /** 是否启用 */
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 人物影响快照表（每章结束后生成，与人物状态快照按章节对齐） */
export const characterImpactSnapshot = pgTable('character_impact_snapshot', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 诛仙库人物ID */
  characterId: bigint('character_id', { mode: 'number' }).notNull(),
  /** 冗余人物名称 */
  characterName: varchar('character_name', { length: 64 }).notNull(),
  volumeNo: integer('volume_no').notNull(),
  /** 章节号，0=初始状态 */
  chapterNo: integer('chapter_no').notNull(),
  /** 数值属性集合 jsonb {impactKey: number} */
  numericValues: jsonb('numeric_values').notNull().default({}),
  /** 标签状态集合 jsonb [{tagKey, tagName, remainChapters, priority}] */
  tagStates: jsonb('tag_states').notNull().default([]),
  /** pending待确认 / confirmed已确认 */
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  /** 来源：manual/auto/branch/bootstrap */
  source: varchar('source', { length: 16 }).notNull(),
  /** 关联生成任务ID */
  taskId: bigint('task_id', { mode: 'number' }),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 世界观影响快照表（记录全局/区域世界状态，空区域=全局） */
export const worldImpactSnapshot = pgTable('world_impact_snapshot', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  volumeNo: integer('volume_no').notNull(),
  chapterNo: integer('chapter_no').notNull(),
  /** 区域标识，空=全局 */
  region: varchar('region', { length: 64 }),
  /** 数值属性 jsonb {impactKey: number} */
  numericValues: jsonb('numeric_values').notNull().default({}),
  /** 全局标签 jsonb [{tagKey, tagName, remainChapters, priority}] */
  tagStates: jsonb('tag_states').notNull().default([]),
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  source: varchar('source', { length: 16 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 分支影响关联表（每个分支选项对应的影响变化明细） */
export const branchImpactLink = pgTable('branch_impact_link', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** 关联分支选项ID */
  branchOptionId: bigint('branch_option_id', { mode: 'number' }).notNull().references(() => chapterBranchOption.id, { onDelete: 'cascade' }),
  /** 目标类型：character/world/relation */
  targetType: varchar('target_type', { length: 16 }).notNull(),
  /** 目标ID（character=人物ID；world 时为空） */
  targetId: bigint('target_id', { mode: 'number' }),
  /** 关系目标人物A（relation 用，阶段4） */
  charAId: bigint('char_a_id', { mode: 'number' }),
  /** 关系目标人物B（relation 用，阶段4） */
  charBId: bigint('char_b_id', { mode: 'number' }),
  /** 世界目标区域 */
  region: varchar('region', { length: 64 }),
  /** 影响项key（对应 impact_definition.impact_key） */
  impactKey: varchar('impact_key', { length: 64 }).notNull(),
  /** 变更类型：add/set/add_tag/remove_tag */
  changeType: varchar('change_type', { length: 16 }).notNull(),
  /** 数值变化量 */
  changeValue: integer('change_value'),
  /** 标签key */
  tagKey: varchar('tag_key', { length: 64 }),
  /** 标签持续章数，-1=永久 */
  tagDuration: integer('tag_duration'),
  /** 前端展示文案 */
  displayText: varchar('display_text', { length: 128 }).notNull(),
  /** 是否隐藏（暗线） */
  isHidden: boolean('is_hidden').notNull().default(false),
  /** 展示排序 */
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 影响变更历史表（全链路追溯所有影响变化，支持审计与回滚） */
export const impactHistory = pgTable('impact_history', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 来源：branch/manual/auto/event */
  sourceType: varchar('source_type', { length: 16 }).notNull(),
  /** 来源ID（branch=分支选项ID） */
  sourceId: bigint('source_id', { mode: 'number' }),
  /** 生效章节 */
  chapterNo: integer('chapter_no').notNull(),
  /** 变更前快照摘要 jsonb */
  snapshotBefore: jsonb('snapshot_before').notNull(),
  /** 变更后快照摘要 jsonb */
  snapshotAfter: jsonb('snapshot_after').notNull(),
  /** 备注 */
  operatorNote: text('operator_note'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ─── 阶段4：因果链 + 关系影响快照 ───────────────────────────────────────────────

/** 因果链表（分支选择/剧情事件 → 后续章节兑现的因果传递线） */
export const causalChain = pgTable('causal_chain', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),

  // 因（起点）
  /** 来源类型：branch/event/manual */
  sourceType: varchar('source_type', { length: 16 }).notNull(),
  /** 来源ID（branch_option.id 或 generated_chapter.id） */
  sourceId: bigint('source_id', { mode: 'number' }),
  /** 因发生的章节号 */
  sourceChapterNo: integer('source_chapter_no').notNull(),
  /** 因果类别：secret/debt/betrayal/prophecy/promise/grudge */
  causeType: varchar('cause_type', { length: 32 }).notNull(),
  /** 因的自然语言描述（供 prompt 注入） */
  causeDescription: text('cause_description').notNull(),

  // 果（预期兑现）
  /** 预期果类别：reveal/repay/revenge/fulfill/break */
  effectType: varchar('effect_type', { length: 32 }),
  /** 预期果的描述 */
  effectDescription: text('effect_description'),
  /** 预期兑现窗口（最早章） */
  targetChapterMin: integer('target_chapter_min'),
  /** 预期兑现窗口（最晚章） */
  targetChapterMax: integer('target_chapter_max'),

  // 生命周期
  /** planted/foreshadowed/triggered/resolved/expired */
  status: varchar('status', { length: 16 }).notNull().default('planted'),
  /** 优先级 1-10，越高越应优先回收 */
  priority: integer('priority').notNull().default(5),
  /** 因果强度 0-100（影响兑现时的剧情烈度） */
  strength: integer('strength').notNull().default(50),

  // 兑现记录
  /** 实际兑现章节 */
  resolvedChapterNo: integer('resolved_chapter_no'),
  /** 兑现时的生成任务 */
  resolvedTaskId: bigint('resolved_task_id', { mode: 'number' }),
  /** 兑现方式备注 */
  resolutionNote: text('resolution_note'),

  // 关联
  /** 关联方向代码（如 mainplot_karma） */
  directionCode: varchar('direction_code', { length: 32 }),
  /** 因果链嵌套（果又生因） */
  parentChainId: bigint('parent_chain_id', { mode: 'number' }),
  /** 自由标签 ["主线","师徒"] */
  tags: jsonb('tags').notNull().default([]),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 关系影响快照表（分支选择对人物关系数值的改变，pending/confirmed 生命周期） */
export const relationImpactSnapshot = pgTable('relation_impact_snapshot', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),

  /** 关系方A（诛仙库人物ID，约定 char_a_id < char_b_id） */
  charAId: bigint('char_a_id', { mode: 'number' }).notNull(),
  /** 关系方B */
  charBId: bigint('char_b_id', { mode: 'number' }).notNull(),
  charAName: varchar('char_a_name', { length: 64 }).notNull(),
  charBName: varchar('char_b_name', { length: 64 }).notNull(),

  volumeNo: integer('volume_no').notNull(),
  chapterNo: integer('chapter_no').notNull(),

  /** 关系类型标签：师徒/同门/仇敌/道侣 */
  relType: varchar('rel_type', { length: 64 }),
  /** 全量关系维度 {"affection":70,"trust":45,"respect":80,"intimacy":30} */
  relationValues: jsonb('relation_values').notNull().default({}),
  /** 本次变更量 {"trust":-20,"affection":5} */
  relationDelta: jsonb('relation_delta').notNull().default({}),

  /** pending/confirmed */
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  /** branch/manual/bootstrap */
  source: varchar('source', { length: 16 }).notNull(),
  taskId: bigint('task_id', { mode: 'number' }),

  createdAt: timestamp('created_at').defaultNow(),
});

// ============================================================
// 自定义人物模块（原创人物创建）
// 对外暴露负数ID（真实自增ID取负），与诛仙库人物正数ID共存；
// 现存 characterIds 数组字段零改动，仅在读取解析层按正负分流。
// ============================================================

/** 自定义人物表 - 三步向导创建的原创小说人物 */
export const customCharacter = pgTable('custom_character', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 姓名（可含道号/称号后缀） */
  name: varchar('name', { length: 64 }).notNull(),
  /** 性别：male/female */
  gender: varchar('gender', { length: 10 }).notNull().default('male'),
  /** 种族大类ID（human/demon_race/demon_king_race/ghost_race/spirit_race/divine_race/hybrid_race） */
  raceCategory: varchar('race_category', { length: 30 }).notNull(),
  /** 种族小类ID（附录A 56小类之一） */
  raceSub: varchar('race_sub', { length: 40 }).notNull(),
  /** 实力定位档位key：chenjie/tongtu/dazhe/zhelong/tianyou */
  position: varchar('position', { length: 20 }).notNull(),
  /** 伪装定位档位key（扮猪吃虎，须低于真实定位档次），空=不伪装 */
  fakePosition: varchar('fake_position', { length: 20 }),
  /** 立场值 0-100（0=极正 100=极邪） */
  stance: integer('stance').notNull().default(50),
  /** 内在性格（单选：无私/正直/中庸/狂邪/利己/邪恶） */
  innerPersonality: varchar('inner_personality', { length: 20 }).notNull(),
  /** 外在性格标签数组（2-3个，jsonb string[]） */
  outerPersonality: jsonb('outer_personality').notNull().default([]),
  /** 天赋名称数组（3正向 + 可选1缺陷，jsonb string[]，详情由shared配置库反查） */
  talents: jsonb('talents').notNull().default([]),
  /** 种族擅长（冗余自附录A，jsonb string[]） */
  strengths: jsonb('strengths').notNull().default([]),
  /** 种族短板（冗余自附录A，jsonb string[]） */
  weaknesses: jsonb('weaknesses').notNull().default([]),
  /** LLM生成的人物小传（300-500字，失败时为模板拼接兜底） */
  description: text('description'),
  /** 人物判词（仿红楼薄命司七言绝句，四句换行分隔，LLM生成失败降级模板） */
  verdictPoem: varchar('verdict_poem', { length: 128 }),
  /** 人物考语（仿警幻情榜二字考语，核心字+情） */
  verdictComment: varchar('verdict_comment', { length: 16 }),
  /** 套装道号（人兵功100%适配时生成，7.31） */
  daoTitle: varchar('dao_title', { length: 64 }),
  /** 套装大招（人兵功100%适配时生成，7.31） */
  comboAbility: text('combo_ability'),
  /** 引用来源（世界观实体快照）：{type, id, name, bookId} */
  sourceRef: jsonb('source_ref'),
  /** 实体状态：official=用户正式创建 / draft=AI自动提取待补充（09-自定义实体自动维护） */
  entityStatus: varchar('entity_status', { length: 16 }).notNull().default('official'),
  /** 章节动态数组 [{chapterNo, volumeNo, updateText, category, extractedAt}]（自动追踪追加） */
  chapterUpdates: jsonb('chapter_updates').notNull().default([]),
  /** 软删除 */
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================================
// 热点嗅探模块（抓热门榜单 → LLM提炼剧情素材 → 推送入素材库）
// 由独立工具并入，表已存在于 novel_studio 库（hotspot_ 前缀隔离），
// DDL 存档见 scripts/ddl-hotspot.sql（幂等）。
// ============================================================

/** 热点嗅探 - 爬取批次 */
export const hotspotCrawlBatch = pgTable('hotspot_crawl_batch', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** 本批次涉及的榜单源名称数组 */
  sourceNames: jsonb('source_names').notNull().default([]),
  /** running/completed/failed/partial */
  status: varchar('status', { length: 20 }).notNull().default('running'),
  /** 成功入库书目数 */
  itemCount: integer('item_count').notNull().default(0),
  /** 备注/错误信息 */
  note: text('note'),
  startedAt: timestamp('started_at').defaultNow(),
  finishedAt: timestamp('finished_at'),
});

/** 热点嗅探 - 原始榜单书目 */
export const hotspotRawNovel = pgTable('hotspot_raw_novel', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  batchId: bigint('batch_id', { mode: 'number' }).notNull().references(() => hotspotCrawlBatch.id, { onDelete: 'cascade' }),
  /** 榜单源名称 */
  source: varchar('source', { length: 60 }).notNull(),
  /** 榜单排名 */
  rank: integer('rank'),
  title: text('title').notNull(),
  author: text('author'),
  category: text('category'),
  /** 标签数组 jsonb string[] */
  tags: jsonb('tags').default([]),
  intro: text('intro'),
  /** 字数（原始展示串） */
  wordCount: text('word_count'),
  /** 热度/人气展示串 */
  popularity: text('popularity'),
  url: text('url'),
  /** 原始抓取字段 */
  raw: jsonb('raw').default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 热点嗅探 - 分析灵感条目 */
export const hotspotInsight = pgTable('hotspot_insight', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  batchId: bigint('batch_id', { mode: 'number' }).notNull().references(() => hotspotCrawlBatch.id, { onDelete: 'cascade' }),
  /** encounter/foreshadow/highlight/task/trend(仅参考) */
  insightType: varchar('insight_type', { length: 20 }).notNull(),
  title: text('title').notNull(),
  /** 灵感正文/核心剧情模板 */
  content: text('content'),
  /** 结构化补充数据（trigger_condition/reward/cost_or_risk/emotional_beat/applicable_scene_type/tags/source_work） */
  payload: jsonb('payload').default({}),
  /** 复用价值评分 0-100 */
  score: integer('score').default(0),
  /** new/kept/discarded/pushed */
  status: varchar('status', { length: 20 }).notNull().default('new'),
  /** 关联的 hotspot_raw_novel.id 数组 */
  sourceNovelIds: jsonb('source_novel_ids').default([]),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 热点嗅探 - 推送入库记录 */
export const hotspotPushLog = pgTable('hotspot_push_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  insightId: bigint('insight_id', { mode: 'number' }).notNull().references(() => hotspotInsight.id, { onDelete: 'cascade' }),
  /** plot_material_encounter/foreshadow/highlight/task */
  targetTable: varchar('target_table', { length: 40 }).notNull(),
  /** creative_project.id，全局素材为 NULL */
  targetProjectId: bigint('target_project_id', { mode: 'number' }),
  /** 目标表新插入行的 id */
  targetId: bigint('target_id', { mode: 'number' }),
  note: text('note'),
  pushedAt: timestamp('pushed_at').defaultNow(),
});

// ============================================================
// 自定义功法模块（九大本源道则体系，3步点选+随机创建）
// 设计决策：独立 custom_technique 表（仿 custom_weapon 先例），entityType='technique'；
// 不接入 6 档品级成长（功法无绝对品级），演化走推演深化/跨界融合/绝境异变三路径，
// 仅复用 growth_type/base_entity_id/source_entity_ids 做演化血缘追溯（无 grade 字段）。
// 配套神通按道境四档（入微/化境/合道/超脱）分级，存于 abilities 各项的 daoRealm，
// 与人物运行态境界（自由文本）解耦。DDL 存档见 scripts/ddl-technique.sql（幂等）。
// ============================================================

/** 自定义功法表 - 项目级自定义小说功法，接入素材池合流、上下文注入与一致性审计 */
export const customTechnique = pgTable('custom_technique', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 功法名号 */
  name: varchar('name', { length: 32 }).notNull(),
  /** 主修道则ID（gengjin/kunearth/thunder/mingshi/void/suishi/xingzhi/lingqi/shenhun） */
  mainDao: varchar('main_dao', { length: 32 }).notNull(),
  /** 辅修道则ID数组（0-3门，jsonb string[]） */
  assistDao: jsonb('assist_dao').notNull().default([]),
  /** 传法指引深度：rudimentary/complete/essential（非品级，仅讲解完备度） */
  guidanceDepth: varchar('guidance_depth', { length: 16 }).notNull(),
  /** 对外展示版本（藏拙隐法用，null 表示不藏拙） */
  fakeDepth: varchar('fake_depth', { length: 16 }),
  /** 功法体例ID：cultivate/attack/defense/assist/special */
  styleType: varchar('style_type', { length: 16 }).notNull(),
  /** 适配门槛 {affinity, body, mind, resource}（词条ID，附录I） */
  threshold: jsonb('threshold').notNull().default([]),
  /** 本源运用方向数组（道则永久特质，附录D-1 词条ID） */
  coreTraits: jsonb('core_traits').notNull().default([]),
  /** 行功路线ID（附录D-2：orthodox/reverse/fusion/remnant/blood_pact/fast_way） */
  practicePath: varchar('practice_path', { length: 32 }).notNull(),
  /** 身体印记 {appearance, aura, behavior, breath}（按道则自动生成，附录J） */
  bodyMark: jsonb('body_mark').notNull().default({}),
  /** 典型运用技巧数组（附录K 词条ID） */
  usageSkills: jsonb('usage_skills').notNull().default([]),
  /** 分道境配套神通数组 [{id, name, daoRealm(入微/化境/合道/超脱), desc, fitDao}]（附录E） */
  abilities: jsonb('abilities').notNull().default([]),
  /** 反噬代价数组（附录F 词条ID） */
  backlash: jsonb('backlash').notNull().default([]),
  /** LLM动态生成的反噬代价描述（13-SRS US-20d，随功法保存不重复生成） */
  backlashText: text('backlash_text'),
  /** 天机独悟神通改名（13-SRS US-20e，[{id,newName}]，展示时覆盖预设神通名） */
  insightRenames: jsonb('insight_renames').notNull().default([]),
  /** 传承方式ID（附录G：oral/jade_slip/blood_seal/remnant/sect_public） */
  inheritance: varchar('inheritance', { length: 32 }).notNull(),
  /** 演化方向数组（附录L 词条ID，预设2-3个） */
  evolution: jsonb('evolution').notNull().default([]),
  /** 先天矛盾ID（附录M，可选，null 表示无） */
  inherentConflict: varchar('inherent_conflict', { length: 32 }),
  /** 核心方向标签数组（根据道则+体例自动生成） */
  coreDirection: jsonb('core_direction').notNull().default([]),
  /** 适配修士标签数组（根据道则+体例自动生成） */
  fitMonk: jsonb('fit_monk').notNull().default([]),
  /** LLM生成的功法详解（500-700字：核心逻辑/修行要点/战斗表现） */
  description: text('description'),
  /** LLM生成配套招式数组 [{name, desc, tier}]（基础招→进阶招→特质招→杀招），与 weapon_lore.moves 同构 */
  moves: jsonb('moves').notNull().default([]),
  /** 演化血缘：base/evolution(推演深化)/fusion(跨界融合)/mutation(绝境异变) */
  growthType: varchar('growth_type', { length: 20 }).notNull().default('base'),
  /** 基础原型ID（演化溯源，可指本表id） */
  baseEntityId: bigint('base_entity_id', { mode: 'number' }),
  /** 来源实体ID数组（跨界融合变式溯源） */
  sourceEntityIds: jsonb('source_entity_ids').default([]),
  /** 关联人物ID数组（自定义人物ID，绑定后触发个人变种生成） */
  linkedCharacterIds: jsonb('linked_character_ids').default([]),
  /** 引用来源（世界观功法快照）：{type, id, name, bookId} */
  sourceRef: jsonb('source_ref'),
  /** 实体状态：official=用户正式创建 / draft=AI自动提取待补充（09-自定义实体自动维护） */
  entityStatus: varchar('entity_status', { length: 16 }).notNull().default('official'),
  /** 章节动态数组 [{chapterNo, volumeNo, updateText, category, extractedAt}]（自动追踪追加） */
  chapterUpdates: jsonb('chapter_updates').notNull().default([]),
  /** 软删除 */
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 人物功法个人变种表 - 同一基础功法绑定不同人物时生成的差异化修炼变种（千人千面法则）
 *  四大影响因子复用人物模块字段：道则亲和（talents body类反查）/心性性格（inner+outer列）/
 *  出身经历（talents origin类反查）/种族特质（raceCategory+raceSub列）。
 *  变种不新增基础功法未含道则能力，仅调整权重/偏向/代价/运用方式。 */
export const characterTechniqueVariant = pgTable('character_technique_variant', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 关联人物ID（自定义人物 custom_character.id） */
  characterId: bigint('character_id', { mode: 'number' }).notNull().references(() => customCharacter.id, { onDelete: 'cascade' }),
  /** 基础功法ID（custom_technique.id） */
  baseTechniqueId: bigint('base_technique_id', { mode: 'number' }).notNull().references(() => customTechnique.id, { onDelete: 'cascade' }),
  /** 变种功法名号 */
  variantName: varchar('variant_name', { length: 48 }).notNull(),
  /** 稀有度：common/remarkable/rare（60/30/10） */
  rarity: varchar('rarity', { length: 16 }).notNull(),
  /** 道则权重偏移 {mainDao, assistDao[]}（不新增道则） */
  daoWeightOffset: jsonb('dao_weight_offset').notNull().default({}),
  /** 本源特质偏移明细 [{id, change, derived?}] */
  traitOffset: jsonb('trait_offset').notNull().default([]),
  /** 神通变种明细 [{baseId, variantName, change}] */
  abilityVariant: jsonb('ability_variant').notNull().default([]),
  /** 反噬偏移明细 [{id, change}] */
  backlashOffset: jsonb('backlash_offset').notNull().default([]),
  /** 专属身体印记 {appearance, aura, behavior, breath} */
  bodyMark: jsonb('body_mark').notNull().default({}),
  /** 专属运用技巧数组 */
  exclusiveSkill: jsonb('exclusive_skill').notNull().default([]),
  /** 修炼适配效果 {speed, bottleneck, risk, note} */
  cultivationEffect: jsonb('cultivation_effect').notNull().default({}),
  /** LLM生成个人化变种详解（400-600字：此人心性/经历/道则亲和如何重塑基础功法） */
  description: text('description'),
  /** 变种版本号（剧情成长后迭代） */
  version: integer('version').notNull().default(1),
  /** 软删除 */
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 人物武学档案表 - 人物绑定一门功法+一件武器后，融合双方招式并形成的人物功法武器小传
 *  一人一份生效档案，upsert 时 version+1（同变种范式）。融合招式与小传均由 CharacterMartialLoreAgent 生成。 */
export const characterMartialLore = pgTable('character_martial_lore', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 关联人物ID（自定义人物 custom_character.id） */
  characterId: bigint('character_id', { mode: 'number' }).notNull().references(() => customCharacter.id, { onDelete: 'cascade' }),
  /** 参与融合的功法ID（custom_technique.id，可空：功法被删后保留档案） */
  techniqueId: bigint('technique_id', { mode: 'number' }).references(() => customTechnique.id, { onDelete: 'set null' }),
  /** 参与融合的武器ID（custom_weapon.id，可空） */
  weaponId: bigint('weapon_id', { mode: 'number' }).references(() => customWeapon.id, { onDelete: 'set null' }),
  /** 融合招式数组 [{name, desc, source}]，source ∈ technique/weapon/fused */
  fusedMoves: jsonb('fused_moves').notNull().default([]),
  /** 人物功法武器小传（500-800字） */
  biography: text('biography'),
  /** 档案版本号（重新生成时+1） */
  version: integer('version').notNull().default(1),
  /** 软删除 */
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================================
// 淘宝系统（铸器天工·淘宝改造 7.31）
// ============================================================

/** 淘宝物品表 - 存储所有淘到的物品（世情小物 + 秘宝） */
export const treasureItem = pgTable('treasure_item', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 物品类型：trinket=世情小物 / secret=秘宝 */
  itemType: varchar('item_type', { length: 16 }).notNull().default('secret'),
  /** 秘宝子类型：spirit=有灵 / legacy=传承 / relic=彩蛋遗珍（小物为null） */
  secretTier: varchar('secret_tier', { length: 16 }),
  /** 展示名：小物=直观名 / 秘宝=外观代称 */
  displayName: varchar('display_name', { length: 128 }).notNull(),
  /** 秘宝正式名（解锁阶段5揭示） */
  trueName: varchar('true_name', { length: 128 }),
  /** 外观描写 */
  appearance: text('appearance'),
  /** 世情小物剧情钩子（1-2句） */
  trinketHook: text('trinket_hook'),
  /** 小物模板分类（首饰/文书/日用/食物/衣饰/杂项） */
  trinketCategory: varchar('trinket_category', { length: 32 }),
  /** 秘宝完整数据（randomWeapon/randomTechnique输出，前端按阶段过滤返回） */
  fullData: jsonb('full_data'),
  /** 当前解锁阶段 0-5 */
  unlockStage: integer('unlock_stage').notNull().default(0),
  /** 解锁进度记录 [{stage, trigger, unlockedAt}] */
  unlockProgress: jsonb('unlock_progress').notNull().default([]),
  /** 绑定的自定义人物ID */
  boundCharacterId: bigint('bound_character_id', { mode: 'number' }),
  /** 绑定时所在章节号（用于阶段4"过了10章"判定） */
  boundChapterNo: integer('bound_chapter_no'),
  /** 使用次数累计（阶段4判定） */
  useCount: integer('use_count').notNull().default(0),
  /** 是否打眼 */
  isFake: boolean('is_fake').notNull().default(false),
  /** 打眼真相（小物淘到即揭示/秘宝阶段5暴露） */
  fakeReveal: text('fake_reveal'),
  /** 淘宝地点 */
  huntLocation: varchar('hunt_location', { length: 64 }),
  /** 关联hunt记录ID */
  huntRecordId: bigint('hunt_record_id', { mode: 'number' }),
  /** 是否已收入囊中 */
  isCollected: boolean('is_collected').notNull().default(false),
  /** 秘宝是否已转为正式武器/功法 */
  isConverted: boolean('is_converted').notNull().default(false),
  /** 转换后的 custom_weapon/custom_technique ID */
  convertedId: bigint('converted_id', { mode: 'number' }),
  /** 用户备注 */
  note: text('note'),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 淘宝记录表 - 每次逛摊/大集的会话记录 */
export const treasureHuntRecord = pgTable('treasure_hunt_record', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  /** 淘宝地点 */
  location: varchar('location', { length: 64 }).notNull(),
  /** 物品总数 */
  itemCount: integer('item_count').notNull().default(10),
  /** 小物数量 */
  trinketCount: integer('trinket_count').notNull().default(0),
  /** 秘宝数量 */
  secretCount: integer('secret_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============ 叙事技法库 ============

/** 技法原子主表 - 存储可量化的叙事原则/模式/示例 */
export const techniqueAtom = pgTable('technique_atom', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** 技法ID，格式 T_{分类}_{序号}，如 T_PLAN_001 */
  techniqueId: varchar('technique_id', { length: 30 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  /** 分类：content_planning / presentation / rhythm / character_logic */
  category: varchar('category', { length: 30 }).notNull(),
  /** 层级：principle（核心原则）/ pattern（参考模式）/ example（示例） */
  level: varchar('level', { length: 20 }).notNull().default('principle'),
  /** 来源：manual（手工整理）/ custom（作者自定义） */
  source: varchar('source', { length: 20 }).notNull().default('manual'),
  description: text('description'),
  /** 可计算规则数组 [{metric, operator, threshold, severity}] */
  coreRules: jsonb('core_rules').notNull().default([]),
  /** 注入 Writer 的原则性指导（≤50字） */
  generationGuidance: text('generation_guidance'),
  /** 追加到 LLM 审计 prompt 的维度描述 */
  auditPromptSegment: text('audit_prompt_segment'),
  /** 段落修复 prompt 模板 */
  autoFixTemplate: text('auto_fix_template'),
  /** 正反例数组 [{type: 'good'|'bad', text, source}] */
  examples: jsonb('examples').default([]),
  /** 适用题材（空=全题材） */
  applicableGenres: varchar('applicable_genres', { length: 100 }).array().default([]),
  sortOrder: integer('sort_order').default(0),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 章节-技法关联表 - 记录每章启用了哪些技法及审计得分 */
export const chapterTechniqueMap = pgTable('chapter_technique_map', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  chapterPlanId: bigint('chapter_plan_id', { mode: 'number' }).notNull().references(() => chapterPlan.id, { onDelete: 'cascade' }),
  techniqueId: varchar('technique_id', { length: 30 }).notNull().references(() => techniqueAtom.techniqueId),
  enabled: boolean('enabled').notNull().default(true),
  /** 用户自定义参数覆盖 */
  params: jsonb('params').default({}),
  /** 该技法在本章的审计得分 0-1 */
  auditScore: numeric('audit_score', { precision: 3, scale: 2 }),
  /** 审计详情（问题段落定位等） */
  auditDetail: jsonb('audit_detail'),
  /** 是否已执行修复 */
  fixed: boolean('fixed').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

/** 信息点表 - 章节规划用的双维度信息点清单 */
export const infoPoint = pgTable('info_point', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  chapterPlanId: bigint('chapter_plan_id', { mode: 'number' }).notNull().references(() => chapterPlan.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  /** 重要性：core / secondary / foreshadow */
  importance: varchar('importance', { length: 20 }).notNull().default('secondary'),
  /** 功能：plot / character / world / atmosphere / foreshadow */
  function: varchar('function', { length: 20 }).notNull().default('plot'),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============================================================
// v1.4 角色心智与信息差增强（PRD-A）
// ============================================================

/** 角色声音配置表 - 人物说话方式/口癖/语气特征，注入式（不做两阶段分角色生成）
 *  characterId 遵循负数约定：正数=诛仙库人物，负数=自定义人物（取绝对值对应 custom_character.id） */
export const characterVoiceConfig = pgTable('character_voice_config', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  characterId: bigint('character_id', { mode: 'number' }).notNull(),
  /** 说话方式概述（语速/句式/用文白程度等） */
  speechStyle: text('speech_style'),
  /** 口头禅/高频用语（逗号分隔） */
  catchphrases: text('catchphrases'),
  /** 称呼习惯（对主角/师长的称呼等） */
  addressHabit: text('address_habit'),
  /** 语气基调（冷淡/热络/阴阳怪气等） */
  toneBase: text('tone_base'),
  /** 示例台词（jsonb 字符串数组，供 prompt 参考） */
  exampleQuotes: jsonb('example_quotes').default([]),
  /** 禁用表达（该人物绝不会说的话/词，jsonb 字符串数组） */
  forbiddenExpressions: jsonb('forbidden_expressions').default([]),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 角色已知信息清单表 - 人物视角的"知识图谱"，供信息差写作与认知越界审计
 *  简化为单层：knowledge_content + info_level 标记（砍掉 L0-L3 四层分级） */
export const characterKnowledge = pgTable('character_knowledge', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  characterId: bigint('character_id', { mode: 'number' }).notNull(),
  /** 已知信息内容（一条一个具体事实） */
  knowledgeContent: text('knowledge_content').notNull(),
  /** 信息层级标记：core(核心认知) / common(普通知晓) / secret(隐秘但已知) */
  infoLevel: varchar('info_level', { length: 20 }).notNull().default('common'),
  /** 来源：manual(手动) / foreshadow(伏笔回收联动) / timeline(时间线推导) */
  sourceType: varchar('source_type', { length: 20 }).notNull().default('manual'),
  /** 来源引用（如 {foreshadowId: 12} / {chapterNo: 8}） */
  sourceRef: jsonb('source_ref').default({}),
  /** 获知章节号（从第几章起该人物知道此信息，空=从头知晓） */
  acquiredChapter: integer('acquired_chapter'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 角色记忆卡表 - 人物级经历/记忆摘要（第三期，状态注入修复后的增量） */
export const characterMemoryCard = pgTable('character_memory_card', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  characterId: bigint('character_id', { mode: 'number' }).notNull(),
  /** 经历摘要（一句话记忆） */
  eventSummary: text('event_summary').notNull(),
  /** 发生章节号 */
  chapterNo: integer('chapter_no'),
  /** 情绪印记（该记忆对人物的情绪影响） */
  emotionalImpact: text('emotional_impact'),
  /** 重要性：high / normal / low */
  importance: varchar('importance', { length: 20 }).notNull().default('normal'),
  /** 来源：auto(自动抽取，低置信) / manual(人工确认) */
  source: varchar('source', { length: 20 }).notNull().default('auto'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============================================================
// 山河舆图（10-需求规格说明书）：自定义地图/地点/路径
// ============================================================

/** 地图表 - 一个项目可有多张地图（US-1/US-3） */
export const customMap = pgTable('custom_map', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  /** 底图 dataURL（无文件上传设施，图片转base64存储） */
  bgImage: text('bg_image'),
  bgOpacity: real('bg_opacity').notNull().default(0.7),
  /** 坐标范围（地图内相对坐标系，默认2000×1500） */
  minX: real('min_x').notNull().default(0),
  minY: real('min_y').notNull().default(0),
  maxX: real('max_x').notNull().default(2000),
  maxY: real('max_y').notNull().default(1500),
  /** 父地图（US-3 基础层级） */
  parentMapId: bigint('parent_map_id', { mode: 'number' }),
  sortOrder: integer('sort_order').notNull().default(0),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 自定义地点表 - 含坐标/类型/危险等级/草稿态（US-1） */
export const customLocation = pgTable('custom_location', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  mapId: bigint('map_id', { mode: 'number' }).notNull().references(() => customMap.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 64 }).notNull(),
  /** 地图内相对坐标 */
  x: real('x').notNull(),
  y: real('y').notNull(),
  /** 类型: sect/city/secret_realm/danger/teleport/battlefield/generic */
  locationType: varchar('location_type', { length: 32 }).notNull().default('generic'),
  /** 危险等级: safe/normal/danger/deadly */
  dangerLevel: varchar('danger_level', { length: 16 }).notNull().default('normal'),
  /** 环境描写（注入生成上下文） */
  description: text('description'),
  /** 所属势力（US-4 简化：字段+颜色区分替代多边形绘制） */
  affiliatedFaction: varchar('affiliated_faction', { length: 64 }),
  /** 上级区域（如小竹峰→青云山） */
  parentLocationId: bigint('parent_location_id', { mode: 'number' }),
  /** 连接到其他地图（传送阵/秘境入口） */
  linkedMapId: bigint('linked_map_id', { mode: 'number' }),
  /** 状态: draft=AI提取/诛仙库导入待确认, official=用户确认 */
  entityStatus: varchar('entity_status', { length: 16 }).notNull().default('official'),
  /** 章节动态数组（与人物 chapterUpdates 同构，预留） */
  chapterUpdates: jsonb('chapter_updates').notNull().default([]),
  icon: varchar('icon', { length: 32 }),
  color: varchar('color', { length: 16 }),
  metadata: jsonb('metadata').notNull().default({}),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** 地点间路径表 - 边权为抽象旅行时间（分钟，US-4） */
export const customLocationLink = pgTable('custom_location_link', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: bigint('project_id', { mode: 'number' }).notNull().references(() => creativeProject.id, { onDelete: 'cascade' }),
  fromLocationId: bigint('from_location_id', { mode: 'number' }).notNull().references(() => customLocation.id, { onDelete: 'cascade' }),
  toLocationId: bigint('to_location_id', { mode: 'number' }).notNull().references(() => customLocation.id, { onDelete: 'cascade' }),
  /** 路径类型: main_road/path/teleport/secret_path */
  linkType: varchar('link_type', { length: 32 }).notNull().default('path'),
  /** 各旅行方式所需分钟数（空=该方式不可用，估算时用直线距离换算） */
  travelTimeWalk: integer('travel_time_walk'),
  travelTimeFly: integer('travel_time_fly'),
  travelTimeShip: integer('travel_time_ship'),
  travelTimeTeleport: integer('travel_time_teleport').default(0),
  description: text('description'),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
});
