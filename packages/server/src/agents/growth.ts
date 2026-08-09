/**
 * GrowthAgent - 功法/法宝成长工坊统一生成器（模块9）
 * 四大成长手段：融合(fusion) / 变异(mutation) / 强化(upgrade) / 进化(evolution)
 * 三层确定性校验：品级上限 / 特效稀有度匹配品级 / 副作用绑定
 */
import { BaseAgent } from './base.js';
import type { LlmConfig } from '../types.js';

// ============ 类型定义 ============

export interface EntityEffect {
  name: string;
  type: 'element' | 'spacetime' | 'soul' | 'body' | 'curse' | 'domain';
  rarity: 'normal' | 'rare' | 'legendary';
  description: string;
  strength: number; // 1-100
}

export interface GrowthEntity {
  id?: number;
  name: string;
  grade: string;       // 凡造/灵淬/宝胎/道纹/仙蜕/神蕴
  gradeLevel: number;  // 1-3
  skillType?: string;
  itemType?: string;
  coreEffect?: string;
  coreAbilities?: string;
  effects: EntityEffect[];
  sideEffects?: string;
  description?: string;
  growthType: string;
  baseEntityId?: number;
  sourceEntityIds?: number[];
  evolutionStage?: string;
  isEvolved?: boolean;
}

export interface GrowthResult {
  success: boolean;
  entity?: GrowthEntity;
  validationErrors?: string[];
  narrative?: string; // LLM生成的成长叙事
  breakthroughScene?: string; // 突破场景片段（300-500字，融合/进化时生成）
}

// ============ 品级体系常量 ============

const GRADE_ORDER = ['凡造', '灵淬', '宝胎', '道纹', '仙蜕', '神蕴'];

/** 各品级允许的特效稀有度上限 */
const GRADE_RARITY_CAP: Record<string, { normal: number; rare: number; legendary: number }> = {
  '凡造': { normal: 1, rare: 0, legendary: 0 },
  '灵淬': { normal: 2, rare: 1, legendary: 0 },
  '宝胎': { normal: 3, rare: 2, legendary: 0 },
  '道纹': { normal: 3, rare: 3, legendary: 1 },
  '仙蜕': { normal: 4, rare: 4, legendary: 2 },
  '神蕴': { normal: 5, rare: 5, legendary: 3 },
};

/** 仙蜕以下禁止出现的特效类型（时空/领域类传说特效） */
const LEGENDARY_RESTRICTED_TYPES = ['spacetime', 'domain'];

export function gradeIndex(grade: string): number {
  const idx = GRADE_ORDER.indexOf(grade);
  return idx === -1 ? 0 : idx;
}

export function nextGrade(grade: string): string | null {
  const idx = gradeIndex(grade);
  return idx < GRADE_ORDER.length - 1 ? GRADE_ORDER[idx + 1] : null;
}

// ============ 确定性校验（三层） ============

/**
 * 校验特效稀有度是否匹配品级
 */
export function validateEffectsForGrade(effects: EntityEffect[], grade: string): string[] {
  const errors: string[] = [];
  const cap = GRADE_RARITY_CAP[grade];
  if (!cap) {
    errors.push(`未知品级「${grade}」`);
    return errors;
  }

  const counts = { normal: 0, rare: 0, legendary: 0 };
  for (const eff of effects) {
    counts[eff.rarity] = (counts[eff.rarity] || 0) + 1;

    // 仙蜕以下不允许时空/领域类传说特效
    if (eff.rarity === 'legendary' && LEGENDARY_RESTRICTED_TYPES.includes(eff.type) && gradeIndex(grade) < 4) {
      errors.push(`品级「${grade}」不允许出现${eff.type === 'spacetime' ? '时空' : '领域'}系传说特效「${eff.name}」`);
    }
  }

  if (counts.normal > cap.normal) errors.push(`品级「${grade}」普通特效上限${cap.normal}个，实际${counts.normal}个`);
  if (counts.rare > cap.rare) errors.push(`品级「${grade}」稀有特效上限${cap.rare}个，实际${counts.rare}个`);
  if (counts.legendary > cap.legendary) errors.push(`品级「${grade}」传说特效上限${cap.legendary}个，实际${counts.legendary}个`);

  return errors;
}

