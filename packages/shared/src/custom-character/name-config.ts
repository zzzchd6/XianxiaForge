// ═══════════════════════════════════════════════════════════════════════════════
// 自定义人物模块 - 姓名生成配置库（附录B）
// ═══════════════════════════════════════════════════════════════════════════════

import type { RaceCategoryId } from './race-config.js';

/** 性别 */
export type Gender = 'male' | 'female';

/** 全局概率规则（结构四选一：精品成名/组内拼字/单字/辈分字，总和=1） */
export const NAME_GLOBAL_RULES = {
  /** 精品成名概率（从预写双字名池直接抽取整名） */
  curatedProb: 0.40,
  /** 双字拼字概率（同风格字组内搭配） */
  doubleCharProb: 0.35,
  /** 单字名概率 */
  singleCharProb: 0.15,
  /** 带辈分字概率（辈分字+单字） */
  generationCharProb: 0.10,
  /** 出道号概率（特殊小类可覆盖，如道门嫡传40%） */
  daoNameProb: 0.05,
  /** 出称号概率 */
  titleProb: 0.05,
} as const;

/** 全局禁用字（现代烂大街字，禁止出现在生成的姓名中） */
export const FORBIDDEN_NAME_CHARS = [
  '梓', '轩', '涵', '宇', '泽', '浩', '晨', '睿', '昊', '博',
  '瑞', '佳', '嘉', '欣', '怡', '馨', '予', '雨', '语', '可',
];

// ─── 风格体系（用于人设联动的轻度倾斜） ─────────────────────────────────────

/** 名字风格：清雅淡泊/凌厉杀伐/古朴厚重/华贵天潢/幽邃诡谲 */
export type NameStyleId = 'elegant' | 'fierce' | 'archaic' | 'noble' | 'dark';

export const NAME_STYLE_LABELS: Record<NameStyleId, string> = {
  elegant: '清雅',
  fierce: '凌厉',
  archaic: '古朴',
  noble: '华贵',
  dark: '幽邃',
};

/** 精品成名条目：[成名, 风格] */
export type CuratedGivenName = [string, NameStyleId];

// ─── 姓氏分层（常见70%/冷门25%/稀有复姓5%） ────────────────────────────────

export interface SurnameTiers {
  common: string[];
  uncommon: string[];
  rare: string[];
}

export const SURNAME_TIER_WEIGHTS = { common: 0.70, uncommon: 0.25, rare: 0.05 } as const;

export const SURNAME_TIERS: Record<RaceCategoryId, SurnameTiers> = {
  human: {
    common: ['萧', '林', '陈', '李', '张', '叶', '苏', '陆', '顾', '沈', '楚', '江', '谢', '宋', '刘', '赵', '周', '王', '孙', '吴', '郑', '杜', '韩', '秦', '许'],
    uncommon: ['燕', '聂', '宫', '洛', '商', '纪', '温', '白', '傅', '霍', '阮', '柳', '岑', '卫', '蔺', '祁', '桑', '简', '池', '蓝', '裴', '沐', '容'],
    rare: ['慕容', '独孤', '南宫', '司马', '百里', '东方', '上官', '长孙', '公孙', '令狐', '皇甫', '澹台', '闻人', '夏侯'],
  },
  demon_race: {
    common: ['胡', '白', '云', '花', '木', '石', '金', '青', '柳', '桃', '梅', '岚'],
    uncommon: ['敖', '苍', '羽', '鳞', '凤', '赤', '黑', '藤', '鹿', '雀'],
    rare: ['涂山', '青丘', '有苏', '陆吾'],
  },
  demon_king_race: {
    common: ['厉', '墨', '冥', '夜', '冷', '黑', '血', '仇'],
    uncommon: ['屠', '阴', '阎', '煞', '骨', '烬', '无', '殷'],
    rare: ['修罗', '夜叉', '罗刹'],
  },
  ghost_race: {
    common: ['阴', '司', '钟', '白', '聂', '宁'],
    uncommon: ['无', '鬼', '幽', '泉', '墟', '蒿'],
    rare: ['酆', '崔'],
  },
  spirit_race: {
    common: ['金', '木', '水', '火', '土', '石', '玉', '剑'],
    uncommon: ['钟', '鼎', '琴', '镜', '珮', '砚', '岫', '璇'],
    rare: ['太华', '昆吾', '若木'],
  },
  divine_race: {
    common: ['龙', '凤', '玄', '白', '麒', '陆', '姬', '姜'],
    uncommon: ['孔', '雷', '离', '昭', '烛', '曦'],
    rare: ['轩辕', '高阳', '重华', '有熊', '金天'],
  },
  hybrid_race: {
    common: ['萧', '白', '苏', '墨', '洛', '纪', '沐', '池'],
    uncommon: ['胡', '厉', '灵', '夜', '燕', '桑'],
    rare: ['慕容', '涂山'],
  },
};

