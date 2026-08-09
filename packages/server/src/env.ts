/**
 * 环境变量加载 - 必须在所有其他模块之前导入
 * 从monorepo根目录加载.env文件
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../../.env');
const result = config({ path: envPath });

if (result.error) {
  console.warn(`[env] .env not found at ${envPath}, using system env`);
} else {
  console.log(`[env] Loaded .env from ${envPath}`);
}