/**
 * 校验副作用绑定（所有特效必须有副作用描述）
 */
export function validateSideEffects(effects: EntityEffect[], sideEffects?: string): string[] {
  const errors: string[] = [];
  if (effects.length > 0 && (!sideEffects || sideEffects.trim().length === 0)) {
    errors.push('存在特效但未绑定副作用/反噬描述（天道平衡规则）');
  }
  return errors;
}

/**
 * 校验品级上限（融合最高仙蜕，变异不超+1阶等）
 */
export function validateGradeCap(resultGrade: string, operationType: string, sourceGrades: string[]): string[] {
  const errors: string[] = [];
  const resultIdx = gradeIndex(resultGrade);

  switch (operationType) {
    case 'fusion': {
      // 融合：最高不超过仙蜕
      if (resultIdx > 4) errors.push('融合结果品级不得超过仙蜕');
      // 不得超过两者较高品级+1
      const maxSourceIdx = Math.max(...sourceGrades.map(g => gradeIndex(g)));
      if (resultIdx > maxSourceIdx + 1) errors.push(`融合结果品级不得超过源实体最高品级+1（源最高${GRADE_ORDER[maxSourceIdx]}）`);
      break;
    }
    case 'mutation': {
      // 变异：品级变动不超过±1
      const srcIdx = gradeIndex(sourceGrades[0] || '凡造');
      if (resultIdx > srcIdx + 1) errors.push('变异品级提升不得超过1阶');
      if (resultIdx < srcIdx - 1) errors.push('变异品级降低不得超过1阶');
      break;
    }
    case 'upgrade': {
      // 强化：同品级内升层或跨1品级
      const srcIdx = gradeIndex(sourceGrades[0] || '凡造');
      if (resultIdx > srcIdx + 1) errors.push('强化品级提升不得超过1阶');
      break;
    }
    case 'evolution': {
      // 进化：提升1大阶，需道纹巅峰以上
      const srcIdx = gradeIndex(sourceGrades[0] || '凡造');
      if (srcIdx < 3) errors.push('进化需道纹巅峰以上实体');
      if (resultIdx !== srcIdx + 1) errors.push('进化必须且只能提升1大阶');
      break;
    }
  }

  return errors;
}

/**
 * 综合校验（三层合一）
 */
export function validateGrowthResult(entity: GrowthEntity, operationType: string, sourceGrades: string[]): string[] {
  const errors = [
    ...validateGradeCap(entity.grade, operationType, sourceGrades),
    ...validateEffectsForGrade(entity.effects, entity.grade),
    ...validateSideEffects(entity.effects, entity.sideEffects),
  ];
  return errors;
}

// ============ GrowthAgent ============

export class GrowthAgent extends BaseAgent {
  constructor() {
    super('GrowthAgent', 2);
  }

