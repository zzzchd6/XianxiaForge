/**
 * WorldEntityExtractorAgent - 文本→世界观实体结构化抽取（LLM）
 *
 * 输入一段设定/章节文本 + 目标实体类型，输出严格 JSON（按 8 类分组）。
 * 温度 0.2（抽取求稳），maxTokens 3000，禁止瞎编：文本没写到的字段一律省略（null），
 * 不做任何脑补扩写。输出经 zod 校验（剥离未知字段）后才交给入库管线。
 *
 * zod schema 放在本模块（而非 @novel-studio/shared）：shared 为零运行时依赖的纯类型包，
 * 而抽取结果校验是纯服务端职责，前端仅渲染预览 JSON，故校验就近放置。
 */
import { z } from 'zod';
import { BaseAgent } from './base.js';
import type { LlmConfig } from '../types.js';

// ============================================================
// zod 输出 schema（字段名=Drizzle 属性名 camelCase，与入库映射一一对应）
// ============================================================

const optStr = z.string().trim().min(1).optional();
const optArr = z.array(z.string().trim().min(1)).optional();

export const extractedCharacter = z.object({
  name: z.string().trim().min(1),
  faction: optStr,
  realm: optStr,
  combatType: optStr,
  personality: optStr,
  allTitles: optArr,
  coreSkills: optArr,
  growthLine: optArr,
  plotTags: optArr,
});

export const extractedFaction = z.object({
  name: z.string().trim().min(1),
  camp: optStr,
  headquarters: optStr,
  leader: optStr,
  townTreasure: optStr,
  cultivationFeature: optStr,
  forceRelations: optArr,
});

export const extractedLocation = z.object({
  name: z.string().trim().min(1),
  level: optStr,
  parentRegion: optStr,
  relatedFaction: optStr,
  environment: optStr,
  dangerLevel: optStr,
  specialFunctions: optStr,
  keyEvents: optArr,
});

export const extractedSkill = z.object({
  name: z.string().trim().min(1),
  grade: optStr,
  faction: optStr,
  skillType: optStr,
  threshold: optStr,
  coreEffect: optStr,
  counter: optStr,
  famousUsage: optArr,
});

export const extractedItem = z.object({
  name: z.string().trim().min(1),
  grade: optStr,
  system: optStr,
  appearance: optStr,
  coreAbilities: optStr,
  useLimit: optStr,
  evolution: optStr,
  owners: optArr,
  relatedPlots: optArr,
});

export const extractedMonster = z.object({
  name: z.string().trim().min(1),
  level: optStr,
  race: optStr,
  habitat: optStr,
  combatLevel: optStr,
  relatedPlot: optStr,
  coreAbilities: optArr,
});

export const extractedMaterial = z.object({
  name: z.string().trim().min(1),
  itemType: optStr,
  grade: optStr,
  coreEffect: optStr,
  sideEffect: optStr,
  origin: optStr,
  usageScene: optArr,
});

export const extractedDaily = z.object({
  name: z.string().trim().min(1),
  itemType: optStr,
  grade: optStr,
  relatedFaction: optStr,
  appearance: optStr,
  material: optStr,
  usageScene: optArr,
  emotionalTag: optArr,
});

// ---- 边界清洗：LLM 脏输出防御（空串/null/数字/数组空串/无名实体）----
// 系统提示词的示例把未知字段写成 ""，会诱导 LLM 照搬空串；不同文本下 LLM 还可能给 null、
// 数字或数组里混空串。若直接交给严格 schema（.min(1)/z.string()）会整批 parse 抛错→抽取 500。
// 故在 zod 校验前先做一层归一化：空串/null/空白→省略，数字/布尔→字符串，数组空串过滤，
// 无合法 name 的实体整条丢弃（而非让整批崩溃）。working case（已省略未知字段）不受影响。

/** 单实体清洗：丢弃 null/空串/空白与非法类型字段，数字/布尔转字符串，数组去空串 */
function cleanEntity(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      const cleaned = v
        .map((x) => (typeof x === 'string' ? x.trim() : x === null || x === undefined ? '' : String(x)))
        .filter((x) => x !== '');
      if (cleaned.length) out[k] = cleaned;
    } else if (typeof v === 'string') {
      const t = v.trim();
      if (t !== '') out[k] = t;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = String(v);
    }
    // 对象等非法类型直接丢弃
  }
  return out;
}

/** 数组清洗：逐项 cleanEntity，并丢弃无合法 name 的实体 */
function cleanEntities(arr: unknown): unknown {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e))
    .map(cleanEntity)
    .filter((e) => typeof e.name === 'string' && e.name.trim() !== '');
}

export const extractionResultSchema = z.object({
  characters: z.preprocess(cleanEntities, z.array(extractedCharacter)).default([]),
  factions: z.preprocess(cleanEntities, z.array(extractedFaction)).default([]),
  locations: z.preprocess(cleanEntities, z.array(extractedLocation)).default([]),
  skills: z.preprocess(cleanEntities, z.array(extractedSkill)).default([]),
  items: z.preprocess(cleanEntities, z.array(extractedItem)).default([]),
  monsters: z.preprocess(cleanEntities, z.array(extractedMonster)).default([]),
  materials: z.preprocess(cleanEntities, z.array(extractedMaterial)).default([]),
  daily: z.preprocess(cleanEntities, z.array(extractedDaily)).default([]),
});

