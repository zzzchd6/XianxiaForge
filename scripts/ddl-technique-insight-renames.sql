-- 13-SRS US-20e：天机独悟神通改名（展示时覆盖预设神通名）
ALTER TABLE custom_technique ADD COLUMN IF NOT EXISTS insight_renames jsonb NOT NULL DEFAULT '[]';
COMMENT ON COLUMN custom_technique.insight_renames IS '天机独悟神通改名 [{id,newName}]（13-SRS US-20e）';
