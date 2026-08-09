-- DDL: 天命系统吸纳需求（P0+P1+P2）
-- P0#1: 冲突值量化
-- P0#1: 伏笔分级
-- P0#3: 载体DNA
-- P1#4: 章节类型
-- P1#6: 仪表盘

-- === P0#1: 冲突值量化 (chapter_plan) ===
ALTER TABLE chapter_plan ADD COLUMN IF NOT EXISTS conflict_score INT;
ALTER TABLE chapter_plan ADD COLUMN IF NOT EXISTS conflict_rating VARCHAR(10);
ALTER TABLE chapter_plan ADD COLUMN IF NOT EXISTS is_peak BOOLEAN DEFAULT FALSE;
ALTER TABLE chapter_plan ADD COLUMN IF NOT EXISTS singularity_event BOOLEAN DEFAULT FALSE;

-- === P0#1: 伏笔分级 (foreshadow_thread) ===
ALTER TABLE foreshadow_thread ADD COLUMN IF NOT EXISTS tier VARCHAR(10) DEFAULT 't3';

-- === P0#3: 载体DNA (foreshadow_thread) ===
ALTER TABLE foreshadow_thread ADD COLUMN IF NOT EXISTS dna_subject VARCHAR(100);
ALTER TABLE foreshadow_thread ADD COLUMN IF NOT EXISTS dna_action VARCHAR(50);
ALTER TABLE foreshadow_thread ADD COLUMN IF NOT EXISTS dna_object VARCHAR(100);
ALTER TABLE foreshadow_thread ADD COLUMN IF NOT EXISTS dna_emotion VARCHAR(50);

-- === P1#4: 章节类型 (chapter_plan) ===
ALTER TABLE chapter_plan ADD COLUMN IF NOT EXISTS chapter_type VARCHAR(30) DEFAULT 'progression';

-- === P1#6: 仪表盘 (generated_chapter) ===
ALTER TABLE generated_chapter ADD COLUMN IF NOT EXISTS dashboard JSONB;
