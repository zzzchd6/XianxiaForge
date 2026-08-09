/**
 * 服务端内部类型定义
 */

/** 审计问题严重程度 */
export type Severity = 'critical' | 'major' | 'minor' | 'info';

/** 审计问题 */
export interface AuditIssue {
  severity: Severity;
  dimension: string;
  description: string;
  suggestion: string;
}

/** 审计报告 */
export interface AuditReport {
  issues: AuditIssue[];
  overallScore: number;
  /** 各维度分项得分（0-100），键为维度名（写作质量增强模块，用于加权计分） */
  dimensionScores?: Record<string, number>;
}

/** 文风校验问题（带原文片段定位，需求13） */
export interface StyleIssue {
  /** 维度名：心智模型/描写比例/核心意象/禁用词/视角规则/反模式/句式规则 */
  dimension: string;
  severity: Severity;
  description: string;
  suggestion: string;
  /** 违规原文片段，供前端定位并高亮（禁用词由本地扫描精确给出，其余由LLM摘录） */
  excerpt?: string;
  /** 去AI味五分型分类（写作质量增强R3，仅反模式维度命中时标注） */
  aiFlavorType?: 'empty_summary' | 'cliche_atmosphere' | 'adjective_stack' | 'explanatory_dialogue' | 'uniform_rhythm' | 'cliche_metaphor' | 'parallel_padding' | 'psych_overload';
}

/** 文风校验报告（需求13） */
export interface StyleAuditReport {
  /** 综合文风得分（百分制） */
  overallScore: number;
  /** 各维度分项得分（0-100），键为维度名 */
  dimensionScores: Record<string, number>;
  issues: StyleIssue[];
}

/** 上下文包 - 传递给写作Agent的完整上下文 */
export interface ContextPackage {
  /** 核心人物设定 */
  characters: CharacterContext[];
  /** 门派/组织设定 */
  factions: FactionContext[];
  /** 地点设定 */
  locations: LocationContext[];
  /** 功法设定 */
  skills: SkillContext[];
  /** 法宝设定 */
  items: ItemContext[];
  /** 人物关系 */
  relations: RelationContext[];
  /** 前文摘要 */
  prevSummaries: string[];
  /** 相关场景分析 */
  scenes: SceneContext[];
  /** 章节计划 */
  chapterPlan: ChapterPlanContext;
  /** 作者规则 */
  rules: string[];
  /** 作者风格铁律（来自诛仙库风格层，可选） */
  style?: StyleContext;
  /** 人物状态快照（最近已确认，可选） */
  stateSnapshots?: CharacterStateContext[];
  /** 时间线里程碑（最近已确认，可选） */
  timelineMilestones?: TimelineMilestoneContext[];
  /** 未回收伏笔线（pending/planted，模块2，可选） */
  foreshadows?: ForeshadowContext[];
  /** 进行中的任务线（active/progressing，素材深度融入·第2层，可选） */
  activeTasks?: ActiveTaskContext[];
  /** 人物成长阶段（按当前章节号匹配，模块3，可选） */
  growthStages?: GrowthStageContext[];
  /** 已收藏金句（模块11，可选注入强化人物说话风格） */
  collectedQuotes?: { characterName?: string; quoteText: string }[];
  /** 自定义功法/法宝（模块9，关联到出场人物的自定义实体） */
  customEntities?: CustomEntityContext[];
  /** 特效共鸣（模块9二期，同一人物多实体共享特效类型时触发的组合加成描述） */
  resonanceEffects?: { characterName: string; entities: string[]; resonanceType: string; description: string }[];
  /** 剧情分支上下文（本章由分支选项衍生时注入，可选） */
  branchContext?: BranchContext;
  /** 动态叙事引擎上下文（下一个待达成里程碑 + 活跃分支弧双轨参照，12-SRS，可选） */
  narrativeContext?: { text: string | null };
  /** 剧情素材召回（二期RAG，语义召回的奇遇/伏笔/高光/任务链，可选） */
  plotMaterials?: PlotMaterialContext[];
  /** 对标素材召回（开源借鉴 PRD v1.1 M5，拆文产出的角色卡/剧情单元/文风/设定，可选） */
  benchmarkMaterials?: BenchmarkMaterialContext[];
  /** 领域知识召回（二期RAG，语义召回的专业知识条目，可选） */
  domainKnowledge?: DomainKnowledgeContext[];
  /** 参考文风预设（二期RAG，精确取或语义召回，参考而非覆盖现有文风引擎，可选） */
  stylePresetRag?: StylePresetRagContext;
  /** 伏笔写作联动（本章需埋设/回收的伏笔及其定向召回的「伏笔手法」素材，可选） */
  foreshadowTechniques?: ForeshadowTechniqueContext[];
  /** 成长高光联动（本章发生阶段跃迁/关键节点的人物及其定向召回的「高光」素材，可选） */
  growthHighlights?: GrowthHighlightContext[];
  /** 成长弧光三向联动（阶段跃迁×影响数值 + 关系升华×关系状态，纯文本块，可选） */
  growthLinkageContext?: { text: string | null };
  /** 分支影响体系上下文（出场人物的数值属性/生效状态 + 世界观状态，Writer 影响铁律的唯一数值权威，可选） */
  impactContext?: ImpactContext;
  /** 人物关系状态上下文（出场人物两两关系维度，阶段4，可选） */
  relationContext?: { text: string | null };
  /** 待回收因果线上下文（当前章节应关注的未兑现因果，阶段4，可选） */
  causalContext?: { text: string | null };
  /** 硬性事实约束（从人物/状态/时间线提取的不可违反事实，Writer 必须遵守，quality-gate 据此校验） */
  hardFacts?: HardFactsContext;
  /** 叙事技法原则性指导（从 technique_atom.generation_guidance 提取，注入 Writer system prompt） */
  techniqueGuidance?: string[];
  /** v1.4 生成功能开关（来自 project.generation_config，控制三节结构/声音/知识/认知越界等新特性块） */
  generationFlags?: Record<string, any>;
  /** 角色声音配置块（v1.4 PRD-A 注入式声音方案，可选） */
  voiceContext?: { text: string | null };
  /** 角色已知信息清单块（v1.4 PRD-A 信息差写作参照，可选） */
  knowledgeContext?: { text: string | null };
  /** 冰山台词参考（FUNC-01：双引擎工坊生成的冰山对话存入 characterKnowledge，Writer 注入强化潜台词风格） */
  icebergDialogues?: { characterName?: string; snippet: string; chapterNo?: number }[];
}

