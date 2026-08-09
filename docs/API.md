# 接口清单（API）

> 完整 200+ 端点路由表见 `XianxiaForge-技术手册.md` §5.2（该表已略旧，缺 `techniques.ts`/`character-aspects.ts` 两个路由模块；实际路由文件 **34 个**，以 `packages/server/src/index.ts` 挂载为准）。本文档按模块分组摘要关键端点。
> 前端经 Vite proxy 将 `/api` 转发到后端，故代码内请求路径统一以 `/api` 开头。

## API 总览

- **Base URL**：`http://localhost:3456/api`（服务端口由 `SERVER_PORT` 控制）
- **统一响应信封**：
  ```json
  { "success": true, "data": <payload> }       // 成功
  { "success": false, "error": "错误信息" }     // 失败
  ```
- **SSE 流式**：`GET /api/generation/stream/:taskId`（事件：token / status / context / pre_check / audit / branch_ready / entities_extracted / teleport_warning / complete / error）
- **分页参数**：`page`、`page_size`（按需支持）
- **软删除**：DELETE 一律 `is_deleted=true` 标记，非物理删除

## 1. 健康检查 / 系统

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/health | 健康检查（status/uptime） |
| GET/PUT | /api/settings | 获取/保存系统设置 |
| POST | /api/settings/test-llm | 测试 LLM 连接 |
| GET | /api/settings/db-status | 数据库状态 |

## 2. 项目管理

| 方法 | 路径 | 功能 |
|------|------|------|
| GET/POST | /api/projects | 项目列表 / 创建 |
| GET/PUT/DELETE | /api/projects/:id | 项目详情 / 更新 / 删除 |
| GET | /api/projects/:id/creation-stats?days= | 创作统计（热力图数据源） |
| GET | /api/projects/:id/export?format=txt\|md&volumeNo=&chapterIds= | 整书/按卷导出（流式下载，可跟随分支路径） |
| GET | /api/projects/:pid/export-package | 导出项目 zip 包（v1.3，含 manifest） |
| POST | /api/projects/import | 导入项目 zip（FormData file，单事务 13 步 + ID 重映射） |

## 3. 大纲与章节

| 方法 | 路径 | 功能 |
|------|------|------|
| GET/POST | /api/projects/:id/outlines | 大纲列表（含章节）/ 创建卷大纲 |
| PUT | /api/projects/:id/outlines/:oid | 更新大纲 |
| POST | /api/projects/:id/outlines/generate | AI 生成大纲（模式归一化，v1.5：mode 缺省 one-shot 零回归，stepwise 必带 step(2\|3\|4\|5) 按步注入；同步物化章节计划） |
| GET/PUT | /api/projects/:id/outlines/stepwise-draft | 分步生成草稿读写（雪花法续进，存于 creative_project.snowflake_draft，v1.5） |
| POST | /api/projects/:id/outlines/finalize | 分步完成同构落库（与 one-shot 同一落库路径，含回标，完成后清草稿，v1.5） |
| DELETE | /api/outlines/:id | 删除卷大纲 |
| GET/POST | /api/projects/:id/chapters | 章节计划列表 / 创建 |
| PUT/DELETE | /api/projects/:id/chapters/:cid | 更新章节（含意图编辑，v1.3）/ 删除 |
| GET | /api/projects/:id/chapters/:cid/content | 获取正文 |
| GET | /api/projects/:id/chapters/:cid/versions | 版本历史 |
| PUT | /api/chapters/:id/content | 保存编辑后正文（新版本，可回退） |

## 4. 生成管线（核心）

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | /api/generation/start | 单章入队 |
| POST | /api/generation/batch | 批量入队（共享 batchId，按章号排序） |
| GET | /api/generation/queue | 队列状态（并发/执行中/等待中） |
| GET | /api/generation/stream/:taskId | SSE 流式推送 |
| POST | /api/generation/cancel/:taskId | 取消任务 |
| GET | /api/generation/tasks | 任务列表 |
| GET | /api/generation/tasks/:id | 任务详情 |
| GET | /api/generation/tasks/:id/checkpoints | 管线断点列表（v1.3） |
| POST | /api/generation/tasks/:id/retry | 从指定/失败步骤重跑（v1.3） |
| POST | /api/generation/tasks/:id/skip-step | 跳过失败步骤继续（v1.3） |
| POST | /api/projects/:pid/post-update | 手动触发后验更新工作流（v1.3） |
| POST | /api/projects/:pid/chapters/:cid/polish | 独立润色 light/medium/deep（v1.3，返回 diff 预览） |

