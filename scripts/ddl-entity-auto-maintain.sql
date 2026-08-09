-- ============================================================
-- 自定义实体自动维护（09-需求规格说明书 v1.0 / 性价比评估 20260803）
-- 三张 custom 表各加两字段：
--   entity_status: official=用户正式创建 / draft=AI自动提取待补充
--   chapter_updates: 章节动态数组 [{chapterNo, volumeNo, updateText, category, extractedAt}]
-- 另补 is_deleted 列默认值（历史隐患，评估文档确认一并修复）
-- 幂等：全部 IF NOT EXISTS，可重复执行
-- ============================================================

ALTER TABLE custom_character ADD COLUMN IF NOT EXISTS entity_status VARCHAR(16) NOT NULL DEFAULT 'official';
ALTER TABLE custom_character ADD COLUMN IF NOT EXISTS chapter_updates JSONB NOT NULL DEFAULT '[]';
ALTER TABLE custom_character ALTER COLUMN is_deleted SET DEFAULT false;

ALTER TABLE custom_weapon ADD COLUMN IF NOT EXISTS entity_status VARCHAR(16) NOT NULL DEFAULT 'official';
ALTER TABLE custom_weapon ADD COLUMN IF NOT EXISTS chapter_updates JSONB NOT NULL DEFAULT '[]';
ALTER TABLE custom_weapon ALTER COLUMN is_deleted SET DEFAULT false;

ALTER TABLE custom_technique ADD COLUMN IF NOT EXISTS entity_status VARCHAR(16) NOT NULL DEFAULT 'official';
ALTER TABLE custom_technique ADD COLUMN IF NOT EXISTS chapter_updates JSONB NOT NULL DEFAULT '[]';
ALTER TABLE custom_technique ALTER COLUMN is_deleted SET DEFAULT false;

COMMENT ON COLUMN custom_character.entity_status IS '实体状态：official=用户正式创建, draft=AI自动提取待补充';
COMMENT ON COLUMN custom_weapon.entity_status IS '实体状态：official=用户正式创建, draft=AI自动提取待补充';
COMMENT ON COLUMN custom_technique.entity_status IS '实体状态：official=用户正式创建, draft=AI自动提取待补充';

-- 回滚（谨慎执行，会丢失草稿与章节动态数据）：
-- ALTER TABLE custom_character DROP COLUMN IF EXISTS entity_status;
-- ALTER TABLE custom_character DROP COLUMN IF EXISTS chapter_updates;
-- ALTER TABLE custom_weapon DROP COLUMN IF EXISTS entity_status;
-- ALTER TABLE custom_weapon DROP COLUMN IF EXISTS chapter_updates;
-- ALTER TABLE custom_technique DROP COLUMN IF EXISTS entity_status;
-- ALTER TABLE custom_technique DROP COLUMN IF EXISTS chapter_updates;
