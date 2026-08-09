-- 仙侠人物判词生成 Skill：custom_character 表新增判词字段（幂等）
-- verdict_poem    人物判词（四句七言绝句，换行分隔）
-- verdict_comment 人物考语（情榜风格，二字+情）
ALTER TABLE custom_character
  ADD COLUMN IF NOT EXISTS verdict_poem varchar(128),
  ADD COLUMN IF NOT EXISTS verdict_comment varchar(16);

COMMENT ON COLUMN custom_character.verdict_poem IS '人物判词（七言绝句，换行分隔）';
COMMENT ON COLUMN custom_character.verdict_comment IS '人物考语（情榜风格，二字+情）';
