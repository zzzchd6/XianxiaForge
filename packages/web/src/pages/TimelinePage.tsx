import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Clock, Plus, CheckCircle2, Star, CircleDot, DownloadCloud, Sparkles,
  User, MapPin, Heart, Sword, Package, Pencil, XCircle,
} from 'lucide-react'
import {
  Card, CardContent, Button, Badge, Dialog, Input, Textarea,
  Select, Spinner, EmptyState, useToast, Tabs,
} from '../components/ui'
import { stateApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import { cn } from '../lib/utils'

const VIEW_TABS = [
  { id: 'timeline', label: '剧情时间线' },
  { id: 'snapshot', label: '人物状态快照' },
  { id: 'chronicle', label: '年鉴' },
]

const FILTER_TABS = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待确认' },
  { id: 'auto_confirmed', label: '自动生效' },
  { id: 'confirmed', label: '已确认' },
  { id: 'rejected', label: '已否决' },
]

/** 状态徽章（v1.4 第三期：新增 auto_confirmed 自动生效 / rejected 已否决） */
function StatusBadge({ status }: { status: string }) {
  if (status === 'confirmed') return <Badge variant="success">已确认</Badge>
  if (status === 'auto_confirmed') {
    return (
      <span title="AI 抽取结果已自动生效，可确认或否决">
        <Badge variant="default">自动生效</Badge>
      </span>
    )
  }
  if (status === 'rejected') return <Badge variant="destructive">已否决</Badge>
  return <Badge variant="warning">待确认</Badge>
}

interface MilestoneForm {
  chapterNo: string
  storyTime: string
  title: string
  description: string
  importance: string
}

const emptyForm: MilestoneForm = {
  chapterNo: '', storyTime: '', title: '', description: '', importance: 'normal',
}

interface SnapshotForm {
  characterId: string
  characterName: string
  chapterNo: string
  location: string
  realm: string
  injury: string
  mentalState: string
  possessedItems: string
}

const emptySnapshotForm: SnapshotForm = {
  characterId: '', characterName: '', chapterNo: '0',
  location: '', realm: '', injury: '', mentalState: '', possessedItems: '',
}

