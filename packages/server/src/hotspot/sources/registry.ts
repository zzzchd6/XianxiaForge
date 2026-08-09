/** 榜单源适配器注册表 */
import type { SourceAdapter } from './types.js';
import { qidianAdapter } from './adapters/qidian.js';
import { zonghengAdapter, zonghengHotAdapter } from './adapters/zongheng.js';
import { jjwxcAdapter } from './adapters/jjwxc.js';
import { fanqieMaleAdapter } from './adapters/fanqie.js';

/** 所有可用适配器（男频玄幻/仙侠源置顶，晋江/起点为降级备用） */
export const adapters: SourceAdapter[] = [
  fanqieMaleAdapter,
  zonghengAdapter,
  zonghengHotAdapter,
  jjwxcAdapter,
  qidianAdapter,
];

export function getAdapter(name: string): SourceAdapter | undefined {
  return adapters.find((a) => a.name === name);
}

/** 前端展示用的源列表（不含实现细节） */
export function listSources() {
  return adapters.map((a) => ({
    name: a.name,
    label: a.label,
    kind: a.kind,
    description: a.description ?? '',
  }));
}
