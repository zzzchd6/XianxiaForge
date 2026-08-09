import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bookmark, Plus, Edit2, Trash2, CheckCircle2, Archive,
  AlertTriangle, AlertOctagon, Clock, Link2, Search, X, Sparkles, GitBranch, FileEdit,
  RefreshCw, Info, ChevronDown, ChevronRight,
} from 'lucide-react'
import {
  Card, CardContent, Button, Badge, Dialog, Input, Textarea,
  Select, Spinner, EmptyState, useToast, Tabs,
} from '../components/ui'
import { foreshadowApi, plotMaterialsApi, chaptersApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import { cn } from '../lib/utils'
import CausalChainPage from './CausalChainPage'

// 状态显示配置
const STATUS_META: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' }> = {
  pending: { label: '待埋入', variant: 'warning' },
  planted: { label: '已埋设', variant: 'default' },
  resolved: { label: '已回收', variant: 'success' },
  abandoned: { label: '已废弃', variant: 'warning' },
}

const PRIORITY_META: Record<string, { label: string; className: string }> = {
  high: { label: '高优先', className: 'text-red-300' },
  normal: { label: '中优先', className: 'text-gray-300' },
  low: { label: '低优先', className: 'text-gray-500' },
}

const FILTER_TABS = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待埋入' },
  { id: 'planted', label: '已埋设' },
  { id: 'resolved', label: '已回收' },
  { id: 'abandoned', label: '已废弃' },
  { id: 'overdue', label: '超期未收' },
]

// 来源筛选（分支衍生伏笔系统）
const SOURCE_FILTERS = [
  { value: 'all', label: '全部来源' },
  { value: 'manual', label: '手动创建' },
  { value: 'scene', label: '场景提升' },
  { value: 'branch', label: '分支衍生' },
]

const SOURCE_META: Record<string, { label: string; className: string }> = {
  manual: { label: '手动', className: 'border-gray-600 bg-gray-700/30 text-gray-300' },
  scene: { label: '场景提升', className: 'border-sky-500/40 bg-sky-500/15 text-sky-300' },
  branch: { label: '分支衍生', className: 'border-amber-500/40 bg-amber-500/15 text-amber-300' },
}

// 草蛇灰线·检测问题严重级别显示配置
const SEVERITY_META: Record<'critical' | 'warning' | 'info', { icon: any; text: string; bg: string }> = {
  critical: { icon: AlertOctagon, text: 'text-red-200', bg: 'bg-red-500/10' },
  warning: { icon: AlertTriangle, text: 'text-amber-200', bg: 'bg-amber-500/10' },
  info: { icon: Info, text: 'text-gray-300', bg: 'bg-gray-700/20' },
}

// 看板视图列配置（按状态分列）
const KANBAN_COLUMNS = [
  { key: 'pending', label: '待埋入', color: 'border-gray-600' },
  { key: 'planted', label: '已埋设', color: 'border-sky-600' },
  { key: 'resolved', label: '已回收', color: 'border-emerald-600' },
  { key: 'abandoned', label: '已废弃', color: 'border-gray-700' },
]

interface ThreadForm {
  title: string
  description: string
  hintClue: string
  status: string
  priority: string
  plantChapter: string
  resolveChapter: string
  sceneIds: string
}

const emptyForm: ThreadForm = {
  title: '', description: '', hintClue: '', status: 'planted', priority: 'normal',
  plantChapter: '', resolveChapter: '', sceneIds: '',
}

