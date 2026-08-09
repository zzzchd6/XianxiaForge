/**
 * 开源借鉴 PRD v1.1 M7 DDL 执行脚本（雪花法：creative_project.snowflake_draft）
 * 用法: node scripts/run-ddl-snowflake.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(resolve(ROOT, 'packages/server/package.json'));

function loadEnv() {
  let content = '';
  try { content = readFileSync(resolve(ROOT, '.env'), 'utf-8'); } catch {}
  const vars = {};
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    vars[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return vars;
}

async function main() {
  const env = loadEnv();
  const host = env.CREATIVE_DB_HOST || process.env.CREATIVE_DB_HOST || 'localhost';
  const port = parseInt(env.CREATIVE_DB_PORT || process.env.CREATIVE_DB_PORT || '5432', 10);
  const database = env.CREATIVE_DB_NAME || process.env.CREATIVE_DB_NAME || 'novel_studio';
  const user = env.CREATIVE_DB_USER || process.env.CREATIVE_DB_USER || 'noveluser';
  const password = env.CREATIVE_DB_PASSWORD || process.env.CREATIVE_DB_PASSWORD || '';

  const sql = readFileSync(resolve(__dirname, 'ddl-snowflake.sql'), 'utf-8');
  console.log(`[info] 目标: ${user}@${host}:${port}/${database} 执行: ddl-snowflake.sql`);

  const postgres = require('postgres');
  const client = postgres({ host, port, username: user, password, database, max: 1 });
  try {
    await client.unsafe(sql);
    const check = await client`SELECT column_name FROM information_schema.columns WHERE table_name='creative_project' AND column_name='snowflake_draft'`;
    console.log('[ok] SQL 执行成功，snowflake_draft 列:', check.length ? '存在' : '缺失！');
  } catch (err) {
    console.error(`[error] 执行失败: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
