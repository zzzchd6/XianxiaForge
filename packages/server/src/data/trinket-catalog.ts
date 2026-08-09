/**
 * 世情小物规则模板库（零token组合生成）
 *
 * 6类 × 9-10模板 ≈ 57个基础物件。
 * 每次十连从中随机抽取（不重复），组合出 display_name + 钩子种子。
 * LLM仅负责将 hookSeeds 展开为1句话钩子。
 */

export interface TrinketTemplate {
  category: string
  name: string
  /** 材质/外观描写片段 */
  material: string
  /** 3-5个钩子种子（关键词/情境），供LLM展开为1句话 */
  hookSeeds: string[]
}

// ============================================================
// 一、首饰类
// ============================================================

const JEWELRY: TrinketTemplate[] = [
  { category: '首饰', name: '刻字银簪', material: '簪尾刻着一个模糊的名字，银质发黑', hookSeeds: ['失踪的人', '当票', '名字的主人'] },
  { category: '首饰', name: '断线珠串', material: '十七颗珠子只剩九颗，断口处有旧血渍', hookSeeds: ['数珠子的人', '缺的八颗去了哪', '血渍来历'] },
  { category: '首饰', name: '旧荷包', material: '绣工粗糙，里面塞着一团干硬的泥巴', hookSeeds: ['泥巴的来历', '绣荷包的人', '藏在里面的东西'] },
  { category: '首饰', name: '缺角玉佩', material: '半块温玉，断口齐整像是被人一刀劈开的', hookSeeds: ['另一半在谁手里', '劈玉的人', '玉中藏字'] },
  { category: '首饰', name: '铜铃铛', material: '拇指大的铜铃，摇不响，里面塞了蜡', hookSeeds: ['为什么塞蜡', '原来响的时候', '铃铛的主人'] },
  { category: '首饰', name: '银锁片', material: '婴儿用的长命锁，背面刻着生辰八字', hookSeeds: ['这个孩子', '锁片为何流落', '八字对应的命格'] },
  { category: '首饰', name: '烧焦的发钗', material: '钗头烧得变形，但钗尾的缠丝纹还在', hookSeeds: ['那场火', '戴钗的人', '火里救出的'] },
  { category: '首饰', name: '骨戒', material: '不知什么骨头磨的，内壁刻着极小的符文', hookSeeds: ['符文含义', '骨头的来历', '戴上后的感觉'] },
  { category: '首饰', name: '褪色红绳', material: '系着三颗小铜钱，绳结打法很特殊', hookSeeds: ['系绳的人', '三颗铜钱的讲究', '解不开的结'] },
]

// ============================================================
// 二、文书类
// ============================================================

const DOCUMENTS: TrinketTemplate[] = [
  { category: '文书', name: '半本油渍账册', material: '后几页被油浸透了，但前几页的字迹还能认', hookSeeds: ['账目对不上', '记的是谁家的账', '油渍盖住的那行'] },
  { category: '文书', name: '带信的旧香囊', material: '香囊里没香料，塞着一封折了八折的信', hookSeeds: ['信没寄出去', '写信人的语气', '信里提到的地点'] },
  { category: '文书', name: '残页棋谱', material: '只剩中盘后半段，边角有人用朱笔批了个"蠢"字', hookSeeds: ['谁批的字', '这盘棋的结局', '棋谱的来历'] },
  { category: '文书', name: '地契残片', material: '只剩右下角，能看出是块山地，印泥还是官印', hookSeeds: ['这块地现在归谁', '地契为何撕了', '山里埋着什么'] },
  { category: '文书', name: '药方子', material: '方子很怪，有一味药被墨涂掉了', hookSeeds: ['涂掉的那味药', '开方的大夫', '这方子治什么病'] },
  { category: '文书', name: '族谱残页', material: '某一支被整页撕掉了，撕痕很新', hookSeeds: ['被除名的人', '谁撕的', '那一支去了哪'] },
  { category: '文书', name: '欠条', material: '欠的是三百两银子，落款日期是十年前', hookSeeds: ['还了没有', '欠债的人现在', '债主是谁'] },
  { category: '文书', name: '童生试答卷', material: '文章写得不错，但被批了个"狂悖"落榜', hookSeeds: ['哪里狂悖了', '这个考生后来', '批卷的人'] },
  { category: '文书', name: '旧地图', material: '画的是条水路，某处用红笔圈了个圈', hookSeeds: ['红圈处有什么', '画地图的人', '这条水路现在'] },
]

// ============================================================
// 三、日用类
// ============================================================

