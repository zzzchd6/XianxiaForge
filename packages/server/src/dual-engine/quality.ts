/**
 * 双引擎质量规则引擎（PRD v1.3 §7.7 冰山4维 + §8.7 冲突4维 + §9.3 交叉校验）
 *
 * 混合方案：规则初筛（零token）+ LLM 精判（仅灰色区间样本）。
 * - 冰山偏差度：台词与真实意图的二元组重叠率近似语义相似度，≤60优秀 / 60-70灰区 / >70不合格
 * - 情绪埋藏：直接情绪词检测（参照 quality-gate.ts 检测器模式）
 * - 冲突阻力精准度：阻力文本命中七寸映射表关键词
 * - 综合分 < 70 触发自动优化建议
 */
import { chatCompletion } from '../llm/client.js';
import { detectMetaNarration } from '../rag/quality-gate.js';
import { getSevenInchEntry, inferDesireType, COST_LEVEL_CHAIN, type DesireTypeKey } from '../data/desire-resistance-mapping.js';
import type {
  TruthLayerCharacter, SurfaceLine, BehaviorAnchorLine,
  QualityReport, QualityDimension, EmotionCurve,
} from './types.js';
import type { IcebergConfig, ConflictConfig } from './schemas.js';

// ============================================================
// 工具：中文二元组关键词提取与重叠率
// ============================================================

/** 提取中文二元组（跳过标点/空白），作为语义近似关键词 */
function bigrams(text: string): string[] {
  const clean = text.replace(/[^\u4e00-\u9fa5]/g, ' ');
  const out: string[] = [];
  for (const seg of clean.split(/\s+/)) {
    for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2));
  }
  return out;
}

/** B 对 A 的关键词命中率（A 的二元组在 B 中出现的比例） */
function overlapRate(baseText: string, targetText: string): number {
  const baseSet = new Set(bigrams(baseText));
  if (baseSet.size === 0) return 0;
  let hits = 0;
  for (const g of baseSet) if (targetText.includes(g)) hits++;
  return hits / baseSet.size;
}

// ============================================================
// §7.7 冰山 4 维校验
// ============================================================

/** 直接情绪词（台词/叙述中直接说出情绪 = 低级写法） */
const DIRECT_EMOTION_WORDS = [
  '很生气', '很愤怒', '很难过', '很伤心', '很悲伤', '很开心', '很高兴', '很快乐',
  '很害怕', '很恐惧', '很紧张', '很心动', '很喜欢', '很感激', '很感动', '很羞愧',
  '很失望', '很绝望', '很惊喜', '很激动', '很嫉妒', '很委屈', '很担忧', '十分难过',
  '非常生气', '非常愤怒', '十分害怕', '特别开心', '心中一酸', '心里很难受',
];

/** 行为泄露动词（下意识动作的典型标志，命中说明锚点有"泄露"功能） */
const LEAK_ACTION_WORDS = [
  '攥', '颤', '避开', '垂', '咽', '紧', '缩', '乱', '僵', '顿', '蜷',
  '摩挲', '掐', '摸', '压低', '放缓', '加快', '发抖', '抿', '别开',
];

export interface IcebergScoreInput {
  truthLayer: TruthLayerCharacter[];
  surfaceLayer: SurfaceLine[];
  behaviorLayer: BehaviorAnchorLine[];
}

/**
 * 冰山 4 维规则评分（偏差度35% / 情绪埋藏25% / 锚点覆盖20% / 行为一致性20%）
 */
