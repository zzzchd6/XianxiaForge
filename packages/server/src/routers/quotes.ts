/**
 * 名场面+金句素材库路由（模块11）
 * 章节生成后自动提取名场面与金句，归档到项目素材库。
 * 支持手动收藏/删除，ContextComposer可选注入收藏金句强化人物说话风格。
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { extractQuotesFromPastedText, type QuoteCandidate } from '../pipeline/quote-extractor.js';
import {
  polishQuoteRow,
  polishAnyText,
  rescoreQuote,
  applyPreview,
  applyToChapter,
  type ApplyVersion,
} from '../services/quote-service.js';

const app = new Hono();

// ---- Schema ----

const quoteCreateSchema = z.object({
  chapterId: z.number().int().optional(),
  characterId: z.number().int().optional(),
  characterName: z.string().optional(),
  quoteText: z.string().min(1),
  sceneDesc: z.string().optional(),
  qualityScore: z.number().int().optional(),
  sourceType: z.enum(['auto', 'manual', 'import']).optional(),
  // 需求11：手动打磨后可直接带着美化结果入库
  originalText: z.string().optional(),
  polishedText: z.string().optional(),
  polishedVersions: z.array(z.any()).optional(),
  scores: z.record(z.any()).optional(),
  grade: z.enum(['legendary', 'good', 'candidate']).optional(),
  polishStatus: z.enum(['none', 'polished', 'applied']).optional(),
});

/** 批量导入的单条金句 */
const importQuoteSchema = z.object({
  quoteText: z.string().min(1),
  characterName: z.string().optional(),
  sceneDesc: z.string().optional(),
  qualityScore: z.number().int().optional(),
  isCollected: z.boolean().optional(),
});

const quoteUpdateSchema = z.object({
  isCollected: z.boolean().optional(),
  qualityScore: z.number().int().optional(),
  sceneDesc: z.string().optional(),
  // 需求11：选版/编辑最终金句文本
  quoteText: z.string().min(1).optional(),
  polishedText: z.string().optional(),
  polishStatus: z.enum(['none', 'polished', 'applied']).optional(),
});

const applyVersionSchema = z.enum(['original', 'conservative', 'balanced', 'deep', 'current']);

// ---- CRUD ----

