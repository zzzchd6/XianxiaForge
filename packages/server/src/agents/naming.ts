/**
 * NamingAgent - 通用命名模块（LLM）
 * 当前支持武器名号/功法名号/人物姓名；预留门派命名扩展位。
 * 仅名号走 LLM，特质随机走确定性引擎（weapon-random），以节省 token。
 */
import { BaseAgent } from './base.js';
import type { LlmConfig } from '../types.js';
import { getCategory, getForm } from '../data/weapon-catalog.js';
import { getDao, getStyle, DEPTH_NAME_SUFFIX, type GuidanceDepth, type StyleType } from '../data/technique-catalog.js';
import {
  findRaceCategory,
  findRaceSub,
  findPosition,
  stanceLabel,
  FORBIDDEN_NAME_CHARS,
  type Gender,
  type PositionKey,
} from '@novel-studio/shared';

export class NamingAgent extends BaseAgent {
  constructor() {
    super('NamingAgent', 2);
  }

  /**
   * 按门类形制生成武器名号
   * @param category 门类ID（martial/taoist/demonic/strange/array）
   * @param type 形制ID
   * @param grade 底蕴层级（影响名号气势）
   * @param count 生成数量（默认1）
   */
  async weaponName(
    category: string, type: string, grade?: string, count = 1, llmConfig?: LlmConfig,
  ): Promise<string[]> {
    const cat = getCategory(category);
    const formInfo = getForm(type);
    const catName = cat?.name || '未知门类';
    const catDesc = cat?.desc || '';
    const formName = formInfo?.form.name || '未知形制';
    const formDesc = formInfo?.form.desc || '';
    const gradeHint = grade ? `底蕴层级「${grade}」，名号气势需匹配该层级（越高越古朴厚重）` : '底蕴层级不限';

    const system = `你是诛仙世界观下的仙侠器物命名大师，精通古典器物美学的命名之道。

【命名要求】
- 门类：${catName}（${catDesc}）
- 形制：${formName}（${formDesc}）
- ${gradeHint}
- 名号2-4字为主，古朴有意境，贴合诛仙文风（如"天琊""斩龙""墨雪""噬魂"之韵）
- 避免直白堆砌（不要"超级无敌剑"），避免与形制门类违和
- 只输出名号本身，不要解释

请以JSON数组输出 ${count} 个候选名号：
{"names": ["名号1", "名号2"]}`;

    const user = `请为「${catName}·${formName}」生成 ${count} 个 weapon 名号。`;

    const raw = await this.callWithRetry(this.buildMessages(system, user), {
      temperature: 0.95,
      maxTokens: 200,
      ...llmConfig,
    });

    try {
      const parsed = this.parseJsonResponse<{ names: string[] }>(raw);
      const names = (parsed.names || []).map(n => String(n).trim()).filter(Boolean);
      return names.length ? names.slice(0, count) : [];
    } catch {
      return [];
    }
  }

  /**
   * 按主修道则+指引深度+体例生成功法名号（附录H命名规则）
   * @param mainDao 主修道则ID（gengjin/kunearth/...）
   * @param depth 指引深度（rudimentary/complete/essential）
   * @param styleType 功法体例（cultivate/attack/defense/assist/special）
   * @param count 生成数量（默认1）
   */
  async techniqueName(
    mainDao: string, depth: GuidanceDepth, styleType?: StyleType, count = 1, llmConfig?: LlmConfig,
  ): Promise<string[]> {
    const dao = getDao(mainDao);
    const daoName = dao?.name || '未知道则';
    const daoAttrs = dao?.attrs || '';
    const prefixes = (dao?.prefixes || ['玄']).join('、');
    const styleName = styleType ? (getStyle(styleType)?.name || '') : '';
    const suffixHint = (DEPTH_NAME_SUFFIX[depth] || []).join('、');
    const depthLabel = depth === 'essential' ? '直指本源' : depth === 'complete' ? '完整传承' : '入门指引';

    const system = `你是诛仙世界观下的仙侠功法命名大师，精通古典道法美学与九大本源道则体系。

【命名要求】
- 主修道则：${daoName}（核心属性：${daoAttrs}）
- 前缀意象须贴合道则属性，优先从「${prefixes}」等意象化用
- 指引深度：${depthLabel}，名号后缀须匹配——可用后缀：「${suffixHint}」
${styleType ? `- 功法体例：${styleName}，名号气质须贴合体例定位` : ''}
- 名号2-4字为主，古朴有意境，贴合诛仙文风（如《太极玄清道》《天书》《焚香玉册》之韵）
- 严禁出现「天级、神级、上品、下品、极品、圣级、帝级、无敌、超级」等品级词汇（功法无品级高低）
- 避免直白堆砌与现代网络词汇，避免与道则属性违和
- 只输出名号本身（可带书名号），不要解释

请以JSON数组输出 ${count} 个候选名号：
{"names": ["名号1", "名号2"]}`;

    const user = `请为「${daoName}·${depthLabel}${styleType ? '·' + styleName : ''}」生成 ${count} 个功法名号。`;

    const raw = await this.callWithRetry(this.buildMessages(system, user), {
      temperature: 0.95,
      maxTokens: 200,
      ...llmConfig,
    });

    try {
      const parsed = this.parseJsonResponse<{ names: string[] }>(raw);
      const names = (parsed.names || [])
        .map(n => String(n).trim().replace(/[《》]/g, ''))
        .filter(Boolean);
      return names.length ? names.slice(0, count) : [];
    } catch {
      return [];
    }
  }