export function scoreIceberg(input: IcebergScoreInput): QualityReport {
  const dims: QualityDimension[] = [];

  // ── 维度1：表层-意图偏差度（35%）──
  {
    let passLines = 0, grayLines = 0, failLines = 0, total = 0;
    const details: string[] = [];
    for (const ch of input.truthLayer) {
      const intentText = `${ch.true_intent} ${ch.true_emotion}`;
      const lines = input.surfaceLayer.filter((l) => l.speaker === ch.name);
      for (const l of lines) {
        total++;
        const sim = overlapRate(intentText, l.line);
        if (sim > 0.7) {
          failLines++;
          details.push(`「${ch.name}」台词与真实意图相似度过高（${(sim * 100).toFixed(0)}%）："${l.line.slice(0, 20)}"`);
        } else if (sim > 0.6) {
          grayLines++;
        } else {
          passLines++;
        }
      }
    }
    const score = total === 0 ? 60 : Math.round((passLines + grayLines * 0.5) / total * 100);
    dims.push({
      key: 'deviation', name: '表层-意图偏差度', weight: 0.35, score,
      verdict: failLines > 0 && score < 70 ? 'fail' : grayLines > 0 && score < 85 ? 'gray' : 'pass',
      details: details.length ? details.slice(0, 5) : [`${total} 句台词中 ${passLines} 句偏差合格`],
    });
  }

  // ── 维度2：情绪埋藏深度（25%）──
  {
    const fullText = input.surfaceLayer.map((l) => l.line).join('')
      + input.behaviorLayer.map((b) => b.action).join('');
    const hits = DIRECT_EMOTION_WORDS.filter((w) => fullText.includes(w));
    const meta = detectMetaNarration(fullText);
    const issues = hits.length + Math.min(meta.total, 3);
    const score = Math.max(0, 100 - issues * 25);
    dims.push({
      key: 'emotion_hide', name: '情绪埋藏深度', weight: 0.25, score,
      verdict: score >= 75 ? 'pass' : score >= 50 ? 'gray' : 'fail',
      details: issues === 0
        ? ['未检测到直接情绪词暴露']
        : [`直接情绪词：${hits.slice(0, 5).join('、')}${meta.total > 0 ? `；元叙述${meta.total}处` : ''}`],
    });
  }

  // ── 维度3：行为锚点覆盖率（20%）──
  {
    const total = input.surfaceLayer.length;
    const covered = input.behaviorLayer.filter((b) => b.action && b.action.trim().length > 0).length;
    const score = total === 0 ? 0 : Math.round(Math.min(covered, total) / total * 100);
    dims.push({
      key: 'anchor_coverage', name: '行为锚点覆盖率', weight: 0.2, score,
      verdict: score >= 90 ? 'pass' : score >= 60 ? 'gray' : 'fail',
      details: [`${total} 句台词中 ${Math.min(covered, total)} 句配有行为锚点`],
    });
  }

  // ── 维度4：行为-台词一致性（20%）──
  {
    let pass = 0, gray = 0, total = 0;
    const details: string[] = [];
    const intentByName = new Map(input.truthLayer.map((c) => [c.name, `${c.true_intent} ${c.true_emotion}`]));
    for (let i = 0; i < input.behaviorLayer.length; i++) {
      const b = input.behaviorLayer[i];
      const s = input.surfaceLayer[i];
      if (!b || !b.action?.trim()) continue;
      total++;
      const intent = intentByName.get(b.speaker) || '';
      const leaksIntent = intent ? overlapRate(b.action, intent) >= 0.15 : false;
      const hasLeakVerb = LEAK_ACTION_WORDS.some((w) => b.action.includes(w));
      const repeatsLine = s ? overlapRate(s.line, b.action) > 0.5 : false;
      if (repeatsLine) {
        details.push(`「${b.speaker}」行为描写与台词重复，无冰山效果`);
      } else if (leaksIntent || hasLeakVerb) {
        pass++;
      } else {
        gray++;
      }
    }
    const score = total === 0 ? 60 : Math.round((pass + gray * 0.5) / total * 100);
    dims.push({
      key: 'behavior_consistency', name: '行为-台词一致性', weight: 0.2, score,
      verdict: score >= 75 ? 'pass' : score >= 55 ? 'gray' : 'fail',
      details: details.length ? details.slice(0, 5) : [`${total} 个锚点中 ${pass} 个有效泄露真实意图`],
    });
  }

  return assembleReport(dims, buildIcebergSuggestions(dims));
}

/** §7.7 自动优化建议 */
function buildIcebergSuggestions(dims: QualityDimension[]): string[] {
  const out: string[] = [];
  const d = (key: string) => dims.find((x) => x.key === key)!;
  if (d('deviation').score < 70) out.push('偏差度不足：将台词改为反话/转移话题/客套话，不要让角色直接说出真实意图');
  if (d('emotion_hide').score < 75) out.push('情绪直接说出：改为通过动作、语气、环境描写间接表达');
  if (d('anchor_coverage').score < 90) out.push('缺少行为锚点：为台词增加下意识动作（攥拳/回避眼神/语气变化）');
  if (d('behavior_consistency').score < 75) out.push('行为锚点失效：调整行为描写，使其与真实意图一致、与表层台词矛盾');
  return out;
}

