/**
 * 对标素材服务（开源借鉴 PRD v1.1 M5 / US-03，拆文体系第一步）
 * - plot_material_benchmark 表走原生 SQL（与 plot_material_* 四表同模式）
 * - 召回降级链：pinned > 语义 > 关键字；任何异常返回空（无对标不阻塞写作）
 * - 拆文 agent：LLM 逐段拆解对标书文本为 角色卡/剧情单元/文风分析/设定
 */
import { creativeClient } from '../db/index.js';
import { embedQuery } from '../rag/plot-material-retriever.js';
import { chatJson } from '../hotspot/llm.js';

export const BENCHMARK_TYPES = ['character', 'plot_unit', 'style', 'setting'] as const;
export type BenchmarkType = (typeof BENCHMARK_TYPES)[number];

export interface BenchmarkMaterialRow {
  id: number;
  project_id: number;
  source_book_title: string;
  material_type: string;
  title: string;
  content_md: string;
  tags: string[];
  pinned: boolean;
  created_at: string;
}

export interface BenchmarkMaterialInput {
  sourceBookTitle: string;
  materialType: string;
  title: string;
  contentMd: string;
  tags?: string[];
  pinned?: boolean;
}

/** 生成 embedding（失败返回 null，不阻断入库） */
async function tryEmbed(text: string): Promise<string | null> {
  try {
    const vec = await embedQuery(text.slice(0, 500));
    if (!vec?.length) return null;
    return `[${vec.join(',')}]`;
  } catch {
    return null;
  }
}

export async function listBenchmarkMaterials(projectId: number): Promise<BenchmarkMaterialRow[]> {
  return creativeClient.unsafe(
    `SELECT id, project_id, source_book_title, material_type, title, content_md, tags, pinned, created_at
     FROM plot_material_benchmark
     WHERE project_id = $1 AND is_deleted = false
     ORDER BY pinned DESC, id DESC`,
    [projectId],
  ) as unknown as BenchmarkMaterialRow[];
}

export async function insertBenchmarkMaterial(projectId: number, input: BenchmarkMaterialInput): Promise<number> {
  const vec = await tryEmbed(`${input.title} ${input.contentMd}`);
  const rows = await creativeClient.unsafe(
    `INSERT INTO plot_material_benchmark
       (project_id, source_book_title, material_type, title, content_md, tags, pinned, embedding)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, ${vec ? `$8::vector` : 'NULL'})
     RETURNING id`,
    vec
      ? [projectId, input.sourceBookTitle, input.materialType, input.title, input.contentMd, JSON.stringify(input.tags ?? []), input.pinned ?? false, vec]
      : [projectId, input.sourceBookTitle, input.materialType, input.title, input.contentMd, JSON.stringify(input.tags ?? []), input.pinned ?? false],
  ) as unknown as { id: number }[];
  return rows[0].id;
}

export async function deleteBenchmarkMaterial(projectId: number, id: number): Promise<boolean> {
  const rows = await creativeClient.unsafe(
    `UPDATE plot_material_benchmark SET is_deleted = true, updated_at = now()
     WHERE id = $1 AND project_id = $2 AND is_deleted = false RETURNING id`,
    [id, projectId],
  );
  return (rows as unknown as any[]).length > 0;
}

export async function toggleBenchmarkPin(projectId: number, id: number, pinned: boolean): Promise<boolean> {
  const rows = await creativeClient.unsafe(
    `UPDATE plot_material_benchmark SET pinned = $3, updated_at = now()
     WHERE id = $1 AND project_id = $2 AND is_deleted = false RETURNING id`,
    [id, projectId, pinned],
  );
  return (rows as unknown as any[]).length > 0;
}

/**
 * 对标素材召回（context-builder 使用）：pinned 优先，语义补足，关键字兜底。
 * 任何异常返回空数组——无对标/服务不可用均不阻塞写作（PRD 降级红线）。
 */
