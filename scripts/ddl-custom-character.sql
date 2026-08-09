-- ============================================================
-- 指尖仙侠 自定义人物模块 DDL
-- 执行目标库: novel_studio (创作库)
-- 新增 custom_character 自定义人物表
-- 对外暴露负数ID（真实自增ID取负），与诛仙库人物正数ID共存
-- 幂等可重复执行
-- ============================================================

-- 自定义人物表：三步向导创建的原创小说人物
CREATE TABLE IF NOT EXISTS custom_character (
  id                BIGSERIAL PRIMARY KEY,
  project_id        BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  -- 姓名（可含道号/称号后缀）
  name              VARCHAR(64) NOT NULL,
  -- 性别：male/female
  gender            VARCHAR(10) NOT NULL DEFAULT 'male',
  -- 种族大类ID（human/demon_race/demon_king_race/ghost_race/spirit_race/divine_race/hybrid_race）
  race_category     VARCHAR(30) NOT NULL,
  -- 种族小类ID（附录A 56小类之一）
  race_sub          VARCHAR(40) NOT NULL,
  -- 实力定位档位key：chenjie/tongtu/dazhe/zhelong/tianyou
  position          VARCHAR(20) NOT NULL,
  -- 伪装定位档位key（扮猪吃虎，须低于真实定位档次），空=不伪装
  fake_position     VARCHAR(20),
  -- 立场值 0-100（0=极正 100=极邪）
  stance            INTEGER NOT NULL DEFAULT 50,
  -- 内在性格（单选：无私/正直/中庸/狂邪/利己/邪恶）
  inner_personality VARCHAR(20) NOT NULL,
  -- 外在性格标签数组（2-3个，jsonb string[]）
  outer_personality JSONB NOT NULL DEFAULT '[]',
  -- 天赋名称数组（3正向 + 可选1缺陷，jsonb string[]）
  talents           JSONB NOT NULL DEFAULT '[]',
  -- 种族擅长（冗余自附录A，jsonb string[]）
  strengths         JSONB NOT NULL DEFAULT '[]',
  -- 种族短板（冗余自附录A，jsonb string[]）
  weaknesses        JSONB NOT NULL DEFAULT '[]',
  -- LLM生成的人物小传（300-500字，失败时为模板拼接兜底）
  description       TEXT,
  -- 软删除
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

-- 按项目查人物列表（过滤软删除后按创建时间倒序）
CREATE INDEX IF NOT EXISTS idx_custom_character_project
  ON custom_character (project_id, is_deleted, created_at DESC);
