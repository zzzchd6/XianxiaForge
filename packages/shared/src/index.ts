// ═══════════════════════════════════════════════════════════════════════════════
// @novel-studio/shared - 共享类型定义
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 状态枚举 ─────────────────────────────────────────────────────────────────

/** 创作项目状态 */
export type ProjectStatus = 'planning' | 'writing' | 'reviewing' | 'completed';

/** 大纲状态 */
export type OutlineStatus = 'draft' | 'confirmed' | 'writing' | 'done';

/** 章节计划状态 */
export type ChapterPlanStatus = 'planned' | 'generating' | 'generated' | 'reviewed' | 'approved';

/** 生成任务类型 */
export type TaskType = 'compose' | 'write' | 'audit' | 'revise';

/** 生成任务状态 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

/** 生成章节状态 */
export type ChapterStatus = 'draft' | 'reviewed' | 'approved' | 'published';

/** 作者规则类型 */
export type RuleType = 'hard' | 'soft' | 'style';

// ─── 创作工作库实体 ───────────────────────────────────────────────────────────

/** 创作项目 */
export interface CreativeProject {
  id: number;
  name: string;
  description: string | null;
  genre: string | null;
  source_book_id: number;
  status: ProjectStatus;
  llm_config: LLMConfig;
  generation_config: GenerationConfig;
  created_at: string;
  updated_at: string;
}

/** 故事大纲（卷级） */
export interface StoryOutline {
  id: number;
  project_id: number;
  volume_no: number;
  title: string;
  synopsis: string | null;
  key_events: KeyEvent[];
  character_arcs: CharacterArc[];
  foreshadowing: Foreshadowing[];
  world_building_notes: string | null;
  sort_order: number;
  status: OutlineStatus;
  created_at: string;
  updated_at: string;
}

/** 卷大纲关键事件/章节条目（story_outline.key_events 的实际结构） */
export interface KeyEvent {
  /** 章节标题 */
  title: string;
  /** 章节意图/剧情描述 */
  intent?: string;
  /** 章节号 */
  chapterNumber?: number;
  /** 冲突类型 */
  conflictType?: string;
  /** 目标情绪 */
  targetEmotion?: string;
  /** 反写覆盖前的原始标题备份（分支选择/场景脚本编辑覆盖时写入，仅首次） */
  originalTitle?: string;
  /** 反写覆盖前的原始意图备份（仅首次） */
  originalIntent?: string;
}

export interface CharacterArc {
  character_id: number;
  character_name: string;
  arc_description: string;
  start_state?: string;
  end_state?: string;
}

export interface Foreshadowing {
  description: string;
  plant_chapter?: number;
  resolve_chapter?: number;
  resolved?: boolean;
}

/** 章节计划 */
export interface ChapterPlan {
  id: number;
  project_id: number;
  outline_id: number | null;
  volume_no: number;
  chapter_no: number;
  title: string;
  intent: string | null;
  pov_character_ids: number[];
  target_word_count: number;
  scene_breakdown: SceneBreakdown[];
  required_entity_ids: RequiredEntities;
  emotion_target: string | null;
  conflict_target: number;
  prev_chapter_summary: string | null;
  status: ChapterPlanStatus;
  created_at: string;
  updated_at: string;
}

export interface SceneBreakdown {
  location: string;
  event: string;
  characters: string[];
  mood?: string;
}

export interface RequiredEntities {
  characters: number[];
  factions: number[];
  locations: number[];
  skills: number[];
}

