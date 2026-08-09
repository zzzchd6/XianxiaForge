# 架构与数据流

> 配套文档：`XianxiaForge-技术手册.md` §2（项目结构）、§5（后端架构）、§6（多 Agent 管线）、§8（场景脚本编排）；`指尖仙侠-功能手册.md` §2（核心关联关系图）

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│ 前端 packages/web (React 19 + Vite 6 + TailwindCSS)          │
│  Dashboard / OutlineEditor / GenerationConsole / ChapterReader│
│  WorldBrowser / 工坊系列 / 伏笔台账 / 山河舆图 / ProjectWizard ... 22 页面 │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTP (REST) + SSE（生成过程流式推送）
                │ Vite proxy: /api → localhost:3456
┌───────────────▼─────────────────────────────────────────────┐
│ 后端 packages/server (Hono 4.6, 端口 3456)                   │
│  ┌─────────────┐ ┌────────────────────────────────────────┐ │
│  │ routers/    │ │ services/  业务逻辑（纯函数/确定性规则）  │ │
│  │ 34 个路由    │ │ agents/    25 个 Agent（LLM 调用）       │ │
│  │ 225+ 端点   │ │ rag/       检索器 + 上下文编排 + 文风引擎 │ │
│  └──────┬──────┘ │ pipeline/  管线编排器 + DB 任务队列      │ │
│         │        │ state/     全局状态存储（快照/时间线）    │ │
│         └────────┴────────────────────────────────────────┘ │
└───────────────┬─────────────────────────────────────────────┘
                │ 双库联动（Drizzle ORM）
     ┌──────────┴──────────┐
     ▼                     ▼
┌──────────────┐    ┌─────────────────┐
│ 诛仙库 novel_db │    │ 创作库 novel_studio │
│ 只读 RAG 源     │    │ 读写项目数据        │
│ 18 核心表/     │    │ Drizzle 56 表       │
│ pgvector 512维  │    │ 项目/大纲/章节/     │
│ (WS0 起 user 书 │    │ 任务/状态/伏笔/     │
│  可写，system 书│    │ 影响/因果/工坊/地图 │
│  只读保护)      │    └─────────────────┘
└──────────────┘
```

## 核心数据流（章节生成管线）

> 当前代码为 **5 个 checkpoint 主步骤**（`pipeline/runner.ts` + `pipeline/checkpoint.ts`，`step_order` 10-50，v1.3 节点化断点续跑后）。早期功能手册的"8 步流程"是节点化之前的旧版描述，已过时。

```
用户创建项目/大纲/章节计划
        │
        ▼
章节计划 (chapter_plan) 入队 generation_task (status=pending)
        │  ← DB 即队列：worker 每 2s 轮询，原子认领（UPDATE...WHERE status='pending' RETURNING）
        ▼
[step1_build_context (10)] 构建上下文 ContextPackage
    ├ RAG 检索诛仙库设定（人物/门派/地点/功法/法宝 + 蒸馏/心智模型）
    ├ 创作库状态：快照/时间线/伏笔/影响/因果/成长阶段/自定义实体/收藏金句/声音配置
    ├ 文风指令 + 作者规则 + 前文摘要 + 分支上下文 + 素材召回（语义+确定性合并）
    └ trimToTokenBudget 按 token 预算裁剪（estimateTokens 中文约 1.5 字/token）
        │
        ▼
[step2_writer (20)] WriterAgent 写作（温度 0.85，maxTokens 16384）
        │
        ▼
[step3_audit_revise (30)] 本地预校验 + 审计回炉 + 禁用词复核 + 精修压缩
    ├ 本地质量预校验（确定性零 LLM）→ critical 先行修订
    ├ AuditorAgent 30 维审计 + 加权计分
    ├ 不达标 → ReviserAgent 六层修订 → 重新审计（回炉循环）
    └ 达标 → 精修压缩 + 禁用词扫描
        │
        ▼
[step4_save_result (40)] 保存正文版本 generated_chapter（版本+1）→ 章节计划置 generated
        │
        ▼
[step5_post_update (50)] 后置处理链（委托 workflows/postUpdate.ts 独立 10 步工作流，best-effort 不阻断）
    ├ 状态抽取（人物状态/时间线/任务，pending 待确认）
    ├ 伏笔自动流转 + 桥段重复扫描 + 钩子轮换检测 + 因果逾期过期（零 LLM 确定性）
    ├ 自动生成分支选项（2-4 个走向）
    ├ 金句质量管线（提取→去重→评审→美化→入库，异步）
    └ 实体自动维护（新人物/武器/功法/地点草稿 + 老实体动态）
        │
        ▼
完成任务，SSE 推送 complete
```

### 分支选定下游链（最关键的跨模块联动）

```
选定分支选项 → 事务内：a 衍生下一章计划（继承卷号/POV/实体下发）
                        b 反写卷大纲 keyEvents
                        c 影响体系应用（回滚上次 pending → 按主方向映射）
事务提交后异步：d 分支衍生伏笔抽取（LLM，待确认）
                e 因果链自动埋因（规则保底 + LLM 增强）
                f 创建/复用分支弧（动态叙事引擎，v1.4）
```

### 方向—影响—因果三角联动

```
方向字典(DIRECTION_CATALOG 10类41方向)
   ├─ MODULE_IMPACT_MAP → 影响体系（方向→影响自动映射）
   ├─ CATEGORY_CAUSE_MAP → 因果链（方向→causeType 推断）
   └─ LLM 打标 + 规则兜底 ← 分支生成
