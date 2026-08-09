/**
 * 自定义武器词条配置库（附录A/B/C/D 结构化）
 * 供随机引擎、前端选择器、一致性审计共用。特质详情靠 ID 解析。
 */

export type Rarity = 'normal' | 'rare' | 'legendary'

/** 武器形制（附录A二级） */
export interface WeaponForm {
  id: string
  name: string
  desc: string
  fitMonk: string          // 适配修士
  coreDirection: string[]  // 核心方向标签
}

/** 武器门类（附录A一级） */
export interface WeaponCategory {
  id: string
  name: string
  desc: string
  forms: WeaponForm[]
}

/** 基础材质（附录B） */
export interface WeaponMaterial {
  id: string
  name: string
  desc: string
  fit: string        // 适配形制（原文描述）
  rarity: Rarity
}

/** 强化特质词条（附录C-1~C-4） */
export interface WeaponTrait {
  id: string
  name: string
  desc: string
  fit: string                 // 适配形制（原文描述）
  conflictTags: string[]      // 机器可读冲突组标签（见下方词汇表），无冲突则为 []
  rarity: Rarity
}

/** 本命祭炼层级（附录D） */
export interface SoulRefineLevel {
  id: string
  name: string
  desc: string
}

/** 底蕴层级6档（与成长工坊品级体系统一） */
export const GRADES = ['凡造', '灵淬', '宝胎', '道纹', '仙蜕', '神蕴'] as const

/** 各底蕴层级的窍藏内嵌数量上限（需求第三步规则） */
export const CAVITY_LIMIT: Record<string, number> = {
  '凡造': 1, '灵淬': 2, '宝胎': 3, '道纹': 4, '仙蜕': 4, '神蕴': 4,
}

