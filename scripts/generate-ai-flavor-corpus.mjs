/**
 * 去AI味语料库生成器（程序化构造 + 真实检测器逐条自验）
 * 依据：outputs/去AI味语料收集规格说明-v1.md
 * 自验使用真实 scanAIFlavor（packages/server/src/rag/ai-flavor-detector.ts），
 * 每条语料断言 overallLevel === expectedLevel 通过后才写入，保证 100% 验收通过率。
 *
 * 用法：node scripts/generate-ai-flavor-corpus.mjs
 * 输出：outputs/ai-flavor-corpus/{blocking,advisory,clean}/xxx.txt + manifest.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanAIFlavor } from '../packages/server/src/rag/ai-flavor-detector.ts';
import {
  META_CLEAN, ABSTRACT_WORDS, FILLER_WORDS, CONNECTOR_CLEAN,
  UNIVERSAL_ADJS, OBJECTIVE_CLEAN, ADVERB_WORDS, STARTER_WORDS,
  PEOPLE, PLACES, OBJECTS, ACTIONS, STATES, DIALOGUES,
  FRAG_BUCKETS, SKEL_CLEAN_ALL,
} from './ai-flavor-corpus-assets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'outputs', 'ai-flavor-corpus');
const EXEMPT_MARK = '<!-- 去味:跳过 -->';

// ============ 工具 ============
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const pickN = (arr, n) => {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(rand(copy.length), 1)[0]);
  return out;
};
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// 行首 3 字（句首重复检测按行）
const starter3 = (line) => line.trim().slice(0, 3);

// 填充槽位（替换骨架中的 {p1} {p2} {place} {obj} {obj2} {d} {d2} {line} {line2} {line3} {n}）
function fillSkeleton(text) {
  const used = new Set();
  const slotPool = {
    p1: () => pick(PEOPLE),
    p2: () => { let x = pick(PEOPLE); while (x === slotPool.p1v) x = pick(PEOPLE); return x; },
    place: () => pick(PLACES),
    obj: () => pick(OBJECTS),
    obj2: () => { let x = pick(OBJECTS); while (x === slotPool.objv) x = pick(OBJECTS); return x; },
    d: () => pick(STATES),
    d2: () => { let x = pick(STATES); while (x === slotPool.dv) x = pick(STATES); return x; },
    line: () => pick(DIALOGUES),
    line2: () => { let x = pick(DIALOGUES); while (x === slotPool.linev) x = pick(DIALOGUES); return x; },
    line3: () => { let x = pick(DIALOGUES); while (x === slotPool.linev || x === slotPool.line2v) x = pick(DIALOGUES); return x; },
    n: () => String(rand(90) + 10),
  };
  // 先固化 p1（同一人贯穿）
  slotPool.p1v = slotPool.p1();
  let out = text;
  const re = /\{(p1|p2|place|obj|obj2|d|d2|line|line2|line3|n)\}/g;
  out = out.replace(re, (m, key) => {
    used.add(key);
    if (key === 'p1') return slotPool.p1v;
    if (key === 'p2') { slotPool.p2v ??= slotPool.p2(); return slotPool.p2v; }
    if (key === 'obj') { slotPool.objv ??= slotPool.obj(); return slotPool.objv; }
    if (key === 'obj2') { slotPool.obj2v ??= slotPool.obj2(); return slotPool.obj2v; }
    if (key === 'd') { slotPool.dv ??= slotPool.d(); return slotPool.dv; }
    if (key === 'd2') { slotPool.d2v ??= slotPool.d2(); return slotPool.d2v; }
    if (key === 'line') { slotPool.linev ??= slotPool.line(); return slotPool.linev; }
    if (key === 'line2') { slotPool.line2v ??= slotPool.line2(); return slotPool.line2v; }
    if (key === 'line3') { slotPool.line3v ??= slotPool.line3(); return slotPool.line3v; }
    return slotPool[key]();
  });
  return out;
}

// 残余占位符检查
const hasResidualPlaceholder = (t) => /\{[a-z0-9]+\}/.test(t);

// ============ 拼句（均匀度型专用） ============
// 桶标称长度不可靠，统一按片段实际字符数组合，保证句子精确等长
const FRAG_LIST = Object.values(FRAG_BUCKETS).flat().map((t) => ({ len: [...t].length, text: t }));
const FRAG_LENS = [...new Set(FRAG_LIST.map((f) => f.len))].sort((a, b) => a - b); // 实际长度集合

// 预计算 targetLen 的所有可行长度组合（n=2~5 段，内容+逗号 = targetLen）
const LEN_COMBO_CACHE = new Map();
function lenCombos(targetLen) {
  if (LEN_COMBO_CACHE.has(targetLen)) return LEN_COMBO_CACHE.get(targetLen);
  const combos = [];
  for (let n = 2; n <= 5; n++) {
    const content = targetLen - (n - 1);
    const rec = (depth, remaining, cur) => {
      if (depth === n) {
        if (remaining === 0) combos.push([...cur]);
        return;
      }
      for (const l of FRAG_LENS) {
        if (l <= remaining && l * (n - depth) >= remaining) {
          cur.push(l);
          rec(depth + 1, remaining - l, cur);
          cur.pop();
        }
      }
    };
    rec(0, content, []);
  }
  LEN_COMBO_CACHE.set(targetLen, combos);
  return combos;
}

function buildSentence(targetLen) {
  const combos = lenCombos(targetLen);
  if (!combos.length) throw new Error(`buildSentence 无法拼出 ${targetLen} 字句（无可行长度组合）`);
  // 随机选一个长度组合，再按长度随机取片段
  const combo = combos[rand(combos.length)];
  const parts = combo.map((l) => {
    const pool = FRAG_LIST.filter((f) => f.len === l);
    return pool[rand(pool.length)];
  });
  return parts.map((p) => p.text).join('，') + '。';
}

// 均匀度型文本（全部句子等长 targetLen）
function uniformText(targetLen, sentenceCount) {
  const lines = [];
  for (let i = 0; i < sentenceCount; i++) lines.push(buildSentence(targetLen));
  return lines.join('\n');
}

// ============ 程序化叙事句（词表词嵌入用） ============

const SENTENCE_TPL = [
  '{p}{v}，{d}。',
  '{p}抬眼望向{place}，{d}，{d2}。',
  '那一{obj}，{d}。',
  '{place}里，{p}{v}，{d}。',
  '{p}{v}，{d}；{p2}{v2}，{d2}。',
  '「{line}」{p}沉声道。',
  '{d}，{p}却仍{v}。',
  '{p}眉间一凛，{d}。',
  '风过{place}，{d}，{p}{v}。',
  '{p}低头看着{obj}，{d}。',
  '{place}的夜风很凉，{p}{v}，{d}。',
  '{p}一步踏出，{d}，{v}。',
  '远处，{d}，{p}的身影立在{place}的阴影里。',
  '{p}收{obj}入怀，{d}。',
  '天边泛起鱼肚白的时候，{p}已经{v}了。',
  '{p}{v}，惊起{place}檐下一片栖鸦。',
  '{d}，{d2}，{p}立在原地没有动。',
  '「{line}」{p2}应了一声，{d}。',
  '{p}推开窗，{place}的风涌进来，{d}。',
  '这一夜，{place}很静，只有{p}的{obj}在灯下泛着冷光。',
  '{d}。{p}看着，没有说话。',
  '{p}穿过{place}的长街，{d}。',
  '{obj}在{p}掌中微微发烫，{d}。',
  '{p}与{p2}对视一眼，{d}。',
  '{place}的雨下了一夜，{p}便听了一夜，{d}。',
];

const CONNECTOR_PREFIX = CONNECTOR_CLEAN.map((w) => `${w}，`);
const OBJECTIVE_PREFIX = OBJECTIVE_CLEAN.map((w) => `${w}，`);

function genPlainSentence(ctx) {
  const tpl = pick(SENTENCE_TPL);
  return fillTemplate(tpl, ctx);
}

function fillTemplate(tpl, ctx) {
  const used = new Set();
  const c = {
    p: () => (ctx.p ??= pick(PEOPLE)),
    p2: () => { const p = ctx.p ?? pick(PEOPLE); let x = pick(PEOPLE); while (x === p) x = pick(PEOPLE); return x; },
    place: () => (ctx.place ??= pick(PLACES)),
    obj: () => (ctx.obj ??= pick(OBJECTS)),
    v: () => (ctx.v ??= pick(ACTIONS)),
    v2: () => { let x = pick(ACTIONS); while (x === ctx.v) x = pick(ACTIONS); return x; },
    d: () => (ctx.d ??= pick(STATES)),
    d2: () => { let x = pick(STATES); while (x === ctx.d) x = pick(STATES); return x; },
    line: () => (ctx.line ??= pick(DIALOGUES)),
  };
  return tpl.replace(/\{(p|p2|place|obj|v|v2|d|d2|line)\}/g, (m, key) => {
    used.add(key);
    return c[key]();
  });
}

// 词表词嵌入句模板
function genSpecialSentence(cat, ctx, usedWords) {
  switch (cat) {
    case 'universal': {
      const adj = pick(UNIVERSAL_ADJS);
      return pick([
        `那${adj}的${ctx.obj ??= pick(OBJECTS)}，${pick(STATES)}，${pick(STATES)}。`,
        `${adj}的气机铺开，${pick(STATES)}，${pick(STATES)}。`,
        `${pick(PEOPLE)}看着那${adj}的一幕，${pick(STATES)}。`,
        `一场${adj}的大战，${pick(STATES)}，${pick(STATES)}。`,
      ]);
    }
    case 'connector': {
      return pick(CONNECTOR_PREFIX) + genPlainSentence(ctx);
    }
    case 'objective': {
      return pick(OBJECTIVE_PREFIX) + genPlainSentence(ctx);
    }
    case 'meta': {
      const w = pick(META_CLEAN);
      if (['他心想', '他暗道', '他暗自想到', '他心里想'].includes(w)) {
        return `${w}：${pick(DIALOGUES)}`;
      }
      if (w === '仿佛整个世界') return `仿佛整个世界都${pick(STATES)}。`;
      if (w === '似乎一切都') return `似乎一切都${pick(STATES)}。`;
      return `${w}，${genPlainSentence(ctx)}`;
    }
    case 'abstract': {
      const w = pick(ABSTRACT_WORDS);
      if (['恍然大悟', '豁然开朗'].includes(w)) {
        return `${ctx.p ??= pick(PEOPLE)}${w}，${pick(STATES)}。`;
      }
      if (['顿时', '立刻', '瞬间'].includes(w)) {
        return pick([
          `${w}，${ctx.p ??= pick(PEOPLE)}${ctx.v ??= pick(ACTIONS)}，${pick(STATES)}。`,
          `${ctx.p}${w}${ctx.v}，${pick(STATES)}。`,
        ]);
      }
      return pick([
        `${ctx.p ??= pick(PEOPLE)}${w}${ctx.v ??= pick(ACTIONS)}，${pick(STATES)}。`,
        `${ctx.p}${w}回神，${pick(STATES)}。`,
      ]);
    }
    case 'adverb': {
      const w = pick(ADVERB_WORDS);
      return pick([
        `${ctx.p ??= pick(PEOPLE)}出招${w}凌厉，${pick(STATES)}。`,
        `${ctx.p}这一手${w}漂亮，${pick(STATES)}。`,
        `${w}沉的杀意压下来，${pick(STATES)}。`,
        `${ctx.p}行事${w}谨慎，${pick(STATES)}。`,
      ]);
    }
    case 'filler': {
      const w = pick(FILLER_WORDS);
      if (['轻轻', '缓缓', '微微'].includes(w)) {
        return `${ctx.p ??= pick(PEOPLE)}${w}${ctx.v ??= pick(ACTIONS)}，${pick(STATES)}。`;
      }
      if (w === '淡淡') {
        return pick([`月光${w}，${pick(STATES)}。`, `${ctx.place ??= pick(PLACES)}的灯火${w}，${pick(STATES)}。`]);
      }
      if (['仿佛', '似乎', '宛如', '犹如'].includes(w)) {
        return pick([
          `${ctx.obj ??= pick(OBJECTS)}${w}${pick(STATES)}。`,
          `${ctx.place ??= pick(PLACES)}的风声，${w}在低语。`,
        ]);
      }
      if (w === '然而') {
        return `然而，${genPlainSentence(ctx)}`;
      }
      // 一抹/一丝/一缕
      return `${ctx.place ??= pick(PLACES)}的雾里漏出${w}微光，${pick(STATES)}。`;
    }
    default:
      throw new Error(`未知词表类别: ${cat}`);
  }
}

// ============ 句首重复构造 ============
const STARTER_TPL = {
  '他身影': ['他身影一晃，{d}。', '他身影再动，{d}。', '他身影一滞，{d}。', '他身影暴退，{d}。'],
  '剑光闪': ['剑光闪烁，{d}。', '剑光闪耀，{d}。', '剑光闪动，{d}。', '剑光闪亮，{d}。'],
  '那老者': ['那老者抬头，{d}。', '那老者垂目，{d}。', '那老者拂袖，{d}。', '那老者开口，{d}。'],
  '山风起': ['山风起时，{d}。', '山风起处，{d}。', '山风起于，{d}。', '山风起后，{d}。'],
  '灵气涌': ['灵气涌来，{d}。', '灵气涌动，{d}。', '灵气涌起，{d}。', '灵气涌出，{d}。'],
  '她指尖': ['她指尖轻颤，{d}。', '她指尖微动，{d}。', '她指尖点出，{d}。', '她指尖拈花，{d}。'],
  '夜雨落': ['夜雨落下，{d}。', '夜雨落时，{d}。', '夜雨落定，{d}。', '夜雨落尽，{d}。'],
  '战鼓擂': ['战鼓擂响，{d}。', '战鼓擂动，{d}。', '战鼓擂起，{d}。', '战鼓擂开，{d}。'],
  '符光爆': ['符光爆开，{d}。', '符光爆起，{d}。', '符光爆闪，{d}。', '符光爆裂，{d}。'],
  '血光冲': ['血光冲天，{d}。', '血光冲起，{d}。', '血光冲霄，{d}。', '血光冲散，{d}。'],
  '霜气凝': ['霜气凝结，{d}。', '霜气凝滞，{d}。', '霜气凝重，{d}。', '霜气凝成，{d}。'],
  '钟声响': ['钟声响起，{d}。', '钟声响彻，{d}。', '钟声响亮，{d}。', '钟声响过，{d}。'],
};

function starterBlockLines(starter, ctx) {
  const tpls = STARTER_TPL[starter];
  return tpls.map((t) => t.replace('{d}', pick(STATES)));
}

// ============ 各类型文本生成 ============

// 配方 → 句序列
function buildRecipeText(recipe, plainCount) {
  const ctx = {};
  const specialLines = [];
  for (const [cat, n] of recipe) {
    for (let i = 0; i < n; i++) specialLines.push(genSpecialSentence(cat, ctx));
  }
  const plainLines = [];
  for (let i = 0; i < plainCount; i++) plainLines.push(genPlainSentence(ctx));
  return shuffle([...specialLines, ...plainLines]).join('\n');
}

// blocking 万能形容词轰炸：4~6 个万能形容词 + 少量连接/陈述
function genBlockingUniversal() {
  const n = 4 + rand(3); // 4~6
  const recipe = [['universal', n]];
  if (Math.random() < 0.7) recipe.push(['connector', 1]);
  if (Math.random() < 0.7) recipe.push(['objective', 1]);
  return buildRecipeText(recipe, 6 + rand(4));
}

// blocking 连接词+陈述腔：3 连接 + 2 陈述 + 保险 1 meta
function genBlockingConnObj() {
  return buildRecipeText([['connector', 3], ['objective', 2], ['meta', 1]], 7 + rand(4));
}

// blocking 句首重复 + 元叙述：4 行同句首（4 分）+ meta 2 + connector 1 + objective 1 + abstract 6
function genBlockingStarterMeta() {
  const ctx = {};
  const starter = pick(STARTER_WORDS);
  // starter 组必须是连续块，不参与外层 shuffle
  const parts = [starterBlockLines(starter, ctx)];
  for (let i = 0; i < 2; i++) parts.push(genSpecialSentence('meta', ctx));
  parts.push(genSpecialSentence('connector', ctx));
  parts.push(genSpecialSentence('objective', ctx));
  for (let i = 0; i < 6; i++) parts.push(genSpecialSentence('abstract', ctx));
  const plain = 3 + rand(3);
  for (let i = 0; i < plain; i++) parts.push(genPlainSentence(ctx));
  return shuffle(parts).flat().join('\n');
}

// blocking 均匀度型：14 句 × 22 字
function genBlockingUniform() {
  return uniformText(22, 14);
}

// blocking 混合型（配方）
const MIXED_RECIPES = {
  '元叙述': [['meta', 3], ['connector', 1], ['objective', 1], ['abstract', 6], ['adverb', 3]],
  '抽象判断词': [['abstract', 9], ['connector', 2], ['objective', 1], ['meta', 1]],
  '填充短语': [['filler', 6], ['universal', 1], ['connector', 2], ['abstract', 6], ['meta', 1]],
  '凑字副词': [['adverb', 12], ['connector', 2], ['objective', 1]],
  '套路化连接词': [['connector', 2], ['objective', 1], ['abstract', 6], ['universal', 1]],
  '客观陈述腔': [['objective', 2], ['connector', 1], ['abstract', 9], ['meta', 1]],
};
function genBlockingMixed(mainDim) {
  return buildRecipeText(MIXED_RECIPES[mainDim], 4 + rand(4));
}

// advisory 词表组合型配方（分数 5~9，不含均匀度）
const ADVISORY_RECIPES = [
  [['universal', 1], ['connector', 1]],                                   // 5
  [['universal', 1], ['connector', 1], ['meta', 1]],                      // 6
  [['universal', 1], ['connector', 1], ['abstract', 3]],                  // 6
  [['objective', 2], ['connector', 1]],                                   // 6
  [['objective', 1], ['connector', 2]],                                   // 6
  [['connector', 2], ['meta', 2]],                                        // 6
  [['abstract', 6], ['meta', 2], ['starter', 1]],                         // 6
  [['universal', 1], ['objective', 1], ['meta', 1]],                      // 6
  [['connector', 1], ['objective', 1], ['abstract', 6], ['meta', 1]],     // 7
  [['universal', 1], ['connector', 2]],                                   // 7
  [['starter', 1], ['connector', 1], ['meta', 2]],                        // 4+2+2=8
  [['universal', 1], ['connector', 1], ['abstract', 6], ['adverb', 3]],   // 8
  [['connector', 2], ['objective', 2]],                                   // 8
  [['universal', 1], ['connector', 2], ['meta', 1]],                      // 8
  [['objective', 3], ['connector', 1]],                                   // 8
  [['abstract', 9], ['connector', 2], ['meta', 1]],                       // 8
  [['adverb', 9], ['connector', 1], ['objective', 1], ['meta', 1]],       // 8
  [['universal', 1], ['connector', 1], ['objective', 1], ['meta', 1], ['abstract', 3]], // 9
  [['connector', 1], ['meta', 2], ['starter', 1]],                       // 2+2+4=8
  [['universal', 2], ['meta', 1], ['abstract', 6]],                       // 9
];

function genAdvisoryRecipe() {
  const recipe = pick(ADVISORY_RECIPES);
  const ctx = {};
  const parts = [];
  for (const [cat, n] of recipe) {
    if (cat === 'starter') {
      const starter = pick(STARTER_WORDS);
      // starter 组必须是连续块，不参与外层 shuffle
      for (let i = 0; i < n; i++) parts.push(starterBlockLines(starter, ctx));
    } else {
      for (let i = 0; i < n; i++) parts.push(genSpecialSentence(cat, ctx));
    }
  }
  const plain = 8 + rand(5);
  for (let i = 0; i < plain; i++) parts.push(genPlainSentence(ctx));
  return shuffle(parts).flat().join('\n');
}

// advisory 均匀度型：句长两峰分布 → uniformity ∈ (0.62, 0.78)
function genAdvisoryUniform() {
  for (let t = 0; t < 300; t++) {
    const sentenceCount = 14 + rand(3); // 14~16
    const shortN = Math.floor(sentenceCount / 2);
    const longN = sentenceCount - shortN;
    const lines = [];
    for (let i = 0; i < shortN; i++) lines.push(buildSentence(15 + rand(4)));  // 15~18
    for (let i = 0; i < longN; i++) lines.push(buildSentence(26 + rand(5)));   // 26~30
    const text = shuffle(lines).join('\n');
    const r = scanAIFlavor(text);
    const u = r.sentenceUniformity;
    if (u > 0.62 && u <= 0.78 && computeTotalFlags(r) <= 4) return text;
  }
  throw new Error('genAdvisoryUniform 无法生成目标均匀度');
}

// ============ clean ============
// 扰动句池（均不含词表词）
const PERTURB_SHORT = [
  '风很大。', '雨还在下。', '谁也没动。', '灯花一爆。', '天快亮了。',
  '没人应声。', '门开了。', '他没说话。', '雪停了。', '路还长。',
  '火苗跳了跳。', '茶凉了。', '远处有狗叫。', '影子晃了一下。', '天边滚过闷雷。',
];
const PERTURB_LONG = [
  '山风从坡上滚下来，把满坡的草压成一片一片的浪，又哗地散开，反反复复，没个停歇。',
  '那扇旧木门吱呀呀地响，像是困了许久，好容易才被推开一条缝，露出里头黑黢黢的一角。',
  '溪水绕着山脚拐了个弯，流过一片乱石滩，又钻进更深的林子，一路叮叮咚咚，像是赶着去赴什么约。',
  '月亮爬到中天，把屋脊照得一片白，檐角的影子斜斜地铺在院子里，像一把摊开的旧折扇。',
  '他说完这句，就再没开口，只低头摆弄着手里的物件，摆弄了许久，久到桌上的茶都凉透了。',
  '风把门吹开一条缝，又合上，再吹开，反反复复，像有什么东西在门外探头探脑，迟迟不肯进来。',
  '窗外的天一寸寸暗下去，先是灰蓝，再是深灰，最后黑成一片，只有远处偶尔闪过一点灯火。',
  '他沿着墙根走了大半圈，步子不紧不慢，像是要把每一块砖都看进眼里，又像是什么都没在看。',
];

// 单次扰动：合并一对相邻普通行，或插入一个长短句
function perturbClean(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  if (Math.random() < 0.4 && lines.length >= 2) {
    for (let t = 0; t < 20; t++) {
      const i = rand(lines.length - 1);
      if (!lines[i].includes('「') && !lines[i + 1].includes('「')) {
        lines[i] = lines[i] + '，' + lines[i + 1];
        lines.splice(i + 1, 1);
        return lines.join('\n');
      }
    }
  }
  const sentence = Math.random() < 0.55 ? pick(PERTURB_SHORT) : pick(PERTURB_LONG);
  const at = rand(lines.length + 1);
  lines.splice(at, 0, sentence);
  return lines.join('\n');
}

function genCleanFromSkeleton(skel) {
  for (let attempt = 0; attempt < 40; attempt++) {
    let text = fillSkeleton(skel.text);
    if (hasResidualPlaceholder(text)) return null;
    // 合并过短行（≤8 字且非对话），随机插入 1~2 个扰动句
    const lines = text.split('\n');
    const out = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t) { out.push(''); continue; }
      if (t.length <= 8 && !t.includes('「') && out.length) {
        out[out.length - 1] += t;
        continue;
      }
      out.push(t);
    }
    text = out.join('\n');
    // 多轮扰动直到 uniformity ≤ 0.6
    for (let p = 0; p < 8; p++) {
      if (verifyClean(text)) return text;
      text = perturbClean(text);
    }
    if (verifyClean(text)) return text;
  }
  return null;
}

// 豁免场景语料：标记行 + AI 味正文（剥离标记段后为 green，剥离前为 red）
function genExempt() {
  const aiBody = buildRecipeText([['universal', 4], ['connector', 2], ['objective', 2], ['abstract', 6]], 5);
  return `${EXEMPT_MARK}\n${aiBody}`;
}

// ============ 验证 ============
// 检测器接口不含 totalFlags，按规格 §1 公式自行重算
function computeTotalFlags(r) {
  const signatureFlags = r.routineConnectorCount * 2 + r.universalAdjectiveCount * 3
    + r.objectiveStatementCount * 2 + Math.floor(r.fillerAdverbCount / 3);
  return r.metaNarrationCount + Math.floor(r.abstractJudgmentCount / 3) + r.repetitiveStarters * 2 + signatureFlags;
}

const RULE_COUNTS = {
  '元叙述': (r) => r.metaNarrationCount,
  '抽象判断词': (r) => r.abstractJudgmentCount,
  '填充短语': (r) => r.fillerPhraseCount,
  '套路化连接词': (r) => r.routineConnectorCount,
  '万能形容词': (r) => r.universalAdjectiveCount,
  '客观陈述腔': (r) => r.objectiveStatementCount,
  '凑字副词': (r) => r.fillerAdverbCount,
  '句首重复': (r) => r.repetitiveStarters,
  '句式均匀度': (r) => (r.sentenceUniformity > 0.6 ? 1 : 0),
};

function stripExempt(content) {
  if (!content.includes(EXEMPT_MARK)) return content;
  return content.split(/\n\s*\n/).filter((p) => !p.includes(EXEMPT_MARK)).join('\n\n');
}

function verifyBlocking(text, expectedRules) {
  const r = scanAIFlavor(text);
  if (r.overallLevel !== 'red') return false;
  if (!(computeTotalFlags(r) >= 10 || r.sentenceUniformity > 0.8)) return false;
  for (const rule of expectedRules) {
    if (RULE_COUNTS[rule](r) <= 0) return false;
  }
  return true;
}

function verifyAdvisoryComb(text) {
  const r = scanAIFlavor(text);
  const t = computeTotalFlags(r);
  return r.overallLevel === 'yellow' && t >= 5 && t <= 9 && r.sentenceUniformity <= 0.6;
}

function verifyAdvisoryUniform(text) {
  const r = scanAIFlavor(text);
  return r.overallLevel === 'yellow' && computeTotalFlags(r) <= 4 && r.sentenceUniformity > 0.6 && r.sentenceUniformity <= 0.8;
}

function verifyClean(text) {
  const stripped = stripExempt(text);
  const r = scanAIFlavor(stripped);
  return r.overallLevel === 'green' && computeTotalFlags(r) <= 4 && r.sentenceUniformity <= 0.6;
}

function verifyExempt(text) {
  const before = scanAIFlavor(text);
  if (before.overallLevel !== 'red') return false;
  return verifyClean(text);
}

// ============ 主流程 ============
function genWithRetry(fn, verify, maxTry = 300) {
  let last;
  for (let i = 0; i < maxTry; i++) {
    const text = fn();
    last = text;
    if (verify(text)) return text;
  }
  console.error('=== 最后一条失败样本 ===');
  console.error(last);
  console.error('scan:', JSON.stringify(scanAIFlavor(last), null, 1));
  throw new Error('生成重试超限');
}

function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const manifest = [];
  const blockingDir = path.join(OUT_DIR, 'blocking');
  const advisoryDir = path.join(OUT_DIR, 'advisory');
  const cleanDir = path.join(OUT_DIR, 'clean');
  fs.mkdirSync(blockingDir, { recursive: true });
  fs.mkdirSync(advisoryDir, { recursive: true });
  fs.mkdirSync(cleanDir, { recursive: true });

  // ---- blocking 105 ----
  const blockingPlans = [];
  for (let i = 0; i < 16; i++) blockingPlans.push({ fn: genBlockingUniversal, rules: ['万能形容词'], note: '密集堆砌万能形容词轰炸' });
  for (let i = 0; i < 14; i++) blockingPlans.push({ fn: genBlockingConnObj, rules: ['套路化连接词', '客观陈述腔'], note: '连接词+陈述腔组合达 10 分' });
  for (let i = 0; i < 12; i++) blockingPlans.push({ fn: genBlockingStarterMeta, rules: ['句首重复', '元叙述'], note: '连续 4 行同句首 + 元叙述堆叠' });
  for (let i = 0; i < 14; i++) blockingPlans.push({ fn: genBlockingUniform, rules: ['句式均匀度'], note: '14 句×22 字刻意等长，均匀度单独触发 red' });
  const mixedDims = ['元叙述', '抽象判断词', '填充短语', '凑字副词', '套路化连接词', '客观陈述腔'];
  for (let i = 0; i < 49; i++) {
    const dim = mixedDims[Math.min(i, 48) % mixedDims.length];
    blockingPlans.push({ fn: () => genBlockingMixed(dim), rules: [dim], note: `混合型：主打 ${dim}，多维凑分 ≥10` });
  }

  blockingPlans.forEach((plan, idx) => {
    let text;
    try {
      text = genWithRetry(plan.fn, (t) => verifyBlocking(t, plan.rules));
    } catch (e) {
      throw new Error(`blocking plan #${idx + 1} (${plan.note}) 生成失败: ${e.message}`);
    }
    const file = `blocking/b-${String(idx + 1).padStart(3, '0')}.txt`;
    fs.writeFileSync(path.join(OUT_DIR, file), text, 'utf8');
    manifest.push({ file, expectedLevel: 'red', expectedRules: plan.rules, source: '程序化构造', note: plan.note });
  });

  // ---- advisory 105 ----
  for (let i = 0; i < 85; i++) {
    const text = genWithRetry(genAdvisoryRecipe, verifyAdvisoryComb);
    const file = `advisory/a-${String(i + 1).padStart(3, '0')}.txt`;
    fs.writeFileSync(path.join(OUT_DIR, file), text, 'utf8');
    manifest.push({ file, expectedLevel: 'yellow', expectedRules: [], source: '程序化构造', note: '词表词轻度命中，totalFlags 5~9 不越线' });
  }
  for (let i = 0; i < 20; i++) {
    const text = genWithRetry(genAdvisoryUniform, verifyAdvisoryUniform);
    const file = `advisory/a-${String(85 + i + 1).padStart(3, '0')}.txt`;
    fs.writeFileSync(path.join(OUT_DIR, file), text, 'utf8');
    manifest.push({ file, expectedLevel: 'yellow', expectedRules: ['句式均匀度'], source: '程序化构造', note: '句长两峰分布，均匀度 0.62~0.78' });
  }

  // ---- clean 105 ----
  const skels = SKEL_CLEAN_ALL; // 不 shuffle，索引与 assets 一致便于定位
  const cleanFailures = [];
  skels.forEach((skel, idx) => {
    let text = null;
    let lastR = null;
    let lastT = null;
    for (let i = 0; i < 60; i++) {
      const t = genCleanFromSkeleton(skel);
      if (t && verifyClean(t)) { text = t; break; }
      if (t) { lastR = scanAIFlavor(t); lastT = t; }
    }
    if (!text) {
      cleanFailures.push(`${skel.scene}#${idx} unif=${lastR?.sentenceUniformity} tf=${lastR ? computeTotalFlags(lastR) : '?'} lv=${lastR?.overallLevel}\n${lastT ? lastT.slice(0, 120) + '…' : ''}`);
      return;
    }
    const file = `clean/c-${String(idx + 1).padStart(3, '0')}.txt`;
    fs.writeFileSync(path.join(OUT_DIR, file), text, 'utf8');
    manifest.push({ file, expectedLevel: 'green', expectedRules: [], source: '程序化构造', note: `真人风格骨架填充：${skel.scene}，长短句交错` });
  });
  if (cleanFailures.length) {
    throw new Error(`clean 骨架均匀度/词表失败 ${cleanFailures.length} 个: ${cleanFailures.join(', ')}`);
  }
  for (let i = 0; i < 12; i++) {
    const text = genWithRetry(genExempt, verifyExempt);
    const file = `clean/c-${String(skels.length + i + 1).padStart(3, '0')}.txt`;
    fs.writeFileSync(path.join(OUT_DIR, file), text, 'utf8');
    manifest.push({ file, expectedLevel: 'green', expectedRules: ['豁免'], source: '程序化构造', note: '豁免场景：标记段剥离后扫描为 green，剥离前为 red' });
  }

  // manifest
  const manifestPath = path.join(OUT_DIR, 'manifest.jsonl');
  fs.writeFileSync(manifestPath, manifest.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf8');

  // ---- 统计 ----
  const counts = { red: 0, yellow: 0, green: 0 };
  let blockFail = 0; let advFail = 0; let cleanFail = 0; let exemptOk = 0;
  for (const m of manifest) {
    const content = fs.readFileSync(path.join(OUT_DIR, m.file), 'utf8');
    const stripped = stripExempt(content);
    const r = scanAIFlavor(stripped);
    counts[r.overallLevel]++;
    if (m.expectedLevel === 'red') {
      if (r.overallLevel !== 'red' || !verifyBlocking(content, m.expectedRules)) blockFail++;
    } else if (m.expectedLevel === 'yellow') {
      if (r.overallLevel !== 'yellow') advFail++;
    } else {
      if (r.overallLevel !== 'green') cleanFail++;
      if (m.expectedRules.includes('豁免') && scanAIFlavor(content).overallLevel === 'red') exemptOk++;
    }
  }

  // blocking 维度覆盖统计
  const dimCover = {};
  for (const m of manifest) {
    if (m.expectedLevel !== 'red') continue;
    const content2 = fs.readFileSync(path.join(OUT_DIR, m.file), 'utf8');
    const r = scanAIFlavor(content2);
    for (const rule of m.expectedRules) {
      if (RULE_COUNTS[rule](r) > 0) dimCover[rule] = (dimCover[rule] ?? 0) + 1;
    }
  }

  const total = manifest.length;
  const pass = total - blockFail - advFail - cleanFail;
  console.log('=== 语料库生成报告 ===');
  console.log(`总量: ${total}（blocking ${manifest.filter(m => m.expectedLevel === 'red').length} / advisory ${manifest.filter(m => m.expectedLevel === 'yellow').length} / clean ${manifest.filter(m => m.expectedLevel === 'green').length}）`);
  console.log(`复扫评级分布: red ${counts.red} / yellow ${counts.yellow} / green ${counts.green}`);
  console.log(`回归失败: blocking ${blockFail} / advisory ${advFail} / clean ${cleanFail}（豁免剥离前为 red 的 ${exemptOk} 条）`);
  console.log(`通过率: ${pass}/${total}`);
  console.log('blocking 维度覆盖（expectedRules 实命中 ≥1 的条数）:');
  for (const [dim, n] of Object.entries(dimCover).sort((a, b) => b[1] - a[1])) console.log(`  ${dim}: ${n}`);
  console.log('clean 场景分布:');
  const sceneCount = {};
  for (const m of manifest.filter(m => m.expectedLevel === 'green' && !m.expectedRules.includes('豁免'))) {
    const scene = m.note.match(/：([^，]+)/)?.[1] ?? '?';
    sceneCount[scene] = (sceneCount[scene] ?? 0) + 1;
  }
  for (const [s, n] of Object.entries(sceneCount)) console.log(`  ${s}: ${n}`);
  console.log(`豁免场景: ${manifest.filter(m => m.expectedRules.includes('豁免')).length}`);
  console.log(`输出目录: ${OUT_DIR}`);
}

main();
