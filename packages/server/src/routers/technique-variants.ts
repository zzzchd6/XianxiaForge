/**
 * 人物功法个人变种路由（附录N「千人千面法则」）
 * 挂载：app.route('/api', techniqueVariantsRouter)
 * 路径前缀：/projects/:pid/characters/:characterId/techniques/...
 *
 * 端点：
 *  GET    /projects/:pid/characters/:characterId/techniques            列出某人物的全部变种
 *  POST   /projects/:pid/characters/:characterId/techniques/:techniqueId/generate-variant  生成变种（人物绑定功法）
 *  POST   /projects/:pid/characters/:characterId/techniques/:variantId/reroll-variant      重随变种（可锁定）
 *  PUT    /projects/:pid/characters/:characterId/techniques/:variantId/upgrade             成长迭代版本
 *  DELETE /projects/:pid/characters/:characterId/techniques/:variantId                     软删除
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { findTalentByName } from '@novel-studio/shared';
import {
  generateVariant,
  validateVariant,
  type VariantCharacterInput,
  type VariantTechniqueInput,
  type VariantLock,
  type VariantDraft,
} from '../services/technique-variant.js';
import {
  techniqueVariantLoreAgent,
  type VariantLoreCharacter,
  type VariantLoreTechnique,
  type VariantLoreSkeleton,
} from '../agents/technique-variant-lore.js';

const app = new Hono();

// ============ 辅助：custom_character 行 → 四因子输入 ============

function toCharacterInput(row: any): VariantCharacterInput {
  const talents = (row.talents || []) as string[];
  const bodyTalents: string[] = [];
  const originTalents: string[] = [];
  for (const name of talents) {
    const found = findTalentByName(name);
    if (!found) continue;
    if (found.category.id === 'body') bodyTalents.push(name);
    else if (found.category.id === 'origin') originTalents.push(name);
  }
  return {
    name: row.name,
    raceCategory: row.raceCategory,
    raceSub: row.raceSub,
    innerPersonality: row.innerPersonality,
    outerPersonality: (row.outerPersonality || []) as string[],
    bodyTalents,
    originTalents,
  };
}

function toTechniqueInput(row: any): VariantTechniqueInput {
  return {
    name: row.name,
    mainDao: row.mainDao,
    assistDao: (row.assistDao || []) as string[],
    styleType: row.styleType,
    coreTraits: (row.coreTraits || []) as string[],
    abilities: (row.abilities || []) as string[],
    backlash: (row.backlash || []) as string[],
    bodyMark: row.bodyMark || {},
  };
}

// ============ 辅助：LLM 变种详解输入组装（血肉层） ============

function toLoreCharacter(row: any): VariantLoreCharacter {
  return {
    name: row.name,
    raceCategory: row.raceCategory,
    raceSub: row.raceSub,
    innerPersonality: row.innerPersonality,
    outerPersonality: (row.outerPersonality || []) as string[],
    talents: (row.talents || []) as string[],
    description: row.description,
    verdictPoem: row.verdictPoem,
    verdictComment: row.verdictComment,
    stance: row.stance,
    position: row.position,
  };
}

function toLoreTechnique(row: any): VariantLoreTechnique {
  return {
    name: row.name,
    mainDao: row.mainDao,
    assistDao: (row.assistDao || []) as string[],
    styleType: row.styleType,
    description: row.description,
    moves: (row.moves || []) as { name: string; desc: string; tier?: string }[],
  };
}

function toSkeleton(draft: VariantDraft): VariantLoreSkeleton {
  const ce = draft.cultivationEffect || ({} as any);
  return {
    variantName: draft.variantName,
    rarity: draft.rarity,
    daoNote: draft.daoWeightOffset?.note || '',
    traitChanges: (draft.traitOffset || []).map(t => `${t.name}：${t.change}`),
    abilityChanges: (draft.abilityVariant || []).map(a => `${a.baseName}→${a.variantName}：${a.change}`),
    backlashChanges: (draft.backlashOffset || []).map(b => `${b.name}：${b.change}`),
    exclusiveSkill: draft.exclusiveSkill || [],
    cultivationNote: `速度${ce.speed || '—'}；瓶颈${ce.bottleneck || '—'}；风险${ce.risk || '—'}；${ce.note || ''}`,
    factorTrace: draft.factorTrace || [],
  };
}

/** 调用 LLM 生成个人化变种详解；失败降级为 null（不阻断骨架入库） */
async function generateVariantDesc(character: any, technique: any, draft: VariantDraft): Promise<string | null> {
  try {
    return await techniqueVariantLoreAgent.generate({
      character: toLoreCharacter(character),
      technique: toLoreTechnique(technique),
      skeleton: toSkeleton(draft),
    });
  } catch {
    return null;
  }
}

