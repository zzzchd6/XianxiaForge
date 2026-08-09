-- 动态叙事引擎（12-需求规格说明书-动态叙事引擎-v2.1）
-- 新增：narrative_milestone / branch_arc / plan_rewrite_log
-- 变更：chapter_plan +2 字段；chapter_branch_option +4 字段

-- 叙事里程碑（与 timeline_milestone 共存各管各的：timeline 管世界时间线，本表管叙事结构）
CREATE TABLE IF NOT EXISTS narrative_milestone (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  outline_id BIGINT REFERENCES story_outline(id) ON DELETE SET NULL,
  label VARCHAR(200) NOT NULL,
  description TEXT,
  must_happen JSONB DEFAULT '[]',
  key_character_ids BIGINT[] DEFAULT '{}',
  target_chapter_from INT,
  target_chapter_to INT,
  status VARCHAR(20) DEFAULT 'upcoming',
  importance VARCHAR(20) DEFAULT 'major',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 分支弧（弧级管理，选项级仍用 chapter_branch_option）
CREATE TABLE IF NOT EXISTS branch_arc (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  source_chapter_id BIGINT,
  source_milestone_id BIGINT,
  title VARCHAR(200) NOT NULL,
  premise TEXT,
  branch_type VARCHAR(20) DEFAULT 'approach',
  estimated_length INT DEFAULT 2,
  status VARCHAR(20) DEFAULT 'active',
  converge_to_milestone_id BIGINT,
  converged_at_chapter BIGINT,
  new_elements JSONB DEFAULT '{}',
  state_snapshot JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- chapterPlan 重写审计日志（汇合引擎全自动重写时记录 before/after，支持回滚）
CREATE TABLE IF NOT EXISTS plan_rewrite_log (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  branch_arc_id BIGINT REFERENCES branch_arc(id) ON DELETE SET NULL,
  action VARCHAR(20) NOT NULL DEFAULT 'convergence',
  plan_id BIGINT NOT NULL,
  before_snapshot JSONB NOT NULL,
  after_snapshot JSONB NOT NULL,
  rolled_back BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- chapter_plan 新增 2 字段
ALTER TABLE chapter_plan ADD COLUMN IF NOT EXISTS branch_arc_id BIGINT;
ALTER TABLE chapter_plan ADD COLUMN IF NOT EXISTS is_convergence BOOLEAN DEFAULT false;

-- chapter_branch_option 新增 4 字段
ALTER TABLE chapter_branch_option ADD COLUMN IF NOT EXISTS branch_premise TEXT;
ALTER TABLE chapter_branch_option ADD COLUMN IF NOT EXISTS estimated_length INT DEFAULT 2;
ALTER TABLE chapter_branch_option ADD COLUMN IF NOT EXISTS core_conflict TEXT;
ALTER TABLE chapter_branch_option ADD COLUMN IF NOT EXISTS converge_to_milestone_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_narrative_milestone_project ON narrative_milestone(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_branch_arc_project ON branch_arc(project_id, status);
CREATE INDEX IF NOT EXISTS idx_plan_rewrite_log_plan ON plan_rewrite_log(plan_id);
