/**
 * 双引擎 Zod schema（双引擎 PRD v1.3 §11 JSON 配置规范的 Zod 落地）
 *
 * - icebergConfigSchema  ← §11.1 三层冰山配置
 * - conflictConfigSchema ← §11.2 冲突三要素配置
 * - composeConfigSchema  ← §11.3 组合工作流配置
 * - regenerateSchema     ← §10.1.2 分步重生成
 * - validateSchema       ← §10.1.5 独立校验打分
 *
 * 所有字符串字段带长度上限（§12 非功能需求：Prompt 注入防护）。
 */
import { z } from 'zod';

// ============================================================
// 公共枚举
// ============================================================

/** 掩饰策略（§7.4） */
export const disguiseStrategySchema = z.enum(['auto', 'irony', 'diversion', 'politeness', 'understatement']);
export type DisguiseStrategy = z.infer<typeof disguiseStrategySchema>;

/** 对话长度（§7.4） */
export const dialogueLengthSchema = z.enum(['short', 'medium', 'long']);
export type DialogueLength = z.infer<typeof dialogueLengthSchema>;

/** 欲望类型（§8.8 desire_type 枚举） */
export const desireTypeSchema = z.enum(['power', 'dignity', 'protection', 'revenge', 'freedom', 'promise']);
export type DesireType = z.infer<typeof desireTypeSchema>;

/** 阻力类型（§11.2） */
export const resistanceTypeSchema = z.enum([
  'rejection', 'humiliation', 'negation_of_effort', 'negation_of_desire', 'physical',
]);
export type ResistanceType = z.infer<typeof resistanceTypeSchema>;

/** 七寸精准度（§11.2） */
export const precisionSchema = z.enum(['auto', 'high', 'medium', 'low']);

/** 代价不可逆程度（§11.2） */
export const irreversibilitySchema = z.enum(['reversible', 'partially_reversible', 'irreversible', 'existential']);

/** 代价等级（§8.7 五级升级链） */
export const costLevelSchema = z.enum(['Lv1', 'Lv2', 'Lv3', 'Lv4', 'Lv5']);

// ============================================================
// §11.1 三层冰山配置
// ============================================================

export const icebergCharacterSchema = z.object({
  name: z.string().min(1).max(50),
  identity: z.string().min(1).max(500),
  relationship: z.string().max(500).optional(),
  /** 预设真实意图（可选，提供则 Step1 直接采用） */
  true_intent: z.string().max(1000).optional(),
  /** 预设真实情绪（可选） */
  true_emotion: z.string().max(200).optional(),
});

export const icebergConfigSchema = z.object({
  scene: z.string().min(1).max(2000),
  characters: z.array(icebergCharacterSchema).min(1).max(10),
  conflict_context: z.string().min(1).max(3000),
  disguise_strategy: disguiseStrategySchema.default('auto'),
  genre: z.string().max(50).default('xianxia'),
  dialogue_length: dialogueLengthSchema.default('medium'),
  behavior_anchor_library: z.string().max(100).default('xianxia_default'),
});
export type IcebergConfig = z.infer<typeof icebergConfigSchema>;
export type IcebergCharacter = z.infer<typeof icebergCharacterSchema>;

// ============================================================
// §11.2 冲突三要素配置
// ============================================================

export const conflictConfigSchema = z.object({
  protagonist: z.object({
    name: z.string().min(1).max(50),
    identity: z.string().min(1).max(500),
    current_status: z.string().max(500).optional(),
  }),
  desire: z.object({
    target: z.string().min(1).max(1000),
    why_it_matters: z.string().min(1).max(1000),
    desire_type: desireTypeSchema.optional(),
  }),
  resistance: z.object({
    source: z.string().min(1).max(1000),
    type: resistanceTypeSchema,
    precision: precisionSchema.default('auto'),
  }),
  cost: z.object({
    what_is_lost: z.string().min(1).max(1000),
    irreversibility: irreversibilitySchema,
    emotional_weight: z.number().int().min(1).max(5),
    cost_level: costLevelSchema.optional(),
  }),
  scene_setting: z.string().min(1).max(2000),
  genre: z.string().max(50).default('xianxia'),
  phase_length: z.object({
    phase1_words: z.number().int().min(100).max(2000).default(400),
    phase2_words: z.number().int().min(100).max(3000).default(600),
    phase3_words: z.number().int().min(50).max(1500).default(250),
  }).partial().default({}),
  seven_inch_mapping: z.string().max(100).default('xianxia_default'),
});
export type ConflictConfig = z.infer<typeof conflictConfigSchema>;

