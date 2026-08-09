# 指尖仙侠 技术手册

AI小说创作系统 — 基于诛仙世界观数据库的多Agent管线章节生成平台

---

## 1. 系统概述

指尖仙侠 是一个本地化部署的AI小说创作工具，核心能力是：以诛仙小说结构化数据库（33表/3层/pgvector 512维向量）为世界观知识源，通过多Agent管线自动生成符合设定的小说章节。

系统采用 TypeScript 全栈开发，pnpm monorepo 组织，前后端分离架构，一键启动。

> **当前版本 v1.5.1**（2026-08-07）：在 v1.5 基础上完成 .env 统一合并、整本拆文 Node 化（新增 BenchmarkBookAnalyzerAgent + benchmark-worker）、新书引导向导、废数据字段标记（26条COMMENT）、模块合并与导航精简。详见 `docs/TODO.md`。

### 1.1 核心特性

- 双库联动：诛仙库（RAG检索 + 世界观CRUD）+ 创作库（读写项目数据）
- 多Agent管线：ContextComposer → WriterAgent → AuditorAgent → ReviserAgent，生成后由 StateExtractorAgent 自动抽取人物状态/时间线（pending待确认）
- SSE流式输出：生成过程实时推送到前端
- OpenAI-compatible接口：支持任意兼容API（DeepSeek/OpenAI/Claude/本地模型）
- 世界观浏览：人物/门派/地点/功法/法宝/妖兽/灵材/信物等多类检索，支持按书籍（book_id）切换隔离、条目CRUD 与文风引擎（全局配置+场景映射+禁用词）
- 场景脚本编排：拖拉拽编排场景节点，结构化字段编辑，智能匹配素材池，节点-素材关联增删改，一致性深度校验（时间线/地点/结构），保存时反写卷大纲
- 全局状态追踪：人物状态快照 + 时间线里程碑，防设定漂移
- 伏笔台账：伏笔线登记、状态流转、超期未回收提醒
- 多版本章节管理：支持版本历史和人工编辑

### 1.2 技术栈

| 层级 | 技术选型 |
|------|----------|
| 后端框架 | Hono 4.6 + @hono/node-server |
| ORM | Drizzle ORM 0.36 (async, pg-core) |
| 数据库 | PostgreSQL + pgvector (512维) |
| LLM客户端 | openai SDK 4.70 (OpenAI-compatible) |
| 校验 | Zod 3.23 |
| 前端框架 | React 19 + React Router 7 |
| 构建工具 | Vite 6 |
| 样式 | TailwindCSS 3.4 |
| 状态/请求 | TanStack Query 5 |
| 拖拽交互 | @dnd-kit (core 6 / sortable 10 / utilities 3) |
| 图标 | Lucide React |
| 包管理 | pnpm (workspace monorepo) |
| 运行时 | Node.js 20+ / tsx (dev) |

---

## 2. 项目结构

```
novel-studio/
├── .env                          # 环境变量（数据库连接、LLM配置）
├── package.json                  # monorepo根配置
├── pnpm-workspace.yaml           # pnpm工作区定义
├── start.bat                     # Windows一键启动脚本
├── tsconfig.json                 # 根TS配置
│
├── packages/
│   ├── server/                   # 后端服务
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── env.ts            # 环境变量加载（必须最先import）
│   │       ├── index.ts          # 服务入口（Hono app）
│   │       ├── types.ts          # 内部类型定义
│   │       ├── db/
│   │       │   ├── index.ts      # 双库连接实例
│   │       │   ├── zhuxian-schema.ts   # 诛仙库Drizzle Schema
│   │       │   └── creative-schema.ts  # 创作库Drizzle Schema
│   │       ├── llm/
│   │       │   └── client.ts     # LLM客户端（流式/非流式）
│   │       ├── rag/
│   │       │   ├── retriever.ts       # RAG检索器
│   │       │   ├── context-builder.ts # 上下文编排器
│   │       │   └── style.ts          # 文风引擎（全局配置+场景映射+禁用词）
│   │       ├── agents/
│   │       │   ├── base.ts       # Agent基类
│   │       │   ├── writer.ts     # 写作Agent
│   │       │   ├── auditor.ts    # 审计Agent（30维）
│   │       │   ├── reviser.ts    # 修订Agent
│   │       │   ├── extractor.ts  # 状态抽取Agent（生成后抽取状态/时间线）
│   │       │   ├── branch.ts     # 分支生成Agent（走向选项+方向打标+世界观推演，需求12）
│   │       │   ├── branch-foreshadow-extractor.ts # 分支衍生伏笔抽取Agent（6.18）
│   │       │   ├── causal-extractor.ts # 因果线LLM增强抽取Agent（6.19）
│   │       │   ├── style-auditor.ts # 文风专项审计Agent（需求13，8维）
│   │       │   ├── growth.ts     # 成长工坊Agent（融合/变异/强化/进化，模块9）
│   │       │   ├── naming.ts     # 通用命名Agent（武器/功法名号骰子）
│   │       │   ├── weapon-lore.ts # 武器文案Agent（名号/化名/简介/招式→weapon_lore）
│   │       │   ├── weapon-sense-card.ts # 五感兵器卡Agent（真本事/怪毛病/前尘/名头/规矩/钩子/名场面，7.30）
│   │       │   ├── trait-naming.ts # 特质古风命名Agent（保存时批量润色，降级标签拼接，7.31）
│   │       │   ├── technique-lore.ts # 功法详解+配套招式Agent（6.28/7.30）
│   │       │   ├── technique-variant-lore.ts # 千人千面LLM个人化详解Agent（7.30）
│   │       │   └── character-martial-lore.ts # 武学档案融合小传Agent（7.30）
│   │       │   ├── world-entity-extractor.ts # 世界观文本抽取Agent（WS3，粘贴文本→8类实体结构化）
│   │       │   ├── forge-smart-match.ts # 三工坊智能匹配Agent（WS4，描述→枚举参数映射）
│   │       │   ├── custom-entity-extractor.ts # 章节实体自动抽取Agent（6.33，正文→新实体草稿+老实体动态）
│   │       │   ├── quote-judge.ts  # 金句评审Agent（五维评分+反膨胀纪律，6.35）
│   │       │   └── quote-polisher.ts # 金句美化Agent（三档版本，6.35）
│   │       ├── data/
│   │       │   ├── weapon-catalog.ts    # 神兵坊静态词条库（门类/形制/材料/特质）
│   │       │   ├── trait-directions.ts  # 方向组合式特质静态定义（4类×4维度×56方向+稀有/瑕疵7条/叠锻规则，类别:道胎铸炼/灵真温养/外相加持/内景洞天，7.31）
│   │       │   └── technique-catalog.ts # 九大道则静态词条库+兼容矩阵（6.28）
│   │       ├── state/
│   │       │   └── store.ts      # 全局状态存储（状态快照/时间线/前文摘要查询）
│   │       ├── services/
│   │       │   ├── outline-writeback.ts # 卷大纲keyEvents反写服务（剧情分支/场景脚本共用，覆盖+备份一次原文）
│   │       │   ├── branch-context.ts    # 分支素材召回(四类)+世界观汇聚+basedOn解析（需求12素材标注/推演）
│   │       │   ├── health-check.ts      # 9维创作体检服务（纯规则零LLM，P2#7+阶段3/4扩展）
│   │       │   ├── direction-catalog.ts # 方向字典（10大类41方向+关键词打标，6.19/6.21）
│   │       │   ├── direction.service.ts # 方向统计/均衡度/连续方向校验（6.19）
│   │       │   ├── impact/              # 影响体系与因果链（6.19）
│   │       │   │   ├── engine.ts            # 影响计算引擎（纯函数）
│   │       │   │   ├── impact-mapping.ts    # 方向↔影响联动映射
│   │       │   │   ├── impact.service.ts    # 影响DB服务层（预览/应用/回滚/三级兜底）
│   │       │   │   ├── causal-auto-plant.ts # 因果规则保底埋因
│   │       │   │   └── causal-chain.service.ts # 因果链服务层
│   │       │   ├── character-generator.ts # 自定义人物随机生成（6.26）
│   │       │   ├── verdict-generator.ts   # AI判词生成（七言+考语+缺陷暗喻，6.26）
│   │       │   ├── weapon-random.ts     # 神兵坊确定性随机引擎（6.27）
│   │       │   ├── weapon-growth.ts     # 神兵坊养成逻辑（强化/进化/变异/融合，6.27）
│   │       │   ├── weapon-refresh.ts    # 统一五感卡刷新服务（7.31）
│   │       │   ├── weapon-scar.ts       # 烙印系统（4预定义烙印+自定义，7.31）
│   │       │   ├── weapon-bond.ts       # 因果羁绊自动匹配（三维度评分，7.31）
│   │       │   ├── weapon-demonize.ts   # 走火入魔魔改/净化（7.31）
│   │       │   ├── weapon-counter.ts    # 天命克制计算（7.31）
│   │       │   ├── weapon-relic.ts      # 诛仙遗珍彩蛋（0.1%，7.31）
│   │       │   ├── trait-composer.ts    # 方向组合式特质零token组合引擎（7.30）
│   │       │   ├── technique-random.ts  # 功法确定性随机引擎（6.28）
│   │       │   ├── technique-variant.ts # 千人千面个人变种引擎（6.28）
│   │       │   ├── quote-service.ts     # 金句质量管线编排（提取→去重→评审→美化→入库，6.35）
│   │       │   ├── custom-entity-pipeline.ts # 实体自动维护管线（新实体草稿+老实体动态，6.33）
│   │       │   ├── custom-map-helpers.ts # 山河舆图辅助（默认地图/边缘坐标/危险度推断，6.34）
│   │       │   ├── travel-time.ts       # 行程时间估算（Dijkstra最短路，6.34）
│   │       │   └── teleport-detector.ts # 瞬移检测（正文地点行程预警，6.34）
│   │       ├── pipeline/
│   │       │   ├── runner.ts     # 管线编排器
│   │       │   ├── queue.ts      # DB任务队列（轮询/原子认领/重试/恢复，需求8）
│   │       │   └── quote-extractor.ts # 金句候选提取器（模块11/6.35，批量导入预筛共用）
│   │       ├── hotspot/          # 热点嗅探（12.1，抓榜单→LLM提炼→推送素材库）
│   │       │   ├── db.ts / llm.ts / crawler.ts / analyzer.ts
│   │       │   └── sources/      # 榜单源适配器注册表（番茄/纵横/晋江/起点+字体反爬）
│   │       └── routers/
│   │           ├── projects.ts   # 项目管理路由（含创作统计/方向统计/方向校验）
│   │           ├── outlines.ts   # 大纲管理路由
│   │           ├── scenes.ts     # 场景脚本路由（节点/关联/匹配/生成/对话/校验/反写卷大纲）
│   │           ├── chapters.ts   # 章节管理路由（含视角改写/分支/文风校验/导出）
│   │           ├── generation.ts # 生成任务路由（含SSE）
│   │           ├── world.ts      # 世界观浏览路由（含CRUD/文风/蒸馏）
│   │           ├── state.ts      # 全局状态追踪路由（状态快照/时间线/引导/抽取）
│   │           ├── foreshadow.ts # 伏笔台账路由（CRUD/超期/提升/DNA/回填/手法）
│   │           ├── growth.ts     # 人物成长阶段路由（模块3）
│   │           ├── relation.ts   # 自定义人物关系路由（模块8）
│   │           ├── quotes.ts     # 金句库路由（模块11）
│   │           ├── workshop.ts   # 成长工坊路由（模块9，13端点）
│   │           ├── settings.ts   # 设置路由（含文风预设/方向字典）
│   │           ├── health.ts     # 叙事体检路由（P2#7）
│   │           ├── impact.ts     # 影响体系路由（定义/状态/预览/候选/历史/推荐，6.19）
│   │           ├── causal-chain.ts # 因果链路由（CRUD/状态流转/统计，6.19）
│   │           ├── plot-materials.ts # 剧情素材浏览路由（二期RAG）
│   │           ├── custom-characters.ts # 自定义人物路由（向导/随机/判词，6.26）
│   │           ├── custom-weapons.ts    # 神兵坊路由（锻造/养成/兵器谱文案，6.27）
│   │           ├── custom-techniques.ts # 自定义功法路由（九大道则，6.28）
│   │           ├── technique-variants.ts # 千人千面个人变种路由（6.28）
│   │           ├── character-martial.ts # 人物武学档案路由（功法×武器融合小传，7.30）
│   │           ├── task-arc.ts   # 任务链台账路由（征途录，6.30）
│   │           ├── materials.ts  # 剧情素材收藏路由（6.30）
│   │           ├── custom-maps.ts # 山河舆图地图路由（6.34）
│   │           ├── custom-locations.ts # 山河舆图地点/连线路由（6.34）
│   │           ├── hotspot.ts    # 热点嗅探路由（12.1）
│   │           └── material-knowledge.ts # 素材知识库路由（12.2）
│   │
│   ├── web/                      # 前端应用
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts        # Vite配置（含API代理）
│   │   └── src/
│   │       ├── main.tsx          # 入口
│   │       ├── App.tsx           # 路由布局
│   │       ├── lib/
│   │       │   ├── api.ts        # API客户端（统一信封解包）
│   │       │   └── utils.ts      # 工具函数
│   │       ├── hooks/
│   │       │   ├── useProjects.ts        # 项目CRUD hooks
│   │       │   └── useGenerationStream.ts # SSE流式生成hook
│   │       ├── components/
│   │       │   ├── ui.tsx        # UI组件库
│   │       │   ├── RelationPanel.tsx # 自定义人物关系推演面板（模块8）
│   │       │   ├── CreationHeatmap.tsx   # 创作热力图（模块14）
│   │       │   ├── ForeshadowProgress.tsx # 伏笔回收进度卡
│   │       │   ├── DirectionBalanceCard.tsx # 方向均衡度卡（6.19）
│   │       │   ├── CustomCharacterWizard.tsx # 自定义人物三步向导（6.26）
│   │       │   └── ornaments.tsx # 装饰元素
│   │       └── pages/
│   │           ├── Dashboard.tsx       # 仪表盘
│   │           ├── OutlineEditor.tsx   # 大纲编辑
│   │           ├── SceneOutlinePanel.tsx # 场景脚本编排（拖拽+弹窗编辑，内嵌于大纲页）
│   │           ├── MaterialPickerDialog.tsx # 固定素材选择器（章节计划弹窗内嵌）
│   │           ├── ChapterReader.tsx   # 章节阅读/编辑
│   │           ├── GenerationConsole.tsx # 生成控制台
│   │           ├── WorldBrowser.tsx    # 世界观浏览（含自定义人物/自定义功法分类）
│   │           ├── GrowthStagePage.tsx # 人物成长弧光（模块3）
│   │           ├── QuoteLibrary.tsx    # 金句库（模块11）
│   │           ├── GrowthWorkshop.tsx  # 成长工坊（模块9，法宝4操作tab）
│   │           ├── TimelinePage.tsx    # 剧情时间线（模块12）
│   │           ├── ForeshadowLedger.tsx # 伏笔台账（统计/筛选/超期提醒，内嵌因果链tab）
│   │           ├── CausalChainPage.tsx # 因果链视图（嵌入伏笔台账页tab，6.19）
│   │           ├── HealthCheck.tsx     # 叙事体检（P2#7）
│   │           ├── DirectionStats.tsx  # 方向分布统计（6.19）
│   │           ├── CustomWeaponForge.tsx # 神兵坊（6.27）
│   │           ├── CustomTechniqueForge.tsx # 自定义功法坊（6.28）
│   │           ├── HotspotSniffer.tsx  # 热点嗅探（12.1）
│   │           ├── MaterialKnowledge.tsx # 素材知识库（12.2）
│   │           └── Settings.tsx        # 系统设置
│   │
│   └── shared/                   # 共享包
│       ├── package.json
│       └── src/
│           ├── index.ts
│           └── custom-character/ # 自定义人物共享配置（types/race/name/talent，6.26）
```

---

## 3. 环境配置

### 3.1 前置要求

- Node.js >= 20 LTS
- pnpm >= 9
- PostgreSQL >= 15（含 pgvector 扩展）
- 诛仙小说数据库（novel_db）已导入

### 3.2 环境变量 (.env)

```env
# ===== 诛仙库（只读，世界观RAG） =====
ZHUXIAN_DB_HOST=localhost
ZHUXIAN_DB_PORT=5432
ZHUXIAN_DB_NAME=novel_db
ZHUXIAN_DB_USER=noveluser
ZHUXIAN_DB_PASSWORD=<password>

# ===== 创作库（读写，项目数据） =====
CREATIVE_DB_HOST=localhost
CREATIVE_DB_PORT=5432
CREATIVE_DB_NAME=novel_studio
CREATIVE_DB_USER=noveluser
CREATIVE_DB_PASSWORD=<password>

# ===== LLM配置（OpenAI-compatible） =====
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=<your-api-key>
LLM_MODEL=deepseek-v4-pro

# ===== 服务配置 =====
SERVER_PORT=3456
QUEUE_CONCURRENCY=1          # 队列并发数（默认1顺序，可设1-4）
```

### 3.3 启动方式

**项目路径**：`K:\xiaoshuochaijie\zwrite\XianxiaForge`

```bash
# 进入项目目录
cd /d K:\xiaoshuochaijie\zwrite\XianxiaForge

# 方式一：一键启动（Windows，双击或命令行运行）
start.bat
# 自动检查 Node.js/pnpm/PostgreSQL → 安装依赖 → 初始化DB → 启动前后端 → 打开浏览器

# 方式二：手动启动（推荐开发时用）
pnpm install        # 首次或依赖变更时
pnpm dev            # 同时启动前后端（concurrently）

# 方式三：分别启动（调试时单独跑某一端）
pnpm --filter server dev   # 后端 http://localhost:3456（tsx watch）
pnpm --filter web dev      # 前端 http://localhost:5173（Vite）
```

启动后访问 **http://localhost:5173** 即可使用。前端通过 Vite proxy 将 `/api` 请求转发到后端 `http://localhost:3456`。

---

## 4. 数据库设计

### 4.1 诛仙库 / 世界观库 (novel_db) — 可写多书籍（WS0 升级）

世界观知识源，18张表，3层结构，含 pgvector 512维向量索引。WS0 起由「只读」升级为**可写多书籍世界观库**：`novel_book` 增 `description`/`source_type`/`cover_url` 三字段，`source_type='system'` 的诛仙三书（book_id=1/2/3）只读保护（禁改禁删），`source_type='user'` 的自建书可写（实体 CRUD + 跨书引入 + 文本抽取入库）。RAG 检索与生成管线当前仍锁定 bookId=1（WS5 二期解锁用户书消费）。

**核心表（系统使用的）：**

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| novel_character_lib | 人物库 | name, all_titles(text[]), faction, realm, combat_type, core_skills(text[]), personality, growth_line(text[]), plot_tags(text[]), writing_profile(jsonb), exclusive_items(text[]) |
| novel_faction_lib | 门派库 | name, camp, headquarters, leader, cultivation_feature |
| novel_location_lib | 地点库 | name, level, parent_region, related_faction, environment, key_events |
| novel_skill_lib | 功法库 | name, grade, faction, skill_type, threshold, core_effect |
| technique_attribute | 功法属性蒸馏（zaomeng） | skill_id, grade, element, difficulty, effect, distill_source |
| technique_move | 功法招式蒸馏（zaomeng） | skill_id, move_name, effect, requirement, distill_source |
| technique_relation | 功法关系蒸馏（zaomeng） | skill_id, target_technique, relation_type(克制/互补/同宗), description |
| technique_distill_archive | 功法蒸馏归档（zaomeng） | skill_id, distill_version, content_json(jsonb) |
| novel_magic_item_lib | 法宝库 | name, grade, system, owners, core_abilities |
| novel_monster_lib | 妖兽库 | name, level, race, core_abilities, habitat, combat_level |
| lib_character_relation | 人物关系 | rel_id(PK), char_a_id, char_b_id, rel_type, interact_count |
| novel_chapter_analysis | 章节分析 | chapter_no, core_event, emotion_main_type, conflict_level, scene_emb(vector512) |

**注意事项：**
- `text[]` 数组列不能用 `ILIKE` 直接查询，需 `column::text ILIKE '%kw%'`
- `lib_character_relation` 无 `is_deleted` 列，PK 是 `rel_id`
- 向量检索使用 `scene_emb <=> $1` 余弦距离

### 4.2 创作库 (novel_studio) — 读写

创作项目数据，Drizzle 定义 48 张表（7张核心业务表 + 1张管线断点表 + 5张场景脚本表 + 2张全局状态追踪表 + 1张伏笔台账表 + 1张剧情分支表 + 1张文风校验表 + 1张人物成长阶段表 + 1张自定义人物关系表 + 1张金句库表 + 3张成长工坊表 + 5张影响体系表 + 2张阶段4扩展表（因果链/关系影响快照） + 2张神兵坊表（自定义武器/武器文案） + 1张自定义人物表 + 2张自定义功法表（功法/个人变种） + 3张山河舆图表（地图/地点/地点路径） + 4张热点嗅探表 + 2张淘宝系统表 + 3张动态叙事引擎表（叙事里程碑/分支弧/计划改写日志））。

> 另有 Python 素材蒸馏侧独立管理的素材表（不在 Drizzle schema 中，仅由后端只读查询）：`plot_material_encounter/foreshadow/highlight/task` 等剧情素材表、`style_preset` 文风预设表、`domain_knowledge` 领域知识表（DDL 见 `sucaiqingxi/ddl-*.sql`）。

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| creative_project | 创作项目 | id, title, description, genre, source_book_id, status, llm_config(jsonb), generation_config(jsonb), default_impact_character_ids(bigint[] 默认影响对象人物ID数组,影响体系POV为空时兜底,默认空) |
| story_outline | 卷级大纲 | id, project_id, volume_no, title, synopsis, key_events(jsonb), character_arcs(jsonb), foreshadowing(jsonb), world_building_notes, sort_order, status |
| chapter_plan | 章节计划 | id, project_id, outline_id, volume_no, chapter_no, title, intent, pov_character_ids(bigint[] 视角人物ID数组), target_word_count, scene_breakdown(jsonb), must_have_events(jsonb 关键剧情锚点数组,模块1), required_entity_ids(jsonb), emotion_target, conflict_target(int), prev_chapter_summary, status, branch_source_option_id(衍生自哪个分支选项), branch_parent_chapter_id(分支来源父章计划id), branch_prediction(text 随分支生成的后续走向世界观推演) |
| generation_task | 生成任务 | id, project_id, chapter_plan_id, task_type, status, current_step, input_snapshot(jsonb), output_text, audit_report(jsonb), revision_notes(jsonb), error_message, llm_model, tokens_used, position(int 队列排序), retry_count, max_retries(默认3), batch_id(varchar 批次号), queue_options(jsonb 生成参数) |
| generated_chapter | 生成章节 | id, project_id, chapter_plan_id, task_id, volume_no, chapter_no, title, content, word_count, version, parent_version_id, quality_score(jsonb), is_current, status, perspective_versions(jsonb 视角改写版本数组,模块6) |
| author_rules | 作者规则 | id, project_id, rule_type, rule_content, priority, is_active |
| generation_log | 生成日志 | id, project_id, task_id, agent_name, action, detail(jsonb) |
| pipeline_checkpoint | 管线断点（架构升级v1.3 Epic1） | id, task_id(可空,后验独立工作流手动触发时无任务), step_name(如step3_writer/post_state_extract), step_order(主管线10-50,后验步骤≥100), step_data(jsonb 步骤产出,断点续跑恢复用), status(pending/running/completed/failed/skipped), token_input, token_output, error_message |
| scene_node | 场景脚本节点 | id, project_id, outline_id, sort_order, title, time_setting, location_desc, core_event, effect_and_result, foreshadowing_note, scene_type(key/transition/foreshadow), is_key_plot, ai_status(manual/generated/refined), metadata(jsonb 含chapterNumber/fromKeyEvent，导入自卷大纲keyEvents时记录对应章号) |
| scene_node_character | 场景-人物关联 | id, scene_node_id, character_id(诛仙库人物ID), appearance_type(protagonist/core_support/mention), role_note, sort_order |
| scene_node_element | 场景-要素关联 | id, scene_node_id, element_type(location/skill/item/monster/material/daily_item/foreshadow_template), element_id(诛仙库主键), element_note, foreshadow_direction(plant/payoff), sort_order |
| scene_node_relation | 节点间关系连线 | id, source_node_id, target_node_id, relation_type(causal/sequential/foreshadow_echo), description |
| scene_edit_log | 场景脚本对话修改日志 | id, project_id, outline_id, user_instruction, parsed_plan(jsonb), snapshot_before(jsonb), snapshot_after(jsonb), apply_status(pending/applied/rolled_back), operation_type |
| character_state_snapshot | 人物状态快照 | id, project_id, character_id(诛仙库人物ID,可空), character_name, volume_no, chapter_no(0=初始), location, realm, injury, mental_state, possessed_items(jsonb), extra_state(jsonb), status(pending/confirmed), source(manual/auto/bootstrap), task_id |
| timeline_milestone | 时间线里程碑 | id, project_id, volume_no, chapter_no(0=初始), story_time, title, description, importance(key/normal), status(pending/confirmed), source(manual/auto/bootstrap), task_id, sort_order |
| foreshadow_thread | 伏笔台账 | id, project_id, title, description, hint_clue(text 埋设线索关键词,模块2), status(pending待埋入/planted/resolved/abandoned), priority(high/normal/low), plant_chapter, resolve_chapter, scene_ids(jsonb 关联场景节点ID数组), source_scene_id(从哪条note提升) |
| chapter_branch_option | 剧情分支选项 | id, project_id, source_chapter_plan_id(来源章计划id), option_title, option_description, next_chapter_intent, next_scene_hint(jsonb), impact_tags(jsonb 影响标签数组), option_type(varchar20 分支类型 normal=常规/encounter=奇遇,默认normal), source_materials(jsonb 本选项借鉴的剧情素材 [{table,id,title,label}],默认[]), main_direction(varchar32 主方向编码,方向体系), secondary_directions(jsonb 次方向编码数组≤2), direction_match_score(int 方向匹配度0-100), is_selected, created_at |
| style_audit_record | 文风校验记录 | id, project_id, chapter_plan_id, generation_task_id(可空), config_snapshot(jsonb 校验时文风配置快照), overall_score(int 百分制), dimension_scores(jsonb 各维度分), issues(jsonb StyleIssue[]含excerpt), issue_count, status(completed/failed), created_at |
| character_growth_stage | 人物成长阶段（模块3） | id, project_id, character_id(诛仙库人物ID), character_name, stage_no(阶段序号), name(阶段名), traits(jsonb 特质数组), description, chapter_start(生效起始章,NULL=不限), chapter_end(生效结束章,NULL=不限), created_at |
| custom_character_relation | 自定义人物关系（模块8） | id, project_id, char_a_id, char_a_name, char_b_id, char_b_name, relation_type(关系类型), description(关系描述), interact_pattern(互动模式), is_active(是否生效), created_at |
| project_quote_lib | 金句库（模块11） | id, project_id, chapter_id(来源章节), character_name(角色名), quote_text(金句当前文本,美化后为选中版), original_text(提取原文,美化前), polished_text(已应用的美化版本), polished_versions(jsonb 三档美化版本[{style:conservative/balanced/deep,text,note}]), scores(jsonb 五维评分{imagery意境/rhythm韵律/philosophy哲理/emotion情感/viral传播点}+total), grade(legendary≥90/good80-89/candidate70-79), polish_status(none/polished/applied 美化状态), applied_at(美化版应用时间), scene_desc(场景描述), quality_score(int 质量分), is_collected(是否收藏), source_type(来源 auto自动/manual手动/import导入), created_at |
| custom_skill_lib | 自定义功法（模块9，**阶段6已退役**：保留为空表，功法能力由 custom_technique 取代） | id, project_id, name, grade(品阶黄/玄/地/天/仙), grade_level(1-3层), skill_type, core_effect, effects(jsonb 特效数组含type/rarity/strength), side_effects, description, growth_type(base/fusion/mutation/upgrade/evolution), base_entity_id, source_entity_ids(jsonb), evolution_stage, is_evolved, linked_character_ids(jsonb 关联人物ID数组), is_deleted, created_at |
| custom_magic_item_lib | 自定义法宝（模块9） | id, project_id, name, grade, grade_level, item_type, core_abilities, effects(jsonb), side_effects, description, growth_type, base_entity_id, source_entity_ids(jsonb), evolution_stage, is_evolved, linked_character_ids(jsonb), is_deleted, created_at |
| entity_growth_record | 实体成长记录（模块9） | id, project_id, entity_type(skill/magic_item), entity_id, operation_type(fusion/mutation/upgrade/evolution), source_entity_ids(jsonb), before_snapshot(jsonb), after_snapshot(jsonb), result(success/failed), operator_note, created_at |
| impact_definition | 影响定义（影响体系白名单） | id, project_id(空=全局预设), impact_key(唯一,如character.dao_xin), name, domain(character/world/relation/rule), category(base/fate/qualification/faction/inner/karma), value_type(numeric/tag), min_value, max_value, default_value, decay_per_chapter(每章自然衰减), grade(标签品级), mutex_group(互斥组), priority, threshold_events(jsonb 阈值触发), description(注入上下文), is_active |
| character_impact_snapshot | 人物影响快照（影响体系） | id, project_id, character_id, character_name, volume_no, chapter_no(0=初始), numeric_values(jsonb {impactKey:number}), tag_states(jsonb [{tagKey,tagName,remainChapters,priority}]), status(pending/confirmed), source(manual/auto/branch/bootstrap), task_id |
| world_impact_snapshot | 世界观影响快照（影响体系） | id, project_id, volume_no, chapter_no, region(空=全局), numeric_values(jsonb), tag_states(jsonb), status(pending/confirmed), source |
| branch_impact_link | 分支影响关联（影响体系） | id, branch_option_id(关联分支选项), target_type(character/world/relation), target_id(人物ID,world空), char_a_id/char_b_id(relation用,阶段4), region, impact_key, change_type(add/set/add_tag/remove_tag), change_value, tag_key, tag_duration(-1永久), display_text, is_hidden(暗线), sort_order |
| impact_history | 影响变更历史（影响体系） | id, project_id, source_type(branch/manual/auto/event), source_id(branch=选项ID), chapter_no, snapshot_before(jsonb), snapshot_after(jsonb), operator_note, created_at |
| causal_chain | 因果链（阶段4） | id, project_id, source_type(branch/event/manual), source_id, source_chapter_no, cause_type(secret/debt/betrayal/prophecy/promise/grudge), cause_description, effect_type(reveal/repay/revenge/fulfill/break), effect_description, target_chapter_min/max(预期兑现窗口), status(planted/foreshadowed/triggered/resolved/expired), priority(1-10), strength(0-100 因果强度), resolved_chapter_no, resolved_task_id, resolution_note, direction_code(关联方向), parent_chain_id(因果嵌套), tags(jsonb) |
| relation_impact_snapshot | 关系影响快照（阶段4） | id, project_id, char_a_id/char_b_id(约定a<b), char_a_name/char_b_name, volume_no, chapter_no, rel_type(师徒/仇敌等), relation_values(jsonb 全量关系维度{affection,trust,respect,intimacy}), relation_delta(jsonb 本次变更量), status(pending/confirmed), source(branch/manual/bootstrap), task_id |
| custom_weapon | 自定义武器（神兵坊） | id, project_id, name, category(martial/taoist/demonic/strange/array), type(形制), grade(凡造/灵淬/宝胎/道纹/仙蜕/神蕴), grade_level(1-3), fake_grade(伪装底蕴), base_material, forge_traits/soak_traits/attach_traits/cavity_traits(jsonb 四类特质ID数组), soul_refine_level(none/soul_mark/blood_merge/dao_resonance), core_direction(jsonb), growth_type(base/fusion/mutation/upgrade/evolution), base_entity_id, source_entity_ids(jsonb), evolution_stage, is_evolved, linked_character_ids(jsonb), breakthrough_narrative(突破叙事片段), reverse_mode(jsonb), source_ref(jsonb,引用来源{table,id,name}), entity_status(draft草稿/official正式,实体自动维护), chapter_updates(jsonb 自动维护更新记录[{chapterNo,volumeNo,updateText,category,extractedAt}]), is_deleted |
| weapon_lore | 武器文案（兵器谱） | id, project_id, weapon_id, name(生成名号), fake_name(对外化名), intro(一句话简介), moves(jsonb 配套招式[{name,desc}]), is_current(当前生效版本，一武器可存多版本) |
| custom_character | 自定义人物（三步向导） | id, project_id, name, gender, race_category(7大类), race_sub(56小类), position(实力档位 chenjie/tongtu/dazhe/zhelong/tianyou), fake_position(伪装定位), stance(0-100 立场值), inner_personality(内在性格单选), outer_personality(jsonb 外在标签2-3个), talents(jsonb 天赋3正向+可选1缺陷), strengths/weaknesses(jsonb 种族擅长/短板), description(LLM小传300-500字), verdict_poem(判词七绝), verdict_comment(二字考语), dao_title(套装道号), combo_ability(套装大招), source_ref(jsonb,引用来源{table,id,name}), entity_status(draft草稿/official正式,实体自动维护), chapter_updates(jsonb 自动维护更新记录), is_deleted；**对外暴露负数ID**（真实自增ID取负），与诛仙库正数ID共存分流 |
| custom_technique | 自定义功法（九大道则） | id, project_id, name, main_dao(主修道则9选1), assist_dao(jsonb 辅修0-3门), guidance_depth(rudimentary/complete/essential 指引深度非品级), fake_depth(藏拙), style_type(cultivate/attack/defense/assist/special), threshold(jsonb 适配门槛), core_traits(jsonb 本源运用方向), practice_path(行功路线), body_mark(jsonb 身体印记), usage_skills(jsonb), abilities(jsonb 分道境神通[{daoRealm:入微/化境/合道/超脱}]), backlash(jsonb 反噬), inheritance(传承方式), evolution(jsonb 演化方向), inherent_conflict(先天矛盾), core_direction/fit_monk(jsonb 自动标签), description(LLM详解500-700字), growth_type(base/evolution/fusion/mutation), base_entity_id, source_entity_ids(jsonb), linked_character_ids(jsonb 自定义人物ID), source_ref(jsonb,引用来源{table,id,name}), entity_status(draft草稿/official正式,实体自动维护), chapter_updates(jsonb 自动维护更新记录), is_deleted |
| character_technique_variant | 人物功法个人变种（千人千面） | id, project_id, character_id(custom_character.id), base_technique_id, variant_name, rarity(common/remarkable/rare 60/30/10), dao_weight_offset(jsonb 道则权重偏移), trait_offset(jsonb), ability_variant(jsonb 神通变种), backlash_offset(jsonb), body_mark(jsonb 专属印记), exclusive_skill(jsonb), cultivation_effect(jsonb 修炼适配{speed,bottleneck,risk,note}), version(变种版本号), is_deleted |
| custom_map | 山河舆图-地图（山河舆图） | id, project_id, name, width(int 画布宽), height(int 画布高), background(背景样式,可空), description, is_default(默认地图,至少保留一张不可删), created_at |
| custom_location | 山河舆图-地点（山河舆图） | id, project_id, map_id(所属地图), name, x/y(int 画布坐标), location_type(sect宗门/city城镇/secret_realm秘境/danger险地/teleport传送阵/battlefield战场/generic通用), danger_level(safe/normal/danger/deadly), affiliated_faction(归属势力文本), description, entity_status(draft草稿/official正式), metadata(jsonb {source:auto-extract/zhuxian-import/manual, zhuxianId, chapterNo, volumeNo}), is_deleted |
| custom_location_link | 山河舆图-地点路径（山河舆图） | id, project_id, map_id, from_location_id, to_location_id, link_type(main_road官道/path小径/teleport传送/secret_path秘径), travel_time_walk/fly/ship/teleport(int 分钟,可空), description, is_deleted |
| hotspot_crawl_batch | 热点嗅探-爬取批次 | id, source_names(jsonb 榜单源数组), status(running/completed/failed/partial), item_count, note, started_at, finished_at；无 project_id（全局） |
| hotspot_raw_novel | 热点嗅探-原始榜单书目 | id, batch_id, source(榜单源), rank, title, author, category, tags(jsonb), intro, word_count, popularity, url, raw(jsonb 原始抓取字段) |
| hotspot_insight | 热点嗅探-分析灵感 | id, batch_id, insight_type(encounter/foreshadow/highlight/task/trend), title, content(核心剧情模板), payload(jsonb 结构化补充), score(0-100 复用价值), status(new/kept/discarded/pushed), source_novel_ids(jsonb) |
| hotspot_push_log | 热点嗅探-推送入库记录 | id, insight_id, target_table(plot_material_*), target_project_id(空=全局素材), target_id(目标表新行id), note, pushed_at |
| treasure_item | 淘宝物品（全面武器化：均为秘宝/武器） | id, project_id, item_type(恒secret), secret_tier(spirit/legacy/relic), display_name, true_name(阶段5揭示), appearance, trinket_hook(遗留列不再写入), trinket_category(遗留列不再写入), full_data(jsonb 武器完整数据), unlock_stage(0-5), unlock_progress(jsonb), bound_character_id, bound_chapter_no, use_count, is_fake, fake_reveal, hunt_location, hunt_record_id, is_collected, is_converted, converted_id, note, is_deleted |
| treasure_hunt_record | 淘宝记录 | id, project_id, location, item_count, trinket_count(恒0), secret_count, created_at |
| narrative_milestone | 叙事里程碑（动态叙事引擎） | id, project_id, label(varchar200), description(text), must_happen(jsonb 必须覆盖事件点数组), key_character_ids(bigint[] 关键人物), target_chapter_from/target_chapter_to(integer 预估章节区间), status(upcoming/active/reached/skipped), importance(critical/major/minor), sort_order, outline_id(FK story_outline 可空) |
| branch_arc | 分支弧（动态叙事引擎） | id, project_id, source_chapter_plan_id(起始章), target_milestone_id(FK narrative_milestone), status(active/converged/abandoned), chapter_count(已用章数), exemption_used(是否已用一次豁免+2), max_chapters(硬限5/豁免后7), converged_chapter_plan_id(收敛章,可空), created_at |
| plan_rewrite_log | 计划改写日志（动态叙事引擎） | id, project_id, branch_arc_id(FK), chapter_plan_id(被改写章), rewrite_type(extend/converge/abandon/promote), before_snapshot(jsonb), after_snapshot(jsonb), reason, max_rewrites(40上限) |

