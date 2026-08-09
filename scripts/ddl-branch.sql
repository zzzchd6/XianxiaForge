-- ============================================================
-- 指尖仙侠 交互式剧情抉择系统 DDL（需求12 第一期：章间分支）
-- 执行目标库: novel_studio (创作库)
-- 新增 chapter_branch_option 表 + chapter_plan 扩 2 个分支溯源字段
-- 幂等可重复执行
-- ============================================================

-- 章间分支选项表：某章生成完成后产出的"下一章走向选项"
CREATE TABLE IF NOT EXISTS chapter_branch_option (
  id                     BIGSERIAL PRIMARY KEY,
  project_id             BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  source_chapter_plan_id BIGINT NOT NULL REFERENCES chapter_plan(id) ON DELETE CASCADE,
  option_title           VARCHAR(200) NOT NULL,
  option_description     TEXT NOT NULL,
  next_chapter_intent    TEXT NOT NULL,
  next_scene_hint        JSONB DEFAULT '{}',
  impact_tags            JSONB DEFAULT '[]',
  option_type            VARCHAR(20) DEFAULT 'normal',
  is_selected            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMP DEFAULT NOW()
);

-- 兼容旧库：补 option_type 列（标记分支类型 normal=常规 / encounter=奇遇）
ALTER TABLE chapter_branch_option ADD COLUMN IF NOT EXISTS option_type VARCHAR(20) DEFAULT 'normal';

-- 按来源章节快速取分支选项
CREATE INDEX IF NOT EXISTS idx_branch_option_source
  ON chapter_branch_option (source_chapter_plan_id);

-- chapter_plan 扩 2 个分支溯源字段（普通列，不加外键避免与 chapter_branch_option 循环引用）
ALTER TABLE chapter_plan ADD COLUMN IF NOT EXISTS branch_source_option_id  BIGINT;
ALTER TABLE chapter_plan ADD COLUMN IF NOT EXISTS branch_parent_chapter_id BIGINT;

-- 按父章节回溯分支链
CREATE INDEX IF NOT EXISTS idx_chapter_plan_branch_parent
  ON chapter_plan (branch_parent_chapter_id);

-- ============================================================
-- 修复：分支衍生章与主线章共享章号导致的唯一约束冲突
-- 原 UNIQUE (project_id, volume_no, chapter_no) 约束对分支章也生效，
-- 但大纲会预置全部主线章节计划，分支衍生章（章号=来源+1）必然与主线计划冲突。
-- 分支章是主线章的"平行替代"，应允许共享章号，故改为部分唯一索引：
-- 仅约束主线章（branch_parent_chapter_id IS NULL），分支章豁免。
-- ============================================================
ALTER TABLE chapter_plan
  DROP CONSTRAINT IF EXISTS chapter_plan_project_id_volume_no_chapter_no_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_chapter_plan_mainline_chapter
  ON chapter_plan (project_id, volume_no, chapter_no)
  WHERE branch_parent_chapter_id IS NULL;

-- ============================================================
-- 分支素材来源标注 + 世界观推演（需求：分支借鉴四类素材并标注、选择前给出发展推演）
-- ============================================================
-- 分支选项借鉴的剧情素材引用数组 [{table,id,title,label}]
ALTER TABLE chapter_branch_option ADD COLUMN IF NOT EXISTS source_materials JSONB DEFAULT '[]';
COMMENT ON COLUMN chapter_branch_option.source_materials IS '本选项借鉴的剧情素材 [{table,id,title,label}]';

-- 随分支生成的"后续大概率怎么发展"世界观推演（存于来源章节计划）
ALTER TABLE chapter_plan ADD COLUMN IF NOT EXISTS branch_prediction TEXT;
COMMENT ON COLUMN chapter_plan.branch_prediction IS '随分支生成的后续发展推演（世界观推演）';

-- ============================================================
-- 剧情方向体系（需求：方向约束生成 + 自动打标 + 筛选 + 统计）
-- ============================================================
-- 主方向编码（如 growth_realm），存量数据为 NULL 时前端展示"未分类"
ALTER TABLE chapter_branch_option ADD COLUMN IF NOT EXISTS main_direction VARCHAR(32);
COMMENT ON COLUMN chapter_branch_option.main_direction IS '主方向编码（方向体系）';

-- 次方向编码数组（最多2个）
ALTER TABLE chapter_branch_option ADD COLUMN IF NOT EXISTS secondary_directions JSONB;
COMMENT ON COLUMN chapter_branch_option.secondary_directions IS '次方向编码数组（最多2个）';

-- 方向匹配度评分 0-100
ALTER TABLE chapter_branch_option ADD COLUMN IF NOT EXISTS direction_match_score INTEGER;
COMMENT ON COLUMN chapter_branch_option.direction_match_score IS '方向匹配度评分0-100';

-- ============================================================
-- 分支影响体系（需求：分支选择带来可累积的状态影响）
-- 设计决策：独立数值表 + 单一权威；关系快照/因果链延后阶段4
-- ============================================================

