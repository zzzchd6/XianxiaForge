/**
 * 人物关系动态推演路由（模块8）
 * 选择两个人物与一个关键事件，AI推演二者关系的变化，
 * 确认后写入 custom_character_relation 表（不修改诛仙库原生关系表），
 * RAG检索时自定义关系优先级高于原生关系。
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { chatCompletion } from '../llm/client.js';

const app = new Hono();

// ---- Schema ----

const inferSchema = z.object({
  charAId: z.number().int(),
  charBId: z.number().int(),
  charAName: z.string().optional(),
  charBName: z.string().optional(),
  event: z.string().min(1),
});

const relationCreateSchema = z.object({
  charAId: z.number().int(),
  charBId: z.number().int(),
  relType: z.string().optional(),
  relLevel: z.number().int().optional(),
  description: z.string().optional(),
  interactPattern: z.string().optional(),
  sourceEvent: z.string().optional(),
});

const relationUpdateSchema = relationCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ---- 关系推演（LLM生成3种走向选项） ----

/** POST /api/projects/:id/relations/infer */
app.post('/projects/:id/relations/infer', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const parsed = inferSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const { charAId, charBId, charAName, charBName, event } = parsed.data;

    const nameA = charAName || `人物${charAId}`;
    const nameB = charBName || `人物${charBId}`;

    const systemPrompt = `你是一位仙侠小说剧情设计师。用户给出两个人物和一个关键事件，你需要推演此事件后二人关系的变化走向。
输出严格JSON数组（3个选项），每项格式：
{"relType":"关系类型(如师徒/仇敌/挚友/暧昧)","relLevel":1-5整数(1疏远5亲密)","description":"关系变化描述(50字内)","interactPattern":"后续互动模式(30字内)"}
不要输出任何其他文字。`;

    const userPrompt = `人物A：${nameA}（ID:${charAId}）
人物B：${nameB}（ID:${charBId}）
关键事件：${event}

请推演此事件后二人关系的3种可能走向（从不同方向：如缓和/恶化/复杂化），输出JSON数组。`;

    const raw = await chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.9, maxTokens: 1024 }
    );

    // 解析JSON（兼容markdown代码块包裹）
    const jsonStr = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    let options: any[];
    try {
      options = JSON.parse(jsonStr);
    } catch {
      return c.json({ success: false, error: 'LLM返回格式异常，请重试', raw }, 502);
    }

    if (!Array.isArray(options)) options = [options];

    return c.json({
      success: true,
      data: {
        charAId,
        charBId,
        charAName: nameA,
        charBName: nameB,
        event,
        options: options.slice(0, 3),
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ---- CRUD ----

/** GET /api/projects/:id/relations 列表 */
app.get('/projects/:id/relations', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const rows = await creativeDb
      .select()
      .from(schema.customCharacterRelation)
      .where(eq(schema.customCharacterRelation.projectId, projectId))
      .orderBy(desc(schema.customCharacterRelation.createdAt));

    return c.json({ success: true, data: rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:id/relations 创建（确认推演结果） */
app.post('/projects/:id/relations', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const parsed = relationCreateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const d = parsed.data;

    const [row] = await creativeDb
      .insert(schema.customCharacterRelation)
      .values({
        projectId,
        charAId: d.charAId,
        charBId: d.charBId,
        relType: d.relType ?? null,
        relLevel: d.relLevel ?? 0,
        description: d.description ?? null,
        interactPattern: d.interactPattern ?? null,
        sourceEvent: d.sourceEvent ?? null,
      })
      .returning();

    return c.json({ success: true, data: row }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/relations/:rid 更新 */
app.put('/relations/:rid', async (c) => {
  try {
    const id = Number(c.req.param('rid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的关系ID' }, 400);

    const parsed = relationUpdateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const d = parsed.data;
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (d.charAId !== undefined) updateData.charAId = d.charAId;
    if (d.charBId !== undefined) updateData.charBId = d.charBId;
    if (d.relType !== undefined) updateData.relType = d.relType;
    if (d.relLevel !== undefined) updateData.relLevel = d.relLevel;
    if (d.description !== undefined) updateData.description = d.description;
    if (d.interactPattern !== undefined) updateData.interactPattern = d.interactPattern;
    if (d.sourceEvent !== undefined) updateData.sourceEvent = d.sourceEvent;
    if (d.isActive !== undefined) updateData.isActive = d.isActive;

    const [row] = await creativeDb
      .update(schema.customCharacterRelation)
      .set(updateData)
      .where(eq(schema.customCharacterRelation.id, id))
      .returning();

    if (!row) return c.json({ success: false, error: '关系不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /api/relations/:rid 删除 */
app.delete('/relations/:rid', async (c) => {
  try {
    const id = Number(c.req.param('rid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的关系ID' }, 400);

    const [row] = await creativeDb
      .delete(schema.customCharacterRelation)
      .where(eq(schema.customCharacterRelation.id, id))
      .returning();

    if (!row) return c.json({ success: false, error: '关系不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