影响体系 IMPACT_DIRECTION_RULES → 影响→方向弱推荐（回环）
```

## 目录结构说明

```
XianxiaForge/                          # monorepo 根
├── package.json                       # scripts: dev / build / db:init
├── pnpm-workspace.yaml                # packages/*
├── .env / .env.example                # 双库连接 + LLM 配置
├── start.bat                          # Windows 一键启动
├── scripts/                           # init-db.mjs、ddl-*.sql（幂等增量 DDL）
└── packages/
    ├── shared/src/                    # 前后端共享类型（含 custom-character 配置）
    ├── server/src/
    │   ├── env.ts                     # 环境变量加载（必须最先 import）
    │   ├── index.ts                   # Hono 服务入口（CORS/日志/耗时中间件）
    │   ├── db/                        # 双库连接 + zhuxian-schema + creative-schema
    │   ├── llm/client.ts              # OpenAI-compatible 客户端（流式/非流式/主备切换）
    │   ├── rag/                       # retriever / context-builder / style 文风引擎 + ai-flavor-detector / conflict-score / continuity-scanner / fact-checker / plot-material-retriever / quality-gate
    │   ├── agents/                    # 24 个 Agent（base/writer/auditor/reviser/extractor/branch/branch-foreshadow-extractor/causal-extractor/style-auditor/growth/naming/weapon-lore/weapon-sense-card/trait-naming/technique-lore/technique-variant-lore/character-martial-lore/world-entity-extractor/forge-smart-match/custom-entity-extractor/quote-judge/quote-polisher/conflict-generator/iceberg-dialogue）
    │   ├── services/                  # 确定性业务逻辑（健康体检/方向/影响/因果/工坊/地图/金句/淘宝/模块文件IO等 40+ 个；v1.5 新增 dual-engine/ 子目录（8文件）与 benchmark.ts）
    │   ├── state/store.ts             # 全局状态存储（快照/时间线/前文摘要）
    │   ├── pipeline/                  # runner 管线编排 + queue DB 任务队列 + checkpoint 断点 + quote-extractor
    │   ├── workflows/postUpdate.ts    # 后验更新独立工作流（step_order≥100，v1.3 Epic2）
    │   ├── hotspot/                   # 热点嗅探（抓榜单→LLM→素材库）
    │   ├── data/                      # weapon-catalog / trait-directions / technique-catalog / trinket-catalog / desire-resistance-mapping / behavior-anchors（静态词条库，v1.5 +双引擎知识库）
    │   └── routers/                   # 34 个路由文件（每模块一个；v1.5 +dual-engine.ts/benchmark.ts，删 snowflake.ts）
    └── web/src/
        ├── main.tsx / App.tsx         # 路由布局（21 页面，v1.5 +双引擎工坊 /dual-engine）
        ├── lib/api.ts                 # API 客户端（统一信封解包）
        ├── hooks/                     # useProjects / useGenerationStream(SSE)
        ├── components/                # ui.tsx 组件库 + 各业务组件
        └── pages/                     # 21 个页面
```

## 关键设计决策

| 决策 | 原因 |
|------|------|
| **双库联动**（诛仙库只读做 RAG + 创作库读写） | 世界观知识源与创作资产分离：诛仙库是"设定事实"（含 512 维向量），创作库是"创作过程"。诛仙库升级 WS0 后 system 书仍只读保护，user 书可写；RAG 检索与生成管线当前锁定 bookId=1 |
| **DB 即队列**（generation_task 表 + 轮询 worker） | 无 Redis 依赖，任务持久化在 PostgreSQL，服务重启不丢任务；`UPDATE...WHERE status='pending' RETURNING` 原子认领防重复执行；`QUEUE_CONCURRENCY` 控制并发（默认 1=顺序，保证后章吃到前章摘要） |
| **pnpm monorepo** | 前后端共享 TypeScript 类型（packages/shared），`pnpm dev` 一键启动两端，构建顺序受控（shared → server → web） |
| **pgvector 混合检索** | 场景向量（scene_emb 512 维，余弦距离 `<=>`）+ 结构化 SQL（ILIKE/字段过滤）双路召回，兼顾语义相似与精确设定 |
| **确定性校验约束 LLM** | 品阶-特效稀有度约束、副作用绑定、禁用词扫描、方向互斥等一律由规则代码把关——LLM 只负责生成/判断，不负责"守规矩"（零 token、零误判） |
| **best-effort 降级红线** | 所有增强能力（后置处理/金句/实体维护/瞬移预警等）失败时静默降级为空并记 generation_log，绝不阻断生成主流程 |
| **版本制 + 永不覆盖原文** | 所有 AI 修订（对话修订/视角重写/文风修订/润色）先返回预览，用户确认后经 `PUT /chapters/:id/content` 存为新版本，可回退 |
| **双引擎工坊分层**（v1.5） | `services/dual-engine/*` 8 文件分层（schemas/errors/types/iceberg/conflict/composer/quality/outline-mapping）+ `/api/v1/*` zod 校验 + EngineError 统一错误码；欲望-阻力映射与行为锚点为静态零 token 知识库；两引擎产物可五步组合成戏、独立体检 |
| **对标素材召回降级链**（v1.5） | benchmark 素材按 `pinned 强制注入 > 语义召回 > 关键字召回` 三级降级；embedding 服务不可达自动降级关键字；无对标素材不阻塞写作（延续 best-effort 红线） |
| **大纲单入口双模式**（v1.5） | outlines/generate 的 mode 缺省 one-shot 零回归，stepwise 承接雪花法；公共服务 buildOutlineContext/saveOutlineVolumes 两模式共用，finalize 同构落库 |
