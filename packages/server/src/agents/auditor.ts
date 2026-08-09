/**
 * 审计Agent - 检查生成章节的一致性和质量
 * 参考InkOS ContinuityAuditor，扩展为11个核心维度
 */
import { BaseAgent } from './base.js';
import type { AuditReport, AuditIssue, ContextPackage, LlmConfig, CustomEntityContext, PlotMaterialContext } from '../types.js';
import type { ChatOptions, UsageInfo } from '../llm/client.js';

/**
 * 审计维度权重规则（按维度名子串匹配，命中第一条即生效，默认1.0）。
 * 数据驱动，新增非1.0权重维度时只需在此追加一条规则。
 */
export const AUDIT_DIMENSION_WEIGHT_RULES: { pattern: string; weight: number }[] = [
  { pattern: '情节逻辑', weight: 1.5 },
  { pattern: '对白张力', weight: 1.5 },
  { pattern: '影响状态一致性', weight: 1.2 },
  { pattern: '认知越界', weight: 1.2 },
];

/** 根据维度名取权重（未命中任何规则则为1.0） */
export function getAuditDimensionWeight(dimensionName: string): number {
  for (const rule of AUDIT_DIMENSION_WEIGHT_RULES) {
    if (dimensionName.includes(rule.pattern)) return rule.weight;
  }
  return 1.0;
}

/**
 * 确定性武器特质一致性扫描（零LLM，第16维度安全网）
 * 规则：正文出现某类效果关键词（毒/寒/火/幻/音），但出场自定义武器均无对应冲突标签特质时，
 * 产出 minor 级提示。仅在确有自定义武器关联出场时启用，避免对功法/天赋误报。
 */
const WEAPON_TRAIT_KEYWORD_RULES: { tag: string; label: string; keywords: string[] }[] = [
  { tag: 'poison', label: '毒', keywords: ['中毒', '剧毒', '毒发', '淬毒', '毒雾', '毒液'] },
  { tag: 'cold', label: '寒', keywords: ['冰封', '冰冻', '寒冰', '霜冻', '凝霜', '冻住'] },
  { tag: 'hot', label: '火', keywords: ['灼烧', '烈焰', '焚烧', '炽热', '熔金', '火舌'] },
  { tag: 'illusion', label: '幻', keywords: ['幻术', '幻境', '魅惑', '摄魂', '迷魂'] },
  { tag: 'sound', label: '音', keywords: ['音波', '魔音', '音啸', '震魂音'] },
];

export function scanWeaponTraitConsistency(
  content: string,
  customEntities?: CustomEntityContext[]
): AuditIssue[] {
  if (!content || !customEntities?.length) return [];
  const weapons = customEntities.filter((e) => e.entityType === 'weapon');
  if (!weapons.length) return [];

  // 汇总所有出场武器具备的冲突标签
  const availableTags = new Set<string>();
  for (const w of weapons) {
    for (const ef of w.effects || []) {
      if (ef.type) availableTags.add(ef.type);
    }
  }

  const issues: AuditIssue[] = [];
  for (const rule of WEAPON_TRAIT_KEYWORD_RULES) {
    if (availableTags.has(rule.tag)) continue; // 有武器具备该特质，放行
    const hit = rule.keywords.find((kw) => content.includes(kw));
    if (!hit) continue;
    issues.push({
      severity: 'minor',
      dimension: '自定义功法/法宝/武器表现一致性',
      description: `正文出现「${hit}」类${rule.label}系效果，但出场自定义武器（${weapons.map((w) => w.name).join('、')}）均未配置对应特质，疑似特质越界（若效果来自功法/天赋可忽略）。`,
      suggestion: `确认该${rule.label}系效果的来源；若应由武器呈现，请为相关武器追加对应特质后再生成。`,
    });
  }
  return issues;
}

/**
 * 确定性五感兵器卡一致性扫描（零LLM，方向组合式特质系统 7.30）
 * 规则：
 *  A. 瑕疵忽略：武器有瑕疵但正文大量描写该武器正面效果而未体现瑕疵 → minor
 *  B. 怪毛病/规矩提醒：武器有怪毛病或专属规矩时，输出 info 级提醒供作者参考
 */
export function scanWeaponSenseCardConsistency(
  content: string,
  customEntities?: CustomEntityContext[]
): AuditIssue[] {
  if (!content || !customEntities?.length) return [];
  const weapons = customEntities.filter((e) => e.entityType === 'weapon');
  if (!weapons.length) return [];

  const issues: AuditIssue[] = [];
  for (const w of weapons) {
    // 正文是否提及该武器
    if (!content.includes(w.name)) continue;

    // A. 瑕疵忽略检测（PRD§4.2：生成具体改文建议）
    if (w.weaponFlaws?.length) {
      const flawKeywords = w.weaponFlaws.flatMap((f) =>
        f.split(/[，。、；]/).map((s) => s.trim()).filter((s) => s.length >= 2).slice(0, 3)
      );
      const flawMentioned = flawKeywords.some((kw) => content.includes(kw));
      if (!flawMentioned && content.length > 200) {
        const fixes: string[] = [];
        if (w.weaponFlaws[0]) fixes.push(`在战斗收尾处体现瑕疵，如："${w.name}砍中对手后，${w.weaponFlaws[0].slice(0, 20)}"`);
        if (w.weirdTrait) fixes.push(`在角色互动中自然带出怪毛病：${w.weirdTrait.slice(0, 30)}`);
        if (w.weaponRules) fixes.push(`让角色遵守专属规矩：${w.weaponRules.slice(0, 30)}`);
        issues.push({
          severity: 'minor',
          dimension: '自定义功法/法宝/武器表现一致性',
          description: `武器「${w.name}」存在瑕疵（${w.weaponFlaws.join('；')}），但正文未体现。按设定，使用场景应自然带出瑕疵表现。`,
          suggestion: fixes.length ? `改文建议：${fixes.map((f, i) => `${i + 1})${f}`).join('；')}` : '在合适的情节节点自然体现武器瑕疵，避免只写增益不写代价。',
        });
      }
    }

    // B. 怪毛病/规矩提醒（info级，不扣分）
    if (w.weirdTrait && content.includes(w.name)) {
      issues.push({
        severity: 'info',
        dimension: '自定义功法/法宝/武器表现一致性',
        description: `武器「${w.name}」有怪毛病设定：${w.weirdTrait.slice(0, 60)}。请确保正文不与之矛盾。`,
        suggestion: '怪毛病是核心记忆点，可在日常/战斗场景中自然体现，但不可被遗忘或矛盾。',
      });
    }

    // C. 特质效果矛盾检测（PRD§4.2增强：稀有特质被写为普通）
    if (w.generatedTraitSummary && content.length > 100) {
      const nameIdx = content.indexOf(w.name);
      const snippet = content.slice(nameIdx, nameIdx + 100);
      if (w.generatedTraitSummary.includes('稀有') && /普通|平凡|寻常|一般/.test(snippet)) {
        issues.push({
          severity: 'major',
          dimension: '自定义功法/法宝/武器表现一致性',
          description: `武器「${w.name}」含稀有特质，但正文用"普通/平凡"等词描述，存在OOC。`,
          suggestion: `改文建议：将"普通"替换为符合稀有特质的描写，体现${w.generatedTraitSummary.slice(0, 40)}的非凡之处。`,
        });
      }
    }
  }
  return issues;
}

