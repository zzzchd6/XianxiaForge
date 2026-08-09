/**
 * 仙侠人物判词生成服务（判词Skill）
 * 基于人物完整标签参数，生成仿《红楼梦》薄命司判词风格的四句七言绝句 + 仿警幻情榜二字考语。
 * 流程：标签抽取 → 意象查表 → LLM生成（温度0.3）→ 质量校验（不通过重试一次）→ 降级兜底模板。
 */
import {
  findRaceCategory,
  findRaceSub,
  findPosition,
  findTalentByName,
  type CustomCharacterDraft,
  type InnerPersonality,
} from '@xianxiaforge/shared';
import { chatCompletion } from '../llm/client.js';

export interface VerdictResult {
  /** 四句七言绝句，换行分隔 */
  verdictPoem: string;
  /** 二字考语（核心字+情） */
  verdictComment: string;
  /** 逐句注解（仅前端展示，不入库） */
  annotation?: Record<string, string>;
}

// ─── 意象映射库（对齐需求文档第三章） ─────────────────────────────────────────

/** 立场三档：色调词 + 推荐韵部 */
function stanceTone(stance: number): { label: string; words: string; rhyme: string } {
  if (stance <= 33) return { label: '浩然正气', words: '浩气、丹心、青松、霜节、青天、朗日', rhyme: 'ang、eng（洪亮开阔）' };
  if (stance <= 66) return { label: '随心所欲', words: '不羁、闲云、由心、无拘、浪迹、随性', rhyme: 'ao、ai（舒展随性）' };
  return { label: '邪异诡道', words: '幽途、鬼谋、邪心、暗机、魔焰、寒煞', rhyme: 'u、ou（沉郁幽暗）' };
}

/** 圣体魔躯类天赋 → 古典意象 */
const BODY_IMAGERY: Record<string, string> = {
  人族圣体: '圣胎、天骨、玉骨、灵光躯',
  先天道胎: '道胎、道蕴、先天道韵',
  先天剑骨: '剑骨、剑胎、青锋骨',
  天生魔胎: '魔根、幽骨、邪胎、寒魔髓',
  玄冰玉骨: '冰肌、玉骨、寒髓',
  凤凰灵体: '凤髓、凰韵、火灵根',
  金刚不坏躯: '金刚躯、铁骨、不坏身',
  万毒不侵体: '百毒身、毒骨、不侵躯',
  太阴阳明体: '阴阳脉、双源体',
  五行元素之体: '五行灵根、元素亲和',
};

/** 命格气运类天赋 → 结句意象 */
const DESTINY_IMAGERY: Record<string, string> = {
  天命之子: '天眷、紫气、龙光、天授',
  天煞孤星: '孤星、寒煞、孤影、寡宿',
  潜龙勿用: '蛰龙、潜鳞、藏渊、待时',
  天妒英才: '天妒、才高命蹇、慧极必伤',
  桃花煞: '红鸾劫、情关、尘缘劫',
  财帛星君命: '金气、禄星、富缘',
  谪仙命格: '谪仙、历劫、归位',
  孤辰寡宿: '孤影、独眠、少亲缘',
  霉运缠身: '晦运、蹇途、多磨',
};

/** 功法天赋类 → 行迹意象 */
const SKILL_IMAGERY: Record<string, string> = {
  剑痴: '三尺锋、青锋、剑心',
  丹心灵童: '丹炉、金鼎、药香',
  阵道灵童: '阵图、八卦、九宫',
  御兽宗师: '兽语、驭兽、万兽朝',
  符道天才: '朱笔、符箓、黄纸',
  器道鬼才: '熔炉、锤锻、神兵',
  幻术宗师: '迷障、虚影、幻梦',
  遁术通天: '残影、无迹、千里',
  医道圣手: '银针、百草、仁心',
};

/** 种族大类 → 起句专属意象 */
const RACE_IMAGERY: Record<string, string> = {
  human: '凡尘、凡胎、人身、红尘（如：生在凡尘/凡胎俗骨）',
  demon_race: '妖元、化形、山野、草木精（如：化形山野/本是山林草木精）',
  demon_king_race: '魔气、九幽、域外、煞焰（如：九幽孕气/域外天魔降世尘）',
  ghost_race: '阴魂、尸身、幽冥、阴气（如：魂归幽冥/枯骨修成不坏身）',
  spirit_race: '灵气、精魄、天地产、无垢（如：天地灵气凝为体）',
  divine_race: '神脉、天潢、贵胄、仙根（如：神脉流传天潢胄）',
  hybrid_race: '混血、双脉、异禀、尘缘错（如：双脉同身天赋异）',
};

