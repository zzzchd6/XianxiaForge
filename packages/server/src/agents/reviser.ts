/**
 * 修订Agent - 根据审计报告修订章节内容
 * 仅处理severity为critical/major的issues
 */
import { BaseAgent } from './base.js';
import type { AuditReport, ContextPackage, LlmConfig, RevisionResult, StyleIssue } from '../types.js';
import type { ChatOptions, UsageInfo } from '../llm/client.js';

export class ReviserAgent extends BaseAgent {
  constructor() {
    super('ReviserAgent');
  }

  /**
   * 修订主方法
   */
  async reviseChapter(
    content: string,
    auditReport: AuditReport,
    context: ContextPackage,
    llmConfig?: LlmConfig,
    onUsage?: (usage: UsageInfo, model: string) => void
  ): Promise<RevisionResult> {
    // 筛选需要处理的问题（仅critical和major）
    const actionableIssues = auditReport.issues.filter(
      (issue) => issue.severity === 'critical' || issue.severity === 'major'
    );

    if (actionableIssues.length === 0) {
      this.log('无需修订的问题，跳过修订步骤');
      return {
        revisedContent: content,
        revisionNotes: ['无需修订，所有问题均为minor级别'],
      };
    }

    this.log(`开始修订，需处理${actionableIssues.length}个问题...`);

    const { systemPrompt, userPrompt } = this.buildRevisionPrompt(
      content,
      actionableIssues,
      context
    );
    const messages = this.buildMessages(systemPrompt, userPrompt);

    const options: ChatOptions = {
      temperature: 0.7,
      maxTokens: 8192,
      configOverride: llmConfig,
      onUsage,
    };

    const response = await this.callWithRetry(messages, options);

    // 解析修订结果
    const result = this.parseRevisionResponse(response, content);
    this.log(`修订完成，修订说明: ${result.revisionNotes.join('; ')}`);

    return result;
  }

  /**
   * 对话式修订：用户输入自然语言指令，可选附带选中文字作为重点提示
   */
  async reviseWithInstruction(
    content: string,
    instruction: string,
    selectedText?: string,
    context?: ContextPackage,
    llmConfig?: LlmConfig,
    onUsage?: (usage: UsageInfo, model: string) => void
  ): Promise<RevisionResult> {
    this.log(`对话式修订，指令: ${instruction.slice(0, 50)}...`);

    const systemPrompt = `你是一位资深小说编辑，负责根据作者的修改指令修订小说章节。

修订原则：
1. 严格按照作者指令修改，不要擅自改动指令未涉及的内容
2. 保持原文的文风、叙事节奏和语言质感
3. 修改后不得引入本书禁用词
4. 确保修改后的人物言行符合设定、情节与前文连贯
5. 如果指令涉及选中段落，重点修改该段落，但允许对上下文做必要的衔接调整

输出格式：
先输出修订说明（每行一条，以"- "开头），然后空一行，输出"【修订正文】"标记，之后输出完整的修订后正文。`;

    const userParts: string[] = [];
    userParts.push('【原文】');
    userParts.push(content);

    userParts.push('\n【修改指令】');
    userParts.push(instruction);

    // R3: 检测指令中是否涉及去AI味八分型，自动追加定向改写策略
    const aiTypes = ['empty_summary', 'cliche_atmosphere', 'adjective_stack', 'explanatory_dialogue', 'uniform_rhythm', 'cliche_metaphor', 'parallel_padding', 'psych_overload'];
    const detectedTypes = aiTypes.filter((t) => instruction.includes(t));
    if (detectedTypes.length) {
      userParts.push('\n【去AI味定向改写策略（必须执行）】');
      userParts.push(this.buildAntiAiRevisionInstruction(detectedTypes));
    }

    if (selectedText && selectedText.trim()) {
      userParts.push('\n【重点修改段落（作者选中）】');
      userParts.push(selectedText.trim());
      userParts.push('（请重点修改以上段落，其余部分除非指令明确要求否则保持不变）');
    }

    // 设定参照（如果有上下文）
    if (context) {
      const refs: string[] = [];
      if (context.characters.length > 0) {
        refs.push('人物设定:');
        for (const c of context.characters) {
          const parts = [c.name];
          if (c.personality) parts.push(`性格: ${c.personality}`);
          if (c.faction) parts.push(`门派: ${c.faction}`);
          refs.push(`- ${parts.join('，')}`);
        }
      }
      if (context.style?.forbiddenWords?.length) {
        refs.push(`禁用词（修订后不得出现）: ${context.style.forbiddenWords.join('、')}`);
      }
      if (refs.length > 0) {
        userParts.push('\n【设定参照】');
        userParts.push(...refs);
      }
    }

    userParts.push('\n请输出修订说明和修订后的完整正文。');

    const messages = this.buildMessages(systemPrompt, userParts.join('\n'));
    const options: ChatOptions = {
      temperature: 0.7,
      maxTokens: 8192,
      configOverride: llmConfig,
      onUsage,
    };

    const response = await this.callWithRetry(messages, options);
    const result = this.parseRevisionResponse(response, content);
    this.log(`对话式修订完成: ${result.revisionNotes.join('; ')}`);
    return result;
  }

