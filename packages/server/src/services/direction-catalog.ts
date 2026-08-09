/**
 * 剧情方向字典（需求：剧情方向体系）
 *
 * 叙事方向 = 比具体分支选项更高一层的叙事目标分类，仅约束创作目标，不约束具体剧情内容。
 * 9 大类，细分方向按 PRD 2.2 表格全量收录（PRD 文案写"27细分"，但其表格实际枚举 37 项，
 * 此处以表格为准全量实现；编码全局唯一）。
 *
 * 使用规则：
 * 1. 单个分支选项 = 1 个主方向 + 0-2 个次方向
 * 2. 默认启用前 6 大类，后 3 大类（势力经营/智斗布局/日常过渡）默认关闭
 * 3. 项目级开关存于 generation_config.directionConfig.enabledCategories（大类编码数组）
 */

/** 方向大类编码 */
export type DirectionCategoryCode =
  | 'growth' | 'relation' | 'item' | 'workshop' | 'mainplot' | 'explore'
  | 'conflict' | 'faction' | 'strategy' | 'buffer';

/** 大类元信息 */
export interface DirectionCategoryMeta {
  code: DirectionCategoryCode;
  name: string;
  /** 前端徽标主题色（tailwind class 片段） */
  color: string;
  /** 是否默认启用（前6大类默认开，后3大类默认关） */
  defaultEnabled: boolean;
}

/** 细分方向定义 */
export interface DirectionDef {
  /** 全局唯一编码，如 growth_realm */
  code: string;
  /** 显示名称，如 境界突破 */
  name: string;
  /** 所属大类 */
  category: DirectionCategoryCode;
  /** 联动影响模块（用于 方向→影响 自动映射，阶段3消费） */
  impactModules: string[];
  /** 核心定义（注入 prompt 帮助 LLM 理解） */
  definition: string;
}

/** 大类元信息表（按 PRD 顺序，前7默认启用） */
export const DIRECTION_CATEGORIES: DirectionCategoryMeta[] = [
  { code: 'growth',   name: '人物成长', color: 'bg-emerald-500/20 text-emerald-400', defaultEnabled: true },
  { code: 'relation', name: '人物关系', color: 'bg-rose-500/20 text-rose-400',       defaultEnabled: true },
  { code: 'item',     name: '道具收获', color: 'bg-amber-500/20 text-amber-400',     defaultEnabled: true },
  { code: 'workshop', name: '功法法宝', color: 'bg-orange-500/20 text-orange-400',   defaultEnabled: true },
  { code: 'mainplot', name: '主线剧情', color: 'bg-indigo-500/20 text-indigo-400',   defaultEnabled: true },
  { code: 'explore',  name: '场景探索', color: 'bg-cyan-500/20 text-cyan-400',       defaultEnabled: true },
  { code: 'conflict', name: '冲突危机', color: 'bg-red-500/20 text-red-400',         defaultEnabled: true },
  { code: 'faction',  name: '势力经营', color: 'bg-yellow-500/20 text-yellow-400',   defaultEnabled: false },
  { code: 'strategy', name: '智斗布局', color: 'bg-violet-500/20 text-violet-400',   defaultEnabled: false },
  { code: 'buffer',   name: '日常过渡', color: 'bg-slate-500/20 text-slate-400',     defaultEnabled: false },
];

