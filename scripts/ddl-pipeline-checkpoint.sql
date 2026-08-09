-- 架构升级 Epic1：管线检查点表（节点化+断点续跑）
CREATE TABLE IF NOT EXISTS pipeline_checkpoint (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT REFERENCES generation_task(id) ON DELETE CASCADE,
  step_name VARCHAR(64) NOT NULL,
  step_order INTEGER NOT NULL DEFAULT 0,
  step_data JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  token_input INTEGER NOT NULL DEFAULT 0,
  token_output INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_checkpoint_task ON pipeline_checkpoint(task_id, step_order);
