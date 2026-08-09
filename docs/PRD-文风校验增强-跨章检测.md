# PRD：文风校验增强 — 开头模板化 / "不是A是B"密集 / 明喻重复

> 版本：1.0 ｜ 日期：2026-08-08 ｜ 状态：待评审

---

## 1. 问题陈述

当前文风校验系统（`style-auditor.ts`）仅对**单章正文**做本地规则扫描 + LLM 维度审计，无法检测三类典型的 AI 写作指纹：

1. **开头模板化**：AI 生成的连续多章开头使用同一结构（如四章都是"两字，两字。"的环境描写），人类不会如此工整。需跨章比较开头类型才能发现。
2. **"不是A，是B"句式密集**：AI 偏爱此句式制造反转感，单章出现 10+ 次时读感僵硬。可在单章内规则检测。
3. **明喻过多且重复**：AI 反复使用"像烧红的烙铁""如潮水"等同一意象，全书级别才暴露。需跨章去重。

这三类问题在用户实际生成的 4 章样例中被人工鉴定为"高度疑似 AI 生成（70%-75%）"的最强证据，但当前系统**全部漏检**。

---

## 2. 现状分析（代码事实）

### 2.1 本地检测器只覆盖单章、无这三类检测

`packages/server/src/rag/ai-flavor-detector.ts`：

- **接口定义**（第 8-22 行）：`AIFlavorScanResult` 包含 `metaNarrationCount`、`sentenceUniformity`、`repetitiveStarters` 等 9 个计数器 + `signatureHits` 数组，**没有**开头类型、不是A是B计数、明喻意象提取相关字段。
- **主函数**（第 73 行 `scanAIFlavor(content: string)`）：只接收单章 `content` 字符串，逐行循环（第 85 行）做 7 类黑名单匹配，**无跨章参数**。
- **句式均匀度**（第 142-152 行）：按句号拆分计算句长标准差，`uniformity > 0.8` 判红（第 159 行）。这只能检测句长均匀，**无法检测开头结构雷同**。
- **综合评级**（第 154-160 行）：`totalFlags` 由元叙述 + 抽象判断词 + 句首重复 + 天命指纹 4 类合计，**不包含**上述三类新检测。

### 2.2 文风校验 Agent 只收单章、无跨章上下文

`packages/server/src/agents/style-auditor.ts`：

- **方法签名**（第 56-62 行）：`auditStyle(content, style, chapterMeta, llmConfig?, onUsage?)` — 仅 `content` 单章正文，**无跨章参数**。
- **本地扫描调用**（第 83 行）：`const aiFlavorScan = scanAIFlavor(content)` — 只扫当前章。
- **issue 生成**（第 84-99 行）：将 `aiFlavorScan` 结果汇总为一条 issue，`severity` 按红/黄定 major/minor，**不按子类别拆分**，也无 `aiFlavorType` 字段。
- **得分计算**（第 102-103 行）：绿=95 / 黄=70 / 红=40，只给 `AI味程度` 一个维度分。
- **LLM 维度**（第 105-158 行）：`collectActiveDimensions`（第 176-184 行）收集 6 个 LLM 维度，其中 `antiPattern`（第 182 行）的 LLM prompt（第 201-209 行）列了 8 种 AI 味分型（A-H），但**完全依赖 LLM 判断**，无本地规则预检。

### 2.3 路由层只加载当前章、无前序章节加载

`packages/server/src/routers/chapters.ts`：

- **`loadStyleAuditInput`**（第 1035-1068 行）：查 `chapterPlan`（第 1036-1040 行）→ 查 `generatedChapter`（第 1043-1050 行）→ 查项目文风配置（第 1054-1064 行）。**不查前序章节**。
- **`auditStyleHandler`**（第 1071-1104 行）：调用 `styleAuditorAgent.auditStyle(content, style, { chapterNumber, title })`（第 1080-1083 行），不传跨章上下文。
- **`reviseStyleAuditHandler`**（第 1242-1310 行）：从 `styleAuditRecord` 取已入库的 issues（第 1277 行），筛选 critical/major（第 1278-1280 行），合成指令调用 `reviserAgent.reviseWithInstruction`（第 1295 行）。

### 2.4 修订器的改写策略不含这三类标准

`packages/server/src/agents/reviser.ts`：