### 章节级 AI 操作（双路径别名 `/chapters/:id/*` 与 `/projects/:pid/chapters/:id/*`）

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | /api/chapters/:id/revise | 对话式 AI 修订（指令+选区→预览，不自动保存） |
| POST | /api/chapters/:id/rewrite-perspective | 视角改写（追加到 perspective_versions） |
| POST | /api/chapters/:id/audit-style | 触发章节文风校验（7 维） |
| GET | /api/chapters/:id/style-audits | 文风校验历史 |
| POST | /api/chapters/:id/style-audits/:aid/revise | 基于校验结果一键修订（预览） |
| POST | /api/chapters/:id/fix-issue | 修复单条审计问题（quality/style，预览） |
| POST | /api/chapters/:id/fix-all-quality | 质量审计一键修复（critical/major） |

## 5. 世界观（世界库 + WS0-WS4）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/world/books | 书籍列表（按 book_id 隔离切换） |
| POST | /api/world/books | 新建用户书籍（WS0，system 书禁改禁删） |
| GET | /api/world/stats?bookId= | 世界观数据总览 |
| GET | /api/world/characters\|factions\|locations\|skills\|items\|monsters\|materials\|daily-items\|faction-rules\|season-events | 各类实体列表 |
| GET | /api/world/characters/:id/distill | 人物深度蒸馏（心智模型/决策启发式/人生阶段） |
| GET | /api/world/skills/:id/distill | 功法深度蒸馏（属性/招式/关系/归档） |
| GET | /api/world/style?bookId= | 文风引擎配置（全局+场景映射） |
| GET | /api/world/search | 全局搜索 |
| POST/PUT/DELETE | /api/world/:collection(/:id) | 世界观实体 CRUD（软删除体系） |
| GET | /api/world/import/sources?bookId= | 跨书引入源清单（WS2） |
| POST | /api/world/import | 跨书引入执行（WS2） |
| POST | /api/world/batch-import/extract | 文本抽取入库（WS3，暂存 awaiting_confirm） |
| GET/POST | /api/world/batch-import/:id(/confirm) | 查询抽取任务 / 确认入库（WS3） |

## 6. 场景脚本编排（小纲）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET/POST | /api/projects/:id/outlines/:oid/scenes | 场景节点列表 / 创建 |
| PUT/DELETE | /api/projects/:id/outlines/:oid/scenes(/:sid) | 更新 / 删除节点 |
| PUT | /api/projects/:id/outlines/:oid/scenes/reorder | 排序 |
| POST | .../scenes/:sid/characters\|elements | 添加人物/要素关联 |
| POST | .../scenes/:sid/match-materials | 智能匹配素材 |
| POST | .../scenes/:sid/relations | 添加节点关系连线 |
| POST | .../scenes/sync-chapters | 小纲同步到章节计划 |
| POST | .../scenes/validate | 一致性深度校验（时间倒流/跨峰跳转/结构/战力） |
| POST | .../scenes/chat | 自然语言对话编排小纲 |
| GET | .../scenes/edit-logs | 对话修改日志 |
| POST | .../scenes/edit-logs/:lid/rollback | 回滚修改 |
| POST | .../scenes/generate | AI 生成场景节点 |
| POST | .../scenes/import-from-chapters | 从章节计划反向导入场景节点 |

## 7. 状态追踪 / 伏笔 / 成长

| 方法 | 路径 | 功能 |
|------|------|------|
| GET/POST | /api/projects/:id/state/snapshots | 人物状态快照列表 / 创建 |
| PUT/POST | /api/state/snapshots/:sid(/confirm) | 更新 / 确认快照 |
| GET/POST | /api/projects/:id/state/timeline | 时间线里程碑列表 / 创建 |
| POST | /api/projects/:id/state/bootstrap | 引导初始化（chapter_no=0 初始态） |
| POST | /api/projects/:id/state/extract | 对正文运行 LLM 状态抽取 |
| GET/POST | /api/projects/:id/foreshadow | 伏笔台账列表（含超期计算）/ 创建 |
| POST | /api/projects/:id/foreshadow/promote | 场景伏笔一键提升为伏笔线 |
| PUT/DELETE | /api/foreshadow/:fid | 更新（状态流转）/ 删除伏笔线 |
| POST | /api/foreshadow/:fid/backfill-anchor / backfill-revise / mark-planted | 伏笔前置回填（锚点/修订/标记已埋） |
| POST | /api/foreshadow/:fid/extract-dna | 伏笔 DNA 抽取（LLM） |
| GET | /api/foreshadow/:fid/suggest-techniques | 伏笔回收手法推荐 |
| GET/POST | /api/projects/:id/growth-stages | 人物成长阶段列表 / 创建 |
| GET/POST | /api/projects/:id/relations(/infer) | 自定义人物关系 / AI 推演 3 候选 |

