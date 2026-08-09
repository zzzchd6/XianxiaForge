/**
 * 自定义功法词条配置库（需求附录 A–M 结构化 + G1 道则兼容矩阵）
 * 供随机引擎（technique-random）、前端选择器、一致性审计共用。词条详情靠 ID 解析。
 * 核心设定：功法无绝对品级，只有对道则挖掘深度与运用技巧之别；九大本源道则为唯一底层根基。
 *
 * 数据缺口补齐（2026-07-30 授权按物理框架推导）：
 *  - 附录K 运用技巧：补 岁时/形质/灵气 三道则
 *  - 附录H 命名前缀意象：补 虚空/岁时/形质/灵气/神魂 五道则
 */

// ============================================================
// 基础类型
// ============================================================

export type DaoId =
  | 'gengjin' | 'kunearth' | 'thunder' | 'mingshi' | 'void'
  | 'suishi' | 'xingzhi' | 'lingqi' | 'shenhun';

export type DaoCompat = 'high' | 'mid' | 'clash';
export type GuidanceDepth = 'rudimentary' | 'complete' | 'essential';
export type StyleType = 'cultivate' | 'attack' | 'defense' | 'assist' | 'special';
export type DaoRealm = '入微' | '化境' | '合道' | '超脱';
export type Rarity = 'normal' | 'rare' | 'legendary';
export type BacklashCategory = 'normal' | 'forced' | 'longterm';

/** 道境四档（配套神通阶梯，与人物运行态境界解耦） */
export const DAO_REALMS: DaoRealm[] = ['入微', '化境', '合道', '超脱'];

// ============================================================
// 附录A：九大本源道则库
// ============================================================

export interface DaoRule {
  id: DaoId;
  name: string;
  essence: string;        // 科学本质（后端数据保留，前端不直显，13-SRS US-20b）
  xianxiaDesc: string;    // 仙侠风格描述（前端卡片主文案）
  trueIntent: string;     // 道则真意（前端 tooltip 悬停显示）
  attrs: string;          // 核心属性
  abilities: string;      // 典型能力方向
  fitMonk: string;        // 适配修士
  prefixes: string[];     // 命名前缀意象（附录H，含补齐）
}

export const DAO_RULES: DaoRule[] = [
  { id: 'gengjin', name: '庚金道则', essence: '强相互作用', xianxiaDesc: '锋锐之本，主杀伐', trueIntent: '万物至坚至锐之理', attrs: '锋锐、坚固、致密、塑形', abilities: '剑气杀伐、法宝淬炼、金属操控、肉身密度强化', fitMonk: '剑修、金系法修、器修、外门体修', prefixes: ['金', '锋', '剑', '锐'] },
  { id: 'kunearth', name: '坤土道则', essence: '万有引力', xianxiaDesc: '厚德载物，主镇压', trueIntent: '万有沉降之理', attrs: '厚重、承载、镇压、沉降', abilities: '岩土防御、重力镇压、地脉借力、肉身密度压缩', fitMonk: '土系法修、内家体修、阵法师、镇狱流', prefixes: ['地', '坤', '山', '岳'] },
  { id: 'thunder', name: '雷霆道则', essence: '电磁相互作用', xianxiaDesc: '阴阳相激，神速破邪', trueIntent: '阴阳相激、神速破邪之理', attrs: '迅捷、破坏、麻痹、涤荡', abilities: '雷击输出、高温灼烧、磁场御物、生物电淬体、光系术法', fitMonk: '雷修、火修、光修、磁修、雷淬体修', prefixes: ['雷', '电', '紫霄', '霆'] },
  { id: 'mingshi', name: '冥蚀道则', essence: '弱相互作用', xianxiaDesc: '衰朽崩坏，万物归虚', trueIntent: '衰朽崩坏、万物归虚之理', attrs: '腐朽、衰变、诅咒、侵蚀', abilities: '毒素侵染、物质腐朽、诅咒缠身、道基消融', fitMonk: '毒修、邪修、诅咒师、鬼道修士、尸修', prefixes: ['冥', '蚀', '幽', '秽'] },
  { id: 'void', name: '虚空道则', essence: '三维空间框架', xianxiaDesc: '上下四方，宇之所在', trueIntent: '上下四方、宇之所在', attrs: '折叠、瞬移、储物、封禁', abilities: '瞬移穿梭、空间切割、阵法封禁、储物空间', fitMonk: '空间修士、阵法师、遁修、封印师', prefixes: ['虚', '空', '界', '宇'] },
  { id: 'suishi', name: '岁时道则', essence: '时间维度', xianxiaDesc: '往古来今，宙之流转', trueIntent: '往古来今、宙之流转', attrs: '流速、回溯、预知、衰老', abilities: '时间变速、短暂预知、加速衰老、局部回溯修复', fitMonk: '时间修士、卜算师、推演流、因果修士', prefixes: ['岁', '时', '宙', '光阴'] },
  { id: 'xingzhi', name: '形质道则', essence: '物质本体', xianxiaDesc: '形形相易，万物之母', trueIntent: '形形相易、万物之母', attrs: '具象、转化、承载、肉身', abilities: '物质形变、元素转化、肉身重塑、凭空凝物', fitMonk: '体修、造化修士、炼器师、肉身成圣流', prefixes: ['形', '质', '造化', '玄'] },
  { id: 'lingqi', name: '灵气道则', essence: '能量本体', xianxiaDesc: '生生化化，万象之源', trueIntent: '生生化化、万象之源', attrs: '滋养、驱动、转化、爆发', abilities: '灵气吐纳、能量护盾、灵力爆发、属性能量转化', fitMonk: '正统法修、聚灵师、辅助修士、所有流派基础', prefixes: ['灵', '气', '元', '清'] },
  { id: 'shenhun', name: '神魂道则', essence: '信息与意识本体', xianxiaDesc: '灵台神明，主宰一切', trueIntent: '灵台神明、主宰一切', attrs: '感知、幻境、意志、传承', abilities: '神识探查、幻境困敌、意念御物、功法传承、记忆篡改', fitMonk: '魂修、幻术师、符修、丹师、剑修精神内核', prefixes: ['神', '魂', '意', '灵台'] },
];

