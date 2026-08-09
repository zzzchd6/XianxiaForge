-- ============================================================
-- 指尖仙侠 章节文风校验功能 DDL（需求13）
-- 执行目标库: novel_studio (创作库)
-- 新增 style_audit_record 文风校验记录表
-- 幂等可重复执行
-- ============================================================

-- 文风校验记录表：对已生成章节手动触发专项文风审计的结果存档
CREATE TABLE IF NOT EXISTS style_audit_record (
  id                 BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  chapter_plan_id    BIGINT NOT NULL REFERENCES chapter_plan(id) ON DELETE CASCADE,
  generation_task_id BIGINT,
  config_snapshot    JSONB NOT NULL,
  overall_score      INTEGER NOT NULL,
  dimension_scores   JSONB NOT NULL,
  issues             JSONB NOT NULL,
  issue_count        INTEGER NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'completed',
  created_at         TIMESTAMP DEFAULT NOW()
);

-- 按章节快速取历史校验记录（按时间倒序）
CREATE INDEX IF NOT EXISTS idx_style_audit_chapter
  ON style_audit_record (chapter_plan_id, created_at DESC);
