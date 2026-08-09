/**
 * 写作Agent - 负责根据上下文和章节计划生成小说章节
 * 参考InkOS Writer + OpenWrite生成逻辑
 */
import { BaseAgent } from './base.js';
import type { ContextPackage, LlmConfig } from '../types.js';
import type { ChatOptions, UsageInfo } from '../llm/client.js';

/** 去AI味指令：避免的高频词列表 */
const AI_FLAVOR_WORDS = [
  '然而', '不禁', '竟然', '居然', '仿佛', '似乎', '宛如', '犹如',
  '一抹', '一丝', '一缕', '淡淡', '缓缓', '轻轻', '微微',
  '不由得', '情不自禁', '恍然大悟', '豁然开朗',
];

export class WriterAgent extends BaseAgent {
  constructor() {
    super('WriterAgent');
  }

  /**
   * 写作主方法 - 非流式
   */
  async writeChapter(
    context: ContextPackage,
    llmConfig?: LlmConfig,
    onUsage?: (usage: UsageInfo, model: string) => void
  ): Promise<string> {
    const { systemPrompt, userPrompt } = this.buildWriterPrompt(context);
    const messages = this.buildMessages(systemPrompt, userPrompt);

    const options: ChatOptions = {
      temperature: 0.85,
      // 预算给足：思考模型（如 LLM_WRITER_MODEL=glm-5.2）的 reasoning token 也计入上限，
      // 预算不足会导致正文被截断甚至返回空内容
      maxTokens: 16384,
      configOverride: llmConfig,
      onUsage,
    };

    this.log(`开始写作第${context.chapterPlan.chapterNumber}章: ${context.chapterPlan.title}`);
    const content = await this.callWithRetry(messages, options);
    this.log(`写作完成，生成${content.length}字`);

    return content;
  }

  /**
   * 写作主方法 - 流式输出
   */
  async writeChapterStream(
    context: ContextPackage,
    llmConfig?: LlmConfig
  ): Promise<ReadableStream<string>> {
    const { systemPrompt, userPrompt } = this.buildWriterPrompt(context);
    const messages = this.buildMessages(systemPrompt, userPrompt);

    const options: ChatOptions = {
      temperature: 0.85,
      maxTokens: 8192,
      configOverride: llmConfig,
    };

    this.log(`开始流式写作第${context.chapterPlan.chapterNumber}章: ${context.chapterPlan.title}`);
    return this.streamWithRetry(messages, options);
  }