/** 内在性格 → 心性意象 + 考语候选 */
const INNER_IMAGERY: Record<InnerPersonality, { words: string; comments: string[] }> = {
  无私: { words: '济人、怀天下、舍己', comments: ['济情', '仁情'] },
  正直: { words: '持正、守节、秉公', comments: ['正情', '直情'] },
  中庸: { words: '持中、随和、不争', comments: ['庸情', '和情'] },
  狂邪: { words: '桀骜、恣肆、逆天', comments: ['狂情', '恣情'] },
  利己: { words: '营私、谋身、逐利', comments: ['私情', '己情'] },
  邪恶: { words: '嗜杀、邪佞、惑世', comments: ['邪情', '戾情'] },
};

/** 外在性格 → 行迹细节意象 */
const OUTER_IMAGERY: Record<string, string> = {
  义气: '一诺千金、同袍共死',
  护短: '庇亲如犊、寸心相护',
  孤僻: '寡言独往、避世离群',
  贪权: '手握权柄、心向鼎炉',
  腹黑: '腹藏机锋、笑里藏刀',
  贪财: '孔方留意、利禄营营',
  好酒: '壶中日月、醉里乾坤',
  高冷: '冷面寒霜、寡语少言',
  果决: '杀伐明断、出手如电',
  情种: '情深不寿、尘缘难断',
};

/** 定位 → 归宿意象（结句范式，7字） */
const POSITION_IMAGERY: Record<string, { words: string; examples: string; fallbackLine: string }> = {
  chenjie: { words: '平凡、湮没、随波、归尘', examples: '终作尘沙散入风 / 浮生渺渺似飘蓬', fallbackLine: '终作尘沙散入风' },
  tongtu: { words: '同道、奔波、恩怨、江湖', examples: '江湖路上一相逢 / 同途漫漫各西东', fallbackLine: '同途漫漫各西东' },
  dazhe: { words: '成名、悟道、为师、一方宗主', examples: '名动一方称达者 / 道成身列仙班中', fallbackLine: '名动一方称达者' },
  zhelong: { words: '厚积薄发、一鸣惊人、登临', examples: '蛰起一声惊四海 / 龙飞九天破九重', fallbackLine: '蛰起一声惊四海' },
  tianyou: { words: '逍遥、无迹、传说、世外', examples: '逍遥世外无踪迹 / 天地遨游任去留', fallbackLine: '逍遥世外任去留' },
};

/** 小缺陷 → 暗喻表达（不直白写出，藏入第3或第4句） */
const FLAW_IMAGERY: Record<string, string> = {
  轻度路痴: '歧途常迷、路转难寻',
  酒量极差: '杯酒即醉、不胜杯杓',
  怕黑: '畏向幽昏、夜影难行',
  社恐: '怯对人声、喜静避喧',
  五音不全: '声难成韵、不谙宫商',
  晕船: '畏乘舟楫、怯向波澜',
  囊中羞涩: '阮囊常涩、身少青蚨',
  过目就忘: '过眼成空、记性寻常',
  怕高: '不敢凭高、临崖心惊',
  吃饭挑食: '馔食多拣、五味难周',
  认床难眠: '客枕难安、异乡少梦',
  不会水: '怯于波澜、河海难渡',
  拖延成性: '事常后日、机到方行',
  手工笨拙: '巧于心而拙于手、器不成形',
  记不住人脸: '面目常混、相逢若初',
  易晕车马: '车马难乘、行路好步',
  晚起难醒: '贪眠误旦、日高方起',
  嗜甜如命: '偏嗜甘饴、苦中寻蜜',
  见血头晕: '见红心悸、不耐腥光',
  不辨左右: '东西常错、方位难明',
  认真就输: '较真失先、当局者迷',
  嘴硬心软: '口冷心热、言厉意慈',
  怕毛虫子: '性惧虫豸、芳丛却步',
};

// ─── 标签抽取 + 提示词拼装 ────────────────────────────────────────────────────

/** 按分类拆分天赋：{ body, destiny, skill, origin, flaws } */
function splitTalents(draft: CustomCharacterDraft) {
  const result: Record<string, string[]> = { body: [], destiny: [], skill: [], origin: [], flaws: [] };
  for (const t of draft.talents) {
    const found = findTalentByName(t);
    if (found) (result[found.category.id] ?? (result[found.category.id] = [])).push(t);
    else result.flaws.push(t);
  }
  return result;
}

