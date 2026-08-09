import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Flame } from 'lucide-react'
import { Card, CardContent, Spinner } from './ui'
import { projectsApi } from '../lib/api'
import { cn } from '../lib/utils'

// 字数 → 热力等级（0-4）
function heatLevel(words: number, max: number): number {
  if (!words || words <= 0) return 0
  if (max <= 0) return 1
  const ratio = words / max
  if (ratio > 0.75) return 4
  if (ratio > 0.5) return 3
  if (ratio > 0.25) return 2
  return 1
}

const LEVEL_CLASS = [
  'bg-gray-800',
  'bg-indigo-900',
  'bg-indigo-700',
  'bg-indigo-500',
  'bg-indigo-300',
]

const WEEKDAY_LABELS = ['', '一', '', '三', '', '五', '']

interface Props {
  projectId: string
  days?: number
}

/** 创作热力图（模块14）：类 GitHub 贡献图，按日展示生成字数，悬停查看当日详情 */
export default function CreationHeatmap({ projectId, days = 365 }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['creation-stats', projectId, days],
    queryFn: () => projectsApi.creationStats(projectId, days),
    enabled: !!projectId,
  })

  const daily: any[] = data?.daily || []
  const summary = data?.summary || { totalWords: 0, totalChapters: 0, currentStreak: 0, longestStreak: 0, activeDays: 0 }

  // 构建按周分组的日期网格（列=周，行=星期）
  const { weeks, maxWords } = useMemo(() => {
    const byDate = new Map<string, any>(daily.map((d) => [d.date, d]))
    const max = daily.reduce((m, d) => Math.max(m, d.words || 0), 0)

    // 从今天往前推 days 天，对齐到周一开头
    const cells: { date: string; words: number; chapters: number }[] = []
    const today = new Date()
    const start = new Date(today)
    start.setDate(start.getDate() - (days - 1))
    // 回退到该周的周一
    const startDow = (start.getDay() + 6) % 7 // 周一=0
    start.setDate(start.getDate() - startDow)

    const cursor = new Date(start)
    while (cursor <= today) {
      const ds = cursor.toISOString().slice(0, 10)
      const rec = byDate.get(ds)
      cells.push({ date: ds, words: rec?.words || 0, chapters: rec?.chapters || 0 })
      cursor.setDate(cursor.getDate() + 1)
    }

    // 每 7 天一周
    const wks: typeof cells[] = []
    for (let i = 0; i < cells.length; i += 7) {
      wks.push(cells.slice(i, i + 7))
    }
    return { weeks: wks, maxWords: max }
  }, [daily, days])

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-200">
            <Flame className="h-5 w-5 text-orange-400" />
            创作热力图
          </h2>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>累计 <b className="text-indigo-300">{summary.totalWords.toLocaleString()}</b> 字</span>
            <span>共 <b className="text-indigo-300">{summary.totalChapters}</b> 章</span>
            <span>连续 <b className="text-orange-300">{summary.currentStreak}</b> 天</span>
            <span>最长 <b className="text-gray-300">{summary.longestStreak}</b> 天</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {/* 星期标签列 */}
            <div className="flex flex-col gap-1 pr-1 text-[10px] text-gray-600">
              {WEEKDAY_LABELS.map((l, i) => (
                <span key={i} className="flex h-3 items-center">{l}</span>
              ))}
            </div>
            {/* 周列 */}
            <div className="flex gap-1">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-1">
                  {week.map((cell) => {
                    const level = heatLevel(cell.words, maxWords)
                    return (
                      <div
                        key={cell.date}
                        className={cn('h-3 w-3 rounded-sm', LEVEL_CLASS[level])}
                        title={`${cell.date}：${cell.words.toLocaleString()} 字 / ${cell.chapters} 章`}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 图例 */}
        <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-gray-600">
          <span>少</span>
          {LEVEL_CLASS.map((cls, i) => (
            <span key={i} className={cn('h-3 w-3 rounded-sm', cls)} />
          ))}
          <span>多</span>
        </div>
      </CardContent>
    </Card>
  )
}