  /**
   * 构建写作prompt
   */
  private buildWriterPrompt(context: ContextPackage): {
    systemPrompt: string;
    userPrompt: string;
  } {
    const { chapterPlan, characters, factions, locations, skills, items, relations, prevSummaries, rules } = context;

    // === System Prompt ===
    const systemParts: string[] = [];

    systemParts.push(
      `你是一位专业的${this.inferGenre(context)}小说作家，拥有丰富的创作经验。你的文字功底深厚，善于营造氛围、刻画人物、推进剧情。`
    );

    // POV限知视角铁律（章节级，仅在章节计划声明了视角人物时启用）
    const povNames = context.chapterPlan.povCharacterNames;
    if (povNames?.length) {
      systemParts.push('\n【视角铁律 - 限知视角，必须严格遵守】');
      if (povNames.length === 1) {
        systemParts.push(`- 本章采用第三人称限知视角，全程锚定「${povNames[0]}」一人。`);
        systemParts.push(`- 只能描写「${povNames[0]}」亲眼所见、亲耳所闻、亲身感受与内心活动。`);
      } else {
        systemParts.push(`- 本章允许在以下视角人物间切换：${povNames.join('、')}。`);
        systemParts.push(`- 每次切换视角必须以场景转换或空行明确分隔，任一时刻只锚定其中一人，不得在同一段内跳跃。`);
        systemParts.push(`- 只能描写当前锚定视角人物亲眼所见、亲耳所闻、亲身感受与内心活动。`);
      }
      systemParts.push('- 其他人物只能写其外在言行、表情、外貌，绝不可直接写其内心想法（"他心想""她暗道"等只能用于视角人物）。');
      systemParts.push('- 不可描写视角人物不在场时发生的事件，不可用上帝视角交代背景设定（须借对话、景物、回忆自然带出）。');
    }

    // 分支影响铁律（仅在注入影响上下文时启用：影响快照是数值状态的唯一权威）
    if (context.impactContext?.characterBlocks?.length || context.impactContext?.worldBlock) {
      systemParts.push('\n【影响铁律 - 数值与状态一致性，必须严格遵守】');
      systemParts.push('- 下方【人物当前状态】与【世界当前状态】中的数值与生效状态，是本书数值体系的唯一权威来源。');
      systemParts.push('- 描写人物修为/气运/根骨/伤势等数值属性时，必须与给定数值一致，禁止凭空拔高、贬低或臆造不存在的属性。');
      systemParts.push('- 标注"生效状态"的标签（如中毒、封印、顿悟）必须在剧情中真实体现其影响；未列出的状态一律视为不存在，禁止虚构。');
      systemParts.push('- 数值与状态只能随剧情合理演变，禁止在本章内无来由地突变；若剧情需要变化，须给出可信的因果铺垫。');
    }

    // P0：硬性事实约束（从人物/状态/时间线提取的不可违反事实）
    if (context.hardFacts?.serialized) {
      systemParts.push('\n【硬性事实约束 - 不可违反，违反即判定生成失败】');
      systemParts.push('以下事实为本书已确认的核心设定，正文中不得出现任何与之矛盾的表述：');
      systemParts.push(context.hardFacts.serialized);
      systemParts.push('⚠️ 特别注意：人物性别/代词不可前后矛盾；时间数字不可与锚点冲突；境界不可与确认状态不一致。');
    }

    // 作者规则
    if (rules.length > 0) {
      systemParts.push('\n【作者规则 - 必须严格遵守】');
      rules.forEach((rule, i) => {
        systemParts.push(`${i + 1}. ${rule}`);
      });
    }

    // 文风要求（优先注入诛仙库风格铁律，缺失时回退通用要求）
    if (context.style) {
      systemParts.push(...this.buildStyleBlock(context.style));
    } else {
      systemParts.push('\n【文风要求】');
      systemParts.push('- 文字要自然流畅，避免生硬的过渡');
      systemParts.push('- 对话要符合人物性格，有个性差异');
      systemParts.push('- 善用细节描写，但不过度堆砌');
      systemParts.push('- 节奏张弛有度，紧张与舒缓交替');
      systemParts.push('- 多用短句，少用长复合句');
    }

    // 去AI味指令（始终保留，与DB禁用词互补）
    systemParts.push('\n【严禁使用的词汇和表达】');
    if (context.style?.forbiddenWords?.length) {
      systemParts.push(`本书禁用词（绝对不得出现）: ${context.style.forbiddenWords.join('、')}`);
    }
    systemParts.push(`以下AI高频词严禁出现: ${AI_FLAVOR_WORDS.join('、')}`);
    systemParts.push('- 禁止使用"值得一提的是""需要指出的是"等说明文用语');
    systemParts.push('- 禁止使用排比句堆砌情感');
    systemParts.push('- 禁止每段开头都用时间/地点状语');
    systemParts.push('- 禁止使用"仿佛整个世界都安静了"等俗套表达');

    // R4: 章末铁律（写作质量增强）
    systemParts.push('\n【章末铁律 - 本章结尾必须遵守】');
    systemParts.push('1. 禁止以总结句、道理句、抒情句收束');
    systemParts.push('2. 必须停在一个"变化发生的那一拍"上：局势变化 / 关系偏移 / 半揭露真相 / 关键决定');
    systemParts.push('3. 该留到下一章的解释，本章绝对不说满');
    systemParts.push('4. 章末最后一句尽量短，能让读者自然想点下一章');

    // v1.4 PRD-A：三节结构铁律（受 generationConfig.threePartStructureEnabled 开关控制）
    if (context.generationFlags?.threePartStructureEnabled === true) {
      systemParts.push('\n【三节结构铁律 - 本章篇幅必须显式分为三节】');
      systemParts.push('1. 开篇节（约前25%）：落地场景与人物状态，并在本节内抛出本章的核心钩子/悬念，禁止慢热铺垫超过三分之一。');
      systemParts.push('2. 发展节（约中50%）：推进核心冲突，至少包含一次实质性的局面/关系/信息变化，禁止原地打转。');
      systemParts.push('3. 收束节（约后25%）：变化落地并停在"变化发生的那一拍"，本节必须包含一个钩子（悬念/危机/反转/情绪高点），与章末铁律叠加生效。');
      systemParts.push('三节之间用空行自然分隔，不需要写节标题；三节占比允许±10%浮动，但不得缺少任何一节的功能。');
    }

    // R8: 黄金三章专项约束（仅第1卷前3章启用）
    const chapterNo = context.chapterPlan.chapterNumber;
    const volumeNo = context.chapterPlan.volumeNo ?? 1;
    if (chapterNo <= 3 && volumeNo === 1) {
      systemParts.push('\n【黄金三章铁律 - 必须严格遵守】');
      if (chapterNo === 1) {
        systemParts.push('第一章（成交章）：');
        systemParts.push('- 前300-500字必须出现抓手（异常局面/危机/反差）');
        systemParts.push('- 前1500字内主角必须正式亮相');
        systemParts.push('- 前3000字内卖点必须显形');
        systemParts.push('- 禁止从天气、日常、背景介绍开场');
        systemParts.push('- 禁止大段世界观直灌');
      } else if (chapterNo === 2) {
        systemParts.push('第二章（升级章）：');
        systemParts.push('- 冲突必须升级：第一章的麻烦在第二章变大');
        systemParts.push('- 卖点必须展开：第一章露了一角的东西，第二章给出更多');
        systemParts.push('- 主角必须主动：不能只被动挨打，要有第一个主动决策');
      } else {
        systemParts.push('第三章（立誓章）：');
        systemParts.push('- 必须建立阶段性目标：读者知道主角接下来要干什么');
        systemParts.push('- 必须给出继续追读的理由：悬念/反差点/关系钩子');
        systemParts.push('- 前三章结束时，读者必须清楚：主角是谁、遇到什么、卖点是什么');
      }
    }

    // R9: 叙事技法要求（从技法库注入的原则性指导）
    if (context.techniqueGuidance && context.techniqueGuidance.length > 0) {
      systemParts.push('\n【叙事技法要求】');
      systemParts.push('本章请遵循以下叙事原则：');
      context.techniqueGuidance.forEach((g, i) => {
        systemParts.push(`${i + 1}. ${g}`);
      });
      systemParts.push('注意：以上是原则性指导，请根据本章具体内容灵活运用，不要生硬套用。');
    }

    const systemPrompt = systemParts.join('\n');

    // === User Prompt ===
    const userParts: string[] = [];

    // 章节意图
    userParts.push(`【本章写作任务】`);
    userParts.push(`章节: 第${chapterPlan.chapterNumber}章 - ${chapterPlan.title}`);
    userParts.push(`核心意图: ${chapterPlan.intent}`);
    userParts.push(`目标字数: ${chapterPlan.targetWordCount}字左右（允许±10%浮动）`);
    if (chapterPlan.targetEmotion) {
      userParts.push(`目标情绪: ${chapterPlan.targetEmotion}`);
    }
    if (chapterPlan.conflictType) {
      userParts.push(`冲突类型: ${chapterPlan.conflictType}`);
    }
    // 冲突值目标（天命P0#1）
    if (chapterPlan.conflictRating) {
      userParts.push(`冲突强度目标: ${chapterPlan.conflictRating}${chapterPlan.isPeak ? '（峰值章——节奏紧凑、思考/对话占比压至10%以下）' : ''}`);
    }
    // 章节类型穿透（天命P1#4）
    if (chapterPlan.chapterType && chapterPlan.chapterType !== 'progression') {
      const typeStrategy: Record<string, string> = {
        climax: '高潮章：全力爆发，冲突白热化，不留余地',
        revelation: '揭露章：信息解密为核心，层层剥开真相，控制信息释放节奏',
        buffer_price: '缓冲-代价：清算前一事件代价，角色消化损失、疗伤、反思',
        buffer_dialog: '缓冲-对话：角色关系演变，深度对话推进情感线，节奏舒缓',
        buffer_clue: '缓冲-线索：伏笔/信息整理，角色梳理线索、规划下一步',
        singularity: '奇点事件：破格行为，打破既有规则，需有相称代价',
      };
      if (typeStrategy[chapterPlan.chapterType]) {
        userParts.push(`章节类型: ${typeStrategy[chapterPlan.chapterType]}`);
      }
    }

    // 场景分解（升级为施工卡格式，需求3）
    if (chapterPlan.sceneBreakdown) {
      let scenes: any[] | null = null;
      try {
        const parsed = JSON.parse(chapterPlan.sceneBreakdown);
        if (Array.isArray(parsed)) scenes = parsed;
      } catch { /* 非JSON，按原文输出 */ }

      if (scenes && scenes.some((s: any) => s.coreBeat || s.stateChange || s.hookType)) {
        // 施工卡格式
        userParts.push(`\n【场景施工卡 - 按序执行，每场必须完成核心节拍和状态变化】`);
        scenes.forEach((s: any, i: number) => {
          userParts.push(`\n场景 ${i + 1}：${s.title || s.name || `场景${i + 1}`}`);
          if (s.coreBeat) userParts.push(`  ▶ 核心节拍（必须完成）：${s.coreBeat}`);
          if (s.stateChange) {
            const sc = typeof s.stateChange === 'string' ? s.stateChange : JSON.stringify(s.stateChange);
            userParts.push(`  ▶ 状态变化：${sc}`);
          }
          if (s.hookType || s.sceneHookType) userParts.push(`  ▶ 场景钩子：${s.hookType || s.sceneHookType}型`);
          if (s.description || s.coreEvent) userParts.push(`  ▶ 场景描述：${s.description || s.coreEvent}`);
        });
        userParts.push(`\n要求：每个场景结束时人物状态必须和开始时不同（最小起伏原则），不得平进平出。`);
      } else {
        // 原始格式兜底
        userParts.push(`\n【场景分解】`);
        userParts.push(chapterPlan.sceneBreakdown);
      }
    }

    // 关键剧情锚点（模块1：本章必须按序覆盖的强制事件）
    if (chapterPlan.mustHaveEvents?.length) {
      userParts.push(`\n【关键剧情锚点 - 必须严格覆盖，不得遗漏】`);
      userParts.push(`本章必须发生以下核心事件，请将其自然融入剧情并保证全部出现：`);
      chapterPlan.mustHaveEvents.forEach((e, i) => {
        userParts.push(`${i + 1}. ${e}`);
      });
      userParts.push(`要求：上述锚点事件须按列出顺序依次推进，每个事件都要有明确的剧情落点，不可一笔带过或跳过。`);
    }

    // 章末钩子专项指令（需求6）
    if (chapterPlan.hookType) {
      userParts.push(`\n【章末钩子要求】`);
      const hookTypeMap: Record<string, string> = {
        suspense: '悬念型 — 在关键时刻切断，留下未解之谜',
        emotion: '情绪型 — 在情绪最高点切断，留下人物的强烈感受',
        turn: '转折型 — 以意外反转收尾，颠覆读者预期',
        crisis: '危机型 — 新的危险突然降临，主角陷入困境',
        reveal: '揭秘型 — 抛出一个颠覆性真相后立即收束',
      };
      userParts.push(`钩子类型：${hookTypeMap[chapterPlan.hookType] || chapterPlan.hookType}`);
      if (chapterPlan.hookIntensity) {
        const intensityMap: Record<string, string> = {
          light: '轻钩 — 轻微悬念，读者好奇但不焦虑',
          medium: '中钩 — 明确悬念，驱动追读',
          heavy: '重钩 — 强烈冲击，不看下一章睡不着',
        };
        userParts.push(`钩子强度：${intensityMap[chapterPlan.hookIntensity] || chapterPlan.hookIntensity}`);
      }
      userParts.push('要求：钩子必须落在本章最后一段，不要提前泄底也不要拖泥带水。');
    }

    // 人物设定（自定义人物渲染★标记+定位/立场/性格标签/天赋/短板，保证生成端吃到完整人设）
    if (characters.length > 0) {
      userParts.push(`\n【出场人物设定】`);
      for (const c of characters) {
        const parts = [c.source === 'custom' ? `★${c.name}` : c.name];
        if (c.allTitles?.length) parts.push(`(${c.allTitles.join('、')})`);
        if (c.personality) parts.push(`性格: ${c.personality}`);
        if (c.source === 'custom') {
          if (c.faction) parts.push(`种族: ${c.faction}`);
          if (c.position) parts.push(`实力定位: ${c.position}`);
          if (c.fakePosition) parts.push(`伪装示人: ${c.fakePosition}（扮猪吃虎，对外言行须匹配伪装定位）`);
          if (c.stance) parts.push(`立场: ${c.stance}`);
          if (c.outerPersonality?.length) parts.push(`性格标签: ${c.outerPersonality.join('、')}`);
        } else {
          if (c.realm) parts.push(`修为: ${c.realm}`);
          if (c.faction) parts.push(`所属: ${c.faction}`);
          if (c.coreSkills?.length) parts.push(`能力: ${c.coreSkills.join('、')}`);
        }
        userParts.push(`- ${parts.join('，')}`);
        // 自定义人物扩展行：天赋/擅长/短板/小传，人物言行与能力表现须严格贴合
        if (c.source === 'custom') {
          if (c.talents?.length) userParts.push(`  先天禀赋: ${c.talents.join('；')}`);
          if (c.strengths?.length || c.weaknesses?.length) {
            userParts.push(`  擅长: ${(c.strengths ?? []).join('、') || '无'}；短板: ${(c.weaknesses ?? []).join('、') || '无'}`);
          }
          if (c.bio) userParts.push(`  人物小传: ${c.bio}`);
          // 武学档案（功法×武器融合招式 + 武学小传）：该人物出手/战斗描写须与融合招式一致
          if (c.martialLores?.length) {
            for (const ml of c.martialLores) {
              const combo = [ml.techniqueName, ml.weaponName].filter(Boolean).join('×');
              userParts.push(`  武学搭配${combo ? `「${combo}」` : ''}:`);
              if (ml.fusedMoves?.length) {
                userParts.push(`    融合招式: ${ml.fusedMoves.map((m) => m.desc ? `${m.name}（${m.desc}）` : m.name).join('；')}`);
              }
              if (ml.biography) userParts.push(`    武学小传: ${ml.biography}`);
            }
          }
        }
        // 深层行为逻辑（诛仙库蒸馏，让人物言行有内在依据而非只有表层性格）
        if (c.mentalModels?.length) userParts.push(`  心智模型: ${c.mentalModels.join('；')}`);
        if (c.heuristics?.length) userParts.push(`  处事准则: ${c.heuristics.join('；')}`);
        if (c.lifeStages?.length) userParts.push(`  人生阶段: ${c.lifeStages.join('；')}`);
        // 模块3：当前成长阶段（按本章章节号匹配，人物言行须符合此阶段特质）
        if (c.currentGrowthStage) {
          const gs = c.currentGrowthStage;
          userParts.push(`  ★当前成长阶段「${gs.name}」: 特质=${gs.traits.join('、')}${gs.description ? '，' + gs.description : ''}`);
        }
      }
      if (characters.some((ch) => ch.source === 'custom')) {
        userParts.push('注意：★标记为用户自定义人物，其实力定位仅为模糊体感强弱描述，严禁在正文中为其安排具体境界名称或等级数字。');
      }
    }

    // 人物关系
    if (relations.length > 0) {
      userParts.push(`\n【人物关系】`);
      for (const r of relations) {
        const tag = r.source === 'custom' ? '★' : '';
        let line = `- ${tag}人物${r.charAId} 与 人物${r.charBId}: ${r.relType}`;
        if (r.description) line += `（${r.description}）`;
        if (r.interactPattern) line += ` 互动模式: ${r.interactPattern}`;
        userParts.push(line);
      }
    }

    // 门派设定
    if (factions.length > 0) {
      userParts.push(`\n【门派/组织】`);
      for (const f of factions) {
        userParts.push(`- ${f.name}: ${f.camp || ''}${f.cultivationFeature ? '，修炼: ' + f.cultivationFeature : ''}`);
      }
    }

    // 地点设定
    if (locations.length > 0) {
      userParts.push(`\n【场景地点】`);
      for (const l of locations) {
        userParts.push(`- ${l.name}: ${l.environment || ''}`);
      }
    }

    // 功法设定
    if (skills.length > 0) {
      userParts.push(`\n【相关功法】`);
      for (const s of skills) {
        userParts.push(`- ${s.name}: ${s.coreEffect || ''}`);
      }
    }

    // 法宝设定
    if (items.length > 0) {
      userParts.push(`\n【相关法宝】`);
      for (const i of items) {
        userParts.push(`- ${i.name}: ${i.coreAbilities || ''}`);
      }
    }

    // 前文摘要
    if (prevSummaries.length > 0) {
      userParts.push(`\n【前文回顾】`);
      prevSummaries.forEach((s, i) => {
        userParts.push(`前${prevSummaries.length - i}章: ${s}`);
      });
    }

    // 状态追踪（最近已确认的人物状态 + 时间线，防止长篇设定漂移）
    if (context.stateSnapshots?.length || context.timelineMilestones?.length) {
      userParts.push(`\n【状态追踪 - 截至上一章的已确认状态，本章不得与之矛盾】`);
      if (context.stateSnapshots?.length) {
        userParts.push(`人物状态:`);
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
        userParts.push(`时间线（注意事件先后，不得颠倒）:`);
        for (const t of context.timelineMilestones) {
          userParts.push(`- 第${t.chapterNo}章${t.storyTime ? ' ' + t.storyTime : ''}: ${t.title}${t.description ? '（' + t.description + '）' : ''}`);
        }
      }
    }

    // 剧情分支走向（本章由玩家选定的分支选项衍生时注入，需求12）
    if (context.branchContext) {
      const b = context.branchContext;
      userParts.push(`\n【剧情分支走向 - 玩家已选定，本章必须严格沿此走向展开】`);
      userParts.push(`所选走向「${b.selectedOptionTitle}」: ${b.selectedOptionDescription}`);
      userParts.push(`本章核心走向: ${b.nextChapterIntent}`);
      if (b.impactTagsHistory?.length) {
        userParts.push(`需承接的影响标签（历代抉择累积，正文走向须与之一致，不得无故背离）: ${b.impactTagsHistory.join('、')}`);
      }
    }

    // 动态叙事引擎双轨参照（12-SRS：里程碑推进 + 分支弧连贯）
    if (context.narrativeContext?.text) {
      userParts.push(context.narrativeContext.text);
    }

    // 待回收叙事线（统一展示层）：伏笔 + 因果线合并为单一参照块
    if (context.foreshadows?.length || context.causalContext?.text) {
      userParts.push(`\n【待回收叙事线 - 前文埋下的伏笔与因果须有回应，切忌生硬堆砌】`);
      if (context.foreshadows?.length) {
        for (const f of context.foreshadows) {
          if (f.status === 'pending') {
            userParts.push(`- [伏笔·待埋入] ${f.title}${f.description ? '：' + f.description : ''}${f.hintClue ? '（埋设线索：' + f.hintClue + '）' : ''} —— 本章如有合适契机，请自然埋下这条线索。`);
          } else {
            userParts.push(`- [伏笔·已埋设] ${f.title}${f.description ? '：' + f.description : ''}${f.hintClue ? '（线索：' + f.hintClue + '）' : ''}${f.resolveChapter ? '（计划第' + f.resolveChapter + '章回收）' : ''} —— 可在本章适度呼应或推进，若恰逢回收时机则给出明确落点。`);
          }
        }
      }
      if (context.causalContext?.text) {
        userParts.push(context.causalContext.text);
      }
      userParts.push(`要求：叙事线须服务于剧情，有机融入，不得为埋而埋或强行提前回收；若本章适合兑现某条线索，须自然融入，若不适合兑现，至少以暗示保持线索活跃，不可完全无视。`);
    }

    // 进行中的任务线（素材深度融入·第2层）：跨章状态机台账，与伏笔同级，须有机推进
    if (context.activeTasks?.length) {
      const taskStatusLabel = (s: string) => (s === 'progressing' ? '推进中' : '待推进');
      const taskPriorityLabel = (p?: string) => (p === 'high' ? '高' : p === 'low' ? '低' : '中');
      userParts.push(`\n【进行中的任务线 - 跨章推进的任务目标，本章须有所推动而非搁置】`);
      for (const t of context.activeTasks) {
        const parts: string[] = [`- [任务·${taskStatusLabel(t.status)}] ${t.title}`];
        if (t.description) parts.push(`：${t.description}`);
        parts.push(`（优先级${taskPriorityLabel(t.priority)}`);
        if (t.tier) parts.push(`·${t.tier}`);
        if (t.targetChapter) parts.push(`·目标第${t.targetChapter}章完成`);
        parts.push(`）`);
        if (t.progressClue) parts.push(`（进度线索：${t.progressClue}）`);
        if (t.referencedMaterialIds?.length) parts.push(`（关联素材ID：${t.referencedMaterialIds.join('、')}）`);
        userParts.push(parts.join(''));
      }
      userParts.push(`要求：任务推进须贴合剧情节奏，本章若契合某任务的推进契机，应自然推动其进展；若时机未到，至少以细节保持任务活跃，不可让其凭空消失或突兀完成。`);
    }

    // 伏笔手法联动（A1+A2）：本章需埋设/回收的伏笔 → 定向召回的伏笔手法参考
    if (context.foreshadowTechniques?.length) {
      userParts.push(`\n【伏笔手法参考 - 埋设/回收伏笔时参照成熟手法】`);
      for (const ft of context.foreshadowTechniques) {
        const actionLabel = ft.action === 'plant' ? '埋设' : '回收';
        userParts.push(`◆ 本章需${actionLabel}伏笔《${ft.foreshadowTitle}》，可参考以下手法：`);
        if (!ft.techniques.length) {
          userParts.push(`  （暂无匹配手法，按情节自然处理）`);
          continue;
        }
        for (const t of ft.techniques) {
          const tag = t.pinned ? '作者指定·必须参照' : '参考';
          userParts.push(`  - [${tag}] ${t.title}：${t.corePlot}`);
          if (t.triggerCondition) userParts.push(`    适用契机：${t.triggerCondition}`);
          if (t.emotionalBeat) userParts.push(`    情绪处理：${t.emotionalBeat}`);
        }
      }
      userParts.push(`要求：借鉴手法如何留线索/如何呼应回收，但须贴合本书情节，作者指定手法的核心机制不可省略。`);
    }

    // 收藏金句参考（模块11）：强化人物说话风格一致性
    if (context.collectedQuotes?.length) {
      userParts.push(`\n【收藏金句参考 - 人物台词风格参照】`);
      for (const q of context.collectedQuotes) {
        userParts.push(`- ${q.characterName || '旁白'}：「${q.quoteText}」`);
      }
      userParts.push(`以上为历史精彩台词，可参考其语气与风格，但不要直接复制。`);
    }

    // 冰山台词参考（FUNC-01）：双引擎工坊生成的三层冰山对话，强化潜台词风格
    if (context.icebergDialogues?.length) {
      userParts.push(`\n【冰山台词参考 - 人物潜台词风格参照】`);
      for (const d of context.icebergDialogues) {
        const chLabel = d.chapterNo ? `（第${d.chapterNo}章）` : '';
        userParts.push(`- ${d.characterName || '未知'}${chLabel}：${d.snippet}`);
      }
      userParts.push(`以上为冰山对话模板（表层台词+真相层+行为锚点），可参考其"说A想B"的潜台词风格，但不要直接复制台词。`);
    }

    // 自定义功法/法宝（模块9）：成长工坊产出的项目级专属实体
    if (context.customEntities?.length) {
      userParts.push(`\n【自定义功法/法宝设定 - 必须严格遵循】`);
      for (const e of context.customEntities) {
        if (e.entityType === 'technique') {
          userParts.push(`◆ 功法「${e.name}」指引=${e.guidanceDepth || '—'} 道则=${e.daoComposition || '—'}`);
          if (e.coreEffect) userParts.push(`  核心定位：${e.coreEffect}`);
          if (e.effects?.length) userParts.push(`  本源特质：${e.effects.map((ef) => ef.name).join('、')}`);
          if (e.realmAbilities) userParts.push(`  分道境神通：${e.realmAbilities}`);
          if (e.backlashSummary) userParts.push(`  ⚠反噬代价：${e.backlashSummary}`);
          if (e.variantSummary) userParts.push(`  ✦个人变种（千人千面，须写出各人差异）：${e.variantSummary}`);
          continue;
        }
        const typeLabel = e.entityType === 'skill' ? '功法' : e.entityType === 'weapon' ? '武器' : '法宝';
        const gradeStr = e.grade ? `${e.grade}第${e.gradeLevel ?? 1}层${e.isEvolved ? `（进化形态·${e.evolutionStage || '觉醒'}）` : ''}` : '';
        userParts.push(`◆ ${typeLabel}「${e.name}」${gradeStr}`);
        if (e.coreEffect) userParts.push(`  核心效果：${e.coreEffect}`);
        if (e.effects?.length) {
          for (const ef of e.effects) {
            const rarityLabel = ef.rarity === 'legendary' ? '★传说' : ef.rarity === 'rare' ? '☆稀有' : '普通';
            userParts.push(`  特效[${rarityLabel}] ${ef.name}：${ef.description}（强度${ef.strength}）`);
          }
        }
        if (e.sideEffects) userParts.push(`  ⚠副作用/反噬：${e.sideEffects}`);
      }
      userParts.push(`以上为角色专属成长实体，战斗中必须体现其特效与副作用，不得凭空新增未列出的能力。`);

      // 模块9二期：突破叙事片段（融合/进化时生成的场景，可作为闪回/铺垫素材）
      const withBreakthrough = context.customEntities.filter((e) => e.breakthroughNarrative);
      if (withBreakthrough.length) {
        userParts.push(`\n【突破叙事素材（可在正文中以闪回/回忆/旁白形式引用）】`);
        for (const e of withBreakthrough) {
          userParts.push(`◆「${e.name}」突破场景：${e.breakthroughNarrative}`);
        }
      }
    }

    // 模块9二期：特效共鸣（同一人物多实体共享特效类型时的组合加成）
    if (context.resonanceEffects?.length) {
      userParts.push(`\n【特效共鸣 - 战斗中必须体现】`);
      for (const r of context.resonanceEffects) {
        userParts.push(`◆ ${r.characterName}触发「${r.description}」`);
      }
      userParts.push(`当上述角色同时使用相关功法/法宝时，必须描写共鸣效果的触发与表现。`);
    }

    // 二期RAG：剧情素材参考（语义召回的奇遇/伏笔/高光/任务链）
    if (context.plotMaterials?.length) {
      const tableLabel: Record<string, string> = {
        plot_material_encounter: '奇遇',
        plot_material_foreshadow: '伏笔手法',
        plot_material_highlight: '高光',
        plot_material_task: '任务链',
      };
      const renderMaterial = (m: (typeof context.plotMaterials)[number]) => {
        const lines: string[] = [];
        lines.push(`- [${tableLabel[m.table] || '素材'}] ${m.title}：${m.corePlot}`);
        if (m.triggerCondition) lines.push(`  触发：${m.triggerCondition}`);
        if (m.reward) lines.push(`  收获：${m.reward}`);
        if (m.costOrRisk) lines.push(`  代价/风险：${m.costOrRisk}`);
        if (m.emotionalBeat) lines.push(`  情绪线：${m.emotionalBeat}`);
        return lines.join('\n');
      };

      // 作者手动固定的素材：本章必须自然融入
      const pinned = context.plotMaterials.filter((m) => m.pinned);
      if (pinned.length) {
        userParts.push(`\n【作者指定剧情素材 - 本章必须自然融入】`);
        for (const m of pinned) userParts.push(renderMaterial(m));
        userParts.push(`以上为作者明确指定要写入本章的素材，须作为本章剧情的有机组成部分自然呈现（可调整呈现方式以贴合上下文，但核心事件不可省略）。`);
      }

      // 语义自动召回的素材：仅供灵感启发
      const auto = context.plotMaterials.filter((m) => !m.pinned);
      if (auto.length) {
        userParts.push(`\n【剧情素材参考 - 仅供灵感启发，不必照搬】`);
        for (const m of auto) userParts.push(renderMaterial(m));
        userParts.push(`以上为语义匹配的参考素材，可借鉴其结构/节奏/情绪曲线，但必须适配本书世界观与人物，禁止直接搬用。`);
      }
    }

    // 开源借鉴 PRD v1.1 M5：对标素材（拆文产出的角色卡/剧情单元/文风/设定）
    if (context.benchmarkMaterials?.length) {
      const typeLabel: Record<string, string> = {
        character: '角色卡',
        plot_unit: '剧情单元',
        style: '文风分析',
        setting: '设定',
      };
      const renderBenchmark = (m: (typeof context.benchmarkMaterials)[number]) =>
        `- [对标·${typeLabel[m.materialType] || m.materialType}] ${m.title}（源自《${m.sourceBookTitle}》）\n${m.contentMd}`;

      const pinnedBm = context.benchmarkMaterials.filter((m) => m.pinned);
      if (pinnedBm.length) {
        userParts.push(`\n【作者置顶对标素材 - 本章必须借鉴融入】`);
        for (const m of pinnedBm) userParts.push(renderBenchmark(m));
        userParts.push(`以上为作者置顶的对标资产：角色卡须对照其 role/personality/motivation/arc 塑造本书对应人物，剧情单元须借鉴其冲突-转折结构，文风要点须落实其可复刻的句式/节奏特征（适配本书世界观，禁止照搬原作人名/地名/专有名词）。`);
      }
      const autoBm = context.benchmarkMaterials.filter((m) => !m.pinned);
      if (autoBm.length) {
        userParts.push(`\n【对标素材参考 - 借鉴节奏与文风，不必照搬】`);
        for (const m of autoBm) userParts.push(renderBenchmark(m));
        userParts.push(`以上为语义召回的对标书拆解资产，可借鉴其叙事节奏、情绪曲线与表达手法，但情节/人物/设定必须原创适配，严禁直接搬运原作内容。`);
      }
    }

    // 成长高光联动（B1+B2）：本章阶段跃迁/关键节点 → 定向召回的高光时刻参考
    if (context.growthHighlights?.length) {
      userParts.push(`\n【成长高光时刻参考 - 阶段跃迁/关键节点须重点渲染】`);
      for (const gh of context.growthHighlights) {
        const who = gh.characterName || `人物${gh.characterId ?? ''}`;
        const trans = gh.fromStage ? `${who}从「${gh.fromStage}」迈入「${gh.toStage}」` : `${who}进入「${gh.toStage}」阶段`;
        const keyTag = gh.isKeyNode ? '（作者标记·关键节点）' : '';
        userParts.push(`◆ 本章${trans}${keyTag}，这是人物弧光的重要时刻，可参考以下高光写法：`);
        if (!gh.highlights.length) {
          userParts.push(`  （暂无匹配高光素材，请着力刻画这一转变的内在张力与外在表现）`);
          continue;
        }
        for (const h of gh.highlights) {
          userParts.push(`  - ${h.title}：${h.corePlot}`);
          if (h.emotionalBeat) userParts.push(`    情绪线：${h.emotionalBeat}`);
        }
      }
      userParts.push(`要求：阶段跃迁/关键节点是人物弧光的支点，须给出有分量的呈现（突破/觉醒/升华的内外刻画），不可一笔带过。`);
    }

    // 成长弧光三向联动：阶段跃迁×影响数值 + 关系升华×关系状态
    if (context.growthLinkageContext?.text) {
      userParts.push(`\n【成长弧光联动 - 阶段与数值/关系的交叉呈现】`);
      userParts.push(context.growthLinkageContext.text);
    }

    // 分支影响体系：人物当前数值/状态 + 世界当前状态（与系统侧【影响铁律】呼应，数值唯一权威）
    if (context.impactContext?.characterBlocks?.length) {
      userParts.push(`\n【人物当前状态 - 数值体系唯一权威，必须严格一致】`);
      for (const cb of context.impactContext.characterBlocks) {
        userParts.push(`◆ ${cb.characterName}：${cb.text}`);
      }
    }
    if (context.impactContext?.worldBlock) {
      userParts.push(`\n【世界当前状态 - 数值体系唯一权威，必须严格一致】`);
      userParts.push(context.impactContext.worldBlock);
    }

    // 阶段4：人物关系状态（出场人物两两关系维度，对话亲疏/态度的参照）
    if (context.relationContext?.text) {
      userParts.push(`\n【人物关系状态 - 对话态度与亲疏参照】`);
      userParts.push(context.relationContext.text);
      userParts.push(`对话语气、称呼、态度须与上述关系维度匹配，禁止关系冷淡却言语亲昵或反之。`);
    }

    // v1.4 PRD-A：角色声音配置（注入式，受 characterVoiceEnabled 开关控制，取数端已把关）
    if (context.voiceContext?.text) {
      userParts.push(`\n【人物声音特征 - 每个角色的对白必须带有其专属辨识度】`);
      userParts.push(context.voiceContext.text);
      userParts.push(`要求：各角色对白须严格贴合上述声音特征，口癖/称呼/语气不得串角色；遮住名字也能通过说话方式分辨是谁在说话；禁用表达绝对不得出现。`);
    }

    // v1.4 PRD-A：角色已知信息清单（信息差写作参照，受 characterKnowledgeEnabled 开关控制）
    if (context.knowledgeContext?.text) {
      userParts.push(`\n【人物已知信息清单 - 信息差写作铁律】`);
      userParts.push(context.knowledgeContext.text);
      userParts.push(`要求：角色的言行/心理只能基于其已知信息；角色不得说出或表现出清单之外的事实（尤其是他人秘密/幕后真相）；可利用人物间信息差制造误会、悬念与反转，但越界知情属于硬伤。`);
    }

    // 二期RAG：领域知识参考（语义召回的专业知识，保证细节不外行）
    if (context.domainKnowledge?.length) {
      userParts.push(`\n【领域知识参考 - 确保专业细节准确】`);
      for (const d of context.domainKnowledge) {
        userParts.push(`- [${d.knowledgeType}${d.applicableDomain ? '·' + d.applicableDomain : ''}] ${d.title}：${d.content}`);
      }
      userParts.push(`涉及上述领域时，细节须符合专业知识，不可外行臆造。`);
    }

    // 二期RAG：参考文风预设（蒸馏自其他作者的文风，参考而非覆盖）
    if (context.stylePresetRag) {
      const sp = context.stylePresetRag;
      userParts.push(`\n【参考文风预设 - ${sp.styleName}${sp.author ? '（' + sp.author + '）' : ''}，仅作风格参考】`);
      if (sp.mentalModels?.length) userParts.push(`创作心智: ${sp.mentalModels.slice(0, 4).join('；')}`);
      if (sp.coreImagery?.length) userParts.push(`意象参考: ${sp.coreImagery.slice(0, 6).join('、')}`);
      if (sp.descriptionRatio) {
        const r = sp.descriptionRatio;
        const pct = (n?: number) => (n != null ? Math.round(n * 100) + '%' : '?');
        userParts.push(`节奏参考: 场景${pct(r.scene)}/动作${pct(r.action)}/对话${pct(r.dialogue)}/心理${pct(r.psychology)}`);
      }
      if (sp.antiPatterns?.length) userParts.push(`可借鉴的反模式规避: ${sp.antiPatterns.slice(0, 3).join('；')}`);
      userParts.push(`注意：本书主文风以上方【作者风格铁律】为准，此处仅为辅助参考，不得喧宾夺主。`);
    }

    // 写作指令
    userParts.push(`\n【写作要求】`);
    userParts.push(`1. 直接输出正文，不要加标题、章节号或任何元信息`);
    userParts.push(`2. 字数控制在${chapterPlan.targetWordCount}字左右`);
    userParts.push(`3. 确保人物言行符合其性格设定`);
    userParts.push(`4. 确保功法、法宝、地点等设定与上述资料一致`);
    userParts.push(`5. 情节推进要自然，不要突兀转折`);
    userParts.push(`6. 章末必须停在"变化发生的那一拍"（局势变化/关系偏移/半揭露/关键决定），禁止以总结、抒情、讲道理收束`);

    const userPrompt = userParts.join('\n');

    return { systemPrompt, userPrompt };
  }

