/**
 * 二期RAG素材召回 - 最小连通性自检脚本
 * 用法: cd packages/server && pnpm exec tsx ../../scripts/test-rag-recall.ts
 *
 * 验证项：
 * 1. embedding_server /health 可达且返回 dim:512
 * 2. embedQuery 能获取 512 维向量
 * 3. 3 类表召回正常（素材/领域/文风）
 * 4. source_snippet 不在返回字段中
 * 5. 降级验证（模拟 embedding 不可达时返回空）
 */
import '../packages/server/src/env.js';
import { embedQuery, recallPlotMaterials } from '../packages/server/src/rag/plot-material-retriever.js';

const EMBEDDING_SERVER_URL = process.env.EMBEDDING_SERVER_URL || 'http://127.0.0.1:8600';
const TEST_PROJECT_ID = 3;
const TEST_QUERY = '主角在绝境中突破修为瓶颈，获得奇遇';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function main() {
  console.log('=== 二期RAG素材召回 连通性自检 ===\n');

  // 1. /health 探活
  console.log('[1] embedding_server /health 探活');
  try {
    const res = await fetch(`${EMBEDDING_SERVER_URL}/health`, { signal: AbortSignal.timeout(5000) });
    const body = await res.json() as any;
    assert(res.ok, `HTTP ${res.status}`);
    assert(body.dim === 512, `dim=${body.dim}（期望512）`);
    assert(!!body.model, `model=${body.model}`);
  } catch (err: any) {
    assert(false, `embedding_server 不可达: ${err.message}`);
    console.log('\n⚠ embedding_server 未启动，后续向量化测试将跳过。');
    console.log(`  启动方式: cd K:\\xiaoshuochaijie\\工具学习\\sucaiqingxi && .venv\\Scripts\\python.exe embedding_server.py`);
    console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
  }

  // 2. embedQuery 向量化
  console.log('\n[2] embedQuery 向量化');
  let qvec: number[] = [];
  try {
    qvec = await embedQuery(TEST_QUERY);
    assert(qvec.length === 512, `向量维度=${qvec.length}（期望512）`);
    const norm = Math.sqrt(qvec.reduce((s, v) => s + v * v, 0));
    assert(Math.abs(norm - 1) < 0.01, `归一化 norm=${norm.toFixed(4)}（期望≈1）`);
  } catch (err: any) {
    assert(false, `embedQuery 失败: ${err.message}`);
  }

  // 3. 素材召回
  console.log('\n[3] recallPlotMaterials 素材召回');
  try {
    const result = await recallPlotMaterials(TEST_QUERY, TEST_PROJECT_ID, {
      enabled: true,
      topN: { materials: 2, domain: 3, style: 1 },
      minScore: 0.2, // 自检用较低阈值，确保能看到结果
    });
    assert(!result.degraded, `未降级（degraded=${result.degraded}）`);
    assert(result.elapsedMs > 0, `耗时=${result.elapsedMs}ms`);
    console.log(`  素材命中: ${result.materials.length}条`);
    for (const m of result.materials) {
      console.log(`    [${m.table}] ${m.title} (score=${m.score.toFixed(3)})`);
      // 红线验证：不含 source_snippet
      assert(!('source_snippet' in m) && !('sourceSnippet' in m), `无source_snippet字段`);
    }
    console.log(`  领域知识命中: ${result.domain.length}条`);
    for (const d of result.domain) {
      console.log(`    [${d.knowledgeType}] ${d.title} (score=${d.score.toFixed(3)})`);
      assert(!('source_snippet' in d) && !('sourceSnippet' in d), `无source_snippet字段`);
    }
    console.log(`  文风预设: ${result.style ? result.style.styleName : '无'}`);
    if (result.style) {
      assert(!!result.style.styleName, `styleName=${result.style.styleName}`);
    }
  } catch (err: any) {
    assert(false, `recallPlotMaterials 异常: ${err.message}`);
  }

  // 4. 降级验证（enabled=false 时返回空）
  console.log('\n[4] 降级验证（enabled=false）');
  const disabled = await recallPlotMaterials(TEST_QUERY, TEST_PROJECT_ID, { enabled: false });
  assert(disabled.materials.length === 0, '素材为空');
  assert(disabled.domain.length === 0, '领域为空');
  assert(disabled.style === null, '文风为null');
  assert(!disabled.degraded, 'enabled=false不算降级');

  // 汇总
  console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('自检脚本异常:', err);
  process.exit(1);
});
