/**
 * 服务入口 - AI小说创作系统后端
 * Hono + Drizzle ORM + PostgreSQL + pgvector
 */
import './env.js'; // 必须最先导入，加载.env环境变量

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

// 路由
import projectsRouter from './routers/projects.js';
import outlinesRouter from './routers/outlines.js';
import chaptersRouter from './routers/chapters.js';
import scenesRouter from './routers/scenes.js';
import generationRouter from './routers/generation.js';
import worldRouter from './routers/world.js';
import settingsRouter from './routers/settings.js';
import stateRouter from './routers/state.js';
import foreshadowRouter from './routers/foreshadow.js';
import taskArcRouter from './routers/task-arc.js';
import growthRouter from './routers/growth.js';
import relationRouter from './routers/relation.js';
import quotesRouter from './routers/quotes.js';
import workshopRouter from './routers/workshop.js';
import plotMaterialsRouter from './routers/plot-materials.js';
import debtGateRouter from './routers/debt-gate.js';
import benchmarkRouter from './routers/benchmark.js';
import { dualEngineRouter } from './routers/dual-engine.js';
import usageRouter from './routers/usage.js';
import materialsRouter from './routers/materials.js';
import healthRouter from './routers/health.js';
import impactRouter from './routers/impact.js';
import causalChainRouter from './routers/causal-chain.js';
import customCharactersRouter from './routers/custom-characters.js';
import customWeaponsRouter from './routers/custom-weapons.js';
import customTechniquesRouter from './routers/custom-techniques.js';
import techniqueVariantsRouter from './routers/technique-variants.js';
import characterMartialRouter from './routers/character-martial.js';
import hotspotRouter from './routers/hotspot.js';
import materialKbRouter from './routers/material-knowledge.js';
import treasureRouter from './routers/treasure.js';
import techniquesRouter from './routers/techniques.js';
import characterAspectsRouter from './routers/character-aspects.js';
import customMapsRouter from './routers/custom-maps.js';
import customLocationsRouter from './routers/custom-locations.js';
import exportRouter from './routers/export.js';
import polishRouter from './routers/polish.js';
import narrativeRouter from './routers/narrative.js';
import { recoverStaleTasks, startQueueWorker } from './pipeline/queue.js';

const app = new Hono();

// ===== 全局中间件 =====

// CORS中间件 - 允许前端开发服务器访问
app.use('/*', cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// 请求日志中间件
app.use('/*', logger());

// 请求体大小限制（通过自定义中间件）
app.use('/*', async (c, next) => {
  const startTime = Date.now();
  await next();
  const elapsed = Date.now() - startTime;
  console.log(`[${c.req.method}] ${c.req.path} - ${c.res.status} (${elapsed}ms)`);
});

// ===== 健康检查 =====
app.get('/api/health', (c) => {
  return c.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
  });
});

// ===== 注册路由 =====

// 项目管理
app.route('/api/projects', projectsRouter);

// 项目导出/导入（架构升级 Epic5）
app.route('/api', exportRouter);

// 大纲管理（混合路由：/api/projects/:id/outlines 和 /api/outlines/:id）
app.route('/api', outlinesRouter);

// 章节管理（混合路由：/api/projects/:id/chapters 和 /api/chapters/:id）
app.route('/api', chaptersRouter);

// 独立润色（架构升级 Epic3：/api/projects/:pid/chapters/:cid/polish）
app.route('/api', polishRouter);

// 场景脚本（路由：/api/projects/:id/outlines/:outlineId/scenes/*）
app.route('/api', scenesRouter);

// 生成任务
app.route('/api/generation', generationRouter);

app.route('/api', debtGateRouter);

// 用量统计（开源借鉴 PRD v1.1 M3）
app.route('/api', usageRouter);

// 对标素材/拆文（开源借鉴 PRD v1.1 M5）
app.route('/api', benchmarkRouter);

// 雪花法渐进大纲已归一化至 outlines 路由（stepwise-draft/finalize + generate mode=stepwise）

// 冲突与台词双引擎（PRD v1.3：/api/v1/dialogue/* + /api/v1/conflict/* + /api/v1/validate）
app.route('/api', dualEngineRouter);

// 世界观浏览
app.route('/api/world', worldRouter);

// 设置
app.route('/api/settings', settingsRouter);

// 全局状态追踪（混合路由：/api/projects/:id/state/* 和 /api/state/*）
app.route('/api', stateRouter);

// 伏笔台账（混合路由：/api/projects/:id/foreshadow/* 和 /api/foreshadow/*）
app.route('/api', foreshadowRouter);

// 任务链台账（路由：/api/projects/:pid/tasks/*）
app.route('/api', taskArcRouter);

