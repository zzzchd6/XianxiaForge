/**
 * 去AI味本地检测器（零 token，确定性规则）
 * 对应 Lorn 13项量化指标中的可规则化部分：
 * - 句法层：元叙述、句首重复、句式均匀度
 * - 设定层：抽象判断词、填充短语
 * - 结构层：开头模板化 / "不是A是B"密集 / 明喻密度与重复（PRD v1.1 新增）
 */

/** 章节开头类型（供跨章模板化检测） */
export type OpeningType = 'environment' | 'dialogue' | 'action' | 'monologue' | 'other';

export interface AIFlavorScanResult {
  metaNarrationCount: number;       // 元叙述词命中数
  metaNarrationHits: Array<{ phrase: string; line: number; column: number }>;
  sentenceUniformity: number;       // 句式均匀度（0-1，越高越均匀=越像AI）
  repetitiveStarters: number;       // 句首重复次数
  abstractJudgmentCount: number;    // 抽象判断词数量
  fillerPhraseCount: number;        // 填充短语数量
  // 天命 AI 指纹黑名单 4 类本地检测
  routineConnectorCount: number;    // 套路化连接词命中数
  universalAdjectiveCount: number;  // 万能形容词命中数
  objectiveStatementCount: number;  // 客观陈述腔命中数
  fillerAdverbCount: number;        // 凑字副词命中数
  signatureHits: Array<{ phrase: string; category: string; line: number }>; // 详细命中
  overallLevel: 'green' | 'yellow' | 'red';
  // PRD v1.1 新增：结构层检测
  notAButBCount: number;            // "不是A是B"句式命中数
  notAButBHits: Array<{ phrase: string; line: number }>;
  simileCount: number;              // 明喻总数
  simileImageries: Array<{ imagery: string; phrase: string; line: number }>; // 明喻意象清单（供跨章去重）
}

// 元叙述检测词（上帝视角、解释腔）
const META_NARRATION_PHRASES = [
  '他心想', '他暗道', '他暗自想到', '他心里想',
  '值得一提的是', '需要指出的是', '值得注意的是',
  '不得不说', '可以说', '总而言之', '综上所述',
  '仿佛整个世界', '似乎一切都',
];

// 抽象判断词（AI 喜欢直接下结论而非通过描写呈现）
const ABSTRACT_JUDGMENT_WORDS = [
  '不禁', '竟然', '居然', '恍然大悟', '豁然开朗',
  '不由得', '情不自禁', '顿时', '立刻', '瞬间',
];

// 填充短语（无实质信息的过渡词）
const FILLER_PHRASES = [
  '然而', '仿佛', '似乎', '宛如', '犹如',
  '一抹', '一丝', '一缕', '淡淡', '缓缓', '轻轻', '微微',
];

// ===== 天命 AI 指纹黑名单（4 类本地精确匹配） =====

// 1. 套路化连接词（过分书面化的衔接）
const ROUTINE_CONNECTORS = [
  '与此同时', '众所周知', '无独有偶', '换言之',
  '不仅', '而且', '综上所述', '值得一提的是',
  '由此可见', '总而言之', '归根结底', '一言以蔽之',
];

// 2. 万能形容词（缺乏具体指向、可套在任何场景）
const UNIVERSAL_ADJECTIVES = [
  '无与伦比', '美轮美奂', '叹为观止', '举世瞩目',
  '淋漓尽致', '蔚为壮观', '气势磅礴', '震撼人心',
  '惊心动魄', '荡气回肠', '不可思议', '匪夷所思',
];

// 3. 客观陈述腔（上帝视角距离感句式）
const OBJECTIVE_STATEMENTS = [
  '需要注意的是', '不难看出', '显而易见', '可想而知',
  '事实证明', '从某种意义上说', '客观来说', '平心而论',
  '公允地说', '毋庸置疑', '不言而喻', '显而易见的是',
];

// 4. 凑字副词（可被精准动词替代的程度副词）
const FILLER_ADVERBS = [
  '非常', '十分', '相当', '极其', '特别', '格外', '分外', '颇为',
  '极为', '万分', '无比', '异常',
];

/**
 * classifyOpening - 分类章节开头结构类型
 * 取正文第一个非空自然段的首句，按对话/心理/动作/环境分类。
 * 跨章模板化检测用：连续多章同类开头即报警。
 */
