/**
 * 自定义人物路由（自定义人物模块）
 * 挂载：/api/projects/:projectId/custom-characters
 * 对外暴露负数ID（数据库自增ID取负），与诛仙库人物正数ID共存；
 * 保存时调用 LLM 生成300-500字人物小传，失败降级模板小传，不阻断入库；
 * 小传之后同步生成人物判词（七言绝句+二字考语，判词Skill），失败同样降级模板。
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { creativeDb, zhuxianDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import * as zhuxianSchema from '../db/zhuxian-schema.js';
import { chatCompletion } from '../llm/client.js';
import { listProjectEntities, importFromProject } from '../services/cross-project-import.js';
import { exportCharacters, importCharacters } from '../services/module-file-io.js';
import {
  findRaceCategory,
  findRaceSub,
  findPosition,
  findTalentByName,
  FLAW_OPTIONS,
  INNER_PERSONALITY_OPTIONS,
  OUTER_PERSONALITY_OPTIONS,
  OUTER_PERSONALITY_MIN,
  OUTER_PERSONALITY_MAX,
  TALENT_MIN_COUNT,
  TALENT_MAX_COUNT,
  TALENT_MAX_PER_CATEGORY,
  POSITION_OPTIONS,
  stanceLabel,
  type CustomCharacterDraft,
  type RaceCategoryId,
  type Gender,
  type PositionKey,
} from '@xianxiaforge/shared';
import { randomCharacter, randomName, randomTalentInCategory, buildFallbackBio } from '../services/character-generator.js';
import { namingAgent } from '../agents/naming.js';
import { generateVerdict, buildFallbackVerdict, type VerdictResult } from '../services/verdict-generator.js';
import { autoVoice } from '../services/ux-gen.js';
import { forgeSmartMatchAgent } from '../agents/forge-smart-match.js';
import { buildCharacterContext, validateCharacter } from '../services/forge-smart-match.js';

const app = new Hono();

// ---- Schema ----

const positionKeys = POSITION_OPTIONS.map((p) => p.key) as [string, ...string[]];

const formSchema = z.object({
  name: z.string().min(1).max(64),
  gender: z.enum(['male', 'female']),
  raceCategory: z.string().min(1),
  raceSub: z.string().min(1),
  position: z.enum(positionKeys),
  fakePosition: z.enum(positionKeys).nullable().optional(),
  stance: z.number().int().min(0).max(100),
  innerPersonality: z.enum(INNER_PERSONALITY_OPTIONS),
  outerPersonality: z.array(z.string()).min(OUTER_PERSONALITY_MIN).max(OUTER_PERSONALITY_MAX),
  talents: z.array(z.string()).min(TALENT_MIN_COUNT).max(TALENT_MAX_COUNT + 1),
});

const randomSchema = z.object({
  locks: z
    .object({
      race: z.boolean().optional(),
      position: z.boolean().optional(),
      name: z.boolean().optional(),
      gender: z.boolean().optional(),
      stance: z.boolean().optional(),
      innerPersonality: z.boolean().optional(),
      outerPersonality: z.boolean().optional(),
      talents: z.boolean().optional(),
    })
    .optional(),
  current: z.record(z.string(), z.any()).optional(),
  /** 分类骰子：只随机指定天赋分类内的一条（body/destiny/skill/origin） */
  talentCategory: z.string().optional(),
  excludeTalents: z.array(z.string()).optional(),
});

const randomNameSchema = z.object({
  raceCategory: z.string().min(1),
  raceSub: z.string().min(1),
  gender: z.enum(['male', 'female']).optional(),
  /** 定位/立场（可选，用于名字风格轻度倾斜） */
  position: z.enum(positionKeys).optional(),
  stance: z.number().int().min(0).max(100).optional(),
});

// ---- 业务校验（zod之外的配置库约束） ----

function validateForm(form: z.infer<typeof formSchema>): string | null {
  if (!findRaceSub(form.raceCategory, form.raceSub)) return '无效的种族配置';
  // 扮猪吃虎：伪装定位必须低于真实定位档次
  if (form.fakePosition) {
    const realRank = findPosition(form.position)?.rank ?? 0;
    const fakeRank = findPosition(form.fakePosition)?.rank ?? 0;
    if (fakeRank >= realRank) return '伪装定位必须低于真实定位档次';
  }
  // 外在性格必须来自预设标签
  if (form.outerPersonality.some((p) => !(OUTER_PERSONALITY_OPTIONS as readonly string[]).includes(p))) {
    return '外在性格包含无效标签';
  }
  // 天赋：3-8个正向（每分类≤2）+ 至多1个小缺陷
  const categoryCount: Record<string, number> = {};
  let positiveCount = 0;
  let flawCount = 0;
  for (const t of form.talents) {
    const found = findTalentByName(t);
    if (found) {
      positiveCount++;
      categoryCount[found.category.id] = (categoryCount[found.category.id] ?? 0) + 1;
      if (categoryCount[found.category.id] > TALENT_MAX_PER_CATEGORY) {
        return `「${found.category.name}」类天赋最多选${TALENT_MAX_PER_CATEGORY}个`;
      }
    } else if (FLAW_OPTIONS.includes(t)) {
      flawCount++;
    } else {
      return `无效的天赋词条：${t}`;
    }
  }
  if (positiveCount < TALENT_MIN_COUNT || positiveCount > TALENT_MAX_COUNT) {
    return `正向天赋须选${TALENT_MIN_COUNT}-${TALENT_MAX_COUNT}个`;
  }
  if (flawCount > 1) return '小缺陷最多选1个';
  return null;
}