**场景脚本表说明：**
- `scene_node` 通过 `outline_id` 归属到某一卷大纲，`sort_order` 控制节点排序
- 人物与要素分两张关联表：人物用 `scene_node_character`（区分出场类型），地点/功法/法宝/妖兽统一用 `scene_node_element`（以 `element_type` 区分）
- `character_id` / `element_id` 均为诛仙库对应表的主键，仅存ID不冗余名称
- `scene_edit_log` 记录自然语言指令修改的前后快照，支持回滚

**全局状态追踪表说明（防长篇设定漂移）：**
- `character_state_snapshot` 记录某人物"截至某章结束时"的状态快照（位置/境界/伤势/心态/持有物），`chapter_no=0` 表示开篇初始状态
- `timeline_milestone` 记录关键剧情事件及其故事内时间，用于约束事件先后顺序
- 两表均带 `status`：LLM抽取/引导初始化产生的是 `pending`（待人工确认），人工确认后置 `confirmed`；写作上下文与审计只读取 `confirmed` 数据
- `source` 区分来源：`manual`(手动录入) / `auto`(生成后LLM自动抽取) / `bootstrap`(从人物库+大纲引导初始化)

**伏笔台账表说明（防埋多忘多）：**
- `foreshadow_thread` 以"伏笔线"为粒度追踪一条伏笔的完整生命周期：在哪埋（`plant_chapter`）、计划/实际哪收（`resolve_chapter`）、当前状态（`pending`待埋入/`planted`已埋设/`resolved`已回收/`abandoned`已废弃）、优先级
- `hint_clue`（模块2）记录埋设线索关键词句，既用于在正文中识别伏笔是否已埋入/回收，也注入写作上下文供 Writer 自然呼应
- 与场景级 `scene_node.foreshadowing_note` 是"台账 vs 明细"两层关系：后者是场景就地备注，前者是跨场景的全局聚合视图；`scene_ids` 关联多个场景节点，`source_scene_id` 记录由哪条 note 一键提升而来
- 状态流转以手动为主，并辅以生成后的零LLM确定性自动流转（模块2）：章节正文定稿后扫描本项目 pending/planted 伏笔，标题或 `hint_clue` 出现在正文中即推进——pending→planted（记埋设章）、planted 且计划回收章等于当前章→resolved；失败不阻断生成
- 超期由服务端按"当前进度章 - 埋设章 ≥ 阈值（默认10）"或"已过计划回收章仍未回收"计算高亮，不自动改状态
- 取代卷大纲 `story_outline.foreshadowing`(jsonb) 成为伏笔权威来源（旧字段保留兼容）

**剧情分支表说明（交互式剧情抉择，需求12）：**
- `chapter_branch_option` 以"来源章节"为粒度存储 AI 推演的 2-4 个下一章走向选项；`source_chapter_plan_id` 指向来源章计划，`is_selected` 标记被玩家选中的那一项（同源至多一个为 true）
- `option_type` 标记分支类型：`normal`=常规走向、`encounter`=奇遇走向（默认 `normal`）。每次生成分支时借鉴【奇遇】素材库（`plot_material_encounter` 单表向量召回，topN=3/minScore=0.3，失败降级为空），并保证有且仅有 1 个奇遇类分支：prompt 约束 LLM 产出恰好一个 `optionType=encounter`，代码侧保底——若 LLM 未标记则将末位选项强制改为 encounter
- 玩家选定后衍生下一章计划：新 `chapter_plan` 继承来源章的卷号/POV/实体下发，章节号 +1，并写入 `branch_source_option_id`（来自哪个选项）与 `branch_parent_chapter_id`（来源父章）两个字段
- 这两个字段为普通 bigint 列（不加外键），避免与 `chapter_branch_option.source_chapter_plan_id` 形成循环引用
- `impact_tags` 沿分支链累积：上下文构建时按 `branch_parent_chapter_id` 回溯（深度上限10）收集各代选项的影响标签，去重后按时间序注入 Writer/Auditor，保证多章分支走向一致
- 覆盖式重选：改选时若已衍生的下一章仍为 `planned` 则删旧建新；若已脱离 `planned`（生成/定稿）则返回 409 拒绝静默覆盖

**文风校验表说明（章节文风校验，需求13）：**
- `style_audit_record` 以"章节"为粒度存储一次专项文风审计的结果；`chapter_plan_id` 关联章节稳定身份（跨版本不变），`config_snapshot` 保存校验当时的文风引擎配置（StyleContext）用于历史追溯与配置变更对比
- `dimension_scores` 为各维度分项得分（0-100），`overall_score` 为各激活维度得分均值（确定性计算）；`issues` 为 `StyleIssue[]`，每条含 `dimension/severity/description/suggestion/excerpt`，`excerpt` 为违规原文片段供前端定位高亮
- 校验标准 100% 复用文风引擎配置（诛仙库 `style_global_config`，按项目 `source_book_id` 隔离、缺省回退书1），不新增独立规则；配置变更后重新校验即同步生效
- 状态 `completed`/`failed`；同一章节可多次校验形成历史，按 `created_at` 倒序

**人物成长阶段表说明（模块3 成长弧光卡点）：**
- `character_growth_stage` 以"人物×阶段"为粒度定义角色在不同章节区间的成长状态（如"青云门初学→第1-30章→特质：青涩/倔强/重情义"）
- `chapter_start`/`chapter_end` 为 NULL 表示不限（从开篇起/到结尾止），上下文构建时按当前章号匹配生效阶段，同一人物多阶段命中取 `stage_no` 最大者
- `character_id` 引用诛仙库人物ID（只读引用，不写诛仙库），`character_name` 冗余存储便于展示
- 注入管线：`ContextPackage.growthStages` → Writer【出场人物设定】块渲染"★当前成长阶段"→ Auditor 第15维"人物阶段一致性"审查言行是否违背阶段特质

**自定义人物关系表说明（模块8 人物关系动态推演）：**
- `custom_character_relation` 存储用户自定义/AI推演的人物间关系（如"师徒→决裂→仇敌"的演变），独立于诛仙库原生 `lib_character_relation`
- 上下文构建时与原生关系合并：同一对人物若存在自定义关系则覆盖原生（优先级更高），标记 `source='custom'`；Writer/Auditor 对自定义关系以★标识并附互动模式描述
- `is_active` 控制是否参与上下文注入（可临时禁用某条关系而不删除）
- AI推演：`POST /projects/:id/relations/infer` 输入两人物+触发事件，LLM（温度0.9）返回3个候选关系演变方案供用户选择确认

**金句库表说明（模块11 名场面金句提取 + 质量升级）：**
- `project_quote_lib` 存储精彩语句，含角色归属、场景描述、质量评分；`source_type` 区分来源：`auto`=章节生成后自动管线提取、`manual`=手动录入、`import`=批量导入
- 提取时机：`runner.ts` 章节生成完成后 fire-and-forget 调用 `quote-service.ts` `runQuotePipeline()`（步骤7.7，不阻塞主流程，失败记 generation_log 不阻断）
- **质量管线四步**（6.35）：`extractQuoteCandidates`（temp0.2）提取候选 → 归一化去重（与本库已有金句双向包含比对）→ `QuoteJudgeAgent` 五维评分（意境画面/韵律节奏/哲理深度/情感张力/传播记忆点各0-20，本地求和定级：total≥90 legendary / 80-89 good / 70-79 candidate，worthy=false 或低于70丢弃）→ `QuotePolisherAgent` 仅对 legendary/good 生成三档美化版本（conservative保守/balanced平衡/deep升华）→ 入库（每章正式入库≤3条 + candidate 候补≤3条）
- `quote_text` 为当前生效文本，`original_text` 保留提取原文；`polished_versions` 存三档美化候选，用户在前端选定后 `apply-preview`（预览替换正文）→ `apply`（写回 quote_text/polished_text/polish_status=applied）
- `is_collected` 标记用户收藏的金句；`getCollectedQuotes(projectId, characterNames?)` 做**人物感知召回**——优先返回本章 POV/出场人物命中的金句，不足 limit 再按质量分全局补足，注入写作上下文【收藏金句参考】块供 Writer 参考风格（降级红线：召回失败返回空，不阻断生成）
- **批量导入**：`POST /quotes/import-preview` 用 LLM（temp0.3）从粘贴的参考文本预筛≤20条候选金句（含说话人推断，不入库）→ 前端审阅勾选/编辑 → `POST /quotes/import` 批量入库（source_type=import，默认收藏）
- 前端 `QuoteLibrary` 页面按角色分组展示、支持收藏/删除/手动录入/批量导入/打磨（QuotePolishModal 三版本对比）/重评/回写原文，来源徽标+分级徽章（legendary/good/candidate）+来源下拉筛选

**山河舆图表说明（山河舆图模块）：**
- `custom_map` 以项目为粒度存多张地图（画布尺寸 width/height），`is_default` 标记默认地图；DELETE 守卫"至少保留一张地图"。首次访问经 `getOrCreateDefaultMap(projectId)` 自动创建默认地图（`services/custom-map-helpers.ts`）
- `custom_location` 存地点点位（x/y 画布坐标），`location_type` 七类（sect宗门/city城镇/secret_realm秘境/danger险地/teleport传送阵/battlefield战场/generic通用），`danger_level` 四档（safe/normal/danger/deadly，`mapDangerLevel` 由 location_type 推断默认值），`affiliated_faction` 归属势力文本
- 地点来源三通道，均记 `metadata.source`：`manual` 前端布点；`auto-extract` 实体自动维护管线从正文抽取（draft 草稿，带 chapterNo/volumeNo）；`zhuxian-import` 诛仙库地点批量导入（`POST /import-zhuxian` 上限500条，draft + 地图边缘坐标 `edgeCoordinate` + metadata.zhuxianId 溯源）
- `entity_status` draft→official 的转正路径：前端确认按钮 `POST :locId/confirm`，或 `PUT` 更新时携带 `confirm:true`
- `custom_location_link` 存地点间路径连线（from/to 双向语义，无向图），`link_type` 四类（main_road官道/path小径/teleport传送/secret_path秘径），各方式通行时间字段（travel_time_walk/fly/ship/teleport，分钟）
- **行程时间估算**（`services/travel-time.ts`）：Dijkstra 最短路，速度常量御剑 0.1 分钟/单位（偏宽松）等；`GET /custom-locations/distance?fromId=&toId=` 返回 estimateTravel（分钟换算可读文案）+ pathNames（途经地点）
- **写作上下文注入**：`context-builder.ts` `getCustomLocationsForChapter` 按地点名对正文做**子串匹配**（名称长者优先，最多5个，catch→[]）合入 `context.locations`——非外键关联，地点改名需手动同步
- **瞬移检测**（`services/teleport-detector.ts`）：章节正文出现≥2个地点名时估算御剑飞行时间，过短距离跨章出现即经 SSE `teleport_warning` 事件预警（best-effort，不阻断）

**实体自动维护表说明（自定义实体自动维护）：**
- `custom_character` / `custom_weapon` / `custom_technique` 三表共用 `entity_status`（draft/official）+ `chapter_updates`(jsonb) 两列，支持"章节生成后自动发现新实体→草稿→人工转正"闭环
- **管线接入**：`runner.ts` 步骤7.8 正文定稿后 `await processChapterEntities()`（`services/custom-entity-pipeline.ts`，try/catch 包裹不阻断），成功后 SSE 推送 `entities_extracted` 事件（含新增人物/武器/功法/地点计数）
- **配置**（`resolveEntityMaintainConfig` 读 `generation_config`）：`autoExtractCustomEntities`（总开关，缺省开）、`entitySensitivity`（strict/balanced/loose 抽取灵敏度，strict 档无对白不抽人物）、`extractWeapons`/`extractTechniques`/`extractLocations`（分项开关，缺省开）
- **去重三保险**：LLM 提取前先收集本项目已有实体名 + 诛仙库对应表名单（人物/法宝/功法/地点）喂给 Agent 要求排除；入库前再按名字 Set 双保险比对（含诛仙库名单）；`strict` 档追加"无对白不抽"过滤，minor 级 mentionCount<2 且无对白者丢弃
- **草稿内容差异**：人物草稿带 description（≤500字），地点草稿带 description + 默认地图边缘坐标；武器/功法草稿仅占位常量（无 description，待人工补全）
- **已有实体增量更新**：正文中老实体出现新信息（境界突破/获得新能力等）时以 `{chapterNo,volumeNo,updateText,category,extractedAt}` 追加进 `chapter_updates`（同章号去重覆盖），不改实体主字段；前端工坊页以徽章/时间线展示
- 前端触点：众生百态（CharacterGallery）草稿筛选+转正/忽略徽章；铸器天工、道法自然同理；地点草稿进山河舆图待确认

**成长工坊表说明（模块9 功法/法宝成长工坊）：**
- `custom_skill_lib` / `custom_magic_item_lib` 结构对称，存储用户创建或经融合/变异/进化产生的自定义功法/法宝实体，独立于诛仙库（只读）
- 品阶体系：黄阶→玄阶→地阶→天阶→仙阶，每阶3层（`grade_level` 1-3）；`effects`(jsonb) 为特效数组 `[{name, type(element|spacetime|soul|body|curse|domain), rarity(normal|rare|legendary), description, strength}]`，品阶约束特效稀有度（黄/玄仅normal，地阶可rare，天阶+可legendary）
- `growth_type` 标记实体来源：base(用户创建) / fusion(融合) / mutation(变异) / upgrade(强化) / evolution(进化)；`source_entity_ids` 记录来源实体ID数组
- `linked_character_ids`(jsonb) 关联使用此功法/法宝的人物ID数组（诛仙库人物ID），上下文构建时按出场人物匹配注入
- `entity_growth_record` 记录每次成长操作的前后快照（`before_snapshot`/`after_snapshot` 完整实体JSON），支持回滚（revert 将 before_snapshot 写回实体）
- 进化为预览确认制：LLM 生成进化预览（不入库），用户确认后 `POST /confirm` 才真正插入新实体；融合/变异同理（先预览后确认），强化为直接执行（原地修改）

**影响体系表说明（剧情方向与分支影响体系）：**
- `impact_definition` 是所有可用影响项的白名单（数值型/标签型），支持全局预设（`project_id` 为空）与项目自定义；`impact_key` 形如 `character.dao_xin`/`world.ling_qi`，`domain` 区分作用域（character/world/relation/rule），`decay_per_chapter` 支持每章自然衰减，`threshold_events` 支持数值越阈自动挂标签
- `character_impact_snapshot` / `world_impact_snapshot` 记录"截至某章结束时"的人物/世界影响数值与标签状态，`chapter_no=0` 为初始态；与人物状态快照（character_state_snapshot）按章节对齐但各自独立
- `branch_impact_link` 是"分支选项 → 影响变更"的明细配置（手工绑定），一条 link = 对某目标（人物/世界区域）的某影响项做一次 add/set/add_tag/remove_tag；`is_hidden` 支持暗线影响（对玩家隐藏）
- `impact_history` 记录每一次影响变更的前后快照（`snapshot_before`/`snapshot_after`），全链路追溯，支持审计与回滚
- **默认影响对象兜底（三级链）**：`creative_project.default_impact_character_ids`（bigint[]）存项目级默认影响人物（通常为主角）。影响体系目标人物解析 `resolveImpactTargetCharacters()` 按三级回落：章节 POV（`pov_character_ids`）→ 本字段 → `character_state_snapshot` 已出场人物前 3（按 char_id 升序），保证 character 域影响有作用目标、影响预览不空。任一级读取失败降级继续，绝不阻断分支选择主流程

---

## 5. 后端架构

### 5.1 服务入口

Hono 应用，端口 3456。全局中间件：CORS（允许 localhost:5173）、请求日志、耗时统计。

**API响应格式（信封）：**
```json
{ "success": true, "data": <payload> }
{ "success": false, "error": "错误信息" }
```