async function loadCharacter(pid: number, characterId: number) {
  const rows = await creativeDb
    .select()
    .from(schema.customCharacter)
    .where(and(
      eq(schema.customCharacter.projectId, pid),
      eq(schema.customCharacter.id, characterId),
      eq(schema.customCharacter.isDeleted, false),
    ));
  return rows[0];
}

async function loadTechnique(pid: number, techniqueId: number) {
  const rows = await creativeDb
    .select()
    .from(schema.customTechnique)
    .where(and(
      eq(schema.customTechnique.projectId, pid),
      eq(schema.customTechnique.id, techniqueId),
      eq(schema.customTechnique.isDeleted, false),
    ));
  return rows[0];
}

// ============ 1. 列出某人物的全部变种 ============

app.get('/projects/:pid/characters/:characterId/techniques', async (c) => {
  const pid = Number(c.req.param('pid'));
  const characterId = Math.abs(Number(c.req.param('characterId')));
  try {
    const rows = await creativeDb
      .select()
      .from(schema.characterTechniqueVariant)
      .where(and(
        eq(schema.characterTechniqueVariant.projectId, pid),
        eq(schema.characterTechniqueVariant.characterId, characterId),
        eq(schema.characterTechniqueVariant.isDeleted, false),
      ));
    return c.json({ success: true, data: rows });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 2. 生成变种 ============

const lockSchema = z.object({
  rarity: z.enum(['common', 'remarkable', 'rare']).optional(),
  originBias: z.boolean().optional(),
});

app.post('/projects/:pid/characters/:characterId/techniques/:techniqueId/generate-variant', async (c) => {
  const pid = Number(c.req.param('pid'));
  const characterId = Math.abs(Number(c.req.param('characterId')));
  const techniqueId = Number(c.req.param('techniqueId'));
  try {
    const body = await c.req.json().catch(() => ({}));
    const lock = lockSchema.parse(body || {}) as VariantLock;

    const character = await loadCharacter(pid, characterId);
    if (!character) return c.json({ success: false, error: '人物不存在' }, 404);
    const technique = await loadTechnique(pid, techniqueId);
    if (!technique) return c.json({ success: false, error: '基础功法不存在' }, 404);

    const techInput = toTechniqueInput(technique);
    const draft = generateVariant(toCharacterInput(character), techInput, { lock });
    const validation = validateVariant(draft, techInput);

    // 血肉层：LLM 生成个人化变种详解（失败降级为 null，骨架照常入库）
    const variantDesc = await generateVariantDesc(character, technique, draft);

    // 若已存在同人物同功法变种，则覆盖最新版（version+1），否则新建
    const existing = await creativeDb
      .select()
      .from(schema.characterTechniqueVariant)
      .where(and(
        eq(schema.characterTechniqueVariant.characterId, characterId),
        eq(schema.characterTechniqueVariant.baseTechniqueId, techniqueId),
        eq(schema.characterTechniqueVariant.isDeleted, false),
      ));

    if (existing.length) {
      const prev = existing[0];
      const [updated] = await creativeDb
        .update(schema.characterTechniqueVariant)
        .set({
          variantName: draft.variantName,
          rarity: draft.rarity,
          daoWeightOffset: draft.daoWeightOffset as any,
          traitOffset: draft.traitOffset as any,
          abilityVariant: draft.abilityVariant as any,
          backlashOffset: draft.backlashOffset as any,
          bodyMark: draft.bodyMark as any,
          exclusiveSkill: draft.exclusiveSkill as any,
          cultivationEffect: draft.cultivationEffect as any,
          description: variantDesc,
          version: (prev.version || 1) + 1,
          updatedAt: new Date(),
        })
        .where(eq(schema.characterTechniqueVariant.id, prev.id))
        .returning();
      return c.json({ success: true, data: updated, validation });
    }

    const [inserted] = await creativeDb
      .insert(schema.characterTechniqueVariant)
      .values({
        projectId: pid,
        characterId,
        baseTechniqueId: techniqueId,
        variantName: draft.variantName,
        rarity: draft.rarity,
        daoWeightOffset: draft.daoWeightOffset as any,
        traitOffset: draft.traitOffset as any,
        abilityVariant: draft.abilityVariant as any,
        backlashOffset: draft.backlashOffset as any,
        bodyMark: draft.bodyMark as any,
        exclusiveSkill: draft.exclusiveSkill as any,
        cultivationEffect: draft.cultivationEffect as any,
        description: variantDesc,
        version: 1,
      })
      .returning();
    return c.json({ success: true, data: inserted, validation });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 3. 重随变种（可锁定） ============

app.post('/projects/:pid/characters/:characterId/techniques/:variantId/reroll-variant', async (c) => {
  const pid = Number(c.req.param('pid'));
  const characterId = Math.abs(Number(c.req.param('characterId')));
  const variantId = Number(c.req.param('variantId'));
  try {
    const body = await c.req.json().catch(() => ({}));
    const lock = lockSchema.parse(body || {}) as VariantLock;

    const variants = await creativeDb
      .select()
      .from(schema.characterTechniqueVariant)
      .where(and(
        eq(schema.characterTechniqueVariant.id, variantId),
        eq(schema.characterTechniqueVariant.isDeleted, false),
      ));
    const prev = variants[0];
    if (!prev) return c.json({ success: false, error: '变种不存在' }, 404);

    const character = await loadCharacter(pid, characterId);
    if (!character) return c.json({ success: false, error: '人物不存在' }, 404);
    const technique = await loadTechnique(pid, Number(prev.baseTechniqueId));
    if (!technique) return c.json({ success: false, error: '基础功法不存在' }, 404);

    const draft = generateVariant(toCharacterInput(character), toTechniqueInput(technique), { lock });

    // 血肉层：重随后同步重生个人化变种详解（失败降级为 null）
    const variantDesc = await generateVariantDesc(character, technique, draft);

    const [updated] = await creativeDb
      .update(schema.characterTechniqueVariant)
      .set({
        variantName: draft.variantName,
        rarity: draft.rarity,
        daoWeightOffset: draft.daoWeightOffset as any,
        traitOffset: draft.traitOffset as any,
        abilityVariant: draft.abilityVariant as any,
        backlashOffset: draft.backlashOffset as any,
        bodyMark: draft.bodyMark as any,
        exclusiveSkill: draft.exclusiveSkill as any,
        cultivationEffect: draft.cultivationEffect as any,
        description: variantDesc,
        version: (prev.version || 1) + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.characterTechniqueVariant.id, variantId))
      .returning();
    return c.json({ success: true, data: updated });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 4. 成长迭代版本 ============

const upgradeSchema = z.object({
  trigger: z.string().max(200).optional(),
});

app.put('/projects/:pid/characters/:characterId/techniques/:variantId/upgrade', async (c) => {
  const pid = Number(c.req.param('pid'));
  const variantId = Number(c.req.param('variantId'));
  try {
    const body = upgradeSchema.parse(await c.req.json().catch(() => ({})));

    const variants = await creativeDb
      .select()
      .from(schema.characterTechniqueVariant)
      .where(and(
        eq(schema.characterTechniqueVariant.id, variantId),
        eq(schema.characterTechniqueVariant.isDeleted, false),
      ));
    const prev = variants[0];
    if (!prev) return c.json({ success: false, error: '变种不存在' }, 404);

    // 成长迭代：在现有 cultivationEffect 上追加成长注记，版本+1（不重掷偏移，符合「前后一致性」）
    const prevEffect = (prev.cultivationEffect || {}) as any;
    const cultivationEffect = {
      ...prevEffect,
      note: [prevEffect.note, body.trigger ? `成长迭代：${body.trigger}` : ''].filter(Boolean).join('；'),
    };

    const [updated] = await creativeDb
      .update(schema.characterTechniqueVariant)
      .set({
        cultivationEffect: cultivationEffect as any,
        version: (prev.version || 1) + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.characterTechniqueVariant.id, variantId))
      .returning();
    return c.json({ success: true, data: updated });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 5. 软删除 ============

app.delete('/projects/:pid/characters/:characterId/techniques/:variantId', async (c) => {
  const variantId = Number(c.req.param('variantId'));
  try {
    await creativeDb
      .update(schema.characterTechniqueVariant)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(eq(schema.characterTechniqueVariant.id, variantId));
    return c.json({ success: true, data: null });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