/** 硬性事实约束上下文（从现有表提取的不可违反事实，注入 Writer 系统提示 + quality-gate 校验依据） */
export interface HardFactsContext {
  /** 人物事实条目（性别/代词/境界/关键背景） */
  characterFacts: Array<{
    name: string;
    /** 性别：male/female（自定义人物有显式字段，诛仙库人物从 personality 推断或留空） */
    gender?: 'male' | 'female';
    /** 对应人称代词 */
    pronoun?: '他' | '她';
    /** 当前确认境界（来自 state_snapshot 最新确认值） */
    realm?: string;
    /** 关键背景事实（从 personality/bio 提取的不可变描述片段） */
    keyFacts?: string[];
    /** 15-SRS P0-4：draft 人物回流标记，序列化时标注"（待确认）" */
    pending?: boolean;
  }>;
  /** 时间锚点（来自 timeline_milestone 已确认的关键节点） */
  timeAnchors: Array<{
    chapterNo: number;
    storyTime?: string;
    title: string;
  }>;
  /** 序列化后的硬约束文本（直接注入 Writer prompt） */
  serialized: string;
}

/** 分支影响体系上下文块（影响快照是数值状态的单一权威来源） */
export interface ImpactContext {
  /** 人物影响块：出场人物当前的数值属性与生效状态标签 */
  characterBlocks: { characterId: number; characterName: string; text: string }[];
  /** 世界观影响块（区域/全局状态），无则为 null */
  worldBlock: string | null;
}

/** 剧情素材召回条目（二期RAG） */
export interface PlotMaterialContext {
  id: number;
  /** 来源表（encounter/foreshadow/highlight/task） */
  table: string;
  title: string;
  corePlot: string;
  triggerCondition?: string;
  reward?: string;
  costOrRisk?: string;
  emotionalBeat?: string;
  applicableSceneType?: string;
  tags?: string[];
  qualityScore?: number;
  /** 余弦相似度得分 */
  score: number;
  /** 是否为作者手动固定的素材（true=本章必须融入） */
  pinned?: boolean;
}

/** 对标素材上下文（开源借鉴 PRD v1.1 M5，拆文产出的结构化对标资产） */
export interface BenchmarkMaterialContext {
  id: number;
  /** 对标书名 */
  sourceBookTitle: string;
  /** 素材类型：character=角色卡 / plot_unit=剧情单元 / style=文风分析 / setting=设定 */
  materialType: string;
  title: string;
  contentMd: string;
  tags?: string[];
  /** 是否为作者手动置顶（true=本章必须借鉴融入） */
  pinned?: boolean;
}

