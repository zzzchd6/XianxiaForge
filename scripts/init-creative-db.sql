-- 创作工作库初始化脚本
-- 执行顺序：先确保PostgreSQL运行，再执行本脚本
-- psql -U noveluser -d postgres -f scripts/init-creative-db.sql

-- 创建数据库（如果不存在需手动执行）
-- CREATE DATABASE novel_studio OWNER noveluser;

-- 连接到 novel_studio 后执行以下内容：

-- 1. 创作项目表
CREATE TABLE IF NOT EXISTS creative_project (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  genre TEXT,                          -- 题材：仙侠/玄幻/都市等
  source_book_id BIGINT DEFAULT 1,     -- 关联诛仙库的book_id
  status VARCHAR(20) NOT NULL DEFAULT 'planning',  -- planning/writing/reviewing/completed
  llm_config JSONB DEFAULT '{}',       -- 模型配置覆盖
  generation_config JSONB DEFAULT '{}', -- 生成参数（字数/风格等）
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- 2. 故事大纲表（卷级）
CREATE TABLE IF NOT EXISTS story_outline (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  volume_no INT NOT NULL,
  title TEXT NOT NULL,
  synopsis TEXT,                        -- 卷概要
  key_events JSONB DEFAULT '[]',        -- 关键事件列表
  character_arcs JSONB DEFAULT '[]',    -- 人物弧线
  foreshadowing JSONB DEFAULT '[]',     -- 伏笔规划
  world_building_notes TEXT,            -- 世界观补充
  sort_order INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'draft',   -- draft/confirmed/writing/done
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(project_id, volume_no)
);

-- 3. 章节计划表
CREATE TABLE IF NOT EXISTS chapter_plan (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  outline_id BIGINT REFERENCES story_outline(id) ON DELETE SET NULL,
  volume_no INT NOT NULL,
  chapter_no INT NOT NULL,
  title TEXT NOT NULL,
  intent TEXT,                          -- 章节意图/要写什么
  pov_character_ids BIGINT[] DEFAULT '{}',  -- POV角色（诛仙库character_lib.id）
  target_word_count INT DEFAULT 3000,
  scene_breakdown JSONB DEFAULT '[]',   -- 场景分解 [{location, event, characters}]
  required_entity_ids JSONB DEFAULT '{}', -- 必须出现的实体 {characters:[], factions:[], locations:[], skills:[]}
  emotion_target TEXT,                  -- 目标情绪
  conflict_target INT DEFAULT 3,        -- 目标冲突等级 1-5
  prev_chapter_summary TEXT,            -- 前文摘要（自动填充）
  status VARCHAR(20) DEFAULT 'planned', -- planned/generating/generated/reviewed/approved
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(project_id, volume_no, chapter_no)
);

-- 4. 生成任务表
CREATE TABLE IF NOT EXISTS generation_task (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  chapter_plan_id BIGINT REFERENCES chapter_plan(id) ON DELETE SET NULL,
  task_type VARCHAR(20) NOT NULL,       -- compose/write/audit/revise
  status VARCHAR(20) DEFAULT 'pending', -- pending/running/completed/failed
  input_snapshot JSONB,                 -- 输入上下文快照
  output_text TEXT,                     -- 生成结果
  audit_report JSONB,                   -- 审计报告
  revision_notes JSONB,                 -- 修订说明
  error_message TEXT,
  llm_model VARCHAR(100),
  tokens_used INT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

-- 5. 生成章节表（支持多版本）
CREATE TABLE IF NOT EXISTS generated_chapter (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  chapter_plan_id BIGINT REFERENCES chapter_plan(id) ON DELETE SET NULL,
  volume_no INT NOT NULL,
  chapter_no INT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,                         -- 正文
  word_count INT DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  parent_version_id BIGINT REFERENCES generated_chapter(id),
  quality_score JSONB,                  -- 质量评分 {consistency, style, plot, ...}
  status VARCHAR(20) DEFAULT 'draft',   -- draft/reviewed/approved/published
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gen_chapter_project ON generated_chapter(project_id, volume_no, chapter_no);

-- 6. 作者规则表
CREATE TABLE IF NOT EXISTS author_rules (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  rule_type VARCHAR(20) NOT NULL DEFAULT 'soft', -- hard/soft/style
  rule_content TEXT NOT NULL,
  priority INT DEFAULT 0,              -- 优先级，越大越优先
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

-- 7. 生成日志表
CREATE TABLE IF NOT EXISTS generation_log (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES creative_project(id) ON DELETE SET NULL,
  task_id BIGINT REFERENCES generation_task(id) ON DELETE SET NULL,
  agent_name VARCHAR(50),
  action VARCHAR(100),
  detail JSONB,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gen_log_project ON generation_log(project_id, created_at DESC);
