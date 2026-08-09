import './src/env.js';
import { zhuxianDb } from './src/db/index.js';
import { sql } from 'drizzle-orm';

async function main() {
  // 1. 查数据库里所有 skill 相关的表
  const tables = await zhuxianDb.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name ILIKE '%skill%'
    ORDER BY table_name
  `);
  console.log('数据库中 skill 相关表:');
  for (const t of tables) console.log('  ', t.table_name);

  // 2. 查每个表的行数和样例
  for (const t of tables) {
    const name = t.table_name as string;
    const cnt = await zhuxianDb.execute(sql.raw(`SELECT count(*) as cnt FROM "${name}"`));
    console.log(`\n=== ${name} (共 ${cnt[0].cnt} 行) ===`);
    // 查列名
    const cols = await zhuxianDb.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = ${name} ORDER BY ordinal_position
    `);
    console.log('列:', cols.map((c: any) => c.column_name).join(', '));
    // 样例
    const sample = await zhuxianDb.execute(sql.raw(`SELECT * FROM "${name}" LIMIT 2`));
    for (const row of sample) {
      const brief: any = {};
      for (const [k, v] of Object.entries(row)) {
        brief[k] = typeof v === 'string' && v.length > 80 ? v.slice(0, 80) + '...' : v;
      }
      console.log(JSON.stringify(brief, null, 2));
    }
  }

  // 3. 顺便看 novel_skill_lib 有多少条、是否有蒸馏相关列
  const skillLib = await zhuxianDb.execute(sql`
    SELECT count(*) as cnt FROM novel_skill_lib WHERE is_deleted = false
  `);
  console.log(`\nnovel_skill_lib 有效功法数: ${skillLib[0].cnt}`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