/** 伏笔写作联动条目 - 本章需埋设/回收的某条伏笔，及其定向召回的「伏笔手法」素材
 *  Writer 据此在埋/收伏笔时参考成熟手法（如何留线索、如何呼应回收） */
export interface ForeshadowTechniqueContext {
  foreshadowId: number;
  foreshadowTitle: string;
  /** 本章对该伏笔的动作：plant=本章埋设，resolve=本章回收 */
  action: 'plant' | 'resolve';
  /** 定向召回的伏笔手法素材（plot_material_foreshadow） */
  techniques: PlotMaterialContext[];
}

/** 成长高光联动条目 - 本章发生阶段跃迁或命中关键节点的某个人物，及其定向召回的「高光」素材
 *  Writer 据此在阶段跃迁处参考成熟的高光时刻写法（突破/觉醒/升华如何渲染） */
export interface GrowthHighlightContext {
  characterName?: string;
  characterId?: number;
  /** 跃迁前阶段名（首章无前一阶段时为 undefined） */
  fromStage?: string;
  /** 跃迁后（当前）阶段名 */
  toStage: string;
  /** 当前阶段是否为作者标记的关键节点 */
  isKeyNode?: boolean;
  /** 定向召回的高光素材（plot_material_highlight） */
  highlights: PlotMaterialContext[];
}

/** 领域知识召回条目（二期RAG） */
export interface DomainKnowledgeContext {
  id: number;
  knowledgeType: string;
  applicableDomain?: string;
  title: string;
  content: string;
  tags?: string[];
  qualityScore?: number;
  score: number;
}

/** 参考文风预设（二期RAG，定位为参考而非覆盖） */
export interface StylePresetRagContext {
  id: number;
  styleName: string;
  author?: string;
  mentalModels?: string[];
  decisionHeuristics?: string[];
  descriptionRatio?: any;
  sentenceRules?: any;
  coreImagery?: string[];
  forbiddenWords?: string[];
  perspectiveRules?: string[];
  antiPatterns?: string[];
  confidence?: number;
}

/** 剧情分支上下文 - 本章由玩家选定的分支选项衍生时注入
 *  Writer 据此锚定走向，Auditor 据此检查承接一致性 */
export interface BranchContext {
  /** 所选分支选项标题 */
  selectedOptionTitle: string;
  /** 所选分支选项描述（走向说明） */
  selectedOptionDescription: string;
  /** 分支选项预设的下一章意图 */
  nextChapterIntent: string;
  /** 场景提示（结构化，可选） */
  nextSceneHint?: any;
  /** 影响标签历史栈（沿分支链回溯累积，时间正序） */
  impactTagsHistory: string[];
  /** 本章主方向编码（方向体系，可选） */
  mainDirection?: string;
  /** 本章主方向显示名（供审计/写作参照，可选） */
  mainDirectionName?: string;
  /** 本章主方向释义（供审计判断正文是否贴合，可选） */
  mainDirectionDefinition?: string;
}

/** 未回收伏笔上下文 - 本项目尚未回收的伏笔线（模块2）
 *  Writer 据此在合适处自然呼应/埋设，Auditor 据此检测伏笔命中 */
export interface ForeshadowContext {
  id: number;
  /** 伏笔标题 */
  title: string;
  /** 伏笔描述 */
  description?: string;
  /** 埋设线索（用于在正文中识别是否已埋入/回收） */
  hintClue?: string;
  /** 状态：pending(待埋入) / planted(已埋设) */
  status: string;
  /** 优先级：high / normal / low */
  priority?: string;
  /** 埋设章节号 */
  plantChapter?: number;
  /** 计划回收章节号 */
  resolveChapter?: number;
  /** 伏笔分级：t1战略级/t2战役级/t3普通 */
  tier?: string;
  /** 载体DNA：主体 */
  dnaSubject?: string;
  /** 载体DNA：动作 */
  dnaAction?: string;
  /** 载体DNA：客体 */
  dnaObject?: string;
  /** 载体DNA：核心情绪 */
  dnaEmotion?: string;
  /** 作者手动绑定的伏笔手法素材ID（plot_material_foreshadow，A2，写作时强制取用） */
  referencedMaterialId?: number;
}

