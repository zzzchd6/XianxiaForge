-- =============================================================
-- 废数据字段标记 Migration（v1.5+，幂等）
-- 
-- 策略：不删列（保证安全回滚），仅通过 COMMENT 标记 @deprecated，
--       并在 creative-schema.ts 中同步添加注释。
--       后续版本确认无引用后再做物理删除。
-- =============================================================

-- ===== 1. creative_project：半废弃字段 =====
COMMENT ON COLUMN creative_project.source_book_id IS '@deprecated WS0多书后仅默认1，大量接口未按book隔离世界观。计划在引导向导中统一处理';
COMMENT ON COLUMN creative_project.story_engine_type IS '@half-used R5故事引擎类型，写入但WriterAgent未直接消费';
COMMENT ON COLUMN creative_project.story_engine_desc IS '@half-used R5故事引擎描述，写入但WriterAgent未直接消费';

-- ===== 2. chapter_plan：部分字段写入但下游消费不稳定 =====
COMMENT ON COLUMN chapter_plan.emotion_target IS '@half-used 写入但WriterAgent未稳定注入';
COMMENT ON COLUMN chapter_plan.conflict_target IS '@half-used 写入但WriterAgent未稳定注入';
COMMENT ON COLUMN chapter_plan.singularity_event IS '@half-used 天命P0#1奇点事件标记，写入但审计/生成未消费';
COMMENT ON COLUMN chapter_plan.chapter_type IS '@half-used 天命P1#4章节类型，写入但下游仅展示未参与生成逻辑';

-- ===== 3. generated_chapter =====
COMMENT ON COLUMN generated_chapter.dashboard IS '@half-used 章信息仪表盘，写入但前端未展示';
COMMENT ON COLUMN generated_chapter.perspective_versions IS '@half-used 段落多视角重写版本，功能存在但使用率低';

-- ===== 4. story_outline =====
COMMENT ON COLUMN story_outline.character_arcs IS '@half-used 写入但context-builder未召回';
COMMENT ON COLUMN story_outline.foreshadowing IS '@half-used 写入但伏笔台账未联动';

-- ===== 5. scene_node =====
COMMENT ON COLUMN scene_node.payoff_setup IS '@half-used 中段回报预埋，写入但生成时未注入';
COMMENT ON COLUMN scene_node.rhythm_anchor IS '@half-used 节奏锚点，写入但生成时未注入';

-- ===== 6. foreshadow_thread =====
COMMENT ON COLUMN foreshadow_thread.dna_subject IS '@half-used 载体DNA，写入但审计未消费';
COMMENT ON COLUMN foreshadow_thread.dna_action IS '@half-used 载体DNA，写入但审计未消费';
COMMENT ON COLUMN foreshadow_thread.dna_object IS '@half-used 载体DNA，写入但审计未消费';
COMMENT ON COLUMN foreshadow_thread.dna_emotion IS '@half-used 载体DNA，写入但审计未消费';

-- ===== 7. impact_definition / impact_history =====
COMMENT ON TABLE impact_definition IS '@half-used 影响定义表，全局预设未填充，项目级自定义使用率低';
COMMENT ON TABLE impact_history IS '@half-used 影响变更历史，写入但无回滚UI消费';

-- ===== 8. relation_impact_snapshot =====
COMMENT ON TABLE relation_impact_snapshot IS '@half-used 关系影响快照，生成时写入但context-builder未稳定召回';

-- ===== 9. world_impact_snapshot =====
COMMENT ON TABLE world_impact_snapshot IS '@half-used 世界观影响快照，生成时写入但context-builder未召回';

-- ===== 10. branch_impact_link =====
COMMENT ON TABLE branch_impact_link IS '@half-used 分支影响关联，写入但前端展示不完整';

-- ===== 11. info_point =====
COMMENT ON TABLE info_point IS '@half-used 信息点表，写入但审计/生成未消费';

-- ===== 12. chapter_technique_map =====
COMMENT ON TABLE chapter_technique_map IS '@half-used 章节-技法关联审计得分，写入但前端未展示';

-- ===== 13. style_audit_record =====
COMMENT ON TABLE style_audit_record IS '@half-used 文风校验记录，写入但前端无历史查看入口';

-- ===== 14. character_memory_card =====
COMMENT ON TABLE character_memory_card IS '@half-used 角色记忆卡，抽取写入但context-builder未稳定召回';
