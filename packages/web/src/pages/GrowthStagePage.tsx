/**
 * 人物成长弧光卡点管理页（模块3）
 * 为核心人物设定分阶段成长节点（阶段名/章节区间/特质），
 * 生成时由 context-builder 按当前章节号匹配阶段注入特质。
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TrendingUp, Plus, Pencil, Trash2, User, Star, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import {
  Card, CardContent, Badge, Input, Textarea, Button, Spinner, EmptyState, Dialog, useToast,
  Select, Switch,
} from '../components/ui'
import { growthApi, plotMaterialsApi } from '../lib/api'

const PROJECT_ID = '3'

// B2：阶段类型选项
const STAGE_TYPES = [
  { value: '', label: '未分类' },
  { value: '境界突破', label: '境界突破' },
  { value: '心境转变', label: '心境转变' },
  { value: '能力觉醒', label: '能力觉醒' },
  { value: '关系升华', label: '关系升华' },
]

interface GrowthStage {
  id: number
  projectId: number
  characterId: number | null
  characterName: string | null
  stageNo: number
  name: string
  chapterStart: number | null
  chapterEnd: number | null
  traits: string[]
  description: string | null
  stageType: string | null
  isKeyNode: boolean
}

const emptyForm = {
  characterId: '' as string,
  characterName: '',
  stageNo: '1',
  name: '',
  chapterStart: '',
  chapterEnd: '',
  traits: '',
  description: '',
  stageType: '',
  isKeyNode: false,
}

export default function GrowthStagePage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...emptyForm })

  const { data: stages, isLoading } = useQuery({
    queryKey: ['growth-stages', PROJECT_ID],
    queryFn: () => growthApi.list(PROJECT_ID),
  })

  const createMut = useMutation({
    mutationFn: (data: any) => growthApi.create(PROJECT_ID, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['growth-stages'] })
      toast('成长阶段已创建', 'success')
      setDialogOpen(false)
    },
    onError: (e: any) => toast(e.message || '创建失败', 'error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => growthApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['growth-stages'] })
      toast('成长阶段已更新', 'success')
      setDialogOpen(false)
    },
    onError: (e: any) => toast(e.message || '更新失败', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => growthApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['growth-stages'] })
      toast('已删除', 'success')
    },
    onError: (e: any) => toast(e.message || '删除失败', 'error'),
  })

  const openCreate = () => {
    setEditId(null)
    setForm({ ...emptyForm })
    setDialogOpen(true)
  }

  const openEdit = (s: GrowthStage) => {
    setEditId(s.id)
    setForm({
      characterId: s.characterId ? String(s.characterId) : '',
      characterName: s.characterName || '',
      stageNo: String(s.stageNo),
      name: s.name,
      chapterStart: s.chapterStart != null ? String(s.chapterStart) : '',
      chapterEnd: s.chapterEnd != null ? String(s.chapterEnd) : '',
      traits: (s.traits || []).join('、'),
      description: s.description || '',
      stageType: s.stageType || '',
      isKeyNode: !!s.isKeyNode,
    })
    setDialogOpen(true)
  }

  const submitForm = () => {
    if (!form.name.trim()) {
      toast('阶段名称不能为空', 'error')
      return
    }
    const payload = {
      characterId: form.characterId.trim() ? Number(form.characterId) : undefined,
      characterName: form.characterName.trim() || undefined,
      stageNo: Number(form.stageNo) || 1,
      name: form.name.trim(),
      chapterStart: form.chapterStart.trim() ? Number(form.chapterStart) : undefined,
      chapterEnd: form.chapterEnd.trim() ? Number(form.chapterEnd) : undefined,
      traits: form.traits.split(/[、,，]/).map((t) => t.trim()).filter(Boolean),
      description: form.description.trim() || undefined,
      stageType: form.stageType || undefined,
      isKeyNode: form.isKeyNode,
    }
    if (editId) {
      updateMut.mutate({ id: editId, data: payload })
    } else {
      createMut.mutate(payload)
    }
  }

  // 按人物分组
  const grouped = groupByCharacter(stages || [])

  if (isLoading) {
    return <div className="flex justify-center py-20"><Spinner /></div>
  }

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">人物成长弧光</h1>
          <p className="mt-1 text-sm text-gray-400">
            为核心人物设定分阶段成长节点，生成时自动匹配对应阶段的性格与行事风格
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> 新增阶段
        </Button>
      </div>

      {/* 统计 */}
      {grouped.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold text-indigo-300">{grouped.length}</p>
              <p className="text-xs text-gray-400">人物</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold text-emerald-300">{(stages || []).length}</p>
              <p className="text-xs text-gray-400">成长阶段</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold text-amber-300">
                {(stages || []).filter((s: GrowthStage) => s.chapterStart != null).length}
              </p>
              <p className="text-xs text-gray-400">已设章节区间</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 空状态 */}
      {grouped.length === 0 && (
        <EmptyState
          message="尚未设定人物成长阶段，点击「新增阶段」开始配置"
          icon={<TrendingUp className="h-10 w-10 text-gray-600" />}
        />
      )}

      {/* 按人物分组展示 */}
      {grouped.map((group) => (
        <Card key={group.key}>
          <CardContent className="pt-4">
            <div className="mb-3 flex items-center gap-2">
              <User className="h-4 w-4 text-indigo-400" />
              <span className="font-medium text-gray-200">
                {group.name}
                {group.characterId ? <span className="ml-2 text-xs text-gray-500">ID:{group.characterId}</span> : null}
              </span>
              <Badge variant="default" className="ml-auto">{group.stages.length} 阶段</Badge>
            </div>

            {/* 时间轴 */}
            <div className="relative ml-2 space-y-3 border-l border-gray-700 pl-5">
              {group.stages.map((s) => (
                <div key={s.id} className="group relative">
                  {/* 时间轴圆点 */}
                  <div className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-indigo-400 bg-gray-900" />
                  <div className="rounded-lg border border-gray-700/50 bg-gray-800/40 p-3 transition-colors hover:border-gray-600">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-200">
                            第{s.stageNo}阶段「{s.name}」
                          </span>
                          {s.chapterStart != null && (
                            <Badge variant="success" className="text-xs">
                              第{s.chapterStart}章{s.chapterEnd != null ? `~${s.chapterEnd}章` : '起'}
                            </Badge>
                          )}
                          {s.stageType && (
                            <Badge variant="default" className="text-xs">{s.stageType}</Badge>
                          )}
                          {s.isKeyNode && (
                            <Badge variant="warning" className="text-xs">
                              <Star className="mr-0.5 h-3 w-3" /> 关键节点
                            </Badge>
                          )}
                        </div>
                        {s.traits && s.traits.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {s.traits.map((t, i) => (
                              <span key={i} className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-xs text-indigo-300">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                        {s.description && (
                          <p className="mt-1.5 text-xs text-gray-400">{s.description}</p>
                        )}
                        <StageHighlightHints stage={s} />
                      </div>
                      {/* 操作按钮 */}
                      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          onClick={() => openEdit(s)}
                          className="rounded p-2 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                          title="编辑"
                          aria-label="编辑"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => { if (confirm('确认删除此成长阶段？')) deleteMut.mutate(s.id) }}
                          className="rounded p-2 text-gray-400 hover:bg-red-900/40 hover:text-red-300"
                          title="删除"
                          aria-label="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* 新增/编辑对话框 */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editId ? '编辑成长阶段' : '新增成长阶段'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="人物ID（诛仙库）"
              placeholder="如 2"
              value={form.characterId}
              onChange={(e) => setForm({ ...form, characterId: e.target.value })}
            />
            <Input
              label="人物名称"
              placeholder="如 张小凡"
              value={form.characterName}
              onChange={(e) => setForm({ ...form, characterName: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="阶段序号"
              type="number"
              value={form.stageNo}
              onChange={(e) => setForm({ ...form, stageNo: e.target.value })}
            />
            <Input
              label="起始章节"
              type="number"
              placeholder="留空=不限"
              value={form.chapterStart}
              onChange={(e) => setForm({ ...form, chapterStart: e.target.value })}
            />
            <Input
              label="结束章节"
              type="number"
              placeholder="留空=不限"
              value={form.chapterEnd}
              onChange={(e) => setForm({ ...form, chapterEnd: e.target.value })}
            />
          </div>
          <Input
            label="阶段名称 *"
            placeholder="如 少年自卑期"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div className="grid grid-cols-2 items-end gap-3">
            <Select
              label="阶段类型"
              value={form.stageType}
              options={STAGE_TYPES}
              onChange={(e) => setForm({ ...form, stageType: e.target.value })}
            />
            <div className="pb-2">
              <Switch
                checked={form.isKeyNode}
                onChange={(v) => setForm({ ...form, isKeyNode: v })}
                label="关键节点（命中即重点渲染高光）"
              />
            </div>
          </div>
          <Input
            label="阶段特质（用顿号分隔）"
            placeholder="如 内向、隐忍、敏感"
            value={form.traits}
            onChange={(e) => setForm({ ...form, traits: e.target.value })}
          />
          <Textarea
            label="阶段描述"
            placeholder="描述此阶段人物的核心状态与行事逻辑"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={submitForm} disabled={createMut.isPending || updateMut.isPending}>
              {editId ? '保存' : '创建'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

/** 每个成长阶段下方的高光素材推荐（懒加载，展开时才请求） */
function StageHighlightHints({ stage }: { stage: GrowthStage }) {
  const [open, setOpen] = useState(false)
  const keyword = [stage.name, ...(stage.traits || [])].join(' ').trim()

  const { data: highlights, isLoading } = useQuery({
    queryKey: ['stage-highlights', PROJECT_ID, stage.id, keyword],
    queryFn: () => plotMaterialsApi.list(PROJECT_ID, { type: 'highlight', keyword, limit: 2 }),
    enabled: open,
  })

  return (
    <div className="mt-2 border-t border-gray-700/40 pt-1.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-amber-400/80 hover:text-amber-300 transition-colors"
      >
        <Sparkles className="h-3 w-3" />
        推荐高光素材
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {isLoading && <p className="text-xs text-gray-500">检索中…</p>}
          {!isLoading && (!highlights || highlights.length === 0) && (
            <p className="text-xs text-gray-500">暂无匹配的高光素材</p>
          )}
          {(highlights || []).map((h: any) => (
            <div key={h.id} className="rounded bg-amber-500/8 border border-amber-500/15 px-2 py-1.5">
              <p className="text-xs font-medium text-amber-200">{h.title}</p>
              {h.core_plot && (
                <p className="mt-0.5 text-xs text-gray-400 line-clamp-2">{h.core_plot}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 按人物分组（优先characterId，退回characterName） */
function groupByCharacter(stages: GrowthStage[]) {
  const map = new Map<string, { key: string; name: string; characterId: number | null; stages: GrowthStage[] }>()
  for (const s of stages) {
    const key = s.characterId ? `id:${s.characterId}` : `name:${s.characterName || 'unknown'}`
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: s.characterName || (s.characterId ? `人物#${s.characterId}` : '未指定'),
        characterId: s.characterId,
        stages: [],
      })
    }
    map.get(key)!.stages.push(s)
  }
  // 每组内按stageNo排序
  for (const g of map.values()) {
    g.stages.sort((a, b) => a.stageNo - b.stageNo)
  }
  return Array.from(map.values())
}