export const DAO_IDS: DaoId[] = DAO_RULES.map(d => d.id);
const daoMap = new Map(DAO_RULES.map(d => [d.id, d]));
export const getDao = (id: string): DaoRule | undefined => daoMap.get(id as DaoId);

// ============================================================
// G1：道则兼容矩阵（按附录A科学本质物理推导，2026-07-30 定稿）
// 高兼容10 / 中兼容23 / 对冲3。默认中兼容，仅列高与冲。
// ============================================================

export const DAO_COMPAT_LABELS: Record<DaoCompat, string> = {
  high: '低风险·成熟稳定',
  mid: '中风险·威力可观',
  clash: '极高风险·逆天反噬',
};

const compatKey = (a: DaoId, b: DaoId) =>
  DAO_IDS.indexOf(a) < DAO_IDS.indexOf(b) ? `${a}|${b}` : `${b}|${a}`;

const CLASH_PAIRS: [DaoId, DaoId][] = [
  ['gengjin', 'kunearth'],   // 锋锐极 vs 厚重极（词条明示冲突）
  ['mingshi', 'xingzhi'],    // 衰变瓦解物质（成毁相冲）
  ['mingshi', 'lingqi'],     // 衰变吞噬生机（正邪相冲）
];
const HIGH_PAIRS: [DaoId, DaoId][] = [
  ['thunder', 'mingshi'],    // 电弱统一
  ['void', 'suishi'],        // 时空一体
  ['xingzhi', 'lingqi'],     // 质能等价
  ['gengjin', 'xingzhi'],    // 强作用塑物
  ['gengjin', 'lingqi'],     // 核能释放
  ['kunearth', 'xingzhi'],   // 引力成物
  ['thunder', 'xingzhi'],    // 电磁构物
  ['thunder', 'lingqi'],     // 电磁显能
  ['gengjin', 'shenhun'],    // 剑意凝真
  ['lingqi', 'shenhun'],     // 以意御气
];
const CLASH_SET = new Set(CLASH_PAIRS.map(([a, b]) => compatKey(a, b)));
const HIGH_SET = new Set(HIGH_PAIRS.map(([a, b]) => compatKey(a, b)));

/** 两道则兼容度（同条道则视为 mid，不属融合） */
export function daoCompat(a: DaoId, b: DaoId): DaoCompat {
  if (a === b) return 'mid';
  const k = compatKey(a, b);
  if (CLASH_SET.has(k)) return 'clash';
  if (HIGH_SET.has(k)) return 'high';
  return 'mid';
}

/** 给定主修道则，返回所有辅修候选的兼容标注（供前端第一步） */
export function compatWithMain(mainDao: DaoId): { id: DaoId; compat: DaoCompat }[] {
  return DAO_IDS.filter(d => d !== mainDao).map(d => ({ id: d, compat: daoCompat(mainDao, d) }));
}

/** 判断一组道则（主+辅）是否含对冲 */
export function hasClash(mainDao: DaoId, assistDao: DaoId[]): boolean {
  const all = [mainDao, ...assistDao];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      if (daoCompat(all[i], all[j]) === 'clash') return true;
  return false;
}

// ============================================================
// 附录B：传法指引深度（3档，非品级）
// ============================================================

export interface GuidanceLevel { id: GuidanceDepth; name: string; desc: string; position: string; weight: number; }

export const GUIDANCE_LEVELS: GuidanceLevel[] = [
  { id: 'rudimentary', name: '入门指引', desc: '只讲宏观运用，路径粗浅，门槛极低，上限全靠修行者自悟', position: '自己摸黑过河', weight: 60 },
  { id: 'complete', name: '完整传承', desc: '蕴含先辈修行心得与微观路径，修炼少走弯路，可稳定触达道则深层', position: '名师指路', weight: 30 },
  { id: 'essential', name: '直指本源', desc: '直接点明道则核心本质，对修士亲和度要求极高，修成可触及规则层面', position: '直指核心', weight: 10 },
];
const guidanceMap = new Map(GUIDANCE_LEVELS.map(g => [g.id, g]));
export const getGuidance = (id: string): GuidanceLevel | undefined => guidanceMap.get(id as GuidanceDepth);

// ============================================================
// 附录C：功法体例（5种）
// ============================================================

export interface TechniqueStyle {
  id: StyleType; name: string; position: string; feature: string;
  coreDirection: string[];   // 自动生成核心方向标签
  fitMonkHint: string;       // 适配修士倾向
}

export const STYLE_TYPES: TechniqueStyle[] = [
  { id: 'cultivate', name: '修炼类', position: '打基筑道，提升修为', feature: '侧重灵气运转、道则感悟，续航强、战力提升平缓', coreDirection: ['道基稳固', '灵气绵长', '感悟精深'], fitMonkHint: '求道问心之士' },
  { id: 'attack', name: '攻伐类', position: '破敌制胜，输出杀伤', feature: '侧重道则破坏力，爆发强、续航弱，反噬风险偏高', coreDirection: ['杀伐凌厉', '爆发绝伦', '一击制胜'], fitMonkHint: '好斗争锋之辈' },
  { id: 'defense', name: '防御类', position: '护体御敌，稳阵扛伤', feature: '侧重道则稳固性，生存强、输出弱，适合持久战', coreDirection: ['护体无双', '稳如磐石', '续航持久'], fitMonkHint: '稳重持正之修' },
  { id: 'assist', name: '辅助类', position: '增益控场，侦查支援', feature: '侧重道则附加效果，团队作用大，单兵战力一般', coreDirection: ['增益加持', '控场侦查', '团队枢纽'], fitMonkHint: '运筹辅佐之才' },
  { id: 'special', name: '特殊类', position: '偏门功用，特殊场景', feature: '遁法、幻术、诅咒、传承等非常规功用，泛用性低、针对性强', coreDirection: ['偏门奇诡', '出其不意', '针对克制'], fitMonkHint: '剑走偏锋之徒' },
];
const styleMap = new Map(STYLE_TYPES.map(s => [s.id, s]));
export const getStyle = (id: string): TechniqueStyle | undefined => styleMap.get(id as StyleType);

