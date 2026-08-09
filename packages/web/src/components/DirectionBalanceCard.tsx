import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Card, CardContent, Spinner } from './ui'
import { projectsApi } from '../lib/api'

/** 大类编码 → 图表色（hex，供徽标点缀） */
const CATEGORY_TEXT: Record<string, string> = {
  growth: 'text-emerald-400',
  relation: 'text-rose-400',
  item: 'text-amber-400',
  mainplot: 'text-indigo-400',
  explore: 'text-cyan-400',
  conflict: 'text-red-400',
  faction: 'text-yellow-400',
  strategy: 'text-violet-400',
  buffer: 'text-slate-400',
}

/** 均衡度评分 → 文案/配色 */
function balanceTone(score: number | null) {
  if (score == null) return { label: '暂无数据', cls: 'text-gray-500' }
  if (score >= 75) return { label: '均衡', cls: 'text-emerald-400' }
  if (score >= 60) return { label: '尚可', cls: 'text-amber-400' }
  return { label: '偏单一', cls: 'text-red-400' }
}

/**
 * 方向均衡度卡片（阶段3 剧情方向体系）
 * 展示已选定分支的方向分布均衡度评分与占比最高的大类，点击跳转方向统计页。
 */
export default function DirectionBalanceCard({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const { data: stats, isLoading } = useQuery({
    queryKey: ['direction-stats', projectId],
    queryFn: () => projectsApi.directionStats(projectId),
    enabled: !!projectId,
  })

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-4">
          <Spinner />
        </CardContent>
      </Card>
    )
  }
  if (!stats) return null

  const tone = balanceTone(stats.balanceScore)
  const top = stats.byCategory?.[0]

  return (
    <Card
      className="cursor-pointer transition-colors hover:border-gray-700"
      onClick={() => navigate('/direction-stats')}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-violet-400" />
            <span className="text-sm font-medium text-gray-200">方向均衡度</span>
          </div>
          <span className="text-xs text-gray-500">{stats.total} 个已选分支</span>
        </div>

        <div className="flex items-end gap-2">
          <span className={`text-3xl font-bold ${tone.cls}`}>
            {stats.balanceScore ?? '—'}
          </span>
          <span className={`mb-1 text-xs ${tone.cls}`}>{tone.label}</span>
        </div>

        {top ? (
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              占比最高：
              <span className={CATEGORY_TEXT[top.code] ?? 'text-gray-300'}>{top.name}</span>
            </span>
            <span>{top.percent}%</span>
          </div>
        ) : (
          <p className="text-xs text-gray-600">暂无已分类的方向数据</p>
        )}
      </CardContent>
    </Card>
  )
}
