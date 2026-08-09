/**
 * 叙事债务仪表盘（架构升级 Epic4）
 * 聚合伏笔台账/因果链/任务链三表的逾期状态，给出健康度评分与回收建议。
 * 数据接口：GET /api/projects/:id/narrative-debt
 */
import { useQuery } from '@tanstack/react-query'
import { Bookmark, Link2, Flag, AlertTriangle, CheckCircle2, RefreshCw, ListChecks } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, Spinner, EmptyState } from '../components/ui'
import { projectsApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import { cn } from '../lib/utils'

const GRADE_META: Record<string, { label: string; color: string; ring: string }> = {
  excellent: { label: '优秀', color: 'text-emerald-400', ring: 'stroke-emerald-400' },
  good: { label: '良好', color: 'text-gold-300', ring: 'stroke-gold-400' },
  warning: { label: '预警', color: 'text-amber-400', ring: 'stroke-amber-400' },
  critical: { label: '危急', color: 'text-red-400', ring: 'stroke-red-400' },
}

const TYPE_META: Record<string, { label: string; icon: any; badge: string }> = {
  foreshadow: { label: '伏笔', icon: Bookmark, badge: 'bg-indigo-600/20 text-indigo-300' },
  causal_chain: { label: '因果链', icon: Link2, badge: 'bg-purple-600/20 text-purple-300' },
  task_arc: { label: '任务链', icon: Flag, badge: 'bg-emerald-600/20 text-emerald-300' },
}

const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  high: { label: '高', cls: 'bg-red-600/20 text-red-300' },
  normal: { label: '中', cls: 'bg-amber-600/20 text-amber-300' },
  low: { label: '低', cls: 'bg-gray-600/20 text-gray-300' },
}

/** 健康度环形仪表（SVG 圆弧） */
function HealthGauge({ score, grade }: { score: number; grade: string }) {
  const meta = GRADE_META[grade] || GRADE_META.good
  const r = 52
  const circumference = 2 * Math.PI * r
  const filled = (score / 100) * circumference
  return (
    <div className="relative flex h-36 w-36 items-center justify-center">
      <svg className="h-36 w-36 -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="8" className="stroke-gray-800" />
        <circle
          cx="60" cy="60" r={r} fill="none" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          className={cn('transition-all duration-700', meta.ring)}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn('text-3xl font-bold', meta.color)}>{score}</span>
        <span className="text-xs text-gray-500">{meta.label}</span>
      </div>
    </div>
  )
}

/** 单表统计卡片 */
function DebtCard({ title, icon: Icon, total, overdue, extra }: {
  title: string; icon: any; total: number; overdue: number; extra?: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-gold-400" />
            <span className="text-sm font-medium text-gray-300">{title}</span>
          </div>
          {overdue > 0 ? (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              逾期 {overdue}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              无逾期
            </span>
          )}
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-gray-100">{total}</span>
          <span className="text-xs text-gray-500">条在册</span>
        </div>
        {extra && <p className="mt-1 text-xs text-gray-500">{extra}</p>}
      </CardContent>
    </Card>
  )
}

export default function NarrativeDebtPage() {
  const projectId = useCurrentProjectId()

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['narrative-debt', projectId],
    queryFn: () => projectsApi.narrativeDebt(projectId),
    enabled: !!projectId,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">叙事全景</h1>
          <p className="mt-1 text-sm text-gray-500">
            聚合伏笔 / 因果链 / 任务链三表的兑现进度，逾期项按优先级给出回收建议
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/foreshadow" className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:border-gold-600/50 hover:text-gold-300 transition-colors">
            <Bookmark className="h-3 w-3" />伏笔台账
          </a>
          <a href="/tasks" className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:border-gold-600/50 hover:text-gold-300 transition-colors">
            <ListChecks className="h-3 w-3" />征途录
          </a>
          <Button variant="outline" size="sm" onClick={() => refetch()} loading={isFetching}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : !data ? (
        <EmptyState message="暂无叙事债务数据" />
      ) : (
        <>
          {/* 顶部：健康度 + 三表统计 */}
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-6">
                <h3 className="mb-2 text-sm font-medium text-gray-400">债务健康度</h3>
                <HealthGauge score={data.healthScore} grade={data.healthGrade} />
                <p className="mt-2 text-xs text-gray-500">
                  当前进度：第 {data.currentChapterNo || 0} 章
                </p>
              </CardContent>
            </Card>
            <div className="grid gap-4 sm:grid-cols-3">
              <DebtCard
                title="伏笔台账"
                icon={Bookmark}
                total={data.foreshadowSummary.total}
                overdue={data.foreshadowSummary.overdueCount}
                extra={`未回收 ${data.foreshadowSummary.unresolvedCount} 条`}
              />
              <DebtCard
                title="因果链"
                icon={Link2}
                total={data.causalChainSummary.total}
                overdue={data.causalChainSummary.overdueCount}
                extra={`未兑现 ${data.causalChainSummary.openCount} 条 · 债务型 ${data.causalChainSummary.debtTypeCount} 条`}
              />
              <DebtCard
                title="任务链"
                icon={Flag}
                total={data.taskArcSummary.total}
                overdue={data.taskArcSummary.overdueCount}
                extra={`进行中 ${data.taskArcSummary.openCount} 条`}
              />
            </div>
          </div>

          {/* 回收建议列表 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">回收建议（按逾期程度与优先级排序）</CardTitle>
            </CardHeader>
            <CardContent>
              {data.recommendations?.length ? (
                <div className="space-y-2">
                  {data.recommendations.map((rec: any) => {
                    const tMeta = TYPE_META[rec.type] || TYPE_META.foreshadow
                    const pMeta = PRIORITY_META[rec.priority] || PRIORITY_META.normal
                    const Icon = tMeta.icon
                    return (
                      <div
                        key={`${rec.type}-${rec.id}`}
                        className={cn(
                          'flex items-center gap-3 rounded-lg border px-3 py-2.5',
                          rec.overdueChapters > 0
                            ? 'border-red-500/30 bg-red-500/[0.04]'
                            : 'border-gray-800 bg-gray-800/40'
                        )}
                      >
                        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', tMeta.badge)}>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-gray-200">{rec.title}</span>
                            <Badge className={tMeta.badge}>{tMeta.label}</Badge>
                            <Badge className={pMeta.cls}>优先级{pMeta.label}</Badge>
                          </div>
                          <p className={cn('mt-0.5 text-xs', rec.overdueChapters > 0 ? 'text-red-400' : 'text-gray-500')}>
                            {rec.reason}
                          </p>
                        </div>
                        {rec.overdueChapters > 0 && (
                          <span className="shrink-0 text-xs font-medium text-red-400">
                            逾期 {rec.overdueChapters} 章
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <EmptyState message="暂无待回收的叙事债务，保持这个节奏！" />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