### 5.2 路由表

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/health | 健康检查 |
| GET | /api/projects | 项目列表 |
| POST | /api/projects | 创建项目 |
| GET | /api/projects/:id | 项目详情 |
| PUT | /api/projects/:id | 更新项目 |
| DELETE | /api/projects/:id | 删除项目 |
| GET | /api/projects/:id/creation-stats?days= | 创作统计（按日字数/章数+连续创作天数，模块14热力图数据源） |
| GET | /api/projects/:id/outlines | 大纲列表（含章节） |
| POST | /api/projects/:id/outlines | 创建卷大纲 |
| PUT | /api/projects/:id/outlines/:oid | 更新大纲 |
| POST | /api/projects/:id/outlines/generate | AI生成大纲（模式归一化：mode 缺省 one-shot 零回归，stepwise 按步注入；同步物化章节计划） |
| GET | /api/projects/:id/chapters | 章节列表 |
| POST | /api/projects/:id/chapters | 创建章节计划 |
| PUT | /api/projects/:id/chapters/:cid | 更新章节 |
| GET | /api/projects/:id/chapters/:cid/content | 获取正文 |
| GET | /api/projects/:id/chapters/:cid/versions | 版本历史 |
| POST | /api/generation/start | 单章入队（创建pending任务） |
| POST | /api/generation/batch | 批量入队（共享batchId，按章节号排序） |
| GET | /api/generation/queue | 队列状态（并发数/执行中/等待中） |
| GET | /api/generation/stream/:taskId | SSE流式推送 |
| POST | /api/generation/cancel/:taskId | 取消任务 |
| GET | /api/generation/tasks | 任务列表 |
| GET | /api/generation/tasks/:id | 任务详情 |
| GET | /api/projects/:id/export?format=&volumeNo=&chapterIds= | 整书/按卷导出（TXT/MD，流式下载）；传 chapterIds（章节计划ID列表）则按阅读路径（含分支）顺序导出 |
| POST | /api/chapters/:id/revise | 对话式AI修订（指令+选区→修订结果，不自动保存） |
| GET | /api/chapters/:id/branch-options | 剧情分支选项列表（需求12） |
| POST | /api/chapters/:id/generate-branches | 手动产出/刷新分支选项（需已有生成内容） |
| POST | /api/chapters/:id/select-branch/:optionId | 选定走向并衍生下一章计划（覆盖式重选，已生成则409） |
| POST | /api/chapters/:id/audit-style | 触发章节文风校验并入库（需求13，复用文风引擎配置） |
| GET | /api/chapters/:id/style-audits | 文风校验历史记录列表 |
| GET | /api/chapters/:id/style-audits/:aid | 单条文风校验记录详情 |
| POST | /api/chapters/:id/style-audits/:aid/revise | 基于校验结果一键文风修订（body 可传 ignoredIndices 跳过被忽略问题；返回预览，不自动保存） |
| POST | /api/chapters/:id/fix-issue | 修复单条审计问题（body: auditType=quality/style + issue；返回预览，不自动保存） |
| POST | /api/chapters/:id/fix-all-quality | 质量审计一键修复（body: issues + ignoredIndices，仅 critical/major；返回预览，不自动保存） |
| GET | /api/world/books | 书籍列表（世界观按 book_id 隔离的切换源） |
| GET | /api/world/stats?bookId= | 世界观数据总览（各类数量，按 bookId 隔离） |
| GET | /api/world/characters | 人物列表 |
| GET | /api/world/characters/:id | 人物详情 |
| GET | /api/world/characters/:id/distill | 人物深度蒸馏（心智模型/决策启发式/人生阶段） |
| GET | /api/world/factions | 门派列表 |
| GET | /api/world/factions/:id | 门派详情（含成员） |
| GET | /api/world/locations | 地点列表 |
| GET | /api/world/skills | 功法列表 |
| GET | /api/world/skills/:id | 功法详情 |
| GET | /api/world/skills/:id/distill | 功法深度蒸馏（属性/招式/关系/归档，zaomeng 写入） |
| GET | /api/world/items | 法宝列表 |
| GET | /api/world/monsters | 妖兽列表 |
| GET | /api/world/materials | 丹药/灵材/毒物列表 |
| GET | /api/world/daily-items | 日常物品与信物列表 |
| GET | /api/world/faction-rules | 宗门规制列表 |
| GET | /api/world/season-events | 岁时节令与宗门事件列表 |
| GET | /api/world/style?bookId= | 文风引擎（全局配置 + 场景映射） |
| GET | /api/world/search | 全局搜索 |
| POST | /api/world/:collection | 世界观实体新增（软删除体系） |
| PUT | /api/world/:collection/:id | 世界观实体修改 |
| DELETE | /api/world/:collection/:id | 世界观实体软删除 |
| POST | /api/world/books | 新建用户书籍（世界观库可写，WS0；source_type='user'，system书禁改禁删） |
| GET | /api/world/import/sources?bookId= | 跨书引入源清单（WS2，按类型列出其他书可引入实体） |
| POST | /api/world/import | 跨书引入执行（WS2，整行复制改book_id+关系表ID重映射+去重+日志） |
| POST | /api/world/batch-import/extract | 文本抽取入库（WS3，WorldEntityExtractorAgent拆解→暂存任务awaiting_confirm） |
| GET | /api/world/batch-import/:id | 查询抽取任务状态与结果（WS3） |
| POST | /api/world/batch-import/:id/confirm | 确认抽取结果入库（WS3，按名称去重，source='text-extract'） |
| GET | /api/projects/:id/outlines/:oid/scenes | 场景节点列表（含人物/要素关联） |
| POST | /api/projects/:id/outlines/:oid/scenes | 创建场景节点 |
| PUT | /api/projects/:id/outlines/:oid/scenes/:sid | 更新场景节点 |
| DELETE | /api/projects/:id/outlines/:oid/scenes/:sid | 删除场景节点 |
| PUT | /api/projects/:id/outlines/:oid/scenes/reorder | 场景节点排序 |
| POST | /api/projects/:id/outlines/:oid/scenes/:sid/characters | 添加人物关联 |
| PUT | /api/projects/:id/outlines/:oid/scenes/:sid/characters/:aid | 修改人物关联（出场类型/备注） |
| DELETE | /api/projects/:id/outlines/:oid/scenes/:sid/characters/:aid | 删除人物关联 |
| POST | /api/projects/:id/outlines/:oid/scenes/:sid/elements | 添加要素关联 |
| PUT | /api/projects/:id/outlines/:oid/scenes/:sid/elements/:aid | 修改要素关联（备注/伏笔方向） |
| DELETE | /api/projects/:id/outlines/:oid/scenes/:sid/elements/:aid | 删除要素关联 |
| POST | /api/projects/:id/outlines/:oid/scenes/:sid/match-materials | 智能匹配素材（扫描文本→候选） |
| POST | /api/projects/:id/outlines/:oid/scenes/:sid/relations | 添加节点关系连线 |
| DELETE | /api/projects/:id/outlines/:oid/scenes/:sid/relations/:rid | 删除节点关系连线 |
| POST | /api/projects/:id/outlines/:oid/scenes/sync-chapters | 小纲同步到章节计划 |
| GET | /api/projects/:id/outlines/:oid/scenes/edit-logs | 对话修改日志列表 |
| POST | /api/projects/:id/outlines/:oid/scenes/edit-logs/:lid/rollback | 回滚某次修改 |
| POST | /api/projects/:id/outlines/:oid/scenes/validate | 小纲一致性深度校验（时间倒流error/跨峰跳转warning/结构/人物战力提醒，issue分error-warning-info三级，见8.5） |
| GET | /api/projects/:id/outlines/:oid/scenes/export | 导出小纲 |
| POST | /api/projects/:id/outlines/:oid/scenes/generate | AI生成场景节点 |
| POST | /api/projects/:id/outlines/:oid/scenes/chat | 自然语言对话编排小纲 |
| GET | /api/settings | 获取设置 |
| PUT | /api/settings | 保存设置 |
| POST | /api/settings/test-llm | 测试LLM连接 |
| GET | /api/settings/db-status | 数据库状态 |
| GET | /api/projects/:id/state/snapshots?status= | 人物状态快照列表（可按 pending/confirmed 过滤） |
| POST | /api/projects/:id/state/snapshots | 手动创建状态快照 |
| PUT | /api/state/snapshots/:sid | 更新状态快照 |
| POST | /api/state/snapshots/:sid/confirm | 确认状态快照 |
| GET | /api/projects/:id/state/timeline?status= | 时间线里程碑列表 |
| POST | /api/projects/:id/state/timeline | 手动创建时间线 |
| PUT | /api/state/timeline/:tid | 更新时间线 |
| POST | /api/state/timeline/:tid/confirm | 确认时间线 |
| POST | /api/projects/:id/state/bootstrap | 引导初始化（从诛仙人物库+卷大纲生成 chapter_no=0 的 pending 初始状态；body 可传 characterIds） |
| POST | /api/projects/:id/state/extract | 对指定章节已生成正文运行LLM状态抽取（body: {chapterNo}，结果 pending 落库） |
| GET | /api/projects/:id/foreshadow?status=&sourceType=&overdueOnly=&threshold= | 伏笔台账列表（含计算的 overdue/chaptersOpen，可按状态/来源/仅超期过滤；summary含branchDerived/unconfirmed/pendingBackfill） |
| GET | /api/projects/:id/foreshadow/overdue?threshold= | 超期未回收伏笔提醒 |
| POST | /api/projects/:id/foreshadow | 创建伏笔线 |
| POST | /api/projects/:id/foreshadow/promote | 从场景节点 foreshadowing_note 一键提升为伏笔线（body: {sceneNodeId,...}，写 source_type='scene'） |
| PUT | /api/foreshadow/:fid | 更新伏笔线（含状态流转/场景关联/回收章） |
| DELETE | /api/foreshadow/:fid | 删除伏笔线 |
| GET | /api/foreshadow/:fid/suggest-plant-chapters | 分支衍生伏笔推荐埋设章（纯规则零LLM，按tier提前N章，须≤分支来源章） |
| POST | /api/foreshadow/:fid/confirm | 确认分支衍生伏笔（is_confirmed false→true） |
| POST | /api/foreshadow/:fid/backfill-anchor | 锚点回填到待生成章 must_have_events（body: {chapterPlanId}，事务化） |
| POST | /api/foreshadow/:fid/backfill-revise | 修订回填已生成章（body: {chapterId,intensity}，Reviser预览不落库） |
| POST | /api/foreshadow/:fid/mark-planted | 修订确认后标记已埋设（body: {backfillMethod,backfillTargetChapterId,plantChapter}） |
| GET | /api/projects/:id/growth-stages?characterId= | 人物成长阶段列表（可按人物过滤，模块3） |
| POST | /api/projects/:id/growth-stages | 创建成长阶段 |
| PUT | /api/growth-stages/:gid | 更新成长阶段 |
| DELETE | /api/growth-stages/:gid | 删除成长阶段 |
| GET | /api/projects/:id/relations | 自定义人物关系列表（模块8） |
| POST | /api/projects/:id/relations | 创建自定义关系 |
| POST | /api/projects/:id/relations/infer | AI推演关系演变（输入两人物+事件→3个候选方案） |
| PUT | /api/relations/:rid | 更新自定义关系 |
| DELETE | /api/relations/:rid | 删除自定义关系 |
| GET | /api/projects/:id/quotes?chapterId=&characterName=&collected=&sourceType= | 金句列表（可按章节/角色/收藏/来源过滤，模块11） |
| POST | /api/projects/:id/quotes | 手动录入金句（source_type=manual） |
| POST | /api/projects/:id/quotes/import-preview | 批量导入·LLM预筛粘贴文本，返回候选金句（不入库，模块11） |
| POST | /api/projects/:id/quotes/import | 批量导入·审阅后金句入库（source_type=import，默认收藏，模块11） |
| PUT | /api/quotes/:qid | 更新金句（收藏/质量分/场景描述/文本） |
| DELETE | /api/quotes/:qid | 删除金句 |
| POST | /api/projects/:id/quotes/polish-text | 美化任意文本（不落库，body {text,characterName?,sceneDesc?}→三档版本，供手动打磨，6.35） |
| POST | /api/quotes/:qid/polish | 对库中金句生成三档美化版本（写 polished_versions，不覆盖 quote_text，6.35） |
| POST | /api/quotes/:qid/rescore | 重新评分（QuoteJudgeAgent 重打五维分+定级，6.35） |
| POST | /api/quotes/:qid/apply-preview | 回写预览：定位金句在章节正文中的位置返回前后文（不落库，6.35） |
| POST | /api/quotes/:qid/apply | 回写正文：精确 indexOf 首处匹配替换为美化版（生成新版本正文，polish_status=applied，6.35） |
| GET | /api/projects/:id/workshop?type= | 成长工坊实体列表（按type过滤skill/magic_item，模块9） |
| POST | /api/projects/:id/workshop | 创建基础功法/法宝实体 |
| POST | /api/projects/:id/workshop/fusion | 融合（2实体→预览，需confirm确认） |
| POST | /api/projects/:id/workshop/mutation | 变异（1实体→随机变体预览） |
| POST | /api/projects/:id/workshop/upgrade | 强化（原地修改，直接执行） |
| POST | /api/projects/:id/workshop/evolution | 进化预览（地阶巅峰→天阶，需confirm确认） |
| POST | /api/projects/:id/workshop/confirm | 确认预览结果→插入新实体 |
| GET | /api/projects/:id/workshop/history?entityType=&entityId= | 成长记录列表 |
| POST | /api/projects/:id/workshop/revert/:recordId | 回滚到操作前快照 |
| GET | /api/projects/:id/workshop/tree?entityType=&entityId= | 融合树（成长血缘路径+后代列表，模块9二期） |
| GET | /api/projects/:id/workshop/:entityType/:entityId | 实体详情（含growthInfo） |
| PUT | /api/projects/:id/workshop/:entityType/:entityId | 更新实体（名称/描述/关联人物等） |
| DELETE | /api/projects/:id/workshop/:entityType/:entityId | 软删除实体 |
| GET | /api/settings/style-presets | 文风预设列表（模块7，4个预设：热血战斗/抒情/日常轻松/诡异悬疑） |
| GET | /api/settings/direction-catalog | 剧情方向体系目录（主/次方向编码表，分支方向标注用） |
| POST | /api/chapters/:id/rewrite-perspective | 视角改写（模块6，指定目标视角人物→ReviserAgent改写→追加到perspective_versions） |
| PUT | /api/chapters/:id/content | 手动保存编辑后的章节正文 |
| DELETE | /api/chapters/:id | 删除章节计划（及关联生成数据） |
| DELETE | /api/outlines/:id | 删除卷大纲 |
| POST | /api/projects/:id/outlines/:oid/scenes/import-from-chapters | 从章节计划反向导入场景节点 |
| GET | /api/projects/:id/direction-stats | 剧情方向占比统计（分支选项主方向分布） |
| GET | /api/projects/:id/direction-check | 方向失衡检测（连续同方向/单一化预警） |
| POST | /api/foreshadow/:fid/extract-dna | 伏笔DNA抽取（LLM提炼伏笔类型/强度/回收手法特征） |
| GET | /api/foreshadow/:fid/suggest-techniques | 伏笔回收手法推荐 |
| GET | /api/projects/:id/health | 健康度体检9维评分（伏笔/因果/方向/钩子/状态确认等，零LLM纯规则） |
| GET | /api/projects/:id/plot-materials?table=&keyword= | 剧情素材浏览（plot_material_* 四表，二期RAG人工干预） |
| GET/POST | /api/projects/:id/impact/definitions | 影响定义列表/新建（含全局预设+项目自定义） |
| PUT/DELETE | /api/impact/definitions/:defId | 更新/删除影响定义 |
| GET | /api/projects/:id/impact/character-state | 人物影响当前状态（数值+标签） |
| GET | /api/projects/:id/impact/world-state | 世界观影响当前状态 |
| GET | /api/projects/:id/impact/relation-state | 关系影响当前状态（阶段4） |
| GET | /api/projects/:id/impact/relation-context | 关系影响上下文预览（注入写作的关系文本） |
| GET | /api/projects/:id/impact/links/:optionId | 某分支选项的影响绑定明细 |
| GET | /api/projects/:id/impact/branch-options/:optionId/preview | 选项影响预览（选定前展示变更效果） |
| GET | /api/projects/:id/impact/target-candidates | 影响目标人物候选（POV→项目默认→已出场三级兜底） |
| GET | /api/projects/:id/impact/history | 影响变更历史 |
| GET | /api/projects/:id/impact/suggest | AI建议影响绑定（按选项文本推荐影响项） |
| GET | /api/projects/:id/impact/direction-recommend | 基于影响状态的剧情方向推荐 |
| GET | /api/projects/:id/causal-chains?status= | 因果链列表（阶段4） |
| GET | /api/projects/:id/causal-chains/context | 因果链写作上下文预览（待兑现因果注入文本） |
| GET | /api/projects/:id/causal-chains/stats | 因果链统计（各状态计数/回收率） |
| GET | /api/projects/:id/causal-chains/:chainId | 因果链详情 |
| POST | /api/projects/:id/causal-chains | 手动创建因果链 |
| PUT | /api/projects/:id/causal-chains/:chainId/status | 因果链状态流转（planted→…→resolved） |
| POST | /api/projects/:id/causal-chains/expire | 批量过期处理（超出兑现窗口置expired） |
| GET | /api/projects/:projectId/custom-characters | 自定义人物列表（对外负数ID） |
| POST | /api/projects/:projectId/custom-characters/random | 一键随机生成完整人物配置 |
| POST | /api/projects/:projectId/custom-characters/random-name | 随机人名（按种族/性别） |
| GET | /api/projects/:projectId/custom-characters/:id | 人物详情（含判词/天赋反查详情） |
| POST | /api/projects/:projectId/custom-characters | 创建人物（三步向导提交，LLM生成小传降级模板兜底） |
| PUT | /api/projects/:projectId/custom-characters/:id | 更新人物 |
| POST | /api/projects/:projectId/custom-characters/:id/generate-verdict | 生成判词七绝+二字考语 |
| DELETE | /api/projects/:projectId/custom-characters/:id | 软删除人物 |
| POST | /api/projects/:projectId/custom-characters/import | 从世界观引用人物（快照复制，sourceRef记录来源） |
| POST | /api/projects/:projectId/custom-characters/smart-match | 以文拟人·智能匹配（WS4，ForgeSmartMatchAgent映射枚举+后端校验约束→回填表单参数） |
| POST | /api/projects/:projectId/custom-characters/:id/auto-voice | 一键补全人物对白风格（ux-gen autoVoice，结果不落库填充表单，v1.4 US-18） |
| GET | /api/projects/:id/custom-weapons | 自定义武器列表（神兵坊） |
| GET | /api/projects/:id/custom-weapons/catalog | 武器图鉴（门类/形制/材质/特质/底蕴全量目录） |
| GET | /api/projects/:id/custom-weapons/:wid | 武器详情 |
| POST | /api/projects/:id/custom-weapons/random | 随机武器（确定性骰子零LLM） |
| POST | /api/projects/:id/custom-weapons/random-name | 随机武器名号（NamingAgent） |
| POST | /api/projects/:id/custom-weapons | 创建武器 |
| PUT | /api/projects/:id/custom-weapons/:wid | 更新武器 |
| DELETE | /api/projects/:id/custom-weapons/:wid | 软删除武器 |
| POST | /api/projects/:id/custom-weapons/:wid/upgrade | 强化（底蕴层内提升，直接执行） |
| POST | /api/projects/:id/custom-weapons/:wid/evolution | 进化预览（底蕴跃升，需confirm） |
| POST | /api/projects/:id/custom-weapons/:wid/mutation | 变异预览（需confirm） |
| POST | /api/projects/:id/custom-weapons/fusion | 融合预览（2武器，需confirm） |
| POST | /api/projects/:id/custom-weapons/confirm | 确认预览结果入库 |
| GET | /api/projects/:id/custom-weapons/:wid/history | 养成记录 |
| POST | /api/projects/:id/custom-weapons/revert/:recordId | 回滚到操作前快照 |
| POST | /api/projects/:id/custom-weapons/:wid/generate-lore | 生成兵器谱文案（WeaponLoreAgent：名号/化名/简介/招式，入库weapon_lore；特质数据源generatedTraits优先、老四列兜底） |
| GET | /api/projects/:id/custom-weapons/:wid/lore | 武器文案版本列表 |
| POST | /api/projects/:id/custom-weapons/lore/:loreId/set-current | 切换当前生效文案版本 |
| POST | /api/projects/:id/custom-weapons/generate-traits | 方向组合特质实时预览（零token，方向×形制×材质×道则） |
| POST | /api/projects/:id/custom-weapons/:wid/generate-sense-card | 五感兵器卡生成/单模块重生成（WeaponSenseCardAgent） |
| POST | /api/projects/:id/custom-weapons/:wid/complete-sense-card | 老武器补全五感卡（包装旧特质+默认控制项） |
| GET | /api/projects/:id/custom-weapons/scars/definitions | 烙印定义列表（4种预定义烙印） |
| GET | /api/projects/:id/custom-weapons/:wid/scars | 武器烙印列表 |
| POST | /api/projects/:id/custom-weapons/:wid/scars | 添加烙印（预定义/自定义） |
| DELETE | /api/projects/:id/custom-weapons/:wid/scars/:traitId | 删除烙印 |
| POST | /api/projects/:id/custom-weapons/bonds/scan | 扫描生成因果羁绊（三维度评分自动匹配） |
| GET | /api/projects/:id/custom-weapons/:wid/bonds | 武器羁绊列表 |
| POST | /api/projects/:id/custom-weapons/:wid/recraft | 重铸 |
| POST | /api/projects/:id/custom-weapons/:wid/dao-title | 套装道号生成（写 custom_character.daoTitle/comboAbility） |
| POST | /api/projects/:id/custom-weapons/:wid/demonize | 魔改（走火入魔） |
| POST | /api/projects/:id/custom-weapons/:wid/purify | 净化 |
| POST | /api/projects/:id/custom-weapons/counter | 天命克制计算 |
| POST | /api/projects/:id/custom-weapons/migrate | 老数据迁移 |
| POST | /api/projects/:id/custom-weapons/import | 从世界观引用法宝（快照复制，sourceRef记录来源） |
| POST | /api/projects/:id/custom-weapons/smart-match | 以文拟器·智能匹配（WS4，ForgeSmartMatchAgent映射枚举+后端校验约束→回填表单参数） |
| GET | /api/projects/:id/custom-techniques | 自定义功法列表（九大道则） |
| GET | /api/projects/:id/custom-techniques/catalog | 功法目录（道则/体例/附录词条全量） |
| GET | /api/projects/:id/custom-techniques/compat/:mainDao | 辅修道则相容性查询 |
| GET | /api/projects/:id/custom-techniques/:tid | 功法详情 |
| POST | /api/projects/:id/custom-techniques/random | 随机功法（确定性骰子） |
| POST | /api/projects/:id/custom-techniques/random-name | 随机功法名号（NamingAgent） |
| POST | /api/projects/:id/custom-techniques | 创建功法 |
| PUT | /api/projects/:id/custom-techniques/:tid | 更新功法（绑定人物触发个人变种生成） |
| DELETE | /api/projects/:id/custom-techniques/:tid | 软删除功法 |
| POST | /api/projects/:id/custom-techniques/:tid/generate-description | 生成功法详解（TechniqueLoreAgent，500-700字） |
| POST | /api/projects/:id/custom-techniques/import | 从世界观引用功法（快照复制，sourceRef记录来源） |
| POST | /api/projects/:id/custom-techniques/smart-match | 以文拟功·智能匹配（WS4，ForgeSmartMatchAgent映射枚举+后端校验约束→回填表单参数） |
| GET | /api/projects/:pid/custom-characters/:cid/martial | 武学档案（lores数组+本项目功法/武器列表） |
| POST | /api/projects/:pid/custom-characters/:cid/martial/bind | 设置绑定（写linkedCharacterIds） |
| POST | /api/projects/:pid/custom-characters/:cid/martial/generate | 生成搭配（功法×武器融合招式+小传，upsert version+1） |
| DELETE | /api/projects/:pid/custom-characters/:cid/martial/:loreId | 删除单条搭配 |
| POST | /api/projects/:pid/custom-characters/:cid/martial/:loreId/regenerate | 重新生成单条搭配（version+1） |
| DELETE | /api/projects/:pid/custom-characters/:cid/martial | 软删除全部档案 |
| GET | /api/projects/:pid/characters/:characterId/techniques | 人物已绑功法+个人变种列表（千人千面） |
| POST | /api/projects/:pid/characters/:characterId/techniques/:techniqueId/generate-variant | 生成个人变种（四因子推导） |
| POST | /api/projects/:pid/characters/:characterId/techniques/:variantId/reroll-variant | 重骰变种 |
| PUT | /api/projects/:pid/characters/:characterId/techniques/:variantId/upgrade | 变种版本迭代（剧情成长后） |
| DELETE | /api/projects/:pid/characters/:characterId/techniques/:variantId | 删除变种 |
| GET | /api/hotspot/sources | 可用榜单源列表 |
| POST | /api/hotspot/crawl | 发起榜单抓取（异步批次） |
| GET | /api/hotspot/batches | 抓取批次列表 |
| GET | /api/hotspot/batches/:id/novels | 批次内原始书目列表 |
| POST | /api/hotspot/analyze | LLM分析提炼灵感（批次→insight条目） |
| GET | /api/hotspot/insights?type=&status= | 灵感列表 |
| PATCH | /api/hotspot/insights/:id | 更新灵感状态（kept/discarded） |
| POST | /api/hotspot/insights/:id/push | 推送灵感入剧情素材库（plot_material_*） |
| GET | /api/hotspot/insights/:id/push-log | 推送记录 |
| GET | /api/material-kb/style-presets | 文风预设列表（Python蒸馏产出） |
| GET | /api/material-kb/style-presets/:id | 文风预设详情 |
| DELETE | /api/material-kb/style-presets/:id | 文风预设软删 |
| GET | /api/material-kb/domain-knowledge | 领域知识列表 |
| GET | /api/material-kb/domain-knowledge/:id | 领域知识详情 |
| DELETE | /api/material-kb/domain-knowledge/:id | 领域知识软删 |
| GET | /api/material-kb/etl/health | 蒸馏ETL服务健康检查（代理Python gui_server） |
| POST | /api/material-kb/etl/run/:kind | 发起蒸馏任务（style/domain/material） |
| GET | /api/material-kb/etl/tasks | ETL任务列表 |
| GET | /api/material-kb/etl/task/:tid | ETL任务进度详情 |
| GET | /api/material-kb/etl/browse | 蒸馏产出文件浏览 |
| POST | /api/projects/:pid/treasure/hunt | 淘宝十连（全面武器化：纯规则生成，零token，<200ms；10件全部为秘宝/武器，三档品阶有灵90%/传承9%/遗珍1%，打眼fakeRatio默认0.1） |
| GET | /api/projects/:pid/treasure/items?type=&status= | 淘宝物品列表（全面武器化后均为secret；bag/converted状态过滤） |
| GET | /api/projects/:pid/treasure/records | 淘宝记录列表 |
| GET | /api/projects/:pid/treasure/settings | 淘宝设置（仅fakeRatio打眼比例，小物比例已废） |
| PUT | /api/projects/:pid/treasure/settings | 更新淘宝设置 |
| GET | /api/projects/:pid/treasure/:id | 物品详情（秘宝按解锁阶段过滤返回） |
| POST | /api/projects/:pid/treasure/:id/bind | 秘宝绑定人物 |
| POST | /api/projects/:pid/treasure/:id/collect | 收入囊中 |
| DELETE | /api/projects/:pid/treasure/:id | 丢弃（软删除） |
| PUT | /api/projects/:pid/treasure/:id/note | 更新备注 |
| POST | /api/projects/:pid/treasure/:id/convert | 秘宝入库：强制转正式武器/功法（force=true 跳过阶段5门槛，返回新实体名，供淘宝「入库」按钮加入锻造列表） |
| GET | /api/projects/:id/custom-maps | 山河舆图-地图列表（含地点计数） |
| POST | /api/projects/:id/custom-maps | 新建地图（name/width/height/description） |
| PUT | /api/projects/:id/custom-maps/:mapId | 更新地图 |
| DELETE | /api/projects/:id/custom-maps/:mapId | 删除地图（守卫：至少保留一张地图） |
| GET | /api/projects/:id/custom-locations?mapId=&entityStatus=&locationType= | 山河舆图-地点列表（可按地图/草稿状态/类型过滤） |
| POST | /api/projects/:id/custom-locations | 新建地点（mapId/name/x/y/locationType…，缺省地图自动 getOrCreateDefaultMap） |
| PUT | /api/projects/:id/custom-locations/:locId | 更新地点（body 带 confirm:true 时同时 draft→official 转正） |
| DELETE | /api/projects/:id/custom-locations/:locId | 软删除地点 |
| POST | /api/projects/:id/custom-locations/:locId/confirm | 地点转正（draft→official） |
| POST | /api/projects/:id/custom-locations/import-zhuxian | 诛仙库地点批量导入（上限500条，draft+边缘坐标+metadata.zhuxianId 溯源，按名去重） |
| GET | /api/projects/:id/custom-locations/distance?fromId=&toId= | 行程估算（Dijkstra 最短路 + estimateTravel 文案 + pathNames 途经点） |
| GET | /api/projects/:id/custom-location-links?mapId= | 地点路径连线列表 |
| POST | /api/projects/:id/custom-location-links | 新建连线（重复边复用返回已有） |
| DELETE | /api/projects/:id/custom-location-links/:linkId | 删除连线 |
| GET | /api/projects/:id/narrative/milestones | 叙事里程碑列表（按 sort_order 排序） |
| POST | /api/projects/:id/narrative/milestones | 创建里程碑 |
| PUT | /api/narrative/milestones/:mid | 更新里程碑 |
| DELETE | /api/narrative/milestones/:mid | 删除里程碑 |
| POST | /api/projects/:id/narrative/milestones/extract | 从大纲自动抽取里程碑（LLM，pending 待确认） |
| PUT | /api/projects/:id/narrative/milestones/reorder | 里程碑重排序（body: {milestoneIds: number[]}） |
| GET | /api/projects/:id/narrative/branch-arcs | 分支弧列表（含进度信息） |
| POST | /api/projects/:id/narrative/branch-arcs | 从分支选项创建分支弧（关联目标里程碑） |
| POST | /api/projects/:id/narrative/branch-arcs/:aid/converge | 触发弧收敛（convergence-engine 改写后续章节计划） |
| POST | /api/projects/:id/narrative/branch-arcs/:aid/extend | 延长弧（+2章，一次性豁免） |
| POST | /api/projects/:id/narrative/branch-arcs/:aid/abandon | 废弃弧 |
| POST | /api/projects/:id/narrative/branch-arcs/:aid/promote | 提升弧元素（注册新元素到弧） |
| GET | /api/projects/:id/narrative/rewrite-logs?arcId= | 计划改写日志列表 |
| POST | /api/narrative/rewrite-logs/:lid/rollback | 回滚某次计划改写 |
| POST | /api/v1/dialogue/iceberg | 冰山台词生成（真相→表面→行为三层，full_dialogue+quality_score+executed_steps） |
| POST | /api/v1/dialogue/iceberg/regenerate | 冰山分步重生成（仅重生成指定层） |
| POST | /api/v1/conflict/generate | 冲突方案生成（欲望→阻力→代价 + 七寸映射 + 情绪曲线四参数） |
| POST | /api/v1/conflict/regenerate | 冲突分步重生成 |
| POST | /api/v1/conflict/compose | 五步组合成戏（双引擎产物合成完整场景戏文） |
| POST | /api/v1/validate | 独立质量体检打分（不与生成绑定） |
| GET | /api/v1/outline/conflict-draft | 大纲联动预填（大纲场景→冲突草案） |
| GET | /api/projects/:id/outlines/stepwise-draft | 读取分步生成草稿（雪花法续进，存于 creative_project.snowflake_draft） |
| PUT | /api/projects/:id/outlines/stepwise-draft | 保存分步草稿（整体覆盖，中途退出可续进） |
| POST | /api/projects/:id/outlines/finalize | 分步完成同构落库（与 one-shot 同一 saveOutlineVolumes 路径，含回标，完成后清空草稿） |
| GET | /api/projects/:id/benchmark-materials | 对标素材列表（plot_material_benchmark，四类 character/plot_unit/style/setting） |
| POST | /api/projects/:id/benchmark-materials | 手动添加对标素材 |
| DELETE | /api/projects/:id/benchmark-materials/:mid | 对标素材软删除 |
| PATCH | /api/projects/:id/benchmark-materials/:mid/pin | 置顶/取消置顶（置顶=写作强制融入） |
| POST | /api/projects/:id/benchmark/analyze | 拆文分析（书名+≥100字文本→LLM 拆四类资产批量入库） |

> 注：`chapters.ts` 内各章节级端点均同时注册了 `/chapters/:id/*` 与 `/projects/:pid/chapters/:id/*` 双路径别名，表中仅列短路径。

### 5.3 LLM客户端

基于 `openai` SDK，支持：
- 非流式调用 `chatCompletion()`
- 流式调用 `streamChatCompletion()` → 返回 ReadableStream
- 项目级配置覆盖（每个项目可独立设置 baseUrl/apiKey/model）
- **主备模型自动切换**：首选模型调用失败（5xx/超时/空内容）后按 `LLM_FALLBACK_MODELS`（逗号分隔）逐个尝试备用模型；可选 `LLM_FALLBACK_BASE_URL`/`LLM_FALLBACK_API_KEY` 指向独立备用供应商（应对首选供应商整体宕机）；401 认证错误不触发切换；项目级自定义 baseUrl 的场景不启用全局备用。切换日志 `[llm-fallback]` 输出到服务端控制台
- Token估算（中文约1.5字/token）
- 连接测试 `testLlmConnection()`

### 5.4 RAG检索

`retriever.ts` 负责从诛仙库检索世界观数据：
- `searchCharacters(keyword)` — 人物搜索（支持 text[] 数组列 ::text ILIKE）
- `getCharacterRelations(charIds)` — 人物关系
- `getRecentChapterAnalyses(limit)` — 最近章节分析
- `getSimilarScenes(embedding, limit)` — 向量相似场景
- `getEntityNameDirectory()` — 去重实体名目录（人物/门派/地点/功法/法宝，5分钟缓存），供场景脚本智能匹配做子串命中
- `getCharacterDistillations(charIds)` — 批量人物蒸馏（心智模型/决策启发式/人生阶段，3次inArray查询按charId分组），返回轻量prompt字符串
- `getTechniqueDistillations(skillIds)` — 批量功法蒸馏（属性/招式/关系，3次inArray查询按skillId分组），返回轻量prompt字符串
- `getTechniqueAttributes/Moves/Relations/DistillArchive(skillId)` — 单功法蒸馏查询（供世界浏览器展示，含原始JSON归档）

`context-builder.ts` 负责编排上下文包：
- 根据章节计划中的人物/地点/功法ID收集设定
- 拼接前文摘要、作者规则
- `trimToTokenBudget()` 按token预算裁剪
- **人物心智模型层（需求5）**：为每个出场人物附加诛仙库蒸馏的深层行为逻辑——`mentalModels`(心智模型one_liner)、`heuristics`(决策启发式"规则名：规则内容")、`lifeStages`(人生阶段"阶段名：性格状态")。仅加载有蒸馏数据的人物，token极省。WriterAgent在【出场人物设定】块渲染这三类，让人物言行有内在依据而非只有表层性格。超token预算时次要人物(第4个起)的蒸馏会被裁剪。
- **功法蒸馏层（需求11）**：zaomeng 工具将功法蒸馏写入诛仙库 4 张表——`technique_attribute`(品阶/属性/难度/效果)、`technique_move`(招式名/效果/施展条件)、`technique_relation`(功法间克制/互补/同宗关系)、`technique_distill_archive`(原始JSON归档)，均带 `distill_source='zaomeng'`、`is_deleted`、`skill_id` 外键指向 `novel_skill_lib.id`。生成管线经 `getTechniqueDistillations` 批量加载涉及功法的蒸馏，WriterAgent 在功法设定块渲染「功法属性/招式/功法关系」三类，让战斗与修炼场景能引用具体招式名与功法克制关系。世界浏览器功法详情弹窗（SkillDetail）设「设定/深度蒸馏」标签页展示全部四块（归档为可折叠原始JSON）。
- **自定义功法/法宝层（模块9）**：`getCustomEntitiesForCharacters(projectId, characterIds)` 查询创作库 `custom_magic_item_lib` + `custom_technique`（+自定义武器，均 is_deleted=false），按 `linked_character_ids` 与章节出场人物ID交集匹配，注入 `ContextPackage.customEntities`。WriterAgent 渲染【自定义功法/法宝设定】块（品阶/特效含稀有度标签/副作用+铁律），AuditorAgent 第16维据此审查表现一致性。注：旧 `custom_skill_lib` 已退役（见 6.28），功法注入改由 `custom_technique` 承担。

`style.ts` 文风引擎（诛仙库 `style_*` 表）：
- 三层结构：全局文风配置（`style_global_config`）、场景维度映射（`style_scene_mapping`，按情绪/功能/交互等维度建 triggerKey）、禁用词表（`style_banned_word`）。
- 接入管线三处：`context-builder` 将匹配到的文风指令注入 `ContextPackage.style` 供 Writer 参考；`runner` 在生成后做确定性禁用词扫描（不耗 LLM）；Auditor 第9维度「风格一致性」据此打分。
- 前端经 `GET /api/world/style?bookId=` 读取配置。

---

## 6. 多Agent管线

### 6.1 管线流程

```
章节计划 → ContextComposer(编排上下文，含已确认状态快照/时间线)
         → WriterAgent(写作)
         → AuditorAgent(审计)
         → [未通过?] → ReviserAgent(修订) → 重新审计
         → [通过] → 保存章节
         → StateExtractorAgent(生成后自动抽取状态，pending待确认，best-effort)
```

### 6.2 Agent职责

| Agent | 职责 | 输入 | 输出 |
|-------|------|------|------|
| ContextComposer | 从诛仙库检索世界观数据，编排上下文包（含本项目已生成章节摘要、已确认状态快照与时间线） | 章节计划 + 项目配置 | ContextPackage |
| WriterAgent | 根据上下文和计划生成章节正文（注入【状态追踪】块防漂移） | ContextPackage + 章节计划 | 章节文本 |
| AuditorAgent | 30维度审计+加权计分（auditor.ts:352，人物连续性细分1.1-1.5、情节逻辑细分6.1-6.5；人物连续性五类/关系/门派/功法法宝/地点/情节逻辑五层因果链/情绪冲突/文笔/风格一致性/状态一致性/视角合规性/分支承接/锚点覆盖/伏笔呼应/人物阶段/自定义功法法宝/对白张力/章末拉力/冲突强度一致性/因果律与代价守恒/方向匹配度/影响状态一致性/命格与资质合理性/宗门身份合理性/因果回收率/关系一致性/自定义人物OOC/指定素材融入率/任务推进合理性/认知越界），情节逻辑+对白权重1.5x | 章节文本 + ContextPackage | AuditReport (score + dimensionScores + issues) |
| ReviserAgent | 根据审计问题修订文本，含六层修订优先级（逻辑>人物>场景>对白>章末>文风）+对白定向修订策略+去AI味五分型改写 | 章节文本 + AuditReport | 修订后文本 + 修订笔记 |
| StateExtractorAgent | 生成后从正文抽取人物状态快照与时间线里程碑（低温0.2，名字→ID解析，pending落库待人工确认） | 章节正文 + 章节元信息 | 状态快照 + 时间线（pending） |
| BranchGeneratorAgent | 章节生成后推演 2-4 个下一章走向选项（温度0.8，含影响标签；借鉴四类剧情素材并自报 basedOn 标注、保底产出恰好1个 encounter 奇遇选项；并入世界观推演 prediction） | 章节正文 + 章节元信息 + 选项数 + 四类素材数组(可空) + 世界观设定(人物/规制/节令/文风) | `{options(含 optionType/sourceMaterials), prediction}` |
| StyleAuditorAgent | 章节文风专项校验（需求13）：禁用词本地精确匹配 + 6维LLM低温判定（心智/比例/意象/视角/反模式含去AI味五分型/句式），反模式维度输出aiFlavorType分类（empty_summary/cliche_atmosphere/adjective_stack/explanatory_dialogue/uniform_rhythm） | 章节正文 + StyleContext | StyleAuditReport (综合分+维度分+issues含aiFlavorType) |
| GrowthAgent | 功法/法宝成长操作（模块9）：融合(2→1,temp0.8)/变异(1→随机,temp0.95)/强化(原地叠加,temp0.6)/进化(地阶巅峰→天阶,temp0.7)，含三层确定性校验（品阶上限/特效稀有度/副作用绑定） | 源实体 + 操作参数 | GrowthResult (preview实体 + narrative + validationErrors) |
| BranchForeshadowExtractorAgent | 分支选定后从走向中抽取 2-3 条可前置埋设的伏笔（低温0.3，必出1条t1核心转折+1-2条t2细节暗示，含hint_clue/DNA四元组；解析失败返回空数组不阻断主流程） | 分支选项信息 | 待确认伏笔数组（source_type='branch'/is_confirmed=false 落库） |
| CausalExtractorAgent | 因果链LLM增强抽取（规则保底之上的可选语义补充，低温0.3，最多1条；受 causalConfig.llmEnhance 开关控制，默认开） | 分支描述 | 因果线条目（causeType/effectType/兑现窗口/强度/优先级） |
| NamingAgent | 通用命名模块：按门类形制/道则体例生成武器、功法名号（仅名号走LLM，特质随机走确定性引擎省token） | 门类/形制/底蕴或道则/体例/深度 | 名号数组 |
| WeaponLoreAgent | 武器文案生成Skill：按提示词工程方案生成「武器名号/对外化名/一句话简介/配套招式」，结构化解析后入库 weapon_lore（温度0.7、约800token；特质入参generatedTraits优先——自带古风名+描述按四类分组进prompt，老四列ID解析为中文名兜底；与NamingAgent职责分离） | 武器参数（custom_weapon行子集，含generatedTraits?） | WeaponLoreResult (name/fakeName/intro/moves) |
| TechniqueLoreAgent | 功法详解生成Skill：按全部选中标签生成500-700字功法详解（核心逻辑/修行要点/战斗表现，温度0.4、约1000token；铁律：功法无品级只有道则深度之别） | 功法参数（custom_technique行子集） | 详解文本 |
| WorldEntityExtractorAgent | 世界观文本抽取（WS3）：粘贴的设定文本→8类实体（人物/门派/地点/功法/法宝/妖兽/灵材/信物）结构化（温度0.2、约3000token；zod逐类校验，仅抽取原文明确字段，未知字段省略） | 原始文本 + 目标类型集 | WorldExtractionResult（8个实体数组） |
| ForgeSmartMatchAgent | 三工坊智能匹配（WS4）：自然语言描述→人物/法宝/功法表单枚举参数（温度0.3、约1000token；LLM仅做描述→枚举键映射，互斥/上限/兼容等确定性约束由 services/forge-smart-match.ts 防御性校验兜底） | 工坊类型 + 描述 + 枚举上下文 | 合法枚举参数对象 |
| CustomEntityExtractorAgent | 章节实体自动抽取（实体自动维护）：从章节正文识别新人物/武器/功法/地点 + 老实体增量动态（低温；入参带已有实体名与诛仙库名单做排除，sensitivity 分档输出） | 章节正文 + 已有实体名单 + 诛仙库名单 + 配置 | ExtractionResult（newCharacters/newWeapons/newTechniques/newLocations + updates[]） |
| QuoteJudgeAgent | 金句评审（模块11质量升级）：五维评分（意境画面/韵律节奏/哲理深度/情感张力/传播记忆点各0-20）+ worthy 判定（temp0.1，prompt 内置反膨胀打分纪律，宁缺毋滥）；total 本地求和定级（≥90 legendary / 80-89 good / 70-79 candidate） | 金句候选列表（≤10条批量一次调用） | [{worthy, scores, reason}] |
| QuotePolisherAgent | 金句美化（模块11质量升级）：对达标金句生成三档美化版本（conservative保守润色/balanced意象升级/deep升华重构），铁律"宁可不改不改坏"、保留原意与角色口吻 | 金句原文 + 角色名 + 场景描述 | PolishVersion[]（style/text/note） |

### 6.3 SSE事件类型

| 事件 | 数据 | 说明 |
|------|------|------|
| token | {content} | 写作token流 |
| status | {phase} | 阶段变更 (context/writing/auditing/revising) |
| context | {上下文摘要} | 上下文编排完成后推送的上下文包概览 |
| pre_check | {issues} | 生成前置检查结果（方向/状态风险提示） |
| audit | {score, issues, passed} | 审计报告 |
| branch_ready | {chapterPlanId, options, prediction} | 章节生成后产出的剧情分支选项+后续走向推演（需求12） |
| plot_duplication_warning | {warnings} | 剧情重复度预警（与历史章节桥段相似度过高） |
| hook_rotation_warning | {warnings} | 章末钩子类型连用预警（钩子轮换检测） |
| entities_extracted | {result} | 实体自动维护抽取结果（新增人物/武器/功法/地点计数，步骤7.8） |
| teleport_warning | {warnings} | 瞬移预警（正文地点间御剑行程过短，疑似瞬移，山河舆图） |
| complete | {content, audit} | 生成完成 |
| error | {message} | 错误 |

### 6.4 任务状态机

```
pending(queued) → running → auditing → revising → completed
       ↑                ↘                        ↗
       │                 → failed ──→ pending(retry_wait) [未达maxRetries]
       │                          ↘→ failed(error)       [达maxRetries]
       └── 重启恢复(running/auditing/revising → pending)
                                    → cancelled
```

- `current_step='queued'`：已入队等待 worker 消费
- `current_step='retry_wait'`：失败后等待指数退避（30s/120s/480s）
- 重启恢复：服务启动时 `recoverStaleTasks()` 将卡在 running/auditing/revising 的任务重置为 pending

### 6.5 POV限知视角约束（需求7）

章节计划可声明 POV 视角人物（`chapter_plan.pov_character_ids`，`bigint[]`），用于约束生成时不得出现上帝视角、跳他人心理、写不在场事件等问题。

- **数据链路**：前端章节计划表单用 `CharacterMultiSelect` 角色选择器（数据源 `useAllCharacters` = 诛仙库原生人物 + 本项目自定义人物，自定义人物名称带★、ID 为负数）直接勾选产出 `povCharacterIds`（含负数ID）提交。后端 `chapters.ts` 的 `resolvePovCharacterIds(projectId, explicitIds, names)` 仍兼容按名解析：诛仙库人物经 `getEntityNameDirectory()` 精确匹配（同名取最小ID），自定义人物查 `custom_character` 表按名匹配返回负数ID，两路均与显式ID合并去重、解析失败不阻断 → 落库 `pov_character_ids`。`buildContextForChapter` 把 POV 人物并入出场人物加载（负数ID 分流到 `getCustomCharactersByIds`），并解析出 `povCharacterNames` 挂到 `chapterPlan`。
- **Writer 视角铁律**：仅当 `povCharacterNames` 非空时，系统提示注入【视角铁律】块。单视角人物=全程锚定一人；多视角人物=允许章内切换但须以场景转换/空行分隔、任一时刻只锚定一人。均禁止写他人内心、禁止上帝视角写不在场事件。未声明 POV 时回退文风层全局 `perspectiveRules`（书级通用，不锚定具体人物）。
- **Auditor 第11维度视角合规性**：仅当声明了 POV 人物时审查，越界（跳他人内心/上帝视角写不在场）报 major，轻微游移报 minor；未声明时不审查此项。
- **前端**：`OutlineEditor` 章节计划创建弹窗"添加"按钮已接通 `chaptersApi.create` 真正落库（原为空壳），POV 由 `CharacterMultiSelect` 选择器勾选（可搜索、含★自定义人物，选中即产出负数ID，不再依赖人名解析）；`GET /projects/:id/outlines` 携带各卷 `chapters` 并解析 `povCharacterNames` 供列表展示（负数ID 解析为★前缀自定义人物名）。

注意：`pov_character_ids` 数据库列实际类型为 `bigint[]`，Drizzle Schema 须用 `bigint(...).array()`（早期误声明为 jsonb，因字段长期为空未暴露，需求7首次写入时发现并修正）。

### 6.6 批量生成队列（需求8）

生成任务采用"数据库即队列"架构：所有任务以 `pending` 状态持久化到 `generation_task` 表，内存 worker 定时轮询消费，服务重启不丢任务。

- **入队**：`POST /start`（单章）和 `POST /batch`（批量）均创建 `status='pending', current_step='queued'` 的任务记录。批量入队共享 `batch_id`，`position` 按卷号+章节号排序（保证顺序生成，后章可吃到前章摘要）。
- **队列执行器**（`pipeline/queue.ts`）：`setInterval` 每 2s 轮询，按 `position → created_at → id` 排序取候选，原子认领（`UPDATE...WHERE status='pending' RETURNING`）防重复执行。并发数由 `QUEUE_CONCURRENCY` 环境变量控制（默认1=顺序）。
- **失败重试**：指数退避，`backoff(n) = 30s × 4^(n-1)`（30s/120s/480s），`max_retries` 默认3。未达上限时任务回到 `pending`（`current_step='retry_wait'`），`completed_at` 记录失败时间用于计算退避窗口。
- **重启恢复**：服务启动时 `recoverStaleTasks()` 将 `running/auditing/revising` 状态的任务重置为 `pending`，worker 启动后自动消费（含历史孤儿任务）。
- **取消**：`cancelGeneration()` 对 pending 任务直接置 `cancelled`（出队），对 running 任务通过 AbortController 中断。
- **SSE兼容**：前端仍通过 `GET /stream/:taskId` 轮询任务状态，`current_step='queued'` 映射为前端 `queued` 阶段显示"排队等待中"。
- **前端**：`GenerationConsole` 左侧章节列表增加复选框批量勾选 + "批量生成"按钮；右侧新增"生成队列"面板（3s轮询 `GET /queue`），展示并发数、执行中任务、等待中任务（含重试计数）。

### 6.7 整书导出（需求9）

`GET /api/projects/:id/export?format=txt|md&volumeNo=&chapterIds=` 默认将 `generated_chapter`（`is_current=true`）按卷号+章节号排序拼接，以 `Content-Disposition: attachment` 流式下载。若传 `chapterIds`（逗号分隔的**章节计划ID**列表），则逐个按 `generated_chapter.chapterPlanId = id AND is_current=true` 查询并**按传入顺序**拼接（不再按卷章排序），使导出与阅读区一致。

