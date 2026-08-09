/**
 * 去AI味语料回归脚本（开源借鉴 PRD v1.1 模块三 US-04 / 去AI味语料收集规格说明-v1 §6）
 *
 * 对 tests/fixtures/ai-flavor-corpus 全量语料逐条跑 scanAIFlavor：
 *   1. 断言 overallLevel === manifest.expectedLevel（验收要求 100%）
 *   2. 正例额外断言 expectedRules 对应计数 > 0（句式均匀度断言 > 0.6）
 *   3. 豁免条目（含 <!-- 去味:跳过 --> 标记）：与欠账门同语义——标记出现在首 6 行内
 *      即整章豁免（见 services/debt-gate.ts INLINE_SKIP_MARK / inline_skip），不再扫描；
 *      仅断言 manifest 标为 green；标记不在首 6 行时回退为剥离标记行后扫描
 *
 * 用法：pnpm --filter server test:ai-flavor
 * 规则变更（ai-flavor-detector.ts 词表/公式）后必须跑本回归，全绿才可合入。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanAIFlavor, type AIFlavorScanResult } from '../src/rag/ai-flavor-detector.js';

const BASE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'ai-flavor-corpus');
const SKIP_MARK_LINE = /<!--\s*去味:跳过\s*-->/;

interface ManifestEntry {
  file: string;
  expectedLevel: 'red' | 'yellow' | 'green';
  expectedRules?: string[];
  source?: string;
  note?: string;
}

/** 规则维度名 → 扫描结果断言（对应规格 §3 九维度） */
const RULE_CHECKS: Record<string, (r: AIFlavorScanResult) => boolean> = {
  '元叙述': (r) => r.metaNarrationCount > 0,
  '抽象判断词': (r) => r.abstractJudgmentCount > 0,
  '填充短语': (r) => r.fillerPhraseCount > 0,
  '套路化连接词': (r) => r.routineConnectorCount > 0,
  '万能形容词': (r) => r.universalAdjectiveCount > 0,
  '客观陈述腔': (r) => r.objectiveStatementCount > 0,
  '凑字副词': (r) => r.fillerAdverbCount > 0,
  '句首重复': (r) => r.repetitiveStarters > 0,
  '句式均匀度': (r) => r.sentenceUniformity > 0.6,
  '豁免': () => true, // 豁免条目：剥离标记行后按 expectedLevel 断言即可
};

/** 剥离含豁免标记的行（门禁层同语义：标记所在段落不参与扫描） */
function stripSkipMarks(content: string): string {
  return content
    .split('\n')
    .filter((line) => !SKIP_MARK_LINE.test(line))
    .join('\n');
}

function summarize(r: AIFlavorScanResult): string {
  return `level=${r.overallLevel} flags[meta=${r.metaNarrationCount},abs=${r.abstractJudgmentCount},starter=${r.repetitiveStarters},conn=${r.routineConnectorCount},adj=${r.universalAdjectiveCount},obj=${r.objectiveStatementCount},adv=${r.fillerAdverbCount}] uniformity=${r.sentenceUniformity}`;
}

function main(): number {
  const manifest = readFileSync(join(BASE_DIR, 'manifest.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l, i) => {
      try {
        return JSON.parse(l) as ManifestEntry;
      } catch {
        throw new Error(`manifest.jsonl 第 ${i + 1} 行 JSON 解析失败`);
      }
    });

  let pass = 0;
  const failures: string[] = [];
  const levelStat: Record<string, { total: number; ok: number }> = {
    red: { total: 0, ok: 0 },
    yellow: { total: 0, ok: 0 },
    green: { total: 0, ok: 0 },
  };

  for (const entry of manifest) {
    const errors: string[] = [];
    let result: AIFlavorScanResult | null = null;
    try {
      const raw = readFileSync(join(BASE_DIR, entry.file), 'utf8');
      const firstSix = raw.split('\n').slice(0, 6);
      // 豁免条目：与欠账门 inline_skip 同语义——首 6 行含标记即整章豁免，不扫描
      if (firstSix.some((l) => SKIP_MARK_LINE.test(l))) {
        if (entry.expectedLevel !== 'green') {
          errors.push(`豁免条目 expectedLevel 应为 green，实际 ${entry.expectedLevel}`);
        }
        levelStat[entry.expectedLevel] = levelStat[entry.expectedLevel] ?? { total: 0, ok: 0 };
        levelStat[entry.expectedLevel].total++;
        if (errors.length) {
          failures.push(`❌ ${entry.file}（${entry.note ?? ''}）\n   ${errors.join('；')}`);
        } else {
          pass++;
          levelStat[entry.expectedLevel].ok++;
        }
        continue;
      }
      const content = SKIP_MARK_LINE.test(raw) ? stripSkipMarks(raw) : raw;
      result = scanAIFlavor(content);

      // 断言 1：评级
      if (result.overallLevel !== entry.expectedLevel) {
        errors.push(`评级不符：期望 ${entry.expectedLevel}，实际 ${result.overallLevel}`);
      }
      // 断言 2：expectedRules 命中（反例 green 的 expectedRules 应为空或仅"豁免"）
      for (const rule of entry.expectedRules ?? []) {
        const check = RULE_CHECKS[rule];
        if (!check) {
          errors.push(`未知规则维度："${rule}"`);
          continue;
        }
        if (!check(result)) {
          errors.push(`规则"${rule}"未命中`);
        }
      }
    } catch (e: any) {
      errors.push(`执行异常：${e?.message || e}`);
    }

    levelStat[entry.expectedLevel] = levelStat[entry.expectedLevel] ?? { total: 0, ok: 0 };
    levelStat[entry.expectedLevel].total++;
    if (errors.length) {
      failures.push(`❌ ${entry.file}（${entry.note ?? ''}）\n   ${errors.join('；')}\n   ${result ? summarize(result) : '(无扫描结果)'}`);
    } else {
      pass++;
      levelStat[entry.expectedLevel].ok++;
    }
  }

  // ---- 汇总报告 ----
  console.log('\n===== 去AI味语料回归 =====');
  for (const [lv, s] of Object.entries(levelStat)) {
    console.log(`  ${lv.padEnd(6)} ${s.ok}/${s.total}`);
  }
  console.log(`  总计   ${pass}/${manifest.length}`);
  if (failures.length) {
    console.log(`\n不达标条目（${failures.length} 条）：`);
    for (const f of failures.slice(0, 50)) console.log(f);
    if (failures.length > 50) console.log(`  ...其余 ${failures.length - 50} 条省略`);
    console.log('\n❌ 回归失败：规则变更不得破坏语料库断言，请修复后重跑');
    return 1;
  }
  console.log('\n✅ 全量通过：规则与语料库一致');
  return 0;
}

process.exit(main());
