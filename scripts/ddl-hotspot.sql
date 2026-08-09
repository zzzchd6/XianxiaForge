-- 热点嗅探模块建表脚本（novel_studio 库内，hotspot_ 前缀，与创作表隔离）
-- 由独立工具「热点嗅探」并入 monorepo，表结构与其 scripts/init-hotspot-db.sql 完全一致。
-- 幂等：CREATE TABLE IF NOT EXISTS，可重复执行。

-- 1. 爬取批次表
CREATE TABLE IF NOT EXISTS hotspot_crawl_batch (
  id BIGSERIAL PRIMARY KEY,
  source_names JSONB NOT NULL DEFAULT '[]',   -- 本批次涉及的榜单源名称
  status VARCHAR(20) NOT NULL DEFAULT 'running', -- running/completed/failed/partial
  item_count INT NOT NULL DEFAULT 0,          -- 成功入库书目数
  note TEXT,                                  -- 备注/错误信息
  started_at TIMESTAMP DEFAULT now(),
  finished_at TIMESTAMP
);

-- 2. 原始榜单书目表
CREATE TABLE IF NOT EXISTS hotspot_raw_novel (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES hotspot_crawl_batch(id) ON DELETE CASCADE,
  source VARCHAR(60) NOT NULL,                -- 榜单源名称
  rank INT,                                   -- 榜单排名
  title TEXT NOT NULL,                        -- 书名
  author TEXT,                                -- 作者
  category TEXT,                              -- 分类
  tags JSONB DEFAULT '[]',                    -- 标签数组
  intro TEXT,                                 -- 简介
  word_count TEXT,                            -- 字数（原始展示串）
  popularity TEXT,                            -- 热度/人气展示串
  url TEXT,                                   -- 详情链接
  raw JSONB DEFAULT '{}',                     -- 原始抓取字段
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hotspot_raw_batch ON hotspot_raw_novel(batch_id);
-- 同批次内按源+书名+作者去重
CREATE UNIQUE INDEX IF NOT EXISTS uq_hotspot_raw_dedup
  ON hotspot_raw_novel(batch_id, source, title, COALESCE(author, ''));

-- 3. 分析/灵感条目表
CREATE TABLE IF NOT EXISTS hotspot_insight (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES hotspot_crawl_batch(id) ON DELETE CASCADE,
  insight_type VARCHAR(20) NOT NULL,          -- encounter/foreshadow/highlight/task/trend(仅参考)
  title TEXT NOT NULL,                        -- 灵感标题
  content TEXT,                               -- 灵感正文/说明
  payload JSONB DEFAULT '{}',                 -- 结构化补充数据
  score INT DEFAULT 0,                        -- 热度/置信度评分
  status VARCHAR(20) NOT NULL DEFAULT 'new',  -- new/kept/discarded/pushed
  source_novel_ids JSONB DEFAULT '[]',        -- 关联的 hotspot_raw_novel.id 数组
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hotspot_insight_batch ON hotspot_insight(batch_id);

-- 4. 推送入库记录表
CREATE TABLE IF NOT EXISTS hotspot_push_log (
  id BIGSERIAL PRIMARY KEY,
  insight_id BIGINT NOT NULL REFERENCES hotspot_insight(id) ON DELETE CASCADE,
  target_table VARCHAR(40) NOT NULL,          -- plot_material_encounter/foreshadow/highlight/task
  target_project_id BIGINT,                   -- creative_project.id，全局素材为 NULL
  target_id BIGINT,                           -- 目标表新插入行的 id
  note TEXT,
  pushed_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hotspot_push_insight ON hotspot_push_log(insight_id);

-- 幂等迁移：素材库推送为全局共享（project_id=NULL），日志列同步放宽
ALTER TABLE hotspot_push_log ALTER COLUMN target_project_id DROP NOT NULL;
