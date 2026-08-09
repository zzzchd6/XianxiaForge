-- DDL: Lorn.NovelWriteSkills 吸纳需求（批次1-3）
-- 需求4: chapter_plan.plot_fingerprint
-- 需求6: chapter_plan.hook_type / hook_intensity
-- 需求3: scene_node 施工卡字段

-- === 需求4: 桥段指纹 ===
ALTER TABLE chapter_plan ADD COLUMN IF NOT EXISTS plot_fingerprint VARCHAR(30);

-- === 需求6: 章末钩子 ===
ALTER TABLE chapter_plan ADD COLUMN IF NOT EXISTS hook_type VARCHAR(20);
ALTER TABLE chapter_plan ADD COLUMN IF NOT EXISTS hook_intensity VARCHAR(10);

-- === 需求3: 场景施工卡 ===
ALTER TABLE scene_node ADD COLUMN IF NOT EXISTS core_beat TEXT;
ALTER TABLE scene_node ADD COLUMN IF NOT EXISTS state_change JSONB DEFAULT '{}';
ALTER TABLE scene_node ADD COLUMN IF NOT EXISTS scene_hook_type VARCHAR(20);
ALTER TABLE scene_node ADD COLUMN IF NOT EXISTS rhythm_anchor VARCHAR(20);
ALTER TABLE scene_node ADD COLUMN IF NOT EXISTS scene_plot_fingerprint VARCHAR(30);
ALTER TABLE scene_node ADD COLUMN IF NOT EXISTS payoff_setup TEXT;