// ---- 行映射：数据库行 → 对外形态（ID取负） ----

function toPublic(row: typeof schema.customCharacter.$inferSelect) {
  return {
    id: -row.id,
    projectId: row.projectId,
    name: row.name,
    gender: row.gender,
    raceCategory: row.raceCategory,
    raceSub: row.raceSub,
    position: row.position,
    fakePosition: row.fakePosition ?? null,
    stance: row.stance,
    innerPersonality: row.innerPersonality,
    outerPersonality: (row.outerPersonality as string[]) ?? [],
    talents: (row.talents as string[]) ?? [],
    strengths: (row.strengths as string[]) ?? [],
    weaknesses: (row.weaknesses as string[]) ?? [],
    description: row.description ?? null,
    verdictPoem: row.verdictPoem ?? null,
    verdictComment: row.verdictComment ?? null,
    /** 实体状态（09-自动维护）：official/draft */
    entityStatus: (row as any).entityStatus ?? 'official',
    /** 章节动态数组（09-自动维护 US-3） */
    chapterUpdates: Array.isArray((row as any).chapterUpdates) ? (row as any).chapterUpdates : [],
    createdAt: row.createdAt?.toISOString() ?? '',
    updatedAt: row.updatedAt?.toISOString() ?? '',
  };
}

/** 对外负数ID → 数据库真实ID */
function toDbId(publicId: number): number | null {
  const abs = Math.abs(Number(publicId));
  return Number.isInteger(abs) && abs > 0 ? abs : null;
}

/** 数据库行 → 判词生成入参草稿 */
function rowToDraft(row: typeof schema.customCharacter.$inferSelect): CustomCharacterDraft {
  return {
    name: row.name,
    gender: row.gender as Gender,
    raceCategory: row.raceCategory as RaceCategoryId,
    raceSub: row.raceSub,
    position: row.position as CustomCharacterDraft['position'],
    fakePosition: (row.fakePosition ?? null) as CustomCharacterDraft['fakePosition'],
    stance: row.stance,
    innerPersonality: row.innerPersonality as CustomCharacterDraft['innerPersonality'],
    outerPersonality: (row.outerPersonality as string[]) ?? [],
    talents: (row.talents as string[]) ?? [],
    strengths: (row.strengths as string[]) ?? [],
    weaknesses: (row.weaknesses as string[]) ?? [],
  };
}

// ---- LLM 小传生成 ----

async function generateBio(draft: CustomCharacterDraft): Promise<string> {
  const category = findRaceCategory(draft.raceCategory);
  const sub = findRaceSub(draft.raceCategory, draft.raceSub);
  const pos = findPosition(draft.position);
  const fakePos = draft.fakePosition ? findPosition(draft.fakePosition) : null;
  const talentLines = draft.talents
    .map((t) => {
      const found = findTalentByName(t);
      return found ? `${t}（${found.entry.desc}）` : `${t}（小缺陷）`;
    })
    .join('\n');

  const systemPrompt = `你是一位仙侠小说人物设定师。根据给定的结构化人物卡，写一段300-500字的人物小传。
要求：
1. 用仙侠韵味的白话文，交代出身来历、性情为人、一技之长与短处
2. 只用"${pos?.name ?? ''}"这类模糊体感定位描述实力（${pos?.desc ?? ''}），严禁出现具体境界名称或等级数字
3. 小传要能直接放进小说设定集使用，不要出现"标签""配置"等系统词汇
4. 只输出小传正文，不要标题、不要解释`;

  const userPrompt = `人物卡：
姓名：${draft.name}（${draft.gender === 'male' ? '男' : '女'}）
种族：${category?.name ?? ''}·${sub?.name ?? ''}——${sub?.desc ?? ''}
实力定位：${pos?.name ?? ''}（${pos?.desc ?? ''}）${fakePos ? `\n伪装示人：平日扮作「${fakePos.name}」，扮猪吃虎` : ''}
立场：${stanceLabel(draft.stance)}（${draft.stance}/100，0=浩然正气 100=邪异诡道）
内在性格：${draft.innerPersonality}
外在性格：${draft.outerPersonality.join('、')}
先天禀赋：
${talentLines}
种族擅长：${draft.strengths.join('、')}
种族短板：${draft.weaknesses.join('、')}`;

  const raw = await chatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0.4, maxTokens: 1024 }
  );
  const bio = raw.trim();
  if (!bio) throw new Error('LLM返回空内容');
  return bio;
}

// ---- 判词生成（失败降级模板，永不阻断） ----

async function generateVerdictSafe(draft: CustomCharacterDraft): Promise<VerdictResult> {
  try {
    return await generateVerdict(draft);
  } catch (err: any) {
    console.warn(`[custom-characters] LLM判词生成失败，降级模板：${err?.message}`);
    return buildFallbackVerdict(draft);
  }
}

// ---- 接口 ----

