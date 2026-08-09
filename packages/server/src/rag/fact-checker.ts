/**
 * 硬性事实校验器（零 token，确定性规则）
 * 从生成文本中检测与已确认事实矛盾的表述：
 * - 人称-性别矛盾（男性人物出现"她"，或反之）
 * - 时间数字矛盾（正文时间表述与时间锚点冲突）
 * - 境界词矛盾（正文境界描述与确认状态不一致）
 */
import type { HardFactsContext } from '../types.js';

export interface FactViolation {
  type: 'pronoun_gender' | 'time_number' | 'realm_mismatch';
  severity: 'critical' | 'major';
  message: string;
  /** 违规原文片段 */
  excerpt: string;
}

export interface FactCheckResult {
  violations: FactViolation[];
  count: number;
}

// ============================================================
// 中文数字 → 阿拉伯数字
// ============================================================
const CN_DIGITS: Record<string, number> = {
  '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
  '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20,
  '三十': 30, '四十': 40, '五十': 50, '六十': 60, '七十': 70,
  '八十': 80, '九十': 90, '百': 100,
};

function chineseToNumber(cn: string): number | null {
  if (!cn) return null;
  // 直接匹配
  if (CN_DIGITS[cn] !== undefined) return CN_DIGITS[cn];
  // 处理 "X十Y" 格式（如 二十三 = 23）
  const shiMatch = cn.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (shiMatch) {
    const tens = shiMatch[1] ? (CN_DIGITS[shiMatch[1]] ?? 1) : 1;
    const ones = shiMatch[2] ? (CN_DIGITS[shiMatch[2]] ?? 0) : 0;
    return tens * 10 + ones;
  }
  // 阿拉伯数字
  const num = parseInt(cn, 10);
  return isNaN(num) ? null : num;
}

// ============================================================
// 1. 人称-性别校验
// ============================================================

// ---- 引号区间工具（15-SRS P1-1：对话内出现不计入校验，防误报） ----
const QUOTE_PAIRS: Array<[string, string]> = [
  ['“', '”'], ['‘', '’'], ['「', '」'], ['『', '』'], ['"', '"'],
];

/** 扫描正文中的引号包裹区间，返回 [start, end) 数组（未闭合引号丢弃） */
export function buildQuoteRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const [open, close] of QUOTE_PAIRS) {
    let from = 0;
    while (true) {
      const s = content.indexOf(open, from);
      if (s < 0) break;
      const e = content.indexOf(close, s + open.length);
      if (e < 0) break;
      ranges.push([s, e + close.length]);
      from = e + close.length;
    }
  }
  return ranges;
}

/** 判断某位置是否落在引号区间内 */
export function isIndexQuoted(ranges: Array<[number, number]>, idx: number): boolean {
  return ranges.some(([s, e]) => idx >= s && idx < e);
}

/**
 * 检测正文中人称代词与人物性别的矛盾。
 * 策略一（兜底）：全场全男不应出现"她"（反之亦然）；混合性别时跳过。
 * 策略二（15-SRS P1-1 人名锚定）：对每个有 gender 的人物，扫描"人物名后 12 字内
 * 出现相反代词"→ critical；引号内对话跳过。两策略并行，混合性别场景不再盲区。
 */
