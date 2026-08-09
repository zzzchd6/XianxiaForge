/**
 * CustomEntityExtractorAgent - 章节正文 → 自定义实体结构化抽取（09-自定义实体自动维护）
 *
 * 复用 WorldEntityExtractorAgent 框架（温度0.2 + zod校验 + 脏输出清洗），
 * 但输出格式简化：只关注 新人物/新武器/新功法/已有人物动态 四类。
 * 宁缺毋滥：文本没明确出现的绝不脑补；已有名单内的实体不重复输出。
 */
import { z } from 'zod';
import { BaseAgent } from './base.js';
import type { LlmConfig } from '../types.js';

// ============================================================
// zod 输出 schema
// ============================================================

const newCharacterSchema = z.object({
  name: z.string().trim().min(1),
  /** 性别推断（15-SRS P0-1）：male/female/unknown，无法确定时给 unknown，禁止猜测 */
  gender: z.enum(['male', 'female', 'unknown']).default('unknown'),
  /** 本章中该人物的描写片段，100-200字 */
  description: z.string().default(''),
  /** 戏份权重 */
  significance: z.enum(['major', 'supporting', 'minor']).default('minor'),
  hasDialogue: z.boolean().default(false),
  mentionCount: z.number().int().default(1),
});

const newWeaponSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().default(''),
  /** 本章中持有者（人名，可选） */
  owner: z.string().trim().optional(),
});

const newTechniqueSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().default(''),
  /** 本章中施展者（人名，可选） */
  practitioner: z.string().trim().optional(),
});

const characterUpdateSchema = z.object({
  /** 已存在的人物名（须与已有名单完全一致） */
  name: z.string().trim().min(1),
  /** 本章新信息，一句话 */
  updateText: z.string().trim().min(1),
  category: z.enum(['realm', 'item', 'personality', 'relationship', 'other']).default('other'),
});

/** 新地点（10-山河舆图 US-8） */
const newLocationSchema = z.object({
  name: z.string().trim().min(1),
  /** 本章中该地点的环境描写片段 */
  description: z.string().default(''),
  /** 地点类型猜测 */
  locationType: z.enum(['sect', 'city', 'secret_realm', 'danger', 'teleport', 'battlefield', 'generic']).default('generic'),
});

/** 边界清洗：空串/null/数字混入防御（同 world-entity-extractor 约定） */
function cleanEntity(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t !== '') out[k] = t;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

function cleanEntities(arr: unknown): unknown {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e))
    .map(cleanEntity)
    .filter((e) => typeof e.name === 'string' && (e.name as string).trim() !== '');
}

export const customExtractionResultSchema = z.object({
  newCharacters: z.preprocess(cleanEntities, z.array(newCharacterSchema)).default([]),
  newWeapons: z.preprocess(cleanEntities, z.array(newWeaponSchema)).default([]),
  newTechniques: z.preprocess(cleanEntities, z.array(newTechniqueSchema)).default([]),
  characterUpdates: z.preprocess(cleanEntities, z.array(characterUpdateSchema)).default([]),
  /** 新地点（10-山河舆图 US-8，字段缺失时默认空数组，兼容旧输出） */
  newLocations: z.preprocess(cleanEntities, z.array(newLocationSchema)).default([]),
});

export type CustomExtractionResult = z.infer<typeof customExtractionResultSchema>;
export type EntitySensitivity = 'strict' | 'balanced' | 'loose';

// ============================================================
// 系统提示词
// ============================================================

const SYSTEM_PROMPT = `# 角色
你是「指尖仙侠」实体库维护员，负责从章节正文中识别新出现的实体与已有人物的新动态，输出严格 JSON。

# 输出格式（必须是合法 JSON，顶层 5 个数组，键名固定）
{
  "newCharacters": [{ "name": "", "gender": "male", "description": "", "significance": "supporting", "hasDialogue": true, "mentionCount": 3 }],
  "newWeapons": [{ "name": "", "description": "", "owner": "" }],
  "newTechniques": [{ "name": "", "description": "", "practitioner": "" }],
  "characterUpdates": [{ "name": "", "updateText": "", "category": "realm" }],
  "newLocations": [{ "name": "", "description": "", "locationType": "generic" }]
}

# 字段含义
- newCharacters 本章首次出现（且不在已有名单内）的人物：gender=性别(male男/female女/unknown无法确定，根据正文外貌描写与第三人称代词"他/她"推断；描写与代词冲突或均无依据时给 unknown，禁止猜测)，description=本章中该人物的描写片段（100-200字，尽量原文摘录），significance=戏份权重(major主角级/supporting配角/minor一闪而过)，hasDialogue=是否有台词，mentionCount=本章被提及次数
- newWeapons 本章新出现的有具体名称的武器/法宝：description=外观与展现能力的描写片段，owner=本章持有者人名
- newTechniques 本章新出现的有具体名称的功法/法术/秘籍：description=效果与施展场景的描写片段，practitioner=施展者人名
- characterUpdates 已有人物（见已有名单）在本章的重要动态：updateText=一句话概括，category=realm境界变化/item法宝得失/personality性格展现/relationship关系变化/other其他
- newLocations 本章新出现的有具体名称的地点/场所（且不在已有地点名单内）：description=环境描写片段，locationType=sect宗门/city城池/secret_realm秘境/danger险地/teleport传送阵/battlefield战场/generic普通

# 铁律
1. 只提取本章明确写到的；已有名单里的人物/武器/功法/地点一律不进 new 数组（人物动态进 characterUpdates）。
2. 路人甲、店小二、侍卫、那少年等无名或一次性龙套不要提取。
3. 武器/功法/地点必须有具体名称（"一把长剑""某种法术""一座山"不算，"青锋剑""大日如来功""青云山"才算），且需有明确的法宝/功法/地点语境。
4. characterUpdates 只收录重要动态（境界突破、法宝得失、性格展现、关系变化），琐碎动作不录。
5. 地点只收录剧情实际发生地或明确提及的具名场所；"路上""半空中"等泛称不提取。
6. name 使用文中最完整的正式称呼；同一实体只输出一次。
7. 只输出 JSON 本体，不要任何解释、前后缀、markdown 代码块标记。`;

