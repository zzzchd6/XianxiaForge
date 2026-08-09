-- 自定义武器模块·文案生成Skill - 新表 weapon_lore
-- 一对多关联 custom_weapon，可保留多版本文案历史；is_current 标记当前生效版本。
-- 适配 PostgreSQL。

CREATE TABLE IF NOT EXISTS weapon_lore (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  weapon_id BIGINT NOT NULL REFERENCES custom_weapon(id) ON DELETE CASCADE,
  -- 生成名号（按门类/形制/底蕴创作）
  name VARCHAR(32) NOT NULL,
  -- 对外化名（敛藏锋芒时用，无则 NULL）
  fake_name VARCHAR(32),
  -- 一句话简介（25-40字，凝练有画面感）
  intro TEXT NOT NULL,
  -- 配套招式数组 [{name, desc}]，梯度：基础招→进阶招→特质招→杀招
  moves JSONB NOT NULL DEFAULT '[]',
  -- 当前生效版本（生成新文案时旧版本置 false）
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weapon_lore_weapon ON weapon_lore(weapon_id);
CREATE INDEX IF NOT EXISTS idx_weapon_lore_current ON weapon_lore(weapon_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_weapon_lore_project ON weapon_lore(project_id);