// ============================================================
// §8.7 冲突 4 维校验
// ============================================================

/** 抽象欲望词（出现即扣分） */
const ABSTRACT_DESIRE_WORDS = ['变强', '变厉害', '成功', '成长', '幸福', '强大', '进步', '提升', '变得更好', '出人头地'];

/** Lv4/Lv5 代价关键词（代价落地段出现 = 重量足） */
const HEAVY_COST_WORDS = [
  '修为被废', '灵根受损', '灵根被废', '道心破碎', '逐出师门', '寿元', '尽废',
  '再也没', '永远失去', '无法挽回', '烟消云散', '除名', '抹去', '破碎', '废去',
];

export interface ConflictScoreInput {
  config: ConflictConfig;
  desirePhase: string;
  resistancePhase: string;
  costPhase: string;
  /** 实际生效的 desire_type（auto 时为推断结果） */
  resolvedDesireType: DesireTypeKey | null;
}

/**
 * 冲突 4 维规则评分（欲望具体度25% / 阻力精准度35% / 代价重量25% / 节奏控制15%）
 */
export function scoreConflict(input: ConflictScoreInput): QualityReport {
  const dims: QualityDimension[] = [];
  const { config } = input;

  // ── 维度1：欲望具体度（25%）──
  {
    const target = config.desire.target;
    let score = 100;
    const details: string[] = [];
    if (target.length < 8) { score -= 40; details.push('欲望目标过短，建议具体到一个瞬间/物品'); }
    const abstractHit = ABSTRACT_DESIRE_WORDS.filter((w) => target.includes(w) || config.desire.why_it_matters.includes(w));
    if (abstractHit.length > 0) { score -= 30 * abstractHit.length; details.push(`含抽象目标词：${abstractHit.join('、')}`); }
    if (/[一二三四五六七八九十0-9]/.test(target)) details.push('含具体数量/指代，具体度好');
    score = Math.max(0, Math.min(100, score));
    dims.push({
      key: 'desire_concreteness', name: '欲望具体度', weight: 0.25, score,
      verdict: score >= 70 ? 'pass' : score >= 50 ? 'gray' : 'fail',
      details: details.length ? details : ['欲望目标具体'],
    });
  }

  // ── 维度2：阻力精准度（35%）──
  {
    const entry = getSevenInchEntry(input.resolvedDesireType ?? undefined, config.seven_inch_mapping);
    let score = 40;
    const details: string[] = [];
    if (entry) {
      const refText = `${entry.sevenInch} ${entry.resistanceDesigns.join(' ')} ${config.resistance.source}`;
      const hitRate = overlapRate(refText, input.resistancePhase);
      const designHits = entry.resistanceDesigns.filter((d) =>
        bigrams(d).some((g) => input.resistancePhase.includes(g))
      );
      if (designHits.length >= 2) score = 95;
      else if (designHits.length === 1) score = 80;
      else if (hitRate >= 0.3) score = 70;
      else if (hitRate >= 0.15) score = 55;
      else score = 35;
      details.push(`七寸（${entry.sevenInch}）方向命中 ${designHits.length} 项，关键词重叠率 ${(hitRate * 100).toFixed(0)}%`);
      if (score <= 70) details.push('处于灰色区间，已转 LLM 语义精判（如启用）');
    } else {
      score = 55;
      details.push('未匹配到欲望类型，无法做七寸比对（灰色区间）');
    }
    dims.push({
      key: 'resistance_precision', name: '阻力精准度', weight: 0.35, score,
      verdict: score >= 75 ? 'pass' : score >= 50 ? 'gray' : 'fail',
      details,
    });
  }

  // ── 维度3：代价重量感（25%）──
  {
    const irreMap: Record<string, number> = { reversible: 40, partially_reversible: 55, irreversible: 80, existential: 100 };
    let score = irreMap[config.cost.irreversibility] ?? 50;
    // cost_level 显式指定时以五级链痛感为准
    const lv = COST_LEVEL_CHAIN.find((c) => c.level === config.cost.cost_level);
    if (lv) score = Math.max(score, lv.pain * 20);
    const heavyHits = HEAVY_COST_WORDS.filter((w) => input.costPhase.includes(w));
    score = Math.min(100, score + Math.min(heavyHits.length * 5, 15));
    const details = [`不可逆程度 ${config.cost.irreversibility}${lv ? `，代价等级 ${lv.level}（${lv.name}）` : ''}`];
    if (heavyHits.length > 0) details.push(`代价落地段命中重量词：${heavyHits.slice(0, 4).join('、')}`);
    if (score < 60) details.push('代价偏轻（Lv1-Lv2 级别），建议升级到身份/道心层面');
    dims.push({
      key: 'cost_weight', name: '代价重量感', weight: 0.25, score,
      verdict: score >= 70 ? 'pass' : score >= 50 ? 'gray' : 'fail',
      details,
    });
  }

  // ── 维度4：节奏控制（15%，篇幅比 3:5:2）──
  {
    const lens = [input.desirePhase.length, input.resistancePhase.length, input.costPhase.length];
    const total = lens[0] + lens[1] + lens[2] || 1;
    const ratios = lens.map((l) => l / total);
    const expect = [0.3, 0.5, 0.2];
    const deviation = ratios.reduce((sum, r, i) => sum + Math.abs(r - expect[i]), 0);
    const score = Math.max(0, Math.round(100 - deviation * 150));
    dims.push({
      key: 'rhythm', name: '节奏控制', weight: 0.15, score,
      verdict: score >= 75 ? 'pass' : score >= 55 ? 'gray' : 'fail',
      details: [`实际篇幅比 ${ratios.map((r) => Math.round(r * 10)).join(':')}（目标 3:5:2）`],
    });
  }

  return assembleReport(dims, buildConflictSuggestions(dims));
}

