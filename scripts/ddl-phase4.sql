-- ============================================================
-- 阶段4：因果链 + 关系影响快照
-- 目标库：novel_studio (creativeDb)
-- 执行：pnpm exec tsx ../../scripts/run-ddl-phase4.ts
-- ============================================================

-- 1. 因果链表
CREATE TABLE IF NOT EXISTS causal_chain (
  id                BIGSERIAL PRIMARY KEY,
  project_id        BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,

  -- 因（起点）
  source_type       VARCHAR(16) NOT NULL,
  source_id         BIGINT,
  source_chapter_no INTEGER NOT NULL,
  cause_type        VARCHAR(32) NOT NULL,
  cause_description TEXT NOT NULL,

  -- 果（预期兑现）
  effect_type       VARCHAR(32),
  effect_description TEXT,
  target_chapter_min INTEGER,
  target_chapter_max INTEGER,

  -- 生命周期
  status            VARCHAR(16) NOT NULL DEFAULT 'planted',
  priority          INTEGER NOT NULL DEFAULT 5,
  strength          INTEGER NOT NULL DEFAULT 50,

  -- 兑现记录
  resolved_chapter_no INTEGER,
  resolved_task_id  BIGINT,
  resolution_note   TEXT,

  -- 关联
  direction_code    VARCHAR(32),
  parent_chain_id   BIGINT,
  tags              JSONB NOT NULL DEFAULT '[]',

  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_causal_chain_project
  ON causal_chain (project_id, status);
CREATE INDEX IF NOT EXISTS idx_causal_chain_chapter
  ON causal_chain (project_id, source_chapter_no);
CREATE INDEX IF NOT EXISTS idx_causal_chain_target
  ON causal_chain (project_id, target_chapter_max)
  WHERE status IN ('planted', 'foreshadowed');

-- 2. 关系影响快照表
CREATE TABLE IF NOT EXISTS relation_impact_snapshot (
  id              BIGSERIAL PRIMARY KEY,
  project_id      BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,

  -- 关系双方（引用诛仙库人物，无 FK 约束）
  char_a_id       BIGINT NOT NULL,
  char_b_id       BIGINT NOT NULL,
  char_a_name     VARCHAR(64) NOT NULL,
  char_b_name     VARCHAR(64) NOT NULL,

  -- 定位
  volume_no       INTEGER NOT NULL,
  chapter_no      INTEGER NOT NULL,

  -- 关系状态（全量快照）
  rel_type        VARCHAR(64),
  relation_values JSONB NOT NULL DEFAULT '{}',
  relation_delta  JSONB NOT NULL DEFAULT '{}',

  -- 生命周期
  status          VARCHAR(16) NOT NULL DEFAULT 'pending',
  source          VARCHAR(16) NOT NULL,
  task_id         BIGINT,

  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rel_impact_snap_lookup
  ON relation_impact_snapshot (project_id, char_a_id, char_b_id, chapter_no);
CREATE INDEX IF NOT EXISTS idx_rel_impact_snap_status
  ON relation_impact_snapshot (project_id, status);
