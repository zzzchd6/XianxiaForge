-- ============================================================
-- v1.4 第二期：角色声音配置 + 角色已知信息清单（PRD-A 修正方案）
-- characterId 遵循负数约定：正数=诛仙库人物，负数=自定义人物
-- 回滚：DROP TABLE IF EXISTS character_voice_config;
--       DROP TABLE IF EXISTS character_knowledge;
-- ============================================================

CREATE TABLE IF NOT EXISTS character_voice_config (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  character_id BIGINT NOT NULL,
  speech_style TEXT,
  catchphrases TEXT,
  address_habit TEXT,
  tone_base TEXT,
  example_quotes JSONB DEFAULT '[]',
  forbidden_expressions JSONB DEFAULT '[]',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (project_id, character_id)
);

COMMENT ON TABLE character_voice_config IS '角色声音配置：人物说话方式/口癖/语气特征，注入式声音方案（不做两阶段分角色生成）';
COMMENT ON COLUMN character_voice_config.character_id IS '正数=诛仙库人物，负数=自定义人物（绝对值对应 custom_character.id）';

CREATE TABLE IF NOT EXISTS character_knowledge (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES creative_project(id) ON DELETE CASCADE,
  character_id BIGINT NOT NULL,
  knowledge_content TEXT NOT NULL,
  info_level VARCHAR(20) NOT NULL DEFAULT 'common',
  source_type VARCHAR(20) NOT NULL DEFAULT 'manual',
  source_ref JSONB DEFAULT '{}',
  acquired_chapter INTEGER,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE character_knowledge IS '角色已知信息清单（单层简化版）：供信息差写作注入与认知越界审计参照';
COMMENT ON COLUMN character_knowledge.info_level IS 'core(核心认知) / common(普通知晓) / secret(隐秘但已知)';
COMMENT ON COLUMN character_knowledge.source_type IS 'manual(手动) / foreshadow(伏笔回收联动) / timeline(时间线推导)';

CREATE INDEX IF NOT EXISTS idx_char_voice_project ON character_voice_config (project_id);
CREATE INDEX IF NOT EXISTS idx_char_knowledge_project_char ON character_knowledge (project_id, character_id);
