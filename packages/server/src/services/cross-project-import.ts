/**
 * 跨项目引入通用服务
 *
 * 众生百态/铸器天工/道法自然三模块共用：从「其他项目」的同表实体复制进「当前项目」。
 * 与世界观跨书引入（world-batch-pipeline.importFromBook）的区别：
 *   - 同库（creativeDb）同表复制，无需跨库字段映射；
 *   - 整行原样复制（含 LLM 生成内容：人物小传/判词、法宝 generatedTraits、功法 moves 等），
 *     仅改 projectId/sourceRef，重置 id/createdAt/updatedAt，清空 linkedCharacterIds（若有该列）；
 *   - 去重按 name（与世界观引入一致），默认跳过目标项目同名实体；
 *   - 不写 entity_import_log（该表属诛仙库），轻量返回结果即可。
 *
 * 用 Drizzle getTableColumns 动态适配三表列差异，避免硬编码列名。
 */
import { and, eq, getTableColumns, inArray } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';

export type ImportableTable =
  | typeof schema.customCharacter
  | typeof schema.customWeapon
  | typeof schema.customTechnique;

export interface ProjectImportResult {
  created: number;
  skippedDuplicate: number;
  failed: number;
  errors: { id: number; name: string; error: string }[];
}

/** 复制时由代码显式接管、不从源行直接搬运的字段 */
const OVERRIDDEN = new Set(['id', 'projectId', 'sourceRef', 'isDeleted', 'createdAt', 'updatedAt']);

/** 源项目某表可引入实体清单（id 为真实正数，内部口径，不走人物负数约定） */
export async function listProjectEntities(
  table: ImportableTable,
  projectId: number
): Promise<{ id: number; name: string }[]> {
  const rows = await creativeDb
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(and(eq(table.projectId, projectId), eq(table.isDeleted, false)))
    .orderBy(table.id);
  return rows.map((r: any) => ({ id: Number(r.id), name: r.name }));
}

/**
 * 从 sourceProjectId 复制指定 ids 的实体到 targetProjectId。
 * @param sourceRefType 来源标记类型，如 project_character / project_weapon / project_technique
 */
export async function importFromProject(opts: {
  table: ImportableTable;
  sourceProjectId: number;
  targetProjectId: number;
  ids: number[];
  skipDuplicates?: boolean;
  sourceRefType: string;
}): Promise<ProjectImportResult> {
  const { table, sourceProjectId, targetProjectId, ids, sourceRefType } = opts;
  const skipDuplicates = opts.skipDuplicates !== false;
  const out: ProjectImportResult = { created: 0, skippedDuplicate: 0, failed: 0, errors: [] };

  if (sourceProjectId === targetProjectId) throw new Error('源项目与目标项目不能相同');
  if (!ids.length) return out;

  const cols = getTableColumns(table) as Record<string, any>;
  const hasLinked = 'linkedCharacterIds' in cols;

  // 源行（仅取本项目、未删除）
  const srcRows = await creativeDb
    .select()
    .from(table)
    .where(
      and(eq(table.projectId, sourceProjectId), eq(table.isDeleted, false), inArray(table.id, ids))
    );

  // 目标项目已有名（去重用）
  const existRows = await creativeDb
    .select({ name: table.name })
    .from(table)
    .where(and(eq(table.projectId, targetProjectId), eq(table.isDeleted, false)));
  const existNames = new Set(existRows.map((r: any) => r.name));

  for (const src of srcRows as any[]) {
    const name = String(src.name ?? '').trim();
    try {
      if (skipDuplicates && existNames.has(name)) {
        out.skippedDuplicate++;
        continue;
      }
      // 组装插入对象：搬运非接管字段，显式覆盖 projectId/sourceRef/isDeleted，清空关联
      const values: Record<string, unknown> = {};
      for (const [key, col] of Object.entries(cols)) {
        if (OVERRIDDEN.has(key)) continue;
        if (key === 'linkedCharacterIds') continue;
        values[key] = src[key];
      }
      values.projectId = targetProjectId;
      values.isDeleted = false;
      values.sourceRef = { type: sourceRefType, id: Number(src.id), name, projectId: sourceProjectId };
      if (hasLinked) values.linkedCharacterIds = [];

      await creativeDb.insert(table).values(values as any);
      existNames.add(name);
      out.created++;
    } catch (e: any) {
      out.failed++;
      out.errors.push({ id: Number(src.id), name, error: e.message });
    }
  }
  return out;
}