- **TXT**：纯文本，卷分隔线 + `第X章 标题` + 正文。
- **Markdown**：`# 项目标题` / `## 第X卷` / `### 第X章 标题` + 正文，可直接用 pandoc/calibre 转 EPUB/PDF。
- **按卷**：传 `volumeNo` 参数仅导出该卷，文件名含卷号后缀。
- **跟随分支**：前端 `handleExport` 把当前 `activeChapters`（阅读路径，分支衍生章已替代被绕过的主线章）的计划ID列表作为 `chapterIds` 传入，故导出内容随用户实际走过的分支路径；未选分支时即主线内容。注意 `activeChapters.id` 是 `chapter_plan.id`（`GET /projects/:id/chapters` 返回计划行），后端须以 `chapterPlanId` 解析而非 `generated_chapter.id`。
- **前端**：`ChapterReader` 头部"导出"下拉菜单（TXT整书 / MD整书 / TXT本卷 / MD本卷），`window.open()` 触发浏览器下载。

### 6.8 对话式章节迭代修改（需求10）

用户通过自然语言指令对已生成章节进行定向修订，支持选区提示和版本 diff 对比。

- **后端**：`POST /api/chapters/:id/revise` 接受 `{instruction, selectedText?}`，取 `is_current=true` 的正文，调用 `ReviserAgent.reviseWithInstruction()`（LLM 输出完整修订章 + 修订说明），返回 `{revisedContent, revisionNotes, originalContent}` 但**不自动保存**——由前端确认后调 `PUT /chapters/:id/content` 存为新版本。
- **ReviserAgent 新模式**：`reviseWithInstruction(content, instruction, selectedText?, context?)` 与原有审计修订（`reviseChapter`）共用解析逻辑（`parseRevisionResponse`），但 prompt 改为"严格按指令修改，未涉及内容保持不变"。选区文字作为"重点修改段落"附在 prompt 中。
- **前端 ChapterReader**：新增"修订"模式（`mode='revise'`）——指令输入框 + 选中段落提示（阅读模式 `onMouseUp` 捕获 `window.getSelection()`）+ AI修订按钮 → 结果以行级 diff（`diff` 库 `diffLines`）红绿高亮展示 → 确认保存为新版本 / 放弃。
- **版本 diff 对比**：版本 tab 每条记录增加"对比当前"按钮，展开后以 `DiffView` 组件渲染该版本与当前版本的行级差异（红色删除/绿色新增）。

### 6.9 交互式剧情抉择（需求12）

章节生成完成后，由 `BranchGeneratorAgent` 推演 2-4 个"下一章走向选项"，玩家选定其一后衍生下一章计划，分支选择沿链路累积影响标签注入上下文，保证多章走向一致。第一期聚焦章间分支（inter-chapter branching）。

- **数据模型**：新增 `chapter_branch_option` 表存储来源章的候选走向（含 `option_type` 列区分 normal/encounter）；`chapter_plan` 增 `branch_source_option_id` / `branch_parent_chapter_id` 两个普通 bigint 列（不加外键，避免与选项表的 `source_chapter_plan_id` 循环引用）。DDL 见 `scripts/ddl-branch.sql`。
- **自动产出**：`runner.ts` 在状态抽取后、complete 前读取 `getBranchConfig()`（设置中的 `branchEnabled`/`branchOptionCount`，默认开启、3个），若本章尚无已选定选项则调用 `branchGeneratorAgent.generateBranches()`，删除旧的未选定选项后插入新选项，并 `emitEvent('branch_ready', {chapterPlanId, options})`。已有选定选项时跳过（保留用户选择链）。
- **素材借鉴与标注**：生成分支前以章节 intent/title 为 query，经 `recallBranchMaterials()`（`services/branch-context.ts`）对**四类剧情素材**——奇遇（`plot_material_encounter`）、伏笔手法（`plot_material_foreshadow`）、人物高光（`plot_material_highlight`）、任务链（`plot_material_task`）——逐表调 `recallMaterialsByQuery`（topN=2/minScore=0.3，单表失败 try/catch 降级跳过，不阻断主流程）。Agent 在 prompt 中注入【剧情素材参考】块（按类型分组、每条带 `#id`），约束 LLM 为每个选项自报 `basedOn`（所借鉴素材的 id 数组）；代码侧经 `resolveSourceMaterials()` 校验——仅保留确实出现在注入集合中的 id（幻觉 id 丢弃、去重），映射为 `[{table,id,title,label}]` 写入选项的 `source_materials` 列并在前端以分类徽标展示。奇遇保底逻辑保留：若注入了奇遇素材但无 encounter 选项，则将末位选项强制标记为 `optionType=encounter`。`runner.ts` 自动产出与 `chapters.ts` 手动 `generate-branches` 共用此召回+标注逻辑。
- **世界观推演（后续走向预测）**：生成分支时同步产出"后续大概率怎么发展"的简要推演。经 `gatherBranchWorldview(bookId, povCharacterIds)`（`services/branch-context.ts`）汇聚世界观设定——POV 人物（`novel_character_lib`，上限6）、宗门规制（`searchFactionRules`，提及主角优先、上限4）、岁时节令（`searchSeasonEvents`，提及主角优先、上限3）、文风心智（`style_global_config` 的 `styleName`/心智模型/决策启发各上限4），全部 best-effort 降级为空。推演与分支选项**并入同一次 LLM 调用**（`generateBranches` 返回 `{options, prediction}`），prompt 注入【世界观设定】块并要求输出 80-150 字推演。推演落库 `chapter_plan.branch_prediction`，`GET branch-options` 与 `generate-branches` 均以 `{options, prediction}` 返回，前端分支面板底部以"后续走向推演"卡片展示。注意：规制/节令数据按 `source_book_id` 隔离，当前项目（book=1）的规制/节令已由 book=3 复制而来。
- **SSE 双通道**：`branch_ready` 既经 runner 的 `onEvent`（真实流式）下发，也经 `generation.ts` 的轮询端点下发（fast-path 已完成任务补发 + 轮询循环 `branchSent` 守卫），因前端实际连接的是轮询端点。
- **上下文注入**：`context-builder.ts` 经 `getBranchContext()`（`state/store.ts`）按 `branch_parent_chapter_id` 回溯分支链（深度上限10）收集各代 `impact_tags`，去重按时间序排列，挂到 `ContextPackage.branchContext`；Writer 注入【剧情分支走向】块，Auditor 第12维度"分支承接一致性"审查走向跑偏/背离影响标签（critical）与承接生硬（minor），未声明分支不审查。
- **覆盖式重选**：`POST /chapters/:id/select-branch/:optionId` 校验选项归属本章；若已衍生下一章仍 `planned` 则删旧建新（章节号恒为来源+1，继承卷号/POV/实体下发）；若已脱离 `planned` 返回 409 拒绝静默覆盖。同源选项仅所选项 `is_selected=true`。删旧+标记选中+插入新章三步包在**事务**中（任一失败整体回滚，杜绝"选中但无衍生章"的半提交脏状态）。分支衍生章与主线章共享章号（大纲预置全部主线计划，分支章章号=来源+1 必然撞号），故 `chapter_plan` 原 `UNIQUE (project_id, volume_no, chapter_no)` 约束已改为**部分唯一索引** `uniq_chapter_plan_mainline_chapter`（仅约束 `branch_parent_chapter_id IS NULL` 的主线章，分支章豁免），DDL 见 `scripts/ddl-branch.sql`。
- **卷大纲反写**：选定分支后在同一事务内调 `writeBackKeyEvent()`（`services/outline-writeback.ts`），把选定的分支走向写回卷大纲 `story_outline.key_events` 中对应章号（`chapterNumber`=衍生章章号）的条目——`title` 覆盖为选项标题、`intent` 覆盖为选项的 `nextChapterIntent`。采用**覆盖更新+保留原文备份**策略：仅当 `originalTitle`/`originalIntent` 尚不存在时才备份原值（只备份一次，保留真正的最初原文，避免二次覆盖把备份污染为中间值）。匹配不到对应 `chapterNumber` 条目时静默跳过（best-effort，不阻断分支选择）。
- **API**：`GET /chapters/:id/branch-options`（列选项+推演，返回 `{options, prediction}`）、`POST /chapters/:id/generate-branches`（手动刷新，需已有生成内容，返回 `{options, prediction}`）、`POST /chapters/:id/select-branch/:optionId`（选定衍生）。均同时注册 `/chapters/...` 与 `/projects/:pid/chapters/...` 双路由。
- **前端**：`ChapterReader` 阅读模式采用 3+6+3 三栏布局——左栏章节列表、中栏正文阅读/编辑、右栏常驻【剧情分支】面板（不再置于正文底部）。左栏章节列表不平铺全部章节计划，而是经 `activeChapters`（useMemo）计算**活跃阅读路径**：从首章主线出发，遇到分支衍生章即沿分支链（`branchParentChapterId`）前进，一旦进入分支链便不再回退主线——被绕过的主线章（与分支章共享章号的"另一条世界线"）不在阅读列表展示（仍可于大纲编辑器查看），从而避免同一章号出现主线/分支两条记录造成混淆；分支衍生章条目右侧显示琥珀色"分支"徽标。分支面板含选项卡片（可选中、已选高亮、影响标签chip、重新生成按钮），卡片内按 `sourceMaterials` 显示"借鉴素材"分类徽标（奇遇=琥珀/伏笔手法=紫/人物高光=玫红/任务链=天蓝，悬停显示素材标题）；面板底部展示"后续走向推演"卡片（`prediction`，基于人物/宗门规制/岁时节令/文风的世界观推演）。选定走向后衍生下一章计划，面板底部出现"立即生成下一章"按钮，点击经 `useGenerationStream` 原地发起生成任务并页内显示 SSE 进度（排队/编排上下文/写作/审计/修订/完成阶段标签 + 流式文本尾部 + 取消按钮），完成/失败后 toast 并刷新章节列表。该按钮跨刷新保留：`effectiveDerivedPlan` 优先取本次会话选择捕获的计划，否则从章节列表恢复（`branchParentChapterId` 指向本章且仍 `planned` 的计划）。`OutlineEditor` 章节卡片对分支衍生章显示"分支"徽标；`GenerationConsole` 收到 `branch_ready` 时 toast 提示；`Settings` 默认生成参数卡新增"剧情分支系统"开关与选项数量（2-4）下拉。

### 6.10 章节文风校验（需求13）

对任意已生成章节手动触发专项文风审计，100% 复用文风引擎配置（不新增独立规则），输出可定位的校验报告并对接修订，形成"生成→校验→修订→复检"闭环。

- **校验维度（7维）**：心智模型、描写比例（场景/动作/对话/心理）、核心意象、禁用词、视角规则、反模式、句式规则——与 `StyleContext` 字段一一对应。仅校验配置中实际提供的维度（无配置则跳过）。
- **本地预校验**：禁用词走 `scanForbiddenWords()` 本地精确匹配（零 token、无误判），命中即生成 critical 问题（`excerpt`=词本身），该维度得分按命中数每个扣 20 分；其余 6 维交 `StyleAuditorAgent` 低温（0.3）LLM 判定。综合得分 = 各激活维度得分均值（确定性）。
- **问题定位**：`StyleIssue.excerpt` 携带违规原文片段（禁用词由本地给出、其余由 LLM 摘录），前端 `HighlightedContent` 组件据 excerpt 在正文中 `indexOf` 匹配并 `<mark>` 高亮、`scrollIntoView` 定位；匹配失败（LLM 摘录不精确）降级为仅展示不高亮。
- **数据流**：`POST /chapters/:id/audit-style` 取 isCurrent 正文 + `buildStyleContext(bookId)`（bookId=项目 `source_book_id` 缺省1，与生成管线一致）→ 本地禁用词 + LLM 判定 → 入 `style_audit_record`（含配置快照）→ 返回记录。历史/详情经 GET 端点读取。
- **一键修订**：`POST /chapters/:id/style-audits/:aid/revise` 读记录 issues，筛 critical/major 合成修订指令，复用 `reviserAgent.reviseWithInstruction()`，返回 `{revisedContent, revisionNotes, originalContent}` 但**不自动保存**——前端 diff 预览确认后调 `PUT /chapters/:id/content` 存为新版本（与需求10对话修订一致，永不覆盖原文、可回退）。仅 minor 问题时返回 400"无需修订"。body 可传 `ignoredIndices`（被忽略问题的下标）跳过相应条目（见 §6.32 审计问题一键修改）。
- **前端 ChapterReader**：工具栏新增"文风校验"按钮（`mode='style'`）——报告面板含综合得分+等级、7维进度条（<70 异常高亮）、问题按维度折叠（点击定位正文）、重新校验/一键修改按钮、每条问题的 修改/忽略 按钮、修订 diff 预览与确认保存；进入时自动加载最近一条历史记录。第一期仅 loading 不做中途取消。

### 6.11 体验增强功能·第一批（模块1/2/12/14）

纯增量改造，100% 兼容存量项目与数据（仅 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，无迁移成本），原有全自动生成能力不受影响，新增能力均为可选。

- **模块1 关键剧情锚点锁定**：`chapter_plan.must_have_events`(jsonb 字符串数组) 声明本章必须按序覆盖的核心事件。`OutlineEditor` 章节表单新增"关键剧情锚点"多行输入（每行一条）。生成时 `WriterAgent` 注入【关键剧情锚点】块要求按序覆盖不得遗漏；`AuditorAgent` 第13维"锚点事件覆盖率"审查——遗漏任一锚点报 critical、顺序错乱或一笔带过报 major，未声明锚点则不审查此项。
- **模块2 伏笔埋点可视化追踪（增量）**：`foreshadow_thread` 新增 `hint_clue`(埋设线索) 与 `pending`(待埋入) 状态。生成管线联动：`getUnresolvedForeshadows()` 取本项目 pending/planted 伏笔注入 `ContextPackage.foreshadows`，`WriterAgent` 注入【未回收伏笔】块（待埋入→自然埋线、已埋设→呼应/回收），`AuditorAgent` 第14维"伏笔呼应合理性"审查（计划本章回收未触及/与伏笔设定矛盾报 major、生硬埋设报 minor）。正文定稿后 `autoUpdateForeshadowFromContent()` 零LLM确定性自动流转状态。前端 `ForeshadowLedger` 新增待埋入筛选/统计卡、埋设线索输入与展示；`Dashboard` 新增伏笔回收进度卡。
- **模块12 剧情时间线自动梳理**：复用既有 `timeline_milestone` 表与 `state.ts` 路由，新增前端 `TimelinePage`（垂直时间线 + 统计卡 + 筛选 + 手动录入/确认/引导初始化/LLM抽取），`api.ts` 补 `stateApi`，`App.tsx` 注册 `/timeline` 路由与导航。
- **模块14 创作热力图**：`GET /projects/:id/creation-stats?days=` 按日聚合 `generated_chapter`(is_current) 的字数/章数并计算当前/最长连续创作天数；前端 `CreationHeatmap` 组件以 GitHub 风格 CSS 网格渲染（无图表库依赖），置于 `Dashboard`。

### 6.12 体验增强功能·第二批（模块6/7/3/11/8）

纯增量改造，100% 兼容存量（仅 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + 3张新表），原有全自动生成能力不受影响，新增能力均为可选。

- **模块6 单场景视角切换**：`generated_chapter` 新增 `perspective_versions`(jsonb) 列存储视角改写版本数组。`POST /chapters/:id/rewrite-perspective` 接受 `{targetCharacter, instruction?}`，取当前正文调用 `ReviserAgent.reviseWithInstruction()` 以目标人物视角改写，结果追加到 `perspective_versions`（不覆盖原文）。后端API已完整交付；前端 ChapterReader 集成（选中文本→右键菜单→视角改写）因组件复杂度（5模式）延后。
- **模块7 临时文风档位**：`settings.ts` 导出 `STYLE_PRESETS`（4个预设：hot_battle热血战斗/lyrical抒情/daily_light日常轻松/eerie_mystery诡异悬疑），每个含 `overrides`（descriptionRatio/sentenceRules/matchedSceneFlavor）。`GET /settings/style-presets` 供前端读取。生成时 `generation.ts` 接受 `stylePreset` 参数，`runner.ts` 在 `trimToTokenBudget` 后将预设 overrides 合并到 `context.style`（覆盖式，styleName 加后缀标识），实现任务级文风微调而不改全局配置。前端 `GenerationConsole` 新增预设下拉选择。
- **模块3 人物成长弧光卡点**：新建 `character_growth_stage` 表（创作库，人物引用诛仙库ID只读）。`store.ts` 新增 `getGrowthStagesForChapter(projectId, chapterNo)` 按章节区间匹配（JS过滤，NULL=不限，同人物多阶段取最大 stageNo）。`context-builder.ts` 将匹配结果注入 `ContextPackage.growthStages` 并在人物设定中附加 `currentGrowthStage`。Writer 渲染"★当前成长阶段「name」: 特质=..."；Auditor 第15维"人物阶段一致性"审查言行违背阶段特质（major）或特质体现不足（minor），无阶段数据不审查。前端 `GrowthStagePage`（/growth 路由）：按人物分组时间线UI + Dialog表单CRUD + 统计卡。
- **模块11 名场面金句提取**（提取编排已于 6.35 升级：`extractQuotesFromChapter` 被 `quote-service.ts runQuotePipeline` 取代，本节为 v1.2 历史描述）：新建 `project_quote_lib` 表 + `pipeline/quote-extractor.ts`。生成完成后 `runner.ts` fire-and-forget 调用 `extractQuotesFromChapter()`（LLM temp0.3 提取≤5条金句，含角色/场景/质量分，source_type=auto）。`getCollectedQuotes(projectId, characterNames?)` 人物感知召回收藏金句（POV/出场人物优先+质量分补足），注入 `ContextPackage.collectedQuotes`，Writer 渲染【收藏金句参考】块。**批量导入**：`extractQuotesFromPastedText()`（LLM temp0.3 从粘贴文本预筛≤20条含说话人推断）经 import-preview/import 两端点入库（source_type=import，默认收藏）。前端 `QuoteLibrary`（/quotes 路由）：按角色分组、全部/收藏 Tabs、收藏/删除/手动录入、批量导入对话框（粘贴→智能提取→审阅编辑→勾选导入）、来源徽标+来源筛选、统计卡；项目ID经 useProjects() 动态获取。
- **模块8 人物关系动态推演**：新建 `custom_character_relation` 表。`store.ts` 新增 `getCustomRelations(projectId, characterIds)` 取 is_active=true 的自定义关系。`context-builder.ts` 合并逻辑：自定义关系覆盖同对原生关系（双向key匹配），标记 `source='custom'`。Writer 对自定义关系显示★标签+互动模式；Auditor 关系参照中自定义优先标注。`POST /projects/:id/relations/infer` AI推演（LLM temp0.9，输入两人物+触发事件→3个候选方案）。前端 `RelationPanel` 组件嵌入 `WorldBrowser` 底部：自定义关系列表 + 推演Dialog（选人物→输入事件→展示3方案→确认入库）。

### 6.13 功法/法宝成长工坊（模块9）

> **阶段6起：旧自定义功法（`custom_skill_lib`）已退役**，成长工坊前端固定为法宝（`magic_item`），不再提供功法页签；自定义功法能力改由 6.28 新模块（九大道则体系）提供。本节下述"功法/法宝"中功法部分仅作历史描述，路由内部 skill 分支保留为不可达休眠代码。

用户可创建自定义功法/法宝实体，并通过融合、变异、强化、进化四种操作驱动其成长，所有操作由 `GrowthAgent`（LLM）生成叙事与属性变更，经三层确定性校验保证品阶-特效约束不被突破。

- **数据模型**：`custom_skill_lib` / `custom_magic_item_lib` 结构对称（品阶/层数/特效jsonb/副作用/成长类型/来源/关联人物），`entity_growth_record` 记录每次操作前后完整快照。DDL 见 `scripts/ddl-growth-workshop.sql`。
- **品阶约束体系（确定性校验，零LLM）**：黄阶→玄阶→地阶→天阶→仙阶，每阶3层。特效稀有度受品阶限制（黄/玄仅normal，地阶可rare，天阶+可legendary）；legendary 特效仅限 element/spacetime/soul/domain 四种类型；副作用必须绑定至少一个特效。校验函数：`validateEffectsForGrade()`、`validateSideEffects()`、`validateGradeCap()`、`validateGrowthResult()`。
- **四种操作**：
  - 融合（fusion）：选2个同类型实体→LLM(temp0.8)生成新实体预览，品阶≤天阶且≤max(源)+1，需用户 confirm 后入库。
  - 变异（mutation）：选1个实体→LLM(temp0.95)生成随机变体预览，品阶±1浮动，需 confirm。
  - 强化（upgrade）：选1个实体→确定性成功率（同阶80%/跨阶50%）→成功则LLM(temp0.6)在原实体上叠加属性（原地修改，直接执行），失败记 record 不改实体。
  - 进化（evolution）：地阶第3层+实体→LLM(temp0.7)生成天阶进化体（100%成功，必得1个legendary专属特效），需 confirm。
- **RAG注入**：`context-builder.ts` 新增 `getCustomEntitiesForCharacters(projectId, characterIds)` 查询两张自定义表，按 `linked_character_ids` 与章节出场人物交集匹配，注入 `ContextPackage.customEntities`。Writer 渲染【自定义功法/法宝设定】块（品阶/特效/副作用+铁律"不得凭空新增未列出能力"）；Auditor 第16维"自定义功法/法宝表现一致性"审查（未列出能力=major/强度超出=major/无代价=minor/低品级碾压高品级=major），无自定义实体不审查。
- **API（13端点）**：列表/创建/详情/更新/软删除 + 融合/变异/强化/进化/确认 + 历史记录/回滚 + 融合树。路由注册于 `routers/workshop.ts`。
- **前端 GrowthWorkshop**（/workshop 路由）：实体类型切换（功法/法宝）+ 6个tab（实体列表/融合/变异/强化/进化/融合树）。列表tab展示品阶徽标、特效chips、副作用、关联人物；操作tab各自交互（融合双选、变异/强化/进化单实体按钮+成功率/条件提示）；预览Dialog展示叙事+校验错误+确认按钮；历史Dialog时间线+回滚按钮；创建Dialog表单（名称/品阶/类型/核心效果/副作用/描述）；融合树tab递归展示实体血缘来源与衍生后代。
- **二期·融合树可视化**：`GET /workshop/tree?entityType=&entityId=` 递归追溯 `sourceEntityIds` 构建血缘树（深度上限10防循环），同时返回直接后代列表。前端 `TreeNodeView` 递归组件以缩进+连接线渲染，已删除实体灰色删除线标识。
- **二期·突破叙事片段**：融合/进化时 LLM 额外生成 300-500 字 `breakthroughScene`（小说正文笔法的突破场景），confirm 入库时存入 `breakthrough_narrative` 列。`context-builder` 将其注入 `CustomEntityContext.breakthroughNarrative`，Writer 渲染【突破叙事素材】块供正文以闪回/回忆/旁白形式引用。DDL 见 `scripts/ddl-growth-phase2.sql`。
- **二期·特效共鸣**：`context-builder` 新增 `detectResonanceEffects()`（纯规则零LLM）——按人物分组其关联的自定义实体，当同一人物拥有2+实体且共享相同特效类型（element/spacetime/soul/body/curse/domain）时触发共鸣，以模板生成组合加成描述。注入 `ContextPackage.resonanceEffects`，Writer 渲染【特效共鸣】块要求战斗中必须体现共鸣触发与表现。

### 6.14 写作质量增强（基于 Chinese-WebNovel-Skill-2 方法论）

在不改动现有架构的前提下，引入写作方法论提升剧情逻辑可定位性、对白张力、去AI味精准度、章末追更感和长篇一致性。8项需求全部为增量改造，总改动约400行（主要是prompt文本）。DDL 见 `scripts/ddl-writing-quality.sql`。

- **R1 五层因果链（Auditor第6维细化）**：原"情节连贯性"拆为动机充分性/触发合理性/决策匹配度/后果落地性/兑现完整性五个子维度，问题标注子维度名（如"情节逻辑·动机充分性"），修订可精准定位断裂层级。
- **R2 对白张力审查（Auditor第17维）**：检查对白目的性/信息增量/关系推进/人物声音区分度。Reviser 增加对白定向修订策略（压关系利益→拆人物声音→删空话）。
- **R3 去AI味五分型（StyleAuditor反模式维度升级）**：反模式维度细化为5种AI味分型（empty_summary空泛总结/cliche_atmosphere套话氛围/adjective_stack形容堆叠/explanatory_dialogue解释腔/uniform_rhythm平均工整），LLM输出`aiFlavorType`字段。Reviser 按分型生成定向改写指令。前端 ChapterReader style模式以紫色标签展示分型。
- **R4 章末钩子（Writer+Auditor第18维）**：Writer systemPrompt 追加【章末铁律】4条（禁总结句/停在变化拍/不说满/末句短）。Auditor 第18维"章末承接与拉力"审查落点类型。
- **R5 故事引擎前置约束**：`creative_project` 新增 `story_engine_type`(varchar32) + `story_engine_desc`(text)。大纲生成时注入【故事引擎约束】块。场景校验新增"故事引擎相关性"维度（纯规则关键词匹配，连续3+弱相关场景报warning）。PUT /projects/:id 支持设置。
- **R6 人物五类连续性（Auditor第1维细化）**：原"人物性格一致性"拆为目标/情绪/关系/声音/身体状态五类连续性，子维度独立标注。
- **R7 场景三有原则（scenes/validate新维度）**：每个场景节点校验有目标（主动动作词）/有阻碍（对抗词）/有变化（effect_and_result含变化词），缺项报warning，连续2+缺变化建议合并。纯规则零token。
- **R8 黄金三章（Writer条件注入）**：第1卷前3章按章节号注入专项铁律（第1章成交章/第2章升级章/第3章立誓章），条件为 `chapterNumber<=3 && volumeNo===1`。
- **加权计分**：Auditor 输出 `dimensionScores`（每维度0-100分），服务端按权重计算 overallScore——情节逻辑/对白张力维度权重1.5x，其余1.0x。
- **修订优先级（Reviser六层）**：剧情逻辑 > 人物一致性 > 场景转场 > 对白张力 > 章末收束 > 文风去AI味。底层没修好不许动表层。

---

### 6.15 Lorn.NovelWriteSkills 吸纳（Batch 1-3）

基于 Lorn.NovelWriteSkills 项目中经过验证的写作方法论，增强本地质检、质量闭环和创作指导能力。排除 P2 级（文风蒸馏/作品蓝本/冷热线）。

**Batch 1：本地质检 + 质量门槛**

- **本地质量门禁工具集**（`rag/quality-gate.ts`，零token）：4项确定性检测——元叙述检测（心理越界/说明文腔/总结腔/评论腔）、POV视角越界检测（非视角人物心理描写）、重复句群检测（连续3+段首4字相同）、注水句子检测（仿佛…一般/似乎…的样子等模式）。综合门禁 `runQualityGate()` 汇总所有检测+禁用词，输出 passed/issues。
- **管线预校验**（runner.ts 步骤3.5）：Writer产出后立即执行 `runQualityGate()`，critical问题（如禁用词）直接触发修订，不浪费LLM审计token。
- **质量门槛回炉循环**（runner.ts 步骤4）：替换原单次审计→修订为 do-while 循环。门槛配置从 `project.generationConfig` jsonb 读取：`qualityGateMinScore`（默认85）、`maxRewriteRounds`（默认2）。每轮：审计→合并禁用词→判定（总分≥门槛 且 无critical）→未达标则修订→下一轮。达标或耗尽轮次退出。

**Batch 2：去AI味扫描 + 桥段重复度**

- **去AI味本地检测器**（`rag/ai-flavor-detector.ts`，零token）：`scanAIFlavor()` 输出5项指标（元叙述命中数+定位、句式均匀度、句首重复次数、抽象判断词数、填充短语数）+ 综合评级（green/yellow/red）。评级公式：totalFlags = metaCount + abstractCount/3 + repetitiveStarters×2，≥10或均匀度>0.8=red，≥5或>0.6=yellow。
- **StyleAuditor第8维「AI味程度」**：在禁用词扫描后、LLM维度前插入本地扫描。得分：green=95/yellow=70/red=40。非green时生成issue（含excerpt定位）。该维度始终激活（不依赖StyleContext配置），参与综合均分计算。
- **桥段重复度扫描**（`rag/continuity-scanner.ts`）：`scanPlotDuplication()` 基于 `chapter_plan.plot_fingerprint` 历史，10章窗口≥3次=黄警，15章窗口≥5次=红警。红警建议卷纲层桥段重置，黄警建议变异处理。管线步骤7.56自动执行（best-effort）。
- **DDL**：`chapter_plan` 新增 `plot_fingerprint VARCHAR(30)`。

**Batch 3：场景施工卡 + 章末钩子**

- **场景施工卡增强**（需求3）：`scene_node` 新增6字段——`core_beat`（核心节拍）、`state_change`（状态变化jsonb）、`scene_hook_type`（场景钩子类型）、`rhythm_anchor`（节奏锚点）、`scene_plot_fingerprint`（桥段指纹）、`payoff_setup`（回报预埋）。Writer 解析 `sceneBreakdown` JSON，若含施工卡字段则渲染为结构化施工命令（▶核心节拍/▶状态变化/▶场景钩子），并注入最小起伏原则铁律。
- **章末钩子体系**（需求6）：`chapter_plan` 新增 `hook_type VARCHAR(20)` + `hook_intensity VARCHAR(10)`。Writer 注入【章末钩子要求】块（5种类型×3级强度的具体描述）。`checkHookRotation()` 检测近5章钩子是否过于单一（连续3章同类型或5章中4章同类型），管线步骤7.57自动执行并记录日志。
- **DDL**：`scripts/ddl-lorn-batch123.sql`（9条ALTER TABLE，已执行验证）。

**新增文件清单**：`rag/quality-gate.ts`、`rag/ai-flavor-detector.ts`、`rag/continuity-scanner.ts`。

**修改文件**：`pipeline/runner.ts`（预校验+回炉循环+桥段扫描+钩子轮换）、`agents/style-auditor.ts`（第8维）、`agents/writer.ts`（施工卡+钩子指令）、`db/creative-schema.ts`（9字段）、`routers/chapters.ts`（3字段CRUD）、`routers/scenes.ts`（6字段CRUD）、`rag/context-builder.ts`（hookType透传）、`types.ts`（事件类型+ChapterPlanContext）。

### 6.16 天命系统吸纳（P0-P2 全8项）

基于天命 Skill v2.0.0（tianming-skill-main）的叙事工程方法论，增强节奏控制、去AI味、伏笔一致性、类型体系和全局健康度监控。

**P0#1：冲突值量化 + 节奏健康度**

- **冲突值算法**（`rag/conflict-score.ts`，从Python移植）：6个加权因子（核心角色状态改变×8、T1伏笔×8、T2伏笔×5、奇点事件×5、核心角色参与×2/位、重要实体改变×3），基础分1，公式=基础分+Σ(权重×触发次数)。五星评级：≥16=5星核心峰值、≥12=4星重要峰值、≥8=3星中度、≥5=2星次要、<5=1星低冲突。
- **节奏健康度校验**（`checkRhythmHealth()`）：连续峰值告警（2连=warning，3连=error）、峰值间距<2章=warning、缓冲比<25%或>45%=warning、连续4章非缓冲=warning。集成到 `scenes/validate` 维度8。
- **峰值禁区**：峰值章前后2章内禁止 `buffer_dialog` 类型（豁免：标题含"遗音/记忆残片"），违反报error。
- **Writer注入**：冲突星级目标+峰值写作指导。
- **Auditor第19维**：冲突强度一致性（目标vs实际）。
- **DDL**：`chapter_plan` +4列（conflict_score/conflict_rating/is_peak/singularity_event）。

**P0#2：AI指纹黑名单扩充**

- **本地4类词库**（`ai-flavor-detector.ts`扩充）：套路化连接词（与此同时/众所周知/无独有偶等12词）、万能形容词（无与伦比/叹为观止等12词）、客观陈述腔（需要注意的是/不难看出等12词）、凑字副词（非常/十分/极其等12词）。纳入评级公式：signatureFlags = 连接词×2 + 形容词×3 + 陈述腔×2 + 副词/3。
- **LLM 3类判定**（StyleAuditor反模式维度扩充）：F.比喻陈词滥调(cliche_metaphor)、G.排比堆砌(parallel_padding)、H.大段心理分析(psych_overload)。aiFlavorType从5型扩为8型。
- **Reviser定向改写**：3种新类型各有对应改写策略。
- **前端**：ChapterReader紫色标签展示8种分型。

**P0#3：载体DNA（悬念钩子语义指纹）**

- **DNA四元组**：`foreshadow_thread` +4列（dna_subject/dna_action/dna_object/dna_emotion）+ tier分级（t1/t2/t3）。
- **自动提取**：`POST /api/foreshadow/:fid/extract-dna` LLM提取[主体]-[动作]-[客体]+情绪。
- **Auditor第14维增强**：伏笔回收时校验DNA一致性，主体张冠李戴或情绪相反报major（"DNA偏离"）。
- **Context注入**：伏笔上下文含DNA标签供Writer/Auditor使用。

**P1#4：章节类型体系 + 类型穿透**

- **7种类型**：climax/progression/revelation/buffer_price/buffer_dialog/buffer_clue/singularity。
- **Writer类型穿透**：6种非默认类型各有写作策略（节奏/描写比例/对话占比指导）。
- **前端**：OutlineEditor章节表单增加类型Select。
- **DDL**：`chapter_plan` +1列（chapter_type VARCHAR(30) DEFAULT 'progression'）。

**P1#5：奇点事件配额管理**

- **路由层校验**：创建章节时若为singularity，检查本卷已有奇点数 vs 配额（`generationConfig.singularity_quota_per_volume`，默认3），超额返回400。
- **管线二次校验**：runner生成前再次校验（防并发绕过）。

**P1#6：标准化章节交付仪表盘**

- **Dashboard组装**（runner步骤5.5）：生成完成后自动组装{chapterInfo, wordCount, styleScore, characters, foreshadow, hookType, generatedAt}存入`generated_chapter.dashboard` jsonb。
- **前端**：ChapterReader顶部可折叠`<details>`卡片展示仪表盘。
- **DDL**：`generated_chapter` +1列（dashboard JSONB）。

**P2#7：叙事体检报告体系**

- **6维体检服务**（`services/health-check.ts`，纯规则零LLM）：目录连续性（章序跳跃）、缓冲比健康度（25%-50%区间）、伏笔生命周期（超期≥10章）、角色状态链（pending积压）、时代与实体（里程碑待确认）、待决议事项（高优先级pending）。
- **路由**：`GET /api/projects/:id/health?volumeNo=`。
- **前端**：HealthCheck.tsx页面（/health路由），综合得分+6维进度条+问题列表+风险分级Badge。

**P2#8：精修初稿两阶段（Ore Foundry）**

- **开关**：`generationConfig.oreFoundryEnabled = true`。
- **第一阶段**：Writer目标字数临时覆盖为5000字（4500-5500扩展初稿）。
- **第二阶段**：质量门槛循环后，`reviserAgent.condenseToTarget()` 启用凝练语言戒律（动词优先/反问替代/去冗余/合并段落/感官优先）压缩到原始目标字数。
- **管线步骤5.4**：condensing状态+事件推送。