const DAILY: TrinketTemplate[] = [
  { category: '日用', name: '缺角茶碗', material: '粗瓷碗，缺口处磨得光滑，用了很久', hookSeeds: ['谁用了这么久', '缺口怎么来的', '碗底的刻字'] },
  { category: '日用', name: '生锈的铜钥匙', material: '钥匙齿很复杂，不像普通门锁用的', hookSeeds: ['开什么锁', '锁还在不在', '钥匙为何被丢'] },
  { category: '日用', name: '半截蜡烛', material: '蜡油凝成了奇怪的形状，里面裹着根头发', hookSeeds: ['头发是谁的', '蜡烛用过的那晚', '蜡油裹住的东西'] },
  { category: '日用', name: '破蒲团', material: '蒲团里塞的不是草，是一团旧布条', hookSeeds: ['布条上写了字', '谁坐了这个蒲团', '为什么要藏'] },
  { category: '日用', name: '裂了的算盘', material: '算盘珠子少了几颗，框上刻着铺号', hookSeeds: ['这个铺子还在吗', '算盘怎么裂的', '铺号的主人'] },
  { category: '日用', name: '旧烟杆', material: '烟杆嘴被咬得变了形，杆身刻着花纹', hookSeeds: ['烟杆的主人', '花纹的含义', '最后一次用'] },
  { category: '日用', name: '缺口剪刀', material: '剪刀口崩了一块，刃上还有暗色痕迹', hookSeeds: ['剪过什么', '暗色痕迹', '剪刀的来历'] },
  { category: '日用', name: '旧灯笼骨架', material: '竹骨还在，纸面烧没了，骨架上写着字', hookSeeds: ['写的什么字', '灯笼怎么烧的', '谁提过这灯笼'] },
  { category: '日用', name: '磨秃的毛笔', material: '笔杆上刻着名字，笔锋已经秃得不能用了', hookSeeds: ['名字是谁', '写过什么', '为何不扔'] },
]

// ============================================================
// 四、食物类
// ============================================================

const FOOD: TrinketTemplate[] = [
  { category: '食物', name: '干硬的月饼', material: '硬得像石头，但模子印的花纹很精致', hookSeeds: ['谁做的', '为什么没吃', '花纹的寓意'] },
  { category: '食物', name: '封蜡的酒坛', material: '巴掌大的酒坛，封蜡完好，摇一摇有水声', hookSeeds: ['什么酒', '封了多久', '谁封的'] },
  { category: '食物', name: '发霉的茶叶饼', material: '茶饼霉了大半，但闻着还有股奇香', hookSeeds: ['什么茶', '为何存到现在', '茶香引来的'] },
  { category: '食物', name: '干瘪的果脯', material: '油纸包里三颗果脯，包纸背面画了个小人', hookSeeds: ['谁画的', '给谁的', '果脯的来历'] },
  { category: '食物', name: '碎了的糖人', material: '碎成三截但能看出是个武将模样', hookSeeds: ['捏糖人的手艺', '为什么碎了', '武将是谁'] },
  { category: '食物', name: '陈年酱菜坛', material: '坛子封着泥，外面贴着红纸条写着年份', hookSeeds: ['多少年了', '谁腌的', '坛子里还有别的'] },
  { category: '食物', name: '药膳方子配好的料包', material: '药材干透了，但配伍很奇怪，不像正经方子', hookSeeds: ['谁配的', '吃了会怎样', '方子从哪来'] },
  { category: '食物', name: '半块压缩干粮', material: '军粮样式，上面烙着番号', hookSeeds: ['哪支军队', '为何剩半块', '吃这粮的人'] },
]

// ============================================================
// 五、衣饰类
// ============================================================

const CLOTHING: TrinketTemplate[] = [
  { category: '衣饰', name: '旧布鞋', material: '鞋底磨穿了，鞋垫下面藏着张纸条', hookSeeds: ['纸条内容', '谁藏的', '走了多少路'] },
  { category: '衣饰', name: '褪色的肚兜', material: '绣着鸳鸯，但鸳鸯的眼睛被针扎烂了', hookSeeds: ['谁扎的', '为什么恨', '肚兜的主人'] },
  { category: '衣饰', name: '破斗笠', material: '斗笠夹层里缝着块铁片', hookSeeds: ['铁片是什么', '为什么藏', '戴斗笠的人'] },
  { category: '衣饰', name: '旧腰带', material: '腰带扣是块假玉，但带身是真丝的', hookSeeds: ['为什么以假乱真', '带子的来历', '系这带子的人'] },
  { category: '衣饰', name: '打了补丁的官帽', material: '官帽补了又补，帽翅断了一根', hookSeeds: ['什么官', '为何不扔', '断翅的来历'] },
  { category: '衣饰', name: '绣了一半的帕子', material: '只绣了半朵花，针还插在上面', hookSeeds: ['谁绣的', '为什么停了', '那半朵花'] },
  { category: '衣饰', name: '旧蓑衣', material: '蓑衣里子缝了个口袋，口袋是空的', hookSeeds: ['口袋里曾装什么', '谁穿的', '为何缝口袋'] },
  { category: '衣饰', name: '小孩虎头帽', material: '虎头帽很旧了，帽顶缝着颗银珠子', hookSeeds: ['哪个孩子', '银珠的讲究', '帽子为何在这'] },
]