/** 进行中的任务线上下文 - 跨章状态机台账（素材深度融入·第2层，镜像 ForeshadowContext） */
export interface ActiveTaskContext {
  id: number;
  /** 任务标题 */
  title: string;
  /** 任务描述 */
  description?: string;
  /** 进度线索（用于在正文中识别任务是否被推进/完成） */
  progressClue?: string;
  /** 状态：active(待推进) / progressing(推进中) */
  status: string;
  /** 优先级：high / normal / low */
  priority?: string;
  /** 任务分级：t1战略级/t2战役级/t3普通 */
  tier?: string;
  /** 任务开始章节号 */
  startChapter?: number;
  /** 目标/计划完成章节号 */
  targetChapter?: number;
  /** 关联剧情素材ID数组（plot_material_*） */
  referencedMaterialIds?: number[];
  /** 关联角色ID数组 */
  relatedCharacterIds?: number[];
}

/** 人物成长阶段上下文 - 按当前章节号匹配到的成长阶段（模块3）
 *  Writer 据此锚定人物当前阶段的性格/能力/行事风格，Auditor 据此校验阶段一致性 */
export interface GrowthStageContext {
  characterId?: number;
  characterName?: string;
  stageNo: number;
  name: string;
  traits: string[];
  description?: string;
  /** 阶段类型（B2）：境界突破/心境转变/能力觉醒/关系升华 */
  stageType?: string;
  /** 是否为作者标记的关键节点（B2，命中即强制召回高光素材） */
  isKeyNode?: boolean;
}

/** 风格上下文 - 由 style_global_config + style_scene_mapping 组装 */
export interface StyleContext {
  /** 风格名称（如"萧鼎仙侠"） */
  styleName?: string;
  /** 作者心智模型 */
  mentalModels?: string[];
  /** 决策启发式 */
  decisionHeuristics?: string[];
  /** 描写比例（场景/动作/对话/心理） */
  descriptionRatio?: {
    scene?: number;
    action?: number;
    dialogue?: number;
    psychology?: number;
  };
  /** 核心意象词库 */
  coreImagery?: string[];
  /** 禁用词 */
  forbiddenWords?: string[];
  /** 句式规则（键值对，如 climax_short/opening_short） */
  sentenceRules?: Record<string, any>;
  /** 视角规则 */
  perspectiveRules?: string[];
  /** 反模式（严禁的写法） */
  antiPatterns?: string[];
  /** 按本章情绪尽力匹配到的场景风味描述（emotion_imagery） */
  matchedSceneFlavor?: string[];
}

/** 人物状态快照上下文 - 某人物在指定章节后的最新确认状态 */
export interface CharacterStateContext {
  characterId?: number;
  characterName?: string;
  /** 快照对应的章节号（0=初始状态） */
  asOfChapter: number;
  location?: string;
  realm?: string;
  injury?: string;
  mentalState?: string;
  possessedItems?: string[];
}

/** 时间线里程碑上下文 */
export interface TimelineMilestoneContext {
  chapterNo: number;
  storyTime?: string;
  title: string;
  description?: string;
  importance?: string;
}

/** 人物上下文 */
export interface CharacterContext {
  id: number;
  name: string;
  /** 性别（自定义人物有显式字段，诛仙库人物可为空） */
  gender?: 'male' | 'female';
  allTitles?: string[];
  personality?: string;
  faction?: string;
  realm?: string;
  coreSkills?: string[];
  growthLine?: string[];
  writingProfile?: any;
  /** 心智模型 one_liner（深层行为逻辑，诛仙库蒸馏） */
  mentalModels?: string[];
  /** 决策启发式（"规则名: 规则内容"，诛仙库蒸馏） */
  heuristics?: string[];
  /** 人生阶段（"阶段名: 性格状态"，诛仙库蒸馏） */
  lifeStages?: string[];
  /** 当前成长阶段（按本章章节号匹配，模块3） */
  currentGrowthStage?: {
    name: string;
    traits: string[];
    description?: string;
  };
  // ─── 自定义人物扩展字段（负数ID，来自创作库 custom_character） ───
  /** 人物来源：'custom'=项目自定义人物（负数ID），缺省=诛仙库原生人物 */
  source?: 'custom';
  /** 实力定位（五档定位名+职能描述，不映射具体境界） */
  position?: string;
  /** 伪装定位（扮猪吃虎，对外示人的低档定位） */
  fakePosition?: string;
  /** 立场描述（如"浩然正气（12/100）"） */
  stance?: string;
  /** 外在性格标签（接入OOC审计） */
  outerPersonality?: string[];
  /** 先天禀赋（含词条说明） */
  talents?: string[];
  /** 擅长标签 */
  strengths?: string[];
  /** 短板标签 */
  weaknesses?: string[];
  /** 人物小传 */
  bio?: string;
  /** 人物武学档案（功法×武器招式融合小传 + 融合招式，自定义人物；一人可多条搭配） */
  martialLores?: {
    techniqueName?: string;
    weaponName?: string;
    biography?: string;
    fusedMoves?: { name: string; desc: string; source?: string }[];
  }[];
}

