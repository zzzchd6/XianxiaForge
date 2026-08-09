-- 体验增强·第二批 DDL 回滚
DROP TABLE IF EXISTS project_quote_lib;
DROP TABLE IF EXISTS custom_character_relation;
DROP TABLE IF EXISTS character_growth_stage;
ALTER TABLE generated_chapter DROP COLUMN IF EXISTS perspective_versions;