/** 命中意象则给具体映射，否则给泛化规则提示 */
function imageryLine(name: string, table: Record<string, string>, generalize: string): string {
  return table[name] ? `「${name}」→ 意象：${table[name]}` : `「${name}」→ ${generalize}`;
}

function buildPrompt(draft: CustomCharacterDraft): { system: string; user: string } {
  const category = findRaceCategory(draft.raceCategory);
  const sub = findRaceSub(draft.raceCategory, draft.raceSub);
  const pos = findPosition(draft.position)!;
  const tone = stanceTone(draft.stance);
  const talents = splitTalents(draft);
  const posImg = POSITION_IMAGERY[draft.position];

  const hints: string[] = [];
  // 根骨：圣体魔躯 > 种族小类 > 宿世出身
  for (const t of talents.body) hints.push(imageryLine(t, BODY_IMAGERY, '泛化：取核心字+体/骨/胎，如「紫极蚀雷体」→「雷骨」'));
  hints.push(`种族「${category?.name}·${sub?.name}」→ 大类意象：${RACE_IMAGERY[draft.raceCategory] ?? ''}；小类泛化：用小类名核心字修饰大类意象（如走兽妖→山君化形）`);
  for (const t of talents.origin) hints.push(`「${t}」（宿世出身）→ 泛化：取出身寓意化为来历意象`);
  // 命格
  for (const t of talents.destiny) hints.push(imageryLine(t, DESTINY_IMAGERY, '泛化：正面命格写得偿所愿/登临/顺遂，负面命格写磨折/羁绊/薄命'));
  // 功法
  for (const t of talents.skill) hints.push(imageryLine(t, SKILL_IMAGERY, '泛化：取功法核心字化为行迹画面'));
  // 性格
  const inner = INNER_IMAGERY[draft.innerPersonality];
  hints.push(`内在性格「${draft.innerPersonality}」→ 意象：${inner.words}；考语候选：${inner.comments.join(' / ')}`);
  for (const p of draft.outerPersonality) {
    if (OUTER_IMAGERY[p]) hints.push(`外在性格「${p}」→ ${OUTER_IMAGERY[p]}`);
  }
  // 归宿
  hints.push(`定位「${pos.name}」→ 结局意象：${posImg?.words}；经典结句范式：${posImg?.examples}`);
  // 缺陷暗线
  for (const f of talents.flaws) hints.push(`小缺陷「${f}」→ 暗喻（严禁直白写出，藏入第3或第4句）：${FLAW_IMAGERY[f] ?? '化为含蓄的美中不足意象'}`);

  const system = `你是「指尖仙侠·人物判词生成器」，仿《红楼梦》薄命司判词，为仙侠人物写宿命谶语。
输出：4句七言绝句（每句严格7个汉字）+ 1个二字考语（核心字+「情」，仿警幻情榜）。

四句四维固定结构（不交叉、不重复、无遗漏）：
- 第1句【根骨出身】起：点破先天根脚与来历（圣体魔躯类天赋 > 种族 > 宿世出身），重意象不直白说天赋名
- 第2句【心性立场】承：定调三观底色与正邪立场（内在性格+立场区间），色调严格匹配立场
- 第3句【行迹所长】转：具象化行事风格与立身之本（功法天赋+外在性格Top2），抓1-2个特征揉成画面
- 第4句【归宿谶语】合：预言终局（定位+命格气运+小缺陷暗线），只写趋势不写死，预言式表达

铁则（违反即废）：
1. 每句恰好7个汉字，第2、4句必须押韵（中华新韵宽韵，现代汉语读顺即可）
2. 全诗严禁出现任何标签原文（如"先天剑骨""社恐""天煞孤星"等），全部转为古典意象
3. 严禁现代术语、境界名称、等级数字
4. 末句预言式，负面命格显宿命感，正面命格留余地
5. 正邪色调与立场值一致，同句意象色调统一

只输出JSON，格式：
{"verdict_poem":"句1\\n句2\\n句3\\n句4","verdict_comment":"X情","annotation":{"line1":"注解","line2":"注解","line3":"注解","line4":"注解"}}`;

  const user = `人物标签：
姓名：${draft.name}（${draft.gender === 'male' ? '男' : '女'}）
种族：${category?.name}·${sub?.name}
真实定位：${pos.name}（判词按真实定位写，保证宿命准确）
立场：${draft.stance}/100，定性「${tone.label}」——全诗色调词：${tone.words}；推荐韵部：${tone.rhyme}
内在性格：${draft.innerPersonality}
外在性格：${draft.outerPersonality.join('、')}
天赋：${draft.talents.join('、')}
擅长：${draft.strengths.join('、')}；短板：${draft.weaknesses.join('、')}（短板可作暗线，不直白写出）

意象查表结果（优先使用，同色调内可微调）：
${hints.map((h) => `- ${h}`).join('\n')}

考语规则：优先内在性格核心字 > 核心天赋核心字 > 种族核心字，二字格式（如 正情/剑情/魔情/孤情）。`;

  return { system, user };
}