// ============================================================
// 附录D-1：本源运用方向（道则永久特质，多选2-3）
// ============================================================

export interface CoreTrait {
  id: string; name: string; desc: string;
  fitDao: DaoId[];          // 适配道则（空=通用）
  conflictTags: string[];   // 机器可读冲突组
  rarity: Rarity;
}

export const CORE_TRAITS: CoreTrait[] = [
  { id: 'sharp_gold', name: '锋锐破罡', desc: '庚金之力高度凝聚，专破护体罡气与金属护甲', fitDao: ['gengjin'], conflictTags: ['soft', 'heavy'], rarity: 'normal' },
  { id: 'heavy_earth', name: '重力镇压', desc: '引力场叠加压制，限制敌人身法与灵气运转', fitDao: ['kunearth'], conflictTags: ['light', 'swift'], rarity: 'normal' },
  { id: 'thunder_strike', name: '雷息麻痹', desc: '电磁之力附着攻击，命中可短暂麻痹经脉与神魂', fitDao: ['thunder'], conflictTags: ['yin', 'soft'], rarity: 'normal' },
  { id: 'decay_corrode', name: '腐朽消融', desc: '弱衰变之力渗透，持续瓦解物质结构与道基', fitDao: ['mingshi'], conflictTags: ['yang', 'life'], rarity: 'normal' },
  { id: 'space_shuttle', name: '虚空穿梭', desc: '空间折叠短距跃迁，身法与攻击角度变幻莫测', fitDao: ['void'], conflictTags: ['frontal'], rarity: 'normal' },
  { id: 'time_flow', name: '岁时流速', desc: '局部改变时间流速，或加速自身或延缓敌人', fitDao: ['suishi'], conflictTags: ['steady'], rarity: 'rare' },
  { id: 'form_reshape', name: '形质重塑', desc: '操控物质结构形变，可修复肉身也可改变兵器形态', fitDao: ['xingzhi'], conflictTags: ['pure_energy'], rarity: 'normal' },
  { id: 'spirit_burst', name: '灵气爆发', desc: '能量短时间集中释放，大幅提升单次攻击威力', fitDao: ['lingqi'], conflictTags: ['sustain'], rarity: 'normal' },
  { id: 'soul_will', name: '神魂加持', desc: '意志力量统御道则，操控精度与反应速度大幅提升', fitDao: ['shenhun'], conflictTags: ['brute'], rarity: 'normal' },
  { id: 'body_temper', name: '炼体固基', desc: '道则之力淬炼肉身，物理防御与力量显著提升', fitDao: ['xingzhi', 'kunearth'], conflictTags: ['pure_soul'], rarity: 'normal' },
  { id: 'sword_intent', name: '剑意凝真', desc: '庚金+神魂高度凝聚，剑意可直接伤及神魂', fitDao: ['gengjin', 'shenhun'], conflictTags: ['illusion', 'stealth'], rarity: 'rare' },
  { id: 'array_foundation', name: '阵道基理', desc: '虚空+神魂构建拓扑框架，可快速布下简易阵法', fitDao: ['void', 'shenhun'], conflictTags: ['frontal_burst'], rarity: 'rare' },
];
const coreTraitMap = new Map(CORE_TRAITS.map(t => [t.id, t]));
export const getCoreTrait = (id: string): CoreTrait | undefined => coreTraitMap.get(id);

// ============================================================
// 附录D-2：行功路线（路线永久特质，单选）
// ============================================================

export interface PracticePath { id: string; name: string; desc: string; risk: string; }

export const PRACTICE_PATHS: PracticePath[] = [
  { id: 'orthodox', name: '正统推演', desc: '循序渐进，根基扎实，反噬微弱，进阶速度平稳', risk: '低风险' },
  { id: 'reverse', name: '逆势反修', desc: '倒行逆施，进境神速，反噬强烈，易生心魔', risk: '高风险' },
  { id: 'fusion', name: '融合共生', desc: '多道则深度耦合，威力远超单门，失衡即重伤', risk: '中高风险' },
  { id: 'remnant', name: '残篇补全', desc: '功法残缺不全，需自行补全路径，上限极高下限极低', risk: '中风险' },
  { id: 'blood_pact', name: '血誓传承', desc: '以血脉为引修炼，同血脉者修行神速，外人难入门', risk: '中风险' },
  { id: 'fast_way', name: '旁门速法', desc: '剑走偏锋快速见效，根基虚浮，大境界突破易陨落', risk: '高风险' },
];
const practicePathMap = new Map(PRACTICE_PATHS.map(p => [p.id, p]));
export const getPracticePath = (id: string): PracticePath | undefined => practicePathMap.get(id);

// ============================================================
// 附录E：分道境配套神通（按道境四档分级，多选总限6-8）
// ============================================================

export interface Ability {
  id: string; name: string; daoRealm: DaoRealm; desc: string;
  fitDao: DaoId[];   // 适配道则（空=全道则通用）
}

