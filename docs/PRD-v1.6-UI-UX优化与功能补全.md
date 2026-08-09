# Novel Studio v1.6 UI/UX 优化与功能补全 PRD

> **版本**：v1.0 | **日期**：2026-08-08
> **依据**：`15-UI优化需求清单.md`（14 项问题，核实通过）
> **事实来源**：所有行号经实际代码文件交叉核实

---

## 问题陈述

Novel Studio 经过 v1.0–v1.5 迭代，核心写作/审计/蒸馏管线已稳定，但存在 14 项 UI/UX 体验断层和功能缺口：
- Writer 上下文未投喂金句库存，导致人物台词风格漂移
- 生成页面面板堆叠、信息过载，低频/高级配置持续占据空间
- 词频/文风内联切换到右栏后，浮层依赖消失，全文无引导跳转
- 叙事方向无智能判词，作者选方向靠猜
- 多个实体模块（地点/功法变种/人物）数据已入库但前端未渲染
- 自查清单未走定向 Audit Agent

这些问题导致用户在**生成写作 → 审计检验 → 素材投喂**三个核心回路中反复遇到阻塞。

---

## 成功度量

| # | 指标 | 当前值 | 目标值 |
|---|------|--------|--------|
| M1 | 生成页面首屏可见核心按钮占比 | ~50%（被折叠面板遮挡） | 85%+ |
| M2 | 人物台词一致性审计通过率 | 无金句投喂（依赖 LLM 记忆） | 金句自动注入 Writer |
| M3 | 词频异常定位时间 | 手动搜索 | 点击跳转 ≤ 1 次 |
| M4 | 方向选择有依据 | 0%（纯手动） | 100%（方向判词覆盖） |
| M5 | 实体信息可见率（地点/功法变种/人物知识） | — | 100% 前端渲染 |

---

## 项目边界

### 纳入范围
- 14 项清单全部事项
- 仅涉及前端组件重排、后端 0–1 条新路由、现有 Agent 复用

### 排除范围
- 不新增 LLM Agent（复用 Auditor / CausalExtractor）
- 不修改核心管线（writer / auditor / reviser 流程不变）
- 不涉及数据库 migration（仅新增查询/写入）

---

## 改动清单（核实后）

### UI-01 首页Dashboard状态/题材显示英文

**问题**：Dashboard 项目卡片状态 `planning` 显示 "planning"；题材 `xianxia` 显示 "xianxia"
**根因**：
- `StatusBadge`（`Dashboard.tsx:34-42`）map 仅覆盖 active/paused/completed/draft，无 `planning` → fallback 到 raw string
- 题材直接渲染 raw 值（`Dashboard.tsx:360` `{project.genre || '未设置'}`）
**方案**：
- `StatusBadge` map 增加 `planning: { label: '规划中', variant: 'warning' }`
- 新增 `GENRE_LABELS` 映射表（`xianxia→仙侠` 等），题材渲染走 `GENRE_LABELS[project.genre] || project.genre`
**涉及文件**：
- `packages/web/src/pages/Dashboard.tsx` 行 34-42, 360

---

### UI-02 首页Dashboard热力图挪位

**问题**：热力图占据首页核心区，当前项目切换才可见
**现状**：`Dashboard.tsx:280` `{/* 创作热力图（模块14）+ 伏笔回收进度（模块2）+ 方向均衡度（阶段3）——跟随当前项目 */}`
**方案**：将热力图从首页主区移到独立的"统计"子页面或右侧折叠面板；首页保留摘要数字
**涉及文件**：`packages/web/src/pages/Dashboard.tsx` 行 280

---

### UI-03 生成页面GenerationConsole面板折叠

**问题**：生成策略/后验配置/生成队列三块持续占据空间，写作核心按钮被挤到底部
**现状**：`GenerationConsole.tsx:1256-1332` — 折叠面板按钮 + 三块内容（GenerationStrategyCard / PostUpdateConfigCard / 生成队列）
**方案**：
- 面板默认折叠，仅展开时占用空间
- 或改为右侧固定 dock 栏，写作区不受挤压
**涉及文件**：`packages/web/src/pages/GenerationConsole.tsx` 行 1256-1332

---

### UI-04 大纲生成片段-方向判词懒加载后仍不显示

**问题**：章节方向判词 loading 后空白
**状态**：需定位路由返回数据与前端渲染对接点
**涉及文件**：
- `packages/server/src/services/direction-catalog.ts` 行 38（`impactModules` 类型）, 行 60-63（方向定义）

---

### FUNC-01 金句库存未注入 Writer 上下文 + 冰山对话未集成

