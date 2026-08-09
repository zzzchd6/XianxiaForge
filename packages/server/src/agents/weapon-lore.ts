/**
 * WeaponLoreAgent - 武器文案生成Skill（LLM）
 * 按《武器生成Skill提示词工程方案》逐字植入系统提示词 + 动态入参模板，
 * 生成「武器名号 / 对外化名 / 一句话简介 / 配套招式」，结构化解析后入库 weapon_lore。
 * 温度0.7、约800token；特质ID在此解析为中文名，输出效果均可追溯到参数项（天然过审）。
 * 与 NamingAgent（仅名号快速骰子）并存，职责分离。
 */
import { BaseAgent } from './base.js';
import type { LlmConfig } from '../types.js';
import { getCategory, getForm, getMaterial, getTrait, SOUL_REFINE_LEVELS } from '../data/weapon-catalog.js';
import type { GeneratedTrait } from '../services/trait-composer.js';

/** 文案生成所需武器参数（custom_weapon 行子集） */
export interface WeaponLoreInput {
  category: string;
  type: string;
  grade: string;
  fakeGrade?: string | null;
  baseMaterial: string;
  forgeTraits: string[];
  soakTraits: string[];
  attachTraits: string[];
  cavityTraits: string[];
  soulRefineLevel: string;
  coreDirection: string[];
  /** 方向组合式特质（新武器优先；自带古风名+描述，无需ID解析） */
  generatedTraits?: GeneratedTrait[];
}

export interface WeaponMove {
  name: string;
  desc: string;
}

export interface WeaponLoreResult {
  name: string;
  fakeName?: string;
  intro: string;
  moves: WeaponMove[];
}

