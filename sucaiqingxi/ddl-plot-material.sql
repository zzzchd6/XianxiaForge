-- =============================================================
-- 网文剧情素材库 · 建表脚本（创作库 novel_studio）
-- 4 张结构完全对称的素材表 + 索引 + 512 维 HNSW 向量索引
-- 特性：可重复执行（IF NOT EXISTS 保护），不破坏存量数据
-- 约定对齐：与 creative_project 外键、部分索引 WHERE NOT is_deleted、
--          pgvector 512 维 cosine（与诛仙库 bge-small-zh-v1.5 同源）
--
-- 表清单：
--   plot_material_encounter   奇遇类剧情素材
--   plot_material_foreshadow  伏笔手法素材
--   plot_material_highlight   人物高光时刻素材
--   plot_material_task        剧情任务链素材
--
-- 隔离粒度：project_id 可空。NULL = 全局共享素材（所有项目召回可用）；
--          非空 = 归属某创作项目（随项目删除级联清理）。
-- =============================================================

-- pgvector 扩展（幂等）。若已由诛仙库初始化则跳过。
CREATE EXTENSION IF NOT EXISTS vector;

-- -------------------------------------------------------------
-- 1) 奇遇：主角因偶然/被迫/意外触发的非常规事件 → 重大收益或转折
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plot_material_encounter (
  id                    BIGSERIAL PRIMARY KEY,
  project_id            BIGINT REFERENCES creative_project(id) ON DELETE CASCADE, -- NULL=全局共享
  title                 VARCHAR(200) NOT NULL,          -- 一句话概括
  core_plot             TEXT NOT NULL,                  -- 抽象化剧情模式（触发→经过→结果），参与向量化
  trigger_condition     TEXT,                           -- 触发前提
  reward                TEXT,                           -- 主角获得什么
  cost_or_risk          TEXT,                           -- 代价或后续风险
  emotional_beat        TEXT,                           -- 情绪曲线
  applicable_scene_type VARCHAR(50),                    -- key | transition | foreshadow（对齐 scene_node.scene_type）
  tags                  TEXT[] DEFAULT '{}',            -- 标签
  quality_score         INT DEFAULT 0,                  -- 质量分 1-10
  source_work           VARCHAR(100),                   -- 来源作品名
  source_snippet        VARCHAR(300),                   -- 原文片段（仅后台可见，禁止进写作上下文）
  embedding             VECTOR(512),                    -- core_plot 的 512 维向量（bge-small-zh-v1.5, 归一化, cosine）
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE, -- 逻辑删除
  created_at            TIMESTAMP DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 2) 伏笔手法：如何埋线、如何呼应、如何回收的可复用手法
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plot_material_foreshadow (
  id                    BIGSERIAL PRIMARY KEY,
  project_id            BIGINT REFERENCES creative_project(id) ON DELETE CASCADE,
  title                 VARCHAR(200) NOT NULL,
  core_plot             TEXT NOT NULL,
  trigger_condition     TEXT,
  reward                TEXT,
  cost_or_risk          TEXT,
  emotional_beat        TEXT,
  applicable_scene_type VARCHAR(50),
  tags                  TEXT[] DEFAULT '{}',
  quality_score         INT DEFAULT 0,
  source_work           VARCHAR(100),
  source_snippet        VARCHAR(300),
  embedding             VECTOR(512),
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMP DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 3) 人物高光时刻：角色魅力集中爆发的名场面模式
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plot_material_highlight (
  id                    BIGSERIAL PRIMARY KEY,
  project_id            BIGINT REFERENCES creative_project(id) ON DELETE CASCADE,
  title                 VARCHAR(200) NOT NULL,
  core_plot             TEXT NOT NULL,
  trigger_condition     TEXT,
  reward                TEXT,
  cost_or_risk          TEXT,
  emotional_beat        TEXT,
  applicable_scene_type VARCHAR(50),
  tags                  TEXT[] DEFAULT '{}',
  quality_score         INT DEFAULT 0,
  source_work           VARCHAR(100),
  source_snippet        VARCHAR(300),
  embedding             VECTOR(512),
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMP DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 4) 剧情任务链：多阶段推进的任务/目标驱动型剧情结构
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plot_material_task (
  id                    BIGSERIAL PRIMARY KEY,
  project_id            BIGINT REFERENCES creative_project(id) ON DELETE CASCADE,
  title                 VARCHAR(200) NOT NULL,
  core_plot             TEXT NOT NULL,
  trigger_condition     TEXT,
  reward                TEXT,
  cost_or_risk          TEXT,
  emotional_beat        TEXT,
  applicable_scene_type VARCHAR(50),
  tags                  TEXT[] DEFAULT '{}',
  quality_score         INT DEFAULT 0,
  source_work           VARCHAR(100),
  source_snippet        VARCHAR(300),
  embedding             VECTOR(512),
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMP DEFAULT NOW()
);

-- =============================================================
-- 索引：每张表各一套（项目索引 / 场景类型索引 / 标签 GIN / 向量 HNSW）
-- HNSW 参数用 pgvector 默认（m=16, ef_construction=64），小数据量足够。
-- =============================================================

-- plot_material_encounter
CREATE INDEX IF NOT EXISTS idx_encounter_project    ON plot_material_encounter(project_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_encounter_scene_type ON plot_material_encounter(applicable_scene_type);
CREATE INDEX IF NOT EXISTS idx_encounter_tags       ON plot_material_encounter USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_encounter_embedding  ON plot_material_encounter USING hnsw (embedding vector_cosine_ops);

-- plot_material_foreshadow
CREATE INDEX IF NOT EXISTS idx_foreshadow_project    ON plot_material_foreshadow(project_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_foreshadow_scene_type ON plot_material_foreshadow(applicable_scene_type);
CREATE INDEX IF NOT EXISTS idx_foreshadow_tags       ON plot_material_foreshadow USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_foreshadow_embedding  ON plot_material_foreshadow USING hnsw (embedding vector_cosine_ops);

-- plot_material_highlight
CREATE INDEX IF NOT EXISTS idx_highlight_project    ON plot_material_highlight(project_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_highlight_scene_type ON plot_material_highlight(applicable_scene_type);
CREATE INDEX IF NOT EXISTS idx_highlight_tags       ON plot_material_highlight USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_highlight_embedding  ON plot_material_highlight USING hnsw (embedding vector_cosine_ops);

-- plot_material_task
CREATE INDEX IF NOT EXISTS idx_task_project    ON plot_material_task(project_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_task_scene_type ON plot_material_task(applicable_scene_type);
CREATE INDEX IF NOT EXISTS idx_task_tags       ON plot_material_task USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_task_embedding  ON plot_material_task USING hnsw (embedding vector_cosine_ops);

-- =============================================================
-- 完成。验证：
--   \d+ plot_material_encounter
--   SELECT count(*) FROM plot_material_encounter;
-- =============================================================
