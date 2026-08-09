# 待办与路线图（TODO）

> 当前版本：**v1.5**（2026-08-07）。本文档数据来源：《指尖仙侠-架构升级需求文档-v1.0》（`docs/` 目录）、《XianxiaForge-技术手册.md》§14-§21、`指尖仙侠-功能手册.md` §3.28-§3.31。
> 阅读本文档可了解项目"接下来要做什么"，便于规划任务优先级。

## 近期已完成

### v1.3（2026-08-03，架构升级六个 P0 Epic）
- [x] **Epic1 管线节点化 + 断点续跑**：`pipeline_checkpoint` 表，主管线步骤 10-50 / 后验 ≥100，失败可从指定步骤重跑/跳过
- [x] **Epic2 后验更新独立工作流**：`workflows/postUpdate.ts` 10 步工作流，可手动补跑（`generation_config.autoPostUpdate` 可关）
- [x] **Epic3 独立润色**：`POST /chapters/:cid/polish`，light/medium/deep 三档，diff 预览确认后存新版本
- [x] **Epic4 叙事债务仪表盘**：`services/narrativeDebt.ts` 聚合伏笔/因果/任务链，healthScore 分档
- [x] **Epic5 项目导出/导入 zip**：`/export-package` + `POST /projects/import`（单事务 13 步 + ID 重映射）
- [x] **Epic6 章节意图编辑**：复用创建弹窗预填全部字段编辑章节计划

### v1.4（2026-08-05）
- [x] **动态叙事引擎**（模块28）：叙事里程碑（作者视角剧情锚点）+ 分支弧管理（硬限 5 章，豁免 +2）+ 自动收束引擎 + 计划改写日志/回滚
- [x] **五模块体验优化**（US-18~US-22）：众生百态一键补全对白风格 / 铸器天工体验优化 / 道法自然体验优化（道则化学反应、反噬动态生成、运用方向 LLM 生成）/ 征途录自动任务提取 / 时间线数据迁移
- [x] **角色心智与信息差**（v1.4 PRD-A，代码已实现、功能手册未收录）：角色声音配置 / 已知信息清单 / 记忆卡三表 + 上下文三层注入 + 认知越界审计
- [x] **叙事技法库**（代码已实现、功能手册未收录）：technique_atom 技法原子 + 章节技法关联 + 双维信息点，`/api/techniques/*`
- [x] **淘宝系统**（代码已实现）：十连 hunt、小物+秘宝、五阶解锁、打眼、秘宝转正式武器/功法
- [x] 山河舆图（v1.3 起）、金句库质量升级与智能美化（五维评审+三档美化+回写正文）、实体自动维护（草稿转正闭环）

### v1.5（2026-08-07）
- [x] **双引擎工坊**（模块29，PRD v1.3）：冰山台词引擎（真相→表面→行为）× 冲突引擎（欲望→阻力→代价+七寸映射+情绪曲线）+ 五步组合成戏 + 独立质量体检 + 大纲联动预填；`/api/v1/*` 7 端点 + ConflictGeneratorAgent/IcebergDialogueAgent + `services/dual-engine/*` 8 服务文件 + 2 静态知识库（desire-resistance-mapping/behavior-anchors）
- [x] **对标素材库·拆文**（模块30）：`plot_material_benchmark` 表 + LLM 拆四类资产（character/plot_unit/style/setting）+ 置顶强制融入 + 写作召回降级链（pinned>语义>关键字）；`routers/benchmark.ts` 5 端点
- [x] **叙事事实自动回流与硬性事实校验**：`rag/fact-checker.ts` 零 token 三类矛盾检测（代词性别/中文数字时间/境界序列）+ 实体管线 EntityConflict 跨章事实冲突（境界倒退/法宝消失，15-SRS P2-1）
- [x] **大纲生成模式归一化**：outlines 单入口双模式（one-shot 缺省零回归 / stepwise 雪花法按步注入）+ stepwise-draft 草稿续进 + finalize 同构落库；删 snowflake 路由，SnowflakeWizard 内嵌 + WorldAssetPicker 共享组件
- [x] **18-SRS 章节阅读页工具栏优化（方案C）**：右栏双 Tab（剧情分支｜章节分析）+ 词频本章/全书范围 + 顶部 10 按钮精简 6 元素 + 审计/润色入口迁右栏
- [x] **素材知识库五页签与修复**：新增检索测试/对标素材页签；蒸馏任务黑屏修复（Python `/api/tasks` 返回 `{tasks:[...]}`，api.ts `etlTasks` 拍平）

### v1.5.1（2026-08-07，工程治理与体验优化）
- [x] **.env 统一合并**：删除 `sucaiqingxi/.env` + `sucaiqingxi/.env.example`，新增 `sucaiqingxi/env_loader.py` 自动从根目录 `.env` 加载并映射 `CREATIVE_DB_* → PG_*`；Python ETL 脚本零改动兼容
- [x] **整本拆文 Node 化**（模块30 扩展）：`POST /api/projects/:id/benchmark/analyze-book`（FormData 上传 TXT）+ `GET /api/benchmark/stream/:taskId`（SSE 进度）+ `agents/benchmark-book-analyzer.ts`（骨架/情节拆解 Agent）+ `services/benchmark-worker.ts`（切章/清洗/向量化/入库 worker）；`plot_material_benchmark` 表扩展 `chapter_idx/item_type/setup_ratio/develop_ratio/turn_ratio/resolve_ratio/emotion_curve/hook/quality_score/source_snippet` 字段（`scripts/ddl-benchmark-book.sql`）
- [x] **新书引导向导**：`pages/ProjectWizard.tsx` 6 步全屏向导（创建项目→设定主角→导入素材→配置文风→搭建大纲→开始写作），Dashboard 新增「新书引导」入口
- [x] **废数据字段标记**：`scripts/ddl-deprecated-fields.sql` 对 26 个半废弃字段/表加 `@half-used`/`@deprecated` COMMENT 标记（影响体系 5 表、伏笔 DNA 4 字段、info_point 等）
- [x] **模块合并与导航精简**：
  - 素材知识库页签重组：灵感素材库（plot_material_* + benchmark 统一展示）/ 文风预设 / 领域知识 / 拆文工具（轻量+整本合并入口）/ 蒸馏任务
  - 侧边栏叙事工程 8→4 项（伏笔因果 / 叙事全景 / 时间线 / 叙事体检）
  - 山河舆图标题统一（WorldMapPage 标题+侧边栏标签一致）
  - 文风预设 Tab 与 Settings 页交叉链接
