import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button, Dialog, Spinner, Switch, useToast } from './ui'
import { customCharacterApi } from '../lib/api'

interface BatchCreateCharactersDialogProps {
  open: boolean
  projectId: string
  onClose: () => void
  onDone: () => void
}

/** 批量新建人物：选数量（1-20）+ 随机开关 + 可选自动生成小传，一键创建到创作库 */
export function BatchCreateCharactersDialog({ open, projectId, onClose, onDone }: BatchCreateCharactersDialogProps) {
  const { toast } = useToast()

  const [count, setCount] = useState(5)
  const [randomize, setRandomize] = useState(true)
  const [generateBio, setGenerateBio] = useState(false)
  const [result, setResult] = useState<{ created: number; failed: number; errors: { name: string; error: string }[] } | null>(null)

  const createMut = useMutation({
    mutationFn: () => customCharacterApi.batchCreate(projectId, { count, randomize, generateBio }),
    onSuccess: (res) => {
      setResult(res)
      toast(`已创建 ${res.created} 位人物`, 'success')
      onDone()
    },
    onError: (e: any) => toast(e.message || '批量创建失败', 'error'),
  })

  if (result) {
    return (
      <Dialog open={open} onClose={onClose} title="批量新建人物" className="max-w-md">
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

  return (
    <Dialog open={open} onClose={onClose} title="批量新建人物" className="max-w-md">
      <div className="space-y-4">
        <p className="text-xs text-gray-500">一次性创建一批人物用于新书起步，创建后可在列表中逐个完善。</p>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-sm text-gray-300">数量</label>
            <span className="text-sm font-medium text-gold-400">{count}</span>
          </div>
          <input
            type="range"
            min={1}
            max={20}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            aria-label="人物数量"
            className="w-full accent-gold-500"
          />
          <div className="mt-0.5 flex justify-between text-[10px] text-gray-600">
            <span>1</span><span>20</span>
          </div>
        </div>

        <div className="space-y-2.5 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
          <Switch checked={randomize} onChange={setRandomize} label="随机生成（种族/性别/性格/天赋）" />
          <Switch checked={generateBio} onChange={setGenerateBio} label="自动生成详细小传（较慢，调用 LLM）" />
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-700/50 pt-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={createMut.isPending} onClick={() => createMut.mutate()}>
            {createMut.isPending ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {createMut.isPending ? '正在创建…' : `创建 ${count} 位人物`}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
