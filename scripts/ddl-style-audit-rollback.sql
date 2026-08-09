-- ============================================================
-- 指尖仙侠 章节文风校验功能 回滚脚本（需求13）
-- 执行目标库: novel_studio (创作库)
-- 删除 style_audit_record 表，恢复原状
-- 注意：会永久删除该表内的全部校验记录，执行前请确认
-- ============================================================

DROP INDEX IF EXISTS idx_style_audit_chapter;
DROP TABLE IF EXISTS style_audit_record;