/**
 * 确定性功法道则一致性扫描（零LLM，第16维度安全网）
 * 仅启用高置信度规则，避免与天赋/法宝/native功法的效果误报：
 *  A. 反噬缺失：对冲融合/内置冲突功法未配置反噬，正文却强行催动大招 → major
 *  B. 入门指引越界：入门指引功法被描写为微观操控/改写道则规则 → major
 *  C. 道则边界：正文出现时间/空间等稀有道则效果，但出场功法均未修该道则 → minor（带忽略提示）
 */
const TECHNIQUE_BIG_MOVE_KEYWORDS = ['强行催动', '燃烧精血', '孤注一掷', '催动杀招', '倾尽全力', '豁出性命', '拼命催动', '催动大招'];
const TECHNIQUE_RUDIMENTARY_KEYWORDS = ['微观操控', '改写规则', '改写道则', '触及规则层面', '操控本源', '改写本质', '规则层面的操控'];
const TECHNIQUE_DAO_KEYWORD_RULES: { dao: string; label: string; keywords: string[] }[] = [
  { dao: 'suishi', label: '岁时（时间）', keywords: ['时间回溯', '时间流速', '加速衰老', '局部回溯', '时间变速'] },
  { dao: 'void', label: '虚空（空间）', keywords: ['空间切割', '空间折叠', '瞬移', '储物空间', '虚空穿梭'] },
];

export function scanTechniqueDaoConsistency(
  content: string,
  customEntities?: CustomEntityContext[]
): AuditIssue[] {
  if (!content || !customEntities?.length) return [];
  const techniques = customEntities.filter((e) => e.entityType === 'technique');
  if (!techniques.length) return [];

  const issues: AuditIssue[] = [];

  // A. 反噬缺失：对冲/内置冲突功法应有反噬代价
  const bigMoveHit = TECHNIQUE_BIG_MOVE_KEYWORDS.find((kw) => content.includes(kw));
  if (bigMoveHit) {
    for (const t of techniques) {
      if (t.isClash && !t.backlashSummary) {
        issues.push({
          severity: 'major',
          dimension: '自定义功法/法宝/武器表现一致性',
          description: `功法「${t.name}」属对冲融合/内置冲突功法却未配置任何反噬代价，正文却出现「${bigMoveHit}」式强行催动，缺少应有代价描写。`,
          suggestion: `为「${t.name}」补充反噬代价设定，或在正文中补写强行催动后的反噬表现（经脉受损/道基动摇/寿元折损等）。`,
        });
      }
    }
  }

  // B. 入门指引越界：入门功法不应直接微观操控/改写规则
  const rudimentaryHit = TECHNIQUE_RUDIMENTARY_KEYWORDS.find((kw) => content.includes(kw));
  if (rudimentaryHit) {
    for (const t of techniques) {
      if (t.guidanceDepthId === 'rudimentary') {
        issues.push({
          severity: 'major',
          dimension: '自定义功法/法宝/武器表现一致性',
          description: `功法「${t.name}」仅为入门指引（路径粗浅、上限靠自悟），正文却出现「${rudimentaryHit}」级微观操控，超出其指引深度。`,
          suggestion: `入门指引功法只能描写宏观运用；如需微观操控/改写规则，应将该功法提升为完整传承或直指本源，或改由天赋/神通呈现。`,
        });
      }
    }
  }

  // C. 道则边界：稀有道则效果但出场功法均未修（保守 minor）
  const coveredDaos = new Set<string>();
  for (const t of techniques) for (const d of t.daoIds || []) coveredDaos.add(d);
  for (const rule of TECHNIQUE_DAO_KEYWORD_RULES) {
    if (coveredDaos.has(rule.dao)) continue;
    const hit = rule.keywords.find((kw) => content.includes(kw));
    if (!hit) continue;
    issues.push({
      severity: 'minor',
      dimension: '自定义功法/法宝/武器表现一致性',
      description: `正文出现「${hit}」类${rule.label}道则效果，但出场自定义功法（${techniques.map((t) => t.name).join('、')}）均未修该道则，疑似道则越界（若效果来自天赋/法宝/native功法可忽略）。`,
      suggestion: `确认该${rule.label}效果的来源；若应由功法呈现，请为相关功法追加对应辅修道则后再生成。`,
    });
  }

  return issues;
}

/**
 * 确定性固定素材融入扫描（零LLM，第28维度安全网）
 * 规则：作者手动固定（pinned=true）的剧情素材，其 title/corePlot 关键词应在正文中有所体现；
 * 若正文完全不包含该素材的任何≥2字关键词片段，判定"未融入"，产出 major 级提示。
 * 灰度策略：仅报 major 供作者参考，不触发 critical 回炉循环。
 */