**DDL汇总**：`scripts/ddl-tianming.sql`（11条ALTER TABLE，已执行验证：chapter_plan 5列 + foreshadow_thread 5列 + generated_chapter 1列）。

**新增文件**：`rag/conflict-score.ts`、`services/health-check.ts`、`routers/health.ts`、`pages/HealthCheck.tsx`。

**修改文件**：`rag/ai-flavor-detector.ts`（4类词库）、`agents/style-auditor.ts`（8型）、`agents/reviser.ts`（3型+condenseToTarget）、`agents/writer.ts`（类型穿透+冲突目标）、`agents/auditor.ts`（19-20维+DNA校验）、`routers/foreshadow.ts`（DNA CRUD+extract-dna）、`routers/chapters.ts`（配额+天命字段）、`routers/scenes.ts`（峰值禁区）、`pipeline/runner.ts`（配额+oreFoundry+dashboard）、`rag/context-builder.ts`（DNA注入）、`types.ts`（8型+DNA字段）、`db/creative-schema.ts`（11字段）、`index.ts`（health路由）、`App.tsx`（/health）、`OutlineEditor.tsx`（类型Select）、`ChapterReader.tsx`（仪表盘+8型标签）。

---

### 6.17 素材联动（伏笔手法×伏笔台账 + 高光×成长弧光）

将素材库的「可复用创作手法模板」与功能侧的「具体实例」打通：伏笔手法素材（`plot_material_foreshadow`）与伏笔台账（`foreshadow_thread`）结合、高光素材（`plot_material_highlight`）与成长弧光（`character_growth_stage`）结合。复用二期RAG的召回机制与降级保护，写作时自动联动 + 作者手动绑定/标记双通道。

**共用底座**

- **单表定向召回**（`rag/plot-material-retriever.ts` 新增 `recallMaterialsByQuery(queryText, table, projectId, topN, minScore)`）：内部自行向量化，对单张素材表做 cosine 召回。全降级保护（embedding 不可用/向量化异常/SQL 异常均返回空数组，绝不阻断写作）。供 A1/B1 复用。
- **`fetchPinnedMaterials` 导出**：原内部函数改为导出，供 A2 按 `{table,id}` 强制取回绑定素材（pinned=true，不受相似度阈值/召回开关影响）。

**A0：DNA/tier 映射修复**

- `store.ts` 的 `getUnresolvedForeshadows()` 补上 `tier`/`dnaSubject`/`dnaAction`/`dnaObject`/`dnaEmotion`/`referencedMaterialId` 字段映射（渲染层早已预留读取，此前恒为空）。

**A1：伏笔写作联动（自动）**

- `context-builder.ts` 新增 `buildForeshadowTechniques()`：筛出本章有动作的伏笔（`plantChapter==本章`→plant / `resolveChapter==本章`→resolve），用 标题+描述+DNA 组装查询定向召回伏笔手法（topN=2），注入 `ContextPackage.foreshadowTechniques`。
- Writer 渲染【伏笔手法参考】块：本章需埋设/回收伏笔《X》，参考手法……（区分作者指定·必须参照 / 参考）。

**A2：伏笔台账绑定手法（手动）**

- **DDL**：`foreshadow_thread` +1列 `referenced_material_id BIGINT`。
- **后端**：`routers/foreshadow.ts` create/update 接受 `referencedMaterialId`（可设 null 解绑）；新增 `GET /api/foreshadow/:fid/suggest-techniques?topN=` 推荐手法端点。
- **写作强取**：绑定手法在 `buildForeshadowTechniques` 中优先强制取回（pinned），语义召回去重后补足。
- **前端**：`ForeshadowLedger.tsx` 编辑弹窗新增 TechniqueBinder 绑定器（当前绑定+解绑 / 智能推荐 / 搜索浏览全部伏笔手法，单选）。

**B1：成长过渡章自动识别（自动）**

- `context-builder.ts` 新增 `buildGrowthHighlights()`：取本章与上一章匹配的成长阶段（`getGrowthStagesForChapter` 调两次），按人物 key 比对 stageNo——跃迁（含上章无阶段→本章有）即高光时刻，用 人物名+阶段名+特质+描述 定向召回高光素材（topN=2），注入 `ContextPackage.growthHighlights`。零 schema 变更。
- Writer 渲染【成长高光时刻参考】块：本章 X 从「阶段一」迈入「阶段二」，参考高光写法……

**B2：成长阶段关键节点标记（手动）**

- **DDL**：`character_growth_stage` +2列 `stage_type VARCHAR(20)`（境界突破/心境转变/能力觉醒/关系升华）+ `is_key_node BOOLEAN DEFAULT FALSE`。
- **后端**：`routers/growth.ts` create/update 接受 `stageType`/`isKeyNode`；`getGrowthStagesForChapter` 映射两字段。
- **写作强触发**：命中 `isKeyNode=true` 的阶段即使无跃迁也强制召回高光素材。
- **前端**：`GrowthStagePage.tsx` 表单新增阶段类型 Select + 关键节点 Switch；时间轴卡片新增类型徽章 + 关键节点星标徽章。

**DDL汇总**：`scripts/ddl-material-linkage.sql`（3条ALTER TABLE，已执行验证：foreshadow_thread 1列 + character_growth_stage 2列）。

**新增类型**：`types.ts` 的 `ForeshadowTechniqueContext`（foreshadowId/foreshadowTitle/action/techniques）、`GrowthHighlightContext`（characterName/characterId/fromStage/toStage/isKeyNode/highlights）；`ContextPackage` +2字段；`ForeshadowContext` +referencedMaterialId；`GrowthStageContext` +stageType/isKeyNode。

**修改文件**：`rag/plot-material-retriever.ts`（recallMaterialsByQuery+导出fetchPinnedMaterials）、`rag/context-builder.ts`（两个联动函数+注入）、`agents/writer.ts`（两个渲染块）、`state/store.ts`（A0+B2字段映射）、`routers/foreshadow.ts`（A2）、`routers/growth.ts`（B2）、`db/creative-schema.ts`（3字段）、`types.ts`、`lib/api.ts`（suggestTechniques）、`pages/ForeshadowLedger.tsx`（TechniqueBinder）、`pages/GrowthStagePage.tsx`（类型/关键节点）。

**E2E验证**：19断言全过（单表召回+降级、A0字段映射、B2字段映射、A1 plant判定、B1阶段跃迁判定、A2绑定强取 pinned=true 且不受召回开关/embedding 可用性影响）。

---

### 6.18 分支衍生伏笔与前置回填系统（P2 完整版）

选定剧情分支后，自动从分支走向中抽取 2-3 条可前置埋设的伏笔线索，落库为待确认伏笔；作者确认后，系统按伏笔分级推荐"早于分支发生章"的埋设位置，并以两种方式回填——待生成章写入关键剧情锚点（Writer 生成时强制融入），已生成章调用 Reviser 自然修订（红绿 diff 预览，确认后存为新版本）。解决"分支转折突兀、伏笔埋多忘多"问题。

**DDL**：`scripts/ddl-foreshadow-branch.sql`（5条 ALTER TABLE + 2条索引，已执行验证）。`foreshadow_thread` +5列：
- `source_type`（manual/scene/branch，默认 manual）、`source_branch_option_id`（衍生自哪个分支选项）
- `is_confirmed`（分支衍生伏笔默认 false，需作者确认；手动/场景提升默认 true）
- `backfill_method`（anchor/revise）、`backfill_target_chapter_id`（回填目标章计划ID）

**抽取Agent**：`agents/branch-foreshadow-extractor.ts`（`BranchForeshadowExtractorAgent`，温度0.3）必出 1 条 t1 核心转折伏笔 + 1-2 条 t2 细节暗示，每条含标题/描述/`hint_clue`（3-5关键词顿号分隔、最具辨识度在前，兼容零LLM自动扫描）/优先级/DNA四元组；解析失败返回空数组（best-effort）。

**分支选定集成**：`routers/chapters.ts` select-branch 事务提交后，伏笔抽取与因果埋因一并放入**后台异步 fire-and-forget**（detached async IIFE，不 await）执行并落库（source_type='branch'、is_confirmed=false、status='pending'、resolve_chapter=衍生章号）；HTTP 响应在事务完成后立即返回（<1秒），`data.derivedForeshadows`/`derivedCausalChains` 固定为空数组——前端通过 `invalidateQueries(['foreshadow'])` 自动刷新列表，不再依赖响应携带条数。抽取失败降级（console.warn）绝不阻断/拖慢分支选择。branch-options 端点为每个选项附 `derivedForeshadowCount`。

**新增端点**（`routers/foreshadow.ts`）：
- `GET /api/foreshadow/:fid/suggest-plant-chapters`：纯规则零LLM。t1 提前 3/2/1 章（3 推荐位）、t2 提前 2/1 章、t3 提前 1 章；推荐章号须 ≤ 分支来源章且 ≥1；匹配章节计划标记 planned/generated 与 suggestedMethod（anchor/revise/unavailable），升序返回。**章节计划按"活跃路径"解析**（`store.ts` `getActivePlansByChapterNos`）：选定分支后同一章号并存主线(已替代)与分支(活跃)两个计划，此处取已选定分支计划优先、主线计划兜底、排除已废弃分支计划——避免展示已被分支替代的旧章节、误判回填方式或把回填写到死计划上。
- `POST /api/foreshadow/:fid/confirm`：分支衍生伏笔 is_confirmed false→true。
- `POST /api/foreshadow/:fid/backfill-anchor`：body{chapterPlanId}，校验已确认+目标无正文+章号<回收章且≤分支来源章，事务内追加 `[伏笔埋设]标题:线索` 到 must_have_events 并置 status=planted/backfill_method=anchor。
- `POST /api/foreshadow/:fid/backfill-revise`：body{chapterId,intensity}，对 is_current 正文调用 Reviser（强度嵌入指令文本），仅返回 {revisedContent,revisionNotes,originalContent} 预览，不落库。
- `POST /api/foreshadow/:fid/mark-planted`：修订预览确认后标记 planted 并记录回填方式/目标章。
- list 端点增 `sourceType` 过滤 + summary 增 branchDerived/unconfirmed/pendingBackfill；promote 端点写 source_type='scene'。

**写作链路联动**：`state/store.ts` getUnresolvedForeshadows 增 `is_confirmed=true` 过滤，未确认的分支衍生伏笔不注入 Writer/Auditor（避免误呼应）。

**前端**：`lib/api.ts` +5封装（suggestPlantChapters/confirm/backfillAnchor/backfillRevise/markPlanted）+ list sourceType。`ForeshadowLedger.tsx`：来源筛选下拉、来源/待确认/已埋设·锚点·修订徽标、确认/回填按钮、分支衍生与待回填统计卡、两步回填弹窗（选章→选方式，修订含 LCS 行级红绿 diff 预览，确认存新版本）。`ChapterReader.tsx`：选定分支后 toast 提示衍生伏笔数、分支选项卡显示「伏笔×N」徽标。

**E2E验证**：16断言全过（sourceType 过滤+统计、推荐章号升序与 upperBound、未确认回填被拒、confirm、anchor 追加锚点+状态流转、回收章约束、mark-planted、branch-options 衍生计数、revise 无效章节校验）。

---

### 6.19 剧情方向与分支影响体系

在"分支选项"之上引入两层抽象：**叙事方向**（比具体剧情更高一层的创作目标分类，只约束目标不约束内容）与**影响体系**（分支选择对人物/世界状态的量化改变）。两者双向联动：方向自动映射影响变更，影响状态反向推荐方向。解决"分支走向无归类、选分支无状态反馈"问题。

**方向字典**（`services/direction-catalog.ts`，纯函数零LLM）：10 大类 41 细分方向（人物成长/人物关系/道具收获/功法法宝/主线剧情/场景探索/冲突危机/势力经营/智斗布局/日常过渡），每个细分方向带 `impactModules`（联动影响模块名）。前 7 大类默认启用、后 3 大类默认关闭，项目级开关存 `generation_config.directionConfig.enabledCategories`。`inferDirectionFromText()` 为规则兜底打标（关键词命中数 → score=clamp(45+hits*15,0,95)，score<60 视为未分类）。

**方向打标**：`agents/branch.ts` generateBranches 支持 `targetDirections`（定向生成）与 `enabledCategories`；`resolveDirection()` 定向强制修正 + 白名单校验 + 规则兜底。分支落库 `main_direction`/`secondary_directions`/`direction_match_score` 三列。`GET /api/settings/direction-catalog` 暴露字典。

**影响体系五表**（见 §4.2）：`impact_definition`（影响项白名单，数值/标签两型，支持衰减/互斥/阈值挂标签）、`character_impact_snapshot`/`world_impact_snapshot`（按章快照，chapter_no=0 初始态）、`branch_impact_link`（分支选项→影响变更明细，手工绑定）、`impact_history`（前后快照全链路追溯，支持回滚）。

**影响服务**（`services/impact/impact.service.ts` + `impact/engine.ts` 纯函数引擎）：`applyBranchImpacts`/`rollbackBranchImpacts`/`previewBranchImpacts` 三件套。影响变更两个来源——手工 `branch_impact_link`（优先，用户显式配置不被覆盖）与方向自动映射（无手工链接时按主方向 `impactModules` 经 `MODULE_IMPACT_MAP` 生成基准幅度 add 建议，`buildAutoLinksFromDirection` 展开为同构虚拟链接复用既有分组/计算逻辑）。character 域按目标人物逐一展开，world 域展开为单条全局。

**默认影响对象兜底（三级链）**：character 域影响需要目标人物。`resolveImpactTargetCharacters(projectId, povIds)` 按三级回落：① 章节计划 `pov_character_ids`；② 项目 `default_impact_character_ids`（项目级默认影响人物，通常为主角）；③ 从 `character_state_snapshot` 取本项目已出场人物（按 char_id 升序前 3，DISTINCT 去重）。**影响预览与实际应用走同一兜底**（`routers/impact.ts` preview 与 `routers/chapters.ts` select-branch 均调用），保证"预览=实际"。每一级读取失败降级继续下一级，最终降级为空数组，绝不阻断分支选择主流程。配套 `GET /api/projects/:id/impact/target-candidates` 返回已出场候选人物（供前端选择），Dashboard 项目编辑弹窗提供「默认影响对象」勾选器。

**影响→方向推荐**（弱提示不强制）：`recommendDirectionsFromState()` 遍历 `IMPACT_DIRECTION_RULES` 规则表（如伤势≥60→休整过渡、心魔≥60→心境提升、气运≤30→秘境探险），对越阈影响项产出方向建议。

**集成点**：select-branch 事务内先 `rollbackBranchImpacts`（回滚上次选择的 pending 快照，覆盖式重选）再 `applyBranchImpacts`（写 pending 快照 + impact_history），best-effort——纯逻辑异常 catch 降级不阻断，SQL 级错误中止事务整体回滚。Writer 注入【影响状态】块，Auditor 审查影响承接一致性。

**降级红线**：方向打标、影响映射、影响应用/回滚、默认对象读取、因果链自动埋因全部 best-effort，任何失败降级为空/跳过，绝不阻断分支选择与章节生成主流程。

**因果链自动埋因管线**（`services/impact/causal-auto-plant.ts` + `agents/causal-extractor.ts`）：
- **触发时机**：select-branch 事务提交后（与分支衍生伏笔抽取同处一个后台异步 fire-and-forget IIFE），best-effort try/catch 降级，不阻塞 HTTP 响应
- **规则保底**（零 LLM，确定性）：`inferCausalFromBranch()` 从 mainDirection → impactModules → MODULE_IMPACT_MAP.category → CATEGORY_CAUSE_MAP 推断 causeType（karma→grudge, fate→prophecy, qualification→secret, faction→promise, base→prophecy）；strength=clamp(baseDelta*10,20,90)；priority 按 category 分级（karma/fate=7, faction=6, qualification=5, base=4）；targetChapterMax=sourceChapterNo+clamp(12-priority,3,12)。保底 1 条，多模块方向最多 2 条。无方向/无命中时用 impactTags 兜底生成通用 promise 因果线
- **LLM 增强**（可选，受 `generation_config.causalConfig.llmEnhance` 控制，默认 true）：`CausalExtractorAgent`（温度0.3）从分支描述中判断是否隐含明确因果关系，产出 0-1 条语义更丰富的因果线。失败降级为仅规则结果
- **逾期自动过期**：runner 步骤 7.58 调用 `expireOverdueChains()`，将 targetChapterMax < 当前章 且仍为 planted/foreshadowed 的因果线标记 expired（best-effort）
- **Writer 注入**：`context-builder.ts` 调用 `buildCausalContext()` 取 planted/foreshadowed/triggered 状态因果线（最多 5 条，按 priority+strength 排序），格式化为 `- [causeType] description →预期:effect (第N章埋下,强度X,余Y章/【已逾期!】)` 注入 Writer prompt
- **前端**：`CausalChainPage.tsx` 支持列表展示 + 状态流转（铺垫/触发/兑现）+ 手动创建因果线（Dialog 表单，sourceType='manual'）
- **响应扩展**：select-branch 响应 `data.derivedCausalChains` 字段保留但异步化后固定返回空数组（实际数据由后台落库、前端列表自动刷新）

---

### 6.20 成长弧光三向关联增强

将「人物成长弧光」（`character_growth_stage`）与系统其余三个子系统打通，形成闭环联动：高光素材语义召回增强、影响体系并列注入、人物关系升华注入。解决"成长阶段孤立、与数值/关系/素材无交叉"问题。

**高光素材召回增强（B1 升级）**：`context-builder.ts` 的 `buildGrowthHighlights()` 查询文本由原来的 `characterName + stageName` 扩展为 `characterName + stageName + stageType`（如"张小凡 佛道双修 能力觉醒"），提升语义向量匹配精度。零 schema 变更，纯查询优化。

**影响体系并列注入（阶段跃迁×数值）**：`context-builder.ts` 新增 `buildGrowthLinkageBlock()` 纯函数——比对本章与上一章的成长阶段，检测 stageNo 跃迁；跃迁时从 `impactContext.characterBlocks` 中查找同名人物当前影响数值，拼接为 `★ 张小凡 阶段跃迁「初入青云→佛道双修」[能力觉醒] | 当前影响：修为+2，心境+1`。产出注入 `ContextPackage.growthLinkageContext`。

**关系升华注入（阶段类型×关系状态）**：同一 `buildGrowthLinkageBlock()` 中，当阶段 `stageType === '关系升华'` 时，将 `relationContext.text`（两两关系维度）拼入联动块：`★ 张小凡 处于「关系升华」阶段 | 当前关系状态：...`。Writer 据此在关系升华阶段着重渲染人物互动。

**Writer 渲染**：`agents/writer.ts` 在【成长高光时刻参考】块之后、【人物当前状态】块之前，新增【成长弧光联动 - 阶段与数值/关系的交叉呈现】块，输出 `growthLinkageContext.text`。

**前端推荐高光素材**：`GrowthStagePage.tsx` 每个阶段卡片底部新增「推荐高光素材」折叠区（`StageHighlightHints` 组件），展开时调用 `plotMaterialsApi.list(projectId, {type:'highlight', keyword: 阶段名+特质, limit:2})` 懒加载语义匹配的高光素材，展示标题+核心情节。

**类型变更**：`types.ts` ContextPackage +`growthLinkageContext?: { text: string | null }`。

**修改文件**：`rag/context-builder.ts`（buildGrowthHighlights 查询增强 + buildGrowthLinkageBlock 新函数 + 注入）、`agents/writer.ts`（渲染块）、`types.ts`（+1字段）、`pages/GrowthStagePage.tsx`（StageHighlightHints 组件 + plotMaterialsApi 导入）。

**降级红线**：`buildGrowthLinkageBlock` 整体 try/catch，任何异常返回 null（不注入），绝不阻断生成主流程。高光素材推荐为前端独立查询，失败仅显示"暂无匹配"。

---

### 6.21 成长工坊×剧情方向关联 + 分支面板改版

将「成长工坊」（自定义功法/法宝）与「剧情方向」体系打通：方向字典新增「功法法宝」大类，分支生成注入工坊实体供剧情实名引用；同时重构章节阅读页的分支面板交互。

**方向字典扩容**（`services/direction-catalog.ts`）：新增 `workshop`（功法法宝）大类，`defaultEnabled: true`（默认启用大类由 6 个增至 7 个）。细分 4 个方向与成长工坊四操作一一对应：`workshop_fusion`（功法融合·根骨资质）/`workshop_mutate`（法宝变异·命格气运）/`workshop_upgrade`（强化突破·根骨资质）/`workshop_evolve`（进化蜕变·根骨资质+命格气运）。各方向带自动打标关键词（融合为一/合璧、功法变异/突变、淬炼/强化、蜕变/品阶突破等）。字典总量 9 大类 37 方向 → 10 大类 41 方向。

**工坊实体注入分支生成**（`services/branch-context.ts` + `agents/branch.ts` + `routers/chapters.ts` + `pipeline/runner.ts`）：
- 新增 `WorkshopEntityRef` 类型与 `gatherWorkshopEntities(projectId, limitPerType=6)`：查询 `custom_magic_item_lib`（未删除）取前 6 条，best-effort 降级为空数组。（原同时采集 `custom_skill_lib`，阶段6退役旧功法后仅采集法宝，`WorkshopEntityRef.type` 收窄为 `'magic_item'`。）
- `generateBranches` 增 `workshopEntities?` 可选参数（位于 directionOpts 之后、llmConfig 之前）。`buildPrompt` 在素材参考之后注入【成长工坊实体】清单（`[法宝] 名称（品阶·成长类型）：核心效果`，coreEffect 截断 60 字）。
- 定向约束：当 `targetDirections.main` 属于 workshop 大类且有实体时，追加强约束——选项剧情须围绕工坊实体展开并在 title/description 实名引用，不得虚构功法法宝名。
- 实体为空时自动跳过注入（零 token 开销）；chapters.ts 与 runner.ts 两处 generateBranches 调用点均已传入。

**分支面板改版**（`pages/ChapterReader.tsx`）：
- 「自动打标 / 方向先行」二选一切换合并为单一流程：叙事方向选择器始终可见、可留空（留空=AI自动推演并打标，选定=定向生成），一个「生成分支」按钮按 `targetMain` 有无自动切换两种模式，按钮文案/图标随状态变化（自动生成分支/生成定向分支）。后端零改动。
- 右侧分支面板改为始终渲染（原先需 `selectedChapter && mode==='read' && 有正文` 才显示），未选章节时展示占位卡，保证 3:6:3 栅格布局稳定。
- 面板 `maxHeight` 由 75vh 提升至 88vh（保留 overflow-y-auto 兜底）。

**修改文件**：`services/direction-catalog.ts`（+1大类+4方向+关键词）、`services/branch-context.ts`（+WorkshopEntityRef/gatherWorkshopEntities/GROWTH_TYPE_LABELS）、`agents/branch.ts`（参数+prompt注入+工坊约束）、`routers/chapters.ts`、`pipeline/runner.ts`（采集并传入实体）、`pages/ChapterReader.tsx`（合并模式+始终渲染+加高）。

**降级红线**：gatherWorkshopEntities 任一查询失败降级为空数组；实体为空跳过注入；均不阻断分支生成主流程。

**E2E验证**：14断言全过（workshop 大类/4方向存在且默认启用、缺省启用集合含 workshop、融合/变异文本自动打标命中、direction-catalog API 返回 workshop、project=4 无实体时 gatherWorkshopEntities 降级为空）。

---

### 6.22 金句库联动增强 + 批量导入（模块11）

**设计背景**：金句库（`project_quote_lib`）原先只有一条联动通路——收藏金句注入 Writer 作「对白风格参考」——且是"全局按质量分取前10条"的粗放注入，与本章出场人物无关；加之库内收藏数为 0，这条注入实际从未激活。同时金句只能靠章节生成后自动提取或逐条手动录入，用户无法快速把其他作品的精彩台词"偷"过来化用。本次增强一面把注入改为**人物感知召回**（优先本章 POV/出场人物），一面新增**批量导入**通路（粘贴其他作品文本 → LLM 预筛 → 人工审阅 → 批量入库），并用 `source_type` 字段区分金句来源。

**人物感知召回（注入增强）**（`pipeline/quote-extractor.ts` + `rag/context-builder.ts`）：
- `getCollectedQuotes(projectId, characterNames?, limit=10)` 签名新增可选 `characterNames`：命中人物的金句经 `CASE WHEN character_name = ANY(names) THEN 0 ELSE 1 END` 排在最前，组内按质量分降序，不足 limit 用全局收藏补足；人物参数为空时退化为全局 TopN（向后兼容）。注意无人物时不能把常量 0 作为排序项（Postgres 会按 ORDER BY position 0 报错），须条件构建 orderBy 数组。
- `context-builder.ts` 将金句召回从 `Promise.all` 中移出（因依赖人物名），改在 `povCharacterNames` 解析完成后，取「POV 名 + 全部出场人物名」去重作为 `relevantNames` 单独调用；结果仍注入 `ContextPackage.collectedQuotes`，Writer 的【收藏金句参考】块无需改动。

**source_type 来源字段**（`db/creative-schema.ts` + DDL）：`project_quote_lib` 新增 `source_type varchar(20) NOT NULL DEFAULT 'auto'` 列，取值 `auto`=章节生成后 LLM 自动提取 / `manual`=手动录入 / `import`=批量导入；存量数据默认 `auto`。`extractQuotesFromChapter` 显式写 `auto`，create 端点手动录入默认 `manual`。

**批量导入（偷金句）**（`pipeline/quote-extractor.ts` + `routers/quotes.ts`）：
- `extractQuotesFromPastedText(text)`：LLM（temp0.3，截取前 12000 字）从粘贴的参考文本预筛 ≤20 条候选金句并推断说话人，**不入库**，返回 `QuoteCandidate[]`。
- `POST /projects/:id/quotes/import-preview {text}` 返回候选；`POST /projects/:id/quotes/import {quotes[]}` 将审阅后的金句批量入库（`source_type=import`，`is_collected` 默认 true——导入即可被后续生成注入）。
- 列表端点 `GET /projects/:id/quotes` 新增 `sourceType` 过滤参数。

**前端**（`pages/QuoteLibrary.tsx` + `lib/api.ts`）：
- 新增两步式 `ImportDialog`：粘贴参考文本 →「智能提取」（import-preview）→ 审阅区逐条勾选/编辑金句文本/所属人物/场景描述 →「导入选中 (N)」（import）。
- 金句卡片新增来源徽标（自动/手动/导入），页头新增来源下拉筛选。
- 修复：页面原硬编码 `PROJECT_ID='3'`（指向不存在的项目，导致页面空白、导入外键失败），改为 `useProjects()→projects?.[0]?.id` 动态获取（兜底 '4'）。注：GrowthStagePage / GrowthWorkshop 仍硬编码 '3'，存在同类隐患（本次未动）。

**修改文件**：`db/creative-schema.ts`（+source_type）、DDL（ALTER TABLE ADD COLUMN）、`pipeline/quote-extractor.ts`（人物感知召回 + 粘贴文本 LLM 提取 + auto sourceType）、`routers/quotes.ts`（import-preview/import 端点 + sourceType 过滤 + create sourceType）、`rag/context-builder.ts`（召回移出 Promise.all 至 POV 解析后）、`lib/api.ts`（importPreview/import + list sourceType）、`pages/QuoteLibrary.tsx`（ImportDialog + 来源徽标/筛选 + useProjects 修复）。

**降级红线**：金句召回整体 try/catch，任何异常返回空数组（不注入），绝不阻断生成主流程；import-preview 在 LLM 失败/解析失败时返回空数组。

**E2E验证**：12断言全过（import 返回201&入库3条&source_type=import&默认收藏、sourceType 筛选、人物感知召回首条命中张小凡、无人物参数退化全局TopN、LLM 预筛返回含说话人推断的候选、测试数据清理）。

---

### 6.23 AI生成大纲同步物化章节计划（bug修复）

**设计背景 / 根因**：AI 生成大纲接口（`POST /projects/:id/outlines/generate`）的 prompt 要求 LLM 输出 `volumes[].chapters[]`，前端弹窗也承诺"自动生成卷级大纲和章节计划"。但后端落库时只把章节数据塞进 `storyOutline.key_events`（jsonb），**从未写入 `chapter_plan` 表**。而生成控制台读取的正是 `chapter_plan`——导致新建项目用 AI 生成大纲后，控制台永远为空、无法生成章节。章节数据其实已生成（躺在 keyEvents 里），只差最后一步物化。

**修复**：
- **接口治本**（`routers/outlines.ts`）：在保存每个卷大纲后，遍历 `volume.chapters` 同步插入 `chapter_plan`——`chapterNo`←`chapterNumber`、`title`←`title`、`intent`←`intent`、`emotionTarget`←`targetEmotion`、`outlineId`←新大纲ID、`status='planned'`，跳过无 title 的无效章节；响应新增 `createdPlanCount`。
- **存量回填**：对项目5「大竹峰小计」已生成的 3 卷×10 章 keyEvents 数据，经一次性幂等脚本（按 volumeNo-chapterNo 去重）物化为 30 条章节计划，无需重新生成大纲即可立即使用。

**修改文件**：`routers/outlines.ts`（generate 端点 +createdPlanCount 物化逻辑）。

**E2E验证**：`GET /projects/5/chapters` 返回 HTTP 200、30 条章节计划、全部关联 outline_id、卷号章号正确（1-1「入门大竹峰」起）、状态 planned；server 包 tsc 零错误；后端 tsx watch 热重载、health 正常。

---

### 6.24 分支影响预览为空（bug修复 + 默认影响对象设置入口）

**现象**：章节阅读页点击分支选项的闪电图标，影响预览始终显示"该走向暂无绑定的影响变更"。

**根因（两处断点）**：
1. **管线写入路径漏字段**：分支选项有两条落库路径——`routers/chapters.ts`（GUI 按钮）与 `pipeline/runner.ts`（生成控制台自动附带）。阶段1方向体系只改了前者，runner.ts 的 insert 漏写 `main_direction`/`secondary_directions`/`direction_match_score` 三列。生成控制台生成的分支方向值在 `resolveDirection()` 中已正确计算（含关键词规则兜底），却在落库时丢弃 → 预览端点读到 `mainDirection=null` → `buildAutoLinksFromDirection` 自动映射被跳过 → 无手工链接时预览为空。
2. **目标人物解析无兜底**：`resolveImpactTargetCharacters` 仅有两级（章节 POV → 项目 `default_impact_character_ids`），新建项目两者皆空 → character 域影响建议展开为零条链接。且前端无 `default_impact_character_ids` 设置入口（后端 PUT 早已支持）。

**修复**：
- **runner.ts 补齐字段**（治本）：分支选项 insert 增补 `mainDirection`/`secondaryDirections`/`directionMatchScore`，与 chapters.ts 路径对齐。
- **存量回填**：对 `main_direction IS NULL` 的 3 条分支选项（62/63/64），用 `inferDirectionFromText` 关键词规则从选项文本重新推断方向写回（零 LLM）：62/63→buffer_daily(日常互动)、64→growth_body(体质异变)。
- **三级兜底**（`impact.service.ts`）：`resolveImpactTargetCharacters` 增第三级——POV 与项目默认皆空时，从 `character_state_snapshot` 取本项目已出场人物（`DISTINCT character_id`，按 char_id 升序前 3）。逐级 try/catch 降级。
- **候选人物端点**（`routers/impact.ts`）：`GET /projects/:id/impact/target-candidates`，`DISTINCT ON (character_id)` 取最新人物名，best-effort 异常返空数组。
- **前端设置入口**（`pages/Dashboard.tsx`）：项目编辑弹窗新增「默认影响对象」勾选器（候选人物按需懒加载），保存经 `PUT /projects/:id` 写入 `defaultImpactCharacterIds`。

**修改文件**：`pipeline/runner.ts`（insert +3字段）、`services/impact/impact.service.ts`（+isNotNull 导入、三级兜底）、`routers/impact.ts`（+sql 导入、target-candidates 端点）、`lib/api.ts`（impactApi.targetCandidates）、`pages/Dashboard.tsx`（编辑弹窗勾选器 + 表单字段）。

**E2E验证**：option 62 预览返回 3 条人物影响（宋大仁/张小凡/田不易，声望 0→3）；option 64 返回根骨+5、气运+5 各 3 人；PUT 设置 `defaultImpactCharacterIds=[2]` 后预览仅作用于张小凡（覆盖生效），恢复空数组后回落前 3；target-candidates 返回 10 位已出场人物（null ID 已排除）；web/server 两包 tsc 零错误。

---

### 6.25 分支选择卡顿优化（后台异步 fire-and-forget）

**现象**：章节阅读页选定剧情分支后，需等待约 1 分钟才弹出"已选择分支"确认。

**根因**：`routers/chapters.ts` `selectBranchHandler` 在 DB 事务（衍生下一章计划 + 卷大纲反写 + 影响回滚/应用，纯数据库操作 <1秒）提交后，又**串行 `await` 了两次 LLM 调用**才返回 HTTP 响应——`branchForeshadowExtractorAgent.extract`（伏笔抽取，maxTokens 2048）与 `causalExtractorAgent.extract`（因果 LLM 增强，maxTokens 1024，`llmEnhance` 默认 true）。LLM client 单次超时 120s、`callWithRetry` 最多 3 次重试，两次串行叠加正常约 40-80s。这两段代码注释自称"best-effort 绝不阻断主流程"，实现上却同步内联阻塞响应——设计意图与实现相悖。

**前端依赖评估**：`derivedForeshadows` 仅用于一条 toast 条数提示，且选完分支已 `invalidateQueries(['foreshadow'])` 自动刷新列表；`derivedCausalChains` 前端完全未消费。故异步化无功能损失。

**修复**：
- **后端**（`routers/chapters.ts`）：事务提交后将伏笔抽取 + 因果埋因整体搬入一个 detached `void (async () => {...})()` IIFE 后台执行（各自保留原 try/catch 降级），HTTP 响应在事务完成后立即返回；响应体 `derivedForeshadows`/`derivedCausalChains` 固定为空数组。
- **前端**（`pages/ChapterReader.tsx`）：`handleSelectBranch` 的 toast 由"按 derivedForeshadows 条数条件提示"改为固定文案「已选择分支，下一章计划已生成」，移除对响应条数的依赖。

**修改文件**：`routers/chapters.ts`（selectBranchHandler 异步化）、`pages/ChapterReader.tsx`（toast 固定文案）。

**E2E验证**：plan 181 / option 68 select-branch 响应 **0.34s**（原约 60s）、HTTP 201、衍生第 4 章计划 id=182 即时创建；等待后台 LLM 完成后查得 option68 落库 3 条伏笔（1×t1+2×t2，resolve_chapter=4）+ 2 条因果（规则 promise/fulfill + LLM secret/reveal）；测试数据已完全还原（branch 伏笔回 9、因果回 5，plan181 无选中无子章节）；web/server 两包 tsc 零错误。

### 6.26 自定义人物·先天禀赋约束改制与小缺陷扩充

