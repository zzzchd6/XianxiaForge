/**
 * 分支弧面板（12-SRS 动态叙事引擎）
 * 选择的血肉层：展示当前活跃分支弧的进度/前提，提供手动汇合、延长、废弃、
 * 新元素提拔、汇合重写日志与回滚等作者控制。
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { GitMerge, PlusCircle, Ban, Award, Undo2, ChevronDown, ChevronRight } from 'lucide-react'
import { Button, Badge, Spinner, useToast } from '../components/ui'
import { narrativeApi } from '../lib/api'

const ARC_TYPE_LABEL: Record<string, string> = {
  approach: '手法分歧',
  detour: '绕路探索',
  consequence: '奇遇后果',
  divergence: '命运分叉',
}
const KIND_LABEL: Record<string, string> = {
  foreshadows: '伏笔',
  items: '任务链',
  characters: '人物',
  locations: '地点',
}

export default function BranchArcPanel({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showLogs, setShowLogs] = useState(false)

  const { data: arcs, isLoading } = useQuery({
    queryKey: ['narrative-arcs', projectId],
    queryFn: () => narrativeApi.arcs(projectId),
    enabled: !!projectId,
  })

  const list: any[] = Array.isArray(arcs) ? arcs : []
  const activeArc = list.find((a) => a.status === 'active')
  const lastConverged = list.filter((a) => a.status === 'converged').slice(-1)[0]

  // 活跃弧详情（含进度）
  const { data: arcDetail } = useQuery({
    queryKey: ['narrative-arc-detail', projectId, activeArc?.id],
    queryFn: () => narrativeApi.arc(projectId, activeArc.id),
    enabled: !!projectId && !!activeArc,
  })

  // 汇合重写日志（最近一次汇合的弧）
  const { data: logs } = useQuery({
    queryKey: ['narrative-rewrite-logs', projectId, lastConverged?.id],
    queryFn: () => narrativeApi.rewriteLogs(projectId, lastConverged.id),
    enabled: !!projectId && !!lastConverged && showLogs,
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['narrative-arcs', projectId] })
    queryClient.invalidateQueries({ queryKey: ['narrative-arc-detail', projectId] })
    queryClient.invalidateQueries({ queryKey: ['outlines', projectId] })
    queryClient.invalidateQueries({ queryKey: ['chapter-plans', projectId] })
  }

  const convergeMutation = useMutation({
    mutationFn: () => narrativeApi.converge(projectId, activeArc.id),
    onSuccess: (res: any) => {
      invalidateAll()
      toast(`汇合完成：汇合章已生成，重写 ${res?.rewritten ?? 0} 条后续计划${res?.milestoneLabel ? `，衔接里程碑「${res.milestoneLabel}」` : ''}`, 'success')
    },
    onError: (err: any) => toast(err.message || '汇合失败', 'error'),
  })

  const extendMutation = useMutation({
    mutationFn: () => narrativeApi.extend(projectId, activeArc.id),
    onSuccess: () => {
      invalidateAll()
      toast('分支弧已延长 2 章（一次性豁免，封顶 7 章）', 'success')
    },
    onError: (err: any) => toast(err.message || '延长失败', 'error'),
  })

  const abandonMutation = useMutation({
    mutationFn: () => narrativeApi.abandon(projectId, activeArc.id),
    onSuccess: () => {
      invalidateAll()
      toast('分支弧已废弃，相关影响快照已回滚', 'success')
    },
    onError: (err: any) => toast(err.message || '废弃失败', 'error'),
  })

  const promoteMutation = useMutation({
    mutationFn: (payload: { kind: string; ref: any }) =>
      narrativeApi.promote(projectId, activeArc.id, payload),
    onSuccess: () => {
      invalidateAll()
      toast('新元素已提拔为正式设定', 'success')
    },
    onError: (err: any) => toast(err.message || '提拔失败', 'error'),
  })

  const rollbackMutation = useMutation({
    mutationFn: () => narrativeApi.rollback(projectId, lastConverged.id),
    onSuccess: () => {
      invalidateAll()
      setShowLogs(false)
      toast('汇合重写已回滚，后续计划恢复原状', 'success')
    },
    onError: (err: any) => toast(err.message || '回滚失败', 'error'),
  })

  if (isLoading) return <div className="mb-3 flex justify-center py-2"><Spinner /></div>
  if (!activeArc && !lastConverged) return null

  const detail: any = arcDetail || activeArc
  const newElements: any[] = detail?.newElements ? Object.entries(detail.newElements).flatMap(([kind, refs]: [string, any]) =>
    (Array.isArray(refs) ? refs : []).map((ref: any) => ({ kind, ref }))) : []

  return (
    <div className="mb-3 space-y-2 rounded-lg border border-indigo-900/40 bg-indigo-950/20 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
        分支弧
        <span className="font-normal text-gray-500">（选择即重写大纲）</span>
      </p>

      {activeArc && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-gray-100">{detail?.title || activeArc.title}</span>
            <Badge variant="default">{ARC_TYPE_LABEL[detail?.branchType] || detail?.branchType}</Badge>
            <Badge variant={detail?.atHardLimit ? 'destructive' : detail?.overEstimate ? 'warning' : 'success'}>
              已写 {detail?.progress ?? 0}/{detail?.estimatedLength ?? 2} 章
            </Badge>
          </div>
          {detail?.premise && <p className="text-xs text-gray-400">{detail.premise}</p>}
          {detail?.shouldConverge && (
            <p className="text-xs text-amber-400">已到汇合时机：建议执行「立即汇合」，让分支剧情改写后续大纲。</p>
          )}

          {/* 新元素提拔 */}
          {newElements.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-gray-500">分支引入的新元素（可提拔为正式设定）：</p>
              {newElements.map((e: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-gray-300">[{KIND_LABEL[e.kind] || e.kind}] {e.ref?.name || e.ref?.title || `#${e.ref?.id ?? ''}`}</span>
                  <Button variant="ghost" size="sm" onClick={() => promoteMutation.mutate({ kind: e.kind, ref: e.ref })}>
                    <Award className="h-3 w-3" />
                    提拔
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button size="sm" onClick={() => {
              if (confirm('立即汇合？引擎将生成汇合方案并自动重写所有后续未完成计划（可在日志中回滚）。')) {
                convergeMutation.mutate()
              }
            }} loading={convergeMutation.isPending}>
              <GitMerge className="h-3.5 w-3.5" />
              立即汇合
            </Button>
            <Button variant="outline" size="sm" onClick={() => extendMutation.mutate()} loading={extendMutation.isPending}
              disabled={detail?.atHardLimit}>
              <PlusCircle className="h-3.5 w-3.5" />
              延长2章
            </Button>
            <Button variant="destructive" size="sm" onClick={() => {
              if (confirm('废弃该分支弧？相关影响快照将回滚，弧内章节保留但不再推进。')) {
                abandonMutation.mutate()
              }
            }} loading={abandonMutation.isPending}>
              <Ban className="h-3.5 w-3.5" />
              废弃
            </Button>
          </div>
        </>
      )}

      {/* 最近一次汇合：日志 + 回滚 */}
      {!activeArc && lastConverged && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-400">
              最近汇合：「{lastConverged.title}」于第{lastConverged.convergedAtChapter ?? '?'}章汇入主线
            </span>
            <button
              className="flex items-center gap-0.5 text-xs text-indigo-400 hover:text-indigo-300"
              onClick={() => setShowLogs((v) => !v)}
            >
              {showLogs ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              重写日志
            </button>
          </div>
          {showLogs && (
            <div className="space-y-1">
              {(Array.isArray(logs) ? logs : []).map((l: any) => (
                <p key={l.id} className="text-[11px] text-gray-500">
                  计划#{l.planId}：{l.beforeSnapshot?.title} → {l.afterSnapshot?.title}
                  {l.rolledBack && <span className="text-amber-400">（已回滚）</span>}
                </p>
              ))}
              {!logs && <p className="text-[11px] text-gray-600">加载中...</p>}
              <Button variant="destructive" size="sm" onClick={() => {
                if (confirm('回滚本次汇合重写？所有被改写的后续计划将恢复原状。')) {
                  rollbackMutation.mutate()
                }
              }} loading={rollbackMutation.isPending}>
                <Undo2 className="h-3.5 w-3.5" />
                回滚汇合
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