// ─── 精品成名池（整名直接抽取，真实感上限来源） ───────────────────────────

export const GIVEN_NAME_POOLS: Record<RaceCategoryId, Record<Gender, CuratedGivenName[]>> = {
  human: {
    male: [
      ['惊蛰', 'elegant'], ['长风', 'elegant'], ['观澜', 'elegant'], ['听松', 'elegant'], ['见山', 'elegant'],
      ['闻溪', 'elegant'], ['卧云', 'elegant'], ['鹤归', 'elegant'], ['清晏', 'elegant'], ['竹隐', 'elegant'],
      ['既白', 'elegant'], ['栖迟', 'elegant'], ['云深', 'elegant'], ['知非', 'elegant'], ['若谷', 'elegant'],
      ['抱朴', 'archaic'], ['守拙', 'archaic'], ['九思', 'archaic'], ['无咎', 'archaic'], ['怀瑾', 'archaic'],
      ['承宗', 'archaic'], ['师古', 'archaic'], ['元朔', 'archaic'], ['从周', 'archaic'], ['敬亭', 'archaic'],
      ['破军', 'fierce'], ['惊雷', 'fierce'], ['拔山', 'fierce'], ['千仞', 'fierce'], ['燎原', 'fierce'],
      ['逐北', 'fierce'], ['横野', 'fierce'], ['铁衣', 'fierce'], ['折冲', 'fierce'], ['磨剑', 'fierce'],
      ['景曜', 'noble'], ['朝宗', 'noble'], ['华章', 'noble'], ['玉衡', 'noble'], ['少微', 'noble'], ['天枢', 'noble'],
      ['夜阑', 'dark'], ['归墟', 'dark'], ['玄夜', 'dark'], ['烬寒', 'dark'],
    ],
    female: [
      ['疏影', 'elegant'], ['青梧', 'elegant'], ['半夏', 'elegant'], ['未晞', 'elegant'], ['采薇', 'elegant'],
      ['清浅', 'elegant'], ['宛在', 'elegant'], ['若荷', 'elegant'], ['汀兰', 'elegant'], ['澄泓', 'elegant'],
      ['听荷', 'elegant'], ['卷舒', 'elegant'], ['眠棠', 'elegant'], ['初霁', 'elegant'], ['白苏', 'elegant'],
      ['静姝', 'archaic'], ['燕婉', 'archaic'], ['洵美', 'archaic'], ['清扬', 'archaic'], ['婉如', 'archaic'],
      ['舜华', 'archaic'], ['佩玖', 'archaic'], ['琼琚', 'archaic'], ['韶华', 'archaic'],
      ['璎珞', 'noble'], ['琅嬛', 'noble'], ['昭华', 'noble'], ['瑶光', 'noble'], ['扶光', 'noble'], ['明珰', 'noble'],
      ['红缨', 'fierce'], ['雪刃', 'fierce'], ['凛秋', 'fierce'], ['白霜', 'fierce'], ['惊鸿', 'fierce'], ['折霜', 'fierce'],
      ['忘川', 'dark'], ['曼陀', 'dark'], ['鸦青', 'dark'], ['落烬', 'dark'], ['蚀月', 'dark'], ['夜阑', 'dark'],
    ],
  },
  demon_race: {
    male: [
      ['千山', 'elegant'], ['踏月', 'elegant'], ['卷风', 'elegant'], ['饮涧', 'elegant'], ['眠云', 'elegant'],
      ['抱松', 'elegant'], ['苍梧', 'archaic'], ['青崖', 'archaic'], ['啸林', 'fierce'], ['逐鹿', 'fierce'],
    ],
    female: [
      ['采苓', 'elegant'], ['照水', 'elegant'], ['拂雪', 'elegant'], ['眠花', 'elegant'], ['灼灼', 'elegant'],
      ['青萝', 'elegant'], ['软枝', 'elegant'], ['杏烟', 'elegant'], ['含桃', 'elegant'], ['栖蝶', 'elegant'],
    ],
  },
  demon_king_race: {
    male: [
      ['噬渊', 'fierce'], ['断岳', 'fierce'], ['蚀骨', 'fierce'], ['玄煞', 'dark'], ['焚川', 'fierce'],
      ['灭明', 'dark'], ['覆潮', 'fierce'], ['枯荣', 'dark'], ['无殇', 'dark'], ['夜屠', 'dark'],
    ],
    female: [
      ['血鸢', 'dark'], ['夜绡', 'dark'], ['烬罗', 'dark'], ['冥犀', 'dark'], ['蚀月', 'dark'],
      ['幽荼', 'dark'], ['玄鸦', 'dark'], ['噬心', 'fierce'],
    ],
  },
  ghost_race: {
    male: [
      ['引魂', 'dark'], ['守灯', 'dark'], ['渡厄', 'dark'], ['枯灯', 'dark'], ['夜巡', 'dark'],
      ['寒鸦', 'dark'], ['断桥', 'dark'], ['蒿里', 'archaic'],
    ],
    female: [
      ['纸鸢', 'dark'], ['冥芜', 'dark'], ['忘归', 'dark'], ['烛泪', 'dark'], ['青骨', 'dark'], ['夜篝', 'dark'],
    ],
  },
  spirit_race: {
    male: [
      ['淬锋', 'fierce'], ['抱璞', 'archaic'], ['澄金', 'noble'], ['凝晖', 'elegant'], ['铸雪', 'elegant'],
      ['含章', 'archaic'], ['贞石', 'archaic'], ['鸣泉', 'elegant'],
    ],
    female: [
      ['流萤', 'elegant'], ['凝碧', 'elegant'], ['皎皎', 'elegant'], ['映雪', 'elegant'], ['温玉', 'noble'], ['采真', 'archaic'],
    ],
  },
  divine_race: {
    male: [
      ['曜灵', 'noble'], ['望舒', 'archaic'], ['扶光', 'noble'], ['重明', 'archaic'], ['烛照', 'noble'],
      ['承乾', 'noble'], ['青冥', 'archaic'], ['御风', 'elegant'], ['泰初', 'archaic'],
    ],
    female: [
      ['羲和', 'noble'], ['素商', 'archaic'], ['青要', 'archaic'], ['瑶光', 'noble'], ['婵媛', 'elegant'], ['云和', 'elegant'], ['皎月', 'elegant'],
    ],
  },
  hybrid_race: {
    male: [
      ['半山', 'elegant'], ['临渊', 'dark'], ['无归', 'dark'], ['栖野', 'elegant'], ['问尘', 'archaic'],
    ],
    female: [
      ['离离', 'elegant'], ['忽晚', 'elegant'], ['无双', 'fierce'], ['拾翠', 'elegant'], ['弄影', 'dark'],
    ],
  },
};

