# 二期需求 · RAG 召回接入 Novel Studio

> **本文件的读者是「负责实现二期的另一位工程 Agent」。**
> 读完本文你应当能独立判断「这活儿该不该做、能不能做、怎么做」，并按下方
> **三步法治理流程**推进：**先评估 → 提交审核 → 获批后再动手**。
> **未经业主（用户）书面同意，禁止写任何 Novel Studio 生产代码。**

---

## 0. TL;DR（30 秒看懂）

- **一期已交付**：`sucaiqingxi/` 这个 Python 工具集已把小说语料蒸馏成 **6 张带 512 维向量的表**（4 类剧情素材 + 文风预设 + 领域知识），全部落在创作库 `novel_studio`，并已写好一个**向量 HTTP 服务** `embedding_server.py`（bge-small-zh-v1.5 / 512 维 / 归一化 / cosine）。
- **二期要做**：在 **Novel Studio（Node/TypeScript）侧**接入 RAG——写作生成章节时，把「章节意图」向量化，用 pgvector 语义召回上述素材/文风/领域知识，注入创作上下文，让 AI 写得更像目标作者、更有料、更专业。
- **本 Python 工具不改一行**（铁律）。二期只在 Node 侧写「检索器 + 上下文拼装」，并部署已有的 `embedding_server.py`。
- **动手前必须走三步法**（见 §1），你现在处于**第一步：评估**。

---

## 1. 三步法治理流程（强制，最高优先级）

```
┌─ 第一步：评估（你现在在这里）───────────────────────────────┐
│  1. 通读本文档 + 技术文档.md，核对 Novel Studio 实际代码现状   │
│  2. 判断：该不该做 / 能不能做 / 有无阻塞 / 风险点              │
│  3. 产出《二期评估与实施方案》：范围、方案选型、改动清单、       │
│     工作量、风险、验收口径、回滚方案（模板见 §9）              │
│  4. 提交业主审核，【停下等待】——不得越过本步写生产代码         │
└──────────────────────────────────────────────────────────┘
                          ↓ 业主书面同意
┌─ 第二步：审核确认 ─────────────────────────────────────────┐
│  业主对方案逐条确认/打回。被打回则修订方案重新提交，直到批准。  │
│  批准范围之外的改动，一律回到第一步。                          │
└──────────────────────────────────────────────────────────┘
                          ↓ 获批
┌─ 第三步：实施 ─────────────────────────────────────────────┐
│  严格按批准方案编码 → 自测 → 按 §8 验收标准逐条自检 →         │
│  交付+演示 → 业主验收。任何方案外的新发现，先记录再请示。      │
└──────────────────────────────────────────────────────────┘
```

**红线**：
1. 第一步未获批，**禁止**修改任何 Novel Studio 生产文件；只能读代码、写评估文档。
2. 评估阶段若发现本文档与 Novel Studio 实际代码冲突（如表名、字段、目录不符），**以实际代码为准**，并在评估文档中列出差异，请业主裁决，不得擅自假设。
3. 有任何拿不准的取舍（模型、阈值、注入策略、topN），列成选项交业主定，不要自作主张。

---

## 2. 背景与现状

### 2.1 一期产出（数据侧，已就绪）

数据都在创作库 `novel_studio`（连接见本工具 `.env`；与 Novel Studio 的 `CREATIVE_DB_*` 指向同一库）。详见同目录 [技术文档.md](./技术文档.md)。

| 数据 | 表 | 向量字段 | 向量来源 |
|------|----|---------|---------|
| 奇遇/伏笔/高光/任务链 | `plot_material_encounter` / `_foreshadow` / `_highlight` / `_task` | `embedding VECTOR(512)` | `core_plot` |
| 作者文风预设 | `style_preset`（25 列，列名对齐仙侠世界 `style_global_config`） | `embedding VECTOR(512)`（可空，风格摘要） | 风格摘要 |
| 专业领域知识 | `plot_domain_knowledge`（5 类 `knowledge_type`） | `embedding VECTOR(512)` | `content` |