- **`buildAntiAiRevisionInstruction`**（第 256-268 行）：`typeMap` 有 8 条策略，其中：
  - `uniform_rhythm`（第 262 行）："打破句子的平均长度，高压处用短句…" — **只讲句长，不讲跨章开头雷同**。
  - `explanatory_dialogue`（第 261 行）："人物对话不要讲解设定…" — **不涉及"不是A是B"句式**。
  - `cliche_metaphor`（第 263 行）："删掉'眼睛像星星''心如刀绞'这类被用滥的比喻…" — **不涉及明喻密度和跨章意象重复**。
  - `adjective_stack`（第 260 行）："删掉一半以上的形容词标签…" — **不涉及明喻总量减少50%**。
- **类型检测触发**（第 95-96 行）：`aiTypes.filter((t) => instruction.includes(t))` — 5 种类型（第 95 行），**不含 `cliche_metaphor` 和 `psych_overload`**（只有 5 种，漏了 3 种）。

### 2.5 类型定义和前端展示

- **`types.ts`**（第 34 行）：`aiFlavorType` 联合类型有 8 个值：`empty_summary | cliche_atmosphere | adjective_stack | explanatory_dialogue | uniform_rhythm | cliche_metaphor | parallel_padding | psych_overload`。
- **`ChapterReader.tsx`**（第 1988-1992 行）：紫色 Badge 展示 `aiFlavorType`，有 8 个中文标签映射。**已有映射可直接复用，无需新增**。

### 2.6 数据库 schema 可支持跨章查询

`packages/server/src/db/creative-schema.ts`：

- **`chapterPlan` 表**（第 59 行）：`projectId`（第 61 行）、`volumeNo`（第 63 行）、`chapterNo`（第 64 行）、`title`（第 65 行）。
- **`generatedChapter` 表**（第 113 行）：`chapterPlanId`（第 113 行）、`isCurrent`（可用于取当前版本正文）。
- 按 `projectId + volumeNo` 查 `chapterNo < 当前章` 的前序章节完全可行。

---

## 3. 目标

| # | 检测项 | 检测范围 | 修订标准 | 复用 aiFlavorType |
|---|--------|---------|---------|-------------------|
| 1 | 开头模板化 | **跨章**（同卷前序章节） | 4章开头结构必须不同：环境/对话/动作/内心独白至少各来一次 | `uniform_rhythm` |
| 2 | "不是A是B"密集 | **单章** | 每章最多保留1处，其余改为动作描写或复杂心理 | `explanatory_dialogue` |
| 3a | 明喻密度过高 | **单章** | 明喻总量减少50%（每千字≤2.5个） | `adjective_stack` |
| 3b | 明喻意象重复 | **跨章**（同卷前序章节） | 同一意象全书只能出现1次 | `cliche_metaphor` |

**不新增 `aiFlavorType` 枚举值**，复用现有 4 种，前端紫色标签映射已有（`ChapterReader.tsx` 第 1990 行）。

---

## 4. 方案设计

### 4.1 改动范围（6 个文件）

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `packages/server/src/rag/ai-flavor-detector.ts` | 新增检测函数 + 扩展结果接口 | 3 个新检测 + 导出 `classifyOpening` |
| `packages/server/src/agents/style-auditor.ts` | 扩展 `auditStyle` 签名 + 新增 issue 生成 | 增加 `crossChapterCtx` 参数 |
| `packages/server/src/routers/chapters.ts` | `auditStyleHandler` 加载跨章上下文 | 查前序 5 章正文 |
| `packages/server/src/agents/reviser.ts` | 修改 `typeMap` 4 条策略 + 修复 `aiTypes` 漏项 | 补全 `cliche_metaphor` |
| `packages/server/src/types.ts` | 无需改 | 复用现有枚举（第 34 行） |
| `packages/web/src/pages/ChapterReader.tsx` | 无需改 | 复用现有标签映射（第 1990 行） |

### 4.2 详细设计

#### 4.2.1 `ai-flavor-detector.ts` — 新增 3 个检测

**A. 开头类型分类函数（新增导出）**

