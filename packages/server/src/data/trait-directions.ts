/**
 * 方向组合式特质系统 — 静态方向定义（零token，纯数据）
 *
 * 四类特质 × 4维度 × 3-4方向，总选项≤56个。
 * 每方向含：id/label/hint/baseEffect/conflictDirs/unfitForms/unfitDaos
 *
 * 命名规则：{category}.{dimension}.{direction}
 * 例：forge.blade.armor_break
 */

// ============================================================
// 类型
// ============================================================

export type TraitCategory = 'forge' | 'infuse' | 'enchant' | 'hidden'

export interface TraitDirection {
  id: string
  label: string
  hint: string
  baseEffect: string
  /** 同维度内互斥方向ID（双向声明） */
  conflictDirs?: string[]
  /** 不适配的形制分类（重兵器/轻兵器/软兵器/暗器/法器/盾牌） */
  unfitFormClasses?: string[]
  /** 不适配的道则ID（来自 technique-catalog DaoId） */
  unfitDaos?: string[]
  /** 选择限制：max 为该维度最多可选数，required 为必选 */
  selectRule?: 'single' | 'max2' | 'max1' | 'required1'
}

export interface TraitDimension {
  id: string
  label: string
  icon: string
  selectRule: 'single' | 'max2' | 'max1' | 'required1'
  directions: TraitDirection[]
}

export interface TraitCategoryDef {
  id: TraitCategory
  label: string
  dimensions: TraitDimension[]
}

// ============================================================
// 形制分类映射（用于 unfitFormClasses 判定）
// ============================================================

/** 形制→分类映射（weapon-catalog formId → formClass） */
export const FORM_CLASS_MAP: Record<string, string> = {
  // martial 武道兵刃
  long_sword: '轻兵器', broad_sword: '重兵器', heavy_hammer: '重兵器',
  spear: '重兵器', halberd: '重兵器', staff: '重兵器',
  dagger: '轻兵器', hidden_weapon: '暗器', whip: '软兵器',
  // taoist 玄门法宝
  taoist_sword: '法器', fly_whisk: '软兵器', jade_ruler: '法器',
  bell: '法器', mirror: '法器', gourd: '法器', seal: '法器',
  // demonic 邪道魔兵
  demon_blade: '重兵器', bone_staff: '重兵器', soul_banner: '软兵器',
  blood_needle: '暗器', ghost_chain: '软兵器', corpse_claw: '轻兵器',
  // strange 奇物异宝
  thunder_bead: '暗器', fire_ring: '法器', ice_silk: '软兵器',
  wind_fan: '轻兵器', earth_plate: '盾牌', spirit_mirror: '法器',
  // array 阵道器符
  array_disk: '法器', talisman_brush: '法器', flag: '法器',
  compass: '法器', jade_pendant: '法器', scroll: '法器',
}

/** 形制分类列表 */
export const FORM_CLASSES = ['重兵器', '轻兵器', '软兵器', '暗器', '法器', '盾牌'] as const

// ============================================================
// 一、胎体改锻（forge）
// ============================================================

