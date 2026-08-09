/**
 * 本地质量门禁工具集（零 token，确定性规则）
 * 全部基于字符串匹配和统计，不调用 LLM
 * 对应 Lorn scripts/ 目录中的核心质检能力：
 * - scan_text_quality → detectMetaNarration
 * - run_pov_gate → detectPOVViolation
 * - diag_cn_repetition → detectRepetitiveStarts
 * - prune_cn_body_sentences → detectFillerSentences
 */
import { scanForbiddenWords } from './style.js';
import { runFactCheck } from './fact-checker.js';
import type { HardFactsContext } from '../types.js';

export interface QualityGateIssue {
  type: string;
  severity: 'critical' | 'major' | 'minor';
  message: string;
  count: number;
  samples?: string[];
}

export interface QualityGateResult {
  passed: boolean;
  issues: QualityGateIssue[];
}

// ============================================================
// 1. 元叙述检测（上帝视角、解释腔）
// ============================================================
const META_NARRATION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /他心[想道中暗]/g, label: '心理越界' },
  { pattern: /她心[想道中暗]/g, label: '心理越界' },
  { pattern: /值得一[提说]的是/g, label: '说明文腔' },
  { pattern: /需要[指出说明]的是/g, label: '说明文腔' },
  { pattern: /总而言[之]/g, label: '总结腔' },
  { pattern: /综上所述/g, label: '总结腔' },
  { pattern: /不得不说/g, label: '评论腔' },
  { pattern: /可以说/g, label: '评论腔' },
];

export function detectMetaNarration(content: string): { total: number; hits: Array<{ label: string; count: number }> } {
  const hits: Array<{ label: string; count: number }> = [];
  let total = 0;
  for (const { pattern, label } of META_NARRATION_PATTERNS) {
    const match = content.match(pattern);
    if (match && match.length > 0) {
      hits.push({ label, count: match.length });
      total += match.length;
    }
  }
  return { total, hits };
}

// ============================================================
// 2. POV 视角越界检测
// ============================================================
/**
 * 检测在限知视角下，是否出现了对非视角人物的心理描写
 * @param content 章节正文
 * @param povNames 视角人物姓名列表
 */
export function detectPOVViolation(content: string, povNames: string[]): {
  violations: Array<{ character: string; context: string }>;
  count: number;
} {
  const violations: Array<{ character: string; context: string }> = [];
  const psychPattern = /(.{0,10})(心[想道中暗]|暗道|暗想|心中)(.{0,20})/g;

  let match;
  while ((match = psychPattern.exec(content)) !== null) {
    const before = match[1] || '';
    // 检查前面是否是视角人物
    const isPOV = povNames.some(name => before.includes(name));
    if (!isPOV && before.trim().length > 0) {
      violations.push({
        character: before.trim().slice(-5),
        context: match[0].slice(0, 30),
      });
    }
  }
  return { violations, count: violations.length };
}

// ============================================================
// 3. 重复句群检测（连续段落开头相同）
// ============================================================
export function detectRepetitiveStarts(content: string): {
  count: number;
  groups: Array<{ starter: string; repeatCount: number }>;
} {
  const lines = content.split('\n').filter(l => l.trim().length > 10);
  const groups: Array<{ starter: string; repeatCount: number }> = [];
  let total = 0;

  let i = 0;
  while (i < lines.length - 2) {
    const starter = lines[i].trim().slice(0, 4);
    let repeatCount = 1;
    let j = i + 1;
    while (j < lines.length && lines[j].trim().slice(0, 4) === starter) {
      repeatCount++;
      j++;
    }
    if (repeatCount >= 3) {
      groups.push({ starter, repeatCount });
      total += repeatCount;
    }
    i = j;
  }
  return { count: total, groups };
}

// ============================================================
// 4. 注水句子检测（无实质信息的修饰句）
// ============================================================
const FILLER_PATTERNS: RegExp[] = [
  /仿佛.{0,6}一般/g,
  /似乎.{0,6}的样子/g,
  /宛如.{0,8}般/g,
  /犹如.{0,8}一般/g,
];

export function detectFillerSentences(content: string): number {
  let count = 0;
  for (const p of FILLER_PATTERNS) {
    count += (content.match(p) || []).length;
  }
  return count;
}

// ============================================================
// 5. 叙事技法零 token 检查
// ============================================================