  /**
   * 构建修订prompt
   */
  private buildRevisionPrompt(
    content: string,
    issues: AuditReport['issues'],
    context: ContextPackage
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `你是一位资深小说编辑，负责修订AI生成的小说章节。你需要根据审查报告中指出的问题进行精准修改。

修订原则：
1. 只修改有问题的部分，保持其他优秀内容不变
2. 修改时保持原文的文风和叙事节奏，且修订后不得引入本书禁用词
3. 确保修改后的人物言行符合设定
4. 确保修改后的情节与前文连贯
5. 不要引入新的问题

修订优先级（从高到低，底层没修好不许动表层）：
1. 剧情逻辑层（动机/触发/决策/后果/兑现）
2. 人物一致性层（目标/情绪/关系/身体/声音）
3. 场景与转场层（衔接、节奏、场景有效性）
4. 对白张力层（关系压力、人物声音、信息嵌入）
5. 章末收束层（钩子、余韵、承接）
6. 文风与去AI味层（空泛、套话、同质化）
禁止把结构问题误修成文风问题。

对白问题修订策略（当问题涉及对白张力时执行）：
1. 先压关系和利益：给每句对白加具体刀口（立场/条件/后果/最后通牒）
2. 再拆人物声音：上位者用短句判断句少解释；下位者试探留余地借规矩说话；情绪激动者断句重复被打断
3. 最后删空话：删掉"你太过分了"这类无刀口句子，换成动作或停顿

输出格式：
先输出修订说明（每行一条，以"- "开头），然后空一行，输出"【修订正文】"标记，之后输出完整的修订后正文。

示例：
- 修正了张三的性格描写，使其更符合"沉稳内敛"的设定
- 调整了与李四的关系描写，从"师徒"改为"同门师兄弟"

【修订正文】
（完整修订后的章节正文）`;

    const userParts: string[] = [];

    userParts.push('【原文】');
    userParts.push(content);

    userParts.push('\n【需要修改的问题】');
    issues.forEach((issue, i) => {
      userParts.push(`${i + 1}. [${issue.severity}] ${issue.dimension}: ${issue.description}`);
      userParts.push(`   修改建议: ${issue.suggestion}`);
    });

    // 提供相关设定作为修订参照
    userParts.push('\n【设定参照（修订时确保一致）】');

    if (context.characters.length > 0) {
      userParts.push('人物设定:');
      for (const c of context.characters) {
        const parts = [c.name];
        if (c.personality) parts.push(`性格: ${c.personality}`);
        if (c.faction) parts.push(`门派: ${c.faction}`);
        if (c.coreSkills?.length) parts.push(`能力: ${c.coreSkills.join('、')}`);
        userParts.push(`- ${parts.join('，')}`);
      }
    }

    if (context.relations.length > 0) {
      userParts.push('人物关系:');
      for (const r of context.relations) {
        userParts.push(`- 人物${r.charAId} 与 人物${r.charBId}: ${r.relType}`);
      }
    }

    if (context.skills.length > 0) {
      userParts.push('功法设定:');
      for (const s of context.skills) {
        userParts.push(`- ${s.name}: ${s.coreEffect || ''}`);
      }
    }

    if (context.items.length > 0) {
      userParts.push('法宝设定:');
      for (const i of context.items) {
        userParts.push(`- ${i.name}: ${i.coreAbilities || ''}`);
      }
    }

    // 风格参照（避免修订时引入禁用词或破坏比例）
    if (context.style) {
      const s = context.style;
      userParts.push('风格参照:');
      if (s.forbiddenWords?.length) {
        userParts.push(`- 禁用词（修订后不得出现）: ${s.forbiddenWords.join('、')}`);
      }
      if (s.descriptionRatio) {
        const pct = (n?: number) => (n != null ? Math.round(n * 100) + '%' : '?');
        userParts.push(
          `- 目标描写比例: 场景${pct(s.descriptionRatio.scene)} / 动作${pct(s.descriptionRatio.action)} / 对话${pct(s.descriptionRatio.dialogue)} / 心理${pct(s.descriptionRatio.psychology)}`
        );
      }
    }

    userParts.push('\n请输出修订说明和修订后的完整正文。');

    return { systemPrompt, userPrompt: userParts.join('\n') };
  }