const FORGE_DIRECTIONS: TraitDimension[] = [
  {
    id: 'blade', label: '锋刃/接触面', icon: '🔪', selectRule: 'max2',
    directions: [
      { id: 'forge.blade.armor_break', label: '砍得动甲', hint: '厚刃/破甲棱/开血槽，破甲不卷刃', baseEffect: '破甲不卷刃，劈砍重甲如切朽木', conflictDirs: ['forge.blade.cut_fast'], unfitFormClasses: ['软兵器', '法器'] },
      { id: 'forge.blade.hurt_more', label: '砍得疼人', hint: '薄刃/锯齿/放血，中者伤口难愈', baseEffect: '中者伤口难愈，锯齿撕裂血肉', unfitFormClasses: ['盾牌', '法器', '软兵器'] },
      { id: 'forge.blade.cut_fast', label: '砍得快', hint: '极薄开刃/夹钢，吹毛断发，变招快', baseEffect: '吹毛断发，变招极快，刃薄如纸', conflictDirs: ['forge.blade.armor_break'], unfitFormClasses: ['盾牌', '软兵器'] },
      { id: 'forge.blade.no_hurt', label: '不伤人', hint: '不开刃/圆头，砸击不致命，适合惩戒/防御', baseEffect: '不开刃圆头，砸击不致命，惩戒留命', unfitFormClasses: ['暗器'] },
    ],
  },
  {
    id: 'weight', label: '重量/重心', icon: '⚖️', selectRule: 'single',
    directions: [
      { id: 'forge.weight.smash_heavy', label: '砸得重', hint: '重心靠前，劈砸力强，适合重兵器', baseEffect: '重心靠前，劈砸力沉，一锤定音', unfitFormClasses: ['暗器', '软兵器'] },
      { id: 'forge.weight.spin_fast', label: '转得快', hint: '重心靠后，灵活变招快，适合快打', baseEffect: '重心靠后，灵活变招，快打连环', unfitFormClasses: ['盾牌'] },
      { id: 'forge.weight.hold_steady', label: '拿得稳', hint: '重心居中，不震手，适合久战', baseEffect: '重心居中，不震手，久战不疲' },
      { id: 'forge.weight.carry_light', label: '带得轻', hint: '空心/减重，轻若无物，适合随身携带', baseEffect: '空心减重，轻若无物，藏于袖中' },
    ],
  },
  {
    id: 'structure', label: '结构/机关', icon: '🔧', selectRule: 'max1',
    directions: [
      { id: 'forge.structure.clad_steel', label: '夹钢/包钢', hint: '刚柔并济，不卷刃不易断', baseEffect: '刚柔并济，不卷刃不易断，韧性极佳' },
      { id: 'forge.structure.mechanism', label: '带机关', hint: '可伸缩/藏机关/可拆分，多形态', baseEffect: '可伸缩拆分，多形态切换，出其不意' },
      { id: 'forge.structure.chain', label: '带锁链/软柄', hint: '可长可短，能掷出拉回', baseEffect: '可长可短，掷出拉回，攻敌不备', unfitFormClasses: ['盾牌', '法器'] },
      { id: 'forge.structure.hollow', label: '空心带夹层', hint: '可藏毒/藏药/藏小物件', baseEffect: '空心夹层，可藏毒藏药，暗藏玄机' },
    ],
  },
  {
    id: 'texture', label: '肌理/处理', icon: '🧱', selectRule: 'max1',
    directions: [
      { id: 'forge.texture.pattern_forge', label: '叠锻花纹', hint: '千层锻/花纹钢，韧性强且美观', baseEffect: '千层锻打花纹钢，韧性强且美观' },
      { id: 'forge.texture.quench', label: '渗碳淬火', hint: '硬度极高，锋利但偏脆', baseEffect: '渗碳淬火硬度极高，锋利但偏脆' },
      { id: 'forge.texture.wrap_metal', label: '包铜/包银', hint: '不生锈/辟邪，适合礼器/法剑', baseEffect: '包铜包银不生锈，辟邪正气，适合礼器' },
      { id: 'forge.texture.rust_hide', label: '做旧埋锈', hint: '锈迹斑斑，适合敛藏锋芒', baseEffect: '锈迹斑斑，敛藏锋芒，示人以钝' },
    ],
  },
]

// ============================================================
// 二、灵质浸养（infuse）
// ============================================================