// ─── 质量校验（需求第四章步骤7） ──────────────────────────────────────────────

/** 提取LLM返回中的JSON对象（容忍```json围栏与前后杂文） */
function extractJson(raw: string): any {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('LLM返回中未找到JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** 校验判词：4句七言 + 考语二字以情结尾 + 术语清零，返回错误信息或null */
function validateVerdict(poem: string, comment: string, draft: CustomCharacterDraft): string | null {
  const lines = poem.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length !== 4) return `判词须恰好4句，实际${lines.length}句`;
  for (const line of lines) {
    const chars = line.replace(/[，。、！？；：“”‘’,.!?;:\s]/g, '');
    if (chars.length !== 7) return `「${line}」非七言（${chars.length}字）`;
  }
  if (!/^[\u4e00-\u9fa5]情$/.test(comment)) return `考语「${comment}」不符合二字+情格式`;
  // 术语清零：天赋名/缺陷名不得出现在诗中（2字及以下标签除外，避免误伤常用字组合）
  for (const t of draft.talents) {
    if (t.length >= 3 && poem.includes(t)) return `判词直白出现了标签原文「${t}」`;
  }
  return null;
}

// ─── 生成入口 ─────────────────────────────────────────────────────────────────

/**
 * LLM生成判词（温度0.3），校验不通过自动重试一次，仍失败则抛错（由调用方降级兜底）
 */
export async function generateVerdict(draft: CustomCharacterDraft): Promise<VerdictResult> {
  const { system, user } = buildPrompt(draft);
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chatCompletion(
      [
        { role: 'system', content: system },
        { role: 'user', content: lastError ? `${user}\n\n上次生成不合格（${lastError}），请严格按铁则重新生成。` : user },
      ],
      { temperature: 0.3, maxTokens: 1024 }
    );
    try {
      const parsed = extractJson(raw);
      const poem = String(parsed.verdict_poem ?? '').replace(/[，。]$/gm, '').trim();
      // 统一句尾无标点、换行分隔
      const normalized = poem
        .split('\n')
        .map((l: string) => l.trim().replace(/[，。、！？；：,.!?;:]+$/, ''))
        .filter(Boolean)
        .join('\n');
      const comment = String(parsed.verdict_comment ?? '').trim();
      const error = validateVerdict(normalized, comment, draft);
      if (!error) {
        return {
          verdictPoem: normalized,
          verdictComment: comment,
          annotation: parsed.annotation && typeof parsed.annotation === 'object' ? parsed.annotation : undefined,
        };
      }
      lastError = error;
    } catch (err: any) {
      lastError = err?.message ?? 'JSON解析失败';
    }
  }
  throw new Error(`判词生成校验未通过：${lastError}`);
}

// ─── 降级兜底（需求第六章：种族+定位基础版四句，永不输出空值） ────────────────

/** 兜底判词：种族起句 + 立场心性句 + 通用行迹句 + 定位结句 */
const RACE_FALLBACK_LINE: Record<string, string> = {
  human: '生在凡尘骨相奇',
  demon_race: '化形山野蕴妖灵',
  demon_king_race: '九幽孕气入尘寰',
  ghost_race: '幽冥炼魄住阴身',
  spirit_race: '天地灵气凝为体',
  divine_race: '神脉天潢自不凡',
  hybrid_race: '双脉同身天赋异',
};

export function buildFallbackVerdict(draft: CustomCharacterDraft): VerdictResult {
  const line1 = RACE_FALLBACK_LINE[draft.raceCategory] ?? '生在凡尘骨相奇';
  const line2 = draft.stance <= 33 ? '心存浩气傲霜寒' : draft.stance <= 66 ? '随心浪迹自无拘' : '暗蓄幽心行诡途';
  const line3 = '半世行藏谁识得';
  const line4 = POSITION_IMAGERY[draft.position]?.fallbackLine ?? '浮生渺渺似飘蓬';
  return {
    verdictPoem: [line1, line2, line3, line4].join('\n'),
    verdictComment: INNER_IMAGERY[draft.innerPersonality]?.comments[0] ?? '凡情',
  };
}