自定义人物模块（三步向导：种族与定位→性格立场→先天禀赋，创建后 AI 生成七言判词+考语；路由族 `/projects/:id/custom-characters`，含 random/random-name/generate-verdict 端点）的先天禀赋第三步原约束为“正向天赋恰好 3 个”，与“每分类最多 2 个”叠加后体验矛盾（选满 3 个后其余分类全部点不动），本次改为区间约束，并扩充小缺陷库。

- **新约束常量**（`shared/src/custom-character/types.ts`）：`TALENT_MIN_COUNT=3`、`TALENT_MAX_COUNT=8`、`TALENT_MAX_PER_CATEGORY=2`（不变）；原 `TALENT_REQUIRED_COUNT` 降级为 `@deprecated` 别名（= MIN，旧脚本兼容）。新规则：正向天赋总量 3-8 个，4 大类（圣体魔躯/命格气运/功法天赋/宿世出身）每类最多 2 个，另可选 0/1 个小缺陷。
- **服务端校验**（`routers/custom-characters.ts`）：zod `talents: z.array(z.string()).min(TALENT_MIN_COUNT).max(TALENT_MAX_COUNT + 1)`（+1 为缺陷位）；`validateForm` 改区间校验（越界返回“正向天赋须选3-8个”），每类≤ 2 校验不变。
- **随机口径不变**（`services/character-generator.ts`）：大骰子 `randomTalents()` 仍默认出最少档 3 个正向（每类≤2）+ 30% 概率附带 1 个小缺陷；用户可在向导中手动加选至上限 8。
- **前端交互**（`components/CustomCharacterWizard.tsx`）：`toggleTalent` 总上限改 8（超限 toast 提示）；分类骰子 `rollTalentCategory` 在总量满 8 时改为替换最后选的一个；`validateStep` 改区间校验；第三步头部文案“选3-8个正向天赋（每类最多2个）+ 可选1个小缺陷”，计数展示“已选 x/8 正向”。
- **小缺陷扩容**（`shared/src/custom-character/talent-config.ts`）：`FLAW_OPTIONS` 8→23 条，新增 15 条：怕高、吃饭挑食、认床难眠、不会水、拖延成性、手工笨拙、记不住人脸、易晕车马、晚起难醒、嗜甜如命、见血头晕、不辨左右、认真就输、嘴硬心软、怕毛虫子。
- **判词联动**（`services/verdict-generator.ts`）：`FLAW_IMAGERY` 同步补 15 条暗喻意象（判词铁则：缺陷不直白写出，以意象藏入第 3/4 句），如 嗜甜如命→“偏嗜甘饴、苦中寻蜜”、嘴硬心软→“口冷心热、言厉意慈”。
- **验证**：`pnpm -r build` 全过；实测创建 5 正向（圣体2+命格2+功法1）+新缺陷「嗜甜如命」人物成功，判词正常生成，测后清理。
- **修改文件**：shared `types.ts`/`talent-config.ts`、server `custom-characters.ts`/`character-generator.ts`/`verdict-generator.ts`、web `CustomCharacterWizard.tsx`。无 DDL 变更。

### 6.27 神兵坊养成交互优化（禁用原因提示 + 强化结果弹窗）

自定义武器模块（神兵坊，路由族 `/projects/:id/custom-weapons`，养成逻辑 `services/weapon-growth.ts` 复用成长工坊品级数学，变更记录写 `entity_growth_record`（entity_type='weapon'））三个养成按钮曾被误判为故障，经服务端 curl + 浏览器双重实测均属正常：强化直接落库（同阶 80%/跨阶 50% 成功率，神蕴禁用）、进化为预览制且需“道纹≥3层或仙蜕”解锁、变异为预览制需确认入库。真正问题是 UI 反馈不足，本次做两处改进（仅改 `pages/CustomWeaponForge.tsx`）：

- **禁用原因内联小字**：进化按钮灰时按钮内显示“需道纹3层”（神蕴品级显示“已顶阶”）；神蕴武器的强化按钮附“已顶阶”；title 悬停提示同步区分可用/禁用两态（可用时提示成功率/进化说明）。
- **强化结果弹窗**：`upgradeMut` 由一闪而过的 toast 改为居中结果 Dialog——成功（金色 ArrowUpCircle+“强化成功”）/失败（红色 X+“强化失败”）+ 武器名 + 品级变化徽章（旧→新）+ 强化叙事文本；`mutationFn` 入参由 id 改为武器对象以携带旧品级快照，spinner 判定同步改 `variables?.id`。
- **验证**：web build 通过；浏览器实测普通武器（道纹·第2层）进化灰+“需道纹3层”、神蕴武器强化/进化均灰+“已顶阶”，变异按钮不受影响。

### 6.28 自定义功法模块（九大道则体系 + 千人千面个人变种）

自定义功法（路由族 `/projects/:id/custom-techniques`）独立于旧 `custom_skill_lib`，以「九大本源道则」为唯一底层根基，**功法无绝对品级**，威力取决于对道则的挖掘深度（传法指引深度）与运用技巧。模板沿用自定义武器模块（静态词条库 + 确定性零token随机 + LLM命名/详解 + 三接入）。

**核心设定与词条库** `data/technique-catalog.ts`：九大道则（庚金/坤土/雷霆/冥蚀/虚空/岁时/形质/灵气/神魂，各含科学本质/属性/能力方向/命名前缀）；G1 道则兼容矩阵按附录A物理本质推导（高兼容10对/中23/对冲3对：庚金-坤土、冥蚀-形质、冥蚀-灵气）；传法指引深度3档（入门指引60/完整传承30/直指本源10，**非品级**）；体例5类（修炼/攻伐/防御/辅助/特殊）；本源特质12（fitDao/conflictTags/rarity）；行功路线6；分道境神通24（按入微/化境/合道/超脱）；反噬9（category/risk/highRisk）；传承5；门槛13；身体印记9×4维；运用技巧；演化9；先天矛盾6。随机权重 高:中:冲=60:35:5。

**确定性随机引擎** `services/technique-random.ts`（零token）：`randomTechnique(base?, locked?)` 产出完整功法草稿（主辅道则/指引深度/体例/门槛/本源特质含冲突标签互斥/行功/身体印记/运用技巧/分道境神通≤8/反噬含对冲强制长期反噬/传承/演化/先天矛盾10%触发）。

**LLM 命名与详解**：`agents/naming.ts` 新增 `techniqueName(mainDao, depth, styleType?, count, llmConfig?)`（temp0.95，禁品级词）；`agents/technique-lore.ts` `TechniqueLoreAgent.generate()`（temp0.4，maxTokens1600，输出【功法详解】500-700字 + 【配套招式】4招：基础招→进阶招→特质招→杀招，`{name,desc,tier?}`，铁律：功法无品级 + 道则边界 + 招式须有代价）。创建功法默认自动生成详解+招式（`generateDescription:false` 可跳过）。

**数据表**（创作库，DDL 已执行）：
- `custom_technique`：name/main_dao/assist_dao(jsonb)/guidance_depth/fake_depth/style_type/threshold(jsonb)/core_traits(jsonb)/practice_path/body_mark(jsonb)/usage_skills(jsonb)/abilities(jsonb)/backlash(jsonb)/inheritance/evolution(jsonb)/inherent_conflict/core_direction(jsonb)/fit_monk(jsonb)/description/**moves(jsonb,4招{name,desc,tier})**/growth_type(base/evolution/fusion/mutation)/base_entity_id/source_entity_ids/linked_character_ids(负数对外ID)/is_deleted。
- `character_technique_variant`：character_id(FK custom_character.id 正数)/base_technique_id(FK)/variant_name/rarity(common/remarkable/rare=60/30/10)/dao_weight_offset/trait_offset/ability_variant/backlash_offset/body_mark/exclusive_skill/cultivation_effect/**description(text,LLM个人化详解)**/version/is_deleted。
- `character_martial_lore`（7.30新增，7.31改多对多）：project_id(FK)/character_id(FK custom_character.id)/technique_id(FK custom_technique,nullable)/weapon_id(FK custom_weapon,nullable)/fused_moves(jsonb,3-5招{name,desc,source:technique|weapon|fused})/biography(text,500-800字武学小传)/version/is_deleted/created_at/updated_at。唯一索引 `idx_martial_char_tech_wpn`(character_id,technique_id,weapon_id) WHERE is_deleted=false，一人可有多条搭配（功法×武器组合）。

**个人变种规则引擎**（千人千面，附录N）`services/technique-variant.ts`（确定性零token）：`generateVariant(character, technique, {lock, rand})` 由人物四因子叠加产出变种——①道则亲和（天赋·圣体魔躯类 `talents category='body'`，关键词归类到对应道则，契合则特质强化/速度+20%/反噬减轻/+微衍生特质；通用道胎全道则+15%）②心性性格（innerPersonality + outerPersonality[]）③出身经历（天赋·宿世出身类 `category='origin'`，关键词→偏向+专属运用技巧）④种族特质（raceCategory）。铁律：边界不变（不新增道则）/代价对等（增益必有代价）/属性溯源（factorTrace 全可追溯）。`validateVariant()` 零token复核三大不变式（道则边界/代价对等/属性溯源）。

**变种路由** `routers/technique-variants.ts`（挂 `/api`，路径 `/projects/:pid/characters/:characterId/techniques/...`，characterId 入参经 `Math.abs` 归一为正数DB id）：GET 列表 / POST `:techniqueId/generate-variant`（绑定即生成，已存在则 version+1 覆盖，响应附 `validation`）/ POST `:variantId/reroll-variant`（可锁 rarity/originBias）/ PUT `:variantId/upgrade`（成长迭代 version+1，不重掷偏移保前后一致）/ DELETE 软删。

**千人千面 LLM 个人化详解**（7.30）`agents/technique-variant-lore.ts`：规则引擎降级为「骨架/约束」（道则边界/代价对等/factorTrace 可审计），新增 LLM 血肉层。`TechniqueVariantLoreAgent.generate(character, technique, skeleton)`（temp0.6，maxTokens1100，400-600字）以人物小传/判词/天赋/性格为素材，在骨架约束内产出因人而异的叙事描写（含角色语气对白、修炼体感、代价具象化）。铁律：不新增道则能力/增益必有代价/程度匹配稀有度。generate-variant 与 reroll-variant 端点在规则引擎产出后自动调用，失败降级为 null（不阻断变种生成）。前端 VariantPanel 展示 `v.description` 块。

**人物武学档案**（7.30，7.31改多对多）`agents/character-martial-lore.ts` + `routers/character-martial.ts`：人物可同时搭配多组功法×武器，每组搭配独立生成融合招式+武学小传。`CharacterMartialLoreAgent.generate(character, technique, weapon)`（temp0.7，maxTokens2000）输出【融合招式】3-5招（≥2 融合型，source 标记 technique/weapon/fused）+【武学小传】500-800字。路由（挂 `/api`，路径 `/projects/:pid/custom-characters/:cid/martial`）：GET 返回 `lores` 数组（每条=一个功法×武器搭配）+ 本项目功法/武器列表（含 bound 标记）/ POST bind（写各实体 linkedCharacterIds）/ POST generate（按 characterId+techniqueId+weaponId upsert，version+1）/ DELETE `:loreId` 软删单条 / POST `:loreId/regenerate` 重生成单条（version+1）/ DELETE 软删全部（兼容）。写作上下文注入：`context-builder.ts` `getCustomCharactersByIds` 批量加载 character_martial_lore，按 characterId 分组为数组（一人多条搭配，修复早期 Map 写法每人只留一条的截断），附 `martialLores:[{techniqueName,weaponName,biography,fusedMoves}]` 到 CharacterContext；`writer.ts` 自定义人物设定块渲染各搭配的融合招式+武学小传（要求出手/战斗描写与融合招式一致）。前端：`CharacterGallery.tsx` MartialSection 按功法分组展示搭配卡片（融合招式+小传+版本+重生成/删除），「绑定武学」chip 区（8.2 新增：功法/武器分行列出，点选切换绑定状态，已绑定金色高亮，接通 bind 接口写 linkedCharacterIds——绑定后的功法/武器随该人物进入章节生成上下文），底部「生成新搭配」选择器（功法×武器下拉）。

**三接入**（同步 writer/auditor/context-builder，铁律不漏入口）：
- `context-builder.ts` `getCustomEntitiesForCharacters` 查 `custom_technique`（is_deleted=false，按 linked_character_ids 负数ID 与出场人物交集匹配），映射 `entityType='technique'`（effects=本源特质 type取conflictTags[0]、realmAbilities 按道境分组、backlashSummary 含风险、daoIds/isClash/guidanceDepthId 供确定性扫描）；并预取 `character_technique_variant` + 人物名映射，附 `variantSummary`（千人千面摘要）。`CustomEntityContext.grade/gradeLevel` 改为可选（功法无品级）。
- `writer.ts`：technique 分支渲染 指引/道则/本源特质/分道境神通/反噬/个人变种（须写出各人差异）；非功法实体加 `e.grade ?` 守卫。
- `auditor.ts`：第16维扩功法（指引深度/道则组合/分道境神通/反噬），新增子项⑤指引深度越界⑥道境神通越界；零token `scanTechniqueDaoConsistency`（A反噬缺失major/B入门指引越界major/C道则边界minor，仅时间·空间稀有道则保守扫描，带「来自天赋/法宝/native功法可忽略」提示）+ 千人千面校验规则；顺修 weapon 曾被误标「法宝」的 typeLabel 三分支 bug。
- `scenes.ts` `match-materials`：自定义功法合流进 skills 候选（source='custom'，key `skill:custom:id`）。

**前端**：`pages/CustomTechniqueForge.tsx`（路由 `/techniques`，侧边栏 ScrollText 图标）——列表卡 + 三步锻造弹窗（道则构型/行功根骨/衍化配置，左预览 + 一键全随机 + LLM名号骰子，客户端兼容矩阵镜像）+ 详情弹窗（含 `VariantPanel` 千人千面面板：绑定人物→自动生成变种，重随/成长迭代/删除，稀有度徽章）；`WorldBrowser` 新增「自定义功法」分类（fuchsia 色，`CustomTechniqueSection` 浏览展示）。`lib/api.ts` 新增 `customTechniquesApi` + `techniqueVariantsApi`。

**关键约定/坑**：①`linked_character_ids` 存负数对外ID，`variant.characterId` 存正数DB id，跨表 join 须取负匹配（context-builder `linked.includes(-Number(v.characterId))`）；②customCharacterApi.list 返回负数 id；③UsageSkill 用 `text` 字段非 `name`；④功法无品级，渲染/审计须 `e.grade ?` 守卫；⑤E2E 31/31 通过 + LLM 详解抽查通过。

**旧 `custom_skill_lib` 退役（阶段6，方案B 入口隔离）**：本模块**取代**旧自定义功法库（D4 决策）。诊断证实旧库 0 存量、`entity_growth_record` 无 skill 历史，故无需数据迁移，退役为纯代码操作。已拆除三处用户可达入口/自动注入点：①`context-builder.ts` 删除 `getCustomEntitiesForCharacters` 中查询 `customSkillLib` 并 push `entityType:'skill'` 的整段（写作上下文不再注入旧功法）；②`branch-context.ts` `gatherWorkshopEntities` 删除 skill 采集分支，`WorkshopEntityRef.type` 收窄为 `'magic_item'`，`branch.ts` prompt 文案同步去掉"功法"（分支生成不再注入旧功法）；③`GrowthWorkshop.tsx` 移除"功法"页签与切换 Select，`entityType` 固定 `'magic_item'`，清理 skill 文案/表单分支。**保留项**：`workshop.ts` 路由内部 skill 分支与 `custom_skill_lib` 空表均保留为不可达休眠代码（与法宝 magic_item 深度共用 `getTable`/zod 枚举，拆之风险高、收益低；空表保留避免破坏性 schema 变更并留回滚余地）。**回归**：两包 tsc 零错误；成长工坊法宝 CRUD E2E 6/6 通过（确认共用路由未受误伤）；上下文/分支无 skill 注入由代码结构保证。**注意**：WorldBrowser/SceneOutlinePanel 中的 `skill`/`skillType` 属世界观设定库（诛仙库功法设定条目），与 `custom_skill_lib` 无关，不在退役范围。

### 6.29 世界观内容生产（一期 WS0-WS4）

将诛仙库从「只读 RAG 知识源」升级为**可写多书籍世界观库**，并围绕「自建书籍」补齐四条内容生产管线。一期范围 WS0-WS4，WS5（生成管线 bookId 解锁，让写作管线消费用户书）延后至二期。

**WS0 多书籍管理**：`novel_book` 增 3 字段 `description`/`source_type`/`cover_url`。诛仙三书（book_id=1/2/3）标 `source_type='system'` 只读保护（禁改禁删），用户新建书 `source_type='user'` 可写。`POST /api/world/books` 建用户书；system 书的写操作返回 403。

**WS1 公共批量管线**（`services/world-batch-pipeline.ts`）：跨书复制的统一底座。8 类实体表多以**名称文本**互相关联（非外键），仅 `lib_character_relation`(char_a_id/char_b_id) 与 `lib_faction_member`(faction_id/char_id) 用真实 ID——故复制策略为「整行 INSERT...SELECT 改 book_id」（embedding 向量留在库内不落地）+ 两张关系表的 ID 重映射。**关键坑**：postgres-js 将 bigint 主键返回为**字符串**，idMap 须 `set(Number(src.id), Number(ins.id))` 归一化，否则关系重映射以数字键查字符串键全 miss（relationsCopied 恒 0）。导出 `importFromBook`/`listImportableEntities`/`insertExtractedEntities`。

**WS2 跨书引入**：`GET /api/world/import/sources?bookId=` 列其他书可引入实体；`POST /api/world/import` 执行复制（去重 + 关系重映射 + 日志）。前端 `WorldBrowser` `ImportDialog`（源书选择 + 按类型勾选 + 全选/indeterminate + 结果网格）。**列表不刷新（bug修复）**：用户引入成功后"看不到"新实体（DB 实已写入），根因是 `ImportDialog`/`ExtractDialog` 的 `onDone` 只失效 `['world-books']` 与 `['world-stats']`，而实体列表用 `['world-all', key, bookId]` 缓存键未被失效→列表停在旧缓存。修复：两处 `onDone` 均补 `queryClient.invalidateQueries({ queryKey: ['world-all'] })` 前缀失效（react-query 前缀匹配会刷新所有实体类型列表）。

**WS3 文本抽取入库**：`WorldEntityExtractorAgent`（`agents/world-entity-extractor.ts`，温度0.2）把粘贴设定文拆成 8 类实体；zod 逐类 schema 内嵌于该 server agent 模块（**偏离约定**：未放 `@xianxiaforge/shared`，因 shared 是零运行时依赖纯类型包，而校验纯服务端职责）。三步端点：`POST /batch-import/extract`（拆解→暂存任务 `awaiting_confirm`）→ `GET /batch-import/:id`（查状态）→ `POST /batch-import/:id/confirm`（`insertExtractedEntities` 按名去重入库，`source='text-extract'`）。前端 `ExtractDialog`（粘贴→预览勾选→确认入库三阶段）。**边界清洗（bug修复）**：系统提示词示例把未知字段写成 `""`，会诱导 LLM 输出空串/null/数字，原严格 schema（`.min(1)`/`z.string()`）整批 parse 抛错→抽取 500 且不留任务记录（用户侧"没结果"）。现 `extractionResultSchema` 每类数组用 `z.preprocess(cleanEntities,…)` 先归一化（空串/null/空白→省略、数字/布尔→字符串、数组空串过滤、无合法 name 的实体整条丢弃），working case 不受影响；extract 端点 catch 加 `console.error` 留痕。**失败可见化（二次bug修复）**：用户报"点开始拆解卡很久后变回原样、没数据"，根因是 LLM 偶发超时/限流抛错后，catch 仅调 `toast(error,'error')`（ui.tsx toast 3 秒自动消失），对话框停在输入页→误以为卡死。修复：`ExtractDialog` 新增 `extractError` 状态，catch 时按"超时/限流/解析"归类后写入对话框内**持久红色横幅**（不再只靠闪逝 toast）；「开始拆解」按钮加 `loading={extracting}` 旋转图标 + 抽取时显示"LLM 抽取约需 10 秒，请稍候"提示。`world-entity-extractor.ts` maxTokens 曾误降 1500→**回归**：实体多、字段长（如 personality 长描述）的文本输出被截断、JSON 不闭合而解析失败；已改为 **4096**（模型上限 8192 的一半，留足余量），并在 `extract` 加截断检测——`parseJsonResponse` 抛错且原始输出 trim 后未以 `}` 闭合时，抛"模型输出被截断，请缩短文本或减少实体类型"的精准错误（前端横幅据此给对症提示）。不动表结构/路由契约/Toast 全局组件。**入库失败（三次bug修复）**：confirm 后部分实体 failed，根因是 `insertExtractedEntities` 把 `new Date()` 作为**原生 postgres-js 绑定参数**（`created_at` 列），postgres-js 拒绝序列化 Date，抛 `The "string" argument must be of type string… Received an instance of Date`→该实体计入 failed。修复：`created_at` 移出 cols/vals，SQL 里直接用 `now()`。**通用坑**：Drizzle ORM `.set({ updatedAt: new Date() })` 由 ORM 正确序列化、安全；但 `zhuxianClient.unsafe()/tx.unsafe()` 等**原生**调用绝不能把 Date 当 `$n` 参数，须用 SQL `now()`（已审计全 server，仅此处犯病，`importFromBook` 等其余原生 INSERT 均已用 now()）。

**WS4 智能匹配**（`agents/forge-smart-match.ts` + `services/forge-smart-match.ts`）：三工坊（人物/法宝/功法）「以文拟X」描述框。设计原则**参数对齐真实 schema**——service 从真实 config 模块（RACE_CONFIG/CATEGORIES/DAO_RULES 等单一事实来源）拼装枚举上下文喂 LLM，LLM **仅**做描述→枚举键映射；互斥/每类上限/辅修不重复主修/忌讳≤2 等**确定性约束**全由 `validateCharacter/validateWeapon/validateTechnique` 防御性过滤兜底，不依赖 LLM 自觉。三端点 `POST /projects/:id/custom-{characters,weapons,techniques}/smart-match`。前端三个 ForgeDialog 左列加描述 Textarea + 「智能匹配参数」按钮，回填尊重锁定项（法宝的 temperament/pastType/taboos/reverseMode 为独立 state，须分别 set）。

**验证**：双包 tsc 零错误；Python urllib E2E——WS4 三端点语义映射精准（雷→thunder 主修、残缺→remnant 传承、嗜血→bloodthirsty 器性）且输出全为合法枚举、过短描述 400，WS2 importSources 200，WS3 任务路由 404 结构正确；Chrome headless CDP 三路由点开新建弹窗，智能匹配面板渲染、零 JS 异常。

**WS5 跨项目引入**（`services/cross-project-import.ts`）：三工坊（众生百态/铸器天工/道法自然）除原有"从世界观引入"外，新增"从其他项目引入"——同库（creativeDb）同表按 `project_id` 隔离，复制行到目标项目。通用服务 `listProjectEntities(table, projectId)` 列源项目实体（id+name）；`importFromProject({table, sourceProjectId, targetProjectId, ids, skipDuplicates, sourceRefType})` 逐行复制，跳过 `id/projectId/sourceRef/isDeleted/createdAt/updatedAt`，`linkedCharacterIds` 清空（跨项目关联无意义），按名称去重（`skipDuplicates` 默认 true），`sourceRef` 记录 `{type, id, name, projectId}` 溯源。三 router 各 +2 端点：`GET /projects/:id/custom-{characters,weapons,techniques}/import/sources?sourceProjectId=` + `POST .../import-from-project`（body `{sourceProjectId, ids, skipDuplicates?}`）。前端通用组件 `ImportFromProjectDialog`（源项目下拉→搜索+多选→跳过同名 Switch→结果三格），三页面各加"从项目引入"按钮并列于原"引用X"按钮旁。**验证**：双包 tsc 零错；Python E2E 三模块创建→sources 列表→引入 created=1→重复引入 skipped=1，ALL PASS。

**WS5-ext 世界观跨书引入扩展**（`services/world-batch-pipeline.ts` + `routers/world.ts`）：WorldBrowser「引入实体」弹窗新增两类——**宗门规制**（`novel_faction_rule_lib`，名称列 `rule_name`）和**岁时节令**（`novel_season_event_lib`，名称列 `event_name`）。实现方式：引入 `ImportableEntityType = WorldEntityType | 'factionRules' | 'seasonEvents'`（WS3 抽取仍用原 8 类 `WorldEntityType` 不受影响），`ENTITY_TABLES`/`ENTITY_TYPE_LABELS` 扩展为 `Record<ImportableEntityType, string>`，`NAME_COLUMN` 映射非标准名称列（默认 `name`），`importFromBook` 去重查询用 `nameCol(type)` 别名 `AS name`。前端 `IMPORT_TYPE_ORDER` 追加两项，ImportDialog 自动渲染（按 `sources[t.key]?.length` 过滤空类型）。**文风引擎**独立端点 `POST /api/world/style/import`（body `{sourceBookId, targetBookId}`）：`cloneBookStyle()` 事务复制 `style_global_config`（1 行）+ `style_scene_mapping`（N 行），排除 `config_id/mapping_id/book_id/is_deleted/version/create_time/update_time`，目标书已有配置则跳过不覆盖（`cloned:false, reason`）。前端 `StyleSection` 加"引入文风"按钮 + `StyleImportDialog`（源书下拉→结果/跳过原因）。**验证**：双包 tsc 零错；E2E 17 断言全通过——sources 含 factionRules(22)/seasonEvents(18)、首次引入 created=40、重复 skipped=40、style cloned(config=1,mappings=52)、重复 style 跳过、system 书 403、清理后活跃记录归零。

### 6.30 素材深度融入写作（召回兜底 + 审计闭环 + 任务链台账 + 节奏编排）

将库中 4.4 万条奇遇/伏笔/高光/任务素材（四张对称表 `plot_material_*`，100% 向量化，经 `creativeClient.unsafe` 原始 SQL 访问）从"写作时的可选灵感"升级为"剧情骨架驱动力 + 写作硬约束"。背景诊断：召回真凶是 embedding_server（127.0.0.1:8600）未启动致查询向量生不出、代码静默降级返空（`plot-material-retriever.ts` 仅 console.warn）。本改造分层落地：

**第0层 召回兜底 + 7.1 分类配额**（`rag/plot-material-retriever.ts`）：
- 0.2 无向量降级：embedding 不可用时改走 `recallMaterialsByKeywordFallback`（粗提取关键字=词 token+中文 bigram，对 `tags[]`(GIN) 做 `&&` 重叠 + `title ILIKE ANY` 兜底，按 quality_score 取），单表路径 `recallSingleTableByKeyword` 同步降级——召回永不熄火。
- 7.1 分类配额：`recallMaterials` 改按表收集 `perTable`，`fairMergePerTable` 轮转公平合并（每轮每表先各占一席），保证四类素材各有槽位，不被高分单类（如伏笔）挤出全局上限 `topN*2`。

**1A 审计闭环**（`agents/auditor.ts`）：systemPrompt 新增第28维「指定素材融入率」；`buildAuditPrompt` 渲染「【应融入素材清单】」（pinned 素材标"必须融入"+伏笔手法+高光参考）；新增零-token `scanPinnedMaterialConsistency(content, plotMaterials)`（pinned 素材 title/core_plot 关键词 `content.includes` 比对，完全缺失 push issue，severity=major 灰度避免回炉循环），并入扫描合并入口。

**1B 确定性触发**（`rag/plot-material-retriever.ts` + `rag/context-builder.ts`）：`recallDeterministicMaterials({projectId, chapterType, intentText})` bypass 语义阈值——奇遇在推进/关键章（progression/climax/revelation/singularity）或命中奇遇关键词（秘境/洞府/机缘/传承…）时按 `applicable_scene_type IN ('transition','key')` + quality_score 确定性取；任务按意图关键词命中 tags/title。`PlotMaterialHit` 加 `deterministic?` 标记。context-builder 在 Promise.all 后调用并 `mergePlotMaterials`（pinned>deterministic>语义，去重，上限8）注入 `plotMaterials`。

**3 素材进大纲编排**（`routers/outlines.ts`，零新增字段）：大纲生成 userParts 拼装区调 `recallBranchMaterials` 召回四类素材按类型分组带 `#id` 注入；system prompt 章节字段增 `basedOnMaterials:[{table,id}]`（强调服务主线、按需选用）；物化时 `resolveOutlineMaterials`（校验 table+id 丢弃幻觉、短名归一全名）写入**已预留**的 `chapter_plan.pinnedMaterialIds`（正文生成 context-builder 已消费它做强制注入）。

**2 task_arc 任务链台账**（仿 foreshadow_thread 八部件）：
- ① schema `creative-schema.ts` 新增 `taskArc` 表 + DDL `sucaiqingxi/ddl-task-arc.sql`（status: active/progressing/completed/failed/abandoned；priority: high/normal/low；tier: t1战略/t2战役/t3普通；referenced_material_ids/related_character_ids jsonb；索引 idx_task_arc_project_status）。
- ③ `state/store.ts` `getActiveTasks`（active/progressing+is_confirmed，按 priority/tier 排序注入）+ `autoUpdateTaskFromContent`（progress_clue 子串匹配状态机：命中且 chapterNo>=targetChapter→completed，否则 active→progressing）。
- ④ `types.ts` `ActiveTaskContext` + `ContextPackage.activeTasks`；context-builder 注入。
- ⑤ `runner.ts` 定稿后 best-effort 调 autoUpdateTaskFromContent（7.55b 块）。
- ⑥ `writer.ts` 新增【进行中的任务线】渲染块。
- ② `routers/task-arc.ts`（挂 /api，`/projects/:pid/tasks` GET列表/POST创建/PUT更新流转/DELETE硬删/POST :id/confirm），index.ts 挂载。
- ⑦ `auditor.ts` 第29维「任务推进合理性」（LLM 审查 + buildAuditPrompt 渲染【进行中的任务线】参照段，维度计数 28→29）。
- ⑧ 前端 `pages/TaskLedger.tsx`（侧边栏「征途录」/tasks，列表+状态筛选+统计卡+新建/编辑弹窗+状态流转/确认/删除）+ `api.ts` taskArcApi + App.tsx 路由。

**7.2 收藏/已用状态**：DDL `sucaiqingxi/ddl-material-collection.sql` 四表各加 `is_collected BOOLEAN DEFAULT false` + `last_used_chapter INTEGER`。retriever 召回过量取 `topN*3` 后 `computeWeightedScore` 重排（收藏 +0.08、近3章已用 -0.05）再表内截断。`routers/materials.ts` `POST /materials/collect`（table 白名单校验防注入）。前端 MaterialPickerDialog 星标收藏开关（乐观更新+失败回滚）。

**验证**：embedding_server /health 在线；双包 tsc 零错误；DDL 已执行（task_arc 表+索引、四表收藏列均就位）；运行时冒烟——语义召回 degraded=false 且 4 条素材覆盖全四类（分类配额生效）、确定性触发返回 2 奇遇+2 任务（deterministic=true）。

### 6.31 众生百态人物生产 + 铸器天工名字保护（v1.3.2）

源自外部 PRD v1.3.1 评审修订版（v1.3.1 字段名与真实 schema 严重不符，已按真实 schema 重写；"世界观页面三按钮重定义"已否决，批量新建/文本抽取归位众生百态）。

**铸器天工名字保护**（`pages/CustomWeaponForge.tsx` handleGenerate）：病因二处——① 创建时强制 `name: ${formLabel}·待命名` 丢弃 draft.name（智能匹配/随机名）；② LLM 文案回来无条件 `update({name})` 覆盖。修法：计算 `userSetName=draft.name?.trim()`、`isDefaultName=!userSetName||endsWith('·待命名')`；创建用 `userSetName||默认`；仅 isDefaultName 时才用 LLM 名覆盖 DB，`patch({name: finalName})` 与 toast 用 finalName 保 DB/UI 一致。第四步「全部重生成」旁加「修改参数」按钮（`setStep(1)` 保留 draft，核心回改本已可行——步骤条可跳步+update 回写分支——此为可发现性增强）。

**众生百态·按书籍批量引用**（`routers/custom-characters.ts`）：抽公共 `mapWorldCharacterToCustom(src, id)`（单个 /import 与批量共用，沿用现网映射：gender 固定 male、REALM_TO_POSITION 境界→position、faction→innerPersonality、personality→outerPersonality[]、coreSkills→talents、growthLine→strengths、sourceRef={type:'world_character',id,name,bookId}）。新增 3 端点：`GET /import/world-books`（novel_book 未删，bookId/bookName/author）、`GET /import/world-sources?bookId=`（novel_character_lib 的 id/name/allTitles/faction/realm）、`POST /import/batch`（body worldCharacterIds[1..100]；预取本项目 sourceRef.id 集合按源ID去重——可靠于 JSON 精确匹配；逐条读源→插入，单条失败不阻断，返回 created/skippedDuplicate/failed/errors）。

**众生百态·文本抽取人物**：`POST /extract-from-text`（body {text, generateBio}，chatCompletion temp0.2 出 JSON 数组，`parseJsonArray` 兼容代码围栏，zod 逐条过滤，不入库）→ 前端预览编辑 → `POST /batch-create-from-candidates`（body characters[]，`normalizePosition` 兼容中文境界/key，默认 human/凡人/stance50，sourceRef={type:'text_extract'}）。

**众生百态·批量新建人物**：`POST /batch-create`（body {count[1..20], randomize, generateBio}；randomize 走 randomCharacter，否则空白凡人草稿 `未命名·N`；generateBio 才调 LLM 小传否则模板；判词恒用 buildFallbackVerdict 模板避 LLM 串行慢）。

**前端**：新增 `components/ImportFromWorldDialog.tsx`（书下拉→人物列表 名字+境界+门派+称号→搜索/全选/多选→批量引用→结果三格）、`ExtractCharactersDialog.tsx`（文本框→抽取→预览可编辑名/性别/档位+删+勾选→批量创建）、`BatchCreateCharactersDialog.tsx`（数量滑杆1-20+随机开关+生成小传开关）。`CharacterGallery.tsx` 头部四按钮：引用人物（改接 ImportFromWorldDialog，删旧单条搜索 ImportCharacterDialog）/从项目引入/文本抽取/批量新建。`api.ts` customCharacterApi +worldBooks/worldSources/importBatch/extractFromText/batchCreateFromCandidates/batchCreate。

**真实 schema 关键事实**（踩坑预防）：创作库表导出名单数 `schema.customCharacter`（表 custom_character），无 bio（小传=description）/verdictText（=verdictPoem+verdictComment）/flaws（并入 talents），innerPersonality 是 varchar、stance 是 integer(0-100)；诛仙库 `novelCharacterLib` 无 gender/alias/sect/position/description 列（真实：allTitles/faction/realm/coreSkills/personality/growthLine）；书籍表 `novelBook`（bookId/bookName/author）。

