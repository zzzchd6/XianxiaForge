-- ============================================================
-- 指尖仙侠 素材联动 DDL（伏笔手法联动 A2 + 成长高光联动 B2）
-- 执行目标库: novel_studio (创作库)
-- 依赖: foreshadow_thread / character_growth_stage 表已存在
-- ============================================================

-- A2：伏笔台账绑定「伏笔手法」素材
-- 作者在台账中为某条伏笔手动指定一条 plot_material_foreshadow 手法，
-- 写作时强制取用（不受相似度阈值/召回开关影响）。
ALTER TABLE foreshadow_thread
  ADD COLUMN IF NOT EXISTS referenced_material_id BIGINT;

COMMENT ON COLUMN foreshadow_thread.referenced_material_id IS
  '作者手动绑定的伏笔手法素材ID（引用 plot_material_foreshadow.id），写作时强制取用';

-- B2：成长阶段关键节点标记
-- stage_type: 阶段类型（境界突破/心境转变/能力觉醒/关系升华）
-- is_key_node: 作者标记的关键节点，命中即强制召回高光素材
ALTER TABLE character_growth_stage
  ADD COLUMN IF NOT EXISTS stage_type VARCHAR(20);

ALTER TABLE character_growth_stage
  ADD COLUMN IF NOT EXISTS is_key_node BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN character_growth_stage.stage_type IS
  '阶段类型：境界突破/心境转变/能力觉醒/关系升华';
COMMENT ON COLUMN character_growth_stage.is_key_node IS
  '是否为作者标记的关键节点（命中即强制召回高光素材）';
