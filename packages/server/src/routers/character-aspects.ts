/**
 * 角色心智路由（v1.4 PRD-A 修正方案）
 * - 角色声音配置（character_voice_config）：注入式声音方案的 CRUD
 * - 角色已知信息清单（character_knowledge）：信息差写作 + 认知越界审计参照
 * - 角色记忆卡（character_memory_card）：第三期增量
 * - 伏笔回收联动：已回收伏笔 → 人物已知信息转化
 * characterId 遵循负数约定：正数=诛仙库人物，负数=自定义人物
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';

const app = new Hono();

// ============ Zod 校验 ============

const voiceUpsertSchema = z.object({
  speechStyle: z.string().nullable().optional(),
  catchphrases: z.string().nullable().optional(),
  addressHabit: z.string().nullable().optional(),
  toneBase: z.string().nullable().optional(),
  exampleQuotes: z.array(z.string()).optional(),
  forbiddenExpressions: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const knowledgeCreateSchema = z.object({
  characterId: z.number().int(),
  knowledgeContent: z.string().min(1, '已知信息内容不能为空'),
  infoLevel: z.enum(['core', 'common', 'secret']).default('common'),
  sourceType: z.enum(['manual', 'foreshadow', 'timeline']).default('manual'),
  sourceRef: z.any().optional(),
  acquiredChapter: z.number().int().nullable().optional(),
  enabled: z.boolean().default(true),
});

const knowledgeUpdateSchema = knowledgeCreateSchema.partial().omit({ characterId: true });

const fromForeshadowSchema = z.object({
  foreshadowId: z.number().int(),
  /** 回收后哪些人物得知了该信息；缺省=仅 POV 无法推断，须显式给出 */
  characterIds: z.array(z.number().int()).min(1, '请指定获知该信息的人物'),
  /** 获知章节号；缺省取伏笔实际回收章节 */
  acquiredChapter: z.number().int().optional(),
});

const memoryCardCreateSchema = z.object({
  characterId: z.number().int(),
  eventSummary: z.string().min(1, '经历摘要不能为空'),
  chapterNo: z.number().int().nullable().optional(),
  emotionalImpact: z.string().nullable().optional(),
  importance: z.enum(['high', 'normal', 'low']).default('normal'),
  source: z.enum(['auto', 'manual']).default('manual'),
  enabled: z.boolean().default(true),
});

const memoryCardUpdateSchema = memoryCardCreateSchema.partial().omit({ characterId: true });

// ============ 角色声音配置 ============