// ─── 风格字组（双字拼字仅在同组内搭配，避免风格打架） ───────────────────────

export const CHAR_STYLE_GROUPS: Record<RaceCategoryId, Record<Gender, Partial<Record<NameStyleId, string[]>>>> = {
  human: {
    male: {
      elegant: ['澈', '疏', '淮', '砚', '溪', '汀', '洲', '泠', '舟', '闲', '鹤', '云', '川', '之', '然', '辞', '安', '清'],
      fierce: ['锋', '决', '烈', '霆', '骁', '枭', '戈', '峥', '啸', '破', '斩', '燃'],
      archaic: ['衡', '尧', '岱', '垣', '铮', '韶', '珩', '琮', '璋', '岳', '崇', '巍', '鼎'],
      noble: ['瑾', '瑜', '琰', '璟', '珏', '琛', '煜', '曜', '玠', '宸'],
      dark: ['渊', '冥', '晦', '烬', '阙', '暝', '湮', '幽', '玄', '墨', '寒'],
    },
    female: {
      elegant: ['芷', '荇', '湄', '蘅', '素', '绡', '澄', '湘', '荷', '菱', '芜', '汀', '烟', '晚', '绾', '笙', '卿'],
      fierce: ['霜', '锐', '飒', '缨', '冽', '寒', '英', '决'],
      archaic: ['韶', '瑟', '磬', '璜', '瑗', '琬', '姝', '婉'],
      noble: ['璎', '珞', '琅', '璃', '玥', '珮', '琚', '瑄', '瑶'],
      dark: ['幽', '夜', '冥', '茕', '鸦', '蔓', '魅', '蛊'],
    },
  },
  demon_race: {
    male: {
      elegant: ['夭', '野', '鹤', '松', '竹', '青', '川', '闲', '尘', '默', '归', '云', '风'],
      fierce: ['啸', '奔', '威', '猛', '彪', '罴', '力', '峰'],
      dark: ['影', '雾', '暮', '霭'],
    },
    female: {
      elegant: ['花', '叶', '蕊', '珠', '玉', '翠', '音', '羽', '夭', '灵', '香', '苓', '萝', '棠'],
      dark: ['媚', '姣', '幽', '娆']
    },
  },
  demon_king_race: {
    male: {
      fierce: ['绝', '灭', '裂', '厉', '煞', '焚', '劫', '屠', '殇'],
      dark: ['冥', '夜', '烬', '渊', '骨', '寒', '无', '邪', '孤', '晦'],
    },
    female: {
      dark: ['媚', '骨', '幽', '姬', '夜', '煞', '娆', '烬', '冥', '邪'],
      fierce: ['九', '孤', '厉', '绝'],
    },
  },
  ghost_race: {
    male: {
      dark: ['魂', '魄', '阴', '幽', '冥', '煞', '无', '常', '泉', '烛'],
    },
    female: {
      dark: ['魂', '魄', '幽', '冥', '媚', '骨', '娘', '姬', '烛'],
    },
  },
  spirit_race: {
    male: {
      elegant: ['灵', '宝', '精', '元', '素', '清', '明', '澄', '莹', '皎'],
      noble: ['琳', '琅', '瑛', '玑'],
    },
    female: {
      elegant: ['灵', '宝', '精', '元', '素', '清', '明', '莹', '皎'],
      noble: ['琳', '琅', '瑛', '玑'],
    },
  },
  divine_race: {
    male: {
      noble: ['辰', '华', '天', '曜', '昭', '曦', '煌', '玑', '璇', '衡'],
      archaic: ['尧', '舜', '禹', '玄', '灵', '常', '羲', '和'],
    },
    female: {
      noble: ['华', '昭', '曦', '璇', '玑', '瑶', '琼', '霄'],
      archaic: ['韶', '羲', '娥', '素'],
    },
  },
  hybrid_race: {
    male: {
      elegant: ['尘', '渊', '玄', '夜', '灵', '默', '归', '川'],
    },
    female: {
      elegant: ['灵', '月', '幽', '汐', '夭', '素', '璃', '烟'],
    },
  },
};

