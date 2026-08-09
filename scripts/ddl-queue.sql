-- ============================================================
-- 指尖仙侠 生成任务队列扩展 DDL（需求8）
-- 执行目标库: novel_studio (创作库)
-- 为 generation_task 增加批量队列字段，幂等可重复执行
-- ============================================================

ALTER TABLE generation_task ADD COLUMN IF NOT EXISTS position      INTEGER DEFAULT 0;
ALTER TABLE generation_task ADD COLUMN IF NOT EXISTS retry_count   INTEGER DEFAULT 0;
ALTER TABLE generation_task ADD COLUMN IF NOT EXISTS max_retries   INTEGER DEFAULT 3;
ALTER TABLE generation_task ADD COLUMN IF NOT EXISTS batch_id      VARCHAR(50);
ALTER TABLE generation_task ADD COLUMN IF NOT EXISTS queue_options JSONB;

-- 队列消费索引：按状态+排序位快速取待执行任务
CREATE INDEX IF NOT EXISTS idx_generation_task_queue
  ON generation_task (status, position, created_at);
