/**
 * LLM 分析：读取某批次书目元数据，产出剧情素材模板形态的灵感条目（奇遇/伏笔手法/高光/任务链），
 * 写入 hotspot_insight，推送时可直接 INSERT 到创作库 plot_material_* 四表。
 * 同时用纯词频统计生成 trend 兜底条目（仅供浏览参考，不可推送，零 LLM 也有产出）。
 */
import { z } from 'zod';
import { query } from './db.js';
import { chatJson } from './llm.js';

interface NovelRow {
  id: number;
  rank: number | null;
  title: string;
  author: string | null;
  category: string | null;
  tags: string[];
  intro: string | null;
}

/** 四类素材型灵感（可推送到 plot_material_* 对应表）+ trend 趋势参考（不可推送） */
export const MATERIAL_INSIGHT_TYPES = ['encounter', 'foreshadow', 'highlight', 'task'] as const;

const InsightItem = z.object({
  insight_type: z.enum(['encounter', 'foreshadow', 'highlight', 'task']),
  title: z.string().min(1),
  core_plot: z.string().min(1),
  trigger_condition: z.string().default(''),
  reward: z.string().default(''),
  cost_or_risk: z.string().default(''),
  emotional_beat: z.string().default(''),
  applicable_scene_type: z.string().default(''),
  tags: z.array(z.string()).default([]),
  source_work: z.string().default(''),
  score: z.number().int().min(0).max(100).default(50),
});

const SYSTEM_PROMPT = `你是一名资深男频玄幻/仙侠网文编辑，为一个仙侠（诛仙世界观）AI 创作系统的【剧情素材库】补充弹药。
你会拿到一批男频玄幻/仙侠热门榜单的书目元数据（书名/作者/分类/标签/简介）。
请从中提炼【可复用的剧情素材模板】，输出严格的 JSON 数组，不要任何解释文字。
硬性要求：
1. 每条素材必须是【泛化模板】：剥离具体书名/人名后仍然成立，能直接套用到诛仙风格的仙侠世界观（宗门、正魔对立、境界修行、机缘宝物、宿命与抗争）。
2. 与仙侠/玄幻无法嫁接的内容直接舍弃，不要勉强产出。
3. 不要产出趋势报告、统计分析、命名规律类内容，只产出可直接写进剧情的素材模板。
每个条目字段：
- insight_type: 取值之一
  - encounter: 奇遇素材（机缘、宝物、隐藏传承、险地探宝、贵人/高人相助等惊喜展开）
  - foreshadow: 伏笔手法素材（埋设/回收伏笔的具体手法模板，如遗物认亲、身世伏线、预言应验）
  - highlight: 高光名场面素材（扮猪吃虎反转打脸、绝境翻盘、当众正名等情绪爆点场面）
  - task: 任务链素材（连环目标/连锁任务/层层递进的剧情链条，如寻药救人→入秘境→揭出阴谋）
- title: 素材标题(不超过20字)
- core_plot: 核心剧情模板(60-200字)，用"主角/对手/长者"等泛指称呼，具体可执行
- trigger_condition: 触发条件(什么情境下可以使用这条素材)
- reward: 收益(主角/剧情获得什么：宝物、境界、人心、信息…)
- cost_or_risk: 代价或风险(使用这条素材的副作用/隐患，避免无脑爽)
- emotional_beat: 情绪节拍(如压抑→爆发、好奇→震惊、绝望→逆转)
- applicable_scene_type: 适用场景类型(如 战斗/奇遇/日常/对峙/秘境探索)
- tags: 3-6个短标签数组
- source_work: 启发来源的书名(不带书名号，单本书名)
- score: 0-100，该素材对仙侠创作的复用价值
数量要求：encounter 4-8条、foreshadow 2-4条、highlight 3-6条、task 2-4条。
只输出 JSON 数组。`;

