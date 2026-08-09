-- ============================================================
-- 金句库质量升级与智能美化（需求11）
-- project_quote_lib 新增字段：原始文本/美化版本/多维评分/分级/美化状态
-- 执行库：novel_studio（创作库）
-- ============================================================

ALTER TABLE project_quote_lib ADD COLUMN IF NOT EXISTS original_text TEXT;
ALTER TABLE project_quote_lib ADD COLUMN IF NOT EXISTS polished_text TEXT;
ALTER TABLE project_quote_lib ADD COLUMN IF NOT EXISTS polished_versions JSONB DEFAULT '[]';
ALTER TABLE project_quote_lib ADD COLUMN IF NOT EXISTS scores JSONB DEFAULT '{}';
ALTER TABLE project_quote_lib ADD COLUMN IF NOT EXISTS grade VARCHAR(16) DEFAULT 'good';
ALTER TABLE project_quote_lib ADD COLUMN IF NOT EXISTS polish_status VARCHAR(16) DEFAULT 'none';
ALTER TABLE project_quote_lib ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP;

COMMENT ON COLUMN project_quote_lib.original_text IS '原始文本（美化前，用于回写正文时定位原句）';
COMMENT ON COLUMN project_quote_lib.polished_text IS '当前选中的美化版本（推荐版）';
COMMENT ON COLUMN project_quote_lib.polished_versions IS '3个美化版本 [{style,text,note}] style=conservative/balanced/deep';
COMMENT ON COLUMN project_quote_lib.scores IS '五维评分 {imagery,rhythm,philosophy,emotion,viral,total} 各20分';
COMMENT ON COLUMN project_quote_lib.grade IS '质量分级：legendary传世级(≥90)/good精品级(80-89)/candidate待打磨(70-79)';
COMMENT ON COLUMN project_quote_lib.polish_status IS '美化状态：none未处理/polished已美化/applied已应用正文';
COMMENT ON COLUMN project_quote_lib.applied_at IS '应用到正文的时间';

-- 旧数据迁移：按旧 quality_score 重映射 grade（一次性脚本，重复执行无副作用）
-- 注意：project_quote_lib 无 is_deleted 列，不可引用
UPDATE project_quote_lib SET original_text = quote_text WHERE original_text IS NULL;
UPDATE project_quote_lib
SET grade = CASE
  WHEN quality_score >= 90 THEN 'legendary'
  WHEN quality_score >= 80 THEN 'good'
  ELSE 'candidate'
END
WHERE quality_score IS NOT NULL AND (scores IS NULL OR scores = '{}');
UPDATE project_quote_lib
SET scores = jsonb_build_object('total', quality_score)
WHERE (scores IS NULL OR scores = '{}') AND quality_score IS NOT NULL;
