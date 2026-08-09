-- ============================================================
-- v1.4 第一期：scene_node 分支三字段（PRD-B 薄增量的 schema 部分）
-- 与场景强度评分合并一次 DDL（强度评分为纯规则校验，无 schema 变更）
-- 回滚：ALTER TABLE scene_node DROP COLUMN IF EXISTS node_type,
--        DROP COLUMN IF EXISTS branch_group_id, DROP COLUMN IF EXISTS path_label;
-- ============================================================

ALTER TABLE scene_node
  ADD COLUMN IF NOT EXISTS node_type VARCHAR(20) NOT NULL DEFAULT 'linear',
  ADD COLUMN IF NOT EXISTS branch_group_id VARCHAR(60),
  ADD COLUMN IF NOT EXISTS path_label VARCHAR(60);

COMMENT ON COLUMN scene_node.node_type IS '节点类型: linear(线性主线) / branch_point(分支点)，暂不做 merge_point';
COMMENT ON COLUMN scene_node.branch_group_id IS '分支组ID：同一分支点下的多条预备路径共享此标识';
COMMENT ON COLUMN scene_node.path_label IS '路径标签：分支组内本节点所属路径的显示名（如"A线·隐忍"）';

CREATE INDEX IF NOT EXISTS idx_scene_node_branch_group ON scene_node (project_id, branch_group_id);
