/**
 * 创作工作库初始化脚本
 * 读取 .env 配置，连接 PostgreSQL 执行 init-creative-db.sql
 *
 * 用法: node scripts/init-db.mjs
 * 或:   pnpm db:init
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── 简易 .env 解析 ───────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  let content = '';
  try {
    content = readFileSync(envPath, 'utf-8');
  } catch {
    console.log('[info] 未找到 .env 文件，使用环境变量或默认值');
  }

  const vars = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    vars[key] = value;
  }
  return vars;
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────────
async function main() {
  const env = loadEnv();

  const host = env.CREATIVE_DB_HOST || process.env.CREATIVE_DB_HOST || 'localhost';
  const port = parseInt(env.CREATIVE_DB_PORT || process.env.CREATIVE_DB_PORT || '5432', 10);
  const database = env.CREATIVE_DB_NAME || process.env.CREATIVE_DB_NAME || 'novel_studio';
  const user = env.CREATIVE_DB_USER || process.env.CREATIVE_DB_USER || 'noveluser';
  const password = env.CREATIVE_DB_PASSWORD || process.env.CREATIVE_DB_PASSWORD || '';

  console.log('═══════════════════════════════════════════════════');
  console.log('  指尖仙侠 - 创作工作库初始化');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  目标: ${user}@${host}:${port}/${database}`);
  console.log('───────────────────────────────────────────────────');

  // 动态导入 pg（需要先 pnpm install）
  let pg;
  try {
    pg = await import('pg');
  } catch {
    console.error('[error] 未找到 pg 模块，请先执行: pnpm add -D pg');
    console.error('        或在 packages/server 中安装 pg 依赖');
    process.exit(1);
  }

  const { Client } = pg.default;

  // 1. 先连接 postgres 数据库，检查/创建目标数据库
  const adminClient = new Client({ host, port, user, password, database: 'postgres' });
  try {
    await adminClient.connect();
    const res = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database]
    );
    if (res.rowCount === 0) {
      console.log(`[info] 数据库 "${database}" 不存在，正在创建...`);
      await adminClient.query(`CREATE DATABASE "${database}" OWNER "${user}"`);
      console.log(`[ok]   数据库 "${database}" 创建成功`);
    } else {
      console.log(`[ok]   数据库 "${database}" 已存在`);
    }
  } catch (err) {
    console.error(`[error] 连接 PostgreSQL 失败: ${err.message}`);
    console.error('        请确认 PostgreSQL 已启动且连接信息正确');
    process.exit(1);
  } finally {
    await adminClient.end();
  }

  // 2. 连接目标数据库，执行建表 SQL
  const sqlPath = resolve(__dirname, 'init-creative-db.sql');
  const sql = readFileSync(sqlPath, 'utf-8');

  const client = new Client({ host, port, user, password, database });
  try {
    await client.connect();
    console.log('[info] 正在执行建表脚本...');
    await client.query(sql);
    console.log('[ok]   所有表创建/更新成功');

    // 验证表是否创建
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log(`[ok]   当前数据库中的表 (${tables.rows.length}):`);
    for (const row of tables.rows) {
      console.log(`       - ${row.table_name}`);
    }
  } catch (err) {
    console.error(`[error] 执行 SQL 失败: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }

  console.log('───────────────────────────────────────────────────');
  console.log('  初始化完成！');
  console.log('═══════════════════════════════════════════════════');
}

main();