const INFUSE_DIRECTIONS: TraitDimension[] = [
  {
    id: 'source', label: '灵质来源', icon: '✨', selectRule: 'single',
    directions: [
      { id: 'infuse.source.earth_vein', label: '地脉灵气', hint: '温和中正，适合道修正道兵器', baseEffect: '地脉灵气温和中正，适合正道兵器' },
      { id: 'infuse.source.sun_moon', label: '日月精华', hint: '清灵纯粹，适合仙剑/拂尘', baseEffect: '日月精华清灵纯粹，仙气凛然', unfitDaos: ['mingshi'] },
      { id: 'infuse.source.evil_blood', label: '煞气/血气', hint: '凶戾霸道，适合魔修/杀器', baseEffect: '煞气凶戾霸道，杀意凛然', unfitDaos: ['kunearth'] },
      { id: 'infuse.source.incense', label: '香火愿力', hint: '厚重辟邪，适合佛门/官家兵器', baseEffect: '香火愿力厚重辟邪，正气浩然', unfitDaos: ['mingshi'] },
    ],
  },
  {
    id: 'method', label: '浸养方式', icon: '🔥', selectRule: 'single',
    directions: [
      { id: 'infuse.method.warm_nourish', label: '常年温养', hint: '日日以真气滋养，温和无副作用', baseEffect: '日日真气滋养，温和无副作用，灵性渐生' },
      { id: 'infuse.method.blood_sacrifice', label: '血祭', hint: '以人/兽血浸养，见效快但带凶性', baseEffect: '血祭见效快，带凶性，器灵暴躁' },
      { id: 'infuse.method.thunder_fire', label: '雷劈/火炼', hint: '以雷火淬炼，破邪但易伤器', baseEffect: '雷火淬炼破邪，但易伤器身', unfitDaos: ['thunder'] },
      { id: 'infuse.method.herb_soak', label: '药泡', hint: '以灵药熬煮，带治疗/毒属性', baseEffect: '灵药熬煮，带治疗或毒属性' },
    ],
  },
  {
    id: 'effect', label: '灵效方向', icon: '💫', selectRule: 'max1',
    directions: [
      { id: 'infuse.effect.spirit_amp', label: '聚灵增幅', hint: '用的时候真气消耗减半，威力提升', baseEffect: '聚灵增幅，真气消耗减半，威力提升' },
      { id: 'infuse.effect.soul_calm', label: '温养神魂', hint: '握在手里能安神定魄，防心魔', baseEffect: '安神定魄，防心魔侵体，握之宁心' },
      { id: 'infuse.effect.evil_break', label: '破邪镇祟', hint: '对阴邪/鬼物伤害加倍', baseEffect: '破邪镇祟，对阴邪鬼物伤害加倍' },
      { id: 'infuse.effect.danger_warn', label: '预警示警', hint: '遇危险自动嗡鸣示警', baseEffect: '遇危险自动嗡鸣示警，先敌一步' },
    ],
  },
  {
    id: 'side_effect', label: '浸养副作用', icon: '⚠️', selectRule: 'required1',
    directions: [
      { id: 'infuse.side_effect.drain_qi', label: '吸人真气', hint: '不用的时候也吸持有者真气', baseEffect: '不用时也吸持有者真气，久握疲惫' },
      { id: 'infuse.side_effect.fear_light', label: '怕光/怕秽', hint: '见光/碰脏东西灵效减弱', baseEffect: '见光碰秽灵效减弱，须避光护持' },
      { id: 'infuse.side_effect.attract_evil', label: '招引邪祟', hint: '煞气重容易招鬼/引魔修', baseEffect: '煞气招引邪祟，夜行鬼随' },
      { id: 'infuse.side_effect.attract_thunder', label: '引雷', hint: '雷雨天容易引雷劈持有者', baseEffect: '雷雨天引雷劈持有者，暴雨须收' },
    ],
  },
]

// ============================================================
// 三、外附加持（enchant）
// ============================================================