- 所有向量：**`BAAI/bge-small-zh-v1.5`，512 维，归一化，cosine**，HNSW 索引 `vector_cosine_ops`，距离算子 `<=>`。
- 逻辑删除字段 `is_deleted`；召回必须带 `WHERE NOT is_deleted AND embedding IS NOT NULL`。
- `project_id`：`NULL` = 全局共享，非空 = 归属某创作项目。召回时按「当前项目 OR 全局」过滤。

### 2.2 向量服务（已写好，待部署）

`embedding_server.py`（Flask，默认 `0.0.0.0:8600`）把 ETL 用的**同一个 bge 模型**暴露为 HTTP：

| 端点 | 用途 |
|------|------|
| `GET /health` | `{"status":"ok","model":"...","dim":512}` |
| `POST /embed` | `{"texts":[...]}` → `{"embeddings":[[...512...]],"dim":512}`（简单接口，供 Node 直连） |
| `POST /v1/embeddings` | OpenAI-compatible，可用 openai SDK / 现成 embedding client 直连 |

**关键**：查询向量必须来自这个服务（同源同空间），**不要**在 Node 侧另找一个 embedding 模型，否则余弦相似度无意义。

### 2.3 Novel Studio 侧现状（评估时你必须亲自核实）

据一期调研（`embedding_server.py` 头部注释）：Novel Studio 后端 **query-time embedding 能力当前为空**，`context-builder.ts` 里的向量检索被置空。二期就是补上这一环。

> ⚠️ 以上是一期的旧观察，**评估第一步你必须打开 Novel Studio 仓库确认**：
> - `context-builder.ts` 的真实路径与当前实现；
> - 是否已有 embedding client / pgvector 查询封装可复用；
> - 章节生成入口在哪、`intent` / `sceneBreakdown` 等上下文从哪来；
> - 创作库连接配置键名（本工具用 `PG_NAME`，Novel Studio 可能用 `CREATIVE_DB_*`，以实际为准）。
> 核实结果写进评估文档。

---

## 3. 二期目标与范围

### 3.1 目标（做什么）

写作生成某章节时，系统能**自动语义召回**与本章意图最相关的：
1. **剧情素材**（奇遇/伏笔/高光/任务链）——给情节灵感；
2. **领域知识**（term/rule/pitfall/expression/case）——保证专业细节不外行；
3. **文风预设**——约束叙事口吻、句式、意象、禁用词。

召回结果**结构化注入创作上下文**，供下游写作 Prompt 使用。

### 3.2 范围内（In Scope）

- 在 Novel Studio（Node/TS）侧新增**检索器**：把「章节意图文本」经 `embedding_server` 向量化 → pgvector top-N 召回 3 类数据。
- 改造 `context-builder.ts`（或等价上下文装配处）**接入召回结果**。
- 召回参数化：topN、相似度下限、是否按 `project_id` / `applicable_domain` / `applicable_scene_type` 过滤、各类数据开关。
- 部署 `embedding_server.py`（本工具目录内启动即可，或按 Novel Studio 运维约定托管）。
- 配套：连通性自检、日志、失败降级（召回失败不阻断写作）。

### 3.3 范围外（Out of Scope，除非业主另行批准）

- ❌ 改本 Python 工具集任何代码（`extract_materials.py` 等零改动铁律）。
- ❌ 新建/改表结构、迁移数据（数据侧已定型）。
- ❌ 重训/更换 embedding 模型。
- ❌ 把 `source_snippet` 原文片段注入写作上下文（见 §7 红线）。
- ❌ 前端 UI 大改（除非评估认为必要并获批）。

---

## 4. 推荐技术方案（供评估参考，非强制）

> 你可提出更优方案，但必须在评估文档里对比说明。以下是默认建议路径。

### 4.1 组件划分（Node/TS 侧）

```
章节生成入口
  └─ context-builder.ts（改造：调用检索器，拼装召回结果）
       └─ plot-material-retriever.ts（新增：检索器）
            ├─ embed(query)  → 调 embedding_server /embed 或 /v1/embeddings
            └─ pgvector 查询 → 3 类表各 top-N（余弦 <=>）
```

### 4.2 检索流程