export const CATEGORIES: WeaponCategory[] = [
  {
    id: 'martial',
    name: '武道兵刃',
    desc: '肢体延伸，技法为尊，威力核心取决于使用者修为与武技',
    forms: [
      {
        id: 'short_sword',
        name: '短兵·剑',
        desc: '单刃/双刃短剑，灵活迅捷，剑修主流',
        fitMonk: '剑修、暗杀修士',
        coreDirection: ['破罡', '迅捷', '剑意承载'],
      },
      {
        id: 'short_blade',
        name: '短兵·刀',
        desc: '短刀、匕首，近身劈刺，招式狠辣',
        fitMonk: '刀修、刺客、散修',
        coreDirection: ['破甲', '放血', '便携'],
      },
      {
        id: 'long_spear',
        name: '长兵·枪',
        desc: '长柄穿刺兵器，一寸长一寸强',
        fitMonk: '军修、体修、战修',
        coreDirection: ['破甲', '重势', '范围穿刺'],
      },
      {
        id: 'long_staff',
        name: '长兵·棍',
        desc: '无锋长棍，重势不重刃，软硬兼施',
        fitMonk: '武僧、体修、宗门弟子',
        coreDirection: ['震击', '卸力', '范围扫击'],
      },
      {
        id: 'heavy_mace',
        name: '奇兵·狼牙棒',
        desc: '带齿重棒，钝击+撕裂双重伤害',
        fitMonk: '力量型体修、魔修',
        coreDirection: ['震击', '撕裂', '破甲'],
      },
      {
        id: 'heavy_hammer',
        name: '奇兵·重锤',
        desc: '纯钝击重兵器，专破硬甲与护体罡气',
        fitMonk: '体修、力修',
        coreDirection: ['碎骨', '震晕', '破罡'],
      },
      {
        id: 'whip_chain',
        name: '奇兵·软鞭',
        desc: '软兵链鞭，可缠可抽，招式诡异',
        fitMonk: '旁门修士、女修',
        coreDirection: ['锁缚', '抽裂', '远程牵制'],
      },
      {
        id: 'long_bow',
        name: '远射·弓',
        desc: '远程袭杀，可加持灵气与咒印',
        fitMonk: '弓修、暗杀修士',
        coreDirection: ['破甲', '追踪', '远程'],
      },
      {
        id: 'hidden_dart',
        name: '远射·袖箭',
        desc: '隐蔽暗器，近身突发，防不胜防',
        fitMonk: '刺客、散修',
        coreDirection: ['破罡', '淬毒', '突袭'],
      },
    ],
  },
  {
    id: 'taoist',
    name: '玄门法宝',
    desc: '禁制为核，正统仙家，注入灵力即可催发神通',
    forms: [
      {
        id: 'flying_sword',
        name: '攻伐·飞剑',
        desc: '神识御使，千里取首，法修标配',
        fitMonk: '剑修、法修、道门弟子',
        coreDirection: ['穿透', '分化', '远距攻伐'],
      },
      {
        id: 'seal_print',
        name: '镇压·法印',
        desc: '重宝镇压，可封禁敌人、镇守气运',
        fitMonk: '宗门长老、道修',
        coreDirection: ['重压', '封禁', '镇气运'],
      },
      {
        id: 'treasure_bell',
        name: '镇压·宝钟',
        desc: '音攻+防御一体，声波可震散神魂',
        fitMonk: '佛门、道门镇守者',
        coreDirection: ['镇魂', '护体', '范围音攻'],
      },
      {
        id: 'spirit_mirror',
        name: '辅助·法镜',
        desc: '可照邪祟、破幻术、反打术法',
        fitMonk: '辅助修士、丹符修',
        coreDirection: ['照邪', '反震', '探测'],
      },
      {
        id: 'gourd_vase',
        name: '辅助·葫芦',
        desc: '收纳、炼丹、喷吐术法，功能多样',
        fitMonk: '丹修、散修、法修',
        coreDirection: ['收纳', '聚灵', '属性喷吐'],
      },
      {
        id: 'shield_armor',
        name: '防御·宝盾',
        desc: '主动护体，硬抗术法与物理攻击',
        fitMonk: '体修、辅助修士',
        coreDirection: ['卸力', '纳法', '抗劫'],
      },
      {
        id: 'jade_pendant',
        name: '防御·玉佩',
        desc: '被动护主，自动抵挡一次致命伤害',
        fitMonk: '全修士通用',
        coreDirection: ['护魂', '挡灾', '聚气'],
      },
    ],
  },
  {
    id: 'demonic',
    name: '邪道魔兵',
    desc: '祭炼吞噬，凶煞霸道，威力与反噬风险成正比',
    forms: [
      {
        id: 'demon_blade',
        name: '魔器·魔刀',
        desc: '魔气淬炼，嗜血狂暴，越战越勇',
        fitMonk: '魔修、邪修',
        coreDirection: ['嗜血', '腐蚀', '乱神'],
      },
      {
        id: 'soul_flag',
        name: '鬼器·魂幡',
        desc: '聚生魂阴气，可释放魂潮、斩神魂',
        fitMonk: '鬼修、旁门散修',
        coreDirection: ['斩魂', '召鬼', '迷魄'],
      },
      {
        id: 'blood_crystal',
        name: '血兵·血晶针',
        desc: '精血祭养，细小隐蔽，穿透性极强',
        fitMonk: '血修、刺客',
        coreDirection: ['吸血', '破罡', '狂暴'],
      },
      {
        id: 'bone_claw',
        name: '鬼器·白骨爪',
        desc: '白骨炼制，阴寒刺骨，专伤神魂',
        fitMonk: '鬼修、邪修',
        coreDirection: ['蚀魂', '阴寒', '撕裂'],
      },
      {
        id: 'poison_urn',
        name: '蛊毒·蛊壶',
        desc: '饲养毒虫，散播瘟疫，范围杀伤',
        fitMonk: '毒修、蛊修',
        coreDirection: ['殖蛊', '下毒', '范围扩散'],
      },
      {
        id: 'corpse_nail',
        name: '蛊毒·尸煞钉',
        desc: '尸气淬炼，中者尸变，阴毒无比',
        fitMonk: '邪修、尸修',
        coreDirection: ['尸变', '溃脉', '破防'],
      },
    ],
  },
  {
    id: 'strange',
    name: '奇物异宝',
    desc: '形态无定，妙用无方，靠特殊材质与规则制敌',
    forms: [
      {
        id: 'meteorite_iron',
        name: '天地奇物·陨铁',
        desc: '天外陨铁，沉重坚硬，自带破罡之效',
        fitMonk: '散修、力修',
        coreDirection: ['破罡', '重势', '御邪'],
      },
      {
        id: 'thunder_bead',
        name: '天地奇物·雷珠',
        desc: '雷霆之力凝聚，催动可爆发雷劫',
        fitMonk: '雷修、法修',
        coreDirection: ['雷击', '麻痹', '破邪'],
      },
      {
        id: 'copper_coin',
        name: '日常化物·铜钱',
        desc: '落宝奇效，可刷落对方法宝禁制',
        fitMonk: '散修、怪杰',
        coreDirection: ['落宝', '破禁', '聚财'],
      },
      {
        id: 'writing_brush',
        name: '日常化物·毛笔',
        desc: '以文入道，写字可引动灵力成阵',
        fitMonk: '儒修、文修',
        coreDirection: ['言出法随', '画阵', '镇魂'],
      },
      {
        id: 'demon_core',
        name: '肉身异宝·妖丹',
        desc: '妖兽内丹，蕴含本命神通，可催动爆发',
        fitMonk: '妖修、散修',
        coreDirection: ['属性爆发', '聚灵', '本命神通'],
      },
      {
        id: 'life_plate',
        name: '因果类·命牌',
        desc: '勾连命数，可断人寿元、消灾挡劫',
        fitMonk: '卜道修士、邪修',
        coreDirection: ['勾命', '挡灾', '因果牵连'],
      },
    ],
  },
  {
    id: 'array',
    name: '阵道器符',
    desc: '组合生效，覆盖极广，群战与战略价值拉满',
    forms: [
      {
        id: 'array_flag',
        name: '阵法·阵旗',
        desc: '布阵核心，插下即可形成杀阵/困阵',
        fitMonk: '阵修、宗门战阵',
        coreDirection: ['困敌', '杀伐', '聚灵'],
      },
      {
        id: 'array_disk',
        name: '阵法·阵盘',
        desc: '便携阵法，催动即触发，无需布置',
        fitMonk: '散修、出行修士',
        coreDirection: ['瞬发', '防御', '迷踪'],
      },
      {
        id: 'organ_puppet',
        name: '机关·傀儡',
        desc: '机关造物，可自主作战，无需操控',
        fitMonk: '器修、宗门镇守',
        coreDirection: ['近战', '抗伤', '批量作战'],
      },
      {
        id: 'fire_talisman',
        name: '符箓·攻击符',
        desc: '一次性消耗品，瞬发术法攻击',
        fitMonk: '全修士通用',
        coreDirection: ['瞬发', '爆发', '便携'],
      },
      {
        id: 'escape_talisman',
        name: '符箓·遁符',
        desc: '一次性消耗品，催动可短距离瞬移',
        fitMonk: '全修士通用',
        coreDirection: ['遁逃', '保命', '追击'],
      },
      {
        id: 'city_crossbow',
        name: '战争器械·破界弩',
        desc: '大型战具，需多人操作，破坏力极强',
        fitMonk: '宗门守军、王朝军队',
        coreDirection: ['破城', '破界', '大范围杀伤'],
      },
    ],
  },
]

