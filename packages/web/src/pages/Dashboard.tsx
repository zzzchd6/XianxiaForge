import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Database, BookOpen, Sparkles, Pencil, Trash2, Clock, Coins, ChevronRight, ChevronDown, Flame, FileText, Download, Upload } from 'lucide-react'
import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Badge, Dialog, Input, Textarea, Select,
  Spinner, EmptyState, useToast,
} from '../components/ui'
import { useProjects, useCreateProject, useUpdateProject, useDeleteProject } from '../hooks/useProjects'
import { useCurrentProjectId, useSetCurrentProject } from '../hooks/useCurrentProject'
import { settingsApi, generationApi, impactApi, customCharacterApi, projectsApi } from '../lib/api'
import { projectKeys } from '../hooks/useProjects'
import { cn, formatDate, formatWordCount } from '../lib/utils'
import CreationHeatmap from '../components/CreationHeatmap'
import ForeshadowProgress from '../components/ForeshadowProgress'
import DirectionBalanceCard from '../components/DirectionBalanceCard'
import sealSquare from '../assets/seal-square.png'
import { CloudDivider } from '../components/ornaments'

// 格式化耗时（毫秒 → 可读文本）
function formatDuration(startedAt?: string | null, completedAt?: string | null): string {
  if (!startedAt || !completedAt) return '—'
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 0) return '—'
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}秒`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return sec > 0 ? `${min}分${sec}秒` : `${min}分钟`
}

// 项目状态徽章映射
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' }> = {
    active: { label: '进行中', variant: 'success' },
    planning: { label: '规划中', variant: 'warning' },
    paused: { label: '已暂停', variant: 'warning' },
    completed: { label: '已完成', variant: 'default' },
    draft: { label: '草稿', variant: 'warning' },
  }
  const info = map[status] || { label: status || '未知', variant: 'default' as const }
  return <Badge variant={info.variant}>{info.label}</Badge>
}

const GENRE_LABELS: Record<string, string> = {
  xianxia: '仙侠', xuanhuan: '玄幻', wuxia: '武侠', kehuan: '科幻',
  qihuan: '奇幻', dushi: '都市', lishi: '历史', junshi: '军事',
  xianshi: '现实', xuanyi: '悬疑', lingyi: '灵异', erciyuan: '二次元',
  duanpian: '短篇',
}

export default function Dashboard() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [form, setForm] = useState({ name: '', genre: 'xianxia', description: '' })

  // 编辑项目状态
  const [showEdit, setShowEdit] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', genre: '', description: '', defaultImpactCharacterIds: [] as number[] })

  // 删除确认状态
  const [showDelete, setShowDelete] = useState(false)
  const [deletingProject, setDeletingProject] = useState<any>(null)

  // 项目导出/导入（架构升级 Epic5）
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  const handleExportProject = async (project: any) => {
    setExportingId(String(project.id))
    try {
      await projectsApi.exportZip(String(project.id), project.title)
      toast('导出包已开始下载', 'success')
    } catch (err: any) {
      toast(err.message || '导出失败', 'error')
    } finally {
      setExportingId(null)
    }
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!confirm('导入将创建一个全新项目（不覆盖现有项目），确认继续？')) return
    setImporting(true)
    try {
      const res = await projectsApi.importZip(file)
      toast(`项目「${res.title || ''}」导入成功`, 'success')
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
    } catch (err: any) {
      toast(err.message || '导入失败', 'error')
    } finally {
      setImporting(false)
    }
  }

  // 获取项目列表
  const { data: projects, isLoading, error } = useProjects()
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()

  // 当前项目（全局状态）：内嵌统计卡片跟随当前项目；项目卡片点击可切换
  const currentProjectId = useCurrentProjectId()
  const setCurrentProjectId = useSetCurrentProject()

  // 获取数据库状态
  const { data: dbStatus } = useQuery({
    queryKey: ['db-status'],
    queryFn: () => settingsApi.dbStatus(),
  })

  // 获取最近生成任务
  const { data: recentTasks } = useQuery({
    queryKey: ['recent-tasks'],
    queryFn: () => generationApi.tasks(),
  })

  // 候选影响对象人物（编辑弹窗打开时按需加载）
  const { data: impactCandidates } = useQuery({
    queryKey: ['impact-target-candidates', editingId],
    queryFn: () => impactApi.targetCandidates(editingId!),
    enabled: showEdit && !!editingId,
  })

  // 本项目自定义人物也可作为影响对象（负数ID，★标记）
  const { data: customChars } = useQuery({
    queryKey: ['custom-characters', editingId ?? ''],
    queryFn: () => customCharacterApi.list(editingId!),
    enabled: showEdit && !!editingId,
    staleTime: 30 * 1000,
  })

  // 合并候选：自定义人物排前，按 characterId 去重（★版本优先）
  const seenImpactIds = new Set<number>()
  const impactOptions = [
    ...(Array.isArray(customChars) ? customChars.map((c: any) => ({ characterId: c.id, characterName: `★${c.name}` })) : []),
    ...(Array.isArray(impactCandidates) ? impactCandidates : []),
  ].filter((ch: any) => {
    if (seenImpactIds.has(ch.characterId)) return false
    seenImpactIds.add(ch.characterId)
    return true
  })

  // 创建项目
  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast('请输入项目名称', 'error')
      return
    }
    try {
      await createProject.mutateAsync(form)
      toast('项目创建成功', 'success')
      setShowCreate(false)
      setForm({ name: '', genre: 'xianxia', description: '' })
    } catch (err: any) {
      toast(err.message || '创建失败', 'error')
    }
  }

  // 打开编辑弹窗
  const openEdit = (project: any) => {
    setEditingId(String(project.id))
    setEditForm({
      name: project.title || '',
      genre: project.genre || 'xianxia',
      description: project.description || '',
      defaultImpactCharacterIds: Array.isArray(project.defaultImpactCharacterIds)
        ? project.defaultImpactCharacterIds.map(Number)
        : [],
    })
    setShowEdit(true)
  }

  // 保存编辑
  const handleUpdate = async () => {
    if (!editForm.name.trim()) {
      toast('请输入项目名称', 'error')
      return
    }
    try {
      await updateProject.mutateAsync({
        id: editingId!,
        data: {
          title: editForm.name,
          genre: editForm.genre,
          description: editForm.description,
          defaultImpactCharacterIds: editForm.defaultImpactCharacterIds,
        },
      })
      toast('项目已更新', 'success')
      setShowEdit(false)
      setEditingId(null)
    } catch (err: any) {
      toast(err.message || '更新失败', 'error')
    }
  }

  // 打开删除确认
  const openDelete = (project: any) => {
    setDeletingProject(project)
    setShowDelete(true)
  }

  // 确认删除
  const handleDelete = async () => {
    if (!deletingProject) return
    try {
      await deleteProject.mutateAsync(String(deletingProject.id))
      toast('项目已删除', 'success')
      setShowDelete(false)
      setDeletingProject(null)
    } catch (err: any) {
      toast(err.message || '删除失败', 'error')
    }
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-100">仪表盘</h1>
          <img
            src={sealSquare}
            alt="仙指侠尖印"
            className="h-11 w-11 rotate-[-6deg] rounded-[4px] object-cover opacity-90 shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-1 ring-gold-600/30"
          />
        </div>
        <div className="flex gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button variant="outline" onClick={() => importInputRef.current?.click()} loading={importing}>
            <Upload className="h-4 w-4" />
            导入项目
          </Button>
          <Button onClick={() => setShowCreate(true)} variant="outline">
            <Plus className="h-4 w-4" />
            快速创建
          </Button>
          <Button onClick={() => navigate('/wizard')}>
            <Sparkles className="h-4 w-4" />
            新书引导
          </Button>
        </div>
      </div>

      {/* 云纹分隔线 */}
      <CloudDivider className="-mt-2 mb-1" />

      {/* 数据库状态指示器 */}
      <div className="flex gap-4">
        <Card className="flex-1">
          <CardContent className="flex items-center gap-3 p-4">
            <Database className="h-5 w-5 text-gray-400" />
            <div>
              <p className="text-sm text-gray-400">诛仙库</p>
              <p className={`text-sm font-medium ${dbStatus?.zhuxian?.connected ? 'text-ok' : 'text-bad'}`}>
                {dbStatus?.zhuxian?.connected ? '已连接' : '未连接'}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="flex-1">
          <CardContent className="flex items-center gap-3 p-4">
            <Database className="h-5 w-5 text-gray-400" />
            <div>
              <p className="text-sm text-gray-400">创作库</p>
              <p className={`text-sm font-medium ${dbStatus?.creative?.connected ? 'text-ok' : 'text-bad'}`}>
                {dbStatus?.creative?.connected ? '已连接' : '未连接'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 创作统计摘要栏（热力图折叠，UI-02） */}
      {currentProjectId && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40">
          <button
            onClick={() => setShowHeatmap(!showHeatmap)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-gray-800/40"
          >
            <span className="flex items-center gap-2 text-xs text-gray-400">
              <Flame className="h-3.5 w-3.5 text-orange-400" />
              创作统计
            </span>
            <ChevronDown className={cn('h-4 w-4 text-gray-500 transition-transform', showHeatmap && 'rotate-180')} />
          </button>
          {showHeatmap && (
            <div className="border-t border-gray-800 p-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <CreationHeatmap projectId={currentProjectId} />
                </div>
                <div className="space-y-4">
                  <ForeshadowProgress projectId={currentProjectId} />
                  <DirectionBalanceCard projectId={currentProjectId} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 项目列表 */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-gray-200">我的项目</h2>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : error ? (
          <EmptyState message="加载项目列表失败，请检查后端服务" />
        ) : !projects?.length ? (
          <EmptyState
            icon={<BookOpen className="h-10 w-10" />}
            message="暂无项目，点击「新建项目」开始创作"
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project: any) => {
              const isCurrent = String(project.id) === currentProjectId
              return (
              <Card
                key={project.id}
                role="button"
                tabIndex={0}
                onClick={() => setCurrentProjectId(String(project.id))}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCurrentProjectId(String(project.id)) } }}
                className={`cursor-pointer transition-colors ${
                  isCurrent ? 'border-gold-400/70' : 'hover:border-gray-700'
                }`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle>{project.title}</CardTitle>
                      {isCurrent && <Badge variant="default">当前</Badge>}
                    </div>
                    <div className="flex items-center gap-1">
                      <StatusBadge status={project.status} />
                      <button
                        className="ml-1 rounded p-2 text-gray-500 transition-colors hover:bg-gray-700 hover:text-indigo-400"
                        title="编辑项目"
                        aria-label="编辑"
                        onClick={(e) => { e.stopPropagation(); openEdit(project) }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="rounded p-2 text-gray-500 transition-colors hover:bg-gray-700 hover:text-indigo-400"
                        title="导出项目 zip 备份包"
                        aria-label="导出"
                        disabled={exportingId === String(project.id)}
                        onClick={(e) => { e.stopPropagation(); handleExportProject(project) }}
                      >
                        <Download className={`h-3.5 w-3.5 ${exportingId === String(project.id) ? 'animate-pulse' : ''}`} />
                      </button>
                      <button
                        className="rounded p-2 text-gray-500 transition-colors hover:bg-gray-700 hover:text-red-400"
                        title="删除项目"
                        aria-label="删除"
                        onClick={(e) => { e.stopPropagation(); openDelete(project) }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-gray-400">
                    题材：{GENRE_LABELS[project.genre] || project.genre || '未设置'}
                  </p>
                  {project.description && (
                    <p className="text-sm text-gray-500 line-clamp-2">
                      {project.description}
                    </p>
                  )}
                  {/* 字数进度 */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>字数进度</span>
                      <span>
                        {formatWordCount(project.wordCount || 0)}
                        {project.targetWords ? ` / ${formatWordCount(project.targetWords)}` : ''}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-800">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all"
                        style={{
                          width: `${Math.min(
                            ((project.wordCount || 0) / (project.targetWords || 1)) * 100,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-600">
                    更新于 {formatDate(project.updatedAt || project.createdAt)}
                  </p>
                </CardContent>
              </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* 最近生成任务 */}
      {recentTasks && recentTasks.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-gray-200">最近生成任务</h2>
          <Card>
            <CardContent className="divide-y divide-gray-800 p-0">
              {recentTasks.slice(0, 5).map((task: any) => (
                <button
                  key={task.id}
                  onClick={() => task.chapterPlanId && navigate(`/chapters?chapter=${task.chapterPlanId}`)}
                  disabled={!task.chapterPlanId}
                  className="group flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left transition-colors hover:bg-gray-800/40 disabled:cursor-default"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15">
                      <Sparkles className="h-4 w-4 text-indigo-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-200 group-hover:text-indigo-300">
                        {task.chapterTitle
                          ? `第${task.volumeNo ?? 1}卷·第${task.chapterNo ?? '?'}章 ${task.chapterTitle}`
                          : `任务 ${task.id}`}
                      </p>
                      <p className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(task.startedAt, task.completedAt)}
                        </span>
                        {task.tokensUsed != null && (
                          <span className="flex items-center gap-1">
                            <Coins className="h-3 w-3" />
                            {formatWordCount(task.tokensUsed)} tokens
                          </span>
                        )}
                        {task.status === 'completed' && task.chapterPlanId && (
                          <span className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            已生成
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge
                      variant={
                        task.status === 'completed' ? 'success'
                          : task.status === 'failed' ? 'destructive'
                          : 'warning'
                      }
                    >
                      {task.status === 'completed' ? '已完成'
                        : task.status === 'failed' ? '失败'
                        : task.status === 'running' ? '生成中'
                        : task.status === 'auditing' ? '审计中'
                        : task.status === 'revising' ? '修订中'
                        : task.status}
                    </Badge>
                    {task.chapterPlanId && (
                      <ChevronRight className="h-4 w-4 text-gray-600 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-400" />
                    )}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 创建项目弹窗 */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)} title="新建项目">
        <div className="space-y-4">
          <Input
            label="项目名称"
            placeholder="例如：诛仙续写"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Select
            label="题材"
            value={form.genre}
            onChange={(e) => setForm({ ...form, genre: e.target.value })}
            options={[
              { value: 'xianxia', label: '仙侠' },
              { value: 'fantasy', label: '玄幻' },
              { value: 'urban', label: '都市' },
              { value: 'scifi', label: '科幻' },
              { value: 'history', label: '历史' },
              { value: 'other', label: '其他' },
            ]}
          />
          <Textarea
            label="项目描述"
            placeholder="简要描述你的小说设定和方向..."
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} loading={createProject.isPending}>
              创建
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 编辑项目弹窗 */}
      <Dialog open={showEdit} onClose={() => setShowEdit(false)} title="编辑项目">
        <div className="space-y-4">
          <Input
            label="项目名称"
            placeholder="例如：诛仙续写"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
          />
          <Select
            label="题材"
            value={editForm.genre}
            onChange={(e) => setEditForm({ ...editForm, genre: e.target.value })}
            options={[
              { value: 'xianxia', label: '仙侠' },
              { value: 'fantasy', label: '玄幻' },
              { value: 'urban', label: '都市' },
              { value: 'scifi', label: '科幻' },
              { value: 'history', label: '历史' },
              { value: 'other', label: '其他' },
            ]}
          />
          <Textarea
            label="项目描述"
            placeholder="简要描述你的小说设定和方向..."
            rows={3}
            value={editForm.description}
            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
          />

          {/* 默认影响对象 */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-300">默认影响对象</label>
            <p className="text-xs text-gray-500">
              章节未指定 POV 人物时，分支影响变更将作用于此处勾选的人物；不勾选则自动取已出场的前 3 位人物。
            </p>
            {!impactOptions.length ? (
              <p className="rounded-lg border border-gray-800 p-3 text-xs text-gray-600">
                暂无候选——先生成章节内容或创建自定义人物，出场人物会自动列入
              </p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-800 p-2">
                {impactOptions.map((ch: any) => {
                  const checked = editForm.defaultImpactCharacterIds.includes(ch.characterId)
                  return (
                    <label
                      key={ch.characterId}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-800"
                    >
                      <input
                        type="checkbox"
                        className="accent-indigo-500"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? editForm.defaultImpactCharacterIds.filter((x) => x !== ch.characterId)
                            : [...editForm.defaultImpactCharacterIds, ch.characterId]
                          setEditForm({ ...editForm, defaultImpactCharacterIds: next })
                        }}
                      />
                      {ch.characterName}
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowEdit(false)}>
              取消
            </Button>
            <Button onClick={handleUpdate} loading={updateProject.isPending}>
              保存
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={showDelete} onClose={() => setShowDelete(false)} title="删除项目">
        <div className="space-y-4">
          <p className="text-sm text-gray-300">
            确定要删除项目「{deletingProject?.title}」吗？此操作不可撤销，项目下的所有大纲和章节数据将一并删除。
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowDelete(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} loading={deleteProject.isPending}>
              确认删除
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
