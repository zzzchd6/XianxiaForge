/**
 * ForgeSmartMatchAgent - 三工坊「文字描述 → 参数/方向」智能匹配（LLM）
 *
 * 用户输入一段自然语言描述，LLM 仅负责把描述映射到给定枚举键（零瞎编），
 * 确定性约束（互斥、rank 比较、每类上限、兼容度）一律由服务端 validate 兜底。
 * 温度 0.3，maxTokens 1000，输出严格 JSON。枚举上下文由各路由从真实 config 模块拼装注入，
 * 保证「参数对齐真实 schema」。
 */
import { BaseAgent } from './base.js';
import type { LlmConfig } from '../types.js';

export type ForgeType = 'character' | 'weapon' | 'technique';

const COMMON_RULES = `
# 铁律
1. 只能从「可选枚举」里给出的键名中选，绝对禁止自创键名或中文值（除非字段明确要求中文/数字）。
2. 文本没体现的字段，给出最合理的默认推断（不要留空），但必须符合枚举范围。
3. 只输出 JSON 本体，不要解释、不要 markdown 代码块。`;

const CHARACTER_SYSTEM = `# 角色
你是「众生百态」人物工坊的智能匹配师。根据用户对人物的描述，推荐一组创建参数。

# 输出 JSON 字段
{
  "name": "string（可留空字符串）",
  "gender": "male | female",
  "raceCategory": "种族大类键",
  "raceSub": "该大类下种族小类键",
  "position": "五档定位键",
  "stance": 0-100的整数（0浩然正气 / 50随心所欲 / 100邪异诡道）,
  "innerPersonality": "内在性格（中文，单选）",
  "outerPersonality": ["外在性格（中文）2-3个"],
  "talents": ["天赋名称 3-8个，尽量覆盖不同类别"]
}` + COMMON_RULES;

const WEAPON_SYSTEM = `# 角色
你是「神兵坊」法宝工坊的智能匹配师。根据用户对法宝的描述，推荐一组创建参数。

# 输出 JSON 字段
{
  "name": "string（可留空字符串）",
  "category": "门类键",
  "type": "该门类下形制键",
  "grade": "底蕴档位（中文）",
  "baseMaterial": "材质键",
  "temperament": "器性键",
  "pastType": "前尘键",
  "taboos": ["忌讳键 0-2个"],
  "reverseMode": true或false（描述有反差萌/凶器胆小等强反差时true）
}` + COMMON_RULES;

const TECHNIQUE_SYSTEM = `# 角色
你是「道法自然」功法工坊的智能匹配师。根据用户对功法的描述，推荐一组创建参数。

# 输出 JSON 字段
{
  "name": "string（可留空字符串）",
  "mainDao": "主修大道则键（单选）",
  "assistDao": ["辅修大道则键 0-3个，不要与主修重复"],
  "styleType": "体例键",
  "guidanceDepth": "传承完备度键",
  "practicePath": "行功路线键",
  "inheritance": "传承方式键",
  "coreTraits": ["本源特质键 2-3个"]
}` + COMMON_RULES;

const SYSTEM_PROMPTS: Record<ForgeType, string> = {
  character: CHARACTER_SYSTEM,
  weapon: WEAPON_SYSTEM,
  technique: TECHNIQUE_SYSTEM,
};

class ForgeSmartMatchAgent extends BaseAgent {
  constructor() {
    super('ForgeSmartMatchAgent', 2);
  }

  /**
   * 描述 → 参数键映射。enumContext 为由真实 config 拼装的可选枚举清单。
   * 返回原始 JSON 对象（未校验），校验交由服务端 validate 兜底。
   */
  async match(
    forgeType: ForgeType,
    description: string,
    enumContext: string,
    llmConfig?: LlmConfig
  ): Promise<Record<string, any>> {
    const user = `## 可选枚举\n${enumContext}\n\n## 用户描述\n${description}`;
    const raw = await this.callWithRetry(this.buildMessages(SYSTEM_PROMPTS[forgeType], user), {
      temperature: 0.3,
      maxTokens: 1000,
      configOverride: llmConfig,
    });
    return this.parseJsonResponse<Record<string, any>>(raw);
  }
}

export const forgeSmartMatchAgent = new ForgeSmartMatchAgent();