export const MATERIALS: WeaponMaterial[] = [
  {
    id: 'fan_iron',
    name: '凡铁精钢',
    desc: '普通凡间铁矿锻打，锋利坚硬，无灵气承载能力',
    fit: '凡造层所有兵刃',
    rarity: 'normal',
  },
  {
    id: 'xuan_iron',
    name: '百年玄铁',
    desc: '地下埋藏百年的玄铁，比凡铁坚硬数倍，可承载基础灵气',
    fit: '灵淬层兵刃、法宝',
    rarity: 'normal',
  },
  {
    id: 'cold_iron',
    name: '千年寒铁',
    desc: '极寒之地埋藏千年的寒铁，自带寒气，攻击可冻凝灵气',
    fit: '灵淬/宝胎层兵刃',
    rarity: 'rare',
  },
  {
    id: 'nine_iron',
    name: '九天异铁',
    desc: '九天落下的神铁，自带雷气，是顶级剑器材质',
    fit: '道纹/仙蜕层剑类',
    rarity: 'legendary',
  },
  {
    id: 'green_crystal',
    name: '万载绿晶',
    desc: '南疆极苦之地出产的绿晶，斩金断玉，煞气内敛',
    fit: '宝胎/道纹层刀剑',
    rarity: 'rare',
  },
  {
    id: 'meteor_iron',
    name: '天外陨铁',
    desc: '流星坠落所化，重逾千斤，坚不可摧，自带破罡效果',
    fit: '全层级重兵器',
    rarity: 'rare',
  },
  {
    id: 'thunder_crystal',
    name: '紫雷晶',
    desc: '雷霆淬炼万年的紫色晶石，自带雷电之力，攻击可麻痹敌人',
    fit: '雷属性兵刃、法宝',
    rarity: 'rare',
  },
  {
    id: 'wind_crystal',
    name: '风灵晶',
    desc: '风眼深处孕育的晶石，轻盈无比，攻击快如疾风',
    fit: '轻兵器、飞剑',
    rarity: 'rare',
  },
  {
    id: 'fire_gold',
    name: '火炼精金',
    desc: '地火中孕育万年的精金，自带烈火，攻击可灼烧神魂',
    fit: '火属性法宝、魔兵',
    rarity: 'rare',
  },
  {
    id: 'xuan_yin_iron',
    name: '玄阴冥铁',
    desc: '九幽之下出产的阴铁，自带阴寒死气，是魔兵顶级材质',
    fit: '魔兵、鬼器',
    rarity: 'legendary',
  },
  {
    id: 'peach_wood',
    name: '雷劈桃木',
    desc: '被天雷劈过的千年桃木，自带雷气，专克阴邪鬼物',
    fit: '道家法器、木剑',
    rarity: 'rare',
  },
  {
    id: 'bodhi_wood',
    name: '菩提神木',
    desc: '菩提树心，自带佛气，可破心魔，专克邪祟',
    fit: '佛门法器',
    rarity: 'rare',
  },
  {
    id: 'ice_silk',
    name: '万年冰蚕丝',
    desc: '万年冰蚕吐的丝，坚韧无比，刀枪不入，可织软甲、软鞭',
    fit: '软兵器、防御法宝',
    rarity: 'rare',
  },
  {
    id: 'dragon_sinew',
    name: '蛟龙筋',
    desc: '蛟龙的筋，弹性极强，是弓弦、软鞭的顶级材质',
    fit: '弓、软鞭类',
    rarity: 'rare',
  },
  {
    id: 'chaos_stone',
    name: '混沌原石',
    desc: '开天前的混沌石，非金非玉，可化万物，是先天灵宝材质',
    fit: '神蕴层法宝',
    rarity: 'legendary',
  },
  {
    id: 'warm_jade',
    name: '万年温玉',
    desc: '火山温玉，自带暖意，可温养神魂，是佩饰类法宝顶级材质',
    fit: '玉佩、辅助类法宝',
    rarity: 'rare',
  },
]