export const ABILITIES: Ability[] = [
  // 入微境
  { id: 'gold_edge', name: '庚金附刃', daoRealm: '入微', desc: '道则之力附着兵器表面，提升锋锐度与破甲能力', fitDao: ['gengjin'] },
  { id: 'earth_shield', name: '岩土护罩', daoRealm: '入微', desc: '凝聚岩土形成简易护盾，抵挡基础物理攻击', fitDao: ['kunearth'] },
  { id: 'thunder_arc', name: '电弧游走', daoRealm: '入微', desc: '指尖迸发细碎电弧，命中造成轻微麻痹', fitDao: ['thunder'] },
  { id: 'void_step', name: '虚步挪移', daoRealm: '入微', desc: '短距空间挪移，可小幅规避攻击', fitDao: ['void'] },
  { id: 'spirit_shield_basic', name: '灵气护罩', daoRealm: '入微', desc: '凝聚稀薄灵气形成护盾，抵挡基础术法', fitDao: ['lingqi'] },
  { id: 'soul_probe', name: '神识探查', daoRealm: '入微', desc: '释放神识感知周遭环境，探查隐藏目标', fitDao: ['shenhun'] },
  // 化境
  { id: 'gold_sword_slash', name: '庚金剑气斩', daoRealm: '化境', desc: '凝聚庚金剑气离体劈砍，破甲能力大幅提升', fitDao: ['gengjin'] },
  { id: 'earth_gravity_cage', name: '重力囚笼', daoRealm: '化境', desc: '局部叠加引力场，禁锢敌人行动与灵气运转', fitDao: ['kunearth'] },
  { id: 'thunder_bolt', name: '紫霄神雷', daoRealm: '化境', desc: '引动雷霆轰击目标，附带麻痹与高温灼烧', fitDao: ['thunder'] },
  { id: 'erosion_curse', name: '冥蚀咒', daoRealm: '化境', desc: '释放衰变之力，持续侵蚀敌人体内生机', fitDao: ['mingshi'] },
  { id: 'void_blink', name: '虚空瞬闪', daoRealm: '化境', desc: '短距离空间跃迁，可规避攻击也可突袭', fitDao: ['void'] },
  { id: 'time_slow', name: '时流减缓', daoRealm: '化境', desc: '局部时间流速变慢，敌人动作大幅迟滞', fitDao: ['suishi'] },
  { id: 'form_heal', name: '形质回春', daoRealm: '化境', desc: '重塑肉身损伤，快速修复外伤与断骨', fitDao: ['xingzhi', 'lingqi'] },
  { id: 'soul_illusion', name: '神魂幻狱', daoRealm: '化境', desc: '制造神识幻境，困敌于意识之中', fitDao: ['shenhun'] },
  // 合道境
  { id: 'gold_domain', name: '庚金剑域', daoRealm: '合道', desc: '周身形成剑域，域内金属皆可为兵，锋锐度倍增', fitDao: ['gengjin', 'shenhun'] },
  { id: 'earth_domain', name: '坤土镇域', daoRealm: '合道', desc: '周身形成重力领域，域内敌人承受数倍重压', fitDao: ['kunearth'] },
  { id: 'thunder_body', name: '雷淬战体', daoRealm: '合道', desc: '雷电淬炼肉身，速度与力量短时爆发，周身遍布雷弧', fitDao: ['thunder', 'xingzhi'] },
  { id: 'space_cut', name: '裂空刃', daoRealm: '合道', desc: '空间裂隙凝成刀刃，无视大部分物理防御', fitDao: ['void', 'gengjin'] },
  { id: 'earth_armor', name: '坤土玄甲', daoRealm: '合道', desc: '岩土与引力凝为铠甲，防御力大幅提升', fitDao: ['kunearth', 'xingzhi'] },
  { id: 'soul_domain', name: '神魂天威', daoRealm: '合道', desc: '领域内神识压制，低阶修士直接心神震颤', fitDao: ['shenhun'] },
  // 超脱境
  { id: 'gold_rule', name: '金锐规则印', daoRealm: '超脱', desc: '暂时改写局部物质结构强度规则，无物不摧', fitDao: ['gengjin'] },
  { id: 'time_rewind', name: '时光回溯', daoRealm: '超脱', desc: '局部短时间回溯，修复损伤甚至逆转战局', fitDao: ['suishi'] },
  { id: 'void_world', name: '虚空小界', daoRealm: '超脱', desc: '开辟独立空间小世界，可困敌可藏身', fitDao: ['void'] },
  { id: 'dao_resonance', name: '道则共鸣', daoRealm: '超脱', desc: '自身与道则高度共鸣，所有招式威力翻倍', fitDao: [] },
];
const abilityMap = new Map(ABILITIES.map(a => [a.id, a]));
export const getAbility = (id: string): Ability | undefined => abilityMap.get(id);
export const abilitiesByRealm = (realm: DaoRealm): Ability[] => ABILITIES.filter(a => a.daoRealm === realm);

// ============================================================
// 附录F：反噬代价（3类，对冲融合强制≥1高风险+1长期风险）
// ============================================================

export interface Backlash {
  id: string; name: string; desc: string;
  category: BacklashCategory;   // normal常态/forced强行催动/longterm长期风险
  risk: string;                 // 低/中/中高/高/极高
  highRisk?: boolean;           // 是否高风险（供对冲强制绑定筛选）
}

export const BACKLASHES: Backlash[] = [
  { id: 'bone_ache', name: '经脉暗伤', desc: '长期修炼导致经脉暗损，阴雨天隐隐作痛', category: 'normal', risk: '低' },
  { id: 'mood_restless', name: '心绪不宁', desc: '道则相冲导致心境不稳，易烦躁动怒', category: 'normal', risk: '低' },
  { id: 'body_mark_bl', name: '道纹烙印', desc: '体表浮现对应道则纹路，无法隐匿，易被识破根底', category: 'normal', risk: '中' },
  { id: 'meridian_break', name: '经脉寸断', desc: '强行催动大招导致经脉碎裂，修为倒退', category: 'forced', risk: '中高', highRisk: true },
  { id: 'memory_loss', name: '记忆损耗', desc: '神魂过载导致部分记忆流失，次数越多遗忘越多', category: 'forced', risk: '中高', highRisk: true },
  { id: 'lifespan_drain', name: '寿元折损', desc: '透支本源换取力量，一次损耗数月至数年寿元', category: 'forced', risk: '高', highRisk: true },
  { id: 'dao_base_decay', name: '道基腐朽', desc: '长期修炼邪法，道基持续衰败，最终修为尽废', category: 'longterm', risk: '高', highRisk: true },
  { id: 'emotion_fade', name: '情感淡漠', desc: '道则侵蚀意识，情绪逐渐消失，最终沦为无情傀儡', category: 'longterm', risk: '极高', highRisk: true },
  { id: 'body_collapse', name: '肉身崩解', desc: '多道则长期冲突，最终肉身无法承载而崩解', category: 'longterm', risk: '极高', highRisk: true },
];
const backlashMap = new Map(BACKLASHES.map(b => [b.id, b]));
export const getBacklash = (id: string): Backlash | undefined => backlashMap.get(id);
export const backlashByCategory = (cat: BacklashCategory): Backlash[] => BACKLASHES.filter(b => b.category === cat);