/** 细分方向字典（全量 37 项） */
export const DIRECTION_CATALOG: DirectionDef[] = [
  // ---- 人物成长 growth ----
  { code: 'growth_realm',  name: '境界突破', category: 'growth', impactModules: ['根骨资质', '劫数瓶颈'], definition: '主角/核心角色修为晋升、实力层级跃升' },
  { code: 'growth_skill',  name: '功法习得', category: 'growth', impactModules: ['根骨资质'],             definition: '学会新功法、解锁核心招式、掌握特殊神通' },
  { code: 'growth_mind',   name: '心境提升', category: 'growth', impactModules: ['劫数瓶颈'],             definition: '心性蜕变、执念化解/生成、认知维度升级' },
  { code: 'growth_body',   name: '体质异变', category: 'growth', impactModules: ['根骨资质', '命格气运'], definition: '获得特殊体质、血脉觉醒/变异、肉身强化' },
  { code: 'growth_status', name: '身份晋升', category: 'growth', impactModules: ['宗门势力'],             definition: '社会地位/职务身份跃升（如弟子→长老）' },
  // ---- 人物关系 relation ----
  { code: 'relation_up',    name: '关系升温',   category: 'relation', impactModules: ['人际网络'], definition: '核心角色间感情/羁绊/信任加深' },
  { code: 'relation_break', name: '关系破裂',   category: 'relation', impactModules: ['人际网络'], definition: '盟友反目、师徒决裂、阵营立场对立' },
  { code: 'relation_new',   name: '结识新角色', category: 'relation', impactModules: ['人际网络'], definition: '关键新人物登场、新队友加入阵营' },
  { code: 'relation_camp',  name: '阵营转变',   category: 'relation', impactModules: ['宗门势力'], definition: '角色改换门庭、身份立场发生变化' },
  // ---- 道具收获 item ----
  { code: 'item_magic',    name: '获得法宝', category: 'item', impactModules: ['因果业障'],         definition: '得到新法器、神兵、护身宝物' },
  { code: 'item_material', name: '得到灵材', category: 'item', impactModules: ['根骨资质', '劫数瓶颈'], definition: '获取稀有丹药、天材地宝、特殊材料' },
  { code: 'item_token',    name: '解锁信物', category: 'item', impactModules: ['宗门势力', '因果业障'], definition: '获得身份令牌、伏笔信物、关键线索' },
  { code: 'item_manual',   name: '功法秘籍', category: 'item', impactModules: ['根骨资质'],         definition: '得到残缺功法、上古传承、秘典残卷' },
  { code: 'item_legacy',   name: '传承印记', category: 'item', impactModules: ['命格气运', '根骨资质'], definition: '获得无形传承、血脉印记、气运加持' },
  // ---- 功法法宝 workshop（成长工坊四操作） ----
  { code: 'workshop_fusion',  name: '功法融合', category: 'workshop', impactModules: ['根骨资质'],             definition: '将两种或多种功法/法宝融合为一，诞生全新能力（成长工坊·融合）' },
  { code: 'workshop_mutate',  name: '法宝变异', category: 'workshop', impactModules: ['命格气运'],             definition: '功法/法宝受外力催化产生变异，获得意想不到的特效（成长工坊·变异）' },
  { code: 'workshop_upgrade', name: '强化突破', category: 'workshop', impactModules: ['根骨资质'],             definition: '功法/法宝原阶强化淬炼，威力显著提升（成长工坊·强化）' },
  { code: 'workshop_evolve',  name: '进化蜕变', category: 'workshop', impactModules: ['根骨资质', '命格气运'], definition: '法宝突破品阶桎梏进化为更高阶存在（成长工坊·进化）' },
  // ---- 主线剧情 mainplot ----
  { code: 'mainplot_resolve', name: '伏笔回收',   category: 'mainplot', impactModules: ['因果业障'],         definition: '揭晓之前埋设的伏笔、填坑闭环' },
  { code: 'mainplot_plant',   name: '新埋伏笔',   category: 'mainplot', impactModules: ['因果业障'],         definition: '埋下新的长线悬念、暗线线索' },
  { code: 'mainplot_reveal',  name: '世界观揭秘', category: 'mainplot', impactModules: ['世界观域'],         definition: '揭露世界观真相、补全背景设定' },
  { code: 'mainplot_event',   name: '关键事件',   category: 'mainplot', impactModules: ['世界观域', '宗门势力'], definition: '触发主线核心节点、改变整体大局' },
  { code: 'mainplot_karma',   name: '因果闭环',   category: 'mainplot', impactModules: ['因果业障'],         definition: '过往伏笔集中兑现、旧怨了结' },
  // ---- 场景探索 explore ----
  { code: 'explore_newmap', name: '新地解锁', category: 'explore', impactModules: ['世界观域'],         definition: '进入全新地图、秘境、宗门、凡间区域' },
  { code: 'explore_secret', name: '秘境探险', category: 'explore', impactModules: ['道具收获', '命格气运'], definition: '进入副本/遗迹/险地探索寻宝' },
  // ---- 冲突危机 conflict ----
  { code: 'conflict_enemy',    name: '遭遇强敌', category: 'conflict', impactModules: ['劫数瓶颈'],         definition: '遇到新对手、发生正面战斗冲突' },
  { code: 'conflict_plot',     name: '阴谋触发', category: 'conflict', impactModules: ['因果业障'],         definition: '反派行动、主角中计、危机爆发' },
  { code: 'conflict_war',      name: '阵营冲突', category: 'conflict', impactModules: ['宗门势力', '因果业障'], definition: '两派/多国开战、大规模阵营对抗' },
  { code: 'conflict_internal', name: '内部纷争', category: 'conflict', impactModules: ['宗门势力', '人际网络'], definition: '己方阵营内斗、分歧、背叛事件' },
  // ---- 势力经营 faction ----
  { code: 'faction_expand',    name: '势力扩张', category: 'faction', impactModules: ['宗门势力'],         definition: '地盘扩大、人手增加、影响力提升' },
  { code: 'faction_build',     name: '宗门建设', category: 'faction', impactModules: ['宗门势力'],         definition: '升级阵法、扩建洞府、添置产业' },
  { code: 'faction_alliance',  name: '阵营结盟', category: 'faction', impactModules: ['宗门势力'],         definition: '与其他势力达成合作、缔结盟约' },
  { code: 'faction_purge',     name: '内部整肃', category: 'faction', impactModules: ['宗门势力', '因果业障'], definition: '清理内鬼、整顿纪律、巩固权力' },
  // ---- 智斗布局 strategy ----
  { code: 'strategy_intel',     name: '情报搜集', category: 'strategy', impactModules: ['人际网络'], definition: '打探消息、探查虚实、获取关键线索' },
  { code: 'strategy_trap',      name: '设局布局', category: 'strategy', impactModules: ['因果业障'], definition: '给反派下套、布置后手、安排陷阱' },
  { code: 'strategy_puzzle',    name: '解谜破局', category: 'strategy', impactModules: ['根骨资质'], definition: '破解阵法、破译密文、解开谜团' },
  { code: 'strategy_negotiate', name: '心理博弈', category: 'strategy', impactModules: ['人际网络'], definition: '谈判交锋、试探底线、虚张声势' },
  // ---- 日常过渡 buffer ----
  { code: 'buffer_rest',       name: '休整过渡', category: 'buffer', impactModules: ['劫数瓶颈'], definition: '疗伤恢复、盘点收获、短暂休息调整' },
  { code: 'buffer_daily',      name: '日常互动', category: 'buffer', impactModules: ['人际网络'], definition: '生活细节、琐碎相处、轻松趣味情节' },
  { code: 'buffer_scene',      name: '风物铺垫', category: 'buffer', impactModules: ['世界观域'], definition: '介绍风土人情、展现世界观细节' },
  { code: 'buffer_foreshadow', name: '情感酝酿', category: 'buffer', impactModules: ['因果业障'], definition: '情绪铺垫、氛围渲染、伏笔暗埋' },
];

