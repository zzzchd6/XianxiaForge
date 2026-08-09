/**
 * 世界观批量管线（公共复用件）
 *
 * 设计要点（基于 schema 实查）：
 * - 8 类实体表互相引用几乎全用「名称文本」（character.faction / skill.faction / location.related_faction /
 *   item.owners 等均为 text），而非外键 ID。因此跨书复制只需整行拷贝（改 book_id），名称引用天然保持，无硬依赖顺序。
 * - 仅两张关系表用真实 ID：lib_character_relation(char_a_id/char_b_id)、lib_faction_member(faction_id/char_id)，
 *   需在全部实体复制完、拿到「源ID→新ID」映射后重映射。
 * - 整行复制用服务端 INSERT...SELECT（embedding 向量不出库、免类型转换），列清单从 information_schema 动态取，
 *   排除 id/book_id/is_deleted/version/created_at（目标端重生成）。
 *
 * 数据源可插拔：当前实现 importFromBook（跨书复制，WS2）；文本抽取入库（WS3）复用日志与去重约定。
 */
import { zhuxianClient } from '../db/index.js';

export type WorldEntityType =
  | 'characters' | 'factions' | 'locations' | 'skills'
  | 'items' | 'monsters' | 'materials' | 'daily';

/** 可跨书引入的实体类型（在 8 类基础上追加 宗门规制/岁时节令；WS3 文本抽取仍只用 WorldEntityType） */
export type ImportableEntityType = WorldEntityType | 'factionRules' | 'seasonEvents';

/** 实体表（顺序仅为复制先后，无硬依赖） */
export const ENTITY_TABLES: Record<ImportableEntityType, string> = {
  locations: 'novel_location_lib',
  factions: 'novel_faction_lib',
  characters: 'novel_character_lib',
  skills: 'novel_skill_lib',
  items: 'novel_magic_item_lib',
  monsters: 'novel_monster_lib',
  materials: 'novel_material_lib',
  daily: 'novel_daily_item_lib',
  factionRules: 'novel_faction_rule_lib',
  seasonEvents: 'novel_season_event_lib',
};

export const ENTITY_TYPE_LABELS: Record<ImportableEntityType, string> = {
  characters: '人物', factions: '门派', locations: '地点', skills: '功法',
  items: '法宝', monsters: '妖兽', materials: '丹药灵材', daily: '日常信物',
  factionRules: '宗门规制', seasonEvents: '岁时节令',
};

/** 主名称列映射：规制/节令表用 rule_name/event_name 而非 name（去重与展示用） */
const NAME_COLUMN: Partial<Record<ImportableEntityType, string>> = {
  factionRules: 'rule_name',
  seasonEvents: 'event_name',
};
const nameCol = (type: ImportableEntityType): string => NAME_COLUMN[type] ?? 'name';

/** 复制时排除的列（目标端重生成） */
const EXCLUDE_COLS = new Set(['id', 'book_id', 'is_deleted', 'version', 'created_at']);

export interface ImportOptions {
  sourceBookId: number;
  targetBookId: number;
  types: ImportableEntityType[];
  /** 可选：按类型指定要引入的源实体 ID；缺省=该类型全部 */
  entityIds?: Partial<Record<ImportableEntityType, number[]>>;
  /** 目标书已有同名实体时跳过（默认 true） */
  skipDuplicates?: boolean;
}

export interface TypeStat { created: number; skipped: number; failed: number }

export interface ImportResult {
  batchId: string;
  created: number;
  skippedDuplicate: number;
  failed: number;
  relationsCopied: number;
  byType: Partial<Record<ImportableEntityType, TypeStat>>;
  errors: { type: ImportableEntityType; sourceId: number; error: string }[];
}

/** 缓存各表可复制列清单 */
const colCache = new Map<string, string[]>();
async function copyColumns(table: string): Promise<string[]> {
  if (colCache.has(table)) return colCache.get(table)!;
  const rows = await zhuxianClient.unsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    [table]
  );
  const cols = rows.map((r: any) => r.column_name as string).filter((c) => !EXCLUDE_COLS.has(c));
  colCache.set(table, cols);
  return cols;
}