export const FORGE_TRAITS: WeaponTrait[] = [
  {
    id: 'forge_sharp',
    name: '开锋锻锐',
    desc: '刃口反复锤锻致密，锋锐度大幅提升，可劈开更厚的护甲与灵气护体',
    fit: '刀剑枪戟、短兵类',
    conflictTags: ['blunt'],
    rarity: 'normal',
  },
  {
    id: 'blood_groove',
    name: '开槽引血',
    desc: '刃身、齿尖开凹槽，命中后引导气血灵气外泄，伤口难以愈合',
    fit: '穿刺、劈砍、齿状兵器',
    conflictTags: ['blunt'],
    rarity: 'normal',
  },
  {
    id: 'reverse_hook',
    name: '做逆倒钩',
    desc: '刃边、齿尖加工反向倒钩，拔出时撕裂皮肉筋骨，可勾锁对方兵器',
    fit: '短兵、狼牙棒、钩爪',
    conflictTags: ['soft'],
    rarity: 'normal',
  },
  {
    id: 'heavy_body',
    name: '锻胎实重',
    desc: '压缩材质密度，整体重量提升，砸落力道更沉，可震得对手气血翻涌',
    fit: '重锤、狼牙棒、长棍、法印',
    conflictTags: ['soft', 'light'],
    rarity: 'normal',
  },
  {
    id: 'qi_guide',
    name: '错纹导气',
    desc: '器身内部锻出导气纹路，灵气传导更顺畅，发力集中不散逸',
    fit: '所有灵气承载类兵器',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'hidden_edge',
    name: '暗藏刃口',
    desc: '看似无锋，实则边缘藏有细刃，缠斗时可突发割伤对手',
    fit: '长棍、软鞭、折扇类',
    conflictTags: ['sharp'],
    rarity: 'normal',
  },
  {
    id: 'anti_slip',
    name: '缠柄防滑',
    desc: '柄身缠绕灵蟒皮防滑，握持稳固，剧烈打斗中不易脱手',
    fit: '所有手持兵器',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'rune_forge',
    name: '符文锻胎',
    desc: '器身锻入基础灵纹，天然导气聚灵，灵气吸纳速度小幅提升',
    fit: '所有灵淬及以上兵器',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'gold_inlay',
    name: '嵌金镶边',
    desc: '以庚金灵金镶边加固，器身韧性提升，不易被外力崩断',
    fit: '刀剑、长兵类',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'hollow_guide',
    name: '镂空引灵',
    desc: '器身镂刻镂空灵纹，与外界灵气呼应，加快战时灵气回复',
    fit: '法宝、长兵类',
    conflictTags: ['heavy'],
    rarity: 'rare',
  },
  {
    id: 'marrow_quench',
    name: '淬髓锻骨',
    desc: '反复以灵火锻打器芯，剔除最后杂质，灵气承载上限显著提升',
    fit: '所有实体兵器',
    conflictTags: [],
    rarity: 'rare',
  },
  {
    id: 'blade_derive',
    name: '分刃衍锋',
    desc: '主刃两侧衍生副刃，攻击覆盖范围扩大，可同时伤敌多处',
    fit: '刀剑、长戟类',
    conflictTags: ['blunt'],
    rarity: 'rare',
  },
  {
    id: 'beast_guard',
    name: '吞口镇煞',
    desc: '器首加铸兽首吞口，以灵材镇压器身凶戾之气，不易反噬主人',
    fit: '长刀、重剑、魔兵类',
    conflictTags: [],
    rarity: 'rare',
  },
  {
    id: 'silk_seal',
    name: '缠丝封刃',
    desc: '以冰蚕丝缠绕刃身，收放自如，平时不易误伤，催动时丝刃齐出',
    fit: '软剑、细剑类',
    conflictTags: ['sharp'],
    rarity: 'rare',
  },
  {
    id: 'vein_seal',
    name: '封脉锁窍',
    desc: '器身锻出封脉纹路，命中可暂时封锁对手经脉灵气流转',
    fit: '细针、短刺、软鞭',
    conflictTags: [],
    rarity: 'rare',
  },
]