- [x] **双引擎集成到生成页**：新增 `GET /v1/outline/iceberg-draft`（冰山台词预填）+ 生成页「智能增强」面板（选中章节自动加载冲突+台词预填，无需手动填写，仅审核）+ `/dual-engine` 从侧边栏移除保留路由

## 当前迭代（v1.6 候选，来自架构升级需求文档 v1.0）

> 需求文档 v1.0（2026-08-04）提出的 P0/P1/P2 Epic 中，**Epic4 后验、Epic5 润色、Epic8 章节意图编辑、Epic9 zip 导入导出已在 v1.3 落地**，剩余：

### 🟥 P0 核心架构升级
- [ ] **Epic1 世界状态机 2.0**（从被动记录到主动运行）
  - [ ] 世界状态总览仪表盘（世界时间进度/势力消长图/暗线运行状态/叙事债务总览）
  - [ ] 暗线运行系统（反派在干什么、势力怎么变化，不依赖主角在场）
  - [ ] 维度化世界规则体系（力量法则/信息传播/社会结构）
- [ ] **Epic2 多写手组合模式**（写作流水线化：叙事骨架 → 专项填充 → 整合；对话/动作/内心/环境分写手专精）
- [ ] **Epic3 可编排工作流引擎**（管线配置化：加步骤/调顺序/改条件不依赖改代码，支持 A/B 测试）

### 🟧 P1 流程架构优化
- [ ] **Epic6 大纲导演系统**（章节节奏规划、镜头分配、信息密度控制、创作留白）

### 🟨 P2 体验优化
- [ ] **Epic7 角色分层构建**（角色深度分层建模）
- [ ] 其他体验打磨（承接 v1.4 五模块优化思路持续迭代）

## 已知问题（经代码核实）

1. **文档与代码漂移**：技术手册声称 32 路由/48 创作表/18 诛仙表，代码实际 34 路由/56 表/33 表；功能手册的 8 步管线已改为 5 checkpoint 主步骤。`docs/` 目录文档已按代码修订，两份根目录手册待同步。
2. **管线编排僵化**：`runner.ts` 包含 14+ 串行/异步步骤全部硬编码在一文件，加步骤/调顺序/改条件都要改代码，非开发人员无法参与流程调整（v1.3 节点化已缓解断点续跑，编排仍硬编码 → Epic3）
3. **后置处理散乱、可观测性不足**：10+ 后置处理逻辑散落 runner 各处，均为 fire-and-forget，失败静默降级只记日志，用户感知不到，无统一状态管理和重试（v1.3 Epic2 已部分缓解，仍需深化 → Epic1）
4. **单 Writer 质量天花板低**：所有描写类型（对话/动作/内心/环境）由同一个 Agent 一次完成，难以专精（→ Epic2）
5. **世界观是"资料库"不是"状态机"**：静态实体库，无"暗线运行"、无维度化世界规则（→ Epic1）
6. **缺少"导演"层**：无章级镜头分配和信息密度规划，"信息黑洞/创作留白"概念缺失，伏笔管理是台账式而非导演式（→ Epic6）
7. **流程调整成本高**：调整生成流程需改代码重新部署，token 成本分布不透明（每步 token 用量统计已有 checkpoint 支撑，前端可视化待补）

## 远期规划

- **多主线剧情自动联动**：分支弧 → 多弧并行 + 自动收束深化，主线/支线自动协调
- **世界主动运行**：暗线系统 + 世界状态机，让"世界是活的"
- **导演层节奏控制**：镜头分配、信息密度、留白管理
- **移动端适配**：移动端创作/审阅体验
- **素材生态**：热点嗅探 → 素材库 → 生成管线的全自动闭环深化；跨书世界观共享

## 参考路线图（需求文档 §6.2 建议）

| Phase | 周期 | 内容 |
|-------|------|------|
| Phase 1 基础架构 | 4-6 周 | 世界状态机、暗线系统、维度化规则（Epic1） |
| Phase 2 核心体验升级 | 6-8 周 | 多写手组合、大纲导演（Epic2/6） |
| Phase 3 流程优化 | 4-6 周 | 可编排工作流引擎（Epic3） |
| Phase 4 体验完善 | 3-4 周 | 角色分层构建等（Epic7） |

## 成功指标（规划参考）

- 质量：章节整体质量评分提升 15%（用户主观 + 审计得分）
- 效率：单章生成总时长缩短 20%（并行化 + 流程优化）
- 可控性：用户可自主调整 80% 的生成流程参数，无需改代码
- 可观测性：100% 的生成步骤有明确状态和 token 用量统计
