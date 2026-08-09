/**
 * TechniqueLoreAgent - 功法详解生成Skill（LLM）
 * 完成创建时调用：按全部选中标签生成 500-700 字自然语言功法详解，
 * 含核心逻辑、修行要点、战斗表现。温度0.4（需求：完成创建温度0.4），约1000token。
 * 所有标签ID在此解析为中文名，输出效果均可追溯到参数项（天然过审）。
 * 核心设定铁律：功法无品级高低，只有道则挖掘深度与运用技巧之别；能力边界由道则决定。
 */
import { BaseAgent } from './base.js';
import type { LlmConfig } from '../types.js';
import {
  getDao, getGuidance, getStyle, getCoreTrait, getPracticePath, getAbility,
  getBacklash, getInheritance, getUsageSkill, getEvolution, getInherentConflict,
  DAO_REALMS, type DaoId, type GuidanceDepth, type StyleType, type BodyMark,
} from '../data/technique-catalog.js';

/** 功法详解生成所需参数（custom_technique 行子集） */
export interface TechniqueLoreInput {
  name: string;
  mainDao: string;
  assistDao: string[];
  guidanceDepth: GuidanceDepth;
  fakeDepth?: string | null;
  styleType: StyleType;
  coreTraits: string[];
  practicePath: string;
  bodyMark?: BodyMark;
  usageSkills: string[];
  abilities: string[];
  backlash: string[];
  inheritance: string;
  evolution: string[];
  inherentConflict?: string | null;
}

/** 功法配套招式（与 weapon_lore.moves 同构） */
export interface TechniqueMove {
  name: string;
  desc: string;
  /** 招式梯度：基础招/进阶招/特质招/杀招 */
  tier?: string;
}

/** 功法详解 + 配套招式生成结果 */
export interface TechniqueLoreResult {
  description: string;
  moves: TechniqueMove[];
}

export class TechniqueLoreAgent extends BaseAgent {
  constructor() {
    super('TechniqueLoreAgent', 2);
  }

  private daoNames(ids: string[]): string {
    return (ids || []).map(id => getDao(id)?.name || id).filter(Boolean).join('、') || '无';
  }

  private listNames(ids: string[], resolver: (id: string) => { name: string } | undefined): string {
    const names = (ids || []).map(id => resolver(id)?.name).filter((n): n is string => Boolean(n));
    return names.length ? names.join('、') : '无';
  }

  /** 神通按道境分组展示 */
  private abilityBlock(ids: string[]): string {
    const byRealm = new Map<string, string[]>();
    for (const id of ids || []) {
      const a = getAbility(id);
      if (!a) continue;
      const arr = byRealm.get(a.daoRealm) || [];
      arr.push(a.name);
      byRealm.set(a.daoRealm, arr);
    }
    const lines: string[] = [];
    for (const realm of DAO_REALMS) {
      const arr = byRealm.get(realm);
      if (arr?.length) lines.push(`  - ${realm}境：${arr.join('、')}`);
    }
    return lines.length ? lines.join('\n') : '  - 无';
  }

  private buildUserPrompt(t: TechniqueLoreInput): string {
    const guidanceName = getGuidance(t.guidanceDepth)?.name || t.guidanceDepth;
    const styleName = getStyle(t.styleType)?.name || t.styleType;
    const pathName = getPracticePath(t.practicePath)?.name || t.practicePath;
    const inhName = getInheritance(t.inheritance)?.name || t.inheritance;
    const bm = t.bodyMark;
    return [
      '请根据以下功法参数，撰写一段自然语言功法详解：',
      `- 功法名号：${t.name}`,
      `- 主修道则：${getDao(t.mainDao)?.name || t.mainDao}`,
      `- 辅修道则：${this.daoNames(t.assistDao)}`,
      `- 传法指引深度：${guidanceName}`,
      `- 对外展示版本：${t.fakeDepth ? (getGuidance(t.fakeDepth as GuidanceDepth)?.name || t.fakeDepth) : '无（不藏拙）'}`,
      `- 功法体例：${styleName}`,
      `- 本源运用方向：${this.listNames(t.coreTraits, getCoreTrait)}`,
      `- 行功路线：${pathName}`,
      `- 典型运用技巧：${(t.usageSkills || []).map(id => getUsageSkill(id)?.text).filter(Boolean).join('、') || '无'}`,
      `- 分道境配套神通：\n${this.abilityBlock(t.abilities)}`,
      `- 反噬代价：${this.listNames(t.backlash, getBacklash)}`,
      `- 传承方式：${inhName}`,
      `- 演化方向：${this.listNames(t.evolution, getEvolution)}`,
      `- 先天矛盾：${t.inherentConflict ? (getInherentConflict(t.inherentConflict)?.name || t.inherentConflict) : '无'}`,
      bm ? `- 身体印记：外貌「${bm.appearance}」；气场「${bm.aura}」；行为「${bm.behavior}」；气息「${bm.breath}」` : '',
    ].filter(Boolean).join('\n');
  }

