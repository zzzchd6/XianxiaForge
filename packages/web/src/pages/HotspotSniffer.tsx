/**
 * 热点嗅探（由独立工具并入）
 * 抓热门榜单 → LLM 提炼剧情素材模板 → 推送入创作库素材四表（全局共享）。
 * 三页签：抓取榜单 / 榜单书目 / 灵感入库，共享选中批次。
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Flame, Radar, BookMarked, Sparkles, Check, X, UploadCloud } from 'lucide-react'
import {
  hotspotApi,
  HOTSPOT_MATERIAL_TYPES,
  HOTSPOT_TYPE_LABELS,
  HOTSPOT_TARGET_TABLE_LABELS,
  type HotspotBatch,
  type HotspotInsight,
} from '../lib/api'
import { Button, Card, Badge, Tabs, Spinner, EmptyState, useToast } from '../components/ui'

type Tab = 'crawl' | 'novels' | 'insight'

export default function HotspotSniffer() {
  const [tab, setTab] = useState<Tab>('crawl')
  const [batchId, setBatchId] = useState<number | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Flame className="h-6 w-6 text-gold-400" />
        <div>
          <h1 className="text-xl font-bold text-gray-100">热点嗅探</h1>
          <p className="text-xs text-gray-400">抓热门榜单 · LLM 提炼剧情素材模板 · 推送入创作库</p>
        </div>
        <Tabs
          className="ml-auto w-80"
          tabs={[
            { id: 'crawl', label: '抓取榜单' },
            { id: 'novels', label: '榜单书目' },
            { id: 'insight', label: '灵感入库' },
          ]}
          active={tab}
          onChange={(id) => setTab(id as Tab)}
        />
      </div>

      {tab === 'crawl' && (
        <CrawlTab
          selectedBatchId={batchId}
          onSelectBatch={setBatchId}
          onGoInsight={() => setTab('insight')}
          onGoNovels={() => setTab('novels')}
        />
      )}
      {tab === 'novels' && <NovelsTab batchId={batchId} />}
      {tab === 'insight' && <InsightTab batchId={batchId} />}
    </div>
  )
}

// ============ 页签1：抓取榜单 ============

function CrawlTab({
  selectedBatchId,
  onSelectBatch,
  onGoInsight,
  onGoNovels,
}: {
  selectedBatchId: number | null
  onSelectBatch: (id: number) => void
  onGoInsight: () => void
  onGoNovels: () => void
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [limit, setLimit] = useState(30)

  const sourcesQ = useQuery({ queryKey: ['hotspot-sources'], queryFn: hotspotApi.sources })
  const batchesQ = useQuery({ queryKey: ['hotspot-batches'], queryFn: hotspotApi.batches })

  const crawlM = useMutation({
    mutationFn: () => hotspotApi.crawl([...checked], limit),
    onSuccess: (r) => {
      toast(`批次 #${r.batchId} 完成：入库 ${r.itemCount} 条（${r.status}）。${r.note}`, r.itemCount > 0 ? 'success' : 'error')
      onSelectBatch(r.batchId)
      qc.invalidateQueries({ queryKey: ['hotspot-batches'] })
    },
    onError: (e: Error) => toast(`抓取失败：${e.message}`, 'error'),
  })

  const analyzeM = useMutation({
    mutationFn: (batchId: number) => hotspotApi.analyze(batchId),
    onSuccess: (r, batchId) => {
      toast(`批次 #${batchId} 分析完成：生成 ${r.count} 条灵感`, 'success')
      onSelectBatch(batchId)
      qc.invalidateQueries({ queryKey: ['hotspot-batches'] })
    },
    onError: (e: Error) => toast(`分析失败：${e.message}`, 'error'),
  })

  const toggle = (name: string) => {
    const next = new Set(checked)
    next.has(name) ? next.delete(name) : next.add(name)
    setChecked(next)
  }

  return (
    <div className="space-y-4">
      {/* 榜单源选择 */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Radar className="h-4 w-4 text-gold-400" />
          <h2 className="font-semibold text-gray-100">1. 选择榜单源</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {sourcesQ.data?.map((s) => (
            <label
              key={s.name}
              className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition ${
                checked.has(s.name)
                  ? 'border-gold-600/60 bg-gold-600/10'
                  : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              <input
                type="checkbox"
                checked={checked.has(s.name)}
                onChange={() => toggle(s.name)}
                className="mt-1 accent-[#c09a52]"
              />
              <div>
                <div className="text-sm font-medium text-gray-100 flex items-center gap-1.5">
                  {s.label}
                  <Badge variant={s.kind === 'page' ? 'default' : 'gold'}>{s.kind}</Badge>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{s.description}</div>
              </div>
            </label>
          ))}
          {sourcesQ.isLoading && <div className="text-sm text-gray-500">加载榜单源...</div>}
        </div>
        <div className="flex items-center gap-3 mt-4">
          <label className="text-sm text-gray-300 flex items-center gap-2">
            每源抓取上限
            <input
              type="number"
              value={limit}
              min={5}
              max={100}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-20 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-gray-100"
            />
          </label>
          <Button disabled={checked.size === 0 || crawlM.isPending} onClick={() => crawlM.mutate()}>
            {crawlM.isPending ? <Spinner className="h-4 w-4" /> : <Radar className="h-4 w-4" />}
            {crawlM.isPending ? '抓取中...' : '开始抓取'}
          </Button>
          <span className="text-xs text-gray-500">抓取耗时较长（逐源串行+间隔防限流），请耐心等待</span>
        </div>
      </Card>

      {/* 批次列表 */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <BookMarked className="h-4 w-4 text-gold-400" />
          <h2 className="font-semibold text-gray-100">2. 抓取批次</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-gray-400 text-left border-b border-gray-700">
              <tr>
                <th className="py-2 pr-3">#</th>
                <th className="pr-3">榜单源</th>
                <th className="pr-3">状态</th>
                <th className="pr-3">书目</th>
                <th className="pr-3">灵感</th>
                <th className="pr-3">时间</th>
                <th className="pr-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {batchesQ.data?.map((b: HotspotBatch) => (
                <tr
                  key={b.id}
                  className={`border-b border-gray-800 hover:bg-gray-800/40 ${
                    selectedBatchId === b.id ? 'bg-gold-600/10' : ''
                  }`}
                >
                  <td className="py-2 pr-3 font-mono text-gray-300">{b.id}</td>
                  <td className="pr-3 text-gray-300">{(b.source_names ?? []).join(', ')}</td>
                  <td className="pr-3">
                    <BatchStatusBadge status={b.status} />
                  </td>
                  <td className="pr-3 text-gray-300">{b.item_count}</td>
                  <td className="pr-3 text-gray-300">{b.insight_count}</td>
                  <td className="pr-3 text-xs text-gray-500">
                    {b.started_at ? new Date(b.started_at).toLocaleString() : '-'}
                  </td>
                  <td className="pr-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          onSelectBatch(b.id)
                          onGoNovels()
                        }}
                        className="text-gold-400 hover:underline"
                      >
                        看书目
                      </button>
                      <button
                        disabled={analyzeM.isPending || b.item_count === 0}
                        onClick={() => analyzeM.mutate(b.id)}
                        className="text-gray-200 hover:underline disabled:opacity-40"
                      >
                        {analyzeM.isPending && analyzeM.variables === b.id ? '分析中...' : '分析'}
                      </button>
                      <button
                        onClick={() => {
                          onSelectBatch(b.id)
                          onGoInsight()
                        }}
                        className="text-ok hover:underline"
                      >
                        看灵感
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {batchesQ.data?.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-gray-500">
                    暂无批次，先在上方抓取
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function BatchStatusBadge({ status }: { status: string }) {
  const map: Record<string, 'success' | 'warning' | 'destructive' | 'gold' | 'default'> = {
    completed: 'success',
    partial: 'warning',
    failed: 'destructive',
    running: 'gold',
  }
  return <Badge variant={map[status] ?? 'default'}>{status}</Badge>
}

// ============ 页签2：榜单书目 ============

function NovelsTab({ batchId }: { batchId: number | null }) {
  const novelsQ = useQuery({
    queryKey: ['hotspot-novels', batchId],
    queryFn: () => hotspotApi.novels(batchId!),
    enabled: !!batchId,
  })

  if (!batchId) {
    return <EmptyState message="请先在「抓取榜单」页选择一个批次" icon={<BookMarked className="h-8 w-8" />} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold text-gray-100">批次 #{batchId} 榜单书目</h2>
        <span className="text-sm text-gray-500">共 {novelsQ.data?.length ?? 0} 本</span>
      </div>
      {novelsQ.isLoading && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {novelsQ.data?.map((n) => (
          <Card key={n.id}>
            <div className="flex items-baseline gap-2">
              {n.rank != null && <span className="text-gold-400 font-bold text-sm">#{n.rank}</span>}
              <span className="font-medium text-gray-100">{n.title}</span>
              {n.url && (
                <a
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-gray-400 hover:text-gold-400 hover:underline"
                >
                  原页
                </a>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-1 flex flex-wrap gap-2">
              {n.author && <span>作者：{n.author}</span>}
              {n.category && <span>分类：{n.category}</span>}
              {n.word_count && <span>字数：{n.word_count}</span>}
              {n.popularity && <span>热度：{n.popularity}</span>}
              <span className="text-gray-600">来源：{n.source}</span>
            </div>
            {n.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {n.tags.map((t, i) => (
                  <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">
                    {t}
                  </span>
                ))}
              </div>
            )}
            {n.intro && <p className="text-xs text-gray-400 mt-2 line-clamp-3">{n.intro}</p>}
          </Card>
        ))}
      </div>
      {novelsQ.data?.length === 0 && !novelsQ.isLoading && <EmptyState message="该批次没有书目数据" />}
    </div>
  )
}

// ============ 页签3：灵感入库 ============

const TYPE_ORDER = ['encounter', 'foreshadow', 'highlight', 'task', 'trend']

function defaultTarget(type: string): string {
  return `plot_material_${type}`
}

function InsightTab({ batchId }: { batchId: number | null }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [statusFilter, setStatusFilter] = useState<string>('')

  const insightsQ = useQuery({
    queryKey: ['hotspot-insights', batchId, statusFilter],
    queryFn: () => hotspotApi.insights({ batchId: batchId!, status: statusFilter || undefined }),
    enabled: !!batchId,
  })

  const updateM = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => hotspotApi.updateInsight(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hotspot-insights'] }),
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const pushM = useMutation({
    mutationFn: ({ id, table }: { id: number; table: string }) => hotspotApi.push(id, table),
    onSuccess: (r) => {
      toast(
        `已推送灵感 #${r.insightId} 到 ${HOTSPOT_TARGET_TABLE_LABELS[r.targetTable]}（全局素材，id=${r.targetId}${
          r.embedded ? '，已向量化' : '，向量服务不可达待补齐'
        }）`,
        'success',
      )
      qc.invalidateQueries({ queryKey: ['hotspot-insights'] })
    },
    onError: (e: Error) => toast(`推送失败：${e.message}`, 'error'),
  })

  const grouped = useMemo(() => {
    const g: Record<string, HotspotInsight[]> = {}
    for (const it of insightsQ.data ?? []) {
      ;(g[it.insight_type] ??= []).push(it)
    }
    return g
  }, [insightsQ.data])

  if (!batchId) {
    return <EmptyState message="请先在「抓取榜单」页选择批次并完成分析" icon={<Sparkles className="h-8 w-8" />} />
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <span className="font-semibold text-gray-100">批次 #{batchId} 剧情素材</span>
        <select
          aria-label="筛选状态"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
        >
          <option value="">全部状态</option>
          <option value="new">未处理</option>
          <option value="kept">已保留</option>
          <option value="discarded">已丢弃</option>
          <option value="pushed">已入库</option>
        </select>
        <span className="ml-auto text-xs text-gray-500">
          素材推送为全局共享（不绑定项目），入库后由写作管线向量召回
        </span>
      </Card>

      {insightsQ.isLoading && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
      {insightsQ.data?.length === 0 && !insightsQ.isLoading && (
        <EmptyState message="该批次暂无素材，请回到抓取页点击「分析」" />
      )}

      {TYPE_ORDER.filter((t) => grouped[t]?.length).map((type) => (
        <Card key={type}>
          <h3 className="font-semibold text-gray-100 mb-3 flex items-center gap-2">
            {HOTSPOT_TYPE_LABELS[type] ?? type}
            <span className="text-xs text-gray-500">{grouped[type].length} 条</span>
            {type === 'trend' && <Badge variant="warning">仅参考，不入素材库</Badge>}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {grouped[type].map((it) => (
              <InsightCard
                key={it.id}
                insight={it}
                onKeep={() => updateM.mutate({ id: it.id, status: 'kept' })}
                onDiscard={() => updateM.mutate({ id: it.id, status: 'discarded' })}
                onPush={(table) => pushM.mutate({ id: it.id, table })}
                pushing={pushM.isPending && pushM.variables?.id === it.id}
              />
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

/** payload 中的素材结构化字段（与 plot_material_* 列对应） */
const PAYLOAD_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'trigger_condition', label: '触发' },
  { key: 'reward', label: '收益' },
  { key: 'cost_or_risk', label: '代价' },
  { key: 'emotional_beat', label: '情绪' },
  { key: 'applicable_scene_type', label: '场景' },
]

function InsightCard({
  insight,
  onKeep,
  onDiscard,
  onPush,
  pushing,
}: {
  insight: HotspotInsight
  onKeep: () => void
  onDiscard: () => void
  onPush: (table: string) => void
  pushing: boolean
}) {
  const [table, setTable] = useState(defaultTarget(insight.insight_type))
  const isPushed = insight.status === 'pushed'
  const isDiscarded = insight.status === 'discarded'
  const isMaterial = HOTSPOT_MATERIAL_TYPES.includes(insight.insight_type)
  const p = insight.payload ?? {}
  const tags: string[] = Array.isArray(p.tags) ? p.tags : []

  return (
    <div
      className={`border rounded-lg p-3 ${
        isPushed
          ? 'bg-ok/5 border-ok/30'
          : isDiscarded
            ? 'bg-gray-900 border-gray-800 opacity-60'
            : 'bg-gray-800/50 border-gray-700'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm text-gray-100">{insight.title}</div>
        <Badge variant="gold" className="shrink-0">
          价值 {insight.score}
        </Badge>
      </div>
      {insight.content && (
        <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{insight.content}</p>
      )}

      {isMaterial && (
        <div className="mt-2 space-y-0.5">
          {PAYLOAD_FIELDS.filter((f) => p[f.key]).map((f) => (
            <div key={f.key} className="text-[11px] text-gray-400">
              <span className="inline-block w-8 text-gray-500">{f.label}</span>
              {String(p[f.key])}
            </div>
          ))}
          {(tags.length > 0 || p.source_work) && (
            <div className="flex flex-wrap items-center gap-1 pt-1">
              {tags.map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">
                  {t}
                </span>
              ))}
              {p.source_work && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">
                  源自《{String(p.source_work)}》
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <InsightStatusTag status={insight.status} />

      {!isPushed && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Button size="sm" variant="outline" onClick={onKeep}>
            <Check className="h-3.5 w-3.5" />
            {insight.status === 'kept' ? '已保留' : '保留'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDiscard}>
            <X className="h-3.5 w-3.5" />
            丢弃
          </Button>
          {isMaterial && (
            <div className="ml-auto flex items-center gap-1">
              <select
                aria-label="选择入库目标表"
                value={table}
                onChange={(e) => setTable(e.target.value)}
                className="text-xs rounded-md border border-gray-700 bg-gray-800 px-1 py-1 text-gray-200"
              >
                {Object.entries(HOTSPOT_TARGET_TABLE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <Button size="sm" disabled={pushing} onClick={() => onPush(table)}>
                {pushing ? <Spinner className="h-3.5 w-3.5" /> : <UploadCloud className="h-3.5 w-3.5" />}
                {pushing ? '推送中...' : '推送入库'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function InsightStatusTag({ status }: { status: string }) {
  const map: Record<string, { t: string; c: string }> = {
    new: { t: '未处理', c: 'text-gray-500' },
    kept: { t: '已保留', c: 'text-gold-400' },
    discarded: { t: '已丢弃', c: 'text-gray-600' },
    pushed: { t: '已入库', c: 'text-ok' },
  }
  const s = map[status] ?? map.new
  return <div className={`text-[11px] mt-1 ${s.c}`}>● {s.t}</div>
}
