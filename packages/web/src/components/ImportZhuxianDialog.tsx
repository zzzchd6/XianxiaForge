/**
 * 诛仙库地点多选导入弹窗
 * 候选列表（搜索过滤 + 默认全选未导入项 + 已导入灰显）→ 勾选导入为草稿
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Download, Search } from 'lucide-react'
import { Button, Dialog, Input, Spinner, useToast } from './ui'
import { mapApi } from '../lib/api'

interface ZhuxianCandidate {
  zhuxianId: number
  name: string
  level: string | null
  parentRegion: string | null
  dangerLevel: string | null
  relatedFaction: string | null
  environment: string | null
  imported: boolean
}

interface ImportZhuxianDialogProps {
  open: boolean
  projectId: string
  mapId?: number
  onClose: () => void
  onDone: () => void
}

export function ImportZhuxianDialog({ open, projectId, mapId, onClose, onDone }: ImportZhuxianDialogProps) {
  const { toast } = useToast()
  const [candidates, setCandidates] = useState<ZhuxianCandidate[] | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [q, setQ] = useState('')
  const [loadError, setLoadError] = useState('')

  // 打开时拉取候选列表
  useEffect(() => {
    if (!open) return
    setLoadError('')
    mapApi.zhuxianCandidates(projectId)
      .then((list) => {
        setCandidates(list)
        // 默认全选未导入项
        setChecked(new Set(list.filter((c) => !c.imported).map((c) => c.zhuxianId)))
      })
      .catch((e: any) => setLoadError(e.message || '获取候选列表失败'))
  }, [open, projectId])

  const importMut = useMutation({
    mutationFn: () => mapApi.importZhuxian(projectId, { zhuxianIds: Array.from(checked), mapId }),
    onSuccess: (res) => {
      toast(`已导入 ${res.imported} 个地点（草稿，请拖拽摆放坐标）`, res.imported > 0 ? 'success' : 'info')
      onDone()
      onClose()
    },
    onError: (e: any) => toast(e.message || '导入失败', 'error'),
  })

  const query = q.trim().toLowerCase()
  const shown = useMemo(() => {
    if (!candidates) return []
    if (!query) return candidates
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        (c.parentRegion ?? '').toLowerCase().includes(query) ||
        (c.relatedFaction ?? '').toLowerCase().includes(query)
    )
  }, [candidates, query])

  const selectableShown = shown.filter((c) => !c.imported)
  const allShownChecked = selectableShown.length > 0 && selectableShown.every((c) => checked.has(c.zhuxianId))

  const toggle = (id: number) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllShown = () => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (allShownChecked) selectableShown.forEach((c) => next.delete(c.zhuxianId))
      else selectableShown.forEach((c) => next.add(c.zhuxianId))
      return next
    })
  }

  return (
    <Dialog open={open} onClose={onClose} title="导入诛仙库地点" className="max-w-2xl">
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          勾选要导入的地点，导入后为草稿状态（橙色虚线圈），坐标落在地图边缘，请拖拽摆放。
        </p>

        {!candidates && !loadError && (
          <div className="flex justify-center py-10"><Spinner label="加载诛仙库候选…" /></div>
        )}
        {loadError && <p className="py-6 text-center text-sm text-red-400">{loadError}</p>}

        {candidates && (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                <Input
                  className="py-1.5 pl-8 text-xs"
                  placeholder="搜索名称/上级区域/势力…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm" onClick={toggleAllShown} disabled={selectableShown.length === 0}>
                {allShownChecked ? '取消本页全选' : '本页全选'}
              </Button>
            </div>

            <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
              {shown.length === 0 ? (
                <p className="py-6 text-center text-xs text-gray-500">
                  {candidates.length === 0 ? '诛仙库暂无地点数据' : `未找到匹配「${q}」的地点`}
                </p>
              ) : (
                shown.map((c) => (
                  <label
                    key={c.zhuxianId}
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
                      c.imported
                        ? 'cursor-not-allowed border-gray-800 bg-gray-900/30 opacity-50'
                        : checked.has(c.zhuxianId)
                          ? 'border-amber-800/60 bg-amber-900/20'
                          : 'border-gray-800 bg-gray-800/30 hover:bg-gray-800/60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-700 text-gold-500 focus:ring-gold-500/30"
                      disabled={c.imported}
                      checked={checked.has(c.zhuxianId)}
                      onChange={() => toggle(c.zhuxianId)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="truncate text-gray-100">{c.name}</span>
                        {c.imported && (
                          <span className="shrink-0 rounded bg-gray-700/60 px-1.5 py-px text-[10px] text-gray-400">已导入</span>
                        )}
                        {c.level && <span className="shrink-0 text-[10px] text-gray-500">{c.level}</span>}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-gray-500">
                        {[c.parentRegion, c.relatedFaction, c.dangerLevel, c.environment].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </label>
                ))
              )}
            </div>

            <div className="flex items-center justify-between border-t border-gray-700/50 pt-3 text-xs text-gray-500">
              <span>
                共 {candidates.length} 个候选，已导入 {candidates.filter((c) => c.imported).length} 个
              </span>
              <Button
                disabled={checked.size === 0 || importMut.isPending}
                onClick={() => importMut.mutate()}
              >
                {importMut.isPending ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                导入 {checked.size > 0 ? `(${checked.size})` : ''}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