// 心理描写高频词（转场冗余检测用）
const PSYCH_WORDS = /心中|心想|暗想|寻思|琢磨|回忆|想起|不禁|暗自|默默|沉思|犹豫|纠结|内心|心头|脑海/i;

/**
 * N1: 转场冗余检测
 * 检查段落中是否存在"转场 + 大段心理描写"的模式：
 * 段落以时间/空间转场词开头，但包含 3+ 个心理描写词且超过 80 字
 */
export function checkTransitionLength(content: string): string[] {
  const issues: string[] = [];
  const paragraphs = content.split(/\n+/).filter(p => p.trim().length > 0);
  const TRANSITION_START = /^(第[二三四五六七八九十]天|次日|翌日|过了|几天后|片刻后|与此同时|另一边|转眼间|不多时|随即|随后|于是|回到|来到|走进|踏入)/;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length < 80) continue;
    if (!TRANSITION_START.test(trimmed)) continue;
    const psychHits = (trimmed.match(new RegExp(PSYCH_WORDS.source, 'gi')) || []).length;
    if (psychHits >= 3) {
      issues.push(`转场段含 ${psychHits} 个心理描写词（${trimmed.slice(0, 30)}…）`);
    }
  }
  return issues;
}

/**
 * N2: 章末钩子检测
 * 检查最后一句是否为"总结句/道理句/抒情句"（反模式）
 */
export function checkChapterHook(content: string): string | null {
  const sentences = content.split(/[。！？…]+/).filter(s => s.trim().length > 0);
  if (sentences.length === 0) return null;
  const lastSentence = sentences[sentences.length - 1].trim();
  if (lastSentence.length < 4) return null;

  // 总结/道理/抒情反模式关键词
  const ANTI_HOOK = /(这就是|这便是|或许.*就是|也许.*才是|一切.*都|所有.*终|人生|命运|岁月|时光.*流逝|故事.*结束|一切.*归于平静|他明白了|她终于懂了|日子.*继续|生活.*还在继续)/;
  if (ANTI_HOOK.test(lastSentence)) {
    return `章末疑似总结/抒情句："${lastSentence.slice(0, 40)}"`;
  }
  return null;
}

/**
 * N3: 旁白占比检测
 * 统计不含对话（无引号）且不含动作描写的纯叙述段落字数占比
 */
export function checkNarrationRatio(content: string): string | null {
  const paragraphs = content.split(/\n+/).filter(p => p.trim().length > 20);
  if (paragraphs.length < 3) return null;

  let totalChars = 0;
  let narrationChars = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    totalChars += trimmed.length;
    // 含对话标记（中文引号）的段落不算纯旁白
    const hasDialogue = /[""「」『』]/.test(trimmed);
    // 含人物动作的段落不算纯旁白（代词+动词 或 多字动作短语）
    const hasAction = /[他她它][^。，]{0,4}(走|跑|跳|拿|放|推|拉|打|砍|挥|站|坐|躺|抬|伸|握|踢|冲|扑|闪|劈|刺|拍|按|摸|碰|撞|摔|扔|捡|搬|抱|扶|拽|拖|提|拎|端|倒|饮|吃|喝|咬|吞|吐|吸|呼|喘|咳|笑|哭|喊|叫|吼|骂|叹|唱|说|问|答|嘟囔|嘀咕)/.test(trimmed)
      || /(走进|走出|推开|拉开|拿起|放下|转身|回头|拔出|收回|跃起|落地|跪下|站起身|伸出手|抬起头|低下头|深吸一口气|点了点头|摇了摇头|叹了口气)/.test(trimmed);
    if (!hasDialogue && !hasAction) {
      narrationChars += trimmed.length;
    }
  }

  const ratio = narrationChars / totalChars;
  if (ratio > 0.4) {
    return `纯旁白占比 ${(ratio * 100).toFixed(0)}%（超过 40% 阈值），建议通过对话/动作/场景呈现信息`;
  }
  return null;
}

