# 网文剧情素材库 ETL 工具

为 **Novel Studio** 提供「剧情多样性」的素材来源：把同类仙侠/玄幻网文 TXT，经清洗 →
切块 → LLM 结构化抽取 → 向量化 → 去重 → 入库，沉淀为可跨世界观复用的 4 类「剧情模式」，
供二期在章节生成时按场景召回、注入 Writer 上下文。

> 本工具为**独立 Python 脚本**，不耦合 Node 后端；手动执行、批量处理。

---

## 一、交付物清单（一期）

| 文件 | 说明 |
|---|---|
| `ddl-plot-material.sql` | 4 张对称素材表 + 索引 + 512 维 HNSW 向量索引，可重复执行 |
| `bge_embedder.py` | 共享向量化模块（bge-small-zh-v1.5 / 512 维 / 归一化），ETL 与向量服务共用 |
| `extract_materials.py` | ETL 主脚本：清洗 / 切块 / 合并抽取 / 向量化 / 去重 / 入库 |
| `embedding_server.py` | 二期用的 bge 向量 HTTP 小服务（供 Node 查询时调用） |
| `requirements.txt` | Python 依赖 |
| `.env.example` | 配置模板 |

四张表：`plot_material_encounter`（奇遇）、`plot_material_foreshadow`（伏笔手法）、
`plot_material_highlight`（人物高光）、`plot_material_task`（剧情任务链），结构完全对称。

---

## 二、环境依赖

- Python ≥ 3.9
- PostgreSQL（创作库 `novel_studio`）+ pgvector 扩展（≥ 0.5，支持 HNSW）
- 一个 OpenAI-compatible 的 LLM chat 接口（如 DeepSeek，可与 Novel Studio 共用凭证）
- 首次运行会自动下载 bge 模型权重（约 100MB，需能访问 HuggingFace；国内可设镜像 `HF_ENDPOINT=https://hf-mirror.com`）

安装依赖：

```bash
cd k:\xiaoshuochaijie\工具学习\sucaiqingxi
python -m venv .venv
.venv\Scripts\activate           # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

---

## 三、配置

```bash
copy .env.example .env            # Windows；Linux/Mac: cp .env.example .env
```

编辑 `.env` 关键项：

- `PG_*`：创作库连接（与 Novel Studio 的 `CREATIVE_DB_*` 指向同一库 `novel_studio`）
- `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL`：抽取用 LLM（与 Novel Studio 的 `LLM_*` 一致即可）
- `EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5`：**勿改维度**，必须 512 维与世界库对齐
- `TARGET_PROJECT_ID`：**留空 = 全局共享素材**（推荐）；填数字 = 归属指定项目
- 调参：`CHUNK_SIZE=2000` / `CHUNK_OVERLAP=200` / `DEDUP_THRESHOLD=0.92` /
  `MIN_QUALITY_TO_STORE=4` / `LLM_CONCURRENCY=5`

---

## 四、执行步骤

### 1) 建表（一次性，可重复执行）

```bash
psql -h <PG_HOST> -U noveluser -d novel_studio -f ddl-plot-material.sql
```

### 2) 跑 ETL

```bash
# 单本 TXT
python extract_materials.py "K:\path\to\某仙侠小说.txt"

# 指定作品名（默认取文件名）
python extract_materials.py "K:\path\to\book.txt" --source-work "凡人修仙传"

# 整个目录批量
python extract_materials.py "K:\novels\"

# 只抽取不入库（验证抽取质量与分布）
python extract_materials.py "K:\path\to\book.txt" --dry-run
```

运行时会打印：清洗字数 → 切块数 → 抽取进度 → 批内去重 → 分类分布 → 入库统计
（新增 / 覆盖更新 / 库内重复跳过）。失败明细写入 `etl_failures.log`，异常数据自动跳过不中断。

### 3) 验证入库

```sql
SELECT material_type, count(*) FROM (
  SELECT 'encounter'  t, quality_score FROM plot_material_encounter  WHERE NOT is_deleted
  UNION ALL SELECT 'foreshadow', quality_score FROM plot_material_foreshadow WHERE NOT is_deleted
  UNION ALL SELECT 'highlight',  quality_score FROM plot_material_highlight  WHERE NOT is_deleted
  UNION ALL SELECT 'task',       quality_score FROM plot_material_task       WHERE NOT is_deleted
) x(material_type, quality_score) GROUP BY material_type;