// ============================================================
// §11.3 组合工作流配置
// ============================================================

export const composeDialogueNodeSchema = z.object({
  phase: z.enum(['phase1', 'phase2', 'phase3']),
  position: z.enum(['beginning', 'middle', 'end']).optional(),
  purpose: z.string().max(200).optional(),
  participants: z.array(z.string().max(50)).max(10).optional(),
});

export const composeConfigSchema = z.object({
  conflict_config: conflictConfigSchema,
  /** 组合场景下 scene/characters/conflict_context 可缺省，由 §9.5 契约自动推导 */
  dialogue_config: icebergConfigSchema.partial(),
  dialogue_nodes: z.array(composeDialogueNodeSchema).max(10).optional(),
  cross_validation: z.object({
    enabled: z.boolean().default(true),
    min_score: z.number().int().min(0).max(100).default(70),
    auto_optimize: z.boolean().default(true),
    max_retry: z.number().int().min(0).max(5).default(3),
  }).partial().default({}),
  output_format: z.enum(['full_text', 'structured', 'both']).default('both'),
});
export type ComposeConfig = z.infer<typeof composeConfigSchema>;

// ============================================================
// §10.1.2 分步重生成 / §10.1.5 独立校验
// ============================================================

/** 冰山三步 / 冲突三阶段步骤枚举（checkpoint stepName 对应） */
export const ICEBERG_STEPS = ['step1_truth', 'step2_surface', 'step3_behavior'] as const;
export const CONFLICT_STEPS = ['phase1_desire', 'phase2_resistance', 'phase3_cost'] as const;

export const icebergRegenerateSchema = z.object({
  /** generation_task.id（生成时返回的 request_id） */
  request_id: z.number().int().positive(),
  /** 重生成起点步骤（联动规则见 §7.3：truth→连带后两步，surface→连带 behavior） */
  step: z.enum(['truth', 'surface', 'behavior']),
  /** 覆盖参数（如换掩饰策略） */
  overrides: icebergConfigSchema.partial().optional(),
});
export type IcebergRegenerateInput = z.infer<typeof icebergRegenerateSchema>;

export const conflictRegenerateSchema = z.object({
  request_id: z.number().int().positive(),
  /** 重生成起点阶段（联动规则见 §8.3：phase1→连带后两阶段，phase2→连带 phase3） */
  step: z.enum(['desire', 'resistance', 'cost']),
  overrides: conflictConfigSchema.partial().optional(),
});
export type ConflictRegenerateInput = z.infer<typeof conflictRegenerateSchema>;

export const validateSchema = z.object({
  module: z.enum(['dialogue', 'conflict', 'compose']),
  content: z.string().min(1).max(50000),
  /** 可选：关联配置（dialogue=冰山配置 / conflict=冲突配置），有则可做语义级校验 */
  config: z.record(z.any()).optional(),
});
export type ValidateInput = z.infer<typeof validateSchema>;

// ============================================================
// 生成请求入口 schema（路由层用：projectId + 配置）
// ============================================================

export const icebergGenerateRequestSchema = z.object({
  projectId: z.number().int().positive(),
  config: icebergConfigSchema,
});
export type IcebergGenerateRequest = z.infer<typeof icebergGenerateRequestSchema>;

export const conflictGenerateRequestSchema = z.object({
  projectId: z.number().int().positive(),
  config: conflictConfigSchema,
});
export type ConflictGenerateRequest = z.infer<typeof conflictGenerateRequestSchema>;

export const composeGenerateRequestSchema = z.object({
  projectId: z.number().int().positive(),
  config: composeConfigSchema,
});
export type ComposeGenerateRequest = z.infer<typeof composeGenerateRequestSchema>;