  /**
   * 融合：2个同类型实体 → 新实体
   */
  async fusion(entityA: GrowthEntity, entityB: GrowthEntity, llmConfig?: LlmConfig): Promise<GrowthResult> {
    const system = `你是诛仙世界观下的功法/法宝融合大师。用户将提供两个同类型实体，你需要将它们融合为一个全新实体。

【品级规则】
- 新实体品级 = 两者较高品级，或提升1小阶（30%概率），最高不超过仙蜕
- 品级体系：凡造→灵淬→宝胎→道纹→仙蜕→神蕴，每阶分3层（初期/中期/巅峰）

【特效规则】
- 继承双方50%以上特效
- 可新增1个融合专属特效
- 特效稀有度必须匹配品级上限：凡造≤1普通；灵淬≤2普通+1稀有；宝胎≤3普通+2稀有；道纹≤3稀有+1传说；仙蜕≤2传说+多稀有
- 仙蜕以下不得出现时空系/领域系传说特效

【副作用规则】
- 叠加双方副作用，或产生新的融合反噬
- 所有特效必须绑定合理副作用，越强反噬越重

【世界观约束】
- 严格遵循诛仙战力体系，不得出现超仙侠/玄幻出戏设定
- 特效命名风格贴合诛仙（如"太极""玄清""噬血""天琊"等）

请以JSON格式输出融合结果：
{
  "name": "新实体名称",
  "grade": "品级",
  "gradeLevel": 1-3,
  "coreEffect": "核心效果描述（功法用）或核心能力（法宝用）",
  "effects": [{"name":"特效名","type":"element|spacetime|soul|body|curse|domain","rarity":"normal|rare|legendary","description":"特效描述","strength":1-100}],
  "sideEffects": "副作用/反噬描述",
  "description": "实体简介（2-3句）",
  "narrative": "融合过程叙事（3-5句，描写融合时的异象与变化）",
  "breakthroughScene": "突破场景片段（300-500字，以小说正文笔法描写融合发生时的完整场景：天象异变、灵气涌动、当事人感受、旁观者反应，可作为正文闪回/铺垫素材直接引用）"
}`;

    const user = `【实体A】
名称：${entityA.name}
品级：${entityA.grade}（第${entityA.gradeLevel}层）
类型：${entityA.skillType || entityA.itemType || '未分类'}
核心效果：${entityA.coreEffect || entityA.coreAbilities || '无'}
特效：${JSON.stringify(entityA.effects, null, 2)}
副作用：${entityA.sideEffects || '无'}

【实体B】
名称：${entityB.name}
品级：${entityB.grade}（第${entityB.gradeLevel}层）
类型：${entityB.skillType || entityB.itemType || '未分类'}
核心效果：${entityB.coreEffect || entityB.coreAbilities || '无'}
特效：${JSON.stringify(entityB.effects, null, 2)}
副作用：${entityB.sideEffects || '无'}

请执行融合，生成全新实体。`;

    const raw = await this.callWithRetry(this.buildMessages(system, user), {
      temperature: 0.8,
      maxTokens: 1500,
      ...llmConfig,
    });

    const parsed = this.parseJsonResponse<any>(raw);
    const entity: GrowthEntity = {
      name: parsed.name,
      grade: parsed.grade,
      gradeLevel: parsed.gradeLevel || 1,
      coreEffect: parsed.coreEffect,
      coreAbilities: parsed.coreEffect,
      effects: parsed.effects || [],
      sideEffects: parsed.sideEffects,
      description: parsed.description,
      growthType: 'fusion',
      sourceEntityIds: [entityA.id, entityB.id].filter(Boolean) as number[],
    };

    const errors = validateGrowthResult(entity, 'fusion', [entityA.grade, entityB.grade]);
    if (errors.length > 0) {
      return { success: false, entity, validationErrors: errors, narrative: parsed.narrative, breakthroughScene: parsed.breakthroughScene };
    }
    return { success: true, entity, narrative: parsed.narrative, breakthroughScene: parsed.breakthroughScene };
  }