/** 编码 → 方向定义 快查表 */
const DIRECTION_BY_CODE = new Map<string, DirectionDef>(
  DIRECTION_CATALOG.map((d) => [d.code, d])
);

/** 大类编码 → 元信息 快查表 */
const CATEGORY_BY_CODE = new Map<string, DirectionCategoryMeta>(
  DIRECTION_CATEGORIES.map((c) => [c.code, c])
);

/** 按编码取方向定义（不存在返回 undefined） */
export function getDirection(code: string | null | undefined): DirectionDef | undefined {
  if (!code) return undefined;
  return DIRECTION_BY_CODE.get(code);
}

/** 按编码取大类元信息 */
export function getCategory(code: string | null | undefined): DirectionCategoryMeta | undefined {
  if (!code) return undefined;
  return CATEGORY_BY_CODE.get(code);
}

/** 默认启用的大类编码（前6大类） */
export const DEFAULT_ENABLED_CATEGORIES: DirectionCategoryCode[] = DIRECTION_CATEGORIES
  .filter((c) => c.defaultEnabled)
  .map((c) => c.code);

/**
 * 解析项目实际启用的大类集合。
 * enabledCategories 缺省/空 → 默认前6大类。
 */
export function resolveEnabledCategories(enabledCategories?: string[] | null): Set<string> {
  const list = Array.isArray(enabledCategories) && enabledCategories.length
    ? enabledCategories
    : DEFAULT_ENABLED_CATEGORIES;
  return new Set(list);
}