export function scanPinnedMaterialConsistency(
  content: string,
  plotMaterials?: PlotMaterialContext[]
): AuditIssue[] {
  if (!content || !plotMaterials?.length) return [];
  const pinned = plotMaterials.filter((m) => m.pinned === true);
  if (!pinned.length) return [];

  const issues: AuditIssue[] = [];
  for (const m of pinned) {
    try {
      // 提取关键词：title 全文 + title 按标点切分的≥2字段 + corePlot 前30字切分的≥2字段
      const keywords: string[] = [];
      if (m.title) {
        keywords.push(m.title);
        const titleSegs = m.title.split(/[，。、；：！？\s·—…「」《》（）()]+/).filter((s) => s.length >= 2);
        keywords.push(...titleSegs);
      }
      if (m.corePlot) {
        const head = m.corePlot.slice(0, 30);
        const coreSegs = head.split(/[，。、；：！？\s·—…「」《》（）()]+/).filter((s) => s.length >= 2);
        keywords.push(...coreSegs);
      }
      const uniqueKw = [...new Set(keywords)];
      if (!uniqueKw.length) continue;

      // 正文是否包含任一关键词片段
      const incorporated = uniqueKw.some((kw) => content.includes(kw));
      if (!incorporated) {
        issues.push({
          severity: 'major',
          dimension: '指定素材融入率',
          description: `作者固定素材「${m.title}」（来源：${m.table}）在正文中未检测到任何关键词融入，疑似被忽略。`,
          suggestion: `请确认该素材是否已实质性融入正文（核心人物/事件/意象应出现）；若确属本章不适用，请取消固定后重新生成。`,
        });
      }
    } catch {
      // 单条素材扫描异常不影响其它素材，静默跳过
    }
  }
  return issues;
}

export class AuditorAgent extends BaseAgent {
  constructor() {
    super('AuditorAgent');
  }

  /**
   * 审计主方法
   */
  async auditChapter(
    content: string,
    context: ContextPackage,
    llmConfig?: LlmConfig,
    onUsage?: (usage: UsageInfo, model: string) => void
  ): Promise<AuditReport> {
    const { systemPrompt, userPrompt } = this.buildAuditPrompt(content, context);
    const messages = this.buildMessages(systemPrompt, userPrompt);

    const options: ChatOptions = {
      temperature: 0.3, // 审计需要低温度，保证判断稳定
      maxTokens: 4096,
      configOverride: llmConfig,
      onUsage,
    };

    this.log(`开始审计第${context.chapterPlan.chapterNumber}章...`);
    const response = await this.callWithRetry(messages, options);

    try {
      const report = this.parseJsonResponse<AuditReport>(response);
      // 验证报告结构
      if (!Array.isArray(report.issues)) {
        report.issues = [];
      }
      // 确定性武器特质扫描（零LLM安全网），合并进问题列表
      const weaponIssues = scanWeaponTraitConsistency(content, context.customEntities);
      if (weaponIssues.length) {
        report.issues.push(...weaponIssues);
      }
      // 确定性五感兵器卡扫描（零LLM，瑕疵/怪毛病一致性）
      const senseCardIssues = scanWeaponSenseCardConsistency(content, context.customEntities);
      if (senseCardIssues.length) {
        report.issues.push(...senseCardIssues);
      }
      // 确定性功法道则扫描（零LLM安全网），合并进问题列表
      const techniqueIssues = scanTechniqueDaoConsistency(content, context.customEntities);
      if (techniqueIssues.length) {
        report.issues.push(...techniqueIssues);
      }
      // 确定性固定素材融入扫描（零LLM安全网，第28维度），合并进问题列表
      const pinnedMaterialIssues = scanPinnedMaterialConsistency(content, context.plotMaterials);
      if (pinnedMaterialIssues.length) {
        report.issues.push(...pinnedMaterialIssues);
      }
      if (typeof report.overallScore !== 'number') {
        report.overallScore = 70;
      }
      // 确保score在0-100范围内
      report.overallScore = Math.max(0, Math.min(100, report.overallScore));

      // 加权计分：按 AUDIT_DIMENSION_WEIGHT_RULES 规则表取权重（情节逻辑/对白张力1.5，其余默认1.0）
      if (report.dimensionScores && typeof report.dimensionScores === 'object') {
        const entries = Object.entries(report.dimensionScores).filter(
          ([, v]) => typeof v === 'number'
        );
        if (entries.length > 0) {
          let weightedSum = 0;
          let totalWeight = 0;
          for (const [dim, score] of entries) {
            const w = getAuditDimensionWeight(dim);
            weightedSum += (score as number) * w;
            totalWeight += w;
          }
          report.overallScore = Math.max(0, Math.min(100, Math.round(weightedSum / totalWeight)));
        }
      }

      this.log(`审计完成，评分: ${report.overallScore}，问题数: ${report.issues.length}`);
      return report;
    } catch (error: any) {
      this.log(`审计报告解析失败，返回默认报告: ${error.message}`, 'warn');
      return { issues: [], overallScore: 70 };
    }
  }