  /**
   * 变异：1个实体 → 随机异变版本
   */
  async mutation(entity: GrowthEntity, llmConfig?: LlmConfig): Promise<GrowthResult> {
    const system = `你是诛仙世界观下的功法/法宝变异催化师。用户将提供一个实体，你需要对其进行随机异变。

【品级规则（随机）】
- 70%概率品级不变
- 20%概率提升1小阶（层数+1，满层则升阶）
- 10%概率降低1小阶
- 5%彩蛋「逆天异变」：越阶获得高一级品级的传说特效（品级本身不变）

【特效规则】
- 必发生特效变更
- 60%概率新增/升级特效（正面）
- 40%概率损失现有特效或新增负面特效
- 特效稀有度必须匹配最终品级上限

【副作用规则】
- 随机变更，可能减轻也可能加重
- 所有特效必须绑定副作用

【世界观约束】
- 变异方向贴合诛仙设定（煞气侵蚀、天雷淬炼、灵脉异变等）
- 不得出现超纲设定

请以JSON格式输出变异结果：
{
  "name": "变异后名称（可加前缀如'异变·'）",
  "grade": "品级",
  "gradeLevel": 1-3,
  "coreEffect": "核心效果",
  "effects": [{"name":"特效名","type":"element|spacetime|soul|body|curse|domain","rarity":"normal|rare|legendary","description":"特效描述","strength":1-100}],
  "sideEffects": "副作用描述",
  "description": "实体简介",
  "mutationType": "positive|negative|neutral|legendary",
  "narrative": "变异过程叙事（2-3句，描写异变时的异象）"
}`;

    const user = `【待变异实体】
名称：${entity.name}
品级：${entity.grade}（第${entity.gradeLevel}层）
类型：${entity.skillType || entity.itemType || '未分类'}
核心效果：${entity.coreEffect || entity.coreAbilities || '无'}
特效：${JSON.stringify(entity.effects, null, 2)}
副作用：${entity.sideEffects || '无'}

请执行随机异变。`;

    const raw = await this.callWithRetry(this.buildMessages(system, user), {
      temperature: 0.95,
      maxTokens: 900,
      ...llmConfig,
    });

    const parsed = this.parseJsonResponse<any>(raw);
    const resultEntity: GrowthEntity = {
      name: parsed.name,
      grade: parsed.grade,
      gradeLevel: parsed.gradeLevel || 1,
      coreEffect: parsed.coreEffect,
      coreAbilities: parsed.coreEffect,
      effects: parsed.effects || [],
      sideEffects: parsed.sideEffects,
      description: parsed.description,
      growthType: 'mutation',
      sourceEntityIds: entity.id ? [entity.id] : [],
    };

    const errors = validateGrowthResult(resultEntity, 'mutation', [entity.grade]);
    if (errors.length > 0) {
      return { success: false, entity: resultEntity, validationErrors: errors, narrative: parsed.narrative };
    }
    return { success: true, entity: resultEntity, narrative: parsed.narrative };
  }

