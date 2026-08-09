/**
 * 五阶剧情解锁引擎
 *
 * 秘宝绑定人物后，随章节正文中的动作描写自动推进解锁阶段。
 * 阶段0-5，每阶段解锁不同层次的内容。
 *
 * 触发方式：章节保存后异步扫描正文关键词。
 * 阶段4特殊：累计使用次数≥3 或 绑定后经过章节数≥10。
 */
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import { eq, and, lt } from 'drizzle-orm';

// ============================================================
// 阶段定义
// ============================================================

export interface UnlockStageDef {
  stage: number;
  label: string;
  progress: number;
  /** 正文触发关键词（正则） */
  triggers: RegExp;
  /** 解锁内容描述（前端展示用） */
  unlockDesc: string;
}

export const UNLOCK_STAGES: UnlockStageDef[] = [
  { stage: 0, label: '远观', progress: 0, triggers: /$^/, unlockDesc: '仅外观代称' },
  { stage: 1, label: '到手', progress: 20, triggers: /拿|握|佩|带在|系在|挂在|揣|别在|插/, unlockDesc: '重量、手感、材质描写' },
  { stage: 2, label: '初窥', progress: 40, triggers: /擦|细看|端详|摩挲|滴血|翻转|凑近|对着光/, unlockDesc: '纹路、异常气息' },
  { stage: 3, label: '初试', progress: 60, triggers: /斩|刺|挥|催动|灌注|劈|削|击|打|砍|撩|挑|扫/, unlockDesc: '第一个特质+第一个小毛病' },
  { stage: 4, label: '熟用', progress: 80, triggers: /斩|刺|挥|催动|灌注|劈|削|击|打|砍|撩|挑|扫/, unlockDesc: '剩余特质、更多毛病、前尘碎片' },
  { stage: 5, label: '探明', progress: 100, triggers: /认主|托梦|碎|知情|真相|名字|来历|身世|记忆|苏醒/, unlockDesc: '正式名字、完整五感卡、前尘、主线钩子' },
];

// ============================================================
// 内容分层返回
// ============================================================

export interface UnlockedContent {
  stage: number;
  label: string;
  progress: number;
  displayName: string;
  trueName: string | null;
  appearance: string | null;
  /** 阶段1+ */
  weight?: string;
  feel?: string;
  material?: string;
  /** 阶段2+ */
  patterns?: string;
  aura?: string;
  /** 阶段3+ */
  firstTrait?: any;
  firstFlaw?: string;
  /** 阶段4+ */
  allTraits?: any[];
  allFlaws?: string[];
  pastFragment?: string;
  /** 阶段5 */
  fullData?: any;
  hooks?: string[];
  isFake?: boolean;
  fakeReveal?: string | null;
}

/**
 * 根据当前解锁阶段，从 fullData 中提取对应层次的内容
 */
export function getUnlockedContent(item: {
  displayName: string;
  trueName: string | null;
  appearance: string | null;
  unlockStage: number;
  fullData: any;
  isFake: boolean;
  fakeReveal: string | null;
}): UnlockedContent {
  const stageDef = UNLOCK_STAGES[item.unlockStage] || UNLOCK_STAGES[0];
  const fd = item.fullData || {};
  const traits = fd.generatedTraits || [];

  const result: UnlockedContent = {
    stage: item.unlockStage,
    label: stageDef.label,
    progress: stageDef.progress,
    displayName: item.unlockStage >= 5 && item.trueName ? item.trueName : item.displayName,
    trueName: item.unlockStage >= 5 ? item.trueName : null,
    appearance: item.appearance,
  };

  if (item.unlockStage >= 1) {
    result.weight = fd.grade ? `入手${fd.grade === '凡造' ? '沉甸甸' : '轻若无物'}` : '入手有分量';
    result.feel = '握在手里有种说不清的契合感';
    result.material = fd.baseMaterial || '材质不明';
  }

  if (item.unlockStage >= 2) {
    result.patterns = traits.length > 0 ? '细看之下，表面隐约有纹路流动' : '表面光滑，但对着光能看到极细的刻痕';
    result.aura = fd.mainDao ? '隐约有一股气息，说不清是什么属性' : '偶尔能感到一丝异样气息';
  }

  if (item.unlockStage >= 3 && traits.length > 0) {
    result.firstTrait = traits[0];
    result.firstFlaw = traits[0]?.flaw || null;
  }

  if (item.unlockStage >= 4) {
    result.allTraits = traits;
    result.allFlaws = traits.filter((t: any) => t.flaw).map((t: any) => t.flaw);
    result.pastFragment = '这东西似乎有些年头了，上面的痕迹不像是一代人留下的。';
  }

  if (item.unlockStage >= 5) {
    result.fullData = fd;
    result.hooks = fd.hooks || [
      '这东西的前主人似乎和某件大事有关',
      '它出现在这里绝非偶然',
      '有人一直在找它',
    ];
    // 打眼在阶段5暴露
    result.isFake = item.isFake;
    result.fakeReveal = item.isFake ? item.fakeReveal : null;
  }

  return result;
}

// ============================================================
// 解锁推进（章节保存后调用）
// ============================================================

export interface UnlockAdvanceResult {
  itemId: number;
  itemName: string;
  newStage: number;
  trigger: string;
}

/**
 * 扫描章节正文，推进绑定秘宝的解锁阶段。
 * 返回本次推进的物品列表（用于前端提示）。
 */
