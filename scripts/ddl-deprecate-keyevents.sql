-- P2：keyEvents 废弃标记（v1.5.1 大纲编辑器重构）
-- 前端不再展示，后端保留写入（scenes.ts:674 降级路径依赖）
-- 幂等，可重复执行

COMMENT ON COLUMN story_outline.key_events IS '@deprecated 2026-08-07：前端不再展示，仅保留后端写入用于场景导入降级路径（scenes.ts:674）。大纲编辑重构后，章节清单的唯一权威数据源为 chapter_plan 表。';
COMMENT ON COLUMN story_outline.character_arcs IS '@deprecated 2026-08-07：前端不再展示。人物弧线功能已迁移至独立的 growth_stage 系统。';
