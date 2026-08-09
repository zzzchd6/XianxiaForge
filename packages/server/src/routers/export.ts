/**
 * 项目导出/导入（架构升级 Epic5）
 * GET  /projects/:pid/export — 导出全项目数据为 zip
 * POST /projects/import      — 上传 zip 还原为新项目（事务 + ID 重映射）
 *
 * 说明：
 * - hotspot_* / generation_task / generation_log / pipeline_checkpoint /
 *   style_audit_record / scene_edit_log 不参与导出。
 * - technique_atom 为全局表（无 project_id），仅导出本项目 chapter_technique_map
 *   引用到的原子；impact_definition 仅导出归属本项目的行（projectId 为空的全局预设不导出）。
 * - 人物ID遵循「负数约定」：正数=诛仙库人物（全局保留原值），负数=自定义人物
 *   （绝对值对应 custom_character.id），导入时按映射重映射。
 */
import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import JSZip from 'jszip';
import { creativeDb } from '../db/index.js';
import {
  creativeProject,
  authorRules,
  storyOutline,
  chapterPlan,
  generatedChapter,
  sceneNode,
  sceneNodeCharacter,
  sceneNodeElement,
  sceneNodeRelation,
  customWeapon,
  weaponLore,
  customTechnique,
  techniqueAtom,
  chapterTechniqueMap,
  customSkillLib,
  customMagicItemLib,
  entityGrowthRecord,
  customMap,
  customLocation,
  customLocationLink,
  impactDefinition,
  infoPoint,
  treasureItem,
  treasureHuntRecord,
  customCharacter,
  customCharacterRelation,
  characterVoiceConfig,
  characterKnowledge,
  characterMemoryCard,
  characterGrowthStage,
  characterTechniqueVariant,
  characterMartialLore,
  characterStateSnapshot,
  foreshadowThread,
  causalChain,
  taskArc,
  timelineMilestone,
  chapterBranchOption,
  characterImpactSnapshot,
  worldImpactSnapshot,
  branchImpactLink,
  impactHistory,
  relationImpactSnapshot,
  projectQuoteLib,
} from '../db/creative-schema.js';

const app = new Hono();

type IdMap = Map<number, number>;
type Row = Record<string, any>;

/** 文件名清洗（去除 Windows 非法字符） */
const safeName = (s: string, fallback = '未命名') =>
  (s ?? '').toString().replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60) || fallback;

/** 人物ID重映射（负数约定）：映射不到时保留原值（诛仙库人物为全局ID） */
function tryRemapChar(v: any, map: IdMap): number | undefined {
  if (typeof v !== 'number') return undefined;
  if (v < 0) {
    const n = map.get(-v);
    return n != null ? -n : undefined;
  }
  const n = map.get(v);
  return n != null ? n : undefined;
}
function remapChar(v: any, map: IdMap): any {
  if (v == null) return null;
  const n = tryRemapChar(v, map);
  return n !== undefined ? n : v;
}

// ============================================================
// 导出
// ============================================================

/** 生成自定义人物档案 markdown */
function renderCharacterProfile(ch: Row): string {
  const arr = (v: any) => (Array.isArray(v) ? v.join('、') : '');
  return [
    `# ${ch.name ?? ''} 档案`,
    '',
    '## 基本信息',
    `- 姓名：${ch.name ?? ''}`,
    `- 道号：${ch.daoTitle ?? ''}`,
    `- 性别：${ch.gender ?? ''}`,
    `- 种族：${ch.raceCategory ?? ''} / ${ch.raceSub ?? ''}`,
    `- 实力定位：${ch.position ?? ''}${ch.fakePosition ? `（伪装定位：${ch.fakePosition}）` : ''}`,
    `- 立场值：${ch.stance ?? ''}`,
    '',
    '## 性格',
    `- 内在性格：${ch.innerPersonality ?? ''}`,
    `- 外在性格标签：${arr(ch.outerPersonality)}`,
    `- 人物判词：${ch.verdictPoem ?? ''}`,
    `- 人物考语：${ch.verdictComment ?? ''}`,
    '',
    '## 天赋与特质',
    `- 天赋：${arr(ch.talents)}`,
    `- 种族擅长：${arr(ch.strengths)}`,
    `- 种族短板：${arr(ch.weaknesses)}`,
    '',
    '## 人物小传',
    ch.description ?? '',
    '',
    '## 套装大招',
    ch.comboAbility ?? '',
    '',
  ].join('\n');
}

/** 生成大纲清单 markdown（按卷号/章节号排序） */
function renderOutlineMd(plans: Row[]): string {
  const sorted = [...plans].sort(
    (a, b) => (a.volumeNo ?? 0) - (b.volumeNo ?? 0) || (a.chapterNo ?? 0) - (b.chapterNo ?? 0),
  );
  const lines: string[] = ['# 章节大纲', ''];
  let curVolume: number | null = null;
  for (const p of sorted) {
    if (p.volumeNo !== curVolume) {
      curVolume = p.volumeNo;
      lines.push(`## 第${curVolume ?? 0}卷`, '');
    }
    const digest = ((p.intent ?? '') as string).replace(/\s+/g, ' ').slice(0, 120);
    lines.push(`- 第${p.chapterNo ?? 0}章 《${p.title ?? ''}》${digest ? `：${digest}` : ''}`);
  }
  return lines.join('\n');
}

