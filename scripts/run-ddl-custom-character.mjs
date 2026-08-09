/**
 * 自定义人物模块 DDL 执行脚本
 * 读取 .env 配置，连接创作库执行 ddl-custom-character.sql（幂等）
 *
 * 用法: node scripts/run-ddl-custom-character.mjs
 * 回滚: node scripts/run-ddl-custom-character.mjs --rollback
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
// postgres(postgres.js) 安装在 packages/server，从该包解析
const require = createRequire(resolve(ROOT, 'packages/server/package.json'));

function loadEnv() {
  let content = '';
  try {
    content = readFileSync(resolve(ROOT, '.env'), 'utf-8');
  } catch {
    console.log('[info] 未找到 .env 文件，使用环境变量或默认值');
  }
  const vars = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
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

  const rollback = process.argv.includes('--rollback');
  const sqlFile = rollback ? 'ddl-custom-character-rollback.sql' : 'ddl-custom-character.sql';
  const sql = readFileSync(resolve(__dirname, sqlFile), 'utf-8');

  console.log(`[info] 目标: ${user}@${host}:${port}/${database}`);
  console.log(`[info] 执行: ${sqlFile}`);

  const postgres = require('postgres');
  const client = postgres({ host, port, username: user, password, database, max: 1 });
  try {
    await client.unsafe(sql);
    console.log('[ok]   SQL 执行成功');

    if (!rollback) {
      const check = await client`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'custom_character' ORDER BY ordinal_position
      `;
      console.log(`[ok]   custom_character 表字段 (${check.length}):`);
      for (const row of check) console.log(`       - ${row.column_name} (${row.data_type})`);
    }
  } catch (err) {
    console.error(`[error] 执行失败: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
