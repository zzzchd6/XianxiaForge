import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Wand2, Trash2, Check, Download } from 'lucide-react'
import { Button, Dialog, Spinner, Switch, Textarea, useToast } from './ui'
import { customCharacterApi } from '../lib/api'

interface ExtractCharactersDialogProps {
  open: boolean
  projectId: string
  onClose: () => void
  onDone: () => void
}

interface Candidate {
  name: string
  gender?: string
  position?: string
  innerPersonality?: string
  outerPersonality?: string[]
  talents?: string[]
  description?: string
  _checked: boolean
}

const POSITION_OPTIONS = [
  { key: 'chenjie', label: '尘界' },
  { key: 'tongtu', label: '同途' },
  { key: 'dazhe', label: '达者' },
  { key: 'zhelong', label: '蛰龙' },
  { key: 'tianyou', label: '天游' },
]

/** 从文本抽取人物：粘贴文本 → LLM 抽取 → 预览编辑 → 批量创建到创作库 */
export function ExtractCharactersDialog({ open, projectId, onClose, onDone }: ExtractCharactersDialogProps) {
  const { toast } = useToast()

  const [text, setText] = useState('')
  const [generateBio, setGenerateBio] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [result, setResult] = useState<{ created: number; failed: number; errors: { name: string; error: string }[] } | null>(null)

  const extractMut = useMutation({
    mutationFn: () => customCharacterApi.extractFromText(projectId, { text, generateBio }),
    onSuccess: (res) => {
      setCandidates(res.candidates.map((c) => ({ ...c, _checked: true })))
      toast(`抽取到 ${res.candidates.length} 位人物，请预览确认`, 'success')
    },
    onError: (e: any) => toast(e.message || '抽取失败', 'error'),
  })

  const createMut = useMutation({
    mutationFn: () => {
      const chosen = (candidates ?? []).filter((c) => c._checked).map(({ _checked, ...rest }) => rest)
      return customCharacterApi.batchCreateFromCandidates(projectId, chosen)
    },
    onSuccess: (res) => {
      setResult(res)
      toast(`创建完成：成功 ${res.created} 个`, 'success')
      onDone()
    },
    onError: (e: any) => toast(e.message || '创建失败', 'error'),
  })

  const patchCandidate = (idx: number, patch: Partial<Candidate>) => {
    setCandidates((prev) => prev?.map((c, i) => (i === idx ? { ...c, ...patch } : c)) ?? null)
  }

  const removeCandidate = (idx: number) => {
    setCandidates((prev) => prev?.filter((_, i) => i !== idx) ?? null)
  }

  const checkedCount = (candidates ?? []).filter((c) => c._checked).length

  // 结果视图
  if (result) {
    return (
      <Dialog open={open} onClose={onClose} title="文本抽取人物" className="max-w-md">
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
      <Dialog open={open} onClose={onClose} title="文本抽取人物·预览确认" className="max-w-2xl">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">LLM 抽取的性别/性格可能不准，请逐项核对后再创建。</p>
          {candidates.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">已清空全部候选</p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {candidates.map((c, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border p-3 ${c._checked ? 'border-gray-700/60 bg-gray-800/40' : 'border-gray-800 bg-gray-900/30 opacity-60'}`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={c._checked}
                      onChange={() => patchCandidate(idx, { _checked: !c._checked })}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-gold-500 focus:ring-gold-500/30"
                    />
                    <input
                      value={c.name}
                      onChange={(e) => patchCandidate(idx, { name: e.target.value })}
                      aria-label="人物姓名"
                      className="w-32 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-gold-500/50 focus:outline-none"
                    />
                    <select
                      value={c.gender ?? 'male'}
                      onChange={(e) => patchCandidate(idx, { gender: e.target.value })}
                      aria-label="性别"
                      className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 focus:outline-none"
                    >
                      <option value="male">男</option>
                      <option value="female">女</option>
                    </select>
                    <select
                      value={c.position ?? 'chenjie'}
                      onChange={(e) => patchCandidate(idx, { position: e.target.value })}
                      aria-label="实力档位"
                      className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 focus:outline-none"
                    >
                      {POSITION_OPTIONS.map((p) => (
                        <option key={p.key} value={p.key}>{p.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeCandidate(idx)}
                      className="ml-auto rounded p-1 text-gray-500 hover:text-red-400"
                      aria-label="删除该候选"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {(c.innerPersonality || (c.outerPersonality ?? []).length > 0 || (c.talents ?? []).length > 0) && (
                    <div className="mt-2 space-y-0.5 pl-6 text-xs text-gray-500">
                      {c.innerPersonality && <p>性情：{c.innerPersonality}</p>}
                      {(c.outerPersonality ?? []).length > 0 && <p>性格：{c.outerPersonality!.join('、')}</p>}
                      {(c.talents ?? []).length > 0 && <p>本领：{c.talents!.join('、')}</p>}
                    </div>
                  )}
                  {c.description && (
                    <p className="mt-1.5 line-clamp-2 pl-6 text-xs text-gray-400">{c.description}</p>
                  )}
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
    <Dialog open={open} onClose={onClose} title="文本抽取人物" className="max-w-xl">
      <div className="space-y-3">
        <p className="text-xs text-gray-500">粘贴一段设定或章节文本，LLM 将识别其中的人物并生成候选，供你预览确认后批量创建。</p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="在此粘贴文本（不少于 10 字）…"
          rows={10}
          aria-label="待抽取文本"
        />
        <div className="flex items-center justify-between">
          <Switch checked={generateBio} onChange={setGenerateBio} label="同时生成详细小传" />
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