// ============================================================
// 六、杂项类
// ============================================================

const MISC: TrinketTemplate[] = [
  { category: '杂项', name: '缺了子的象棋', material: '只剩一个"将"，棋子背面刻着日期', hookSeeds: ['那盘棋', '其他子呢', '日期那天发生了什么'] },
  { category: '杂项', name: '断弦的二胡', material: '琴筒里塞着团棉花，棉花上有暗渍', hookSeeds: ['谁拉的', '暗渍是什么', '最后一首曲子'] },
  { category: '杂项', name: '旧鸟笼', material: '笼门焊死了，里面放了朵干花', hookSeeds: ['为什么焊死', '鸟呢', '干花谁放的'] },
  { category: '杂项', name: '裂了的铜镜', material: '镜面裂成三瓣，背面铸着铭文', hookSeeds: ['铭文内容', '镜子怎么裂的', '照过谁'] },
  { category: '杂项', name: '空药瓶', material: '瓷瓶塞着木塞，瓶底残留着黑色粉末', hookSeeds: ['什么药', '谁吃的', '瓶子为何留着'] },
  { category: '杂项', name: '旧骰子', material: '三颗骰子，其中一颗灌了铅', hookSeeds: ['谁灌的铅', '赢了多少', '被发现了没'] },
  { category: '杂项', name: '断了柄的折扇', material: '扇面还在，画的是幅山水，题跋被撕了', hookSeeds: ['谁画的', '题跋写的什么', '为何撕了'] },
  { category: '杂项', name: '旧木梳', material: '梳齿断了几根，梳背刻着"白头"二字', hookSeeds: ['谁刻的', '白头之约', '梳子为何在这'] },
  { category: '杂项', name: '锈了的铁哨', material: '哨子吹不响，里面堵了东西', hookSeeds: ['堵了什么', '哨子做什么用', '谁吹过'] },
  { category: '杂项', name: '旧风筝骨架', material: '竹骨上糊的纸撕了大半，剩半张脸谱', hookSeeds: ['什么脸谱', '谁放的', '风筝怎么落的'] },
]

// ============================================================
// 汇总
// ============================================================

export const TRINKET_CATALOG: TrinketTemplate[] = [
  ...JEWELRY,
  ...DOCUMENTS,
  ...DAILY,
  ...FOOD,
  ...CLOTHING,
  ...MISC,
]

export const TRINKET_CATEGORIES = ['首饰', '文书', '日用', '食物', '衣饰', '杂项'] as const

/** 随机抽取 n 个不重复模板 */
export function pickTrinkets(n: number): TrinketTemplate[] {
  const pool = [...TRINKET_CATALOG]
  const picked: TrinketTemplate[] = []
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length)
    picked.push(pool.splice(idx, 1)[0])
  }
  return picked
}

// ============================================================
// 淘宝地点
// ============================================================

export const HUNT_LOCATIONS = [
  '城南鬼市', '河滩旧摊', '古战场边缘', '破庙集市', '码头黑市',
  '山脚杂货摊', '官道旁茶棚', '废村废墟', '军营旧货场', '雨夜巷口',
  '城隍庙前', '渡口跳蚤市', '老宅拆迁现场', '深山猎户棚', '矿洞入口',
] as const

export function randomLocation(): string {
  return HUNT_LOCATIONS[Math.floor(Math.random() * HUNT_LOCATIONS.length)]
}

// ============================================================
// 打眼（fake）预设
// ============================================================

export const FAKE_REVEALS_TRINKET = [
  '这是赃物，戴在身上会被捕快盘问',
  '这是赝品，真品早被人调包了',
  '这东西是假的，做旧手艺不错但经不起细看',
  '这是从坟里刨出来的，带着晦气',
  '这东西来路不正，原主人在找它',
  '这是别人故意丢的饵，拿了就被人盯上了',
] as const

export function randomFakeReveal(): string {
  return FAKE_REVEALS_TRINKET[Math.floor(Math.random() * FAKE_REVEALS_TRINKET.length)]
}