  /**
   * 强化：提升品级层数/特效强度，有成功率
   */
  async upgrade(entity: GrowthEntity, llmConfig?: LlmConfig): Promise<GrowthResult & { upgraded: boolean; newGradeLevel: number; newGrade: string }> {
    // 确定性计算成功率
    const isCrossGrade = entity.gradeLevel >= 3;
    const successRate = isCrossGrade ? 0.5 : 0.8;
    const roll = Math.random();
    const upgraded = roll < successRate;

    let newGrade = entity.grade;
    let newGradeLevel = entity.gradeLevel;

    if (upgraded) {
      if (entity.gradeLevel >= 3) {
        // 跨品级
        const ng = nextGrade(entity.grade);
        if (ng) { newGrade = ng; newGradeLevel = 1; }
      } else {
        newGradeLevel = entity.gradeLevel + 1;
      }
    } else {
      // 失败：跨品级冲击失败掉1层
      if (isCrossGrade && entity.gradeLevel > 1) {
        newGradeLevel = entity.gradeLevel - 1;
      }
      // 同品级失败无惩罚
    }

    const system = `你是诛仙世界观下的功法/法宝强化师。用户正在强化一个实体。

【本次强化结果】
- 结果：${upgraded ? '成功' : '失败'}
- 品级变化：${entity.grade}第${entity.gradeLevel}层 → ${newGrade}第${newGradeLevel}层
${upgraded ? '- 现有特效强度提升（strength +10~20），描述对应增强' : '- 强化失败，特效无变化或略有损耗'}

【规则】
- 强化不新增特效，仅提升现有特效的强度/范围/持续时间
- 副作用可能随强化加重
- 特效稀有度不变

请以JSON格式输出强化后实体：
{
  "name": "名称（不变）",
  "grade": "${newGrade}",
  "gradeLevel": ${newGradeLevel},
  "coreEffect": "核心效果（成功时增强描述）",
  "effects": [{"name":"特效名","type":"类型不变","rarity":"稀有度不变","description":"强化后描述","strength":强化后数值}],
  "sideEffects": "副作用（成功可能加重）",
  "description": "简介",
  "narrative": "强化过程叙事（2-3句，${upgraded ? '描写强化成功的异象' : '描写强化失败的反噬'}）"
}`;

    const user = `【待强化实体】
名称：${entity.name}
品级：${entity.grade}（第${entity.gradeLevel}层）
核心效果：${entity.coreEffect || entity.coreAbilities || '无'}
特效：${JSON.stringify(entity.effects, null, 2)}
副作用：${entity.sideEffects || '无'}

强化结果：${upgraded ? '成功' : '失败'}，品级→${newGrade}第${newGradeLevel}层`;

    const raw = await this.callWithRetry(this.buildMessages(system, user), {
      temperature: 0.6,
      maxTokens: 1200,
      ...llmConfig,
    });

    const parsed = this.parseJsonResponse<any>(raw);
    const resultEntity: GrowthEntity = {
      name: entity.name,
      grade: newGrade,
      gradeLevel: newGradeLevel,
      skillType: entity.skillType,
      itemType: entity.itemType,
      coreEffect: parsed.coreEffect || entity.coreEffect,
      coreAbilities: parsed.coreEffect || entity.coreAbilities,
      effects: parsed.effects || entity.effects,
      sideEffects: parsed.sideEffects || entity.sideEffects,
      description: parsed.description || entity.description,
      growthType: 'upgrade',
      baseEntityId: entity.baseEntityId || entity.id,
      sourceEntityIds: entity.id ? [entity.id] : [],
    };

    const errors = validateGrowthResult(resultEntity, 'upgrade', [entity.grade]);
    return {
      success: errors.length === 0,
      entity: resultEntity,
      validationErrors: errors.length > 0 ? errors : undefined,
      narrative: parsed.narrative,
      upgraded,
      newGradeLevel,
      newGrade,
    };
  }

  /**
   * 强化叙事（轻量版）：仅生成 2-3 句纯文本叙事，不产出实体 JSON。
   * 结果（成功/失败、目标品级）由调用方预先确定，叙事严格描述该既定结果，
   * 供武器强化「即时返回 + 后台补叙事」使用，token 开销极小。
   */
  async narrateUpgrade(
    entity: GrowthEntity,
    upgraded: boolean,
    newGrade: string,
    newGradeLevel: number,
    llmConfig?: LlmConfig,
  ): Promise<string> {
    const system = `你是诛仙世界观下的法宝强化叙事者。请为一次既定结果的强化写2-3句叙事（60-100字），直接输出叙事文本，不要JSON、不要标题、不要引号。
- 结果：${upgraded ? '强化成功' : '强化失败'}
- 品级变化：${entity.grade}第${entity.gradeLevel}层 → ${newGrade}第${newGradeLevel}层
- ${upgraded ? '描写器身灵光更盛、纹路流转的异象' : '描写冲击失败、器身微损的反噬'}
- 贴合诛仙仙侠设定，不得出戏`;
    const user = `法宝「${entity.name}」（${entity.itemType || '兵刃'}）强化${upgraded ? '成功' : '失败'}，品级变为${newGrade}第${newGradeLevel}层。请写叙事。`;
    const raw = await this.callWithRetry(this.buildMessages(system, user), {
      temperature: 0.6,
      maxTokens: 200,
      ...llmConfig,
    });
    return raw.trim();
  }

