/**
 * 人物关系动态推演面板（模块8）
 * 选择两个人物与一个关键事件，AI推演二者关系的变化，
 * 确认后写入 custom_character_relation 表。
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Network, Plus, Trash2, Sparkles, Loader2, Pencil } from 'lucide-react'
import {
  Card, CardContent, Badge, Input, Textarea, Button, Spinner, EmptyState, Dialog, useToast,
} from './ui'
import { relationApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import { useCharacterNameResolver } from '../lib/useAllCharacters'

interface InferOption {
  relType: string
  relLevel: number
  description: string
  interactPattern: string
}

export default function RelationPanel() {
  const qc = useQueryClient()
  const { toast } = useToast()
  // 当前项目（全局状态，侧边栏可切换）
  const projectId = useCurrentProjectId()
  // 人物名称解析：正数ID→诛仙库人物，负数ID→本项目自定义人物（带★）
  const resolveName = useCharacterNameResolver(projectId)
  const [inferOpen, setInferOpen] = useState(false)
  const [form, setForm] = useState({ charAId: '', charBId: '', charAName: '', charBName: '', event: '' })
  const [options, setOptions] = useState<InferOption[]>([])
  const [inferLoading, setInferLoading] = useState(false)

  const { data: relations, isLoading } = useQuery({
    queryKey: ['custom-relations', projectId],
    queryFn: () => relationApi.list(projectId),
    enabled: !!projectId,
  })

  const createMut = useMutation({
    mutationFn: (data: any) => relationApi.create(projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-relations'] })
      toast('关系已入库', 'success')
      setInferOpen(false)
      setOptions([])
    },
    onError: (e: any) => toast(e.message || '创建失败', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => relationApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-relations'] })
      toast('已删除', 'success')
    },
    onError: (e: any) => toast(e.message || '删除失败', 'error'),
  })

  // 编辑关系
  const [editingRel, setEditingRel] = useState<any>(null)
  const [editForm, setEditForm] = useState({ description: '', interactPattern: '', relType: '', relLevel: '3' })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => relationApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-relations'] })
      setEditingRel(null)
      toast('关系已更新', 'success')
    },
    onError: (e: any) => toast(e.message || '更新失败', 'error'),
  })
  const openEditRel = (r: any) => {
    setEditingRel(r)
    setEditForm({
      description: r.description || '',
      interactPattern: r.interactPattern || '',
      relType: r.relType || '',
      relLevel: String(r.relLevel ?? 3),
    })
  }

  const runInfer = async () => {
    if (!form.charAId.trim() || !form.charBId.trim() || !form.event.trim()) {
      toast('请填写两个人物ID和关键事件', 'error')
      return
    }
    setInferLoading(true)
    setOptions([])
    try {
      const res = await relationApi.infer(projectId, {
        charAId: Number(form.charAId),
        charBId: Number(form.charBId),
        charAName: form.charAName.trim() || undefined,
        charBName: form.charBName.trim() || undefined,
        event: form.event.trim(),
      })
      setOptions(res.options || [])
    } catch (e: any) {
      toast(e.message || '推演失败', 'error')
    } finally {
      setInferLoading(false)
    }
  }

  const confirmOption = (opt: InferOption) => {
    createMut.mutate({
      charAId: Number(form.charAId),
      charBId: Number(form.charBId),
      relType: opt.relType,
      relLevel: opt.relLevel,
      description: opt.description,
      interactPattern: opt.interactPattern,
      sourceEvent: form.event.trim(),
    })
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-violet-400" />
            <span className="font-medium text-gray-200">自定义人物关系</span>
            <Badge variant="default">{(relations || []).length}</Badge>
          </div>
          <Button variant="ghost" onClick={() => { setInferOpen(true); setOptions([]); }}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" /> 关系推演
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : (relations || []).length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-500">
            暂无自定义关系，点击「关系推演」开始
          </p>
        ) : (
          <div className="space-y-2">
            {(relations || []).map((r: any) => (
              <div key={r.id} className="group flex items-start justify-between rounded-lg border border-gray-700/50 bg-gray-800/40 p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-200">
                      {resolveName(r.charAId, `#${r.charAId}`)} ↔ {resolveName(r.charBId, `#${r.charBId}`)}
                    </span>
                    <Badge variant="warning" className="text-xs">{r.relType || '自定义'}</Badge>
                    {!r.isActive && <Badge variant="destructive" className="text-xs">已停用</Badge>}
                  </div>
                  {r.description && <p className="mt-1 text-xs text-gray-400">{r.description}</p>}
                  {r.interactPattern && <p className="mt-0.5 text-xs text-gray-500">互动: {r.interactPattern}</p>}
                  {r.sourceEvent && <p className="mt-0.5 text-xs text-gray-600">源事件: {r.sourceEvent}</p>}
                </div>
                <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    onClick={() => openEditRel(r)}
                    className="rounded p-2 text-gray-500 hover:bg-gray-700 hover:text-gray-200"
                    title="编辑"
                    aria-label="编辑关系"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => { if (confirm('确认删除此关系？')) deleteMut.mutate(r.id) }}
                    className="rounded p-2 text-gray-500 hover:bg-red-900/40 hover:text-red-300"
                    aria-label="删除关系"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* 推演对话框 */}
      <Dialog open={inferOpen} onClose={() => setInferOpen(false)} title="人物关系推演">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="人物A ID"
              placeholder="如 2"
              type="number"
              inputMode="numeric"
              value={form.charAId}
              onChange={(e) => setForm({ ...form, charAId: e.target.value })}
            />
            <Input
              label="人物A 名称"
              placeholder="如 张小凡"
              value={form.charAName}
              onChange={(e) => setForm({ ...form, charAName: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="人物B ID"
              placeholder="如 6"
              type="number"
              inputMode="numeric"
              value={form.charBId}
              onChange={(e) => setForm({ ...form, charBId: e.target.value })}
            />
            <Input
              label="人物B 名称"
              placeholder="如 林惊羽"
              value={form.charBName}
              onChange={(e) => setForm({ ...form, charBName: e.target.value })}
            />
          </div>
          <Textarea
            label="关键事件 *"
            placeholder="如 反目成仇、共同经历生死、发现对方秘密"
            rows={2}
            value={form.event}
            onChange={(e) => setForm({ ...form, event: e.target.value })}
          />
          <Button onClick={runInfer} disabled={inferLoading} className="w-full">
            {inferLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
            {inferLoading ? '推演中...' : '开始推演'}
          </Button>

          {/* 推演结果 */}
          {options.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-xs font-medium text-gray-400">推演结果（点击选定入库）：</p>
              {options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => confirmOption(opt)}
                  disabled={createMut.isPending}
                  className="w-full rounded-lg border border-gray-600 bg-gray-800/60 p-3 text-left transition-colors hover:border-violet-500/60 hover:bg-violet-900/20"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="warning" className="text-xs">{opt.relType}</Badge>
                    <span className="text-xs text-gray-400">亲密度 {opt.relLevel}/5</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-300">{opt.description}</p>
                  <p className="mt-0.5 text-xs text-gray-500">互动模式: {opt.interactPattern}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </Dialog>

      {/* 编辑关系对话框 */}
      <Dialog open={!!editingRel} onClose={() => setEditingRel(null)} title="编辑人物关系">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="关系类型"
              placeholder="如 师徒、宿敌、挚友"
              value={editForm.relType}
              onChange={(e) => setEditForm({ ...editForm, relType: e.target.value })}
            />
            <Input
              label="亲密度 (1-5)"
              type="number"
              min={1}
              max={5}
              value={editForm.relLevel}
              onChange={(e) => setEditForm({ ...editForm, relLevel: e.target.value })}
            />
          </div>
          <Textarea
            label="关系描述"
            rows={2}
            value={editForm.description}
            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
          />
          <Input
            label="互动模式"
            placeholder="如 表面恭敬，暗中较劲"
            value={editForm.interactPattern}
            onChange={(e) => setEditForm({ ...editForm, interactPattern: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditingRel(null)}>取消</Button>
            <Button
              onClick={() => updateMut.mutate({
                id: editingRel.id,
                data: {
                  relType: editForm.relType || undefined,
                  relLevel: Number(editForm.relLevel) || 3,
                  description: editForm.description || undefined,
                  interactPattern: editForm.interactPattern || undefined,
                },
              })}
              disabled={updateMut.isPending}
            >
              保存
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  )
}
