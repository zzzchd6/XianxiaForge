import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { Compass, TrendingUp } from 'lucide-react'
import {
  Card, CardHeader, CardTitle, CardContent, Select, Spinner, EmptyState, Badge,
} from '../components/ui'
import { projectsApi, chaptersApi, settingsApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'

/** 大类编码 → 图表色（hex） */
const CATEGORY_HEX: Record<string, string> = {
  growth: '#10b981',
  relation: '#f43f5e',
  item: '#f59e0b',
  mainplot: '#c49a52',
  explore: '#06b6d4',
  conflict: '#ef4444',
  faction: '#eab308',
  strategy: '#8b5cf6',
  buffer: '#64748b',
}
const FALLBACK_HEX = '#6b7280'

/** 均衡度评分 → 文案/配色 */
function balanceTone(score: number | null) {
  if (score == null) return { label: '暂无数据', cls: 'text-gray-500' }
  if (score >= 75) return { label: '均衡', cls: 'text-emerald-400' }
  if (score >= 60) return { label: '尚可', cls: 'text-amber-400' }
  return { label: '偏单一', cls: 'text-red-400' }
}

/**
 * 方向统计页（阶段3 剧情方向体系）
 * 基于已选定分支链的方向分布，recharts 可视化：大类柱状图 + 细分方向占比环图 + 均衡度评分。
 */
export default function DirectionStats() {
  // 当前项目（全局状态，侧边栏可切换）
  const projectId = useCurrentProjectId()

  // 卷筛选（默认全书）
  const [volumeNo, setVolumeNo] = useState<string>('all')

  // 章节列表（用于派生卷选项）
  const { data: chapters } = useQuery({
    queryKey: ['chapters', projectId],
    queryFn: () => chaptersApi.list(projectId),
    enabled: !!projectId,
  })
  const volumeOptions = useMemo(() => {
    const vols = Array.from(new Set((chapters ?? []).map((c: any) => c.volumeNo ?? 1))).sort((a, b) => a - b)
    return [{ value: 'all', label: '全书' }, ...vols.map((v) => ({ value: String(v), label: `第${v}卷` }))]
  }, [chapters])

  // 方向字典（用于大类元信息与细分方向归属）
  const { data: catalog } = useQuery({
    queryKey: ['direction-catalog'],
    queryFn: () => settingsApi.directionCatalog(),
    staleTime: Infinity,
  })
  const categoryByCode = useMemo(
    () => new Map<string, any>((catalog?.categories ?? []).map((c: any) => [c.code, c])),
    [catalog]
  )

  // 方向分布统计
  const { data: stats, isLoading } = useQuery({
    queryKey: ['direction-stats', projectId, volumeNo],
    queryFn: () => projectsApi.directionStats(projectId, volumeNo === 'all' ? undefined : Number(volumeNo)),
    enabled: !!projectId,
  })

  const barData = useMemo(
    () => (stats?.byCategory ?? []).map((c: any) => ({
      name: c.name,
      count: c.count,
      percent: c.percent,
      fill: CATEGORY_HEX[c.code] ?? FALLBACK_HEX,
    })),
    [stats]
  )
  const pieData = useMemo(
    () => (stats?.byDirection ?? []).map((d: any) => ({
      name: d.name,
      value: d.count,
      category: d.category,
      fill: CATEGORY_HEX[d.category] ?? FALLBACK_HEX,
    })),
    [stats]
  )

  const tone = balanceTone(stats?.balanceScore ?? null)

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Compass className="h-6 w-6 text-violet-400" />
          <h1 className="text-2xl font-bold text-gray-100">方向统计</h1>
        </div>
        <div className="w-32">
          <Select aria-label="选择卷" value={volumeNo} onChange={(e) => setVolumeNo(e.target.value)} options={volumeOptions} />
        </div>
      </div>

      {!projectId ? (
        <EmptyState message="暂无项目，请先创建项目" />
      ) : isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : !stats || stats.total === 0 ? (
        <EmptyState
          icon={<TrendingUp className="h-10 w-10" />}
          message="暂无已选定分支的方向数据，选择分支后此处将展示叙事方向分布"
        />
      ) : (
        <>
          {/* 概览指标 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">方向均衡度</p>
                <div className="mt-1 flex items-end gap-2">
                  <span className={`text-3xl font-bold ${tone.cls}`}>{stats.balanceScore ?? '—'}</span>
                  <span className={`mb-1 text-xs ${tone.cls}`}>{tone.label}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">已选定分支</p>
                <p className="mt-1 text-3xl font-bold text-gray-100">{stats.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">未分类方向</p>
                <p className="mt-1 text-3xl font-bold text-gray-100">
                  {stats.unclassified}
                  <span className="ml-1 text-sm font-normal text-gray-500">
                    ({stats.total ? Math.round((stats.unclassified / stats.total) * 100) : 0}%)
                  </span>
                </p>
              </CardContent>
            </Card>
          </div>

          {/* 图表区 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* 大类分布柱状图 */}
            <Card>
              <CardHeader><CardTitle>大类分布</CardTitle></CardHeader>
              <CardContent>
                {barData.length ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#332b1f" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: '#8d8371', fontSize: 12 }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fill: '#8d8371', fontSize: 12 }} axisLine={false} tickLine={false} />
                        <Tooltip
                          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                          contentStyle={{ background: '#17130c', border: '1px solid #453c2d', borderRadius: 8 }}
                          labelStyle={{ color: '#ece7da' }}
                          formatter={(v: any, _n: any, entry: any) => [`${v} 章（${entry?.payload?.percent ?? 0}%）`, '数量']}
                        />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {barData.map((d: any, i: number) => <Cell key={i} fill={d.fill} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="py-16 text-center text-sm text-gray-600">暂无已分类数据</p>
                )}
              </CardContent>
            </Card>

            {/* 细分方向占比环图 */}
            <Card>
              <CardHeader><CardTitle>细分方向占比</CardTitle></CardHeader>
              <CardContent>
                {pieData.length ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2}>
                          {pieData.map((d: any, i: number) => <Cell key={i} fill={d.fill} />)}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: '#17130c', border: '1px solid #453c2d', borderRadius: 8 }}
                          labelStyle={{ color: '#ece7da' }}
                          formatter={(v: any, name: any) => [`${v} 章`, name]}
                        />
                        <Legend
                          formatter={(value: any) => <span style={{ color: '#8d8371', fontSize: 12 }}>{value}</span>}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="py-16 text-center text-sm text-gray-600">暂无已分类数据</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 明细表 */}
          <Card>
            <CardHeader><CardTitle>方向明细</CardTitle></CardHeader>
            <CardContent>
              {stats.byDirection?.length ? (
                <div className="space-y-2">
                  {stats.byDirection.map((d: any) => {
                    const cat = categoryByCode.get(d.category)
                    return (
                      <div key={d.code} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_HEX[d.category] ?? FALLBACK_HEX }} />
                          <span className="text-sm text-gray-200">{d.name}</span>
                          {cat && <Badge variant="default">{cat.name}</Badge>}
                        </div>
                        <span className="text-sm text-gray-400">{d.count} 章</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-gray-600">暂无已分类方向</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
