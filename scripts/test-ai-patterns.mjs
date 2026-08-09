/**
 * 去AI味语料库回归验收脚本
 * 依据：outputs/去AI味语料收集规格说明-v1.md §6.2
 * 逐条调用真实 scanAIFlavor（packages/server/src/rag/ai-flavor-detector.ts）：
 *   1. 断言 overallLevel === manifest.expectedLevel
 *   2. blocking 正例额外断言 expectedRules 对应计数 > 0
 *   3. 豁免场景（<!-- 去味:跳过 -->）剥离标记段后再扫描（与门禁层 debt-gate.ts 一致）
 * 任一失败：输出明细并以非零退出码结束。
 *
 * 用法：node scripts/test-ai-patterns.mjs [corpusDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanAIFlavor } from '../packages/server/src/rag/ai-flavor-detector.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(__dirname, '..', process.argv[2] ?? 'outputs/ai-flavor-corpus');
const EXEMPT_MARK = '<!-- 去味:跳过 -->';

// 与检测器接口对应的规则计数
const RULE_COUNTS = {
  '元叙述': (r) => r.metaNarrationCount,
  '抽象判断词': (r) => r.abstractJudgmentCount,
  '填充短语': (r) => r.fillerPhraseCount,
  '套路化连接词': (r) => r.routineConnectorCount,
  '万能形容词': (r) => r.universalAdjectiveCount,
  '客观陈述腔': (r) => r.objectiveStatementCount,
  '凑字副词': (r) => r.fillerAdverbCount,
  '句首重复': (r) => r.repetitiveStarters,
  '句式均匀度': (r) => (r.sentenceUniformity > 0.6 ? 1 : 0),
};

// 剥离豁免标记所在段落（与 debt-gate.ts 整段豁免语义一致）
function stripExempt(content) {
  if (!content.includes(EXEMPT_MARK)) return content;
  return content.split(/\n\s*\n/).filter((p) => !p.includes(EXEMPT_MARK)).join('\n\n');
}

function main() {
  const manifestPath = path.join(CORPUS_DIR, 'manifest.jsonl');
  if (!fs.existsSync(manifestPath)) {
    console.error(`manifest 不存在: ${manifestPath}`);
    process.exit(2);
  }
  const entries = fs.readFileSync(manifestPath, 'utf8').trim().split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const failures = [];
  const stats = { red: 0, yellow: 0, green: 0 };

  for (const entry of entries) {
    const abs = path.join(CORPUS_DIR, entry.file);
    if (!fs.existsSync(abs)) {
      failures.push({ file: entry.file, why: '文件缺失' });
      continue;
    }
    const content = fs.readFileSync(abs, 'utf8');
    const stripped = stripExempt(content);
    const r = scanAIFlavor(stripped);
    stats[r.overallLevel]++;

    const levelOk = r.overallLevel === entry.expectedLevel;
    if (!levelOk) {
      failures.push({ file: entry.file, why: `期望 ${entry.expectedLevel}，实际 ${r.overallLevel}` });
      continue;
    }

    // blocking 正例：expectedRules 对应计数 > 0（豁免场景的 ["豁免"] 不在此列）
    if (entry.expectedLevel === 'red') {
      for (const rule of entry.expectedRules) {
        const count = RULE_COUNTS[rule] ? RULE_COUNTS[rule](r) : 0;
        if (count <= 0) {
          failures.push({ file: entry.file, why: `期望规则「${rule}」未命中（计数 0）` });
        }
      }
    }
  }

  const total = entries.length;
  const pass = total - failures.length;
  console.log('=== 去AI味语料回归 ===');
  console.log(`语料库: ${CORPUS_DIR}`);
  console.log(`总量: ${total}（blocking ${entries.filter(e => e.expectedLevel === 'red').length} / advisory ${entries.filter(e => e.expectedLevel === 'yellow').length} / clean ${entries.filter(e => e.expectedLevel === 'green').length}）`);
  console.log(`扫描评级分布: red ${stats.red} / yellow ${stats.yellow} / green ${stats.green}`);
  console.log(`通过: ${pass}/${total}`);
  if (failures.length) {
    console.error('\n失败明细:');
    for (const f of failures) console.error(`  ✗ ${f.file}: ${f.why}`);
    process.exit(1);
  }
  console.log('全部通过 ✅');
}

main();
