/**
 * 15-SRS P0-1 验收：第3章赤霞真人片段 → 提取器输出 gender='male'
 * 用法：pnpm exec tsx test-extract-gender.ts（消耗少量 LLM token）
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const { customEntityExtractorAgent } = await import('./src/agents/custom-entity-extractor.js');

const chapter3 = `第三章 山中道观
暮色四合，王林拾级而上。道观门前立着一位道人，正是赤霞真人。他是个中年男人，青布道袍洗得发白，颧骨很高，下巴上有一颗黑痣。赤霞真人打量了他一眼，淡淡道："你来了。"王林躬身行礼，不敢直视。赤霞真人拂尘一摆，引他入内。殿中烛火摇曳，墙上悬着一柄古剑。赤霞真人道："从今日起，你便留在观中洒扫。"王林应了，心中却隐隐不安。`;

const result = await customEntityExtractorAgent.extract(chapter3, {
  existingCharacters: [],
  existingWeapons: [],
  existingTechniques: [],
  existingLocations: [],
  zhuxianCharacters: [],
  sensitivity: 'balanced',
  extractWeapons: false,
  extractTechniques: false,
  extractLocations: false,
});

const chixia = result.newCharacters.find((c) => c.name.includes('赤霞真人'));
console.log('提取结果 newCharacters =', JSON.stringify(result.newCharacters, null, 2));
if (chixia && chixia.gender === 'male') {
  console.log('✅ P0-1 验收通过：赤霞真人 gender=male');
  process.exit(0);
} else {
  console.log(`❌ P0-1 验收失败：赤霞真人 gender=${chixia?.gender ?? '未提取到'}`);
  process.exit(1);
}