/** §8.7 自动优化建议 */
function buildConflictSuggestions(dims: QualityDimension[]): string[] {
  const out: string[] = [];
  const d = (key: string) => dims.find((x) => x.key === key)!;
  if (d('desire_concreteness').score < 70) out.push('欲望太抽象：将抽象目标具象化为一个具体的场景/瞬间/物品');
  if (d('resistance_precision').score < 75) out.push('阻力打偏了：调整阻力方向，使其直接攻击欲望的核心（七寸）');
  if (d('cost_weight').score < 70) out.push('代价太轻：将代价从事件层面升级到身份/道心层面，参考代价五级升级链');
  if (d('rhythm').score < 75) out.push('节奏失衡：调整各阶段篇幅，欲望建立不宜过长，阻力降临是重点');
  return out;
}

// ============================================================
// LLM 精判层（灰色区间样本，混合方案第二步）
// ============================================================

function parseJsonLoose(text: string): any {
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const raw = (fence ? fence[1] : text).trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) return JSON.parse(raw.slice(first, last + 1));
  return JSON.parse(raw);
}

/** 偏差度 LLM 精判（60-70% 灰区样本）：返回 0-100，越高越隐藏得当 */
export async function llmJudgeDeviation(dialogueText: string, truthLayer: TruthLayerCharacter[]): Promise<number | null> {
  try {
    const res = await chatCompletion([
      { role: 'system', content: '你是台词质量评审。只输出 JSON：{"score": 0-100}。score 表示台词"准确隐藏真实意图"的得分，越直白分越低。' },
      {
        role: 'user', content:
          `【角色真实意图】\n${JSON.stringify(truthLayer, null, 2)}\n\n【表层台词】\n${dialogueText}\n\n请评估台词的隐藏质量。`,
      },
    ], { temperature: 0.2, maxTokens: 200 });
    const parsed = parseJsonLoose(res);
    const s = Number(parsed?.score);
    return Number.isFinite(s) ? Math.max(0, Math.min(100, s)) : null;
  } catch {
    return null;
  }
}

/** 阻力精准度 LLM 精判：返回 0-100 */
export async function llmJudgeResistance(desireTarget: string, resistanceText: string): Promise<number | null> {
  try {
    const res = await chatCompletion([
      { role: 'system', content: '你是冲突设计评审。只输出 JSON：{"score": 0-100}。score 表示阻力是否精准攻击了欲望核心（七寸），打偏了分低。' },
      { role: 'user', content: `【主角欲望】\n${desireTarget}\n\n【阻力降临段】\n${resistanceText}\n\n请评估阻力精准度。` },
    ], { temperature: 0.2, maxTokens: 200 });
    const parsed = parseJsonLoose(res);
    const s = Number(parsed?.score);
    return Number.isFinite(s) ? Math.max(0, Math.min(100, s)) : null;
  } catch {
    return null;
  }
}