  /**
   * 把风格上下文序列化为系统提示的风格铁律文本行
   * （禁用词由【严禁使用的词汇和表达】块统一处理，此处不重复）
   */
  private buildStyleBlock(style: NonNullable<ContextPackage['style']>): string[] {
    const parts: string[] = [];
    parts.push(`\n【作者风格铁律${style.styleName ? ' - ' + style.styleName : ''}】（必须严格内化遵守）`);

    if (style.coreImagery?.length) {
      parts.push(`核心意象（描写时优先化用，营造统一氛围）: ${style.coreImagery.join('、')}`);
    }
    if (style.descriptionRatio) {
      const r = style.descriptionRatio;
      const pct = (n?: number) => (n != null ? Math.round(n * 100) + '%' : '?');
      parts.push(
        `描写比例（偏差控制在±15%内）: 场景${pct(r.scene)} / 动作${pct(r.action)} / 对话${pct(r.dialogue)} / 心理${pct(r.psychology)}`
      );
    }
    if (style.sentenceRules && Object.keys(style.sentenceRules).length) {
      parts.push('句式规则:');
      for (const [k, v] of Object.entries(style.sentenceRules)) {
        parts.push(`- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      }
    }
    if (style.perspectiveRules?.length) {
      parts.push('视角规则:');
      style.perspectiveRules.forEach((r) => parts.push(`- ${r}`));
    }
    if (style.antiPatterns?.length) {
      parts.push('反模式（严禁的写法）:');
      style.antiPatterns.forEach((r) => parts.push(`- ${r}`));
    }
    if (style.mentalModels?.length) {
      parts.push('作者心智模型（创作时内化）:');
      style.mentalModels.forEach((r) => parts.push(`- ${r}`));
    }
    if (style.decisionHeuristics?.length) {
      parts.push(`决策启发: ${style.decisionHeuristics.join('、')}`);
    }
    if (style.matchedSceneFlavor?.length) {
      parts.push(`本章情绪笔触: ${style.matchedSceneFlavor.join('；')}`);
    }
    return parts;
  }

  /**
   * 推断小说类型
   */
  private inferGenre(context: ContextPackage): string {
    // 根据上下文中的元素推断类型
    if (context.skills.length > 0 || context.characters.some((c) => c.realm)) {
      return '仙侠/玄幻';
    }
    return '玄幻';
  }
}

export const writerAgent = new WriterAgent();