/** 种族通用命名规则 */
export interface RaceNameRule {
  /** 通用姓氏池 */
  surnames: string[];
  /** 男名用字池 */
  maleChars: string[];
  /** 女名用字池 */
  femaleChars: string[];
  /** 辈分用字池（空数组=该族不用辈分字） */
  generationChars: string[];
  /** 男道号后缀 */
  maleDaoSuffixes: string[];
  /** 女道号后缀 */
  femaleDaoSuffixes: string[];
  /** 男称号后缀 */
  maleTitleSuffixes: string[];
  /** 女称号后缀 */
  femaleTitleSuffixes: string[];
}

/** 小类特殊命名规则（覆盖通用规则的部分字段） */
export interface SubNameRule {
  surnames?: string[];
  maleChars?: string[];
  femaleChars?: string[];
  /** 覆盖道号概率（如凡俗血脉仅5%） */
  daoNameProb?: number;
  /** 覆盖称号概率 */
  titleProb?: number;
  /** 覆盖辈分字概率（如修士世家40%） */
  generationCharProb?: number;
  /** 覆盖精品成名概率（凡俗血脉等土味小类设0，避免出现“张惊鸿”式违和） */
  curatedProb?: number;
  /** 覆盖道号后缀（男女共用时两者写同一份） */
  maleDaoSuffixes?: string[];
  femaleDaoSuffixes?: string[];
  maleTitleSuffixes?: string[];
  femaleTitleSuffixes?: string[];
}