```
1. 组装 query 文本 = 章节 intent + sceneBreakdown（或大纲/目标）
2. POST embedding_server /embed {texts:[query]} → 512 维向量 qvec
3. 对每类表执行（示例见 §5）：
     SELECT ... 1-(embedding <=> :qvec) AS score
     FROM <表> WHERE NOT is_deleted AND embedding IS NOT NULL
       AND (project_id = :pid OR project_id IS NULL)
       [AND 业务过滤：scene_type / domain]
     ORDER BY embedding <=> :qvec LIMIT :topN
4. score < 相似度下限 的丢弃；各类保留 top-N
5. 结构化组装为 context 片段（只用可注入字段，见 §7）
6. 交给写作 Prompt
```

### 4.3 关键设计取舍（评估时须给出结论）

| 取舍点 | 建议默认 | 说明 |
|--------|---------|------|
| topN（每类） | 素材 2 / 领域 3 / 文风 1 | 防上下文过长；文风通常锁定 1 套 |
| 相似度下限 | 0.35（cosine score） | 太低会召回噪声，评估时用真实数据调 |
| 文风召回方式 | 优先按 `style_name`/`project_id` **精确取**，向量召回兜底 | 文风一般由项目显式指定，不靠语义猜 |
| 项目过滤 | `project_id = 当前项目 OR IS NULL` | 全局素材共享 |
| 失败降级 | 召回失败**返回空**、写日志、**不阻断**写作 | 铁律：召回是增强项非必需项 |
| embedding 调用 | 复用 Novel Studio 现有 HTTP/embedding client | 避免重复造轮子 |

---

## 5. 召回 SQL 参考（可直接改用）

```sql
-- 剧情素材（以 encounter 为例，四表同构，按 scene_type 可选过滤）
SELECT id, title, core_plot, applicable_scene_type, tags, quality_score,
       1 - (embedding <=> :qvec) AS score
FROM plot_material_encounter
WHERE NOT is_deleted AND embedding IS NOT NULL
  AND (project_id = :pid OR project_id IS NULL)
ORDER BY embedding <=> :qvec
LIMIT :topN;

-- 领域知识（可按 applicable_domain / knowledge_type 过滤）
SELECT id, knowledge_type, applicable_domain, title, content, quality_score,
       1 - (embedding <=> :qvec) AS score
FROM plot_domain_knowledge
WHERE NOT is_deleted AND embedding IS NOT NULL
  AND (project_id = :pid OR project_id IS NULL)
ORDER BY embedding <=> :qvec
LIMIT :topN;

-- 文风：优先精确取（推荐），而非语义召回
SELECT id, style_name, author, mental_models, decision_heuristics,
       description_ratio, sentence_rules, core_imagery, forbidden_words,
       perspective_rules, anti_patterns, confidence
FROM style_preset
WHERE NOT is_deleted
  AND ( (project_id = :pid AND style_name = :styleName)
        OR (project_id IS NULL AND style_name = :styleName) )
ORDER BY project_id NULLS LAST, "version" DESC
LIMIT 1;
```

> `:qvec` 传 pgvector 字面量（`'[0.12,...]'`），或用 pgvector 的 Node 适配器参数化传数组。

---

## 6. 可注入字段 vs 禁注入字段（务必区分）

| 数据 | ✅ 可注入写作上下文 | ❌ 禁止注入 |
|------|--------------------|-----------|
| 剧情素材 | `title` / `core_plot`（已抽象化）/ `trigger_condition` / `reward` / `cost_or_risk` / `emotional_beat` / `tags` | **`source_snippet`（原文片段）** |
| 领域知识 | `title` / `content` / `knowledge_type` / `applicable_domain` / `tags` | **`source_snippet`** |
| 文风 | 6 大维度全部 + `forbidden_words`（作为负向约束） | 无原文片段（文风表本就不落 snippet） |

> `core_plot` / `content` 在一期已做**抽象化**（禁原文专名），可安全注入。`source_snippet` 仅供后台溯源。

---

## 7. 红线与约束（违反即验收不通过）

