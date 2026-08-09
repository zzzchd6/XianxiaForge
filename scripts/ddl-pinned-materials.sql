-- ============================================================
-- 指尖仙侠 章节计划「固定素材」字段 DDL
-- 执行目标库: novel_studio (创作库)
-- 依赖: chapter_plan 表已存在
-- 用途: 手动指定本章必须融入的剧情素材（奇遇/伏笔/高光/任务链）
-- 数据格式: [{ "table": "plot_material_encounter", "id": 5 }, ...]
-- ============================================================

ALTER TABLE chapter_plan
  ADD COLUMN IF NOT EXISTS pinned_material_ids JSONB DEFAULT '[]';

COMMENT ON COLUMN chapter_plan.pinned_material_ids IS
  '手动固定的剧情素材引用数组，元素形如 {table, id}，table∈{plot_material_encounter,plot_material_foreshadow,plot_material_highlight,plot_material_task}';
