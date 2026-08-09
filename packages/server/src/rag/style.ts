/**
 * 风格上下文组装器
 * 从诛仙库风格层（style_global_config + style_scene_mapping）读取作者风格铁律，
 * 组装为 StyleContext 注入写作/审计/修订管线。
 *
 * 设计取舍（见需求2方案评审）：
 * - 全局配置：全量注入（禁用词/意象词库/描写比例/句式/视角/反模式/心智模型/决策启发）
 * - 场景映射：仅对 emotion_imagery 做「尽力匹配」（章节层只有自由情绪短语+数字冲突等级，
 *   其余映射类型在章节层级无可靠匹配桥，v1 不硬接以免误配污染上下文）
 */
import * as retriever from './retriever.js';
import type { StyleContext } from '../types.js';

/** 规范情绪 → 自由情绪短语里可能出现的关键词（用于尽力归并） */
const EMOTION_KEYWORDS: Record<string, string[]> = {
  伤感: ['伤感', '悲', '哀', '难过', '失落', '惆怅', '心酸', '凄凉'],
  压抑: ['压抑', '窒', '沉闷', '沉重', '憋', '阴霾', '憋闷'],
  紧张: ['紧张', '局促', '慌乱', '忐忑', '惊', '惶', '慌乱'],
  激昂: ['激昂', '热血', '振奋', '豪迈', '激越', '澎湃'],
  温馨: ['温馨', '温暖', '温情', '甜', '心动', '羞涩', '悸动', '暧昧', '柔情'],
  清冷: ['清冷', '冷清', '孤冷', '自持', '克制', '淡漠'],
  平静: ['平静', '淡然', '宁静', '平和', '安宁', '舒缓'],
};

/** 冲突等级(1-5) → emotion_imagery 强度档(_1/_3/_5) */
function conflictToLevel(conflictLevel: number | null | undefined): number {
  const n = Number(conflictLevel);
  if (!Number.isFinite(n) || n <= 0) return 3; // 缺省中档
  if (n <= 2) return 1;
  if (n >= 5) return 5;
  return 3; // 3 或 4 → 中档
}

/** 把自由情绪短语归并到规范情绪前缀，匹配不到返回 null */
function normalizeEmotion(targetEmotion: string | null | undefined): string | null {
  if (!targetEmotion) return null;
  for (const [canonical, keywords] of Object.entries(EMOTION_KEYWORDS)) {
    if (keywords.some((kw) => targetEmotion.includes(kw))) return canonical;
  }
  return null;
}

/**
 * 尽力匹配情绪意象映射（emotion_imagery）
 * @returns 场景风味描述字符串（如"情绪基调：低沉舒缓；笔触：白描；意象：细雨、夜色、孤灯"）
 */
function matchEmotionImagery(
  targetEmotion: string | null | undefined,
  conflictLevel: number | null | undefined,
  mappings: { mappingType: string | null; triggerKey: string | null; resultValue: any }[]
): string[] {
  const canonical = normalizeEmotion(targetEmotion);
  if (!canonical) return [];

  const level = conflictToLevel(conflictLevel);
  const emotionRows = mappings.filter(
    (m) => m.mappingType === 'emotion_imagery' && (m.triggerKey || '').startsWith(canonical + '_')
  );
  if (!emotionRows.length) return [];

  // 优先精确强度档，其次退到任意可用档
  const exact = emotionRows.find((m) => m.triggerKey === `${canonical}_${level}`);
  const row = exact || emotionRows[0];
  const rv = row.resultValue || {};

  const parts: string[] = [];
  if (rv.tone) parts.push(`情绪基调：${rv.tone}`);
  if (rv.brush) parts.push(`笔触：${rv.brush}`);
  if (Array.isArray(rv.imagery) && rv.imagery.length) parts.push(`意象：${rv.imagery.join('、')}`);
  return parts.length ? [parts.join('；')] : [];
}

/**
 * 为章节构建风格上下文
 * @param bookId 诛仙库书籍ID（管线锁定诛仙书=1）
 * @param chapterPlan 章节计划（用于情绪尽力匹配）
 */
export async function buildStyleContext(
  bookId: number,
  chapterPlan: { targetEmotion?: string | null; conflictType?: string | null }
): Promise<StyleContext | undefined> {
  try {
    const [global, mappings] = await Promise.all([
      retriever.getStyleGlobalConfig(bookId),
      retriever.getStyleSceneMappings(bookId),
    ]);

    // 无全局配置则不注入风格（保持向后兼容）
    if (!global) return undefined;

    const clean = (arr: any): string[] | undefined =>
      Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : undefined;

    // 情绪尽力匹配（冲突等级来自 chapterPlan.conflictType 字符串）
    const conflictLevel = chapterPlan.conflictType != null ? Number(chapterPlan.conflictType) : null;
    const matchedSceneFlavor = matchEmotionImagery(chapterPlan.targetEmotion, conflictLevel, mappings);

    const style: StyleContext = {
      styleName: global.styleName || undefined,
      mentalModels: clean(global.mentalModels),
      decisionHeuristics: clean(global.decisionHeuristics),
      descriptionRatio: (global.descriptionRatio as StyleContext['descriptionRatio']) || undefined,
      coreImagery: clean(global.coreImagery),
      forbiddenWords: clean(global.forbiddenWords),
      sentenceRules: (global.sentenceRules as Record<string, any>) || undefined,
      perspectiveRules: clean(global.perspectiveRules),
      antiPatterns: clean(global.antiPatterns),
      matchedSceneFlavor: matchedSceneFlavor.length ? matchedSceneFlavor : undefined,
    };

    return style;
  } catch {
    // 风格加载失败不阻断生成
    return undefined;
  }
}

/**
 * 确定性禁用词扫描（零LLM成本，作为Auditor风格维度的兜底）
 * @returns 正文中实际出现的禁用词列表
 */
export function scanForbiddenWords(content: string, forbiddenWords?: string[]): string[] {
  if (!content || !forbiddenWords?.length) return [];
  return forbiddenWords.filter((w) => w && w.length >= 2 && content.includes(w));
}
