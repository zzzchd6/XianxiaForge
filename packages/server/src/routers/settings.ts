/**
 * 设置路由 - LLM配置、数据库状态
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { checkDatabaseHealth } from '../db/index.js';
import { testLlmConnection } from '../llm/client.js';
import { DIRECTION_CATEGORIES, DIRECTION_CATALOG } from '../services/direction-catalog.js';

const app = new Hono();

/** 任务角色→模型分流（开源借鉴 PRD v1.1 M3 / US-09）：未配置的角色回退全局 LLM_MODEL */
export const AGENT_ROLES = [
  { role: 'writer', label: '写作 Writer', env: 'LLM_WRITER_MODEL' },
  { role: 'auditor', label: '审计 Auditor', env: 'LLM_AUDITOR_MODEL' },
  { role: 'reviser', label: '修订 Reviser', env: 'LLM_REVISER_MODEL' },
  { role: 'extractor', label: '状态抽取 Extractor', env: 'LLM_EXTRACTOR_MODEL' },
  { role: 'branch', label: '分支生成 Branch', env: 'LLM_BRANCH_MODEL' },
  { role: 'quote', label: '金句提取 Quote', env: 'LLM_QUOTE_MODEL' },
] as const;

// 内存中存储设置（生产环境应持久化到数据库或文件）
let currentSettings = {
  llm: {
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || 'gpt-4o',
    temperature: 0.8,
    maxTokens: 4096,
    // apiKey不返回给前端
  },
  /** 按任务角色的模型分流配置（空=回退全局模型） */
  agentModels: Object.fromEntries(
    AGENT_ROLES.map((r) => [r.role, process.env[r.env] || undefined])
  ) as Record<string, string | undefined>,
  generation: {
    defaultTargetWordCount: 3000,
    defaultConflictLevel: 'medium',
    enableAudit: true,
    enableRevision: true,
    maxRevisions: 1,
    contextTokenBudget: 12000,
    // 交互式剧情抉择（需求12）：章节生成完成后自动产出下一章走向分支
    branchEnabled: true,
    branchOptionCount: 3,
  },
};

/**
 * 获取剧情分支配置（需求12）
 * 供生成管线在章节完成后决定是否产出分支选项及产出数量。
 */
export function getBranchConfig(): { branchEnabled: boolean; branchOptionCount: number } {
  return {
    branchEnabled: currentSettings.generation.branchEnabled !== false,
    branchOptionCount: Math.max(2, Math.min(4, currentSettings.generation.branchOptionCount || 3)),
  };
}

/**
 * 获取某任务角色的专属模型（开源借鉴 PRD v1.1 M3）；未配置返回 undefined（回退全局）。
 * 供 runner / postUpdate 在调用各 agent 前解析模型。
 */
export function getAgentModel(role: string): string | undefined {
  const m = currentSettings.agentModels?.[role];
  return m && m.trim() ? m.trim() : undefined;
}

// 更新设置验证
const updateSettingsSchema = z.object({
  llm: z.object({
    // 放宽为空字符串/省略协议头的地址，由 handler 归一化，避免清空或粘贴 relay 地址时保存失败
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(100).max(32000).optional(),
  }).optional(),
  generation: z.object({
    defaultTargetWordCount: z.number().int().min(500).max(20000).optional(),
    defaultConflictLevel: z.string().optional(),
    enableAudit: z.boolean().optional(),
    enableRevision: z.boolean().optional(),
    maxRevisions: z.number().int().min(0).max(5).optional(),
    contextTokenBudget: z.number().int().min(4000).max(32000).optional(),
    branchEnabled: z.boolean().optional(),
    branchOptionCount: z.number().int().min(2).max(4).optional(),
  }).optional(),
  /** 按角色模型分流：role -> 模型名（空字符串=清除回退全局） */
  agentModels: z.record(z.string()).optional(),
});

// 测试LLM连接验证
const testLlmSchema = z.object({
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
});

/** GET /api/settings - 获取当前设置 */
app.get('/', async (c) => {
  return c.json({
    success: true,
    data: {
      ...currentSettings,
      llm: {
        ...currentSettings.llm,
        apiKey: process.env.LLM_API_KEY ? '***已配置***' : '未配置',
      },
    },
  });
});

