-- 回滚 13-SRS US-20e：移除天机独悟神通改名列
ALTER TABLE custom_technique DROP COLUMN IF EXISTS insight_renames;
