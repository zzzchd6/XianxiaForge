# 配置与运行

> 依据 `XianxiaForge-技术手册.md` §3（环境配置）、§10（部署与运维）、README.md、`.env.example`。

## 前置要求

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | ≥ 20（推荐 22 LTS） | 运行时 |
| pnpm | ≥ 9 | 包管理（monorepo） |
| PostgreSQL | ≥ 15 | 需安装 **pgvector** 扩展 |
| 诛仙小说数据库 | 已导入 | 33 张 schema 表（18 核心 + 15 蒸馏/心智/文风扩展）+ 512 维向量（`novel_db`） |
| LLM | 任意 OpenAI-compatible API | Ollama 本地 / DeepSeek / OpenAI 等 |

## 快速启动

### 方式一：一键启动（Windows）

```bat
双击 start.bat
```

脚本自动：检查环境（Node/pnpm/PostgreSQL）→ 初始化创作库 → 安装依赖 → 启动前后端 → 打开浏览器。

### 方式二：手动启动（推荐开发）

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入双库连接信息和 LLM 配置

# 3. 初始化创作工作库（Drizzle 56 张表）
pnpm db:init        # = node scripts/init-db.mjs

# 4. 启动开发服务（concurrently 同时启动前后端）
pnpm dev
```

- 前端：http://localhost:5173 （Vite，HMR）
- 后端：http://localhost:3456 （Hono，`tsx watch` 热重载；前端经 Vite proxy 转发 `/api`）

### 方式三：分别启动（调试）

```bash
pnpm --filter server dev   # 仅后端（tsx watch）
pnpm --filter web dev      # 仅前端（Vite）
```

## 关键配置项（.env）

> 加载方式（`env.ts`）：dotenv 从 **monorepo 根目录** `.env` 加载（`packages/server/src/env.ts` 相对路径 `../../../.env`），必须最先 import。
> **v1.5.1 起 .env 统一**：`sucaiqingxi/.env` 已删除，Python ETL 脚本通过 `sucaiqingxi/env_loader.py` 从根目录 `.env` 加载，自动映射 `CREATIVE_DB_* → PG_*`。Python 专属配置（`CHUNK_SIZE`/`EMBEDDING_MODEL` 等）已合并到根目录 `.env`。

```env
# ===== 诛仙库（只读，世界观 RAG） =====
ZHUXIAN_DB_HOST=localhost
ZHUXIAN_DB_PORT=5432
ZHUXIAN_DB_NAME=novel_db          # 诛仙小说数据库
ZHUXIAN_DB_USER=noveluser
ZHUXIAN_DB_PASSWORD=

# ===== 创作库（读写，项目数据，自动创建） =====
CREATIVE_DB_HOST=localhost
CREATIVE_DB_PORT=5432
CREATIVE_DB_NAME=novel_studio
CREATIVE_DB_USER=noveluser
CREATIVE_DB_PASSWORD=

# ===== LLM 配置（OpenAI-compatible） =====
LLM_BASE_URL=https://api.deepseek.com  # 或 http://localhost:11434/v1 (Ollama)
LLM_API_KEY=your-api-key
LLM_MODEL=deepseek-chat
# LLM_WRITER_MODEL=glm-5.2      # 写作步骤专用强模型（可选，不设则用 LLM_MODEL）
# LLM_FALLBACK_MODELS=minimax-m2.7,qwen3.8-max   # 备用模型（逗号分隔，5xx/超时/空内容自动切换）
# LLM_FALLBACK_BASE_URL=        # 独立备用供应商（可选）
# LLM_FALLBACK_API_KEY=
LLM_MAX_TOKENS=4096
LLM_TEMPERATURE=0.8

# ===== 服务配置 =====
SERVER_PORT=3456
QUEUE_CONCURRENCY=1              # 生成队列并发数（默认 1=顺序，可设 1-4）