/** 门派上下文 */
export interface FactionContext {
  id: number;
  name: string;
  camp?: string;
  headquarters?: string;
  leader?: string;
  cultivationFeature?: string;
}

/** 地点上下文 */
export interface LocationContext {
  id: number;
  name: string;
  level?: string;
  environment?: string;
  relatedFaction?: string;
  keyEvents?: string[];
}

/** 功法上下文 */
export interface SkillContext {
  id: number;
  name: string;
  grade?: string;
  skillType?: string;
  coreEffect?: string;
  threshold?: string;
  /** 功法属性（"品阶：效果"，诛仙库蒸馏） */
  attributes?: string[];
  /** 招式（"招式名：效果"，诛仙库蒸馏） */
  moves?: string[];
  /** 功法关系（"关系类型 目标功法：描述"，诛仙库蒸馏） */
  relations?: string[];
}

/** 法宝上下文 */
export interface ItemContext {
  id: number;
  name: string;
  grade?: string;
  coreAbilities?: string;
  owners?: string[];
}

/** 自定义功法/法宝上下文（模块9，成长工坊产出的项目级实体） */
export interface CustomEntityContext {
  id: number;
  entityType: 'skill' | 'magic_item' | 'weapon' | 'technique';
  name: string;
  /** 品级名（功法无品级，故可选） */
  grade?: string;
  /** 品级层数（功法无品级，故可选） */
  gradeLevel?: number;
  coreEffect?: string;
  effects: { name: string; type: string; rarity: string; description: string; strength: number }[];
  sideEffects?: string;
  growthType: string;
  evolutionStage?: string;
  isEvolved?: boolean;
  /** 突破叙事片段（融合/进化时生成，供写作引用） */
  breakthroughNarrative?: string;
  /** 关联人物ID数组（用于特效共鸣分组） */
  linkedCharacterIds?: number[];
  /** 武器对外化名（敛藏锋芒，文案生成Skill产出） */
  fakeName?: string;
  /** 武器一句话简介（文案生成Skill产出） */
  intro?: string;
  /** 武器配套招式（文案生成Skill产出，梯度：基础→进阶→特质→杀招） */
  moves?: { name: string; desc: string }[];
  /** 功法：道则组合摘要（主修+辅修，如「庚金 + 神魂」） */
  daoComposition?: string;
  /** 功法：传法指引深度中文名（入门指引/完整传承/直指本源，非品级） */
  guidanceDepth?: string;
  /** 功法：分道境神通摘要（按入微/化境/合道/超脱分组） */
  realmAbilities?: string;
  /** 功法：反噬代价摘要（含风险等级） */
  backlashSummary?: string;
  /** 功法：详解片段（LLM生成，供写作/审计引用） */
  description?: string;
  /** 功法：道则ID集合（主修+辅修，供确定性道则边界扫描） */
  daoIds?: string[];
  /** 功法：是否对冲融合/内置冲突（应有反噬代价，供确定性反噬缺失扫描） */
  isClash?: boolean;
  /** 功法：传法指引深度原始ID（rudimentary/complete/essential，供确定性入门越界扫描） */
  guidanceDepthId?: string;
  /** 功法：各人物的个人变种摘要（千人千面，供写作/审计体现差异化修炼） */
  variantSummary?: string;
  /** 武器五感卡：真本事描写（供写作引用） */
  realSkill?: string;
  /** 武器五感卡：怪毛病（供写作/审计OOC检测） */
  weirdTrait?: string;
  /** 武器五感卡：专属规矩（供写作/审计OOC检测） */
  weaponRules?: string;
  /** 武器五感卡：江湖外号 */
  jianghuNickname?: string;
  /** 武器：生成式特质摘要（方向组合系统，含稀有/瑕疵标记） */
  generatedTraitSummary?: string;
  /** 武器：瑕疵列表（供审计检测「只写增益不写瑕疵」OOC） */
  weaponFlaws?: string[];
}