export function checkPronounGender(
  content: string,
  facts: HardFactsContext['characterFacts']
): FactViolation[] {
  const violations: FactViolation[] = [];
  const withGender = facts.filter(f => f.gender);
  if (!withGender.length) return violations;

  const allMale = withGender.every(f => f.gender === 'male');
  const allFemale = withGender.every(f => f.gender === 'female');

  if (allMale) {
    // 所有出场人物都是男性，不应出现"她"
    const matches = content.match(/她/g);
    if (matches && matches.length > 0) {
      // 找到第一个"她"的上下文
      const idx = content.indexOf('她');
      const excerpt = content.slice(Math.max(0, idx - 10), idx + 11);
      violations.push({
        type: 'pronoun_gender',
        severity: 'critical',
        message: `所有出场人物均为男性（${withGender.map(f => f.name).join('、')}），但正文出现"${matches.length}个"她"`,
        excerpt,
      });
    }
  } else if (allFemale) {
    const matches = content.match(/他/g);
    if (matches && matches.length > 0) {
      const idx = content.indexOf('他');
      const excerpt = content.slice(Math.max(0, idx - 10), idx + 11);
      violations.push({
        type: 'pronoun_gender',
        severity: 'critical',
        message: `所有出场人物均为女性（${withGender.map(f => f.name).join('、')}），但正文出现${matches.length}个"他"`,
        excerpt,
      });
    }
  }
  // 混合性别：兜底策略不校验（无法确定指代），但人名锚定策略仍生效（见下）

  // ---- 人名锚定校验（15-SRS P1-1）：名字后 12 字内出现相反代词 → critical ----
  const quoteRanges = buildQuoteRanges(content);
  const seen = new Set<string>();
  for (const f of withGender) {
    if (!f.name || f.name.length < 2) continue;
    const wrongPronoun = f.gender === 'male' ? '她' : '他';
    const correctPronoun = f.gender === 'male' ? '他' : '她';
    let from = 0;
    let hitCount = 0;
    let firstExcerpt = '';
    while (true) {
      const idx = content.indexOf(f.name, from);
      if (idx < 0) break;
      from = idx + f.name.length;
      if (isIndexQuoted(quoteRanges, idx)) continue; // 名字本身在对话内（提及他人）不判
      const window = content.slice(idx + f.name.length, idx + f.name.length + 12);
      const wrongIdx = window.indexOf(wrongPronoun);
      if (wrongIdx < 0) continue;
      // 排除：相反代词之前已先出现正确代词（指代可能是另一人，防误报）
      const before = window.slice(0, wrongIdx);
      if (before.includes(correctPronoun)) continue;
      hitCount++;
      if (!firstExcerpt) firstExcerpt = content.slice(idx, idx + f.name.length + wrongIdx + 6);
      if (hitCount >= 3) break; // 同一人物最多报一条，上下文取首例
    }
    if (hitCount > 0) {
      const key = `anchored:${f.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        violations.push({
          type: 'pronoun_gender',
          severity: 'critical',
          message: `${f.name}确认性别为${f.gender === 'male' ? '男' : '女'}（应用"${correctPronoun}"），但名字后出现相反代词"${wrongPronoun}"（${hitCount}处）`,
          excerpt: firstExcerpt,
        });
      }
    }
  }

  return violations;
}

// ============================================================
// 2. 时间数字校验
// ============================================================
/** 时间表述正则：X年前 / X年来了 / 来了X年 / 待了X年 / X年 / 过了X年 */
const TIME_PATTERNS: RegExp[] = [
  /([一二两三四五六七八九十百\d]+)\s*年前/g,
  /([一二两三四五六七八九十百\d]+)\s*年来了/g,
  /来了\s*([一二两三四五六七八九十百\d]+)\s*年/g,
  /待了\s*([一二两三四五六七八九十百\d]+)\s*年/g,
  /过了\s*([一二两三四五六七八九十百\d]+)\s*年/g,
  /([一二两三四五六七八九十百\d]+)\s*年了/g,
];

/**
 * 检测正文中的时间数字表述是否与时间锚点矛盾。
 * 策略：从时间锚点标题中提取数字（如"七年前上山"→7），
 * 如果正文出现不同的时间数字（如"三年"），报 critical。
 * 容差：允许模糊表述（"数月""数日""几年"），只校验明确数字。
 */
export function checkTimeNumbers(
  content: string,
  timeAnchors: HardFactsContext['timeAnchors']
): FactViolation[] {
  const violations: FactViolation[] = [];
  if (!timeAnchors.length) return violations;

  // 从锚点标题/时间中提取关键数字
  const anchorNumbers: Array<{ value: number; source: string }> = [];
  for (const anchor of timeAnchors) {
    const text = `${anchor.storyTime ?? ''} ${anchor.title}`;
    for (const pattern of TIME_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(text)) !== null) {
        const num = chineseToNumber(m[1]);
        if (num && num >= 2) { // 忽略"一年"（太模糊）
          anchorNumbers.push({ value: num, source: anchor.title });
        }
      }
    }
  }

  if (!anchorNumbers.length) return violations;

  // 扫描正文中的时间表述
  for (const pattern of TIME_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(content)) !== null) {
      const num = chineseToNumber(m[1]);
      if (!num || num < 2) continue;
      // 检查是否与任何锚点数字矛盾（允许相等，不允许不等）
      const conflicting = anchorNumbers.find(a => a.value !== num);
      if (conflicting) {
        const excerpt = content.slice(Math.max(0, m.index - 5), m.index + m[0].length + 5);
        violations.push({
          type: 'time_number',
          severity: 'critical',
          message: `正文时间"${m[0]}"与时间锚点"${conflicting.source}"（${conflicting.value}年）矛盾`,
          excerpt,
        });
      }
    }
  }

  // 去重（同一数字可能命中多个 pattern）
  const seen = new Set<string>();
  return violations.filter(v => {
    const key = v.message;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================
// 3. 境界词校验
// ============================================================
/** 已知境界体系（从低到高；15-SRS P2-1 亦用作 realm 倒退判定默认序列） */
export const REALM_HIERARCHY = [
  '练气', '炼气', '筑基', '金丹', '元婴', '化神',
  '炼虚', '合体', '大乘', '渡劫', '仙人',
];

/**
 * 检测正文中的境界描述是否与确认状态矛盾。
 * 策略：如果某人确认境界是"筑基"，正文不应出现该人物+"金丹"的组合。
 * 简化：只检查"人物名+境界词"的近距离共现。
 */
export function checkRealmConsistency(
  content: string,
  facts: HardFactsContext['characterFacts']
): FactViolation[] {
  const violations: FactViolation[] = [];
  const withRealm = facts.filter(f => f.realm);
  if (!withRealm.length) return violations;

  for (const fact of withRealm) {
    const confirmedRealm = fact.realm!;
    // 找到确认境界在体系中的位置
    const confirmedIdx = REALM_HIERARCHY.findIndex(r => confirmedRealm.includes(r));
    if (confirmedIdx < 0) continue; // 非标准境界名，跳过

    // 扫描正文中该人物名附近是否出现不同境界词
    const namePattern = new RegExp(
      `${escapeRegex(fact.name)}.{0,20}(${REALM_HIERARCHY.join('|')})`,
      'g'
    );
    let m;
    while ((m = namePattern.exec(content)) !== null) {
      const mentionedRealm = m[1];
      const mentionedIdx = REALM_HIERARCHY.indexOf(mentionedRealm);
      if (mentionedIdx >= 0 && mentionedIdx !== confirmedIdx) {
        const excerpt = m[0].slice(0, 30);
        violations.push({
          type: 'realm_mismatch',
          severity: 'critical',
          message: `${fact.name}确认境界为"${confirmedRealm}"，但正文出现"${mentionedRealm}"`,
          excerpt,
        });
      }
    }

    // 反向：境界词+人物名
    const reversePattern = new RegExp(
      `(${REALM_HIERARCHY.join('|')}).{0,10}${escapeRegex(fact.name)}`,
      'g'
    );
    while ((m = reversePattern.exec(content)) !== null) {
      const mentionedRealm = m[1];
      const mentionedIdx = REALM_HIERARCHY.indexOf(mentionedRealm);
      if (mentionedIdx >= 0 && mentionedIdx !== confirmedIdx) {
        const excerpt = m[0].slice(0, 30);
        violations.push({
          type: 'realm_mismatch',
          severity: 'critical',
          message: `${fact.name}确认境界为"${confirmedRealm}"，但正文出现"${mentionedRealm}"`,
          excerpt,
        });
      }
    }
  }

  // 去重
  const seen = new Set<string>();
  return violations.filter(v => {
    const key = `${v.message}|${v.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================
// 综合入口
// ============================================================
/**
 * 运行全部事实校验（零 token，纯正则/规则）
 * @param content 章节正文
 * @param hardFacts 硬约束上下文（从 context-builder 组装）
 */
export function runFactCheck(content: string, hardFacts: HardFactsContext): FactCheckResult {
  const violations: FactViolation[] = [
    ...checkPronounGender(content, hardFacts.characterFacts),
    ...checkTimeNumbers(content, hardFacts.timeAnchors),
    ...checkRealmConsistency(content, hardFacts.characterFacts),
  ];
  return { violations, count: violations.length };
}

// ============================================================
// 工具函数
// ============================================================
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
