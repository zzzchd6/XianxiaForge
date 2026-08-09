/**
 * 人物武学档案路由（人物×功法×武器 招式融合 + 小传）
 * 挂载：app.route('/api', characterMartialRouter)
 * 路径前缀：/projects/:pid/custom-characters/:characterId/martial
 *
 * 端点：
 *  GET    /projects/:pid/custom-characters/:cid/martial          当前档案 + 本项目功法/武器（含 bound 标记，供选择器）
 *  POST   /projects/:pid/custom-characters/:cid/martial/bind     body {techniqueIds[], weaponIds[]} 设置绑定（写各实体 linkedCharacterIds）
 *  POST   /projects/:pid/custom-characters/:cid/martial/generate body {techniqueId, weaponId} 融合招式+小传（upsert，version+1）
 *  DELETE /projects/:pid/custom-characters/:cid/martial          软删除档案
 *
 * 绑定载体复用各实体的 linkedCharacterIds（jsonb，存负数对外人物ID -cid）。
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import {
  characterMartialLoreAgent,
  type MartialLoreCharacter,
  type MartialLoreTechnique,
  type MartialLoreWeapon,
} from '../agents/character-martial-lore.js';

const app = new Hono();

// ============ 辅助 ============

async function loadCharacter(pid: number, cid: number) {
  const rows = await creativeDb
    .select()
    .from(schema.customCharacter)
    .where(and(
      eq(schema.customCharacter.projectId, pid),
      eq(schema.customCharacter.id, cid),
      eq(schema.customCharacter.isDeleted, false),
    ));
  return rows[0];
}

function toMartialCharacter(row: any): MartialLoreCharacter {
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

/** linkedCharacterIds 存负数对外ID；判断是否绑定该人物（兼容正负） */
function isLinked(linked: any, cid: number): boolean {
  const arr = (linked || []) as any[];
  return arr.some((x) => Math.abs(Number(x)) === cid);
}

/** 设置某实体 linkedCharacterIds 中该人物的绑定状态 */
function setLinked(linked: any, cid: number, bind: boolean): any[] {
  const arr = (linked || []) as any[];
  const others = arr.filter((x) => Math.abs(Number(x)) !== cid);
  return bind ? [...others, -cid] : others;
}

// ============ 1. 获取档案 + 可选功法/武器 ============

