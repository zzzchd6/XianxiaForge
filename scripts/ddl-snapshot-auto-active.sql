-- ============================================================
-- v1.4 第三期：状态快照/时间线自动生效修复（confirmed=0 空转）
-- 背景：旧机制 LLM 抽取结果写 pending，依赖人工确认才进写作上下文；
--       实际 DB 中 confirmed=0，状态注入长期空转。
-- 修复：代码侧改为抽取即写 auto_confirmed（自动生效、可否决）；
--       本脚本将存量 auto 来源的 pending 数据一次性转为 auto_confirmed。
-- 目标库：创作库 novel_studio
-- 回滚：见文件末尾注释
-- ============================================================

-- 存量人物状态快照：自动抽取且从未被人工处理的 pending → auto_confirmed
UPDATE character_state_snapshot
SET status = 'auto_confirmed', updated_at = now()
WHERE source = 'auto' AND status = 'pending';

-- 存量时间线里程碑：同上
UPDATE timeline_milestone
SET status = 'auto_confirmed'
WHERE source = 'auto' AND status = 'pending';

-- ============================================================
-- 回滚脚本（如需恢复旧语义，代码需同步回退）：
-- UPDATE character_state_snapshot SET status = 'pending', updated_at = now()
--   WHERE source = 'auto' AND status = 'auto_confirmed';
-- UPDATE timeline_milestone SET status = 'pending'
--   WHERE source = 'auto' AND status = 'auto_confirmed';
-- ============================================================
