/**
 * 自定义人物模块冒烟测试脚本
 * 前置：server 已启动（默认 http://localhost:3456）、DDL 已执行
 *
 * 覆盖：
 *  1. 整卡随机接口 N 次抽样：禁用字、天赋约束（3正向/每类≤2/缺陷≤1）、立场范围、
 *     扮猪吃虎档次约束、稀有度权重占比统计
 *  2. 随机姓名接口：各大类首个小类抽样 + 禁用字校验
 *  3. 分类骰子：talentCategory 定向随机 + excludeTalents 排除
 *  4. CRUD 全链路：create→负数ID→get 回读→update→list→delete→404
 *
 * 用法: node scripts/test-custom-character.mjs
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3456/api';

const shared = await import(pathToFileURL(resolve(ROOT, 'packages/shared/dist/index.js')).href);
const {
  FORBIDDEN_NAME_CHARS,
  RACE_CONFIG,
  POSITION_OPTIONS,
  TALENT_CONFIG,
  TALENT_RARITY_WEIGHTS,
  TALENT_REQUIRED_COUNT,
  TALENT_MAX_PER_CATEGORY,
  FLAW_OPTIONS,
  OUTER_PERSONALITY_MIN,
  OUTER_PERSONALITY_MAX,
  INNER_PERSONALITY_OPTIONS,
  findTalentByName,
  findRaceSub,
  findPosition,
} = shared;

let passCount = 0;
let failCount = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    passCount++;
  } else {
    failCount++;
    failures.push(`${name}${detail ? ` —— ${detail}` : ''}`);
    console.error(`  [FAIL] ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function hasForbiddenChar(name) {
  return FORBIDDEN_NAME_CHARS.some((ch) => name.includes(ch));
}

/** 校验一份 draft 的通用约束，返回错误消息数组 */
function validateDraft(draft) {
  const errors = [];
  if (!draft.name || typeof draft.name !== 'string') errors.push(`姓名为空: ${JSON.stringify(draft.name)}`);
  else if (hasForbiddenChar(draft.name)) errors.push(`姓名含禁用字: ${draft.name}`);
  if (!findRaceSub(draft.raceCategory, draft.raceSub)) errors.push(`无效种族: ${draft.raceCategory}/${draft.raceSub}`);
  if (!findPosition(draft.position)) errors.push(`无效定位: ${draft.position}`);
  if (draft.fakePosition) {
    const realRank = findPosition(draft.position)?.rank ?? 0;
    const fakeRank = findPosition(draft.fakePosition)?.rank ?? 0;
    if (fakeRank >= realRank) errors.push(`伪装定位未低于真实定位: ${draft.fakePosition} vs ${draft.position}`);
  }
  if (!Number.isInteger(draft.stance) || draft.stance < 0 || draft.stance > 100) errors.push(`立场越界: ${draft.stance}`);
  if (!INNER_PERSONALITY_OPTIONS.includes(draft.innerPersonality)) errors.push(`无效内在性格: ${draft.innerPersonality}`);
  if (
    !Array.isArray(draft.outerPersonality) ||
    draft.outerPersonality.length < OUTER_PERSONALITY_MIN ||
    draft.outerPersonality.length > OUTER_PERSONALITY_MAX
  ) {
    errors.push(`外在性格数量异常: ${JSON.stringify(draft.outerPersonality)}`);
  }
  // 天赋：3正向、每类≤2、缺陷≤1
  const catCount = {};
  let positive = 0;
  let flaw = 0;
  for (const t of draft.talents ?? []) {
    const found = findTalentByName(t);
    if (found) {
      positive++;
      catCount[found.category.id] = (catCount[found.category.id] ?? 0) + 1;
    } else if (FLAW_OPTIONS.includes(t)) {
      flaw++;
    } else {
      errors.push(`无效天赋词条: ${t}`);
    }
  }
  if (positive !== TALENT_REQUIRED_COUNT) errors.push(`正向天赋数=${positive}（应为${TALENT_REQUIRED_COUNT}）: ${JSON.stringify(draft.talents)}`);
  if (flaw > 1) errors.push(`缺陷数=${flaw}（应≤1）`);
  for (const [cat, n] of Object.entries(catCount)) {
    if (n > TALENT_MAX_PER_CATEGORY) errors.push(`「${cat}」类天赋${n}个（应≤${TALENT_MAX_PER_CATEGORY}）`);
  }
  return errors;
}

