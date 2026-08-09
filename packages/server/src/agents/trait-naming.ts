/**
 * TraitNamingAgent - 特质古风命名（LLM批量润色）
 *
 * 在武器保存时调用，将零token组合引擎生成的"标签式名称"批量替换为有画面感的古风特质名。
 * 单次LLM调用处理全部待命名特质，节省token。
 *
 * 降级策略：LLM失败时用方向标签拼接兜底（如"破罡·雷淬"），不阻塞保存流程。
 */
import { BaseAgent } from './base.js';
import type { LlmConfig } from '../types.js';
import { getDirection } from '../data/trait-directions.js';
import type { GeneratedTrait } from '../services/trait-composer.js';

// ============================================================
// 类型
// ============================================================

export interface TraitNamingInput {
  weaponName: string;
  category: string;
  grade: string;
  traits: GeneratedTrait[];
}

/** traitId → 新名称 */
export type TraitNamingResult = Record<string, string>;

// ============================================================
// 系统提示词
// ============================================================

const SYSTEM_PROMPT = `# 角色
你是仙侠兵器设定师，负责为武器特质起古风名号。

# 规则
1. 每个特质名2-4字，古风有画面感，像「破军棱」「噬魂纹」「藏锋匣」「雷劫印」。
2. 名字必须贴合特质效果，不能泛泛（禁止「强化」「加持」这类空泛词）。
3. 稀有特质名字可以霸气些（3-4字），普通特质朴素些（2-3字）。
4. 同一武器的多个特质名不能重字、不能同风格（避免全叫「XX印」「XX纹」）。
5. 禁止出现现代词、数值、英文。

# 输出格式
严格输出JSON对象，key为特质ID，value为新名称字符串。不要输出任何其他文字。
示例：{"trait_001":"破军棱","trait_002":"藏锋匣"}`;

// ============================================================
// Agent
// ============================================================

class TraitNamingAgent extends BaseAgent {
  constructor() {
    super('TraitNamingAgent', 2);
  }

  private buildUserPrompt(input: TraitNamingInput): string {
    const lines = input.traits.map((t) => {
      const rareTag = t.isRare ? '（稀有）' : '';
      return `- ID:${t.id} 类型:${t.type} 效果:${t.desc}${rareTag}`;
    });

    return `## 武器：${input.weaponName}（${input.category}，底蕴${input.grade}）

## 待命名特质（${input.traits.length}个）
${lines.join('\n')}

请为每个特质起一个古风名号，输出JSON。`;
  }

  /**
   * 批量命名特质。LLM失败时降级为方向标签拼接。
   */
  async nameTraits(input: TraitNamingInput, llmConfig?: LlmConfig): Promise<TraitNamingResult> {
    // 过滤：只命名非经典、非烙印、当前名称为自动生成（即desc的前N字或空）的特质
    const toName = input.traits.filter((t) => !t.isClassic && !t.isScar);
    if (toName.length === 0) return {};

    try {
      const user = this.buildUserPrompt({ ...input, traits: toName });
      const raw = await this.callWithRetry(this.buildMessages(SYSTEM_PROMPT, user), {
        temperature: 0.3,
        maxTokens: 600,
        ...llmConfig,
      });
      const parsed = this.parseJsonResponse<TraitNamingResult>(raw);

      // 校验：确保每个key都在待命名列表中
      const validIds = new Set(toName.map((t) => t.id));
      const result: TraitNamingResult = {};
      for (const [id, name] of Object.entries(parsed)) {
        if (validIds.has(id) && typeof name === 'string' && name.length > 0 && name.length <= 8) {
          result[id] = name;
        }
      }
      return result;
    } catch (err: any) {
      this.log(`LLM命名失败，降级为标签拼接: ${err.message}`, 'warn');
      return this.fallbackNames(toName);
    }
  }

  /**
   * 降级：从 sourceDirections 提取方向标签拼接
   * 如 ['forge.blade.armor_break', 'forge.texture.quench'] → "破罡·淬锋"
   */
  private fallbackNames(traits: GeneratedTrait[]): TraitNamingResult {
    const result: TraitNamingResult = {};
    for (const t of traits) {
      const labels = t.sourceDirections
        .map((dirId) => getDirection(dirId)?.label)
        .filter(Boolean) as string[];
      if (labels.length > 0) {
        // 取前2个方向标签，各取前2字，用·连接
        const parts = labels.slice(0, 2).map((l) => l.slice(0, 2));
        result[t.id] = parts.join('·');
      }
      // 如果完全没有方向信息，保留原名不改
    }
    return result;
  }
}

export const traitNamingAgent = new TraitNamingAgent();
