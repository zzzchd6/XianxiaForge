/**
 * 上下文验证脚本：负数ID自定义人物进入章节上下文（计划六-4）
 * 用法: pnpm --filter server exec tsx ../../scripts/test-custom-context.ts
 * 验证 buildContextForChapter 对负数 characterIds 的分流：
 *   自定义人物应出现在 context.characters 中且 source='custom'，
 *   携带 position/stance/outerPersonality/talents/weaknesses 扩展字段。
 */
import '../packages/server/src/env.js';
import { buildContextForChapter } from '../packages/server/src/rag/context-builder.js';

const CUSTOM_ID = Number(process.env.CUSTOM_ID || -2);
const PROJECT_ID = Number(process.env.PROJECT_ID || 5);

const chapterPlan = {
  id: 999999,
  chapterNumber: 1,
  volumeNo: 1,
  title: '上下文验证-临时章节',
  intent: '验证自定义人物负数ID进入上下文',
  targetWordCount: 3000,
  targetEmotion: null,
  conflictType: null,
  sceneBreakdown: null,
  requiredEntityIds: { characters: [CUSTOM_ID, 1] },
  povCharacterIds: [CUSTOM_ID],
};

const project = { id: PROJECT_ID, title: '大竹峰小计', genre: 'xianxia', styleGuide: null };

async function main() {
  const result = await buildContextForChapter(chapterPlan as any, project, []);
  const ctx = result.context;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`[ok]   ${name}`); }
  else { fail++; console.error(`[FAIL] ${name}${detail ? ` —— ${detail}` : ''}`); }
}

  const custom = ctx.characters.find((c: any) => c.source === 'custom');
  check('上下文包含 source=custom 人物', !!custom, `characters=${ctx.characters.map((c: any) => c.name).join(',')}`);
  if (custom) {
    const c = custom as any;
    check('姓名正确', c.name === '隐拙默', c.name);
    check('position 为定位名+职能描述', typeof c.position === 'string' && c.position.includes('达者'), c.position);
    check('position 不含具体境界名称', !/筑基|金丹|元婴|化神|合体|大乘|渡劫|炼气|太清|上清|玉清|重天|层境/.test(c.position ?? ''), c.position);
    check('stance 已注入', typeof c.stance === 'string' && c.stance.includes('50'), String(c.stance));
    check('outerPersonality 已注入', Array.isArray(c.outerPersonality) && c.outerPersonality.length >= 2, JSON.stringify(c.outerPersonality));
    check('talents 已注入', Array.isArray(c.talents) && c.talents.length >= 3, JSON.stringify(c.talents));
    check('weaknesses 已注入', Array.isArray(c.weaknesses) && c.weaknesses.length > 0, JSON.stringify(c.weaknesses));
  }
  const native = ctx.characters.find((c: any) => c.source !== 'custom');
  check('正数ID诛仙人物同批返回', !!native, JSON.stringify(ctx.characters.map((c: any) => ({ id: c.id, source: c.source }))));

  console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
