# 提示词体系（Prompt / Agent）

> 本项目 **没有独立的 prompt 模板文件目录**（不同于常见的 `/prompts/{module}/` 结构）：全部 prompt 逻辑内嵌在 `packages/server/src/agents/*.ts` 的 22 个 Agent 文件中，输出格式用 Zod 校验。
> 完整职责表见 `Novel-Studio-技术手册.md` §6.2。

## 设计原则

1. **每个 Agent 独立 prompt**：写作/审计/修订/抽取/命名/美化各有专用 Agent，不共用模板。
2. **system + user 两层**：`BaseAgent.buildMessages(system, user)` 固定拼装 `[{role:'system'}, {role:'user'}]`（见 `agents/base.ts`）。
3. **输出强制 JSON + Zod 校验**：结构化输出一律 Zod 校验；`BaseAgent.parseJsonResponse()` 依次尝试 ```json 代码块 → 裸 JSON → 首尾花括号截取 → 首尾方括号截取，全部失败抛错走降级分支。
4. **best-effort 降级红线**：任何 Agent 失败（超时/解析失败/LLM 不可用）→ 返回空/兜底值，记 generation_log，绝不阻断主流程。
5. **重试与容错**：`BaseAgent.callWithRetry/streamWithRetry` 默认重试 3 次；**认证错误不重试**，限流等待 `attempt×2000ms` 后重试。
6. **低温抽高温创**：抽取/评审类 Agent 用低温（0.1-0.4）保证确定性；创作类（Writer/分支）用高温（0.7-0.95）保证多样性。
7. **确定性校验约束 LLM**：LLM 只负责"生成/判断"，品阶上限、特效稀有度、副作用绑定、互斥组、禁用词等约束由后端规则代码把关（零 token、零误判），LLM 输出再校验一层。

## Agent 清单（25 个文件，含底座 BaseAgent）

### 核心生成管线 Agent

| Agent | 温度 | 职责 | 输入 → 输出 |
|-------|------|------|-------------|
| **ContextComposer**（非 LLM，编排器） | - | 从诛仙库 RAG 检索 + 创作库状态/伏笔/影响/成长注入，编排上下文包并按 token 预算裁剪 | 章节计划 + 项目配置 → ContextPackage |
| **WriterAgent** | 0.85 | 根据上下文包生成章节正文（`agents/writer.ts`，非流式 maxTokens 16384 / 流式 8192，预算给足供思考模型 reasoning token）；内置 `AI_FLAVOR_WORDS` 去 AI 味高频词表；注入【状态追踪】【关键剧情锚点】【未回收伏笔】【视角铁律】【章末铁律】【里程碑方向】等约束块 | ContextPackage + 章节计划 → 章节文本 |
| **AuditorAgent** | 低温 | **30 维审计** + 加权计分（情节逻辑+对白权重 1.5x）：人物连续性五类(1.1-1.5)/关系/门派/功法法宝/地点/情节逻辑五层因果链/情绪冲突/文笔/风格/状态/视角合规/分支承接/锚点覆盖/伏笔呼应/人物阶段/自定义功法法宝/对白张力/章末拉力/冲突强度/因果律与代价守恒/方向匹配/影响状态/命格资质/宗门身份/因果回收率/关系一致性/自定义人物 OOC/素材融入率/任务推进/认知越界 | 章节文本 + ContextPackage → AuditReport(score + dimensionScores + issues) |
| **ReviserAgent** | - | 按审计问题修订：**六层修订优先级**（逻辑>人物>场景>对白>章末>文风）+ 对白定向修订策略 + 去 AI 味分型改写；对话式修订 `reviseWithInstruction()` 严格按指令改、未涉及内容不动 | 章节文本 + AuditReport → 修订文本 + 修订笔记 |
| **StateExtractorAgent** | 0.2 | 生成后从正文抽取人物状态快照 + 时间线里程碑 + 任务链（v1.4 扩展 4 类），名字→ID 解析，pending 落库待人工确认 | 章节正文 + 元信息 → 状态快照/时间线/tasks |

### 叙事工程 Agent

| Agent | 温度 | 职责 | 输入 → 输出 |
|-------|------|------|-------------|
| **BranchGeneratorAgent** | 0.8 | 章节生成后推演 2-4 个下一章走向选项（含影响标签、借鉴四类剧情素材并自报 basedOn、保底 1 个 encounter 奇遇、并入世界观推演 prediction） | 正文 + 元信息 + 素材数组 + 世界观设定 → {options, prediction} |
| **StyleAuditorAgent** | 0.3 | 文风专项校验：禁用词本地精确匹配（零 token）+ 6 维 LLM 判定（心智/比例/意象/视角/反模式/句式）；反模式输出 aiFlavorType 5 分型 | 正文 + StyleContext → StyleAuditReport |
| **BranchForeshadowExtractorAgent** | 0.3 | 分支选定后抽取 2-3 条可前置埋设伏笔（必出 1 条 t1 核心 + 1-2 条 t2 细节，含 hint_clue/DNA） | 分支选项 → 待确认伏笔数组 |
| **CausalExtractorAgent** | 0.3 | 因果链 LLM 增强抽取（规则保底之上，最多 1 条，受 causalConfig.llmEnhance 控制） | 分支描述 → 因果线条目 |
| **GrowthAgent** | 0.6-0.95 | 成长工坊四操作：融合(0.8)/变异(0.95)/强化(0.6)/进化(0.7)，含三层确定性校验 | 源实体 + 操作参数 → GrowthResult |

### 工坊/素材 Agent

| Agent | 温度 | 职责 |
|-------|------|------|
| **NamingAgent** | - | 通用命名：武器/功法名号（仅名号走 LLM，特质随机走确定性引擎省 token） |
| **WeaponLoreAgent** | 0.7 | 兵器谱文案：名号/化名/一句话简介/配套招式（约 800 token） |
| **WeaponSenseCardAgent** | - | 五感兵器卡：真本事/怪毛病/前尘/名头/规矩/钩子/名场面 |
| **TechniqueLoreAgent** | 0.4 | 功法详解 500-700 字（核心逻辑/修行要点/战斗表现，约 1000 token；铁律：功法无品级只有道则深度） |
| **TechniqueVariantLoreAgent** | - | 千人千面个人化功法详解 |
| **CharacterMartialLoreAgent** | - | 武学档案融合小传（功法×武器） |
| **WorldEntityExtractorAgent** | 0.2 | 世界观文本抽取：粘贴设定 → 8 类实体结构化（约 3000 token，zod 逐类校验） |
| **ForgeSmartMatchAgent** | 0.3 | 三工坊智能匹配：自然语言描述 → 表单枚举参数映射（互斥/上限由后端确定性校验兜底） |
| **CustomEntityExtractorAgent** | 低温 | 章节实体自动维护：正文 → 新实体草稿 + 老实体动态（带已有名单排除，sensitivity 分档） |
| **QuoteJudgeAgent** | 0.1 | 金句五维评分（意境/韵律/哲理/情感/传播各 0-20）+ worthy 判定（内置反膨胀纪律，宁缺毋滥），本地求和定级 |
| **QuotePolisherAgent** | - | 金句三档美化（conservative 保守/balanced 意象升级/deep 升华重构），铁律"宁可不改不改坏" |
| **TraitNamingAgent** | - | 特质古风命名（保存时批量润色，降级标签拼接） |

### 双引擎工坊 Agent（v1.5）

| Agent | 职责 | 输入 → 输出 |
|-------|------|-------------|
| **ConflictGeneratorAgent** | 冲突引擎：欲望→阻力→代价三元组 + 七寸映射 + 情绪曲线四参数（expectation_peak/suppression_depth/drop_amplitude/cost_weight）；静态知识来自 desire-resistance-mapping/behavior-anchors | 场景上下文 + 人物/欲望 → 冲突方案 |
| **IcebergDialogueAgent** | 冰山台词引擎：真相层→表面层→行为层分层生成完整对白（full_dialogue + quality_score + executed_steps 分层留痕，支持按层重生成） | 场景上下文 + 潜台词 → 三层对白 |

### 整本拆文 Agent（v1.5.1）

| Agent | 温度 | 职责 | 输入 → 输出 |
|-------|------|------|-------------|
| **BenchmarkBookAnalyzerAgent** | 0.3 | 整本对标书逐章拆解：每章产出骨架（起承转合+情绪曲线+钩子）+ 0-3 条情节模式（冲突-转折结构）；Zod 校验 + 降级跳过；prompt 移植自 Python `benchmark_analyze.py` | 章节文本 + 书名 + 章序号 → { skeleton, plots[] } |

> 底座 **BaseAgent** 提供重试、超时、JSON 解析、Zod 校验、错误降级的通用能力，所有 Agent 继承之。

## 上下文构建要点（ContextComposer）

- **上下文块 20+ 项**（`ContextPackage`，见 `types.ts`）：chars/factions/locations/skills/items/relations、prevSummaries 前文摘要、scenes、chapterPlan、rules 作者规则、plotMaterials 四类素材（encounter/foreshadow/highlight/task，语义召回 + 确定性命中合并）、growthStages 成长阶段、collectedQuotes 收藏金句、style 文风指令、customEntities 自定义实体、resonanceEffects 特效共鸣、breakthroughNarrative 突破叙事、状态快照/时间线、影响状态、因果待兑现、分支上下文、里程碑方向、地图地点等。
- **角色心智三层**（v1.4 PRD-A，`context-builder.ts` 的 `buildVoiceContextBlock` / `buildKnowledgeContextBlock` / `buildMemoryContextBlock`）：`character_voice_config` 声音配置（说话方式/口癖/语气/示例台词/禁用表达）、`character_knowledge` 已知信息（core/common/secret 分级 + acquiredChapter 获知章，供信息差写作与认知越界审计）、`character_memory_card` 记忆卡（经历摘要+情绪印记）。
- **人物心智模型层（需求5）**：为每个出场人物附加诛仙库蒸馏的 `mentalModels`（心智模型 one_liner）/`heuristics`（决策启发式"规则名：规则内容"）/`lifeStages`（人生阶段），让人物言行有内在依据。
- **功法蒸馏层（需求11）**：zaomeng 工具将功法蒸馏写入诛仙库 4 表（属性/招式/关系/归档），管线批量加载后 Writer 渲染「功法属性/招式/功法关系」，战斗场景可引用具体招式名与克制关系。
- **自定义实体层（模块9）**：按 `linked_character_ids` 与出场人物交集匹配注入自定义功法/法宝，Writer 渲染【自定义功法/法宝设定】块（品阶/特效/副作用 + 铁律"不得凭空新增未列出能力"）。
- **收藏金句参考**：`getCollectedQuotes()` 人物感知召回（POV/出场人物优先 + 质量分补足），失败返回空不阻断。
- **素材召回双通道**：`mergePlotMaterials()` 合并语义召回（`plot-material-retriever.ts` 向量/关键词）与确定性命中（固定素材 pinnedMaterialIds），`buildHardFacts()` 组装硬事实块。

## 风格约束

- **诛仙仙侠古风**：文风引擎三层结构——全局配置（`style_global_config`）/ 场景维度映射（`style_scene_mapping`，按情绪/功能/交互建 triggerKey）/ 禁用词表（`style_banned_word`）。
- **文风档位预设**：4 个任务级临时档位（热血战斗/抒情/日常轻松/诡异悬疑），覆盖式合并不改全局。
- **去 AI 味 5 分型**：`empty_summary` 空泛总结 / `cliche_atmosphere` 套话氛围 / `adjective_stack` 形容堆叠 / `explanatory_dialogue` 解释腔 / `uniform_rhythm` 平均工整——StyleAuditor 输出分类，Reviser 按分型生成定向改写指令。
- **章末铁律（4条）**：禁总结句 / 停在变化拍 / 不说满 / 末句短。

## 铁律（LLM 不可越权）

1. **POV 视角约束**：声明了 POV 人物时注入【视角铁律】块——单视角全程锚定一人、多视角场景切换分隔、任一时刻只锚定一人、禁止写他人内心/上帝视角；Auditor 第 11 维审查越界（major）。
2. **禁用词硬扫描**：生成后本地精确匹配扫描（零 token、零误判），命中即 critical；Writer 侧另有 `AI_FLAVOR_WORDS` 高频词表主动规避（然而/不禁/仿佛/一抹/淡淡 等）。
3. **确定性校验约束 LLM**：品阶-特效稀有度、副作用绑定、方向互斥、功法道则相容性等一律由规则代码拦截，LLM 输出违规即拒绝。
4. **锚点必覆盖**：声明了 must_have_events 时 Writer 必须按序覆盖，Auditor 第 13 维审查（遗漏 critical）。
5. **信息差与认知越界**：角色已知信息（character_knowledge）按获知章过滤注入，Auditor 审查认知越界（写了角色不可能知道的事）；memory-card 自动抽取为低置信。
6. **best-effort**：所有 LLM 增强能力失败时降级为空、不阻断主流程。
