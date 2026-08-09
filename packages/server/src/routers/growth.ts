/**
 * 人物成长弧光卡点路由（模块3）
 * 项目级：为核心人物设定分阶段成长节点（阶段名/章节区间/特质），
 * 生成时由 context-builder 按当前章节号匹配阶段注入特质，Auditor 第15维校验阶段一致性。
 * character_id 引用诛仙库人物ID（只读引用，不建外键）。
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, asc } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';

const app = new Hono();

const stageCreateSchema = z.object({
  characterId: z.number().int().optional(),
  characterName: z.string().optional(),
  stageNo: z.number().int().default(1),
  name: z.string().min(1),
  chapterStart: z.number().int().optional(),
  chapterEnd: z.number().int().optional(),
  traits: z.array(z.string()).optional(),
  description: z.string().optional(),
  stageType: z.string().max(20).optional(),
  isKeyNode: z.boolean().optional(),
});

const stageUpdateSchema = stageCreateSchema.partial();

/** GET /api/projects/:id/growth-stages?characterId= 列表（可按人物过滤） */
app.get('/projects/:id/growth-stages', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const conds = [eq(schema.characterGrowthStage.projectId, projectId)];
    const characterId = c.req.query('characterId');
    if (characterId) conds.push(eq(schema.characterGrowthStage.characterId, Number(characterId)));

    const rows = await creativeDb
      .select()
      .from(schema.characterGrowthStage)
      .where(and(...conds))
      .orderBy(asc(schema.characterGrowthStage.characterId), asc(schema.characterGrowthStage.stageNo));

    return c.json({ success: true, data: rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:id/growth-stages 创建成长阶段 */
app.post('/projects/:id/growth-stages', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const parsed = stageCreateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const d = parsed.data;

    const [row] = await creativeDb
      .insert(schema.characterGrowthStage)
      .values({
        projectId,
        characterId: d.characterId ?? null,
        characterName: d.characterName ?? null,
        stageNo: d.stageNo,
        name: d.name,
        chapterStart: d.chapterStart ?? null,
        chapterEnd: d.chapterEnd ?? null,
        traits: d.traits ?? [],
        description: d.description ?? null,
        stageType: d.stageType ?? null,
        isKeyNode: d.isKeyNode ?? false,
      })
      .returning();

    return c.json({ success: true, data: row }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/growth-stages/:gid 更新成长阶段 */
app.put('/growth-stages/:gid', async (c) => {
  try {
    const id = Number(c.req.param('gid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的阶段ID' }, 400);

    const parsed = stageUpdateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const d = parsed.data;
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (d.characterId !== undefined) updateData.characterId = d.characterId;
    if (d.characterName !== undefined) updateData.characterName = d.characterName;
    if (d.stageNo !== undefined) updateData.stageNo = d.stageNo;
    if (d.name !== undefined) updateData.name = d.name;
    if (d.chapterStart !== undefined) updateData.chapterStart = d.chapterStart;
    if (d.chapterEnd !== undefined) updateData.chapterEnd = d.chapterEnd;
    if (d.traits !== undefined) updateData.traits = d.traits;
    if (d.description !== undefined) updateData.description = d.description;
    if (d.stageType !== undefined) updateData.stageType = d.stageType;
    if (d.isKeyNode !== undefined) updateData.isKeyNode = d.isKeyNode;

    const [row] = await creativeDb
      .update(schema.characterGrowthStage)
      .set(updateData)
      .where(eq(schema.characterGrowthStage.id, id))
      .returning();

    if (!row) return c.json({ success: false, error: '成长阶段不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /api/growth-stages/:gid 删除成长阶段 */
app.delete('/growth-stages/:gid', async (c) => {
  try {
    const id = Number(c.req.param('gid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的阶段ID' }, 400);

    const [row] = await creativeDb
      .delete(schema.characterGrowthStage)
      .where(eq(schema.characterGrowthStage.id, id))
      .returning();

    if (!row) return c.json({ success: false, error: '成长阶段不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
