import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Package, Lock, Dice5, Eye } from 'lucide-react'
import { Button, Badge, Spinner, useToast } from '../components/ui'
import { treasureApi } from '../lib/api'

/* ------------------------------------------------------------------ */
/* TreasureHuntTab (淘宝)                                              */
/* 逛大集 → 逐件「探查」揭示详情 → 秘宝「入库」进锻造列表              */
/* 全面武器化：10 件全部为武器（秘宝），纯规则生成、零 token           */
/* 当前这批物品暂存，点「再逛一次」才清空替换                          */
/* ------------------------------------------------------------------ */

const TIER_LABELS: Record<string, { text: string; cls: string }> = {
  spirit: { text: '有灵', cls: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' },
  legacy: { text: '传承', cls: 'border-blue-500/30 bg-blue-500/15 text-blue-300' },
  relic: { text: '遗珍', cls: 'border-amber-500/30 bg-amber-500/15 text-amber-300' },
}

function TreasureHuntTab({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [results, setResults] = useState<any[]>([])
  const [probed, setProbed] = useState<Set<number>>(new Set())       // 已探查
  const [converted, setConverted] = useState<Set<number>>(new Set()) // 已入库
  const [location, setLocation] = useState('')

  const huntMut = useMutation({
    mutationFn: () => treasureApi.hunt(projectId, { count: 10 }),
    onSuccess: (res: any) => {
      const data = res?.data || res || {}
      setResults(data.items || [])
      setLocation(data.location || '')
      setProbed(new Set())       // 再逛一次：清空上一批的探查/入库状态
      setConverted(new Set())
    },
    onError: (e: any) => toast(e.message || '逛街失败', 'error'),
  })

  // 入库：秘宝→正式武器（刷新「锻造」列表）
  const convertMut = useMutation({
    mutationFn: (id: number) => treasureApi.convert(projectId, id),
    onSuccess: (res: any, id: number) => {
      const name = res?.data?.name || res?.name || ''
      setConverted((s) => new Set(s).add(id))
      queryClient.invalidateQueries({ queryKey: ['custom-weapons', projectId] })
      toast(name ? `「${name}」已入库，去【锻造】查看` : '已入库，去【锻造】查看', 'success')
    },
    onError: (e: any) => toast(e.message || '入库失败', 'error'),
  })

  const probe = (id: number) => setProbed((s) => new Set(s).add(id))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={() => huntMut.mutate()} disabled={huntMut.isPending}>
          {huntMut.isPending ? <Spinner className="h-4 w-4" /> : <Dice5 className="h-4 w-4" />}
          {results.length ? '再逛一次' : '逛一次大集（10件）'}
        </Button>
        {location && <span className="text-xs text-gray-500">这回逛的是：{location}</span>}
      </div>

      {results.length > 0 && (
        <div className="space-y-1.5" aria-live="polite">
          {results.map((item: any, idx: number) => {
            const id = Number(item.id)
            const isProbed = probed.has(id)
            const isConverted = converted.has(id)
            const tier = TIER_LABELS[item.secretTier]

            return (
              <div key={item.id ?? idx} className="rounded-lg border border-gray-800/60 bg-gray-900/30 px-3 py-2">
                {/* 名称行 + 探查按钮 */}
                <div className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-gray-600" />
                  <span className="text-sm font-medium text-gray-200">{item.displayName || item.name}</span>
                  {!isProbed && <span className="text-xs text-gray-500">？？？未探明</span>}
                  {!isProbed && (
                    <Button size="sm" variant="ghost" onClick={() => probe(id)} className="ml-auto">
                      <Eye className="h-3.5 w-3.5" /> 探查
                    </Button>
                  )}
                </div>

                {/* 探查详情：品阶 + 外观 + 入库 */}
                {isProbed && (
                  <div className="ml-6 mt-1.5 space-y-1.5">
                    {tier && <Badge className={tier.cls}>秘宝·{tier.text}</Badge>}
                    <p className="text-xs leading-relaxed text-gray-400">{item.appearance}</p>
                    {isConverted ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400/80">
                        <Package className="h-3 w-3" /> 已入库
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => convertMut.mutate(id)}
                        disabled={convertMut.isPending}
                      >
                        {convertMut.isPending && convertMut.variables === id ? <Spinner className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />}
                        入库
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {results.length === 0 && !huntMut.isPending && (
        <p className="py-8 text-center text-sm text-gray-500">
          点「逛一次大集」去市集淘货，十件兵器秘宝，慧眼识珠者得之。
        </p>
      )}
    </div>
  )
}

export default TreasureHuntTab