  /**
   * R3: 去AI味五分型定向改写指令生成
   * 根据命中的 aiFlavorType 生成对应的改写策略文本
   */
  private buildAntiAiRevisionInstruction(types: string[]): string {
    const typeMap: Record<string, string> = {
      empty_summary: '空泛总结型：把所有"心中五味杂陈""感慨万千"这类总结句，改成具体的身体动作、手势、停顿或物件变化。',
      cliche_atmosphere: '套话氛围型：删掉"空气凝固""气氛微妙"这类套话，换成场内某个人的动作变化（停住、后退、沉默）或某个声音的变化。',
      adjective_stack: '形容词堆叠型：删掉一半以上的形容词标签，用一个具体动作来立住人物感觉。\n【明喻密度铁律】每千字明喻不超过5个。',
      explanatory_dialogue: '解释腔对白型：人物对话不要讲解设定，要让他们说立场、说条件、说后果、说最后通牒。\n【"不是A是B"铁律】每章最多保留1处，其余改为动作描写或复杂心理活动。',
      uniform_rhythm: '平均工整型：打破句子的平均长度，高压处用短句，关键处用截断，不要每句都完整。\n【跨章铁律】连续章节开头结构必须不同：环境/对话/动作/内心独白至少各来一次，禁止多章同类开头。',
      cliche_metaphor: '比喻陈词滥调：删掉"眼睛像星星""心如刀绞"这类被用滥的比喻，换成角色独有的、带体温的感官描写。\n【明喻铁律】同一意象全书只能出现1次；明喻总量减少50%，改用借代、通感或白描。',
      parallel_padding: '排比堆砌：砍掉缺乏逻辑递进的排比段，保留最有力的一句，其余改为动作或留白。',
      psych_overload: '大段心理分析：紧张/战斗场景中删除长段心理独白，改为感官碎片（痛觉、声音、气味、视野收窄）。',
    };
    return types.map((t) => typeMap[t] || '').filter(Boolean).join('\n');
  }