## 8. 剧情方向 / 影响 / 因果

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/projects/:id/direction-stats | 方向占比统计 |
| GET | /api/projects/:id/direction-check | 方向失衡检测 |
| GET/POST | /api/projects/:id/impact/definitions | 影响定义列表 / 新建 |
| GET | /api/projects/:id/impact/character-state \| world-state \| relation-state | 影响当前状态 |
| GET | /api/projects/:id/impact/links/:optionId | 分支选项影响绑定明细 |
| GET | /api/projects/:id/impact/branch-options/:optionId/preview | 选项影响预览 |
| GET | /api/projects/:id/impact/target-candidates | 影响目标人物候选（POV→项目默认→已出场三级兜底） |
| GET | /api/projects/:id/impact/suggest | AI 建议影响绑定 |
| GET | /api/projects/:id/impact/direction-recommend | 基于影响状态的剧情方向推荐 |
| GET/POST | /api/projects/:id/causal-chains | 因果链列表 / 创建 |
| PUT | /api/projects/:id/causal-chains/:chainId/status | 状态流转 |
| POST | /api/projects/:id/causal-chains/expire | 批量过期处理 |
| GET | /api/projects/:id/causal-chains/stats | 因果链统计（回收率） |

## 9. 三工坊（自定义实体）

### 自定义人物（负数 ID）
| 方法 | 路径 | 功能 |
|------|------|------|
| GET/POST | /api/projects/:projectId/custom-characters | 列表 / 创建（三步向导） |
| POST | .../custom-characters/random | 一键随机生成完整人物 |
| POST | .../custom-characters/random-name | 随机人名 |
| POST | .../custom-characters/:id/generate-verdict | 生成判词七绝+考语 |
| POST | .../custom-characters/import | 从世界观引用人物 |
| POST | .../custom-characters/smart-match | 以文拟人·智能匹配（WS4） |
| POST | .../custom-characters/:id/auto-voice | 一键补全对白风格（v1.4，不落库） |

### 神兵坊（自定义武器）
| 方法 | 路径 | 功能 |
|------|------|------|
| GET | .../custom-weapons/catalog | 武器图鉴全量目录 |
| POST | .../custom-weapons/random \| random-name | 随机武器（零 LLM 骰子）/ 随机名号 |
| POST | .../custom-weapons/:wid/upgrade \| evolution \| mutation | 养成（强化/进化/变异，进化需 confirm） |
| POST | .../custom-weapons/fusion \| confirm | 融合（2 武器，需 confirm）/ 确认入库 |
| POST | .../custom-weapons/:wid/generate-lore | 生成兵器谱文案（weapon_lore） |
| POST | .../custom-weapons/generate-traits | 方向组合特质实时预览（零 token） |
| POST | .../custom-weapons/:wid/generate-sense-card | 五感兵器卡生成 |
| POST | .../custom-weapons/:wid/scars \| bonds/scan \| recraft \| dao-title \| demonize \| purify \| counter | 烙印/羁绊/重铸/道号/魔改/净化/克制 |
| POST | .../custom-weapons/import \| smart-match | 引用法宝 / 以文拟器 |

### 自定义功法 + 武学档案 + 千人千面
| 方法 | 路径 | 功能 |
|------|------|------|
| GET | .../custom-techniques/catalog | 功法目录（道则/体例/附录） |
| GET | .../custom-techniques/compat/:mainDao | 辅修道则相容性查询 |
| POST | .../custom-techniques/random \| random-name | 随机功法 / 随机名号 |
| POST | .../custom-techniques/:tid/generate-description | 生成 500-700 字功法详解 |
| POST | .../custom-techniques/:tid/generate-backlash | 反噬代价动态生成（v1.4） |
| POST | .../custom-techniques/:tid/generate-dao-insights | 运用方向 LLM 生成（v1.4） |
| GET/POST | .../custom-characters/:cid/martial | 武学档案（lores）/ 设置绑定 |
| POST | .../custom-characters/:cid/martial/generate | 生成功法×武器融合小传 |
| GET | .../characters/:characterId/techniques | 人物已绑功法+个人变种 |
| POST | .../techniques/:techniqueId/generate-variant | 生成个人变种（四因子推导） |