/** 判断某方向（按其所属大类）是否启用 */
export function isDirectionEnabled(code: string, enabled: Set<string>): boolean {
  const def = getDirection(code);
  if (!def) return false;
  return enabled.has(def.category);
}

// ============================================================
// 规则自动打标（2.4.2）
// 对存量分支、未指定方向生成的分支，基于标题+描述+意图的关键词匹配主方向。
// 纯函数、零 LLM；作为 LLM 打标的主保底/兜底。
// ============================================================

/** 方向编码 → 关键词表（修仙题材启发式，命中越多越可信） */
const DIRECTION_KEYWORDS: Record<string, string[]> = {
  growth_realm:  ['突破', '境界', '修为', '晋升', '进阶', '筑基', '金丹', '元婴', '渡劫', '飞升', '破境'],
  growth_skill:  ['功法', '习得', '学会', '神通', '招式', '秘术', '领悟', '修炼成', '掌握'],
  growth_mind:   ['心境', '心性', '执念', '顿悟', '明悟', '蜕变', '道心', '心结'],
  growth_body:   ['体质', '血脉', '觉醒', '异变', '肉身', '强化', '特殊体质', '淬体'],
  growth_status: ['身份', '长老', '执事', '掌门', '地位', '职务', '首座', '晋升'],
  relation_up:    ['升温', '羁绊', '信任', '感情', '加深', '亲近', '结义', '情愫', '交好'],
  relation_break: ['反目', '决裂', '背叛', '对立', '恩断义绝', '翻脸', '割席'],
  relation_new:   ['结识', '新角色', '登场', '加入', '相遇', '初见', '新人物'],
  relation_camp:  ['阵营', '改换门庭', '投奔', '叛出', '立场', '转变'],
  item_magic:    ['法宝', '法器', '神兵', '宝物', '护身', '仙剑', '灵器', '得宝'],
  item_material: ['灵材', '丹药', '天材地宝', '材料', '灵草', '灵药', '丹方'],
  item_token:    ['信物', '令牌', '线索', '凭证', '玉佩', '钥匙', '印记'],
  item_manual:   ['秘籍', '秘典', '残卷', '上古功法', '传承功法', '功法秘籍'],
  item_legacy:   ['传承', '血脉印记', '气运', '无形传承', '机缘', '印记'],
  workshop_fusion:  ['功法融合', '法宝融合', '融合为一', '合璧', '双法合一', '融为一体'],
  workshop_mutate:  ['法宝变异', '功法变异', '异变', '突变', '特效变异'],
  workshop_upgrade: ['功法强化', '法宝强化', '淬炼', '强化', '威力提升'],
  workshop_evolve:  ['法宝进化', '功法进化', '蜕变', '品阶突破', '升阶'],
  mainplot_resolve: ['伏笔回收', '填坑', '揭晓', '闭环', '真相大白', '回收伏笔'],
  mainplot_plant:   ['埋伏笔', '埋下', '悬念', '暗线', '新伏笔'],
  mainplot_reveal:  ['揭秘', '世界观真相', '揭露', '背景秘密', '世界真相'],
  mainplot_event:   ['关键事件', '主线节点', '大局', '转折', '主线推进'],
  mainplot_karma:   ['因果', '兑现', '了结', '旧怨', '报应', '因果闭环'],
  explore_newmap: ['新地', '解锁', '地图', '踏入', '抵达', '新区域', '初入'],
  explore_secret: ['秘境', '探险', '遗迹', '险地', '寻宝', '副本', '洞府探秘'],
  conflict_enemy:    ['强敌', '战斗', '对手', '厮杀', '对决', '遭遇战', '激战'],
  conflict_plot:     ['阴谋', '中计', '危机', '反派', '算计', '陷阱'],
  conflict_war:      ['开战', '对抗', '战争', '大战', '阵营冲突', '交锋'],
  conflict_internal: ['内斗', '纷争', '分歧', '内鬼', '内部背叛'],
  faction_expand:    ['势力扩张', '地盘', '人手', '影响力', '扩张'],
  faction_build:     ['建设', '护山大阵', '扩建', '产业', '宗门建设'],
  faction_alliance:  ['结盟', '盟约', '合作', '联手', '缔结'],
  faction_purge:     ['整肃', '清理内鬼', '整顿', '纪律', '巩固权力'],
  strategy_intel:     ['情报', '打探', '探查', '消息', '虚实', '刺探'],
  strategy_trap:      ['设局', '布局', '下套', '后手', '圈套'],
  strategy_puzzle:    ['解谜', '破阵', '密文', '谜团', '破解', '解阵'],
  strategy_negotiate: ['谈判', '博弈', '试探', '底线', '虚张声势', '周旋'],
  buffer_rest:       ['休整', '疗伤', '恢复', '休息', '调整', '盘点收获'],
  buffer_daily:      ['日常', '互动', '相处', '琐碎', '轻松', '趣味'],
  buffer_scene:      ['风物', '风土人情', '铺垫', '世界观细节', '景色', '游历见闻'],
  buffer_foreshadow: ['酝酿', '情绪铺垫', '氛围', '渲染', '暗埋'],
};