  /**
   * 按种族+性别+人设生成人物姓名候选（自定义人物 AI 精取名）
   * @param raceCategory 种族大类ID（human/demon_race/...）
   * @param raceSub 种族小类ID
   * @param gender 性别
   * @param position 定位档位（可选，影响名字气质）
   * @param stance 立场 0-100（可选，0浩然正气/100邪异诡道）
   * @param count 生成数量（默认5）
   */
  async characterName(
    raceCategory: string, raceSub: string, gender: Gender,
    position?: PositionKey, stance?: number, count = 5, llmConfig?: LlmConfig,
  ): Promise<string[]> {
    const cat = findRaceCategory(raceCategory);
    const sub = findRaceSub(raceCategory, raceSub);
    const pos = position ? findPosition(position) : undefined;
    const genderLabel = gender === 'male' ? '男' : '女';
    const raceDesc = `${cat?.name || '人族'}·${sub?.name || ''}（${sub?.desc || ''}）`;
    const posHint = pos ? `- 实力定位：${pos.name}（${pos.desc}），定位越高名字越古朴贵重，低定位名字接地气` : '';
    const stanceHint = typeof stance === 'number'
      ? `- 立场：${stanceLabel(stance)}（${stance}/100），邪异者名字可带幽邃凌厉之气，正道者清雅端方，但不要直白写“魔”“邪”满天飞`
      : '';

    const system = `你是诛仙世界观下的仙侠人物取名大师，精通古典姓名美学。

【取名要求】
- 人物：${raceDesc}，${genderLabel}性
${posHint}
${stanceHint}
- 姓名格式：姓+名，2-3字为主，要像真实古人名而非网文堆砌（好例：张小凡、陆雪琦、曾书书、周一仙之韵）
- 非人族可用种族特色姓（如妖族的涂山/青丘、魔族的厉/冥），但仍须像个正经名字
- 禁用现代烂大街字：${FORBIDDEN_NAME_CHARS.join('、')}
- 候选之间风格拉开差异（有的清雅、有的古朴、有的凌厉），避免同姓或同字扎堆
- 只输出姓名本身，不要道号称号后缀，不要解释

请以JSON数组输出 ${count} 个候选姓名：
{"names": ["姓名1", "姓名2"]}`;

    const user = `请为「${raceDesc}·${genderLabel}」生成 ${count} 个人物姓名。`;

    const raw = await this.callWithRetry(this.buildMessages(system, user), {
      temperature: 0.95,
      maxTokens: 300,
      ...llmConfig,
    });

    try {
      const parsed = this.parseJsonResponse<{ names: string[] }>(raw);
      const names = (parsed.names || [])
        .map(n => String(n).trim().replace(/[《》「」\s]/g, ''))
        .filter(n => n.length >= 2 && n.length <= 5);
      return names.length ? names.slice(0, count) : [];
    } catch {
      return [];
    }
  }
}

export const namingAgent = new NamingAgent();
