import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Clock, XCircle, ListTodo } from 'lucide-react'
import {
  Card, CardContent, CardHeader, CardTitle, Badge, EmptyState, Spinner,
} from '../components/ui'
import { healthApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'

/** tier → 徽章文案/配色 */
const TIER_META: Record<string, { label: string; variant: 'destructive' | 'warning' | 'default' }> = {
  t1: { label: 'T1 战略级', variant: 'destructive' },
  t2: { label: 'T2 战役级', variant: 'warning' },
  t3: { label: 'T3 普通', variant: 'default' },
}

/** 格式化失败任务时间 */
function formatTime(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 待办中心（全局聚合面板）
 * 汇总当前项目需关注事项：超期伏笔 / 高优先级待处理 / 生成失败任务。纯展示。
 */
export default function TodoCenter() {
  const projectId = useCurrentProjectId()

  const { data, isLoading } = useQuery({
    queryKey: ['todo-center', projectId],
    queryFn: () => healthApi.todo(projectId),
    enabled: !!projectId,
  })

  const overdue = data?.overdueForeshadows ?? []
  const pending = data?.highPriorityPending ?? []
  const failed = data?.failedTasks ?? []
  const totalCount = data?.totalCount ?? 0

  return (
    <div className="space-y-6">
      {/* 标题 + 总待办数 */}
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-100">待办中心</h1>
          <p className="text-sm text-gray-500">汇总当前项目需关注的事项</p>
        </div>
        {data && (
          <Badge variant={totalCount > 0 ? 'destructive' : 'success'} className="ml-1">
            <ListTodo className="mr-1 h-3.5 w-3.5" />
            总待办 {totalCount}
          </Badge>
        )}
      </div>

      {isLoading && (
        <div className="flex justify-center py-12"><Spinner /></div>
      )}

      {!isLoading && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* 超期伏笔（红色主题） */}
          <Card className="border-red-500/30">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-red-300">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                超期伏笔
              </CardTitle>
              <Badge variant="destructive">{overdue.length}</Badge>
            </CardHeader>
            <CardContent>
              {overdue.length === 0 ? (
                <EmptyState message="暂无超期伏笔" icon={<AlertTriangle className="h-8 w-8 text-gray-600" />} />
              ) : (
                <ul className="space-y-2">
                  {overdue.map((f) => {
                    const tier = TIER_META[f.tier] ?? TIER_META.t3
                    return (
                      <li
                        key={f.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-red-500/15 bg-red-500/[0.04] px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm text-gray-200">{f.title}</div>
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-red-400/80">
                            <Clock className="h-3 w-3" />
                            已敞开 {f.chaptersOpen} 章
                          </div>
                        </div>
                        <Badge variant={tier.variant} className="shrink-0">{tier.label}</Badge>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* 高优先级待处理（琥珀色主题） */}
          <Card className="border-amber-500/30">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-amber-300">
                <Clock className="h-4 w-4 text-amber-400" />
                高优先级待处理
              </CardTitle>
              <Badge variant="warning">{pending.length}</Badge>
            </CardHeader>
            <CardContent>
              {pending.length === 0 ? (
                <EmptyState message="暂无高优先级待处理项" icon={<Clock className="h-8 w-8 text-gray-600" />} />
              ) : (
                <ul className="space-y-2">
                  {pending.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-3 py-2"
                    >
                      <span className="truncate text-sm text-gray-200">{p.title}</span>
                      <Badge variant="warning" className="shrink-0">高优先级</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* 生成失败（灰色主题） */}
          <Card className="border-gray-600/40">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-gray-300">
                <XCircle className="h-4 w-4 text-gray-400" />
                生成失败
              </CardTitle>
              <Badge variant="default">{failed.length}</Badge>
            </CardHeader>
            <CardContent>
              {failed.length === 0 ? (
                <EmptyState message="暂无失败任务" icon={<XCircle className="h-8 w-8 text-gray-600" />} />
              ) : (
                <ul className="space-y-2">
                  {failed.map((t) => (
                    <li
                      key={t.id}
                      className="rounded-lg border border-gray-600/30 bg-gray-500/[0.04] px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-gray-200">
                          章节计划 #{t.chapterPlanId ?? '—'}
                        </span>
                        <span className="shrink-0 text-xs text-gray-500">{formatTime(t.createdAt)}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-red-400/80" title={t.error ?? ''}>
                        {t.error || '（无错误信息）'}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