export async function retrieveBenchmarkMaterials(
  projectId: number,
  queryText: string,
  topN = 3,
): Promise<BenchmarkMaterialRow[]> {
  try {
    const pinned = await creativeClient.unsafe(
      `SELECT id, project_id, source_book_title, material_type, title, content_md, tags, pinned, created_at
       FROM plot_material_benchmark
       WHERE project_id = $1 AND is_deleted = false AND pinned = true
       ORDER BY id DESC LIMIT $2`,
      [projectId, topN],
    ) as unknown as BenchmarkMaterialRow[];
    if (pinned.length >= topN) return pinned.slice(0, topN);

    const pinnedIds = pinned.map((p) => p.id);
    const exclude = pinnedIds.length ? `AND id NOT IN (${pinnedIds.join(',')})` : '';
    const rest = topN - pinned.length;

    // 语义召回（embedding 服务不可用/无向量则抛错进关键字兜底）
    if (queryText.trim()) {
      try {
        const vec = await embedQuery(queryText);
        const semantic = await creativeClient.unsafe(
          `SELECT id, project_id, source_book_title, material_type, title, content_md, tags, pinned, created_at
           FROM plot_material_benchmark
           WHERE project_id = $1 AND is_deleted = false AND embedding IS NOT NULL ${exclude}
           ORDER BY embedding <=> $2::vector LIMIT $3`,
          [projectId, `[${vec.join(',')}]`, rest],
        ) as unknown as BenchmarkMaterialRow[];
        if (semantic.length) return [...pinned, ...semantic];
      } catch {
        // 降级到关键字
      }
      // 关键字兜底：标题/正文命中查询词
      const kw = queryText.split(/[\s。；，、]+/).filter((w) => w.length >= 2).slice(0, 3);
      if (kw.length) {
        // postgres-js unsafe 用 $n 占位符，动态拼接
        const conditions = kw.map((_, i) => `(title ILIKE '%' || $${i + 3} || '%' OR content_md ILIKE '%' || $${i + 3} || '%')`);
        const rows = await creativeClient.unsafe(
          `SELECT id, project_id, source_book_title, material_type, title, content_md, tags, pinned, created_at
           FROM plot_material_benchmark
           WHERE project_id = $1 AND is_deleted = false ${exclude} AND (${conditions.join(' OR ')})
           ORDER BY id DESC LIMIT $2`,
          [projectId, rest, ...kw],
        ) as unknown as BenchmarkMaterialRow[];
        return [...pinned, ...rows];
      }
    }
    return pinned;
  } catch (e) {
    console.warn('[benchmark] 对标素材召回失败（降级为空）:', (e as Error)?.message || e);
    return [];
  }
}

/**
 * 拆文 agent：LLM 拆解对标书文本，产出结构化素材清单。
 * 角色卡必须含 role/personality/motivation/arc 四要素（PRD §7.3 验收）。
 */
export async function analyzeBenchmarkText(sourceBookTitle: string, text: string): Promise<BenchmarkMaterialInput[]> {
  const system = `你是资深网文拆书分析师。请把给定的对标书文本拆解为结构化素材资产，输出 JSON 数组，每项字段：
- type: character | plot_unit | style | setting 四选一
- title: 简短标题（人物名/剧情单元名/文风要点/设定名）
- content_md: markdown 详情。type=character 时必须含四要素：role（定位）、personality（性格）、motivation（动机）、arc（成长弧）；type=plot_unit 时写清冲突-转折-情绪曲线；type=style 时给可复刻的句式/节奏/视角特征；type=setting 时写设定规则与限制。
- tags: 字符串数组（2-6 个）
只输出 JSON 数组，不要解释。`;
  const user = `对标书：《${sourceBookTitle}》\n\n待拆解文本：\n${text.slice(0, 24000)}`;
  const parsed = await chatJson(system, user, 1, 1);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr
    .filter((m: any) => m && typeof m.title === 'string' && typeof m.content_md === 'string')
    .map((m: any) => ({
      sourceBookTitle,
      materialType: BENCHMARK_TYPES.includes(m.type) ? m.type : 'plot_unit',
      title: String(m.title).slice(0, 200),
      contentMd: String(m.content_md),
      tags: Array.isArray(m.tags) ? m.tags.map((t: any) => String(t)).slice(0, 6) : [],
      pinned: false,
    }));
}
