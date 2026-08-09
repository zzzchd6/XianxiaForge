import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bookmark, AlertTriangle } from 'lucide-react'
import { Card, CardContent, Spinner } from './ui'
import { foreshadowApi } from '../lib/api'

/**
 * 伏笔回收进度卡片（模块2）
 * 展示本项目伏笔的埋设/回收进度条与超期提醒，点击跳转伏笔台账
 */
export default function ForeshadowProgress({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const { data: threads, isLoading } = useQuery({
    queryKey: ['foreshadow-progress', projectId],
    queryFn: () => foreshadowApi.list(projectId),
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

  const list: any[] = threads || []
  if (!list.length) return null

  const total = list.length
  const pending = list.filter((t) => t.status === 'pending').length
  const planted = list.filter((t) => t.status === 'planted').length
  const resolved = list.filter((t) => t.status === 'resolved').length
  const overdue = list.filter((t) => t.overdue).length
  const resolvedPct = Math.round((resolved / total) * 100)

  return (
    <Card
      className="cursor-pointer transition-colors hover:border-gray-700"
      onClick={() => navigate('/foreshadow')}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-cyan-400" />
            <span className="text-sm font-medium text-gray-200">伏笔回收进度</span>
          </div>
          {overdue > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-red-300">
              <AlertTriangle className="h-3 w-3" /> {overdue} 条超期
            </span>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>已回收 {resolved} / {total}</span>
            <span>{resolvedPct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${resolvedPct}%` }}
            />
          </div>
        </div>

        <div className="flex gap-4 text-xs text-gray-500">
          <span>待埋入 <span className="text-amber-300">{pending}</span></span>
          <span>已埋设 <span className="text-indigo-300">{planted}</span></span>
          <span>已回收 <span className="text-emerald-300">{resolved}</span></span>
        </div>
      </CardContent>
    </Card>
  )
}
