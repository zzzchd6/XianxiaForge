-- ============================================================
-- 指尖仙侠 自定义人物模块 DDL 回滚脚本
-- 执行目标库: novel_studio (创作库)
-- 删除 custom_character 表及索引（不可恢复，执行前请确认）
-- ============================================================

DROP INDEX IF EXISTS idx_custom_character_project;
DROP TABLE IF EXISTS custom_character;
