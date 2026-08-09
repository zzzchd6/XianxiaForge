-- ============================================================
-- v1.4 第三期：角色记忆卡（状态注入修复后的增量）
-- 回滚：DROP TABLE IF EXISTS character_memory_card;
-- ============================================================

CREATE TABLE IF NOT EXISTS character_memory_card (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  character_id BIGINT NOT NULL,
  event_summary TEXT NOT NULL,
  chapter_no INTEGER,
  emotional_impact TEXT,
  importance VARCHAR(20) NOT NULL DEFAULT 'normal',
  source VARCHAR(20) NOT NULL DEFAULT 'auto',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE character_memory_card IS '角色记忆卡：人物级经历/记忆摘要，auto=自动抽取低置信，manual=人工确认';

CREATE INDEX IF NOT EXISTS idx_char_memory_project_char ON character_memory_card (project_id, character_id);
