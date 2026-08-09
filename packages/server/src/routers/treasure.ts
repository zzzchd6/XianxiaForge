/**
 * 淘宝系统路由
 * 挂载：app.route('/api', treasureRouter)
 * 路径前缀：/projects/:pid/treasure
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { generateHunt, type HuntConfig } from '../services/treasure-hunt.js';
import { getUnlockedContent, convertToFormalEntity } from '../services/treasure-unlock.js';

const app = new Hono();

// ============ 1. 十连淘宝 ============

const huntSchema = z.object({
  count: z.number().int().min(1).max(20).default(10),
  fakeRatio: z.number().min(0).max(0.5).optional(),
});

app.post('/projects/:pid/treasure/hunt', async (c) => {
  const pid = Number(c.req.param('pid'));
  const body = huntSchema.parse(await c.req.json().catch(() => ({})));

  const config: HuntConfig = {
    count: body.count,
    fakeRatio: body.fakeRatio ?? 0.1,
  };

  try {
    const result = await generateHunt(config);

    // 写入hunt记录（全面武器化：trinketCount 恒 0）
    const [record] = await creativeDb.insert(schema.treasureHuntRecord).values({
      projectId: pid,
      location: result.location,
      itemCount: result.items.length,
      trinketCount: 0,
      secretCount: result.secretCount,
    }).returning();

    // 写入物品（全部为秘宝/武器）
    const dbItems: (typeof schema.treasureItem.$inferSelect)[] = [];
    for (const item of result.items) {
      const [row] = await creativeDb.insert(schema.treasureItem).values({
        projectId: pid,
        itemType: 'secret',
        secretTier: item.secretTier,
        displayName: item.displayName,
        trueName: item.trueName,
        appearance: item.appearance,
        trinketHook: null,
        trinketCategory: null,
        fullData: item.fullData,
        unlockStage: 0,
        isFake: item.isFake,
        fakeReveal: item.fakeReveal,
        huntLocation: result.location,
        huntRecordId: Number(record.id),
        isCollected: false,
      }).returning();
      dbItems.push(row);
    }

    // 返回前端：秘宝不返回 fullData/trueName，打眼不暴露
    const safeItems = dbItems.map((item) => ({
      id: item.id,
      itemType: item.itemType,
      secretTier: item.secretTier,
      displayName: item.displayName,
      appearance: item.appearance,
      isFake: false,
      huntLocation: item.huntLocation,
      unlockStage: 0,
    }));

    return c.json({ success: true, data: { location: result.location, items: safeItems, recordId: record.id } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 2. 物品列表 ============

app.get('/projects/:pid/treasure/items', async (c) => {
  const pid = Number(c.req.param('pid'));
  const type = c.req.query('type') || 'all';       // trinket | secret | all
  const status = c.req.query('status') || 'bag';   // bag | converted | all

  const conditions = [
    eq(schema.treasureItem.projectId, pid),
    eq(schema.treasureItem.isDeleted, false),
  ];

  if (type !== 'all') conditions.push(eq(schema.treasureItem.itemType, type));
  if (status === 'bag') conditions.push(eq(schema.treasureItem.isConverted, false));
  if (status === 'converted') conditions.push(eq(schema.treasureItem.isConverted, true));

  const rows = await creativeDb.select().from(schema.treasureItem)
    .where(and(...conditions))
    .orderBy(desc(schema.treasureItem.createdAt));

  // 秘宝不返回 fullData
  const safe = rows.map((r) => {
    const { fullData, trueName, ...rest } = r;
    if (r.itemType === 'secret' && r.unlockStage < 5) {
      return { ...rest, trueName: null };
    }
    return { ...rest, trueName: r.unlockStage >= 5 ? trueName : null };
  });

  return c.json({ success: true, data: safe });
});

// ============ 9. 淘宝记录 ============

app.get('/projects/:pid/treasure/records', async (c) => {
  const pid = Number(c.req.param('pid'));
  const rows = await creativeDb.select().from(schema.treasureHuntRecord)
    .where(eq(schema.treasureHuntRecord.projectId, pid))
    .orderBy(desc(schema.treasureHuntRecord.createdAt))
    .limit(50);
  return c.json({ success: true, data: rows });
});

// ============ 10. 设置 ============

app.get('/projects/:pid/treasure/settings', async (c) => {
  // TODO: 从 settings 表读取，暂返回默认值（全面武器化后仅 fakeRatio）
  return c.json({ success: true, data: { fakeRatio: 0.1 } });
});

app.put('/projects/:pid/treasure/settings', async (c) => {
  // TODO: 写入 settings 表
  const body = await c.req.json().catch(() => ({}));
  return c.json({ success: true, data: body });
});

// ============ 3. 物品详情（按阶段返回） ============

app.get('/projects/:pid/treasure/:id', async (c) => {
  const pid = Number(c.req.param('pid'));
  const id = Number(c.req.param('id'));

  const [item] = await creativeDb.select().from(schema.treasureItem)
    .where(and(eq(schema.treasureItem.id, id), eq(schema.treasureItem.projectId, pid), eq(schema.treasureItem.isDeleted, false)));

  if (!item) return c.json({ success: false, error: '物品不存在' }, 404);

  // 秘宝：按阶段过滤
  const content = getUnlockedContent(item as any);
  return c.json({
    success: true,
    data: {
      id: item.id,
      itemType: item.itemType,
      secretTier: item.secretTier,
      displayName: content.displayName,
      appearance: item.appearance,
      unlockStage: item.unlockStage,
      unlockProgress: item.unlockProgress,
      boundCharacterId: item.boundCharacterId,
      isCollected: item.isCollected,
      isConverted: item.isConverted,
      convertedId: item.convertedId,
      note: item.note,
      huntLocation: item.huntLocation,
      createdAt: item.createdAt,
      content, // 分层解锁内容
    },
  });
});

// ============ 4. 绑定人物 ============

const bindSchema = z.object({ characterId: z.number(), chapterNo: z.number().optional() });

app.post('/projects/:pid/treasure/:id/bind', async (c) => {
  const pid = Number(c.req.param('pid'));
  const id = Number(c.req.param('id'));
  const { characterId, chapterNo } = bindSchema.parse(await c.req.json().catch(() => ({})));

  const [item] = await creativeDb.select().from(schema.treasureItem)
    .where(and(eq(schema.treasureItem.id, id), eq(schema.treasureItem.projectId, pid)));
  if (!item) return c.json({ success: false, error: '物品不存在' }, 404);
  if (item.itemType !== 'secret') return c.json({ success: false, error: '只有秘宝需要绑定' }, 400);

  const [updated] = await creativeDb.update(schema.treasureItem)
    .set({
      boundCharacterId: characterId,
      boundChapterNo: chapterNo ?? null,
      unlockStage: Math.max(item.unlockStage, 1), // 绑定即推进到阶段1
      unlockProgress: [...(item.unlockProgress as any[] || []), { stage: 1, trigger: '绑定人物', unlockedAt: new Date().toISOString() }],
      updatedAt: new Date(),
    })
    .where(eq(schema.treasureItem.id, id))
    .returning();

  return c.json({ success: true, data: updated });
});

// ============ 5. 收入囊中 ============

app.post('/projects/:pid/treasure/:id/collect', async (c) => {
  const pid = Number(c.req.param('pid'));
  const id = Number(c.req.param('id'));

  const [updated] = await creativeDb.update(schema.treasureItem)
    .set({ isCollected: true, updatedAt: new Date() })
    .where(and(eq(schema.treasureItem.id, id), eq(schema.treasureItem.projectId, pid)))
    .returning();

  if (!updated) return c.json({ success: false, error: '物品不存在' }, 404);
  return c.json({ success: true, data: updated });
});

// ============ 6. 丢弃（软删） ============

app.delete('/projects/:pid/treasure/:id', async (c) => {
  const pid = Number(c.req.param('pid'));
  const id = Number(c.req.param('id'));

  await creativeDb.update(schema.treasureItem)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(and(eq(schema.treasureItem.id, id), eq(schema.treasureItem.projectId, pid)));

  return c.json({ success: true, data: null });
});

// ============ 7. 改备注 ============

const noteSchema = z.object({ note: z.string().max(500) });

app.put('/projects/:pid/treasure/:id/note', async (c) => {
  const pid = Number(c.req.param('pid'));
  const id = Number(c.req.param('id'));
  const { note } = noteSchema.parse(await c.req.json().catch(() => ({})));

  const [updated] = await creativeDb.update(schema.treasureItem)
    .set({ note, updatedAt: new Date() })
    .where(and(eq(schema.treasureItem.id, id), eq(schema.treasureItem.projectId, pid)))
    .returning();

  if (!updated) return c.json({ success: false, error: '物品不存在' }, 404);
  return c.json({ success: true, data: updated });
});

// ============ 8. 入库（秘宝→正式武器，无需等待五阶解锁） ============

app.post('/projects/:pid/treasure/:id/convert', async (c) => {
  const pid = Number(c.req.param('pid'));
  const id = Number(c.req.param('id'));

  const result = await convertToFormalEntity(pid, id, true);
  if (!result) return c.json({ success: false, error: '物品已入库或不存在' }, 400);
  return c.json({ success: true, data: result });
});

export default app;