/** 自动打标结果 */
export interface InferredDirection {
  /** 主方向编码（无命中时为 null，表示"未分类"） */
  mainDirection: string | null;
  /** 次方向编码数组（0-2，取与主方向不同大类的次优命中） */
  secondaryDirections: string[];
  /** 匹配度评分 0-100（<60 视为未分类） */
  directionMatchScore: number;
}

/**
 * 基于文本（标题+描述+意图）关键词推断主方向。
 * 评分规则：最高命中数 hits → score = clamp(45 + hits*15, 0, 95)；
 * hits=0 或 score<60 → mainDirection=null（未分类）。
 * 次方向取与主方向不同大类、命中数最高的前 2 个。
 */
export function inferDirectionFromText(text: string): InferredDirection {
  const haystack = text || '';
  const scored: { code: string; category: DirectionCategoryCode; hits: number }[] = [];
  for (const def of DIRECTION_CATALOG) {
    const kws = DIRECTION_KEYWORDS[def.code];
    if (!kws?.length) continue;
    let hits = 0;
    for (const kw of kws) {
      if (haystack.includes(kw)) hits++;
    }
    if (hits > 0) scored.push({ code: def.code, category: def.category, hits });
  }
  if (!scored.length) {
    return { mainDirection: null, secondaryDirections: [], directionMatchScore: 0 };
  }
  // 命中数降序，同命中按字典序（稳定）
  scored.sort((a, b) => b.hits - a.hits || a.code.localeCompare(b.code));
  const top = scored[0];
  const score = Math.max(0, Math.min(95, 45 + top.hits * 15));
  if (score < 60) {
    return { mainDirection: null, secondaryDirections: [], directionMatchScore: score };
  }
  const secondary = scored
    .filter((s) => s.category !== top.category)
    .slice(0, 2)
    .map((s) => s.code);
  return { mainDirection: top.code, secondaryDirections: secondary, directionMatchScore: score };
}