const ENCHANT_DIRECTIONS: TraitDimension[] = [
  {
    id: 'material', label: '附加材料', icon: '🧩', selectRule: 'max2',
    directions: [
      { id: 'enchant.material.talisman', label: '符篆/咒印', hint: '道士画的符/刻的咒', baseEffect: '符篆咒印加持，道气流转' },
      { id: 'enchant.material.gem', label: '灵石/宝石', hint: '嵌灵石/玉石/宝珠', baseEffect: '嵌灵石宝珠，灵气内蕴' },
      { id: 'enchant.material.beast_soul', label: '兽魂/残魂', hint: '封妖兽/人的残魂在上面', baseEffect: '封兽魂残魂，器有灵性', conflictDirs: ['enchant.material.token'] },
      { id: 'enchant.material.token', label: '信物/发丝', hint: '缠情人/亲人的发丝/信物', baseEffect: '缠信物发丝，情念系器', conflictDirs: ['enchant.material.beast_soul'] },
    ],
  },
  {
    id: 'method', label: '加持方式', icon: '✍️', selectRule: 'single',
    directions: [
      { id: 'enchant.method.paste_wrap', label: '贴符/缠丝', hint: '材料贴/缠在兵器表面，可更换', baseEffect: '贴缠表面可更换，灵活但易损' },
      { id: 'enchant.method.carve_embed', label: '刻咒/嵌宝', hint: '刻在兵器里/嵌在槽里，永久固定', baseEffect: '刻嵌永久固定，不可更换但稳固' },
      { id: 'enchant.method.seal_soul', label: '封魂/养灵', hint: '封在兵器内部，不可更换', baseEffect: '封魂内部不可换，器灵渐生' },
      { id: 'enchant.method.blood_pact', label: '血契', hint: '以血画符，和持有者绑定', baseEffect: '血契绑定持有者，他人不可用' },
    ],
  },
  {
    id: 'effect', label: '特效方向', icon: '🎇', selectRule: 'max1',
    directions: [
      { id: 'enchant.effect.element_def', label: '五行防御', hint: '防火/防水/防风/防土', baseEffect: '五行防御，防火防水防风防土' },
      { id: 'enchant.effect.speed_boost', label: '轻身提速', hint: '拿在手里身轻如燕，跑得快跳得高', baseEffect: '轻身提速，身轻如燕' },
      { id: 'enchant.effect.seek_guide', label: '寻人指路', hint: '指向要找的人/地方', baseEffect: '寻人指路，指向目标' },
      { id: 'enchant.effect.illusion', label: '幻象惑敌', hint: '能放小幻象迷惑敌人', baseEffect: '幻象惑敌，虚实难辨' },
    ],
  },
  {
    id: 'trigger', label: '触发限制', icon: '🚫', selectRule: 'required1',
    directions: [
      { id: 'enchant.trigger.blood_trigger', label: '见血才触发', hint: '必须沾了血才生效', baseEffect: '见血才触发，不沾血则沉眠' },
      { id: 'enchant.trigger.chant_trigger', label: '念咒才触发', hint: '要念口诀才生效', baseEffect: '念咒才触发，口诀为引' },
      { id: 'enchant.trigger.crisis_auto', label: '遇危机自动触发', hint: '危险的时候自己生效', baseEffect: '遇危机自动触发，护主心切' },
      { id: 'enchant.trigger.once_daily', label: '一天只能用一次', hint: '用了要等一天恢复', baseEffect: '一天一次，用后须等一日恢复' },
    ],
  },
]

// ============================================================
// 四、窍藏内嵌（hidden）
// ============================================================