/** GET /api/projects/:projectId/custom-characters 列表 */
app.get('/projects/:projectId/custom-characters', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    // 状态筛选（09-自动维护 US-4）：?entityStatus=official|draft
    const statusFilter = c.req.query('entityStatus');
    const conds = [
      eq(schema.customCharacter.projectId, projectId),
      eq(schema.customCharacter.isDeleted, false),
    ];
    if (statusFilter === 'draft' || statusFilter === 'official') {
      conds.push(eq((schema.customCharacter as any).entityStatus, statusFilter));
    }

    const rows = await creativeDb
      .select()
      .from(schema.customCharacter)
      .where(and(...conds))
      .orderBy(desc(schema.customCharacter.createdAt));

    return c.json({ success: true, data: rows.map(toPublic) });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:projectId/custom-characters/random 整卡随机（大骰子/局部骰子） */
app.post('/projects/:projectId/custom-characters/random', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = randomSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const { locks = {}, current = {}, talentCategory, excludeTalents = [] } = parsed.data;

    // 分类骰子：只随机指定分类内一条天赋
    if (talentCategory) {
      const name = randomTalentInCategory(talentCategory, excludeTalents);
      if (!name) return c.json({ success: false, error: '该分类无可用天赋' }, 400);
      return c.json({ success: true, data: { talent: name } });
    }

    const draft = randomCharacter(locks, current as any);
    return c.json({ success: true, data: draft });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

const batchCreateSchema = z.object({
  count: z.number().int().min(1).max(20),
  randomize: z.boolean().optional(),
  generateBio: z.boolean().optional(),
});

/** POST /api/projects/:projectId/custom-characters/batch-create 批量新建空白/随机人物 */
app.post('/projects/:projectId/custom-characters/batch-create', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const parsed = batchCreateSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    const { count, randomize = false, generateBio: wantBio = false } = parsed.data;

    const humanSub = findRaceSub('human', '凡人');
    const blankDraft = (i: number): CustomCharacterDraft => ({
      name: `未命名·${i + 1}`,
      gender: 'male',
      raceCategory: 'human' as RaceCategoryId,
      raceSub: '凡人',
      position: 'chenjie' as CustomCharacterDraft['position'],
      fakePosition: null,
      stance: 50,
      innerPersonality: '中庸' as CustomCharacterDraft['innerPersonality'],
      outerPersonality: [],
      talents: [],
      strengths: [...(humanSub?.strengths ?? [])],
      weaknesses: [...(humanSub?.weaknesses ?? [])],
    });

    const result = { created: 0, failed: 0, errors: [] as any[] };
    for (let i = 0; i < count; i++) {
      const draft = randomize ? randomCharacter({}, {}) : blankDraft(i);
      let description: string;
      if (wantBio) {
        try {
          description = await generateBio(draft);
        } catch (err: any) {
          console.warn(`[custom-characters] 批量小传生成失败，降级模板：${err?.message}`);
          description = buildFallbackBio(draft);
        }
      } else {
        description = buildFallbackBio(draft);
      }
      const verdict = buildFallbackVerdict(draft);
      try {
        await creativeDb.insert(schema.customCharacter).values({
          projectId,
          name: draft.name,
          gender: draft.gender,
          raceCategory: draft.raceCategory,
          raceSub: draft.raceSub,
          position: draft.position,
          fakePosition: draft.fakePosition,
          stance: draft.stance,
          innerPersonality: draft.innerPersonality,
          outerPersonality: draft.outerPersonality,
          talents: draft.talents,
          strengths: draft.strengths,
          weaknesses: draft.weaknesses,
          description,
          verdictPoem: verdict.verdictPoem,
          verdictComment: verdict.verdictComment,
        });
        result.created++;
      } catch (e: any) {
        result.failed++;
        result.errors.push({ name: draft.name, error: e.message });
      }
    }
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:projectId/custom-characters/random-name 随机姓名（姓名小骰子） */
app.post('/projects/:projectId/custom-characters/random-name', async (c) => {
  try {
    const parsed = randomNameSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const { raceCategory, raceSub, gender, position, stance } = parsed.data;
    if (!findRaceSub(raceCategory, raceSub)) return c.json({ success: false, error: '无效的种族配置' }, 400);

    const g: Gender = gender ?? (Math.random() < 0.5 ? 'male' : 'female');
    const name = randomName(raceCategory as RaceCategoryId, raceSub, g, { position: position as PositionKey | undefined, stance });
    return c.json({ success: true, data: { name, gender: g } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:projectId/custom-characters/ai-name AI精取名（LLM出5候选，失败回落本地生成） */
app.post('/projects/:projectId/custom-characters/ai-name', async (c) => {
  try {
    const parsed = randomNameSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const { raceCategory, raceSub, gender, position, stance } = parsed.data;
    if (!findRaceSub(raceCategory, raceSub)) return c.json({ success: false, error: '无效的种族配置' }, 400);

    const g: Gender = gender ?? (Math.random() < 0.5 ? 'male' : 'female');
    const count = 5;
    let names: string[] = [];
    let source: 'ai' | 'local' = 'ai';
    try {
      names = await namingAgent.characterName(raceCategory, raceSub, g, position as PositionKey | undefined, stance, count);
    } catch {
      names = [];
    }
    // LLM失败/空结果时回落本地生成器凑满候选，保证按钮永远有结果
    if (names.length === 0) source = 'local';
    const seen = new Set(names);
    let guard = 0;
    while (names.length < count && guard++ < 50) {
      const n = randomName(raceCategory as RaceCategoryId, raceSub, g, { position: position as PositionKey | undefined, stance });
      if (!seen.has(n)) {
        seen.add(n);
        names.push(n);
      }
    }
    return c.json({ success: true, data: { names, gender: g, source } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:projectId/custom-characters/:id 详情（:id 为负数ID或其绝对值） */
app.get('/projects/:projectId/custom-characters/:id', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    const dbId = toDbId(Number(c.req.param('id')));
    if (isNaN(projectId) || !dbId) return c.json({ success: false, error: '无效的ID' }, 400);

    const [row] = await creativeDb
      .select()
      .from(schema.customCharacter)
      .where(and(
        eq(schema.customCharacter.id, dbId),
        eq(schema.customCharacter.projectId, projectId),
        eq(schema.customCharacter.isDeleted, false)
      ));
    if (!row) return c.json({ success: false, error: '人物不存在' }, 404);

    return c.json({ success: true, data: toPublic(row) });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:projectId/custom-characters/smart-match 文字描述→参数智能匹配 */
app.post('/projects/:projectId/custom-characters/smart-match', async (c) => {
  try {
    const { description } = await c.req.json();
    if (typeof description !== 'string' || description.trim().length < 5) {
      return c.json({ success: false, error: '请提供至少 5 个字的描述' }, 400);
    }
    const raw = await forgeSmartMatchAgent.match('character', description.trim(), buildCharacterContext());
    const result = validateCharacter(raw);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:projectId/custom-characters 保存人物（LLM生成小传，失败降级模板） */
app.post('/projects/:projectId/custom-characters', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const parsed = formSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const bizError = validateForm(parsed.data);
    if (bizError) return c.json({ success: false, error: bizError }, 400);

    const sub = findRaceSub(parsed.data.raceCategory, parsed.data.raceSub)!;
    const draft: CustomCharacterDraft = {
      ...parsed.data,
      raceCategory: parsed.data.raceCategory as RaceCategoryId,
      position: parsed.data.position as CustomCharacterDraft['position'],
      fakePosition: (parsed.data.fakePosition ?? null) as CustomCharacterDraft['fakePosition'],
      strengths: [...sub.strengths],
      weaknesses: [...sub.weaknesses],
    };

    // LLM 小传生成，失败降级模板小传（不阻断入库）
    let description: string;
    try {
      description = await generateBio(draft);
    } catch (err: any) {
      console.warn(`[custom-characters] LLM小传生成失败，降级模板：${err?.message}`);
      description = buildFallbackBio(draft);
    }

    // 小传之后同步生成判词（判词Skill，失败降级模板）
    const verdict = await generateVerdictSafe(draft);

    const [row] = await creativeDb
      .insert(schema.customCharacter)
      .values({
        projectId,
        name: draft.name,
        gender: draft.gender,
        raceCategory: draft.raceCategory,
        raceSub: draft.raceSub,
        position: draft.position,
        fakePosition: draft.fakePosition,
        stance: draft.stance,
        innerPersonality: draft.innerPersonality,
        outerPersonality: draft.outerPersonality,
        talents: draft.talents,
        strengths: draft.strengths,
        weaknesses: draft.weaknesses,
        description,
        verdictPoem: verdict.verdictPoem,
        verdictComment: verdict.verdictComment,
      })
      .returning();

    return c.json({ success: true, data: toPublic(row) });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** PUT /api/projects/:projectId/custom-characters/:id 更新（regenerateBio 重生小传，regenerateVerdict 重生判词） */
app.put('/projects/:projectId/custom-characters/:id', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    const dbId = toDbId(Number(c.req.param('id')));
    if (isNaN(projectId) || !dbId) return c.json({ success: false, error: '无效的ID' }, 400);

    const body = await c.req.json();
    const parsed = formSchema.partial().extend({
      description: z.string().optional(),
      regenerateBio: z.boolean().optional(),
      regenerateVerdict: z.boolean().optional(),
    }).safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }

    const [existing] = await creativeDb
      .select()
      .from(schema.customCharacter)
      .where(and(
        eq(schema.customCharacter.id, dbId),
        eq(schema.customCharacter.projectId, projectId),
        eq(schema.customCharacter.isDeleted, false)
      ));
    if (!existing) return c.json({ success: false, error: '人物不存在' }, 404);

    // 合并后整体做业务校验（保证更新后仍满足配置库约束）
    const { regenerateBio, regenerateVerdict, description: manualDesc, ...patch } = parsed.data;
    const merged = {
      name: patch.name ?? existing.name,
      gender: (patch.gender ?? existing.gender) as Gender,
      raceCategory: patch.raceCategory ?? existing.raceCategory,
      raceSub: patch.raceSub ?? existing.raceSub,
      position: patch.position ?? existing.position,
      fakePosition: patch.fakePosition !== undefined ? patch.fakePosition : (existing.fakePosition ?? null),
      stance: patch.stance ?? existing.stance,
      innerPersonality: (patch.innerPersonality ?? existing.innerPersonality) as z.infer<typeof formSchema>['innerPersonality'],
      outerPersonality: patch.outerPersonality ?? ((existing.outerPersonality as string[]) ?? []),
      talents: patch.talents ?? ((existing.talents as string[]) ?? []),
    };
    const formCheck = formSchema.safeParse(merged);
    if (!formCheck.success) {
      return c.json({ success: false, error: '参数验证失败', details: formCheck.error.issues }, 400);
    }
    const bizError = validateForm(formCheck.data);
    if (bizError) return c.json({ success: false, error: bizError }, 400);

    const sub = findRaceSub(merged.raceCategory, merged.raceSub)!;
    const draft: CustomCharacterDraft = {
      ...formCheck.data,
      raceCategory: merged.raceCategory as RaceCategoryId,
      position: merged.position as CustomCharacterDraft['position'],
      fakePosition: (merged.fakePosition ?? null) as CustomCharacterDraft['fakePosition'],
      strengths: [...sub.strengths],
      weaknesses: [...sub.weaknesses],
    };

    let description = manualDesc ?? existing.description ?? null;
    if (regenerateBio) {
      try {
        description = await generateBio(draft);
      } catch (err: any) {
        console.warn(`[custom-characters] LLM小传重生成失败，降级模板：${err?.message}`);
        description = buildFallbackBio(draft);
      }
    }

    // 判词：显式要求重生，或历史数据缺失时补生
    let verdictPoem = existing.verdictPoem ?? null;
    let verdictComment = existing.verdictComment ?? null;
    if (regenerateVerdict || !verdictPoem) {
      const verdict = await generateVerdictSafe(draft);
      verdictPoem = verdict.verdictPoem;
      verdictComment = verdict.verdictComment;
    }

    const [row] = await creativeDb
      .update(schema.customCharacter)
      .set({
        name: draft.name,
        gender: draft.gender,
        raceCategory: draft.raceCategory,
        raceSub: draft.raceSub,
        position: draft.position,
        fakePosition: draft.fakePosition,
        stance: draft.stance,
        innerPersonality: draft.innerPersonality,
        outerPersonality: draft.outerPersonality,
        talents: draft.talents,
        strengths: draft.strengths,
        weaknesses: draft.weaknesses,
        description,
        verdictPoem,
        verdictComment,
        // 用户编辑保存后草稿自动转正（09-自动维护 US-4）
        entityStatus: 'official',
        updatedAt: new Date(),
      })
      .where(eq(schema.customCharacter.id, dbId))
      .returning();

    return c.json({ success: true, data: toPublic(row) });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:projectId/custom-characters/:id/adopt-update 采纳章节动态到正式小传（09 US-3）
 *  body: { index: number } —— chapterUpdates 数组下标；采纳后追加到 description 并移除该条动态 */
app.post('/projects/:projectId/custom-characters/:id/adopt-update', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    const dbId = toDbId(Number(c.req.param('id')));
    if (isNaN(projectId) || !dbId) return c.json({ success: false, error: '无效的ID' }, 400);
    const { index } = await c.req.json();
    if (!Number.isInteger(index) || index < 0) return c.json({ success: false, error: '无效的动态下标' }, 400);

    const [row] = await creativeDb
      .select()
      .from(schema.customCharacter)
      .where(and(
        eq(schema.customCharacter.id, dbId),
        eq(schema.customCharacter.projectId, projectId),
        eq(schema.customCharacter.isDeleted, false)
      ));
    if (!row) return c.json({ success: false, error: '人物不存在' }, 404);

    const updates = Array.isArray(row.chapterUpdates) ? (row.chapterUpdates as any[]) : [];
    const target = updates[index];
    if (!target) return c.json({ success: false, error: '动态不存在（可能已被处理）' }, 404);

    const chapterTag = target.volumeNo != null ? `第${target.volumeNo}卷第${target.chapterNo}章` : `第${target.chapterNo}章`;
    const appended = `【${chapterTag}】${target.updateText}`;
    const description = row.description ? `${row.description}\n${appended}` : appended;
    const next = updates.filter((_, i) => i !== index);

    const [updated] = await creativeDb
      .update(schema.customCharacter)
      .set({ description, chapterUpdates: next, updatedAt: new Date() })
      .where(eq(schema.customCharacter.id, dbId))
      .returning();
    return c.json({ success: true, data: toPublic(updated) });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:projectId/custom-characters/:id/dismiss-update 忽略一条章节动态（09 US-3）
 *  body: { index: number } —— 仅移除，不追加到小传 */
app.post('/projects/:projectId/custom-characters/:id/dismiss-update', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    const dbId = toDbId(Number(c.req.param('id')));
    if (isNaN(projectId) || !dbId) return c.json({ success: false, error: '无效的ID' }, 400);
    const { index } = await c.req.json();
    if (!Number.isInteger(index) || index < 0) return c.json({ success: false, error: '无效的动态下标' }, 400);

    const [row] = await creativeDb
      .select()
      .from(schema.customCharacter)
      .where(and(
        eq(schema.customCharacter.id, dbId),
        eq(schema.customCharacter.projectId, projectId),
        eq(schema.customCharacter.isDeleted, false)
      ));
    if (!row) return c.json({ success: false, error: '人物不存在' }, 404);

    const updates = Array.isArray(row.chapterUpdates) ? (row.chapterUpdates as any[]) : [];
    if (!updates[index]) return c.json({ success: false, error: '动态不存在（可能已被处理）' }, 404);
    const next = updates.filter((_, i) => i !== index);

    const [updated] = await creativeDb
      .update(schema.customCharacter)
      .set({ chapterUpdates: next, updatedAt: new Date() })
      .where(eq(schema.customCharacter.id, dbId))
      .returning();
    return c.json({ success: true, data: toPublic(updated) });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** POST /api/projects/:projectId/custom-characters/:id/generate-verdict 手动（重）生成判词（判词Skill） */
app.post('/projects/:projectId/custom-characters/:id/generate-verdict', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    const dbId = toDbId(Number(c.req.param('id')));
    if (isNaN(projectId) || !dbId) return c.json({ success: false, error: '无效的ID' }, 400);

    const [row] = await creativeDb
      .select()
      .from(schema.customCharacter)
      .where(and(
        eq(schema.customCharacter.id, dbId),
        eq(schema.customCharacter.projectId, projectId),
        eq(schema.customCharacter.isDeleted, false)
      ));
    if (!row) return c.json({ success: false, error: '人物不存在' }, 404);

    const verdict = await generateVerdictSafe(rowToDraft(row));
    await creativeDb
      .update(schema.customCharacter)
      .set({ verdictPoem: verdict.verdictPoem, verdictComment: verdict.verdictComment, updatedAt: new Date() })
      .where(eq(schema.customCharacter.id, dbId));

    // annotation 仅前端展示用，不入库
    return c.json({ success: true, data: verdict });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * POST /projects/:projectId/custom-characters/:id/auto-voice（13-SRS US-18）
 * 一键补全对白风格：读人物完整信息 → flash 模型生成6个业务字段 → 返回不保存
 * （前端填充 VoiceForm 供用户微调后手动点“保存声音配置”）
 */
app.post('/projects/:projectId/custom-characters/:id/auto-voice', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    const dbId = toDbId(Number(c.req.param('id')));
    if (isNaN(projectId) || !dbId) return c.json({ success: false, error: '无效的ID' }, 400);

    const [row] = await creativeDb
      .select()
      .from(schema.customCharacter)
      .where(and(
        eq(schema.customCharacter.id, dbId),
        eq(schema.customCharacter.projectId, projectId),
        eq(schema.customCharacter.isDeleted, false)
      ));
    if (!row) return c.json({ success: false, error: '人物不存在' }, 404);

    const result = await autoVoice({
      name: row.name,
      gender: row.gender,
      raceCategory: row.raceCategory,
      raceSub: row.raceSub,
      position: row.position,
      stance: row.stance,
      innerPersonality: row.innerPersonality,
      outerPersonality: (row.outerPersonality as string[]) ?? [],
      talents: (row.talents as string[]) ?? [],
      strengths: (row.strengths as string[]) ?? [],
      weaknesses: (row.weaknesses as string[]) ?? [],
      description: row.description,
    });
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message || '对白风格生成失败' }, 500);
  }
});

/** DELETE /api/projects/:projectId/custom-characters/:id 软删除 */
app.delete('/projects/:projectId/custom-characters/:id', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    const dbId = toDbId(Number(c.req.param('id')));
    if (isNaN(projectId) || !dbId) return c.json({ success: false, error: '无效的ID' }, 400);

    const [row] = await creativeDb
      .update(schema.customCharacter)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(and(
        eq(schema.customCharacter.id, dbId),
        eq(schema.customCharacter.projectId, projectId),
        eq(schema.customCharacter.isDeleted, false)
      ))
      .returning();
    if (!row) return c.json({ success: false, error: '人物不存在' }, 404);

    return c.json({ success: true, data: { id: -row.id } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ---- 从诛仙库导入人物 ----

const importCharacterSchema = z.object({ worldCharacterId: z.number() });

const REALM_TO_POSITION: Record<string, string> = {
  '尘界': 'chenjie',
  '同途': 'tongtu',
  '达者': 'dazhe',
  '蛰龙': 'zhelong',
  '天游': 'tianyou',
};

/** 诛仙库人物 → 创作库 customCharacter 字段映射（单个/批量导入共用） */
function mapWorldCharacterToCustom(src: any, worldCharacterId: number) {
  return {
    name: src.name,
    gender: 'male', // novel_character_lib 无 gender 列，固定 male
    raceCategory: 'human',
    raceSub: '凡人',
    position: REALM_TO_POSITION[src.realm ?? ''] ?? 'chenjie',
    stance: 50,
    innerPersonality: src.faction ?? '中庸',
    outerPersonality: src.personality ? [src.personality] : [],
    talents: (src.coreSkills as string[]) ?? [],
    strengths: (src.growthLine as string[]) ?? [],
    weaknesses: [],
    sourceRef: { type: 'world_character', id: worldCharacterId, name: src.name, bookId: src.bookId ?? null },
  };
}

/** POST /api/projects/:projectId/custom-characters/import 从诛仙库导入人物快照 */
app.post('/projects/:projectId/custom-characters/import', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const parsed = importCharacterSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const { worldCharacterId } = parsed.data;

    // 1. 从诛仙库读取源人物
    const [src] = await zhuxianDb
      .select()
      .from(zhuxianSchema.novelCharacterLib)
      .where(eq(zhuxianSchema.novelCharacterLib.id, worldCharacterId));
    if (!src) return c.json({ success: false, error: '诛仙库中未找到该人物' }, 404);

    // 2. 字段映射 + 3. 插入 creativeDb
    const [row] = await creativeDb
      .insert(schema.customCharacter)
      .values({
        projectId,
        ...mapWorldCharacterToCustom(src, worldCharacterId),
      })
      .returning();

    return c.json({ success: true, data: toPublic(row) }, 201);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:projectId/custom-characters/import/world-books - 诛仙库书籍列表 */
app.get('/projects/:projectId/custom-characters/import/world-books', async (c) => {
  try {
    const books = await zhuxianDb
      .select({
        bookId: zhuxianSchema.novelBook.bookId,
        bookName: zhuxianSchema.novelBook.bookName,
        author: zhuxianSchema.novelBook.author,
      })
      .from(zhuxianSchema.novelBook)
      .where(eq(zhuxianSchema.novelBook.isDeleted, false))
      .orderBy(zhuxianSchema.novelBook.bookId);
    return c.json({ success: true, data: books });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:projectId/custom-characters/import/world-sources?bookId= - 指定书籍的人物列表 */
app.get('/projects/:projectId/custom-characters/import/world-sources', async (c) => {
  try {
    const bookId = Number(c.req.query('bookId'));
    if (isNaN(bookId)) return c.json({ success: false, error: 'bookId required' }, 400);
    const characters = await zhuxianDb
      .select({
        id: zhuxianSchema.novelCharacterLib.id,
        name: zhuxianSchema.novelCharacterLib.name,
        allTitles: zhuxianSchema.novelCharacterLib.allTitles,
        faction: zhuxianSchema.novelCharacterLib.faction,
        realm: zhuxianSchema.novelCharacterLib.realm,
        bookId: zhuxianSchema.novelCharacterLib.bookId,
      })
      .from(zhuxianSchema.novelCharacterLib)
      .where(and(
        eq(zhuxianSchema.novelCharacterLib.bookId, bookId),
        eq(zhuxianSchema.novelCharacterLib.isDeleted, false),
      ))
      .orderBy(zhuxianSchema.novelCharacterLib.name);
    return c.json({ success: true, data: characters });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

const batchImportSchema = z.object({
  worldCharacterIds: z.array(z.number()).min(1).max(100),
});

/** POST /api/projects/:projectId/custom-characters/import/batch - 从诛仙库批量导入人物 */
app.post('/projects/:projectId/custom-characters/import/batch', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const parsed = batchImportSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const { worldCharacterIds } = parsed.data;
    const result = { created: 0, skippedDuplicate: 0, failed: 0, errors: [] as any[] };

    // 预取本项目已导入人物的 sourceRef.id 集合做去重（按源ID，可靠于 JSON 精确匹配）
    const imported = await creativeDb
      .select({ sourceRef: schema.customCharacter.sourceRef })
      .from(schema.customCharacter)
      .where(and(eq(schema.customCharacter.projectId, projectId), eq(schema.customCharacter.isDeleted, false)));
    const importedWorldIds = new Set(
      imported.map((r) => (r.sourceRef as any)?.id).filter((id) => typeof id === 'number'),
    );

    for (const worldCharacterId of worldCharacterIds) {
      try {
        if (importedWorldIds.has(worldCharacterId)) {
          result.skippedDuplicate++;
          continue;
        }
        const [src] = await zhuxianDb
          .select()
          .from(zhuxianSchema.novelCharacterLib)
          .where(eq(zhuxianSchema.novelCharacterLib.id, worldCharacterId));
        if (!src) {
          result.failed++;
          result.errors.push({ id: worldCharacterId, error: '源人物不存在' });
          continue;
        }
        await creativeDb.insert(schema.customCharacter).values({
          projectId,
          ...mapWorldCharacterToCustom(src, worldCharacterId),
        });
        importedWorldIds.add(worldCharacterId);
        result.created++;
      } catch (e: any) {
        result.failed++;
        result.errors.push({ id: worldCharacterId, error: e.message });
      }
    }

    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ---- 文本抽取人物（LLM 抽取候选 → 人工预览 → 批量创建） ----

const POSITION_KEYS = new Set(['chenjie', 'tongtu', 'dazhe', 'zhelong', 'tianyou']);

/** 将 LLM 返回的境界/档位归一为合法 position key */
function normalizePosition(raw?: string): string {
  if (!raw) return 'chenjie';
  const t = String(raw).trim();
  if (POSITION_KEYS.has(t)) return t;
  if (REALM_TO_POSITION[t]) return REALM_TO_POSITION[t];
  return 'chenjie';
}

const extractedCandidateSchema = z.object({
  name: z.string().min(1).max(50),
  gender: z.enum(['male', 'female']).optional(),
  position: z.string().optional(),
  innerPersonality: z.string().optional(),
  outerPersonality: z.array(z.string()).optional(),
  talents: z.array(z.string()).optional(),
  description: z.string().optional(),
});

/** 从 LLM 输出中稳健提取 JSON 数组（兼容 ```json 代码围栏与前后多余文字） */
function parseJsonArray(raw: string): any[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) throw new Error('LLM 未返回有效 JSON 数组');
  const arr = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error('LLM 返回非数组');
  return arr;
}

/** POST /api/projects/:projectId/custom-characters/extract-from-text 从文本抽取人物候选（不入库） */
app.post('/projects/:projectId/custom-characters/extract-from-text', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const body = z.object({ text: z.string().min(10), generateBio: z.boolean().optional() }).safeParse(await c.req.json());
    if (!body.success) return c.json({ success: false, error: '参数验证失败', details: body.error.issues }, 400);
    const { text, generateBio } = body.data;

    const systemPrompt = `你是一位仙侠小说设定分析师。从用户给出的设定/章节文本中，抽取其中出现的人物，输出结构化 JSON 数组。
每个元素字段：
- name: 人物姓名（字符串，必填）
- gender: "male" 或 "female"（无法判断填 "male"）
- position: 实力档位，只能是 chenjie/tongtu/dazhe/zhelong/tianyou 之一（尘界=最弱 … 天游=最强，无法判断填 chenjie）
- innerPersonality: 一句话内在性情或立场
- outerPersonality: 外在性格标签数组（1-3 个词）
- talents: 本领/特长数组（0-4 个）
- description: ${generateBio ? '300-500字人物小传（仙侠白话，交代来历性情长短）' : '一句话人物简介（30字内）'}
要求：
1. 只输出 JSON 数组，不要任何解释、标题或代码围栏外的文字
2. 没有名字的龙套不要抽取；同一人物只出现一次
3. 严格基于文本，不要虚构文本中没有的设定`;

    const raw = await chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `文本：\n${text.slice(0, 12000)}` },
      ],
      { temperature: 0.2, maxTokens: 4096 }
    );

    const arr = parseJsonArray(raw);
    const candidates: z.infer<typeof extractedCandidateSchema>[] = [];
    for (const item of arr) {
      const parsed = extractedCandidateSchema.safeParse(item);
      if (parsed.success && parsed.data.name.trim()) candidates.push(parsed.data);
    }
    if (candidates.length === 0) {
      return c.json({ success: false, error: '未能从文本中抽取到有效人物' }, 422);
    }
    return c.json({ success: true, data: { candidates } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

const batchCreateCandidatesSchema = z.object({
  characters: z.array(extractedCandidateSchema).min(1).max(50),
});

/** POST /api/projects/:projectId/custom-characters/batch-create-from-candidates 确认候选后批量创建 */
app.post('/projects/:projectId/custom-characters/batch-create-from-candidates', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);

    const parsed = batchCreateCandidatesSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);

    const result = { created: 0, failed: 0, errors: [] as any[] };
    for (const ch of parsed.data.characters) {
      try {
        await creativeDb.insert(schema.customCharacter).values({
          projectId,
          name: ch.name.trim(),
          gender: ch.gender ?? 'male',
          raceCategory: 'human',
          raceSub: '凡人',
          position: normalizePosition(ch.position),
          stance: 50,
          innerPersonality: ch.innerPersonality?.trim() || '中庸',
          outerPersonality: (ch.outerPersonality ?? []).slice(0, 5),
          talents: (ch.talents ?? []).slice(0, 6),
          strengths: [],
          weaknesses: [],
          description: ch.description?.trim() || null,
          sourceRef: { type: 'text_extract' },
        });
        result.created++;
      } catch (e: any) {
        result.failed++;
        result.errors.push({ name: ch.name, error: e.message });
      }
    }
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

/** GET /api/projects/:projectId/custom-characters/import/sources?sourceProjectId= - 源项目可引入人物清单 */
app.get('/projects/:projectId/custom-characters/import/sources', async (c) => {
  try {
    const sourceProjectId = Number(c.req.query('sourceProjectId'));
    if (isNaN(sourceProjectId)) return c.json({ success: false, error: '无效的源项目ID' }, 400);
    const data = await listProjectEntities(schema.customCharacter, sourceProjectId);
    return c.json({ success: true, data });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

const importFromProjectCharacterSchema = z.object({
  sourceProjectId: z.number(),
  ids: z.array(z.number()).min(1),
  skipDuplicates: z.boolean().optional(),
});

/** POST /api/projects/:projectId/custom-characters/import-from-project - 从其他项目引入人物 */
app.post('/projects/:projectId/custom-characters/import-from-project', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const parsed = importFromProjectCharacterSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    }
    const result = await importFromProject({
      table: schema.customCharacter,
      sourceProjectId: parsed.data.sourceProjectId,
      targetProjectId: projectId,
      ids: parsed.data.ids,
      skipDuplicates: parsed.data.skipDuplicates,
      sourceRefType: 'project_character',
    });
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================
// 文件导出/导入（14-SRS US-23）
// ============================================================

const fileExportCharacterSchema = z.object({ ids: z.array(z.number()).min(1) });

/** POST /api/projects/:projectId/custom-characters/export - 导出人物（含 9 张子表）为 JSON items */
app.post('/projects/:projectId/custom-characters/export', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const parsed = fileExportCharacterSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    const items = await exportCharacters(projectId, parsed.data.ids);
    return c.json({ success: true, data: { items } });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

const fileImportCharacterSchema = z.object({
  items: z.array(z.any()).min(1),
  conflictStrategy: z.enum(['skip', 'overwrite']).default('skip'),
});

/** POST /api/projects/:projectId/custom-characters/import-file - 从 JSON 文件导入人物 */
app.post('/projects/:projectId/custom-characters/import-file', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'));
    if (isNaN(projectId)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const parsed = fileImportCharacterSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ success: false, error: '参数验证失败', details: parsed.error.issues }, 400);
    const result = await importCharacters(projectId, parsed.data.items, parsed.data.conflictStrategy);
    return c.json({ success: true, data: result });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;

