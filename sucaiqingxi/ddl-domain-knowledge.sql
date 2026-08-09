-- =============================================================
-- 专业领域知识库 · 建表脚本（创作库 novel_studio）
-- 用途：领域知识蒸馏工具 extract_domain_knowledge.py 的落库目标。
--       把专业书籍/资料抽取为结构化领域知识，向量化入库，供 RAG 检索
--       注入写作上下文，提升特定题材（医学/刑侦/军事等）的专业度与真实感。
--
-- 设计对齐：字段规范与 4 张剧情素材表（plot_material_*）完全一致；
--          采用「单表 + knowledge_type 枚举」而非 5 张表——5 类结构对称、
--          单类量小、RAG 常需跨类召回，单表更利于统一向量检索与过滤。
-- 边界：本表建在创作库 novel_studio，诛仙原著库只读、不做任何修改。
--
-- 隔离粒度：project_id 可空。NULL = 全局共享；非空 = 归属某创作项目。
-- 特性：可重复执行（IF NOT EXISTS），不破坏存量数据。
-- =============================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS plot_domain_knowledge (
  id                BIGSERIAL PRIMARY KEY,
  project_id        BIGINT REFERENCES creative_project(id) ON DELETE CASCADE, -- NULL=全局共享
  knowledge_type    VARCHAR(30) NOT NULL,   -- term|rule|pitfall|expression|case
  applicable_domain VARCHAR(50),            -- 领域归属，如“中医/刑侦/航海”，RAG 过滤召回用
  title             VARCHAR(200) NOT NULL,  -- 术语名/规则名/知识点标题
  content           TEXT NOT NULL,          -- 知识正文（100-300字，独立完整）；【唯一参与向量化字段】
  tags              TEXT[] DEFAULT '{}',    -- 标签
  quality_score     INT DEFAULT 0,          -- 质量分 1-10
  source_book       VARCHAR(100),           -- 来源书籍
  source_snippet    VARCHAR(300),           -- 原文片段（仅后台可见，禁止进写作上下文）
  ext               JSONB DEFAULT '{}',     -- 预留扩展位
  embedding         VECTOR(512),            -- content 的 512 维向量（bge, 归一化, cosine）
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMP DEFAULT NOW(),

  CONSTRAINT chk_domain_knowledge_type
    CHECK (knowledge_type IN ('term', 'rule', 'pitfall', 'expression', 'case'))
);

-- 索引（与剧情素材表同套路：项目 / 类型 / 领域 / 标签 GIN / 向量 HNSW）
CREATE INDEX IF NOT EXISTS idx_domain_project   ON plot_domain_knowledge (project_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_domain_type      ON plot_domain_knowledge (knowledge_type);
CREATE INDEX IF NOT EXISTS idx_domain_domain    ON plot_domain_knowledge (applicable_domain);
CREATE INDEX IF NOT EXISTS idx_domain_tags      ON plot_domain_knowledge USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_domain_embedding ON plot_domain_knowledge USING hnsw (embedding vector_cosine_ops);

-- =============================================================
-- 完成。验证：
--   \d+ plot_domain_knowledge
--   SELECT knowledge_type, count(*) FROM plot_domain_knowledge GROUP BY 1;
-- =============================================================
