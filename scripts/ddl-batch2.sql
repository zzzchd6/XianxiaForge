-- ============================================================
-- 体验增强·第二批 DDL（模块3/6/8/11）
-- 纯增量：CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- 不触碰只读诛仙库；新表均 project_id 级联删除
-- ============================================================

-- 模块3：人物成长弧光卡点（项目级，character_id 引用诛仙库人物ID，只读引用不建外键）
CREATE TABLE IF NOT EXISTS character_growth_stage (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  character_id BIGINT,
  character_name TEXT,
  stage_no INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  chapter_start INTEGER,
  chapter_end INTEGER,
  traits JSONB DEFAULT '[]',
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_growth_stage_project_char ON character_growth_stage(project_id, character_id);

-- 模块8：人物关系动态推演（自定义关系表，不修改原生 lib_character_relation）
CREATE TABLE IF NOT EXISTS custom_character_relation (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  char_a_id BIGINT NOT NULL,
  char_b_id BIGINT NOT NULL,
  rel_type TEXT,
  rel_level INTEGER DEFAULT 0,
  description TEXT,
  interact_pattern TEXT,
  source_event TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_custom_rel_project ON custom_character_relation(project_id);

-- 模块11：项目金句/名场面素材库
CREATE TABLE IF NOT EXISTS project_quote_lib (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  chapter_id BIGINT,
  character_id BIGINT,
  character_name TEXT,
  quote_text TEXT NOT NULL,
  scene_desc TEXT,
  quality_score INTEGER,
  is_collected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quote_lib_project ON project_quote_lib(project_id, created_at DESC);

-- 模块6：单场景视角切换（段落多视角重写版本，jsonb 数组，不覆盖原文）
ALTER TABLE generated_chapter ADD COLUMN IF NOT EXISTS perspective_versions JSONB DEFAULT '[]';
