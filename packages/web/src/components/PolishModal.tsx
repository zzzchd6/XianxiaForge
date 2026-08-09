/**
 * 独立润色弹窗（架构升级 Epic3）
 * 不推进剧情，仅对当前版本正文做语言层润色；预览段落级 diff 后可一键应用为新版本。
 * 后端：POST /api/projects/:pid/chapters/:cid/polish { level }
 * 应用：PUT /api/projects/:pid/chapters/:cid/content（版本自动递增）
 */
import { useState } from 'react'
import { Wand2, Save, X } from 'lucide-react'
import { Dialog, Button, Select, Badge, Spinner, useToast } from './ui'
import { chaptersApi } from '../lib/api'
import { cn } from '../lib/utils'

type PolishLevel = 'light' | 'medium' | 'deep'

interface PolishResult {
  originalText: string
  polishedText: string
  diff: { type: 'same' | 'removed' | 'added'; text: string }[]
  changedParagraphs: number
  totalParagraphs: number
  auditScore: number | null
  aiFlavorReport?: any
  revisionNotes?: string
}

const LEVEL_OPTIONS = [
  { value: 'light', label: '轻度（仅修语病与标点）' },
  { value: 'medium', label: '中度（优化表达 + 去AI味）' },
  { value: 'deep', label: '深度（允许重写部分段落）' },
]

export default function PolishModal({
  projectId,
  chapterPlanId,
  open,
  onClose,
  onApplied,
}: {
  projectId: string
  chapterPlanId: string
  open: boolean
  onClose: () => void
  onApplied?: () => void
}) {
  const { toast } = useToast()
  const [level, setLevel] = useState<PolishLevel>('medium')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<PolishResult | null>(null)
  const [viewMode, setViewMode] = useState<'diff' | 'full'>('diff')

  const handlePolish = async () => {
    setLoading(true)
    setResult(null)
    try {
      const res = await chaptersApi.polish(projectId, chapterPlanId, level)
      setResult(res)
    } catch (err: any) {
      toast(err.message || '润色失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleApply = async () => {
    if (!result) return
    setApplying(true)
    try {
      await chaptersApi.updateContent(projectId, chapterPlanId, result.polishedText)
      toast('润色结果已应用为新版本', 'success')
      onApplied?.()
      onClose()
    } catch (err: any) {
      toast(err.message || '应用失败', 'error')
    } finally {
      setApplying(false)
    }
  }

  const handleClose = () => {
    setResult(null)
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} title="独立润色（不推进剧情）" className="max-w-4xl">
      <div className="space-y-4">
        {/* 级别选择 + 执行 */}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Select
              label="润色级别"
              value={level}
              onChange={(e) => setLevel(e.target.value as PolishLevel)}
              options={LEVEL_OPTIONS}
            />
          </div>
          <Button onClick={handlePolish} loading={loading}>
            <Wand2 className="h-4 w-4" />
            {result ? '重新润色' : '开始润色'}
          </Button>
        </div>
        <p className="text-xs text-gray-500">
          润色基于当前版本正文做自审 + 定向修订，不改变剧情与设定；结果预览确认后另存为新版本。
        </p>

        {loading && (
          <div className="flex flex-col items-center gap-2 py-10">
            <Spinner label="AI 正在润色，通常需要 20~60 秒…" />
          </div>
        )}

        {result && !loading && (
          <>
            {/* 摘要信息 */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2 text-xs">
              <Badge variant="default">
                修改段落 {result.changedParagraphs}/{result.totalParagraphs}
              </Badge>
              {result.auditScore != null && (
                <Badge variant="default">自审得分 {result.auditScore}</Badge>
              )}
              {result.aiFlavorReport?.totalHits > 0 && (
                <Badge className="bg-amber-600/20 text-amber-300">
                  检出 AI 味 {result.aiFlavorReport.totalHits} 处
                </Badge>
              )}
              {result.revisionNotes && (
                <span className="ml-1 text-gray-400">{result.revisionNotes}</span>
              )}
            </div>

            {/* 视图切换 */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={viewMode === 'diff' ? 'default' : 'outline'}
                onClick={() => setViewMode('diff')}
              >
                段落差异
              </Button>
              <Button
                size="sm"
                variant={viewMode === 'full' ? 'default' : 'outline'}
                onClick={() => setViewMode('full')}
              >
                润色全文
              </Button>
            </div>

            {viewMode === 'diff' ? (
              <div className="max-h-[420px] space-y-1.5 overflow-y-auto rounded-lg border border-gray-800 bg-gray-900/60 p-3">
                {result.diff.map((seg, i) => (
                  <div
                    key={i}
                    className={cn(
                      'rounded px-2 py-1 text-sm leading-6',
                      seg.type === 'removed' && 'bg-red-500/10 text-red-300/80 line-through decoration-red-400/50',
                      seg.type === 'added' && 'bg-emerald-500/10 text-emerald-200',
                      seg.type === 'same' && 'text-gray-400'
                    )}
                  >
                    {seg.type !== 'same' && (
                      <span className="mr-1.5 select-none font-mono text-xs">
                        {seg.type === 'removed' ? '−' : '+'}
                      </span>
                    )}
                    {seg.text}
                  </div>
                ))}
                {result.diff.length === 0 && (
                  <p className="py-6 text-center text-sm text-gray-500">无差异（润色未改动正文）</p>
                )}
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-800 bg-gray-900/60 p-4 text-sm leading-7 text-gray-300">
                {result.polishedText}
              </div>
            )}

            {/* 操作区 */}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={handleClose}>
                <X className="h-4 w-4" />
                放弃
              </Button>
              <Button onClick={handleApply} loading={applying} disabled={result.changedParagraphs === 0}>
                <Save className="h-4 w-4" />
                应用为新版本
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
