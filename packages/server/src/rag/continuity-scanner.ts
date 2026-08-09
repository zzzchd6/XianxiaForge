/**
 * 连续性扫描器（需求4）
 * 桥段重复度检测：基于 chapter_plan.plot_fingerprint 历史数据，
 * 在滑动窗口内检测同类型桥段是否过于密集。
 * 零 LLM，纯规则。
 */

export type PlotFingerprint =
  | 'faceoff'      // 打脸/对抗
  | 'puzzle'       // 解谜/推理
  | 'showcase'     // 展示/装逼
  | 'dialogue'     // 对话推进
  | 'relation'     // 关系升温/降温
  | 'daily'        // 日常事件
  | 'upgrade'      // 装备/能力升级
  | 'crisis'       // 危机/遇险
  | 'reveal';      // 揭秘/真相

export interface DuplicationWarning {
  fingerprint: string;
  level: 'yellow' | 'red';
  count: number;
  window: number;
}

export interface DuplicationScanResult {
  fingerprintCounts: Record<string, number>;
  warnings: DuplicationWarning[];
  suggestion: string;
}

/**
 * 检测最近 N 章的桥段重复度
 * 预警阈值：10章窗口≥3次=黄色，15章窗口≥5次=红色
 */
export function scanPlotDuplication(
  recentFingerprints: Array<{ chapterNo: number; fingerprint: string }>
): DuplicationScanResult {
  const counts: Record<string, number> = {};
  const warnings: DuplicationWarning[] = [];

  // 统计全部
  for (const fp of recentFingerprints) {
    counts[fp.fingerprint] = (counts[fp.fingerprint] || 0) + 1;
  }

  // 10 章窗口黄警检测
  const last10 = recentFingerprints.slice(-10);
  const count10: Record<string, number> = {};
  for (const fp of last10) count10[fp.fingerprint] = (count10[fp.fingerprint] || 0) + 1;
  for (const [fp, c] of Object.entries(count10)) {
    if (c >= 3) warnings.push({ fingerprint: fp, level: 'yellow', count: c, window: 10 });
  }

  // 15 章窗口红警检测
  const last15 = recentFingerprints.slice(-15);
  const count15: Record<string, number> = {};
  for (const fp of last15) count15[fp.fingerprint] = (count15[fp.fingerprint] || 0) + 1;
  for (const [fp, c] of Object.entries(count15)) {
    if (c >= 5) warnings.push({ fingerprint: fp, level: 'red', count: c, window: 15 });
  }

  // 去重：同一指纹如果同时触发黄警和红警，只保留红警
  const redFingerprints = new Set(warnings.filter(w => w.level === 'red').map(w => w.fingerprint));
  const dedupedWarnings = warnings.filter(w => w.level === 'red' || !redFingerprints.has(w.fingerprint));

  // 生成建议
  let suggestion = '桥段分布健康，无明显重复。';
  if (dedupedWarnings.length > 0) {
    const reds = dedupedWarnings.filter(w => w.level === 'red');
    if (reds.length > 0) {
      suggestion = `【红色预警】${reds.map(r => `${r.fingerprint}(${r.count}次/${r.window}章)`).join('、')} 重复严重，建议返回卷纲层做桥段重置，至少插入1-2个全新事件类型。`;
    } else {
      suggestion = `【黄色预警】${dedupedWarnings.map(w => `${w.fingerprint}(${w.count}次/${w.window}章)`).join('、')} 出现重复，下一章控制卡请做变异处理：换触发条件、换执行人、换场景、翻转预期结果。`;
    }
  }

  return { fingerprintCounts: counts, warnings: dedupedWarnings, suggestion };
}

/**
 * 检测最近 5 章钩子类型是否过于单一（需求6 轮换检测）
 */
export function checkHookRotation(recentHooks: string[]): {
  repetitive: boolean;
  dominantType?: string;
} {
  if (recentHooks.length < 3) return { repetitive: false };
  const counts: Record<string, number> = {};
  for (const h of recentHooks) counts[h] = (counts[h] || 0) + 1;
  const maxCount = Math.max(...Object.values(counts));
  const dominant = Object.entries(counts).find(([, c]) => c === maxCount)?.[0];
  // 连续3章同类型或5章中4章同类型
  const repetitive = maxCount >= 4 ||
    (recentHooks.slice(-3).every(h => h === recentHooks[recentHooks.length - 1]));
  return { repetitive, dominantType: dominant };
}
