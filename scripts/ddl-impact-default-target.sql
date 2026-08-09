-- ============================================================
-- 影响体系·默认影响对象（分支影响预览/应用的目标人物兜底）
-- 背景：章节 POV 为空时，人物域影响（声望/根骨/业障等）无作用目标，
--       导致 ⚡ 影响预览与分支选择应用影响全空。
-- 方案：项目级"默认影响对象"（通常为主角），POV 为空时自动回落。
-- 消费方：impact.service.ts resolveImpactTargetCharacters
--          （routers/impact.ts 预览端点 + routers/chapters.ts select-branch 共用）
-- 日期：2026-07-26
-- ============================================================

ALTER TABLE creative_project
  ADD COLUMN IF NOT EXISTS default_impact_character_ids bigint[] DEFAULT '{}';

COMMENT ON COLUMN creative_project.default_impact_character_ids
  IS '默认影响对象人物ID数组（章节POV为空时影响体系的兜底作用目标，通常为主角）';