**验证**：双包 tsc 零错误；运行时冒烟 ALL PASS——world-books 4 本、world-sources(book=1) 96 人、import/batch 首引 created=2 再引 skipped=2（去重生效）、batch-create created=2、batch-create-from-candidates created=2（中文境界归一）、extract-from-text LLM 抽出 3 人；冒烟数据已按时间窗软删清理。

### 6.32 审计问题一键修改 + 导出跟随分支（v1.3.2）

源自外部 PRD v1.3.2 评审修订版。原 PRD 两处与代码现状不符已修正：① 导出修复方案误用 `eq(generatedChapter.id, id)`，而前端 `activeChapters.id` 实为 `chapter_plan.id`（`GET /projects/:id/chapters` 返回计划行），直接用 id 会导出空文件——已改为按 `chapterPlanId` 解析；② 质量审计 `AuditIssue`（types.ts）仅有 severity/dimension/description/suggestion，**无 excerpt/aiFlavorType**（那是 `StyleIssue` 独有），单条修复指令据此构造。文案"27维"统一更正为实际的 29 维（auditor.ts:351）。

**导出跟随分支**（`routers/chapters.ts` export + `pages/ChapterReader.tsx` handleExport）：`GET /projects/:pid/export` 新增可选 `chapterIds`（逗号分隔章节计划ID）。传了则逐个按 `generated_chapter.chapterPlanId=id AND project_id=pid AND is_current=true` 查询、**按传入顺序**拼接（仍受 volumeNo 过滤）；未传则保持原主线卷章排序，兼容旧调用。前端 `handleExport` 把 `activeChapters`（阅读路径，分支衍生章已替代被绕过主线章）的计划ID列表作为 chapterIds 传入，导出遂与阅读区一致。

**单条问题修复**：`POST /chapters/:id/fix-issue` 与 `/projects/:pid/chapters/:id/fix-issue`（同 handler 双注册）。body `{auditType:'quality'|'style', issue}`；取 isCurrent 正文，按 auditType 称"文风/质量问题"合成**单条**修订指令（含 dimension/description/aiFlavorType/excerpt/suggestion 可选字段），调 `reviserAgent.reviseWithInstruction()`，返回 `{revisedContent, revisionNotes, originalContent}`，**不自动保存**。

**质量审计一键修复**：`POST /chapters/:id/fix-all-quality` 与 projects 形式。body `{issues[], ignoredIndices[]}`；过滤被忽略下标后仅取 critical/major，合成合并指令调 reviser，返回同上结构；无可修复项（全 minor 或全忽略）返回 400。文风一键修订 `style-audits/:aid/revise` 亦新增 `ignoredIndices` body 支持（原接口无 body）。

**前端 ChapterReader**：新增页内 `FixConfirmDialog`（复用私有 `DiffView`，含 取消/重新生成/确认替换）。质量审计弹窗（标题 29维）顶部加「一键修改」按钮（无可处理 critical/major 非忽略项时 disabled），每条问题加「修改」「忽略/撤销」按钮（minor 或已忽略时修改 disabled，忽略项 opacity-50 灰显）。文风问题清单每条同样加「修改」「忽略」按钮（原「一键修正」改名「一键修改」并传 ignoredIndices）。忽略态存 `ignoredIssues: Set<string>`（key `${type}-${index}`，文风用 `styleRecord.issues.indexOf(issue)` 取平铺下标对齐后端），重新审计时按类型清空（下标会漂移）。`handleConfirmFix` 经 `updateContent` 存新版本 + invalidate 缓存 + 按类型重审。`api.ts` chaptersApi +fixIssue/fixAllQuality，reviseStyleAudit 增第4参 ignoredIndices。

**验证**：双包 tsc 零错误；运行时冒烟——导出 branch path(149,180,181,184) 与主线内容/长度不同、chapterIds=150(planned 无内容)→404 而 180(generated)→3227 字（证 chapterPlanId 解析正确，规避 PRD 致命 bug）；fix-all-quality 空 issues/全 minor/唯一 critical 被忽略 均正确返回 400「无可修复」，fix-issue 非法 auditType 返回 zod 400，双路由形式（/chapters 与 /projects/:pid/chapters）皆已注册（LLM 实际改写复用已验证的 reviserAgent，未耗 token 重复验证）。

### 6.33 自定义实体自动维护（v1.4）

源自外部 PRD 09 评审修订版。目标：章节生成后自动从正文发现新人物/武器/功法/地点并建草稿，老实体增量动态记入台账，替代纯手工维护三工坊。

**DDL**（`scripts/ddl-entity-auto-maintain.sql`，已执行）：`custom_character`/`custom_weapon`/`custom_technique` 三表各加 `entity_status VARCHAR(16) DEFAULT 'official'` + `chapter_updates JSONB DEFAULT '[]'`（存量行默认 official，不影响现有数据）。

**后端核心**（`services/custom-entity-pipeline.ts`）：
- `resolveEntityMaintainConfig(generationConfig)`：读 `autoExtractCustomEntities`（总开关，缺省 true）、`entitySensitivity`（strict/balanced/loose）、`extractWeapons/extractTechniques/extractLocations`（分项开关，缺省 true）。
- `processChapterEntities(projectId, chapterNo, volumeNo, content)`：① 预取本项目已有实体名（四表）+ 诛仙库名单（人物/法宝/功法/地点）→ ② `customEntityExtractorAgent.extract()` LLM 抽取（existingXxx 名单 + zhuxianCharacters 入参排除，sensitivity 分档）→ ③ 新实体逐条入库为 draft（人物带 description≤500字；武器/功法仅占位常量无 description；地点经 `getOrCreateDefaultMap` + `edgeCoordinate` 落默认地图边缘，metadata.source='auto-extract'）→ ④ 老实体动态以 `{chapterNo,volumeNo,updateText,category,extractedAt}` 追加 `chapter_updates`（同章号去重：`prev.filter(e => e.chapterNo !== chapterNo)` 后追加）。
- 双保险去重：LLM 名单排除之外，入库前再按 `charNames/weaponNames/techNames/locNames` + 诛仙库名单 Set 比对；strict 档无对白不抽人物；minor 级 mentionCount<2 且无对白丢弃。单条插入失败 catch 跳过不阻断。

**管线接入**（`pipeline/runner.ts` 步骤7.8）：正文定稿后 `await processChapterEntities()`（try/catch 包裹，失败仅 console.error 不阻断），成功后 `emitEvent('entities_extracted', {result})`。注意与步骤7.7 金句管线（fire-and-forget）不同，7.8 是 await 但包在 try/catch 里。

**前端**：`CharacterGallery.tsx`（众生百态）加草稿筛选与 entityStatus 徽章（转正/忽略操作）；`custom-characters.ts` GET 列表支持 `entityStatus` 查询过滤（L246-253），创建默认 'official'（L621）。地点草稿进山河舆图（见 6.34）待确认。`useGenerationStream.ts` 处理 `entities_extracted`，`GenerationConsole.tsx` 展示"本章发现 N 个新实体"通知（L665-677）。

**验证**：双包 tsc 零错误；DDL 已执行（三表列就位）；API 冒烟——列表 entityStatus 过滤、chapter_updates 追加均通过。

**关键约定/坑**：① 无 DB 级 `(project_id,name)` 唯一约束，去重全依赖应用层 Set，并发同名理论上可双写；② `chapter_updates` 去重仅按 chapterNo 不带 volumeNo（跨卷同号章会覆盖）；③ 批量忽略草稿未实现（逐条操作）；④ 武器/功法草稿无 description（PLACEHOLDER 常量），需人工补全后才适合注入写作——草稿实体因无 linked_character_ids 本就不会被 `getCustomEntitiesForCharacters` 注入。

### 6.34 山河舆图（v1.4）

源自外部 PRD 10 评审修订版。目标：项目级可视化地图——地点布点/路径连线/行程估算/诛仙库导入/正文地点注入/瞬移预警。一期范围 US-1/2/3/5/8/9，US-4 势力多边形（affiliated_faction 文本字段替代）/US-6 行程时间轴/US-7 伏笔地图标注明确不做。

**DDL**（`scripts/ddl-world-map.sql`，已执行）：`custom_map`（画布尺寸+is_default）/`custom_location`（x/y坐标+location_type七类+danger_level四档+affiliated_faction+entity_status+metadata jsonb）/`custom_location_link`（from/to+link_type四类+四种通行时间）+ 3 索引。

**后端**：
- `routers/custom-maps.ts`：地图 CRUD（GET/POST `/projects/:id/custom-maps`、PUT/DELETE `/projects/:id/custom-maps/:mapId`），DELETE 守卫"至少保留一张地图"。
- `routers/custom-locations.ts`：地点 CRUD（GET 支持 mapId/entityStatus/locationType 过滤）；`POST :locId/confirm` 转正；`PUT` 带 `confirm:true` 同时转正；`POST /projects/:id/custom-locations/import-zhuxian` 诛仙库地点批量导入（上限500条，draft + `edgeCoordinate` 边缘坐标 + `metadata.zhuxianId` 溯源，按名去重）；`GET /distance?fromId=&toId=` 行程估算（返回 estimateTravel/分钟 + pathNames 途经点）；连线 CRUD（`custom-location-links`，重复边复用返回已有）。
- `services/custom-map-helpers.ts`：`getOrCreateDefaultMap`（首次自动建默认地图）/`edgeCoordinate`（按序排布边缘坐标）/`mapDangerLevel`（location_type→danger_level 默认推断）/`guessLocationType`。
- `services/travel-time.ts`：Dijkstra 最短路 + 分交通方式速度常量（御剑 0.1 分钟/单位，偏宽松）。
- `services/teleport-detector.ts`：正文出现≥2地点名时按御剑速度估算行程，过短即产出 warning。
- **管线接入**（`pipeline/runner.ts`）：定稿后 `detectTeleport` → `emitEvent('teleport_warning', {warnings})`（best-effort，不阻断，L664-671）。
- **写作上下文注入**（`rag/context-builder.ts` `getCustomLocationsForChapter`，L1121-1143）：地点名对正文**子串匹配**（名称长者优先、最多5个、catch→[]）合入 `context.locations`（L393-400）；Promise.all 预取（L172）。非外键关联。

**前端**：`pages/WorldMapPage.tsx`（路由 `/maps`，App.tsx lazy 加载 L257-264）：地图切换/地点编辑弹窗（保存即转正）/草稿确认与删除/连线绘制/行程估算展示。`useGenerationStream.ts` 处理 `teleport_warning` 事件。

**体验优化二期（v1.5，源11-需求规格说明书 v1.3）**：① 三栏布局 `xl:grid-cols-[260px_1fr_320px]`（左地点导航树/中画布/右详情），xl 以下降级为上下布局+Tab 切换；② 新增 `components/LocationTreePanel.tsx`：搜索高亮过滤+parentLocationId 树形折叠+点击居中定位（panToLocation）+悬停编辑/删除；③ US-12 地点标记升级为 7 类 SVG path 图标（LocationTypeIcon，双层白描边+类型色填充，导出供树面板复用），名称加深色背景条（rect+text），选中金色脉冲光圈+scale1.15，草稿 opacity0.6+橙虚线圈+「待确认」标签；④ US-13a 双击空白处新建地点（删除布点模式，mode 收窄 select/link）；⑤ 画布米黄渐变背景+高度自适应 `h-[calc(100vh-260px)]` min 480px；⑥ US-13d 缩放显隐：k<0.4 隐藏名称、k<0.6 隐藏路径；⑦ US-14 默认底图**渲染层兜底**（`assets/default-map-bg.png` ImageGen 水墨宣纸图，`bgImage || defaultMapBg` 始终渲染，不入库存 URL 避构建 hash 失效）。另修存量 bug：切项目未重置 activeMapId 致新项目显示「加载中」。

**验证**：双包 tsc 零错误；DDL 已执行（3表+3索引）；API 冒烟——地图 CRUD（含最后一张守卫 400）、地点 CRUD/confirm、连线重复边复用均通过。

**关键约定/坑**：① 上下文注入靠地点名子串匹配，地点改名需人工同步，否则召回失联；② 诛仙库136条地点导入端点已就绪但**前端未触发**（需用户在页面手动点，或后续挂初始化钩子）；③ 御剑速度常量偏宽松，瞬移预警阈值保守；④ 布点交互 v1.4 为「布点模式+左键」，v1.5 已改为双击空白处新建（US-13a）；⑤ 默认底图不存 DB：存 vite import URL 会因构建 hash 变化失效，故采用渲染层兜底；⑥ custom_map 创建/更新 zod 校验 description/parentMapId 需兼容前端传 null/''（已修为 nullable）。

### 6.35 金句库质量升级与智能美化（v1.4）

源自外部 PRD 11 评审修订版。目标：对抗 LLM 评分膨胀（提取门槛提升+五维评审纪律）、三档美化（保守/平衡/升华）、金句回写正文。Token 成本从 ~800/章升至 ~8000/章（用户已确认接受）。

**DDL**（`scripts/ddl-quote-quality.sql`，已执行）：`project_quote_lib` 加 7 列（original_text/polished_text/polished_versions jsonb/scores jsonb/grade/polish_status/applied_at）+ 旧数据一次性迁移（按 quality_score 映射 grade、scores 回填 total；迁移时 20 条存量金句全部覆盖）。注意该表无 is_deleted 列。

**后端**：
- `agents/quote-judge.ts` `QuoteJudgeAgent`：批量评审（≤10条一次调用，temp0.1），prompt 内置**反膨胀打分纪律**（平庸3-8/尚可8-12/出彩13-17/传世18-20，宁缺毋滥，worthy=true 通常≤3条）；五维 imagery/rhythm/philosophy/emotion/viral 各0-20，total 本地求和；`gradeOfTotal`：≥90 legendary / ≥80 good / 其余 candidate。
- `agents/quote-polisher.ts` `QuotePolisherAgent`：三档美化（conservative 保守润色/balanced 意象升级/deep 升华重构），铁律保留原意与角色口吻、宁可不改不改坏。
- `pipeline/quote-extractor.ts`：`extractQuoteCandidates`（temp0.2，maxTokens1500）+ `extractQuotesFromPastedText`（批量导入预筛）。旧 `extractQuotesFromChapter` 已删除，由 quote-service 编排取代。
- `services/quote-service.ts`（编排核心）：`runQuotePipeline(projectId, chapterId, content, title?)` 四步——提取→归一化去重（双向包含比对）→评审定级（worthy=false 或 total<70 丢弃，candidate 上限3）→仅 legendary/good 调打磨→入库（正式≤3条/章，常量 MAX_STORED_PER_CHAPTER=3/STORE_MIN_TOTAL=80/CANDIDATE_MIN_TOTAL=70）；另 `polishQuoteRow`（库中金句补三版本）、`polishAnyText`（任意文本先重评再打磨，worthy≥70 才磨）、`rescoreQuote`、`applyPreview`（定位原句返回前后文不落库）、`applyToChapter`（精确 indexOf 首处匹配替换，按 generated_chapter.id 或 chapterPlanId 定位 isCurrent=true 正文存新版本，polish_status=applied+applied_at；找不到原句报错提示手动复制，不做模糊匹配）。
- **管线接入**（`pipeline/runner.ts` 步骤7.7）：fire-and-forget `runQuotePipeline`（失败记 generation_log 不阻断，L617）。
- **路由**（`routers/quotes.ts` 新增5端点）：`POST /projects/:id/quotes/polish-text`、`POST /quotes/:qid/polish`、`POST /quotes/:qid/rescore`、`POST /quotes/:qid/apply-preview`、`POST /quotes/:qid/apply`。

**前端**：`pages/QuoteLibrary.tsx` 重构——分级徽章（legendary/good/candidate）+五维迷你分+打磨按钮；`components/QuotePolishModal.tsx` 三版本对比弹窗（原文 vs 三档，选定应用/重新打磨）；重评、回写原文（预览→确认替换正文）；批量导入流程保留。

**验证**：双包 tsc 零错误；DDL 已执行（7列+迁移完成）；API 冒烟——quotes 列表返回新字段、polish/rescore/apply 链路通过。

**关键约定/坑**：① `applyToChapter` 只做精确 indexOf 首处匹配，用户手改过正文会失败（设计如此，提示手动复制）；② 回写生成新正文版本，后续重新生成章节会覆盖回写结果（不做撤销链）；③ **dist/ 目录仍是旧构建**（引用已删除的 extractQuotesFromChapter），生产部署前必须 `pnpm build`；④ 美化 token 成本 ~10倍，美化仅对 legendary/good 触发以控量。

---

## 7. 前端架构

### 7.1 页面结构

| 路由 | 页面 | 功能 |
|------|------|------|
| / | Dashboard | 项目列表、数据库状态、最近任务 |
| /outlines | OutlineEditor | 卷大纲CRUD、AI生成、章节计划；内嵌 SceneOutlinePanel 场景脚本拖拽编排 |
| /chapters | ChapterReader | 章节阅读、编辑、版本历史；右侧剧情分支面板（3:6:3 常显，叙事方向可选定向/自动合一） |
| /generation | GenerationConsole | 生成控制台、SSE实时预览、参数配置 |
| /world | WorldBrowser | 诛仙世界观多类浏览+搜索+条目CRUD+深度蒸馏，顶部书籍切换（book_id 隔离），底部嵌入 RelationPanel 自定义人物关系推演 |
| /characters | CharacterGallery | 众生百态：自定义人物列表+三步向导入口+引用/文本抽取/批量新建；实体自动维护后增草稿筛选与转正/忽略徽章（6.33） |
| /growth | GrowthStagePage | 人物成长弧光卡点：按人物分组时间线、阶段CRUD、统计卡、推荐高光素材（模块3） |
| /quotes | QuoteLibrary | 金句库：按角色分组、全部/收藏Tabs、收藏/删除/手动录入、批量导入（LLM预筛+审阅）、来源徽标+筛选；质量升级后增分级徽章（legendary/good/candidate）+五维评分+QuotePolishModal 三版本打磨对比+重评+回写原文（模块11） |
| /workshop | GrowthWorkshop | 成长工坊：法宝自定义实体管理（阶段6起旧功法页签已退役）、融合/变异/强化/进化4操作tab、成长记录与回滚（模块9） |
| /foreshadow | ForeshadowLedger | 伏笔台账：统计卡片、状态筛选、超期提醒、从场景节点提升；内嵌因果链页签（CausalChainPage） |
| /tasks | TaskLedger | 征途录：任务链台账（active/progressing/completed/failed/abandoned 流转、确认、t1-t3 分级，6.30；lazy加载） |
| /todo | TodoCenter | 待办中心：健康度/失败任务等待办项全局聚合面板（T1战略/T2战役/T3普通分级徽章，lazy加载） |
| /timeline | TimelinePage | 人物状态快照与时间线里程碑：pending/confirmed 管理、引导初始化、手动抽取 |
| /weapons | CustomWeaponForge | 神兵坊：自定义武器创建（图鉴点选/随机骰子）、强化/进化/变异/融合养成、兵器谱文案生成与版本管理 |
| /techniques | CustomTechniqueForge | 功法铸造：九大道则三步点选/随机创建、功法详解生成、绑定人物触发个人变种（千人千面） |
| /maps | WorldMapPage | 山河舆图：多地图切换、布点模式左键落点、地点类型/危险度/归属势力编辑、草稿确认转正、地点路径连线、行程估算（Dijkstra）、诛仙库地点批量导入（lazy加载） |
| /health | HealthCheck | 健康度体检：9维零LLM规则评分仪表盘（伏笔/因果/方向/钩子/状态确认等） |
| /direction-stats | DirectionStats | 剧情方向统计：分支主方向占比分布与失衡预警 |
| /technique-library | TechniqueLibrary | 叙事技法库：技法原子浏览/筛选（内容规划/呈现技法/节奏控制/人物逻辑）、详情（生成指导/审计维度/修复模板）、启用切换（数据源 techniques.ts，注意与 /techniques 功法铸造区分） |
| /hotspot | HotspotSniffer | 热点嗅探：榜单抓取→LLM提炼灵感→筛选保留→推送入剧情素材库 |
| /material-kb | MaterialKnowledge | 素材知识库：文风预设/领域知识浏览软删 + 蒸馏ETL任务发起与进度监控 |
| /settings | Settings | LLM配置、数据库状态、默认参数 |

另有非路由嵌入式页面/组件：CausalChainPage（嵌入 ForeshadowLedger 页签）、CustomCharacterWizard（三步向导，嵌入 WorldBrowser）、MaterialPickerDialog（剧情素材选择器，嵌入 OutlineEditor）、RelationPanel（嵌入 WorldBrowser）、SceneOutlinePanel（嵌入 OutlineEditor）。

### 7.2 API客户端设计

`api.ts` 底层 `request()` 函数统一处理 `{success, data}` 信封解包：

```typescript
// 底层自动解包，调用方直接拿到 data 内容
const json = await response.json()
if (json && typeof json === 'object' && 'success' in json) {
  return json.data as T
}
return json as T
```

所有API方法无需额外处理，直接返回业务数据。

### 7.3 SSE流式生成

`useGenerationStream` hook 管理 EventSource 连接：
- 自动重连（最多3次，递增延迟）
- 阶段状态追踪 (idle → context → writing → auditing → revising → complete/error)
- 文本累积拼接
- 审计报告解析

### 7.4 UI组件库

内置轻量组件（`components/ui.tsx`）：Button, Card, Input, Textarea, Select, Badge, Dialog, Tabs, Spinner, Toast, EmptyState。暗色主题，TailwindCSS 实现。

### 7.5 当前项目全局状态（8.1 修复）

**背景**：此前前端无"当前项目"概念，所有项目作用域页面硬取 `useProjects()→projects?.[0]?.id`。后端项目列表按 `createdAt` 升序，故 `projects[0]` 恒为第一个项目——新建的第二个项目在任何页面都无法生效（"第二个项目啥也做不了"）。

**方案**：`hooks/useCurrentProject.tsx` 提供 `ProjectProvider`（React Context + `localStorage` 持久化，键 `novel-studio:currentProjectId`），在 `App.tsx` 根部包裹全部路由。存储的 ID 若不在项目列表中（如项目被删），自动回退到列表首个项目。

对外 API：

```typescript
useCurrentProjectId(): string        // 当前项目ID（各页面数据查询统一入口）
useCurrentProject(): Project | null  // 当前项目对象
useSetCurrentProject(): (id) => void // 切换当前项目
useProjectContext()                  // { currentProjectId, projects, setCurrentProjectId }
```

**两个切换入口**：

- 侧边栏 `ProjectSwitcher`（`App.tsx`）：品牌回纹带下方的下拉选择器，展示当前项目名，展开列出全部项目。
- 仪表盘项目卡片（`Dashboard.tsx`）：点击卡片即切换当前项目，当前项目卡片金色描边（`border-gold-400/70`）+「当前」徽标；卡片内编辑/删除按钮 `stopPropagation` 防误切换。

**消费方**：15 个项目作用域页面/组件统一改用 `useCurrentProjectId()`——CharacterGallery、CustomWeaponForge、CustomTechniqueForge、OutlineEditor、GenerationConsole、ChapterReader、ForeshadowLedger、TimelinePage、QuoteLibrary、HealthCheck、DirectionStats、CausalChainPage、SceneOutlinePanel（useMaterials）、RelationPanel、Dashboard 内嵌统计卡（CreationHeatmap/ForeshadowProgress/DirectionBalanceCard）。切换项目后全部页面数据自动跟随，刷新后由 localStorage 恢复。

> 注：`/world`（WorldBrowser）按 `book_id` 作用域、`/settings` 为全局配置，均与项目无关，不消费当前项目状态。`GrowthWorkshop.tsx` 硬编码 `'3'` 属未注册路由的死代码，未处理。

---

## 8. 场景脚本编排模块（原"场景小纲"）

场景脚本（原名"场景小纲"，因"小纲"一词过于含糊、不能体现其"逐场景可落笔剧本"的实际定位而更名）是介于「卷级大纲」与「章节计划」之间的中间层，把每一卷拆分为若干场景节点，并为每个节点关联诛仙库中的人物、地点、功法、法宝、妖兽等素材，形成可落笔的细粒度剧情骨架。

### 8.1 数据模型

三层结构：

```
卷大纲 (story_outline)
  └── 场景节点 (scene_node)            ← 标题/时间/地点/核心事件/作用结果/伏笔
        ├── 人物关联 (scene_node_character)  ← 诛仙库人物 + 出场类型 + 备注
        └── 要素关联 (scene_node_element)    ← 地点/功法/法宝/妖兽 + 备注 + 伏笔方向
```

节点之间可用 `scene_node_relation` 建立因果/顺承/伏笔呼应连线。

### 8.2 前端交互（SceneOutlinePanel.tsx）

整体为左右两栏布局，外层包裹单一 `DndContext`（@dnd-kit）：

- **左栏 素材池**：分类展示诛仙库素材（人物/地点/功法/法宝/妖兽/灵材/信物），支持关键词搜索。每个素材项是 `useDraggable` 拖拽源。
- **右栏 节点画布**：场景节点卡片纵向排列，使用 `useSortable` 支持上下拖拽排序。卡片同时是拖放目标——从素材池拖素材到卡片上即添加关联（拖拽悬停时卡片高亮）。
- **DragOverlay**：拖拽素材时显示悬浮的素材芯片。

设计取舍：`Dialog` 组件为内联渲染（fixed 定位，无 Portal），为避免嵌套 DndContext 冲突，**拖拽只发生在主画布**（素材池→卡片）；弹窗内的素材添加改用**点击式**（点迷你素材池项或智能匹配候选）。

### 8.3 大弹窗编辑器（SceneNodeEditor）

点击节点卡片弹出 `max-w-4xl` 大弹窗，包含：

- **基本信息区**：场景标题、时间、地点、核心事件、作用与结果、伏笔说明、场景类型（关键剧情/过渡/伏笔）、重点剧情标记。
- **关联素材区**：按人物/地点/功法/法宝/妖兽/灵材/信物七个分框展示已关联素材，每条可编辑备注（失焦提交）、可删除。
- **智能匹配区**：点击「智能匹配」按钮，后端扫描节点文本返回候选，前端列出未关联的候选项供手动确认加入。
- **迷你素材池**：弹窗内嵌紧凑型素材池，点击即添加（已关联项显示勾选态并禁用）。

### 8.4 智能匹配机制（match-materials）

后端 `POST .../scenes/:sid/match-materials` 流程：

1. 读取节点文本（标题 + 时间 + 地点 + 核心事件 + 作用结果 + 伏笔说明）拼接成检索串。
2. 加载该节点已关联的人物与要素，构建排除集（`linkedCharIds`、`linkedElKeys = elementType:elementId`）。
3. 通过 `retriever.getEntityNameDirectory()` 获取去重后的实体名目录（人物/门派/地点/功法/法宝，5分钟缓存），妖兽/灵材/信物单独查询并按名去重。
4. 对名称（长度≥2）做子串匹配，命中即作为候选（人物上限12、其余上限8）。
5. 返回 `{characters, locations, skills, items, monsters, materials, dailyItems}`，每项为 `{id, name}[]`，已关联的实体自动剔除。

匹配结果仅为「建议」，需用户在弹窗中手动确认后才写入关联表。

### 8.5 一致性校验（validate，需求6）

`POST .../scenes/validate` 对一卷场景脚本做一致性深度校验，返回 `{valid, totalNodes, keyPlotCount, errorCount, warningCount, issues[]}`。每个 issue 形如 `{level, dimension, nodeId?, message}`，`level` 为 error/warning/info，`dimension` 为 timeline/location/structure/character/combat。`valid` 仅在无 error 级 issue 时为 true。

校验分五个维度：

- **时间线（timeline，硬校验）**：解析 `time_setting` 中的"第N日"（支持中文数字）与时段（清晨<上午<午时<午后<傍晚<深夜）。绝对日序倒流判为 **error**（如第2日场景排在第3日之后）；同日时段倒退判为 warning。提不到绝对日序时保守跳过，不误报。
- **地点跳转（location，粗粒度告警）**：取 `location_desc` 中"·"前的区域前缀（如"大竹峰·山门"→"大竹峰"），相邻场景跨区域时给 warning，提醒作者确认行程衔接。无地理坐标数据，故只做区域级粗粒度判断。
- **结构/节奏（structure）**：保留原有检查（关键剧情缺失/占比、空核心事件、缺地点、连续过渡、场景数量）。
- **人物出场（character，数据缺失提醒）**：当本卷场景无任何 `scene_node_character` 关联时，提示无法校验出场一致性（该关联表当前使用率低）。
- **战力（combat，暂不支持）**：`novel_character_lib.realm` 为无统一格式的自由文本，无结构化等级，故仅给 info 提示当前未启用。

人物出场与战力两维度因底层数据缺失（关联表空、修为无结构化）暂为提醒性质，待数据补齐后再升级为实质校验。本校验纯规则实现，不消耗 LLM token。

前端 `SceneOutlinePanel` 将校验结果渲染为右侧侧边栏：error/warning/info 三色图标区分、附维度标签，点击带 `nodeId` 的 issue 会滚动定位并高亮对应场景节点（2秒）。

### 8.6 保存时反写卷大纲（keyEvents 双向同步）

场景脚本节点若由卷大纲 keyEvents 导入（`metadata.fromKeyEvent=true`），其 `metadata.chapterNumber` 记录了对应的章节号。`PUT .../scenes/:sceneId` 保存节点后，自动调 `writeBackKeyEvent()`（`services/outline-writeback.ts`，与 6.9 剧情分支反写共用同一服务）把节点的最新 `title` / `coreEvent` 写回卷大纲 `story_outline.key_events` 中 `chapterNumber` 匹配的条目（`title`←节点标题、`intent`←节点核心事件），同样采用**覆盖更新+只备份一次原文**策略（`originalTitle`/`originalIntent`）。反写为 best-effort：包在 try/catch 中，失败仅 `console.warn` 不阻断场景保存；匹配不到对应章节号条目时静默跳过。由此实现"卷大纲 → 场景脚本"导入后，用户在场景脚本里的修改能回流到卷大纲，保持两层大纲一致。

---

## 9. 关键开发约定

### 9.1 字段名对齐规则

Drizzle Schema 的列名必须与 PostgreSQL 实际列名完全一致。创作库关键字段映射：

| 数据库列名 | Drizzle属性名 | 前端使用 |
|-----------|--------------|----------|
| volume_no | volumeNo | vol.volumeNo |
| chapter_no | chapterNo | ch.chapterNo |
| synopsis | synopsis | vol.synopsis |
| target_word_count | targetWordCount | ch.targetWordCount |
| emotion_target | emotionTarget | plan.emotionTarget |
| conflict_target | conflictTarget | plan.conflictTarget (int) |
| rule_content | ruleContent | rule.ruleContent |
| agent_name | agentName | log.agentName |
| current_step | currentStep | task.currentStep |
| is_current | isCurrent | chapter.isCurrent |
| task_id | taskId | chapter.taskId |

### 9.2 诛仙库查询注意

- `text[]` 数组列搜索：`sql\`${column}::text ILIKE ${'%' + kw + '%'}\``
- `lib_character_relation` 无 `is_deleted` 列，不要加该过滤条件
- 向量检索：`scene_emb <=> ${embedding}` 余弦距离，需 pgvector 扩展

### 9.3 环境变量加载

`env.ts` 必须作为 entry 第一行 import（`import './env.js'`），否则其他模块在 import 阶段读 `process.env` 时还是空的。

### 9.4 pnpm 构建脚本

pnpm v11 默认阻止依赖的构建脚本（ERR_PNPM_IGNORED_BUILDS），需在 `pnpm-workspace.yaml` 中声明：
```yaml
allowBuilds:
  esbuild: true
```

---

## 10. 部署与运维

### 10.1 开发模式

```bash
pnpm dev  # concurrently 启动前后端
```

后端使用 `tsx watch` 热重载，前端使用 Vite HMR。

### 10.2 生产构建

```bash
pnpm build
# 后端: tsc → dist/
# 前端: tsc + vite build → dist/
```

### 10.3 数据库初始化

创作库 Drizzle 定义的 48 张表（另含 Python 侧素材表）需预先创建。`start.bat` 会自动执行 `scripts/init-db.mjs`（如存在）；各增量模块 DDL 见 `scripts/ddl-*.sql`（均幂等）。

### 10.4 健康检查

```bash
curl http://localhost:3456/api/health
# → {"success":true,"data":{"status":"ok","timestamp":"...","uptime":...}}
```

### 10.5 前端功能补全（7.25 缺口修复）

基于后端15个路由+55张表 vs 前端12页面的对照审计，补全了15项前端缺失功能：

| 优先级 | 页面 | 功能 | 消费的后端接口 |
|--------|------|------|----------------|
| P0 | TimelinePage | 状态快照管理（查看/创建/编辑/确认） | stateApi.snapshots/create/update/confirm |
| P1 | SceneOutlinePanel | 场景关联管理（添加/删除节点关系） | scenesApi.relations/addRelation/removeRelation |
| P1 | SceneOutlinePanel | 伏笔提升（场景伏笔→伏笔台账） | foreshadowApi.promote |
| P1 | ChapterReader | 段落视角重写 | chaptersApi.rewritePerspective |
| P1 | SceneOutlinePanel | 编辑日志+回滚（含后端数据恢复） | scenesApi.editLogs/rollback |
| P1 | Settings | 文风预设展示 | settingsApi.getStylePresets |
| P1 | QuoteLibrary | 手动添加金句 | quotesApi.create |
| P2 | WorldBrowser | 全局搜索 | worldApi.search |
| P2 | OutlineEditor | 删除卷大纲 | outlinesApi.delete |
| P2 | RelationPanel | 编辑关系属性 | relationApi.update |
| P2 | GrowthWorkshop | 实体详情查看与编辑 | workshopApi.detail/update |
| P2 | ChapterReader | 文风校验历史记录浏览 | chaptersApi.getStyleAudits/getStyleAuditDetail |
| P2 | GenerationConsole | 单任务详情（日志时间线+结果） | generationApi.task |
| P3 | GenerationConsole | 桥段重复度告警面板 | SSE plot_duplication_warning |
| P3 | GenerationConsole | 章末钩子轮换提示 | SSE hook_rotation_warning（新增后端emit） |

后端变更：
- `scenes.ts`：rollback增强为完整数据恢复（删除新增节点→重插删除节点→逐字段恢复修改节点）
- `runner.ts`：hook_rotation检测新增 `emitEvent('hook_rotation_warning', rotation)` SSE下发
- `types.ts`：GenerationStreamEventType 新增 `'hook_rotation_warning'`

前端Hook变更：
- `useGenerationStream.ts`：新增 `plotDuplicationWarning` + `hookRotationWarning` 状态字段及SSE case处理

---

## 11. 文件清单

源文件规模（不含 node_modules/配置）：

