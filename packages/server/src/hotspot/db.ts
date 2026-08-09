/**
 * 热点嗅探 DB 封装：复用 monorepo 创作库连接 creativeClient（postgres-js）。
 * 原独立服务使用 pg.Pool + $n 占位符 SQL，这里经 unsafe() 原样执行，移植改动最小。
 */
import { creativeClient } from '../db/index.js';

export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const rows = await creativeClient.unsafe(text, params);
  return rows as unknown as T[];
}

export async function queryOne<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
