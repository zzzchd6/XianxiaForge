-- ============================================================
-- 指尖仙侠 场景小纲扩展表 DDL
-- 执行目标库: novel_studio (创作库)
-- 依赖: creative_project, story_outline 表已存在
-- 执行顺序: 按文件内顺序从上到下执行即可
-- ============================================================

-- 1. 场景节点主表
CREATE TABLE IF NOT EXISTS scene_node (
  id            BIGSERIAL PRIMARY KEY,
  project_id    BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  outline_id    BIGINT NOT NULL REFERENCES story_outline(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  title         TEXT NOT NULL,
  time_setting  TEXT,
  location_desc TEXT,
  core_event    TEXT,
  effect_and_result TEXT,
  foreshadowing_note TEXT,
  scene_type    VARCHAR(20) NOT NULL DEFAULT 'transition',
  is_key_plot   BOOLEAN NOT NULL DEFAULT FALSE,
  ai_status     VARCHAR(20) DEFAULT 'manual',
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scene_node_outline ON scene_node(outline_id);
CREATE INDEX IF NOT EXISTS idx_scene_node_project ON scene_node(project_id);
CREATE INDEX IF NOT EXISTS idx_scene_node_sort ON scene_node(outline_id, sort_order);

COMMENT ON TABLE scene_node IS '场景小纲节点主表，承载7类核心要素，归属卷大纲';
COMMENT ON COLUMN scene_node.scene_type IS '场景类型: key(关键剧情) / transition(过渡) / foreshadow(伏笔)';
COMMENT ON COLUMN scene_node.ai_status IS 'AI生成状态: manual / generated / refined';

-- 2. 场景-人物关联表
CREATE TABLE IF NOT EXISTS scene_node_character (
  id              BIGSERIAL PRIMARY KEY,
  scene_node_id   BIGINT NOT NULL REFERENCES scene_node(id) ON DELETE CASCADE,
  character_id    BIGINT NOT NULL,
  appearance_type VARCHAR(20) NOT NULL DEFAULT 'core_support',
  role_note       TEXT,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scene_char_node ON scene_node_character(scene_node_id);
CREATE INDEX IF NOT EXISTS idx_scene_char_id ON scene_node_character(character_id);

COMMENT ON TABLE scene_node_character IS '场景-人物多对多关联，区分出场类型';
COMMENT ON COLUMN scene_node_character.character_id IS '诛仙库 novel_character_lib.char_id';
COMMENT ON COLUMN scene_node_character.appearance_type IS '出场类型: protagonist / core_support / mention';

-- 3. 场景-世界观要素关联表
CREATE TABLE IF NOT EXISTS scene_node_element (
  id                    BIGSERIAL PRIMARY KEY,
  scene_node_id         BIGINT NOT NULL REFERENCES scene_node(id) ON DELETE CASCADE,
  element_type          VARCHAR(30) NOT NULL,
  element_id            BIGINT NOT NULL,
  element_note          TEXT,
  foreshadow_direction  VARCHAR(10),
  sort_order            INTEGER DEFAULT 0,
  created_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scene_elem_node ON scene_node_element(scene_node_id);
CREATE INDEX IF NOT EXISTS idx_scene_elem_type ON scene_node_element(element_type, element_id);

COMMENT ON TABLE scene_node_element IS '场景-世界观要素关联（地点/功法/法宝/妖兽/伏笔模板）';
COMMENT ON COLUMN scene_node_element.element_type IS '要素类型: location / skill / item / monster / foreshadow_template';
COMMENT ON COLUMN scene_node_element.foreshadow_direction IS '伏笔方向: plant(埋设) / payoff(回收)';

-- 4. 节点间关系表（连线）
CREATE TABLE IF NOT EXISTS scene_node_relation (
  id              BIGSERIAL PRIMARY KEY,
  source_node_id  BIGINT NOT NULL REFERENCES scene_node(id) ON DELETE CASCADE,
  target_node_id  BIGINT NOT NULL REFERENCES scene_node(id) ON DELETE CASCADE,
  relation_type   VARCHAR(20) NOT NULL DEFAULT 'sequential',
  description     TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scene_rel_source ON scene_node_relation(source_node_id);
CREATE INDEX IF NOT EXISTS idx_scene_rel_target ON scene_node_relation(target_node_id);

COMMENT ON TABLE scene_node_relation IS '场景节点间连线关系';
COMMENT ON COLUMN scene_node_relation.relation_type IS '关系类型: causal(因果) / sequential(顺承) / foreshadow_echo(伏笔呼应)';

-- 5. 对话修改日志表
CREATE TABLE IF NOT EXISTS scene_edit_log (
  id                BIGSERIAL PRIMARY KEY,
  project_id        BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  outline_id        BIGINT NOT NULL REFERENCES story_outline(id) ON DELETE CASCADE,
  user_instruction  TEXT NOT NULL,
  parsed_plan       JSONB,
  snapshot_before   JSONB,
  snapshot_after    JSONB,
  apply_status      VARCHAR(20) NOT NULL DEFAULT 'pending',
  operation_type    VARCHAR(30),
  created_at        TIMESTAMP DEFAULT NOW(),
  applied_at        TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scene_log_outline ON scene_edit_log(outline_id);
CREATE INDEX IF NOT EXISTS idx_scene_log_status ON scene_edit_log(apply_status);

COMMENT ON TABLE scene_edit_log IS '场景小纲对话修改日志，支持版本回滚';
COMMENT ON COLUMN scene_edit_log.apply_status IS '应用状态: pending / applied / rolled_back';
COMMENT ON COLUMN scene_edit_log.operation_type IS '操作类型: add_node / delete_node / modify_field / reorder / add_relation / polish';