/** 各种族大类通用命名规则 */
export const RACE_NAME_RULES: Record<RaceCategoryId, RaceNameRule> = {
  human: {
    surnames: ['萧', '林', '陈', '李', '张', '叶', '苏', '陆', '顾', '沈', '楚', '江', '谢', '宋', '刘', '赵', '朱', '王', '孙', '周'],
    maleChars: ['辰', '凡', '玄', '渊', '峰', '阳', '澈', '珩', '墨', '言', '舟', '川', '翊', '宸', '君', '瑾', '瑜', '寒', '清', '珏', '衍', '之', '然', '辞', '安'],
    femaleChars: ['清', '瑶', '月', '霜', '雪', '烟', '凝', '柔', '灵', '汐', '薇', '萱', '晚', '卿', '璃', '璎', '珞', '笙', '绾', '素', '鸢', '槿', '辞', '安'],
    generationChars: ['子', '仲', '叔', '伯', '少', '小', '明', '德', '承', '弘', '景', '广', '永', '传', '继', '昌', '荣', '华'],
    maleDaoSuffixes: ['子', '真人', '先生', '道长', '散人', '居士'],
    femaleDaoSuffixes: ['仙子', '仙姑', '夫人', '女冠'],
    maleTitleSuffixes: ['真人', '真君', '先生', '前辈', '剑仙'],
    femaleTitleSuffixes: ['仙子', '元君', '女侠', '女仙'],
  },
  demon_race: {
    surnames: ['胡', '敖', '苍', '王', '云', '白', '羽', '鳞', '木', '花', '石', '金', '凤', '赤', '青', '黑'],
    maleChars: ['夭', '野', '鹤', '松', '竹', '石', '青', '灵', '川', '闲', '尘', '默', '归', '月', '日', '星', '风', '云', '雪'],
    femaleChars: ['花', '叶', '蕊', '珠', '玉', '翠', '音', '羽', '鳞', '姣', '夭', '灵', '月', '风', '云', '春', '夏', '秋', '冬', '香'],
    generationChars: ['小', '大', '老', '少', '三', '四', '五', '六', '七', '八', '九'],
    maleDaoSuffixes: ['大王', '大圣', '老祖', '太爷', '爷爷', '妖王'],
    femaleDaoSuffixes: ['奶奶', '姥姥', '夫人', '娘子', '妖姬', '娘娘'],
    maleTitleSuffixes: ['大王', '大圣', '老祖', '太爷', '妖王'],
    femaleTitleSuffixes: ['奶奶', '姥姥', '夫人', '娘子', '妖姬', '娘娘'],
  },
  demon_king_race: {
    surnames: ['厉', '血', '屠', '墨', '阴', '冥', '阎', '仇', '煞', '骨', '冷', '黑', '夜', '烬', '无'],
    maleChars: ['绝', '冥', '夜', '烬', '渊', '裂', '骨', '寒', '厉', '无', '灭', '殇', '邪', '孤', '煞', '焚', '劫'],
    femaleChars: ['媚', '骨', '幽', '姬', '夜', '煞', '娆', '烬', '冥', '九', '邪', '孤'],
    generationChars: [],
    maleDaoSuffixes: ['魔尊', '魔君', '教主', '老祖', '魔将'],
    femaleDaoSuffixes: ['魔尊', '魔君', '教主', '老祖', '魔姬'],
    maleTitleSuffixes: ['魔尊', '魔君', '教主', '老祖', '魔将'],
    femaleTitleSuffixes: ['魔尊', '魔君', '教主', '老祖', '魔姬'],
  },
  ghost_race: {
    surnames: ['阴', '司', '钟', '白', '无', '鬼', '尸', '僵'],
    maleChars: ['魂', '魄', '阴', '幽', '冥', '煞', '尸', '僵', '无', '常'],
    femaleChars: ['魂', '魄', '幽', '冥', '媚', '骨', '娘', '婆', '姬'],
    generationChars: [],
    maleDaoSuffixes: ['鬼王', '阴帅', '无常', '尸王'],
    femaleDaoSuffixes: ['婆婆', '鬼姬', '阴娘'],
    maleTitleSuffixes: ['鬼王', '阴帅', '无常', '尸王'],
    femaleTitleSuffixes: ['婆婆', '鬼姬', '阴娘'],
  },
  spirit_race: {
    surnames: ['金', '木', '水', '火', '土', '剑', '钟', '鼎', '石', '玉'],
    maleChars: ['灵', '宝', '精', '元', '素', '清', '明'],
    femaleChars: ['灵', '宝', '精', '元', '素', '清', '明'],
    generationChars: [],
    maleDaoSuffixes: ['灵君', '精怪', '灵尊'],
    femaleDaoSuffixes: ['灵子', '灵姬', '精灵'],
    maleTitleSuffixes: ['灵君', '灵尊'],
    femaleTitleSuffixes: ['灵姬', '灵子'],
  },
  divine_race: {
    surnames: ['龙', '凤', '麒', '麟', '玄', '白', '孔', '陆', '轩辕', '公孙'],
    maleChars: ['辰', '华', '天', '帝', '君', '子', '阳'],
    femaleChars: ['华', '天', '后', '子', '阳', '辰'],
    generationChars: [],
    maleDaoSuffixes: ['神君', '圣子', '太子'],
    femaleDaoSuffixes: ['元君', '圣女', '公主'],
    maleTitleSuffixes: ['太子', '神君', '圣子'],
    femaleTitleSuffixes: ['公主', '元君', '圣女'],
  },
  hybrid_race: {
    // 混血种按占比高的种族姓氏规则命名，此处提供兜底池（实际生成时借用人族规则并混入两族用字）
    surnames: ['胡', '厉', '灵', '萧', '白', '夜', '苏', '墨'],
    maleChars: ['尘', '渊', '玄', '夜', '灵', '默', '归', '川'],
    femaleChars: ['灵', '月', '幽', '汐', '夭', '素', '璃', '烟'],
    generationChars: [],
    maleDaoSuffixes: ['子', '道长', '散人'],
    femaleDaoSuffixes: ['仙子', '娘子'],
    maleTitleSuffixes: ['前辈', '半仙'],
    femaleTitleSuffixes: ['仙子', '女侠'],
  },
};

