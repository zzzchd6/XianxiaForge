-- ============================================================
-- 分支衍生伏笔与前置回填系统（P2）
-- 目标库：novel_studio (creativeDb)
-- 执行：pnpm exec tsx ../../scripts/run-ddl-foreshadow-branch.ts
-- 说明：全部为 ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS，
--       幂等且兼容存量数据（存量默认 source_type='manual', is_confirmed=true）
-- ============================================================

-- 伏笔表新增字段
ALTER TABLE foreshadow_thread ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE foreshadow_thread ADD COLUMN IF NOT EXISTS source_branch_option_id BIGINT NULL;
ALTER TABLE foreshadow_thread ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE foreshadow_thread ADD COLUMN IF NOT EXISTS backfill_method VARCHAR(20) NULL;
ALTER TABLE foreshadow_thread ADD COLUMN IF NOT EXISTS backfill_target_chapter_id BIGINT NULL;

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_foreshadow_source_type ON foreshadow_thread(project_id, source_type);
CREATE INDEX IF NOT EXISTS idx_foreshadow_branch_source ON foreshadow_thread(source_branch_option_id);
