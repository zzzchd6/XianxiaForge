/**
 * 自定义实体自动维护管线（09-需求规格说明书 v1.0）
 *
 * 章节生成后：提取新人物/武器/功法 → 建草稿（entityStatus=draft）；
 * 已有人物的重要动态追加到 chapter_updates（不覆盖结构化字段）。
 * 全程 best-effort：调用方已包裹 try/catch，此处内部各步也尽量降级，
 * 任何单点失败不影响其他实体的入库。
 *
 * 去重双保险：prompt 已注入已有名单，入库前再按名称精确匹配查库一次。
 */
import { eq, and } from 'drizzle-orm';
import { creativeDb, zhuxianDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import * as zhuxianSchema from '../db/zhuxian-schema.js';
import { customEntityExtractorAgent, type EntitySensitivity } from '../agents/custom-entity-extractor.js';
import { REALM_HIERARCHY, buildQuoteRanges, isIndexQuoted } from '../rag/fact-checker.js';
import { getOrCreateDefaultMap, edgeCoordinate } from './custom-map-helpers.js';
import type { LlmConfig } from '../types.js';

export interface EntityMaintainConfig {
  /** 总开关（默认开） */
  enabled: boolean;
  sensitivity: EntitySensitivity;
  extractWeapons: boolean;
  extractTechniques: boolean;
  /** 是否提取新地点（10-山河舆图 US-8，默认开） */
  extractLocations: boolean;
}

/** 跨章事实冲突条目（15-SRS P2-1：realm 倒退 / item 消失） */
export interface EntityConflict {
  type: 'realm_regression' | 'item_vanished';
  severity: 'major' | 'minor';
  characterName: string;
  message: string;
}

export interface EntityMaintainResult {
  newCharacters: number;
  newWeapons: number;
  newTechniques: number;
  newLocations: number;
  updates: number;
  /** 跨章新旧事实冲突（15-SRS P2-1，仅作审计提醒不阻断） */
  conflicts: EntityConflict[];
}

/** 章节动态条目（chapter_updates jsonb 数组元素） */
export interface ChapterUpdateEntry {
  chapterNo: number;
  volumeNo: number | null;
  updateText: string;
  category: string;
  extractedAt: string;
}

/** 从 generationConfig 解析实体维护配置（缺省=开启+balanced） */
export function resolveEntityMaintainConfig(generationConfig: unknown): EntityMaintainConfig {
  const cfg = (generationConfig ?? {}) as Record<string, unknown>;
  const sensitivity = cfg.entitySensitivity;
  return {
    enabled: cfg.autoExtractCustomEntities !== false,
    sensitivity: sensitivity === 'strict' || sensitivity === 'loose' ? sensitivity : 'balanced',
    extractWeapons: cfg.extractWeapons !== false,
    extractTechniques: cfg.extractTechniques !== false,
    extractLocations: cfg.extractLocations !== false,
  };
}

// ---- 已有名单查询 ----

async function listNames(
  table: any,
  projectId: number
): Promise<Set<string>> {
  const rows = await creativeDb
    .select({ name: table.name })
    .from(table)
    .where(and(eq(table.projectId, projectId), eq(table.isDeleted, false)));
  return new Set(rows.map((r: any) => r.name as string));
}

async function listZhuxianNames(table: any): Promise<string[]> {
  try {
    const rows = await zhuxianDb
      .select({ name: table.name })
      .from(table)
      .limit(3000);
    return rows.map((r: any) => r.name as string).filter(Boolean);
  } catch {
    // 诛仙库不可达时降级为空名单（不阻断维护流程，仅丧失原著去重能力）
    return [];
  }
}

// ---- 草稿占位字段（NOT NULL 且无默认值的列给安全占位，用户编辑时补全）----

const CHARACTER_PLACEHOLDER = {
  raceCategory: 'human',
  raceSub: 'commoner',
  position: 'chenjie',
  innerPersonality: '中庸',
} as const;

const WEAPON_PLACEHOLDER = {
  category: 'martial',
  type: 'short_sword',
  baseMaterial: 'fan_iron',
} as const;

const TECHNIQUE_PLACEHOLDER = {
  mainDao: 'lingqi',
  guidanceDepth: 'rudimentary',
  styleType: 'special',
  practicePath: 'orthodox',
  inheritance: 'oral',
} as const;

// ============================================================
// 15-SRS P2-1：跨章新旧事实冲突比对（realm 倒退 / item 消失，零 token 规则）
// ============================================================

/** item 消失判定的否定表述模式（边界：仅做字面否定匹配，不做存在性推理） */
const ITEM_NEGATION_RE = /(从未有过|不曾拥有|从未拥有|不曾有过|从未持有|根本没有|并无此物|早已丢失|已经丢失|早已不在)/;

/**
 * realm 等级序列：优先读环境变量 REALM_SEQUENCE（逗号/顿号/箭头分隔），
 * 否则回退默认仙侠序列（fact-checker REALM_HIERARCHY）。
 */
function getRealmSequence(): string[] {
  const raw = process.env.REALM_SEQUENCE;
  if (raw) {
    const seq = raw.split(/[,，、→>\s]+/).map((s) => s.trim()).filter(Boolean);
    if (seq.length >= 2) return seq;
  }
  return REALM_HIERARCHY;
}

/** 从自由文本中匹配境界词，返回序列索引（多个命中取最高级，兼容"从X突破到Y"表述），无命中 -1 */
function matchRealmIndex(text: string, seq: string[]): number {
  let best = -1;
  for (let i = 0; i < seq.length; i++) {
    if (text.includes(seq[i])) best = i;
  }
  return best;
}

/**
 * realm 倒退检测：历史最新 realm 记录 vs 本次提取的 realm，等级下降 → major。
 * （正常升境/无法解析的表述均不报，防误报优先）
 */
export function detectRealmRegression(
  charName: string,
  prevUpdates: ChapterUpdateEntry[],
  newUpdateText: string,
): EntityConflict | null {
  const seq = getRealmSequence();
  const newIdx = matchRealmIndex(newUpdateText, seq);
  if (newIdx < 0) return null;
  // 取历史中最新一条含境界词的 realm 记录
  const prevRealm = [...prevUpdates]
    .filter((e) => e.category === 'realm')
    .sort((a, b) => b.chapterNo - a.chapterNo)
    .map((e) => matchRealmIndex(e.updateText, seq))
    .find((idx) => idx >= 0);
  if (prevRealm === undefined) return null;
  if (newIdx < prevRealm) {
    return {
      type: 'realm_regression',
      severity: 'major',
      characterName: charName,
      message: `${charName}境界疑似倒退：历史确认"${seq[prevRealm]}"，本次提取"${seq[newIdx]}"`,
    };
  }
  return null;
}

/**
 * item 消失检测：历史 chapterUpdates(category=item) 记录持有某武器 +
 * 当章正文该武器名后 12 字内出现否定表述 → minor。引号内对话跳过防误报。
 */
export function detectItemVanished(
  charName: string,
  prevUpdates: ChapterUpdateEntry[],
  content: string,
  weaponNames: Set<string>,
): EntityConflict[] {
  const conflicts: EntityConflict[] = [];
  const itemTexts = prevUpdates.filter((e) => e.category === 'item').map((e) => e.updateText);
  if (!itemTexts.length || !weaponNames.size) return conflicts;
  const quoteRanges = buildQuoteRanges(content);
  for (const item of weaponNames) {
    if (item.length < 2) continue;
    // 历史须确认过持有该武器
    if (!itemTexts.some((t) => t.includes(item))) continue;
    let from = 0;
    while (true) {
      const idx = content.indexOf(item, from);
      if (idx < 0) break;
      from = idx + item.length;
      if (isIndexQuoted(quoteRanges, idx)) continue; // 对话内不判
      const window = content.slice(idx + item.length, idx + item.length + 12);
      if (ITEM_NEGATION_RE.test(window)) {
        conflicts.push({
          type: 'item_vanished',
          severity: 'minor',
          characterName: charName,
          message: `${charName}历史上持有"${item}"，但本章出现否定表述（${window.trim().slice(0, 12)}）`,
        });
        break;
      }
    }
  }
  return conflicts;
}

/** 章节实体自动维护主入口（best-effort，调用方负责 try/catch） */
export async function processChapterEntities(
  projectId: number,
  volumeNo: number | null,
  chapterNo: number,
  content: string,
  config: EntityMaintainConfig,
  llmConfig?: LlmConfig
): Promise<EntityMaintainResult> {
  const result: EntityMaintainResult = { newCharacters: 0, newWeapons: 0, newTechniques: 0, newLocations: 0, updates: 0, conflicts: [] };
  if (!config.enabled || !content || content.trim().length < 50) return result;

  // 1. 已有名单（项目内四表 + 诛仙库原著）
  const [charNames, weaponNames, techNames, locNames, zhuxianChars, zhuxianItems, zhuxianSkills, zhuxianLocs] = await Promise.all([
    listNames(schema.customCharacter, projectId),
    listNames(schema.customWeapon, projectId),
    listNames(schema.customTechnique, projectId),
    listNames(schema.customLocation, projectId),
    listZhuxianNames(zhuxianSchema.novelCharacterLib),
    config.extractWeapons ? listZhuxianNames(zhuxianSchema.novelMagicItemLib) : Promise.resolve([]),
    config.extractTechniques ? listZhuxianNames(zhuxianSchema.novelSkillLib) : Promise.resolve([]),
    config.extractLocations ? listZhuxianNames(zhuxianSchema.novelLocationLib) : Promise.resolve([]),
  ]);

  // 2. LLM 提取
  const extraction = await customEntityExtractorAgent.extract(content, {
    existingCharacters: Array.from(charNames),
    existingWeapons: Array.from(weaponNames),
    existingTechniques: Array.from(techNames),
    existingLocations: Array.from(locNames),
    zhuxianCharacters: zhuxianChars,
    sensitivity: config.sensitivity,
    extractWeapons: config.extractWeapons,
    extractTechniques: config.extractTechniques,
    extractLocations: config.extractLocations,
    llmConfig,
  });

  // 3. 新人物建草稿
  const zhuxianCharSet = new Set(zhuxianChars);
  const seenChars = new Set<string>();
  for (const ch of extraction.newCharacters) {
    const name = ch.name.trim().slice(0, 64);
    if (!name || seenChars.has(name)) continue;
    // 双保险去重：已有名单/诛仙库/严格档无对话/路人过滤
    if (charNames.has(name) || zhuxianCharSet.has(name)) continue;
    if (config.sensitivity === 'strict' && !ch.hasDialogue) continue;
    if (ch.significance === 'minor' && ch.mentionCount < 2 && !ch.hasDialogue) continue;
    seenChars.add(name);
    try {
      await creativeDb.insert(schema.customCharacter).values({
        projectId,
        name,
        description: ch.description ? ch.description.slice(0, 500) : null,
        ...CHARACTER_PLACEHOLDER,
        entityStatus: 'draft',
        // 15-SRS P0-2：提取器已推断出男/女时写入，unknown 不写（保持表默认）
        ...(ch.gender === 'male' || ch.gender === 'female' ? { gender: ch.gender } : {}),
      });
      result.newCharacters++;
    } catch {
      // 单条插入失败（如并发同名）跳过，不阻断
    }
  }

  // 4. 新武器建草稿
  if (config.extractWeapons) {
    const zhuxianItemSet = new Set(zhuxianItems);
    const seenWeapons = new Set<string>();
    for (const wp of extraction.newWeapons) {
      const name = wp.name.trim().slice(0, 32);
      if (!name || seenWeapons.has(name)) continue;
      if (weaponNames.has(name) || zhuxianItemSet.has(name)) continue;
      seenWeapons.add(name);
      try {
        await creativeDb.insert(schema.customWeapon).values({
          projectId,
          name,
          ...WEAPON_PLACEHOLDER,
          entityStatus: 'draft',
        });
        result.newWeapons++;
      } catch {
        // 跳过单条失败
      }
    }
  }

  // 5. 新功法建草稿
  if (config.extractTechniques) {
    const zhuxianSkillSet = new Set(zhuxianSkills);
    const seenTechs = new Set<string>();
    for (const tc of extraction.newTechniques) {
      const name = tc.name.trim().slice(0, 32);
      if (!name || seenTechs.has(name)) continue;
      if (techNames.has(name) || zhuxianSkillSet.has(name)) continue;
      seenTechs.add(name);
      try {
        await creativeDb.insert(schema.customTechnique).values({
          projectId,
          name,
          ...TECHNIQUE_PLACEHOLDER,
          entityStatus: 'draft',
        });
        result.newTechniques++;
      } catch {
        // 跳过单条失败
      }
    }
  }

  // 6. 新地点建草稿（10-山河舆图 US-8：默认地图 + 边缘坐标 + draft）
  if (config.extractLocations && extraction.newLocations.length > 0) {
    const zhuxianLocSet = new Set(zhuxianLocs);
    const seenLocs = new Set<string>();
    let defaultMap: Awaited<ReturnType<typeof getOrCreateDefaultMap>> | null = null;
    let placed = 0;
    for (const lc of extraction.newLocations) {
      const name = lc.name.trim().slice(0, 64);
      if (!name || seenLocs.has(name)) continue;
      if (locNames.has(name) || zhuxianLocSet.has(name)) continue;
      seenLocs.add(name);
      try {
        if (!defaultMap) defaultMap = await getOrCreateDefaultMap(projectId);
        const pos = edgeCoordinate(locNames.size + placed, defaultMap);
        await creativeDb.insert(schema.customLocation).values({
          projectId,
          mapId: defaultMap.id,
          name,
          x: pos.x,
          y: pos.y,
          locationType: lc.locationType,
          description: lc.description ? lc.description.slice(0, 500) : null,
          entityStatus: 'draft',
          metadata: { source: 'auto-extract', chapterNo, volumeNo },
        });
        placed++;
        result.newLocations++;
      } catch {
        // 跳过单条失败
      }
    }
  }

  // 7. 已有人物动态追加（幂等：先移除本章旧条目再追加）
  if (extraction.characterUpdates.length > 0) {
    // 只保留名字精确匹配本项目自定义人物的动态（诛仙库人物无 custom 记录，自然丢弃）
    const matched = extraction.characterUpdates.filter((u) => charNames.has(u.name.trim()));
    if (matched.length > 0) {
      const names = Array.from(new Set(matched.map((u) => u.name.trim())));
      const rows = await creativeDb
        .select({ id: schema.customCharacter.id, name: schema.customCharacter.name, chapterUpdates: schema.customCharacter.chapterUpdates })
        .from(schema.customCharacter)
        .where(and(
          eq(schema.customCharacter.projectId, projectId),
          eq(schema.customCharacter.isDeleted, false),
        ));
      const byName = new Map(rows.filter((r) => names.includes(r.name)).map((r) => [r.name, r]));
      const now = new Date().toISOString();
      const itemChecked = new Set<string>();
      for (const u of matched) {
        const row = byName.get(u.name.trim());
        if (!row) continue;
        try {
          const prev = (Array.isArray(row.chapterUpdates) ? row.chapterUpdates : []) as ChapterUpdateEntry[];
          const cleaned = prev.filter((e) => e.chapterNo !== chapterNo);

          // 15-SRS P2-1：写入前做新旧事实冲突比对（best-effort，单条失败不阻断）
          try {
            if (u.category === 'realm') {
              const conflict = detectRealmRegression(row.name, cleaned, u.updateText);
              if (conflict) result.conflicts.push(conflict);
            }
            if (!itemChecked.has(row.name)) {
              itemChecked.add(row.name);
              result.conflicts.push(...detectItemVanished(row.name, cleaned, content, weaponNames));
            }
          } catch { /* 冲突检测失败不影响动态入库 */ }

          const next = [...cleaned, {
            chapterNo,
            volumeNo,
            updateText: u.updateText.slice(0, 200),
            category: u.category,
            extractedAt: now,
          }];
          await creativeDb
            .update(schema.customCharacter)
            .set({ chapterUpdates: next, updatedAt: new Date() })
            .where(eq(schema.customCharacter.id, row.id));
          result.updates++;
        } catch {
          // 跳过单条失败
        }
      }
    }
  }

  return result;
}