app.get('/projects/:pid/custom-characters/:characterId/martial', async (c) => {
  const pid = Number(c.req.param('pid'));
  const cid = Math.abs(Number(c.req.param('characterId')));
  try {
    const lores = await creativeDb
      .select()
      .from(schema.characterMartialLore)
      .where(and(
        eq(schema.characterMartialLore.projectId, pid),
        eq(schema.characterMartialLore.characterId, cid),
        eq(schema.characterMartialLore.isDeleted, false),
      ));

    const techniques = await creativeDb
      .select({ id: schema.customTechnique.id, name: schema.customTechnique.name, mainDao: schema.customTechnique.mainDao, linkedCharacterIds: schema.customTechnique.linkedCharacterIds })
      .from(schema.customTechnique)
      .where(and(eq(schema.customTechnique.projectId, pid), eq(schema.customTechnique.isDeleted, false)));
    const weapons = await creativeDb
      .select({ id: schema.customWeapon.id, name: schema.customWeapon.name, category: schema.customWeapon.category, linkedCharacterIds: schema.customWeapon.linkedCharacterIds })
      .from(schema.customWeapon)
      .where(and(eq(schema.customWeapon.projectId, pid), eq(schema.customWeapon.isDeleted, false)));

    return c.json({
      success: true,
      data: {
        lores,
        techniques: techniques.map((t) => ({ id: t.id, name: t.name, mainDao: t.mainDao, bound: isLinked(t.linkedCharacterIds, cid) })),
        weapons: weapons.map((w) => ({ id: w.id, name: w.name, category: w.category, bound: isLinked(w.linkedCharacterIds, cid) })),
      },
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 2. 设置绑定 ============

const bindSchema = z.object({
  techniqueIds: z.array(z.number()).optional(),
  weaponIds: z.array(z.number()).optional(),
});

app.post('/projects/:pid/custom-characters/:characterId/martial/bind', async (c) => {
  const pid = Number(c.req.param('pid'));
  const cid = Math.abs(Number(c.req.param('characterId')));
  try {
    const body = bindSchema.parse(await c.req.json().catch(() => ({})));

    if (body.techniqueIds) {
      const rows = await creativeDb.select().from(schema.customTechnique)
        .where(and(eq(schema.customTechnique.projectId, pid), eq(schema.customTechnique.isDeleted, false)));
      for (const t of rows) {
        const shouldBind = body.techniqueIds.includes(Number(t.id));
        if (isLinked(t.linkedCharacterIds, cid) !== shouldBind) {
          await creativeDb.update(schema.customTechnique)
            .set({ linkedCharacterIds: setLinked(t.linkedCharacterIds, cid, shouldBind), updatedAt: new Date() })
            .where(eq(schema.customTechnique.id, t.id));
        }
      }
    }
    if (body.weaponIds) {
      const rows = await creativeDb.select().from(schema.customWeapon)
        .where(and(eq(schema.customWeapon.projectId, pid), eq(schema.customWeapon.isDeleted, false)));
      for (const w of rows) {
        const shouldBind = body.weaponIds.includes(Number(w.id));
        if (isLinked(w.linkedCharacterIds, cid) !== shouldBind) {
          await creativeDb.update(schema.customWeapon)
            .set({ linkedCharacterIds: setLinked(w.linkedCharacterIds, cid, shouldBind), updatedAt: new Date() })
            .where(eq(schema.customWeapon.id, w.id));
        }
      }
    }
    return c.json({ success: true, data: null });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 3. 融合生成（招式 + 小传） ============

const genSchema = z.object({
  techniqueId: z.number(),
  weaponId: z.number(),
});

app.post('/projects/:pid/custom-characters/:characterId/martial/generate', async (c) => {
  const pid = Number(c.req.param('pid'));
  const cid = Math.abs(Number(c.req.param('characterId')));
  try {
    const { techniqueId, weaponId } = genSchema.parse(await c.req.json().catch(() => ({})));

    const character = await loadCharacter(pid, cid);
    if (!character) return c.json({ success: false, error: '人物不存在' }, 404);

    const [technique] = await creativeDb.select().from(schema.customTechnique)
      .where(and(eq(schema.customTechnique.id, techniqueId), eq(schema.customTechnique.isDeleted, false)));
    if (!technique) return c.json({ success: false, error: '功法不存在' }, 404);

    const [weapon] = await creativeDb.select().from(schema.customWeapon)
      .where(and(eq(schema.customWeapon.id, weaponId), eq(schema.customWeapon.isDeleted, false)));
    if (!weapon) return c.json({ success: false, error: '武器不存在' }, 404);

    // 武器当前生效文案（取招式与简介）
    const [lore] = await creativeDb.select().from(schema.weaponLore)
      .where(and(eq(schema.weaponLore.weaponId, weaponId), eq(schema.weaponLore.isCurrent, true)));

    const techInput: MartialLoreTechnique = {
      name: technique.name,
      mainDao: technique.mainDao,
      assistDao: (technique.assistDao || []) as string[],
      styleType: technique.styleType,
      description: technique.description,
      moves: (technique.moves || []) as { name: string; desc: string; tier?: string }[],
    };
    const weaponInput: MartialLoreWeapon = {
      name: weapon.name,
      category: weapon.category,
      type: weapon.type,
      grade: weapon.grade,
      intro: lore?.intro || null,
      moves: ((lore?.moves || []) as { name: string; desc: string }[]),
    };

    if (!techInput.moves.length && !weaponInput.moves.length) {
      return c.json({ success: false, error: '功法与武器均无招式，无法融合（请先生成功法详解与武器文案）' }, 400);
    }

    const result = await characterMartialLoreAgent.generate({
      character: toMartialCharacter(character),
      technique: techInput,
      weapon: weaponInput,
    });

    // upsert：按 (character, technique, weapon) 组合去重
    const [existing] = await creativeDb.select().from(schema.characterMartialLore)
      .where(and(
        eq(schema.characterMartialLore.projectId, pid),
        eq(schema.characterMartialLore.characterId, cid),
        eq(schema.characterMartialLore.techniqueId, techniqueId),
        eq(schema.characterMartialLore.weaponId, weaponId),
        eq(schema.characterMartialLore.isDeleted, false),
      ));

    if (existing) {
      const [updated] = await creativeDb.update(schema.characterMartialLore)
        .set({
          techniqueId, weaponId,
          fusedMoves: result.fusedMoves as any,
          biography: result.biography,
          version: (existing.version || 1) + 1,
          updatedAt: new Date(),
        })
        .where(eq(schema.characterMartialLore.id, existing.id))
        .returning();
      return c.json({ success: true, data: updated });
    }

    const [inserted] = await creativeDb.insert(schema.characterMartialLore)
      .values({
        projectId: pid, characterId: cid, techniqueId, weaponId,
        fusedMoves: result.fusedMoves as any,
        biography: result.biography,
        version: 1,
      })
      .returning();
    return c.json({ success: true, data: inserted });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 4. 软删除单条 ============

app.delete('/projects/:pid/custom-characters/:characterId/martial/:loreId', async (c) => {
  const pid = Number(c.req.param('pid'));
  const loreId = Number(c.req.param('loreId'));
  try {
    await creativeDb.update(schema.characterMartialLore)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(and(
        eq(schema.characterMartialLore.id, loreId),
        eq(schema.characterMartialLore.projectId, pid),
        eq(schema.characterMartialLore.isDeleted, false),
      ));
    return c.json({ success: true, data: null });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 5. 重新生成单条 ============

app.post('/projects/:pid/custom-characters/:characterId/martial/:loreId/regenerate', async (c) => {
  const pid = Number(c.req.param('pid'));
  const cid = Math.abs(Number(c.req.param('characterId')));
  const loreId = Number(c.req.param('loreId'));
  try {
    const [lore] = await creativeDb.select().from(schema.characterMartialLore)
      .where(and(eq(schema.characterMartialLore.id, loreId), eq(schema.characterMartialLore.isDeleted, false)));
    if (!lore) return c.json({ success: false, error: '档案不存在' }, 404);

    const character = await loadCharacter(pid, cid);
    if (!character) return c.json({ success: false, error: '人物不存在' }, 404);

    const [technique] = await creativeDb.select().from(schema.customTechnique)
      .where(and(eq(schema.customTechnique.id, lore.techniqueId!), eq(schema.customTechnique.isDeleted, false)));
    const [weapon] = await creativeDb.select().from(schema.customWeapon)
      .where(and(eq(schema.customWeapon.id, lore.weaponId!), eq(schema.customWeapon.isDeleted, false)));
    if (!technique || !weapon) return c.json({ success: false, error: '功法或武器已不存在' }, 404);

    const [wpnLore] = await creativeDb.select().from(schema.weaponLore)
      .where(and(eq(schema.weaponLore.weaponId, weapon.id), eq(schema.weaponLore.isCurrent, true)));

    const techInput: MartialLoreTechnique = {
      name: technique.name, mainDao: technique.mainDao,
      assistDao: (technique.assistDao || []) as string[],
      styleType: technique.styleType,
      description: technique.description,
      moves: (technique.moves || []) as { name: string; desc: string; tier?: string }[],
    };
    const weaponInput: MartialLoreWeapon = {
      name: weapon.name, category: weapon.category, type: weapon.type, grade: weapon.grade,
      intro: wpnLore?.intro || null,
      moves: ((wpnLore?.moves || []) as { name: string; desc: string }[]),
    };

    const result = await characterMartialLoreAgent.generate({
      character: toMartialCharacter(character), technique: techInput, weapon: weaponInput,
    });

    const [updated] = await creativeDb.update(schema.characterMartialLore)
      .set({
        fusedMoves: result.fusedMoves as any,
        biography: result.biography,
        version: (lore.version || 1) + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.characterMartialLore.id, loreId))
      .returning();
    return c.json({ success: true, data: updated });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============ 6. 软删除全部（兼容） ============

app.delete('/projects/:pid/custom-characters/:characterId/martial', async (c) => {
  const pid = Number(c.req.param('pid'));
  const cid = Math.abs(Number(c.req.param('characterId')));
  try {
    await creativeDb.update(schema.characterMartialLore)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(and(
        eq(schema.characterMartialLore.projectId, pid),
        eq(schema.characterMartialLore.characterId, cid),
        eq(schema.characterMartialLore.isDeleted, false),
      ));
    return c.json({ success: true, data: null });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