const HIDDEN_DIRECTIONS: TraitDimension[] = [
  {
    id: 'content', label: '内嵌物', icon: '📦', selectRule: 'max1',
    directions: [
      { id: 'hidden.content.pill', label: '救命丹药/毒丹', hint: '藏救命药或毒丹', baseEffect: '藏救命丹药或毒丹，关键时一口' },
      { id: 'hidden.content.needle', label: '飞针/毒刺/小暗器', hint: '藏飞针毒刺小暗器', baseEffect: '藏飞针毒刺，近身暗算' },
      { id: 'hidden.content.mechanism_hidden', label: '机关/弹簧/毒烟', hint: '藏机关弹簧毒烟', baseEffect: '藏机关毒烟，触发即放' },
      { id: 'hidden.content.seed_soul', label: '种子/残魂/传信符', hint: '藏种子残魂传信符', baseEffect: '藏残魂传信符，危急时求援' },
    ],
  },
  {
    id: 'location', label: '藏纳位置', icon: '📍', selectRule: 'single',
    directions: [
      { id: 'hidden.location.handle', label: '兵器柄/把里', hint: '最隐蔽，按柄上机关触发', baseEffect: '藏于柄中，最隐蔽，按柄触发' },
      { id: 'hidden.location.spine', label: '脊/身里', hint: '藏在兵器内部，要拔开机关', baseEffect: '藏于脊身内部，拔开机关取用' },
      { id: 'hidden.location.guard', label: '格/护手处', hint: '一按就弹出来', baseEffect: '藏于护手处，一按弹出' },
      { id: 'hidden.location.blade_tip', label: '刃/尖处', hint: '打中目标自动注入', baseEffect: '藏于刃尖，刺中目标自动注入', unfitFormClasses: ['盾牌', '法器'] },
    ],
  },
  {
    id: 'trigger', label: '触发方式', icon: '⚡', selectRule: 'single',
    directions: [
      { id: 'hidden.trigger.button', label: '按柄上机关', hint: '手动按，可控', baseEffect: '按柄上机关，手动可控' },
      { id: 'hidden.trigger.chant', label: '念咒触发', hint: '念口诀触发', baseEffect: '念咒触发，口诀为引' },
      { id: 'hidden.trigger.hit_auto', label: '打中目标自动触发', hint: '刺中就自动放东西', baseEffect: '刺中目标自动触发，无需分心' },
      { id: 'hidden.trigger.crisis_auto', label: '危机自动触发', hint: '持有者有生命危险自己弹出来', baseEffect: '危机时自动弹出，护主心切' },
    ],
  },
  {
    id: 'cost', label: '代价', icon: '🧱', selectRule: 'required1',
    directions: [
      { id: 'hidden.cost.heavier', label: '兵器变重', hint: '加了夹层比同型兵器重', baseEffect: '加了夹层比同型兵器重，久战吃力' },
      { id: 'hidden.cost.bad_balance', label: '平衡变差', hint: '重心偏移，用着不顺手', baseEffect: '重心偏移，用着不顺手，须适应' },
      { id: 'hidden.cost.limited', label: '容量有限', hint: '只能装一次，用了要重新填', baseEffect: '容量有限，用一次须重新填装' },
      { id: 'hidden.cost.fragile', label: '容易坏', hint: '夹层处薄弱，容易被砍断', baseEffect: '夹层处薄弱，容易被砍断' },
    ],
  },
]

// ============================================================
// 汇总导出
// ============================================================

export const TRAIT_CATEGORIES: TraitCategoryDef[] = [
  { id: 'forge', label: '道胎铸炼', dimensions: FORGE_DIRECTIONS },
  { id: 'infuse', label: '灵真温养', dimensions: INFUSE_DIRECTIONS },
  { id: 'enchant', label: '外相加持', dimensions: ENCHANT_DIRECTIONS },
  { id: 'hidden', label: '内景洞天', dimensions: HIDDEN_DIRECTIONS },
]

/** 全部方向扁平索引 */
const allDirections = new Map<string, TraitDirection>()
for (const cat of TRAIT_CATEGORIES) {
  for (const dim of cat.dimensions) {
    for (const dir of dim.directions) {
      allDirections.set(dir.id, dir)
    }
  }
}

export function getDirection(id: string): TraitDirection | undefined {
  return allDirections.get(id)
}

export function getAllDirections(): TraitDirection[] {
  return [...allDirections.values()]
}

// ============================================================
// 稀有组合规则表（PRD§二.3）
// ============================================================

export interface RareCombination {
  /** 需要同时选中的方向ID集合（子集匹配） */
  requiredDirs: string[]
  name: string
  effect: string
  cost: string
  /** 触发权重倍数（默认1；歪打正着固定组合为3） */
  weightBoost?: number
}