**问题 1**：Writer 缺少金句注入 → 人物台词风格漂移
**现状**：`writer.ts:496-503` — 金句上下文仅注入 `collectedQuotes` 台词列表，无冰山对话模板
**方案**：
- `iceberg-dialogue.ts`（已存在 Agent）输出在 Writer prompt 中增加"冰山台词模板"块
- 在 `writer.ts` 的 context 收集阶段（约行 170-190）加载金句 + 冰山模板联合上下文
**涉及文件**：
- `packages/server/src/agents/writer.ts` 行 496-503
- `packages/server/src/agents/iceberg-dialogue.ts`（已存在，待接入 Writer 上下文）

**问题 2**：对话比例标记"对话投喂4段"与金句/冰山模块割裂
**方案**：将"对话投喂"标签改为"金句/冰山"，指标合并显示

---

### FUNC-02 词频内联缺乏全文跳转

**问题**：词频从浮层改为右栏内联后，点击词频项无法在正文字段中定位
**现状**：词频使用纯前端 `analyzeWordFreq`（`wordfreq.ts:1-80+`，停用字集 `wordfreq.ts:7-9`），右栏 Tab 渲染（`ChapterReader.tsx:152` `analysisTool`）
**方案**：
- 词频项点击 → 正文中高亮该词出现位置（类似 grep 高亮）
- 利用 `excerpt` 字段反向定位 DOM 节点
**涉及文件**：
- `packages/web/src/pages/ChapterReader.tsx` 行 150-220（右栏双 Tab 区域）
- `packages/web/src/lib/wordfreq.ts` 行 1-80+

---

### UI-05 词频/文风右栏数据不随章节切换刷新

**问题**：右栏数据停留在上一章
**方案**：`analysisTool` 切换时强制 invalidate 缓存；章节切换时清空右栏数据
**涉及文件**：`packages/web/src/pages/ChapterReader.tsx` 行 152-220

---

### FUNC-03 分支选择-方向判词与因果链上下文

**问题**：方向判词懒加载后空白；因果链上下文未展示
**方案**：
- 方向判词显示修复 → 排查路由返回结构
- 因果链上下文加载 → 分支选择弹窗显示"待兑现因果线"清单
**涉及文件**：
- `packages/server/src/services/direction-catalog.ts` 行 38-63
- `packages/server/src/services/impact/causal-chain.service.ts`（已实现 buildCausalContext）

---

### UI-06 法宝工坊四步点选弹窗大屏重叠

**问题**：`ForgeDialog`（`CustomWeaponForge.tsx:1058`）弹窗宽度 `max-w-2xl`，步骤多时大屏两栏重叠
**根因**：`CustomWeaponForge.tsx:553` — 预览弹窗使用 `max-w-2xl`，大屏宽度不足导致两栏挤压
**方案**：弹窗 `max-w-4xl`；左侧选项列表与右侧预览区改为固定比例并排
**涉及文件**：
- `packages/web/src/pages/CustomWeaponForge.tsx` 行 553, 1058

---

### FUNC-04 地点自动提取后未在实体列表渲染

**问题**：`customLocation` 表（`creative-schema.ts:1666`）已存储 AI 自动提取的地点，但实体列表页无渲染
**现状**：`customLocation` 表字段完整（`creative-schema.ts:1666-1696`），含 `entityStatus`（行 1687）、`chapterUpdates`（行 1688-1689），但无对应前端列表页/路由
**方案**：
- 新建 `LocationList` 组件，复用 `CharacterGallery` 的列表+筛选模式
- `entityStatus='draft'` 地点标"待确认"，`official` 标"已确认"
- 路由注册：`/project/:id/locations`
**涉及文件**：
- `packages/server/src/db/creative-schema.ts` 行 1666-1696

---

### FUNC-05 功法千人千面 + 人物知识未在详情页渲染

**问题 1**：功法"千人千面"变种数据已入库，但人物详情页未渲染
**现状**：
- `techniqueVariantsApi`（`api.ts:1288`）已实现 CRUD
- `CharacterGallery.tsx:633-658` `VariantsSection` 已渲染变种列表
- 但 `CustomTechniqueForge.tsx:652-728` 绑定/生成/重随/成长/删除功能仅在功法工坊可用
**方案**：在 `CharacterGallery` 人物详情页增加"功法变种"区块，调用 `techniqueVariantsApi.list(projectId, negId)`
**涉及文件**：
- `packages/web/src/pages/CharacterGallery.tsx` 行 633-658
- `packages/web/src/lib/api.ts` 行 1288

**问题 2**：人物专属知识（`characterKnowledge` 表）未在详情页渲染
**现状**：`characterKnowledge` 表 `creative-schema.ts:1601-1618` 已定义，字段完整（含 `coreDrives/knowledgeType/knowledgeText/chapterNo`），但无前端集成
**方案**：在人物详情页底部分块显示 `characterKnowledge` 按 `knowledgeType` 分组
**涉及文件**：
- `packages/server/src/db/creative-schema.ts` 行 1601-1618

---

### BUG-01 法宝工坊-天机独悟名称前缀重复