/** 人族各小类特殊命名规则（其余族小类走大类通用规则） */
export const HUMAN_SUB_NAME_RULES: Record<string, SubNameRule> = {
  commoner: {
    surnames: ['张', '王', '李', '赵', '刘', '陈', '孙', '周'],
    maleChars: ['大', '二', '铁', '牛', '柱', '山', '石', '虎', '根', '旺'],
    femaleChars: ['花', '秀', '妞', '丫', '翠', '兰', '香', '菊', '梅', '杏'],
    daoNameProb: 0.05,
    titleProb: 0.05,
    curatedProb: 0,
  },
  cultivator_family: {
    surnames: ['萧', '林', '苏', '顾', '沈', '楚', '谢', '慕容', '欧阳', '上官'],
    maleChars: ['珩', '瑾', '瑜', '珏', '琛', '璟', '玠', '琰', '璋', '琮'],
    femaleChars: ['璎', '珞', '琬', '琳', '瑶', '璃', '玥', '珂', '瑗', '珮'],
    generationCharProb: 0.40,
  },
  taoist_disciple: {
    maleChars: ['清', '虚', '玄', '真', '一', '尘', '陵', '静', '朴', '素'],
    femaleChars: ['清', '虚', '玄', '素', '静', '凝', '尘', '真', '芷', '筠'],
    daoNameProb: 0.40,
  },
  demonic_cultivator: {
    surnames: ['厉', '血', '屠', '墨', '冥', '夜', '骨', '烬'],
    maleChars: ['绝', '冥', '烬', '煞', '渊', '殇', '邪', '孤', '灭', '劫'],
    femaleChars: ['幽', '姬', '媚', '烬', '煞', '娆', '冥', '邪'],
    maleDaoSuffixes: ['老祖', '魔君'],
    femaleDaoSuffixes: ['老祖', '魔姬'],
    maleTitleSuffixes: ['老祖', '魔君'],
    femaleTitleSuffixes: ['老祖', '魔姬'],
  },
  confucian_scholar: {
    surnames: ['孔', '孟', '朱', '程', '董', '温', '文', '谢'],
    maleChars: ['仁', '义', '礼', '智', '信', '诗', '书', '文', '言', '辞', '然', '君'],
    femaleChars: ['诗', '书', '雅', '文', '琴', '棋', '画', '墨', '静', '仪'],
    maleDaoSuffixes: ['先生', '大儒'],
    femaleDaoSuffixes: ['先生', '女史'],
    maleTitleSuffixes: ['先生', '大儒', '文公'],
    femaleTitleSuffixes: ['先生', '女史'],
  },
  military_warrior: {
    surnames: ['杨', '岳', '韩', '狄', '秦', '霍', '卫', '罗'],
    maleChars: ['锋', '刃', '战', '勇', '烈', '铁', '山', '威', '虎', '彪'],
    femaleChars: ['英', '红', '妆', '刃', '霜', '锐', '飒', '缨'],
    maleTitleSuffixes: ['将军', '杀神', '战神'],
    femaleTitleSuffixes: ['将军', '女帅', '红妆'],
  },
  overseas_cultivator: {
    surnames: ['云', '风', '海', '沧', '岛', '汪', '洋', '宁'],
    maleChars: ['海', '波', '潮', '闲', '游', '浪', '溟', '帆'],
    femaleChars: ['汐', '浪', '珠', '螺', '岚', '波', '澜', '滟'],
    maleDaoSuffixes: ['散人', '岛主'],
    femaleDaoSuffixes: ['散人', '岛主'],
    maleTitleSuffixes: ['散人', '岛主'],
    femaleTitleSuffixes: ['散人', '岛主'],
  },
  hermit_disciple: {
    surnames: ['无', '空', '尘', '隐', '莫', '忘', '了', '寂'],
    maleChars: ['忘', '了', '无', '归', '拙', '闲', '云', '寂', '默', '休'],
    femaleChars: ['忘', '无', '归', '静', '寂', '幽', '素', '云'],
    maleDaoSuffixes: ['山人', '隐者'],
    femaleDaoSuffixes: ['山人', '隐者'],
    maleTitleSuffixes: ['山人', '隐者'],
    femaleTitleSuffixes: ['山人', '隐者'],
  },
  artisan: {
    surnames: ['鲁', '班', '墨', '欧冶', '金', '石', '公输', '匠'],
    maleChars: ['锻', '铸', '炼', '巧', '工', '斧', '凿', '钧'],
    femaleChars: ['巧', '织', '绣', '纹', '钗', '镜', '珰', '环'],
    maleTitleSuffixes: ['神匠', '大师'],
    femaleTitleSuffixes: ['神匠', '大师', '巧手'],
  },
  shaman: {
    surnames: ['巫', '祝', '九黎', '蛊', '灵', '祭'],
    maleChars: ['巫', '祝', '蛊', '咒', '祭', '傩', '灵', '骨'],
    femaleChars: ['巫', '蛊', '咒', '灵', '婆', '姑', '祝', '媚'],
    maleTitleSuffixes: ['大巫', '神汉'],
    femaleTitleSuffixes: ['大巫', '神婆', '灵婆'],
  },
  merchant_cultivator: {
    surnames: ['沈', '万', '金', '钱', '陶', '白', '范', '吕'],
    maleChars: ['金', '银', '财', '宝', '富', '贵', '满', '堂', '通', '达'],
    femaleChars: ['金', '珠', '宝', '玉', '银', '巧', '盈', '珍'],
    maleTitleSuffixes: ['员外', '东家', '财神'],
    femaleTitleSuffixes: ['东家', '掌柜', '娘子'],
  },
};

