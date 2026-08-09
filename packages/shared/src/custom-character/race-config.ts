// ═══════════════════════════════════════════════════════════════════════════════
// 自定义人物模块 - 种族配置库（附录A：7大类56小类）
// ═══════════════════════════════════════════════════════════════════════════════

/** 种族大类ID */
export type RaceCategoryId =
  | 'human'
  | 'demon_race'
  | 'demon_king_race'
  | 'ghost_race'
  | 'spirit_race'
  | 'divine_race'
  | 'hybrid_race';

/** 种族小类 */
export interface RaceSub {
  id: string;
  name: string;
  desc: string;
  /** 擅长标签 */
  strengths: string[];
  /** 短板标签 */
  weaknesses: string[];
}

/** 种族大类 */
export interface RaceCategory {
  id: RaceCategoryId;
  name: string;
  desc: string;
  subs: RaceSub[];
}

export const RACE_CONFIG: RaceCategory[] = [
  {
    id: 'human',
    name: '人族',
    desc: '血肉灵长，数量最多，适应性最强，按出身与修行道路划分小类',
    subs: [
      { id: 'commoner', name: '凡俗血脉', desc: '出身普通人家，无修行背景，最懂人情世故', strengths: ['适应力强', '人脉广'], weaknesses: ['无修行基础', '起点低'] },
      { id: 'cultivator_family', name: '修士世家', desc: '传承数代的修仙家族子弟，自幼有家学渊源', strengths: ['根基扎实', '初始资源足'], weaknesses: ['见识受家族限制', '受门规束缚'] },
      { id: 'taoist_disciple', name: '道门嫡传', desc: '名门正派亲传弟子，功法正统，术法全面', strengths: ['功法正统', '术法齐全'], weaknesses: ['门规戒律多', '不擅变通'] },
      { id: 'demonic_cultivator', name: '魔门修士', desc: '魔功法统传承者，修炼魔功，进境神速', strengths: ['战力强悍', '修炼进境快'], weaknesses: ['易生心魔', '被正道敌视'] },
      { id: 'confucian_scholar', name: '儒门子弟', desc: '读书修浩然正气，以文入道，言出法随', strengths: ['浩然正气', '言出法随'], weaknesses: ['正面战力偏弱', '需长期养气'] },
      { id: 'military_warrior', name: '军中武者', desc: '沙场厮杀以武入道，杀伐气重，肉身强悍', strengths: ['肉身强悍', '杀伐果断'], weaknesses: ['不擅术法', '杀气过重'] },
      { id: 'overseas_cultivator', name: '海外散修', desc: '远离中原的海外修士，功法驳杂，路子野', strengths: ['见多识广', '会偏门术法'], weaknesses: ['根基不稳', '无后台依靠'] },
      { id: 'hermit_disciple', name: '隐世传人', desc: '不出世的隐世门派弟子，身怀独门异术', strengths: ['有独门绝技', '出其不意'], weaknesses: ['不通世事', '人脉稀少'] },
      { id: 'artisan', name: '百工巧匠', desc: '工匠出身，擅长炼器、制符、阵法等旁门', strengths: ['炼器制符', '精通旁门技艺'], weaknesses: ['正面战力弱', '依赖材料'] },
      { id: 'shaman', name: '巫祝传人', desc: '巫蛊祭祀传承，擅长咒术通灵与蛊毒', strengths: ['咒术通灵', '蛊毒诡异'], weaknesses: ['肉身脆弱', '被正道不容'] },
      { id: 'merchant_cultivator', name: '商贾修士', desc: '商道修行，身家丰厚，人脉遍布天下', strengths: ['资源丰厚', '人脉广'], weaknesses: ['正面战力一般', '需财富养道'] },
    ],
  },
  {
    id: 'demon_race',
    name: '妖族',
    desc: '草木禽兽化形，天赋异禀，按生物类群划分小类',
    subs: [
      { id: 'beast_demon', name: '走兽妖', desc: '虎狼狐熊等陆地走兽化形，肉身强悍力量大', strengths: ['肉身强悍', '力量大'], weaknesses: ['灵智偏低', '术法单一'] },
      { id: 'bird_demon', name: '飞禽妖', desc: '鹤鹰鹏雀等飞禽化形，速度极快擅风遁', strengths: ['速度极快', '风属性术法强'], weaknesses: ['肉身偏弱', '防御不足'] },
      { id: 'scale_demon', name: '鳞甲妖', desc: '龙蛟蛇龟等鳞甲水族化形，控水天赋强', strengths: ['控水天赋', '肉身坚韧'], weaknesses: ['陆地战力受限', '行动偏迟缓'] },
      { id: 'plant_demon', name: '草木妖', desc: '树花藤药等植物化形，精通木属性术法', strengths: ['木属性术法', '寿命长'], weaknesses: ['移动缓慢', '怕火怕雷'] },
      { id: 'insect_demon', name: '虫豸妖', desc: '蜂蝶蛛蝎等昆虫节肢化形，数量繁多擅毒', strengths: ['群体战术', '毒术诡异'], weaknesses: ['个体战力弱', '肉身脆弱'] },
      { id: 'aquatic_demon', name: '水妖族', desc: '鱼鳖虾蟹等水族化形，水下战力极强', strengths: ['水下无敌', '控水能力强'], weaknesses: ['离水战力大减', '陆上行动受限'] },
      { id: 'auspicious_demon', name: '瑞兽妖', desc: '麒麟白泽等祥瑞之兽化形，天生自带神通', strengths: ['天生神通', '祥瑞护身'], weaknesses: ['数量稀少', '成长缓慢'] },
    ],
  },
  {
    id: 'demon_king_race',
    name: '魔族',
    desc: '九幽/域外魔气所化，杀伐气重，按本源与魔功属性划分小类',
    subs: [
      { id: 'outer_heaven_demon', name: '域外天魔', desc: '天外天魔，由众生负面意念所化，专勾心魔', strengths: ['蛊惑人心', '心魔攻击'], weaknesses: ['无实体', '怕浩然正气'] },
      { id: 'nether_demon', name: '九幽魔将', desc: '九幽地府出身，操控阴寒死气，克制活物', strengths: ['阴寒死气', '克制活物'], weaknesses: ['怕阳属性术法', '怕佛光'] },
      { id: 'blood_demon', name: '血魔一脉', desc: '修炼血道魔功，靠精血修炼，恢复力极强', strengths: ['恢复力强', '越战越勇'], weaknesses: ['需要精血修炼', '易嗜血失控'] },
      { id: 'lust_demon', name: '欲魔一脉', desc: '擅长情欲幻术，能勾动人心底最深欲望', strengths: ['情欲幻术', '勾魂夺魄'], weaknesses: ['正面战力弱', '怕清心诀'] },
      { id: 'bone_demon', name: '骨魔一脉', desc: '以骨骼修炼，肉身坚硬如铁，不怕物理攻击', strengths: ['肉身坚硬', '物理免疫高'], weaknesses: ['行动迟缓', '怕雷法'] },
      { id: 'shadow_demon', name: '影魔一脉', desc: '藏于阴影之中，擅长暗杀遁术，来无影去无踪', strengths: ['暗杀遁术', '潜行能力强'], weaknesses: ['正面战力弱', '怕光明术法'] },
      { id: 'heart_demon', name: '心魔一脉', desc: '由众生执念化生，无形无质，专破修行者心境', strengths: ['破人心境', '无形无质'], weaknesses: ['无实体', '怕坚定道心'] },
      { id: 'flame_demon', name: '炎魔一脉', desc: '火属性魔族，控火能力极强，性情暴躁好战', strengths: ['控火能力强', '破坏力高'], weaknesses: ['怕水', '性情暴躁易冲动'] },
    ],
  },
  {
    id: 'ghost_race',
    name: '鬼族',
    desc: '死后魂魄/尸身修炼而成，阴属性，按形态分魂体、尸身两条线',
    subs: [
      { id: 'soul_ghost', name: '阴魂鬼修', desc: '普通魂魄修炼而成，无肉身，靠阴气修炼', strengths: ['穿墙遁地', '阴气修炼'], weaknesses: ['无肉身', '怕阳光'] },
      { id: 'asura_ghost', name: '修罗战魂', desc: '战死沙场的凶魂修炼，杀伐气重，越战越勇', strengths: ['杀伐气重', '越战越勇'], weaknesses: ['易失去理智', '只知杀戮'] },
      { id: 'resentful_ghost', name: '怨灵凶魂', desc: '含冤而死的魂魄，怨气越重实力越强', strengths: ['怨气加持', '越怨越强'], weaknesses: ['易失去理智', '怕被超度'] },
      { id: 'skin_walker_ghost', name: '画皮鬼魅', desc: '靠画皮伪装成人，擅长魅惑，能变他人模样', strengths: ['伪装魅惑', '变化术'], weaknesses: ['正面战力弱', '怕被识破'] },
      { id: 'chang_ghost', name: '伥鬼', desc: '被猛兽害死的人化成，帮凶兽害人，擅长引诱', strengths: ['引诱人', '熟悉人性弱点'], weaknesses: ['战力极弱', '依附凶兽生存'] },
      { id: 'city_god', name: '城隍阴神', desc: '受人间香火的阴司正神，有官职，能调阴兵', strengths: ['调遣阴兵', '有阴司职权'], weaknesses: ['受天条约束', '不能随意妄为'] },
      { id: 'jiangshi', name: '僵尸一族', desc: '尸体不腐成僵，肉身强悍，力大无穷', strengths: ['肉身强悍', '力大无穷'], weaknesses: ['怕阳光', '行动迟缓'] },
      { id: 'ba_jiangshi', name: '尸魃', desc: '僵尸修炼到极高境界，能引发旱灾，不畏阳光', strengths: ['引动旱灾', '不惧阳光'], weaknesses: ['怕水', '形成条件极苛刻'] },
    ],
  },
  {
    id: 'spirit_race',
    name: '灵族',
    desc: '天地灵气/器物化生，天生亲近五行，按化生来源划分小类',
    subs: [
      { id: 'five_element_spirit', name: '五行之精', desc: '金木水火土先天灵气所化，天生掌控对应元素', strengths: ['掌控对应元素', '天生亲和大道'], weaknesses: ['被克制元素压制'] },
      { id: 'wind_thunder_spirit', name: '风雷异灵', desc: '风雷等天地异象化生之灵，速度极快', strengths: ['速度极快', '破坏力强'], weaknesses: ['力量不稳定', '容易失控'] },
      { id: 'mountain_river_spirit', name: '山川地灵', desc: '山灵水灵等地脉灵气所化，镇守一方山川', strengths: ['借地脉之力', '镇守一方'], weaknesses: ['不能远离属地', '移动缓慢'] },
      { id: 'star_moon_spirit', name: '星月天灵', desc: '吸收月华星力修炼，容貌绝美，擅推演', strengths: ['推演占卜', '夜间战力翻倍'], weaknesses: ['白天战力减弱', '正面战力一般'] },
      { id: 'artifact_spirit', name: '器灵', desc: '剑钟鼎玉等古器开灵，天生御物，与器同修', strengths: ['天生御物', '器人同修'], weaknesses: ['依赖本体法宝', '器毁人亡'] },
      { id: 'jade_spirit', name: '石灵玉精', desc: '玉石宝石等天然矿物开灵，肉身坚硬如铁', strengths: ['肉身坚硬', '防御极强'], weaknesses: ['行动迟缓', '灵智偏低'] },
    ],
  },
  {
    id: 'divine_race',
    name: '神族',
    desc: '上古仙神/神兽后裔，血脉高贵，天生人形，按血脉来源划分小类',
    subs: [
      { id: 'dragon_descendant', name: '龙族后裔', desc: '真龙蛟龙螭龙之后，控水，肉身强，天生威压', strengths: ['控水', '肉身强', '天生威压'], weaknesses: ['性情高傲', '身怀重宝易招灾'] },
      { id: 'phoenix_descendant', name: '凤族后裔', desc: '凤凰朱雀青鸾之后，控火，能涅槃重生', strengths: ['控火', '涅槃重生'], weaknesses: ['数量稀少', '涅槃期脆弱'] },
      { id: 'qilin_descendant', name: '麒麟后裔', desc: '瑞兽之后，祥瑞不沾杀业，逢凶化吉', strengths: ['祥瑞护身', '逢凶化吉'], weaknesses: ['不擅杀戮', '战力偏柔'] },
      { id: 'xuanwu_descendant', name: '玄武后裔', desc: '龟蛇合体之后，防御极强，寿命极长', strengths: ['防御极强', '寿命极长'], weaknesses: ['行动迟缓', '攻击偏弱'] },
      { id: 'white_tiger_descendant', name: '白虎后裔', desc: '西方庚金白虎之后，主杀伐，带庚金之气', strengths: ['杀伐能力强', '庚金之气锋利'], weaknesses: ['杀气过重', '易惹祸端'] },
      { id: 'wu_descendant', name: '巫族后裔', desc: '上古巫神之后，肉身强悍，能沟通天地', strengths: ['肉身强悍', '沟通天地'], weaknesses: ['不擅术法', '血脉稀薄'] },
      { id: 'ancient_god_descendant', name: '古神后裔', desc: '上古金仙古神后人，天生带一门大神通', strengths: ['天生神通', '血脉高贵'], weaknesses: ['血脉稀薄', '天赋觉醒难'] },
      { id: 'sage_descendant', name: '圣人后裔', desc: '上古圣人之后，气运加身，万法不侵', strengths: ['气运加身', '万法不侵'], weaknesses: ['正面战力一般', '受天道关注'] },
    ],
  },
  {
    id: 'hybrid_race',
    name: '混血种',
    desc: '跨种族/特殊体质出身，自带戏剧冲突',
    subs: [
      { id: 'half_demon', name: '半妖', desc: '人妖混血，同时有人和妖的天赋，被两边排斥', strengths: ['人妖双天赋', '适应力强'], weaknesses: ['被两族排斥', '身份尴尬'] },
      { id: 'half_demon_king', name: '半魔', desc: '人魔混血，魔功天赋高，但容易被魔气侵蚀', strengths: ['魔功天赋高', '修炼进境快'], weaknesses: ['易被魔气侵蚀', '被正道不容'] },
      { id: 'ghost_fetus', name: '鬼胎', desc: '母孕时被鬼气侵染，生而带阴气，能见鬼神', strengths: ['能见鬼神', '天生阴气亲和'], weaknesses: ['体质阴寒', '寿元偏短'] },
      { id: 'reincarnated', name: '转世仙魔', desc: '前世是仙/魔转世，带残缺前世记忆与天赋', strengths: ['前世记忆', '天赋觉醒潜力大'], weaknesses: ['记忆残缺', '天赋觉醒困难'] },
      { id: 'heaven_abandoned', name: '天弃之人', desc: '被天道诅咒，运气极差，但往往有逆天奇遇', strengths: ['易遇逆天奇遇', '破而后立'], weaknesses: ['运气极差', '霉运缠身'] },
      { id: 'spirit_child', name: '灵童', desc: '人灵混血，天生亲和天地灵气，修炼神速', strengths: ['亲和灵气', '修炼神速'], weaknesses: ['肉身脆弱', '易被恶人觊觎'] },
      { id: 'twin_soul', name: '双生灵', desc: '一体双魂，有两个独立意识，能切换人格', strengths: ['双份天赋', '意识切换应对不同场景'], weaknesses: ['易精神分裂', '意识冲突'] },
      { id: 'dao_fetus', name: '道胎', desc: '先天道体，生而近道，修炼一日千里', strengths: ['先天道体', '生而近道'], weaknesses: ['涉世未深', '心思单纯'] },
    ],
  },
];

/** 按大类ID查找大类 */
export function findRaceCategory(categoryId: string): RaceCategory | undefined {
  return RACE_CONFIG.find((c) => c.id === categoryId);
}

/** 按大类+小类ID查找小类 */
export function findRaceSub(categoryId: string, subId: string): RaceSub | undefined {
  return findRaceCategory(categoryId)?.subs.find((s) => s.id === subId);
}
