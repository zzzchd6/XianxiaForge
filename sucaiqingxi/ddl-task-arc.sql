
-- =============================================================
-- 任务链台账 · 建表脚本（创作库 novel_studio）
-- 素材深度融入·第2层：让"任务"从一次性灵感升级为跨章状态机台账，与伏笔台账同级
-- 状态机：active(待推进) → progressing(推进中) → completed/failed/abandoned
-- 特性：可重复执行（IF NOT EXISTS 保护），不破坏存量数据
-- 约定对齐：与 creative_project 外键 ON DELETE CASCADE，镜像 foreshadow_thread 模式
-- =============================================================

CREATE TABLE IF NOT EXISTS task_arc (
  id                      BIGSERIAL PRIMARY KEY,
  project_id              BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL,                  -- 任务标题
  description             TEXT,                           -- 任务描述（要达成什么、为何重要）
  progress_clue           TEXT,                           -- 进度线索：正文出现该子串视为任务被推进
  status                  VARCHAR(16) NOT NULL DEFAULT 'active',   -- active/progressing/completed/failed/abandoned
  priority                VARCHAR(8) NOT NULL DEFAULT 'normal',    -- high/normal/low
  tier                    VARCHAR(4) NOT NULL DEFAULT 't3',        -- t1战略/t2战役/t3普通
  start_chapter           INTEGER,                        -- 任务开始章节号
  target_chapter          INTEGER,                        -- 目标/计划完成章节号
  referenced_material_ids JSONB DEFAULT '[]',             -- 关联剧情素材ID数组（plot_material_*）
  related_character_ids   JSONB DEFAULT '[]',             -- 关联角色ID数组
  source_type             VARCHAR(10) NOT NULL DEFAULT 'manual',   -- manual/scene/branch
  is_confirmed            BOOLEAN NOT NULL DEFAULT TRUE,  -- 确认后才注入写作上下文
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_arc_project_status ON task_arc(project_id, status);

-- =============================================================
-- 完成。验证：
--   \d+ task_arc
--   SELECT count(*) FROM task_arc;
-- =============================================================
