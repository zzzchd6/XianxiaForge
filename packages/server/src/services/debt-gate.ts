/**
 * 毒句式欠账门（开源借鉴 PRD v1.1 M1，P0）
 * 写第 N 章前检查上一章 blocking 级 AI 味：未清即拦截，支持豁免。
 *
 * blocking 判定（用户确认口径）：
 *   - scanAIFlavor 总评级 red，或
 *   - runQualityGate 产出 critical / major 级问题
 * 豁免三选一（本期实现前两种）：
 *   - 上一章正文首 6 行含 <!-- 去味:跳过 --> → 整章豁免
 *   - deslop_whitelist 项目级词表：pattern 子串命中原文的 issue 不计 blocking
 * 全程零 token 本地规则，单章 ≤ 500ms。
 */
import { eq, and } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { scanAIFlavor } from '../rag/ai-flavor-detector.js';
import { runQualityGate } from '../rag/quality-gate.js';

/** 行内豁免注释（首 6 行内出现即整章豁免） */
export const INLINE_SKIP_MARK = '去味:跳过';

/** 错误消息前缀（前端/队列据此识别欠账门拦截，不自动重试） */
export const DEBT_GATE_ERROR_PREFIX = 'DEBT_GATE_BLOCKED:';

export interface DebtIssue {
  /** flavor=去AI味扫描 / gate=零token门禁 */
  kind: 'flavor' | 'gate';
  rule: string;
  severity: 'blocking' | 'advisory';
  excerpt: string;
  line?: number | null;
}

export interface DebtGateResult {
  blocked: boolean;
  /** 未拦截原因：开关关闭 / 无上一章 / 行内豁免 */
  skippedReason?: 'disabled' | 'no_prev' | 'inline_skip';
  prevChapter?: {
    id: number;
    chapterPlanId: number | null;
    volumeNo: number | null;
    chapterNo: number | null;
    title: string | null;
  };
  issues: DebtIssue[];
  /** 被 whitelist 豁免的命中数 */
  exemptedCount: number;
}

/** 欠账门拦截异常（message 为 DEBT_GATE_BLOCKED: + JSON payload，前端可解析） */
export class DebtGateBlockedError extends Error {
  payload: DebtGateResult;
  constructor(payload: DebtGateResult) {
    super(DEBT_GATE_ERROR_PREFIX + JSON.stringify(payload));
    this.name = 'DebtGateBlockedError';
    this.payload = payload;
  }
}

/** 读取项目 whitelist patterns */
export async function getWhitelistPatterns(projectId: number): Promise<string[]> {
  const rows = await creativeDb
    .select({ pattern: schema.deslopWhitelist.pattern })
    .from(schema.deslopWhitelist)
    .where(eq(schema.deslopWhitelist.projectId, projectId));
  return rows.map((r) => r.pattern).filter((p) => p && p.trim());
}

/**
 * 对一段正文跑 blocking 检查（纯函数+whitelist 过滤，供欠账门与预览端点复用）
 */
export function scanBlockingIssues(content: string, whitelist: string[]): { issues: DebtIssue[]; exemptedCount: number } {
  const issues: DebtIssue[] = [];

  // 1. 去AI味扫描：red 评级视为 blocking（明细列出指纹命中）
  const flavor = scanAIFlavor(content);
  if (flavor.overallLevel === 'red') {
    const detailHits = [
      ...flavor.signatureHits.map((h) => ({ rule: `AI指纹·${h.category}`, excerpt: h.phrase, line: h.line })),
      ...flavor.metaNarrationHits.slice(0, 5).map((h) => ({ rule: '元叙述/解释腔', excerpt: h.phrase, line: h.line })),
    ];
    if (detailHits.length) {
      for (const h of detailHits.slice(0, 20)) {
        issues.push({ kind: 'flavor', rule: h.rule, severity: 'blocking', excerpt: h.excerpt, line: h.line });
      }
    } else {
      issues.push({
        kind: 'flavor', rule: 'AI味总评级red', severity: 'blocking',
        excerpt: `句首重复${flavor.repetitiveStarters}处/填充短语${flavor.fillerPhraseCount}处/抽象判断词${flavor.abstractJudgmentCount}处`,
        line: null,
      });
    }
  }

  // 2. 零 token 门禁：critical / major 视为 blocking
  const gate = runQualityGate(content);
  for (const g of gate.issues) {
    if (g.severity !== 'critical' && g.severity !== 'major') continue;
    issues.push({
      kind: 'gate', rule: g.type, severity: 'blocking',
      excerpt: (g.samples && g.samples.length ? g.samples[0] : g.message).slice(0, 120),
      line: null,
    });
  }

  // 3. whitelist 豁免：pattern 子串命中 issue 原文即剔除
  if (whitelist.length) {
    const kept: DebtIssue[] = [];
    let exempted = 0;
    for (const it of issues) {
      if (whitelist.some((p) => it.excerpt.includes(p) || it.rule.includes(p))) { exempted++; continue; }
      kept.push(it);
    }
    return { issues: kept, exemptedCount: exempted };
  }
  return { issues, exemptedCount: 0 };
}

/**
 * 欠账门检查：生成 (volumeNo, chapterNo) 前，检查上一章 blocking 欠账。
 * @param genCfg 项目 generationConfig（debtGateEnabled !== false 时启用）
 */
export async function checkDebtGate(
  projectId: number,
  volumeNo: number,
  chapterNo: number,
  genCfg: Record<string, any> = {},
): Promise<DebtGateResult> {
  if (genCfg.debtGateEnabled === false) {
    return { blocked: false, skippedReason: 'disabled', issues: [], exemptedCount: 0 };
  }

  // 上一章：同项目 isCurrent 版本中 (volumeNo, chapterNo) 小于目标且最接近的一章
  const chapters = await creativeDb
    .select({
      id: schema.generatedChapter.id,
      chapterPlanId: schema.generatedChapter.chapterPlanId,
      volumeNo: schema.generatedChapter.volumeNo,
      chapterNo: schema.generatedChapter.chapterNo,
      title: schema.generatedChapter.title,
      content: schema.generatedChapter.content,
    })
    .from(schema.generatedChapter)
    .where(and(
      eq(schema.generatedChapter.projectId, projectId),
      eq(schema.generatedChapter.isCurrent, true),
    ));
  const prev = chapters
    .filter((c) => c.volumeNo != null && c.chapterNo != null &&
      (c.volumeNo! < volumeNo || (c.volumeNo === volumeNo && c.chapterNo! < chapterNo)))
    .sort((a, b) => (b.volumeNo! - a.volumeNo!) || (b.chapterNo! - a.chapterNo!))[0];

  if (!prev || !prev.content) {
    return { blocked: false, skippedReason: 'no_prev', issues: [], exemptedCount: 0 };
  }

  const prevRef = {
    id: prev.id, chapterPlanId: prev.chapterPlanId,
    volumeNo: prev.volumeNo, chapterNo: prev.chapterNo, title: prev.title,
  };

  // 行内豁免：首 6 行含标记
  const headLines = prev.content.split('\n').slice(0, 6).join('\n');
  if (headLines.includes(INLINE_SKIP_MARK)) {
    return { blocked: false, skippedReason: 'inline_skip', prevChapter: prevRef, issues: [], exemptedCount: 0 };
  }

  const whitelist = await getWhitelistPatterns(projectId);
  const { issues, exemptedCount } = scanBlockingIssues(prev.content, whitelist);

  return {
    blocked: issues.length > 0,
    prevChapter: prevRef,
    issues,
    exemptedCount,
  };
}