// ============================================================
// 附录G：传承方式（单选）
// ============================================================

export interface Inheritance { id: string; name: string; desc: string; secrecy: string; }

export const INHERITANCES: Inheritance[] = [
  { id: 'oral', name: '口传心授', desc: '师徒口耳相传，无文字记载，极易失传', secrecy: '极高' },
  { id: 'jade_slip', name: '玉简刻录', desc: '刻录于灵玉玉简，需神识读取，可长期保存', secrecy: '中高' },
  { id: 'blood_seal', name: '血脉封印', desc: '封印于血脉之中，仅特定血脉后裔可解锁', secrecy: '极高' },
  { id: 'remnant_inh', name: '残篇散佚', desc: '散落于各地的残缺功法，需收集补全', secrecy: '低' },
  { id: 'sect_public', name: '宗门公传', desc: '宗门公开典籍，入门弟子皆可修习', secrecy: '极低' },
];
const inheritanceMap = new Map(INHERITANCES.map(i => [i.id, i]));
export const getInheritance = (id: string): Inheritance | undefined => inheritanceMap.get(id);

// ============================================================
// 附录I：适配门槛词条（4类，自动按道则+指引深度生成，可微调）
// ============================================================

export type ThresholdCategory = 'affinity' | 'body' | 'mind' | 'resource';

export interface ThresholdEntry { id: string; name: string; desc: string; category: ThresholdCategory; }

export const THRESHOLDS: ThresholdEntry[] = [
  { id: 'affinity_low', name: '低等亲和', desc: '需对应道则基础亲和度，几乎无门槛', category: 'affinity' },
  { id: 'affinity_mid', name: '中等亲和', desc: '需对应道则中等以上亲和度，杂灵根难以入门', category: 'affinity' },
  { id: 'affinity_high', name: '高等亲和', desc: '需对应道则上等亲和度，天赋不足者强行修炼必反噬', category: 'affinity' },
  { id: 'affinity_dual', name: '双道亲和', desc: '需主辅两道均达中等以上亲和，对冲功法需双上等', category: 'affinity' },
  { id: 'body_normal', name: '寻常体质', desc: '无需特殊体质，普通修士即可承载', category: 'body' },
  { id: 'body_strong', name: '强韧体质', desc: '需肉身基础强横，体弱修士易被道则反噬', category: 'body' },
  { id: 'body_soul_stable', name: '神魂稳固', desc: '需元神根基稳固，心神不坚者易走火入魔', category: 'body' },
  { id: 'mind_calm', name: '沉稳坚韧', desc: '需心境沉稳，急躁冒进者易出差错', category: 'mind' },
  { id: 'mind_fierce', name: '杀伐果断', desc: '需心性决绝，优柔寡断者威力大减', category: 'mind' },
  { id: 'mind_hidden', name: '隐忍内敛', desc: '需心性隐忍，张扬外放者易道则外泄', category: 'mind' },
  { id: 'res_normal', name: '常规资源', desc: '只需基础灵气环境即可修炼', category: 'resource' },
  { id: 'res_special', name: '特殊环境', desc: '需特定地脉环境（如雷泽、冰渊、矿脉）', category: 'resource' },
  { id: 'res_costly', name: '珍稀材料', desc: '需消耗珍稀灵材淬体/炼器，资源消耗巨大', category: 'resource' },
];
const thresholdMap = new Map(THRESHOLDS.map(t => [t.id, t]));
export const getThreshold = (id: string): ThresholdEntry | undefined => thresholdMap.get(id);
export const thresholdsByCategory = (cat: ThresholdCategory): ThresholdEntry[] => THRESHOLDS.filter(t => t.category === cat);

// ============================================================
// 附录J：身体印记（按道则自动匹配，4维度）
// ============================================================

export interface BodyMark { appearance: string; aura: string; behavior: string; breath: string; }

