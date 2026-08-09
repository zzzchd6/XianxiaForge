/**
 * 叙事体检服务（天命P2#7 / 阶段3 联动整合 / 阶段4 因果链）
 * 9维度健康度扫描，纯规则零LLM，输出结构化体检报告
 * 维度：目录连续性 / 缓冲比健康度 / 伏笔生命周期 / 角色状态链 / 时代与实体 / 待决议事项
 *       / 方向均衡度（阶段3） / 影响健康度（阶段3） / 因果链健康度（阶段4）
 */
import { eq, and, asc, sql } from 'drizzle-orm';
import { creativeDb } from '../db/index.js';
import * as schema from '../db/creative-schema.js';
import {
  getSelectedDirectionChain,
  computeDirectionStats,
  checkConsecutiveDirection,
} from './direction.service.js';
import { getCausalStats } from './impact/causal-chain.service.js';

export type RiskLevel = 'high' | 'medium' | 'low';

export interface HealthIssue {
  dimension: string;
  level: RiskLevel;
  message: string;
  detail?: string;
}

export interface HealthReport {
  projectId: number;
  volumeNo: number | null; // null = 全书
  generatedAt: string;
  dimensions: {
    name: string;
    score: number; // 0-100
    issues: HealthIssue[];
  }[];
  overallScore: number;
  summary: { high: number; medium: number; low: number };
}

/**
 * 执行体检
 * @param projectId 项目ID
 * @param volumeNo 可选，指定卷号；null=全书
 */