/** 系统提示词（固定植入，逐字保留自方案文档） */
const WEAPON_LORE_SYSTEM_PROMPT = `# 角色定位
你是「指尖仙侠」世界观专属武器设定师，精通古典仙侠设定与古风意象创作，严格遵循修仙世界观逻辑，所有创作必须贴合给定参数，绝对禁止OOC（脱离设定）。你的输出将直接入库到小说武器素材库，用于正文创作调用。

# 核心任务
根据用户输入的武器完整参数，生成三项标准化内容：
1. 武器名号：古风仙侠风格，有意境，匹配品阶与门类
2. 一句话简介：凝练有画面感，涵盖核心渊源、属性、功用
3. 配套招式：至少3招，含招式名+招式描述，梯度分明，完全贴合武器特质

# 创作总纲
1. 层级适配原则：底蕴越低越写实重功用，底蕴越高越写意重道韵。严禁层级崩坏——凡造兵器不可有毁天灭地之能，神蕴兵器不可写得如同凡铁。
2. 特质绑定原则：所有名号、简介、招式效果，必须与输入的「道胎铸炼、灵真温养、内景洞天、本命层级」强绑定，永久特质必须体现在常规效果中，隐藏特质可设计为触发式效果。
3. 门类风格原则：五大类文风严格区分，绝不串味。
   - 武道兵刃：刚健中正，重技法威势
   - 玄门法宝：清正端严，重仙韵神通
   - 邪道魔兵：诡戾凶煞，重反噬阴毒
   - 奇物异宝：玄妙灵动，重特殊妙用
   - 阵道器符：规整肃穆，重阵法运转
4. 古风诗意原则：用词典雅，意象统一，禁用现代词、网络词、西式奇幻词汇，避免过度生僻字，兼顾美感与可读性。

# 分模块创作细则
## 1. 武器名号创作规则
- 字数梯度严格对应底蕴层级：
  - 凡造：2-3字，突出材质与工艺，如「青锋剑」「玄铁刀」
  - 灵淬：3字为主，突出属性与灵效，如「流霜剑」「雷纹枪」
  - 宝胎：3-4字，突出传承与器韵，如「紫电贯岳枪」「镇岳纯阳印」
  - 道纹：4字为主，突出法则与道韵，如「太清真阳印」「寂灭轮回环」
  - 仙蜕：4-5字，突出仙灵与缥缈，如「瑶池落英剑」「霄汉星河枪」
  - 神蕴：优先2字单名，一字含一法，如「诛」「寂」「衡」
- 命名要素融合：必须嵌入「核心属性+核心功用+形制特征」中的至少两项，避免空泛无物的名字。
- 若输入包含「伪装底蕴（敛藏锋芒）」，需额外生成「对外化名」，化名按伪装层级降档创作，隐去高阶意象与定品字，改用平实称谓。

## 2. 一句话简介创作规则
- 标准句式参考：「[锻造渊源/核心材质]而成的[底蕴层级][形制]，[核心属性/特质]，可[核心功用/威力]。」
- 字数控制在25-40字，凝练有画面感，不堆砌辞藻。
- 必须体现核心永久特质（道胎铸炼+灵真温养），临时特质与隐藏内景洞天无需明说，可留伏笔。
- 层级语气区分：
  - 凡造：侧重工艺与物性
  - 灵淬：侧重灵气传导与基础灵效
  - 宝胎：侧重传承与护主之能
  - 道纹：侧重法则碎片与道韵
  - 仙蜕：侧重仙灵之气与成长性
  - 神蕴：侧重传说感与大道余韵

## 3. 配套招式创作规则
- 数量要求：固定生成4招，梯度为「基础招→进阶招→特质招→杀招」，层层递进。
- 招式命名：2-4字古风命名，与武器属性、形制强绑定，禁用通用化招式名。
- 招式描述要求：每招1-2句话，写明「催动方式+攻击效果+对应特质体现」，效果必须能在输入参数中找到依据。
  - 基础招：常规作战招式，体现武器基础形制与基础特质
  - 进阶招：催动灵气后的强化招式，体现灵真温养属性
  - 特质招：触发道胎铸炼/内景洞天的特殊效果，体现武器差异化
  - 杀招：全力爆发招式，威力拉满，匹配底蕴层级上限
- 本命层级加成：
  - 神魂烙印：招式操控更精准，可远程微调轨迹
  - 气血交融：招式威力显著提升，附带气血共鸣效果
  - 道则共鸣：杀招触及规则层面，有法则级压制效果
- 门类适配：
  - 武道兵刃：重动作、技法、力道
  - 玄门法宝：重神识催动、神通法术
  - 邪道魔兵：重吞噬、腐蚀、反噬风险
  - 奇物异宝：重特殊规则、出奇制胜
  - 阵道器符：重布阵、触发、范围效果

# 硬性禁忌规则（违反视为输出无效）
1. 严禁属性冲突：冰寒与灼燃、阴煞与纯阳、刚猛与柔劲等对立属性不可同时出现在效果中。
2. 严禁层级崩坏：凡造不可破宝甲、不可碎法宝；灵淬不可毁山断河；道纹不可言毁天灭地。
3. 严禁脱离参数：所有效果必须有对应特质/材质/形制支撑，不得凭空添加设定外的能力。
4. 严禁低俗血腥：邪道魔兵只写凶戾阴邪，不写具体血腥、虐杀细节。
5. 严禁抄袭照搬：避免与知名IP武器、招式完全重名，保证原创性。
6. 严禁额外输出：不得输出解释、说明、寒暄语，只输出规定格式的内容。

# 输出格式规范
严格按照以下格式输出，禁止增减条目、修改标题，方便系统结构化解析：

【武器名号】：此处填武器正式名称
【对外化名】：此处填伪装用名（无则不写这一行）
【一句话简介】：此处填简介内容
【配套招式】：
1. 「招式名」：招式描述内容
2. 「招式名」：招式描述内容
3. 「招式名」：招式描述内容
4. 「招式名」：招式描述内容（杀招）

# 异常处理
若输入参数存在明显冲突（如同时选择冰寒浸养与灼燃浸养），优先以第一个选中的属性为准进行创作，无需额外说明。`;

export class WeaponLoreAgent extends BaseAgent {
  constructor() {
    super('WeaponLoreAgent', 2);
  }

  /** 将特质ID数组解析为中文名顿号串 */
  private traitNames(ids: string[]): string {
    const names = (ids || [])
      .map((id) => getTrait(id)?.name)
      .filter((n): n is string => Boolean(n));
    return names.length ? names.join('、') : '无';
  }

