/**
 * 五模块体验优化 LLM 生成服务（13-SRS v1.4）
 * - US-18 人物对白风格一键补全（autoVoice）
 * - US-20d 功法反噬代价动态生成（generateBacklashText）
 * - US-20e 道则组合「天机独悟」运用方向 + 神通招式名生成（generateDaoInsights）
 * 统一走默认 LLM_MODEL（.env 配置为 flash 档模型，省 token 响应快），超时 30s。
 * 所有函数失败抛错，由路由层统一 toast 文案处理。
 */
import { chatCompletion } from '../llm/client.js';
import {
  getDao, getCoreTrait, getPracticePath, daoCompat,
  type DaoId,
} from '../data/technique-catalog.js';

const GEN_TIMEOUT = 30000;

/** 从 LLM 输出中提取 JSON（容忍 ```json 围栏与前后杂讯） */
function extractJson<T>(raw: string): T {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = (fence ? fence[1] : raw).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    const arrStart = text.indexOf('[');
    const arrEnd = text.lastIndexOf(']');
    if (arrStart >= 0 && arrEnd > arrStart) {
      return JSON.parse(text.slice(arrStart, arrEnd + 1)) as T;
    }
    throw new Error('LLM输出无法解析为JSON');
  }
  return JSON.parse(text.slice(start, end + 1)) as T;
}

// ============ US-18 对白风格一键补全 ============

/** 人物对白风格生成入参（custom_character 行子集） */
export interface AutoVoiceInput {
  name: string;
  gender?: string | null;
  raceCategory?: string | null;
  raceSub?: string | null;
  position?: string | null;
  stance?: number | null;
  innerPersonality?: string | null;
  outerPersonality?: string[] | null;
  talents?: string[] | null;
  strengths?: string[] | null;
  weaknesses?: string[] | null;
  description?: string | null;
}

export interface AutoVoiceResult {
  speechStyle: string;
  catchphrases: string;
  addressHabit: string;
  toneBase: string;
  exampleQuotes: string[];
  forbiddenExpressions: string[];
}