export function classifyOpening(content: string): OpeningType {
  const firstLine = content.trim().split('\n').find(l => l.trim().length > 3)?.trim() || '';
  const firstSentence = firstLine.split(/[。！？]/)[0].trim();

  if (/^[「"'""']/.test(firstSentence)) return 'dialogue';
  if (/^(他|她|我)?(心想|暗道|暗自|心中|脑海里)/.test(firstSentence)) return 'monologue';
  if (/^(他|她|我|那|这)?(走|跑|跳|抓|推|拉|拔|冲|蹲|站|转身|飞|拍|踢|挥|甩)/.test(firstSentence)) return 'action';
  if (/^[^\n，。,．.]{1,3}[，,][^\n，。,．.]{1,3}[。．.]$/.test(firstSentence)) return 'environment';
  if (/^(风|雨|云|雾|夜|晨|天|山|水|林|月|日|雪|霜|雷|石|竹|树|草|花|星)/.test(firstSentence)) return 'environment';
  return 'other';
}

export function scanAIFlavor(content: string): AIFlavorScanResult {
  const lines = content.split('\n');
  const hits: Array<{ phrase: string; line: number; column: number }> = [];
  const notAButBHits: Array<{ phrase: string; line: number }> = [];
  const simileImageries: Array<{ imagery: string; phrase: string; line: number }> = [];
  const signatureHits: Array<{ phrase: string; category: string; line: number }> = [];
  let metaCount = 0;
  let abstractCount = 0;
  let fillerCount = 0;
  let routineConnectorCount = 0;
  let universalAdjectiveCount = 0;
  let objectiveStatementCount = 0;
  let fillerAdverbCount = 0;
  let notAButBCount = 0;
  let simileCount = 0;

  const NOT_A_BUT_B_RE = /不是[，。、]?[^，。！？]{0,15}[，,]?\s*是(?!因为|为了|什么)/g;
  const SIMILE_RE = /(?:像|如同|犹如|仿佛|宛如|好像|好似)([^，。！？、\s]{2,6})/g;
  const EXCLUDED_IMAGERY = new Set(['这样', '那样', '什么', '一个', '一种', '如此', '那般', '怎样']);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 1. 元叙述检测
    for (const phrase of META_NARRATION_PHRASES) {
      let idx = 0;
      while ((idx = line.indexOf(phrase, idx)) !== -1) {
        hits.push({ phrase, line: i + 1, column: idx + 1 });
        metaCount++;
        idx += phrase.length;
      }
    }
    // 2. 抽象判断词
    for (const w of ABSTRACT_JUDGMENT_WORDS) {
      abstractCount += (line.match(new RegExp(w, 'g')) || []).length;
    }
    // 3. 填充短语
    for (const p of FILLER_PHRASES) {
      fillerCount += (line.match(new RegExp(p, 'g')) || []).length;
    }
    // 4. 天命·套路化连接词
    for (const w of ROUTINE_CONNECTORS) {
      const cnt = (line.match(new RegExp(w, 'g')) || []).length;
      if (cnt > 0) { routineConnectorCount += cnt; signatureHits.push({ phrase: w, category: '套路化连接词', line: i + 1 }); }
    }
    // 5. 天命·万能形容词
    for (const w of UNIVERSAL_ADJECTIVES) {
      const cnt = (line.match(new RegExp(w, 'g')) || []).length;
      if (cnt > 0) { universalAdjectiveCount += cnt; signatureHits.push({ phrase: w, category: '万能形容词', line: i + 1 }); }
    }
    // 6. 天命·客观陈述腔
    for (const w of OBJECTIVE_STATEMENTS) {
      const cnt = (line.match(new RegExp(w, 'g')) || []).length;
      if (cnt > 0) { objectiveStatementCount += cnt; signatureHits.push({ phrase: w, category: '客观陈述腔', line: i + 1 }); }
    }
    // 7. 天命·凑字副词
    for (const w of FILLER_ADVERBS) {
      const cnt = (line.match(new RegExp(w, 'g')) || []).length;
      if (cnt > 0) { fillerAdverbCount += cnt; signatureHits.push({ phrase: w, category: '凑字副词', line: i + 1 }); }
    }

    // 8. "不是A是B"句式检测（PRD v1.1）
    const notAButBMatches = [...lines[i].matchAll(NOT_A_BUT_B_RE)];
    for (const m of notAButBMatches) {
      notAButBCount++;
      notAButBHits.push({ phrase: m[0], line: i + 1 });
    }

    // 9. 明喻检测（密度 + 意象提取）（PRD v1.1）
    const simileMatches = [...lines[i].matchAll(SIMILE_RE)];
    for (const m of simileMatches) {
      const imagery = (m[1] || '').trim();
      if (EXCLUDED_IMAGERY.has(imagery)) continue;
      simileCount++;
      const dup = simileImageries.find(s => s.imagery === imagery && s.line === i + 1);
      if (!dup) {
        simileImageries.push({ imagery, phrase: m[0], line: i + 1 });
      }
    }
  }

  // 8. 句首重复检测（连续3句以上开头相同模式）
  let repetitiveStarters = 0;
  const sentenceStarters: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 2) {
      sentenceStarters.push(trimmed.slice(0, 3));
    }
  }
  for (let i = 2; i < sentenceStarters.length; i++) {
    if (sentenceStarters[i] === sentenceStarters[i - 1] &&
        sentenceStarters[i] === sentenceStarters[i - 2]) {
      repetitiveStarters++;
    }
  }

  // 9. 句式均匀度（按句号/问号/感叹号拆分，计算句长标准差）
  const sentences = content.split(/[。？！]/).filter(s => s.trim().length > 5);
  let uniformity = 0;
  if (sentences.length > 10) {
    const lengths = sentences.map(s => s.length);
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    uniformity = Math.min(1, stdDev / avg);
    uniformity = 1 - uniformity;
  }

  // 综合评级（天命指纹纳入计分：套路连接词×2 + 万能形容词×3 + 客观陈述腔×2 + 凑字副词/3）
  const signatureFlags = routineConnectorCount * 2 + universalAdjectiveCount * 3
    + objectiveStatementCount * 2 + Math.floor(fillerAdverbCount / 3);
  const totalFlags = metaCount + Math.floor(abstractCount / 3) + repetitiveStarters * 2 + signatureFlags;
  let level: 'green' | 'yellow' | 'red' = 'green';
  if (totalFlags >= 10 || uniformity > 0.8) level = 'red';
  else if (totalFlags >= 5 || uniformity > 0.6) level = 'yellow';

  return {
    metaNarrationCount: metaCount,
    metaNarrationHits: hits,
    sentenceUniformity: Math.round(uniformity * 100) / 100,
    repetitiveStarters,
    abstractJudgmentCount: abstractCount,
    fillerPhraseCount: fillerCount,
    routineConnectorCount,
    universalAdjectiveCount,
    objectiveStatementCount,
    fillerAdverbCount,
    signatureHits,
    overallLevel: level,
    notAButBCount,
    notAButBHits,
    simileCount,
    simileImageries,
  };
}
