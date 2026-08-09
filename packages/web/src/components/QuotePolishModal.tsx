/**
 * 金句美化对比弹窗 + 回写正文diff预览（需求11 US-2/US-3）
 * - QuotePolishModal：原文 + 三版本对比（保守/平衡/升华）+ 修改说明 + 选版 + 自定义编辑
 * - QuoteApplyDialog：应用到正文的diff预览与确认替换；找不到原句时提示手动复制
 * - 共享：GRADE_META 分级徽标、POLISH_STATUS_META 状态徽标、ScoreBars 迷你五维分数条
 */
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Check, Copy, AlertTriangle, RefreshCw } from 'lucide-react'
import { Dialog, Button, Textarea, Badge, Spinner, useToast } from './ui'
import { quotesApi } from '../lib/api'

/** 美化版本风格标签 */
export const STYLE_LABELS: Record<string, string> = {
  conservative: '保守润色',
  balanced: '平衡打磨（推荐）',
  deep: '深度升华',
}

/** 质量分级徽标配置 */
export const GRADE_META: Record<string, { label: string; variant: 'gold' | 'default' | 'warning'; icon?: string }> = {
  legendary: { label: '传世级', variant: 'gold', icon: '🏆' },
  good: { label: '精品级', variant: 'default', icon: '⭐' },
  candidate: { label: '待打磨', variant: 'warning', icon: '📝' },
}

/** 美化状态徽标配置 */
export const POLISH_STATUS_META: Record<string, { label: string; variant: 'default' | 'success' | 'seal' }> = {
  none: { label: '未处理', variant: 'default' },
  polished: { label: '已美化', variant: 'success' },
  applied: { label: '已应用正文', variant: 'seal' },
}

const SCORE_DIMS: { key: string; label: string }[] = [
  { key: 'imagery', label: '意境' },
  { key: 'rhythm', label: '韵律' },
  { key: 'philosophy', label: '哲理' },
  { key: 'emotion', label: '情感' },
  { key: 'viral', label: '传播' },
]

