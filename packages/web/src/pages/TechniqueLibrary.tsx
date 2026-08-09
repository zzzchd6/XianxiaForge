/**
 * 叙事技法库页面
 * 浏览/筛选叙事技法原子（内容规划/呈现技法/节奏控制/人物逻辑），
 * 查看详情（生成指导/审计维度/修复模板/核心规则/示例），并切换启用状态（active ↔ deprecated）。
 */
import { useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import {
  Card, CardContent, Badge, Button, Spinner, EmptyState, Dialog, useToast,
} from '../components/ui'
import { techniqueApi } from '../lib/api'
import { cn } from '../lib/utils'

interface TechniqueAtom {
  id: number
  techniqueId: string
  name: string
  category: string
  level: string
  source: string
  description: string | null
  coreRules: any[]
  generationGuidance: string | null
  auditPromptSegment: string | null
  autoFixTemplate: string | null
  examples: any[]
  applicableGenres: string[]
  sortOrder: number
  status: string
  createdAt: string
  updatedAt: string
}

/** 分类标签映射 */
const CATEGORY_LABELS: Record<string, string> = {
  content_planning: '内容规划',
  presentation: '呈现技法',
  rhythm: '节奏控制',
  character_logic: '人物逻辑',
}

/** 层级标签映射 */
const LEVEL_LABELS: Record<string, string> = {
  principle: '核心原则',
  pattern: '参考模式',
  example: '示例',
}

/** 分类筛选（pill 按钮） */
const CATEGORY_FILTERS = [
  { value: '', label: '全部' },
  { value: 'content_planning', label: '内容规划' },
  { value: 'presentation', label: '呈现技法' },
  { value: 'rhythm', label: '节奏控制' },
  { value: 'character_logic', label: '人物逻辑' },
]

/** 层级筛选（更小的 pill） */
const LEVEL_FILTERS = [
  { value: '', label: '全部' },
  { value: 'principle', label: '核心原则' },
  { value: 'pattern', label: '参考模式' },
]

export default function TechniqueLibrary() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [category, setCategory] = useState('')
  const [level, setLevel] = useState('')
  const [selected, setSelected] = useState<TechniqueAtom | null>(null)

  const { data: techniques, isLoading } = useQuery({
    queryKey: ['technique-atoms', category, level],
    queryFn: () =>
      techniqueApi.list({
        category: category || undefined,
        level: level || undefined,
      }),
  })

  const updateMut = useMutation({
    mutationFn: ({ techniqueId, data }: { techniqueId: string; data: any }) =>
      techniqueApi.update(techniqueId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['technique-atoms'] })
      toast('已更新', 'success')
    },
    onError: (e: any) => toast(e.message || '更新失败', 'error'),
  })

  const list = (techniques || []) as TechniqueAtom[]

  const toggleStatus = (t: TechniqueAtom) => {
    const next = t.status === 'active' ? 'deprecated' : 'active'
    updateMut.mutate(
      { techniqueId: t.techniqueId, data: { status: next } },
      {
        onSuccess: () => setSelected((prev) => (prev ? { ...prev, status: next } : prev)),
      }
    )
  }

  if (isLoading) {
    return <div className="flex justify-center py-20"><Spinner /></div>
  }

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div>
        <h1 className="title-serif text-xl font-bold text-gray-100">叙事技法库</h1>
        <p className="mt-1 text-sm text-gray-400">
          浏览叙事技法原子，查看生成指导、审计维度与修复模板，管理启用状态
        </p>
      </div>

      {/* 筛选栏 */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f.value || 'all-category'}
              type="button"
              onClick={() => setCategory(f.value)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                category === f.value
                  ? 'border-gold-500/60 bg-gold-500/10 text-gold-300'
                  : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-200'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {LEVEL_FILTERS.map((f) => (
            <button
              key={f.value || 'all-level'}
              type="button"
              onClick={() => setLevel(f.value)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                level === f.value
                  ? 'border-gold-500/60 bg-gold-500/10 text-gold-300'
                  : 'border-gray-700/70 text-gray-500 hover:border-gray-600 hover:text-gray-300'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 空状态 */}
      {list.length === 0 && (
        <EmptyState
          message="暂无符合条件的技法"
          icon={<BookOpen className="h-10 w-10 text-gray-600" />}
        />
      )}

      {/* 技法卡片网格 */}
      {list.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {list.map((t) => (
            <Card
              key={t.id}
              className="cursor-pointer transition-colors hover:border-gold-600/50"
              onClick={() => setSelected(t)}
            >
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-100">{t.name}</span>
                    <Badge variant="gold" className="text-xs">{t.techniqueId}</Badge>
                    <Badge variant="default" className="text-xs">
                      {CATEGORY_LABELS[t.category] || t.category}
                    </Badge>
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-gray-500">
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        t.status === 'active' ? 'bg-emerald-400' : 'bg-gray-600'
                      )}
                    />
                    {t.status === 'active' ? '启用' : '弃用'}
                  </span>
                </div>
                {t.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-gray-400">{t.description}</p>
                )}
                {t.generationGuidance && (
                  <p className="mt-2 line-clamp-2 text-xs italic text-gold-300">
                    {t.generationGuidance}
                  </p>
                )}
                <div className="mt-2 text-xs text-gray-500">
                  {LEVEL_LABELS[t.level] || t.level}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 详情弹窗 */}
      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
        className="max-w-2xl"
      >
        {selected && (
          <div className="space-y-4">
            {/* 元信息徽标 */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="gold" className="text-xs">{selected.techniqueId}</Badge>
              <Badge variant="default" className="text-xs">
                {CATEGORY_LABELS[selected.category] || selected.category}
              </Badge>
              <Badge variant="default" className="text-xs">
                {LEVEL_LABELS[selected.level] || selected.level}
              </Badge>
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    selected.status === 'active' ? 'bg-emerald-400' : 'bg-gray-600'
                  )}
                />
                {selected.status === 'active' ? '启用' : '弃用'}
              </span>
            </div>

            {/* 描述 */}
            {selected.description && (
              <p className="text-sm leading-relaxed text-gray-300">{selected.description}</p>
            )}

            {/* 生成指导 */}
            <DetailSection label="生成指导">
              {selected.generationGuidance ? (
                <p className="whitespace-pre-wrap text-sm italic leading-relaxed text-gold-300">
                  {selected.generationGuidance}
                </p>
              ) : (
                <p className="text-sm text-gray-600">暂无</p>
              )}
            </DetailSection>

            {/* 审计维度 */}
            <DetailSection label="审计维度">
              {selected.auditPromptSegment ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                  {selected.auditPromptSegment}
                </p>
              ) : (
                <p className="text-sm text-gray-600">暂无</p>
              )}
            </DetailSection>

            {/* 修复模板 */}
            <DetailSection label="修复模板">
              {selected.autoFixTemplate ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                  {selected.autoFixTemplate}
                </p>
              ) : (
                <p className="text-sm text-gray-600">不支持</p>
              )}
            </DetailSection>

            {/* 核心规则 */}
            <DetailSection label="核心规则">
              {selected.coreRules && selected.coreRules.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-gray-700/60">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-800/50 text-gray-500">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium">指标</th>
                        <th className="px-3 py-1.5 text-left font-medium">运算符</th>
                        <th className="px-3 py-1.5 text-left font-medium">阈值</th>
                        <th className="px-3 py-1.5 text-left font-medium">严重度</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.coreRules.map((r, i) => (
                        <tr key={i} className="border-t border-gray-700/50 text-gray-300">
                          <td className="px-3 py-1.5">{r.metric}</td>
                          <td className="px-3 py-1.5">{r.operator}</td>
                          <td className="px-3 py-1.5">{String(r.threshold)}</td>
                          <td className="px-3 py-1.5">{r.severity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-600">暂无</p>
              )}
            </DetailSection>

            {/* 示例 */}
            <DetailSection label="示例">
              {selected.examples && selected.examples.length > 0 ? (
                <div className="space-y-2">
                  {selected.examples.map((ex, i) => {
                    const isGood = (ex?.type || ex?.kind) === 'good'
                    const text =
                      ex?.text || ex?.content || ex?.example ||
                      (typeof ex === 'string' ? ex : JSON.stringify(ex))
                    return (
                      <div
                        key={i}
                        className={cn(
                          'rounded-lg border p-2.5 text-xs',
                          isGood
                            ? 'border-emerald-500/40 bg-emerald-500/5'
                            : 'border-red-500/40 bg-red-500/5'
                        )}
                      >
                        <span
                          className={cn(
                            'font-medium',
                            isGood ? 'text-emerald-300' : 'text-red-300'
                          )}
                        >
                          {isGood ? '正例' : '反例'}
                        </span>
                        <p className="mt-1 whitespace-pre-wrap leading-relaxed text-gray-300">
                          {text}
                        </p>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-600">暂无</p>
              )}
            </DetailSection>

            {/* 状态切换 */}
            <div className="flex justify-end border-t border-gray-700/60 pt-3">
              <Button
                variant={selected.status === 'active' ? 'destructive' : 'default'}
                size="sm"
                onClick={() => toggleStatus(selected)}
                disabled={updateMut.isPending}
              >
                {selected.status === 'active' ? '标记为弃用' : '标记为启用'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}

/** 详情弹窗中的带标签小节 */
function DetailSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</div>
      {children}
    </div>
  )
}