export const RARE_COMBINATIONS: RareCombination[] = [
  {
    requiredDirs: ['forge.blade.armor_break', 'forge.blade.cut_fast', 'forge.structure.clad_steel', 'forge.texture.quench'],
    name: '吹毛断甲',
    effect: '削甲如泥，连铁甲带骨头一起砍断',
    cost: '刃极脆，砍硬东西必崩一个缺口',
  },
  {
    requiredDirs: ['forge.weight.smash_heavy', 'forge.structure.hollow', 'forge.structure.mechanism'],
    name: '藏雷重器',
    effect: '夹层里藏雷火/毒烟，砸中就炸',
    cost: '机关容易卡壳，十次有一次炸到自己',
  },
  {
    requiredDirs: ['forge.weight.carry_light', 'forge.texture.rust_hide'],
    name: '藏锋',
    effect: '看起来像破铜烂铁，重量只有普通兵器五分之一，拔剑速度极快',
    cost: '不能让别人知道是好东西，见了血就露馅',
  },
  {
    requiredDirs: ['infuse.source.evil_blood', 'infuse.method.blood_sacrifice', 'infuse.effect.evil_break'],
    name: '杀佛',
    effect: '杀的人越多破邪效果越强，连高僧的佛光都能破',
    cost: '杀性太重，握久了会眼睛红，敌我不分',
  },
  {
    requiredDirs: ['enchant.material.beast_soul', 'infuse.effect.danger_warn', 'enchant.trigger.crisis_auto'],
    name: '灵魂',
    effect: '兽魂会主动提醒危险，还能帮你挡一下致命攻击',
    cost: '兽魂会抢你身体控制权，每月十五要和它斗一次',
  },
  // ---- 歪打正着固定稀有组合（weightBoost:3，触发概率为普通稀有的3倍） ----
  {
    requiredDirs: ['forge.blade.armor_break', 'forge.weight.smash_heavy'],
    name: '重锋',
    effect: '刃口极薄却极重，一劈下去连甲带人斩为两截',
    cost: '重心极端靠前，收招慢半拍，被闪开就露破绽',
    weightBoost: 3,
  },
  {
    requiredDirs: ['infuse.source.evil_blood', 'infuse.method.herb_soak', 'forge.texture.quench'],
    name: '生死肌',
    effect: '器身有活肉纹理，能自行愈合裂痕，越打越韧',
    cost: '愈合时会吞噬主人一滴精血，连战十场就头晕目眩',
    weightBoost: 3,
  },
  {
    requiredDirs: ['infuse.source.evil_blood', 'infuse.method.blood_sacrifice', 'forge.weight.smash_heavy', 'forge.texture.rust_hide'],
    name: '生死轮',
    effect: '杀生越多器身越亮，锈壳下藏轮回之力，一击可碎同阶法宝',
    cost: '每次全力一击后强制休眠三日，期间与凡铁无异',
    weightBoost: 3,
  },
]

// ============================================================
// 瑕疵规则表（PRD§二.4）
// ============================================================

export interface FlawRule {
  /** 触发方向ID */
  directionId: string
  /** 叠锻层数阈值 */
  minStack: number
  flaw: string
}

export const FLAW_RULES: FlawRule[] = [
  { directionId: 'forge.blade.cut_fast', minStack: 4, flaw: '刃太脆，容易崩口' },
  { directionId: 'forge.weight.smash_heavy', minStack: 4, flaw: '太重，久战胳膊酸，容易脱手' },
  { directionId: 'forge.structure.mechanism', minStack: 4, flaw: '机关容易卡壳，要经常上油' },
  { directionId: 'infuse.method.blood_sacrifice', minStack: 4, flaw: '血腥味太重，容易引来野兽/邪祟' },
  { directionId: 'enchant.material.gem', minStack: 4, flaw: '宝石突出，容易被磕掉' },
  { directionId: 'hidden.trigger.crisis_auto', minStack: 4, flaw: '感应太灵敏，有时没危险也自己弹出来，白白浪费一次' },
  { directionId: 'hidden.cost.fragile', minStack: 4, flaw: '夹层太多器身千疮百孔，被重击一次整段碎裂' },
]

// ============================================================
// 叠锻概率表（PRD§四）
// ============================================================

export interface StackTier {
  min: number
  max: number
  label: string
  rareProb: number
  flawProb: number
}

