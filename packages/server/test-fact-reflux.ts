/**
 * 15-SRS 叙事事实自动回流 —— 纯规则验收脚本（零 token）
 * 覆盖：P1-1 人名锚定代词校验 / P0-4 buildHardFacts 回流注入 / P2-1 realm倒退+item消失
 * 用法：pnpm exec tsx test-fact-reflux.ts
 */
import { checkPronounGender, runFactCheck } from './src/rag/fact-checker.js';
import { buildHardFacts, type NarrativeFactRow } from './src/rag/context-builder.js';
import { detectRealmRegression, detectItemVanished, type ChapterUpdateEntry } from './src/services/custom-entity-pipeline.js';

let pass = 0, fail = 0;
function assert(cond: boolean, label: string, extra?: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}${extra ? ' → ' + extra : ''}`); }
}

// ============================================================
console.log('【P1-1】人名锚定代词校验');
// 1a. 混合性别场景（原盲区）：男角色后出现"她" → critical
{
  const facts = [
    { name: '赤霞真人', gender: 'male' as const },
    { name: '阿九', gender: 'female' as const },
  ];
  const content = '赤霞真人从门外走进来，她今日换了身深蓝色道袍。阿九垂手立在一旁。';
  const v = checkPronounGender(content, facts);
  const hit = v.find(x => x.message.includes('赤霞真人'));
  assert(!!hit && hit.severity === 'critical', '混合性别场景命中"赤霞真人……她"', JSON.stringify(v));
  assert(!v.some(x => x.message.includes('阿九')), '阿九无误报');
}
// 1b. 正确代词 → 零误报
{
  const facts = [{ name: '赤霞真人', gender: 'male' as const }];
  const v = checkPronounGender('赤霞真人从门外走进来，他今日换了身道袍。', facts);
  assert(v.length === 0, '正确使用"他"零误报', JSON.stringify(v));
}
// 1c. 对话内出现 → 不报
{
  const facts = [{ name: '阿九', gender: 'female' as const }, { name: '老沈', gender: 'male' as const }];
  const v = checkPronounGender('老沈笑着开口："阿九，对她说这些没用。"', facts);
  assert(!v.some(x => x.message.includes('阿九')), '对话内"阿九对她说"不报', JSON.stringify(v));
}
// 1d. 全场全男兜底仍生效（回归）
{
  const facts = [{ name: '老沈', gender: 'male' as const }];
  const v = checkPronounGender('山风吹过，她缓缓走来。', facts);
  assert(v.length > 0, '全场全男兜底策略仍生效');
}
// 1e. runFactCheck 综合入口不炸
{
  const r = runFactCheck('赤霞真人走来，她拂尘一挥。', {
    characterFacts: [{ name: '赤霞真人', gender: 'male' as const }, { name: '阿九', gender: 'female' as const }],
    timeAnchors: [],
    serialized: '',
  });
  assert(r.count > 0, 'runFactCheck 综合入口命中');
}

// ============================================================
console.log('【P0-4】buildHardFacts 跨章回流注入');
// 2a. 当章未提及的人物经 narrativeRows 注入，draft 标注待确认
{
  const rows: NarrativeFactRow[] = [{
    name: '赤霞真人',
    gender: 'male',
    description: '中年男人，青布道袍，颧骨很高，下巴上有一颗黑痣，目光沉静如水。',
    entityStatus: 'draft',
    chapterUpdates: [{ chapterNo: 3, volumeNo: 1, updateText: '以掌风击退妖物', category: 'other', extractedAt: '' }],
  }];
  const hf = buildHardFacts([], undefined, undefined, rows);
  assert(!!hf, '有回流行时注入非空');
  assert(!!hf && hf.serialized.includes('赤霞真人'), '序列化含人物名');
  assert(!!hf && hf.serialized.includes('（待确认）'), 'draft 标注（待确认）');
  assert(!!hf && hf.serialized.includes('第3章确认动态'), '含最近一条动态');
  assert(!!hf && hf.characterFacts[0]?.gender === 'male' && hf.characterFacts[0]?.pronoun === '他', 'gender/代词正确');
}
// 2b. 已被 autoLink 加载的人物不重复注入
{
  const rows: NarrativeFactRow[] = [{ name: '赤霞真人', gender: 'male', description: '中年男人', entityStatus: 'draft', chapterUpdates: [{}] }];
  const hf = buildHardFacts([{ id: -7, name: '赤霞真人', source: 'custom' } as any], undefined, undefined, rows);
  assert(!hf || hf.serialized === '', '已加载人物不重复注入');
}
// 2c. 无 narrativeRows 时行为与旧版一致（无 characters → undefined）
{
  const hf = buildHardFacts([], undefined, undefined, []);
  assert(hf === undefined, '无事实时返回 undefined（不注入）');
}

// ============================================================
console.log('【P2-1】realm 倒退 / item 消失');
const mk = (chapterNo: number, category: string, updateText: string): ChapterUpdateEntry =>
  ({ chapterNo, volumeNo: 1, updateText, category, extractedAt: '' });
// 3a. 境界倒退 → major
{
  const prev = [mk(2, 'realm', '突破至筑基')];
  const c = detectRealmRegression('王林', prev, '修为跌落回炼气');
  assert(!!c && c.severity === 'major' && c.type === 'realm_regression', '筑基→炼气触发 major 倒退警告', JSON.stringify(c));
}
// 3b. 正常升境不误报
{
  const prev = [mk(2, 'realm', '炼气三层')];
  const c = detectRealmRegression('王林', prev, '突破到筑基');
  assert(c === null, '炼气→筑基正常升境零误报');
}
// 3c. 无历史境界记录不报
{
  const c = detectRealmRegression('王林', [], '突破到筑基');
  assert(c === null, '无历史记录不报');
}
// 3d. item 消失 → minor
{
  const prev = [mk(1, 'item', '获得青锋剑')];
  const cs = detectItemVanished('王林', prev, '王林看着剑匣，青锋剑从未有过。', new Set(['青锋剑']));
  assert(cs.length === 1 && cs[0].severity === 'minor', 'item 消失触发 minor 警告', JSON.stringify(cs));
}
// 3e. 对话内否定不报
{
  const prev = [mk(1, 'item', '获得青锋剑')];
  const cs = detectItemVanished('王林', prev, '他笑道："青锋剑从未有过。"', new Set(['青锋剑']));
  assert(cs.length === 0, '对话内否定表述零误报');
}
// 3f. 正常持有表述不报
{
  const prev = [mk(1, 'item', '获得青锋剑')];
  const cs = detectItemVanished('王林', prev, '青锋剑嗡鸣震颤，寒光大盛。', new Set(['青锋剑']));
  assert(cs.length === 0, '正常持有表述零误报');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