/** 迷你五维分数条（评估拍板：不做雷达图） */
export function ScoreBars({ scores }: { scores: any }) {
  if (!scores || typeof scores !== 'object') return null
  const dims = SCORE_DIMS.filter((d) => typeof scores[d.key] === 'number')
  if (dims.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {dims.map((d) => (
        <div key={d.key} className="flex items-center gap-1" title={`${d.label} ${scores[d.key]}/20`}>
          <span className="text-[10px] text-gray-500">{d.label}</span>
          <div className="h-1 w-10 overflow-hidden rounded-full bg-gray-700">
            <div
              className="h-full rounded-full bg-gold-500"
              style={{ width: `${Math.min(100, (scores[d.key] / 20) * 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-400">{scores[d.key]}</span>
        </div>
      ))}
      {typeof scores.total === 'number' && (
        <span className="text-[11px] font-medium text-gold-300">总分 {scores.total}/100</span>
      )}
    </div>
  )
}

/** 美化对比弹窗：三版本并排 + 修改说明 + 选版/应用/重新美化 */
export function QuotePolishModal({
  quote,
  onClose,
  onApply,
}: {
  quote: any | null
  onClose: () => void
  /** 点"应用到正文"时回调（由父级打开QuoteApplyDialog） */
  onApply: (version: string) => void
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [editText, setEditText] = useState('')

  useEffect(() => {
    if (quote) setEditText(quote.polishedText || quote.quoteText || '')
  }, [quote?.id])

  const polishMut = useMutation({
    mutationFn: () => quotesApi.polish(quote.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      toast('美化完成', 'success')
    },
    onError: (e: any) => toast(e.message || '美化失败', 'error'),
  })

  const chooseMut = useMutation({
    mutationFn: (text: string) => quotesApi.update(quote.id, { quoteText: text, polishedText: text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      toast('已选为最终金句', 'success')
    },
    onError: (e: any) => toast(e.message || '保存失败', 'error'),
  })

  if (!quote) return null

  const original = quote.originalText || quote.quoteText
  const versions: any[] = Array.isArray(quote.polishedVersions) ? quote.polishedVersions : []
  const chosen = quote.quoteText

  return (
    <Dialog open={!!quote} onClose={onClose} title="金句美化对比" className="max-w-3xl">
      <div className="space-y-4">
        {/* 原文 */}
        <div className="rounded-lg border border-gray-700/50 bg-gray-800/40 p-3">
          <p className="mb-1 text-xs text-gray-500">原文{quote.characterName ? ` · ${quote.characterName}` : ''}</p>
          <p className="text-sm text-gray-200">「{original}」</p>
          {quote.scores && (
            <div className="mt-2">
              <ScoreBars scores={quote.scores} />
            </div>
          )}
        </div>

        {/* 版本列表 */}
        {versions.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-gray-700 py-8">
            <p className="text-sm text-gray-400">尚未美化</p>
            <Button size="sm" onClick={() => polishMut.mutate()} disabled={polishMut.isPending}>
              <Sparkles className="h-3.5 w-3.5" />
              {polishMut.isPending ? '正在打磨…' : '立即美化（生成3个版本）'}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {versions.map((v) => (
              <div
                key={v.style}
                className={`rounded-lg border p-3 ${
                  chosen === v.text ? 'border-gold-500/60 bg-gold-500/5' : 'border-gray-700/50 bg-gray-800/30'
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-gold-300">
                    {STYLE_LABELS[v.style] || v.style}
                    {v.style === 'balanced' && chosen !== v.text && (
                      <span className="ml-1 text-gray-500">· 推荐</span>
                    )}
                    {chosen === v.text && <span className="ml-1 text-ok">· 当前选用</span>}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => chooseMut.mutate(v.text)}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-gold-300"
                      title="选此版作为最终金句"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => onApply(v.style)}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-indigo-300"
                      title="应用此版本到正文"
                    >
                      <FileDownIcon />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-100">「{v.text}」</p>
                {v.note && <p className="mt-1 text-xs leading-relaxed text-gray-500">✏️ {v.note}</p>}
              </div>
            ))}
          </div>
        )}

        {/* 自定义编辑 */}
        <div>
          <Textarea
            label="自定义最终金句（可在任意版本基础上修改）"
            rows={2}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
          />
          <div className="mt-2 flex items-center justify-between">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => polishMut.mutate()}
              disabled={polishMut.isPending}
              title="重新生成3个美化版本"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${polishMut.isPending ? 'animate-spin' : ''}`} />
              重新美化
            </Button>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={!editText.trim() || chooseMut.isPending}
                onClick={() => chooseMut.mutate(editText.trim())}
              >
                保存自定义
              </Button>
              <Button size="sm" onClick={() => onApply('current')}>
                应用到正文
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

/** 内联小图标：写入正文 */
function FileDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M12 11v6M9 14l3 3 3-3" />
    </svg>
  )
}

/** 回写正文弹窗：diff预览 → 确认替换；找不到原句则提示手动复制（US-3，无撤销链） */
export function QuoteApplyDialog({
  quote,
  version,
  onClose,
}: {
  quote: any | null
  version: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [preview, setPreview] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!quote) return
    setLoading(true)
    setError('')
    setPreview(null)
    quotesApi
      .applyPreview(quote.id, version)
      .then((res) => setPreview(res))
      .catch((e) => setError(e.message || '预览失败'))
      .finally(() => setLoading(false))
  }, [quote?.id, version])

  const applyMut = useMutation({
    mutationFn: () => quotesApi.apply(quote.id, version),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      toast('已替换正文中的原句', 'success')
      onClose()
    },
    onError: (e: any) => toast(e.message || '替换失败', 'error'),
  })

  if (!quote) return null

  const copyNew = () => {
    const text = preview?.replacement || quote.polishedText || quote.quoteText
    navigator.clipboard?.writeText(text)
    toast('已复制新句', 'success')
  }

  return (
    <Dialog open={!!quote} onClose={onClose} title="应用到正文" className="max-w-2xl">
      {loading && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      {error && <p className="py-6 text-center text-sm text-red-400">{error}</p>}
      {!loading && !error && preview && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            来源章节：{preview.chapterTitle ? `《${preview.chapterTitle}》` : preview.chapterNo ? `第${preview.chapterNo}章` : '未知'}
          </p>

          {preview.found ? (
            <>
              <div className="rounded-lg border border-red-900/40 bg-red-950/20 p-3">
                <p className="mb-1 text-xs text-red-400/80">替换前</p>
                <p className="text-sm leading-relaxed text-gray-300">
                  {renderHighlight(preview.beforeContext, preview.originalText, 'del')}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3">
                <p className="mb-1 text-xs text-emerald-400/80">替换后</p>
                <p className="text-sm leading-relaxed text-gray-300">
                  {renderHighlight(preview.afterContext, preview.replacement, 'add')}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={copyNew}>
                  <Copy className="h-3.5 w-3.5" />
                  复制新句
                </Button>
                <Button variant="ghost" onClick={onClose}>
                  取消
                </Button>
                <Button onClick={() => applyMut.mutate()} disabled={applyMut.isPending}>
                  {applyMut.isPending ? '替换中…' : '确认替换'}
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                <p className="text-sm leading-relaxed text-gray-300">
                  {preview.message || '未在正文中找到原句，可能已被修改，请手动替换'}
                </p>
              </div>
              <div className="rounded-lg border border-gray-700/50 bg-gray-800/40 p-3">
                <p className="mb-1 text-xs text-gray-500">新句（可复制后手动粘贴）</p>
                <p className="text-sm text-gray-200">「{preview.replacement}」</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  关闭
                </Button>
                <Button onClick={copyNew}>
                  <Copy className="h-3.5 w-3.5" />
                  复制新句
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

/** 在上下文中高亮目标片段（del=标红删除 / add=标绿新增） */
function renderHighlight(context: string, target: string, mode: 'del' | 'add') {
  const idx = context.indexOf(target)
  if (idx === -1) return context
  const before = context.slice(0, idx)
  const after = context.slice(idx + target.length)
  const cls =
    mode === 'del'
      ? 'rounded bg-red-500/20 px-0.5 text-red-300 line-through decoration-red-400/60'
      : 'rounded bg-emerald-500/20 px-0.5 text-emerald-300'
  return (
    <>
      {before}
      <span className={cls}>{target}</span>
      {after}
    </>
  )
}
