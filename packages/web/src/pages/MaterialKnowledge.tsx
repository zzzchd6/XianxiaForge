/**
 * 素材知识库 — v2.0 合并版
 *
 * 页签重组（5 → 5，合并重复功能）：
 *   灵感素材库  — plot_material_* + benchmark 统一列表（P1 合并）
 *   文风预设    — style_preset 浏览管理
 *   领域知识    — domain_knowledge 浏览管理
 *   拆文工具    — 轻量拆文 + 整本拆文 合并入口（原两条路径）
 *   蒸馏任务    — ETL 触发（Python 旁路，高级功能）
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Palette, BookOpenCheck, PlayCircle, Search, Trash2, RefreshCw, Zap, Lightbulb, Globe, Wrench, Pin, PinOff, Eye, Layers } from 'lucide-react'
import { materialKbApi, KNOWLEDGE_TYPE_LABELS, benchmarkApi, BENCHMARK_TYPE_LABELS, plotMaterialsApi } from '../lib/api'
import { Button, Card, Badge, Tabs, Spinner, EmptyState, Dialog, Input, Textarea, Select, useToast } from '../components/ui'
import { useCurrentProjectId } from '../hooks/useCurrentProject'

type Tab = 'inspiration' | 'style' | 'domain' | 'benchmark' | 'etl'

export default function MaterialKnowledge() {
  const [tab, setTab] = useState<Tab>('inspiration')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Database className="h-6 w-6 text-gold-400" />
        <div>
          <h1 className="text-xl font-bold text-gray-100">素材知识库</h1>
          <p className="text-xs text-gray-400">
            灵感素材 · 文风预设 · 领域知识 · 拆文工具 · 蒸馏任务
          </p>
        </div>
        <Tabs
          className="ml-auto w-[32rem]"
          tabs={[
            { id: 'inspiration', label: '灵感素材库' },
            { id: 'style', label: '文风预设' },
            { id: 'domain', label: '领域知识' },
            { id: 'benchmark', label: '拆文工具' },
            { id: 'etl', label: '蒸馏任务' },
          ]}
          active={tab}
          onChange={(id) => setTab(id as Tab)}
        />
      </div>

      {tab === 'inspiration' && <InspirationTab />}
      {tab === 'style' && <StyleTab />}
      {tab === 'domain' && <DomainTab />}
      {tab === 'benchmark' && <BenchmarkTab />}
      {tab === 'etl' && <EtlTab />}
    </div>
  )
}

// ============ 页签0：灵感素材库（P1 合并：plot_material_* + benchmark 统一视图） ============

function InspirationTab() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const projectId = useCurrentProjectId()
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [keyword, setKeyword] = useState('')

  // Fetch both sources
  const benchmarkQ = useQuery({
    queryKey: ['inspiration-benchmark', projectId],
    queryFn: () => benchmarkApi.list(projectId),
    enabled: !!projectId,
  })

  const plotQ = useQuery({
    queryKey: ['inspiration-plot', projectId, typeFilter !== 'all' && ['encounter','foreshadow','highlight','task'].includes(typeFilter) ? typeFilter : ''],
    queryFn: () => plotMaterialsApi.list(projectId, { type: typeFilter !== 'all' && ['encounter','foreshadow','highlight','task'].includes(typeFilter) ? typeFilter : undefined, keyword: keyword || undefined, limit: 50 }),
    enabled: !!projectId,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['inspiration-benchmark', projectId] })
    qc.invalidateQueries({ queryKey: ['inspiration-plot', projectId] })
  }

  // Merge and normalize
  const benchmarkRows = benchmarkQ.data ?? []
  const plotRows = plotQ.data ?? []

  interface UnifiedItem {
    id: number
    title: string
    content: string
    type: string
    source: 'benchmark' | 'plot_material'
    sourceBook: string
    pinned: boolean
    tags: string[]
    qualityScore?: number
  }

  const allItems: UnifiedItem[] = [
    ...benchmarkRows.map((r: any) => ({
      id: r.id,
      title: r.title,
      content: r.content_md ?? r.content ?? '',
      type: r.material_type,
      source: 'benchmark' as const,
      sourceBook: r.source_book_title ?? '',
      pinned: r.pinned ?? false,
      tags: r.tags ?? [],
    })),
    ...plotRows.flatMap((r: any) => {
      // plot_material_* response may have items nested
      if (r.items) return r.items.map((item: any) => ({
        id: item.id ?? 0,
        title: item.title ?? r.title ?? '',
        content: item.core_plot ?? item.content ?? '',
        type: item.material_type ?? r.material_type ?? r.type ?? 'unknown',
        source: 'plot_material' as const,
        sourceBook: r.source_work ?? '',
        pinned: false,
        tags: item.tags ?? r.tags ?? [],
        qualityScore: item.quality_score,
      }))
      return [{
        id: r.id ?? 0,
        title: r.title ?? '',
        content: r.core_plot ?? r.content ?? '',
        type: r.material_type ?? r.type ?? 'unknown',
        source: 'plot_material' as const,
        sourceBook: r.source_work ?? '',
        pinned: false,
        tags: r.tags ?? [],
        qualityScore: r.quality_score,
      }]
    }),
  ]

  // Filter
  let filtered = allItems
  if (typeFilter !== 'all') {
    filtered = filtered.filter((m) => m.type === typeFilter)
  }
  if (keyword.trim()) {
    const kw = keyword.trim().toLowerCase()
    filtered = filtered.filter((m) =>
      m.title.toLowerCase().includes(kw) || m.content.toLowerCase().includes(kw) || m.tags.some((t) => t.toLowerCase().includes(kw)),
    )
  }

  // Type labels
  const allTypes = ['character', 'plot_unit', 'style', 'setting', 'encounter', 'foreshadow', 'highlight', 'task']
  const typeLabel: Record<string, string> = {
    character: '角色卡', plot_unit: '剧情单元', style: '文风', setting: '设定',
    encounter: '奇遇', foreshadow: '伏笔', highlight: '高光', task: '任务链',
  }
  const sourceLabel = { benchmark: '对标拆文', plot_material: '剧情素材' }
  const sourceColor = { benchmark: 'bg-purple-900/40 text-purple-300', plot_material: 'bg-sky-900/40 text-sky-300' }

  const pinM = useMutation({
    mutationFn: ({ id, pinned }: { id: number; pinned: boolean }) => benchmarkApi.togglePin(projectId, id, pinned),
    onSuccess: () => { toast('已更新', 'success'); invalidate() },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const [expandedId, setExpandedId] = useState<number | null>(null)

  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-3 p-3 flex-wrap">
        <Search className="h-4 w-4 text-gray-500 shrink-0" />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索标题/内容/标签..."
          className="min-w-[200px] flex-1 bg-transparent text-sm text-gray-100 outline-none placeholder:text-gray-600"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300"
        >
          <option value="all">全部类型</option>
          {allTypes.map((t) => (
            <option key={t} value={t}>{typeLabel[t] ?? t}</option>
          ))}
        </select>
        <span className="text-xs text-gray-500">{filtered.length} 条</span>
      </Card>

      {(benchmarkQ.isLoading || plotQ.isLoading) && (
        <div className="flex justify-center py-10"><Spinner /></div>
      )}
      {filtered.length === 0 && !benchmarkQ.isLoading && !plotQ.isLoading && (
        <EmptyState message="暂无素材，请先「拆文工具」拆解对标书或「蒸馏任务」蒸馏素材" />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
        {filtered.map((item) => (
          <Card
            key={`${item.source}-${item.id}`}
            className="cursor-pointer hover:border-gold-600/30 transition-colors"
            onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-medium text-gray-200 truncate">{item.title}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${sourceColor[item.source]}`}>
                    {sourceLabel[item.source]}
                  </span>
                  <Badge variant="default" className="text-[10px]">{typeLabel[item.type] ?? item.type}</Badge>
                  {item.pinned && <Pin className="h-3 w-3 text-gold-400 shrink-0" />}
                </div>
                {item.sourceBook && (
                  <p className="text-[11px] text-gray-500 mb-1">来源：{item.sourceBook}</p>
                )}
                <p className="text-xs text-gray-400 line-clamp-3">{item.content}</p>
                {expandedId === item.id && (
                  <div className="mt-2 pt-2 border-t border-gray-700/50">
                    <p className="text-xs text-gray-300 whitespace-pre-wrap">{item.content}</p>
                    {item.tags.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {item.tags.map((t, i) => <Badge key={i} variant="default" className="text-[10px]">{t}</Badge>)}
                      </div>
                    )}
                    {item.source === 'benchmark' && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); pinM.mutate({ id: item.id, pinned: !item.pinned }) }}>
                          {item.pinned ? <><PinOff className="h-3 w-3 mr-1" />取消置顶</> : <><Pin className="h-3 w-3 mr-1" />置顶借鉴</>}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ============ 页签1：文风预设 ============

function StyleTab() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [q, setQ] = useState('')
  const [detailId, setDetailId] = useState<number | null>(null)

  const listQ = useQuery({
    queryKey: ['mk-style', q],
    queryFn: () => materialKbApi.stylePresets(q || undefined),
  })
  const detailQ = useQuery({
    queryKey: ['mk-style-detail', detailId],
    queryFn: () => materialKbApi.stylePresetDetail(detailId!),
    enabled: !!detailId,
  })
  const delM = useMutation({
    mutationFn: (id: number) => materialKbApi.deleteStylePreset(id),
    onSuccess: (r) => {
      toast(r.deleted ? '已软删除' : '条目不存在或已删除', r.deleted ? 'success' : 'info')
      qc.invalidateQueries({ queryKey: ['mk-style'] })
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const d = detailQ.data

  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-3 p-3">
        <Palette className="h-5 w-5 text-indigo-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-200">文风引擎 — 预设浏览与去AI味</p>
          <p className="text-xs text-gray-500">
            文风预设由「蒸馏任务」从对标书提炼，写作时自动引导风格 · 去 AI 味配置在
            <a href="/settings" className="text-gold-400 hover:text-gold-300 underline mx-0.5">系统设置</a>
          </p>
        </div>
        <Search className="h-4 w-4 text-gray-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="按预设名 / 作者搜索..."
          aria-label="搜索"
          className="flex-1 bg-transparent text-sm text-gray-100 outline-none placeholder:text-gray-600"
        />
        <span className="text-xs text-gray-500">{listQ.data?.length ?? 0} 条</span>
      </Card>

      {listQ.isLoading && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      {listQ.data?.length === 0 && !listQ.isLoading && <EmptyState message="暂无文风预设，可在「蒸馏任务」页触发文风蒸馏" />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {listQ.data?.map((s: any) => (
          <Card key={s.id} className="cursor-pointer hover:border-gold-600/50" role="button" tabIndex={0} onClick={() => setDetailId(s.id)} onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailId(s.id) } }}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-gold-400 shrink-0" />
                <span className="font-medium text-gray-100">{s.style_name}</span>
                {s.author && <span className="text-xs text-gray-500">{s.author}</span>}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`确认软删除文风预设「${s.style_name}」？（可数据库恢复）`)) delM.mutate(s.id)
                }}
                className="rounded p-2 text-gray-600 hover:text-bad"
                title="软删除"
                aria-label="删除"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-400">
              <Badge variant="gold">质量 {s.quality_score ?? '-'}</Badge>
              <span>置信度 {Number(s.confidence ?? 0).toFixed(2)}</span>
              <span>样本 {s.sample_word_count ?? '-'} 字</span>
              <span>心智 {s.n_mind} / 意象 {s.n_img}</span>
              <Badge variant={s.verify_status === 'approved' ? 'success' : 'default'}>
                {s.verify_status ?? 'auto'}
              </Badge>
              <span className="text-gray-600">v{s.version}</span>
              <span className="ml-auto text-gray-600">{s.update_time}</span>
            </div>
          </Card>
        ))}
      </div>

      {/* 详情弹窗 */}
      <Dialog open={!!detailId} onClose={() => setDetailId(null)} title={d?.style_name ?? '文风预设详情'} className="max-w-2xl">
        {detailQ.isLoading && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}
        {d && (
          <div className="space-y-3 text-sm max-h-[65vh] overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-2 text-xs text-gray-400">
              {d.author && <Badge>作者：{d.author}</Badge>}
              <Badge variant="gold">质量 {d.quality_score ?? '-'}</Badge>
              <Badge>置信度 {Number(d.confidence ?? 0).toFixed(2)}</Badge>
              <Badge>样本 {d.sample_word_count ?? '-'} 字</Badge>
              <Badge>{d.verify_status}</Badge>
            </div>
            {Array.isArray(d.source_works) && d.source_works.length > 0 && (
              <DetailBlock label="来源作品" text={d.source_works.join('、')} />
            )}
            <DetailArray label="心智模型" items={d.mental_models} />
            <DetailArray label="决策启发" items={d.decision_heuristics} />
            <DetailBlock label="描写比例" text={typeof d.description_ratio === 'object' ? JSON.stringify(d.description_ratio) : d.description_ratio} />
            <DetailArray label="句式规则" items={d.sentence_rules} />
            <DetailArray label="核心意象" items={d.core_imagery} />
            <DetailArray label="禁用词" items={d.forbidden_words} />
            <DetailArray label="视角规则" items={d.perspective_rules} />
            <DetailArray label="反模式" items={d.anti_patterns} />
            {d.local_stats && (
              <DetailBlock label="本地统计" text={JSON.stringify(d.local_stats, null, 2)} mono />
            )}
          </div>
        )}
      </Dialog>
    </div>
  )
}