/** 依据人物性格/身份/背景生成完整对白风格（6个业务字段），不自动保存 */
export async function autoVoice(input: AutoVoiceInput): Promise<AutoVoiceResult> {
  const system = `你是「指尖仙侠」世界观的角色声音设计师，精通古典仙侠人物的语言风格塑造。
根据人物设定推断其说话方式，输出必须贴合人物身份、性格与出身，杜绝千人一面。
文风古朴，禁用现代网络用语。只输出JSON，不要任何额外文字。

输出格式（严格JSON）：
{
  "speechStyle": "说话风格概述（语速/句式/文白程度，20字内）",
  "catchphrases": "口头禅或高频用词（15字内）",
  "addressHabit": "称呼习惯（对不同身份者的称呼方式，20字内）",
  "toneBase": "语气基调（8字内）",
  "exampleQuotes": ["3-5条符合该人物身份性格的典型台词，每条不超过25字"],
  "forbiddenExpressions": ["2-3条该人物绝不会说的话或表达"]
}`;

  const user = [
    '请为以下人物生成对白风格配置：',
    `- 姓名：${input.name}`,
    input.gender ? `- 性别：${input.gender === 'male' ? '男' : input.gender === 'female' ? '女' : input.gender}` : '',
    input.raceSub ? `- 种族：${input.raceSub}` : '',
    input.position ? `- 身份定位：${input.position}` : '',
    input.stance != null ? `- 立场倾向：${input.stance}（0=极邪，100=极正）` : '',
    input.innerPersonality ? `- 内在性格：${input.innerPersonality}` : '',
    input.outerPersonality?.length ? `- 外在表现：${input.outerPersonality.join('、')}` : '',
    input.talents?.length ? `- 天赋专长：${input.talents.join('、')}` : '',
    input.strengths?.length ? `- 长处：${input.strengths.join('、')}` : '',
    input.weaknesses?.length ? `- 短处：${input.weaknesses.join('、')}` : '',
    input.description ? `- 背景/出场描写：${input.description.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n');

  const raw = await chatCompletion(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { temperature: 0.7, maxTokens: 1200, timeout: GEN_TIMEOUT }
  );
  const parsed = extractJson<Partial<AutoVoiceResult>>(raw);
  if (!parsed.speechStyle) throw new Error('对白风格生成结果不完整');
  return {
    speechStyle: String(parsed.speechStyle),
    catchphrases: String(parsed.catchphrases ?? ''),
    addressHabit: String(parsed.addressHabit ?? ''),
    toneBase: String(parsed.toneBase ?? ''),
    exampleQuotes: Array.isArray(parsed.exampleQuotes) ? parsed.exampleQuotes.map(String) : [],
    forbiddenExpressions: Array.isArray(parsed.forbiddenExpressions) ? parsed.forbiddenExpressions.map(String) : [],
  };
}

// ============ US-20d 反噬代价动态生成 ============

export interface BacklashGenInput {
  name: string;
  mainDao: string;
  assistDao: string[];
  practicePath: string;
  coreTraits: string[];
}

/** 根据道则组合+行功路线+兼容度动态生成反噬描述（200字以内），随功法保存 */
export async function generateBacklashText(input: BacklashGenInput): Promise<string> {
  const allDaos = [input.mainDao, ...(input.assistDao || [])] as DaoId[];
  const clashPairs: string[] = [];
  const highPairs: string[] = [];
  for (let i = 0; i < allDaos.length; i++) {
    for (let j = i + 1; j < allDaos.length; j++) {
      const c = daoCompat(allDaos[i], allDaos[j]);
      const label = `${getDao(allDaos[i])?.name || allDaos[i]}×${getDao(allDaos[j])?.name || allDaos[j]}`;
      if (c === 'clash') clashPairs.push(label);
      else if (c === 'high') highPairs.push(label);
    }
  }
  const pathName = getPracticePath(input.practicePath)?.name || input.practicePath;
  const traitNames = (input.coreTraits || [])
    .map((id) => getCoreTrait(id)?.name).filter(Boolean).join('、') || '无';

  const system = `你是「指尖仙侠」世界观的功法设定师。为功法撰写"反噬代价"描述。
要求：
- 200字以内，一段话，古朴仙侠文风，禁用现代词与数值品级词。
- 须具体到道则互冲/反噬细节，不得套话；每部功法的反噬都不一样。
- 对冲组合：反噬惨烈，具体写道则互冲如何反噬肉身/神魂/道基。
- 高兼容组合：反噬轻微但有特殊代价（如折寿/断情/惧某物）。
- 行功路线为"逆势反修"或"旁门速法"：反噬加重，写入魔风险。
- 行功路线为"正统推演"：反噬温和。
只输出反噬描述正文，不要标题、引号或任何额外文字。`;

  const user = [
    `功法名号：${input.name}`,
    `主修道则：${getDao(input.mainDao)?.name || input.mainDao}`,
    `辅修道则：${(input.assistDao || []).map((d) => getDao(d)?.name || d).join('、') || '无'}`,
    `行功路线：${pathName}`,
    `本源运用方向：${traitNames}`,
    clashPairs.length ? `对冲组合：${clashPairs.join('；')}` : '',
    highPairs.length ? `高兼容组合：${highPairs.join('；')}` : '',
    '请撰写该功法的反噬代价描述。',
  ].filter(Boolean).join('\n');

  const raw = await chatCompletion(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { temperature: 0.8, maxTokens: 500, timeout: GEN_TIMEOUT }
  );
  const text = raw.trim().replace(/^["'“]+|["'”]+$/g, '');
  if (!text) throw new Error('反噬描述生成为空');
  return text;
}

// ============ US-20e 天机独悟：运用方向 + 神通招式名 ============

export interface DaoInsightInput {
  mainDao: string;
  assistDao: string[];
  coreTraits: string[];
  /** 需要命名的神通（预设词条），每项含道境 */
  abilities?: { id: string; name: string; daoRealm: string }[];
}

export interface InsightDirection {
  name: string;
  desc: string;
}

export interface InsightAbilityRename {
  id: string;
  newName: string;
}

export interface DaoInsightResult {
  directions: InsightDirection[];
  abilityRenames: InsightAbilityRename[];
}

/** 依据道则组合生成 3-5 个独有运用方向（天机独悟）+ 神通招式改名 */
export async function generateDaoInsights(input: DaoInsightInput): Promise<DaoInsightResult> {
  const daoNames = [input.mainDao, ...(input.assistDao || [])]
    .map((d) => getDao(d)?.name || d);
  const traitNames = (input.coreTraits || [])
    .map((id) => getCoreTrait(id)?.name).filter(Boolean);

  const needAbilities = (input.abilities || []).filter((a) => a && a.id);
  const system = `你是「指尖仙侠」世界观的功法设定师，为道则组合推演独创的运用方向与神通名号。
要求：
- 运用方向：3-5个，每个含 name（4字仙侠风，如"雷腐蚀魂""时空斩"）与 desc（一句话，30字内），
  名称与描述必须体现所给道则组合的独特化学反应，不得与通用方向雷同。
- 神通改名：为每个给定神通取一个贴合道则组合的新招式名（2-5字），保留原道境档位气质。
- 古朴仙侠文风，禁用现代词、物理术语、数值品级词。
只输出JSON，不要任何额外文字。

输出格式（严格JSON）：
{
  "directions": [ { "name": "4字方向名", "desc": "一句话描述" } ],
  "abilityRenames": [ { "id": "原神通id", "newName": "新招式名" } ]
}`;

  const user = [
    `主修道则：${getDao(input.mainDao)?.name || input.mainDao}`,
    `辅修道则：${(input.assistDao || []).map((d) => getDao(d)?.name || d).join('、') || '无'}`,
    `道则组合：${daoNames.join(' + ')}`,
    traitNames.length ? `已选基础运用方向（避免雷同）：${traitNames.join('、')}` : '',
    needAbilities.length
      ? `待改名神通：${needAbilities.map((a) => `${a.id}(原名:${a.name},${a.daoRealm}境)`).join('；')}`
      : '待改名神通：无（abilityRenames 返回空数组）',
  ].join('\n');

  const raw = await chatCompletion(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { temperature: 0.9, maxTokens: 1000, timeout: GEN_TIMEOUT }
  );
  const parsed = extractJson<Partial<DaoInsightResult>>(raw);
  const directions = (Array.isArray(parsed.directions) ? parsed.directions : [])
    .filter((d) => d && d.name && d.desc)
    .map((d) => ({ name: String(d.name), desc: String(d.desc) }));
  const abilityRenames = (Array.isArray(parsed.abilityRenames) ? parsed.abilityRenames : [])
    .filter((r) => r && r.id && r.newName)
    .map((r) => ({ id: String(r.id), newName: String(r.newName) }));
  if (!directions.length) throw new Error('天机独悟生成结果为空');
  return { directions, abilityRenames };
}