export const SOAK_TRAITS: WeaponTrait[] = [
  {
    id: 'frost_soak',
    name: '冰寒浸淬',
    desc: '极寒冰潭温养，攻击附带冰寒气劲，可凝滞对手灵气与身法',
    fit: '刀剑枪、法宝类',
    conflictTags: ['hot'],
    rarity: 'normal',
  },
  {
    id: 'burn_soak',
    name: '灼燃浸淬',
    desc: '地火脉温养，攻击附带灼烧效果，伤口普通灵气难以扑灭',
    fit: '刀、锤、幡、葫芦类',
    conflictTags: ['cold'],
    rarity: 'normal',
  },
  {
    id: 'thunder_soak',
    name: '雷纹浸养',
    desc: '雷泽淤泥温养，攻击附带麻痹效果，可震散对手神识',
    fit: '剑、枪、珠、钟类',
    conflictTags: ['yin', 'soft'],
    rarity: 'rare',
  },
  {
    id: 'poison_soak',
    name: '奇毒浸养',
    desc: '毒液长期浸泡，毒质沁入材质肌理，命中即带腐脉毒效',
    fit: '短兵、暗器、针类',
    conflictTags: ['yang', 'pure'],
    rarity: 'normal',
  },
  {
    id: 'evil_soak',
    name: '阴煞喂养',
    desc: '乱葬岗阴脉温养，附带阴煞之气，可扰乱神识、压制灵气',
    fit: '魔兵、鬼器类',
    conflictTags: ['yang'],
    rarity: 'normal',
  },
  {
    id: 'pure_soak',
    name: '纯阳温养',
    desc: '太阳精火温养，自带纯阳之气，专克阴邪鬼物',
    fit: '桃木剑、佛门法宝',
    conflictTags: ['yin'],
    rarity: 'normal',
  },
  {
    id: 'soul_soak',
    name: '神魂温养',
    desc: '使用者自身神识日夜温养，心意相通，操控如臂使指',
    fit: '所有可认主兵器',
    conflictTags: [],
    rarity: 'rare',
  },
  {
    id: 'gengjin_quench',
    name: '庚金淬体',
    desc: '以庚金之精温养，锋锐度大幅提升，专破护体罡气与金属法宝',
    fit: '刀剑、枪刺类',
    conflictTags: ['soft'],
    rarity: 'rare',
  },
  {
    id: 'yimu_nourish',
    name: '乙木养魂',
    desc: '以乙木灵液浸润，器身生机盎然，可缓慢自修复细微损伤',
    fit: '木属性兵器、软鞭类',
    conflictTags: ['hard', 'hot'],
    rarity: 'rare',
  },
  {
    id: 'kuiwater_soak',
    name: '葵水涵灵',
    desc: '以葵水精华温养，灵气运转绵柔悠长，持久战续航能力极强',
    fit: '水族兵器、葫芦类',
    conflictTags: ['hot', 'hard'],
    rarity: 'rare',
  },
  {
    id: 'lihua_refine',
    name: '离火炼元',
    desc: '以离火本源淬炼，攻击附带离火灼烧，可直接炼化灵气护盾',
    fit: '火属性法宝、魔兵',
    conflictTags: ['cold'],
    rarity: 'rare',
  },
  {
    id: 'wutu_soild',
    name: '戊土固基',
    desc: '以戊土精元沉养，器身厚重稳固，难以被外力损毁震碎',
    fit: '重锤、法印、宝盾',
    conflictTags: ['soft'],
    rarity: 'normal',
  },
  {
    id: 'taiyin_condense',
    name: '太阴凝华',
    desc: '吸纳月华太阴之气，夜间威力倍增，对神魂攻击有额外加持',
    fit: '月属性法宝、魂幡',
    conflictTags: ['hot', 'yang'],
    rarity: 'rare',
  },
  {
    id: 'sun_melt',
    name: '太阳熔金',
    desc: '吸纳太阳真火之气，至阳至刚，可直接焚毁阴邪与低阶法器',
    fit: '佛门法宝、纯阳兵器',
    conflictTags: ['yin'],
    rarity: 'legendary',
  },
  {
    id: 'xuanbing_freeze',
    name: '玄霜冻髓',
    desc: '以九天玄霜浸润，命中可冻结经脉灵气，迟缓效果持久',
    fit: '冰属性剑、针类',
    conflictTags: ['hot'],
    rarity: 'rare',
  },
  {
    id: 'mist_confuse',
    name: '幻雾迷神',
    desc: '以迷幻灵雾温养，挥器可散逸迷神雾气，扰乱对手心神',
    fit: '软鞭、魂幡、扇类',
    conflictTags: ['pure', 'yang'],
    rarity: 'rare',
  },
  {
    id: 'baleful_blade',
    name: '煞气凝刃',
    desc: '以古战场煞气养器，杀伐之气越重威力越强，可震慑低阶修士',
    fit: '战刀、长枪、魔兵',
    conflictTags: ['pure'],
    rarity: 'legendary',
  },
]

