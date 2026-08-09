import './src/env.js';
import { zhuxianDb } from './src/db/index.js';
import { sql } from 'drizzle-orm';

async function main() {
  // 验证 technique_* 表的 skill_id 是否能对应到 novel_skill_lib.id
  const mapped = await zhuxianDb.execute(sql`
    SELECT DISTINCT t.skill_id, s.name as skill_name
    FROM (
      SELECT DISTINCT skill_id FROM technique_attribute WHERE is_deleted = false
      UNION
      SELECT DISTINCT skill_id FROM technique_move WHERE is_deleted = false
      UNION
      SELECT DISTINCT skill_id FROM technique_relation WHERE is_deleted = false
    ) t
    LEFT JOIN novel_skill_lib s ON s.id = t.skill_id
    ORDER BY t.skill_id
  `);
  console.log('有蒸馏数据的功法 (skill_id → 名称):');
  for (const r of mapped) {
    console.log(`  skill_id=${r.skill_id} → ${r.skill_name ?? '⚠️ 未找到对应功法!'}`);
  }

  // 各表按 skill_id 的分布
  const attr = await zhuxianDb.execute(sql`SELECT skill_id, count(*) cnt FROM technique_attribute WHERE is_deleted=false GROUP BY skill_id ORDER BY skill_id`);
  const move = await zhuxianDb.execute(sql`SELECT skill_id, count(*) cnt FROM technique_move WHERE is_deleted=false GROUP BY skill_id ORDER BY skill_id`);
  const rel = await zhuxianDb.execute(sql`SELECT skill_id, count(*) cnt FROM technique_relation WHERE is_deleted=false GROUP BY skill_id ORDER BY skill_id`);
  console.log('\nattribute分布:', attr.map((r: any) => `${r.skill_id}:${r.cnt}`).join(', '));
  console.log('move分布:', move.map((r: any) => `${r.skill_id}:${r.cnt}`).join(', '));
  console.log('relation分布:', rel.map((r: any) => `${r.skill_id}:${r.cnt}`).join(', '));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