export type WorldExtractionResult = z.infer<typeof extractionResultSchema>;

// ============================================================
// 系统提示词
// ============================================================

const SYSTEM_PROMPT = `# 角色
你是「指尖仙侠」世界观录入师，负责从用户粘贴的文本（设定稿、章节、笔记）中抽取世界观实体，输出严格 JSON。

# 输出格式（必须是合法 JSON，顶层 8 个数组，键名固定）
{
  "characters": [{ "name": "", "faction": "", "realm": "", "combatType": "", "personality": "", "allTitles": [], "coreSkills": [], "growthLine": [], "plotTags": [] }],
  "factions": [{ "name": "", "camp": "", "headquarters": "", "leader": "", "townTreasure": "", "cultivationFeature": "", "forceRelations": [] }],
  "locations": [{ "name": "", "level": "", "parentRegion": "", "relatedFaction": "", "environment": "", "dangerLevel": "", "specialFunctions": "", "keyEvents": [] }],
  "skills": [{ "name": "", "grade": "", "faction": "", "skillType": "", "threshold": "", "coreEffect": "", "counter": "", "famousUsage": [] }],
  "items": [{ "name": "", "grade": "", "system": "", "appearance": "", "coreAbilities": "", "useLimit": "", "evolution": "", "owners": [], "relatedPlots": [] }],
  "monsters": [{ "name": "", "level": "", "race": "", "habitat": "", "combatLevel": "", "relatedPlot": "", "coreAbilities": [] }],
  "materials": [{ "name": "", "itemType": "", "grade": "", "coreEffect": "", "sideEffect": "", "origin": "", "usageScene": [] }],
  "daily": [{ "name": "", "itemType": "", "grade": "", "relatedFaction": "", "appearance": "", "material": "", "usageScene": [], "emotionalTag": [] }]
}

# 字段含义
- characters 人物：faction=所属门派(文本)，realm=修为境界，combatType=战斗类型，personality=性格，allTitles=称号/外号数组，coreSkills=招牌功法数组，growthLine=成长轨迹数组，plotTags=剧情标签数组
- factions 门派：camp=正/邪/中立阵营，headquarters=总坛所在，leader=掌门/首领，townTreasure=镇派之宝，cultivationFeature=修炼特色，forceRelations=势力关系数组
- locations 地点：level=层级(如山脉/城镇/秘境)，parentRegion=上级区域，relatedFaction=相关门派，environment=环境描写，dangerLevel=危险等级，specialFunctions=特殊功用，keyEvents=关键事件数组
- skills 功法：grade=品阶，faction=所属门派，skillType=功法/法术/武技/阵法，threshold=修炼门槛，coreEffect=核心效果，counter=克制/破绽，famousUsage=著名使用数组
- items 法宝：grade=品阶，system=体系归属，appearance=外观，coreAbilities=核心能力，useLimit=使用限制，evolution=进化/成长，owners=历任持有者数组，relatedPlots=相关剧情数组
- monsters 妖兽：level=等级，race=种族，habitat=栖息地，combatLevel=战力等级，relatedPlot=相关剧情，coreAbilities=核心能力数组
- materials 丹药灵材：itemType=丹药/灵材/毒物，grade=品阶，coreEffect=核心功效，sideEffect=副作用，origin=产地，usageScene=使用场景数组
- daily 日常信物：itemType=类别，grade=品阶，relatedFaction=相关门派，appearance=外观，material=材质，usageScene=使用场景数组，emotionalTag=情感标签数组

# 铁律
1. 只抽取文本明确写到或可直接推断的实体与字段；文本没提到的字段直接省略（不要填 null，不要瞎编）。
2. name 必填且为规范名称；同一实体在文中多次出现只输出一次。
3. 数组字段用字符串数组；单值字段用字符串。不要输出数字、对象嵌套。
4. 仅输出用户指定的实体类型；未指定的类型给空数组 []。
5. 只输出 JSON 本体，不要任何解释、前后缀、markdown 代码块标记。`;

// ============================================================
// Agent
// ============================================================

class WorldEntityExtractorAgent extends BaseAgent {
  constructor() {
    super('WorldEntityExtractorAgent', 2);
  }

  private buildUserPrompt(text: string, types: string[]): string {
    return `## 需要抽取的实体类型
${types.join(', ')}

## 待抽取文本
${text}`;
  }

  /**
   * 抽取并校验。返回剥离未知字段后的结构化结果。
   */
  async extract(text: string, types: string[], llmConfig?: LlmConfig): Promise<WorldExtractionResult> {
    const user = this.buildUserPrompt(text, types);
    const raw = await this.callWithRetry(this.buildMessages(SYSTEM_PROMPT, user), {
      temperature: 0.2,
      maxTokens: 4096,
      configOverride: llmConfig,
    });
    let parsed: Record<string, unknown>;
    try {
      parsed = this.parseJsonResponse<Record<string, unknown>>(raw);
    } catch (e) {
      // 输出未以 } 闭合 → 大概率是 maxTokens 截断导致 JSON 不完整
      if (!raw.trim().endsWith('}')) {
        throw new Error('模型输出被截断（文本过长或实体过多），请缩短文本或减少实体类型后重试');
      }
      throw e;
    }
    // zod 校验 + 剥离未知字段；缺失类型补默认空数组
    return extractionResultSchema.parse(parsed);
  }
}

export const worldEntityExtractorAgent = new WorldEntityExtractorAgent();