### 成长工坊（模块9）
| 方法 | 路径 | 功能 |
|------|------|------|
| GET/POST | /api/projects/:id/workshop | 实体列表 / 创建 |
| POST | .../workshop/fusion \| mutation \| upgrade \| evolution | 四种成长操作（前三需 confirm） |
| POST | .../workshop/confirm | 确认预览入库 |
| GET | .../workshop/history / tree | 成长记录 / 融合树 |
| POST | .../workshop/revert/:recordId | 回滚到操作前快照 |

## 10. 金句 / 热点 / 素材知识库

| 方法 | 路径 | 功能 |
|------|------|------|
| GET/POST | /api/projects/:id/quotes | 金句列表（按章节/角色/收藏/来源过滤）/ 手动录入 |
| POST | .../quotes/import-preview \| import | 批量导入·LLM 预筛 / 入库 |
| POST | /api/quotes/:qid/polish \| rescore | 生成三档美化 / 重新评分 |
| POST | /api/quotes/:qid/apply-preview \| apply | 回写预览 / 回写正文 |
| GET | /api/hotspot/sources \| batches | 榜单源 / 抓取批次 |
| POST | /api/hotspot/crawl \| analyze | 发起抓取 / LLM 分析提炼 |
| GET/PATCH | /api/hotspot/insights | 灵感列表 / 更新状态 |
| POST | /api/hotspot/insights/:id/push | 推送灵感入剧情素材库 |
| GET | /api/material-kb/style-presets \| domain-knowledge | 文风预设 / 领域知识 |
| GET | /api/material-kb/etl/tasks | 蒸馏任务列表（Python 侧返回 `{tasks:[...]}`，前端 api.ts `etlTasks` 已拍平为数组，v1.5 修复黑屏） |
| POST | /api/material-kb/etl/run/:kind | 发起蒸馏任务（style/domain/material） |

## 11. 山河舆图

| 方法 | 路径 | 功能 |
|------|------|------|
| GET/POST | /api/projects/:id/custom-maps | 地图列表（含地点计数）/ 新建 |
| PUT/DELETE | .../custom-maps/:mapId | 更新 / 删除（守卫至少一张） |
| GET/POST | .../custom-locations | 地点列表（按地图/草稿/类型过滤）/ 新建 |
| PUT | .../custom-locations/:locId | 更新（带 confirm:true 转正） |
| POST | .../custom-locations/:locId/confirm | 地点转正 draft→official |
| POST | .../custom-locations/import-world | 世界库地点批量导入（上限 500） |
| GET | .../custom-locations/distance?fromId=&toId= | 行程估算（Dijkstra + 途经点） |
| GET/POST/DELETE | .../custom-location-links | 路径连线 CRUD |

## 12. 动态叙事引擎（v1.4）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET/POST | /api/projects/:id/narrative/milestones | 里程碑列表 / 创建 |
| POST | .../narrative/milestones/extract | 从卷大纲自动抽取（LLM，pending） |
| PUT | .../narrative/milestones/reorder | 重排序 |
| GET/POST | .../narrative/branch-arcs | 分支弧列表 / 从分支选项创建 |
| POST | .../branch-arcs/:aid/converge \| extend \| abandon \| promote | 收束 / 豁免延长(+2) / 放弃 / 提升元素 |
| GET | .../branch-arcs/:aid/rewrite-logs | 计划改写日志 |
| POST | .../rewrite-logs/:lid/rollback | 回滚某次计划改写 |

## 13. 叙事技法库（/api/techniques/*，代码新增，手册未收录）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/techniques?category=&level=&status= | 技法原子列表（分类/层级/状态筛选） |
| GET/PUT | /api/techniques/:techniqueId | 技法详情 / 更新参数（status/generationGuidance/coreRules/autoFixTemplate/sortOrder） |
| POST | /api/techniques/recommend | 按章节类型推荐技法（V1 返回全部 active principle） |
| GET/PUT | /api/chapters/:chapterPlanId/techniques | 本章已启用技法 / 全量替换设置 |
| GET/PUT | /api/chapters/:chapterPlanId/infopoints | 本章信息点清单 / 全量替换 |

## 14. 角色心智与信息差（v1.4 PRD-A，/api/projects/:pid/*）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/projects/:pid/voice-configs | 角色声音配置列表 |
| PUT | /api/projects/:pid/characters/:characterId/voice | 设置单角色声音配置 |
| DELETE | /api/projects/:pid/voice-configs/:id | 删除声音配置 |
| GET/POST/PUT/DELETE | /api/projects/:pid/knowledge | 角色已知信息清单 CRUD |
| POST | /api/projects/:pid/knowledge/from-foreshadow | 伏笔回收联动生成已知信息 |
| GET/POST/PUT/DELETE | /api/projects/:pid/memory-cards | 角色记忆卡 CRUD |

