import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Activity, AlertTriangle, CheckCircle, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Spinner, useToast } from '../components/ui'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import { healthApi } from '../lib/api'

interface HealthIssue {
  dimension: string
  level: 'high' | 'medium' | 'low'
  message: string
}

interface HealthDimension {
  name: string
  score: number
  issues: HealthIssue[]
}

interface HealthReport {
  projectId: number
  volumeNo: number | null
  generatedAt: string
  dimensions: HealthDimension[]
  overallScore: number
  summary: { high: number; medium: number; low: number }
}

async function fetchHealth(projectId: number): Promise<HealthReport> {
  const res = await fetch(`/api/projects/${projectId}/health`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || '体检失败')
  return json.data
}

const levelConfig = {
  high: { label: '高', variant: 'destructive' as const, icon: AlertTriangle, color: 'text-red-400' },
  medium: { label: '中', variant: 'warning' as const, icon: Info, color: 'text-amber-400' },
  low: { label: '低', variant: 'default' as const, icon: CheckCircle, color: 'text-gray-400' },
}

function ScoreTrendChart({ points }: { points: { chapterNo: number; title: string; score: number }[] }) {
  if (!points.length) return null

  const width = 600
  const height = 120
  const padding = { top: 10, right: 20, bottom: 25, left: 35 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const maxScore = 100
  const minScore = Math.max(0, Math.min(...points.map(p => p.score)) - 10)
  const range = maxScore - minScore || 1

  const x = (i: number) => padding.left + (i / Math.max(points.length - 1, 1)) * innerW
  const y = (score: number) => padding.top + (1 - (score - minScore) / range) * innerH

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.score)}`).join(' ')

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[500px]" role="img" aria-label="健康度雷达图">
        {/* Y轴参考线 */}
        {[60, 70, 80, 90].filter(v => v >= minScore).map(v => (
          <g key={v}>
            <line x1={padding.left} y1={y(v)} x2={width - padding.right} y2={y(v)} stroke="currentColor" className="text-gray-800" strokeWidth="0.5" />
            <text x={padding.left - 5} y={y(v) + 3} textAnchor="end" className="fill-gray-600 text-[8px]">{v}</text>
          </g>
        ))}
        {/* 折线 */}
        <path d={pathD} fill="none" stroke="currentColor" className="text-indigo-400" strokeWidth="1.5" strokeLinejoin="round" />
        {/* 数据点 */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.score)} r="2.5" className={p.score >= 70 ? 'fill-emerald-400' : p.score >= 50 ? 'fill-amber-400' : 'fill-red-400'} />
            {points.length <= 20 && (
              <text x={x(i)} y={height - 5} textAnchor="middle" className="fill-gray-600 text-[7px]">{p.chapterNo}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

export default function HealthCheck() {
  const { toast } = useToast()
  const projectId = useCurrentProjectId()

  const { data: report, isLoading, refetch } = useQuery({
    queryKey: ['health', projectId],
    queryFn: () => fetchHealth(Number(projectId)),
    enabled: !!projectId,
  })

  const { data: scoreTrend } = useQuery({
    queryKey: ['score-trend', projectId],
    queryFn: () => healthApi.scoreTrend(projectId),
    enabled: !!projectId,
  })

  const scoreColor = (score: number) =>
    score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">叙事体检报告</h1>
          <p className="text-sm text-gray-500">9维度健康度扫描（纯规则零LLM）</p>
        </div>
        <Button onClick={() => refetch()} disabled={isLoading}>
          <Activity className="mr-1.5 h-4 w-4" />
          {isLoading ? '扫描中...' : '重新体检'}
        </Button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12"><Spinner /></div>
      )}

      {report && !isLoading && (
        <>
          {/* 总览 */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <div className={`text-3xl font-bold ${scoreColor(report.overallScore)}`}>
                    {report.overallScore}
                  </div>
                  <div className="text-xs text-gray-500">综合健康度</div>
                </div>
                <div className="flex gap-4">
                  {report.summary.high > 0 && (
                    <Badge variant="destructive">高风险 {report.summary.high}</Badge>
                  )}
                  {report.summary.medium > 0 && (
                    <Badge variant="warning">中风险 {report.summary.medium}</Badge>
                  )}
                  {report.summary.low > 0 && (
                    <Badge variant="default">低风险 {report.summary.low}</Badge>
                  )}
                  {report.summary.high === 0 && report.summary.medium === 0 && report.summary.low === 0 && (
                    <Badge variant="success">全部健康</Badge>
                  )}
                </div>
                <div className="ml-auto text-xs text-gray-600">
                  {new Date(report.generatedAt).toLocaleString('zh-CN')}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 故事心电图 */}
          {scoreTrend && scoreTrend.points.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">故事心电图 · 文风质量趋势</CardTitle>
              </CardHeader>
              <CardContent>
                <ScoreTrendChart points={scoreTrend.points} />
                <p className="mt-2 text-[11px] text-gray-600">
                  基于各章文风审计得分（满分100），共 {scoreTrend.points.length} 章有审计记录。
                </p>
              </CardContent>
            </Card>
          )}

          {/* 各维度 */}
          <div className="grid gap-4 md:grid-cols-2">
            {report.dimensions.map((dim) => (
              <Card key={dim.name}>
                <CardContent className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-200">{dim.name}</span>
                    <span className={`text-sm font-bold ${scoreColor(dim.score)}`}>{dim.score}</span>
                  </div>
                  {/* 进度条 */}
                  <div className="mb-3 h-1.5 w-full rounded-full bg-gray-700">
                    <div
                      className={`h-1.5 rounded-full ${dim.score >= 80 ? 'bg-emerald-500' : dim.score >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${dim.score}%` }}
                    />
                  </div>
                  {/* 问题列表 */}
                  {dim.issues.length === 0 ? (
                    <p className="text-xs text-gray-500">无异常</p>
                  ) : (
                    <div className="space-y-1.5">
                      {dim.issues.map((issue, idx) => {
                        const cfg = levelConfig[issue.level]
                        return (
                          <div key={idx} className="flex items-start gap-1.5 text-xs">
                            <cfg.icon className={`mt-0.5 h-3 w-3 shrink-0 ${cfg.color}`} />
                            <span className="text-gray-400">{issue.message}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
