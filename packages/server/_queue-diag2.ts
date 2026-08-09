import './src/env.js';
import { creativeDb } from './src/db/index.js';
import { sql } from 'drizzle-orm';

async function main() {
  // 场景小纲节点
  const nodes = await creativeDb.execute(sql`
    SELECT outline_id, count(*) as cnt FROM scene_node GROUP BY outline_id ORDER BY outline_id
  `);
  console.log('=== scene_node 按大纲统计 ===');
  for (const n of nodes) console.log(`  outline_id=${n.outline_id}: ${n.cnt} 个场景节点`);
  if (!nodes.length) console.log('  (空!)');

  // 大纲详情
  const outlines = await creativeDb.execute(sql`
    SELECT id, volume_no, title, status FROM story_outline WHERE project_id=3 ORDER BY volume_no
  `);
  console.log('\n=== story_outline (project 3) ===');
  for (const o of outlines) console.log(`  id=${o.id} 第${o.volume_no}卷 《${o.title}》 status=${o.status}`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
