/**
 * 世界观浏览与管理路由（世界观库 novel_db，多书可写）
 * - 书籍管理：books CRUD（system 书只读保护，user 书可写可删）
 * - 实体 CRUD：10 类实体按 book_id 隔离
 * - 批量引入 / 文本抽取：见 world-batch 相关端点
 */
import { Hono } from 'hono';
import { z } from 'zod';
import * as retriever from '../rag/retriever.js';
import { zhuxianDb, zhuxianClient } from '../db/index.js';
import * as schema from '../db/zhuxian-schema.js';
import { eq, and, ilike, sql, inArray } from 'drizzle-orm';
import { importFromBook, listImportableEntities, insertExtractedEntities, cloneBookStyle, type WorldEntityType, type ImportableEntityType } from '../services/world-batch-pipeline.js';
import { worldEntityExtractorAgent } from '../agents/world-entity-extractor.js';

const app = new Hono();

// 分页参数验证
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  bookId: z.coerce.number().int().optional(),
});

/** GET /api/world/characters - 人物列表 */
app.get('/characters', async (c) => {
  try {
    const query = paginationSchema.safeParse({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      keyword: c.req.query('keyword'),
      bookId: c.req.query('bookId'),
    });

    const params = query.success ? query.data : { page: 1, pageSize: 20 };
    const characters = await retriever.searchCharacters(params);
    return c.json({ success: true, data: characters });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/characters/:id - 人物详情（含关系） */
app.get('/characters/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的人物ID' }, 400);
    }

    const characters = await retriever.getCharactersByIds([id]);
    if (!characters.length) {
      return c.json({ success: false, error: '人物不存在' }, 404);
    }

    // 获取人物关系（含对方姓名）
    const relations = await retriever.getCharacterRelationsResolved(id);

    return c.json({
      success: true,
      data: {
        ...characters[0],
        relations,
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/factions - 门派列表 */
app.get('/factions', async (c) => {
  try {
    const query = paginationSchema.safeParse({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      keyword: c.req.query('keyword'),
      bookId: c.req.query('bookId'),
    });

    const params = query.success ? query.data : { page: 1, pageSize: 20 };
    const factions = await retriever.searchFactions(params);
    return c.json({ success: true, data: factions });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/locations - 地点列表 */
app.get('/locations', async (c) => {
  try {
    const query = paginationSchema.safeParse({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      keyword: c.req.query('keyword'),
      bookId: c.req.query('bookId'),
    });

    const params = query.success ? query.data : { page: 1, pageSize: 20 };
    const locations = await retriever.searchLocations(params);
    return c.json({ success: true, data: locations });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/skills - 功法列表 */
app.get('/skills', async (c) => {
  try {
    const query = paginationSchema.safeParse({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      keyword: c.req.query('keyword'),
      bookId: c.req.query('bookId'),
    });

    const params = query.success ? query.data : { page: 1, pageSize: 20 };
    const skills = await retriever.searchSkills(params);
    return c.json({ success: true, data: skills });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/skills/:id - 功法详情 */
app.get('/skills/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的功法ID' }, 400);
    }
    const skills = await retriever.getSkillsByIds([id]);
    if (!skills.length) {
      return c.json({ success: false, error: '功法不存在' }, 404);
    }
    return c.json({ success: true, data: skills[0] });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/items - 法宝列表 */
app.get('/items', async (c) => {
  try {
    const query = paginationSchema.safeParse({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      keyword: c.req.query('keyword'),
      bookId: c.req.query('bookId'),
    });

    const params = query.success ? query.data : { page: 1, pageSize: 20 };
    const items = await retriever.searchMagicItems(params);
    return c.json({ success: true, data: items });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/monsters - 妖兽列表 */
app.get('/monsters', async (c) => {
  try {
    const query = paginationSchema.safeParse({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      keyword: c.req.query('keyword'),
      bookId: c.req.query('bookId'),
    });

    const params = query.success ? query.data : { page: 1, pageSize: 20 };
    const monsters = await retriever.searchMonsters(params);
    return c.json({ success: true, data: monsters });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/materials - 丹药灵材毒物列表 */
app.get('/materials', async (c) => {
  try {
    const query = paginationSchema.safeParse({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      keyword: c.req.query('keyword'),
      bookId: c.req.query('bookId'),
    });
    const params = query.success ? query.data : { page: 1, pageSize: 20 };
    const itemType = c.req.query('itemType');
    const data = await retriever.searchMaterials({ ...params, itemType });
    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/daily-items - 日常物品与信物列表 */
app.get('/daily-items', async (c) => {
  try {
    const query = paginationSchema.safeParse({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      keyword: c.req.query('keyword'),
      bookId: c.req.query('bookId'),
    });
    const params = query.success ? query.data : { page: 1, pageSize: 20 };
    const itemType = c.req.query('itemType');
    const data = await retriever.searchDailyItems({ ...params, itemType });
    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/faction-rules - 宗门规制列表 */
app.get('/faction-rules', async (c) => {
  try {
    const query = paginationSchema.safeParse({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      keyword: c.req.query('keyword'),
      bookId: c.req.query('bookId'),
    });
    const params = query.success ? query.data : { page: 1, pageSize: 50 };
    const ruleType = c.req.query('ruleType');
    const data = await retriever.searchFactionRules({ ...params, ruleType });
    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/season-events - 岁时节令与宗门事件列表 */
app.get('/season-events', async (c) => {
  try {
    const query = paginationSchema.safeParse({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      keyword: c.req.query('keyword'),
      bookId: c.req.query('bookId'),
    });
    const params = query.success ? query.data : { page: 1, pageSize: 50 };
    const eventType = c.req.query('eventType');
    const data = await retriever.searchSeasonEvents({ ...params, eventType });
    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/style - 文风引擎（全局配置 + 场景映射） */
app.get('/style', async (c) => {
  try {
    const bookId = Number(c.req.query('bookId') || '1');
    const [globalConfig, mappings] = await Promise.all([
      retriever.getStyleGlobalConfig(bookId),
      retriever.getStyleSceneMappings(bookId),
    ]);

    // 映射按 mapping_type 分组
    const mappingsByType: Record<string, any[]> = {};
    for (const m of mappings) {
      const key = m.mappingType || 'other';
      (mappingsByType[key] ||= []).push(m);
    }

    return c.json({ success: true, data: { globalConfig, mappingsByType } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

const styleImportSchema = z.object({
  sourceBookId: z.coerce.number().int(),
  targetBookId: z.coerce.number().int(),
});

/** POST /api/world/style/import - 跨书克隆文风引擎（整套配置+场景映射，目标已有则跳过，target 须为 user 书） */
app.post('/style/import', async (c) => {
  try {
    const body = styleImportSchema.parse(await c.req.json());
    const target = await loadBook(body.targetBookId);
    if (!target) return c.json({ success: false, error: '目标书籍不存在' }, 404);
    if (target.sourceType === 'system') {
      return c.json({ success: false, error: '系统内置书籍不可写入，请选择用户创建的书作为目标' }, 403);
    }
    const result = await cloneBookStyle(body.sourceBookId, body.targetBookId);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/characters/:id/distill - 人物蒸馏（心智模型/启发式/人生阶段） */
app.get('/characters/:id/distill', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的人物ID' }, 400);
    }
    const [mentalModels, heuristics, lifeStages] = await Promise.all([
      retriever.getCharacterMentalModels(id),
      retriever.getCharacterHeuristics(id),
      retriever.getCharacterLifeStages(id),
    ]);
    return c.json({ success: true, data: { mentalModels, heuristics, lifeStages } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/skills/:id/distill - 功法蒸馏（属性/招式/关系/归档） */
app.get('/skills/:id/distill', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的功法ID' }, 400);
    }
    const [attributes, moves, relations, archive] = await Promise.all([
      retriever.getTechniqueAttributes(id),
      retriever.getTechniqueMoves(id),
      retriever.getTechniqueRelations(id),
      retriever.getTechniqueDistillArchive(id),
    ]);
    return c.json({ success: true, data: { attributes, moves, relations, archive } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/factions/:id - 门派详情（含成员） */
app.get('/factions/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ success: false, error: '无效的门派ID' }, 400);
    }
    const factions = await retriever.getFactionsByIds([id]);
    if (!factions.length) {
      return c.json({ success: false, error: '门派不存在' }, 404);
    }
    const members = await retriever.getFactionMembers(id);
    return c.json({ success: true, data: { ...factions[0], members } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/books - 书籍列表（book_id 隔离，用于世界观界面切换书籍） */
app.get('/books', async (c) => {
  try {
    const books = await zhuxianDb
      .select()
      .from(schema.novelBook)
      .where(eq(schema.novelBook.isDeleted, false))
      .orderBy(schema.novelBook.bookId);
    return c.json({ success: true, data: books });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ---- 书籍管理（system 书只读保护，user 书可写可删）----
const bookUpsertSchema = z.object({
  bookName: z.string().min(1).max(255),
  author: z.string().max(255).optional(),
  description: z.string().optional(),
  coverUrl: z.string().max(500).optional(),
  tags: z.any().optional(),
});

/** 取书并校验存在；返回 [row, errorResponse] */
async function loadBook(bookId: number) {
  const rows = await zhuxianDb
    .select()
    .from(schema.novelBook)
    .where(and(eq(schema.novelBook.bookId, bookId), eq(schema.novelBook.isDeleted, false)));
  return rows[0];
}

/** POST /api/world/books - 新建书籍（source_type=user） */
app.post('/books', async (c) => {
  try {
    const body = bookUpsertSchema.parse(await c.req.json());
    const [created] = await zhuxianDb
      .insert(schema.novelBook)
      .values({
        bookName: body.bookName,
        author: body.author ?? null,
        description: body.description ?? null,
        coverUrl: body.coverUrl ?? null,
        tags: body.tags ?? null,
        sourceType: 'user',
        isDeleted: false,
        version: 1,
      })
      .returning();
    return c.json({ success: true, data: created });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/world/books/:id - 更新书籍信息（system 书禁改） */
app.put('/books/:id', async (c) => {
  try {
    const bookId = Number(c.req.param('id'));
    const book = await loadBook(bookId);
    if (!book) return c.json({ success: false, error: '书籍不存在' }, 404);
    if (book.sourceType === 'system') {
      return c.json({ success: false, error: '系统内置书籍不可修改' }, 403);
    }
    const body = bookUpsertSchema.partial().parse(await c.req.json());
    const [updated] = await zhuxianDb
      .update(schema.novelBook)
      .set({
        ...(body.bookName !== undefined ? { bookName: body.bookName } : {}),
        ...(body.author !== undefined ? { author: body.author } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.coverUrl !== undefined ? { coverUrl: body.coverUrl } : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
        updateTime: new Date(),
      })
      .where(eq(schema.novelBook.bookId, bookId))
      .returning();
    return c.json({ success: true, data: updated });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /api/world/books/:id - 软删除书籍（system 书禁删；仅删书元数据，实体保留由 is_deleted 联动可后续扩展） */
app.delete('/books/:id', async (c) => {
  try {
    const bookId = Number(c.req.param('id'));
    const book = await loadBook(bookId);
    if (!book) return c.json({ success: false, error: '书籍不存在' }, 404);
    if (book.sourceType === 'system') {
      return c.json({ success: false, error: '系统内置书籍不可删除' }, 403);
    }
    await zhuxianDb
      .update(schema.novelBook)
      .set({ isDeleted: true, updateTime: new Date() })
      .where(eq(schema.novelBook.bookId, bookId));
    return c.json({ success: true, data: null });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ---- 跨书批量引入（复制式，target 须为 user 书）----
const ALL_ENTITY_TYPES: WorldEntityType[] = [
  'locations', 'factions', 'characters', 'skills', 'items', 'monsters', 'materials', 'daily',
];

/** 跨书引入支持的类型（在 8 类基础上追加 宗门规制/岁时节令；WS3 文本抽取仍只用 ALL_ENTITY_TYPES） */
const IMPORTABLE_ENTITY_TYPES: ImportableEntityType[] = [
  ...ALL_ENTITY_TYPES, 'factionRules', 'seasonEvents',
];

/** GET /api/world/import/sources?bookId= - 源书可引入实体清单（按类型分组） */
app.get('/import/sources', async (c) => {
  try {
    const bookId = Number(c.req.query('bookId') || '1');
    const data = await listImportableEntities(bookId, IMPORTABLE_ENTITY_TYPES);
    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

const importSchema = z.object({
  sourceBookId: z.coerce.number().int(),
  targetBookId: z.coerce.number().int(),
  types: z.array(z.enum(IMPORTABLE_ENTITY_TYPES as [ImportableEntityType, ...ImportableEntityType[]])).min(1),
  entityIds: z.record(z.array(z.coerce.number().int())).optional(),
  skipDuplicates: z.boolean().optional(),
});

/** POST /api/world/import - 执行跨书引入 */
app.post('/import', async (c) => {
  try {
    const body = importSchema.parse(await c.req.json());
    if (body.sourceBookId === body.targetBookId) {
      return c.json({ success: false, error: '源书籍与目标书籍不能相同' }, 400);
    }
    const target = await loadBook(body.targetBookId);
    if (!target) return c.json({ success: false, error: '目标书籍不存在' }, 404);
    if (target.sourceType === 'system') {
      return c.json({ success: false, error: '系统内置书籍不可写入，请选择用户创建的书作为目标' }, 403);
    }
    const result = await importFromBook({
      sourceBookId: body.sourceBookId,
      targetBookId: body.targetBookId,
      types: body.types,
      entityIds: body.entityIds as any,
      skipDuplicates: body.skipDuplicates,
    });
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ---- 文本批量抽取入库（LLM 结构化抽取 → 预览 → 确认入库，target 须为 user 书）----
const extractSchema = z.object({
  bookId: z.coerce.number().int(),
  text: z.string().trim().min(10, '文本太短，至少需要 10 个字'),
  types: z.array(z.enum(ALL_ENTITY_TYPES as [WorldEntityType, ...WorldEntityType[]])).min(1),
  projectId: z.coerce.number().int().optional(),
});

/** POST /api/world/batch-import/extract - 文本抽取（同步 LLM，返回预览 + 任务ID） */
app.post('/batch-import/extract', async (c) => {
  try {
    const body = extractSchema.parse(await c.req.json());
    const book = await loadBook(body.bookId);
    if (!book) return c.json({ success: false, error: '目标书籍不存在' }, 404);
    if (book.sourceType === 'system') {
      return c.json({ success: false, error: '系统内置书籍不可写入，请选择用户创建的书作为目标' }, 403);
    }
    const result = await worldEntityExtractorAgent.extract(body.text, body.types);
    const [row] = await zhuxianClient.unsafe(
      `INSERT INTO world_batch_import (book_id, project_id, source_text, entity_types, status, result, created_count, failed_count, create_time)
       VALUES ($1,$2,$3,$4,'awaiting_confirm',$5,0,0,now()) RETURNING id`,
      [body.bookId, body.projectId ?? null, body.text, JSON.stringify(body.types), JSON.stringify(result)]
    );
    return c.json({ success: true, data: { taskId: Number(row.id), result } });
  } catch (error: any) {
    console.error('[world/batch-import/extract] 抽取失败:', error?.message || error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/batch-import/:id - 查询抽取任务 */
app.get('/batch-import/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const [row] = await zhuxianClient.unsafe(`SELECT * FROM world_batch_import WHERE id = $1`, [id]);
    if (!row) return c.json({ success: false, error: '任务不存在' }, 404);
    return c.json({ success: true, data: row });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

const confirmSchema = z.object({
  result: z.record(z.array(z.any())).optional(),
  skipDuplicates: z.boolean().optional(),
});

/** POST /api/world/batch-import/:id/confirm - 确认入库 */
app.post('/batch-import/:id/confirm', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const body = confirmSchema.parse(await c.req.json().catch(() => ({})));
    const [task] = await zhuxianClient.unsafe(`SELECT * FROM world_batch_import WHERE id = $1`, [id]);
    if (!task) return c.json({ success: false, error: '任务不存在' }, 404);
    const book = await loadBook(Number(task.book_id));
    if (book?.sourceType === 'system') {
      return c.json({ success: false, error: '系统内置书籍不可写入' }, 403);
    }
    // 优先用客户端回传的（可能已编辑/筛选）result，否则用存储的
    const stored = typeof task.result === 'string' ? JSON.parse(task.result) : task.result;
    const result = body.result ?? stored;
    const ins = await insertExtractedEntities(Number(task.book_id), result, { skipDuplicates: body.skipDuplicates });
    await zhuxianClient.unsafe(
      `UPDATE world_batch_import SET status='completed', created_count=$1, failed_count=$2, completed_time=now() WHERE id=$3`,
      [ins.created, ins.failed, id]
    );
    return c.json({ success: true, data: ins });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/stats - 世界观数据总览（各类数量，按 bookId 隔离） */
app.get('/stats', async (c) => {
  try {
    const bookId = Number(c.req.query('bookId') || '1');
    const count = async (table: any) => {
      const rows = await zhuxianDb
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(and(eq(table.isDeleted, false), eq(table.bookId, bookId)));
      return rows[0]?.n ?? 0;
    };

    const [characters, factions, locations, skills, items, monsters, materials, dailyItems, factionRules, seasonEvents, relRows] =
      await Promise.all([
        count(schema.novelCharacterLib),
        count(schema.novelFactionLib),
        count(schema.novelLocationLib),
        count(schema.novelSkillLib),
        count(schema.novelMagicItemLib),
        count(schema.novelMonsterLib),
        count(schema.novelMaterialLib),
        count(schema.novelDailyItemLib),
        count(schema.novelFactionRuleLib),
        count(schema.novelSeasonEventLib),
        // 关系表无 book_id，通过 char_a_id 关联人物表按书过滤
        zhuxianDb
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.libCharacterRelation)
          .innerJoin(schema.novelCharacterLib, eq(schema.libCharacterRelation.charAId, schema.novelCharacterLib.id))
          .where(and(eq(schema.novelCharacterLib.bookId, bookId), eq(schema.novelCharacterLib.isDeleted, false))),
      ]);
    const relations = relRows[0]?.n ?? 0;

    return c.json({
      success: true,
      data: { bookId, characters, factions, locations, skills, items, monsters, materials, dailyItems, factionRules, seasonEvents, relations },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/search - 全局搜索（文本搜索，跨多表） */
app.get('/search', async (c) => {
  try {
    const keyword = c.req.query('keyword');
    const type = c.req.query('type'); // 可选：character, faction, location, skill, item, monster
    const limit = Number(c.req.query('limit') || '10');

    if (!keyword) {
      return c.json({ success: false, error: '请提供搜索关键词' }, 400);
    }

    const results: Record<string, any[]> = {};

    // 根据type过滤搜索范围
    const searchAll = !type;

    if (searchAll || type === 'character') {
      results.characters = await retriever.searchCharacters({ keyword, pageSize: limit });
    }
    if (searchAll || type === 'faction') {
      results.factions = await retriever.searchFactions({ keyword, pageSize: limit });
    }
    if (searchAll || type === 'location') {
      results.locations = await retriever.searchLocations({ keyword, pageSize: limit });
    }
    if (searchAll || type === 'skill') {
      results.skills = await retriever.searchSkills({ keyword, pageSize: limit });
    }
    if (searchAll || type === 'item') {
      results.items = await retriever.searchMagicItems({ keyword, pageSize: limit });
    }
    if (searchAll || type === 'monster') {
      results.monsters = await retriever.searchMonsters({ keyword, pageSize: limit });
    }

    return c.json({ success: true, data: results });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/* ================================================================== */
/* CRUD：新增 / 修改 / 删除（软删除）                                  */
/* ================================================================== */

/** 实体表注册：路由前缀 → drizzle表 + 允许写入的字段白名单 */
const crudTables: Record<string, { table: any; fields: string[]; nameField: string }> = {
  characters: {
    table: schema.novelCharacterLib,
    nameField: 'name',
    fields: ['name', 'allTitles', 'faction', 'realm', 'combatType', 'coreSkills', 'personality', 'growthLine', 'plotTags', 'exclusiveItems', 'entityType', 'source'],
  },
  factions: {
    table: schema.novelFactionLib,
    nameField: 'name',
    fields: ['name', 'camp', 'headquarters', 'leader', 'townTreasure', 'cultivationFeature', 'forceRelations', 'entityType', 'source'],
  },
  locations: {
    table: schema.novelLocationLib,
    nameField: 'name',
    fields: ['name', 'level', 'parentRegion', 'relatedFaction', 'environment', 'keyEvents', 'dangerLevel', 'specialFunctions', 'entityType', 'source'],
  },
  skills: {
    table: schema.novelSkillLib,
    nameField: 'name',
    fields: ['name', 'grade', 'faction', 'skillType', 'threshold', 'coreEffect', 'counter', 'famousUsage', 'entityType', 'source'],
  },
  items: {
    table: schema.novelMagicItemLib,
    nameField: 'name',
    fields: ['name', 'grade', 'system', 'owners', 'appearance', 'coreAbilities', 'useLimit', 'evolution', 'relatedPlots', 'entityType', 'source'],
  },
  monsters: {
    table: schema.novelMonsterLib,
    nameField: 'name',
    fields: ['name', 'level', 'race', 'coreAbilities', 'habitat', 'combatLevel', 'relatedPlot', 'entityType', 'source'],
  },
  materials: {
    table: schema.novelMaterialLib,
    nameField: 'name',
    fields: ['name', 'itemType', 'grade', 'coreEffect', 'sideEffect', 'origin', 'usageScene', 'entityType', 'source'],
  },
  'daily-items': {
    table: schema.novelDailyItemLib,
    nameField: 'name',
    fields: ['name', 'itemType', 'grade', 'relatedFaction', 'appearance', 'material', 'usageScene', 'emotionalTag', 'entityType', 'source'],
  },
  'faction-rules': {
    table: schema.novelFactionRuleLib,
    nameField: 'ruleName',
    fields: ['factionId', 'factionName', 'ruleType', 'ruleName', 'ruleContent', 'severity', 'enforcement', 'relatedPlots', 'entityType', 'source'],
  },
  'season-events': {
    table: schema.novelSeasonEventLib,
    nameField: 'eventName',
    fields: ['eventType', 'eventName', 'cycleDescription', 'relatedFaction', 'traditions', 'atmosphere', 'relatedPlots', 'entityType', 'source'],
  },
};

/** 从请求体中只提取白名单字段 */
function pickAllowed(body: Record<string, any>, allowed: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      result[key] = body[key];
    }
  }
  return result;
}

/** POST /api/world/:collection - 新增实体 */
app.post('/:collection', async (c) => {
  try {
    const collection = c.req.param('collection');
    const reg = crudTables[collection];
    if (!reg) return c.json({ success: false, error: `不支持的集合: ${collection}` }, 400);

    const body = await c.req.json();
    const data = pickAllowed(body, reg.fields);

    // 名称字段必填
    if (!data[reg.nameField]) {
      return c.json({ success: false, error: `缺少必填字段: ${reg.nameField}` }, 400);
    }

    // 构建插入数据（注意：实体库表无 update_time 列）
    // bookId 来自前端当前选中的书籍，默认 1
    const insertData: Record<string, any> = {
      ...data,
      bookId: Number(body.bookId) || 1,
      createdAt: new Date(),
      isDeleted: false,
      verifyStatus: 'pending',
      version: 1,
    };

    const rows = await zhuxianDb.insert(reg.table).values(insertData).returning();
    return c.json({ success: true, data: rows[0] }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/world/:collection/:id - 修改实体 */
app.put('/:collection/:id', async (c) => {
  try {
    const collection = c.req.param('collection');
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的ID' }, 400);

    const reg = crudTables[collection];
    if (!reg) return c.json({ success: false, error: `不支持的集合: ${collection}` }, 400);

    const body = await c.req.json();
    const data = pickAllowed(body, reg.fields);
    if (Object.keys(data).length === 0) {
      return c.json({ success: false, error: '没有可更新的字段' }, 400);
    }

    // 乐观锁：version + 1（实体库表无 update_time）
    const rows = await zhuxianDb
      .update(reg.table)
      .set({ ...data, version: sql`${reg.table.version} + 1` })
      .where(and(eq(reg.table.id, id), eq(reg.table.isDeleted, false)))
      .returning();

    if (!rows.length) return c.json({ success: false, error: '记录不存在或已删除' }, 404);
    return c.json({ success: true, data: rows[0] });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** DELETE /api/world/:collection/:id - 软删除实体 */
app.delete('/:collection/:id', async (c) => {
  try {
    const collection = c.req.param('collection');
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return c.json({ success: false, error: '无效的ID' }, 400);

    const reg = crudTables[collection];
    if (!reg) return c.json({ success: false, error: `不支持的集合: ${collection}` }, 400);

    const rows = await zhuxianDb
      .update(reg.table)
      .set({ isDeleted: true })
      .where(and(eq(reg.table.id, id), eq(reg.table.isDeleted, false)))
      .returning({ id: reg.table.id });

    if (!rows.length) return c.json({ success: false, error: '记录不存在或已删除' }, 404);
    return c.json({ success: true, data: { id } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/world/graph?bookId=X - 关系图谱数据（节点+连线） */
app.get('/graph', async (c) => {
  try {
    const bookId = Number(c.req.query('bookId')) || 1;

    // 1. 查询该 book 的所有人物
    const characters = await zhuxianDb
      .select({ id: schema.novelCharacterLib.id, name: schema.novelCharacterLib.name })
      .from(schema.novelCharacterLib)
      .where(and(eq(schema.novelCharacterLib.bookId, bookId), eq(schema.novelCharacterLib.isDeleted, false)));

    if (!characters.length) {
      return c.json({ success: true, data: { nodes: [], links: [] } });
    }

    const charIds = characters.map((ch) => ch.id);

    // 2. 查询人物关系（两端都在本书人物集合内）
    const relations = await zhuxianDb
      .select({
        charAId: schema.libCharacterRelation.charAId,
        charBId: schema.libCharacterRelation.charBId,
        relType: schema.libCharacterRelation.relType,
      })
      .from(schema.libCharacterRelation)
      .where(
        and(
          inArray(schema.libCharacterRelation.charAId, charIds),
          inArray(schema.libCharacterRelation.charBId, charIds)
        )
      );

    // 3. 组装 nodes + links
    const nodes = characters.map((ch) => ({ id: ch.id, name: ch.name, type: 'character' }));
    const links = relations
      .filter((r) => r.charAId != null && r.charBId != null)
      .map((r) => ({ source: r.charAId!, target: r.charBId!, relType: r.relType || '未知' }));

    return c.json({ success: true, data: { nodes, links } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