export const ATTACH_TRAITS: WeaponTrait[] = [
  {
    id: 'poison_apply',
    name: '外敷麻药',
    desc: '战前刃口涂抹迷魂散、麻痹药，命中可短暂失神',
    fit: '尖刺、刃口类',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'evil_apply',
    name: '黑狗血涂',
    desc: '刃尖涂黑狗血/雄黄，针对阴邪鬼物有额外破防效果',
    fit: '所有近战兵器',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'talisman_stick',
    name: '贴符增幅',
    desc: '器身贴微型符篆，临时增幅对应属性威力',
    fit: '所有兵器法宝',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'silk_wrap',
    name: '灵丝缠柄',
    desc: '柄身缠灵蚕丝/雷纹丝，小幅减震或附加麻痹触感',
    fit: '手持类兵器',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'liquid_dip',
    name: '药液浸润',
    desc: '战前泡入特殊药液，如蚀骨水、清心液，造成额外效果',
    fit: '刃口、齿状兵器',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'stealth_paint',
    name: '隐漆涂覆',
    desc: '器身涂哑光隐漆，暗处不易被发现，适配暗杀潜行',
    fit: '暗器、短兵类',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'attack_talisman',
    name: '符篆封刃',
    desc: '刃口贴特制爆炎符/冰刃符，一击爆发后符篆失效',
    fit: '刀剑、枪刺类',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'ward_stripe',
    name: '禁纹贴覆',
    desc: '器身贴临时禁纹，可短暂免疫低阶术法与符篆攻击',
    fit: '所有实体兵器',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'spirit_dust',
    name: '灵粉敷刃',
    desc: '刃口敷破幻灵粉，可破隐身、幻术类术法，照出鬼魅原形',
    fit: '所有近战兵器',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'luck_cord',
    name: '气运红绳',
    desc: '柄系加持红绳，小幅提升命中机缘与小额避灾效果',
    fit: '所有手持兵器',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'clease_talisman',
    name: '清心符贴',
    desc: '器身贴清心符，可抵御心魔与魅惑类攻击，稳固心神',
    fit: '所有兵器法宝',
    conflictTags: ['illusion'],
    rarity: 'normal',
  },
  {
    id: 'evil_ward',
    name: '破邪符印',
    desc: '器身盖破邪符印，对邪祟、鬼物、尸傀类目标额外加成',
    fit: '所有兵器',
    conflictTags: ['yin'],
    rarity: 'normal',
  },
  {
    id: 'light_talisman',
    name: '轻身符裹',
    desc: '器身缠轻身符，降低握持重量，提升挥击与出招速度',
    fit: '短兵、软兵类',
    conflictTags: ['heavy'],
    rarity: 'normal',
  },
  {
    id: 'sound_seal',
    name: '噤声符贴',
    desc: '器身贴噤声符，出招无声无息，适配暗杀与潜行作战',
    fit: '暗器、短剑类',
    conflictTags: ['sound'],
    rarity: 'normal',
  },
]