export default function ForeshadowLedger() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [viewType, setViewType] = useState<'foreshadow' | 'causal'>('foreshadow')
  const [filter, setFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState<ThreadForm>(emptyForm)
  // A2：当前编辑伏笔绑定的「伏笔手法」素材（null=未绑定）
  const [boundTechnique, setBoundTechnique] = useState<{ id: number; title: string } | null>(null)
  // 分支衍生伏笔：来源筛选 + 回填弹窗目标
  const [sourceFilter, setSourceFilter] = useState('all')
  const [backfillTarget, setBackfillTarget] = useState<any>(null)
  // 列表/看板视图切换（P1-23）
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list')
  // 草蛇灰线检测面板折叠状态（默认折叠，有 critical/warning 时自动展开）
  const [detectionOpen, setDetectionOpen] = useState(false)

  const projectId = useCurrentProjectId()

  // 拉取全部伏笔线（含后端计算的 overdue/chaptersOpen/currentChapter）
  const { data: threads, isLoading } = useQuery({
    queryKey: ['foreshadow', projectId],
    queryFn: () => foreshadowApi.list(projectId),
    enabled: !!projectId,
  })

  const list: any[] = threads || []

  // 客户端统计
  const summary = useMemo(() => ({
    total: list.length,
    pending: list.filter((t) => t.status === 'pending').length,
    planted: list.filter((t) => t.status === 'planted').length,
    resolved: list.filter((t) => t.status === 'resolved').length,
    abandoned: list.filter((t) => t.status === 'abandoned').length,
    overdue: list.filter((t) => t.overdue).length,
    branchDerived: list.filter((t) => t.sourceType === 'branch').length,
    unconfirmed: list.filter((t) => t.sourceType === 'branch' && !t.isConfirmed).length,
    pendingBackfill: list.filter(
      (t) => t.sourceType === 'branch' && t.isConfirmed && (t.status === 'pending' || t.status === 'planted') && !t.backfillMethod
    ).length,
  }), [list])

  // 按筛选标签 + 来源过滤
  const filtered = useMemo(() => {
    let arr = list
    if (filter === 'overdue') arr = arr.filter((t) => t.overdue)
    else if (filter !== 'all') arr = arr.filter((t) => t.status === filter)
    if (sourceFilter !== 'all') arr = arr.filter((t) => (t.sourceType || 'manual') === sourceFilter)
    return arr
  }, [list, filter, sourceFilter])

  // 看板视图数据源：仅按来源筛选（看板自身按状态分列，故忽略状态标签）
  const sourceFiltered = useMemo(() => {
    if (sourceFilter === 'all') return list
    return list.filter((t) => (t.sourceType || 'manual') === sourceFilter)
  }, [list, sourceFilter])

  // 草蛇灰线·伏笔健康检测（纯规则零LLM）
  const { data: detection, isFetching: isDetecting } = useQuery({
    queryKey: ['foreshadow-detection', projectId],
    queryFn: () => foreshadowApi.detection(projectId),
    enabled: !!projectId,
  })

  const detectionIssues: any[] = detection?.issues || []
  const grouped = useMemo(() => ({
    critical: detectionIssues.filter((i) => i.severity === 'critical'),
    warning: detectionIssues.filter((i) => i.severity === 'warning'),
    info: detectionIssues.filter((i) => i.severity === 'info'),
  }), [detectionIssues])
  const hasAlert = grouped.critical.length > 0 || grouped.warning.length > 0

  // 出现 critical/warning 时自动展开检测面板
  useEffect(() => {
    if (hasAlert) setDetectionOpen(true)
  }, [hasAlert])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['foreshadow', projectId] })

  // 创建/更新
  const saveMutation = useMutation({
    mutationFn: (data: any) =>
      editing ? foreshadowApi.update(String(editing.id), data) : foreshadowApi.create(projectId, data),
    onSuccess: () => {
      invalidate()
      setShowForm(false)
      setEditing(null)
      setForm(emptyForm)
      setBoundTechnique(null)
      toast(editing ? '伏笔已更新' : '伏笔已创建', 'success')
    },
    onError: (err: any) => toast(err.message || '保存失败', 'error'),
  })

  // 状态流转（回收/废弃/重新埋设）
  const statusMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => foreshadowApi.update(String(id), data),
    onSuccess: () => { invalidate() },
    onError: (err: any) => toast(err.message || '操作失败', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => foreshadowApi.delete(String(id)),
    onSuccess: () => { invalidate(); toast('已删除', 'success') },
    onError: (err: any) => toast(err.message || '删除失败', 'error'),
  })

  // 分支衍生伏笔：确认
  const confirmMutation = useMutation({
    mutationFn: (id: number) => foreshadowApi.confirm(String(id)),
    onSuccess: () => { invalidate(); toast('已确认该伏笔', 'success') },
    onError: (err: any) => toast(err.message || '确认失败', 'error'),
  })

  const openCreate = () => { setEditing(null); setForm(emptyForm); setBoundTechnique(null); setShowForm(true) }
  const openEdit = (t: any) => {
    setEditing(t)
    setForm({
      title: t.title || '',
      description: t.description || '',
      hintClue: t.hintClue || '',
      status: t.status || 'planted',
      priority: t.priority || 'normal',
      plantChapter: t.plantChapter != null ? String(t.plantChapter) : '',
      resolveChapter: t.resolveChapter != null ? String(t.resolveChapter) : '',
      sceneIds: Array.isArray(t.sceneIds) ? t.sceneIds.join(',') : '',
    })
    setBoundTechnique(t.referencedMaterialId ? { id: t.referencedMaterialId, title: `手法#${t.referencedMaterialId}` } : null)
    setShowForm(true)
  }

  const submitForm = () => {
    if (!form.title.trim()) { toast('请填写伏笔名称', 'error'); return }
    const parseIds = form.sceneIds
      .split(/[,，]/).map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !isNaN(n))
    const payload: any = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      hintClue: form.hintClue.trim() || null,
      status: form.status,
      priority: form.priority,
      plantChapter: form.plantChapter ? Number(form.plantChapter) : null,
      resolveChapter: form.resolveChapter ? Number(form.resolveChapter) : null,
      sceneIds: parseIds,
      referencedMaterialId: boundTechnique?.id ?? null,
    }
    saveMutation.mutate(payload)
  }

  // 标记回收：若未填回收章，默认填入当前进度章
  const markResolved = (t: any) => {
    const data: any = { status: 'resolved' }
    if (t.resolveChapter == null) data.resolveChapter = t.currentChapter ?? t.plantChapter ?? null
    statusMutation.mutate({ id: t.id, data }, { onSuccess: () => toast('已标记回收', 'success') })
  }

  return (
    <div className="space-y-5">
      {/* 页头：统一叙事线索 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bookmark className="h-5 w-5 text-cyan-400" />
          <h1 className="text-xl font-semibold text-gray-100">叙事线索</h1>
          <div role="tablist" className="flex rounded-lg border border-gray-700 p-0.5">
            <button
              role="tab"
              aria-selected={viewType === 'foreshadow'}
              onClick={() => setViewType('foreshadow')}
              className={cn('px-3 py-1 rounded-md text-xs transition-colors', viewType === 'foreshadow' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-gray-200')}
            >
              伏笔
            </button>
            <button
              role="tab"
              aria-selected={viewType === 'causal'}
              onClick={() => setViewType('causal')}
              className={cn('px-3 py-1 rounded-md text-xs transition-colors', viewType === 'causal' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200')}
            >
              因果链
            </button>
          </div>
        </div>
        {viewType === 'foreshadow' && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> 新建伏笔
          </Button>
        )}
      </div>

      {/* 因果链视图 */}
      {viewType === 'causal' ? (
        <CausalChainPage />
      ) : (
      <>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="伏笔总数" value={summary.total} />
        <StatCard label="待埋入" value={summary.pending} accent="text-amber-300" />
        <StatCard label="已埋设" value={summary.planted} accent="text-indigo-300" />
        <StatCard label="已回收" value={summary.resolved} accent="text-emerald-300" />
        <StatCard label="已废弃" value={summary.abandoned} accent="text-gray-400" />
        <StatCard label="超期未收" value={summary.overdue} accent="text-red-300" />
        <StatCard label="分支衍生" value={summary.branchDerived} accent="text-amber-300" />
        <StatCard label="待回填" value={summary.pendingBackfill} accent="text-cyan-300" />
      </div>

      {/* 超期提醒横幅 */}
      {summary.overdue > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>有 {summary.overdue} 条伏笔埋设过久仍未回收，建议尽快安排回收或确认废弃，避免读者遗忘。</span>
          <button className="ml-auto underline hover:text-red-100" onClick={() => setFilter('overdue')}>
            查看超期
          </button>
        </div>
      )}

      {/* 分支衍生待确认提醒 */}
      {summary.unconfirmed > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          <GitBranch className="h-4 w-4 shrink-0" />
          <span>有 {summary.unconfirmed} 条分支衍生伏笔待确认，确认后方可安排回填埋设。</span>
          <button className="ml-auto underline hover:text-amber-100" onClick={() => { setSourceFilter('branch'); setFilter('all') }}>
            查看分支衍生
          </button>
        </div>
      )}

      {/* 草蛇灰线 · 伏笔健康检测（P2-03，纯规则） */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/30">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <button
            onClick={() => setDetectionOpen((v) => !v)}
            aria-expanded={detectionOpen}
            aria-controls="detection-panel"
            className="flex flex-1 items-center gap-2 text-left"
          >
            {detectionOpen
              ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
              : <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />}
            <Sparkles className="h-4 w-4 shrink-0 text-cyan-400" />
            <span className="text-sm font-medium text-gray-200">草蛇灰线 · 伏笔健康检测</span>
            {hasAlert && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] text-red-300">
                {grouped.critical.length + grouped.warning.length} 项待处理
              </span>
            )}
            {detection && (
              <span className="text-[10px] text-gray-600">
                已扫描 {detection.scannedCount} 条 · 当前第 {detection.currentChapter} 章
              </span>
            )}
          </button>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['foreshadow-detection', projectId] })}
            className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isDetecting && 'animate-spin')} /> 刷新
          </button>
        </div>

        {detectionOpen && (
          <div id="detection-panel" className="space-y-1.5 border-t border-gray-800 px-4 py-3">
            {isDetecting && detectionIssues.length === 0 ? (
              <div className="flex justify-center py-4"><Spinner /></div>
            ) : detectionIssues.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> 所有伏笔状态健康
              </p>
            ) : (
              (['critical', 'warning', 'info'] as const).map((sev) =>
                grouped[sev].length === 0 ? null : (
                  <div key={sev} className="space-y-1">
                    {grouped[sev].map((issue: any, idx: number) => {
                      const meta = SEVERITY_META[sev]
                      const Icon = meta.icon
                      return (
                        <div
                          key={`${issue.rule}-${issue.threadId}-${idx}`}
                          className={cn('flex items-start gap-2 rounded-md px-2.5 py-1.5 text-xs', meta.bg)}
                        >
                          <Icon className={cn('mt-px h-3.5 w-3.5 shrink-0', meta.text)} />
                          <span className={meta.text}>{issue.message}</span>
                        </div>
                      )
                    })}
                  </div>
                )
              )
            )}
          </div>
        )}
      </div>

      {/* 筛选区：状态标签 + 来源下拉 + 视图切换 */}
      <div className="flex flex-wrap items-center gap-3">
        {viewMode === 'list' && (
          <Tabs tabs={FILTER_TABS} active={filter} onChange={setFilter} className="max-w-2xl" />
        )}
        <div className="w-40">
          <Select value={sourceFilter} options={SOURCE_FILTERS} onChange={(e) => setSourceFilter(e.target.value)} />
        </div>
        <div role="tablist" className="flex rounded-lg border border-gray-700 p-0.5">
          <button
            role="tab"
            aria-selected={viewMode === 'list'}
            onClick={() => setViewMode('list')}
            className={cn('rounded-md px-2.5 py-1 text-xs', viewMode === 'list' ? 'bg-gray-700 text-gray-200' : 'text-gray-500')}
          >
            列表
          </button>
          <button
            role="tab"
            aria-selected={viewMode === 'kanban'}
            onClick={() => setViewMode('kanban')}
            className={cn('rounded-md px-2.5 py-1 text-xs', viewMode === 'kanban' ? 'bg-gray-700 text-gray-200' : 'text-gray-500')}
          >
            看板
          </button>
        </div>
      </div>

      {/* 列表 / 看板 */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : viewMode === 'kanban' ? (
        <div className="grid grid-cols-4 gap-3">
          {KANBAN_COLUMNS.map((col) => {
            const items = sourceFiltered.filter((t: any) => t.status === col.key)
            return (
              <div key={col.key} className={cn('rounded-lg border-t-2 bg-gray-900/40 p-2', col.color)}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-xs font-medium text-gray-300">{col.label}</span>
                  <span className="text-[10px] text-gray-600">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((t: any) => (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openEdit(t)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(t) } }}
                      className="cursor-pointer rounded-md border border-gray-700/60 bg-gray-800/60 p-2.5 transition-colors hover:border-gray-600"
                    >
                      <p className="text-xs font-medium text-gray-200 line-clamp-2">{t.title}</p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {t.tier && <span className="rounded bg-gray-700 px-1 py-px text-[9px] text-gray-400">{t.tier}</span>}
                        {t.overdue && <span className="rounded bg-red-500/20 px-1 py-px text-[9px] text-red-400">超期</span>}
                        {t.priority === 'high' && <span className="rounded bg-amber-500/20 px-1 py-px text-[9px] text-amber-400">高</span>}
                      </div>
                      {t.plantChapter && (
                        <p className="mt-1 text-[10px] text-gray-600">
                          第{t.plantChapter}章{t.resolveChapter ? ` → 第${t.resolveChapter}章` : ''}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Bookmark className="h-8 w-8" />} message="暂无伏笔记录，点击「新建伏笔」开始追踪" />
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => (
            <ThreadCard
              key={t.id}
              thread={t}
              onEdit={() => openEdit(t)}
              onResolve={() => markResolved(t)}
              onAbandon={() => statusMutation.mutate({ id: t.id, data: { status: 'abandoned' } }, { onSuccess: () => toast('已标记废弃', 'info') })}
              onReplant={() => statusMutation.mutate({ id: t.id, data: { status: 'planted' } }, { onSuccess: () => toast('已重新设为埋设', 'info') })}
              onDelete={() => { if (confirm(`确认删除伏笔「${t.title}」？`)) deleteMutation.mutate(t.id) }}
              onConfirm={() => confirmMutation.mutate(t.id)}
              onBackfill={() => setBackfillTarget(t)}
            />
          ))}
        </div>
      )}

      {/* 分支衍生伏笔回填弹窗 */}
      <BackfillDialog
        thread={backfillTarget}
        projectId={projectId}
        onClose={() => { setBackfillTarget(null); invalidate() }}
      />

      {/* 创建/编辑弹窗 */}
      <Dialog open={showForm} onClose={() => setShowForm(false)} title={editing ? '编辑伏笔' : '新建伏笔'}>
        <div className="space-y-4">
          <Input label="伏笔名称" value={form.title} placeholder="如：张小凡的身世之谜" onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea label="描述（埋了什么 / 预期如何回收）" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input label="埋设线索（关键词句，用于在正文中自动识别埋入/回收）" value={form.hintClue} placeholder="如：噬魂珠、碧瑶的铃铛" onChange={(e) => setForm({ ...form, hintClue: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="状态" value={form.status} options={[
              { value: 'pending', label: '待埋入' },
              { value: 'planted', label: '已埋设' },
              { value: 'resolved', label: '已回收' },
              { value: 'abandoned', label: '已废弃' },
            ]} onChange={(e) => setForm({ ...form, status: e.target.value })} />
            <Select label="优先级" value={form.priority} options={[
              { value: 'high', label: '高' },
              { value: 'normal', label: '中' },
              { value: 'low', label: '低' },
            ]} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="埋设章节" type="number" value={form.plantChapter} placeholder="如 3" onChange={(e) => setForm({ ...form, plantChapter: e.target.value })} />
            <Input label="回收章节" type="number" value={form.resolveChapter} placeholder="如 25" onChange={(e) => setForm({ ...form, resolveChapter: e.target.value })} />
          </div>
          <Input label="关联场景节点ID（逗号分隔，可选）" value={form.sceneIds} placeholder="如 1,2,3" onChange={(e) => setForm({ ...form, sceneIds: e.target.value })} />

          {/* A2：绑定伏笔手法（写作时强制参照该手法） */}
          <TechniqueBinder
            projectId={projectId}
            foreshadowId={editing?.id ?? null}
            enabled={showForm}
            value={boundTechnique}
            onChange={setBoundTechnique}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>取消</Button>
            <Button onClick={submitForm} loading={saveMutation.isPending}>保存</Button>
          </div>
        </div>
      </Dialog>
      </>
      )}
    </div>
  )
}

// 统计卡片
function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-gray-500">{label}</p>
        <p className={cn('mt-1 text-2xl font-semibold', accent || 'text-gray-100')}>{value}</p>
      </CardContent>
    </Card>
  )
}

