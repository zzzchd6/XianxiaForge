import './src/env.js';
import * as retriever from './src/rag/retriever.js';

async function main() {
  // 验证批量功法蒸馏查询（生成管线使用）
  const map = await retriever.getTechniqueDistillations([1, 9, 40]);
  console.log('=== getTechniqueDistillations([1,9,40]) ===');
  for (const [id, d] of map) {
    console.log(`skill ${id}:`);
    console.log(`  attributes(${d.attributes.length}):`, d.attributes[0] ?? '(空)');
    console.log(`  moves(${d.moves.length}):`, d.moves[0] ?? '(空)');
    console.log(`  relations(${d.relations.length}):`, d.relations[0] ?? '(空)');
  }

  let ok = true;
  const d1 = map.get(1);
  if (!d1 || d1.attributes.length < 1 || d1.moves.length < 1) { console.log('✗ skill 1 蒸馏数据缺失'); ok = false; }
  else console.log('✓ skill 1 有属性+招式蒸馏');
  const d9 = map.get(9);
  if (!d9 || !d9.relations.some(r => r.includes('诛仙剑'))) { console.log('✗ skill 9 缺少诛仙剑关系'); ok = false; }
  else console.log('✓ skill 9 含诛仙剑克制关系');
  if (map.has(40) && (map.get(40)!.attributes.length || map.get(40)!.moves.length || map.get(40)!.relations.length)) {
    console.log('✗ skill 40 不应有蒸馏数据'); ok = false;
  } else console.log('✓ skill 40 无蒸馏数据（不注入）');

  console.log(ok ? '\n批量函数验证通过' : '\n批量函数验证失败');
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