  /** 解析 LLM 输出：切分【功法详解】与【配套招式】两块 */
  private parseLore(raw: string): TechniqueLoreResult {
    const text = raw.trim();
    // 详解块：【功法详解】之后到【配套招式】之前（或全文结尾）
    const descMatch = text.match(/【功法详解】\s*[：:]?\s*([\s\S]*?)(?=【配套招式】|$)/);
    let description = (descMatch ? descMatch[1] : text).trim();
    // 若未命中分段标记，退化为"去掉招式块后的正文"
    description = description.replace(/【配套招式】[\s\S]*$/, '').trim();
    if (!description) throw new Error('[TechniqueLoreAgent] 功法详解生成为空');

    // 招式块：1.「招式名」（梯度）：描述
    const moves: TechniqueMove[] = [];
    const moveBlock = text.match(/【配套招式】\s*[：:]?\s*([\s\S]*)$/);
    if (moveBlock) {
      const re = /\d+\s*[.、]\s*「(.+?)」\s*[（(]?\s*([^）)]*?)\s*[）)]?\s*[：:]\s*(.+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(moveBlock[1])) !== null) {
        const name = m[1].trim();
        const tier = m[2].trim() || undefined;
        const desc = m[3].trim().replace(/[（(]杀招[）)]/, '').trim();
        if (name && desc) moves.push({ name, desc, tier });
      }
    }
    return { description, moves };
  }

  async generate(input: TechniqueLoreInput, llmConfig?: LlmConfig): Promise<TechniqueLoreResult> {
    const system = `你是「指尖仙侠」世界观专属功法设定师，精通古典仙侠道法设定与九大本源道则体系，严格遵循以下核心铁律，绝对禁止OOC：

# 核心设定铁律（必须贯穿全文）
1. 功法无绝对品级：不存在"品级更高的功法"，只有对道则挖掘更深、传法路径更清晰、指引更完备之别。基础吐纳法与上古传承触碰同一条道则，区别只在指引深度，最终威力取决于修士领悟深度与运用技巧。
2. 能力边界由道则决定：不兼修对应道则的功法永远无法产生对应能力。详解与招式的所有功效必须能在输入的道则与特质中找到依据，不得凭空添加设定外能力。
3. 融合必有代价：多道则融合必伴随反噬风险，对冲融合须突出高风险代价。

# 撰写要求
## 第一部分·功法详解
- 篇幅500-700字，自然语言散文体，分三到四个自然段，不用列表、不用标题、不用markdown。
- 第一段：点明功法渊源、主辅道则与核心逻辑（这门功法从哪个角度挖掘道则）。
- 第二段：修行要点与行功路线（修炼节奏、门槛、指引深度带来的差异、身体印记变化）。
- 第三段：战斗表现与运用技巧（分道境神通的实战画面，体现"运用技巧决定战力"）。
- 第四段（可选）：反噬代价、传承方式与演化潜力，若有先天矛盾须埋入戏剧钩子。

## 第二部分·配套招式
- 固定生成 4 招，梯度依次为「基础招→进阶招→特质招→杀招」。
- 每招取 2-4 字古风招式名，须契合主修道则与功法体例。
- 每招用 1-2 句写清：催动方式 + 实战效果 + 对应道则/特质的体现；杀招须体现最高强度与代价。
- 招式威力梯度通过描述体现，基础招平实、杀招凌厉，不得出现数值或品级。

# 文风与禁忌
- 文风古朴凝练，贴合诛仙文风，禁用现代词、网络词、西式奇幻词汇。
- 严禁出现"天级/神级/上品/下品"等品级词汇。

# 输出格式（严格遵守，便于解析）
【功法详解】：
<此处为500-700字散文详解>
【配套招式】：
1. 「招式名」（基础招）：描述
2. 「招式名」（进阶招）：描述
3. 「招式名」（特质招）：描述
4. 「招式名」（杀招）：描述

只输出以上两部分内容，不要任何额外解释或寒暄。`;

    const user = this.buildUserPrompt(input);
    const raw = await this.callWithRetry(this.buildMessages(system, user), {
      temperature: 0.4,
      maxTokens: 1600,
      ...llmConfig,
    });
    return this.parseLore(raw);
  }
}

export const techniqueLoreAgent = new TechniqueLoreAgent();