export const BODY_MARKS: Record<DaoId, BodyMark> = {
  gengjin: { appearance: '指节泛冷金属光泽，虎口掌心有薄茧如钢，眼含锐利之气', aura: '周身隐隐有锐利气场，草木靠近会自发断裂', behavior: '走路步幅稳定，出手精准，习惯用手指摩挲器物边缘', breath: '触碰带冰凉坚硬的金属质感，气息锋锐割人' },
  kunearth: { appearance: '掌心粗糙如岩石纹理，肩背宽厚，步伐沉稳', aura: '靠近者不自觉感到脚步沉重，周身气场厚重', behavior: '落地有声，站立时双脚抓地，习惯重心下沉', breath: '气息沉厚，脚下地面常有微不可察的沉降' },
  thunder: { appearance: '体表隐现淡紫色雷纹，发丝间偶有细碎电光', aura: '靠近时有轻微麻电感，心跳声如闷雷', behavior: '行动迅捷，情绪激动时周身噼啪作响', breath: '体温偏高，呼吸间带微弱电离感' },
  mingshi: { appearance: '肤色灰败偏青，指尖泛黑，眼窝深陷', aura: '周身带着若有若无的腐朽气息，草木触碰快速枯萎', behavior: '身影虚浮，走路无声，所过之处砖石微微风化', breath: '气息阴冷腐朽，令人心生不适' },
  void: { appearance: '周身光影微微扭曲，身影偶有极短重影', aura: '靠近产生空间错位错觉，仿佛不在同一平面', behavior: '移动时身形飘忽，仿佛随时会融入虚空', breath: '气息极淡，几乎难以捕捉位置' },
  suishi: { appearance: '气息飘忽不定，时而苍老时而稚嫩', aura: '对视会产生一瞬恍惚，仿佛时间错开', behavior: '动作节奏忽快忽慢，难以预判', breath: '周身时间流速与外界有微差' },
  xingzhi: { appearance: '身形匀称饱满，肌肤质感细腻却坚不可摧', aura: '周身物质感极强，碎石尘土会自发围绕转动', behavior: '举手投足带动周遭物质微微共鸣', breath: '气息厚重实在，给人脚踏实地之感' },
  lingqi: { appearance: '肌肤莹润有光泽，周身灵气氤氲', aura: '站在原地周遭灵气自发汇聚，形成肉眼可见漩涡', behavior: '呼吸间有灵气吞吐，吐纳节奏均匀', breath: '气息温润充沛，令人心生舒畅' },
  shenhun: { appearance: '面色偏苍白，眼神深邃有穿透力', aura: '被注视会产生「心事被看穿」的本能压迫感', behavior: '走路几乎无声，观察力极强，极少有情绪外露', breath: '气息极淡，却让人无法忽视其存在' },
};

// ============================================================
// 附录K：典型运用技巧（按道则，分常规/进阶/偏门）
// 含补齐：岁时/形质/灵气（2026-07-30 推导）
// ============================================================

export type SkillTier = 'routine' | 'advanced' | 'esoteric';
export const SKILL_TIER_LABELS: Record<SkillTier, string> = { routine: '常规用法', advanced: '进阶巧用', esoteric: '偏门奇招' };

export interface UsageSkill { id: string; dao: DaoId; tier: SkillTier; text: string; }