// ---- 0. 获取项目ID ----
console.log(`\n=== 冒烟测试 @ ${BASE} ===\n`);
const projRes = await api('GET', '/projects');
check('GET /projects 成功', projRes.status === 200 && projRes.json.success, JSON.stringify(projRes.json).slice(0, 200));
const projects = projRes.json.data ?? [];
if (!projects.length) {
  console.error('[abort] 无可用项目，无法继续测试');
  process.exit(1);
}
const PID = projects[0].id;
console.log(`[info] 使用项目 projectId=${PID}\n`);
const P = `/projects/${PID}/custom-characters`;

// ---- 1. 整卡随机 N 次抽样 ----
console.log('--- 1. 整卡随机抽样（N=200） ---');
const N = 200;
const rarityCount = { rare: 0, advanced: 0, common: 0 };
let flawTotal = 0;
let fakeTotal = 0;
let sampleErrors = 0;
for (let i = 0; i < N; i++) {
  const { status, json } = await api('POST', `${P}/random`, {});
  if (status !== 200 || !json.success) {
    sampleErrors++;
    continue;
  }
  const errs = validateDraft(json.data);
  if (errs.length) {
    sampleErrors++;
    if (sampleErrors <= 3) console.error(`  [sample#${i}] ${errs.join('; ')}`);
  }
  for (const t of json.data.talents ?? []) {
    const found = findTalentByName(t);
    if (found) rarityCount[found.entry.rarity] = (rarityCount[found.entry.rarity] ?? 0) + 1;
    else flawTotal++;
  }
  if (json.data.fakePosition) fakeTotal++;
}
check(`整卡随机 ${N} 次全部合法`, sampleErrors === 0, `${sampleErrors} 次异常`);

const rarityTotal = rarityCount.rare + rarityCount.advanced + rarityCount.common;
const pct = (n) => ((n / rarityTotal) * 100).toFixed(1);
console.log(`  [stat] 稀有度分布: rare=${pct(rarityCount.rare)}% advanced=${pct(rarityCount.advanced)}% common=${pct(rarityCount.common)}%（期望 ${TALENT_RARITY_WEIGHTS.rare * 100}/${TALENT_RARITY_WEIGHTS.advanced * 100}/${TALENT_RARITY_WEIGHTS.common * 100}）`);
console.log(`  [stat] 缺陷出现率: ${((flawTotal / N) * 100).toFixed(1)}%（期望约30%）、扮猪吃虎出现率: ${((fakeTotal / N) * 100).toFixed(1)}%`);
// 权重容差 ±10 个百分点（每卡按稀有度分层抽样，样本约600条）
check('rare 占比接近 10%', Math.abs(rarityCount.rare / rarityTotal - TALENT_RARITY_WEIGHTS.rare) < 0.1, `实际 ${pct(rarityCount.rare)}%`);
check('common 占比接近 60%', Math.abs(rarityCount.common / rarityTotal - TALENT_RARITY_WEIGHTS.common) < 0.15, `实际 ${pct(rarityCount.common)}%`);

// ---- 2. 锁定项测试 ----
console.log('--- 2. 锁定项随机 ---');
const lockCurrent = { name: '林惊羽', raceCategory: 'human', raceSub: 'commoner', position: 'dazhe', gender: 'male' };
const lockRes = await api('POST', `${P}/random`, { locks: { name: true, race: true, position: true, gender: true }, current: lockCurrent });
check('锁定随机接口成功', lockRes.status === 200 && lockRes.json.success);
if (lockRes.json.success) {
  const d = lockRes.json.data;
  check('锁定姓名保留', d.name === '林惊羽', d.name);
  check('锁定种族保留', d.raceCategory === 'human' && d.raceSub === 'commoner', `${d.raceCategory}/${d.raceSub}`);
  check('锁定定位保留', d.position === 'dazhe', d.position);
}

// ---- 3. 随机姓名（各大类首个小类） ----
console.log('--- 3. 随机姓名抽样 ---');
for (const cat of RACE_CONFIG) {
  const sub = cat.subs[0];
  let bad = 0;
  for (let i = 0; i < 10; i++) {
    const { status, json } = await api('POST', `${P}/random-name`, { raceCategory: cat.id, raceSub: sub.id, gender: i % 2 ? 'female' : 'male' });
    if (status !== 200 || !json.success || !json.data.name || hasForbiddenChar(json.data.name)) bad++;
  }
  check(`随机姓名 ${cat.name}·${sub.name} ×10 合法`, bad === 0, `${bad} 次异常`);
}
const badNameRes = await api('POST', `${P}/random-name`, { raceCategory: 'human', raceSub: 'not-exist' });
check('无效种族随机姓名返回 400', badNameRes.status === 400);