// ============================================================
// Agent
// ============================================================

const SENSITIVITY_HINTS: Record<EntitySensitivity, string> = {
  strict: '敏感度=严格：只提取有名有姓且有对话的人物；无对话的人物一律不进 newCharacters。',
  balanced: '敏感度=平衡：有名有姓或有对话/动作描写的人物都可提取；一闪而过的无名龙套不提取。',
  loose: '敏感度=宽松：只要被提及名字的人物都可提取；仍排除完全无名的路人。',
};

export interface CustomExtractOptions {
  /** 本项目已有自定义人物名（含草稿），LLM 据此排除重复 */
  existingCharacters: string[];
  existingWeapons: string[];
  existingTechniques: string[];
  /** 已有地点名单（含诛仙库，10-山河舆图 US-8） */
  existingLocations: string[];
  /** 诛仙库原著人物名，不重复建档 */
  zhuxianCharacters: string[];
  sensitivity: EntitySensitivity;
  extractWeapons: boolean;
  extractTechniques: boolean;
  /** 是否提取新地点（10-山河舆图 US-8，默认开） */
  extractLocations: boolean;
  llmConfig?: LlmConfig;
}

class CustomEntityExtractorAgent extends BaseAgent {
  constructor() {
    super('CustomEntityExtractorAgent', 2);
  }

  private buildUserPrompt(text: string, opts: CustomExtractOptions): string {
    const fmt = (names: string[]) => (names.length ? names.join('、') : '（无）');
    // 名单过长时截断，防 prompt 膨胀（保留前300个）
    const cap = (names: string[]) => (names.length > 300 ? names.slice(0, 300) : names);
    return `## 规则补充
${SENSITIVITY_HINTS[opts.sensitivity]}
性别推断：newCharacters 中每个人物须给出 gender（male/female/unknown）——依据正文外貌描写与第三人称代词"他/她"推断，两者冲突或均无依据时给 unknown，禁止猜测。
${opts.extractWeapons ? '' : '本章不提取武器/法宝：newWeapons 直接给空数组 []。\n'}${opts.extractTechniques ? '' : '本章不提取功法/法术：newTechniques 直接给空数组 []。\n'}${opts.extractLocations ? '' : '本章不提取地点：newLocations 直接给空数组 []。\n'}
## 已有自定义人物名单（不要重复建档；其动态写入 characterUpdates）
${fmt(cap(opts.existingCharacters))}

## 原著人物名单（诛仙库，绝不建档，也不进 characterUpdates）
${fmt(cap(opts.zhuxianCharacters))}

## 已有武器名单（不要重复建档）
${fmt(cap(opts.existingWeapons))}

## 已有功法名单（不要重复建档）
${fmt(cap(opts.existingTechniques))}

## 已有地点名单（不要重复建档）
${fmt(cap(opts.existingLocations))}

## 本章正文
${text}`;
  }

  /**
   * 抽取并校验。返回剥离未知字段后的结构化结果。
   */
  async extract(content: string, opts: CustomExtractOptions): Promise<CustomExtractionResult> {
    const user = this.buildUserPrompt(content, opts);
    const raw = await this.callWithRetry(this.buildMessages(SYSTEM_PROMPT, user), {
      temperature: 0.2,
      maxTokens: 4096,
      configOverride: opts.llmConfig,
    });
    let parsed: Record<string, unknown>;
    try {
      parsed = this.parseJsonResponse<Record<string, unknown>>(raw);
    } catch (e) {
      if (!raw.trim().endsWith('}')) {
        throw new Error('模型输出被截断（章节过长或实体过多），跳过本次实体维护');
      }
      throw e;
    }
    return customExtractionResultSchema.parse(parsed);
  }
}

export const customEntityExtractorAgent = new CustomEntityExtractorAgent();