## 15. 其他

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/projects/:id/health | 叙事体检 9 维（零 LLM 纯规则） |
| GET | /api/projects/:id/plot-materials?table=&keyword= | 剧情素材浏览（四表） |
| GET | /api/projects/:pid/narrative-debt | 叙事债务仪表盘（v1.3） |
| GET | /api/settings/style-presets | 文风预设列表（4 预设） |
| GET | /api/settings/direction-catalog | 剧情方向体系目录 |
| GET/POST/PUT/DELETE | /api/projects/:pid/treasure/* | 淘宝系统（十连 hunt/物品/记录/设置/绑定 bind/收藏 collect/打眼 isFake/转化 convert） |

## 16. 双引擎工坊（v1.5，/api/v1/*，zod 校验 + EngineError 统一错误契约）

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | /api/v1/dialogue/iceberg | 冰山台词生成（真相→表面→行为，full_dialogue+quality_score+executed_steps） |
| POST | /api/v1/dialogue/iceberg/regenerate | 冰山分步重生成（仅重生成指定层） |
| POST | /api/v1/conflict/generate | 冲突方案生成（欲望→阻力→代价 + 七寸映射 + 情绪曲线四参数） |
| POST | /api/v1/conflict/regenerate | 冲突分步重生成 |
| POST | /api/v1/conflict/compose | 五步组合成戏（双引擎产物合成完整场景戏文） |
| POST | /api/v1/validate | 独立质量体检打分（不与生成绑定） |
| GET | /api/v1/outline/conflict-draft | 大纲联动预填（大纲场景→冲突草案） |
| GET | /api/v1/outline/iceberg-draft | 冰山台词预填（v1.5.1，章节→场景上下文+真相层+表面层预填） |

错误契约：400 INVALID_CONFIG（字段级 details）/ 404 / 422 LLM_OUTPUT_PARSE_ERROR / 429 / 502 LLM_UNAVAILABLE；体检不达标返回 200 + VALIDATION_FAILED。

## 17. 对标素材库·拆文（v1.5 + v1.5.1 扩展）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET/POST | /api/projects/:id/benchmark-materials | 对标素材列表 / 手动添加（四类 character/plot_unit/style/setting） |
| DELETE | /api/projects/:id/benchmark-materials/:mid | 软删除 |
| PATCH | /api/projects/:id/benchmark-materials/:mid/pin | 置顶/取消（置顶=写作强制融入） |
| POST | /api/projects/:id/benchmark/analyze | 拆文分析（书名+≥100字文本→LLM 拆四类批量入库） |
| POST | /api/projects/:id/benchmark/analyze-book | **整本拆文**（FormData 上传 TXT→异步切章→LLM 逐章拆骨架/情节→向量化→入库；返回 SSE 流 + `X-Task-Id` 响应头） |
| GET | /api/benchmark/stream/:taskId | 整本拆文 SSE 进度流（事件：status/chapter_start/chapter_complete/progress/complete/error） |

数据表：`plot_material_benchmark`（原生 SQL，v1.5.1 扩展 `chapter_idx/item_type/*_ratio/emotion_curve/hook/quality_score/source_snippet` 字段）。
写作召回降级链：pinned 强制 > 语义 > 关键字，无对标素材不阻塞写作。
整本拆文复用 `generation_task` 表（`task_type='benchmark_analysis'`），向量化调用 `embedQuery()`（Python `embedding_server:8600`，best-effort 降级）。

## 规则约定

- **统一信封**：`{success, data}` / `{success, error}`；前端 `lib/api.ts` 统一解包。
- **SSE 事件**：生成过程实时推送（token 流 / 阶段变更 / 审计报告 / branch_ready / 预警事件）。
- **错误处理**：业务错误返回 `success:false` + 中文 error 信息；HTTP 状态码：200 成功、400 参数错误、404 不存在、409 冲突（如分支重选已脱离 planned 的章节）、500 服务端错误。
- **双路径别名**：章节级端点同时注册 `/chapters/:id/*` 与 `/projects/:pid/chapters/:id/*`。
- **命名警示**：zip 导出是 `/export-package`，`/export` 已被整书 txt/md 导出占用（Hono 按注册顺序匹配）。
- **负数 ID 贯穿**：自定义人物 ID 为负数，前端选择器/上下文构建/影响目标解析均需分流处理。