/**
 * 对冰山报告中的灰色维度做 LLM 精判并回填分数（可选调用）
 */
export async function refineIcebergWithLlm(
  report: QualityReport, input: IcebergScoreInput
): Promise<QualityReport> {
  const dev = report.dimensions.find((d) => d.key === 'deviation');
  if (dev && dev.verdict === 'gray') {
    const judged = await llmJudgeDeviation(
      input.surfaceLayer.map((l) => `${l.speaker}：${l.line}`).join('\n'),
      input.truthLayer
    );
    if (judged != null) {
      dev.score = judged;
      dev.verdict = judged >= 70 ? 'pass' : 'fail';
      dev.details.push(`LLM 精判偏差度得分：${judged}`);
    }
  }
  return assembleReport(report.dimensions, buildIcebergSuggestions(report.dimensions));
}

/**
 * 对冲突报告中的阻力精准度灰区做 LLM 精判并回填分数（可选调用）
 */
export async function refineConflictWithLlm(
  report: QualityReport, input: ConflictScoreInput
): Promise<QualityReport> {
  const res = report.dimensions.find((d) => d.key === 'resistance_precision');
  if (res && res.verdict === 'gray') {
    const judged = await llmJudgeResistance(input.config.desire.target, input.resistancePhase);
    if (judged != null) {
      res.score = judged;
      res.verdict = judged >= 70 ? 'pass' : 'fail';
      res.details.push(`LLM 精判阻力精准度得分：${judged}`);
    }
  }
  return assembleReport(report.dimensions, buildConflictSuggestions(report.dimensions));
}

// ============================================================
// §9.3 交叉校验（组合工作流，LLM 为主 + 风格规则初筛）
// ============================================================

/** 现代口语词（仙侠风格断裂检测，规则初筛零token） */
const MODERN_WORDS = ['手机', '电脑', '网络', '咖啡', '沙发', '汽车', '地铁', 'OK', '拜拜', '打卡', '老板', '公司', '视频', '电话', '短信'];

export const CROSS_DIMENSIONS = [
  { key: 'consistency', name: '冲突-台词一致性', weight: 0.25 },
  { key: 'progression', name: '台词推进冲突', weight: 0.25 },
  { key: 'anchor_service', name: '行为锚点服务冲突', weight: 0.2 },
  { key: 'curve_match', name: '情绪曲线匹配', weight: 0.2 },
  { key: 'style_unity', name: '仙侠风格统一', weight: 0.1 },
] as const;

/**
 * 交叉校验：LLM 五维打分 + 现代词规则初筛
 */
export async function crossValidateCompose(
  fullText: string,
  config: ConflictConfig,
  curve: EmotionCurve,
  minScore: number
): Promise<{ total: number; passed: boolean; min_score: number; dimensions: QualityDimension[] }> {
  // 规则初筛：现代词混入直接拉低风格统一分
  const modernHits = MODERN_WORDS.filter((w) => fullText.includes(w));

  let llmScores: Record<string, number> = {};
  let llmNotes: Record<string, string> = {};
  try {
    const res = await chatCompletion([
      {
        role: 'system',
        content: '你是仙侠小说总编审。对给定的完整冲突戏按五个维度打分。只输出 JSON：\n' +
          '{"consistency": 0-100, "progression": 0-100, "anchor_service": 0-100, "curve_match": 0-100, "style_unity": 0-100, "notes": {"consistency": "...", "progression": "...", "anchor_service": "...", "curve_match": "...", "style_unity": "..."}}\n' +
          '维度含义：consistency=台词情绪底色与冲突阶段匹配；progression=每句重要台词推高冲突；anchor_service=行为锚点暴露冲突真实情绪；curve_match=台词情绪强度与情绪曲线一致；style_unity=仙侠风格统一无现代口语。',
      },
      {
        role: 'user',
        content: `【冲突设定】主角 ${config.protagonist.name}，欲望：${config.desire.target}，阻力：${config.resistance.source}，代价：${config.cost.what_is_lost}\n` +
          `【情绪曲线】期待峰值 ${curve.expectation_peak} / 压抑深度 ${curve.suppression_depth} / 代价重量 ${curve.cost_weight}\n\n【完整冲突戏】\n${fullText}`,
      },
    ], { temperature: 0.2, maxTokens: 800 });
    const parsed = parseJsonLoose(res);
    for (const d of CROSS_DIMENSIONS) {
      const v = Number(parsed?.[d.key]);
      if (Number.isFinite(v)) llmScores[d.key] = Math.max(0, Math.min(100, v));
    }
    llmNotes = parsed?.notes || {};
  } catch {
    // LLM 不可用时退化为规则兜底分（中性 60）
  }

  const dimensions: QualityDimension[] = CROSS_DIMENSIONS.map((d) => {
    let score = llmScores[d.key] ?? 60;
    const details: string[] = [];
    if (llmNotes[d.key]) details.push(String(llmNotes[d.key]).slice(0, 120));
    if (d.key === 'style_unity' && modernHits.length > 0) {
      score = Math.max(0, score - modernHits.length * 15);
      details.push(`检测到现代口语词：${modernHits.slice(0, 5).join('、')}`);
    }
    return {
      key: d.key, name: d.name, weight: d.weight, score: Math.round(score),
      verdict: score >= 70 ? 'pass' : score >= 55 ? 'gray' : 'fail',
      details: details.length ? details : [llmScores[d.key] != null ? 'LLM 评审通过' : 'LLM 不可用，采用规则兜底分'],
    };
  });

  const total = Math.round(dimensions.reduce((sum, d) => sum + d.score * d.weight, 0));
  return { total, passed: total >= minScore, min_score: minScore, dimensions };
}

