/**
 * 从文本抽取地点（同众生百态 ExtractCharactersDialog 模式）
 * 粘贴文本 → LLM 抽取候选 → 预览编辑（名称/类型/危险等级）→ 勾选批量落草稿
 */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Wand2, Trash2, Download } from 'lucide-react'
import { Button, Dialog, Spinner, Textarea, useToast } from './ui'
import { mapApi } from '../lib/api'

const LOCATION_TYPE_OPTIONS = [
  { value: 'sect', label: '宗门' },
  { value: 'city', label: '城池' },
  { value: 'secret_realm', label: '秘境' },
  { value: 'danger', label: '险地' },
  { value: 'teleport', label: '传送阵' },
  { value: 'battlefield', label: '战场' },
  { value: 'generic', label: '通用' },
]
const DANGER_OPTIONS = [
  { value: 'safe', label: '安全' },
  { value: 'normal', label: '寻常' },
  { value: 'danger', label: '凶险' },
  { value: 'deadly', label: '绝地' },
]

interface Candidate {
  name: string
  locationType?: string
  dangerLevel?: string
  description?: string
  affiliatedFaction?: string
  _checked: boolean
}

interface ExtractLocationsDialogProps {
  open: boolean
  projectId: string
  mapId?: number
  onClose: () => void
  onDone: () => void
}

export function ExtractLocationsDialog({ open, projectId, mapId, onClose, onDone }: ExtractLocationsDialogProps) {
  const { toast } = useToast()

  const [text, setText] = useState('')
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [result, setResult] = useState<{ created: number; failed: number; errors: { name: string; error: string }[] } | null>(null)

  const extractMut = useMutation({
    mutationFn: () => mapApi.extractLocationsFromText(projectId, { text }),
    onSuccess: (res) => {
      setCandidates(res.candidates.map((c) => ({ ...c, _checked: true })))
      toast(`抽取到 ${res.candidates.length} 个地点，请预览确认`, 'success')
    },
    onError: (e: any) => toast(e.message || '抽取失败', 'error'),
  })

  const createMut = useMutation({
    mutationFn: () => {
      const chosen = (candidates ?? []).filter((c) => c._checked).map(({ _checked, ...rest }) => rest)
      return mapApi.batchCreateLocationCandidates(projectId, { candidates: chosen, mapId })
    },
    onSuccess: (res) => {
      setResult(res)
      toast(`创建完成：成功 ${res.created} 个（草稿，坐标在地图边缘，请拖拽摆放）`, 'success')
      onDone()
    },
    onError: (e: any) => toast(e.message || '创建失败', 'error'),
  })

  const patch = (idx: number, p: Partial<Candidate>) =>
    setCandidates((prev) => prev?.map((c, i) => (i === idx ? { ...c, ...p } : c)) ?? null)

  const remove = (idx: number) => setCandidates((prev) => prev?.filter((_, i) => i !== idx) ?? null)

  const checkedCount = (candidates ?? []).filter((c) => c._checked).length

  // 结果视图
  if (result) {
    return (
      <Dialog open={open} onClose={onClose} title="文本抽取地点" className="max-w-md">
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-lg bg-emerald-500/10 p-3">
              <div className="text-2xl font-bold text-emerald-400">{result.created}</div>
              <div className="text-xs text-gray-400">成功创建</div>
            </div>
            <div className="rounded-lg bg-red-500/10 p-3">
              <div className="text-2xl font-bold text-red-400">{result.failed}</div>
              <div className="text-xs text-gray-400">失败</div>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="max-h-32 space-y-1 overflow-y-auto text-xs text-red-300">
              {result.errors.map((e, i) => (
                <p key={i}>{e.name}：{e.error}</p>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>完成</Button>
          </div>
        </div>
      </Dialog>
    )
  }

  // 预览视图
  if (candidates) {
    return (
      <Dialog open={open} onClose={onClose} title="文本抽取地点·预览确认" className="max-w-2xl">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">LLM 抽取的类型/危险等级可能不准，请逐项核对后再创建。创建后为草稿，坐标需拖拽摆放。</p>
          {candidates.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">已清空全部候选</p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {candidates.map((c, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border p-3 ${c._checked ? 'border-gray-700/60 bg-gray-800/40' : 'border-gray-800 bg-gray-900/30 opacity-60'}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      checked={c._checked}
                      onChange={() => patch(idx, { _checked: !c._checked })}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-gold-500 focus:ring-gold-500/30"
                    />
                    <input
                      value={c.name}
                      onChange={(e) => patch(idx, { name: e.target.value })}
                      aria-label="地点名称"
                      className="w-36 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-gold-500/50 focus:outline-none"
                    />
                    <select
                      value={c.locationType ?? 'generic'}
                      onChange={(e) => patch(idx, { locationType: e.target.value })}
                      aria-label="地点类型"
                      className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 focus:outline-none"
                    >
                      {LOCATION_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <select
                      value={c.dangerLevel ?? 'normal'}
                      onChange={(e) => patch(idx, { dangerLevel: e.target.value })}
                      aria-label="危险等级"
                      className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 focus:outline-none"
                    >
                      {DANGER_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => remove(idx)}
                      className="ml-auto rounded p-1 text-gray-500 hover:text-red-400"
                      aria-label="删除该候选"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-1.5 space-y-0.5 pl-6 text-xs text-gray-500">
                    {c.affiliatedFaction && <p>所属势力：{c.affiliatedFaction}</p>}
                    {c.description && <p className="line-clamp-2">{c.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between border-t border-gray-700/50 pt-3">
            <Button variant="ghost" size="sm" onClick={() => setCandidates(null)}>← 重新抽取</Button>
            <Button
              disabled={checkedCount === 0 || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              创建 {checkedCount > 0 ? `(${checkedCount})` : ''}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  // 输入视图
  return (
    <Dialog open={open} onClose={onClose} title="文本抽取地点" className="max-w-xl">
      <div className="space-y-3">
        <p className="text-xs text-gray-500">粘贴一段设定或章节文本，LLM 将识别其中的地点并生成候选，供你预览确认后批量创建为草稿。</p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="在此粘贴文本（不少于 10 字）…"
          rows={10}
          aria-label="待抽取文本"
        />
        <div className="flex justify-end">
          <Button
            disabled={text.trim().length < 10 || extractMut.isPending}
            onClick={() => extractMut.mutate()}
          >
            {extractMut.isPending ? <Spinner className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />}
            {extractMut.isPending ? '正在抽取…' : '开始抽取'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