  /**
   * 构建审计prompt
   */
  private buildAuditPrompt(
    content: string,
    context: ContextPackage
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `你是一位严格的小说编辑和连续性审校专家。你的任务是审查AI生成的小说章节，检查其与既定设定的一致性。

你需要从以下30个维度进行审查：
1. 人物连续性（五类）
   1.1 目标连续性：主角本章想做什么？过程中有没有无故漂移？
   1.2 情绪连续性：情绪有没有来路？上一场的情绪有没有带到下一场？
   1.3 关系连续性：关系温度和上一场对不对得上？有没有突然变熟/变生分？
   1.4 声音连续性：人物说话方式、口吻前后是否一致？换个人说这句还成立吗？
   1.5 身体状态一致性：伤势、疲劳、中毒等身体状态有没有丢？（与状态快照矛盾报critical）
   每类独立判断，问题分别标注 dimension 为"人物连续性·目标""人物连续性·情绪"等子维度名
2. 人物关系正确性 - 人物之间的关系描写是否正确
3. 门派/组织归属 - 人物的门派归属是否正确
4. 功法/法宝设定一致 - 功法和法宝的描述是否与设定一致
5. 地点描述一致 - 地点的描述是否与设定一致
6. 情节逻辑一致性（五层因果链）
   6.1 动机充分性：人物行动动机是否清晰？不做的代价是否足以支撑行动成本？
   6.2 触发合理性：事件为什么偏偏在这个时间点发生？触发条件是否成立？
   6.3 决策匹配度：人物选择是否符合其性格、处境、已知信息？有无无故转折？
   6.4 后果落地性：关键事件后，局面/关系/资源/风险是否真的改变？
   6.5 兑现完整性：前文铺垫是否以冲突/反转/代价方式回收？有无伏笔烂尾？
   每层独立判断，问题分别标注 dimension 为"情节逻辑·动机充分性""情节逻辑·触发合理性"等子维度名
7. 情绪/冲突达标 - 是否达到章节计划要求的情绪和冲突目标
8. 基本文笔质量 - 是否有明显的文笔问题、逻辑漏洞
9. 风格一致性 - 是否出现禁用词；描写比例（场景/动作/对话/心理）是否严重偏离风格配置；意象与文风是否统一
10. 状态一致性 - 正文是否与已确认的人物状态快照（所在位置、境界、伤势、物品归属）及时间线里程碑相矛盾（如人物已受伤却行动自如、物品已易主却仍在原主手中、事件先后颠倒）
11. 视角合规性 - 若章节声明了限知视角人物，正文是否越界：跳到非视角人物的内心活动（"他心想/她暗道"用于他人）、用上帝视角描写视角人物不在场的事件或交代背景设定。仅在确实越界时报 major（视角轻微游移可报 minor）；未声明视角人物时不审查此项
12. 分支承接一致性 - 若章节声明了玩家选定的剧情分支走向，正文是否沿所选走向与"下一章核心走向"展开，是否无故背离需承接的影响标签历史栈（如标签为"黑化线"正文却写成洗白、标签为"失去挚友"正文却该角色安然无恙）。走向明显跑偏或背离影响标签报 critical；承接生硬但方向正确报 minor；未声明分支走向时不审查此项
13. 锚点事件覆盖率 - 若章节声明了关键剧情锚点（必须发生的核心事件），逐一检查每个锚点事件是否在正文中真实出现并有明确剧情落点。遗漏任一锚点事件报 critical（dimension 注明"锚点事件覆盖率"，description 指出遗漏了哪个事件）；锚点出现但顺序明显错乱或一笔带过缺乏落点报 major；全部锚点按序覆盖则不报此项；未声明锚点时不审查此项
14. 伏笔呼应合理性 - 若上下文提供了未回收伏笔线，检查正文对伏笔的处理是否合理：①对"已埋设且计划本章回收"的伏笔，正文是否给出明确回收落点（计划回收却完全未触及报 major）；②正文是否与伏笔设定明显矛盾（如伏笔线索暗示某物已毁/某人已离场，正文却照常使用/出现，报 major）；③伏笔的埋设或呼应是否生硬突兀、明显为埋而埋破坏叙事节奏（报 minor）；④载体DNA校验：若伏笔线标注了DNA四元组（主体-动作-客体-情绪），回收时正文的实际主体/动作/客体/情绪是否与DNA一致——主体张冠李戴或情绪方向完全相反报 major（"DNA偏离"），动作/客体轻微偏移报 minor。伏笔处理自然得体则不报此项；上下文无未回收伏笔时不审查此项
15. 人物阶段一致性 - 若上下文提供了人物当前成长阶段（含阶段名与特质），检查正文中该人物的言行、心理、处事方式是否符合所处阶段的特质设定。人物表现与阶段特质明显矛盾（如"少年自卑期"却自信张扬、"黑化期"却圣母心肠）报 major；阶段特质体现不足但无明显矛盾报 minor；人物言行自然贴合阶段设定则不报此项；上下文无成长阶段信息时不审查此项
16. 自定义功法/法宝/武器表现一致性 - 若上下文提供了自定义功法/法宝/武器设定（含品级、特效列表、副作用；武器则为形制/材质/锻造·淬炼·附魔·窍藏特质词条；功法则为指引深度/道则组合/分道境神通/反噬代价），检查正文中涉及这些实体的描写是否与设定一致：①特效表现是否匹配设定（使用了未列出的能力/特质报 major，特效强度明显超出设定报 major）；②副作用/反噬是否体现（使用强力特效却完全无代价报 minor；对冲融合/内置冲突功法强行催动大招却无反噬代价描写报 major）；③品级压制是否合理（低品级实体碾压高品级而无合理解释报 major）；④武器特质越界（如武器无"淬毒"特质正文却写淬毒伤敌、无"寒冰"特质却冰封对手，报 major）；⑤指引深度越界（入门指引功法被描写为微观操控/改写道则规则层面，报 major）；⑥道境神通越界（功法出现其所修道则之外的能力，或动用未列出的分道境神通，报 major）。描写与设定一致则不报此项；上下文无自定义实体时不审查此项
17. 对白张力与人物声音 - 检查所有重要对话场景：
    - 目的性：每轮对话谁想赢什么？有无明确意图？
    - 信息增量：对白是否带出新信息/新站位/新威胁？还是原地复读？
    - 关系推进：对话结束后双方关系位置是否发生偏移？
    - 人物声音：不同身份/性格的人说话方式是否有区分度？换个人说这句还成立吗？
    常见故障：空话套话型（只有情绪没有刀口）、设定讲解型（边吵边念大纲）、口径同质化（全员一个腔调）
18. 章末承接与拉力 - 检查章节结尾：
    - 章末落点类型：优秀（局势变化/关系偏移/半揭露真相/关键决定）vs 不良（总结/抒情/讲道理/自然结束）
    - 是否留有悬念或余韵？读者会不会自然想知道下一章？
    - 有无章末硬钩（为了悬念而强行制造的突兀悬念）？
    - 下一章第一拍能否自然承接？
    章末停在总结/抒情/讲道理报 major；硬钩突兀报 minor；落点优秀则不报此项
19. 冲突强度一致性 - 若章节计划声明了冲突星级目标（如★★★★☆），检查正文实际冲突强度是否匹配：
    - 目标为峰值（≥4星）但正文冲突平淡、无核心对抗或状态改变 → major
    - 目标为低冲突（≤2星）但正文出现重大角色死亡/能力得失等峰值事件 → minor（节奏越级）
    - 实际强度与目标基本匹配则不报此项；未声明冲突星级时不审查此项
20. 因果律与代价守恒 - 检查重大事件的因果完整性：
    - 任何重大事件（伏笔回收、核心角色死亡、世界规则改变）必须在前文有逻辑先导事件作为因。遗漏因果先导 → critical
    - 任何重大增益（关键能力、战略级物品、决定性胜利）必须伴随相称代价。无代价获取 → major；代价不相称 → minor
21. 方向匹配度 - 若上下文提供了本章选定的剧情主方向（及方向释义），检查正文核心内容是否沿该方向展开：
    - 正文主体剧情与选定主方向明显不符（如选定"境界突破"方向正文却全程处理门派杂务）→ major
    - 正文仅边缘触及主方向、着力点在别处 → minor
    - 正文自然贴合主方向则不报此项；未提供主方向时不审查此项
22. 影响状态一致性 - 若上下文提供了人物当前数值属性与生效状态标签（影响快照，数值体系唯一权威），检查正文是否与之矛盾：
    - 正文描写的数值状态与给定数值明显矛盾（如给定"伤势80"却行动自如、给定"道心20"却意志坚定毫不动摇）→ critical
    - 给定生效状态标签（如"中毒""封印"）在正文中完全无体现或被无视 → major
    - 正文虚构了给定状态中不存在的属性/状态（如凭空出现未列出的"重伤""顿悟"）→ major
    - 数值与状态在正文中自然一致则不报此项；未提供影响状态时不审查此项
23. 命格与资质合理性 - 若上下文提供了人物命格/根骨/气运等资质数值，检查剧情与资质的匹配度：
    - 资质平庸者（根骨/悟性低）轻易领悟神功、突破关键瓶颈而无合理机缘铺垫 → major
    - 命格/气运表现与剧情走向明显背离（如气运极低却连连奇遇不断、无代价无解释）→ minor
    - 资质与剧情匹配或有机缘铺垫则不报此项；未提供资质数值时不审查此项
24. 宗门身份合理性 - 若上下文提供了人物宗门/身份设定及宗门规制，检查NPC对待主角的态度、待遇、称呼是否匹配其身份：
    - 身份/辈分与所受待遇明显错位（如杂役弟子被长老以平辈之礼相待而无缘由）→ major
    - 称呼/礼仪与宗门规制轻微不符 → minor
    - 态度待遇与身份匹配则不报此项；未提供宗门身份设定时不审查此项
25. 因果回收率 - 若上下文提供了待回收因果线（前文埋下的因），检查正文是否对因果线有所回应：
    - 已逾期因果线（标注【已逾期!】）在正文中完全无任何体现、暗示或铺垫 → major
    - 未逾期但即将到期的因果线被完全无视（无任何呼应） → minor
    - 正文自然兑现或铺垫了因果线则不报此项；未提供因果线时不审查此项
26. 关系一致性 - 若上下文提供了人物关系状态（好感/信任/敬重/亲密等维度），检查正文中人物互动是否与关系数值匹配：
    - 关系极差（信任/好感≤20）的人物之间却表现出高度信任、亲密无间的言行 → major
    - 关系极好（好感/亲密≥80）的人物之间却言语冷淡、形同陌路而无剧情解释 → minor
    - 人物互动态度与关系维度匹配则不报此项；未提供关系状态时不审查此项
27. 自定义人物OOC - 若上下文提供了★自定义人物（含定位/立场/性格标签/天赋/短板），检查正文中该人物是否OOC：
    - 性格标签行为矛盾（如标签"高冷"却喋喋不休、标签"护短"却伤害自己人）→ major
    - 实力表现与定位档次明显不符（定位仅描述模糊体感强弱，正文压制/被压制关系颠倒且无剧情理由）→ major
    - 扮猪吃虎人物：对外言行须匹配其伪装定位，无剧情理由暴露真实实力 → major；伪装偶有破绽但有铺垫 → 不报
    - 立场明显背离（浩然正气者无故行邪异之事，反之亦然，且无剧情动机）→ major；天赋/短板设定被正文无视或反向描写 → minor
    - 人物言行贴合人物卡则不报此项；无自定义人物时不审查此项
28. 指定素材融入率 - 若上下文提供了作者手动固定（pinned）的剧情素材（标注"必须融入"），检查正文是否实质性融入了这些素材（核心人物/事件/意象出现）：
    - 固定素材在正文中完全未出现、无任何实质性体现 → major
    - 固定素材仅被一笔带过、缺乏剧情落点 → minor
    - 固定素材被自然融入剧情则不报此项；无固定素材时不审查此项
29. 任务推进合理性 - 若上下文提供了进行中的任务线（activeTasks，含标题/状态/优先级/目标章/进度线索），检查正文是否对这些任务有合理推进或呼应（接取/推进/完成/受阻/提及等），而非完全无视：
    - 关键任务（高优先级或战略级tier）在正文中被完全无视、无任何推进或呼应 → major
    - 普通任务线轻微未呼应、缺乏进度线索体现 → minor
    - 正文对任务有自然推进、呼应或合理交代（哪怕只是侧面提及）则不报此项；上下文无进行中任务线时不审查此项
30. 认知越界 - 若上下文提供了人物已知信息清单（【人物已知信息清单】块），检查角色的对白/心理是否越界知情：
    - 角色说出了其清单之外的具体事实（尤其是他人秘密/幕后真相/未公开事件）且剧情未给出获知途径 → major
    - 角色的心理活动体现了其不该知道的信息（非视角人物秘密被视角人物无来由看穿）→ major
    - 轻微提及清单外信息但可合理推断自现场观察/常识 → 不报或 minor
    - 判定边界：本维只查"角色说出了其知识清单外的具体事实"；视角叙述越界归第11维，性格OOC归第27维，勿重复报
    - 人物言行均在其已知信息范围内则不报此项；上下文无已知信息清单时不审查此项

输出格式要求（严格JSON）：
{
  "dimensionScores": { "维度名或子维度名": 0-100整数 },
  "issues": [
    {
      "severity": "critical|major|minor",
      "dimension": "维度名称",
      "description": "问题描述",
      "suggestion": "修改建议"
    }
  ],
  "overallScore": 0-100的整数
}

dimensionScores 要求：为每个审查过的维度（含子维度）各给一个 0-100 整数分。未审查的条件维度不必列出。

severity定义：
- critical: 严重设定冲突，必须修改（如人物性格完全不符、关系搞错）
- major: 明显问题，建议修改（如情节不够连贯、情绪未达标）
- minor: 小问题，可选修改（如文笔小瑕疵）

注意：
- 只报告确实存在的问题，不要过度挑剔
- 如果没有问题，issues可以为空数组
- overallScore: 90+优秀, 70-89良好, 50-69需改进, <50需重写`;

    // 构建用户prompt
    const userParts: string[] = [];

    userParts.push('【待审查章节内容】');
    userParts.push(content);

    userParts.push('\n【审查参照资料】');

    // 章节计划
    userParts.push(`\n章节计划: 第${context.chapterPlan.chapterNumber}章 - ${context.chapterPlan.title}`);
    userParts.push(`核心意图: ${context.chapterPlan.intent}`);
    if (context.chapterPlan.targetEmotion) {
      userParts.push(`目标情绪: ${context.chapterPlan.targetEmotion}`);
    }
    if (context.chapterPlan.conflictType) {
      userParts.push(`冲突类型: ${context.chapterPlan.conflictType}`);
    }

    // 人物设定（自定义人物渲染★标记+定位/立场/性格标签/天赋/短板，供OOC审查）
    if (context.characters.length > 0) {
      userParts.push('\n【人物设定参照】');
      for (const c of context.characters) {
        const parts = [c.source === 'custom' ? `★${c.name}` : c.name];
        if (c.personality) parts.push(`性格: ${c.personality}`);
        if (c.source === 'custom') {
          if (c.faction) parts.push(`种族: ${c.faction}`);
          if (c.position) parts.push(`实力定位: ${c.position}`);
          if (c.fakePosition) parts.push(`伪装示人: ${c.fakePosition}（扮猪吃虎）`);
          if (c.stance) parts.push(`立场: ${c.stance}`);
          if (c.outerPersonality?.length) parts.push(`性格标签: ${c.outerPersonality.join('、')}`);
          if (c.talents?.length) parts.push(`天赋: ${c.talents.join('；')}`);
          if (c.strengths?.length) parts.push(`擅长: ${c.strengths.join('、')}`);
          if (c.weaknesses?.length) parts.push(`短板: ${c.weaknesses.join('、')}`);
        } else {
          if (c.faction) parts.push(`门派: ${c.faction}`);
          if (c.realm) parts.push(`修为: ${c.realm}`);
          if (c.coreSkills?.length) parts.push(`能力: ${c.coreSkills.join('、')}`);
        }
        userParts.push(`- ${parts.join('，')}`);
      }
      if (context.characters.some((ch) => ch.source === 'custom')) {
        userParts.push('注意：★标记为用户自定义人物，其定位仅为模糊体感强弱（严禁映射具体境界名）。请按维度27审查其性格标签、定位表现、伪装身份与立场是否OOC。');
      }
    }

    // 人物关系
    if (context.relations.length > 0) {
      userParts.push('\n【人物关系参照】');
      for (const r of context.relations) {
        const tag = r.source === 'custom' ? '★自定义(优先) ' : '';
        let line = `- ${tag}人物${r.charAId} 与 人物${r.charBId}: ${r.relType}`;
        if (r.description) line += `（${r.description}）`;
        if (r.interactPattern) line += ` 互动: ${r.interactPattern}`;
        userParts.push(line);
      }
      if (context.relations.some((r) => r.source === 'custom')) {
        userParts.push('注意：★标记为用户自定义关系，优先级高于原生设定，正文互动须符合自定义关系描述。');
      }
    }

    // v1.4 人物已知信息清单（第30维认知越界审查参照，清单非空才注入）
    if (context.knowledgeContext?.text) {
      userParts.push('\n【人物已知信息清单（第30维认知越界审查参照）】');
      userParts.push(context.knowledgeContext.text);
    }

    // 门派
    if (context.factions.length > 0) {
      userParts.push('\n【门派设定参照】');
      for (const f of context.factions) {
        userParts.push(`- ${f.name}: ${f.camp || f.cultivationFeature || ''}`);
      }
    }

    // 功法
    if (context.skills.length > 0) {
      userParts.push('\n【功法设定参照】');
      for (const s of context.skills) {
        userParts.push(`- ${s.name}: ${s.coreEffect || ''}`);
      }
    }

    // 法宝
    if (context.items.length > 0) {
      userParts.push('\n【法宝设定参照】');
      for (const i of context.items) {
        userParts.push(`- ${i.name}: ${i.coreAbilities || ''}`);
      }
    }

    // 地点
    if (context.locations.length > 0) {
      userParts.push('\n【地点设定参照】');
      for (const l of context.locations) {
        userParts.push(`- ${l.name}: ${l.environment || ''}`);
      }
    }

    // 前文摘要
    if (context.prevSummaries.length > 0) {
      userParts.push('\n【前文摘要（用于连贯性检查）】');
      context.prevSummaries.forEach((s, i) => {
        userParts.push(`前${context.prevSummaries.length - i}章: ${s}`);
      });
    }

    // 风格判据（第9维度）
    if (context.style) {
      const s = context.style;
      userParts.push('\n【风格参照（用于风格一致性检查）】');
      if (s.forbiddenWords?.length) {
        userParts.push(`禁用词（正文出现任意一个即报 critical）: ${s.forbiddenWords.join('、')}`);
      }
      if (s.descriptionRatio) {
        const pct = (n?: number) => (n != null ? Math.round(n * 100) + '%' : '?');
        userParts.push(
          `目标描写比例: 场景${pct(s.descriptionRatio.scene)} / 动作${pct(s.descriptionRatio.action)} / 对话${pct(s.descriptionRatio.dialogue)} / 心理${pct(s.descriptionRatio.psychology)}（任一项偏差超过15%报 major）`
        );
      }
      if (s.coreImagery?.length) {
        userParts.push(`核心意象（应统一化用）: ${s.coreImagery.join('、')}`);
      }
      if (s.antiPatterns?.length) {
        userParts.push(`反模式（命中报 major）: ${s.antiPatterns.join('；')}`);
      }
    }

    // 状态参照（第10维度）
    if (context.stateSnapshots?.length || context.timelineMilestones?.length) {
      userParts.push('\n【状态参照（用于状态一致性检查）】');
      if (context.stateSnapshots?.length) {
        userParts.push('已确认人物状态（正文若与之矛盾，位置/境界/伤势/物品归属冲突报 critical）:');
        for (const st of context.stateSnapshots) {
          const parts = [st.characterName || `人物#${st.characterId}`];
          if (st.location) parts.push(`位置: ${st.location}`);
          if (st.realm) parts.push(`境界: ${st.realm}`);
          if (st.injury) parts.push(`伤势: ${st.injury}`);
          if (st.mentalState) parts.push(`心态: ${st.mentalState}`);
          if (st.possessedItems?.length) parts.push(`持有: ${st.possessedItems.join('、')}`);
          userParts.push(`- ${parts.join('，')}`);
        }
      }
      if (context.timelineMilestones?.length) {
        userParts.push('已确认时间线（事件先后颠倒报 critical）:');
        for (const t of context.timelineMilestones) {
          userParts.push(`- 第${t.chapterNo}章${t.storyTime ? ' ' + t.storyTime : ''}: ${t.title}`);
        }
      }
    }

    // 视角参照（第11维度）
    if (context.chapterPlan.povCharacterNames?.length) {
      userParts.push('\n【视角参照（用于视角合规性检查）】');
      userParts.push(`本章限知视角人物: ${context.chapterPlan.povCharacterNames.join('、')}`);
      userParts.push('正文若跳到上述人物之外的角色内心（"他心想/她暗道"用于他人），或以上帝视角描写视角人物不在场的事件、直接交代背景设定，报 major；轻微视角游移可报 minor。');
    }

    // 分支参照（第12维度）
    if (context.branchContext) {
      const b = context.branchContext;
      userParts.push('\n【分支参照（用于分支承接一致性检查）】');
      userParts.push(`玩家所选走向「${b.selectedOptionTitle}」: ${b.selectedOptionDescription}`);
      userParts.push(`本章核心走向: ${b.nextChapterIntent}`);
      if (b.impactTagsHistory?.length) {
        userParts.push(`需承接的影响标签历史栈（正文走向须与之一致，无故背离报 critical）: ${b.impactTagsHistory.join('、')}`);
      }
      // 方向参照（第21维度：方向匹配度）
      if (b.mainDirectionName) {
        userParts.push(`\n【方向参照（用于方向匹配度检查）】`);
        userParts.push(`本章选定主方向「${b.mainDirectionName}」${b.mainDirectionDefinition ? '：' + b.mainDirectionDefinition : ''}`);
        userParts.push('正文主体剧情应沿该方向展开；明显不符报 major，仅边缘触时报 minor。');
      }
    }

    // 叙事引擎参照（12-SRS：里程碑推进/分支弧连贯一致性检查）
    if (context.narrativeContext?.text) {
      userParts.push(context.narrativeContext.text);
      userParts.push('正文与上述里程碑/分支弧设定明显矛盾（如分支弧中无故回主线、里程碑要素被架空）报 major。');
    }

    // 影响状态参照（第22维度：影响状态一致性 + 第23维度：命格与资质合理性）
    if (context.impactContext?.characterBlocks?.length || context.impactContext?.worldBlock) {
      userParts.push('\n【影响状态参照（数值体系唯一权威，用于影响状态一致性/命格资质合理性检查）】');
      if (context.impactContext.characterBlocks?.length) {
        for (const cb of context.impactContext.characterBlocks) {
          userParts.push(`◆ ${cb.characterName}：${cb.text}`);
        }
      }
      if (context.impactContext.worldBlock) {
        userParts.push(`◆ 世界状态：${context.impactContext.worldBlock}`);
      }
      userParts.push('正文描写与上述数值/状态明显矛盾报 critical（数值）或 major（状态标签缺失/虚构）；资质平庸者轻易领悟神功、气运与剧情走向明显背离报 major/minor。');
    }

    // 宗门身份参照（第24维度：宗门身份合理性）
    if (context.characters?.length && context.factions?.length) {
      const members = context.characters.filter((ch) => ch.faction);
      if (members.length) {
        userParts.push('\n【宗门身份参照（用于宗门身份合理性检查）】');
        for (const ch of members) {
          userParts.push(`◆ ${ch.name}：${ch.faction}${ch.realm ? '，境界=' + ch.realm : ''}${ch.allTitles ? '，身份=' + ch.allTitles : ''}`);
        }
        userParts.push('NPC对待上述人物的态度、待遇、称呼应与其宗门身份/辈分/境界匹配；明显错位报 major，称呼礼仪轻微不符报 minor。');
      }
    }

    // 因果线参照（第25维度：因果回收率）
    if (context.causalContext?.text) {
      userParts.push('\n【待回收因果线参照（用于因果回收率检查）】');
      userParts.push(context.causalContext.text);
      userParts.push('已逾期因果线完全无体现报 major；即将到期因果线被完全无视报 minor。');
    }

    // 关系状态参照（第26维度：关系一致性）
    if (context.relationContext?.text) {
      userParts.push('\n【人物关系状态参照（用于关系一致性检查）】');
      userParts.push(context.relationContext.text);
      userParts.push('人物互动态度与关系维度明显矛盾（极差却亲密/极好却冷淡无解释）报 major/minor。');
    }

    // 锚点参照（第13维度）
    if (context.chapterPlan.mustHaveEvents?.length) {
      userParts.push('\n【关键剧情锚点（用于锚点事件覆盖率检查）】');
      userParts.push('本章必须覆盖以下核心事件，请逐一核对是否在正文中按序出现并有明确剧情落点：');
      context.chapterPlan.mustHaveEvents.forEach((e, i) => {
        userParts.push(`${i + 1}. ${e}`);
      });
      userParts.push('遗漏任一锚点报 critical，顺序明显错乱或一笔带过报 major。');
    }

    // 伏笔参照（第14维度）
    if (context.foreshadows?.length) {
      userParts.push('\n【未回收伏笔（用于伏笔呼应合理性检查）】');
      for (const f of context.foreshadows) {
        const state = f.status === 'pending' ? '待埋入' : '已埋设';
        userParts.push(`- [${state}] ${f.title}${f.description ? '：' + f.description : ''}${f.hintClue ? '（线索：' + f.hintClue + '）' : ''}${f.resolveChapter ? '（计划第' + f.resolveChapter + '章回收）' : ''}`);
      }
      userParts.push('计划本章回收却完全未触及报 major，正文与伏笔设定矛盾报 major，埋设/呼应生硬突兀报 minor。');
    }

    // 进行中任务线参照（第29维度：任务推进合理性）
    if (context.activeTasks?.length) {
      userParts.push('\n【进行中的任务线（用于任务推进合理性检查）】');
      for (const t of context.activeTasks) {
        const statusLabel = t.status === 'progressing' ? '推进中' : '待推进';
        const parts = [`[${statusLabel}] ${t.title}`];
        if (t.priority) parts.push(`优先级=${t.priority}`);
        if (t.tier) parts.push(`分级=${t.tier}`);
        if (t.targetChapter) parts.push(`目标第${t.targetChapter}章`);
        userParts.push(`- ${parts.join('，')}${t.description ? '：' + t.description : ''}${t.progressClue ? '（进度线索：' + t.progressClue + '）' : ''}`);
      }
      userParts.push('关键任务（高优先级/战略级）被完全无视报 major，普通任务线轻微未呼应报 minor，正文有合理推进或呼应则不报此项。');
    }

    // 成长阶段参照（第15维度）
    if (context.growthStages?.length) {
      userParts.push('\n【人物当前成长阶段（用于人物阶段一致性检查）】');
      for (const g of context.growthStages) {
        userParts.push(`- ${g.characterName || '人物' + g.characterId}：第${g.stageNo}阶段「${g.name}」，特质=${g.traits.join('、')}${g.description ? '，' + g.description : ''}`);
      }
      userParts.push('人物言行与阶段特质明显矛盾报 major，特质体现不足但无矛盾报 minor。');
    }

    // 自定义功法/法宝/武器参照（第16维度）
    if (context.customEntities?.length) {
      userParts.push('\n【自定义功法/法宝/武器设定（用于表现一致性检查）】');
      for (const e of context.customEntities) {
        if (e.entityType === 'technique') {
          userParts.push(`- 功法「${e.name}」指引=${e.guidanceDepth || '—'} 道则=${e.daoComposition || '—'}：${e.coreEffect || ''}`);
          if (e.effects?.length) userParts.push(`  本源特质：${e.effects.map((ef) => ef.name).join('、')}`);
          if (e.realmAbilities) userParts.push(`  分道境神通：${e.realmAbilities}`);
          if (e.backlashSummary) userParts.push(`  反噬代价：${e.backlashSummary}`);
          if (e.variantSummary) userParts.push(`  个人变种：${e.variantSummary}`);
          continue;
        }
        const typeLabel = e.entityType === 'skill' ? '功法' : e.entityType === 'weapon' ? '武器' : '法宝';
        const gradeStr = e.grade ? `${e.grade}第${e.gradeLevel ?? 1}层${e.isEvolved ? '(进化)' : ''}` : '';
        userParts.push(`- ${typeLabel}「${e.name}」${gradeStr}：${e.coreEffect || ''}`);
        if (e.effects?.length) {
          for (const ef of e.effects) {
            userParts.push(`  特效[${ef.rarity}] ${ef.name}：${ef.description}（强度${ef.strength}）`);
          }
        }
        if (e.sideEffects) userParts.push(`  副作用：${e.sideEffects}`);
        if (e.fakeName) userParts.push(`  对外化名：${e.fakeName}`);
        if (e.intro) userParts.push(`  简介：${e.intro}`);
        if (e.moves?.length) {
          for (const m of e.moves) userParts.push(`  招式「${m.name}」：${m.desc}`);
        }
      }
      userParts.push('使用未列出能力/特质报 major，特效强度超出设定报 major，强力特效无代价报 minor，低品级碾压高品级无解释报 major；武器出现无对应特质的效果（如无淬毒却淬毒伤敌）报 major。');
      userParts.push('道则边界铁律：功法出现其所修道则之外的能力（如纯坤土功法浮空飞行、纯庚金功法治愈）报 major；强行催动大招或对冲融合功法却无对应反噬代价描写报 major；入门指引功法直接描写微观操控/改写道则规则报 major。');
      userParts.push('千人千面校验：若提供了个人变种，同一功法在不同人物手中应体现差异化修炼偏向（变种名/专属技巧/修炼适配），把所有人写成完全相同报 minor；变种突破基础功法道则边界或出现无代价纯增益报 major。');
    }

    // 应融入素材参照（第28维度：指定素材融入率）
    const pinnedMaterials = context.plotMaterials?.filter((m) => m.pinned === true) || [];
    if (pinnedMaterials.length || context.foreshadowTechniques?.length || context.growthHighlights?.length) {
      userParts.push('\n【应融入素材清单（用于指定素材融入率检查）】');
      if (pinnedMaterials.length) {
        userParts.push('必须融入（作者手动固定，正文须实质性体现其核心人物/事件/意象）:');
        for (const m of pinnedMaterials) {
          userParts.push(`- [必须融入] ${m.title}：${m.corePlot}`);
        }
      }
      if (context.foreshadowTechniques?.length) {
        userParts.push('伏笔手法参考:');
        for (const ft of context.foreshadowTechniques) {
          const techTitles = ft.techniques?.map((t) => t.title).join('、') || '无';
          userParts.push(`- 伏笔「${ft.foreshadowTitle}」（${ft.action === 'plant' ? '本章埋设' : '本章回收'}）参考手法: ${techTitles}`);
        }
      }
      if (context.growthHighlights?.length) {
        userParts.push('高光参考:');
        for (const gh of context.growthHighlights) {
          const hlTitles = gh.highlights?.map((h) => h.title).join('、') || '无';
          userParts.push(`- ${gh.characterName || '人物'}（${gh.fromStage ? gh.fromStage + '→' : ''}${gh.toStage}${gh.isKeyNode ? '，关键节点' : ''}）参考高光: ${hlTitles}`);
        }
      }
      userParts.push('固定素材完全未融入报 major，仅一笔带过缺乏落点报 minor。');
    }

    userParts.push('\n请严格按照JSON格式输出审查报告。');

    return { systemPrompt, userPrompt: userParts.join('\n') };
  }
}

export const auditorAgent = new AuditorAgent();