/** 人物关系上下文 */
export interface RelationContext {
  charAId: number;
  charBId: number;
  relType: string;
  interactCount?: number;
  /** 关系描述（自定义关系，模块8） */
  description?: string;
  /** 互动模式（自定义关系，模块8） */
  interactPattern?: string;
  /** 来源：native=诛仙库原生 / custom=用户推演自定义（模块8） */
  source?: 'native' | 'custom';
}

/** 场景上下文 */
export interface SceneContext {
  id: number;
  sceneNo: number;
  coreEvent?: string;
  emotionMainType?: string;
  conflictLevel?: string;
}

/** 章节计划上下文 */
export interface ChapterPlanContext {
  id: number;
  chapterNumber: number;
  volumeNo?: number;
  title: string;
  intent: string;
  targetWordCount: number;
  targetEmotion?: string;
  conflictType?: string;
  sceneBreakdown?: string;
  /** POV限知视角人物ID数组（章节计划声明，空=不启用硬约束） */
  povCharacterIds?: number[];
  /** POV视角人物姓名（由ID解析，供Writer/Auditor渲染） */
  povCharacterNames?: string[];
  /** 关键剧情锚点（模块1）：本章必须按序覆盖的强制事件，空=不启用 */
  mustHaveEvents?: string[];
  /** 章末钩子类型（需求6）：suspense/emotion/turn/crisis/reveal */
  hookType?: string;
  /** 钩子强度（需求6）：light/medium/heavy */
  hookIntensity?: string;
  /** 冲突值分值（天命P0#1） */
  conflictScore?: number;
  /** 冲突星级（天命P0#1）：如 ★★★★☆ */
  conflictRating?: string;
  /** 是否峰值章节（天命P0#1） */
  isPeak?: boolean;
  /** 章节类型（天命P1#4） */
  chapterType?: string;
}

/** 实体ID集合（显式声明 / 自动关联共用结构） */
export interface EntityIdSet {
  characters: number[];
  factions: number[];
  locations: string[];
  skills: number[];
  items: number[];
}

/** 检索元信息：记录本次生成从诛仙库检索到了什么、来源是什么 */
export interface RetrievalInfo {
  /** 章节计划中显式声明的实体ID（人物下发） */
  explicit: EntityIdSet;
  /** 通过章节文本自动关联匹配到的实体ID */
  autoLinked: EntityIdSet;
  /** 各类实体最终检索数量 */
  counts: {
    characters: number;
    factions: number;
    locations: number;
    skills: number;
    items: number;
    relations: number;
    prevSummaries: number;
  };
  /** 上下文token估算 */
  estimatedTokens: number;
}

/** 生成流事件类型 */
export type GenerationStreamEventType = 'token' | 'status' | 'audit' | 'context' | 'branch_ready' | 'complete' | 'error' | 'pre_check' | 'plot_duplication_warning' | 'hook_rotation_warning' | 'entities_extracted' | 'teleport_warning' | 'post_update_step' | 'post_update_step_failed';

/** 生成流事件 */
export interface GenerationStreamEvent {
  type: GenerationStreamEventType;
  data: any;
  timestamp: number;
}

/** 生成任务状态 */
export type TaskStatus = 'pending' | 'running' | 'auditing' | 'revising' | 'completed' | 'failed' | 'cancelled';

/** LLM配置 */
export interface LlmConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/** 生成选项 */
export interface GenerationOptions {
  /** 是否跳过审计 */
  skipAudit?: boolean;
  /** 是否跳过修订 */
  skipRevision?: boolean;
  /** 项目级LLM配置覆盖 */
  llmConfig?: LlmConfig;
  /** 最大修订次数 */
  maxRevisions?: number;
  /** 临时文风预设ID（模块7，仅本次任务生效，不修改全局配置） */
  stylePreset?: string;
  /** 覆盖章节计划的目标字数（用户在控制台手动设置时优先） */
  targetWords?: number;
  /** 断点续跑：从指定步骤名重新开始（之前的步骤用 checkpoint 产出恢复），架构升级 Epic1 */
  resumeFrom?: string;
  /** 欠账门强制继续（开源借鉴PRD M1：二次确认后跳过上一章 blocking 拦截，留痕日志） */
  forceContinue?: boolean;
}

/** 修订结果 */
export interface RevisionResult {
  revisedContent: string;
  revisionNotes: string[];
}