// 注意：不可用 /projects/:pid/export —— 该路径已被 chapters.ts 的整书 txt/md 导出占用（Hono 按注册顺序匹配）
app.get('/projects/:pid/export-package', async (c) => {
  try {
    const pid = Number(c.req.param('pid'));
    if (!Number.isFinite(pid)) return c.json({ success: false, error: '无效的项目ID' }, 400);
    const [project] = await creativeDb
      .select()
      .from(creativeProject)
      .where(eq(creativeProject.id, pid));
    if (!project) return c.json({ success: false, error: '项目不存在' }, 404);

    // ===== 第一批：直接按 projectId 查询（容错：表不存在/列漂移时按空数据处理，不阻断整包） =====
    const safe = <T,>(p: Promise<T[]>): Promise<T[]> =>
      p.catch((e: any) => { console.warn(`[export] 查询跳过（表/列可能不存在）: ${e?.message}`); return [] as T[]; });
    const [
      rules, outlines, plans, chaptersAll, sceneNodes,
      weapons, weaponLores, techniques, techMaps, skillLibs, magicItemLibs,
      growthRecords, maps, locations, locationLinks, impactDefs, infoPoints,
      treasureItems, huntRecords, characters, charRelations, voiceConfigs,
      knowledgeRows, memoryCards, growthStages, techVariants, martialLores,
      stateSnapshots, foreshadows, causalChains, taskArcs, milestones,
      branchOptions, charImpactSnaps, worldImpactSnaps,
      impactHistoryRows, relationImpactSnaps, quoteRows,
    ] = await Promise.all([
      safe(creativeDb.select().from(authorRules).where(eq(authorRules.projectId, pid))),
      safe(creativeDb.select().from(storyOutline).where(eq(storyOutline.projectId, pid))),
      safe(creativeDb.select().from(chapterPlan).where(eq(chapterPlan.projectId, pid))),
      safe(creativeDb.select().from(generatedChapter).where(eq(generatedChapter.projectId, pid))),
      safe(creativeDb.select().from(sceneNode).where(eq(sceneNode.projectId, pid))),
      safe(creativeDb.select().from(customWeapon).where(eq(customWeapon.projectId, pid))),
      safe(creativeDb.select().from(weaponLore).where(eq(weaponLore.projectId, pid))),
      safe(creativeDb.select().from(customTechnique).where(eq(customTechnique.projectId, pid))),
      safe(creativeDb.select().from(chapterTechniqueMap).where(eq(chapterTechniqueMap.projectId, pid))),
      safe(creativeDb.select().from(customSkillLib).where(eq(customSkillLib.projectId, pid))),
      safe(creativeDb.select().from(customMagicItemLib).where(eq(customMagicItemLib.projectId, pid))),
      safe(creativeDb.select().from(entityGrowthRecord).where(eq(entityGrowthRecord.projectId, pid))),
      safe(creativeDb.select().from(customMap).where(eq(customMap.projectId, pid))),
      safe(creativeDb.select().from(customLocation).where(eq(customLocation.projectId, pid))),
      safe(creativeDb.select().from(customLocationLink).where(eq(customLocationLink.projectId, pid))),
      safe(creativeDb.select().from(impactDefinition).where(eq(impactDefinition.projectId, pid))),
      safe(creativeDb.select().from(infoPoint).where(eq(infoPoint.projectId, pid))),
      safe(creativeDb.select().from(treasureItem).where(eq(treasureItem.projectId, pid))),
      safe(creativeDb.select().from(treasureHuntRecord).where(eq(treasureHuntRecord.projectId, pid))),
      safe(creativeDb.select().from(customCharacter).where(eq(customCharacter.projectId, pid))),
      safe(creativeDb.select().from(customCharacterRelation).where(eq(customCharacterRelation.projectId, pid))),
      safe(creativeDb.select().from(characterVoiceConfig).where(eq(characterVoiceConfig.projectId, pid))),
      safe(creativeDb.select().from(characterKnowledge).where(eq(characterKnowledge.projectId, pid))),
      safe(creativeDb.select().from(characterMemoryCard).where(eq(characterMemoryCard.projectId, pid))),
      safe(creativeDb.select().from(characterGrowthStage).where(eq(characterGrowthStage.projectId, pid))),
      safe(creativeDb.select().from(characterTechniqueVariant).where(eq(characterTechniqueVariant.projectId, pid))),
      safe(creativeDb.select().from(characterMartialLore).where(eq(characterMartialLore.projectId, pid))),
      safe(creativeDb.select().from(characterStateSnapshot).where(eq(characterStateSnapshot.projectId, pid))),
      safe(creativeDb.select().from(foreshadowThread).where(eq(foreshadowThread.projectId, pid))),
      safe(creativeDb.select().from(causalChain).where(eq(causalChain.projectId, pid))),
      safe(creativeDb.select().from(taskArc).where(eq(taskArc.projectId, pid))),
      safe(creativeDb.select().from(timelineMilestone).where(eq(timelineMilestone.projectId, pid))),
      safe(creativeDb.select().from(chapterBranchOption).where(eq(chapterBranchOption.projectId, pid))),
      safe(creativeDb.select().from(characterImpactSnapshot).where(eq(characterImpactSnapshot.projectId, pid))),
      safe(creativeDb.select().from(worldImpactSnapshot).where(eq(worldImpactSnapshot.projectId, pid))),
      safe(creativeDb.select().from(impactHistory).where(eq(impactHistory.projectId, pid))),
      safe(creativeDb.select().from(relationImpactSnapshot).where(eq(relationImpactSnapshot.projectId, pid))),
      safe(creativeDb.select().from(projectQuoteLib).where(eq(projectQuoteLib.projectId, pid))),
    ]);

    // ===== 第二批：依赖第一批结果的关联查询（同样容错） =====
    const nodeIds = sceneNodes.map((n) => n.id);
    const branchOptionIds = branchOptions.map((r) => r.id);
    const [[sceneChars, sceneElements, sceneRelations], branchImpactLinksRows] = await Promise.all([
      nodeIds.length
        ? Promise.all([
            safe(creativeDb.select().from(sceneNodeCharacter).where(inArray(sceneNodeCharacter.sceneNodeId, nodeIds))),
            safe(creativeDb.select().from(sceneNodeElement).where(inArray(sceneNodeElement.sceneNodeId, nodeIds))),
            safe(creativeDb.select().from(sceneNodeRelation).where(inArray(sceneNodeRelation.sourceNodeId, nodeIds))),
          ])
        : Promise.resolve([[], [], []]),
      branchOptionIds.length
        ? safe(creativeDb.select().from(branchImpactLink).where(inArray(branchImpactLink.branchOptionId, branchOptionIds)))
        : Promise.resolve([]),
    ]);

    // 叙事技法原子为全局表：仅导出本项目引用到的原子
    const atomIds = [...new Set(techMaps.map((r) => r.techniqueId))];
    const atoms = atomIds.length
      ? await safe(creativeDb.select().from(techniqueAtom).where(inArray(techniqueAtom.techniqueId, atomIds)))
      : [];

    // ===== 组装 zip =====
    const zip = new JSZip();
    const put = (path: string, data: any) => zip.file(path, JSON.stringify(data, null, 2));

    put('project.json', { project, authorRules: rules });

    const world: Record<string, Row[]> = {
      customWeapon: weapons as Row[],
      weaponLore: weaponLores as Row[],
      customTechnique: techniques as Row[],
      techniqueAtom: atoms as Row[],
      chapterTechniqueMap: techMaps as Row[],
      customSkillLib: skillLibs as Row[],
      customMagicItemLib: magicItemLibs as Row[],
      entityGrowthRecord: growthRecords as Row[],
      customMap: maps as Row[],
      customLocation: locations as Row[],
      customLocationLink: locationLinks as Row[],
      impactDefinition: impactDefs as Row[],
      infoPoint: infoPoints as Row[],
      treasureItem: treasureItems as Row[],
      treasureHuntRecord: huntRecords as Row[],
    };
    for (const [name, rows] of Object.entries(world)) put(`world/${name}.json`, rows);

    const chars: Record<string, Row[]> = {
      customCharacter: characters as Row[],
      customCharacterRelation: charRelations as Row[],
      characterVoiceConfig: voiceConfigs as Row[],
      characterKnowledge: knowledgeRows as Row[],
      characterMemoryCard: memoryCards as Row[],
      characterGrowthStage: growthStages as Row[],
      characterTechniqueVariant: techVariants as Row[],
      characterMartialLore: martialLores as Row[],
      characterStateSnapshot: stateSnapshots as Row[],
    };
    for (const [name, rows] of Object.entries(chars)) put(`characters/${name}.json`, rows);
    for (const ch of characters as Row[]) {
      zip.file(`characters/profiles/${safeName(ch.name)}-档案.md`, renderCharacterProfile(ch));
    }

    const outlineFiles: Record<string, Row[]> = {
      storyOutline: outlines as Row[],
      chapterPlan: plans as Row[],
      sceneNode: sceneNodes as Row[],
      sceneNodeCharacter: sceneChars as Row[],
      sceneNodeElement: sceneElements as Row[],
      sceneNodeRelation: sceneRelations as Row[],
    };
    for (const [name, rows] of Object.entries(outlineFiles)) put(`outlines/${name}.json`, rows);
    zip.file('outlines/大纲.md', renderOutlineMd(plans as Row[]));

    // 章节：仅 isCurrent 版本导出为 markdown，全部版本元数据（含正文）进 _meta.json 保证可导入
    const currentChapters = (chaptersAll as Row[]).filter((ch) => ch.isCurrent);
    for (const ch of currentChapters) {
      const header = [
        '---',
        `卷号: ${ch.volumeNo ?? ''}`,
        `章号: ${ch.chapterNo ?? ''}`,
        `字数: ${ch.wordCount ?? ''}`,
        '---',
        '',
      ].join('\n');
      const fileName = `chapters/第${String(ch.chapterNo ?? 0).padStart(2, '0')}章-${safeName(ch.title)}.md`;
      zip.file(fileName, `${header}${ch.content ?? ''}`);
    }
    put('chapters/_meta.json', chaptersAll);

    const states: Record<string, Row[]> = {
      foreshadowThread: foreshadows as Row[],
      causalChain: causalChains as Row[],
      taskArc: taskArcs as Row[],
      timelineMilestone: milestones as Row[],
      chapterBranchOption: branchOptions as Row[],
      characterImpactSnapshot: charImpactSnaps as Row[],
      worldImpactSnapshot: worldImpactSnaps as Row[],
      branchImpactLink: branchImpactLinksRows as Row[],
      impactHistory: impactHistoryRows as Row[],
      relationImpactSnapshot: relationImpactSnaps as Row[],
      projectQuoteLib: quoteRows as Row[],
    };
    for (const [name, rows] of Object.entries(states)) put(`state/${name}.json`, rows);

    const tableCounts: Record<string, number> = {
      creativeProject: 1, authorRules: rules.length,
      ...Object.fromEntries(Object.entries(world).map(([k, v]) => [k, v.length])),
      ...Object.fromEntries(Object.entries(chars).map(([k, v]) => [k, v.length])),
      ...Object.fromEntries(Object.entries(outlineFiles).map(([k, v]) => [k, v.length])),
      generatedChapter: chaptersAll.length,
      ...Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v.length])),
    };
    put('manifest.json', {
      format: 'novel-studio-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      projectTitle: project.title,
      tableCounts,
    });

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="project-${pid}-export.zip"`,
      },
    });
  } catch (error: any) {
    console.error('[Export] 导出失败:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================
// 导入
// ============================================================

/** 去掉 id/createdAt/updatedAt，返回可插入的其余字段 */
function strip(row: Row): Row {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row;
  return rest;
}

/** 按插入顺序建立 oldId→newId 映射 */
function buildMap(oldRows: Row[], newRows: Row[]): IdMap {
  const m: IdMap = new Map();
  oldRows.forEach((r, i) => {
    if (newRows[i]) m.set(r.id, newRows[i].id);
  });
  return m;
}

/** 批量插入并返回插入结果（空数组直接返回 []） */
async function insertAll(tx: any, table: any, rows: Row[]): Promise<Row[]> {
  if (!rows.length) return [];
  return tx.insert(table).values(rows as any).returning();
}

app.post('/projects/import', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file || typeof (file as any).arrayBuffer !== 'function') {
      return c.json({ success: false, error: '缺少上传文件（字段名 file）' }, 400);
    }
    const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));

    const readJson = async (path: string): Promise<any> => {
      const f = zip.file(path);
      if (!f) return null;
      // 还原时间戳：导出时 JSON.stringify 把 Date 序列化为 ISO 字符串，
      // drizzle 的 timestamp 列插入需要 Date 对象（否则 toISOString 报错）
      return JSON.parse(await f.async('string'), (_k, v) =>
        typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(v)
          ? new Date(v)
          : v
      );
    };

    const manifest = await readJson('manifest.json');
    if (!manifest || manifest.format !== 'novel-studio-export') {
      return c.json({ success: false, error: '无效的导出包：manifest 格式不符' }, 400);
    }

    const projectData = (await readJson('project.json')) ?? {};
    const srcProject: Row | null = projectData.project ?? null;
    if (!srcProject) return c.json({ success: false, error: '导出包缺少项目数据' }, 400);

    const w = async (name: string): Promise<Row[]> => (await readJson(`world/${name}.json`)) ?? [];
    const ch = async (name: string): Promise<Row[]> => (await readJson(`characters/${name}.json`)) ?? [];
    const ol = async (name: string): Promise<Row[]> => (await readJson(`outlines/${name}.json`)) ?? [];
    const st = async (name: string): Promise<Row[]> => (await readJson(`state/${name}.json`)) ?? [];

    // 读入全部表数据
    const [
      srcRules,
      srcWeapons, srcWeaponLores, srcTechniques, srcAtoms, srcTechMaps,
      srcSkillLibs, srcMagicItemLibs, srcGrowthRecords, srcMaps, srcLocations,
      srcLocationLinks, srcImpactDefs, srcInfoPoints, srcTreasureItems, srcHuntRecords,
      srcCharacters, srcCharRelations, srcVoiceConfigs, srcKnowledge, srcMemoryCards,
      srcGrowthStages, srcTechVariants, srcMartialLores, srcStateSnapshots,
      srcOutlines, srcPlans, srcSceneNodes, srcSceneChars, srcSceneElements, srcSceneRelations,
      srcChapters,
      srcForeshadows, srcCausalChains, srcTaskArcs, srcMilestones, srcBranchOptions,
      srcCharImpactSnaps, srcWorldImpactSnaps, srcBranchImpactLinks, srcImpactHistory,
      srcRelationImpactSnaps, srcQuotes,
    ] = await Promise.all([
      readJson('project.json').then((d) => (d?.authorRules ?? []) as Row[]),
      w('customWeapon'), w('weaponLore'), w('customTechnique'), w('techniqueAtom'), w('chapterTechniqueMap'),
      w('customSkillLib'), w('customMagicItemLib'), w('entityGrowthRecord'), w('customMap'), w('customLocation'),
      w('customLocationLink'), w('impactDefinition'), w('infoPoint'), w('treasureItem'), w('treasureHuntRecord'),
      ch('customCharacter'), ch('customCharacterRelation'), ch('characterVoiceConfig'), ch('characterKnowledge'),
      ch('characterMemoryCard'), ch('characterGrowthStage'), ch('characterTechniqueVariant'),
      ch('characterMartialLore'), ch('characterStateSnapshot'),
      ol('storyOutline'), ol('chapterPlan'), ol('sceneNode'), ol('sceneNodeCharacter'),
      ol('sceneNodeElement'), ol('sceneNodeRelation'),
      readJson('chapters/_meta.json').then((d) => (Array.isArray(d) ? d : []) as Row[]),
      st('foreshadowThread'), st('causalChain'), st('taskArc'), st('timelineMilestone'), st('chapterBranchOption'),
      st('characterImpactSnapshot'), st('worldImpactSnapshot'), st('branchImpactLink'), st('impactHistory'),
      st('relationImpactSnapshot'), st('projectQuoteLib'),
    ]);

    const importedTables: Record<string, number> = {};
    const count = (name: string, n: number) => { if (n > 0) importedTables[name] = n; };

    const result = await creativeDb.transaction(async (tx) => {
      // ===== 1. 项目主体 =====
      const [newProj] = await tx
        .insert(creativeProject)
        .values({ ...strip(srcProject), title: `${srcProject.title}（导入）` } as any)
        .returning();
      const newProjectId: number = newProj.id;
      count('creativeProject', 1);

      // ===== 2. 作者规则 =====
      const insertedRules = await insertAll(
        tx, authorRules,
        srcRules.map((r) => ({ ...strip(r), projectId: newProjectId })),
      );
      count('authorRules', insertedRules.length);

      // ===== 3. 影响定义（impactKey 全局唯一：已存在则复用） =====
      const definitionMap: IdMap = new Map();
      let defInserted = 0;
      for (const r of srcImpactDefs as Row[]) {
        const existing = await tx
          .select({ id: impactDefinition.id })
          .from(impactDefinition)
          .where(eq(impactDefinition.impactKey, r.impactKey));
        if (existing.length) {
          definitionMap.set(r.id, existing[0].id);
          continue;
        }
        const inserted = await insertAll(tx, impactDefinition, [{ ...strip(r), projectId: newProjectId }]);
        if (inserted.length) { definitionMap.set(r.id, inserted[0].id); defInserted++; }
      }
      count('impactDefinition', defInserted);

      // ===== 4. 卷大纲 =====
      const newOutlines = await insertAll(
        tx, storyOutline,
        (srcOutlines as Row[]).map((r) => ({ ...strip(r), projectId: newProjectId })),
      );
      const outlineMap = buildMap(srcOutlines as Row[], newOutlines);
      count('storyOutline', newOutlines.length);

      // ===== 5. 仅依赖项目的实体表 =====
      const newCharacters = await insertAll(
        tx, customCharacter,
        (srcCharacters as Row[]).map((r) => ({ ...strip(r), projectId: newProjectId })),
      );
      const characterMap = buildMap(srcCharacters as Row[], newCharacters);
      count('customCharacter', newCharacters.length);

      const newWeapons = await insertAll(
        tx, customWeapon,
        (srcWeapons as Row[]).map((r) => ({
          ...strip(r), projectId: newProjectId,
          linkedCharacterIds: ((r.linkedCharacterIds ?? []) as any[]).map((x) => remapChar(x, characterMap)),
        })),
      );
      const weaponMap = buildMap(srcWeapons as Row[], newWeapons);
      count('customWeapon', newWeapons.length);

      const newTechniques = await insertAll(
        tx, customTechnique,
        (srcTechniques as Row[]).map((r) => ({
          ...strip(r), projectId: newProjectId,
          linkedCharacterIds: ((r.linkedCharacterIds ?? []) as any[]).map((x) => remapChar(x, characterMap)),
        })),
      );
      const techniqueMap = buildMap(srcTechniques as Row[], newTechniques);
      count('customTechnique', newTechniques.length);

      // 地图：先插入（parentMapId 置空），再二次更新父地图
      const mapPrepared = (srcMaps as Row[]).map((r) => ({ ...strip(r), projectId: newProjectId, parentMapId: null }));
      const newMaps = await insertAll(tx, customMap, mapPrepared);
      const mapMap = buildMap(srcMaps as Row[], newMaps);
      for (let i = 0; i < (srcMaps as Row[]).length; i++) {
        const oldParent = (srcMaps as Row[])[i].parentMapId;
        if (oldParent != null && mapMap.has(oldParent) && newMaps[i]) {
          await tx.update(customMap).set({ parentMapId: mapMap.get(oldParent)! }).where(eq(customMap.id, newMaps[i].id));
        }
      }
      count('customMap', newMaps.length);

      const newSkillLibs = await insertAll(
        tx, customSkillLib,
        (srcSkillLibs as Row[]).map((r) => ({
          ...strip(r), projectId: newProjectId,
          linkedCharacterIds: ((r.linkedCharacterIds ?? []) as any[]).map((x) => remapChar(x, characterMap)),
        })),
      );
      const skillMap = buildMap(srcSkillLibs as Row[], newSkillLibs);
      count('customSkillLib', newSkillLibs.length);

      const newMagicItemLibs = await insertAll(
        tx, customMagicItemLib,
        (srcMagicItemLibs as Row[]).map((r) => ({
          ...strip(r), projectId: newProjectId,
          linkedCharacterIds: ((r.linkedCharacterIds ?? []) as any[]).map((x) => remapChar(x, characterMap)),
        })),
      );
      const magicItemMap = buildMap(srcMagicItemLibs as Row[], newMagicItemLibs);
      count('customMagicItemLib', newMagicItemLibs.length);

      // 地点：先插入（parentLocationId 置空），再二次更新上级区域
      const locPrepared = (srcLocations as Row[])
        .filter((r) => r.mapId != null && mapMap.has(r.mapId))
        .map((r) => ({
          ...strip(r), projectId: newProjectId,
          mapId: mapMap.get(r.mapId)!,
          linkedMapId: r.linkedMapId != null ? mapMap.get(r.linkedMapId) ?? null : null,
          parentLocationId: null,
        }));
      const newLocations = await insertAll(tx, customLocation, locPrepared);
      const locationMap = buildMap(
        (srcLocations as Row[]).filter((r) => r.mapId != null && mapMap.has(r.mapId)),
        newLocations,
      );
      const locKept = (srcLocations as Row[]).filter((r) => r.mapId != null && mapMap.has(r.mapId));
      for (let i = 0; i < locKept.length; i++) {
        const oldParent = locKept[i].parentLocationId;
        if (oldParent != null && locationMap.has(oldParent) && newLocations[i]) {
          await tx.update(customLocation).set({ parentLocationId: locationMap.get(oldParent)! }).where(eq(customLocation.id, newLocations[i].id));
        }
      }
      count('customLocation', newLocations.length);

      const newHuntRecords = await insertAll(
        tx, treasureHuntRecord,
        (srcHuntRecords as Row[]).map((r) => ({ ...strip(r), projectId: newProjectId })),
      );
      const huntMap = buildMap(srcHuntRecords as Row[], newHuntRecords);
      count('treasureHuntRecord', newHuntRecords.length);

      // ===== 6. 章节计划（outlineId 重映射；branchSourceOptionId 延后回填） =====
      const planPrepared = (srcPlans as Row[]).map((r) => ({
        ...strip(r), projectId: newProjectId,
        outlineId: r.outlineId != null ? outlineMap.get(r.outlineId) ?? null : null,
        povCharacterIds: ((r.povCharacterIds ?? []) as any[]).map((x) => remapChar(x, characterMap)),
        branchSourceOptionId: null,
        branchParentChapterId: r.branchParentChapterId ?? null,
      }));
      const newPlans = await insertAll(tx, chapterPlan, planPrepared);
      const planMap = buildMap(srcPlans as Row[], newPlans);
      // branchParentChapterId 自引用二次更新
      for (let i = 0; i < (srcPlans as Row[]).length; i++) {
        const oldParent = (srcPlans as Row[])[i].branchParentChapterId;
        if (oldParent != null && planMap.has(oldParent) && newPlans[i]) {
          await tx.update(chapterPlan).set({ branchParentChapterId: planMap.get(oldParent)! }).where(eq(chapterPlan.id, newPlans[i].id));
        }
      }
      count('chapterPlan', newPlans.length);

      // ===== 7. 叙事技法原子（全局表，techniqueId 唯一：已存在跳过） =====
      if ((srcAtoms as Row[]).length) {
        const existingAtoms = await tx
          .select({ techniqueId: techniqueAtom.techniqueId })
          .from(techniqueAtom)
          .where(inArray(techniqueAtom.techniqueId, (srcAtoms as Row[]).map((a) => a.techniqueId)));
        const existingSet = new Set(existingAtoms.map((e) => e.techniqueId));
        const toInsert = (srcAtoms as Row[]).filter((a) => !existingSet.has(a.techniqueId)).map(strip);
        if (toInsert.length) await tx.insert(techniqueAtom).values(toInsert as any);
        count('techniqueAtom', toInsert.length);
      }

      const newTechMaps = await insertAll(
        tx, chapterTechniqueMap,
        (srcTechMaps as Row[])
          .filter((r) => r.chapterPlanId != null && planMap.has(r.chapterPlanId))
          .map((r) => ({ ...strip(r), projectId: newProjectId, chapterPlanId: planMap.get(r.chapterPlanId)! })),
      );
      count('chapterTechniqueMap', newTechMaps.length);

      const newInfoPoints = await insertAll(
        tx, infoPoint,
        (srcInfoPoints as Row[])
          .filter((r) => r.chapterPlanId != null && planMap.has(r.chapterPlanId))
          .map((r) => ({ ...strip(r), projectId: newProjectId, chapterPlanId: planMap.get(r.chapterPlanId)! })),
      );
      count('infoPoint', newInfoPoints.length);

      // ===== 8. world 其余表 =====
      const newWeaponLores = await insertAll(
        tx, weaponLore,
        (srcWeaponLores as Row[])
          .filter((r) => r.weaponId != null && weaponMap.has(r.weaponId))
          .map((r) => ({ ...strip(r), projectId: newProjectId, weaponId: weaponMap.get(r.weaponId)! })),
      );
      count('weaponLore', newWeaponLores.length);

      const newGrowthRecords = await insertAll(
        tx, entityGrowthRecord,
        (srcGrowthRecords as Row[])
          .map((r): Row | null => {
            const targetMap = r.entityType === 'skill' ? skillMap : magicItemMap;
            const newEntityId = r.entityId != null ? targetMap.get(r.entityId) : undefined;
            if (newEntityId == null) return null;
            return { ...strip(r), projectId: newProjectId, entityId: newEntityId };
          })
          .filter((r): r is Row => r != null),
      );
      count('entityGrowthRecord', newGrowthRecords.length);

      const newLocationLinks = await insertAll(
        tx, customLocationLink,
        (srcLocationLinks as Row[])
          .filter((r) => locationMap.has(r.fromLocationId) && locationMap.has(r.toLocationId))
          .map((r) => ({
            ...strip(r), projectId: newProjectId,
            fromLocationId: locationMap.get(r.fromLocationId)!,
            toLocationId: locationMap.get(r.toLocationId)!,
          })),
      );
      count('customLocationLink', newLocationLinks.length);

      const newTreasureItems = await insertAll(
        tx, treasureItem,
        (srcTreasureItems as Row[]).map((r) => ({
          ...strip(r), projectId: newProjectId,
          huntRecordId: r.huntRecordId != null ? huntMap.get(r.huntRecordId) ?? null : null,
          boundCharacterId: remapChar(r.boundCharacterId, characterMap),
          convertedId: r.convertedId != null
            ? weaponMap.get(r.convertedId) ?? techniqueMap.get(r.convertedId) ?? null
            : null,
        })),
      );
      count('treasureItem', newTreasureItems.length);

      // ===== 9. 场景脚本（sceneNode 有 projectId/outlineId） =====
      const nodeKept = (srcSceneNodes as Row[]).filter((r) => r.outlineId != null && outlineMap.has(r.outlineId));
      const newSceneNodes = await insertAll(
        tx, sceneNode,
        nodeKept.map((r) => ({ ...strip(r), projectId: newProjectId, outlineId: outlineMap.get(r.outlineId)! })),
      );
      const sceneNodeMap = buildMap(nodeKept, newSceneNodes);
      count('sceneNode', newSceneNodes.length);

      const newSceneChars = await insertAll(
        tx, sceneNodeCharacter,
        (srcSceneChars as Row[])
          .filter((r) => sceneNodeMap.has(r.sceneNodeId))
          .map((r) => ({ ...strip(r), sceneNodeId: sceneNodeMap.get(r.sceneNodeId)!, characterId: remapChar(r.characterId, characterMap) })),
      );
      count('sceneNodeCharacter', newSceneChars.length);

      const newSceneElements = await insertAll(
        tx, sceneNodeElement,
        (srcSceneElements as Row[])
          .filter((r) => sceneNodeMap.has(r.sceneNodeId))
          .map((r) => {
            let elementId = r.elementId;
            if (r.elementSource === 'custom') {
              if (r.elementType === 'location') elementId = locationMap.get(elementId) ?? elementId;
              else if (r.elementType === 'skill') elementId = skillMap.get(elementId) ?? elementId;
              else if (r.elementType === 'item') elementId = magicItemMap.get(elementId) ?? elementId;
            }
            return { ...strip(r), sceneNodeId: sceneNodeMap.get(r.sceneNodeId)!, elementId };
          }),
      );
      count('sceneNodeElement', newSceneElements.length);

      const newSceneRelations = await insertAll(
        tx, sceneNodeRelation,
        (srcSceneRelations as Row[])
          .filter((r) => sceneNodeMap.has(r.sourceNodeId) && sceneNodeMap.has(r.targetNodeId))
          .map((r) => ({
            ...strip(r),
            sourceNodeId: sceneNodeMap.get(r.sourceNodeId)!,
            targetNodeId: sceneNodeMap.get(r.targetNodeId)!,
          })),
      );
      count('sceneNodeRelation', newSceneRelations.length);

      // ===== 10. 生成章节（taskId 置空，parentVersionId 二次更新） =====
      const chapterPrepared = (srcChapters as Row[]).map((r) => ({
        ...strip(r), projectId: newProjectId,
        chapterPlanId: r.chapterPlanId != null ? planMap.get(r.chapterPlanId) ?? null : null,
        taskId: null,
        parentVersionId: null,
      }));
      const newChapters = await insertAll(tx, generatedChapter, chapterPrepared);
      const chapterMap = buildMap(srcChapters as Row[], newChapters);
      for (let i = 0; i < (srcChapters as Row[]).length; i++) {
        const oldParent = (srcChapters as Row[])[i].parentVersionId;
        if (oldParent != null && chapterMap.has(oldParent) && newChapters[i]) {
          await tx.update(generatedChapter).set({ parentVersionId: chapterMap.get(oldParent)! }).where(eq(generatedChapter.id, newChapters[i].id));
        }
      }
      count('generatedChapter', newChapters.length);

      // ===== 11. characters 其余表 =====
      const newCharRelations = await insertAll(
        tx, customCharacterRelation,
        (srcCharRelations as Row[]).map((r) => ({
          ...strip(r), projectId: newProjectId,
          charAId: remapChar(r.charAId, characterMap),
          charBId: remapChar(r.charBId, characterMap),
          weaponId: r.weaponId != null ? weaponMap.get(r.weaponId) ?? null : null,
        })),
      );
      count('customCharacterRelation', newCharRelations.length);

      const newVoiceConfigs = await insertAll(
        tx, characterVoiceConfig,
        (srcVoiceConfigs as Row[]).map((r) => ({ ...strip(r), projectId: newProjectId, characterId: remapChar(r.characterId, characterMap) })),
      );
      count('characterVoiceConfig', newVoiceConfigs.length);

      const newKnowledge = await insertAll(
        tx, characterKnowledge,
        (srcKnowledge as Row[]).map((r) => ({ ...strip(r), projectId: newProjectId, characterId: remapChar(r.characterId, characterMap) })),
      );
      count('characterKnowledge', newKnowledge.length);

      const newMemoryCards = await insertAll(
        tx, characterMemoryCard,
        (srcMemoryCards as Row[]).map((r) => ({ ...strip(r), projectId: newProjectId, characterId: remapChar(r.characterId, characterMap) })),
      );
      count('characterMemoryCard', newMemoryCards.length);

      const newGrowthStages = await insertAll(
        tx, characterGrowthStage,
        (srcGrowthStages as Row[]).map((r) => ({ ...strip(r), projectId: newProjectId, characterId: remapChar(r.characterId, characterMap) })),
      );
      count('characterGrowthStage', newGrowthStages.length);

      const newTechVariants = await insertAll(
        tx, characterTechniqueVariant,
        (srcTechVariants as Row[])
          .filter((r) => characterMap.has(r.characterId) && techniqueMap.has(r.baseTechniqueId))
          .map((r) => ({
            ...strip(r), projectId: newProjectId,
            characterId: characterMap.get(r.characterId)!,
            baseTechniqueId: techniqueMap.get(r.baseTechniqueId)!,
          })),
      );
      count('characterTechniqueVariant', newTechVariants.length);

      const newMartialLores = await insertAll(
        tx, characterMartialLore,
        (srcMartialLores as Row[])
          .filter((r) => characterMap.has(r.characterId))
          .map((r) => ({
            ...strip(r), projectId: newProjectId,
            characterId: characterMap.get(r.characterId)!,
            techniqueId: r.techniqueId != null ? techniqueMap.get(r.techniqueId) ?? null : null,
            weaponId: r.weaponId != null ? weaponMap.get(r.weaponId) ?? null : null,
          })),
      );
      count('characterMartialLore', newMartialLores.length);

      const newStateSnapshots = await insertAll(
        tx, characterStateSnapshot,
        (srcStateSnapshots as Row[]).map((r) => ({
          ...strip(r), projectId: newProjectId,
          characterId: remapChar(r.characterId, characterMap),
          taskId: null,
        })),
      );
      count('characterStateSnapshot', newStateSnapshots.length);

      // 项目级默认影响人物（依赖 characterMap，二次更新）
      if (Array.isArray(srcProject.defaultImpactCharacterIds)) {
        await tx.update(creativeProject)
          .set({ defaultImpactCharacterIds: (srcProject.defaultImpactCharacterIds as any[]).map((x) => remapChar(x, characterMap)) } as any)
          .where(eq(creativeProject.id, newProjectId));
      }

      // ===== 12. 分支选项（回填 chapterPlan.branchSourceOptionId） =====
      const branchKept = (srcBranchOptions as Row[]).filter((r) => planMap.has(r.sourceChapterPlanId));
      const newBranchOptions = await insertAll(
        tx, chapterBranchOption,
        branchKept.map((r) => ({ ...strip(r), projectId: newProjectId, sourceChapterPlanId: planMap.get(r.sourceChapterPlanId)! })),
      );
      const branchOptionMap = buildMap(branchKept, newBranchOptions);
      count('chapterBranchOption', newBranchOptions.length);

      for (let i = 0; i < (srcPlans as Row[]).length; i++) {
        const oldOpt = (srcPlans as Row[])[i].branchSourceOptionId;
        if (oldOpt != null && branchOptionMap.has(oldOpt) && newPlans[i]) {
          await tx.update(chapterPlan).set({ branchSourceOptionId: branchOptionMap.get(oldOpt)! }).where(eq(chapterPlan.id, newPlans[i].id));
        }
      }

      // ===== 13. state 表 =====
      const newForeshadows = await insertAll(
        tx, foreshadowThread,
        (srcForeshadows as Row[]).map((r) => ({
          ...strip(r), projectId: newProjectId,
          sceneIds: ((r.sceneIds ?? []) as any[]).map((x) => (typeof x === 'number' ? sceneNodeMap.get(x) ?? x : x)),
          sourceSceneId: r.sourceSceneId != null ? sceneNodeMap.get(r.sourceSceneId) ?? null : null,
          sourceBranchOptionId: r.sourceBranchOptionId != null ? branchOptionMap.get(r.sourceBranchOptionId) ?? null : null,
          backfillTargetChapterId: r.backfillTargetChapterId != null ? planMap.get(r.backfillTargetChapterId) ?? null : null,
          // referencedMaterialId 引用全局素材库，保留原值
        })),
      );
      count('foreshadowThread', newForeshadows.length);

      // 因果链：parentChainId 自引用，先置空再二次更新；sourceId/resolvedTaskId 置空
      const chainPrepared = (srcCausalChains as Row[]).map((r) => ({
        ...strip(r), projectId: newProjectId,
        sourceId: null,
        resolvedTaskId: null,
        parentChainId: null,
      }));
      const newChains = await insertAll(tx, causalChain, chainPrepared);
      const chainMap = buildMap(srcCausalChains as Row[], newChains);
      for (let i = 0; i < (srcCausalChains as Row[]).length; i++) {
        const oldParent = (srcCausalChains as Row[])[i].parentChainId;
        if (oldParent != null && chainMap.has(oldParent) && newChains[i]) {
          await tx.update(causalChain).set({ parentChainId: chainMap.get(oldParent)! }).where(eq(causalChain.id, newChains[i].id));
        }
      }
      count('causalChain', newChains.length);

      const newTaskArcs = await insertAll(
        tx, taskArc,
        (srcTaskArcs as Row[]).map((r) => ({
          ...strip(r), projectId: newProjectId,
          // 关联角色逐个重映射，映射不到丢弃
          relatedCharacterIds: ((r.relatedCharacterIds ?? []) as any[])
            .map((x) => tryRemapChar(x, characterMap))
            .filter((x): x is number => x !== undefined),
        })),
      );
      count('taskArc', newTaskArcs.length);

      const newMilestones = await insertAll(
        tx, timelineMilestone,
        (srcMilestones as Row[]).map((r) => ({ ...strip(r), projectId: newProjectId, taskId: null })),
      );
      count('timelineMilestone', newMilestones.length);

      const newCharImpactSnaps = await insertAll(
        tx, characterImpactSnapshot,
        (srcCharImpactSnaps as Row[]).map((r) => ({
          ...strip(r), projectId: newProjectId,
          characterId: remapChar(r.characterId, characterMap),
          taskId: null,
        })),
      );
      count('characterImpactSnapshot', newCharImpactSnaps.length);

      const newWorldImpactSnaps = await insertAll(
        tx, worldImpactSnapshot,
        (srcWorldImpactSnaps as Row[]).map((r) => ({ ...strip(r), projectId: newProjectId })),
      );
      count('worldImpactSnapshot', newWorldImpactSnaps.length);

      const newBranchImpactLinks = await insertAll(
        tx, branchImpactLink,
        (srcBranchImpactLinks as Row[])
          .filter((r) => branchOptionMap.has(r.branchOptionId))
          .map((r) => ({
            ...strip(r),
            branchOptionId: branchOptionMap.get(r.branchOptionId)!,
            targetId: r.targetType === 'character' ? remapChar(r.targetId, characterMap) : r.targetId ?? null,
            charAId: remapChar(r.charAId, characterMap),
            charBId: remapChar(r.charBId, characterMap),
          })),
      );
      count('branchImpactLink', newBranchImpactLinks.length);

      const newImpactHistory = await insertAll(
        tx, impactHistory,
        (srcImpactHistory as Row[]).map((r) => ({
          ...strip(r), projectId: newProjectId,
          sourceId: r.sourceType === 'branch' && r.sourceId != null
            ? branchOptionMap.get(r.sourceId) ?? null
            : r.sourceId ?? null,
        })),
      );
      count('impactHistory', newImpactHistory.length);

      const newRelationImpactSnaps = await insertAll(
        tx, relationImpactSnapshot,
        (srcRelationImpactSnaps as Row[]).map((r) => ({
          ...strip(r), projectId: newProjectId,
          charAId: remapChar(r.charAId, characterMap),
          charBId: remapChar(r.charBId, characterMap),
          taskId: null,
        })),
      );
      count('relationImpactSnapshot', newRelationImpactSnaps.length);

      const newQuotes = await insertAll(
        tx, projectQuoteLib,
        (srcQuotes as Row[]).map((r) => ({
          ...strip(r), projectId: newProjectId,
          chapterId: r.chapterId != null ? chapterMap.get(r.chapterId) ?? null : null,
          characterId: remapChar(r.characterId, characterMap),
        })),
      );
      count('projectQuoteLib', newQuotes.length);

      return { projectId: newProjectId, title: newProj.title };
    });

    return c.json({
      success: true,
      data: { projectId: result.projectId, title: result.title, importedTables },
    });
  } catch (error: any) {
    console.error('[Import] 导入失败:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default app;