export async function scanAndAdvanceUnlock(
  projectId: number,
  chapterContent: string,
  currentChapterNo: number,
): Promise<UnlockAdvanceResult[]> {
  if (!chapterContent || chapterContent.length < 50) return [];

  // 查询所有已绑定、未完全解锁的秘宝
  const items = await creativeDb
    .select()
    .from(schema.treasureItem)
    .where(and(
      eq(schema.treasureItem.projectId, projectId),
      eq(schema.treasureItem.itemType, 'secret'),
      eq(schema.treasureItem.isDeleted, false),
      eq(schema.treasureItem.isConverted, false),
      lt(schema.treasureItem.unlockStage, 5),
    ));

  const boundItems = items.filter((i) => i.boundCharacterId != null);
  if (boundItems.length === 0) return [];

  const results: UnlockAdvanceResult[] = [];

  for (const item of boundItems) {
    const nextStage = item.unlockStage + 1;
    if (nextStage > 5) continue;

    const stageDef = UNLOCK_STAGES[nextStage];
    let triggered = false;
    let trigger = '';

    if (nextStage === 4) {
      // 阶段4特殊判定：使用次数≥3 或 经过章节≥10
      const chaptersSinceBind = currentChapterNo - (item.boundChapterNo || currentChapterNo);
      const useMatch = chapterContent.match(stageDef.triggers);
      const newUseCount = item.useCount + (useMatch ? 1 : 0);

      if (newUseCount >= 3 || chaptersSinceBind >= 10) {
        triggered = true;
        trigger = newUseCount >= 3 ? `累计使用${newUseCount}次` : `经过${chaptersSinceBind}章`;
      }
      // 更新使用计数（即使不触发阶段）
      if (useMatch) {
        await creativeDb.update(schema.treasureItem)
          .set({ useCount: newUseCount, updatedAt: new Date() })
          .where(eq(schema.treasureItem.id, item.id));
      }
    } else {
      // 常规阶段：关键词匹配
      const match = chapterContent.match(stageDef.triggers);
      if (match) {
        triggered = true;
        trigger = `正文出现"${match[0]}"`;
      }
    }

    if (triggered) {
      const progress = [...(item.unlockProgress as any[] || []), {
        stage: nextStage,
        trigger,
        unlockedAt: new Date().toISOString(),
      }];

      await creativeDb.update(schema.treasureItem)
        .set({
          unlockStage: nextStage,
          unlockProgress: progress,
          updatedAt: new Date(),
        })
        .where(eq(schema.treasureItem.id, item.id));

      results.push({
        itemId: Number(item.id),
        itemName: item.displayName,
        newStage: nextStage,
        trigger,
      });
    }
  }

  return results;
}

// ============================================================
// 解锁完成自动流转
// ============================================================

/**
 * 秘宝转为正式武器/功法。
 * force=true 时无需等待五阶解锁，直接转换（淘宝「入库」流程）。
 * 返回新创建的实体ID与名称。
 */
export async function convertToFormalEntity(
  projectId: number,
  itemId: number,
  force = false,
): Promise<{ convertedId: number; entityType: 'weapon' | 'technique'; name: string } | null> {
  const conditions = [eq(schema.treasureItem.id, itemId)];
  if (!force) conditions.push(eq(schema.treasureItem.unlockStage, 5));
  const [item] = await creativeDb.select().from(schema.treasureItem)
    .where(and(...conditions));

  if (!item || item.isConverted) return null;

  const fd = item.fullData as any;
  if (!fd) return null;

  const entityName = item.trueName || item.displayName;
  let convertedId: number;
  let entityType: 'weapon' | 'technique';

  if (fd.type === 'weapon' || fd.category) {
    // 创建正式武器
    const [weapon] = await creativeDb.insert(schema.customWeapon).values({
      projectId,
      name: entityName,
      category: fd.category || '武道兵刃',
      type: fd.type || 'sword',
      grade: fd.grade || '灵淬',
      fakeGrade: fd.fakeGrade || null,
      baseMaterial: fd.baseMaterial || 'iron',
      forgeTraits: fd.forgeTraits || [],
      soakTraits: fd.soakTraits || [],
      attachTraits: fd.attachTraits || [],
      cavityTraits: fd.cavityTraits || [],
      soulRefineLevel: fd.soulRefineLevel || 'none',
      coreDirection: fd.coreDirection || [],
      selectedDirections: fd.selectedDirections || {},
      generatedTraits: fd.generatedTraits || [],
      temperament: fd.temperament || null,
      pastType: fd.pastType || null,
      taboos: fd.taboos || [],
      reverseMode: fd.reverseMode || false,
      linkedCharacterIds: item.boundCharacterId ? [-Number(item.boundCharacterId)] : [],
      growthType: 'base',
    }).returning();
    convertedId = Number(weapon.id);
    entityType = 'weapon';
  } else {
    // 创建正式功法（预留，当前秘宝主要是武器）
    const [tech] = await creativeDb.insert(schema.customTechnique).values({
      projectId,
      name: entityName,
      mainDao: fd.mainDao || 'lingqi',
      assistDao: fd.assistDao || [],
      styleType: fd.styleType || '攻伐',
      description: fd.description || '',
      guidanceDepth: fd.guidanceDepth || '入门',
      practicePath: fd.practicePath || '正统',
      inheritance: fd.inheritance || '散修',
      linkedCharacterIds: item.boundCharacterId ? [-Number(item.boundCharacterId)] : [],
    }).returning();
    convertedId = Number(tech.id);
    entityType = 'technique';
  }

  // 标记已转换
  await creativeDb.update(schema.treasureItem)
    .set({ isConverted: true, convertedId, updatedAt: new Date() })
    .where(eq(schema.treasureItem.id, itemId));

  return { convertedId, entityType, name: entityName };
}
