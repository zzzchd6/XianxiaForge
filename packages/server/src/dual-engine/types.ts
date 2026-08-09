/**
 * 双引擎共享输出类型（PRD v1.3 §7.5 / §8.5 / §9 输出规范）
 */
import type { IcebergConfig, ConflictConfig } from './schemas.js';

// ============================================================
// 三层冰山输出（§7.5）
// ============================================================

export interface TruthLayerCharacter {
  name: string;
  true_intent: string;
  true_emotion: string;
  core_tension: string;
}

export interface SurfaceLine {
  speaker: string;
  line: string;
}

export interface BehaviorAnchorLine {
  speaker: string;
  action: string;
}

export interface IcebergResult {
  /** generation_task.id，分步重生成凭证 */
  request_id: number;
  truth_layer: { characters: TruthLayerCharacter[] };
  surface_layer: SurfaceLine[];
  behavior_layer: BehaviorAnchorLine[];
  /** 整合后的完整对话文本（台词+行为描写） */
  full_dialogue: string;
  quality_score: QualityReport;
  suggestions: string[];
  /** 本次实际执行/重生成的步骤 */
  executed_steps: string[];
  tokens_used: number;
}

// ============================================================
// 冲突三要素输出（§8.5）
// ============================================================

export interface EmotionCurve {
  /** Phase 1 结束时的期待值 0-100 */
  expectation_peak: number;
  /** Phase 2 结束时的憋屈感 0-100 */
  suppression_depth: number;
  /** 期待峰值 + 压抑深度 = 情绪落差（越大越好） */
  drop_amplitude: number;
  /** Phase 3 落地的代价重量感 0-100 */
  cost_weight: number;
}

export interface ConflictResult {
  request_id: number;
  desire_phase: string;
  resistance_phase: string;
  cost_phase: string;
  full_scene: string;
  emotion_curve: EmotionCurve;
  quality_score: QualityReport;
  suggestions: string[];
  /** 实际生效的 desire_type（auto 时为推断结果） */
  resolved_desire_type: string | null;
  executed_steps: string[];
  tokens_used: number;
}

// ============================================================
// 质量评分（§7.7 / §8.7）
// ============================================================

export type DimensionVerdict = 'pass' | 'gray' | 'fail';

export interface QualityDimension {
  key: string;
  name: string;
  weight: number;
  /** 单项得分 0-100 */
  score: number;
  verdict: DimensionVerdict;
  details: string[];
}

export interface QualityReport {
  /** 综合分 = Σ(单项得分 × 权重)，<70 不合格 */
  total: number;
  passed: boolean;
  dimensions: QualityDimension[];
}

// ============================================================
// 组合工作流输出（§9）
// ============================================================

export interface CrossValidationReport {
  total: number;
  passed: boolean;
  min_score: number;
  dimensions: QualityDimension[];
  retry_count: number;
}

export interface ComposeResult {
  request_id: number;
  /** 完整冲突戏文本（三阶段 + 冰山对话注入 + 叙事衔接） */
  full_text: string;
  /** 结构化产物（冲突三阶段 + 各节点冰山对话） */
  structured: {
    conflict: ConflictResult;
    dialogue_nodes: Array<{
      phase: string;
      purpose?: string;
      iceberg: IcebergResult;
    }>;
  };
  cross_validation: CrossValidationReport;
  executed_steps: string[];
  tokens_used: number;
}

// ============================================================
// 内部任务上下文（编排层传递）
// ============================================================

export interface EngineTaskRecord {
  id: number;
  projectId: number;
  taskType: string;
  inputSnapshot: IcebergConfig | ConflictConfig | any;
}