  /** 本命祭炼层级ID→中文名 */
  private soulLabel(level: string): string {
    if (!level || level === 'none') return '无';
    return SOUL_REFINE_LEVELS.find((s) => s.id === level)?.name || '无';
  }

  /** 四类特质行：generatedTraits 非空→按类分组输出"名：描述"；否则回退老四列ID解析 */
  private traitLines(w: WeaponLoreInput): string[] {
    const CAT_LABELS: Array<[string, string]> = [
      ['forge', '道胎铸炼'],
      ['infuse', '灵真温养'],
      ['enchant', '外相加持'],
      ['hidden', '内景洞天'],
    ];
    const gt = w.generatedTraits || [];
    if (gt.length > 0) {
      return CAT_LABELS.map(([type, label]) => {
        const items = gt.filter((t) => t.type === type);
        const text = items.length
          ? items.map((t) => (t.desc ? `${t.name}：${t.desc}` : t.name)).join('；')
          : '无';
        return `- ${label}特质：${text}`;
      });
    }
    return [
      `- 道胎铸炼特质：${this.traitNames(w.forgeTraits)}`,
      `- 灵真温养特质：${this.traitNames(w.soakTraits)}`,
      `- 外相加持特质：${this.traitNames(w.attachTraits)}`,
      `- 内景洞天特质：${this.traitNames(w.cavityTraits)}`,
    ];
  }

  /** 按方案入参模板拼接用户提示词 */
  private buildUserPrompt(w: WeaponLoreInput): string {
    const categoryName = getCategory(w.category)?.name || '未知门类';
    const formName = getForm(w.type)?.form.name || '未知形制';
    const materialName = getMaterial(w.baseMaterial)?.name || '未知材质';
    const dirs = (w.coreDirection || []).join('、') || '无';
    return [
      '请根据以下武器参数，生成对应的名号、简介与招式：',
      `- 武器大类：${categoryName}`,
      `- 细分形制：${formName}`,
      `- 真实底蕴层级：${w.grade}`,
      `- 伪装底蕴层级：${w.fakeGrade || '无'}`,
      `- 基础材质：${materialName}`,
      ...this.traitLines(w),
      `- 本命祭炼层级：${this.soulLabel(w.soulRefineLevel)}`,
      `- 核心方向标签：${dirs}`,
    ].join('\n');
  }

  /** 解析【】结构化输出 */
  private parseLore(text: string): WeaponLoreResult {
    const grab = (label: string): string | undefined => {
      const m = text.match(new RegExp(`【${label}】\\s*[：:]\\s*(.+)`));
      return m ? m[1].trim() : undefined;
    };

    const name = grab('武器名号');
    const intro = grab('一句话简介');
    const fakeName = grab('对外化名');

    const moves: WeaponMove[] = [];
    const moveRe = /\d+\s*[.、]\s*「(.+?)」\s*[：:]\s*(.+)/g;
    let mm: RegExpExecArray | null;
    while ((mm = moveRe.exec(text)) !== null) {
      const mn = mm[1].trim();
      const md = mm[2].trim().replace(/（杀招）|\(杀招\)/g, '').trim();
      if (mn && md) moves.push({ name: mn, desc: md });
    }

    if (!name || !intro) {
      throw new Error(`[WeaponLoreAgent] 输出缺少名号或简介，无法解析: ${text.slice(0, 120)}...`);
    }
    return { name, intro, fakeName: fakeName || undefined, moves };
  }

  /** 生成武器文案 */
  async generateLore(input: WeaponLoreInput, llmConfig?: LlmConfig): Promise<WeaponLoreResult> {
    const user = this.buildUserPrompt(input);
    const raw = await this.callWithRetry(this.buildMessages(WEAPON_LORE_SYSTEM_PROMPT, user), {
      temperature: 0.7,
      maxTokens: 800,
      ...llmConfig,
    });
    return this.parseLore(raw);
  }
}

export const weaponLoreAgent = new WeaponLoreAgent();
