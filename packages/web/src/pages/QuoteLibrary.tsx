/**
 * 名场面+金句素材库页面（模块11）
 * 按人物分类查看所有金句，支持收藏/删除/批量导入。
 * 章节生成后自动提取，也可手动添加或从其他作品批量导入（LLM预筛+人工审阅）。
 * 收藏的金句会按"人物感知"注入后续生成（优先本章出场人物），强化角色口吻一致性。
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Quote, Star, Trash2, Filter, Plus, Upload, Sparkles, Wand2, RefreshCw } from 'lucide-react'
import {
  Card, CardContent, Badge, Button, Spinner, EmptyState, Tabs, useToast,
  Dialog, Input, Textarea, Select,
} from '../components/ui'
import { quotesApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import {
  QuotePolishModal, QuoteApplyDialog, GRADE_META, POLISH_STATUS_META, ScoreBars,
} from '../components/QuotePolishModal'

/** 金句来源徽标配置 */
const SOURCE_META: Record<string, { label: string; variant: 'default' | 'success' | 'warning' }> = {
  auto: { label: '自动', variant: 'default' },
  manual: { label: '手动', variant: 'warning' },
  import: { label: '导入', variant: 'success' },
}

export default function QuoteLibrary() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const projectId = useCurrentProjectId()
  const [tab, setTab] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showPolishText, setShowPolishText] = useState(false)
  const [polishTarget, setPolishTarget] = useState<any | null>(null)
  const [applyTarget, setApplyTarget] = useState<{ quote: any; version: string } | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [createForm, setCreateForm] = useState({ quoteText: '', characterName: '', sceneDesc: '' })

  const { data: quotes, isLoading } = useQuery({
    queryKey: ['quotes', projectId, tab, sourceFilter, gradeFilter, statusFilter],
    queryFn: () =>
      quotesApi.list(projectId, {
        collected: tab === 'collected' ? true : undefined,
        sourceType: sourceFilter || undefined,
        grade: gradeFilter || undefined,
        polishStatus: statusFilter || undefined,
      }),
  })

  const createMut = useMutation({
    mutationFn: (data: any) => quotesApi.create(projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      setShowCreate(false)
      setCreateForm({ quoteText: '', characterName: '', sceneDesc: '' })
      toast('金句已添加', 'success')
    },
    onError: (e: any) => toast(e.message || '添加失败', 'error'),
  })

  const collectMut = useMutation({
    mutationFn: ({ id, isCollected }: { id: number; isCollected: boolean }) =>
      quotesApi.update(id, { isCollected }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
    },
    onError: (e: any) => toast(e.message || '操作失败', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => quotesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      toast('已删除', 'success')
    },
    onError: (e: any) => toast(e.message || '删除失败', 'error'),
  })

  const polishMut = useMutation({
    mutationFn: (id: number) => quotesApi.polish(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      toast('美化完成', 'success')
    },
    onError: (e: any) => toast(e.message || '美化失败', 'error'),
  })

  const rescoreMut = useMutation({
    mutationFn: (id: number) => quotesApi.rescore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      toast('重新评分完成', 'success')
    },
    onError: (e: any) => toast(e.message || '评分失败', 'error'),
  })

  // 按人物分组
  const grouped = groupByCharacter(quotes || [])

  if (isLoading) {
    return <div className="flex justify-center py-20"><Spinner /></div>
  }

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">名场面 · 金句库</h1>
          <p className="mt-1 text-sm text-gray-400">
            自动提取/手动录入/批量导入精彩片段，收藏后按人物感知注入后续生成，强化角色口吻
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowPolishText(true)}>
            <Wand2 className="h-3.5 w-3.5" />
            打磨句子
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowImport(true)}>
            <Upload className="h-3.5 w-3.5" />
            批量导入
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" />
            手动添加
          </Button>
          <Filter className="h-4 w-4 text-gray-500" />
          <Select
            options={[
              { value: '', label: '全部质量' },
              { value: 'legendary', label: '🏆 传世级' },
              { value: 'good', label: '⭐ 精品级' },
              { value: 'candidate', label: '📝 待打磨' },
            ]}
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            className="w-28 py-1.5"
          />
          <Select
            options={[
              { value: '', label: '全部状态' },
              { value: 'none', label: '未处理' },
              { value: 'polished', label: '已美化' },
              { value: 'applied', label: '已应用' },
            ]}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-28 py-1.5"
          />
          <Select
            options={[
              { value: '', label: '全部来源' },
              { value: 'auto', label: '自动提取' },
              { value: 'manual', label: '手动录入' },
              { value: 'import', label: '批量导入' },
            ]}
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="w-28 py-1.5"
          />
          <Tabs
            tabs={[
              { id: 'all', label: '全部' },
              { id: 'collected', label: '已收藏' },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-amber-300">{(quotes || []).length}</p>
            <p className="text-xs text-gray-400">金句总数</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-yellow-300">
              {(quotes || []).filter((q: any) => q.isCollected).length}
            </p>
            <p className="text-xs text-gray-400">已收藏</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-indigo-300">{grouped.length}</p>
            <p className="text-xs text-gray-400">涉及人物</p>
          </CardContent>
        </Card>
      </div>

      {/* 空状态 */}
      {(quotes || []).length === 0 && (
        <EmptyState
          message={tab === 'collected' ? '暂无收藏金句' : '暂无金句，生成章节后将自动提取'}
          icon={<Quote className="h-10 w-10 text-gray-600" />}
        />
      )}

      {/* 按人物分组展示 */}
      {grouped.map((group) => (
        <Card key={group.name}>
          <CardContent className="pt-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="font-medium text-gray-200">{group.name}</span>
              <Badge variant="default">{group.quotes.length}</Badge>
            </div>
            <div className="space-y-2">
              {group.quotes.map((q: any) => {
                const grade = GRADE_META[q.grade] || GRADE_META.good
                const status = POLISH_STATUS_META[q.polishStatus || 'none']
                const displayText = q.polishedText || q.quoteText
                const hasOriginal = !!q.polishedText && q.originalText && q.originalText !== q.polishedText
                const expanded = expandedIds.has(q.id)
                return (
                  <div
                    key={q.id}
                    className={`group rounded-lg border bg-gray-800/40 p-3 ${
                      q.grade === 'legendary'
                        ? 'border-gold-500/50 shadow-[0_0_12px_rgba(192,154,82,0.08)]'
                        : 'border-gray-700/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-sm text-gray-100">「{displayText}」</p>
                        {hasOriginal && (
                          <button
                            onClick={() => {
                              setExpandedIds((prev) => {
                                const next = new Set(prev)
                                if (next.has(q.id)) next.delete(q.id)
                                else next.add(q.id)
                                return next
                              })
                            }}
                            className="mt-1 text-left text-xs text-gray-500 hover:text-gray-300"
                          >
                            {expanded ? `收起原文：${q.originalText}` : '展开原文 ▾'}
                          </button>
                        )}
                        {q.sceneDesc && <p className="mt-1 text-xs text-gray-500">{q.sceneDesc}</p>}
                        {q.scores && (
                          <div className="mt-1.5">
                            <ScoreBars scores={q.scores} />
                          </div>
                        )}
                        <div className="mt-1.5 flex items-center gap-2">
                          <Badge variant={grade.variant} className="text-xs">
                            {grade.icon} {grade.label}
                          </Badge>
                          {status && (
                            <Badge variant={status.variant} className="text-xs">
                              {status.label}
                            </Badge>
                          )}
                          {SOURCE_META[q.sourceType || 'auto'] && (
                            <Badge variant={SOURCE_META[q.sourceType || 'auto'].variant} className="text-xs">
                              {SOURCE_META[q.sourceType || 'auto'].label}
                            </Badge>
                          )}
                          {q.isCollected && <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          onClick={() => setPolishTarget(q)}
                          className="rounded p-2 text-gray-400 hover:bg-gray-700 hover:text-gold-300"
                          title="查看/生成美化版本"
                          aria-label="美化版本"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => collectMut.mutate({ id: q.id, isCollected: !q.isCollected })}
                          className={`rounded p-2 ${q.isCollected ? 'text-yellow-400' : 'text-gray-400'} hover:bg-gray-700`}
                          title={q.isCollected ? '取消收藏' : '收藏'}
                          aria-label="收藏"
                        >
                          <Star className={`h-3.5 w-3.5 ${q.isCollected ? 'fill-yellow-400' : ''}`} />
                        </button>
                        <button
                          onClick={() => { if (confirm('确认删除？')) deleteMut.mutate(q.id) }}
                          className="rounded p-2 text-gray-400 hover:bg-red-900/40 hover:text-red-300"
                          title="删除"
                          aria-label="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {/* 快捷操作行 */}
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-700/40 pt-2">
                      {q.grade === 'candidate' ? (
                        <>
                          <button
                            onClick={() => polishMut.mutate(q.id)}
                            disabled={polishMut.isPending}
                            className="text-xs text-gold-300 hover:underline disabled:opacity-50"
                          >
                            <Sparkles className="mr-0.5 inline h-3 w-3" />
                            {polishMut.isPending ? '打磨中…' : '打磨升级'}
                          </button>
                          <button
                            onClick={() => rescoreMut.mutate(q.id)}
                            disabled={rescoreMut.isPending}
                            className="text-xs text-gray-400 hover:underline disabled:opacity-50"
                          >
                            <RefreshCw className="mr-0.5 inline h-3 w-3" />
                            重新评分
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setPolishTarget(q)}
                            className="text-xs text-gray-400 hover:underline"
                          >
                            查看{(q.polishedVersions || []).length > 0 ? `${q.polishedVersions.length}个版本` : '/美化'}
                          </button>
                          {q.chapterId && (
                            <button
                              onClick={() => setApplyTarget({ quote: q, version: 'current' })}
                              className="text-xs text-indigo-300 hover:underline"
                            >
                              应用到正文
                            </button>
                          )}
                          <button
                            onClick={() => polishMut.mutate(q.id)}
                            disabled={polishMut.isPending}
                            className="text-xs text-gray-400 hover:underline disabled:opacity-50"
                          >
                            重新美化
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* 手动添加金句对话框 */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)} title="手动添加金句">
        <div className="space-y-3">
          <Textarea
            label="金句内容 *"
            rows={3}
            placeholder="输入精彩台词或描写片段"
            value={createForm.quoteText}
            onChange={(e) => setCreateForm({ ...createForm, quoteText: e.target.value })}
          />
          <Input
            label="所属人物"
            placeholder="如 张小凡（留空=旁白/描写）"
            value={createForm.characterName}
            onChange={(e) => setCreateForm({ ...createForm, characterName: e.target.value })}
          />
          <Input
            label="场景描述"
            placeholder="如 大竹峰后山练剑时的感悟"
            value={createForm.sceneDesc}
            onChange={(e) => setCreateForm({ ...createForm, sceneDesc: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>取消</Button>
            <Button
              onClick={() => {
                if (!createForm.quoteText.trim()) { toast('金句内容不能为空', 'error'); return }
                createMut.mutate({
                  quoteText: createForm.quoteText.trim(),
                  characterName: createForm.characterName.trim() || undefined,
                  sceneDesc: createForm.sceneDesc.trim() || undefined,
                })
              }}
              disabled={createMut.isPending}
            >
              添加
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 批量导入金句对话框 */}
      <ImportDialog open={showImport} onClose={() => setShowImport(false)} projectId={projectId} />

      {/* 美化对比弹窗（数据以列表最新为准，避免陈旧state） */}
      <QuotePolishModal
        quote={polishTarget ? (quotes || []).find((q: any) => q.id === polishTarget.id) || polishTarget : null}
        onClose={() => setPolishTarget(null)}
        onApply={(version) => {
          const q = polishTarget ? (quotes || []).find((x: any) => x.id === polishTarget.id) || polishTarget : null
          if (q) {
            setPolishTarget(null)
            setApplyTarget({ quote: q, version })
          }
        }}
      />

      {/* 应用到正文diff预览弹窗 */}
      <QuoteApplyDialog
        quote={applyTarget?.quote || null}
        version={applyTarget?.version || 'current'}
        onClose={() => setApplyTarget(null)}
      />

      {/* 打磨任意句子对话框（US-5） */}
      <PolishTextDialog open={showPolishText} onClose={() => setShowPolishText(false)} projectId={projectId} />
    </div>
  )
}

/** 批量导入对话框：粘贴参考文本 → LLM预筛候选 → 人工审阅编辑 → 勾选导入 */
function ImportDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [step, setStep] = useState<'paste' | 'review'>('paste')
  const [text, setText] = useState('')
  const [candidates, setCandidates] = useState<any[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [extracting, setExtracting] = useState(false)
  const [importing, setImporting] = useState(false)

  const reset = () => {
    setStep('paste')
    setText('')
    setCandidates([])
    setSelected(new Set())
  }

  const handleExtract = async () => {
    if (text.trim().length < 20) {
      toast('请粘贴更多内容（至少20字）', 'error')
      return
    }
    setExtracting(true)
    try {
      const res = await quotesApi.importPreview(projectId, text)
      const list = res || []
      setCandidates(list)
      setSelected(new Set(list.map((_: any, i: number) => i)))
      setStep('review')
      if (list.length === 0) toast('未提取到可借鉴的金句', 'info')
    } catch (e: any) {
      toast(e.message || '提取失败', 'error')
    } finally {
      setExtracting(false)
    }
  }

  const handleImport = async () => {
    const chosen = candidates
      .filter((_, i) => selected.has(i))
      .map((c) => ({
        quoteText: (c.quoteText || '').trim(),
        characterName: c.characterName?.trim() || undefined,
        sceneDesc: c.sceneDesc?.trim() || undefined,
        qualityScore: c.qualityScore,
      }))
      .filter((c) => c.quoteText)
    if (chosen.length === 0) {
      toast('请至少勾选一条金句', 'error')
      return
    }
    setImporting(true)
    try {
      await quotesApi.import(projectId, chosen)
      toast(`已导入 ${chosen.length} 条金句（默认已收藏）`, 'success')
      qc.invalidateQueries({ queryKey: ['quotes'] })
      reset()
      onClose()
    } catch (e: any) {
      toast(e.message || '导入失败', 'error')
    } finally {
      setImporting(false)
    }
  }

  const updateCandidate = (i: number, field: string, value: string) => {
    setCandidates((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)))
  }

  const toggleSelect = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <Dialog open={open} onClose={onClose} title="批量导入金句" className="max-w-2xl">
      {step === 'paste' ? (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-gray-400">
            粘贴其他作品的一段文本，AI 将自动挑选值得借鉴的金句与名场面台词（含说话人推断），
            供你审阅、修改后导入本作。导入的金句默认收藏，会注入后续生成。
          </p>
          <Textarea
            label="参考文本 *"
            rows={9}
            placeholder="粘贴小说片段（建议包含人物对白，20字以上）…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button onClick={handleExtract} disabled={extracting}>
              {extracting ? '正在智能提取…' : '智能提取'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">
              共 {candidates.length} 条候选，已勾选 {selected.size} 条 · 文本与人物可直接修改
            </p>
            <Button variant="ghost" size="sm" onClick={() => setStep('paste')}>← 重新粘贴</Button>
          </div>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {candidates.length === 0 && (
              <p className="py-6 text-center text-xs text-gray-500">未提取到金句，请返回重新粘贴</p>
            )}
            {candidates.map((c, i) => (
              <div
                key={i}
                className={`rounded-lg border p-2.5 transition-colors ${
                  selected.has(i)
                    ? 'border-indigo-500/50 bg-indigo-500/5'
                    : 'border-gray-700/50 bg-gray-800/30 opacity-60'
                }`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggleSelect(i)}
                    aria-label={`选择第${i + 1}条金句`}
                    className="mt-1.5 h-3.5 w-3.5 accent-indigo-500"
                  />
                  <div className="flex-1 space-y-1.5">
                    <Textarea
                      rows={2}
                      value={c.quoteText || ''}
                      onChange={(e) => updateCandidate(i, 'quoteText', e.target.value)}
                      className="text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="所属人物"
                        value={c.characterName || ''}
                        onChange={(e) => updateCandidate(i, 'characterName', e.target.value)}
                        className="flex-1 py-1 text-xs"
                      />
                      <Input
                        placeholder="场景描述"
                        value={c.sceneDesc || ''}
                        onChange={(e) => updateCandidate(i, 'sceneDesc', e.target.value)}
                        className="flex-1 py-1 text-xs"
                      />
                      {c.qualityScore != null && (
                        <Badge variant={c.qualityScore >= 80 ? 'success' : 'default'} className="shrink-0 text-xs">
                          {c.qualityScore}分
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button onClick={handleImport} disabled={importing || selected.size === 0}>
              {importing ? '正在导入…' : `导入选中 (${selected.size})`}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

/** 打磨任意句子对话框（US-5）：输入→评分判价值→3版本→可收藏入库 */
function PolishTextDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [text, setText] = useState('')
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<any | null>(null)

  const reset = () => {
    setText('')
    setResult(null)
  }

  const handlePolish = async () => {
    if (text.trim().length < 4) {
      toast('句子太短，请输入至少4个字', 'error')
      return
    }
    setWorking(true)
    try {
      const res = await quotesApi.polishText(projectId, text.trim())
      setResult(res)
    } catch (e: any) {
      toast(e.message || '打磨失败', 'error')
    } finally {
      setWorking(false)
    }
  }

  /** 收藏某个版本：带着美化结果直接入库（默认收藏） */
  const handleCollect = async (versionText: string) => {
    try {
      await quotesApi.create(projectId, {
        quoteText: versionText,
        originalText: text.trim(),
        polishedText: versionText,
        polishedVersions: result?.versions || [],
        scores: result?.scores || {},
        qualityScore: result?.scores?.total,
        grade: result?.grade || 'good',
        polishStatus: (result?.versions || []).length > 0 ? 'polished' : 'none',
        sourceType: 'manual',
      })
      qc.invalidateQueries({ queryKey: ['quotes'] })
      toast('已收藏入库', 'success')
      reset()
      onClose()
    } catch (e: any) {
      toast(e.message || '收藏失败', 'error')
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="打磨句子" className="max-w-2xl">
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-gray-400">
          输入任意一句你觉得有感觉但写得不够好的话，AI 会先评分判断打磨价值，
          有价值则生成3个美化版本（保守/平衡/升华）供你挑选收藏。
        </p>
        <Textarea
          label="句子 *"
          rows={3}
          placeholder="如：路很长，走下去总会到的。"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex justify-end">
          <Button onClick={handlePolish} disabled={working || !text.trim()}>
            <Wand2 className="h-3.5 w-3.5" />
            {working ? '评分与打磨中…' : '评分并打磨'}
          </Button>
        </div>

        {result && (
          <div className="space-y-3 border-t border-gray-700/50 pt-3">
            <div className="flex items-center justify-between">
              <ScoreBars scores={result.scores} />
              {result.isWorth ? (
                <Badge variant="success" className="text-xs">值得打磨</Badge>
              ) : (
                <Badge variant="warning" className="text-xs">打磨价值一般</Badge>
              )}
            </div>
            {result.reason && <p className="text-xs text-gray-500">评审理由：{result.reason}</p>}

            {(result.versions || []).length > 0 ? (
              <div className="space-y-2">
                {(result.versions || []).map((v: any) => (
                  <div key={v.style} className="rounded-lg border border-gray-700/50 bg-gray-800/30 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium text-gold-300">
                        {({ conservative: '保守润色', balanced: '平衡打磨（推荐）', deep: '深度升华' } as Record<string, string>)[v.style] || v.style}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { navigator.clipboard?.writeText(v.text); toast('已复制', 'success') }}
                          className="text-xs text-gray-400 hover:underline"
                        >
                          复制
                        </button>
                        <button onClick={() => handleCollect(v.text)} className="text-xs text-gold-300 hover:underline">
                          收藏此版
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-gray-100">「{v.text}」</p>
                    {v.note && <p className="mt-1 text-xs text-gray-500">✏️ {v.note}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-lg border border-gray-700/50 bg-gray-800/30 p-3">
                <p className="text-xs text-gray-400">未生成美化版本，可直接收藏原句</p>
                <button onClick={() => handleCollect(text.trim())} className="text-xs text-gold-300 hover:underline">
                  收藏原句
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}

function groupByCharacter(quotes: any[]) {
  const map = new Map<string, any[]>()
  for (const q of quotes) {
    const key = q.characterName || '旁白/描写'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(q)
  }
  // 组内按分级排序：传世级置顶 > 精品级 > 待打磨，同级按总分降序
  const gradeRank: Record<string, number> = { legendary: 0, good: 1, candidate: 2 }
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        (gradeRank[a.grade || 'good'] ?? 1) - (gradeRank[b.grade || 'good'] ?? 1) ||
        (b.qualityScore || 0) - (a.qualityScore || 0)
    )
  }
  return Array.from(map.entries()).map(([name, quotes]) => ({ name, quotes }))
}
