-- 自定义武器模块 - 新表 custom_weapon + 素材池合流层 scene_node_element.element_source
-- 适配 PostgreSQL。底蕴层级6档：凡造/灵淬/宝胎/道纹/仙蜕/神蕴。

CREATE TABLE IF NOT EXISTS custom_weapon (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  name VARCHAR(32) NOT NULL,
  category VARCHAR(32) NOT NULL,
  type VARCHAR(32) NOT NULL,
  grade VARCHAR(16) NOT NULL DEFAULT '凡造',
  grade_level INTEGER NOT NULL DEFAULT 1,
  fake_grade VARCHAR(16),
  base_material VARCHAR(32) NOT NULL,
  forge_traits JSONB NOT NULL DEFAULT '[]',
  soak_traits JSONB NOT NULL DEFAULT '[]',
  attach_traits JSONB NOT NULL DEFAULT '[]',
  cavity_traits JSONB NOT NULL DEFAULT '[]',
  soul_refine_level VARCHAR(16) NOT NULL DEFAULT 'none',
  core_direction JSONB NOT NULL DEFAULT '[]',
  growth_type VARCHAR(20) NOT NULL DEFAULT 'base',
  base_entity_id BIGINT,
  source_entity_ids JSONB DEFAULT '[]',
  evolution_stage VARCHAR(30),
  is_evolved BOOLEAN NOT NULL DEFAULT FALSE,
  linked_character_ids JSONB DEFAULT '[]',
  breakthrough_narrative TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_weapon_project ON custom_weapon(project_id) WHERE NOT is_deleted;

-- 素材池合流层：场景要素来源判别（native=诛仙库原生 / custom=创作库自定义）
-- 使自定义武器（及未来自定义功法/法宝）可拖入场景且 ID 不与原生撞车
ALTER TABLE scene_node_element ADD COLUMN IF NOT EXISTS element_source VARCHAR(16) NOT NULL DEFAULT 'native';