/** GET /api/projects/:id/quotes?chapterId=&characterName=&collected= 列表 */
app.get('/projects/:id/quotes', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const conds = [eq(schema.projectQuoteLib.projectId, projectId)];
    const chapterId = c.req.query('chapterId');
    if (chapterId) conds.push(eq(schema.projectQuoteLib.chapterId, Number(chapterId)));
    const characterName = c.req.query('characterName');
    if (characterName) conds.push(eq(schema.projectQuoteLib.characterName, characterName));
    const collected = c.req.query('collected');
    if (collected === 'true') conds.push(eq(schema.projectQuoteLib.isCollected, true));
    const sourceType = c.req.query('sourceType');
    if (sourceType) conds.push(eq(schema.projectQuoteLib.sourceType, sourceType));
    const grade = c.req.query('grade');
    if (grade) conds.push(eq(schema.projectQuoteLib.grade, grade));
    const polishStatus = c.req.query('polishStatus');
    if (polishStatus) conds.push(eq(schema.projectQuoteLib.polishStatus, polishStatus));

    const rows = await creativeDb
      .select()
      .from(schema.projectQuoteLib)
      .where(and(...conds))
      .orderBy(desc(schema.projectQuoteLib.createdAt));

    return c.json({ success: true, data: rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:id/quotes 手动创建金句 */
app.post('/projects/:id/quotes', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const parsed = quoteCreateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const d = parsed.data;

    const [row] = await creativeDb
      .insert(schema.projectQuoteLib)
      .values({
        projectId,
        chapterId: d.chapterId ?? null,
        characterId: d.characterId ?? null,
        characterName: d.characterName ?? null,
        quoteText: d.quoteText,
        sceneDesc: d.sceneDesc ?? null,
        qualityScore: d.qualityScore ?? null,
        sourceType: d.sourceType ?? 'manual',
        originalText: d.originalText ?? d.quoteText,
        polishedText: d.polishedText ?? null,
        polishedVersions: d.polishedVersions ?? [],
        scores: d.scores ?? {},
        grade: d.grade ?? 'good',
        polishStatus: d.polishStatus ?? 'none',
      })
      .returning();

    return c.json({ success: true, data: row }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/quotes/:qid 更新（收藏/取消收藏/评分） */
app.put('/quotes/:qid', async (c) => {
  try {
    const id = Number(c.req.param('qid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的金句ID' }, 400);

    const parsed = quoteUpdateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const d = parsed.data;
    const updateData: Record<string, any> = {};
    if (d.isCollected !== undefined) updateData.isCollected = d.isCollected;
    if (d.qualityScore !== undefined) updateData.qualityScore = d.qualityScore;
    if (d.sceneDesc !== undefined) updateData.sceneDesc = d.sceneDesc;
    if (d.quoteText !== undefined) updateData.quoteText = d.quoteText;
    if (d.polishedText !== undefined) updateData.polishedText = d.polishedText;
    if (d.polishStatus !== undefined) updateData.polishStatus = d.polishStatus;

    const [row] = await creativeDb
      .update(schema.projectQuoteLib)
      .set(updateData)
      .where(eq(schema.projectQuoteLib.id, id))
      .returning();

    if (!row) return c.json({ success: false, error: '金句不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /api/quotes/:qid 删除 */
app.delete('/quotes/:qid', async (c) => {
  try {
    const id = Number(c.req.param('qid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的金句ID' }, 400);

    const [row] = await creativeDb
      .delete(schema.projectQuoteLib)
      .where(eq(schema.projectQuoteLib.id, id))
      .returning();

    if (!row) return c.json({ success: false, error: '金句不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ---- 批量导入（从其他作品"偷"金句） ----

/** POST /api/projects/:id/quotes/import-preview { text } LLM预筛粘贴文本，返回候选金句（不入库） */
app.post('/projects/:id/quotes/import-preview', async (c) => {
  try {
    const body = await c.req.json();
    const text = typeof body.text === 'string' ? body.text : '';
    if (text.trim().length < 20) {
      return c.json({ success: false, error: '参考文本过短，请粘贴更多内容' }, 400);
    }

    const candidates = await extractQuotesFromPastedText(text);
    return c.json({ success: true, data: candidates });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:id/quotes/import { quotes: [...] } 批量导入审阅后的金句（source_type=import，默认收藏） */
app.post('/projects/:id/quotes/import', async (c) => {
  try {
    const projectId = Number(c.req.param('id'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const body = await c.req.json();
    const quotesRaw: unknown[] = Array.isArray(body.quotes) ? body.quotes : [];
    const parsed = quotesRaw
      .map((q: unknown) => importQuoteSchema.safeParse(q))
      .filter((r: z.SafeParseReturnType<any, any>) => r.success)
      .map((r: z.SafeParseReturnType<any, any>) => (r as z.SafeParseSuccess<any>).data);

    if (parsed.length === 0) {
      return c.json({ success: false, error: '没有可导入的有效金句' }, 400);
    }

    const rows = await creativeDb
      .insert(schema.projectQuoteLib)
      .values(
        parsed.map((q: any) => ({
          projectId,
          chapterId: null,
          characterId: null,
          characterName: q.characterName ?? null,
          quoteText: q.quoteText.trim(),
          sceneDesc: q.sceneDesc ?? null,
          qualityScore: q.qualityScore ?? null,
          isCollected: q.isCollected ?? true,
          sourceType: 'import',
        }))
      )
      .returning();

    return c.json({ success: true, data: { imported: rows.length, quotes: rows } }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ---- 智能美化与回写正文（需求11） ----

/** POST /api/projects/:id/quotes/polish-text { text } 打磨任意句子（US-5）：先评分判价值，有价值生成3版本（不入库） */
app.post('/projects/:id/quotes/polish-text', async (c) => {
  try {
    const body = await c.req.json();
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length < 4) {
      return c.json({ success: false, error: '句子太短，请输入至少4个字' }, 400);
    }
    const result = await polishAnyText(text);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/quotes/:qid/polish 对已入库金句（重新）美化，保存3版本 */
app.post('/quotes/:qid/polish', async (c) => {
  try {
    const id = Number(c.req.param('qid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的金句ID' }, 400);
    const row = await polishQuoteRow(id);
    if (!row) return c.json({ success: false, error: '金句不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/quotes/:qid/rescore 重新评分（US-4：待打磨候选可借此升级） */
app.post('/quotes/:qid/rescore', async (c) => {
  try {
    const id = Number(c.req.param('qid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的金句ID' }, 400);
    const row = await rescoreQuote(id);
    if (!row) return c.json({ success: false, error: '金句不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/quotes/:qid/apply-preview { version } 回写正文-diff预览（US-3） */
app.post('/quotes/:qid/apply-preview', async (c) => {
  try {
    const id = Number(c.req.param('qid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的金句ID' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const parsed = applyVersionSchema.safeParse(body.version ?? 'current');
    if (!parsed.success) return c.json({ success: false, error: '无效的版本参数' }, 400);
    const preview = await applyPreview(id, parsed.data as ApplyVersion);
    return c.json({ success: true, data: preview });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/quotes/:qid/apply { version } 回写正文-确认替换第一处原句（US-3） */
app.post('/quotes/:qid/apply', async (c) => {
  try {
    const id = Number(c.req.param('qid'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的金句ID' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const parsed = applyVersionSchema.safeParse(body.version ?? 'current');
    if (!parsed.success) return c.json({ success: false, error: '无效的版本参数' }, 400);
    const result = await applyToChapter(id, parsed.data as ApplyVersion);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
