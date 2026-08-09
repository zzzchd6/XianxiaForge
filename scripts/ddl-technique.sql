-- ============================================================
-- 自定义功法模块 DDL（幂等存档）
-- 设计决策：独立 custom_technique 表，不接入 6 档品级（无 grade 字段）；
-- 配套神通按道境四档（入微/化境/合道/超脱）存于 abilities.daoRealm。
-- 执行方式：packages/server 下 tsx 临时脚本调用 creativeClient.unsafe（见管线 Step 3）。
-- ============================================================

CREATE TABLE IF NOT EXISTS custom_technique (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  name VARCHAR(32) NOT NULL,
  main_dao VARCHAR(32) NOT NULL,
  assist_dao JSONB NOT NULL DEFAULT '[]',
  guidance_depth VARCHAR(16) NOT NULL,
  fake_depth VARCHAR(16),
  style_type VARCHAR(16) NOT NULL,
  threshold JSONB NOT NULL DEFAULT '{}',
  core_traits JSONB NOT NULL DEFAULT '[]',
  practice_path VARCHAR(32) NOT NULL,
  body_mark JSONB NOT NULL DEFAULT '{}',
  usage_skills JSONB NOT NULL DEFAULT '[]',
  abilities JSONB NOT NULL DEFAULT '[]',
  backlash JSONB NOT NULL DEFAULT '[]',
  inheritance VARCHAR(32) NOT NULL,
  evolution JSONB NOT NULL DEFAULT '[]',
  inherent_conflict VARCHAR(32),
  core_direction JSONB NOT NULL DEFAULT '[]',
  fit_monk JSONB NOT NULL DEFAULT '[]',
  description TEXT,
  growth_type VARCHAR(20) NOT NULL DEFAULT 'base',
  base_entity_id BIGINT,
  source_entity_ids JSONB DEFAULT '[]',
  linked_character_ids JSONB DEFAULT '[]',
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_technique_project ON custom_technique(project_id);
CREATE INDEX IF NOT EXISTS idx_technique_project_alive ON custom_technique(project_id, is_deleted);

CREATE TABLE IF NOT EXISTS character_technique_variant (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  character_id BIGINT NOT NULL REFERENCES custom_character(id) ON DELETE CASCADE,
  base_technique_id BIGINT NOT NULL REFERENCES custom_technique(id) ON DELETE CASCADE,
  variant_name VARCHAR(48) NOT NULL,
  rarity VARCHAR(16) NOT NULL,
  dao_weight_offset JSONB NOT NULL DEFAULT '{}',
  trait_offset JSONB NOT NULL DEFAULT '[]',
  ability_variant JSONB NOT NULL DEFAULT '[]',
  backlash_offset JSONB NOT NULL DEFAULT '[]',
  body_mark JSONB NOT NULL DEFAULT '{}',
  exclusive_skill JSONB NOT NULL DEFAULT '[]',
  cultivation_effect JSONB NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_variant_character ON character_technique_variant(character_id);
CREATE INDEX IF NOT EXISTS idx_variant_technique ON character_technique_variant(base_technique_id);