// 动态叙事引擎（12-SRS：/api/projects/:pid/narrative/*，里程碑+分支弧+汇合引擎）
app.route('/api', narrativeRouter);

// 叙事体检（天命P2#7）
app.route('/api', healthRouter);

// 人物成长弧光卡点（混合路由：/api/projects/:id/growth-stages 和 /api/growth-stages/*）
app.route('/api', growthRouter);

// 人物关系动态推演（混合路由：/api/projects/:id/relations 和 /api/relations/*）
app.route('/api', relationRouter);

// 名场面+金句素材库（混合路由：/api/projects/:id/quotes 和 /api/quotes/*）
app.route('/api', quotesRouter);

// 功法/法宝成长工坊（模块9：/api/projects/:id/workshop/*）
app.route('/api', workshopRouter);

// 剧情素材浏览（二期RAG人工干预：/api/projects/:id/plot-materials）
app.route('/api', plotMaterialsRouter);

// 剧情素材收藏切换（配套改造7.2：/api/materials/collect）
app.route('/api', materialsRouter);

// 分支影响体系（混合路由：/api/projects/:id/impact/* 与 /api/impact/definitions/*）
app.route('/api', impactRouter);

// 因果链（阶段4：/api/projects/:id/causal-chains/*）
app.route('/api', causalChainRouter);

// 自定义武器（/api/projects/:id/custom-weapons/*）
app.route('/api', customWeaponsRouter);

// 自定义功法（/api/projects/:id/custom-techniques/*，九大道则体系，无品级）
app.route('/api', customTechniquesRouter);

// 人物功法个人变种（/api/projects/:pid/characters/:characterId/techniques/*，千人千面法则）
app.route('/api', techniqueVariantsRouter);

// 人物武学档案（/api/projects/:pid/custom-characters/:cid/martial/*，功法×武器招式融合+小传）
app.route('/api', characterMartialRouter);

// 自定义人物（/api/projects/:projectId/custom-characters/*，对外负数ID）
app.route('/api', customCharactersRouter);

// 热点嗅探（/api/hotspot/*：抓榜单→LLM提炼→推送素材库）
app.route('/api/hotspot', hotspotRouter);

// 素材知识库（/api/material-kb/*：文风预设/领域知识浏览软删 + 蒸馏ETL代理）
app.route('/api/material-kb', materialKbRouter);

// 淘宝系统（/api/projects/:pid/treasure/*：十连淘宝/百宝囊/秘宝囊/五阶解锁）
app.route('/api', treasureRouter);

// 叙事技法库（/api/techniques/*：技法CRUD/推荐/章节技法关联/信息点）
app.route('/api', techniquesRouter);

// 角色心智（v1.4 PRD-A：/api/projects/:pid/voice-configs、knowledge、memory-cards、伏笔转化）
app.route('/api', characterAspectsRouter);

// 山河舆图（/api/projects/:id/custom-maps/*：地图CRUD+底图）
app.route('/api', customMapsRouter);

// 山河舆图（/api/projects/:id/custom-locations/*：地点CRUD+路径+距离+诛仙库导入）
app.route('/api', customLocationsRouter);

// ===== 404处理 =====
app.notFound((c) => {
  return c.json({ success: false, error: '接口不存在' }, 404);
});

// ===== 全局错误处理 =====
app.onError((err, c) => {
  console.error(`[ERROR] ${err.message}`, err.stack);
  return c.json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? '服务器内部错误' : err.message,
  }, 500);
});

// ===== 启动服务 =====
const port = Number(process.env.SERVER_PORT) || 3456;

console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║       AI小说创作系统 - 后端服务              ║');
console.log('╠══════════════════════════════════════════════╣');
console.log(`║  地址: http://localhost:${port}                ║`);
console.log(`║  环境: ${process.env.NODE_ENV || 'development'}                          ║`);
console.log('╚══════════════════════════════════════════════╝');
console.log('');

serve({
  fetch: app.fetch,
  port,
}, async (info) => {
  console.log(`[Server] 服务已启动，监听端口 ${info.port}`);
  console.log(`[Server] 访问地址: http://localhost:${info.port}`);
  console.log(`[Server] 健康检查: http://localhost:${info.port}/api/health`);

  // 重启恢复：把卡在运行态的任务重置入队，再启动队列执行器
  try {
    const recovered = await recoverStaleTasks();
    if (recovered > 0) console.log(`[Queue] 已恢复 ${recovered} 个卡死任务重新入队`);
  } catch (e: any) {
    console.error(`[Queue] 重启恢复失败: ${e.message}`);
  }
  startQueueWorker();
});

export default app;