export default function TimelinePage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [view, setView] = useState('timeline')
  const [filter, setFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<MilestoneForm>(emptyForm)
  // 分支感知：默认仅展示活跃分支路径上的自动抽取节点
  const [branchAware, setBranchAware] = useState(true)

  const projectId = useCurrentProjectId()

  // 拉取时间线里程碑（后端按 chapterNo, sortOrder 排序；branchAware 时过滤废弃分支的自动节点）
  const { data: timelineData, isLoading } = useQuery({
    queryKey: ['timeline', projectId, branchAware],
    queryFn: () => stateApi.timeline(projectId, undefined, branchAware),
    enabled: !!projectId,
  })

  const list: any[] = timelineData?.milestones || []
  const branchPath: number[] = timelineData?.branchPath || []

  const summary = useMemo(() => ({
    total: list.length,
    confirmed: list.filter((m) => m.status === 'confirmed').length,
    auto: list.filter((m) => m.status === 'auto_confirmed').length,
    pending: list.filter((m) => m.status === 'pending').length,
    key: list.filter((m) => m.importance === 'key').length,
  }), [list])

  const filtered = useMemo(() => {
    if (filter === 'all') return list
    return list.filter((m) => m.status === filter)
  }, [list, filter])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['timeline', projectId] })

  // 手动创建里程碑
  const createMutation = useMutation({
    mutationFn: (data: any) => stateApi.createTimeline(projectId, data),
    onSuccess: () => {
      invalidate()
      setShowForm(false)
      setForm(emptyForm)
      toast('时间线节点已添加', 'success')
    },
    onError: (err: any) => toast(err.message || '添加失败', 'error'),
  })

  // 确认里程碑
  const confirmMutation = useMutation({
    mutationFn: (id: number) => stateApi.confirmTimeline(id),
    onSuccess: () => {
      invalidate()
      toast('已确认该时间节点', 'success')
    },
    onError: (err: any) => toast(err.message || '确认失败', 'error'),
  })

  // 否决自动生效的里程碑（v1.4 第三期）
  const rejectTimelineMut = useMutation({
    mutationFn: (id: number) => stateApi.rejectTimeline(id),
    onSuccess: () => {
      invalidate()
      toast('已否决该时间节点，不再进入写作上下文', 'success')
    },
    onError: (err: any) => toast(err.message || '否决失败', 'error'),
  })

  // 引导初始化（从卷大纲 keyEvents 生成待确认节点）
  const bootstrapMutation = useMutation({
    mutationFn: () => stateApi.bootstrap(projectId),
    onSuccess: (res: any) => {
      invalidate()
      toast(`已从大纲引导 ${res?.seededMilestones ?? 0} 个时间节点`, 'success')
    },
    onError: (err: any) => toast(err.message || '引导失败', 'error'),
  })

  // LLM 抽取指定章节的时间信息
  const [extractChapter, setExtractChapter] = useState('')
  const extractMutation = useMutation({
    mutationFn: (chapterNo: number) => stateApi.extract(projectId, chapterNo),
    onSuccess: (res: any) => {
      invalidate()
      toast(`已抽取第${extractChapter}章：新增 ${res?.timelineInserted ?? res?.extraction?.timeline?.length ?? 0} 个时间节点`, 'success')
      setExtractChapter('')
    },
    onError: (err: any) => toast(err.message || '抽取失败', 'error'),
  })

  // ---------- 人物状态快照 ----------
  const [snapshotFilter, setSnapshotFilter] = useState('all')
  const [showSnapshotForm, setShowSnapshotForm] = useState(false)
  const [editSnapshotId, setEditSnapshotId] = useState<number | null>(null)
  const [snapshotForm, setSnapshotForm] = useState<SnapshotForm>(emptySnapshotForm)

  const { data: snapshots, isLoading: snapshotLoading } = useQuery({
    queryKey: ['snapshots', projectId],
    queryFn: () => stateApi.snapshots(projectId),
    enabled: !!projectId && (view === 'snapshot' || view === 'chronicle'),
  })

  const snapshotList: any[] = snapshots || []

  const snapshotSummary = useMemo(() => ({
    total: snapshotList.length,
    confirmed: snapshotList.filter((s) => s.status === 'confirmed').length,
    auto: snapshotList.filter((s) => s.status === 'auto_confirmed').length,
    pending: snapshotList.filter((s) => s.status === 'pending').length,
    characters: new Set(snapshotList.map((s) => s.characterName)).size,
  }), [snapshotList])

  const filteredSnapshots = useMemo(() => {
    if (snapshotFilter === 'all') return snapshotList
    return snapshotList.filter((s) => s.status === snapshotFilter)
  }, [snapshotList, snapshotFilter])

  const groupedSnapshots = useMemo(() => {
    const map = new Map<string, { name: string; characterId: number | null; items: any[] }>()
    for (const s of filteredSnapshots) {
      const key = s.characterName || `ID:${s.characterId ?? '?'}`
      if (!map.has(key)) map.set(key, { name: key, characterId: s.characterId, items: [] })
      map.get(key)!.items.push(s)
    }
    for (const g of map.values()) g.items.sort((a, b) => a.chapterNo - b.chapterNo)
    return Array.from(map.values())
  }, [filteredSnapshots])

  // ---------- 年鉴视图：按章节合并里程碑 + 人物快照 ----------
  const chronicleEntries = useMemo(() => {
    const map = new Map<number, { chapterNo: number; milestones: any[]; snapshots: any[] }>()
    for (const m of list) {
      const ch = m.chapterNo ?? 0
      if (!map.has(ch)) map.set(ch, { chapterNo: ch, milestones: [], snapshots: [] })
      map.get(ch)!.milestones.push(m)
    }
    for (const s of snapshotList) {
      const ch = s.chapterNo ?? 0
      if (!map.has(ch)) map.set(ch, { chapterNo: ch, milestones: [], snapshots: [] })
      map.get(ch)!.snapshots.push(s)
    }
    return Array.from(map.values()).sort((a, b) => a.chapterNo - b.chapterNo)
  }, [list, snapshotList])

  const invalidateSnapshots = () => queryClient.invalidateQueries({ queryKey: ['snapshots', projectId] })

  const snapshotCreateMut = useMutation({
    mutationFn: (data: any) => stateApi.createSnapshot(projectId, data),
    onSuccess: () => {
      invalidateSnapshots()
      setShowSnapshotForm(false)
      setSnapshotForm(emptySnapshotForm)
      toast('状态快照已创建', 'success')
    },
    onError: (e: any) => toast(e.message || '创建失败', 'error'),
  })

  const snapshotUpdateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => stateApi.updateSnapshot(id, data),
    onSuccess: () => {
      invalidateSnapshots()
      setShowSnapshotForm(false)
      setSnapshotForm(emptySnapshotForm)
      toast('快照已更新', 'success')
    },
    onError: (e: any) => toast(e.message || '更新失败', 'error'),
  })

  const snapshotConfirmMut = useMutation({
    mutationFn: (id: number) => stateApi.confirmSnapshot(id),
    onSuccess: () => {
      invalidateSnapshots()
      toast('已确认该状态快照', 'success')
    },
    onError: (e: any) => toast(e.message || '确认失败', 'error'),
  })

  // 否决自动生效的快照（v1.4 第三期）
  const snapshotRejectMut = useMutation({
    mutationFn: (id: number) => stateApi.rejectSnapshot(id),
    onSuccess: () => {
      invalidateSnapshots()
      toast('已否决该状态快照，不再进入写作上下文', 'success')
    },
    onError: (e: any) => toast(e.message || '否决失败', 'error'),
  })

  const openSnapshotCreate = () => {
    setEditSnapshotId(null)
    setSnapshotForm(emptySnapshotForm)
    setShowSnapshotForm(true)
  }

  const openSnapshotEdit = (s: any) => {
    setEditSnapshotId(s.id)
    setSnapshotForm({
      characterId: s.characterId ? String(s.characterId) : '',
      characterName: s.characterName || '',
      chapterNo: String(s.chapterNo ?? 0),
      location: s.location || '',
      realm: s.realm || '',
      injury: s.injury || '',
      mentalState: s.mentalState || '',
      possessedItems: (s.possessedItems || []).join('、'),
    })
    setShowSnapshotForm(true)
  }

  const handleSnapshotSubmit = () => {
    if (!snapshotForm.characterName.trim()) {
      toast('人物名称不能为空', 'error')
      return
    }
    const payload = {
      characterId: snapshotForm.characterId.trim() ? Number(snapshotForm.characterId) : undefined,
      characterName: snapshotForm.characterName.trim(),
      chapterNo: Number(snapshotForm.chapterNo) || 0,
      location: snapshotForm.location.trim() || undefined,
      realm: snapshotForm.realm.trim() || undefined,
      injury: snapshotForm.injury.trim() || undefined,
      mentalState: snapshotForm.mentalState.trim() || undefined,
      possessedItems: snapshotForm.possessedItems.split(/[、,，]/).map((t) => t.trim()).filter(Boolean),
    }
    if (editSnapshotId) {
      snapshotUpdateMut.mutate({ id: editSnapshotId, data: payload })
    } else {
      snapshotCreateMut.mutate(payload)
    }
  }

  const handleCreate = () => {
    if (!form.title.trim()) {
      toast('请输入事件标题', 'error')
      return
    }
    createMutation.mutate({
      chapterNo: form.chapterNo ? Number(form.chapterNo) : 0,
      storyTime: form.storyTime || undefined,
      title: form.title,
      description: form.description || undefined,
      importance: form.importance,
      status: 'pending',
    })
  }

  return (
    <div className="space-y-6">
      {/* 顶层视图切换 */}
      <Tabs tabs={VIEW_TABS} active={view} onChange={setView} />

      {view === 'timeline' ? (
        <>
          {/* 页头 */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-100">
                <Clock className="h-6 w-6 text-indigo-400" />
                剧情时间线
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                自动梳理已生成章节的时间顺序与核心事件，长按拖动可修正（点击节点跳转章节）
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => bootstrapMutation.mutate()}
                loading={bootstrapMutation.isPending}
              >
                <DownloadCloud className="h-3.5 w-3.5" />
                从大纲引导
              </Button>
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus className="h-3.5 w-3.5" />
                添加节点
              </Button>
            </div>
          </div>

          {/* 统计卡片 */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: '时间节点总数', value: summary.total, className: 'text-indigo-300' },
              { label: '生效中（含自动）', value: summary.confirmed + summary.auto, className: 'text-emerald-300' },
              { label: '待确认', value: summary.pending, className: 'text-amber-300' },
              { label: '关键节点', value: summary.key, className: 'text-rose-300' },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className={cn('mt-1 text-2xl font-bold', s.className)}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* LLM 抽取工具条 */}
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Sparkles className="h-4 w-4 shrink-0 text-indigo-400" />
              <span className="text-sm text-gray-400">从已生成章节自动抽取时间信息：</span>
              <Input
                type="number"
                placeholder="章节号"
                aria-label="章节号"
                className="w-28"
                value={extractChapter}
                onChange={(e) => setExtractChapter(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!extractChapter}
                loading={extractMutation.isPending}
                onClick={() => extractMutation.mutate(Number(extractChapter))}
              >
                抽取该章
              </Button>
            </CardContent>
          </Card>

          {/* 筛选 + 分支感知开关 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs tabs={FILTER_TABS} active={filter} onChange={setFilter} />
            <button
              onClick={() => setBranchAware((v) => !v)}
              role="switch"
              aria-checked={branchAware}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors',
                branchAware
                  ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300'
                  : 'border-gray-700 text-gray-400 hover:text-gray-200'
              )}
              title="开启后仅展示活跃分支路径上自动抽取的时间节点，手动添加/大纲引导的节点不受影响"
            >
              <span className={cn('h-3.5 w-6 rounded-full p-0.5 transition-colors', branchAware ? 'bg-indigo-500' : 'bg-gray-600')}>
                <span className={cn('block h-2.5 w-2.5 rounded-full bg-white transition-transform', branchAware && 'translate-x-2.5')} />
              </span>
              仅活跃分支路径
            </button>
          </div>

          {/* 活跃分支路径提示 */}
          {branchAware && branchPath.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-4 py-2.5 text-xs text-indigo-300/90">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span>
                当前展示活跃分支路径：第 {branchPath.join('、')} 章
                <span className="ml-2 text-gray-500">（已废弃分支的自动抽取节点已隐藏，可关闭右上角开关查看全部）</span>
              </span>
            </div>
          )}

          {/* 时间线主体 */}
          {isLoading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Clock className="h-8 w-8" />}
              message="暂无时间节点，生成章节后会自动抽取时间线，也可点击「从大纲引导」或「添加节点」手动创建"
            />
          ) : (
            <div className="relative pl-8">
              {/* 纵向时间轴竖线 */}
              <div className="absolute bottom-2 left-3 top-2 w-px bg-gray-800" />
              <div className="space-y-3">
                {filtered.map((m) => (
                  <div key={m.id} className="relative">
                    {/* 轴上节点圆点 */}
                    <span
                      className={cn(
                        'absolute -left-[22px] top-4 flex h-3 w-3 items-center justify-center rounded-full ring-4 ring-gray-950',
                        m.importance === 'key' ? 'bg-rose-400' : m.status === 'confirmed' ? 'bg-emerald-400' : 'bg-amber-400'
                      )}
                    />
                    <Card
                      className={cn(
                        'cursor-pointer transition-colors hover:border-indigo-700',
                        m.status === 'pending' && 'border-amber-800/50'
                      )}
                      role="button"
                      tabIndex={0}
                      onClick={() => m.chapterNo > 0 && navigate('/chapters')}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); m.chapterNo > 0 && navigate('/chapters') } }}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-indigo-400">
                                第{m.chapterNo || '?'}章
                              </span>
                              {m.storyTime && (
                                <Badge variant="default">{m.storyTime}</Badge>
                              )}
                              {m.importance === 'key' && (
                                <span className="inline-flex items-center gap-0.5 text-xs text-rose-300">
                                  <Star className="h-3 w-3 fill-rose-300" />
                                  关键
                                </span>
                              )}
                              <StatusBadge status={m.status} />
                              {m.source && m.source !== 'manual' && (
                                <span className="text-[10px] text-gray-600">
                                  {m.source === 'bootstrap' ? '大纲引导' : m.source === 'extracted' ? 'AI抽取' : m.source}
                                </span>
                              )}
                            </div>
                            <p className="mt-1.5 text-sm font-medium text-gray-200">{m.title}</p>
                            {m.description && (
                              <p className="mt-1 text-xs text-gray-500">{m.description}</p>
                            )}
                          </div>
                          {(m.status === 'pending' || m.status === 'auto_confirmed') && (
                            <div className="flex shrink-0 gap-1.5">
                              {m.status === 'auto_confirmed' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  loading={rejectTimelineMut.isPending}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    rejectTimelineMut.mutate(m.id)
                                  }}
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  否决
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                loading={confirmMutation.isPending}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  confirmMutation.mutate(m.id)
                                }}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                确认
                              </Button>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 添加节点弹窗 */}
          <Dialog
            open={showForm}
            onClose={() => setShowForm(false)}
            title="添加时间节点"
          >
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="章节号"
                  type="number"
                  value={form.chapterNo}
                  onChange={(e) => setForm({ ...form, chapterNo: e.target.value })}
                  placeholder="0=卷级/全局"
                />
                <Input
                  label="故事时间"
                  value={form.storyTime}
                  onChange={(e) => setForm({ ...form, storyTime: e.target.value })}
                  placeholder="如：三日后 / 清晨"
                />
              </div>
              <Input
                label="事件标题"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="本章核心事件"
              />
              <Textarea
                label="事件描述"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
              <Select
                label="重要性"
                value={form.importance}
                onChange={(e) => setForm({ ...form, importance: e.target.value })}
                options={[
                  { value: 'normal', label: '普通节点' },
                  { value: 'key', label: '关键节点' },
                ]}
              />
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setShowForm(false)}>取消</Button>
                <Button onClick={handleCreate} loading={createMutation.isPending}>添加</Button>
              </div>
            </div>
          </Dialog>
        </>
      ) : view === 'snapshot' ? (
        <>
          {/* ===== 人物状态快照视图 ===== */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-100">
                <User className="h-6 w-6 text-indigo-400" />
                人物状态快照
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                追踪人物在各章节的状态变化（位置/境界/伤势/心理/持有物），确认后供生成时校验一致性
              </p>
            </div>
            <Button size="sm" onClick={openSnapshotCreate}>
              <Plus className="h-3.5 w-3.5" />
              添加快照
            </Button>
          </div>

          {/* 统计 */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: '快照总数', value: snapshotSummary.total, className: 'text-indigo-300' },
              { label: '生效中（含自动）', value: snapshotSummary.confirmed + snapshotSummary.auto, className: 'text-emerald-300' },
              { label: '待确认', value: snapshotSummary.pending, className: 'text-amber-300' },
              { label: '涉及人物', value: snapshotSummary.characters, className: 'text-sky-300' },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className={cn('mt-1 text-2xl font-bold', s.className)}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* 筛选 */}
          <Tabs tabs={FILTER_TABS} active={snapshotFilter} onChange={setSnapshotFilter} />

          {/* 快照主体 */}
          {snapshotLoading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : groupedSnapshots.length === 0 ? (
            <EmptyState
              icon={<User className="h-8 w-8" />}
              message="暂无状态快照，生成章节后会自动抽取人物状态，也可点击「添加快照」手动创建"
            />
          ) : (
            <div className="space-y-5">
              {groupedSnapshots.map((group) => (
                <Card key={group.name}>
                  <CardContent className="pt-4">
                    <div className="mb-3 flex items-center gap-2">
                      <User className="h-4 w-4 text-indigo-400" />
                      <span className="font-medium text-gray-200">{group.name}</span>
                      {group.characterId && (
                        <span className="text-xs text-gray-500">ID:{group.characterId}</span>
                      )}
                      <Badge variant="default" className="ml-auto">{group.items.length} 条</Badge>
                    </div>
                    <div className="space-y-2">
                      {group.items.map((s) => (
                        <div
                          key={s.id}
                          className={cn(
                            'group rounded-lg border p-3 transition-colors',
                            s.status === 'pending'
                              ? 'border-amber-800/50 bg-amber-950/10'
                              : 'border-gray-700/50 bg-gray-800/30'
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-medium text-indigo-400">
                                  第{s.chapterNo}章
                                </span>
                                <StatusBadge status={s.status} />
                                {s.source && s.source !== 'manual' && (
                                  <span className="text-[10px] text-gray-600">
                                    {s.source === 'bootstrap' ? '引导' : s.source === 'extracted' ? 'AI抽取' : s.source}
                                  </span>
                                )}
                              </div>
                              {/* 状态字段网格 */}
                              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400 sm:grid-cols-3">
                                {s.location && (
                                  <span className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3 text-gray-500" />
                                    {s.location}
                                  </span>
                                )}
                                {s.realm && (
                                  <span className="flex items-center gap-1">
                                    <Sword className="h-3 w-3 text-gray-500" />
                                    {s.realm}
                                  </span>
                                )}
                                {s.injury && (
                                  <span className="flex items-center gap-1">
                                    <Heart className="h-3 w-3 text-rose-400" />
                                    {s.injury}
                                  </span>
                                )}
                                {s.mentalState && (
                                  <span className="flex items-center gap-1">
                                    <Sparkles className="h-3 w-3 text-gray-500" />
                                    {s.mentalState}
                                  </span>
                                )}
                              </div>
                              {s.possessedItems && s.possessedItems.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {s.possessedItems.map((item: string, i: number) => (
                                    <span key={i} className="inline-flex items-center gap-0.5 rounded bg-gray-700/50 px-1.5 py-0.5 text-[10px] text-gray-300">
                                      <Package className="h-2.5 w-2.5" />
                                      {item}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            {/* 操作按钮 */}
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                onClick={() => openSnapshotEdit(s)}
                                className="rounded p-2 text-gray-400 opacity-0 transition-opacity hover:bg-gray-700 hover:text-gray-200 group-hover:opacity-100 focus-within:opacity-100 focus:opacity-100"
                                title="编辑"
                                aria-label="编辑"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              {(s.status === 'pending' || s.status === 'auto_confirmed') && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  loading={snapshotConfirmMut.isPending}
                                  onClick={() => snapshotConfirmMut.mutate(s.id)}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  确认
                                </Button>
                              )}
                              {s.status === 'auto_confirmed' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  loading={snapshotRejectMut.isPending}
                                  onClick={() => snapshotRejectMut.mutate(s.id)}
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  否决
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* 快照新增/编辑弹窗 */}
          <Dialog
            open={showSnapshotForm}
            onClose={() => setShowSnapshotForm(false)}
            title={editSnapshotId ? '编辑状态快照' : '添加状态快照'}
          >
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="人物名称 *"
                  placeholder="如 张小凡"
                  value={snapshotForm.characterName}
                  onChange={(e) => setSnapshotForm({ ...snapshotForm, characterName: e.target.value })}
                />
                <Input
                  label="人物ID（诛仙库）"
                  placeholder="如 2"
                  value={snapshotForm.characterId}
                  onChange={(e) => setSnapshotForm({ ...snapshotForm, characterId: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="章节号"
                  type="number"
                  placeholder="0=初始状态"
                  value={snapshotForm.chapterNo}
                  onChange={(e) => setSnapshotForm({ ...snapshotForm, chapterNo: e.target.value })}
                />
                <Input
                  label="所在位置"
                  placeholder="如 大竹峰"
                  value={snapshotForm.location}
                  onChange={(e) => setSnapshotForm({ ...snapshotForm, location: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="修为境界"
                  placeholder="如 玉清境第三层"
                  value={snapshotForm.realm}
                  onChange={(e) => setSnapshotForm({ ...snapshotForm, realm: e.target.value })}
                />
                <Input
                  label="伤势/身体状况"
                  placeholder="如 右臂骨折未愈"
                  value={snapshotForm.injury}
                  onChange={(e) => setSnapshotForm({ ...snapshotForm, injury: e.target.value })}
                />
              </div>
              <Input
                label="心理状态"
                placeholder="如 对师门心生愧疚，暗自决心"
                value={snapshotForm.mentalState}
                onChange={(e) => setSnapshotForm({ ...snapshotForm, mentalState: e.target.value })}
              />
              <Input
                label="持有物品（顿号分隔）"
                placeholder="如 噬魂棒、玄火鉴"
                value={snapshotForm.possessedItems}
                onChange={(e) => setSnapshotForm({ ...snapshotForm, possessedItems: e.target.value })}
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setShowSnapshotForm(false)}>取消</Button>
                <Button
                  onClick={handleSnapshotSubmit}
                  disabled={snapshotCreateMut.isPending || snapshotUpdateMut.isPending}
                >
                  {editSnapshotId ? '保存' : '创建'}
                </Button>
              </div>
            </div>
          </Dialog>
        </>
      ) : (
        <>
          {/* ===== 年鉴视图 ===== */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-100">
                <Clock className="h-6 w-6 text-indigo-400" />
                年鉴
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                以章节为锚点，将剧情里程碑与人物状态变化整合为编年史式叙事
              </p>
            </div>
          </div>

          {isLoading || snapshotLoading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : (
            <div className="space-y-0">
              {chronicleEntries.map((entry, i) => (
                <div key={i} className="relative pl-6 pb-6 last:pb-0">
                  {/* 时间轴线 */}
                  {i < chronicleEntries.length - 1 && (
                    <div className="absolute left-[7px] top-4 bottom-0 w-px bg-gray-700" />
                  )}
                  {/* 节点圆点 */}
                  <div className="absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-indigo-500 bg-gray-900" />
                  {/* 内容 */}
                  <div className="ml-2">
                    <h4 className="text-sm font-medium text-gray-200">第{entry.chapterNo}章</h4>
                    {entry.milestones.map((m: any, mi: number) => (
                      <div key={mi} className="mt-1.5 rounded-lg border border-gray-700/50 bg-gray-800/40 p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-indigo-300">{m.title}</span>
                          {m.importance === 'key' && (
                            <span className="rounded bg-amber-500/20 px-1 py-px text-[9px] text-amber-400">关键</span>
                          )}
                        </div>
                        {m.description && <p className="mt-1 text-xs text-gray-400">{m.description}</p>}
                        {m.storyTime && <p className="mt-0.5 text-[10px] text-gray-600">{m.storyTime}</p>}
                      </div>
                    ))}
                    {entry.snapshots.map((s: any, si: number) => (
                      <div key={si} className="mt-1 flex flex-wrap gap-1.5">
                        <span className="rounded-md border border-gray-700/60 bg-gray-800/60 px-2 py-1 text-[10px] text-gray-400">
                          {s.characterName || `角色#${s.characterId}`}
                          {s.realm && <span className="ml-1 text-indigo-400">{s.realm}</span>}
                          {s.location && <span className="ml-1 text-emerald-400">@{s.location}</span>}
                          {s.injury && <span className="ml-1 text-red-400">{s.injury}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {!chronicleEntries.length && <EmptyState message="暂无时间线数据，无法生成年鉴" />}
            </div>
          )}
        </>
      )}
    </div>
  )
}