/** GET /projects/:pid/voice-configs - 列表（可按 characterId 过滤） */
app.get('/projects/:pid/voice-configs', async (c) => {
  try {
    const projectId = Number(c.req.param('pid'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const characterId = c.req.query('characterId');
    const where = characterId
      ? and(eq(schema.characterVoiceConfig.projectId, projectId), eq(schema.characterVoiceConfig.characterId, Number(characterId)))
      : eq(schema.characterVoiceConfig.projectId, projectId);

    const rows = await creativeDb.select().from(schema.characterVoiceConfig).where(where);
    return c.json({ success: true, data: rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /projects/:pid/characters/:characterId/voice - 新建或更新（每人物一条） */
app.put('/projects/:pid/characters/:characterId/voice', async (c) => {
  try {
    const projectId = Number(c.req.param('pid'));
    const characterId = Number(c.req.param('characterId'));
    if (isNaN(projectId) || isNaN(characterId)) return c.json({ success: false, error: '无效的参数' }, 400);

    const body = await c.req.json();
    const parsed = voiceUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const [existing] = await creativeDb
      .select()
      .from(schema.characterVoiceConfig)
      .where(and(
        eq(schema.characterVoiceConfig.projectId, projectId),
        eq(schema.characterVoiceConfig.characterId, characterId),
      ))
      .limit(1);

    if (existing) {
      const [updated] = await creativeDb
        .update(schema.characterVoiceConfig)
        .set({
          ...(parsed.data.speechStyle !== undefined ? { speechStyle: parsed.data.speechStyle } : {}),
          ...(parsed.data.catchphrases !== undefined ? { catchphrases: parsed.data.catchphrases } : {}),
          ...(parsed.data.addressHabit !== undefined ? { addressHabit: parsed.data.addressHabit } : {}),
          ...(parsed.data.toneBase !== undefined ? { toneBase: parsed.data.toneBase } : {}),
          ...(parsed.data.exampleQuotes !== undefined ? { exampleQuotes: parsed.data.exampleQuotes } : {}),
          ...(parsed.data.forbiddenExpressions !== undefined ? { forbiddenExpressions: parsed.data.forbiddenExpressions } : {}),
          ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.characterVoiceConfig.id, existing.id))
        .returning();
      return c.json({ success: true, data: updated });
    }

    const [created] = await creativeDb
      .insert(schema.characterVoiceConfig)
      .values({
        projectId,
        characterId,
        speechStyle: parsed.data.speechStyle ?? null,
        catchphrases: parsed.data.catchphrases ?? null,
        addressHabit: parsed.data.addressHabit ?? null,
        toneBase: parsed.data.toneBase ?? null,
        exampleQuotes: parsed.data.exampleQuotes ?? [],
        forbiddenExpressions: parsed.data.forbiddenExpressions ?? [],
        enabled: parsed.data.enabled ?? true,
      })
      .returning();
    return c.json({ success: true, data: created }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /projects/:pid/voice-configs/:id - 删除 */
app.delete('/projects/:pid/voice-configs/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的ID' }, 400);
    await creativeDb.delete(schema.characterVoiceConfig).where(eq(schema.characterVoiceConfig.id, id));
    return c.json({ success: true, data: { message: '声音配置已删除' } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 角色已知信息清单 ============

/** GET /projects/:pid/knowledge - 列表（可按 characterId 过滤） */
app.get('/projects/:pid/knowledge', async (c) => {
  try {
    const projectId = Number(c.req.param('pid'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const characterId = c.req.query('characterId');
    const where = characterId
      ? and(eq(schema.characterKnowledge.projectId, projectId), eq(schema.characterKnowledge.characterId, Number(characterId)))
      : eq(schema.characterKnowledge.projectId, projectId);

    const rows = await creativeDb.select().from(schema.characterKnowledge).where(where);
    return c.json({ success: true, data: rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /projects/:pid/knowledge - 新增一条已知信息 */
app.post('/projects/:pid/knowledge', async (c) => {
  try {
    const projectId = Number(c.req.param('pid'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const body = await c.req.json();
    const parsed = knowledgeCreateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const [created] = await creativeDb
      .insert(schema.characterKnowledge)
      .values({
        projectId,
        characterId: parsed.data.characterId,
        knowledgeContent: parsed.data.knowledgeContent,
        infoLevel: parsed.data.infoLevel,
        sourceType: parsed.data.sourceType,
        sourceRef: parsed.data.sourceRef ?? {},
        acquiredChapter: parsed.data.acquiredChapter ?? null,
        enabled: parsed.data.enabled,
      })
      .returning();
    return c.json({ success: true, data: created }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /projects/:pid/knowledge/:id - 更新 */
app.put('/projects/:pid/knowledge/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的ID' }, 400);

    const body = await c.req.json();
    const parsed = knowledgeUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (parsed.data.knowledgeContent !== undefined) updateData.knowledgeContent = parsed.data.knowledgeContent;
    if (parsed.data.infoLevel !== undefined) updateData.infoLevel = parsed.data.infoLevel;
    if (parsed.data.sourceType !== undefined) updateData.sourceType = parsed.data.sourceType;
    if (parsed.data.sourceRef !== undefined) updateData.sourceRef = parsed.data.sourceRef;
    if (parsed.data.acquiredChapter !== undefined) updateData.acquiredChapter = parsed.data.acquiredChapter;
    if (parsed.data.enabled !== undefined) updateData.enabled = parsed.data.enabled;

    const [updated] = await creativeDb
      .update(schema.characterKnowledge)
      .set(updateData)
      .where(eq(schema.characterKnowledge.id, id))
      .returning();
    if (!updated) return c.json({ success: false, error: '记录不存在' }, 404);
    return c.json({ success: true, data: updated });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /projects/:pid/knowledge/:id - 删除 */
app.delete('/projects/:pid/knowledge/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的ID' }, 400);
    await creativeDb.delete(schema.characterKnowledge).where(eq(schema.characterKnowledge.id, id));
    return c.json({ success: true, data: { message: '已知信息已删除' } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 伏笔回收联动：伏笔 → 已知信息转化 ============

/** POST /projects/:pid/knowledge/from-foreshadow - 把已回收伏笔转化为指定人物的已知信息 */
app.post('/projects/:pid/knowledge/from-foreshadow', async (c) => {
  try {
    const projectId = Number(c.req.param('pid'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const body = await c.req.json();
    const parsed = fromForeshadowSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const [thread] = await creativeDb
      .select()
      .from(schema.foreshadowThread)
      .where(and(
        eq(schema.foreshadowThread.id, parsed.data.foreshadowId),
        eq(schema.foreshadowThread.projectId, projectId),
      ))
      .limit(1);
    if (!thread) return c.json({ success: false, error: '伏笔不存在' }, 404);

    const acquiredChapter = parsed.data.acquiredChapter ?? thread.resolveChapter ?? null;
    const factText = `「${thread.title}」已揭晓${thread.description ? `：${thread.description}` : ''}`;

    const created = [];
    for (const characterId of parsed.data.characterIds) {
      // 同一伏笔对同一人物不重复转化
      const existing = await creativeDb
        .select({ id: schema.characterKnowledge.id, sourceRef: schema.characterKnowledge.sourceRef })
        .from(schema.characterKnowledge)
        .where(and(
          eq(schema.characterKnowledge.projectId, projectId),
          eq(schema.characterKnowledge.characterId, characterId),
          eq(schema.characterKnowledge.sourceType, 'foreshadow'),
        ));
      const dup = existing.some((r) => (r.sourceRef as any)?.foreshadowId === parsed.data.foreshadowId);
      if (dup) continue;

      const [row] = await creativeDb
        .insert(schema.characterKnowledge)
        .values({
          projectId,
          characterId,
          knowledgeContent: factText,
          infoLevel: 'secret',
          sourceType: 'foreshadow',
          sourceRef: { foreshadowId: thread.id },
          acquiredChapter,
          enabled: true,
        })
        .returning();
      created.push(row);
    }

    return c.json({ success: true, data: created }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 角色记忆卡（第三期） ============

/** GET /projects/:pid/memory-cards - 列表（可按 characterId 过滤） */
app.get('/projects/:pid/memory-cards', async (c) => {
  try {
    const projectId = Number(c.req.param('pid'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const characterId = c.req.query('characterId');
    const where = characterId
      ? and(eq(schema.characterMemoryCard.projectId, projectId), eq(schema.characterMemoryCard.characterId, Number(characterId)))
      : eq(schema.characterMemoryCard.projectId, projectId);

    const rows = await creativeDb.select().from(schema.characterMemoryCard).where(where);
    return c.json({ success: true, data: rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /projects/:pid/memory-cards - 新增记忆卡 */
app.post('/projects/:pid/memory-cards', async (c) => {
  try {
    const projectId = Number(c.req.param('pid'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const body = await c.req.json();
    const parsed = memoryCardCreateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const [created] = await creativeDb
      .insert(schema.characterMemoryCard)
      .values({
        projectId,
        characterId: parsed.data.characterId,
        eventSummary: parsed.data.eventSummary,
        chapterNo: parsed.data.chapterNo ?? null,
        emotionalImpact: parsed.data.emotionalImpact ?? null,
        importance: parsed.data.importance,
        source: parsed.data.source,
        enabled: parsed.data.enabled,
      })
      .returning();
    return c.json({ success: true, data: created }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /projects/:pid/memory-cards/:id - 更新记忆卡 */
app.put('/projects/:pid/memory-cards/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的ID' }, 400);

    const body = await c.req.json();
    const parsed = memoryCardUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const updateData: Record<string, any> = {};
    if (parsed.data.eventSummary !== undefined) updateData.eventSummary = parsed.data.eventSummary;
    if (parsed.data.chapterNo !== undefined) updateData.chapterNo = parsed.data.chapterNo;
    if (parsed.data.emotionalImpact !== undefined) updateData.emotionalImpact = parsed.data.emotionalImpact;
    if (parsed.data.importance !== undefined) updateData.importance = parsed.data.importance;
    if (parsed.data.source !== undefined) updateData.source = parsed.data.source;
    if (parsed.data.enabled !== undefined) updateData.enabled = parsed.data.enabled;

    const [updated] = await creativeDb
      .update(schema.characterMemoryCard)
      .set(updateData)
      .where(eq(schema.characterMemoryCard.id, id))
      .returning();
    if (!updated) return c.json({ success: false, error: '记录不存在' }, 404);
    return c.json({ success: true, data: updated });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /projects/:pid/memory-cards/:id - 删除记忆卡 */
app.delete('/projects/:pid/memory-cards/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的ID' }, 400);
    await creativeDb.delete(schema.characterMemoryCard).where(eq(schema.characterMemoryCard.id, id));
    return c.json({ success: true, data: { message: '记忆卡已删除' } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
