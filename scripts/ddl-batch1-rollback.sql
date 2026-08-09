-- 第一批 DDL 回滚脚本（novel_studio 创作库）
ALTER TABLE chapter_plan DROP COLUMN IF EXISTS must_have_events;
ALTER TABLE foreshadow_thread DROP COLUMN IF EXISTS hint_clue;
