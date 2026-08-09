// PRD 优化版验证脚本：对「冲突与台词双引擎生成模块-PRD-优化版.md」做确定性断言
// 运行：node --test scripts/verify-prd-optimized.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const OPT = fileURLToPath(new URL('../冲突与台词双引擎生成模块-PRD-优化版.md', import.meta.url));

test('优化版 PRD 存在且非空', () => {
  const content = fs.readFileSync(OPT, 'utf8');
  assert.ok(content.length > 10000, '文档内容过短');
});

test('17 个一级章节齐全', () => {
  const content = fs.readFileSync(OPT, 'utf8');
  for (let i = 1; i <= 17; i++) {
    assert.match(content, new RegExp(`^# ${i}\\. `, 'm'), `缺少一级章节 ${i}`);
  }
});

test('原稿关键内容点全部保留', () => {
  const opt = fs.readFileSync(OPT, 'utf8');
  const keys = [
    '三层冰山台词法', '冲突三要素公式', '双引擎组合工作流', '情绪过山车',
    '指节发白', '废灵根', '道心破碎', '灵力波动不稳', '袖中手指掐了个法诀',
    '欲扬先抑', 'behavior_anchor_library', 'seven_inch_mapping', 'cross_validation',
    'phase1_words', 'emotional_weight', 'desire_type', 'Lv.5', '陶阿乙', '执法长老'
  ];
  const missing = keys.filter(k => !opt.includes(k));
  assert.deepEqual(missing, [], `原稿关键内容缺失: ${missing.join(', ')}`);
});

test('旧矛盾表述已清除、修订点已落实', () => {
  const opt = fs.readFileSync(OPT, 'utf8');
  // 「15字以内」只允许出现在修订说明行（引用旧值作变更说明），正文要求应为 25 字以内
  const matches = [...opt.matchAll(/15字以内/g)];
  const allowed = matches.every(m => {
    const lineStart = opt.lastIndexOf('\n', m.index) + 1;
    const lineEnd = opt.indexOf('\n', m.index) === -1 ? opt.length : opt.indexOf('\n', m.index);
    return opt.slice(lineStart, lineEnd).includes('修订说明');
  });
  assert.ok(allowed, `正文残留旧矛盾表述「15字以内」（非修订说明处）: ${matches.length} 处`);
  assert.ok(opt.includes('25字以内'), '缺少修订后的「25字以内」');
  assert.ok(opt.includes('分段判定标准'), '缺少偏差度分段判定（§7.7）');
  assert.ok(opt.includes('Step 3 输入数据契约'), '缺少 §9.5 数据契约');
  assert.ok(opt.includes('分步重生成联动规则'), '缺少 §7.3 联动规则');
  assert.ok(opt.includes('修订对照'), '缺少附录A 修订对照');
});

test('JSON Schema 块均可解析', () => {
  const opt = fs.readFileSync(OPT, 'utf8');
  const blocks = [...opt.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m => m[1]);
  assert.ok(blocks.length >= 3, `JSON 块数量不足: ${blocks.length}`);
  const schemas = blocks.filter(b => b.includes('"$schema"'));
  assert.ok(schemas.length >= 3, `Schema 块数量不足: ${schemas.length}`);
  for (const s of schemas) {
    assert.doesNotThrow(() => JSON.parse(s), 'JSON Schema 解析失败');
  }
});

test('v1.2 事实核查附录存在且含 file:line 证据', () => {
  const opt = fs.readFileSync(OPT, 'utf8');
  assert.ok(opt.includes('附录B：事实核查对照表'), '缺少附录B');
  assert.ok(opt.includes('v1.2'), '缺少 v1.2 版本标识');
  const evid = [...opt.matchAll(/packages\/server\/src\/[\w./-]+\.ts:\d+/g)];
  assert.ok(evid.length >= 10, `附录B 代码证据数量不足: ${evid.length}`);
  // 修正后的关键主张不再出现旧的不实表述（「沿用项目 4096 默认」仅允许存在于附录B B7 的引用列）
  const m4096 = [...opt.matchAll(/沿用项目 4096 默认/g)];
  const allowed4096 = m4096.every(x => {
    const lineStart = opt.lastIndexOf('\n', x.index) + 1;
    return opt.slice(lineStart, lineStart + 4) === '| B7';
  });
  assert.ok(allowed4096, 'LLM_MAX_TOKENS 不实主张残留于正文（非 B7 引用行）');
  assert.ok(opt.includes('主客户端实际硬编码 maxTokens=8192'), '缺少 LLM_MAX_TOKENS 修正说明');
  assert.ok(!opt.includes('identity/relationship 自动填充'), '未修正设定库字段表述');
  assert.ok(opt.includes('大纲节点**无** protagonist/desire/resistance/cost 字段'), '缺少大纲字段修正说明');
});