export const USAGE_SKILLS: UsageSkill[] = [
  // 庚金
  { id: 'gjin_r1', dao: 'gengjin', tier: 'routine', text: '凝聚剑气劈砍' },
  { id: 'gjin_r2', dao: 'gengjin', tier: 'routine', text: '强化兵器锋锐' },
  { id: 'gjin_r3', dao: 'gengjin', tier: 'routine', text: '淬炼金属法宝' },
  { id: 'gjin_a1', dao: 'gengjin', tier: 'advanced', text: '偏转敌方金属兵器' },
  { id: 'gjin_a2', dao: 'gengjin', tier: 'advanced', text: '压缩剑气提升穿透' },
  { id: 'gjin_a3', dao: 'gengjin', tier: 'advanced', text: '震动分子键切割' },
  { id: 'gjin_e1', dao: 'gengjin', tier: 'esoteric', text: '用庚金之力加固经脉' },
  { id: 'gjin_e2', dao: 'gengjin', tier: 'esoteric', text: '凝聚金针封堵穴位' },
  { id: 'gjin_e3', dao: 'gengjin', tier: 'esoteric', text: '打磨物体表面至镜面' },
  // 坤土
  { id: 'kth_r1', dao: 'kunearth', tier: 'routine', text: '凝聚土墙防御' },
  { id: 'kth_r2', dao: 'kunearth', tier: 'routine', text: '加重物体' },
  { id: 'kth_r3', dao: 'kunearth', tier: 'routine', text: '引地脉之力' },
  { id: 'kth_a1', dao: 'kunearth', tier: 'advanced', text: '引力偏转卸力而非硬扛' },
  { id: 'kth_a2', dao: 'kunearth', tier: 'advanced', text: '加重敌人衣物限制身法' },
  { id: 'kth_a3', dao: 'kunearth', tier: 'advanced', text: '借地脉隐匿身形' },
  { id: 'kth_e1', dao: 'kunearth', tier: 'esoteric', text: '用引力聚气' },
  { id: 'kth_e2', dao: 'kunearth', tier: 'esoteric', text: '局部微重力加速自身出拳' },
  { id: 'kth_e3', dao: 'kunearth', tier: 'esoteric', text: '沉降敌人脚下地面破坏平衡' },
  // 雷霆
  { id: 'thd_r1', dao: 'thunder', tier: 'routine', text: '引雷劈敌' },
  { id: 'thd_r2', dao: 'thunder', tier: 'routine', text: '麻痹对手' },
  { id: 'thd_r3', dao: 'thunder', tier: 'routine', text: '高温灼烧' },
  { id: 'thd_a1', dao: 'thunder', tier: 'advanced', text: '电磁脉冲干扰神识与阵法' },
  { id: 'thd_a2', dao: 'thunder', tier: 'advanced', text: '磁场操控金属御物' },
  { id: 'thd_a3', dao: 'thunder', tier: 'advanced', text: '生物电刺激肉身潜能' },
  { id: 'thd_e1', dao: 'thunder', tier: 'esoteric', text: '用电磁波探测隐身目标' },
  { id: 'thd_e2', dao: 'thunder', tier: 'esoteric', text: '电磁屏蔽隔绝神识' },
  { id: 'thd_e3', dao: 'thunder', tier: 'esoteric', text: '光折射制造视觉隐身' },
  // 冥蚀
  { id: 'msh_r1', dao: 'mingshi', tier: 'routine', text: '毒素侵蚀' },
  { id: 'msh_r2', dao: 'mingshi', tier: 'routine', text: '腐朽物质' },
  { id: 'msh_r3', dao: 'mingshi', tier: 'routine', text: '诅咒缠身' },
  { id: 'msh_a1', dao: 'mingshi', tier: 'advanced', text: '定向衰变指定器官' },
  { id: 'msh_a2', dao: 'mingshi', tier: 'advanced', text: '缓慢瓦解敌方道基' },
  { id: 'msh_a3', dao: 'mingshi', tier: 'advanced', text: '阴煞之气扰乱心神' },
  { id: 'msh_e1', dao: 'mingshi', tier: 'esoteric', text: '用衰变加速物质分解毁尸灭迹' },
  { id: 'msh_e2', dao: 'mingshi', tier: 'esoteric', text: '低剂量辐射缓慢消耗敌人生机' },
  // 虚空
  { id: 'vod_r1', dao: 'void', tier: 'routine', text: '瞬移穿梭' },
  { id: 'vod_r2', dao: 'void', tier: 'routine', text: '储物收纳' },
  { id: 'vod_r3', dao: 'void', tier: 'routine', text: '空间切割' },
  { id: 'vod_a1', dao: 'void', tier: 'advanced', text: '空间折叠压缩攻击范围' },
  { id: 'vod_a2', dao: 'void', tier: 'advanced', text: '曲率偏转规避伤害' },
  { id: 'vod_a3', dao: 'void', tier: 'advanced', text: '拓扑闭环困敌' },
  { id: 'vod_e1', dao: 'void', tier: 'esoteric', text: '空间褶皱藏物' },
  { id: 'vod_e2', dao: 'void', tier: 'esoteric', text: '短距空间跃迁出剑' },
  { id: 'vod_e3', dao: 'void', tier: 'esoteric', text: '折叠空间延长攻击距离' },
  // 神魂
  { id: 'shn_r1', dao: 'shenhun', tier: 'routine', text: '神识探查' },
  { id: 'shn_r2', dao: 'shenhun', tier: 'routine', text: '幻境困敌' },
  { id: 'shn_r3', dao: 'shenhun', tier: 'routine', text: '意念御物' },
  { id: 'shn_a1', dao: 'shenhun', tier: 'advanced', text: '修改环境细节制造认知偏差' },
  { id: 'shn_a2', dao: 'shenhun', tier: 'advanced', text: '干扰平衡感使人眩晕' },
  { id: 'shn_a3', dao: 'shenhun', tier: 'advanced', text: '植入虚假记忆碎片' },
  { id: 'shn_e1', dao: 'shenhun', tier: 'esoteric', text: '用神识传音密语' },
  { id: 'shn_e2', dao: 'shenhun', tier: 'esoteric', text: '感知他人情绪波动' },
  { id: 'shn_e3', dao: 'shenhun', tier: 'esoteric', text: '模拟他人气息迷惑敌人' },
  // 岁时（补齐）
  { id: 'sui_r1', dao: 'suishi', tier: 'routine', text: '局部时间变速' },
  { id: 'sui_r2', dao: 'suishi', tier: 'routine', text: '短暂预知未来' },
  { id: 'sui_r3', dao: 'suishi', tier: 'routine', text: '加速伤口衰老或愈合' },
  { id: 'sui_a1', dao: 'suishi', tier: 'advanced', text: '延缓敌人动作' },
  { id: 'sui_a2', dao: 'suishi', tier: 'advanced', text: '回溯修复破损物品' },
  { id: 'sui_a3', dao: 'suishi', tier: 'advanced', text: '加速自身修炼进程' },
  { id: 'sui_e1', dao: 'suishi', tier: 'esoteric', text: '用时间流速差藏物保鲜' },
  { id: 'sui_e2', dao: 'suishi', tier: 'esoteric', text: '局部回溯抹除痕迹' },
  { id: 'sui_e3', dao: 'suishi', tier: 'esoteric', text: '预判敌方招式轨迹' },
  // 形质（补齐）
  { id: 'xzh_r1', dao: 'xingzhi', tier: 'routine', text: '改变物质形态' },
  { id: 'xzh_r2', dao: 'xingzhi', tier: 'routine', text: '修复破损器物' },
  { id: 'xzh_r3', dao: 'xingzhi', tier: 'routine', text: '强化肉身硬度' },
  { id: 'xzh_a1', dao: 'xingzhi', tier: 'advanced', text: '元素转化（石化/金属化）' },
  { id: 'xzh_a2', dao: 'xingzhi', tier: 'advanced', text: '凭空凝物' },
  { id: 'xzh_a3', dao: 'xingzhi', tier: 'advanced', text: '重塑肉身断肢' },
  { id: 'xzh_e1', dao: 'xingzhi', tier: 'esoteric', text: '改变敌方兵器材质使其脆化' },
  { id: 'xzh_e2', dao: 'xingzhi', tier: 'esoteric', text: '将空气凝为屏障' },
  { id: 'xzh_e3', dao: 'xingzhi', tier: 'esoteric', text: '转化毒素为无害物质' },
  // 灵气（补齐）
  { id: 'lqi_r1', dao: 'lingqi', tier: 'routine', text: '灵气吐纳续航' },
  { id: 'lqi_r2', dao: 'lingqi', tier: 'routine', text: '凝聚能量护盾' },
  { id: 'lqi_r3', dao: 'lingqi', tier: 'routine', text: '灵力爆发增幅' },
  { id: 'lqi_a1', dao: 'lingqi', tier: 'advanced', text: '属性能量转化' },
  { id: 'lqi_a2', dao: 'lingqi', tier: 'advanced', text: '抽取环境灵气补给' },
  { id: 'lqi_a3', dao: 'lingqi', tier: 'advanced', text: '灵气共振引爆' },
  { id: 'lqi_e1', dao: 'lingqi', tier: 'esoteric', text: '用灵气模拟他属性能量' },
  { id: 'lqi_e2', dao: 'lingqi', tier: 'esoteric', text: '布设灵气陷阱' },
  { id: 'lqi_e3', dao: 'lingqi', tier: 'esoteric', text: '以灵气滋养灵材催熟' },
];
const usageSkillMap = new Map(USAGE_SKILLS.map(s => [s.id, s]));
export const getUsageSkill = (id: string): UsageSkill | undefined => usageSkillMap.get(id);
export const usageSkillsByDao = (dao: DaoId): UsageSkill[] => USAGE_SKILLS.filter(s => s.dao === dao);

