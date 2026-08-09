/**
 * 数据库连接管理
 * 创建两个postgres连接：zhuxianDb（只读）和 creativeDb（读写）
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as creativeSchema from './creative-schema.js';
import * as zhuxianSchema from './zhuxian-schema.js';

/** 从分离的环境变量构建连接串 */
function buildConnString(prefix: string, fallbackDb: string): string {
  const host = process.env[`${prefix}_HOST`] || 'localhost';
  const port = process.env[`${prefix}_PORT`] || '5432';
  const name = process.env[`${prefix}_NAME`] || fallbackDb;
  const user = process.env[`${prefix}_USER`] || 'postgres';
  const pass = process.env[`${prefix}_PASSWORD`] || '';
  return `postgresql://${user}:${encodeURIComponent(pass)}@${host}:${port}/${name}`;
}

// 诛仙数据库连接（读写，RAG检索 + 前台世界观编辑）
const zhuxianClient = postgres(buildConnString('ZHUXIAN_DB', 'novel_db'), {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});

// 创作数据库连接（读写）
const creativeClient = postgres(buildConnString('CREATIVE_DB', 'novel_studio'), {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// 导出drizzle实例
export const zhuxianDb = drizzle(zhuxianClient, { schema: zhuxianSchema });
export const creativeDb = drizzle(creativeClient, { schema: creativeSchema });

// 导出原始客户端（用于事务等场景）
export { zhuxianClient, creativeClient };

/**
 * 数据库健康检查
 */
export async function checkDatabaseHealth(): Promise<{
  zhuxian: { connected: boolean; error?: string };
  creative: { connected: boolean; error?: string };
}> {
  const result = {
    zhuxian: { connected: false, error: undefined as string | undefined },
    creative: { connected: false, error: undefined as string | undefined },
  };

  try {
    await zhuxianClient`SELECT 1`;
    result.zhuxian.connected = true;
  } catch (err: any) {
    result.zhuxian.error = err.message;
  }

  try {
    await creativeClient`SELECT 1`;
    result.creative.connected = true;
  } catch (err: any) {
    result.creative.error = err.message;
  }

  return result;
}

/**
 * 关闭所有数据库连接
 */
export async function closeConnections(): Promise<void> {
  await zhuxianClient.end();
  await creativeClient.end();
}