/** 生成任务 */
export interface GenerationTask {
  id: number;
  project_id: number;
  chapter_plan_id: number | null;
  task_type: TaskType;
  status: TaskStatus;
  input_snapshot: Record<string, unknown> | null;
  output_text: string | null;
  audit_report: AuditReport | null;
  revision_notes: RevisionNote[] | null;
  error_message: string | null;
  llm_model: string | null;
  tokens_used: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface AuditReport {
  overall_score: number;
  consistency_score: number;
  style_score: number;
  plot_score: number;
  issues: AuditIssue[];
  suggestions: string[];
}

export interface AuditIssue {
  type: 'consistency' | 'style' | 'plot' | 'character' | 'world';
  severity: 'error' | 'warning' | 'info';
  description: string;
  location?: string;
}

export interface RevisionNote {
  issue: string;
  action: string;
  applied: boolean;
}

/** 生成章节（支持多版本） */
export interface GeneratedChapter {
  id: number;
  project_id: number;
  chapter_plan_id: number | null;
  volume_no: number;
  chapter_no: number;
  title: string;
  content: string | null;
  word_count: number;
  version: number;
  parent_version_id: number | null;
  quality_score: QualityScore | null;
  status: ChapterStatus;
  created_at: string;
  updated_at: string;
}

export interface QualityScore {
  consistency: number;
  style: number;
  plot: number;
  character: number;
  readability: number;
  overall: number;
}

/** 作者规则 */
export interface AuthorRule {
  id: number;
  project_id: number;
  rule_type: RuleType;
  rule_content: string;
  priority: number;
  is_active: boolean;
  created_at: string;
}

/** 生成日志 */
export interface GenerationLog {
  id: number;
  project_id: number | null;
  task_id: number | null;
  agent_name: string | null;
  action: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

// ─── LLM 配置 ─────────────────────────────────────────────────────────────────

/** LLM 模型配置 */
export interface LLMConfig {
  base_url?: string;
  api_key?: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

/** 生成参数配置 */
export interface GenerationConfig {
  target_word_count?: number;
  style?: string;
  tone?: string;
  narrative_perspective?: 'first' | 'third' | 'omniscient';
  chapter_structure?: string;
  custom_instructions?: string;
}

// ─── 诛仙知识库实体类型（只读） ───────────────────────────────────────────────

/** 角色实体 */
export interface CharacterEntity {
  id: number;
  book_id: number;
  name: string;
  aliases: string[] | null;
  gender: string | null;
  role: string | null;               // 主角/配角/龙套
  faction_id: number | null;
  cultivation_level: string | null;   // 修为境界
  personality: string | null;         // 性格描述
  appearance: string | null;          // 外貌描述
  background: string | null;          // 背景故事
  relationships: CharacterRelationship[] | null;
  skills: number[] | null;            // 关联技能ID
  first_appearance_chapter: number | null;
  tags: string[] | null;
}

export interface CharacterRelationship {
  target_character_id: number;
  target_name: string;
  relation_type: string;              // 师徒/情侣/仇敌/同门等
  description: string | null;
}

/** 门派/势力实体 */
export interface FactionEntity {
  id: number;
  book_id: number;
  name: string;
  aliases: string[] | null;
  type: string | null;                // 门派/家族/组织/国家
  description: string | null;
  location_id: number | null;
  leader: string | null;
  members: string[] | null;
  alignment: string | null;           // 正/邪/中立
  power_level: string | null;
  relationships: FactionRelationship[] | null;
  tags: string[] | null;
}

export interface FactionRelationship {
  target_faction_id: number;
  target_name: string;
  relation_type: string;              // 同盟/敌对/附属
  description: string | null;
}

/** 地点实体 */
export interface LocationEntity {
  id: number;
  book_id: number;
  name: string;
  aliases: string[] | null;
  type: string | null;                // 山脉/城镇/秘境/门派驻地
  description: string | null;
  parent_location_id: number | null;
  faction_id: number | null;
  features: string[] | null;          // 地理特征
  significance: string | null;        // 剧情意义
  tags: string[] | null;
}

/** 功法/技能实体 */
export interface SkillEntity {
  id: number;
  book_id: number;
  name: string;
  aliases: string[] | null;
  type: string | null;                // 功法/法术/武技/阵法/炼丹
  grade: string | null;               // 品阶
  description: string | null;
  faction_id: number | null;          // 所属门派
  practitioners: number[] | null;     // 使用者角色ID
  requirements: string | null;        // 修炼条件
  effects: string | null;             // 效果描述
  tags: string[] | null;
}

/** 物品/法宝实体 */
export interface ItemEntity {
  id: number;
  book_id: number;
  name: string;
  aliases: string[] | null;
  type: string | null;                // 法宝/丹药/材料/杂物
  grade: string | null;               // 品阶
  description: string | null;
  owner_id: number | null;            // 持有者角色ID
  abilities: string | null;           // 能力描述
  origin: string | null;              // 来历
  tags: string[] | null;
}

/** 事件实体 */
export interface EventEntity {
  id: number;
  book_id: number;
  name: string;
  type: string | null;                // 战斗/会议/突破/阴谋
  description: string | null;
  chapter_range: string | null;       // 发生章节范围
  participant_ids: number[] | null;   // 参与角色ID
  location_id: number | null;
  outcome: string | null;             // 结果
  significance: string | null;        // 剧情意义
  tags: string[] | null;
}

/** 世界观/设定实体 */
export interface WorldSettingEntity {
  id: number;
  book_id: number;
  name: string;
  category: string | null;            // 修炼体系/历史/规则/种族
  description: string | null;
  parent_id: number | null;           // 上级设定
  related_entities: number[] | null;
  tags: string[] | null;
}

// ─── API 请求/响应类型 ────────────────────────────────────────────────────────

/** 通用分页参数 */
export interface PaginationParams {
  page?: number;
  page_size?: number;
}

/** 通用分页响应 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** 通用 API 响应 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ─── 项目 API ─────────────────────────────────────────────────────────────────

export interface CreateProjectRequest {
  name: string;
  description?: string;
  genre?: string;
  source_book_id?: number;
  llm_config?: LLMConfig;
  generation_config?: GenerationConfig;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  genre?: string;
  status?: ProjectStatus;
  llm_config?: LLMConfig;
  generation_config?: GenerationConfig;
}

// ─── 大纲 API ─────────────────────────────────────────────────────────────────

export interface CreateOutlineRequest {
  project_id: number;
  volume_no: number;
  title: string;
  synopsis?: string;
  key_events?: KeyEvent[];
  character_arcs?: CharacterArc[];
  foreshadowing?: Foreshadowing[];
  world_building_notes?: string;
}

export interface UpdateOutlineRequest {
  title?: string;
  synopsis?: string;
  key_events?: KeyEvent[];
  character_arcs?: CharacterArc[];
  foreshadowing?: Foreshadowing[];
  world_building_notes?: string;
  status?: OutlineStatus;
}

// ─── 章节计划 API ─────────────────────────────────────────────────────────────

export interface CreateChapterPlanRequest {
  project_id: number;
  outline_id?: number;
  volume_no: number;
  chapter_no: number;
  title: string;
  intent?: string;
  pov_character_ids?: number[];
  target_word_count?: number;
  scene_breakdown?: SceneBreakdown[];
  required_entity_ids?: RequiredEntities;
  emotion_target?: string;
  conflict_target?: number;
}

export interface UpdateChapterPlanRequest {
  title?: string;
  intent?: string;
  pov_character_ids?: number[];
  target_word_count?: number;
  scene_breakdown?: SceneBreakdown[];
  required_entity_ids?: RequiredEntities;
  emotion_target?: string;
  conflict_target?: number;
  prev_chapter_summary?: string;
  status?: ChapterPlanStatus;
}

// ─── 生成任务 API ─────────────────────────────────────────────────────────────

export interface CreateGenerationTaskRequest {
  project_id: number;
  chapter_plan_id?: number;
  task_type: TaskType;
}

export interface GenerationTaskResponse {
  task: GenerationTask;
  chapter?: GeneratedChapter;
}

// ─── 章节生成 API ─────────────────────────────────────────────────────────────

export interface GenerateChapterRequest {
  project_id: number;
  chapter_plan_id: number;
  /** 是否基于上一版本修订 */
  revise_from_version?: number;
  /** 额外指令 */
  extra_instructions?: string;
}

export interface ChapterVersionsResponse {
  chapter_plan_id: number;
  versions: GeneratedChapter[];
  current_version: number;
}

// ─── 作者规则 API ─────────────────────────────────────────────────────────────

export interface CreateAuthorRuleRequest {
  project_id: number;
  rule_type: RuleType;
  rule_content: string;
  priority?: number;
}

export interface UpdateAuthorRuleRequest {
  rule_type?: RuleType;
  rule_content?: string;
  priority?: number;
  is_active?: boolean;
}

// ─── 诛仙知识库查询 API ───────────────────────────────────────────────────────

export interface EntitySearchParams {
  book_id?: number;
  keyword?: string;
  type?: string;
  faction_id?: number;
  tags?: string[];
  page?: number;
  page_size?: number;
}

export interface CharacterSearchResult {
  data: CharacterEntity[];
  total: number;
}

// ─── 上下文组装（供 LLM 使用） ────────────────────────────────────────────────

/** 章节生成上下文 */
export interface ChapterGenerationContext {
  project: CreativeProject;
  outline: StoryOutline | null;
  chapter_plan: ChapterPlan;
  prev_chapter_summary: string | null;
  characters: CharacterEntity[];
  factions: FactionEntity[];
  locations: LocationEntity[];
  skills: SkillEntity[];
  items: ItemEntity[];
  rules: AuthorRule[];
  world_settings: WorldSettingEntity[];
}

/** LLM 调用消息 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** LLM 调用请求 */
export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

/** LLM 调用响应 */
export interface LLMResponse {
  id: string;
  model: string;
  content: string;
  tokens_used: number;
  finish_reason: string;
}

// ─── 自定义人物模块（种族/姓名/天赋配置库与类型） ───────────────────────────────

export * from './custom-character/index.js';
