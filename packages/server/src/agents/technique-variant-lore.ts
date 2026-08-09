/**
 * TechniqueVariantLoreAgent - 个人化变种详解生成Skill（LLM，千人千面血肉层）
 *
 * 与规则引擎 generateVariant（骨架层，确定性零token）分工：
 *  - 骨架层产出 variantName/稀有度/道则权重偏移/特质神通反噬偏移/修炼适配/factorTrace（保道则边界、代价对等、可追溯）
 *  - 本 Skill 在骨架约束之上，化用人物小传/判词/具体天赋与基础功法详解，写出 400-600 字「为何这门功法在此人身上长出独特形态」的自然语言详解
 *
 * 铁律：不新增基础功法未含道则能力；增益必伴代价；程度贴合稀有度；所有差异须能在骨架 factorTrace 与人物属性中找到依据。
 * 温度0.6（比基础功法详解 0.4 略高以增加个性差异，但受骨架硬约束）。
 */
import { BaseAgent } from './base.js';
import type { LlmConfig } from '../types.js';
import { getDao, getStyle } from '../data/technique-catalog.js';

/** 人物画像（custom_character 行子集，含小传/判词等个性化文本） */
export interface VariantLoreCharacter {
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

/** 基础功法（custom_technique 行子集） */
export interface VariantLoreTechnique {
  name: string;
  mainDao: string;
  assistDao: string[];
  styleType: string;
  description?: string | null;
  moves?: { name: string; desc: string; tier?: string }[];
}

/** 规则引擎骨架（VariantDraft 的展示性子集） */
export interface VariantLoreSkeleton {
  variantName: string;
  rarity: 'common' | 'remarkable' | 'rare';
  daoNote: string;
  traitChanges: string[];
  abilityChanges: string[];
  backlashChanges: string[];
  exclusiveSkill: string[];
  cultivationNote: string;
  factorTrace: string[];
}

export interface VariantLoreInput {
  character: VariantLoreCharacter;
  technique: VariantLoreTechnique;
  skeleton: VariantLoreSkeleton;
}

const RARITY_LABEL: Record<string, string> = {
  common: '寻常变种（差异细微，多为气质与运用习惯的微调）',
  remarkable: '显著变种（差异明显，已影响修炼偏向与战斗风格）',
  rare: '稀世变种（差异剧烈，几为此人量身重塑，伴随独特代价）',
};

export class TechniqueVariantLoreAgent extends BaseAgent {
  constructor() {
    super('TechniqueVariantLoreAgent', 2);
  }

  private buildUserPrompt(i: VariantLoreInput): string {
    const c = i.character;
    const t = i.technique;
    const s = i.skeleton;
    const mainDaoName = getDao(t.mainDao)?.name || t.mainDao;
    const assistDaoNames = (t.assistDao || []).map(id => getDao(id)?.name || id).join('、') || '无';
    const styleName = getStyle(t.styleType)?.name || t.styleType;
    const movesLine = (t.moves || []).map(m => `「${m.name}」${m.desc}`).join('；') || '无';
    return [
      '请为以下人物撰写其个人功法变种详解：',
      '',
      '【人物】',
      `- 姓名：${c.name}（种族：${c.raceCategory}/${c.raceSub}；实力定位：${c.position || '未知'}；立场：${c.stance ?? '未知'}）`,
      `- 内在性格：${c.innerPersonality}；外在性格：${(c.outerPersonality || []).join('、') || '无'}`,
      `- 先天禀赋：${(c.talents || []).join('、') || '无'}`,
      c.verdictPoem ? `- 判词：${c.verdictPoem.replace(/\n/g, '，')}` : '',
      c.verdictComment ? `- 考语：${c.verdictComment}` : '',
      c.description ? `- 人物小传：${c.description}` : '',
      '',
      '【基础功法】',
      `- 名号：${t.name}（主修${mainDaoName}，辅修${assistDaoNames}，体例${styleName}）`,
      t.description ? `- 功法详解：${t.description}` : '',
      `- 配套招式：${movesLine}`,
      '',
      '【个人变种骨架（硬约束，详解须与之吻合，不得矛盾或越界）】',
      `- 变种名号：${s.variantName}`,
      `- 稀有度：${RARITY_LABEL[s.rarity] || s.rarity}`,
      `- 道则权重：${s.daoNote}`,
      s.traitChanges.length ? `- 本源特质变化：${s.traitChanges.join('；')}` : '',
      s.abilityChanges.length ? `- 神通变化：${s.abilityChanges.join('；')}` : '',
      s.backlashChanges.length ? `- 反噬变化：${s.backlashChanges.join('；')}` : '',
      s.exclusiveSkill.length ? `- 专属运用技巧：${s.exclusiveSkill.join('、')}` : '',
      `- 修炼适配：${s.cultivationNote}`,
      s.factorTrace.length ? `- 差异溯源：${s.factorTrace.join('；')}` : '',
    ].filter(Boolean).join('\n');
  }

  async generate(input: VariantLoreInput, llmConfig?: LlmConfig): Promise<string> {
    const system = `你是「指尖仙侠」世界观专属功法设定师，精通古典仙侠道法设定与九大本源道则体系。你的任务：在给定「个人变种骨架」的硬约束之上，撰写一段个人化变种详解，讲清「这门基础功法为何在此人身上长出独特形态」。严格遵循以下铁律，绝对禁止OOC：

# 核心铁律
1. 骨架即边界：详解必须与骨架的道则权重/特质/神通/反噬/修炼适配完全吻合，不得新增基础功法未含的道则能力，不得凭空强化或弱化骨架未提及之处。
2. 代价对等：凡写增益偏向，必同时点出对应代价，与骨架的反噬变化一致。
3. 因人而异：必须化用人物的小传、判词、性格、具体天赋与经历，写出独属于此人的修炼体悟与战斗风貌——换一个同类人物便不成立，方为上品。
4. 程度贴合稀有度：寻常变种写气质与运用习惯的微调；显著变种写修炼偏向与战斗风格的明显分化；稀世变种写几近量身重塑的剧烈差异与独特代价。

# 撰写要求
- 篇幅400-600字，自然语言散文体，分两到三个自然段，不用列表、不用标题、不用markdown。
- 第一段：点明此人的心性/经历/禀赋如何与这门功法相互激发，使功法呈现何种个人形态（呼应变种名号与稀有度）。
- 第二段：具体写修炼过程中的偏向与体感（道则权重、特质、修炼适配的个性化体现），须有人物细节。
- 第三段：写实战风貌与代价（神通变化、专属技巧、反噬的个人化表现），可化用判词意境埋戏剧钩子。
- 文风古朴凝练，贴合诛仙文风，禁用现代词、网络词、西式奇幻词汇。
- 严禁出现"天级/神级/上品/下品"等品级词汇，严禁罗列骨架词条（须化为叙事）。
- 只输出变种详解正文，不要任何解释、标题或寒暄。`;

    const user = this.buildUserPrompt(input);
    const raw = await this.callWithRetry(this.buildMessages(system, user), {
      temperature: 0.6,
      maxTokens: 1100,
      ...llmConfig,
    });
    const text = raw.trim();
    if (!text) throw new Error('[TechniqueVariantLoreAgent] 变种详解生成为空');
    return text;
  }
}

export const techniqueVariantLoreAgent = new TechniqueVariantLoreAgent();
