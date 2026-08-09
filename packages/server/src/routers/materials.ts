/**
 * 剧情素材·收藏切换路由（配套改造 7.2）
 * 提供 4 类剧情素材（奇遇/伏笔手法/高光/任务链）的收藏状态切换，
 * 供前端表达作者偏好；收藏状态会被召回器读取并做加权（收藏素材优先）。
 *
 * 红线：
 *   - table 拼接进 SQL 前必须经白名单校验（防 SQL 注入），仅 4 张素材表合法。
 *   - id/collected 走参数化绑定（$1/$2），绝不拼接。
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { creativeClient } from '../db/index.js';

const app = new Hono();

/** 允许收藏操作的素材表白名单（仅此 4 张，任何其它表名一律拒绝） */
const COLLECTABLE_TABLES = new Set([
  'plot_material_encounter',
  'plot_material_foreshadow',
  'plot_material_highlight',
  'plot_material_task',
]);

/** 收藏切换请求体校验 */
const collectBodySchema = z.object({
  table: z.string(),
  id: z.number().int(),
  collected: z.boolean(),
});

/**
 * POST /api/materials/collect
 * body: { table: string, id: number, collected: boolean }
 * 切换指定素材的收藏状态。table 必须是 4 张素材表之一，否则 400。
 */
app.post('/materials/collect', async (c) => {
  try {
    const parsed = collectBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '请求体校验失败：需 { table, id, collected }' }, 400);
    }
    const { table, id, collected } = parsed.data;

    // 白名单校验：table 通过后方可拼接进 SQL（防注入）
    if (!COLLECTABLE_TABLES.has(table)) {
      return c.json({ success: false, error: 'table 仅支持 4 张剧情素材表' }, 400);
    }

    // table 已过白名单，安全拼接；is_collected/id 走参数化绑定
    await creativeClient.unsafe(
      `UPDATE ${table} SET is_collected = $1 WHERE id = $2`,
      [collected, id]
    );

    return c.json({ success: true, data: { id, collected } });
  } catch (error: any) {
    console.error(`[materials] 收藏切换失败: ${error?.message || error}`);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
