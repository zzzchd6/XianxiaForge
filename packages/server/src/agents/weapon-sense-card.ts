/**
 * WeaponSenseCardAgent - 五感兵器卡生成（LLM）
 *
 * 基于已选方向/特质/器性/前尘/忌讳，生成5个核心维度 + 3剧情钩子 + 3名场面草稿。
 * 温度0.4，maxTokens2500，禁止瞎编，语言为有画面感的白话古风，无数值，无空泛形容词。
 * 支持单模块重生成（module参数）。
 *
 * 铁律：
 *  - 怪毛病绝对禁止写「反噬主人」
 *  - 所有内容严格基于用户选的方向/特质/器性/前尘/忌讳
 *  - 开了反差感开关必须强制反差点满
 */
import { BaseAgent } from './base.js';
import type { LlmConfig } from '../types.js';
import { getCategory, getForm, getMaterial } from '../data/weapon-catalog.js';
import type { GeneratedTrait } from '../services/trait-composer.js';

// ============================================================
// 类型
// ============================================================

export interface SenseCardInput {
  weaponName: string;
  category: string;
  type: string;
  grade: string;
  baseMaterial: string;
  traits: GeneratedTrait[];
  temperament: string;
  pastType: string;
  taboos: string[];
  reverseMode: boolean;
}

export interface SenseCardHook {
  type: 'seek' | 'eerie' | 'conflict';
  title: string;
  content: string;
}

export interface SenseCardScene {
  type: 'daily' | 'battle' | 'comedy';
  content: string;
}

export interface SenseCardResult {
  realSkill: string;
  weirdTrait: string;
  pastMemory: string;
  jianghuNickname: string;
  jianghuHeihua: string;
  rules: string;
  hooks: SenseCardHook[];
  famousScenes: SenseCardScene[];
  spirit: string;
}

// ============================================================
// 系统提示词
// ============================================================

const SYSTEM_PROMPT = `# 角色
你是「指尖仙侠」世界观专属兵器设定师，负责为已确定的武器生成「五感兵器卡」——一套可直接抄入小说正文的写作素材。

# 输出格式（严格按此结构，每模块用【】标题分隔）
【真本事】2-3句有画面感的描写，将武器所有特质（不含瑕疵）串成具体使用效果。不写标签不写数值，写「砍在铁甲上像切豆腐」这种画面。
【怪毛病】1-2个接地气、有反差的小毛病。绝对禁止写「反噬主人」「噬主」「反噬」这类烂大街内容。要写具体的、好笑的、有记忆点的毛病，比如「斩过上百人的凶刀怕猫」「仙人留的玉尺被女人碰过就三个月不灵」。
【前尘影事】1个具体的、可当伏笔的小细节。不说破结局，留悬念。比如「剑身上的缺口是当年前主人砍狗头铡救百姓弄的」。
【江湖名头】一个接地气的江湖外号 + 一句江湖黑话（像路人聊天会说的）。
【专属规矩】1-2条使用必须遵守的小规矩，破了就不灵。
【剧情钩子】3个，格式：① 寻亲钩（和前主人相关）② 灵异钩（和兵器带的东西相关）③ 风波钩（和江湖纷争相关），每个1句话。
【名场面草稿】3个，每个100字以内：① 日常使用小细节 ② 打架高光时刻 ③ 反差搞笑片段。
【器灵】根据器性和底蕴生成器灵设定。凡造/灵淬：只有模糊情绪和小脾气，没有完整意识（2-3句）。宝胎/道纹：有简单性格，能和主人做情绪感应（3-4句）。仙蜕/神蕴：有完整意识、形象、记忆碎片，能对话和托梦（4-5句）。器灵性格必须和器性100%一致（刚直肃杀→沉默老兵，跳脱嗜酒→小酒鬼，胆小怕疼→小哭包）。

# 铁律
1. 所有内容严格基于给定参数，禁止瞎编不存在的设定。
2. 怪毛病必须具体、有画面、有反差，禁止空泛。
3. 语言：有画面感的白话古风，无数值，无「强大」「恐怖」等空泛形容词。
4. 开了反差感时，怪毛病必须和兵器凶名形成强烈反差（凶刀怕猫、魔剑爱花）。
5. 前尘必须有具体可当伏笔的细节，不能泛泛而谈。`;

// ============================================================
// Agent
// ============================================================

class WeaponSenseCardAgent extends BaseAgent {
  constructor() {
    super('WeaponSenseCardAgent', 2);
  }

