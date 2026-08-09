import './src/env.js';
import { zhuxianDb } from './src/db/index.js';
import { sql } from 'drizzle-orm';

async function main() {
  const tables = ['technique_attribute', 'technique_move', 'technique_relation', 'technique_distill_archive'];

  for (const name of tables) {
    const cnt = await zhuxianDb.execute(sql.raw(`SELECT count(*) as cnt FROM "${name}"`));
    console.log(`\n=== ${name} (共 ${cnt[0].cnt} 行) ===`);
    const cols = await zhuxianDb.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = ${name} ORDER BY ordinal_position
    `);
    console.log('列结构:');
    for (const c of cols) console.log(`  ${c.column_name} (${c.data_type})`);
    const sample = await zhuxianDb.execute(sql.raw(`SELECT * FROM "${name}" LIMIT 2`));
    console.log('样例数据:');
    for (const row of sample) {
      const brief: any = {};
      for (const [k, v] of Object.entries(row)) {
        brief[k] = typeof v === 'string' && v.length > 100 ? v.slice(0, 100) + '...' : v;
      }
      console.log(JSON.stringify(brief, null, 2));
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