/** 妖族各小类特殊命名规则 */
export const DEMON_SUB_NAME_RULES: Record<string, SubNameRule> = {
  beast_demon: {
    surnames: ['虎', '狼', '狐', '熊', '豹', '狮', '象', '猿'],
    maleChars: ['力', '风', '罴', '彪', '啸', '奔', '威', '猛'],
    femaleChars: ['媚', '儿', '娘', '姣', '婉', '灵', '绒', '雪'],
  },
  bird_demon: {
    surnames: ['云', '羽', '鹏', '鹤', '雕', '鸾', '雀', '燕'],
    maleChars: ['飞', '翔', '羽', '翼', '霄', '空', '风', '万里'],
    femaleChars: ['翎', '羽', '翠', '莺', '燕', '雀', '鸾', '凰'],
  },
  scale_demon: {
    surnames: ['敖', '鳞', '沧', '蛟', '龟', '鼍', '螭', '蜃'],
    maleChars: ['波', '涛', '浪', '潮', '渊', '溟', '洋', '澜'],
    femaleChars: ['珠', '波', '绡', '鲛', '澜', '汐', '涟', '滟'],
  },
  plant_demon: {
    surnames: ['木', '花', '桃', '柳', '松', '藤', '兰', '梅'],
    maleChars: ['公', '青', '荫', '柏', '槐', '榕', '朴', '楠'],
    femaleChars: ['夭', '花', '叶', '蕊', '朵', '芳', '菲', '蔓'],
  },
  insect_demon: {
    surnames: ['虫', '毒', '蛛', '蜂', '蝶', '蝎', '螳', '蛾'],
    maleChars: ['丝', '毒', '网', '螯', '针', '甲', '翅', '百眼'],
    femaleChars: ['儿', '丝', '娘子', '蝶', '纱', '姬', '翩', '蛊'],
  },
  aquatic_demon: {
    surnames: ['鱼', '虾', '蟹', '沧', '蚌', '鲤', '鲛', '龟'],
    maleChars: ['浪', '潮', '波', '涛', '溟', '渊', '将军', '力'],
    femaleChars: ['珠', '贝', '绡', '汐', '涟', '姬', '娘', '滟'],
  },
  auspicious_demon: {
    surnames: ['麒', '麟', '白', '泽', '瑞', '祥', '灵', '獬'],
    maleChars: ['瑞', '祥', '吉', '泽', '灵', '光', '昭', '明'],
    femaleChars: ['瑞', '祥', '灵', '昭', '瑾', '芝', '芸', '琪'],
  },
};

