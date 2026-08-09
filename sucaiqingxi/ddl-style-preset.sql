-- =============================================================
-- 作者文风预设表 · 建表脚本（创作库 novel_studio）
-- 用途：文风蒸馏工具 distill_style.py 的落库目标，一套风格一行，
--       可被 Novel Studio 文风档位功能直接读取使用。
--
-- 设计对齐：字段命名 1:1 参考诛仙原著库 public.style_global_config
--          （萧鼎仙侠文风基准表），仅把隔离键 book_id 换成 project_id，
--          使 Node 侧读取诛仙文风表的同一套字段即可读本表（drop-in 复用）。
-- 边界：本表建在创作库 novel_studio，诛仙原著库只读、不做任何修改。
--
-- 隔离粒度：project_id 可空。NULL = 全局共享文风（所有项目可用）；
--          非空 = 归属某创作项目（随项目删除级联清理）。
-- 特性：可重复执行（IF NOT EXISTS / 幂等），不破坏存量数据。
-- =============================================================

-- pgvector 扩展（幂等）。若已由诛仙库/剧情素材库初始化则跳过。
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS style_preset (
  id                  BIGSERIAL PRIMARY KEY,
  project_id          BIGINT REFERENCES creative_project(id) ON DELETE CASCADE, -- NULL=全局共享
  style_name          VARCHAR(100) NOT NULL,             -- 预设名（幂等键，如“忘语·凡人流”）
  author              VARCHAR(100),                      -- 作者
  source_works        TEXT[] DEFAULT '{}',               -- 蒸馏样本作品列表

  -- ---- 6 大风格维度（列名对齐诛仙 style_global_config）----
  mental_models       TEXT[]  DEFAULT '{}',  -- 维度1 核心创作心智：底层叙事原则/审美偏好
  decision_heuristics TEXT[]  DEFAULT '{}',  -- 维度1 决策启发式：遇到情节如何取舍
  description_ratio   JSONB   DEFAULT '{}',  -- 维度2 描写比例与节奏：场景/动作/对话/心理占比 + 节奏松紧
  sentence_rules      JSONB   DEFAULT '{}',  -- 维度3 句式与段落：平均句长/句式偏好/段落/过渡/修辞
  core_imagery        TEXT[]  DEFAULT '{}',  -- 维度4 专属意象库
  forbidden_words     TEXT[]  DEFAULT '{}',  -- 维度4 禁用表达
  perspective_rules   TEXT[]  DEFAULT '{}',  -- 维度5 视角与叙事规则：视角严格度/信息差/心理边界
  anti_patterns       TEXT[]  DEFAULT '{}',  -- 维度6 避坑与反模式：绝不出现的写法/烂大街表达

  -- ---- 蒸馏元数据 ----
  local_stats         JSONB   DEFAULT '{}',  -- 本地零成本量化统计（句长/对话占比/四字密度等），与 LLM 双向校准
  confidence          NUMERIC(5,2) DEFAULT 0,-- 风格置信度 0-100
  quality_score       INT     DEFAULT 0,     -- 质量分 1-10
  sample_word_count   INT     DEFAULT 0,     -- 有效样本字数（不足会告警）

  -- ---- 扩展预留 ----
  category            VARCHAR(50),           -- 预留：自定义文风分类（如“仙侠/悬疑/都市”）
  ext                 JSONB   DEFAULT '{}',  -- 预留：高频词/修辞明细/未来扩展键

  embedding           VECTOR(512),           -- 可空：风格摘要向量，供“相似文风召回”预留
  verify_status       VARCHAR(20) NOT NULL DEFAULT 'auto', -- 审核态（对齐诛仙约定）
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  "version"           INT NOT NULL DEFAULT 1,
  create_time         TIMESTAMP DEFAULT NOW(),
  update_time         TIMESTAMP DEFAULT NOW(),

  CONSTRAINT chk_style_preset_verify
    CHECK (verify_status IN ('auto', 'pending', 'approved', 'rejected'))
);

-- 幂等键：全局态与项目态分别唯一，规避 NULL 唯一性陷阱
CREATE UNIQUE INDEX IF NOT EXISTS uk_style_preset_global
  ON style_preset (style_name) WHERE project_id IS NULL AND NOT is_deleted;
CREATE UNIQUE INDEX IF NOT EXISTS uk_style_preset_project
  ON style_preset (project_id, style_name) WHERE project_id IS NOT NULL AND NOT is_deleted;

-- 常用检索索引
CREATE INDEX IF NOT EXISTS idx_style_preset_project  ON style_preset (project_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_style_preset_author   ON style_preset (author)     WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_style_preset_category ON style_preset (category)   WHERE NOT is_deleted;
-- 可空向量的 HNSW 索引（cosine）；仅对非空 embedding 建索引
CREATE INDEX IF NOT EXISTS idx_style_preset_embedding
  ON style_preset USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;

-- =============================================================
-- 完成。验证：
--   \d+ style_preset
--   SELECT style_name, author, quality_score, sample_word_count FROM style_preset;
-- =============================================================
