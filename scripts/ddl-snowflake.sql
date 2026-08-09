-- 开源借鉴 PRD v1.1 M7（雪花法渐进大纲）：creative_project 增加渐进向导中间态草稿字段
ALTER TABLE creative_project ADD COLUMN IF NOT EXISTS snowflake_draft jsonb;
COMMENT ON COLUMN creative_project.snowflake_draft IS '雪花法渐进大纲中间态草稿 {step,premise,theme,characters,volumes}，finalize 后置空';
