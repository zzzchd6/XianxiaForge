import './packages/server/src/env.js';
import { creativeDb } from './packages/server/src/db/index.js';
import { sql } from 'drizzle-orm';

async function main() {
  const ddls = [
    `ALTER TABLE weapon_lore ADD COLUMN IF NOT EXISTS spirit text`,
    `ALTER TABLE custom_character ADD COLUMN IF NOT EXISTS dao_title varchar(64)`,
    `ALTER TABLE custom_character ADD COLUMN IF NOT EXISTS combo_ability text`,
    `ALTER TABLE custom_character_relation ADD COLUMN IF NOT EXISTS entity_type varchar(20) NOT NULL DEFAULT 'character'`,
    `ALTER TABLE custom_character_relation ADD COLUMN IF NOT EXISTS weapon_id bigint`,
  ];
  for (const ddl of ddls) {
    await creativeDb.execute(sql.raw(ddl));
    console.log('OK:', ddl.slice(0, 60));
  }
  console.log('\nAll DDL done.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
