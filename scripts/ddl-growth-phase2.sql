-- 模块9二期：突破叙事字段
-- 为 custom_skill_lib 和 custom_magic_item_lib 添加 breakthrough_narrative 列
-- 存储进化/融合时生成的300-500字突破场景片段，供写作时引用

ALTER TABLE custom_skill_lib ADD COLUMN IF NOT EXISTS breakthrough_narrative TEXT;
ALTER TABLE custom_magic_item_lib ADD COLUMN IF NOT EXISTS breakthrough_narrative TEXT;
