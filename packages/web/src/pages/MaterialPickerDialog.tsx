/**
 * 剧情素材选择器（二期RAG人工干预）
 * 弹窗浏览/搜索 4 类剧情素材（奇遇/伏笔/高光/任务链），勾选后作为章节计划的「固定素材」。
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Check, Plus, Star } from 'lucide-react'
import { Dialog, Button, Badge, Input, Spinner, EmptyState, useToast } from '../components/ui'
import { plotMaterialsApi, materialsApi } from '../lib/api'
import { cn } from '../lib/utils'

/** 固定素材的精简结构（章节计划表单与选择器共用） */
export interface PinnedMaterial {
  id: number
  table: string
  tableLabel: string
  title: string
}

const TYPE_TABS = [
  { value: '', label: '全部' },
  { value: 'encounter', label: '奇遇' },
  { value: 'foreshadow', label: '伏笔' },
  { value: 'highlight', label: '高光' },
  { value: 'task', label: '任务链' },
]

interface MaterialPickerDialogProps {
  projectId: string
  open: boolean
  onClose: () => void
  /** 当前已选中的固定素材 */
  selected: PinnedMaterial[]
  /** 切换某条素材的选中态 */
  onToggle: (m: PinnedMaterial) => void
}

export default function MaterialPickerDialog({
  projectId, open, onClose, selected, onToggle,
}: MaterialPickerDialogProps) {
  const [type, setType] = useState('')
  const [keyword, setKeyword] = useState('')

  const { data: materials, isLoading } = useQuery({
    queryKey: ['plot-materials', projectId, type, keyword],
    queryFn: () => plotMaterialsApi.list(projectId, { type: type || undefined, keyword: keyword || undefined, limit: 30 }),
    enabled: open,
  })

  const { toast } = useToast()
  const queryClient = useQueryClient()

  // 收藏切换：乐观更新（立即翻转 isCollected）+ 失败回滚 + toast 反馈
  const collectMutation = useMutation({
    mutationFn: (vars: { table: string; id: number; collected: boolean }) =>
      materialsApi.collect(vars.table, vars.id, vars.collected),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['plot-materials'] })
      // 快照所有筛选条件下的缓存，便于失败回滚
      const snapshots = queryClient.getQueriesData<any[]>({ queryKey: ['plot-materials'] })
      queryClient.setQueriesData<any[]>({ queryKey: ['plot-materials'] }, (old) =>
        old?.map((item) =>
          item && item.table === vars.table && item.id === vars.id
            ? { ...item, isCollected: vars.collected }
            : item
        )
      )
      return { snapshots }
    },
    onError: (_err, _vars, context) => {
      context?.snapshots?.forEach(([key, data]) => queryClient.setQueryData(key, data))
      toast('收藏操作失败，已恢复原状态', 'error')
    },
    onSuccess: (data) => {
      toast(data.collected ? '已收藏该素材' : '已取消收藏', 'success')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['plot-materials'] })
    },
  })

  const toggleCollect = (m: any) => {
    collectMutation.mutate({ table: m.table, id: m.id, collected: !m.isCollected })
  }

  const selectedKeys = new Set(selected.map((s) => `${s.table}:${s.id}`))
  const isSelected = (m: any) => selectedKeys.has(`${m.table}:${m.id}`)

  return (
    <Dialog open={open} onClose={onClose} title="选择固定素材" className="max-w-2xl">
      <div className="space-y-3">
        {/* 类型筛选 */}
        <div className="flex flex-wrap gap-1.5">
          {TYPE_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs transition-colors',
                type === t.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 关键词搜索 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
          <Input
            aria-label="搜索素材"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索素材标题或核心剧情..."
            className="pl-9"
          />
        </div>

        {/* 素材列表 */}
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : !materials?.length ? (
            <EmptyState message="没有匹配的素材" />
          ) : (
            materials.map((m: any) => {
              const active = isSelected(m)
              const collected = m.isCollected === true
              const pick = () => onToggle({ id: m.id, table: m.table, tableLabel: m.tableLabel, title: m.title })
              return (
                <div
                  key={`${m.table}:${m.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={pick}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      pick()
                    }
                  }}
                  aria-pressed={active}
                  className={cn(
                    'w-full cursor-pointer rounded-lg border border-l-2 p-3 text-left transition-colors',
                    collected ? 'border-l-amber-400' : 'border-l-transparent',
                    active
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : 'border-gray-800 bg-gray-900/40 hover:border-gray-700'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge className="shrink-0 text-[10px]">{m.tableLabel}</Badge>
                        <span className="truncate text-sm font-medium text-gray-200">{m.title}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-500">{m.corePlot}</p>
                    </div>
                    <div className="flex shrink-0 items-start gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleCollect(m) }}
                        aria-label={collected ? '取消收藏' : '收藏'}
                        aria-pressed={collected}
                        title={collected ? '取消收藏' : '收藏'}
                        className={cn(
                          'mt-0.5 rounded p-0.5 transition-colors',
                          collected ? 'text-amber-400' : 'text-gray-500 hover:text-amber-300'
                        )}
                      >
                        <Star className={cn('h-4 w-4', collected && 'fill-amber-400')} />
                      </button>
                      <span
                        className={cn(
                          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                          active ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-gray-600 text-transparent'
                        )}
                      >
                        {active ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-800 pt-3">
          <span className="text-xs text-gray-500">已选 {selected.length} 个素材</span>
          <Button onClick={onClose}>完成</Button>
        </div>
      </div>
    </Dialog>
  )
}