  /**
   * 解析修订响应
   */
  private parseRevisionResponse(response: string, originalContent: string): RevisionResult {
    const revisionNotes: string[] = [];
    let revisedContent = originalContent;

    // 查找【修订正文】标记
    const markerIndex = response.indexOf('【修订正文】');
    if (markerIndex !== -1) {
      // 提取修订说明（标记之前的内容）
      const notesSection = response.slice(0, markerIndex).trim();
      const noteLines = notesSection.split('\n').filter((line) => line.trim().startsWith('- '));
      for (const line of noteLines) {
        revisionNotes.push(line.replace(/^-\s*/, '').trim());
      }

      // 提取修订正文（标记之后的内容）
      revisedContent = response.slice(markerIndex + '【修订正文】'.length).trim();
    } else {
      // 没有标记，尝试其他解析方式
      // 查找第一个空行之后的内容作为正文
      const paragraphs = response.split('\n\n');
      if (paragraphs.length >= 2) {
        // 第一段作为修订说明
        const noteLines = paragraphs[0].split('\n').filter((line) => line.trim().startsWith('- '));
        for (const line of noteLines) {
          revisionNotes.push(line.replace(/^-\s*/, '').trim());
        }
        // 其余作为正文
        revisedContent = paragraphs.slice(1).join('\n\n').trim();
      } else {
        // 无法解析，将整个响应作为修订内容
        revisedContent = response.trim();
        revisionNotes.push('修订完成（自动解析）');
      }
    }

    if (revisionNotes.length === 0) {
      revisionNotes.push('修订完成');
    }

    return { revisedContent, revisionNotes };
  }

  /**
   * 精修初稿压缩（天命P2#8 Ore Foundry 第二阶段）
   * 将扩展初稿（4500-5500字）压缩到目标字数（3500-4000字）
   * 启用凝练语言戒律：动词优先、去冗余副词、合并段落
   */
  async condenseToTarget(
    oreContent: string,
    targetWordCount: number,
    llmConfig?: LlmConfig,
    onUsage?: (usage: UsageInfo, model: string) => void
  ): Promise<{ content: string; notes: string[] }> {
    const currentLen = oreContent.length;
    if (currentLen <= targetWordCount * 1.1) {
      this.log(`初稿${currentLen}字已接近目标${targetWordCount}字，无需压缩`);
      return { content: oreContent, notes: ['字数已达标，跳过压缩'] };
    }

    this.log(`开始精修压缩：${currentLen}字 → 目标${targetWordCount}字...`);

    const systemPrompt = `你是一位精通「凝练语言戒律」的小说编辑。你的任务是将一篇扩展初稿压缩到目标字数，同时保留所有情节内核。

【凝练语言戒律】
1. 动词优先：用一个精准强力的动词，取代平庸动词+副词的组合
   反例：他非常快速地跑了过去 → 正例：他冲了过去
2. 反问替代陈述：多用反问句加强语气、制造悬念
   反例：这件事不可能成功 → 正例：这种事，怎么可能成？
3. 去冗余：删除重复表达、无信息量的过渡句、凑字副词（非常/十分/相当/极其）
4. 合并段落：将碎片化的短段合并为有节奏感的段落
5. 感官优先：保留具体的感官描写，删除抽象的心理分析

【铁律】
- 不得删除任何情节事件、对话核心、人物动作
- 不得改变情节走向和人物关系
- 保留所有伏笔线索和章末钩子
- 压缩后字数控制在 ${targetWordCount} 字左右（±10%）

输出格式：
先列出压缩说明（每行以"- "开头），然后输出【压缩正文】标记，之后是压缩后的完整正文。`;

    const userPrompt = `【目标字数】${targetWordCount}字（当前${currentLen}字，需压缩约${currentLen - targetWordCount}字）

【扩展初稿】
${oreContent}`;

    const messages = this.buildMessages(systemPrompt, userPrompt);
    const options: ChatOptions = {
      temperature: 0.5,
      maxTokens: 8192,
      configOverride: llmConfig,
      onUsage,
    };

    const response = await this.callWithRetry(messages, options);

    // 解析
    const notes: string[] = [];
    let content = oreContent;
    const marker = '【压缩正文】';
    const markerIdx = response.indexOf(marker);
    if (markerIdx !== -1) {
      const notesSection = response.slice(0, markerIdx).trim();
      for (const line of notesSection.split('\n')) {
        if (line.trim().startsWith('- ')) notes.push(line.replace(/^-\s*/, '').trim());
      }
      content = response.slice(markerIdx + marker.length).trim();
    } else {
      content = response.trim();
      notes.push('压缩完成（自动解析）');
    }

    if (notes.length === 0) notes.push('压缩完成');
    this.log(`精修压缩完成：${content.length}字`);
    return { content, notes };
  }
}

export const reviserAgent = new ReviserAgent();