**问题**：天机独悟生成的特质描述中，形制名称被重复拼接
**根因**：`trait-composer.ts:176-179` — 特质描述 = `baseEffect → formAdapt（形制适配）→ matLabel（材质前缀）→ daoSuffix（道则后缀）`，形制名称在 `formAdapt` 内已包含，但外层再次拼接
**方案**：`formAdaptFn` 输出已含形制名时不再追加前缀
**涉及文件**：`packages/server/src/services/trait-composer.ts` 行 176-179

---

### BUG-02 功法工坊对外指引显示为空白

**问题**：功法详情"对外指引"字段不显示内容
**根因**：
- `custom-techniques.ts:470` — 新建功法 `threshold: {}`（空对象），但前端 `CustomTechniqueForge.tsx:561` 期望 `threshold` 为数组 → `(t.threshold || []).map(...)` 空对象 fallback 为空数组 → 返回空
- 编辑页面 `GUIDANCE_LABELS`（`CustomTechniqueForge.tsx:55`, 行 543-544）本身正常，但数据源为空导致无内容
**方案**：`custom-techniques.ts:470` 改为 `threshold: []`；已存量数据需要在读取时做类型兼容
**涉及文件**：
- `packages/server/src/routers/custom-techniques.ts` 行 470
- `packages/web/src/pages/CustomTechniqueForge.tsx` 行 55, 543-544, 561

---

### FUNC-06 人物专属功法列表为空

**问题**：人物工坊人物详情页 > 功法列表无数据
**方案**：按 `customCharacter.id` 关联查询 `customCharacterTechnique`（`creative-schema.ts:1382-1383`），渲染功法卡片
**涉及文件**：
- `packages/server/src/db/creative-schema.ts` 行 1382-1383

---

### FUNC-07 地点自动提取-章节动态时间线

**问题**：AI 自动提取的地点随章节推进产生动态（`chapterUpdates`），但无时间线视图
**现状**：`customLocation.chapterUpdates`（`creative-schema.ts:1688-1689`）为 `jsonb` 数组，结构为 `[{chapterNo, volumeNo, updateText, category, extractedAt}]`
**方案**：地点详情页底部时间线组件，按章号倒序展示 `chapterUpdates`
**涉及文件**：
- `packages/server/src/db/creative-schema.ts` 行 1688-1689

---

### FUNC-08 自查清单加入定向 Audit Agent 审查

**问题**：自查清单目前仅做 pattern 匹配，未走 Auditor 定向输入
**方案**：
- 新增接口：`POST /api/projects/:id/self-check/audit`，取待查条目 → 构造 simplified ContextPackage → 调用 `AuditorAgent` 定向维度的 `planAudit`
- 结果回写自查清单的"审计状态"字段
**涉及文件**：
- `packages/server/src/agents/auditor.ts`

---

## 依赖拓扑

```
FUNC-01（Writer 金句冰山）── 无依赖，优先
UI-01（Dashboard 中文化）── 无依赖，优先
UI-03（GenerationConsole 折叠）── 无依赖，优先
BUG-01（法宝前缀重复）── 无依赖，优先
BUG-02（功法对外指引空白）── 无依赖，优先

FUNC-02（词频全文跳转）── 依赖 FUNC-02 自身（前端纯改）
UI-05（右栏刷新）── 依赖 FUNC-02

FUNC-04（地点渲染）── 依赖 FUNC-07（时间线视图可同步）
FUNC-05（功法变种人物知识）── 无依赖
FUNC-06（人物功法列表）── 无依赖
FUNC-07（地点时间线）── 依赖 FUNC-04

UI-02（热力图挪位）── 无依赖，独立
UI-04（方向判词修复）── 需排查路由
UI-06（法宝弹窗宽度）── 无依赖，独立
FUNC-03（方向判词+因果链）── 依赖 UI-04
FUNC-08（自查清单 Audit）── 无依赖，独立
```

---

## 实施顺序（建议）

| 批次 | 事项 | 估时 |
|------|------|------|
| P0 (BUG) | BUG-01 法宝前缀 / BUG-02 功法指引 | 0.5天 |
| P0 (UI 速赢) | UI-01 Dashboard / UI-03 面板折叠 / UI-06 弹窗宽度 | 0.5天 |
| P1 (FUNC 速赢) | FUNC-01 金句冰山 / FUNC-02 词频跳转 / UI-05 刷新 | 1天 |
| P2 (新模块) | FUNC-04 地点列表 / FUNC-07 地点时间线 / FUNC-05 人物知识 | 1.5天 |
| P3 (补齐) | FUNC-06 人物功法 / UI-02 热力图 / UI-04 方向判词 / FUNC-03 因果链 / FUNC-08 自查清单 Audit | 2天 |

---

*本 PRD 所有代码行号均经 2026-08-08 实时交叉核实。*
