-- 模块9：功法/法宝成长工坊 - 3张新表
-- custom_skill_lib / custom_magic_item_lib / entity_growth_record

CREATE TABLE IF NOT EXISTS custom_skill_lib (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  grade VARCHAR(20) NOT NULL DEFAULT '黄阶',
  grade_level INTEGER NOT NULL DEFAULT 1,
  skill_type VARCHAR(50),
  core_effect TEXT,
  effects JSONB NOT NULL DEFAULT '[]',
  side_effects TEXT,
  description TEXT,
  growth_type VARCHAR(20) NOT NULL DEFAULT 'base',
  base_entity_id BIGINT,
  source_entity_ids JSONB DEFAULT '[]',
  evolution_stage VARCHAR(30),
  is_evolved BOOLEAN NOT NULL DEFAULT FALSE,
  linked_character_ids JSONB DEFAULT '[]',
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_magic_item_lib (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  grade VARCHAR(20) NOT NULL DEFAULT '黄阶',
  grade_level INTEGER NOT NULL DEFAULT 1,
  item_type VARCHAR(50),
  core_abilities TEXT,
  effects JSONB NOT NULL DEFAULT '[]',
  side_effects TEXT,
  description TEXT,
  growth_type VARCHAR(20) NOT NULL DEFAULT 'base',
  base_entity_id BIGINT,
  source_entity_ids JSONB DEFAULT '[]',
  evolution_stage VARCHAR(30),
  is_evolved BOOLEAN NOT NULL DEFAULT FALSE,
  linked_character_ids JSONB DEFAULT '[]',
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entity_growth_record (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  entity_type VARCHAR(20) NOT NULL,
  entity_id BIGINT NOT NULL,
  operation_type VARCHAR(20) NOT NULL,
  source_entity_ids JSONB DEFAULT '[]',
  before_snapshot JSONB NOT NULL,
  after_snapshot JSONB NOT NULL,
  result VARCHAR(20) NOT NULL,
  operator_note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_custom_skill_project ON custom_skill_lib(project_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_custom_item_project ON custom_magic_item_lib(project_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_growth_record_entity ON entity_growth_record(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_growth_record_project ON entity_growth_record(project_id);
