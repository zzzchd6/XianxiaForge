/**
 * CharacterMartialLoreAgent - 人物武学档案生成Skill（LLM）
 *
 * 人物绑定一门功法 + 一件武器后调用：
 *  1. 融合创新招式：把功法配套招式与武器配套招式两两/组合创新，产出 3-5 式「人器合一」的融合招式
 *  2. 撰写人物功法武器小传（500-800字）：此人携此功法、持此武器的修行与战斗风貌
 *
 * 铁律：融合招式必须基于双方既有招式与道则，不得凭空添加设定外能力；化用人物性格经历；诛仙文风；禁品级词。
 * 温度0.7（融合创新需要更高创造性，但受双方招式与道则硬约束）。
 */
import { BaseAgent } from './base.js';
import type { LlmConfig } from '../types.js';
import { getDao, getStyle } from '../data/technique-catalog.js';
import { getCategory, getForm } from '../data/weapon-catalog.js';

export interface MartialLoreCharacter {
  name: string;
  raceCategory: string;
  raceSub: string;
  innerPersonality: string;
  outerPersonality: string[];
  talents: string[];
  description?: string | null;
  verdictPoem?: string | null;
  verdictComment?: string | null;
  stance?: number | null;
  position?: string | null;
}

export interface MartialLoreTechnique {
  name: string;
  mainDao: string;
  assistDao: string[];
  styleType: string;
  description?: string | null;
  moves: { name: string; desc: string; tier?: string }[];
}

export interface MartialLoreWeapon {
  name: string;
  category: string;
  type: string;
  grade?: string | null;
  intro?: string | null;
  moves: { name: string; desc: string }[];
}

export interface MartialLoreInput {
  character: MartialLoreCharacter;
  technique: MartialLoreTechnique;
  weapon: MartialLoreWeapon;
}

/** 融合招式（source 标注来源：功法/武器/融合创新） */
export interface FusedMove {
  name: string;
  desc: string;
  source: 'technique' | 'weapon' | 'fused';
}

export interface MartialLoreResult {
  fusedMoves: FusedMove[];
  biography: string;
}

export class CharacterMartialLoreAgent extends BaseAgent {
  constructor() {
    super('CharacterMartialLoreAgent', 2);
  }

  private buildUserPrompt(i: MartialLoreInput): string {
    const c = i.character;
    const t = i.technique;
    const w = i.weapon;
    const mainDaoName = getDao(t.mainDao)?.name || t.mainDao;
    const assistDaoNames = (t.assistDao || []).map(id => getDao(id)?.name || id).join('、') || '无';
    const styleName = getStyle(t.styleType)?.name || t.styleType;
    const categoryName = getCategory(w.category)?.name || '未知门类';
    const formName = getForm(w.type)?.form.name || '未知形制';
    const tMoves = (t.moves || []).map(m => `「${m.name}」${m.desc}`).join('\n  ') || '无';
    const wMoves = (w.moves || []).map(m => `「${m.name}」${m.desc}`).join('\n  ') || '无';
    return [
      '请为以下人物生成其功法与武器融合的武学档案：',
      '',
      '【人物】',
      `- 姓名：${c.name}（种族：${c.raceCategory}/${c.raceSub}；实力定位：${c.position || '未知'}；立场：${c.stance ?? '未知'}）`,
      `- 内在性格：${c.innerPersonality}；外在性格：${(c.outerPersonality || []).join('、') || '无'}`,
      `- 先天禀赋：${(c.talents || []).join('、') || '无'}`,
      c.verdictPoem ? `- 判词：${c.verdictPoem.replace(/\n/g, '，')}` : '',
      c.description ? `- 人物小传：${c.description}` : '',
      '',
      '【功法】',
      `- 名号：${t.name}（主修${mainDaoName}，辅修${assistDaoNames}，体例${styleName}）`,
      t.description ? `- 功法详解：${t.description}` : '',
      `- 配套招式：\n  ${tMoves}`,
      '',
      '【武器】',
      `- 名号：${w.name}（门类${categoryName}，形制${formName}${w.grade ? `，底蕴${w.grade}` : ''}）`,
      w.intro ? `- 武器简介：${w.intro}` : '',
      `- 配套招式：\n  ${wMoves}`,
    ].filter(Boolean).join('\n');
  }

