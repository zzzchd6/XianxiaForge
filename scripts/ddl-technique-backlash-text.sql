-- ============================================================
-- 13-五模块体验优化 US-20d：功法动态反噬文本字段
-- backlash（jsonb 词条ID数组）保留，backlash_text 存 LLM 动态生成的反噬描述
-- 回滚：ALTER TABLE custom_technique DROP COLUMN IF EXISTS backlash_text;
-- ============================================================

ALTER TABLE custom_technique ADD COLUMN IF NOT EXISTS backlash_text TEXT;

COMMENT ON COLUMN custom_technique.backlash_text IS 'LLM动态生成的反噬代价描述（13-SRS US-20d，随功法保存不重复生成）';