function DetailBlock({ label, text, mono }: { label: string; text?: string | null; mono?: boolean }) {
  if (!text) return null
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-gray-300 whitespace-pre-wrap ${mono ? 'font-mono text-xs' : ''}`}>{text}</div>
    </div>
  )
}

function DetailArray({ label, items }: { label: string; items?: unknown }) {
  const arr = Array.isArray(items) ? items.map(String) : typeof items === 'string' && items ? [items] : []
  if (!arr.length) return null
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">
        {label}（{arr.length}）
      </div>
      <div className="flex flex-wrap gap-1">
        {arr.map((it, i) => (
          <span key={i} className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">
            {it}
          </span>
        ))}
      </div>
    </div>
  )
}

// ============ 页签2：领域知识 ============

function DomainTab() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [q, setQ] = useState('')
  const [ktype, setKtype] = useState('')
  const [detailId, setDetailId] = useState<number | null>(null)

  const listQ = useQuery({
    queryKey: ['mk-domain', q, ktype],
    queryFn: () => materialKbApi.domainKnowledge({ q: q || undefined, type: ktype || undefined }),
  })
  const detailQ = useQuery({
    queryKey: ['mk-domain-detail', detailId],
    queryFn: () => materialKbApi.domainKnowledgeDetail(detailId!),
    enabled: !!detailId,
  })
  const delM = useMutation({
    mutationFn: (id: number) => materialKbApi.deleteDomainKnowledge(id),
    onSuccess: (r) => {
      toast(r.deleted ? '已软删除' : '条目不存在或已删除', r.deleted ? 'success' : 'info')
      qc.invalidateQueries({ queryKey: ['mk-domain'] })
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const d = detailQ.data

  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-3 p-3">
        <Search className="h-4 w-4 text-gray-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="按标题 / 内容搜索..."
          aria-label="搜索"
          className="flex-1 bg-transparent text-sm text-gray-100 outline-none placeholder:text-gray-600"
        />
        <select
          value={ktype}
          onChange={(e) => setKtype(e.target.value)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-200"
        >
          <option value="">全部类型</option>
          {Object.entries(KNOWLEDGE_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500">{listQ.data?.length ?? 0} 条</span>
      </Card>

      {listQ.isLoading && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      {listQ.data?.length === 0 && !listQ.isLoading && <EmptyState message="暂无领域知识，可在「蒸馏任务」页触发领域知识蒸馏" />}

      <div className="space-y-2">
        {listQ.data?.map((k: any) => (
          <Card
            key={k.id}
            className="cursor-pointer hover:border-gold-600/50 flex items-start gap-3"
            role="button"
            tabIndex={0}
            onClick={() => setDetailId(k.id)}
            onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailId(k.id) } }}
          >
            <BookOpenCheck className="h-4 w-4 text-gold-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm text-gray-100">{k.title}</span>
                <Badge variant="default">{KNOWLEDGE_TYPE_LABELS[k.knowledge_type] ?? k.knowledge_type}</Badge>
                {k.applicable_domain && <span className="text-xs text-gray-500">{k.applicable_domain}</span>}
                <Badge variant="gold">质量 {k.quality_score ?? '-'}</Badge>
              </div>
              {k.preview && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{k.preview}...</p>}
              <div className="flex flex-wrap gap-1 mt-1.5">
                {(k.tags ?? []).map((t: string) => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                    {t}
                  </span>
                ))}
                {k.source_book && <span className="text-[10px] text-gray-600">源自《{k.source_book}》</span>}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`确认软删除领域知识「${k.title}」？（可数据库恢复）`)) delM.mutate(k.id)
              }}
              className="rounded p-2 text-gray-600 hover:text-bad shrink-0"
              title="软删除"
              aria-label="删除"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </Card>
        ))}
      </div>

      <Dialog open={!!detailId} onClose={() => setDetailId(null)} title={d?.title ?? '领域知识详情'} className="max-w-xl">
        {detailQ.isLoading && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}
        {d && (
          <div className="space-y-3 text-sm max-h-[65vh] overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge>{KNOWLEDGE_TYPE_LABELS[d.knowledge_type] ?? d.knowledge_type}</Badge>
              {d.applicable_domain && <Badge variant="gold">{d.applicable_domain}</Badge>}
              <Badge variant="gold">质量 {d.quality_score ?? '-'}</Badge>
              {d.source_book && <Badge>源自《{d.source_book}》</Badge>}
            </div>
            <DetailBlock label="内容" text={d.content} />
            {d.source_snippet && <DetailBlock label="原文片段" text={d.source_snippet} mono />}
            <DetailArray label="标签" items={d.tags} />
          </div>
        )}
      </Dialog>
    </div>
  )
}

// ============ 页签3：蒸馏任务（ETL，代理 Python GUI 8610） ============

const KIND_OPTIONS = [
  { value: 'style', label: '文风蒸馏（distill_style.py）' },
  { value: 'domain', label: '领域知识蒸馏（extract_domain_knowledge.py）' },
  { value: 'material', label: '剧情素材抽取（extract_materials.py）' },
]

function EtlTab() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [kind, setKind] = useState<'style' | 'domain' | 'material'>('style')
  const [path, setPath] = useState('')
  const [presetName, setPresetName] = useState('')
  const [domain, setDomain] = useState('')
  const [sourceWork, setSourceWork] = useState('')
  const [dryRun, setDryRun] = useState(false)
  const [activeTid, setActiveTid] = useState<string | null>(null)
  const [logLines, setLogLines] = useState<string[]>([])
  const [logOffset, setLogOffset] = useState(0)
  const [taskStatus, setTaskStatus] = useState<string>('')

  const healthQ = useQuery({
    queryKey: ['mk-etl-health'],
    queryFn: materialKbApi.etlHealth,
    retry: false,
    refetchInterval: 30_000,
  })
  const tasksQ = useQuery({
    queryKey: ['mk-etl-tasks'],
    queryFn: materialKbApi.etlTasks,
    refetchInterval: 5_000,
  })

  const runM = useMutation({
    mutationFn: () => {
      const params: Record<string, unknown> = { path, dry_run: dryRun || undefined }
      if (kind === 'style') params.preset_name = presetName
      if (kind === 'domain') params.domain = domain
      if (kind === 'material') params.source_work = sourceWork
      return materialKbApi.etlRun(kind, params)
    },
    onSuccess: (r) => {
      toast(`蒸馏任务 #${r.task_id} 已启动`, 'success')
      setActiveTid(r.task_id)
      setLogLines([])
      setLogOffset(0)
      qc.invalidateQueries({ queryKey: ['mk-etl-tasks'] })
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  // 日志增量轮询：选中任务且未结束时每秒拉取
  useEffect(() => {
    if (!activeTid) return
    const timer = setInterval(async () => {
      try {
        const r = await materialKbApi.etlTaskLog(activeTid, logOffset)
        if (r.lines?.length) setLogLines((prev) => [...prev, ...r.lines])
        setLogOffset(r.next_offset)
        setTaskStatus(r.status)
        if (r.status !== 'running') clearInterval(timer)
      } catch {
        clearInterval(timer)
      }
    }, 1_000)
    return () => clearInterval(timer)
  }, [activeTid, logOffset])

  const selectTask = (tid: string) => {
    setActiveTid(tid)
    setLogLines([])
    setLogOffset(0)
    setTaskStatus('running')
  }

  const etlOnline = !!healthQ.data

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 左：触发表单 */}
      <div className="space-y-4">
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <PlayCircle className="h-4 w-4 text-gold-400" />
            <h2 className="font-semibold text-gray-100">触发蒸馏</h2>
            <span
              role="button"
              tabIndex={0}
              className={`ml-auto flex items-center gap-1.5 text-xs ${etlOnline ? 'text-ok' : 'text-bad'}`}
              onClick={() => healthQ.refetch()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); healthQ.refetch() } }}
            >
              <RefreshCw className="h-3 w-3 cursor-pointer" />
              Python ETL 服务{etlOnline ? '在线' : '离线'}
            </span>
          </div>
          {!etlOnline && (
            <div className="mb-3 text-xs text-gray-400 bg-gray-800/60 border border-gray-700 rounded-lg p-2">
              请先启动 Python 旁路服务：
              <code className="block mt-1 text-gold-400">
                cd sucaiqingxi && .venv\Scripts\python.exe gui_server.py
              </code>
            </div>
          )}
          <div className="space-y-3">
            <label className="block text-sm text-gray-300">
              任务类型
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as any)}
                className="mt-1 w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
              >
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-gray-300">
              语料路径（服务端 .txt 文件或目录）
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="如 K:\xiaoshuochaijie\zwrite\XianxiaForge\sucaiqingxi\xxx.txt"
                className="mt-1 w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
              />
            </label>
            {kind === 'style' && (
              <label className="block text-sm text-gray-300">
                预设名（必填）
                <input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="如 诛仙文风"
                  className="mt-1 w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
                />
              </label>
            )}
            {kind === 'domain' && (
              <label className="block text-sm text-gray-300">
                领域
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="如 仙侠修行体系"
                  className="mt-1 w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
                />
              </label>
            )}
            {kind === 'material' && (
              <label className="block text-sm text-gray-300">
                来源作品
                <input
                  value={sourceWork}
                  onChange={(e) => setSourceWork(e.target.value)}
                  placeholder="如 诛仙"
                  className="mt-1 w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
                />
              </label>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="accent-[#c09a52]" />
              试跑模式（只解析不写库）
            </label>
            <Button
              disabled={!etlOnline || !path || runM.isPending || (kind === 'style' && !presetName)}
              onClick={() => runM.mutate()}
            >
              {runM.isPending ? <Spinner className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
              {runM.isPending ? '提交中...' : '启动任务'}
            </Button>
          </div>
        </Card>

        {/* 任务列表 */}
        <Card>
          <h2 className="font-semibold text-gray-100 mb-3">任务列表</h2>
          {tasksQ.data?.length === 0 && <div className="text-sm text-gray-500">暂无任务</div>}
          <div className="space-y-1.5">
            {tasksQ.data?.map((t: any) => (
              <button
                key={t.id}
                onClick={() => selectTask(t.id)}
                className={`w-full text-left flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  activeTid === t.id ? 'border-gold-600/60 bg-gold-600/10' : 'border-gray-700 hover:border-gray-600'
                }`}
              >
                <Badge variant={t.status === 'done' ? 'success' : t.status === 'failed' ? 'destructive' : 'gold'}>
                  {t.status}
                </Badge>
                <span className="text-gray-200 truncate flex-1">{t.title}</span>
                <span className="text-xs text-gray-500 shrink-0">{t.elapsed}s</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* 右：日志 */}
      <Card className="flex flex-col min-h-[420px]">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="font-semibold text-gray-100">任务日志</h2>
          {activeTid && <Badge variant={taskStatus === 'done' ? 'success' : taskStatus === 'failed' ? 'destructive' : 'gold'}>#{activeTid} {taskStatus || 'loading'}</Badge>}
        </div>
        <div aria-live="polite" className="flex-1 overflow-y-auto rounded-lg bg-gray-950 border border-gray-800 p-3 font-mono text-xs text-gray-300 max-h-[60vh]">
          {!activeTid && <span className="text-gray-600">选择左侧任务查看日志...</span>}
          {logLines.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {l}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ============ 页签4：RAG 检索测试台 ============

const TABLE_LABELS: Record<string, string> = {
  plot_material_encounter: '奇遇',
  plot_material_foreshadow: '伏笔手法',
  plot_material_highlight: '高光',
  plot_material_task: '任务链',
}

function RecallTab() {
  const { toast } = useToast()
  const projectId = useCurrentProjectId()
  const [query, setQuery] = useState('')
  const [topN, setTopN] = useState(5)
  const [result, setResult] = useState<any>(null)

  const runM = useMutation({
    mutationFn: () =>
      materialKbApi.recallTest({
        query: query.trim(),
        projectId: projectId ? Number(projectId) : undefined,
        topN,
      }),
    onSuccess: (data) => setResult(data),
    onError: (e: Error) => toast(e.message || '检索失败', 'error'),
  })

  const handleSearch = () => {
    if (!query.trim()) {
      toast('请输入检索查询文本', 'error')
      return
    }
    runM.mutate()
  }

  return (
    <div className="space-y-4">
      {/* 查询输入区 */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-4 w-4 text-gold-400" />
          <h2 className="font-semibold text-gray-100">RAG 语义检索测试</h2>
          <span className="ml-auto text-xs text-gray-500">
            embedding_server (bge-small-zh-v1.5 / 512维)
          </span>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="输入查询文本，如：张小凡在死灵渊遭遇危机，需要一场奇遇..."
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 outline-none focus:border-gold-600/60"
            />
          </div>
          <div className="w-24">
            <label className="block text-xs text-gray-500 mb-1">Top N</label>
            <input
              type="number"
              min={1}
              max={20}
              value={topN}
              onChange={(e) => setTopN(Math.min(20, Math.max(1, Number(e.target.value) || 5)))}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-2 text-sm text-gray-100 outline-none"
            />
          </div>
          <Button onClick={handleSearch} disabled={runM.isPending || !query.trim()}>
            {runM.isPending ? <Spinner className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            {runM.isPending ? '检索中...' : '测试检索'}
          </Button>
        </div>
      </Card>

      {/* 结果区 */}
      {result && (
        <div className="space-y-4">
          {/* 元信息 */}
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>耗时 {result.elapsedMs}ms</span>
            {result.degraded && (
              <Badge variant="destructive">降级（embedding 不可用）</Badge>
            )}
            {!result.degraded && <Badge variant="success">正常召回</Badge>}
            <span>素材 {result.materials?.length ?? 0} 条</span>
            <span>领域 {result.domain?.length ?? 0} 条</span>
            <span>文风 {result.style ? 1 : 0} 套</span>
          </div>

          {/* 剧情素材命中 */}
          {result.materials?.length > 0 && (
            <Card>
              <h3 className="text-sm font-medium text-gray-200 mb-2">剧情素材命中</h3>
              <div className="space-y-2">
                {result.materials.map((m: any, i: number) => (
                  <div key={`${m.table}:${m.id}`} className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                    <span className="mt-0.5 shrink-0 text-xs font-mono text-gray-500">#{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-gray-100">{m.title}</span>
                        <Badge variant="default">{TABLE_LABELS[m.table] || m.table}</Badge>
                        {m.pinned && <Badge variant="gold">固定</Badge>}
                        {m.qualityScore != null && <span className="text-xs text-gray-500">质量 {m.qualityScore}</span>}
                      </div>
                      {m.corePlot && <p className="mt-1 text-xs text-gray-400 line-clamp-2">{m.corePlot}</p>}
                      {m.tags?.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {m.tags.map((t: string) => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`text-sm font-mono font-medium ${m.score >= 0.6 ? 'text-emerald-400' : m.score >= 0.4 ? 'text-gold-400' : 'text-gray-400'}`}>
                        {m.score.toFixed(3)}
                      </div>
                      <div className="text-[10px] text-gray-600">score</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 领域知识命中 */}
          {result.domain?.length > 0 && (
            <Card>
              <h3 className="text-sm font-medium text-gray-200 mb-2">领域知识命中</h3>
              <div className="space-y-2">
                {result.domain.map((d: any, i: number) => (
                  <div key={d.id} className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                    <span className="mt-0.5 shrink-0 text-xs font-mono text-gray-500">#{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-gray-100">{d.title}</span>
                        <Badge variant="default">{KNOWLEDGE_TYPE_LABELS[d.knowledgeType] ?? d.knowledgeType}</Badge>
                        {d.applicableDomain && <span className="text-xs text-gray-500">{d.applicableDomain}</span>}
                      </div>
                      {d.content && <p className="mt-1 text-xs text-gray-400 line-clamp-2">{d.content}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`text-sm font-mono font-medium ${d.score >= 0.6 ? 'text-emerald-400' : d.score >= 0.4 ? 'text-gold-400' : 'text-gray-400'}`}>
                        {d.score.toFixed(3)}
                      </div>
                      <div className="text-[10px] text-gray-600">score</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 文风预设命中 */}
          {result.style && (
            <Card>
              <h3 className="text-sm font-medium text-gray-200 mb-2">文风预设命中</h3>
              <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                <div className="flex items-center gap-2">
                  <Palette className="h-4 w-4 text-gold-400" />
                  <span className="text-sm font-medium text-gray-100">{result.style.styleName}</span>
                  {result.style.author && <span className="text-xs text-gray-500">{result.style.author}</span>}
                  {result.style.confidence != null && (
                    <Badge variant="gold">置信度 {Number(result.style.confidence).toFixed(2)}</Badge>
                  )}
                </div>
                {result.style.mentalModels?.length > 0 && (
                  <p className="mt-1.5 text-xs text-gray-400">
                    心智模型：{result.style.mentalModels.slice(0, 3).join('、')}
                    {result.style.mentalModels.length > 3 && ` 等${result.style.mentalModels.length}条`}
                  </p>
                )}
                {result.style.coreImagery?.length > 0 && (
                  <p className="mt-1 text-xs text-gray-400">
                    核心意象：{result.style.coreImagery.slice(0, 5).join('、')}
                  </p>
                )}
              </div>
            </Card>
          )}

          {/* 无结果 */}
          {!result.degraded && !result.materials?.length && !result.domain?.length && !result.style && (
            <EmptyState message="未命中任何素材（可能 embedding 服务未启动或相似度低于阈值）" />
          )}
        </div>
      )}
    </div>
  )
}

// ============ 页签3：拆文工具（轻量拆文 + 整本拆文 合并入口） ============

function BenchmarkTab() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const projectId = useCurrentProjectId()
  const [addOpen, setAddOpen] = useState(false)
  const [analyzeOpen, setAnalyzeOpen] = useState(false)
  const [bookOpen, setBookOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const listQ = useQuery({
    queryKey: ['mk-benchmark', projectId],
    queryFn: () => benchmarkApi.list(projectId),
    enabled: !!projectId,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['mk-benchmark', projectId] })

  const pinM = useMutation({
    mutationFn: ({ id, pinned }: { id: number; pinned: boolean }) => benchmarkApi.togglePin(projectId, id, pinned),
    onSuccess: (r) => {
      toast(r.pinned ? '已置顶（写作时强制借鉴）' : '已取消置顶', 'success')
      invalidate()
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const delM = useMutation({
    mutationFn: (id: number) => benchmarkApi.remove(projectId, id),
    onSuccess: () => {
      toast('已删除', 'success')
      invalidate()
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const rows = listQ.data ?? []

  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-200">拆文工具（对标书 → 灵感素材）</p>
          <p className="text-xs text-gray-500">
            轻量拆文：粘贴原文→LLM拆4类资产 · 整本拆文：上传TXT逐章深度拆解 · 拆后素材在「灵感素材库」查看和置顶
          </p>
        </div>
        <Button variant="outline" onClick={() => setAddOpen(true)}>手动添加</Button>
        <Button variant="outline" onClick={() => setBookOpen(true)}>
          <BookOpenCheck className="mr-1 h-4 w-4" />上传整本
        </Button>
        <Button onClick={() => setAnalyzeOpen(true)}>
          <Zap className="mr-1 h-4 w-4" />轻量拆文
        </Button>
      </Card>

      {listQ.isLoading ? (
        <Spinner label="加载对标素材" />
      ) : !rows.length ? (
        <EmptyState message="暂无对标素材：使用上方「轻量拆文」粘贴原文或「上传整本」拆解" />
      ) : (
        <div className="space-y-2">
          {rows.map((m: any) => (
            <Card key={m.id} className="p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-100">{m.title}</span>
                    <Badge variant="default">{BENCHMARK_TYPE_LABELS[m.material_type] ?? m.material_type}</Badge>
                    <Badge variant="seal">《{m.source_book_title}》</Badge>
                    {m.pinned && <Badge variant="gold">置顶·必融入</Badge>}
                  </div>
                  <p
                    className={`mt-1 cursor-pointer text-xs text-gray-400 ${expandedId === m.id ? '' : 'line-clamp-2'}`}
                    onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
                    title={expandedId === m.id ? '点击收起' : '点击展开'}
                  >
                    {m.content_md}
                  </p>
                  {m.tags?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {m.tags.map((t: string) => (
                        <span key={t} className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => pinM.mutate({ id: m.id, pinned: !m.pinned })}
                  >
                    {m.pinned ? '取消置顶' : '置顶'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(`删除对标素材「${m.title}」？`)) delM.mutate(m.id)
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {addOpen && (
        <BenchmarkAddDialog
          projectId={projectId}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false)
            invalidate()
          }}
        />
      )}
      {analyzeOpen && (
        <BenchmarkAnalyzeDialog
          projectId={projectId}
          onClose={() => setAnalyzeOpen(false)}
          onDone={() => {
            setAnalyzeOpen(false)
            invalidate()
          }}
        />
      )}
      {bookOpen && (
        <BenchmarkBookDialog
          projectId={projectId}
          onClose={() => setBookOpen(false)}
          onDone={() => {
            setBookOpen(false)
            invalidate()
          }}
        />
      )}
    </div>
  )
}

/** 手动添加对标素材 */
function BenchmarkAddDialog({ projectId, onClose, onSaved }: {
  projectId: number | string
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [form, setForm] = useState({
    sourceBookTitle: '',
    materialType: 'character',
    title: '',
    contentMd: '',
    tags: '',
  })

  const saveM = useMutation({
    mutationFn: () =>
      benchmarkApi.add(projectId, {
        sourceBookTitle: form.sourceBookTitle.trim(),
        materialType: form.materialType,
        title: form.title.trim(),
        contentMd: form.contentMd.trim(),
        tags: form.tags.split(/[,，、\s]+/).filter(Boolean).slice(0, 6),
      }),
    onSuccess: () => {
      toast('已添加', 'success')
      onSaved()
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const valid = form.sourceBookTitle.trim() && form.title.trim() && form.contentMd.trim()

  return (
    <Dialog open onClose={onClose} title="手动添加对标素材" className="max-w-2xl">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="对标书名"
            placeholder="如：仙逆"
            value={form.sourceBookTitle}
            onChange={(e) => setForm({ ...form, sourceBookTitle: e.target.value })}
          />
          <Select
            label="素材类型"
            value={form.materialType}
            onChange={(e) => setForm({ ...form, materialType: e.target.value })}
            options={[
              { value: 'character', label: '角色卡（含四要素）' },
              { value: 'plot_unit', label: '剧情单元（冲突-转折）' },
              { value: 'style', label: '文风分析（句式/节奏）' },
              { value: 'setting', label: '设定（规则与限制）' },
            ]}
          />
        </div>
        <Input
          label="标题"
          placeholder="人物名/剧情单元名/文风要点"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <Textarea
          label="内容（markdown）"
          rows={8}
          placeholder={form.materialType === 'character'
            ? '角色卡须含四要素：role（定位）/ personality（性格）/ motivation（动机）/ arc（成长弧）'
            : '可复刻的结构/节奏/情绪曲线描述'}
          value={form.contentMd}
          onChange={(e) => setForm({ ...form, contentMd: e.target.value })}
        />
        <Input
          label="标签（逗号分隔，最多6个）"
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!valid || saveM.isPending} onClick={() => saveM.mutate()}>
            {saveM.isPending ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/** 拆文 agent：粘贴对标书文本 → LLM 拆解 → 批量入库 */
function BenchmarkAnalyzeDialog({ projectId, onClose, onDone }: {
  projectId: number | string
  onClose: () => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [bookTitle, setBookTitle] = useState('')
  const [text, setText] = useState('')

  const analyzeM = useMutation({
    mutationFn: () => benchmarkApi.analyze(projectId, bookTitle.trim(), text),
    onSuccess: (r) => {
      toast(`拆文完成：产出 ${r.analyzed} 条，入库 ${r.inserted.length} 条`, 'success')
      onDone()
    },
    onError: (e: Error) => toast(`拆文失败：${e.message}`, 'error'),
  })

  const valid = bookTitle.trim() && text.trim().length >= 100

  return (
    <Dialog open onClose={onClose} title="拆文分析（LLM 拆解对标书）" className="max-w-3xl">
      <div className="space-y-3">
        <Input
          label="对标书名"
          placeholder="如：仙逆"
          value={bookTitle}
          onChange={(e) => setBookTitle(e.target.value)}
        />
        <Textarea
          label="待拆解文本（至少100字，超长自动截断前2.4万字）"
          rows={14}
          placeholder="粘贴对标书章节/片段原文，将拆解为角色卡、剧情单元、文风分析、设定四类素材"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">当前 {text.trim().length} 字（需≥100）</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={!valid || analyzeM.isPending} onClick={() => analyzeM.mutate()}>
              {analyzeM.isPending ? '拆解中（约数十秒）…' : '开始拆文'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

/** 整本拆文：上传 TXT → SSE 实时进度 → 完成后刷新列表 */
function BenchmarkBookDialog({ projectId, onClose, onDone }: {
  projectId: number | string
  onClose: () => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [bookTitle, setBookTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [maxChapters, setMaxChapters] = useState(5)
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<{ text: string; type: string }[]>([])
  const [progress, setProgress] = useState(0)
  const [completed, setCompleted] = useState(false)

  const valid = bookTitle.trim() && file != null

  const handleStart = async () => {
    if (!file || !bookTitle.trim()) return
    setRunning(true)
    setLogs([])
    setProgress(0)

    try {
      const { response } = await benchmarkApi.analyzeBook(projectId, file, bookTitle.trim(), maxChapters)

      // 读取 SSE 流
      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法读取 SSE 流')

      const decoder = new TextDecoder()
      let buffer = ''
      let totalItems = 0
      let totalChapters = 0
      let skipped = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))

            if (event.type === 'status') {
              setLogs((prev) => [...prev, { text: event.data.message, type: 'status' }])
            } else if (event.type === 'chapter_start') {
              setLogs((prev) => [...prev, { text: `📖 第${event.data.chapterIdx}章 ${event.data.title}`, type: 'chapter' }])
            } else if (event.type === 'chapter_complete') {
              const sk = event.data.skeletonTitle ? `骨架: ${event.data.skeletonTitle}` : '无骨架'
              setLogs((prev) => [...prev, { text: `  ✅ 第${event.data.chapterIdx}章 完成 — ${sk}，${event.data.plotCount} 条情节`, type: 'complete' }])
            } else if (event.type === 'progress') {
              setProgress(event.data.percent)
            } else if (event.type === 'complete') {
              totalItems = event.data.totalItems
              totalChapters = event.data.totalChapters
              skipped = event.data.skipped
              setLogs((prev) => [...prev, { text: `🎉 全部完成：${totalChapters} 章拆解，产出 ${totalItems} 条素材，跳过 ${skipped} 章`, type: 'complete' }])
              setCompleted(true)
              setProgress(100)
            } else if (event.type === 'error') {
              setLogs((prev) => [...prev, { text: `❌ ${event.data.message}`, type: 'error' }])
            }
          } catch {
            // 忽略解析失败
          }
        }
      }

      toast(`整本拆文完成：产出 ${totalItems} 条素材`, 'success')
    } catch (e: any) {
      toast(`整本拆文失败: ${e.message}`, 'error')
      setLogs((prev) => [...prev, { text: `❌ ${e.message}`, type: 'error' }])
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="整本对标书拆解（结构级逆向）" className="max-w-2xl">
      <div className="space-y-3">
        {!running && !completed && (
          <>
            <Input
              label="对标书名"
              placeholder="如：仙逆"
              value={bookTitle}
              onChange={(e) => setBookTitle(e.target.value)}
            />
            <div>
              <label className="mb-1 block text-xs text-gray-400">上传 TXT 文件</label>
              <input
                type="file"
                accept=".txt"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-gray-300 file:mr-3 file:rounded file:border-0 file:bg-gold-600/20 file:px-3 file:py-1.5 file:text-gold-400 hover:file:bg-gold-600/30"
              />
              {file && <span className="mt-1 block text-xs text-gray-500">{file.name}（{(file.size / 1024 / 1024).toFixed(2)} MB）</span>}
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">拆解章节数（默认前5章验证，0=全部）</label>
              <input
                type="number"
                min={0}
                max={9999}
                value={maxChapters}
                onChange={(e) => setMaxChapters(Number(e.target.value) || 0)}
                className="w-24 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
              />
              <span className="ml-2 text-xs text-gray-500">建议先拆5章验证效果再跑整本</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>取消</Button>
              <Button disabled={!valid} onClick={handleStart}>
                <BookOpenCheck className="mr-1 h-4 w-4" />开始拆解
              </Button>
            </div>
          </>
        )}

        {(running || completed || logs.length > 0) && (
          <>
            {/* 进度条 */}
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${completed ? 'bg-green-500' : 'bg-gold-500'}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-gray-400">{progress}%</span>
            </div>

            {/* 日志 */}
            <div className="max-h-80 space-y-0.5 overflow-y-auto rounded border border-gray-800 bg-black/30 p-2 font-mono text-xs">
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={
                    log.type === 'error' ? 'text-red-400' :
                    log.type === 'complete' ? 'text-green-400' :
                    log.type === 'chapter' ? 'text-gold-400' :
                    'text-gray-400'
                  }
                >
                  {log.text}
                </div>
              ))}
            </div>

            {completed && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onClose}>关闭</Button>
                <Button onClick={onDone}>完成，查看素材</Button>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