/** 合并后的有效命名规则（含结构概率、姓氏分层、精品名池与风格字组） */
export interface ResolvedNameRule extends RaceNameRule {
  daoNameProb: number;
  titleProb: number;
  generationCharProb: number;
  /** 精品成名概率（凡俗血脉等土味小类为0） */
  curatedProb: number;
  doubleCharProb: number;
  singleCharProb: number;
  /** 大类姓氏分层池（小类未覆盖姓氏时按权重抽层） */
  surnameTiers: SurnameTiers;
  /** 小类是否自定义了姓氏池（true时直接用surnames扁平池） */
  subSurnamesOverridden: boolean;
  /** 大类精品成名池 */
  curatedNames: Record<Gender, CuratedGivenName[]>;
  /** 大类风格字组（双字拼字仅同组内搭配） */
  charGroups: Record<Gender, Partial<Record<NameStyleId, string[]>>>;
  /** 小类是否自定义了拼字池（true时拼字用扁平池、不做风格倾斜） */
  subCharsOverridden: boolean;
}

/** 按大类+小类取合并后的有效命名规则 */
export function resolveNameRule(categoryId: RaceCategoryId, subId: string): ResolvedNameRule {
  const base = RACE_NAME_RULES[categoryId] ?? RACE_NAME_RULES.human;
  let sub: SubNameRule | undefined;
  if (categoryId === 'human') sub = HUMAN_SUB_NAME_RULES[subId];
  if (categoryId === 'demon_race') sub = DEMON_SUB_NAME_RULES[subId];
  return {
    surnames: sub?.surnames ?? base.surnames,
    maleChars: sub?.maleChars ?? base.maleChars,
    femaleChars: sub?.femaleChars ?? base.femaleChars,
    generationChars: base.generationChars,
    maleDaoSuffixes: sub?.maleDaoSuffixes ?? base.maleDaoSuffixes,
    femaleDaoSuffixes: sub?.femaleDaoSuffixes ?? base.femaleDaoSuffixes,
    maleTitleSuffixes: sub?.maleTitleSuffixes ?? base.maleTitleSuffixes,
    femaleTitleSuffixes: sub?.femaleTitleSuffixes ?? base.femaleTitleSuffixes,
    daoNameProb: sub?.daoNameProb ?? NAME_GLOBAL_RULES.daoNameProb,
    titleProb: sub?.titleProb ?? NAME_GLOBAL_RULES.titleProb,
    generationCharProb: sub?.generationCharProb ?? NAME_GLOBAL_RULES.generationCharProb,
    curatedProb: sub?.curatedProb ?? NAME_GLOBAL_RULES.curatedProb,
    doubleCharProb: NAME_GLOBAL_RULES.doubleCharProb,
    singleCharProb: NAME_GLOBAL_RULES.singleCharProb,
    surnameTiers: SURNAME_TIERS[categoryId] ?? SURNAME_TIERS.human,
    subSurnamesOverridden: !!sub?.surnames,
    curatedNames: GIVEN_NAME_POOLS[categoryId] ?? GIVEN_NAME_POOLS.human,
    charGroups: CHAR_STYLE_GROUPS[categoryId] ?? CHAR_STYLE_GROUPS.human,
    subCharsOverridden: !!(sub?.maleChars || sub?.femaleChars),
  };
}