// ============================================================
// 6. 综合质量门禁
// ============================================================
export function runQualityGate(
  content: string,
  options: { povNames?: string[]; forbiddenWords?: string[]; hardFacts?: HardFactsContext } = {}
): QualityGateResult {
  const issues: QualityGateIssue[] = [];

  // 元叙述
  const meta = detectMetaNarration(content);
  if (meta.total >= 5) {
    issues.push({
      type: 'meta_narration',
      severity: meta.total >= 10 ? 'major' : 'minor',
      message: `检测到元叙述/解释腔 ${meta.total} 处`,
      count: meta.total,
      samples: meta.hits.map(h => `${h.label}×${h.count}`),
    });
  }

  // POV 越界
  if (options.povNames?.length) {
    const pov = detectPOVViolation(content, options.povNames);
    if (pov.count >= 3) {
      issues.push({
        type: 'pov_violation',
        severity: 'major',
        message: `检测到视角越界 ${pov.count} 处`,
        count: pov.count,
        samples: pov.violations.slice(0, 3).map(v => `${v.character}: "${v.context}"`),
      });
    }
  }

  // 句首重复
  const repeats = detectRepetitiveStarts(content);
  if (repeats.count > 0) {
    issues.push({
      type: 'repetitive_starts',
      severity: repeats.groups.some(g => g.repeatCount >= 5) ? 'major' : 'minor',
      message: `检测到句首重复 ${repeats.groups.length} 组`,
      count: repeats.count,
      samples: repeats.groups.slice(0, 3).map(g => `"${g.starter}..."×${g.repeatCount}`),
    });
  }

  // 注水句子
  const fillerCount = detectFillerSentences(content);
  if (fillerCount >= 8) {
    issues.push({
      type: 'filler_sentences',
      severity: fillerCount >= 15 ? 'major' : 'minor',
      message: `检测到注水修饰句 ${fillerCount} 处`,
      count: fillerCount,
    });
  }

  // 禁用词（复用现有）
  if (options.forbiddenWords?.length) {
    const hits = scanForbiddenWords(content, options.forbiddenWords);
    if (hits.length > 0) {
      issues.push({
        type: 'forbidden_words',
        severity: 'critical',
        message: `出现禁用词 ${hits.length} 个`,
        count: hits.length,
        samples: hits.slice(0, 5),
      });
    }
  }

  // 硬性事实校验（人称-性别/时间数字/境界词，零 token）
  if (options.hardFacts) {
    const factResult = runFactCheck(content, options.hardFacts);
    if (factResult.count > 0) {
      const criticals = factResult.violations.filter(v => v.severity === 'critical');
      const majors = factResult.violations.filter(v => v.severity === 'major');
      if (criticals.length > 0) {
        issues.push({
          type: 'fact_violation',
          severity: 'critical',
          message: `检测到设定事实矛盾 ${criticals.length} 处（人称/时间/境界）`,
          count: criticals.length,
          samples: criticals.slice(0, 3).map(v => `${v.message} → "${v.excerpt}"`),
        });
      }
      if (majors.length > 0) {
        issues.push({
          type: 'fact_warning',
          severity: 'major',
          message: `检测到疑似设定偏差 ${majors.length} 处`,
          count: majors.length,
          samples: majors.slice(0, 3).map(v => `${v.message} → "${v.excerpt}"`),
        });
      }
    }
  }

  // ── 叙事技法零 token 检查 ──

  // N1: 转场冗余检测（连续心理描写词超过阈值的段落）
  const transitionIssues = checkTransitionLength(content);
  if (transitionIssues.length > 0) {
    issues.push({
      type: 'narrative_transition',
      severity: 'minor',
      message: `检测到 ${transitionIssues.length} 处冗余转场（含过多心理描写）`,
      count: transitionIssues.length,
      samples: transitionIssues.slice(0, 3),
    });
  }

  // N2: 章末钩子检测（最后一句是否为总结/抒情/道理句）
  const hookIssue = checkChapterHook(content);
  if (hookIssue) {
    issues.push({
      type: 'narrative_hook',
      severity: 'minor',
      message: hookIssue,
      count: 1,
      samples: [hookIssue],
    });
  }

  // N3: 旁白占比检测（纯叙述段落字数占比过高）
  const narrationIssue = checkNarrationRatio(content);
  if (narrationIssue) {
    issues.push({
      type: 'narrative_narration',
      severity: 'minor',
      message: narrationIssue,
      count: 1,
      samples: [narrationIssue],
    });
  }

  const passed = !issues.some(i => i.severity === 'critical' || i.severity === 'major');
  return { passed, issues };
}
