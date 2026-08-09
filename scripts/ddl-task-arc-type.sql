-- ============================================================
-- 13-五模块体验优化 US-21a：征途录任务类型字段（主线/支线/隐藏/机缘）
-- 回滚：ALTER TABLE task_arc DROP COLUMN IF EXISTS task_type;
-- ============================================================

ALTER TABLE task_arc ADD COLUMN IF NOT EXISTS task_type VARCHAR(12);

COMMENT ON COLUMN task_arc.task_type IS '任务类型: main(主线) / side(支线) / hidden(隐藏) / fortune(机缘)，手动创建可为空';