export const CAVITY_TRAITS: WeaponTrait[] = [
  {
    id: 'poison_sac',
    name: '暗窍藏毒',
    desc: '柄部/根部开暗窍封存毒囊，命中受力时毒液喷溅',
    fit: '近战兵器、长兵',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'fire_bead',
    name: '嵌爆火珠',
    desc: '器身开孔嵌火珠，危急时刻可引爆换取一击爆发',
    fit: '所有实体兵器',
    conflictTags: ['cold'],
    rarity: 'normal',
  },
  {
    id: 'spring_needle',
    name: '簧藏细针',
    desc: '内部装崩簧暗藏细针，近身缠斗时突然弹出突袭',
    fit: '短柄、棒柄、剑柄',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'mini_array',
    name: '纳微型阵',
    desc: '器胎内嵌微型阵盘，命中后触发小型困阵/护罩',
    fit: '法宝、重兵器类',
    conflictTags: [],
    rarity: 'rare',
  },
  {
    id: 'spirit_stone',
    name: '嵌聚灵玉',
    desc: '开孔嵌聚灵玉，平时加速灵气汇聚，战时可补充灵气续航',
    fit: '所有灵气类兵器',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'soul_bead',
    name: '纳魂珠窍',
    desc: '暗窍嵌纳魂珠，击杀目标后可收纳生魂滋养器身',
    fit: '魔兵、魂幡类',
    conflictTags: ['yang', 'pure'],
    rarity: 'rare',
  },
  {
    id: 'talisman_slot',
    name: '藏符暗格',
    desc: '柄内开暗格藏微型符篆，危急时神识触发应急保命',
    fit: '所有手持兵器',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'crystal_core',
    name: '聚灵晶窍',
    desc: '嵌高阶聚灵晶，战时可快速释放储备灵气，续航翻倍',
    fit: '法宝、飞剑类',
    conflictTags: [],
    rarity: 'rare',
  },
  {
    id: 'voice_jade',
    name: '传音玉窍',
    desc: '嵌传音玉，可与持器者神识远程传讯，跨距可达数里',
    fit: '所有可认主兵器',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'explode_pill',
    name: '自爆丹窍',
    desc: '藏一次性爆丹，绝境时引爆与敌同归于尽，器毁人伤',
    fit: '所有实体兵器',
    conflictTags: [],
    rarity: 'rare',
  },
  {
    id: 'dust_bead',
    name: '避尘珠窍',
    desc: '嵌避尘珠，器身永不沾尘污血渍，常年光洁如新',
    fit: '所有实体兵器',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'heal_jade',
    name: '温养玉窍',
    desc: '嵌温养玉，缓慢修复器身细微损伤，延长兵器寿命',
    fit: '所有实体兵器',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'smoke_hole',
    name: '迷烟窍',
    desc: '藏迷魂烟，触发后可释放大范围迷烟脱身，扰敌视线',
    fit: '短兵、杖类',
    conflictTags: [],
    rarity: 'normal',
  },
  {
    id: 'seal_gem',
    name: '封灵宝石',
    desc: '嵌封灵石，命中可暂时封禁低阶法宝的禁制灵光',
    fit: '锤、印、棍类',
    conflictTags: [],
    rarity: 'rare',
  },
]

