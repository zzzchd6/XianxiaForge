/**
 * US-22 一次性迁移脚本（13-SRS 五模块体验优化）
 * 将历史自动抽取数据从 pending 迁移为 auto_confirmed（代码早已写 auto_confirmed，
 * 此为代码修改前入库的历史遗留）。仅迁移 source='auto' 的数据，手动数据不触碰。
 *
 * 执行：从 packages/server 目录
 *   pnpm exec tsx --env-file=../../.env ../../scripts/migrate-pending-to-auto-confirmed.ts
 */
import { creativeDb } from '../packages/server/src/db/index.js';
import { sql } from 'drizzle-orm';

async function main() {
  const snapBefore = await creativeDb.execute(sql`
    SELECT COUNT(*) as cnt FROM character_state_snapshot
    WHERE source = 'auto' AND status = 'pending'`);
  const tlBefore = await creativeDb.execute(sql`
    SELECT COUNT(*) as cnt FROM timeline_milestone
    WHERE source = 'auto' AND status = 'pending'`);
  console.log(`待迁移：状态快照 ${snapBefore[0].cnt} 条，时间线 ${tlBefore[0].cnt} 条`);

  const snapRes = await creativeDb.execute(sql`
    UPDATE character_state_snapshot
    SET status = 'auto_confirmed'
    WHERE source = 'auto' AND status = 'pending'`);
  const tlRes = await creativeDb.execute(sql`
    UPDATE timeline_milestone
    SET status = 'auto_confirmed'
    WHERE source = 'auto' AND status = 'pending'`);
  console.log(`已迁移：状态快照 ${snapRes.count} 条，时间线 ${tlRes.count} 条`);

  const remain = await creativeDb.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM character_state_snapshot WHERE source = 'auto' AND status = 'pending') as snap,
      (SELECT COUNT(*) FROM timeline_milestone WHERE source = 'auto' AND status = 'pending') as tl`);
  console.log('迁移后残留 pending:', JSON.stringify(remain[0]));
  if (Number(remain[0].snap) === 0 && Number(remain[0].tl) === 0) {
    console.log('US-22 迁移完成 ✓');
  } else {
    console.error('迁移不完整，请排查');
    process.exit(1);
  }
}

main().then(() => process.exit(0));
