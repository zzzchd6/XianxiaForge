import './src/env.js';
import { Hono } from 'hono';
import worldRouter from './src/routers/world.js';

const app = new Hono();
app.route('/api/world', worldRouter);

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
}

async function main() {
  console.log('=== 功法详情接口 GET /api/world/skills/:id ===');
  {
    const res = await app.request('/api/world/skills/1');
    const body = await res.json();
    assert(res.status === 200, 'skill/1 返回 200');
    assert(body.success === true, 'skill/1 success=true');
    assert(body.data?.name === '太极玄清道', `skill/1 name=太极玄清道 (实际:${body.data?.name})`);
    assert(typeof body.data?.grade === 'string', 'skill/1 有 grade 字段');
  }
  {
    const res = await app.request('/api/world/skills/99999');
    assert(res.status === 404, 'skill/99999 返回 404');
  }
  {
    const res = await app.request('/api/world/skills/abc');
    assert(res.status === 400, 'skill/abc 返回 400');
  }

  console.log('\n=== 功法蒸馏接口 GET /api/world/skills/:id/distill ===');
  {
    // skill_id=1 太极玄清道：有 attribute/move/relation/archive
    const res = await app.request('/api/world/skills/1/distill');
    const body = await res.json();
    assert(res.status === 200, 'distill/1 返回 200');
    assert(body.success === true, 'distill/1 success=true');
    const d = body.data;
    assert(Array.isArray(d.attributes), 'distill/1 attributes 是数组');
    assert(Array.isArray(d.moves), 'distill/1 moves 是数组');
    assert(Array.isArray(d.relations), 'distill/1 relations 是数组');
    assert(Array.isArray(d.archive), 'distill/1 archive 是数组');
    assert(d.attributes.length >= 1, `distill/1 attributes>=1 (实际:${d.attributes.length})`);
    assert(d.moves.length >= 1, `distill/1 moves>=1 (实际:${d.moves.length})`);
    assert(d.relations.length >= 1, `distill/1 relations>=1 (实际:${d.relations.length})`);
    assert(d.archive.length >= 1, `distill/1 archive>=1 (实际:${d.archive.length})`);
    // 结构校验：前端 SkillDetail 依赖的字段
    const a = d.attributes[0];
    assert('grade' in a && 'effect' in a && 'element' in a && 'difficulty' in a, 'attribute 含 grade/effect/element/difficulty');
    const m = d.moves[0];
    assert('moveName' in m && 'effect' in m && 'requirement' in m, 'move 含 moveName/effect/requirement');
    const r = d.relations[0];
    assert('relationType' in r && 'targetTechnique' in r && 'description' in r, 'relation 含 relationType/targetTechnique/description');
    const arc = d.archive[0];
    assert('distillSource' in arc && 'distillVersion' in arc && 'contentJson' in arc, 'archive 含 distillSource/distillVersion/contentJson');
    assert(arc.distillSource === 'zaomeng', `archive distillSource=zaomeng (实际:${arc.distillSource})`);
  }
  {
    // skill_id=9 痴情咒：验证另一条数据
    const res = await app.request('/api/world/skills/9/distill');
    const body = await res.json();
    const d = body.data;
    assert(res.status === 200 && body.success, 'distill/9 返回成功');
    assert(d.attributes.some((a: any) => a.grade === '禁术级'), 'distill/9 痴情咒品阶=禁术级');
    assert(d.relations.some((r: any) => r.targetTechnique === '诛仙剑' && r.relationType === '克制'), 'distill/9 有克制诛仙剑关系');
  }
  {
    // 无蒸馏数据的功法：返回空数组而非报错
    const res = await app.request('/api/world/skills/40/distill');
    const body = await res.json();
    assert(res.status === 200 && body.success, 'distill/40 返回成功');
    const d = body.data;
    assert(d.attributes.length === 0 && d.moves.length === 0 && d.relations.length === 0 && d.archive.length === 0, 'distill/40 四块均为空数组');
  }
  {
    const res = await app.request('/api/world/skills/xyz/distill');
    assert(res.status === 400, 'distill/xyz 返回 400');
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