export const SOUL_REFINE_LEVELS: SoulRefineLevel[] = [
  {
    id: 'none',
    name: '无',
    desc: '未进行本命祭炼，任何人皆可使用，无额外加成',
  },
  {
    id: 'soul_mark',
    name: '神魂烙印',
    desc: '神识刻入器胎，心意相通，操控速度与精准度大幅提升，他人无法轻易夺走',
  },
  {
    id: 'blood_merge',
    name: '气血交融',
    desc: '精血与器胎相融，人器同息，武器可借用修士自身修为，所有特质触发概率、影响范围显著提升',
  },
  {
    id: 'dao_resonance',
    name: '道则共鸣',
    desc: '自身道法与武器特质完全契合，催生出专属本命神通，威力翻倍，人器一荣俱荣一损俱损',
  },
]

// ============ 查找辅助 ============
const categoryMap = new Map(CATEGORIES.map(c => [c.id, c]))
const formMap = new Map<string, { form: WeaponForm; category: WeaponCategory }>()
for (const c of CATEGORIES) for (const f of c.forms) formMap.set(f.id, { form: f, category: c })
const materialMap = new Map(MATERIALS.map(m => [m.id, m]))
const traitMap = new Map<string, WeaponTrait>([
  ...FORGE_TRAITS, ...SOAK_TRAITS, ...ATTACH_TRAITS, ...CAVITY_TRAITS,
].map(t => [t.id, t]))

export function getCategory(id: string) { return categoryMap.get(id) }
export function getForm(id: string) { return formMap.get(id) }
export function getMaterial(id: string) { return materialMap.get(id) }
export function getTrait(id: string) { return traitMap.get(id) }
export function getFormsByCategory(categoryId: string) {
  return categoryMap.get(categoryId)?.forms ?? []
}
