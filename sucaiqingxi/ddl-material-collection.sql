
-- =============================================================
-- 剧情素材·收藏/已用状态 · 加列脚本（创作库 novel_studio）
-- 配套改造 7.2：给 4 张剧情素材表加「收藏」「最近使用章节」两列，
--   支撑召回加权（收藏优先）与近期已用惩罚（避免素材重复使用）。
-- 字段：
--   is_collected      BOOLEAN  作者收藏标记（true=召回加权 +0.08）
--   last_used_chapter INTEGER  最近一次被采用的章节号（用于近期已用惩罚）
-- 特性：可重复执行（ADD COLUMN IF NOT EXISTS 幂等保护），不破坏存量数据
-- =============================================================

ALTER TABLE plot_material_encounter   ADD COLUMN IF NOT EXISTS is_collected BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plot_material_encounter   ADD COLUMN IF NOT EXISTS last_used_chapter INTEGER;

ALTER TABLE plot_material_foreshadow  ADD COLUMN IF NOT EXISTS is_collected BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plot_material_foreshadow  ADD COLUMN IF NOT EXISTS last_used_chapter INTEGER;

ALTER TABLE plot_material_highlight   ADD COLUMN IF NOT EXISTS is_collected BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plot_material_highlight   ADD COLUMN IF NOT EXISTS last_used_chapter INTEGER;

ALTER TABLE plot_material_task        ADD COLUMN IF NOT EXISTS is_collected BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE plot_material_task        ADD COLUMN IF NOT EXISTS last_used_chapter INTEGER;