// 单条伏笔卡片
function ThreadCard({ thread: t, onEdit, onResolve, onAbandon, onReplant, onDelete, onConfirm, onBackfill }: {
  thread: any
  onEdit: () => void
  onResolve: () => void
  onAbandon: () => void
  onReplant: () => void
  onDelete: () => void
  onConfirm: () => void
  onBackfill: () => void
}) {
  const status = STATUS_META[t.status] || STATUS_META.planted
  const priority = PRIORITY_META[t.priority] || PRIORITY_META.normal
  const sceneCount = Array.isArray(t.sceneIds) ? t.sceneIds.length : 0
  const source = SOURCE_META[t.sourceType] || SOURCE_META.manual
  const isBranch = t.sourceType === 'branch'
  const needsConfirm = isBranch && !t.isConfirmed
  const canBackfill = isBranch && t.isConfirmed && !t.backfillMethod && (t.status === 'pending' || t.status === 'planted')
  const backfillLabel = t.backfillMethod === 'anchor' ? '已埋设·锚点' : t.backfillMethod === 'revise' ? '已埋设·修订' : null

  return (
    <Card className={cn(t.overdue && 'border-red-500/50', needsConfirm && 'border-amber-500/40')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-gray-100">{t.title}</h3>
              <Badge variant={status.variant}>{status.label}</Badge>
              <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', source.className)}>
                {isBranch && <GitBranch className="mr-0.5 inline h-3 w-3" />}{source.label}
              </span>
              {needsConfirm && (
                <span className="rounded border border-yellow-500/40 bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-300">待确认</span>
              )}
              {backfillLabel && (
                <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">{backfillLabel}</span>
              )}
              <span className={cn('text-xs', priority.className)}>{priority.label}</span>
              {t.overdue && (
                <Badge variant="destructive">
                  <AlertTriangle className="mr-1 h-3 w-3" /> 超期
                </Badge>
              )}
            </div>
            {t.description && (
              <p className="mt-1.5 text-sm text-gray-400">{t.description}</p>
            )}
            {t.hintClue && (
              <p className="mt-1 text-xs text-cyan-300/80">线索：{t.hintClue}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                埋设：第{t.plantChapter ?? '?'}章 → 回收：第{t.resolveChapter ?? '?'}章
              </span>
              {t.chaptersOpen != null && t.status === 'planted' && (
                <span className={cn(t.overdue && 'text-red-300')}>已敞开 {t.chaptersOpen} 章</span>
              )}
              {sceneCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Link2 className="h-3 w-3" /> 关联 {sceneCount} 个场景
                </span>
              )}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex shrink-0 items-center gap-1">
            {needsConfirm && (
              <Button size="sm" variant="ghost" title="确认该分支衍生伏笔" onClick={onConfirm}>
                <CheckCircle2 className="h-4 w-4 text-yellow-400" />
              </Button>
            )}
            {canBackfill && (
              <Button size="sm" variant="outline" className="border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/10" onClick={onBackfill}>
                <FileEdit className="mr-1 h-3.5 w-3.5" />
                回填埋设
              </Button>
            )}
            {t.status === 'planted' && (
              <>
                <Button size="sm" variant="ghost" title="标记回收" onClick={onResolve}>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                </Button>
                <Button size="sm" variant="ghost" title="标记废弃" onClick={onAbandon}>
                  <Archive className="h-4 w-4 text-amber-400" />
                </Button>
              </>
            )}
            {t.status !== 'planted' && (
              <Button size="sm" variant="ghost" title={t.status === 'pending' ? '标记已埋设' : '重新设为埋设'} onClick={onReplant}>
                <Bookmark className="h-4 w-4 text-indigo-400" />
              </Button>
            )}
            <Button size="sm" variant="ghost" title="编辑" onClick={onEdit}>
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" title="删除" onClick={onDelete}>
              <Trash2 className="h-4 w-4 text-red-400" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// 简易行级 diff（LCS），用于修订回填预览的红绿对比
function diffLines(oldText: string, newText: string): Array<{ type: 'same' | 'add' | 'del'; text: string }> {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const m = a.length, n = b.length
  // 超大文本降级：不做逐行 diff，直接整体视为新增
  if (m * n > 1_000_000) {
    return [
      ...a.map((t) => ({ type: 'del' as const, text: t })),
      ...b.map((t) => ({ type: 'add' as const, text: t })),
    ]
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: Array<{ type: 'same' | 'add' | 'del'; text: string }> = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++ }
    else { out.push({ type: 'add', text: b[j] }); j++ }
  }
  while (i < m) out.push({ type: 'del', text: a[i++] })
  while (j < n) out.push({ type: 'add', text: b[j++] })
  return out
}

// 分支衍生伏笔回填弹窗（两步：选章 → 选方式；修订含红绿 diff 预览）
function BackfillDialog({ thread, projectId, onClose }: {
  thread: any
  projectId: string
  onClose: () => void
}) {
  const { toast } = useToast()
  const [selected, setSelected] = useState<any>(null)
  const [intensity, setIntensity] = useState<'light' | 'medium' | 'strong'>('medium')
  const [preview, setPreview] = useState<any>(null)

  const open = !!thread

  // 切换目标伏笔时重置内部状态
  useEffect(() => {
    setSelected(null)
    setPreview(null)
    setIntensity('medium')
  }, [thread?.id])

  const { data: suggestData, isLoading: suggesting } = useQuery({
    queryKey: ['foreshadow-plant-chapters', thread?.id],
    queryFn: () => foreshadowApi.suggestPlantChapters(String(thread.id)),
    enabled: open,
  })

  const anchorMutation = useMutation({
    mutationFn: () => foreshadowApi.backfillAnchor(String(thread.id), selected.chapterPlanId),
    onSuccess: () => { toast('已写入章节锚点，该章生成时将强制融入', 'success'); onClose() },
    onError: (e: any) => toast(e.message || '锚点回填失败', 'error'),
  })

  const reviseMutation = useMutation({
    mutationFn: () => foreshadowApi.backfillRevise(String(thread.id), selected.generatedChapterId, intensity),
    onSuccess: (data) => setPreview(data),
    onError: (e: any) => toast(e.message || '修订预览生成失败', 'error'),
  })

  const saveReviseMutation = useMutation({
    mutationFn: async () => {
      await chaptersApi.updateContent(projectId, String(selected.chapterPlanId), preview.revisedContent)
      await foreshadowApi.markPlanted(String(thread.id), {
        backfillMethod: 'revise',
        backfillTargetChapterId: selected.chapterPlanId,
        plantChapter: selected.chapterNo,
      })
    },
    onSuccess: () => { toast('修订已保存为新版本并标记埋设', 'success'); onClose() },
    onError: (e: any) => toast(e.message || '保存失败', 'error'),
  })

  if (!open) return null

  const suggestions = suggestData?.suggestions || []
  const isRevise = selected?.suggestedMethod === 'revise'
  const diff = preview ? diffLines(preview.originalContent || '', preview.revisedContent || '') : []

  return (
    <Dialog open={open} onClose={onClose} title={`回填埋设：${thread.title}`} className="max-w-3xl">
      <div className="space-y-4">
        {!selected ? (
          <>
            <p className="text-sm text-gray-400">
              选择要埋设本伏笔的早期章节（推荐章号均早于分支发生章，第{suggestData?.resolveChapter ?? '?'}章回收）：
            </p>
            {suggesting ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : suggestions.length === 0 ? (
              <EmptyState message="没有可用的推荐章节（可能尚无早于分支的章节计划）" />
            ) : (
              <div className="space-y-2">
                {suggestions.map((s: any) => {
                  const disabled = s.suggestedMethod === 'unavailable'
                  return (
                    <button
                      key={s.chapterNo}
                      disabled={disabled}
                      onClick={() => setSelected(s)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                        disabled
                          ? 'cursor-not-allowed border-gray-800 bg-gray-900/30 opacity-50'
                          : 'border-gray-700 bg-gray-900/50 hover:border-cyan-500/60 hover:bg-cyan-500/5'
                      )}
                    >
                      <span className="text-sm font-medium text-gray-200">第{s.chapterNo}章</span>
                      {s.title && <span className="truncate text-sm text-gray-400">{s.title}</span>}
                      <span className={cn(
                        'ml-auto shrink-0 rounded px-2 py-0.5 text-[10px]',
                        s.suggestedMethod === 'revise'
                          ? 'bg-purple-500/15 text-purple-300'
                          : s.suggestedMethod === 'anchor'
                            ? 'bg-cyan-500/15 text-cyan-300'
                            : 'bg-gray-700/40 text-gray-500'
                      )}>
                        {s.suggestedMethod === 'revise' ? '已有正文·修订回填' : s.suggestedMethod === 'anchor' ? '待生成·锚点回填' : '无章节计划'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setSelected(null); setPreview(null) }}
                className="text-xs text-gray-400 hover:text-gray-200"
              >
                ← 重选章节
              </button>
              <span className="text-sm text-gray-300">
                目标：第{selected.chapterNo}章{selected.title ? ` 「${selected.title}」` : ''}
              </span>
            </div>

            {!isRevise ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm text-gray-300">
                  将以「关键剧情锚点」写入该章计划的 must_have_events，该章生成时 Writer 会强制融入本伏笔线索：
                  <span className="mt-1 block text-cyan-300/80">{thread.hintClue || thread.title}</span>
                </div>
                <div className="flex justify-end">
                  <Button onClick={() => anchorMutation.mutate()} loading={anchorMutation.isPending}>
                    确认锚点回填
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {!preview ? (
                  <>
                    <div className="flex items-end gap-3">
                      <div className="w-48">
                        <Select
                          label="埋设强度"
                          value={intensity}
                          options={[
                            { value: 'light', label: '轻（细节暗示）' },
                            { value: 'medium', label: '中（自然融入）' },
                            { value: 'strong', label: '强（明显铺设）' },
                          ]}
                          onChange={(e) => setIntensity(e.target.value as any)}
                        />
                      </div>
                      <Button onClick={() => reviseMutation.mutate()} loading={reviseMutation.isPending}>
                                        生成修订预览
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500">将调用 Reviser 在该章正文中自然埋入伏笔，仅生成预览，确认后才保存为新版本。</p>
                  </>
                ) : (
                  <>
                    {Array.isArray(preview.revisionNotes) && preview.revisionNotes.length > 0 && (
                      <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3">
                        <p className="mb-1 text-xs font-medium text-gray-400">修订说明</p>
                        <ul className="space-y-0.5 text-xs text-gray-300">
                          {preview.revisionNotes.map((n: string, i: number) => (
                            <li key={i}>· {n}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-700 bg-gray-950/60 p-3 font-mono text-xs leading-relaxed">
                      {diff.map((d, i) => (
                        <div
                          key={i}
                          className={cn(
                            'whitespace-pre-wrap px-1',
                            d.type === 'add' && 'bg-emerald-500/15 text-emerald-300',
                            d.type === 'del' && 'bg-red-500/15 text-red-300 line-through',
                            d.type === 'same' && 'text-gray-400'
                          )}
                        >
                          <span className="mr-1 select-none text-gray-600">{d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' '}</span>
                          {d.text || '\u00A0'}
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setPreview(null)}>重新生成</Button>
                      <Button onClick={() => saveReviseMutation.mutate()} loading={saveReviseMutation.isPending}>
                        确认并保存为新版本
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

// A2：伏笔手法绑定器（单选一条 plot_material_foreshadow 手法，写作时强制参照）
function TechniqueBinder({ projectId, foreshadowId, enabled, value, onChange }: {
  projectId: string
  foreshadowId: number | null
  enabled: boolean
  value: { id: number; title: string } | null
  onChange: (m: { id: number; title: string } | null) => void
}) {
  const [keyword, setKeyword] = useState('')
  const [showBrowse, setShowBrowse] = useState(false)

  // 推荐手法（仅编辑已有伏笔时可用）
  const { data: suggestions } = useQuery({
    queryKey: ['foreshadow-suggest', foreshadowId],
    queryFn: () => foreshadowApi.suggestTechniques(String(foreshadowId), 5),
    enabled: enabled && !!foreshadowId,
  })

  // 浏览全部伏笔手法
  const { data: browseList, isLoading: browsing } = useQuery({
    queryKey: ['foreshadow-techniques', projectId, keyword],
    queryFn: () => plotMaterialsApi.list(projectId, { type: 'foreshadow', keyword: keyword || undefined, limit: 20 }),
    enabled: enabled && showBrowse,
  })

  const pick = (m: any) => onChange({ id: Number(m.id), title: m.title })

  const renderRow = (m: any) => {
    const active = value?.id === Number(m.id)
    return (
      <button
        key={`${m.table || 'foreshadow'}:${m.id}`}
        onClick={() => pick(m)}
        className={cn(
          'w-full rounded-lg border p-2.5 text-left transition-colors',
          active ? 'border-cyan-500 bg-cyan-500/10' : 'border-gray-800 bg-gray-900/40 hover:border-gray-700'
        )}
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-200">{m.title}</span>
          {active && <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-cyan-400" />}
        </div>
        {m.corePlot && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{m.corePlot}</p>}
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-gray-800 bg-gray-900/30 p-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-300" aria-label="绑定伏笔手法">绑定伏笔手法（可选）</label>
        {value && (
          <button onClick={() => onChange(null)} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-300">
            <X className="h-3 w-3" /> 解绑
          </button>
        )}
      </div>

      {value ? (
        <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200">
          已绑定：{value.title}
        </div>
      ) : (
        <p className="text-xs text-gray-500">绑定后，写作埋设/回收本伏笔时将强制参照该手法。</p>
      )}

      {/* 推荐手法 */}
      {!!foreshadowId && suggestions && suggestions.length > 0 && (
        <div className="space-y-1.5">
          <p className="inline-flex items-center gap-1 text-xs text-gray-400">
            <Sparkles className="h-3 w-3 text-amber-400" /> 智能推荐
          </p>
          {suggestions.map(renderRow)}
        </div>
      )}

      {/* 浏览全部 */}
      {!showBrowse ? (
        <Button size="sm" variant="outline" onClick={() => setShowBrowse(true)}>
          <Search className="h-3.5 w-3.5" /> 浏览全部伏笔手法
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
            <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索手法标题或核心剧情..." className="pl-9" />
          </div>
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {browsing ? (
              <div className="flex justify-center py-4"><Spinner /></div>
            ) : !browseList?.length ? (
              <EmptyState message="没有匹配的伏笔手法" />
            ) : (
              browseList.map(renderRow)
            )}
          </div>
        </div>
      )}
    </div>
  )
}
