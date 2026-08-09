/**
 * 剧情素材浏览路由（二期RAG人工干预）
 * 提供 4 类剧情素材（奇遇/伏笔/高光/任务链）的浏览与搜索，
 * 供章节计划编辑器手动选择「固定素材」。只读，不写素材表。
 * 红线：不返回 source_snippet（原始素材片段）。
 */
import { Hono } from 'hono';
import { creativeClient } from '../db/index.js';

const app = new Hono();

/** 4 类剧情素材表 + 中文标签 */
const MATERIAL_TABLES: { table: string; label: string }[] = [
  { table: 'plot_material_encounter', label: '奇遇' },
  { table: 'plot_material_foreshadow', label: '伏笔手法' },
  { table: 'plot_material_highlight', label: '高光' },
  { table: 'plot_material_task', label: '任务链' },
];

interface MaterialRow {
  id: number;
  table: string;
  tableLabel: string;
  title: string;
  corePlot: string;
  triggerCondition?: string;
  reward?: string;
  costOrRisk?: string;
  emotionalBeat?: string;
  applicableSceneType?: string;
  tags?: string[];
  qualityScore?: number;
}

/**
 * GET /api/projects/:id/plot-materials?type=&keyword=&limit=
 * type: encounter|foreshadow|highlight|task（缺省=全部4类）
 * keyword: 标题/核心剧情模糊匹配（ILIKE）
 * limit: 每类返回上限（缺省20，最大50）
 */
app.get('/projects/:id/plot-materials', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) {
      return c.json({ success: false, error: '无效的项目ID' }, 400);
    }

    const type = (c.req.query('type') || '').trim();
    const keyword = (c.req.query('keyword') || '').trim();
    const limit = Math.min(Math.max(Number(c.req.query('limit')) || 20, 1), 50);

    // 选定要查询的表
    const tables = type
      ? MATERIAL_TABLES.filter((t) => t.table === `plot_material_${type}`)
      : MATERIAL_TABLES;
    if (type && tables.length === 0) {
      return c.json({ success: false, error: 'type 仅支持 encounter/foreshadow/highlight/task' }, 400);
    }

    const results: MaterialRow[] = [];
    const likePattern = `%${keyword.replace(/[%_]/g, '')}%`;

    for (const { table, label } of tables) {
      try {
        const params: any[] = [projectId, limit];
        let sql = `
          SELECT id, title, core_plot, trigger_condition, reward, cost_or_risk,
                 emotional_beat, applicable_scene_type, tags, quality_score
          FROM ${table}
          WHERE NOT is_deleted
            AND (project_id = $1 OR project_id IS NULL)
        `;
        if (keyword) {
          params.push(likePattern);
          sql += ` AND (title ILIKE $${params.length} OR core_plot ILIKE $${params.length})`;
        }
        sql += ` ORDER BY quality_score DESC NULLS LAST, id DESC LIMIT $2`;

        const rows = await creativeClient.unsafe(sql, params);
        for (const row of rows) {
          results.push({
            id: Number(row.id),
            table,
            tableLabel: label,
            title: row.title,
            corePlot: row.core_plot,
            triggerCondition: row.trigger_condition || undefined,
            reward: row.reward || undefined,
            costOrRisk: row.cost_or_risk || undefined,
            emotionalBeat: row.emotional_beat || undefined,
            applicableSceneType: row.applicable_scene_type || undefined,
            tags: row.tags || undefined,
            qualityScore: row.quality_score != null ? Number(row.quality_score) : undefined,
          });
        }
      } catch (err: any) {
        console.warn(`[plot-materials] ${table} 查询失败: ${err?.message || err}`);
      }
    }

    return c.json({ success: true, data: results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