// ---- 4. 分类骰子 ----
console.log('--- 4. 天赋分类骰子 ---');
for (const cat of TALENT_CONFIG) {
  const { status, json } = await api('POST', `${P}/random`, { talentCategory: cat.id });
  const ok = status === 200 && json.success && cat.entries.some((e) => e.name === json.data.talent);
  check(`分类骰子 ${cat.name} 命中本类`, ok, JSON.stringify(json.data ?? json.error));
}
// excludeTalents：排除某类除1条外全部，应必中剩下那条
const bodyCat = TALENT_CONFIG[0];
const keep = bodyCat.entries[0].name;
const exclude = bodyCat.entries.slice(1).map((e) => e.name);
const exRes = await api('POST', `${P}/random`, { talentCategory: bodyCat.id, excludeTalents: exclude });
check('excludeTalents 生效（唯一候选必中）', exRes.json?.data?.talent === keep, JSON.stringify(exRes.json?.data ?? exRes.json?.error));

// ---- 5. CRUD 全链路 ----
console.log('--- 5. CRUD 全链路（含LLM/模板小传，稍慢） ---');
const draftRes = await api('POST', `${P}/random`, {});
const draft = draftRes.json.data;
const form = {
  name: draft.name,
  gender: draft.gender,
  raceCategory: draft.raceCategory,
  raceSub: draft.raceSub,
  position: draft.position,
  fakePosition: draft.fakePosition ?? null,
  stance: draft.stance,
  innerPersonality: draft.innerPersonality,
  outerPersonality: draft.outerPersonality,
  talents: draft.talents,
};
const createRes = await api('POST', P, form);
check('POST 创建成功', createRes.status === 200 && createRes.json.success, JSON.stringify(createRes.json).slice(0, 300));
const created = createRes.json.data;
if (created) {
  check('创建返回负数ID', typeof created.id === 'number' && created.id < 0, String(created.id));
  check('小传非空', typeof created.description === 'string' && created.description.length > 0, `len=${created.description?.length}`);
  check('擅长/短板从种族配置回填', created.strengths.length > 0 && created.weaknesses.length > 0);

  const getRes = await api('GET', `${P}/${created.id}`);
  check('GET 负数ID回读成功', getRes.status === 200 && getRes.json.success && getRes.json.data.id === created.id);
  check('回读姓名一致', getRes.json?.data?.name === form.name);

  const updRes = await api('PUT', `${P}/${created.id}`, { name: '冒烟改名', stance: 88 });
  check('PUT 更新成功', updRes.status === 200 && updRes.json.success, JSON.stringify(updRes.json).slice(0, 300));
  check('更新后姓名/立场生效', updRes.json?.data?.name === '冒烟改名' && updRes.json?.data?.stance === 88);

  const listRes = await api('GET', P);
  check('LIST 包含新建人物', Array.isArray(listRes.json?.data) && listRes.json.data.some((c) => c.id === created.id));

  // 业务校验：非法更新应 400
  const badUpd = await api('PUT', `${P}/${created.id}`, { fakePosition: 'tianyou' });
  check('伪装定位≥真实定位被拒（400）', badUpd.status === 400, `status=${badUpd.status} ${JSON.stringify(badUpd.json).slice(0, 150)}`);

  const delRes = await api('DELETE', `${P}/${created.id}`);
  check('DELETE 软删除成功', delRes.status === 200 && delRes.json.success);
  const getAfterDel = await api('GET', `${P}/${created.id}`);
  check('删除后 GET 返回 404', getAfterDel.status === 404);
  const listAfterDel = await api('GET', P);
  check('删除后 LIST 不再包含', !(listAfterDel.json?.data ?? []).some((c) => c.id === created.id));
}

// ---- 6. 非法创建校验 ----
console.log('--- 6. 非法参数校验 ---');
const badForm = { ...form, talents: form.talents.filter((t) => findTalentByName(t)).slice(0, 2) };
const badCreate = await api('POST', P, badForm);
check('正向天赋不足3个被拒（400）', badCreate.status === 400, `status=${badCreate.status}`);

// ---- 汇总 ----
console.log(`\n=== 结果: ${passCount} 通过 / ${failCount} 失败 ===`);
if (failCount > 0) {
  console.log('失败清单:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('全部通过 ✔');