- 后端 `packages/server/src` 共 113 个 TypeScript 文件：26路由（routers/） + 22Agent（agents/） + 31服务（services/，含 impact/ 子目录） + 11热点嗅探（hotspot/） + 8RAG（rag/） + 3DB + 3Pipeline + 4静态目录（data/：武器/功法/特质图鉴） + 1LLM + 1State + 根目录3个（index/types/env）
- 前端 `packages/web/src` 共 35 个 TS/TSX 文件：20页面（pages/） + 7组件（components/） + 2hooks + 其余为 lib/App/Main 等
- 共享包 `packages/shared/src` 共 6 个 TS 文件（含 custom-character/ 配置库）
- 配置文件 8 个（3 package.json + 3 tsconfig + vite.config + pnpm-workspace），另有 .env / start.bat / scripts/*.sql DDL 存档

---

## 12. 外部工具并入（热点嗅探 + 素材清洗）

两个原独立工具于 2026-07-29 并入本系统，均复用创作库 novel_studio 与既有 LLM/向量配置，不新建数据库。

### 12.1 热点嗅探（整体并入 monorepo）

抓热门榜单 → LLM 提炼剧情素材模板 → 推送入创作库素材四表（全局共享 project_id=NULL）。

- **后端**：`packages/server/src/hotspot/`（db/llm/crawler/analyzer + sources 适配器注册表，含番茄/纵横/晋江/起点四源，番茄带 PUA 字体反爬解码）。路由 `routers/hotspot.ts` 挂载 `/api/hotspot/*`，复用 `creativeClient.unsafe()` 执行原 $n 占位符 SQL。
- **表**：4 张 `hotspot_` 前缀表（crawl_batch/raw_novel/insight/push_log）已收进 `creative-schema.ts`（Drizzle 定义），DDL 存档 `scripts/ddl-hotspot.sql`（幂等）。
- **前端**：`pages/HotspotSniffer.tsx`（抓取榜单/榜单书目/灵感入库 三页签，共享批次），导航 `/hotspot`。
- **推送链路**：insight(encounter/foreshadow/highlight/task) → 映射 plot_material_* 四表，14 列字段映射 + 向量化（embedding_server 8600，不可达降级无向量入库）；trend 类型仅浏览不可推送。
- **关键约定**：CORS allowMethods 已补 PATCH（灵感状态更新用）；响应信封统一 `{success,data}`。

### 12.2 素材清洗（Python 旁路 + TS 管理界面）

蒸馏管线（BGE 向量化 + LLM 抽取）保留 Python 实现（`sucaiqingxi/`），本系统提供统一管理界面。

- **Python 旁路**：embedding_server.py（8600，bge-small-zh 512维）+ gui_server.py（8610，ETL 子进程编排 + 日志轮询）。启动：`cd sucaiqingxi && .venv\Scripts\python.exe gui_server.py`。
- **后端**：`routers/material-knowledge.ts` 挂载 `/api/material-kb/*`。style_preset / plot_domain_knowledge 浏览/搜索/详情/软删（直连创作库）；ETL 触发经 HTTP 代理转发 8610（`MATERIAL_GUI_URL` 可覆盖），服务离线返回 503 + 启动提示。
- **前端**：`pages/MaterialKnowledge.tsx`（文风预设/领域知识/蒸馏任务 三页签），导航 `/material-kb`。蒸馏任务支持 style/domain/material 三类、dry-run、实时日志增量轮询。
- **数据消费**：plot_material_* 与 plot_domain_knowledge 由 `rag/plot-material-retriever.ts` 向量召回注入写作上下文（既有能力，本次未改动）。

---

## 13. UI/UX 批量优化（2026-08-02）

基于外部 UI/UX 深度诊断报告，完成 26 项实施（63 项中筛选），分四梯队落地。

### 13.1 信息架构与导航

- **侧边栏分组**（App.tsx）：16 项平铺导航重构为 4 组（创作主线/世界搭建/叙事工程/素材配置），带组标题渲染。
- **待办中心**（新页面 `/todo`）：聚合超期伏笔（top5）、高优先级待处理、生成失败任务（最近5条）。后端 `GET /projects/:id/health/todo`。

### 13.2 生成控制台增强

- **参数透传修复**（P0-05）：startGenerationSchema 补齐 targetWords/temperature/autoRevise 顶层字段，zod 不再静默剥离。
- **高级参数模式**：折叠面板暴露 skipAudit + maxTokens（1000-16000），透传至 llmConfig。
- **生成前预览确认**：点击"开始生成"后弹出参数摘要 Dialog，确认后才入队。
- **文案修正**："生成日志"→"章节计划"、"温度"→"创造性（温度）"。

### 13.3 章节编辑器

- **查找/替换**：编辑模式下可展开查找替换工具栏，大小写不敏感匹配，支持单个/全部替换。
- **分支树视图**：左侧章节列表新增"平铺/分支树"切换，树视图按 branchParentChapterId 缩进渲染分支子章节。
- **质量审计手动触发**：`POST /chapters/:id/audit-quality` 端点 + 章节页"质量审计"按钮，调用现有 29 维 AuditorAgent。
- **布局调整**：阅读页三栏比例 3:6:3 → 3:5:4（分支面板加宽）。

### 13.4 伏笔系统

- **草蛇灰线检测引擎**：`GET /projects/:id/foreshadow/detection`，5 条纯规则（tier 分级超期/超过计划回收章/无埋设线索/高优先级滞留/同章密集埋设），零 LLM。前端可折叠面板按 severity 分组展示。
- **看板视图**：伏笔台账新增"列表/看板"切换，看板按 pending/planted/resolved/abandoned 四列静态分列。
- **回填按钮明显化**：从 ghost 小图标改为 outline 文字按钮"回填埋设"。

### 13.5 世界观浏览器

- **搜索修复**（P0-03）：后端返回 Record 对象，前端 flatten 为带 type 标签的数组。
- **人物出场章节**：`GET /projects/:pid/chapters/by-entity?entityId=&entityType=`，查 povCharacterIds + requiredEntityIds jsonb 包含关系。CharacterDetail 新增第 4 Tab"出场"。
- **关系图谱**：新 section"关系图谱"，`GET /world/graph?bookId=` 返回 nodes+links，前端 RelationGraph.tsx 纯 SVG 圆形布局渲染（无 D3 依赖），hover 高亮连线显示 relType。

### 13.6 大纲与时间线

- **天机推演**（剧情沙盒）：OutlineEditor 第 3 Tab，`POST /projects/:id/outlines/divine` 调用 LLM（temp 0.9）基于最近 5 章 + 主要角色生成 3 个未来走向（各含 2-3 章概要），正则解析结构化输出。
- **年鉴视图**：TimelinePage 第 3 Tab，将里程碑 + 人物快照按 chapterNo 合并为垂直时间轴编年史。

### 13.7 叙事体检

- **故事心电图**：`GET /projects/:id/health/score-trend` 查询 style_audit_record 按章排序，前端纯 SVG 折线图（无新依赖）展示文风质量趋势。
- **维度数修正**："6维度"→"9维度"。

### 13.8 三工坊（自定义功法）

- **复制创建**：功法卡片新增"复制"按钮，打开 ForgeDialog 预填全部字段（name 加"（副本）"后缀），走同一 create 路径。

### 13.9 素材知识库

- **检索测试台**：`POST /api/material-kb/recall-test`，输入查询词返回 RAG 召回结果 + 相似度分数。前端新增"检索测试"Tab。
- **术语通俗化**："dry-run"→"试跑模式"。

### 13.10 新增文件清单

| 文件 | 用途 |
|------|------|
| `packages/web/src/pages/TodoCenter.tsx` | 待办中心页面 |
| `packages/web/src/components/RelationGraph.tsx` | 关系图谱 SVG 组件 |

新增端点汇总：`GET health/todo`、`GET health/score-trend`、`GET chapters/by-entity`、`GET foreshadow/detection`、`POST outlines/divine`、`GET world/graph`、`POST material-kb/recall-test`、`POST chapters/:id/audit-quality`。

---

## 14. 架构升级 v1.3（2026-08-03，六个 P0 Epic）

依据《指尖仙侠-架构升级需求文档-v1.3（评审修订版）》落地全部 6 个 P0 Epic。

### 14.1 Epic1 管线节点化 + 断点续跑

- 新表 `pipeline_checkpoint`（见 §4.2）：每步骤一行，`step_order` 主管线 10-50、后验步骤 ≥100；`step_data` 存步骤产出供恢复。
- runner 每步执行前 upsert running、成功后 completed（update-then-insert，task_id 可空）。
- 重试机制 `reenqueueWithResume`：任务置 pending + `queue_options.resumeFrom` + `completedAt=null`（绕开退避），runner 启动时按 resumeFrom 定位首个未完成步骤，已完成步骤直接读 checkpoint.step_data 跳过。
- API：`GET /generation/tasks/:id/checkpoints` → `{mainSteps, checkpoints}`；`POST /generation/tasks/:id/retry` `{fromStep?}`（从指定步骤/失败步骤重跑）；`POST /generation/tasks/:id/skip-step`（跳过失败步骤继续）。
- 前端：GenerationConsole 任务详情弹窗步骤条，每主步骤带「从此重跑」；失败任务显示「从失败步骤重试」「跳过失败步骤」。

### 14.2 Epic2 后验更新独立工作流

- 原 postUpdate 逻辑拆为 `workflows/postUpdate.ts` 独立 10 步工作流（状态抽取/伏笔流转/因果链/时间线/金句/实体维护等），每步写 checkpoint（step_order ≥100）。
- `POST /api/projects/:pid/post-update` `{chapterPlanId?}` 手动触发（task_id 为空的独立 checkpoint 链）。
- `generation_config.autoPostUpdate` 配置项：关闭后生成完成不再自动跑后验，可前端手动补跑。
- 前端：completed 且有 chapterPlanId 的任务显示「补跑后验更新」按钮。

### 14.3 Epic3 独立润色

- `POST /api/projects/:pid/chapters/:cid/polish` `{level: light|medium|deep}`（`routers/polish.ts`）：不推进剧情，仅对当前版本做自审+定向修订；返回 `{originalText, polishedText, diff[{type:same/removed/added,text}], changedParagraphs, totalParagraphs, auditScore, aiFlavorReport, revisionNotes}`。
- 前端：ChapterReader 工具栏「润色」按钮 → `PolishModal.tsx`（级别三档、diff/全文切换视图、变更段数为0时禁用应用）；确认应用走既有 `PUT /chapters/:id/content`（版本自动递增），不新建 apply 端点。

### 14.4 Epic4 叙事债务仪表盘

- `services/narrativeDebt.ts` 聚合伏笔台账/因果链/任务链三表兑现进度：`healthScore = 100 - 逾期比例×60 - min(平均逾期章数,10)×3`；grade 分档 ≥85 excellent / ≥70 good / ≥50 warning / 其余 critical。
- `GET /api/projects/:pid/narrative-debt` 返回三表汇总 + healthScore/healthGrade + recommendations（按逾期程度与优先级排序）。接口形态预留 Epic9 世界状态总览复用。
- 前端：新路由 `/narrative-debt`（NarrativeDebtPage）——SVG 环形健康度仪表、三表债务卡片、回收建议列表（逾期项红框高亮），导航归入「叙事工程」组。

### 14.5 Epic5 项目导出/导入 zip

- **路由命名警示**：zip 导出路由为 `GET /api/projects/:pid/export-package`。不得使用 `/projects/:pid/export`——该路径已被 chapters.ts 既有整书 txt/md 导出占用，且 chaptersRouter 先于 exportRouter 注册，Hono 按注册顺序匹配会导致新路由永不可达。
- 导出含 manifest.json（format='novel-studio-export'）+ 世界观/人物/大纲/章节/状态等全量数据；导出侧每个查询以 `safe()` 容错包裹（缺失表/列 → 空数据 + warn，不阻断整包）。
- 导入：`POST /api/projects/import`（FormData field=file），单事务 13 步插入 + 旧→新 ID 重映射；`readJson` 带 ISO 日期 reviver（JSON 序列化把 Date 变字符串，drizzle timestamp 列插入需 Date 对象，否则 `toISOString is not a function`）。
- 跨库漂移场景（目标库缺表）导入会失败，同库往返安全——导入在单事务内无法逐表 catch。
- 前端：Dashboard 每项目卡片「导出」按钮（blob 下载）+ 顶部「导入项目」按钮（隐藏 file input，导入后刷新项目列表）。

### 14.6 Epic6 章节意图编辑

- 后端零改动：chapters.ts `PUT /chapters/:id` 的 `updateChapterSchema = createChapterSchema.partial()` 已接受 intent/emotionTarget/conflictTarget/mustHaveEvents/chapterType/pinnedMaterialIds/povCharacterIds 全部字段。
- 前端：OutlineEditor 卷展开后章节卡片新增「编辑章节意图」按钮（Edit2 图标），复用新建章节弹窗预填全部字段；编辑模式提交不带 outlineId/volumeNo/chapterNo。

### 14.7 新增端点与文件汇总

新增端点：`GET /generation/tasks/:id/checkpoints`、`POST /generation/tasks/:id/retry`、`POST /generation/tasks/:id/skip-step`、`POST /projects/:pid/post-update`、`POST /projects/:pid/chapters/:cid/polish`、`GET /projects/:pid/narrative-debt`、`GET /projects/:pid/export-package`、`POST /projects/import`。

| 文件 | 用途 |
|------|------|
| `packages/server/src/routers/polish.ts` | Epic3 独立润色路由 |
| `packages/server/src/routers/export.ts` | Epic5 导出/导入路由（safe() 容错 + 日期 reviver） |
| `packages/server/src/services/narrativeDebt.ts` | Epic4 叙事债务聚合 |
| `packages/server/src/workflows/postUpdate.ts` | Epic2 后验更新 10 步工作流 |
| `packages/web/src/pages/NarrativeDebtPage.tsx` | Epic4 仪表盘页面 |
| `packages/web/src/components/PolishModal.tsx` | Epic3 润色 diff 弹窗 |

DB 变更：`pipeline_checkpoint` 建表；补执行 `scripts/ddl-scene-branch.sql`（scene_node 补 node_type/branch_group_id/path_label，此前 schema 声明但库中缺列）。

---

## 15. 动态叙事引擎（v1.4，里程碑驱动 + 分支弧管理 + 自动收束）

源自外部 PRD《动态叙事引擎 v2.1》评审修订版。目标：将大纲从"逐章剧本"升级为"里程碑骨架"——里程碑定义"必须发生的事"，里程碑之间的内容由生成管线动态填充；分支走向升级为"分支弧"（有前提/核心冲突/预估长度/收束目标），硬限 5 章自动收束。

### 15.1 叙事里程碑（narrative_milestone）

**数据模型**（创作库，DDL 已执行）：`narrative_milestone` 表——`label`(varchar200)/`description`(text)/`must_happen`(jsonb 必须覆盖的事件点数组)/`key_character_ids`(bigint[] 关键人物)/`target_chapter_from`/`target_chapter_to`(integer 预估章节区间)/`status`(upcoming/active/reached/skipped)/`importance`(critical/major/minor)/`sort_order`(integer)/`outline_id`(FK story_outline 可空)。

**与 timeline_milestone 的区别**：`timeline_milestone`（模块11）记录故事世界时间线（"第3天·张小凡抵达青云"），是**世界内**时间事件；`narrative_milestone` 记录叙事骨架（"张小凡首次使用佛道双修击败对手"），是**作者视角**的剧情锚点，不绑定具体章号。两者共存互不干扰。

**后端**：
- `routers/narrative.ts`（挂载 `/api`，路径 `/projects/:pid/narrative/*`）：6 个里程碑端点——列表/从大纲抽取/排序/手动创建/更新/删除。
- `services/milestone-service.ts`：`extractMilestonesFromOutlines(projectId, outlineId?)` 从卷大纲 keyEvents 幂等抽取（每卷首/末 keyEvent 标 critical，其余 major）；`getNextMilestone()` 取首个 upcoming/active 里程碑供 Writer/Auditor 双轨注入；`getLastReachedMilestone()` 取最后已到达里程碑作为分支弧默认源里程碑。
- **Writer 双轨注入**（`agents/writer.ts`）：主线章注入【里程碑方向】块（下一个 mustHappen 事件点 + 关键人物）；分支章注入【分支弧状态 + 里程碑方向】；收束章注入三轨（弧进展 + 里程碑 + 收束意图）。
- **Auditor 接入**：审计维度增加里程碑覆盖检查——critical 里程碑未被任何章节覆盖报 major。

**前端**：`OutlineEditor.tsx` 新增"里程碑"Tab——时间线展示（按 sortOrder 排序）、拖拽排序、添加/编辑/删除弹窗、critical 里程碑金色标记。`POST /narrative/milestones/extract` 一键从卷大纲抽取。

### 15.2 分支弧管理（branch_arc）

**数据模型**：`branch_arc` 表——`source_chapter_id`(FK chapterPlan 分支来源章)/`source_milestone_id`(FK narrativeMilestone 源里程碑)/`title`/`premise`(text 分支前提假设)/`branch_type`(approach/consequence/detour/divergence)/`estimated_length`(integer 预估长度默认2)/`status`(active/converged/abandoned)/`converge_to_milestone_id`(FK narrativeMilestone 收束目标)/`converged_at_chapter`(bigint 收束时章号)/`new_elements`(jsonb 分支中发现的新元素 {characters,locations,foreshadows,items})/`state_snapshot`(jsonb 分支开始时的状态快照)。

**chapter_plan 扩展**：+2列 `branch_arc_id`(FK branch_arc) + `is_convergence`(boolean 默认false 收束过渡章)。

**chapter_branch_option 扩展**：+4列 `branch_premise`(text)/`estimated_length`(integer 默认2)/`core_conflict`(text)/`converge_to_milestone_id`(FK narrativeMilestone)。optionType 语义扩展：normal→approach 语义、encounter→consequence 语义，新增 detour/divergence。

**后端**：
- `routers/narrative.ts`：8 个分支弧端点——列表/详情(含进度)/手动收束/豁免延长(+2章上限7)/放弃(状态回滚)/提升分支元素到主线/重写日志/回滚重写。
- `services/branch-arc-service.ts`：`createArcFromOption()` 选定分支时自动创建弧（幂等，同源章复用已有 active 弧）；`getArcWithProgress()` 返回弧+进度（章节列表/进度数/硬限/是否到达硬限/是否应收束）；`extendArc()` 一次性+2章（上限 ARC_ABS_LIMIT=7）；`abandonArc()` 放弃弧并调 `rollbackBranchImpacts` 回滚影响；`promoteElement()` 提升分支发现元素到主线（伏笔→isConfirmed+high priority，人物/地点→entityStatus='official'，任务→isConfirmed+high）。
- **硬限规则**：ARC_HARD_LIMIT=5（分支弧最多5章），到达硬限时提示收束而非自动继续；一次性豁免延长至多+2章（上限7）。
- **管线接入**（`pipeline/runner.ts`）：选定分支后 `createArcFromOption()` 创建弧；`maybeAutoConverge()` 在章节生成后 best-effort 探测——弧进度≥estimatedLength 且<5 时自动触发收束，到达硬限5时返回提示不强制。

### 15.3 自动收束引擎（convergence-engine）

**核心函数** `convergeArc(arcId, opts?)`（`services/convergence-engine.ts`）：
1. 收集弧编年（分支链所有章节标题/意图）+ new_elements + 目标里程碑 mustHappen
2. LLM 生成收束计划（ConvergencePlan）：一章收束过渡章（title+intent）+ 后续章节计划重写列表（每条 {planId, title, intent}）
3. 事务内执行：创建收束过渡章（is_convergence=true）+ 重写后续 chapterPlan（before/after 快照写入 `plan_rewrite_log`）
4. 反写卷大纲 keyEvents（收束章对应 chapterNumber 条目）
5. 目标里程碑 status 置 active

**重写审计**：`plan_rewrite_log` 表记录每次收束重写的 before_snapshot/after_snapshot（jsonb），支持 `rollbackArcRewrites(arcId)` 全量回滚（恢复所有 before 快照，标记 rolledBack=true，弧状态回 active）。

**前端**：`ChapterReader.tsx` 分支面板——弧进度条（当前章数/预估长度/硬限标记）+ 收束提示（到达硬限时显示"建议收束"按钮）+ 手动收束/延长/放弃/提升按钮。收束重写日志查看弹窗。

### 15.4 planRewriteLog 表

`plan_rewrite_log`——`project_id`/`branch_arc_id`(FK set null)/`action`(varchar20 默认'convergence')/`plan_id`(bigint 章节计划ID)/`before_snapshot`(jsonb)/`after_snapshot`(jsonb)/`rolled_back`(boolean 默认false)/`created_at`。

### 15.5 新增端点汇总

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/projects/:pid/narrative/milestones | 里程碑列表 |
| POST | /api/projects/:pid/narrative/milestones/extract | 从卷大纲抽取里程碑 |
| POST | /api/projects/:pid/narrative/milestones/reorder | 批量排序 |
| POST | /api/projects/:pid/narrative/milestones | 手动创建里程碑 |
| PUT | /api/projects/:pid/narrative/milestones/:mid | 更新里程碑 |
| DELETE | /api/projects/:pid/narrative/milestones/:mid | 删除里程碑 |
| GET | /api/projects/:pid/narrative/arcs | 分支弧列表 |
| GET | /api/projects/:pid/narrative/arcs/:aid | 弧详情+进度 |
| POST | /api/projects/:pid/narrative/arcs/:aid/converge | 手动触发收束 |
| POST | /api/projects/:pid/narrative/arcs/:aid/extend | 豁免延长+2章 |
| POST | /api/projects/:pid/narrative/arcs/:aid/abandon | 放弃弧（状态回滚） |
| POST | /api/projects/:pid/narrative/arcs/:aid/promote | 提升分支元素到主线 |
| GET | /api/projects/:pid/narrative/arcs/:aid/rewrite-logs | 重写审计日志 |
| POST | /api/projects/:pid/narrative/arcs/:aid/rollback | 回滚收束重写 |

### 15.6 新增文件清单

| 文件 | 用途 |
|------|------|
| `packages/server/src/routers/narrative.ts` | 里程碑+分支弧路由（14端点） |
| `packages/server/src/services/milestone-service.ts` | 里程碑管理（抽取/CRUD/查询） |
| `packages/server/src/services/branch-arc-service.ts` | 分支弧生命周期（创建/进度/延长/放弃/提升） |
| `packages/server/src/services/convergence-engine.ts` | 自动收束引擎（LLM收束计划+重写+回滚） |

DB 变更：`narrative_milestone` 建表 + `branch_arc` 建表 + `plan_rewrite_log` 建表；`chapter_plan` +2列（branch_arc_id/is_convergence）；`chapter_branch_option` +4列（branch_premise/estimated_length/core_conflict/converge_to_milestone_id）。创作库 Drizzle 表增至 48 张。

---

## 16. 五模块体验优化（v1.4，US-18~US-22）

源自外部 PRD《五模块体验优化 v1.4》评审修订版。5 个用户体验改进点，涉及众生百态/铸器天工/道法自然/征途录/时间线。

### 16.1 US-18 众生百态——一键补全对白风格

**后端**：`POST /api/projects/:projectId/custom-characters/:id/auto-voice`（`routers/custom-characters.ts`）。读取人物完整信息，调用 `services/ux-gen.ts` 的 `autoVoice()`（flash 模型，超时30s），LLM 根据人物性格/身份/背景生成 6 个声音配置字段（speechStyle/catchphrases/addressHabit/toneBase/exampleQuotes/forbiddenExpressions），**结果不落库**——前端填充表单供用户审阅后手动保存。

**前端**：`CharacterGallery.tsx` 声音配置区"一键补全"按钮（魔法棒图标），无论 draft/official 状态均显示；点击后 loading→填充表单→用户手动保存。

### 16.2 US-19 铸器天工——体验优化

- **19a 编辑按钮**：武器卡片底部操作区新增"编辑"按钮（与"详情"并列），点击打开编辑弹窗（复用创建弹窗预填数据）。
- **19b 弹窗布局**：创建弹窗从 `max-w-5xl` 收窄至 `max-w-2xl`，单列布局。
- **19d 去铁匠铺味**：纯文案替换（无视觉动画），"基础材质"→"主材"、"辅助材料"→"辅材"等修仙化表述。

### 16.3 US-20 道法自然——体验优化

- **20a 按钮位置**：卡片底部操作区顺序修正为【详解】【详情】【复制】【删除】。
- **20b 物理术语隐晦化**：九大本源道则前端显示仙侠名+仙侠描述（如"庚金道则→锋锐之本，主杀伐"），物理本质（"强相互作用"）仅在 tooltip 中以"道则真意"隐晦展示（如"万物至坚至锐之理"）。后端 `DAO_RULES` 的 `essence` 字段保留不变，前端新增 `xianxiaDesc` 映射。
- **20c 道则组合化学反应**：选择主+辅道则后，界面实时显示兼容/冲克效果——高兼容金色边框+仙侠文案（如"电蚀相生"）、对冲红色边框+警告文案（如"锐重相冲"）、中兼容蓝色边框+平静文案。36 对组合前端预映射文案。
- **20d 反噬代价动态生成**：`POST /api/projects/:id/custom-techniques/:tid/generate-backlash`（`routers/custom-techniques.ts`），调用 `services/ux-gen.ts` 的 `generateBacklashText()`（flash 模型），根据道则组合+行功路线+兼容度动态生成反噬描述，每个功法独一无二。
- **20e 运用方向 LLM 生成**：`POST /api/projects/:id/custom-techniques/:tid/generate-dao-insights`，调用 `generateDaoInsights()`（flash 模型），根据道则组合生成 3-5 个"天机独悟"运用方向（各含名称+描述），与既有 12 个 CORE_TRAITS（标为"基础方向"）并列展示。

### 16.4 US-21 征途录——自动数据填充

**StateExtractorAgent 扩展**（`agents/extractor.ts`）：抽取输出从 3 类（characters/timeline/memories）扩展为 4 类——新增 `tasks` 数组（`ExtractedTask` 接口：title/description/characterNames/taskType[main/side/hidden/fortune]/status[progressing/completed/failed/pending]/priority[high/normal/low]）。prompt 新增任务抽取指令："收录本章明确写到的角色任务/委托/使命/誓言/目标"。

**落库**：抽取结果中的 tasks 经名字→ID 解析后写入 `task_arc` 表，status 为 `auto_confirmed`（与 characters/timeline 一致）。前端 `TaskLedger.tsx`（征途录）自动提取的任务标"AI"标签，支持确认/否决交互。

### 16.5 US-22 时间线/状态快照数据显示修复

**根因**：代码 `store.ts:546,564` 写入 `status: 'auto_confirmed'` 正确，但历史数据在代码变更前已插入为 `pending`。无代码 bug，仅需一次性迁移。

**迁移脚本**：`UPDATE character_state_snapshot SET status='auto_confirmed' WHERE source='auto' AND status='pending'`；`UPDATE timeline_milestone SET status='auto_confirmed' WHERE source='auto' AND status='pending'`。前端默认显示所有非 rejected 状态数据，迁移后立即可见。

### 16.6 新增文件

| 文件 | 用途 |
|------|------|
| `packages/server/src/services/ux-gen.ts` | 五模块体验优化 LLM 生成服务（autoVoice/generateBacklashText/generateDaoInsights，flash 模型，超时30s） |

---

## 17. 双引擎工坊（v1.5，PRD v1.3）

场景级对白与冲突的专业工坊：**冰山台词引擎**（真相层→表面层→行为层）× **冲突引擎**（欲望→阻力→代价），两引擎产物可五步组合成完整戏文，另有独立质量体检与大纲联动预填。

### 17.1 后端分层

| 文件 | 职责 |
|------|------|
| `routers/dual-engine.ts` | 挂 `/api/v1/*`，7 端点；zod 参数校验；EngineError 统一错误响应（code+error+details） |
| `services/dual-engine/schemas.ts` | 全部 zod 请求/响应 schema |
| `services/dual-engine/errors.ts` | EngineError 错误码定义（INVALID_CONFIG/LLM_UNAVAILABLE/LLM_OUTPUT_PARSE_ERROR/VALIDATION_FAILED 等） |
| `services/dual-engine/types.ts` | 领域类型（冰山三层/冲突三元组/情绪曲线参数） |
| `services/dual-engine/iceberg.ts` | 冰山台词编排（真相→表面→行为，分层留痕 executed_steps） |
| `services/dual-engine/conflict.ts` | 冲突方案编排（欲望→阻力→代价 + 七寸映射 + 情绪曲线 expectation_peak/suppression_depth/drop_amplitude/cost_weight） |
| `services/dual-engine/composer.ts` | 五步组合成戏编排 |
| `services/dual-engine/quality.ts` | 产物质量体检打分（quality_score） |
| `services/dual-engine/outline-mapping.ts` | 大纲场景→冲突草案映射（预填） |
| `agents/conflict-generator.ts` | ConflictGeneratorAgent（冲突方案 LLM 生成） |
| `agents/iceberg-dialogue.ts` | IcebergDialogueAgent（冰山三层对白 LLM 生成） |
| `data/desire-resistance-mapping.ts` | 欲望-阻力静态映射库（零 token） |
| `data/behavior-anchors.ts` | 行为锚点静态库（零 token） |

### 17.2 错误契约

| 状态码 | 场景 |
|------|------|
| 400 INVALID_CONFIG | zod 校验失败，details 返回字段级明细 |
| 404 | 大纲/场景/预填源不存在 |
| 422 LLM_OUTPUT_PARSE_ERROR | LLM 输出解析失败 |
| 429 | 限流 |
| 502 LLM_UNAVAILABLE | LLM 服务不可达 |
| 200 + VALIDATION_FAILED | 体检不达标（业务态，非错误） |

### 17.3 前端

- `pages/DualEngineWorkshop.tsx`：路由 `/dual-engine`，三页签 IcebergPanel/ConflictPanel/ValidatePanel。
- 大纲场景入口经 `location.state.conflictDraft` 传预填数据，进入工坊自动切冲突页签。

---

## 18. 叙事事实自动回流与硬性事实校验（v1.5）

### 18.1 rag/fact-checker.ts（零 token 确定性规则）

对正文做三类硬性事实矛盾检测，`FactViolation { type, severity, message, excerpt }`：

| 类型 | 规则 |
|------|------|
| `pronoun_gender` | 代词他/她与人物设定性别矛盾 |
| `time_number` | 中文数字时间表述矛盾（CN_DIGITS 中文数字转换） |
| `realm_mismatch` | 境界描述与 REALM_HIERARCHY 境界序列矛盾（倒退/越级） |

导出 `buildQuoteRanges`/`isIndexQuoted` 辅助函数供引用区间判定；全程纯规则零 LLM，符合降级红线（失败不阻断）。

### 18.2 实体管线跨章事实冲突（15-SRS P2-1）

`services/custom-entity-pipeline.ts` 新增 `EntityConflict` 检测：

| 类型 | 含义 |
|------|------|
| `realm_regression` | 人物境界较台账历史倒退 |
| `item_vanished` | 已持有武器/法宝在后续章节消失 |

配置接口 `EntityMaintainConfig { enabled, sensitivity, extractWeapons, extractTechniques, extractLocations }`。

---

## 19. 大纲生成模式归一化（v1.5）

将原独立雪花法路由归一到 `outlines.ts`，单入口双模式：

- **REQ-1 公共服务抽取**：`buildOutlineContext`（上下文构建，资产块范围 all/chars-locations）与 `saveOutlineVolumes`（统一落库：characterArcs/pinnedMaterialIds/requiredEntityIds/povCharacterIds 全齐）导出为公共服务，one-shot 与 stepwise 共用。
- **REQ-2 mode 分流**：`POST /projects/:id/outlines/generate` 新增 `mode: z.enum(['one-shot','stepwise']).default('one-shot')`——缺省 one-shot 零回归；stepwise 必带 `step(2|3|4|5)` 按步注入（step3 注入完整人物库，step4/5 注入资产+分支链+素材）。
- **草稿续进**：`GET/PUT /projects/:id/outlines/stepwise-draft`（承接原 `snowflake_draft` 字段，旧草稿可续进，语义迁移自已删除的 snowflake.ts 路由）。
- **同构落库**：`POST /projects/:id/outlines/finalize` 走与 one-shot 相同的 `saveOutlineVolumes` 路径（含章节计划物化与回标），完成后清空草稿。
- **前端**：`WorldAssetPicker` 抽为共享资产勾选组件；`SnowflakeWizard` 支持 `embedded` 内嵌模式嵌入生成弹窗；snowflake 路由已删除（index.ts 注释留痕）。

---

## 20. 章节阅读页工具栏优化（v1.5，18-SRS 方案C）

ChapterReader 结构重构：

- **右栏双 Tab**：`rightTab: 'branch' | 'analysis'`——剧情分支 Tab 与章节分析 Tab 并列。
- **分析工具内联**：`analysisTool: 'style' | 'wordfreq'`，文风审计与词频分析迁至右栏分析 Tab；词频支持本章/全书两种统计范围。
- **顶部精简**：顶部工具栏从 10 按钮精简 6 元素，审计/润色入口迁右栏，阅读主区干扰最小化。

---

## 21. 对标素材库·拆文（v1.5）

- **数据层**：`plot_material_benchmark` 表（Python 侧素材库，原生 SQL 直连），四类 `character/plot_unit/style/setting`。
- **服务层**：`services/benchmark.ts`——拆文入库（部分失败不影响已成功部分）、embedding 失败记 null 不阻断入库、置顶 pin 标记。
- **路由层**：`routers/benchmark.ts` 挂 `/api`，5 端点（列表/添加/软删/置顶/analyze 拆文）。
- **写作召回降级链**：context-builder 取对标素材按 `pinned 强制注入 > 语义召回 > 关键字召回` 三级降级；embedding 服务不可达自动降级关键字；无对标素材不阻塞写作（best-effort）。
- **前端**：素材知识库 `/material-kb` 新增对标素材页签（MaterialKnowledge 扩展为五页签），拆文分析弹窗：书名 + ≥100字文本 → LLM 拆四类。
- **配套修复**：蒸馏任务页签黑屏——Python `/api/tasks` 返回 `{tasks:[...]}`，前端 api.ts `etlTasks` 拍平为数组。

---

*文档生成时间：2026-07-25（最近更新：2026-08-07，v1.5 五项更新文档化：§17 双引擎工坊（7端点+2新Agent+8服务文件+2静态数据库）/ §18 叙事事实回流与硬性事实校验（fact-checker 零token 三类矛盾检测+实体管线 EntityConflict）/ §19 大纲生成模式归一化（one-shot/stepwise 单入口+stepwise-draft/finalize，删 snowflake 路由）/ §20 章节阅读页工具栏优化方案C（右栏双Tab）/ §21 对标素材库·拆文（plot_material_benchmark+召回降级链+五页签）；路由文件增至 28+ 个（+dual-engine.ts/benchmark.ts），Agent 文件 24 个（+conflict-generator/iceberg-dialogue）。此前 2026-08-05：v1.4 两大新增功能文档化：§15 动态叙事引擎（里程碑驱动+分支弧管理+自动收束引擎，3新表+16端点+4新服务）/ §16 五模块体验优化（US-18一键补全对白/US-19铸器天工优化/US-20道法自然优化/US-21征途录自动提取/US-22数据迁移）；创作库 Drizzle 表增至 48 张（+narrative_milestone/branch_arc/plan_rewrite_log）。此前 2026-08-03：架构升级 v1.3 六个 P0 Epic 落地，见 §14）*
*项目路径：K:\xiaoshuochaijie\zwrite\XianxiaForge\*
