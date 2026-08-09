import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { causalChainApi } from '../lib/api';
import { useCurrentProjectId } from '../hooks/useCurrentProject';
import { EmptyState } from '../components/ui';
import { Link2, AlertTriangle, Plus, X } from 'lucide-react';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  planted: { label: '已埋设', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  foreshadowed: { label: '已铺垫', color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  triggered: { label: '已触发', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  resolved: { label: '已兑现', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  expired: { label: '已过期', color: 'text-red-400', bg: 'bg-red-500/10' },
};

const CAUSE_TYPE_LABELS: Record<string, string> = {
  secret: '隐瞒', debt: '恩情', betrayal: '背叛', prophecy: '预言', promise: '承诺', grudge: '仇怨',
};

const CAUSE_TYPES = Object.entries(CAUSE_TYPE_LABELS);
const EFFECT_TYPES: [string, string][] = [
  ['reveal', '揭露'], ['repay', '报答'], ['revenge', '复仇'], ['fulfill', '兑现'], ['break', '打破'],
];

const EMPTY_FORM = {
  causeType: 'promise',
  causeDescription: '',
  effectType: 'fulfill',
  effectDescription: '',
  sourceChapterNo: 1,
  targetChapterMax: 10,
  strength: 50,
  priority: 5,
};

export default function CausalChainPage() {
  const projectId = useCurrentProjectId();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // Escape 关闭弹窗
  useEffect(() => {
    if (!showCreate) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowCreate(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showCreate]);

  const { data: chains = [] } = useQuery({
    queryKey: ['causal-chains', projectId, statusFilter],
    queryFn: () => causalChainApi.list(projectId, {
      status: statusFilter === 'active' ? 'planted,foreshadowed,triggered' : statusFilter === 'all' ? undefined : statusFilter,
      limit: 100,
    }),
    enabled: !!projectId,
  });

  const { data: stats } = useQuery({
    queryKey: ['causal-stats', projectId],
    queryFn: () => causalChainApi.stats(projectId),
    enabled: !!projectId,
  });

  const statusMutation = useMutation({
    mutationFn: ({ chainId, status }: { chainId: number; status: string }) =>
      causalChainApi.updateStatus(projectId, chainId, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['causal-chains'] });
      queryClient.invalidateQueries({ queryKey: ['causal-stats'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => causalChainApi.create(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['causal-chains'] });
      queryClient.invalidateQueries({ queryKey: ['causal-stats'] });
      setShowCreate(false);
      setForm({ ...EMPTY_FORM });
    },
  });

  const handleCreate = () => {
    if (!form.causeDescription.trim()) return;
    createMutation.mutate({
      sourceType: 'manual',
      sourceChapterNo: form.sourceChapterNo,
      causeType: form.causeType,
      causeDescription: form.causeDescription.trim(),
      effectType: form.effectType,
      effectDescription: form.effectDescription.trim() || undefined,
      targetChapterMax: form.targetChapterMax || undefined,
      strength: form.strength,
      priority: form.priority,
    });
  };

  const filters = [
    { key: 'active', label: '进行中' },
    { key: 'resolved', label: '已兑现' },
    { key: 'expired', label: '已过期' },
    { key: 'all', label: '全部' },
  ];

  const inputCls = 'w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-purple-500';
  const labelCls = 'block text-xs text-zinc-400 mb-1';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <Link2 size={20} className="text-purple-400" /> 因果链管理
        </h1>
        <div className="flex items-center gap-3">
          {stats && (
            <div className="flex gap-3 text-xs">
              <span className="text-blue-400">埋设 {stats.planted ?? 0}</span>
              <span className="text-cyan-400">铺垫 {stats.foreshadowed ?? 0}</span>
              <span className="text-amber-400">触发 {stats.triggered ?? 0}</span>
              <span className="text-emerald-400">兑现 {stats.resolved ?? 0}</span>
              {(stats.overdue ?? 0) > 0 && (
                <span className="text-red-400 flex items-center gap-1">
                  <AlertTriangle size={12} /> 逾期 {stats.overdue}
                </span>
              )}
            </div>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-purple-600 text-white text-xs hover:bg-purple-500 transition-colors"
          >
            <Plus size={14} /> 新建因果线
          </button>
        </div>
      </div>

      {/* 状态过滤 */}
      <div className="flex gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`px-3 py-1 rounded text-xs transition-colors ${
              statusFilter === f.key
                ? 'bg-purple-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 因果线列表 */}
      {chains.length === 0 ? (
        <EmptyState icon={<Link2 size={32} />} message="暂无因果线，分支选择或手动创建后将在此展示" />
      ) : (
        <div className="space-y-3">
          {(chains as any[]).map((chain: any) => {
            const sc = STATUS_CONFIG[chain.status] ?? STATUS_CONFIG.planted;
            const causeLabel = CAUSE_TYPE_LABELS[chain.causeType] ?? chain.causeType;
            return (
              <div key={chain.id} className={`rounded-lg border border-zinc-800 p-4 ${sc.bg}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${sc.color} ${sc.bg} border border-current/20`}>
                        {sc.label}
                      </span>
                      <span className="text-xs text-zinc-500">[{causeLabel}]</span>
                      <span className="text-xs text-zinc-600">第{chain.sourceChapterNo}章埋下</span>
                      {chain.targetChapterMax != null && (
                        <span className={`text-xs ${chain.status === 'expired' ? 'text-red-400' : 'text-zinc-500'}`}>
                          预期≤第{chain.targetChapterMax}章
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-200 truncate">{chain.causeDescription}</p>
                    {chain.effectDescription && (
                      <p className="text-xs text-zinc-500 mt-1">→ {chain.effectDescription}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-zinc-600">
                      <span>强度 {chain.strength}/100</span>
                      <span>优先级 {chain.priority}/10</span>
                      {chain.resolutionNote && <span className="text-emerald-500">✓ {chain.resolutionNote}</span>}
                    </div>
                  </div>
                  {/* 操作按钮 */}
                  {(chain.status === 'planted' || chain.status === 'foreshadowed' || chain.status === 'triggered') && (
                    <div className="flex flex-col gap-1 shrink-0">
                      {chain.status === 'planted' && (
                        <button
                          onClick={() => statusMutation.mutate({ chainId: chain.id, status: 'foreshadowed' })}
                          className="text-xs px-2 py-1 rounded bg-cyan-900/40 text-cyan-400 hover:bg-cyan-900/60"
                        >
                          铺垫
                        </button>
                      )}
                      {chain.status !== 'triggered' && (
                        <button
                          onClick={() => statusMutation.mutate({ chainId: chain.id, status: 'triggered' })}
                          className="text-xs px-2 py-1 rounded bg-amber-900/40 text-amber-400 hover:bg-amber-900/60"
                        >
                          触发
                        </button>
                      )}
                      <button
                        onClick={() => statusMutation.mutate({ chainId: chain.id, status: 'resolved' })}
                        className="text-xs px-2 py-1 rounded bg-emerald-900/40 text-emerald-400 hover:bg-emerald-900/60"
                      >
                        兑现
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 新建因果线 Dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)} role="dialog" aria-modal="true">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md space-y-4 focus:outline-none" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">新建因果线</h2>
              <button onClick={() => setShowCreate(false)} className="text-zinc-500 hover:text-zinc-300" aria-label="关闭"><X size={16} /></button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="causal-cause-type" className={labelCls}>因类型</label>
                <select id="causal-cause-type" className={inputCls} value={form.causeType} onChange={(e) => setForm({ ...form, causeType: e.target.value })}>
                  {CAUSE_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="causal-effect-type" className={labelCls}>果类型</label>
                <select id="causal-effect-type" className={inputCls} value={form.effectType} onChange={(e) => setForm({ ...form, effectType: e.target.value })}>
                  {EFFECT_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="causal-cause-desc" className={labelCls}>因描述 *</label>
              <textarea id="causal-cause-desc" className={inputCls} rows={2} value={form.causeDescription} onChange={(e) => setForm({ ...form, causeDescription: e.target.value })} placeholder="描述种下的因（如：第5章选择隐瞒秘密）" />
            </div>

            <div>
              <label htmlFor="causal-effect-desc" className={labelCls}>果描述</label>
              <textarea id="causal-effect-desc" className={inputCls} rows={2} value={form.effectDescription} onChange={(e) => setForm({ ...form, effectDescription: e.target.value })} placeholder="预期兑现的果（可选）" />
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div>
                <label htmlFor="causal-source-chapter" className={labelCls}>来源章</label>
                <input id="causal-source-chapter" type="number" min={1} className={inputCls} value={form.sourceChapterNo} onChange={(e) => setForm({ ...form, sourceChapterNo: Number(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="causal-target-chapter" className={labelCls}>最晚兑现</label>
                <input id="causal-target-chapter" type="number" min={1} className={inputCls} value={form.targetChapterMax} onChange={(e) => setForm({ ...form, targetChapterMax: Number(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="causal-strength" className={labelCls}>强度</label>
                <input id="causal-strength" type="number" min={0} max={100} className={inputCls} value={form.strength} onChange={(e) => setForm({ ...form, strength: Number(e.target.value) })} />
              </div>
              <div>
                <label htmlFor="causal-priority" className={labelCls}>优先级</label>
                <input id="causal-priority" type="number" min={1} max={10} className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200">取消</button>
              <button
                onClick={handleCreate}
                disabled={!form.causeDescription.trim() || createMutation.isPending}
                className="px-4 py-1.5 rounded text-xs bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createMutation.isPending ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
