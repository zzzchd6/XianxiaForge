/**
 * 双引擎共享展示组件（PRD v1.3）
 * - QualityReportView：质量体检四维评分展示（§7.7 / §8.7）
 * - EmotionCurveView：情绪曲线四项指标（§8.5）
 * - CrossValidationView：组合工作流交叉校验报告（§9.3）
 */
import { useState, type ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface QualityDimensionView {
  key: string
  name: string
  weight: number
  score: number
  verdict: 'pass' | 'gray' | 'fail'
  details: string[]
}

export interface QualityReportViewData {
  total: number
  passed: boolean
  dimensions: QualityDimensionView[]
}

const verdictMeta = {
  pass: { icon: CheckCircle2, color: 'text-emerald-400', bar: 'bg-emerald-500', label: '合格' },
  gray: { icon: AlertTriangle, color: 'text-amber-400', bar: 'bg-amber-500', label: '灰区' },
  fail: { icon: XCircle, color: 'text-red-400', bar: 'bg-red-500', label: '不合格' },
} as const

/** 综合分徽标 */
export function TotalScore({ total, passed }: { total: number; passed: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-full border-2 text-lg font-bold',
          passed ? 'border-emerald-500/60 text-emerald-300' : 'border-red-500/60 text-red-300'
        )}
      >
        {Math.round(total)}
      </div>
      <div>
        <div className={cn('text-sm font-semibold', passed ? 'text-emerald-300' : 'text-red-300')}>
          {passed ? '体检通过' : '体检未通过'}
        </div>
        <div className="text-xs text-gray-500">及格线 70 分</div>
      </div>
    </div>
  )
}

/** 质量评分四维展示（可折叠明细） */
export function QualityReportView({ report }: { report: QualityReportViewData }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <TotalScore total={report.total} passed={report.passed} />
      <div className="space-y-2">
        {report.dimensions.map((d) => {
          const meta = verdictMeta[d.verdict] || verdictMeta.gray
          const Icon = meta.icon
          const open = expanded === d.key
          return (
            <div key={d.key} className="rounded-lg border border-gray-700/70 bg-gray-900/50">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : d.key)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left"
              >
                <Icon className={cn('h-4 w-4 shrink-0', meta.color)} />
                <span className="w-28 shrink-0 text-sm text-gray-200">{d.name}</span>
                <span className="w-14 shrink-0 text-xs text-gray-500">权重{Math.round(d.weight * 100)}%</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
                  <div className={cn('h-full rounded-full', meta.bar)} style={{ width: `${Math.min(100, d.score)}%` }} />
                </div>
                <span className={cn('w-10 shrink-0 text-right text-sm font-semibold', meta.color)}>{Math.round(d.score)}</span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-gray-500 transition-transform', open && 'rotate-180')} />
              </button>
              {open && d.details.length > 0 && (
                <ul className="space-y-1 border-t border-gray-800 px-3 py-2">
                  {d.details.map((t, i) => (
                    <li key={i} className="text-xs leading-relaxed text-gray-400">· {t}</li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 情绪曲线四项指标（§8.5：期待峰值/压抑深度/情绪落差/代价重量） */
export function EmotionCurveView({ curve }: {
  curve: { expectation_peak: number; suppression_depth: number; drop_amplitude: number; cost_weight: number }
}) {
  const items = [
    { key: 'expectation_peak', label: '期待峰值', desc: 'Phase1 结束时读者有多期待', value: curve.expectation_peak, color: 'bg-gold-500' },
    { key: 'suppression_depth', label: '压抑深度', desc: 'Phase2 结束时的憋屈感', value: curve.suppression_depth, color: 'bg-indigo-500' },
    { key: 'drop_amplitude', label: '情绪落差', desc: '峰值+压抑深度，越大越爽', value: curve.drop_amplitude, color: 'bg-seal-500' },
    { key: 'cost_weight', label: '代价重量', desc: 'Phase3 落地的痛感', value: curve.cost_weight, color: 'bg-red-500' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((it) => (
        <div key={it.key} className="rounded-lg border border-gray-700/70 bg-gray-900/50 p-3">
          <div className="text-sm font-medium text-gray-200">{it.label}</div>
          <div className="mt-1 text-2xl font-bold text-gold-300">{Math.round(it.value)}</div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-800">
            <div className={cn('h-full rounded-full', it.color)} style={{ width: `${Math.min(100, it.value)}%` }} />
          </div>
          <div className="mt-1.5 text-[11px] leading-snug text-gray-500">{it.desc}</div>
        </div>
      ))}
    </div>
  )
}

/** 交叉校验报告（§9.3 五维） */
export function CrossValidationView({ report }: {
  report: { total: number; passed: boolean; min_score: number; dimensions: QualityDimensionView[]; retry_count: number }
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className={cn('flex items-center gap-2 text-sm font-semibold', report.passed ? 'text-emerald-300' : 'text-red-300')}>
          {report.passed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          交叉校验{report.passed ? '通过' : '未通过'}（{Math.round(report.total)} / 及格线 {report.min_score}）
        </div>
        {report.retry_count > 0 && <span className="text-xs text-gray-500">回炉 {report.retry_count} 次</span>}
      </div>
      <QualityReportView report={{ total: report.total, passed: report.passed, dimensions: report.dimensions }} />
    </div>
  )
}

/** 建议列表 */
export function SuggestionList({ suggestions }: { suggestions: string[] }) {
  if (!suggestions?.length) return null
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3">
      <div className="mb-1.5 text-xs font-semibold tracking-wide text-amber-300">优化建议</div>
      <ul className="space-y-1">
        {suggestions.map((s, i) => (
          <li key={i} className="text-xs leading-relaxed text-gray-300">· {s}</li>
        ))}
      </ul>
    </div>
  )
}

/** 折叠面板 */
export function Collapse({ title, badge, defaultOpen = false, children }: {
  title: string
  badge?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="overflow-hidden rounded-lg border border-gray-700/70 bg-gray-900/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-gray-500 transition-transform', !open && '-rotate-90')} />
        <span className="text-sm font-medium text-gray-200">{title}</span>
        {badge}
      </button>
      {open && <div className="border-t border-gray-800 p-3">{children}</div>}
    </div>
  )
}
