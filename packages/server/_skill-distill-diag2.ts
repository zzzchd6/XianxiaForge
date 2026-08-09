import './src/env.js';
import { zhuxianDb } from './src/db/index.js';
import { sql } from 'drizzle-orm';

async function main() {
  // 1. 列出数据库所有表
  const tables = await zhuxianDb.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  console.log('数据库全部表:');
  for (const t of tables) console.log('  ', t.table_name);

  // 2. 查 novel_skill_lib 的 source 分布，看有没有 zaomeng 来源
  const sources = await zhuxianDb.execute(sql`
    SELECT source, count(*) as cnt FROM novel_skill_lib WHERE is_deleted = false GROUP BY source
  `);
  console.log('\nnovel_skill_lib source分布:', sources);

  // 3. 查 character_distill_archive 里有没有 skill 相关的归档
  const archive = await zhuxianDb.execute(sql`
    SELECT DISTINCT distill_type FROM character_distill_archive LIMIT 20
  `);
  console.log('\ncharacter_distill_archive distill_type:', archive);

  // 4. 查最近更新的 skill 记录（看 zaomeng 是否更新了 novel_skill_lib）
  const recent = await zhuxianDb.execute(sql`
    SELECT id, name, source, version, created_at FROM novel_skill_lib
    ORDER BY created_at DESC NULLS LAST LIMIT 5
  `);
  console.log('\n最近创建的 skill 记录:', recent);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
