-- ============================================================
-- 指尖仙侠 体验增强 第一批 DDL
-- 执行目标库: novel_studio (创作库)
-- 模块1 关键剧情锚点: chapter_plan.must_have_events
-- 模块2 伏笔追踪增量: foreshadow_thread.hint_clue + pending 状态取值
-- 幂等可重复执行；全部为 additive 变更，不影响存量数据
-- ============================================================

-- 模块1：章节强制事件锚点（jsonb 数组，空=不启用，完全不影响原流程）
ALTER TABLE chapter_plan ADD COLUMN IF NOT EXISTS must_have_events JSONB DEFAULT '[]';

-- 模块2：伏笔线索（埋设时留给后文回收的暗示线索）
ALTER TABLE foreshadow_thread ADD COLUMN IF NOT EXISTS hint_clue TEXT;
-- 注：foreshadow_thread.status 为 varchar，新增 'pending'(待埋入) 取值无需 DDL