export async function runHealthCheck(projectId: number, volumeNo: number | null = null): Promise<HealthReport> {
  const dimensions: HealthReport['dimensions'] = [];

  // 获取章节计划
  const chapterConds = [eq(schema.chapterPlan.projectId, projectId)];
  if (volumeNo != null) chapterConds.push(eq(schema.chapterPlan.volumeNo, volumeNo));
  const chapters = await creativeDb
    .select()
    .from(schema.chapterPlan)
    .where(and(...chapterConds))
    .orderBy(asc(schema.chapterPlan.volumeNo), asc(schema.chapterPlan.chapterNo));

  // ===== 维度1：目录连续性 =====
  const dim1Issues: HealthIssue[] = [];
  if (chapters.length > 0) {
    // 按卷分组检查章序连续性
    const byVolume = new Map<number, number[]>();
    for (const ch of chapters) {
      const vol = ch.volumeNo ?? 1;
      if (!byVolume.has(vol)) byVolume.set(vol, []);
      byVolume.get(vol)!.push(ch.chapterNo);
    }
    for (const [vol, nos] of byVolume) {
      nos.sort((a, b) => a - b);
      for (let i = 1; i < nos.length; i++) {
        if (nos[i] - nos[i - 1] > 1) {
          dim1Issues.push({
            dimension: '目录连续性',
            level: 'medium',
            message: `第${vol}卷章序跳跃：第${nos[i - 1]}章 → 第${nos[i]}章（缺${nos[i] - nos[i - 1] - 1}章）`,
          });
        }
      }
      if (nos[0] !== 1) {
        dim1Issues.push({
          dimension: '目录连续性',
          level: 'low',
          message: `第${vol}卷起始章号非1（从第${nos[0]}章开始）`,
        });
      }
    }
  } else {
    dim1Issues.push({ dimension: '目录连续性', level: 'low', message: '暂无章节计划' });
  }
  const dim1Score = Math.max(0, 100 - dim1Issues.filter(i => i.level === 'medium').length * 20 - dim1Issues.filter(i => i.level === 'low').length * 5);
  dimensions.push({ name: '目录连续性', score: dim1Score, issues: dim1Issues });

  // ===== 维度2：缓冲比健康度 =====
  const dim2Issues: HealthIssue[] = [];
  const bufferTypes = ['buffer_price', 'buffer_dialog', 'buffer_clue'];
  const typedChapters = chapters.filter(ch => ch.chapterType);
  if (typedChapters.length >= 5) {
    const bufferCount = typedChapters.filter(ch => bufferTypes.includes(ch.chapterType || '')).length;
    const ratio = bufferCount / typedChapters.length;
    if (ratio < 0.25) {
      dim2Issues.push({
        dimension: '缓冲比健康度',
        level: 'medium',
        message: `缓冲章占比过低：${(ratio * 100).toFixed(0)}%（建议30%-40%），读者可能疲劳`,
      });
    } else if (ratio > 0.50) {
      dim2Issues.push({
        dimension: '缓冲比健康度',
        level: 'medium',
        message: `缓冲章占比过高：${(ratio * 100).toFixed(0)}%（建议30%-40%），节奏可能拖沓`,
      });
    }
  } else if (typedChapters.length > 0 && typedChapters.length < 5) {
    dim2Issues.push({ dimension: '缓冲比健康度', level: 'low', message: '章节类型标注不足5章，无法评估缓冲比' });
  }
  const dim2Score = Math.max(0, 100 - dim2Issues.filter(i => i.level === 'medium').length * 25 - dim2Issues.filter(i => i.level === 'low').length * 5);
  dimensions.push({ name: '缓冲比健康度', score: dim2Score, issues: dim2Issues });

  // ===== 维度3：伏笔生命周期 =====
  const dim3Issues: HealthIssue[] = [];
  const foreshadowConds = [eq(schema.foreshadowThread.projectId, projectId)];
  const foreshadows = await creativeDb
    .select()
    .from(schema.foreshadowThread)
    .where(and(...foreshadowConds));

  const planted = foreshadows.filter(f => f.status === 'planted');
  const pending = foreshadows.filter(f => f.status === 'pending');
  // 超期：planted且plantChapter距当前进度超过10章
  const maxChapter = chapters.length > 0 ? Math.max(...chapters.map(c => c.chapterNo)) : 0;
  const overdue = planted.filter(f => f.plantChapter != null && (maxChapter - f.plantChapter) >= 10);

  if (overdue.length > 0) {
    dim3Issues.push({
      dimension: '伏笔生命周期',
      level: overdue.length >= 3 ? 'high' : 'medium',
      message: `${overdue.length}条伏笔超期未回收（敞开≥10章）：${overdue.slice(0, 3).map(f => f.title).join('、')}${overdue.length > 3 ? '等' : ''}`,
    });
  }
  if (pending.length > 3) {
    dim3Issues.push({
      dimension: '伏笔生命周期',
      level: 'low',
      message: `${pending.length}条伏笔待埋入（pending状态积压）`,
    });
  }
  const dim3Score = Math.max(0, 100 - dim3Issues.filter(i => i.level === 'high').length * 30 - dim3Issues.filter(i => i.level === 'medium').length * 20 - dim3Issues.filter(i => i.level === 'low').length * 5);
  dimensions.push({ name: '伏笔生命周期', score: dim3Score, issues: dim3Issues });

  // ===== 维度4：角色状态链 =====
  const dim4Issues: HealthIssue[] = [];
  try {
    const snapshots = await creativeDb
      .select({ status: schema.characterStateSnapshot.status })
      .from(schema.characterStateSnapshot)
      .where(eq(schema.characterStateSnapshot.projectId, projectId));
    const pendingSnapshots = snapshots.filter(s => s.status === 'pending');
    if (pendingSnapshots.length > 5) {
      dim4Issues.push({
        dimension: '角色状态链',
        level: 'medium',
        message: `${pendingSnapshots.length}条状态快照待确认（pending），可能影响后续生成一致性`,
      });
    }
  } catch { /* 表不存在时跳过 */ }
  const dim4Score = Math.max(0, 100 - dim4Issues.filter(i => i.level === 'medium').length * 20);
  dimensions.push({ name: '角色状态链', score: dim4Score, issues: dim4Issues });

  // ===== 维度5：时代与实体 =====
  const dim5Issues: HealthIssue[] = [];
  try {
    const milestones = await creativeDb
      .select({ status: schema.timelineMilestone.status })
      .from(schema.timelineMilestone)
      .where(eq(schema.timelineMilestone.projectId, projectId));
    const pendingMilestones = milestones.filter(m => m.status === 'pending');
    if (pendingMilestones.length > 3) {
      dim5Issues.push({
        dimension: '时代与实体',
        level: 'low',
        message: `${pendingMilestones.length}条时间线里程碑待确认`,
      });
    }
  } catch { /* 表不存在时跳过 */ }
  const dim5Score = Math.max(0, 100 - dim5Issues.filter(i => i.level === 'medium').length * 20 - dim5Issues.filter(i => i.level === 'low').length * 10);
  dimensions.push({ name: '时代与实体', score: dim5Score, issues: dim5Issues });

  // ===== 维度6：待决议事项 =====
  const dim6Issues: HealthIssue[] = [];
  const pendingForeshadow = foreshadows.filter(f => f.status === 'pending').length;
  const totalPending = pendingForeshadow + pending.length;
  if (totalPending > 10) {
    dim6Issues.push({
      dimension: '待决议事项',
      level: 'medium',
      message: `积压待决议事项较多（伏笔pending=${pendingForeshadow}），建议定期清理`,
    });
  }
  // 检查高优先级伏笔中pending的
  const highPriorityPending = foreshadows.filter(f => f.status === 'pending' && f.priority === 'high');
  if (highPriorityPending.length > 0) {
    dim6Issues.push({
      dimension: '待决议事项',
      level: 'high',
      message: `${highPriorityPending.length}条高优先级伏笔仍为pending状态：${highPriorityPending.slice(0, 3).map(f => f.title).join('、')}`,
    });
  }
  const dim6Score = Math.max(0, 100 - dim6Issues.filter(i => i.level === 'high').length * 30 - dim6Issues.filter(i => i.level === 'medium').length * 15);
  dimensions.push({ name: '待决议事项', score: dim6Score, issues: dim6Issues });

  // ===== 维度7：方向均衡度（阶段3 剧情方向体系） =====
  const dim7Issues: HealthIssue[] = [];
  let dim7Score = 100;
  try {
    const [proj] = await creativeDb
      .select({ generationConfig: schema.creativeProject.generationConfig })
      .from(schema.creativeProject)
      .where(eq(schema.creativeProject.id, projectId))
      .limit(1);
    const directionConfig = ((proj?.generationConfig as any)?.directionConfig) ?? {};
    const chain = await getSelectedDirectionChain(projectId);
    const stats = computeDirectionStats(chain, {
      volumeNo: volumeNo ?? undefined,
      enabledCategories: directionConfig.enabledCategories,
    });
    if (stats.total === 0) {
      dim7Issues.push({ dimension: '方向均衡度', level: 'low', message: '暂无已选定分支的方向数据，无法评估均衡度' });
    } else {
      if (stats.balanceScore != null) {
        dim7Score = stats.balanceScore;
        if (stats.balanceScore < 60) {
          const top = stats.byCategory[0];
          dim7Issues.push({
            dimension: '方向均衡度',
            level: 'medium',
            message: `方向分布均衡度仅 ${stats.balanceScore} 分${top ? `（「${top.name}」占 ${top.percent}%）` : ''}，叙事方向偏单一`,
          });
        }
      }
      if (stats.unclassified > 0 && stats.unclassified >= Math.ceil(stats.total * 0.3)) {
        dim7Issues.push({
          dimension: '方向均衡度',
          level: 'low',
          message: `${stats.unclassified}/${stats.total} 个已选分支未分类方向，影响均衡度统计`,
        });
        dim7Score = Math.max(0, dim7Score - 5);
      }
      // 连续方向校验（锚定统计范围内最新章节）
      const scopeChain = volumeNo != null ? chain.filter((n) => n.volumeNo === volumeNo) : chain;
      if (scopeChain.length) {
        const anchorChapter = Math.max(...scopeChain.map((n) => n.chapterNo));
        const maxAllowed = Number(directionConfig.maxConsecutiveSameDirection) || 3;
        const chk = checkConsecutiveDirection(chain, anchorChapter, maxAllowed);
        if (chk.warning) {
          dim7Issues.push({
            dimension: '方向均衡度',
            level: 'medium',
            message: `「${chk.categoryName}」方向已连续 ${chk.consecutiveCount} 章（阈值 ${maxAllowed}），建议切换叙事方向`,
          });
          dim7Score = Math.max(0, dim7Score - 15);
        }
      }
    }
  } catch { /* 降级：方向体系异常不阻断体检 */ }
  dimensions.push({ name: '方向均衡度', score: Math.round(dim7Score), issues: dim7Issues });

  // ===== 维度8：影响健康度（阶段3 分支影响体系） =====
  const dim8Issues: HealthIssue[] = [];
  let dim8Score = 100;
  try {
    // 待确认快照积压（人物 + 世界）
    const [pendChar] = await creativeDb.execute(
      sql`SELECT COUNT(*)::int AS c FROM character_impact_snapshot WHERE project_id=${projectId} AND status='pending'`
    );
    const [pendWorld] = await creativeDb.execute(
      sql`SELECT COUNT(*)::int AS c FROM world_impact_snapshot WHERE project_id=${projectId} AND status='pending'`
    );
    const pendingTotal = Number(pendChar?.c ?? 0) + Number(pendWorld?.c ?? 0);
    if (pendingTotal > 5) {
      dim8Issues.push({
        dimension: '影响健康度',
        level: 'medium',
        message: `${pendingTotal} 条影响快照待确认（pending），请及时确认以免影响生成一致性`,
      });
      dim8Score -= 20;
    } else if (pendingTotal > 0) {
      dim8Issues.push({ dimension: '影响健康度', level: 'low', message: `${pendingTotal} 条影响快照待确认` });
      dim8Score -= 5;
    }
    // 各人物最新已确认状态中的风险型属性逼近上限（≥80）
    const latest = await creativeDb.execute(
      sql`SELECT DISTINCT ON (character_id) character_id, character_name, numeric_values
          FROM character_impact_snapshot
          WHERE project_id=${projectId} AND status='confirmed'
          ORDER BY character_id, chapter_no DESC`
    );
    const RISK_KEYS = ['character.shang_shi', 'character.xin_mo', 'character.tian_qian', 'character.dao_shang', 'character.ye_zhang'];
    const extremeChars: { name: string; hits: string[] }[] = [];
    for (const row of latest) {
      const nv = (row.numeric_values ?? {}) as Record<string, number>;
      const hits = RISK_KEYS.filter((k) => (nv[k] ?? 0) >= 80);
      if (hits.length) extremeChars.push({ name: String(row.character_name ?? `人物${row.character_id}`), hits });
    }
    if (extremeChars.length) {
      dim8Issues.push({
        dimension: '影响健康度',
        level: extremeChars.length >= 3 ? 'medium' : 'low',
        message: `${extremeChars.length} 位人物风险属性逼近上限（≥80）：${extremeChars.slice(0, 3).map((c) => c.name).join('、')}${extremeChars.length > 3 ? '等' : ''}，注意剧情承接与状态一致性`,
      });
      dim8Score -= extremeChars.length >= 3 ? 20 : 10;
    }
  } catch { /* 降级：影响体系异常不阻断体检 */ }
  dimensions.push({ name: '影响健康度', score: Math.max(0, dim8Score), issues: dim8Issues });

  // ===== 维度9：因果链健康度（阶段4 因果链体系） =====
  const dim9Issues: HealthIssue[] = [];
  let dim9Score = 100;
  try {
    const causalStats = await getCausalStats(projectId, volumeNo ? undefined : undefined);
    if (causalStats.overdue > 0) {
      dim9Issues.push({
        dimension: '因果链健康度',
        level: causalStats.overdue >= 3 ? 'medium' : 'low',
        message: `${causalStats.overdue} 条因果线已逾期未兑现（超过预期最晚章节），建议尽快在后续章节回收或标记废弃`,
      });
      dim9Score -= Math.min(40, causalStats.overdue * 15);
    }
    const unresolved = causalStats.planted + causalStats.foreshadowed + causalStats.triggered;
    if (unresolved > 8) {
      dim9Issues.push({
        dimension: '因果链健康度',
        level: 'low',
        message: `当前有 ${unresolved} 条未兑现因果线积压（planted=${causalStats.planted}, foreshadowed=${causalStats.foreshadowed}, triggered=${causalStats.triggered}），注意节奏控制`,
      });
      dim9Score -= 10;
    }
  } catch { /* 降级：因果链体系异常不阻断体检 */ }
  dimensions.push({ name: '因果链健康度', score: Math.max(0, dim9Score), issues: dim9Issues });

  // 综合
  const overallScore = Math.round(dimensions.reduce((a, d) => a + d.score, 0) / dimensions.length);
  const allIssues = dimensions.flatMap(d => d.issues);
  const summary = {
    high: allIssues.filter(i => i.level === 'high').length,
    medium: allIssues.filter(i => i.level === 'medium').length,
    low: allIssues.filter(i => i.level === 'low').length,
  };

  return {
    projectId,
    volumeNo,
    generatedAt: new Date().toISOString(),
    dimensions,
    overallScore,
    summary,
  };
}
