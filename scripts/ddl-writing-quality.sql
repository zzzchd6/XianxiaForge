-- 写作质量增强模块 R5：故事引擎前置规划约束
-- creative_project 新增故事引擎字段

ALTER TABLE creative_project ADD COLUMN IF NOT EXISTS story_engine_type VARCHAR(32);
ALTER TABLE creative_project ADD COLUMN IF NOT EXISTS story_engine_desc TEXT;