-- 抽查若干条
SELECT title, applicable_scene_type, quality_score, tags
FROM plot_material_encounter WHERE NOT is_deleted ORDER BY quality_score DESC LIMIT 10;
```

---

## 五、处理流程与关键规则

```
TXT → clean_text（去广告/作者话/网址/分隔线/乱码/相邻重复）
    → chunk_text（2000字滑窗，overlap 200）
    → extract_from_chunk（并发；单次合并抽 4 类；JSON 校验+重试3次；异常跳过）
    → vectorize（core_plot → 512维 bge 归一化向量）
    → dedup_in_batch（同类批内 cos>0.92 只留高分）
    → persist（库内 pgvector 最近邻再去重：>0.92 时保留高分，更高则覆盖更新）
```

- **去重刚性执行**：余弦相似度 > `DEDUP_THRESHOLD`(0.92) 判重，保留 `quality_score` 更高者。
- **质量门槛**：低于 `MIN_QUALITY_TO_STORE` 的素材直接丢弃，宁缺毋滥。
- **core_plot 抽象化**：Prompt 强制输出可跨世界观复用的剧情模式，不照抄原文专名。
- **版权红线**：`source_snippet` 仅入库、仅后台可见，**二期严禁注入写作上下文**。

---

## 六、二期向量服务（RAG 召回依赖）

Novel Studio 后端当前**无 query-time embedding 能力**（`context-builder.ts` 的向量检索被置空）。
二期做语义召回需要把查询文本向量化到同一 bge 512 维空间，故提供本服务：

```bash
python embedding_server.py        # 默认 http://0.0.0.0:8600
```

二期 `plot-material-retriever.ts` 调用示例：

```ts
// 把「章节 intent + sceneBreakdown」向量化
const r = await fetch('http://<host>:8600/embed', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ texts: [intent + ' ' + sceneBreakdown] }),
});
const { embeddings } = await r.json();      // embeddings[0] = 512维
// 再用 pgvector 做各表 top-2 召回：
//   ORDER BY embedding <=> $1::vector LIMIT 2
//   过滤 quality_score >= 6；有 scene_type 时优先 applicable_scene_type 相同
```

也提供 OpenAI-compatible 的 `POST /v1/embeddings`，可让 Node 的 openai SDK 直接对接
（baseURL 指向本服务）。

---

## 七、常见问题排查

| 现象 | 原因 / 解决 |
|---|---|
| `未配置 LLM_API_KEY` | 未复制 `.env` 或未填 key |
| 模型下载慢/失败 | 设环境变量 `HF_ENDPOINT=https://hf-mirror.com` 后重试 |
| `模型输出维度 ≠ 512` | `EMBEDDING_MODEL` 换成了非 512 维模型，改回 `BAAI/bge-small-zh-v1.5` |
| `type "vector" does not exist` | 目标库未装 pgvector；先执行 `CREATE EXTENSION vector;`（DDL 已含） |
| 入库全是 `skip` | 素材与库内高度重复（正常），或 `DEDUP_THRESHOLD` 过低 |
| 抽取条数很少 | 正常，Prompt 要求宁缺毋滥；可下调 `MIN_QUALITY_TO_STORE` 观察 |
| LLM 429 限流 | 调低 `LLM_CONCURRENCY`（如设 1-2） |
| TXT 乱码 | 脚本已尝试 utf-8/gb18030/gbk；仍乱码请先手动转码为 UTF-8 |

---

## 八、不做的事（范围红线）

不做爬虫框架、不做增量爬取/定时任务、不做素材编辑/手动录入、不做 source_snippet 与原文的
自动校验、不做素材间关联/图谱。低质量素材直接删。
