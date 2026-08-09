-- =============================================================
-- 整本拆文功能 DDL（v1.5+，幂等）
-- 扩展 plot_material_benchmark 表，增加整本拆文产物的结构化字段
-- 复用 generation_task 表做任务队列（task_type='benchmark_analysis'）
-- =============================================================

-- 1) 扩展 plot_material_benchmark 表：增加整本拆文专属字段
ALTER TABLE plot_material_benchmark
  ADD COLUMN IF NOT EXISTS book_title       TEXT,           -- 对标书名（冗余 source_book_title，保留兼容）
  ADD COLUMN IF NOT EXISTS chapter_idx      INT,            -- 所属章序号（1起；NULL=轻量拆文/手动添加）
  ADD COLUMN IF NOT EXISTS item_type        VARCHAR(20) DEFAULT 'asset', -- asset(轻量拆文/手动) | skeleton(骨架) | plot(情节)
  ADD COLUMN IF NOT EXISTS setup_ratio      NUMERIC(5,4),   -- 起 占比
  ADD COLUMN IF NOT EXISTS develop_ratio    NUMERIC(5,4),   -- 承 占比
  ADD COLUMN IF NOT EXISTS turn_ratio       NUMERIC(5,4),   -- 转 占比
  ADD COLUMN IF NOT EXISTS resolve_ratio    NUMERIC(5,4),   -- 合 占比
  ADD COLUMN IF NOT EXISTS emotion_curve    NUMERIC[],      -- 情绪曲线
  ADD COLUMN IF NOT EXISTS hook             TEXT,           -- 章末钩子/悬念手法
  ADD COLUMN IF NOT EXISTS quality_score    INT DEFAULT 0,  -- 质量分 1-10
  ADD COLUMN IF NOT EXISTS source_snippet   VARCHAR(300);   -- 原文片段（仅后台可见）

-- 2) 复用 generation_task.task_type = 'benchmark_analysis'（无需建表）
-- input_snapshot 存 { sourceBookTitle, filePath, totalChapters, maxChapters, options }

-- 3) 索引：按章节查询
CREATE INDEX IF NOT EXISTS idx_benchmark_chapter
  ON plot_material_benchmark(project_id, chapter_idx)
  WHERE is_deleted = false AND chapter_idx IS NOT NULL;

-- 4) 索引：按 item_type 筛选
CREATE INDEX IF NOT EXISTS idx_benchmark_item_type
  ON plot_material_benchmark(project_id, item_type)
  WHERE is_deleted = false;
