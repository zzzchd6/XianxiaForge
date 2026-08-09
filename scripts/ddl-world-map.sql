-- ============================================================
-- 山河舆图（自定义地点地图系统）DDL
-- 来源：10-需求规格说明书-山河舆图.md v1.0 / 性价比评估-山河舆图-20260803.md
-- 执行目标库: novel_studio (创作库)
-- 范围：custom_map + custom_location + custom_location_link 三表
-- （US-6/US-7 不做，故不建 character_location_history / custom_location_event）
-- （US-2 走 scene_node_element 复用路径，不给 scene_node 加 location_id）
-- 幂等：全部 IF NOT EXISTS，可重复执行
-- ============================================================

-- 1. 地图表：一个项目可有多张地图
CREATE TABLE IF NOT EXISTS custom_map (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  name VARCHAR(64) NOT NULL,
  description TEXT,
  -- 底图：存 dataURL（项目无文件上传设施，限2MB内图片转base64）
  bg_image TEXT,
  bg_opacity REAL NOT NULL DEFAULT 0.7,
  -- 坐标范围（地图内相对坐标系）
  min_x REAL NOT NULL DEFAULT 0,
  min_y REAL NOT NULL DEFAULT 0,
  max_x REAL NOT NULL DEFAULT 2000,
  max_y REAL NOT NULL DEFAULT 1500,
  -- 层级：父地图（US-3 基础层级）
  parent_map_id BIGINT REFERENCES custom_map(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. 地点表
CREATE TABLE IF NOT EXISTS custom_location (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  map_id BIGINT NOT NULL REFERENCES custom_map(id) ON DELETE CASCADE,
  name VARCHAR(64) NOT NULL,
  -- 坐标（地图内相对坐标）
  x REAL NOT NULL,
  y REAL NOT NULL,
  -- 类型：sect宗门/city城池/secret_realm秘境/danger险地/teleport传送阵/battlefield战场/generic普通
  location_type VARCHAR(32) NOT NULL DEFAULT 'generic',
  -- 危险等级：safe/normal/danger/deadly
  danger_level VARCHAR(16) NOT NULL DEFAULT 'normal',
  description TEXT,                 -- 环境描写（注入生成上下文）
  affiliated_faction VARCHAR(64),   -- 所属势力（US-4 简化方案：字段+颜色区分替代多边形）
  parent_location_id BIGINT REFERENCES custom_location(id) ON DELETE SET NULL,
  linked_map_id BIGINT REFERENCES custom_map(id) ON DELETE SET NULL,
  -- 状态：draft=AI提取/诛仙库导入待确认, official=用户确认
  entity_status VARCHAR(16) NOT NULL DEFAULT 'official',
  -- 章节动态（与人物 chapter_updates 同构，预留）
  chapter_updates JSONB NOT NULL DEFAULT '[]',
  icon VARCHAR(32),
  color VARCHAR(16),
  metadata JSONB NOT NULL DEFAULT '{}',
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. 地点间路径/道路（US-4）
CREATE TABLE IF NOT EXISTS custom_location_link (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  from_location_id BIGINT NOT NULL REFERENCES custom_location(id) ON DELETE CASCADE,
  to_location_id BIGINT NOT NULL REFERENCES custom_location(id) ON DELETE CASCADE,
  -- 路径类型：main_road主路/path小路/teleport传送/secret_path秘径
  link_type VARCHAR(32) NOT NULL DEFAULT 'path',
  -- 旅行时间（分钟，抽象单位）
  travel_time_walk INT,
  travel_time_fly INT,
  travel_time_ship INT,
  travel_time_teleport INT DEFAULT 0,
  description TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_map_project ON custom_map(project_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_custom_location_project_map ON custom_location(project_id, map_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_custom_location_link_project ON custom_location_link(project_id) WHERE NOT is_deleted;

COMMENT ON TABLE custom_map IS '山河舆图：地图表（10-需求规格说明书 US-1/US-3）';
COMMENT ON TABLE custom_location IS '山河舆图：自定义地点表（含 entity_status 草稿态，诛仙库导入/AI提取为 draft）';
COMMENT ON TABLE custom_location_link IS '山河舆图：地点间路径（US-4），旅行时间为抽象分钟单位';

-- 回滚（谨慎执行，丢失全部地图数据）：
-- DROP TABLE IF EXISTS custom_location_link;
-- DROP TABLE IF EXISTS custom_location;
-- DROP TABLE IF EXISTS custom_map;