function genBatchId(): string {
  return `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 跨书批量引入（复制式）。事务包裹，失败整体回滚。
 */
export async function importFromBook(opts: ImportOptions): Promise<ImportResult> {
  const { sourceBookId, targetBookId, types } = opts;
  const skipDuplicates = opts.skipDuplicates !== false;
  const batchId = genBatchId();
  const result: ImportResult = {
    batchId, created: 0, skippedDuplicate: 0, failed: 0, relationsCopied: 0, byType: {}, errors: [],
  };
  // 源ID→新ID 映射（供关系表重映射）
  const idMap: Partial<Record<ImportableEntityType, Map<number, number>>> = {};

  await zhuxianClient.begin(async (tx) => {
    // 1. 逐类型复制实体
    for (const type of types) {
      const table = ENTITY_TABLES[type];
      if (!table) continue;
      const stat: TypeStat = { created: 0, skipped: 0, failed: 0 };
      result.byType[type] = stat;
      idMap[type] = new Map();

      const cols = await copyColumns(table);
      const colList = cols.map((c) => `"${c}"`).join(', ');
      const ncol = nameCol(type);

      // 目标书已有名（去重用）
      const existRows = await tx.unsafe(
        `SELECT "${ncol}" AS name FROM ${table} WHERE book_id = $1 AND is_deleted = false`, [targetBookId]
      );
      const existNames = new Set(existRows.map((r: any) => r.name));

      // 源实体
      const wantIds = opts.entityIds?.[type];
      const srcRows = wantIds && wantIds.length
        ? await tx.unsafe(
            `SELECT id, "${ncol}" AS name FROM ${table} WHERE book_id = $1 AND is_deleted = false AND id = ANY($2) ORDER BY id`,
            [sourceBookId, wantIds]
          )
        : await tx.unsafe(
            `SELECT id, "${ncol}" AS name FROM ${table} WHERE book_id = $1 AND is_deleted = false ORDER BY id`,
            [sourceBookId]
          );

      for (const src of srcRows) {
        if (skipDuplicates && existNames.has(src.name)) {
          stat.skipped++; result.skippedDuplicate++;
          await tx.unsafe(
            `INSERT INTO entity_import_log (batch_id, source_book_id, target_book_id, entity_type, source_entity_id, status, error_message)
             VALUES ($1,$2,$3,$4,$5,'skipped_duplicate',$6)`,
            [batchId, sourceBookId, targetBookId, type, src.id, `目标书已存在同名实体：${src.name}`]
          );
          continue;
        }
        try {
          const [ins] = await tx.unsafe(
            `INSERT INTO ${table} (${colList}, book_id, is_deleted, version, created_at)
             SELECT ${colList}, $1, false, 1, now() FROM ${table} WHERE id = $2 AND book_id = $3
             RETURNING id`,
            [targetBookId, src.id, sourceBookId]
          );
          if (!ins) throw new Error('复制未返回新ID');
          // postgres-js 将 bigint 主键返回为字符串，统一归一化为 number，
          // 否则关系重映射时 charMap.get(Number(id)) 以数字键查字符串键会全部 miss
          idMap[type]!.set(Number(src.id), Number(ins.id));
          existNames.add(src.name);
          stat.created++; result.created++;
          await tx.unsafe(
            `INSERT INTO entity_import_log (batch_id, source_book_id, target_book_id, entity_type, source_entity_id, target_entity_id, status)
             VALUES ($1,$2,$3,$4,$5,$6,'success')`,
            [batchId, sourceBookId, targetBookId, type, src.id, ins.id]
          );
        } catch (e: any) {
          stat.failed++; result.failed++;
          result.errors.push({ type, sourceId: src.id, error: e.message });
          await tx.unsafe(
            `INSERT INTO entity_import_log (batch_id, source_book_id, target_book_id, entity_type, source_entity_id, status, error_message)
             VALUES ($1,$2,$3,$4,$5,'failed',$6)`,
            [batchId, sourceBookId, targetBookId, type, src.id, e.message]
          );
        }
      }
    }

    // 2. 关系表重映射复制
    const charMap = idMap.characters;
    const factionMap = idMap.factions;

    // 2a. 人物关系（两端都需已复制）
    if (charMap && charMap.size) {
      const relRows = await tx.unsafe(
        `SELECT r.rel_id, r.char_a_id, r.char_b_id, r.rel_type, r.interact_count
         FROM lib_character_relation r
         JOIN novel_character_lib c ON c.id = r.char_a_id
         WHERE c.book_id = $1`, [sourceBookId]
      );
      for (const r of relRows) {
        const a = charMap.get(Number(r.char_a_id));
        const b = charMap.get(Number(r.char_b_id));
        if (a && b) {
          await tx.unsafe(
            `INSERT INTO lib_character_relation (char_a_id, char_b_id, rel_type, interact_count, created_at)
             VALUES ($1,$2,$3,$4,now())`, [a, b, r.rel_type, r.interact_count]
          );
          result.relationsCopied++;
        }
      }
    }

    // 2b. 门派成员（门派+人物都需已复制）
    if (charMap && factionMap && charMap.size && factionMap.size) {
      const memRows = await tx.unsafe(
        `SELECT m.faction_id, m.char_id, m.position
         FROM lib_faction_member m
         JOIN novel_faction_lib f ON f.id = m.faction_id
         WHERE f.book_id = $1`, [sourceBookId]
      );
      for (const m of memRows) {
        const fid = factionMap.get(Number(m.faction_id));
        const cid = charMap.get(Number(m.char_id));
        if (fid && cid) {
          await tx.unsafe(
            `INSERT INTO lib_faction_member (faction_id, char_id, position) VALUES ($1,$2,$3)`,
            [fid, cid, m.position]
          );
          result.relationsCopied++;
        }
      }
    }
  });

  return result;
}

/** 查询某书可作为引入源的实体清单（按类型分组，供前端选择器） */
export async function listImportableEntities(bookId: number, types: ImportableEntityType[]) {
  const out: Partial<Record<ImportableEntityType, { id: number; name: string }[]>> = {};
  for (const type of types) {
    const table = ENTITY_TABLES[type];
    if (!table) continue;
    const rows = await zhuxianClient.unsafe(
      `SELECT id, "${nameCol(type)}" AS name FROM ${table} WHERE book_id = $1 AND is_deleted = false ORDER BY id`, [bookId]
    );
    out[type] = rows.map((r: any) => ({ id: Number(r.id), name: r.name }));
  }
  return out;
}

// ============================================================
// 文风引擎跨书克隆（WS5：整套配置 + 场景映射）
// ============================================================

/** 文风表复制时排除的列（主键/书隔离/软删/版本/时间戳均在目标端重生成） */
const STYLE_EXCLUDE_COLS = new Set([
  'config_id', 'mapping_id', 'book_id', 'is_deleted', 'version', 'create_time', 'update_time',
]);

async function styleCopyColumns(table: string): Promise<string[]> {
  const rows = await zhuxianClient.unsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    [table]
  );
  return rows.map((r: any) => r.column_name as string).filter((c) => !STYLE_EXCLUDE_COLS.has(c));
}

export interface StyleCloneResult {
  /** false 表示未克隆（源书无配置 或 目标书已有配置而跳过） */
  cloned: boolean;
  configCopied: number;
  mappingsCopied: number;
  reason?: string;
}

/**
 * 跨书克隆文风引擎：把源书的全局文风配置 + 全部场景映射复制到目标书。
 * - 源书无配置 → 不克隆，返回 reason
 * - 目标书已有 active 配置 → 跳过（不覆盖），返回 reason
 */
export async function cloneBookStyle(sourceBookId: number, targetBookId: number): Promise<StyleCloneResult> {
  if (sourceBookId === targetBookId) throw new Error('源书籍与目标书籍不能相同');

  const [srcCfg] = await zhuxianClient.unsafe(
    `SELECT config_id FROM style_global_config WHERE book_id = $1 AND is_deleted = false LIMIT 1`, [sourceBookId]
  );
  if (!srcCfg) return { cloned: false, configCopied: 0, mappingsCopied: 0, reason: '源书没有文风配置，无可引入' };

  const [existCfg] = await zhuxianClient.unsafe(
    `SELECT config_id FROM style_global_config WHERE book_id = $1 AND is_deleted = false LIMIT 1`, [targetBookId]
  );
  if (existCfg) return { cloned: false, configCopied: 0, mappingsCopied: 0, reason: '目标书已有文风配置，已跳过（未覆盖）' };

  let configCopied = 0;
  let mappingsCopied = 0;
  await zhuxianClient.begin(async (tx) => {
    const cfgCols = await styleCopyColumns('style_global_config');
    const cfgList = cfgCols.map((c) => `"${c}"`).join(', ');
    const cfgIns = await tx.unsafe(
      `INSERT INTO style_global_config (${cfgList}, book_id, is_deleted, version, create_time, update_time)
       SELECT ${cfgList}, $1, false, 1, now(), now()
       FROM style_global_config WHERE book_id = $2 AND is_deleted = false
       RETURNING config_id`,
      [targetBookId, sourceBookId]
    );
    configCopied = cfgIns.length;

    const mapCols = await styleCopyColumns('style_scene_mapping');
    const mapList = mapCols.map((c) => `"${c}"`).join(', ');
    const mapIns = await tx.unsafe(
      `INSERT INTO style_scene_mapping (${mapList}, book_id, is_deleted, version, create_time, update_time)
       SELECT ${mapList}, $1, false, 1, now(), now()
       FROM style_scene_mapping WHERE book_id = $2 AND is_deleted = false
       RETURNING mapping_id`,
      [targetBookId, sourceBookId]
    );
    mappingsCopied = mapIns.length;
  });

  return { cloned: true, configCopied, mappingsCopied };
}

// ============================================================
// 文本抽取入库（WS3）
// ============================================================

/** 抽取字段映射：camelCase 键（=zod schema 键）→ snake_case 列 + 是否数组 */
interface FieldSpec { key: string; col: string; array?: boolean }

export const EXTRACT_INSERT_FIELDS: Record<WorldEntityType, FieldSpec[]> = {
  characters: [
    { key: 'faction', col: 'faction' }, { key: 'realm', col: 'realm' },
    { key: 'combatType', col: 'combat_type' }, { key: 'personality', col: 'personality' },
    { key: 'allTitles', col: 'all_titles', array: true }, { key: 'coreSkills', col: 'core_skills', array: true },
    { key: 'growthLine', col: 'growth_line', array: true }, { key: 'plotTags', col: 'plot_tags', array: true },
  ],
  factions: [
    { key: 'camp', col: 'camp' }, { key: 'headquarters', col: 'headquarters' },
    { key: 'leader', col: 'leader' }, { key: 'townTreasure', col: 'town_treasure' },
    { key: 'cultivationFeature', col: 'cultivation_feature' }, { key: 'forceRelations', col: 'force_relations', array: true },
  ],
  locations: [
    { key: 'level', col: 'level' }, { key: 'parentRegion', col: 'parent_region' },
    { key: 'relatedFaction', col: 'related_faction' }, { key: 'environment', col: 'environment' },
    { key: 'dangerLevel', col: 'danger_level' }, { key: 'specialFunctions', col: 'special_functions' },
    { key: 'keyEvents', col: 'key_events', array: true },
  ],
  skills: [
    { key: 'grade', col: 'grade' }, { key: 'faction', col: 'faction' },
    { key: 'skillType', col: 'skill_type' }, { key: 'threshold', col: 'threshold' },
    { key: 'coreEffect', col: 'core_effect' }, { key: 'counter', col: 'counter' },
    { key: 'famousUsage', col: 'famous_usage', array: true },
  ],
  items: [
    { key: 'grade', col: 'grade' }, { key: 'system', col: 'system' },
    { key: 'appearance', col: 'appearance' }, { key: 'coreAbilities', col: 'core_abilities' },
    { key: 'useLimit', col: 'use_limit' }, { key: 'evolution', col: 'evolution' },
    { key: 'owners', col: 'owners', array: true }, { key: 'relatedPlots', col: 'related_plots', array: true },
  ],
  monsters: [
    { key: 'level', col: 'level' }, { key: 'race', col: 'race' },
    { key: 'habitat', col: 'habitat' }, { key: 'combatLevel', col: 'combat_level' },
    { key: 'relatedPlot', col: 'related_plot' }, { key: 'coreAbilities', col: 'core_abilities', array: true },
  ],
  materials: [
    { key: 'itemType', col: 'item_type' }, { key: 'grade', col: 'grade' },
    { key: 'coreEffect', col: 'core_effect' }, { key: 'sideEffect', col: 'side_effect' },
    { key: 'origin', col: 'origin' }, { key: 'usageScene', col: 'usage_scene', array: true },
  ],
  daily: [
    { key: 'itemType', col: 'item_type' }, { key: 'grade', col: 'grade' },
    { key: 'relatedFaction', col: 'related_faction' }, { key: 'appearance', col: 'appearance' },
    { key: 'material', col: 'material' }, { key: 'usageScene', col: 'usage_scene', array: true },
    { key: 'emotionalTag', col: 'emotional_tag', array: true },
  ],
};

export interface ExtractInsertResult {
  created: number;
  skippedDuplicate: number;
  failed: number;
  byType: Partial<Record<WorldEntityType, TypeStat>>;
  errors: { type: WorldEntityType; name: string; error: string }[];
}

/**
 * 将 LLM 抽取结果写入目标书（逐条 INSERT，同名去重）。
 * @param result 抽取结果（键为 WorldEntityType，值为实体数组）
 */
export async function insertExtractedEntities(
  bookId: number,
  result: Record<string, any[]>,
  opts?: { skipDuplicates?: boolean }
): Promise<ExtractInsertResult> {
  const skipDuplicates = opts?.skipDuplicates !== false;
  const out: ExtractInsertResult = { created: 0, skippedDuplicate: 0, failed: 0, byType: {}, errors: [] };

  for (const type of Object.keys(ENTITY_TABLES) as WorldEntityType[]) {
    const entities = result[type];
    if (!Array.isArray(entities) || !entities.length) continue;
    const table = ENTITY_TABLES[type];
    const fields = EXTRACT_INSERT_FIELDS[type];
    const stat: TypeStat = { created: 0, skipped: 0, failed: 0 };
    out.byType[type] = stat;

    // 目标书已有名（去重用）
    const existRows = await zhuxianClient.unsafe(
      `SELECT name FROM ${table} WHERE book_id = $1 AND is_deleted = false`, [bookId]
    );
    const existNames = new Set(existRows.map((r: any) => r.name));

    for (const ent of entities) {
      const name = typeof ent?.name === 'string' ? ent.name.trim() : '';
      if (!name) { stat.failed++; out.failed++; out.errors.push({ type, name: '(无名)', error: '缺少名称' }); continue; }
      if (skipDuplicates && existNames.has(name)) { stat.skipped++; out.skippedDuplicate++; continue; }

      // 组装列与参数（created_at 用 SQL now()，避免 postgres-js 拒绝 Date 参数）
      const cols: string[] = ['name', 'book_id', 'source', 'is_deleted', 'version'];
      const vals: any[] = [name, bookId, 'text-extract', false, 1];
      for (const f of fields) {
        const v = ent[f.key];
        if (v === undefined || v === null || v === '') continue;
        if (f.array) {
          if (Array.isArray(v) && v.length) { cols.push(f.col); vals.push(v); }
        } else {
          cols.push(f.col); vals.push(String(v));
        }
      }
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
      try {
        await zhuxianClient.unsafe(
          `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}, "created_at") VALUES (${placeholders}, now())`,
          vals
        );
        existNames.add(name);
        stat.created++; out.created++;
      } catch (e: any) {
        stat.failed++; out.failed++;
        out.errors.push({ type, name, error: e.message });
      }
    }
  }
  return out;
}