  private buildUserPrompt(input: SenseCardInput, module?: string): string {
    const catInfo = getCategory(input.category);
    const formInfo = getForm(input.type);
    const matInfo = getMaterial(input.baseMaterial);

    const traitLines = input.traits
      .filter((t) => !t.isClassic || t.desc)
      .map((t) => {
        let line = `- [${t.type}] ${t.name}：${t.desc}`;
        if (t.isRare) line += '（✨稀有）';
        if (t.flaw) line += `（⚠️瑕疵：${t.flaw}）`;
        return line;
      }).join('\n');

    const tabooStr = input.taboos.length ? input.taboos.join('、') : '无特殊忌讳';

    let prompt = `## 武器基础
- 名号：${input.weaponName}
- 门类：${catInfo?.name ?? input.category}
- 形制：${formInfo?.form?.name ?? input.type}
- 底蕴：${input.grade}
- 材质：${matInfo?.name ?? input.baseMaterial}

## 特质列表
${traitLines || '（无特质）'}

## 控制项
- 器性：${input.temperament}
- 前尘类型：${input.pastType}
- 专属忌讳：${tabooStr}
- 反差感模式：${input.reverseMode ? '开启（怪毛病必须和凶名强反差）' : '关闭'}`;

    if (module) {
      prompt += `\n\n## 注意：仅重新生成【${module}】模块，其他模块不需要输出。`;
    }

    return prompt;
  }

  /**
   * 生成完整五感卡（或单模块重生成）
   */
  async generate(input: SenseCardInput, opts?: { module?: string; llmConfig?: LlmConfig }): Promise<Partial<SenseCardResult>> {
    const user = this.buildUserPrompt(input, opts?.module);
    const raw = await this.callWithRetry(this.buildMessages(SYSTEM_PROMPT, user), {
      temperature: 0.4,
      maxTokens: 2500,
      ...opts?.llmConfig,
    });
    return this.parse(raw, opts?.module);
  }

  private parse(raw: string, module?: string): Partial<SenseCardResult> {
    const result: Partial<SenseCardResult> = {};

    const extract = (label: string): string => {
      const re = new RegExp(`【${label}】\\s*([\\s\\S]*?)(?=\\n【|$)`);
      const m = raw.match(re);
      return m ? m[1].trim() : '';
    };

    if (!module || module === '真本事') result.realSkill = extract('真本事');
    if (!module || module === '怪毛病') result.weirdTrait = extract('怪毛病');
    if (!module || module === '前尘影事') result.pastMemory = extract('前尘影事');
    if (!module || module === '江湖名头') {
      const block = extract('江湖名头');
      // 尝试多种格式：外号：X / 外号「X」/ 第一行
      const nickMatch = block.match(/外号[：:「]\s*[「"]?([^」"\n]+)/);
      const heiMatch = block.match(/黑话[：:「]\s*[「"]?([^」"\n]+)/);
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (nickMatch) {
        result.jianghuNickname = nickMatch[1].trim();
      } else {
        // fallback: 第一行去掉"外号"前缀
        result.jianghuNickname = (lines[0] ?? '').replace(/^外号[：:]?\s*/, '').trim();
      }
      if (heiMatch) {
        result.jianghuHeihua = heiMatch[1].trim();
      } else {
        // fallback: 找含"黑话"的行，否则取第二行
        const heiLine = lines.find((l) => l.includes('黑话'));
        result.jianghuHeihua = heiLine
          ? heiLine.replace(/.*黑话[：:]?\s*/, '').trim()
          : (lines[1] ?? '').trim();
      }
    }
    if (!module || module === '专属规矩') result.rules = extract('专属规矩');

    if (!module || module === '剧情钩子') {
      const block = extract('剧情钩子');
      const hooks: SenseCardHook[] = [];
      const hookTypes: Array<'seek' | 'eerie' | 'conflict'> = ['seek', 'eerie', 'conflict'];
      const lines = block.split('\n').filter((l) => l.trim());
      for (let i = 0; i < Math.min(lines.length, 3); i++) {
        hooks.push({ type: hookTypes[i], title: '', content: lines[i].replace(/^[①②③]\s*/, '').trim() });
      }
      result.hooks = hooks;
    }

    if (!module || module === '名场面草稿') {
      const block = extract('名场面草稿');
      const scenes: SenseCardScene[] = [];
      const sceneTypes: Array<'daily' | 'battle' | 'comedy'> = ['daily', 'battle', 'comedy'];
      const lines = block.split('\n').filter((l) => l.trim());
      for (let i = 0; i < Math.min(lines.length, 3); i++) {
        scenes.push({ type: sceneTypes[i], content: lines[i].replace(/^[①②③]\s*/, '').trim() });
      }
      result.famousScenes = scenes;
    }

    if (!module || module === '器灵') result.spirit = extract('器灵');

    return result;
  }
}

export const weaponSenseCardAgent = new WeaponSenseCardAgent();