1. **零侵入本工具**：不改 `sucaiqingxi/` 下任何 `.py`（`embedding_server.py` 只部署不改；如需改，回第一步请示）。
2. **`source_snippet` 永不进写作上下文**：召回层必须在 SELECT 或组装层显式排除/不返回该字段。
3. **向量同源**：查询向量只能来自 `embedding_server`（bge-small-zh-v1.5 / 512 维 / 归一化），不得换模型。
4. **只读不写创作库素材表**：二期只 SELECT；不 INSERT/UPDATE/DELETE 那 6 张表。
5. **召回失败降级不阻断**：`embedding_server` 挂了或查询异常，写作流程照常（空召回 + 告警日志）。
6. **源世界原著库只读**：全程不连不写世界库。
7. **过滤逻辑分作用域**：`project_id = 当前项目 OR IS NULL`，不得跨项目泄露归属素材。

---

## 8. 验收标准（实施后逐条自检）

**功能**
- [ ] `embedding_server` 部署并 `GET /health` 返回 `dim:512`。
- [ ] 给定章节意图，检索器能召回 3 类数据，`score` 合理降序。
- [ ] 召回结果正确注入创作上下文，下游写作 Prompt 能拿到。
- [ ] 相似度下限 / topN / 各类开关可配置。
- [ ] `project_id` 过滤正确（全局 + 当前项目，不串项目）。

**红线**
- [ ] 上下文中**不含 `source_snippet`**（抓包/日志验证）。
- [ ] 查询向量来自 `embedding_server`（同一模型/512 维）。
- [ ] 本 Python 工具集无任何文件被改动（`git diff` 为空）。
- [ ] `embedding_server` 停机时写作不报错（降级验证）。

**质量**
- [ ] 端到端有日志：query、耗时、各类命中数、被降级次数。
- [ ] 有一份最小连通性自检脚本/说明。

---

## 9. 评估文档模板（第一步交付物）

> 第一步产出，命名建议《二期评估与实施方案.md》，提交业主审核。

```markdown
# 二期评估与实施方案

## 一、结论先行
- 该不该做：做 / 不做 / 有条件做（理由）
- 能不能做：能 / 有阻塞（列阻塞项）

## 二、现状核实（Novel Studio 实际代码）
- context-builder.ts 实际路径与现状：
- 现有 embedding client / pgvector 封装是否可复用：
- 创作库连接配置键名：
- 与本需求文档的差异点（如有）：

## 三、方案选型
- 采用方案（默认 §4 / 或自选，需对比）：
- 组件与文件改动清单（新增/修改，逐个文件）：
- 关键取舍结论（topN / 阈值 / 文风召回方式 / 过滤 / 降级）：

## 四、工作量与风险
- 预估工作量：
- 风险点与缓解：
- 依赖（部署 embedding_server 的机器/端口/资源）：

## 五、验收口径
- 对齐 §8，逐条确认可测：

## 六、回滚方案
- 如何一键关闭 RAG 召回（配置开关）回到现状：

## 七、待业主拍板的开放问题
- （列出需要用户决策的选项）
```

---

## 10. 关键信息速查

| 项 | 值 |
|----|----|
| 向量模型 | `BAAI/bge-small-zh-v1.5`，512 维，归一化，cosine |
| 距离算子 | pgvector `<=>`（余弦距离），`score = 1 - 距离` |
| 向量服务 | `embedding_server.py`，默认 `0.0.0.0:8600`，`/embed`、`/v1/embeddings`、`/health` |
| 创作库 | `novel_studio`（连接见本工具 `.env`，键名 `PG_*`；Novel Studio 侧可能是 `CREATIVE_DB_*`，以实际为准） |
| 6 张表 | `plot_material_{encounter,foreshadow,highlight,task}` / `style_preset` / `plot_domain_knowledge` |
| 必带过滤 | `WHERE NOT is_deleted AND embedding IS NOT NULL AND (project_id=:pid OR project_id IS NULL)` |
| 禁注入字段 | `source_snippet` |
| 工具技术文档 | [技术文档.md](./技术文档.md) |

---

**再次强调：你现在处于第一步「评估」。请先产出评估文档并等待业主审核，获批后再进入实施。**