/** PUT /api/settings - 更新设置 */
app.put('/', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    // 更新LLM设置
    if (parsed.data.llm) {
      if (parsed.data.llm.baseUrl) {
        // 归一化：无协议头时补 https://（兼容粘贴 relay 地址）
        let baseUrl = parsed.data.llm.baseUrl.trim();
        if (baseUrl && !/^https?:\/\//i.test(baseUrl)) baseUrl = `https://${baseUrl}`;
        currentSettings.llm.baseUrl = baseUrl;
        process.env.LLM_BASE_URL = baseUrl;
      }
      // 掩码或空值不回写，避免覆盖真实 key
      const apiKey = parsed.data.llm.apiKey;
      if (apiKey && apiKey !== '***已配置***' && apiKey !== '未配置') {
        process.env.LLM_API_KEY = apiKey;
      }
      if (parsed.data.llm.model) {
        currentSettings.llm.model = parsed.data.llm.model;
        process.env.LLM_MODEL = parsed.data.llm.model;
      }
      if (parsed.data.llm.temperature !== undefined) {
        currentSettings.llm.temperature = parsed.data.llm.temperature;
      }
      if (parsed.data.llm.maxTokens !== undefined) {
        currentSettings.llm.maxTokens = parsed.data.llm.maxTokens;
      }
    }

    // 更新生成设置
    if (parsed.data.generation) {
      Object.assign(currentSettings.generation, parsed.data.generation);
    }

    // 更新按角色模型分流（同步写回 env，与既有 LLM_* 模式一致）
    if (parsed.data.agentModels) {
      for (const { role, env } of AGENT_ROLES) {
        const v = parsed.data.agentModels[role];
        if (v === undefined) continue;
        const trimmed = (v || '').trim();
        currentSettings.agentModels[role] = trimmed || undefined;
        if (trimmed) process.env[env] = trimmed;
        else delete process.env[env];
      }
    }

    return c.json({
      success: true,
      data: {
        ...currentSettings,
        llm: {
          ...currentSettings.llm,
          apiKey: process.env.LLM_API_KEY ? '***已配置***' : '未配置',
        },
      },
      message: '设置已更新',
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/settings/test-llm - 测试LLM连接 */
app.post('/test-llm', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = testLlmSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const configOverride = {
      baseUrl: parsed.data.baseUrl || undefined,
      apiKey: parsed.data.apiKey || undefined,
      model: parsed.data.model || undefined,
    };

    const result = await testLlmConnection(configOverride);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/settings/db-status - 数据库连接状态 */
app.get('/db-status', async (c) => {
  try {
    const health = await checkDatabaseHealth();
    return c.json({
      success: true,
      data: health,
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 临时文风档位（模块7） ============

/** 内置文风预设（代码定义，无需数据库） */
export const STYLE_PRESETS = [
  {
    id: 'hot_battle',
    name: '热血打斗',
    description: '节奏急促、短句为主、动作描写密集、氛围紧张炽烈',
    overrides: {
      descriptionRatio: { scene: 15, action: 50, dialogue: 20, psychology: 15 },
      sentenceRules: { climax_short: true, opening_short: true },
      matchedSceneFlavor: ['刀光剑影间气劲纵横', '每一击都带着破空之声', '热血在胸中沸腾'],
    },
  },
  {
    id: 'lyrical',
    name: '细腻抒情',
    description: '节奏舒缓、长句为主、心理与环境描写细腻、情感绵长',
    overrides: {
      descriptionRatio: { scene: 30, action: 10, dialogue: 25, psychology: 35 },
      sentenceRules: { climax_short: false, opening_short: false },
      matchedSceneFlavor: ['月光如水洒落', '心中泛起层层涟漪', '往事如烟萦绕心头'],
    },
  },
  {
    id: 'daily_light',
    name: '轻松日常',
    description: '节奏轻快、对话为主、氛围温馨幽默、生活气息浓',
    overrides: {
      descriptionRatio: { scene: 15, action: 10, dialogue: 50, psychology: 25 },
      sentenceRules: { climax_short: false, opening_short: true },
      matchedSceneFlavor: ['炊烟袅袅升起', '笑声在院落中回荡', '平淡中透着暖意'],
    },
  },
  {
    id: 'eerie_mystery',
    name: '悬疑诡异',
    description: '节奏压抑、环境描写阴森、心理暗示多、信息留白制造悬念',
    overrides: {
      descriptionRatio: { scene: 35, action: 15, dialogue: 20, psychology: 30 },
      sentenceRules: { climax_short: true, opening_short: false },
      matchedSceneFlavor: ['阴风阵阵掠过', '黑暗中似有目光窥视', '不安在心底蔓延'],
    },
  },
];

/** GET /api/settings/style-presets - 获取文风预设列表 */
app.get('/style-presets', (c) => {
  return c.json({ success: true, data: STYLE_PRESETS });
});

/** GET /api/settings/direction-catalog - 获取全局剧情方向字典（9大类+细分方向） */
app.get('/direction-catalog', (c) => {
  return c.json({
    success: true,
    data: {
      categories: DIRECTION_CATEGORIES,
      directions: DIRECTION_CATALOG,
    },
  });
});

export default app;
