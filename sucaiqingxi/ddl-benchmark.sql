-- =============================================================
-- 对标拆文库 · 建表脚本（创作库 novel_studio）
-- 拆文系统第一梯队：benchmark_book（书级）+ benchmark_item（节点级）1+1 表
-- 特性：可重复执行（IF NOT EXISTS 保护），不破坏存量数据
-- 约定对齐：与 creative_project 外键、部分索引 WHERE NOT is_deleted、
--          pgvector 512 维 cosine（与诛仙库 bge-small-zh-v1.5 同源）
--
-- 设计要点（元评估裁定）：
--   - 否决 5 库独立存储 → 1+1 表，item_type 枚举表达全部库语义
--   - 原文定位三字段：chapter_idx / char_start / char_end
--   - 起承转合比例落数值列（可 SQL 过滤），情绪曲线落 NUMERIC[]（可曲线比较）
--   - source_snippet 仅后台可见，禁止进写作上下文（红线同 plot_material_*）
--
-- item_type 枚举语义：
--   skeleton  骨架级节点（章/卷的起承转合结构单元）
--   plot      情节级单元（可跨世界观复用的剧情模式）
--   variable  变量级要素（人设/金手指/地图等可替换变量，三梯队）
--   arc       长篇级节点（跨章伏笔/节奏抽样，二梯队）
-- =============================================================

-- pgvector 扩展（幂等）。若已由诛仙库初始化则跳过。
CREATE EXTENSION IF NOT EXISTS vector;

-- -------------------------------------------------------------
-- 1) benchmark_book：对标书目（一本 TXT 一行）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS benchmark_book (
  id              BIGSERIAL PRIMARY KEY,
  project_id      BIGINT REFERENCES creative_project(id) ON DELETE CASCADE, -- NULL=全局共享
  title           VARCHAR(200) NOT NULL,           -- 作品名
  author          VARCHAR(100),                    -- 作者
  source_path     TEXT,                            -- 源 TXT 绝对路径
  total_chapters  INT NOT NULL DEFAULT 0,          -- 切分出的章节数
  total_chars     BIGINT NOT NULL DEFAULT 0,       -- 清洗后总字数
  status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|analyzing|partial|done
  summary         TEXT,                            -- 全书骨架综述（抽象化，禁专名）
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 2) benchmark_item：拆解节点（骨架/情节/变量/长篇统一存储）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS benchmark_item (
  id              BIGSERIAL PRIMARY KEY,
  book_id         BIGINT NOT NULL REFERENCES benchmark_book(id) ON DELETE CASCADE,
  project_id      BIGINT REFERENCES creative_project(id) ON DELETE CASCADE, -- 冗余自书，便于 RAG 作用域过滤
  item_type       VARCHAR(20) NOT NULL CHECK (item_type IN ('skeleton','plot','variable','arc')),
  chapter_idx     INT,                             -- 所属章序号（1 起；NULL=全书/卷级）
  char_start      INT,                             -- 原文字符偏移起（含）
  char_end        INT,                             -- 原文字符偏移止（不含）
  title           VARCHAR(200) NOT NULL,           -- 抽象化标题（禁专名）
  content         TEXT NOT NULL,                   -- 抽象化模式正文（参与向量化，禁专名）
  setup_ratio     NUMERIC(5,4),                    -- 起 占比（0-1）
  develop_ratio   NUMERIC(5,4),                    -- 承 占比
  turn_ratio      NUMERIC(5,4),                    -- 转 占比
  resolve_ratio   NUMERIC(5,4),                    -- 合 占比
  emotion_curve   NUMERIC[],                       -- 情绪曲线数值序列（可曲线比较）
  hook            TEXT,                            -- 钩子/悬念手法描述
  material_type   VARCHAR(20),                     -- 二梯队：情节节点对应的素材类型 encounter|foreshadow|highlight|task（回流分表依据）
  reflux_material_id BIGINT,                       -- 二梯队：已回流素材表的行 id（NULL=未回流，幂等依据）
  tags            TEXT[] DEFAULT '{}',
  quality_score   INT DEFAULT 0,                   -- 质量分 1-10
  source_snippet  VARCHAR(300),                    -- 原文片段（仅后台可见，禁止进写作上下文）
  embedding       VECTOR(512),                     -- content 的 512 维向量（bge-small-zh-v1.5, 归一化, cosine）
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- =============================================================
-- 索引
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_bench_book_project ON benchmark_book(project_id) WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS idx_bench_item_book     ON benchmark_item(book_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_bench_item_type     ON benchmark_item(item_type);
CREATE INDEX IF NOT EXISTS idx_bench_item_project  ON benchmark_item(project_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_bench_item_chapter  ON benchmark_item(book_id, chapter_idx);
CREATE INDEX IF NOT EXISTS idx_bench_item_tags     ON benchmark_item USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_bench_item_embedding ON benchmark_item USING hnsw (embedding vector_cosine_ops);

-- =============================================================
-- 完成。验证：
--   \d+ benchmark_book
--   \d+ benchmark_item
-- =============================================================
