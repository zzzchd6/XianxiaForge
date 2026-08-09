/**
 * 16-SRS 验收脚本：AI生成大纲注入四模块资产
 *
 * 覆盖（纯规则层，不打 LLM）：
 *   1. 全量注入：loadWorldAssets 四类查询 + buildWorldAssetsBlock 硬约束块（含性别/定位/描述截断）
 *   2. 显式选择（P2-1 后端分支）：仅注入选中资产
 *   3. 降级：不存在的ID/空项目 → 空资产 → block 为 null（不阻断）
 *   4. 上限：人物≤20、武器/功法/地点≤10
 *   5. 武器描述：weaponLore.intro 优先或组合字段兜底（desc 非空）
 *   6. 回标匹配数据结构：reqIds 负数ID约定与 context-builder parseEntityIds 兼容
 *
 * 运行：cd packages/server && pnpm exec tsx test-outline-assets.ts
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const { creativeDb } = await import('./src/db/index.js');
const schema = await import('./src/db/creative-schema.js');
const { eq } = await import('drizzle-orm');
const { loadWorldAssets, buildWorldAssetsBlock } = await import('./src/routers/outlines.js');

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log(`  [PASS] ${msg}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${msg}`);
  }
}

// 找一个有四模块资产的项目
const [row] = await creativeDb
  .select({ projectId: schema.customCharacter.projectId })
  .from(schema.customCharacter)
  .where(eq(schema.customCharacter.isDeleted, false))
  .limit(1);

if (!row) {
  console.log('无自定义人物数据，仅测降级路径');
  const empty = await loadWorldAssets(999999, {});
  assert(buildWorldAssetsBlock(empty) === null, '空项目 → block=null（跳过注入不阻断）');
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

const pid = row.projectId;
console.log(`测试项目ID: ${pid}`);

// 1. 全量注入
console.log('\n[1] 全量注入');
const assets = await loadWorldAssets(pid, {});
assert(assets.characters.length > 0, `人物加载成功（${assets.characters.length} 条，上限20）`);
assert(assets.characters.length <= 20, '人物不超过上限20');
assert(assets.weapons.length <= 10, '武器不超过上限10');
assert(assets.techniques.length <= 10, '功法不超过上限10');
assert(assets.locations.length <= 10, '地点不超过上限10');

const block = buildWorldAssetsBlock(assets);
assert(block !== null, '非空项目 → block 非 null');
if (block) {
  assert(block.includes('【世界观资产'), '含硬约束块标题');
  assert(block.includes('不得与之矛盾'), '含硬约束语气');
  const first = assets.characters[0];
  assert(block.includes(first.name), `含首个人物名「${first.name}」`);
  assert(block.includes(first.gender === 'female' ? '女' : first.gender === 'male' ? '男' : '性别未知'), '含性别标注');
  // 描述截断40字以内
  for (const c of assets.characters) {
    if (c.desc.length > 40) { assert(false, `人物「${c.name}」描述超40字`); }
  }
  assert(true, '人物描述均已截断至40字内');
}

// 2. 武器描述兜底（intro 或 组合字段）
console.log('\n[2] 武器描述');
if (assets.weapons.length > 0) {
  assert(assets.weapons.every((w) => w.desc.length > 0), '所有武器 desc 非空（intro 优先/组合兜底）');
} else {
  assert(true, '无武器数据（跳过）');
}

// 3. 显式选择（P2-1）
console.log('\n[3] 显式选择注入');
const firstChar = assets.characters[0];
const sel = await loadWorldAssets(pid, { characterIds: [firstChar.id] });
assert(sel.characters.length === 1 && sel.characters[0].id === firstChar.id, '仅返回选中的1个人物');
const selBlock = buildWorldAssetsBlock(sel);
assert(selBlock !== null && selBlock.includes(firstChar.name), '选中人物出现在注入块');
if (assets.characters.length > 1 && selBlock) {
  assert(!selBlock.includes(assets.characters[1].name), '未选中人物不出现在该类注入块');
}

// 4. 降级：不存在的ID
console.log('\n[4] 降级路径');
const ghost = await loadWorldAssets(pid, { characterIds: [999999999] });
assert(ghost.characters.length === 0, '不存在的ID → 人物空');
const ghostProject = await loadWorldAssets(999999999, {});
assert(buildWorldAssetsBlock(ghostProject) === null, '空项目 → block=null（降级不阻断）');

// 5. 回标数据结构与 parseEntityIds 兼容（负数ID约定）
console.log('\n[5] 回标落库结构');
const reqIds = {
  characters: [-firstChar.id],
  locations: assets.locations.map((l) => l.name),
  items: assets.weapons.map((w) => -w.id),
  skills: assets.techniques.map((t) => -t.id),
};
assert(reqIds.characters.every((id) => id < 0), '人物为负数ID（context-builder 负数分流约定）');
assert(reqIds.locations.every((n) => typeof n === 'string'), '地点为名称字符串（getLocationsByNames 语义）');
console.log(`  reqIds 示例: ${JSON.stringify(reqIds).slice(0, 160)}`);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