  /**
   * 进化：道纹巅峰以上 → 终极形态，100%成功
   */
  async evolution(entity: GrowthEntity, llmConfig?: LlmConfig): Promise<GrowthResult> {
    const targetGrade = nextGrade(entity.grade);
    if (!targetGrade) {
      return { success: false, validationErrors: ['已达最高品级，无法进化'] };
    }
    if (gradeIndex(entity.grade) < 3 || entity.gradeLevel < 3) {
      return { success: false, validationErrors: ['进化需道纹巅峰（道纹第3层）以上实体'] };
    }

    const system = `你是诛仙世界观下的功法/法宝进化引导师。一个${entity.grade}巅峰实体即将进化为${targetGrade}终极形态。

【进化规则】
- 100%成功
- 品级提升1大阶：${entity.grade} → ${targetGrade}
- 解锁1个专属传说级核心特效（唯一且不可通过其他方式获得）
- 获得专属名称后缀（如「·太清化境」「·血灵觉醒」「·天琊化神」）
- 进化阶段标记为「觉醒」

【专属特效要求】
- 必须是传说级（legendary）
- 类型从六大系中选择最契合该实体的
- 描述必须独特、有标志性，体现质变
- 必须绑定强力副作用（进化代价）

【世界观约束】
- 进化叙事贴合诛仙（天劫降临、灵脉共鸣、上古传承觉醒等）
- 专属特效不得与已有普通特效重复

请以JSON格式输出进化形态：
{
  "name": "原名+进化后缀",
  "grade": "${targetGrade}",
  "gradeLevel": 1,
  "coreEffect": "进化后核心效果（质变描述）",
  "effects": [保留原有特效(可升级) + 新增1个传说专属特效],
  "sideEffects": "进化后副作用（含进化代价）",
  "description": "进化形态简介",
  "evolutionStage": "觉醒",
  "exclusiveEffect": {"name":"专属特效名","type":"类型","rarity":"legendary","description":"独特描述","strength":90-100},
  "narrative": "进化过程叙事（2-3句，描写形态质变的震撼场面）",
  "breakthroughScene": "突破场景片段（150-250字，以小说正文笔法描写进化时的完整场景：天劫降临、形态蜕变、力量觉醒的震撼画面，可作为正文闪回/铺垫素材直接引用）"
}`;

    const user = `【待进化实体】
名称：${entity.name}
品级：${entity.grade}（第${entity.gradeLevel}层）
类型：${entity.skillType || entity.itemType || '未分类'}
核心效果：${entity.coreEffect || entity.coreAbilities || '无'}
特效：${JSON.stringify(entity.effects, null, 2)}
副作用：${entity.sideEffects || '无'}
简介：${entity.description || '无'}

请执行进化，解锁终极形态。`;

    const raw = await this.callWithRetry(this.buildMessages(system, user), {
      temperature: 0.7,
      maxTokens: 1000,
      ...llmConfig,
    });

    const parsed = this.parseJsonResponse<any>(raw);
    const resultEntity: GrowthEntity = {
      name: parsed.name,
      grade: targetGrade,
      gradeLevel: 1,
      skillType: entity.skillType,
      itemType: entity.itemType,
      coreEffect: parsed.coreEffect,
      coreAbilities: parsed.coreEffect,
      effects: parsed.effects || [],
      sideEffects: parsed.sideEffects,
      description: parsed.description,
      growthType: 'evolution',
      baseEntityId: entity.baseEntityId || entity.id,
      sourceEntityIds: entity.id ? [entity.id] : [],
      evolutionStage: parsed.evolutionStage || '觉醒',
      isEvolved: true,
    };

    const errors = validateGrowthResult(resultEntity, 'evolution', [entity.grade]);
    if (errors.length > 0) {
      return { success: false, entity: resultEntity, validationErrors: errors, narrative: parsed.narrative, breakthroughScene: parsed.breakthroughScene };
    }
    return { success: true, entity: resultEntity, narrative: parsed.narrative, breakthroughScene: parsed.breakthroughScene };
  }
}

export const growthAgent = new GrowthAgent();
