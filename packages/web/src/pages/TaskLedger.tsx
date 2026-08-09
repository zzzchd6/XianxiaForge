import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ListChecks, Plus, Edit2, Trash2, CheckCircle2, Archive,
  PlayCircle, XCircle, Clock, Target, AlertTriangle,
} from 'lucide-react'
import {
  Card, CardContent, Button, Badge, Dialog, Input, Textarea,
  Select, Spinner, EmptyState, useToast,
} from '../components/ui'
import { taskArcApi, customCharacterApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import { cn } from '../lib/utils'

// 状态显示配置（不同状态不同色）
const STATUS_META: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'destructive'; className?: string }> = {
  active: { label: '待推进', variant: 'default' },
  progressing: { label: '推进中', variant: 'default', className: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  completed: { label: '已完成', variant: 'success' },
  failed: { label: '已失败', variant: 'destructive' },
  abandoned: { label: '已放弃', variant: 'default', className: 'bg-gray-500/10 text-gray-400 border-gray-500/30' },
}

const PRIORITY_META: Record<string, { label: string; className: string }> = {
  high: { label: '高优先', className: 'text-red-300' },
  normal: { label: '中优先', className: 'text-gray-300' },
  low: { label: '低优先', className: 'text-gray-500' },
}

const TIER_META: Record<string, { label: string; className: string }> = {
  t1: { label: '战略', className: 'border-amber-500/40 bg-amber-500/15 text-amber-300' },
  t2: { label: '战役', className: 'border-sky-500/40 bg-sky-500/15 text-sky-300' },
  t3: { label: '普通', className: 'border-gray-600 bg-gray-700/30 text-gray-300' },
}

// 任务类型标签（13-SRS US-21a 自动提取 taskType）
const TASK_TYPE_META: Record<string, { label: string; className: string }> = {
  main: { label: '主线', className: 'border-amber-500/40 bg-amber-500/15 text-amber-300' },
  side: { label: '支线', className: 'border-sky-500/40 bg-sky-500/15 text-sky-300' },
  hidden: { label: '隐藏', className: 'border-purple-500/40 bg-purple-500/15 text-purple-300' },
  fortune: { label: '机缘', className: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' },
}

// 分组展示配置（13-SRS US-21c：进行中 / 已完成 / 未接·隐藏）
const TASK_GROUPS: { key: string; label: string; statuses: string[]; accent: string }[] = [
  { key: 'ongoing', label: '进行中', statuses: ['active', 'progressing'], accent: 'text-sky-300' },
  { key: 'completed', label: '已完成', statuses: ['completed'], accent: 'text-emerald-300' },
  { key: 'closed', label: '未接·隐藏', statuses: ['failed', 'abandoned'], accent: 'text-gray-400' },
]

// 状态筛选下拉项
const STATUS_FILTERS = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '待推进' },
  { value: 'progressing', label: '推进中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '已失败' },
  { value: 'abandoned', label: '已放弃' },
]

interface TaskForm {
  title: string
  description: string
  progressClue: string
  status: string
  priority: string
  tier: string
  startChapter: string
  targetChapter: string
}

const emptyForm: TaskForm = {
  title: '', description: '', progressClue: '', status: 'active', priority: 'normal',
  tier: 't3', startChapter: '', targetChapter: '',
}

export default function TaskLedger() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState<TaskForm>(emptyForm)

  const projectId = useCurrentProjectId()

  // 拉取任务线列表（queryKey 含 pid + status 过滤；status=all 时不传）
  const { data: tasks, isLoading } = useQuery({
    queryKey: ['tasks', projectId, filter],
    queryFn: () => taskArcApi.list(projectId, filter === 'all' ? undefined : filter),
    enabled: !!projectId,
  })

  const list: any[] = tasks || []

  // 自定义人物名单（用于关联角色 ID → 姓名；13-SRS US-21c）
  const { data: characters = [] } = useQuery({
    queryKey: ['custom-characters', projectId],
    queryFn: () => customCharacterApi.list(projectId),
    enabled: !!projectId,
  })
  const nameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of characters as any[]) m.set(c.id, c.name)
    return m
  }, [characters])
  const resolveNames = (ids: any): string[] =>
    (Array.isArray(ids) ? ids : []).flatMap((id: number) => {
      const n = nameById.get(id)
      return n ? [n] : []
    })

  // 按状态分组（13-SRS US-21c）
  const groups = useMemo(() =>
    TASK_GROUPS.map((g) => ({ ...g, tasks: list.filter((t) => g.statuses.includes(t.status)) })),
  [list])

  // 客户端状态统计
  const summary = useMemo(() => ({
    total: list.length,
    active: list.filter((t) => t.status === 'active').length,
    progressing: list.filter((t) => t.status === 'progressing').length,
    completed: list.filter((t) => t.status === 'completed').length,
    failed: list.filter((t) => t.status === 'failed').length,
    abandoned: list.filter((t) => t.status === 'abandoned').length,
    unconfirmed: list.filter((t) => !t.isConfirmed).length,
  }), [list])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })

  // 创建/更新
  const saveMutation = useMutation({
    mutationFn: (data: any) =>
      editing ? taskArcApi.update(projectId, editing.id, data) : taskArcApi.create(projectId, data),
    onSuccess: () => {
      invalidate()
      setShowForm(false)
      setEditing(null)
      setForm(emptyForm)
      toast(editing ? '任务已更新' : '任务已创建', 'success')
    },
    onError: (err: any) => toast(err.message || '保存失败', 'error'),
  })

  // 状态流转（PUT 改 status）
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      taskArcApi.update(projectId, id, { status }),
    onSuccess: () => { invalidate() },
    onError: (err: any) => toast(err.message || '操作失败', 'error'),
  })

  // 删除（硬删）
  const deleteMutation = useMutation({
    mutationFn: (id: number) => taskArcApi.remove(projectId, id),
    onSuccess: () => { invalidate(); toast('已删除', 'success') },
    onError: (err: any) => toast(err.message || '删除失败', 'error'),
  })

  // 确认生效
  const confirmMutation = useMutation({
    mutationFn: (id: number) => taskArcApi.confirm(projectId, id),
    onSuccess: () => { invalidate(); toast('已确认该任务', 'success') },
    onError: (err: any) => toast(err.message || '确认失败', 'error'),
  })

  const openCreate = () => { setEditing(null); setForm(emptyForm); setShowForm(true) }
  const openEdit = (t: any) => {
    setEditing(t)
    setForm({
      title: t.title || '',
      description: t.description || '',
      progressClue: t.progressClue || '',
      status: t.status || 'active',
      priority: t.priority || 'normal',
      tier: t.tier || 't3',
      startChapter: t.startChapter != null ? String(t.startChapter) : '',
      targetChapter: t.targetChapter != null ? String(t.targetChapter) : '',
    })
    setShowForm(true)
  }

  const submitForm = () => {
    if (!form.title.trim()) { toast('请填写任务名称', 'error'); return }
    const payload: any = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      progressClue: form.progressClue.trim() || null,
      status: form.status,
      priority: form.priority,
      tier: form.tier,
      startChapter: form.startChapter ? Number(form.startChapter) : null,
      targetChapter: form.targetChapter ? Number(form.targetChapter) : null,
    }
    saveMutation.mutate(payload)
  }

  return (
    <div className="space-y-5">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ListChecks className="h-5 w-5 text-amber-400" />
          <h1 className="text-xl font-semibold text-gray-100">征途录</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-40">
            <Select value={filter} options={STATUS_FILTERS} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> 新建任务
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="任务总数" value={summary.total} />
        <StatCard label="待推进" value={summary.active} accent="text-amber-300" />
        <StatCard label="推进中" value={summary.progressing} accent="text-sky-300" />
        <StatCard label="已完成" value={summary.completed} accent="text-emerald-300" />
        <StatCard label="已失败" value={summary.failed} accent="text-red-300" />
        <StatCard label="已放弃" value={summary.abandoned} accent="text-gray-400" />
        <StatCard label="待确认" value={summary.unconfirmed} accent="text-yellow-300" />
      </div>

      {/* 待确认提醒 */}
      {summary.unconfirmed > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>有 {summary.unconfirmed} 条任务待确认，确认后才会注入写作上下文。</span>
        </div>
      )}

      {/* 列表（按状态分组；13-SRS US-21c） */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : list.length === 0 ? (
        <EmptyState icon={<ListChecks className="h-8 w-8" />} message="暂无任务记录，点击「新建任务」开始规划征途" />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => g.tasks.length > 0 && (
            <div key={g.key}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className={cn('text-sm font-semibold', g.accent)}>{g.label}</h2>
                <span className="text-xs text-gray-500">({g.tasks.length})</span>
              </div>
              <div className="space-y-3">
                {g.tasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    characterNames={resolveNames(t.relatedCharacterIds)}
                    onEdit={() => openEdit(t)}
                    onStatus={(status) => statusMutation.mutate({ id: t.id, status }, { onSuccess: () => toast(`已标记：${STATUS_META[status]?.label || status}`, 'info') })}
                    onConfirm={() => confirmMutation.mutate(t.id)}
                    onReject={() => { if (confirm(`确认否决并删除 AI 提取的任务「${t.title}」？`)) deleteMutation.mutate(t.id) }}
                    onDelete={() => { if (confirm(`确认删除任务「${t.title}」？`)) deleteMutation.mutate(t.id) }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 创建/编辑弹窗 */}
      <Dialog open={showForm} onClose={() => setShowForm(false)} title={editing ? '编辑任务' : '新建任务'}>
        <div className="space-y-4">
          <Input label="任务名称" value={form.title} placeholder="如：夺取诛仙古剑" onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea label="描述（任务目标 / 预期走向）" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input label="进度线索（关键词句，用于追踪推进）" value={form.progressClue} placeholder="如：青云门大比、万蝠古窟" onChange={(e) => setForm({ ...form, progressClue: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="状态" value={form.status} options={[
              { value: 'active', label: '待推进' },
              { value: 'progressing', label: '推进中' },
              { value: 'completed', label: '已完成' },
              { value: 'failed', label: '已失败' },
              { value: 'abandoned', label: '已放弃' },
            ]} onChange={(e) => setForm({ ...form, status: e.target.value })} />
            <Select label="优先级" value={form.priority} options={[
              { value: 'high', label: '高' },
              { value: 'normal', label: '中' },
              { value: 'low', label: '低' },
            ]} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Select label="分级" value={form.tier} options={[
              { value: 't1', label: '战略' },
              { value: 't2', label: '战役' },
              { value: 't3', label: '普通' },
            ]} onChange={(e) => setForm({ ...form, tier: e.target.value })} />
            <Input label="起始章" type="number" value={form.startChapter} placeholder="如 1" onChange={(e) => setForm({ ...form, startChapter: e.target.value })} />
            <Input label="目标章" type="number" value={form.targetChapter} placeholder="如 30" onChange={(e) => setForm({ ...form, targetChapter: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>取消</Button>
            <Button onClick={submitForm} loading={saveMutation.isPending}>保存</Button>
          </div>
        </div>
      </Dialog>
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

// 单条任务卡片
function TaskCard({ task: t, characterNames, onEdit, onStatus, onConfirm, onReject, onDelete }: {
  task: any
  characterNames: string[]
  onEdit: () => void
  onStatus: (status: string) => void
  onConfirm: () => void
  onReject: () => void
  onDelete: () => void
}) {
  const status = STATUS_META[t.status] || STATUS_META.active
  const priority = PRIORITY_META[t.priority] || PRIORITY_META.normal
  const tier = TIER_META[t.tier] || TIER_META.t3
  const taskType = t.taskType ? TASK_TYPE_META[t.taskType] : null
  const isAuto = t.sourceType === 'auto'
  const needsConfirm = !t.isConfirmed

  return (
    <Card className={cn(needsConfirm && 'border-amber-500/40')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-gray-100">{t.title}</h3>
              {isAuto && (
                <Badge variant="gold" className="text-[10px]" >AI</Badge>
              )}
              <Badge variant={status.variant} className={status.className}>{status.label}</Badge>
              {taskType && (
                <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', taskType.className)}>{taskType.label}</span>
              )}
              <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', tier.className)}>{tier.label}</span>
              {needsConfirm && (
                <span className="rounded border border-yellow-500/40 bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-300">待确认</span>
              )}
              <span className={cn('text-xs', priority.className)}>{priority.label}</span>
            </div>
            {t.description && (
              <p className="mt-1.5 text-sm text-gray-400">{t.description}</p>
            )}
            {t.progressClue && (
              <p className="mt-1 text-xs text-amber-300/80">线索：{t.progressClue}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                起始：第{t.startChapter ?? '?'}章
              </span>
              <span className="inline-flex items-center gap-1">
                <Target className="h-3 w-3" />
                目标：第{t.targetChapter ?? '?'}章
              </span>
              {characterNames.length > 0 && (
                <span className="inline-flex items-center gap-1 text-gray-400">
                  关联：{characterNames.join('、')}
                </span>
              )}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex shrink-0 items-center gap-1">
            {needsConfirm && (
              <Button size="sm" variant="ghost" title="确认该任务" onClick={onConfirm}>
                <CheckCircle2 className="h-4 w-4 text-yellow-400" />
              </Button>
            )}
            {isAuto && (
              <Button size="sm" variant="ghost" title="否决该 AI 提取任务（删除）" onClick={onReject}>
                <XCircle className="h-4 w-4 text-gray-500" />
              </Button>
            )}
            {t.status === 'active' && (
              <Button size="sm" variant="ghost" title="标记推进中" onClick={() => onStatus('progressing')}>
                <PlayCircle className="h-4 w-4 text-sky-400" />
              </Button>
            )}
            {t.status === 'progressing' && (
              <>
                <Button size="sm" variant="ghost" title="标记完成" onClick={() => onStatus('completed')}>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                </Button>
                <Button size="sm" variant="ghost" title="标记失败" onClick={() => onStatus('failed')}>
                  <XCircle className="h-4 w-4 text-red-400" />
                </Button>
              </>
            )}
            {t.status !== 'completed' && t.status !== 'abandoned' && (
              <Button size="sm" variant="ghost" title="标记放弃" onClick={() => onStatus('abandoned')}>
                <Archive className="h-4 w-4 text-gray-400" />
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
