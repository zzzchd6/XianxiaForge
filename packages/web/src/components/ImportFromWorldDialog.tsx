import { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Download, CheckSquare, Square } from 'lucide-react'
import { Button, Dialog, Spinner, useToast } from './ui'
import { customCharacterApi } from '../lib/api'

interface ImportFromWorldDialogProps {
  open: boolean
  projectId: string
  onClose: () => void
  onDone: () => void
}

interface WorldCharacter {
  id: number
  name: string
  allTitles: string[] | null
  faction: string | null
  realm: string | null
  bookId: number
}

interface ImportResult {
  created: number
  skippedDuplicate: number
  failed: number
  errors: { id: number; error: string }[]
}

/** 从诛仙库按书籍浏览并批量引用人物到创作库 */
export function ImportFromWorldDialog({ open, projectId, onClose, onDone }: ImportFromWorldDialogProps) {
  const { toast } = useToast()

  const [bookId, setBookId] = useState<string>('')
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<ImportResult | null>(null)

  // 诛仙库书籍列表
  const { data: books = [] } = useQuery({
    queryKey: ['world-books', projectId],
    queryFn: () => customCharacterApi.worldBooks(projectId),
    enabled: open,
  })

  // 选定书籍的人物列表
  const { data: characters = [], isLoading } = useQuery({
    queryKey: ['world-sources', projectId, bookId],
    queryFn: () => customCharacterApi.worldSources(projectId, Number(bookId)),
    enabled: !!bookId,
  }) as { data: WorldCharacter[]; isLoading: boolean }

  const filtered = useMemo(() => {
    if (!keyword.trim()) return characters
    const kw = keyword.trim().toLowerCase()
    return characters.filter((c) =>
      c.name.toLowerCase().includes(kw) ||
      (c.faction ?? '').toLowerCase().includes(kw) ||
      (c.allTitles ?? []).some((t) => t.toLowerCase().includes(kw))
    )
  }, [characters, keyword])

  const importMut = useMutation({
    mutationFn: () => customCharacterApi.importBatch(projectId, [...selected]),
    onSuccess: (res) => {
      setResult(res)
      toast(`引用完成：成功 ${res.created} 个`, 'success')
      onDone()
    },
    onError: (e: any) => toast(e.message || '引用失败', 'error'),
  })

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (filtered.length > 0 && selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((c) => c.id)))
    }
  }

  // 结果视图
  if (result) {
    return (
      <Dialog open={open} onClose={onClose} title="引用人物·从世界观" className="max-w-md">
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-emerald-500/10 p-3">
              <div className="text-2xl font-bold text-emerald-400">{result.created}</div>
              <div className="text-xs text-gray-400">成功引用</div>
            </div>
            <div className="rounded-lg bg-amber-500/10 p-3">
              <div className="text-2xl font-bold text-amber-400">{result.skippedDuplicate}</div>
              <div className="text-xs text-gray-400">跳过重复</div>
            </div>
            <div className="rounded-lg bg-red-500/10 p-3">
              <div className="text-2xl font-bold text-red-400">{result.failed}</div>
              <div className="text-xs text-gray-400">失败</div>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="max-h-32 space-y-1 overflow-y-auto text-xs text-red-300">
              {result.errors.map((e) => (
                <p key={e.id}>#{e.id}：{e.error}</p>
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

  return (
    <Dialog open={open} onClose={onClose} title="引用人物·从世界观" className="max-w-lg">
      <div className="space-y-3">
        {/* 书籍选择 */}
        <select
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-gold-500/50 focus:outline-none"
          value={bookId}
          onChange={(e) => { setBookId(e.target.value); setSelected(new Set()) }}
          aria-label="选择源书籍"
        >
          <option value="">选择源书籍…</option>
          {books.map((b) => (
            <option key={b.bookId} value={String(b.bookId)}>
              {b.bookName}{b.author ? `（${b.author}）` : ''}
            </option>
          ))}
        </select>

        {!bookId ? (
          <p className="py-8 text-center text-sm text-gray-500">请先选择要从哪本书引用人物</p>
        ) : isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <>
            {/* 搜索 + 全选 */}
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-gold-500/50"
                placeholder="搜索名字 / 门派 / 称号…"
                aria-label="搜索人物"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <button
                type="button"
                className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-gray-400 hover:text-gray-200"
                onClick={toggleAll}
                aria-pressed={selected.size === filtered.length && filtered.length > 0}
              >
                {selected.size === filtered.length && filtered.length > 0
                  ? <CheckSquare className="h-4 w-4 text-gold-400" />
                  : <Square className="h-4 w-4" />}
                全选
              </button>
            </div>

            {/* 人物列表 */}
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">该书暂无人物</p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {filtered.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-gray-700/60 bg-gray-800/40 px-3 py-2 hover:border-gray-600"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-gold-500 focus:ring-gold-500/30"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-200">{item.name}</span>
                        {item.realm && (
                          <span className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">{item.realm}</span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-gray-500">
                        {[item.faction, (item.allTitles ?? []).join('、')].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {/* 底部操作 */}
            <div className="flex items-center justify-between border-t border-gray-700/50 pt-3">
              <span className="text-xs text-gray-500">共 {filtered.length} 人</span>
              <Button
                disabled={selected.size === 0 || importMut.isPending}
                onClick={() => importMut.mutate()}
              >
                {importMut.isPending ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                引用 {selected.size > 0 ? `(${selected.size})` : ''}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