# ===== Python ETL 侧配置（v1.5.1 合并，sucaiqingxi/ 脚本复用） =====
# Python 脚本通过 env_loader.py 自动映射 CREATIVE_DB_* → PG_*，无需重复配置
EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
EMBEDDING_DEVICE=cpu
HF_ENDPOINT=https://hf-mirror.com
HF_HUB_OFFLINE=1
CHUNK_SIZE=2000
CHUNK_OVERLAP=200
LLM_CONCURRENCY=20
LLM_JSON_MODE=1
LLM_THINKING=disabled
GUI_PORT=8610
EMBEDDING_SERVER_HOST=0.0.0.0
EMBEDDING_SERVER_PORT=8600
```

### 配置项说明

| 配置项 | 说明 |
|--------|------|
| `ZHUXIAN_DB_*` | 诛仙世界观库连接（只读 RAG + WS0 起 user 书可写）。连接串由 `db/index.ts` 的 `buildConnString()` 拼接：缺省 host=localhost/port=5432/user=postgres/pass=空/库名=novel_db；连接池 `max=5` |
| `CREATIVE_DB_*` | 创作工作库连接（读写，`pnpm db:init` 自动建表）。缺省库名 novel_studio；连接池 `max=10`，idle_timeout 20s、connect_timeout 10s |
| `LLM_BASE_URL` | 任意 OpenAI-compatible API 地址 |
| `LLM_WRITER_MODEL` | 写作步骤专用模型（质量关键步可配思考模型，审计/修订用默认快模型） |
| `LLM_FALLBACK_MODELS` | 首选模型失败后逐个切换的备用模型清单（401 不触发切换） |
| `QUEUE_CONCURRENCY` | 生成队列并发数；默认 1 保证顺序生成（后章吃到前章摘要）。代码 `Math.max(1, Number(env) || 1)` 下限保护 |
| 项目级覆盖 | 每个项目可在 UI 中独立设置 baseUrl/apiKey/model（`creative_project.llm_config`），覆盖全局 |

## LLM 推荐配置

| 场景 | base_url | model | 说明 |
|------|----------|-------|------|
| 本地离线 | http://localhost:11434/v1 | qwen2.5:14b | Ollama 运行，免费 |
| 高质量 | https://api.deepseek.com | deepseek-chat | DeepSeek，性价比高 |
| 最强 | https://api.openai.com/v1 | gpt-4o | OpenAI，效果最好 |

> 本地 Ollama 建议 14B 以下模型；生成速度取决于 LLM 响应速度。

## 环境模式

| 模式 | 命令 | 行为 |
|------|------|------|
| dev（开发） | `pnpm dev` | tsx watch 热重载 + Vite HMR |
| prod（生产） | `pnpm build` | shared → server（tsc）→ web（tsc + vite build），产物在 `dist/` |
| 增量 DDL | `node scripts/init-db.mjs` | 幂等；各模块增量 DDL 见 `scripts/ddl-*.sql`（均幂等，可重复执行） |

## 数据库初始化

- 创作库 56 张表由 Drizzle schema 定义，`scripts/init-db.mjs` 统一创建；`start.bat` 会自动执行。
- 增量模块建表/加列脚本：`scripts/ddl-*.sql`（如 `ddl-growth-workshop.sql`、`ddl-scene-branch.sql`、`ddl-writing-quality.sql`、`ddl-benchmark-book.sql`、`ddl-deprecated-fields.sql`），均幂等。
- 诛仙库由外部导入（不在本仓库 DDL 管理内），需预装 pgvector 扩展。

## 健康检查

```bash
curl http://localhost:3456/api/health
# → {"success":true,"data":{"status":"ok","timestamp":"...","uptime":...}}
```

设置页还有 `GET /api/settings/db-status` 查看双库连接状态、`POST /api/settings/test-llm` 测试 LLM 连通性。

## 常见问题

- **诛仙库连接失败**：确认 PostgreSQL 运行、`.env` 的 `ZHUXIAN_DB_*` 正确、诛仙库已安装 pgvector。
- **生成速度慢**：取决于 LLM 响应；本地用 14B 以下模型，云端检查网络。
- **生成内容与设定不一致**：① 章节计划 `required_entity_ids` 是否正确指定；② 诛仙库实体数据是否完整；③ 在「作者规则」中添加硬约束。
- **更换 LLM**：改 `.env` 重启后端，或「设置」页面在线修改（项目级覆盖）。