```typescript
export type OpeningType = 'environment' | 'dialogue' | 'action' | 'monologue' | 'other';

export function classifyOpening(content: string): OpeningType {
  // 取第一个非空自然段的首句
  const firstLine = content.trim().split('\n').find(l => l.trim().length > 3)?.trim() || '';
  const firstSentence = firstLine.split(/[。！？]/)[0].trim();

  if (/^[「"'""']/.test(firstSentence)) return 'dialogue';
  if (/^(他|她|我)?(心想|暗道|暗自|心中|脑海里)/.test(firstSentence)) return 'monologue';
  if (/^(他|她|我|那|这)?(走|跑|跳|抓|推|拉|拔|冲|蹲|站|转身)/.test(firstSentence)) return 'action';
  if (/^(风|雨|云|雾|夜|晨|天|山|水|林|月|日|雪|霜|雷|石|竹|树|草|花)/.test(firstSentence)) return 'environment';
  if (/^[^\n，。,．.]{1,3}[，,][^\n，。,．.]{1,3}[。．.]$/.test(firstSentence)) return 'environment';
  return 'other';
}
```

**B. 扩展 `AIFlavorScanResult` 接口**（第 8-22 行新增 3 个字段）

```typescript
notAButBCount: number;
notAButBHits: Array<{ phrase: string; line: number }>;
simileCount: number;
simileImageries: Array<{ imagery: string; phrase: string; line: number }>;
```

**C. 在 `scanAIFlavor` 主循环（第 85 行）内新增检测**

```typescript
// "不是A是B" 句式检测
const NOT_A_BUT_B_RE = /不是[，。、]?[^，。！？]{0,15}[，,]?\s*是(?!因为|为了|什么)/g;

// 明喻意象提取
const SIMILE_RE = /(?:像|如同|犹如|仿佛|宛如)([^，。！？、\s]{2,6})/g;
```

#### 4.2.2 `style-auditor.ts` — 扩展 `auditStyle` 签名 + 新增 issue

**A. 方法签名扩展**（第 56-62 行增加第 6 个可选参数）

```typescript
async auditStyle(
  content: string,
  style: StyleContext,
  chapterMeta: { chapterNumber?: number; title?: string },
  llmConfig?: LlmConfig,
  onUsage?: (usage: UsageInfo, model: string) => void,
  crossChapterCtx?: {
    previousOpenings?: Array<{ chapterNo: number; type: string }>;
    previousSimileImageries?: string[];
  }
): Promise<StyleAuditReport> {
```

**B. 在 step 1.5（第 82-103 行）之后新增 step 1.6-1.8**

- **step 1.6 开头模板化**（跨章）：调用 `classifyOpening(content)`，与 `crossChapterCtx.previousOpenings` 比较，同类 ≥2 次报 `major`，`aiFlavorType: 'uniform_rhythm'`。
- **step 1.7 "不是A是B"密集**（单章）：读 `aiFlavorScan.notAButBCount`，>1 报 `minor`，≥4 报 `major`，`aiFlavorType: 'explanatory_dialogue'`。
- **step 1.8 明喻检测**：
  - 密度过高（单章）：`simileCount / (content.length / 1000) > 5` → `minor`，`aiFlavorType: 'adjective_stack'`。
  - 意象重复（跨章）：`simileImageries` 与 `previousSimileImageries` 交集 → `major`，`aiFlavorType: 'cliche_metaphor'`。

每条 issue 包含 `dimension: STYLE_DIMENSIONS.antiPattern`、`description`、`suggestion`、`excerpt`、`aiFlavorType`。

#### 4.2.3 `chapters.ts` — `auditStyleHandler` 加载跨章上下文

在 `auditStyleHandler`（第 1071-1104 行）中，`loadStyleAuditInput` 之后、`styleAuditorAgent.auditStyle` 之前，新增：

1. 查同卷前序 5 章：`SELECT id, chapter_no FROM chapter_plan WHERE project_id = $1 AND volume_no = $2 AND chapter_no < $3 ORDER BY chapter_no DESC LIMIT 5`
2. 逐章查 `generatedChapter.content`（`is_current = true`）
3. 对每章调用 `scanAIFlavor` 提取 `simileImageries` + 调用 `classifyOpening` 提取开头类型
4. 组装 `crossChapterCtx` 传入 `auditStyle`

#### 4.2.4 `reviser.ts` — 修改 `typeMap` + 修复 `aiTypes` 漏项

**A. `typeMap`（第 257-266 行）修改 4 条策略**