-- 影响定义表：所有可用影响项的元数据白名单（全局预设 + 项目自定义）
CREATE TABLE IF NOT EXISTS impact_definition (
  id                BIGSERIAL PRIMARY KEY,
  project_id        BIGINT REFERENCES creative_project(id) ON DELETE CASCADE,
  impact_key        VARCHAR(64) NOT NULL UNIQUE,
  name              VARCHAR(64) NOT NULL,
  domain            VARCHAR(32) NOT NULL,
  category          VARCHAR(32) NOT NULL,
  value_type        VARCHAR(16) NOT NULL,
  min_value         INTEGER NOT NULL DEFAULT 0,
  max_value         INTEGER NOT NULL DEFAULT 100,
  default_value     INTEGER NOT NULL DEFAULT 0,
  decay_per_chapter INTEGER NOT NULL DEFAULT 0,
  grade             VARCHAR(16),
  mutex_group       VARCHAR(64),
  priority          INTEGER NOT NULL DEFAULT 1,
  threshold_events  JSONB,
  description       TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT NOW()
);
COMMENT ON TABLE impact_definition IS '影响定义白名单（project_id 空=全局预设）';

-- 人物影响快照表：每章结束后生成，与人物状态快照按章节对齐
CREATE TABLE IF NOT EXISTS character_impact_snapshot (
  id             BIGSERIAL PRIMARY KEY,
  project_id     BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  character_id   BIGINT NOT NULL,
  character_name VARCHAR(64) NOT NULL,
  volume_no      INTEGER NOT NULL,
  chapter_no     INTEGER NOT NULL,
  numeric_values JSONB NOT NULL DEFAULT '{}',
  tag_states     JSONB NOT NULL DEFAULT '[]',
  status         VARCHAR(16) NOT NULL DEFAULT 'pending',
  source         VARCHAR(16) NOT NULL,
  task_id        BIGINT,
  created_at     TIMESTAMP DEFAULT NOW()
);
COMMENT ON TABLE character_impact_snapshot IS '人物影响快照（chapter_no 0=初始状态）';
CREATE INDEX IF NOT EXISTS idx_char_impact_snap_lookup
  ON character_impact_snapshot (project_id, character_id, chapter_no);

-- 世界观影响快照表：全局/区域世界状态（空区域=全局）
CREATE TABLE IF NOT EXISTS world_impact_snapshot (
  id             BIGSERIAL PRIMARY KEY,
  project_id     BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  volume_no      INTEGER NOT NULL,
  chapter_no     INTEGER NOT NULL,
  region         VARCHAR(64),
  numeric_values JSONB NOT NULL DEFAULT '{}',
  tag_states     JSONB NOT NULL DEFAULT '[]',
  status         VARCHAR(16) NOT NULL DEFAULT 'pending',
  source         VARCHAR(16) NOT NULL,
  created_at     TIMESTAMP DEFAULT NOW()
);
COMMENT ON TABLE world_impact_snapshot IS '世界观影响快照（region 空=全局）';
CREATE INDEX IF NOT EXISTS idx_world_impact_snap_lookup
  ON world_impact_snapshot (project_id, chapter_no);

-- 分支影响关联表：每个分支选项对应的影响变化明细
CREATE TABLE IF NOT EXISTS branch_impact_link (
  id               BIGSERIAL PRIMARY KEY,
  branch_option_id BIGINT NOT NULL REFERENCES chapter_branch_option(id) ON DELETE CASCADE,
  target_type      VARCHAR(16) NOT NULL,
  target_id        BIGINT,
  char_a_id        BIGINT,
  char_b_id        BIGINT,
  region           VARCHAR(64),
  impact_key       VARCHAR(64) NOT NULL,
  change_type      VARCHAR(16) NOT NULL,
  change_value     INTEGER,
  tag_key          VARCHAR(64),
  tag_duration     INTEGER,
  display_text     VARCHAR(128) NOT NULL,
  is_hidden        BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMP DEFAULT NOW()
);
COMMENT ON TABLE branch_impact_link IS '分支选项影响变化明细';
CREATE INDEX IF NOT EXISTS idx_branch_impact_link_option ON branch_impact_link (branch_option_id);

-- 影响变更历史表：全链路追溯所有影响变化，支持审计与回滚
CREATE TABLE IF NOT EXISTS impact_history (
  id              BIGSERIAL PRIMARY KEY,
  project_id      BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  source_type     VARCHAR(16) NOT NULL,
  source_id       BIGINT,
  chapter_no      INTEGER NOT NULL,
  snapshot_before JSONB NOT NULL,
  snapshot_after  JSONB NOT NULL,
  operator_note   TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);
COMMENT ON TABLE impact_history IS '影响变更历史（全链路追溯）';
CREATE INDEX IF NOT EXISTS idx_impact_history_project ON impact_history (project_id, chapter_no);
