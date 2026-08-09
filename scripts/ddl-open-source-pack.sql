-- 开源借鉴 PRD v1.1 DDL 批次（M1 欠账门豁免表 + M5 对标素材表，幂等）

-- M1：去AI味豁免词表（项目级 whitelist，命中 pattern 的表达不判 blocking）
CREATE TABLE IF NOT EXISTS deslop_whitelist (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deslop_whitelist_project ON deslop_whitelist(project_id);

-- M5：对标素材表（结构对称 plot_material_*，存对标书拆解产物：角色卡/剧情单元/文风分析/设定）
CREATE TABLE IF NOT EXISTS plot_material_benchmark (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  source_book_title TEXT NOT NULL DEFAULT '',
  material_type VARCHAR(20) NOT NULL DEFAULT 'plot_unit',
  title TEXT NOT NULL,
  content_md TEXT NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '[]',
  embedding vector(512),
  pinned BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_benchmark_project ON plot_material_benchmark(project_id) WHERE is_deleted = false;