| 键 | 现有策略（第 257-266 行） | 追加铁律 |
|----|--------------------------|---------|
| `uniform_rhythm` | 第 262 行 | +`【跨章铁律】连续章节开头结构必须不同：环境/对话/动作/内心独白至少各来一次，禁止多章同类开头。` |
| `explanatory_dialogue` | 第 261 行 | +`【"不是A是B"铁律】每章最多保留1处，其余改为动作描写或复杂心理活动。` |
| `cliche_metaphor` | 第 263 行 | +`【明喻铁律】同一意象全书只能出现1次；明喻总量减少50%，改用借代、通感或白描。` |
| `adjective_stack` | 第 260 行 | +`【明喻密度铁律】每千字明喻不超过2.5个。` |

**B. `aiTypes` 数组（第 95 行）修复漏项**

现有：`['empty_summary', 'cliche_atmosphere', 'adjective_stack', 'explanatory_dialogue', 'uniform_rhythm']`（5 种）

改为：追加 `'cliche_metaphor'`（补全 6 种，确保跨章明喻重复也能触发定向改写策略）

---

## 5. 非目标

- **不新增 `aiFlavorType` 枚举值**：复用现有 8 种中的 4 种（`uniform_rhythm`、`explanatory_dialogue`、`adjective_stack`、`cliche_metaphor`），前端 `ChapterReader.tsx` 第 1990 行已有中文标签映射。
- **不修改 LLM prompt**：`style-auditor.ts` 第 194-232 行的 LLM 审计 prompt 不变，新检测全部走本地零 token 规则。
- **不修改数据库 schema**：不新建表、不加列。跨章查询走现有 `chapter_plan` + `generated_chapter` 表。
- **不做全书级明喻统计**：跨章范围限定为同卷前序 5 章，不做全库扫描。

---

## 6. 成功指标

| 指标 | 衡量方式 |
|------|---------|
| 检测覆盖率 | 对用户提供的 4 章样例，三类问题全部检出（当前为 0/3） |
| 零 token 成本 | 三类新检测全部走本地规则，不增加 LLM 调用 |
| 修订可触发 | `reviseStyleAuditHandler` 一键修订时，`aiFlavorType` 出现在指令中能触发对应改写策略 |
| 类型检查通过 | `packages/server` + `packages/web` 两包 `npx tsc --noEmit` 零错误 |
| E2E 验证 | 对 4 章样例调用 `POST /chapters/:id/audit-style`，返回 issues 中包含三类问题的 `aiFlavorType` 标签 |

---

## 7. 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 跨章查询增加 DB 开销 | `auditStyleHandler` 每次校验多查 5 章正文 | 前 5 章查询走单条 SQL + 限制 5 章，正文已有索引 `chapter_plan_id` |
| 开头类型分类误判 | 环境词列表不完整导致 `other` 过多 | 先跑 4 章样例验证分类准确率，再迭代词表 |
| 明喻意象提取精度 | 正则可能误抓"像"做动词（如"像这样"） | SIMILE_RE 限定喻体 2-6 字 + 排除"这样/那种/什么"等代词 |
| `crossChapterCtx` 参数可选性 | 前序章节不存在时（第 1 章）检测降级 | `if (crossChapterCtx?.previousOpenings?.length)` 守卫，第 1 章只做单章检测 |

---

## 8. 验收清单

- [ ] `ai-flavor-detector.ts`：新增 `classifyOpening` 导出函数 + `notAButBCount` / `simileCount` / `simileImageries` 三个结果字段
- [ ] `style-auditor.ts`：`auditStyle` 第 6 参数 `crossChapterCtx` 可选传入；step 1.6-1.8 生成带 `aiFlavorType` 的 issue
- [ ] `chapters.ts`：`auditStyleHandler` 查前序 5 章正文，组装 `crossChapterCtx` 传入
- [ ] `reviser.ts`：`typeMap` 4 条策略追加铁律；`aiTypes` 数组补全 `cliche_metaphor`
- [ ] `types.ts`：无改动
- [ ] `ChapterReader.tsx`：无改动
- [ ] 两包 `tsc --noEmit` 零错误
- [ ] E2E：对 4 章样例调 `POST /chapters/:id/audit-style`，issues 包含 `uniform_rhythm` / `explanatory_dialogue` / `adjective_stack` / `cliche_metaphor` 标签