export const STACK_TIERS: StackTier[] = [
  { min: 0, max: 3, label: '稳定', rareProb: 0, flawProb: 0 },
  { min: 4, max: 4, label: '小险', rareProb: 0.05, flawProb: 0.10 },
  { min: 5, max: 5, label: '中险', rareProb: 0.10, flawProb: 0.30 },
  { min: 6, max: 99, label: '大险', rareProb: 0.20, flawProb: 0.60 },
]

export function getStackTier(count: number): StackTier {
  return STACK_TIERS.find((t) => count >= t.min && count <= t.max) ?? STACK_TIERS[0]
}

// ============================================================
// 器性/前尘/忌讳 控制项定义（PRD§3.1）
// ============================================================

export const TEMPERAMENTS = [
  { id: 'stern', label: '🔪刚直肃杀', fitHint: '重兵器/杀器' },
  { id: 'playful', label: '🍶跳脱嗜酒', fitHint: '轻剑/辅助' },
  { id: 'lazy', label: '😴慵懒怕事', fitHint: '防御法宝' },
  { id: 'bloodthirsty', label: '🩸邪性嗜血', fitHint: '魔兵' },
  { id: 'rigid', label: '📜古板守旧', fitHint: '古宝' },
  { id: 'tsundere', label: '😤傲娇嘴硬', fitHint: '仙剑' },
  { id: 'timid', label: '😨胆小怕疼', fitHint: '辅助/奇物' },
  { id: 'obsessed', label: '💔痴念深重', fitHint: '信物兵器' },
] as const

export const PAST_TYPES = [
  { id: 'general_fall', label: '⚔️名将战陨', fitHint: '凡造战兵' },
  { id: 'lover_death', label: '💕情人殉情', fitHint: '信物/轻剑' },
  { id: 'master_pass', label: '🧙高人坐化', fitHint: '道纹以上' },
  { id: 'smith_legacy', label: '🔨匠人遗作', fitHint: '凡造手工' },
  { id: 'evil_refine', label: '👻邪人祭炼', fitHint: '魔兵' },
  { id: 'natural_born', label: '🌱天生地养', fitHint: '神蕴' },
] as const

export const TABOOS = [
  { id: 'no_opposite_sex', label: '🚫忌异性别碰' },
  { id: 'no_blood_uncleaned', label: '🚫忌见血不擦' },
  { id: 'no_alcohol', label: '🚫忌没酒喝' },
  { id: 'no_innocent_kill', label: '🚫忌滥杀无辜' },
  { id: 'no_monk_officer', label: '🚫忌见僧道/官差' },
  { id: 'no_noise', label: '🚫忌大声喧哗' },
  { id: 'no_filth', label: '🚫忌碰脏东西' },
  { id: 'no_rain_fullmoon', label: '🚫忌雨天/满月出鞘' },
] as const

/** 器性默认推荐规则 */
export function getDefaultTemperament(category: string, type: string): string {
  const cls = FORM_CLASS_MAP[type] ?? ''
  if (category === 'demonic') return 'bloodthirsty'
  if (cls === '重兵器') return 'stern'
  if (cls === '轻兵器') return 'playful'
  if (cls === '法器') return 'rigid'
  if (cls === '盾牌') return 'lazy'
  return 'tsundere'
}

/** 前尘默认推荐规则 */
export function getDefaultPastType(grade: string, category: string): string {
  if (grade === '神蕴') return 'natural_born'
  if (category === 'demonic') return 'evil_refine'
  if (['道纹', '仙蜕'].includes(grade)) return 'master_pass'
  if (grade === '凡造') return 'smith_legacy'
  return 'general_fall'
}

/** 忌讳默认推荐规则 */
export function getDefaultTaboos(temperament: string): string[] {
  const map: Record<string, string> = {
    stern: 'no_innocent_kill',
    playful: 'no_alcohol',
    bloodthirsty: 'no_filth',
    rigid: 'no_noise',
    lazy: 'no_noise',
    tsundere: 'no_opposite_sex',
    timid: 'no_blood_uncleaned',
    obsessed: 'no_opposite_sex',
  }
  return map[temperament] ? [map[temperament]] : []
}