  /** 解析 LLM 输出：切分【融合招式】与【武学小传】两块 */
  private parse(raw: string): MartialLoreResult {
    const text = raw.trim();
    // 融合招式
    const fusedMoves: FusedMove[] = [];
    const moveBlock = text.match(/【融合招式】\s*[：:]?\s*([\s\S]*?)(?=【武学小传】|$)/);
    if (moveBlock) {
      const re = /\d+\s*[.、]\s*「(.+?)」\s*[（(]\s*(功法|武器|融合)[^）)]*\s*[）)]\s*[：:]\s*(.+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(moveBlock[1])) !== null) {
        const name = m[1].trim();
        const srcRaw = m[2].trim();
        const source: FusedMove['source'] = srcRaw === '功法' ? 'technique' : srcRaw === '武器' ? 'weapon' : 'fused';
        const desc = m[3].trim();
        if (name && desc) fusedMoves.push({ name, desc, source });
      }
    }
    // 小传
    const bioMatch = text.match(/【武学小传】\s*[：:]?\s*([\s\S]*?)$/);
    let biography = (bioMatch ? bioMatch[1] : '').replace(/【融合招式】[\s\S]*$/, '').trim();
    if (!biography) {
      // 退化：去掉招式块后的全文
      biography = text.replace(/【融合招式】[\s\S]*?(?=【武学小传】)/, '').replace(/【武学小传】\s*[：:]?/, '').trim();
    }
    if (!biography) throw new Error('[CharacterMartialLoreAgent] 武学小传生成为空');
    return { fusedMoves, biography };
  }

  async generate(input: MartialLoreInput, llmConfig?: LlmConfig): Promise<MartialLoreResult> {
    const system = `你是「指尖仙侠」世界观专属武学设定师，精通古典仙侠道法、兵器设定与九大本源道则体系。你的任务：把人物所修功法与所持兵器的招式融会贯通，创新出「人器合一」的融合招式，并撰写此人功法武器合一的武学小传。严格遵循以下铁律，绝对禁止OOC：

# 核心铁律
1. 融合须有据：每一式融合招式必须基于功法或武器的既有招式与道则演化而来，不得凭空添加设定外的道则能力。
2. 人器合一：融合招式要体现「功法催动兵器、兵器放大功法」的协同，而非简单拼接；须贴合人物的性格、禀赋与战斗习惯。
3. 代价对等：威力越大的融合式，越要点明催动代价或破绽。

# 第一部分·融合招式
- 生成 3-5 式融合招式，每式取 2-4 字古风招式名。
- 每式标注来源：（功法）=沿用功法招式精要、（武器）=沿用武器招式精要、（融合）=功法×武器创新合击。其中「融合」式至少 2 式，是重点。
- 每式用 1-2 句写清：催动方式 + 人器协同的实战效果 + 代价（若有）。

# 第二部分·武学小传
- 篇幅500-800字，自然语言散文体，分三到四个自然段，不用列表、不用标题、不用markdown。
- 第一段：此人为何修这门功法、为何用这件兵器，二者如何契合其心性经历。
- 第二段：功法与兵器在其手中如何相互成就，修炼与御器的独特体感。
- 第三段：实战风貌（融合招式的实战画面），体现人物独有的战斗气质。
- 第四段（可选）：代价、破绽或成长潜力，可化用判词意境埋戏剧钩子。

# 文风与禁忌
- 文风古朴凝练，贴合诛仙文风，禁用现代词、网络词、西式奇幻词汇。
- 严禁出现"天级/神级/上品/下品"等品级词汇。

# 输出格式（严格遵守，便于解析）
【融合招式】：
1. 「招式名」（融合）：描述
2. 「招式名」（融合）：描述
3. 「招式名」（功法）：描述
...
【武学小传】：
<此处为500-800字散文小传>

只输出以上两部分内容，不要任何额外解释或寒暄。`;

    const user = this.buildUserPrompt(input);
    const raw = await this.callWithRetry(this.buildMessages(system, user), {
      temperature: 0.7,
      maxTokens: 2000,
      ...llmConfig,
    });
    const result = this.parse(raw);
    if (!result.fusedMoves.length) {
      // 解析失败重试一次
      const raw2 = await this.callWithRetry(this.buildMessages(system, user), { temperature: 0.7, maxTokens: 2000, ...llmConfig });
      const retry = this.parse(raw2);
      if (retry.fusedMoves.length) return retry;
    }
    return result;
  }
}

export const characterMartialLoreAgent = new CharacterMartialLoreAgent();