// ============================================================
// 情绪曲线启发式计算（§8.5，零token确定性规则）
// ============================================================

/** 阻力类型 → 压抑强度基数 */
const RESISTANCE_SUPPRESSION: Record<string, number> = {
  humiliation: 80,
  negation_of_effort: 75,
  negation_of_desire: 70,
  rejection: 60,
  physical: 65,
};

/**
 * 由配置推导情绪曲线四项指标（0-100）
 */
export function computeEmotionCurve(config: ConflictConfig): EmotionCurve {
  // 期待峰值：why_it_matters 越长越具体 + 主角现状越具体，期待越高
  const whyLen = Math.min(config.desire.why_it_matters.length, 100);
  const expectationPeak = Math.min(95, 45 + Math.round(whyLen / 2.5) + (config.protagonist.current_status ? 10 : 0));

  // 压抑深度：阻力类型基数 + 精准度修正
  const base = RESISTANCE_SUPPRESSION[config.resistance.type] ?? 60;
  const precisionBoost = { high: 12, medium: 6, auto: 6, low: -8 }[config.resistance.precision] ?? 0;
  const suppressionDepth = Math.max(20, Math.min(98, base + precisionBoost));

  // 代价重量：五级链痛感 ×20；未指定等级按不可逆程度映射
  const lv = COST_LEVEL_CHAIN.find((c) => c.level === config.cost.cost_level);
  const irreLv: Record<string, number> = { reversible: 2, partially_reversible: 3, irreversible: 4, existential: 5 };
  const pain = lv?.pain ?? irreLv[config.cost.irreversibility] ?? 3;
  const costWeight = Math.min(100, pain * 16 + config.cost.emotional_weight * 4);

  return {
    expectation_peak: expectationPeak,
    suppression_depth: suppressionDepth,
    drop_amplitude: expectationPeak + suppressionDepth,
    cost_weight: costWeight,
  };
}

// ============================================================
// 组装报告
// ============================================================

function assembleReport(dimensions: QualityDimension[], _suggestions: string[]): QualityReport {
  const total = Math.round(dimensions.reduce((sum, d) => sum + d.score * d.weight, 0));
  return { total, passed: total >= 70, dimensions };
}

/** 冰山建议（对外导出供编排层使用） */
export function icebergSuggestions(report: QualityReport): string[] {
  return buildIcebergSuggestions(report.dimensions);
}

/** 冲突建议（对外导出供编排层使用） */
export function conflictSuggestions(report: QualityReport): string[] {
  return buildConflictSuggestions(report.dimensions);
}

/** 组合场景下的欲望类型解析（显式指定优先，否则关键词推断） */
export function resolveDesireType(config: ConflictConfig): DesireTypeKey | null {
  if (config.desire.desire_type) return config.desire.desire_type;
  return inferDesireType(`${config.desire.target} ${config.desire.why_it_matters}`, config.seven_inch_mapping);
}
