import './src/env.js';
import { creativeDb } from './src/db/index.js';
import { sql } from 'drizzle-orm';

async function main() {
  // 1. 查项目
  const projects = await creativeDb.execute(sql`
    SELECT id, title, status FROM creative_project ORDER BY id
  `);
  console.log('=== creative_project ===');
  for (const p of projects) console.log(`  id=${p.id} title=${p.title} status=${p.status}`);
  if (!projects.length) console.log('  (空!)');

  // 2. 查章节计划
  const plans = await creativeDb.execute(sql`
    SELECT project_id, count(*) as cnt, min(chapter_no) as min_ch, max(chapter_no) as max_ch
    FROM chapter_plan GROUP BY project_id ORDER BY project_id
  `);
  console.log('\n=== chapter_plan 按项目统计 ===');
  for (const p of plans) console.log(`  project_id=${p.project_id}: ${p.cnt} 章 (第${p.min_ch}~${p.max_ch}章)`);
  if (!plans.length) console.log('  (空!)');

  // 3. 查大纲
  const outlines = await creativeDb.execute(sql`
    SELECT project_id, count(*) as cnt FROM story_outline GROUP BY project_id ORDER BY project_id
  `);
  console.log('\n=== story_outline 按项目统计 ===');
  for (const o of outlines) console.log(`  project_id=${o.project_id}: ${o.cnt} 卷`);
  if (!outlines.length) console.log('  (空!)');

  // 4. 查生成任务
  const tasks = await creativeDb.execute(sql`
    SELECT project_id, status, count(*) as cnt FROM generation_task GROUP BY project_id, status ORDER BY project_id
  `);
  console.log('\n=== generation_task 按项目+状态统计 ===');
  for (const t of tasks) console.log(`  project_id=${t.project_id} status=${t.status}: ${t.cnt}`);
  if (!tasks.length) console.log('  (空!)');

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
