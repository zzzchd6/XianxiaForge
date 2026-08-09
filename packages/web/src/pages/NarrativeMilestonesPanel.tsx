/**
 * 叙事里程碑面板（12-SRS 动态叙事引擎）
 * 故事骨架层：不绑死章节号的叙事锚点，支持从卷大纲提取/手动增删/排序/状态流转。
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Sparkles, Edit2, Trash2, ArrowUp, ArrowDown, Flag } from 'lucide-react'
import {
  Card, CardContent, Button, Badge, Dialog, Input, Textarea, Select,
  Spinner, EmptyState, useToast,
} from '../components/ui'
import { narrativeApi } from '../lib/api'

const STATUS_LABEL: Record<string, string> = {
  upcoming: '未达成',
  active: '推进中',
  reached: '已达成',
}
const IMPORTANCE_LABEL: Record<string, string> = {
  critical: '关键节点',
  major: '重要',
  minor: '次要',
}

export default function NarrativeMilestonesPanel({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState({
    label: '', description: '', importance: 'major', status: 'upcoming', mustHappen: '',
  })

  const { data: milestones, isLoading } = useQuery({
    queryKey: ['narrative-milestones', projectId],
    queryFn: () => narrativeApi.milestones(projectId),
    enabled: !!projectId,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['narrative-milestones', projectId] })

  // 从卷大纲一键提取（幂等）
  const extractMutation = useMutation({
    mutationFn: () => narrativeApi.extractMilestones(projectId),
    onSuccess: (res: any) => {
      invalidate()
      toast(`已提取 ${res?.created ?? 0} 条里程碑（跳过重复 ${res?.skipped ?? 0} 条）`, 'success')
    },
    onError: (err: any) => toast(err.message || '提取失败', 'error'),
  })

  const saveMutation = useMutation({
    mutationFn: (data: any) =>
      editing
        ? narrativeApi.updateMilestone(projectId, editing.id, data)
        : narrativeApi.createMilestone(projectId, data),
    onSuccess: () => {
      invalidate()
      setShowForm(false)
      setEditing(null)
      toast(editing ? '里程碑已更新' : '里程碑已创建', 'success')
    },
    onError: (err: any) => toast(err.message || '保存失败', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => narrativeApi.deleteMilestone(projectId, id),
    onSuccess: () => { invalidate(); toast('里程碑已删除', 'success') },
    onError: (err: any) => toast(err.message || '删除失败', 'error'),
  })

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: number[]) => narrativeApi.reorderMilestones(projectId, orderedIds),
    onSuccess: invalidate,
    onError: (err: any) => toast(err.message || '排序失败', 'error'),
  })

  const list: any[] = Array.isArray(milestones) ? milestones : []

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= list.length) return
    const ids = list.map((m: any) => m.id)
    const tmp = ids[idx]; ids[idx] = ids[target]; ids[target] = tmp
    reorderMutation.mutate(ids)
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ label: '', description: '', importance: 'major', status: 'upcoming', mustHappen: '' })
    setShowForm(true)
  }
  const openEdit = (m: any) => {
    setEditing(m)
    setForm({
      label: m.label || '',
      description: m.description || '',
      importance: m.importance || 'major',
      status: m.status || 'upcoming',
      mustHappen: Array.isArray(m.mustHappen) ? m.mustHappen.join('\n') : '',
    })
    setShowForm(true)
  }
  const handleSave = () => {
    if (!form.label.trim()) { toast('请输入里程碑名称', 'error'); return }
    saveMutation.mutate({
      label: form.label,
      description: form.description || null,
      importance: form.importance,
      status: form.status,
      mustHappen: form.mustHappen.split('\n').map((s) => s.trim()).filter(Boolean),
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          故事骨架层：里程碑是不绑死章节号的叙事锚点，分支剧情最终须向其汇合。
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => extractMutation.mutate()} loading={extractMutation.isPending}>
            <Sparkles className="h-3.5 w-3.5" />
            从卷大纲提取
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            新建里程碑
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : !list.length ? (
        <EmptyState message="暂无里程碑。可点击「从卷大纲提取」自动抽取关键事件，或手动新建。" />
      ) : (
        <div className="space-y-2">
          {list.map((m: any, idx: number) => (
            <Card key={m.id}>
              <CardContent className="flex items-start gap-3 p-3">
                <Flag className={`mt-0.5 h-4 w-4 shrink-0 ${m.importance === 'critical' ? 'text-amber-400' : 'text-indigo-400'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-100">{m.label}</span>
                    <Badge variant={m.importance === 'critical' ? 'warning' : 'default'}>
                      {IMPORTANCE_LABEL[m.importance] || m.importance}
                    </Badge>
                    <Badge variant={m.status === 'reached' ? 'success' : m.status === 'active' ? 'gold' : 'default'}>
                      {STATUS_LABEL[m.status] || m.status}
                    </Badge>
                    {m.targetChapterFrom != null && (
                      <span className="text-xs text-gray-500">
                        预估第{m.targetChapterFrom}{m.targetChapterTo && m.targetChapterTo !== m.targetChapterFrom ? `-${m.targetChapterTo}` : ''}章
                      </span>
                    )}
                  </div>
                  {m.description && <p className="mt-1 text-xs text-gray-400">{m.description}</p>}
                  {Array.isArray(m.mustHappen) && m.mustHappen.length > 0 && (
                    <p className="mt-1 text-xs text-gray-500">必须达成：{m.mustHappen.join('；')}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" aria-label="上移" onClick={() => move(idx, -1)} disabled={idx === 0}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="下移" onClick={() => move(idx, 1)} disabled={idx === list.length - 1}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="编辑" onClick={() => openEdit(m)}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="删除"
                    onClick={() => {
                      if (confirm(`确认删除里程碑「${m.label}」？此操作不可恢复。`)) {
                        deleteMutation.mutate(m.id)
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 新建/编辑弹窗 */}
      <Dialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditing(null) }}
        title={editing ? '编辑里程碑' : '新建里程碑'}
      >
        <div className="space-y-4">
          <Input
            label="里程碑名称"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="例如：主角拜入青云门"
          />
          <Textarea
            label="描述（可选）"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <Textarea
            label="必须达成的要素（每行一个）"
            rows={3}
            value={form.mustHappen}
            onChange={(e) => setForm({ ...form, mustHappen: e.target.value })}
            placeholder="汇合时剧情必须包含的核心要素"
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="重要性"
              value={form.importance}
              onChange={(e) => setForm({ ...form, importance: e.target.value })}
              options={[
                { value: 'critical', label: '关键节点（必须发生）' },
                { value: 'major', label: '重要' },
                { value: 'minor', label: '次要' },
              ]}
            />
            <Select
              label="状态"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              options={[
                { value: 'upcoming', label: '未达成' },
                { value: 'active', label: '推进中' },
                { value: 'reached', label: '已达成' },
              ]}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => { setShowForm(false); setEditing(null) }}>取消</Button>
            <Button onClick={handleSave} loading={saveMutation.isPending}>保存</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
