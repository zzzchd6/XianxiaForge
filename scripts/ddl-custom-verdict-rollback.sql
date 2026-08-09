-- 判词字段回滚
ALTER TABLE custom_character
  DROP COLUMN IF EXISTS verdict_poem,
  DROP COLUMN IF EXISTS verdict_comment;