/** 对批次执行分析 */
export async function runAnalyze(batchId: number): Promise<{ count: number; byType: Record<string, number> }> {
  const novels = await query<NovelRow>(
    `SELECT id, rank, title, author, category, tags, intro
     FROM hotspot_raw_novel WHERE batch_id=$1 ORDER BY source, rank NULLS LAST`,
    [batchId],
  );
  if (novels.length === 0) {
    throw new Error('该批次没有书目数据，无法分析');
  }

  // 清空该批次旧的分析结果（仅未推送的），避免重复
  await query(`DELETE FROM hotspot_insight WHERE batch_id=$1 AND status <> 'pushed'`, [batchId]);

  const sourceNovelIds = novels.map((n) => n.id);
  const inserted: Array<{ type: string }> = [];

  // 1. 词频统计兜底 trend
  const freqInsights = buildFrequencyTrends(novels);
  for (const ins of freqInsights) {
    await insertInsight(batchId, ins.insight_type, ins.title, ins.content, ins.score, ins.payload ?? {}, sourceNovelIds);
    inserted.push({ type: ins.insight_type });
  }

  // 2. LLM 深度分析
  try {
    const digest = novels
      .slice(0, 40)
      .map(
        (n, i) =>
          `${i + 1}. 《${n.title}》 作者:${n.author ?? '?'} 分类:${n.category ?? '?'} 标签:${(n.tags ?? []).join('/') || '无'}\n   简介:${(n.intro ?? '').slice(0, 120)}`,
      )
      .join('\n');
    // 四类数量下限合计 11 条（4+2+3+2），截断打捞后不足则重试
    const raw = await chatJson(SYSTEM_PROMPT, `以下均为男频玄幻/仙侠热门榜单书目：\n${digest}`, 2, 11);
    // 逐条校验：截断打捞场景下个别坏条目不拖垮全部
    const rawItems: unknown[] = Array.isArray(raw) ? raw : [];
    let dropped = 0;
    for (const rawItem of rawItems) {
      const parsed = InsightItem.safeParse(rawItem);
      if (!parsed.success) {
        dropped++;
        continue;
      }
      const item = parsed.data;
      // content 存核心剧情，其余素材字段进 payload，推送时直接映射到 plot_material_* 列
      await insertInsight(batchId, item.insight_type, item.title, item.core_plot, item.score, {
        trigger_condition: item.trigger_condition,
        reward: item.reward,
        cost_or_risk: item.cost_or_risk,
        emotional_beat: item.emotional_beat,
        applicable_scene_type: item.applicable_scene_type,
        tags: item.tags,
        source_work: item.source_work,
      }, sourceNovelIds);
      inserted.push({ type: item.insight_type });
    }
    if (dropped > 0) {
      console.warn(`[hotspot-analyzer] 丢弃 ${dropped} 条校验不通过的条目，保留 ${rawItems.length - dropped} 条`);
    }
  } catch (e) {
    console.warn('[hotspot-analyzer] LLM 分析失败，仅保留词频兜底结果:', (e as Error).message);
  }

  const byType: Record<string, number> = {};
  for (const it of inserted) byType[it.type] = (byType[it.type] ?? 0) + 1;
  return { count: inserted.length, byType };
}

/** 词频统计：统计标签/分类高频项，作为 trend 兜底 */
function buildFrequencyTrends(novels: NovelRow[]) {
  const tagFreq = new Map<string, number>();
  const catFreq = new Map<string, number>();
  for (const n of novels) {
    for (const t of n.tags ?? []) {
      const key = t.trim();
      if (key) tagFreq.set(key, (tagFreq.get(key) ?? 0) + 1);
    }
    if (n.category) {
      const key = n.category.trim();
      catFreq.set(key, (catFreq.get(key) ?? 0) + 1);
    }
  }
  // trend 仅供浏览参考，不在可推送的素材类型内，故不走 InsightItem schema
  const results: Array<{ insight_type: string; title: string; content: string; score: number; payload: Record<string, any> }> = [];

  const topTags = [...tagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (topTags.length) {
    results.push({
      insight_type: 'trend',
      title: '高频标签统计',
      content: `本批次榜单出现频次最高的标签：${topTags.map(([k, v]) => `${k}(${v})`).join('、')}。可作为新书标签选型参考。`,
      score: Math.min(100, 50 + topTags[0][1] * 5),
      payload: { tags: Object.fromEntries(topTags) },
    });
  }
  const topCats = [...catFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (topCats.length) {
    results.push({
      insight_type: 'trend',
      title: '热门分类分布',
      content: `本批次榜单分类分布：${topCats.map(([k, v]) => `${k}(${v})`).join('、')}。反映当下热门题材方向。`,
      score: Math.min(100, 50 + topCats[0][1] * 5),
      payload: { categories: Object.fromEntries(topCats) },
    });
  }
  return results;
}

async function insertInsight(
  batchId: number,
  type: string,
  title: string,
  content: string,
  score: number,
  payload: Record<string, any>,
  sourceNovelIds: number[],
) {
  await query(
    `INSERT INTO hotspot_insight (batch_id, insight_type, title, content, score, payload, source_novel_ids, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'new')`,
    [batchId, type, title, content, score, JSON.stringify(payload ?? {}), JSON.stringify(sourceNovelIds)],
  );
}