// ============================================================
// 附录L：演化方向（3类创法路径，预设2-3个）
// ============================================================

export type EvolutionType = 'deepen' | 'crossover' | 'crisis';
export const EVOLUTION_TYPE_LABELS: Record<EvolutionType, string> = { deepen: '推演深化', crossover: '跨界融合', crisis: '绝境异变' };

export interface Evolution { id: string; name: string; desc: string; type: EvolutionType; }

export const EVOLUTIONS: Evolution[] = [
  { id: 'optimize_efficiency', name: '运转优化', desc: '优化道则运转路径，同等灵力下威力提升三成', type: 'deepen' },
  { id: 'micro_control', name: '微观精控', desc: '深入微观操控，招式精细化，可完成更复杂操作', type: 'deepen' },
  { id: 'sustain_boost', name: '续航强化', desc: '优化能量利用效率，持续作战能力大幅提升', type: 'deepen' },
  { id: 'fusion_thunder', name: '融雷变式', desc: '叠加雷霆道则，招式附加麻痹与高温效果', type: 'crossover' },
  { id: 'fusion_void', name: '融空变式', desc: '叠加虚空道则，招式附带空间属性与瞬移效果', type: 'crossover' },
  { id: 'fusion_soul', name: '融神变式', desc: '叠加神魂道则，招式附带神识攻击与意志压制', type: 'crossover' },
  { id: 'life_burn', name: '燃命异变', desc: '燃烧寿元换取短时暴增威力，事后代价沉重', type: 'crisis' },
  { id: 'dao_riot', name: '道则暴走', desc: '生死关头道则失控暴走，威力翻倍但自身也受重创', type: 'crisis' },
  { id: 'exclusive_skill', name: '本命神通', desc: '绝境中催生出专属本命神通，独一无二不可复制', type: 'crisis' },
];
const evolutionMap = new Map(EVOLUTIONS.map(e => [e.id, e]));
export const getEvolution = (id: string): Evolution | undefined => evolutionMap.get(id);

// ============================================================
// 附录M：先天矛盾（稀有戏剧冲突，随机10%触发，单选可选）
// ============================================================

export type ConflictType = 'evil_guise' | 'transfer' | 'binding' | 'curse';
export const CONFLICT_TYPE_LABELS: Record<ConflictType, string> = { evil_guise: '正邪外衣型', transfer: '代价转移型', binding: '绑定型', curse: '诅咒型' };

export interface InherentConflict { id: string; name: string; type: ConflictType; desc: string; }

export const INHERENT_CONFLICTS: InherentConflict[] = [
  { id: 'evil_inside', name: '正道魔心', type: 'evil_guise', desc: '表面是正统功法，底层掺有冥蚀衰变之力，修炼越深肉身衰败越快' },
  { id: 'transfer_damage', name: '伤己渡人', type: 'transfer', desc: '治愈类功法，每救一人便将对方伤势转移到自己身上' },
  { id: 'enemy_blood', name: '仇敌血脉', type: 'binding', desc: '对冲融合功法，必须与特定仇族血脉共同修炼才能稳定道则冲突' },
  { id: 'kill_grow', name: '杀业缠身', type: 'curse', desc: '威力随杀人数提升，但杀业越重心神越容易被道则吞噬' },
  { id: 'fame_curse', name: '名高劫重', type: 'curse', desc: '功法威名越盛、修炼者名气越大，天劫与反噬越强' },
  { id: 'dao_seal', name: '道则自封', type: 'binding', desc: '功法威力越强，对道则的感知反而越迟钝，最终困于瓶颈永无精进' },
];
const inherentConflictMap = new Map(INHERENT_CONFLICTS.map(c => [c.id, c]));
export const getInherentConflict = (id: string): InherentConflict | undefined => inherentConflictMap.get(id);

// ============================================================
// 附录H：命名规则（前缀意象按道则 + 后缀按指引深度 + 禁用词）
// ============================================================

export const DEPTH_NAME_SUFFIX: Record<GuidanceDepth, string[]> = {
  rudimentary: ['诀', '法', '功'],
  complete: ['经', '典', '录'],
  essential: ['真解', '玄功'],
};

export const NAME_FORBIDDEN = ['天级', '神级', '上品', '下品', '极品', '圣级', '帝级', '无敌', '超级'];

/** 确定性名号生成（零token模板拼接）：前缀意象 + 体例/道则核心字 + 深度后缀 */
export function generateTechniqueName(mainDao: DaoId, depth: GuidanceDepth, styleType?: StyleType): string {
  const dao = getDao(mainDao);
  const prefixes = dao?.prefixes || ['玄'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffixes = DEPTH_NAME_SUFFIX[depth];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  // 体例核心字点缀
  const styleChar: Record<StyleType, string[]> = {
    cultivate: ['元', '玄', '真'],
    attack: ['煞', '绝', '破'],
    defense: ['罡', '镇', '固'],
    assist: ['灵', '辅', '佑'],
    special: ['诡', '秘', '幻'],
  };
  const mid = styleType ? styleChar[styleType][Math.floor(Math.random() * 3)] : '';
  return `${prefix}${mid}${suffix}`;
}

// ============================================================
// 随机权重常量（需求五.1）
// ============================================================

/** 辅修兼容随机权重（G1 定稿：高:中:冲 = 60:35:5） */
export const COMPAT_WEIGHT: Record<DaoCompat, number> = { high: 60, mid: 35, clash: 5 };
/** 稀有度权重（先天矛盾/稀有异变 10%，进阶 30%，基础 60%） */
export const RARITY_WEIGHT: Record<Rarity, number> = { normal: 60, rare: 30, legendary: 10 };
/** 指引深度权重取自 GUIDANCE_LEVELS.weight（60/30/10） */
/** 先天矛盾触发概率 10% */
export const CONFLICT_TRIGGER_RATE = 0.10;
