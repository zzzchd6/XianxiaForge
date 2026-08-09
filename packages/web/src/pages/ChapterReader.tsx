import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { BookOpen, Edit3, Eye, History, Save, ChevronRight, ChevronDown, Download, Wand2, GitBranch, RefreshCw, Feather, AlertTriangle, Users, Sparkles, Loader2, Target, Compass, Zap, Search, Maximize2, Minimize2, BarChart3, Link2 } from 'lucide-react'
import { diffLines, type Change } from 'diff'
import {
  Card, CardContent, Button, Badge, Textarea, Tabs, Input, Dialog,
  Spinner, EmptyState, useToast,
} from '../components/ui'
import { chaptersApi, generationApi, projectsApi, settingsApi, impactApi, causalChainApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import { useGenerationStream } from '../hooks/useGenerationStream'
import PolishModal from '../components/PolishModal'
import BranchArcPanel from './BranchArcPanel'
import { cn, formatWordCount } from '../lib/utils'
import { analyzeWordFreq } from '../lib/wordfreq'

// 章节状态配置
const statusConfig: Record<string, { label: string; variant: 'default' | 'success' | 'warning' }> = {
  planned: { label: '待生成', variant: 'default' },
  writing: { label: '生成中', variant: 'warning' },
  generated: { label: '已生成', variant: 'success' },
  draft: { label: '草稿', variant: 'warning' },
  reviewed: { label: '已审', variant: 'default' },
  finalized: { label: '已定稿', variant: 'success' },
  approved: { label: '已批准', variant: 'success' },
}

// 分支选项借鉴素材的徽标配色（按素材类型区分）
const materialBadgeClass: Record<string, string> = {
  奇遇: 'bg-amber-500/20 text-amber-400',
  伏笔手法: 'bg-purple-500/20 text-purple-400',
  人物高光: 'bg-rose-500/20 text-rose-400',
  任务链: 'bg-sky-500/20 text-sky-400',
}

/** 行级Diff渲染组件 */
function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const changes: Change[] = diffLines(oldText, newText)
  return (
    <div className="space-y-0 font-mono text-xs leading-5">
      {changes.map((change, i) => (
        <div
          key={i}
          className={cn(
            'whitespace-pre-wrap px-2 py-0.5',
            change.added && 'bg-emerald-500/15 text-emerald-300',
            change.removed && 'bg-red-500/15 text-red-300 line-through',
            !change.added && !change.removed && 'text-gray-400'
          )}
        >
          {change.added ? '+ ' : change.removed ? '- ' : '  '}
          {change.value}
        </div>
      ))}
    </div>
  )
}

/** 审计问题修改预览确认弹窗（复用页内 DiffView，单条/一键修改共用） */
function FixConfirmDialog({
  open, title, issue, revisionNotes, originalContent, revisedContent, loading,
  onConfirm, onRegenerate, onCancel,
}: {
  open: boolean
  title: string
  issue?: any
  revisionNotes?: string[]
  originalContent?: string
  revisedContent?: string
  loading?: boolean
  onConfirm: () => void
  onRegenerate: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={title} className="max-w-3xl">
      <div className="space-y-3">
        {issue?.description && (
          <div className="rounded-md bg-amber-500/10 p-2 text-sm text-amber-300">
            {issue.dimension ? `[${issue.dimension}] ` : ''}{issue.description}
          </div>
        )}
        {revisionNotes && revisionNotes.length > 0 && (
          <ul className="space-y-0.5">
            {revisionNotes.map((n, i) => <li key={i} className="text-xs text-gray-400">• {n}</li>)}
          </ul>
        )}
        <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-700 bg-gray-950 p-4">
          <DiffView oldText={originalContent ?? ''} newText={revisedContent ?? ''} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>取消</Button>
          <Button variant="outline" size="sm" onClick={onRegenerate} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" />
            重新生成
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={loading || !revisedContent}>
            <Save className="h-3.5 w-3.5" />
            确认替换
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/** 综合得分 → 等级标识 */
function scoreGrade(score: number): { label: string; color: string } {
  if (score >= 90) return { label: '优秀', color: 'text-emerald-400' }
  if (score >= 70) return { label: '良好', color: 'text-sky-400' }
  if (score >= 50) return { label: '需改进', color: 'text-amber-400' }
  return { label: '需重写', color: 'text-red-400' }
}

/** 正文高亮渲染：highlight=单段高亮(amber)；searchWord=全词搜索高亮(indigo+amber首项) */
function HighlightedContent({ content, highlight, searchWord }: { content: string; highlight?: string; searchWord?: string }) {
  const markRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (searchWord && markRef.current) {
      markRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else if (highlight && markRef.current) {
      markRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlight, searchWord])

  if (!highlight && !searchWord) {
    return <div className="whitespace-pre-wrap text-base leading-8 text-gray-200">{content}</div>
  }

  // searchWord 模式：全文所有匹配高亮
  if (searchWord) {
    const parts = content.split(new RegExp(`(${searchWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g'))
    if (parts.length === 1) {
      return <div className="whitespace-pre-wrap text-base leading-8 text-gray-200">{content}</div>
    }
    let firstMatch = true
    return (
      <div className="whitespace-pre-wrap text-base leading-8 text-gray-200">
        {parts.map((part, i) => {
          if (part === searchWord) {
            const cls = firstMatch
              ? 'rounded bg-indigo-400/50 px-0.5 text-indigo-100'
              : 'rounded bg-indigo-400/20 px-0.5 text-indigo-100'
            const ref = firstMatch ? markRef : undefined
            firstMatch = false
            return <mark key={i} ref={ref} className={cls}>{part}</mark>
          }
          return <span key={i}>{part}</span>
        })}
      </div>
    )
  }

  // highlight 模式：单段高亮（原有逻辑）
  const idx = content.indexOf(highlight!)
  if (idx === -1) {
    return <div className="whitespace-pre-wrap text-base leading-8 text-gray-200">{content}</div>
  }
  return (
    <div className="whitespace-pre-wrap text-base leading-8 text-gray-200">
      {content.slice(0, idx)}
      <mark ref={markRef} className="rounded bg-amber-400/40 px-0.5 text-amber-100">
        {content.slice(idx, idx + highlight!.length)}
      </mark>
      {content.slice(idx + highlight!.length)}
    </div>
  )
}

export default function ChapterReader() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [selectedChapter, setSelectedChapter] = useState<any>(null)
  const [mode, setMode] = useState<'read' | 'edit' | 'versions' | 'revise' | 'focus'>('read')
  // 18-SRS 方案C：右栏双Tab + 章节分析工具（词频/文风内联右栏，阅读区永显正文）
  const [rightTab, setRightTab] = useState<'branch' | 'analysis'>('branch')
  const [analysisTool, setAnalysisTool] = useState<'style' | 'wordfreq' | null>(null)
  const [wordSearch, setWordSearch] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [listView, setListView] = useState<'flat' | 'tree'>('flat')

  // AI修订状态
  const [reviseInstruction, setReviseInstruction] = useState('')
  const [reviseSelectedText, setReviseSelectedText] = useState('')
  const [reviseResult, setReviseResult] = useState<any>(null)
  const [reviseLoading, setReviseLoading] = useState(false)
  // 独立润色弹窗（架构升级 Epic3）
  const [showPolishModal, setShowPolishModal] = useState(false)
  // 版本diff对比
  const [diffVersionId, setDiffVersionId] = useState<number | null>(null)
  // 分支面板：生成中标志
  const [branchGenerating, setBranchGenerating] = useState(false)
  // 选定分支后衍生的下一章计划（供原地生成使用）
  const [derivedPlan, setDerivedPlan] = useState<any>(null)
  // 原地生成下一章：SSE 流式 Hook
  const {
    phase: genPhase, text: genText, isStreaming: genStreaming, error: genError,
    startGeneration, cancelGeneration,
  } = useGenerationStream()
  // 文风校验状态（需求13）
  const [styleRecord, setStyleRecord] = useState<any>(null)
  const [styleLoading, setStyleLoading] = useState(false)
  const [activeExcerpt, setActiveExcerpt] = useState<string | undefined>(undefined)
  const [styleReviseResult, setStyleReviseResult] = useState<any>(null)
  const [styleReviseLoading, setStyleReviseLoading] = useState(false)
  const [showStyleHistory, setShowStyleHistory] = useState(false)
  const [styleHistoryList, setStyleHistoryList] = useState<any[]>([])
  // 29维质量审计状态
  const [qualityAuditLoading, setQualityAuditLoading] = useState(false)
  const [qualityAuditResult, setQualityAuditResult] = useState<any>(null)
  const [showQualityAudit, setShowQualityAudit] = useState(false)
  // 审计问题一键修改状态（质量/文风共用）
  const [fixingIssue, setFixingIssue] = useState<{ type: 'quality' | 'style'; issue: any; index: number } | null>(null)
  const [fixResult, setFixResult] = useState<any>(null)
  const [fixLoading, setFixLoading] = useState(false)
  const [fixAllLoading, setFixAllLoading] = useState(false)
  const [ignoredIssues, setIgnoredIssues] = useState<Set<string>>(new Set()) // key: `${type}-${index}`
  const contentRef = useRef<HTMLDivElement>(null)

  // 查找替换状态
  const [showFindReplace, setShowFindReplace] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')

  // 专注模式（开源借鉴 PRD v1.1 M4）：进入前的模式，退出时恢复
  const [prevMode, setPrevMode] = useState<'read' | 'edit'>('read')
  const focusShellRef = useRef<HTMLDivElement>(null)
  // 词频分析范围（当前章/整书）
  const [wordfreqScope, setWordfreqScope] = useState<'chapter' | 'book'>('chapter')

  const matchCount = useMemo(() => {
    if (!findText || !editContent) return 0
    let count = 0
    let pos = 0
    const lower = editContent.toLowerCase()
    const needle = findText.toLowerCase()
    while ((pos = lower.indexOf(needle, pos)) !== -1) {
      count++
      pos += needle.length
    }
    return count
  }, [findText, editContent])

  const handleReplace = () => {
    if (!findText) return
    const lower = editContent.toLowerCase()
    const needle = findText.toLowerCase()
    const idx = lower.indexOf(needle)
    if (idx === -1) return
    const newContent = editContent.slice(0, idx) + replaceText + editContent.slice(idx + findText.length)
    setEditContent(newContent)
  }

  const handleReplaceAll = () => {
    if (!findText) return
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    setEditContent(editContent.replace(regex, replaceText))
  }

  // 导出：整书或本卷，TXT或MD；沿当前阅读路径（含分支选择）导出
  const handleExport = (format: 'txt' | 'md', volumeNo?: number) => {
    const params = new URLSearchParams({ format })
    if (volumeNo !== undefined) params.set('volumeNo', String(volumeNo))
    // 传阅读路径的章节计划ID列表，使导出与阅读区一致（分支衍生章替代主线章）
    const pathIds = (activeChapters as any[]).map((c) => c.id).filter(Boolean)
    if (pathIds.length) params.set('chapterIds', pathIds.join(','))
    window.open(`/api/projects/${projectId}/export?${params.toString()}`, '_blank')
    setExportMenuOpen(false)
  }

  // AI修订：提交指令
  const handleRevise = async () => {
    if (!reviseInstruction.trim()) {
      toast('请输入修改指令', 'error')
      return
    }
    setReviseLoading(true)
    setReviseResult(null)
    try {
      const result = await chaptersApi.revise(projectId, selectedChapter.id, {
        instruction: reviseInstruction,
        selectedText: reviseSelectedText || undefined,
      })
      setReviseResult(result)
    } catch (err: any) {
      toast(err.message || 'AI修订失败', 'error')
    } finally {
      setReviseLoading(false)
    }
  }

  // AI修订：确认保存为新版本
  const handleConfirmRevise = async () => {
    if (!reviseResult?.revisedContent) return
    try {
      await chaptersApi.updateContent(projectId, selectedChapter.id, reviseResult.revisedContent)
      toast('修订已保存为新版本', 'success')
      queryClient.invalidateQueries({ queryKey: ['chapter-content', projectId, selectedChapter?.id] })
      queryClient.invalidateQueries({ queryKey: ['chapter-versions', projectId, selectedChapter?.id] })
      setReviseResult(null)
      setReviseInstruction('')
      setReviseSelectedText('')
      setMode('read')
    } catch (err: any) {
      toast(err.message || '保存失败', 'error')
    }
  }

  // 捕获阅读模式下的文字选区
  const captureSelection = () => {
    const sel = window.getSelection()
    if (sel && sel.toString().trim().length > 0) {
      setReviseSelectedText(sel.toString().trim())
    }
  }

  // 视角重写状态
  const [showPerspectiveDialog, setShowPerspectiveDialog] = useState(false)
  const [perspectiveTarget, setPerspectiveTarget] = useState('')
  const [perspectiveResult, setPerspectiveResult] = useState<any>(null)
  const [perspectiveLoading, setPerspectiveLoading] = useState(false)

  const handlePerspectiveRewrite = async () => {
    if (!perspectiveTarget.trim() || !reviseSelectedText) return
    setPerspectiveLoading(true)
    setPerspectiveResult(null)
    try {
      const result = await chaptersApi.rewritePerspective(projectId, String(selectedChapter.id), {
        selectedText: reviseSelectedText,
        targetCharacterName: perspectiveTarget.trim(),
      })
      setPerspectiveResult(result)
      setShowPerspectiveDialog(false)
    } catch (err: any) {
      toast(err.message || '视角重写失败', 'error')
    } finally {
      setPerspectiveLoading(false)
    }
  }

  // 当前项目（全局状态，侧边栏可切换）
  const projectId = useCurrentProjectId()

  // 原地生成完成/失败后刷新章节列表
  useEffect(() => {
    if (genPhase === 'complete') {
      toast('下一章生成完成', 'success')
      queryClient.invalidateQueries({ queryKey: ['chapters', projectId] })
      queryClient.invalidateQueries({ queryKey: ['chapter-plans', projectId] })
    } else if (genPhase === 'error' && genError) {
      toast(genError, 'error')
    }
  }, [genPhase, genError, projectId, queryClient, toast])

  // 获取章节列表
  const { data: chapters, isLoading } = useQuery({
    queryKey: ['chapters', projectId],
    queryFn: () => chaptersApi.list(projectId),
    enabled: !!projectId,
  })

  // 重载恢复：从章节列表中找出本章已选定分支衍生的待生成下一章计划
  // （branchParentChapterId 指向本章且仍为 planned 的计划）
  const recoveredPlan = useMemo(() => {
    if (!selectedChapter?.id || !chapters?.length) return null
    return chapters.find(
      (c: any) => c.branchParentChapterId === selectedChapter.id && c.status === 'planned'
    ) || null
  }, [chapters, selectedChapter?.id])
  // 优先用本次会话选择捕获的计划（即时反馈），否则回退到列表恢复的（跨刷新保留）
  const effectiveDerivedPlan = derivedPlan || recoveredPlan

  // 活跃阅读路径：分支衍生章与主线章共享章号（平行替代关系），阅读列表只呈现用户实际走过的链路——
  // 从首章主线出发，遇到分支衍生章即沿分支链前进；一旦进入分支链便不再回退主线（被绕过的主线章
  // 视为"另一条世界线"，不在阅读列表展示，仍可于大纲编辑器查看）。
  const activeChapters = useMemo(() => {
    if (!chapters?.length) return []
    const list = chapters as any[]
    // 父章计划id -> 分支衍生章；"卷-章号" -> 主线章
    const branchChild = new Map<number, any>()
    const mainline = new Map<string, any>()
    for (const ch of list) {
      if (ch.branchParentChapterId) {
        branchChild.set(Number(ch.branchParentChapterId), ch)
      } else {
        mainline.set(`${ch.volumeNo}-${ch.chapterNo}`, ch)
      }
    }
    const mainlineList = list
      .filter((c) => !c.branchParentChapterId)
      .sort((a, b) => Number(a.volumeNo) - Number(b.volumeNo) || Number(a.chapterNo) - Number(b.chapterNo))
    if (!mainlineList.length) return list

    const path: any[] = []
    const visited = new Set<number>()
    let cur: any = mainlineList[0]
    let onBranch = false
    while (cur && !visited.has(Number(cur.id))) {
      visited.add(Number(cur.id))
      path.push(cur)
      const bc = branchChild.get(Number(cur.id))
      if (bc) {
        cur = bc
        onBranch = true
      } else if (!onBranch) {
        // 沿主线推进到下一章（章号+1，换卷时取下一卷首章）
        cur = mainline.get(`${cur.volumeNo}-${Number(cur.chapterNo) + 1}`)
          || mainlineList.find((c) => Number(c.volumeNo) > Number(cur?.volumeNo))
          || null
      } else {
        cur = null // 分支链尚未衍生下一章，路径到此为止
      }
    }
    return path
  }, [chapters])

  // 分支树视图：主线章节 + 按 branchParentChapterId 分组的分支子章节
  const chapterTree = useMemo(() => {
    if (!activeChapters.length) return { mainline: [] as any[], branchMap: new Map<number, any[]>() }
    const mainline = activeChapters.filter((ch: any) => !ch.branchParentChapterId)
    const branches = activeChapters.filter((ch: any) => ch.branchParentChapterId)
    const branchMap = new Map<number, any[]>()
    for (const b of branches) {
      const pid = Number(b.branchParentChapterId)
      if (!branchMap.has(pid)) branchMap.set(pid, [])
      branchMap.get(pid)!.push(b)
    }
    return { mainline, branchMap }
  }, [activeChapters])

  // 从URL参数预选章节（仪表盘点击穿透进入）
  useEffect(() => {
    const chapterId = searchParams.get('chapter')
    if (chapterId && chapters?.length) {
      const target = chapters.find((ch: any) => String(ch.id) === chapterId)
      if (target) {
        setSelectedChapter(target)
        setMode('read')
      }
    }
  }, [searchParams, chapters])

  // 获取章节正文
  const { data: content, isLoading: contentLoading } = useQuery({
    queryKey: ['chapter-content', projectId, selectedChapter?.id],
    queryFn: () => chaptersApi.getContent(projectId, selectedChapter.id),
    enabled: !!selectedChapter?.id,
  })

  // 获取版本历史
  const { data: versions } = useQuery({
    queryKey: ['chapter-versions', projectId, selectedChapter?.id],
    queryFn: () => chaptersApi.getVersions(projectId, selectedChapter.id),
    enabled: !!selectedChapter?.id && mode === 'versions',
  })

  // 词频分析：整书正文（懒加载并行拉取所有章节，开源借鉴 PRD v1.1 M4）
  const { data: bookText, isLoading: bookTextLoading } = useQuery({
    queryKey: ['wordfreq-book', projectId],
    queryFn: async () => {
      const list = activeChapters ?? []
      const rs = await Promise.all(
        list.map((ch: any) => chaptersApi.getContent(String(projectId), String(ch.id)).catch(() => null)),
      )
      return rs.map((r: any) => r?.content || r?.text || '').join('\n')
    },
    enabled: !!projectId && analysisTool === 'wordfreq' && wordfreqScope === 'book',
  })

  // 获取分支选项（阅读模式下展示）
  const { data: branchOptions, refetch: refetchBranches } = useQuery({
    queryKey: ['branch-options', projectId, selectedChapter?.id],
    queryFn: () => chaptersApi.getBranchOptions(projectId, selectedChapter.id),
    enabled: !!selectedChapter?.id,
  })

  // ===== 剧情方向体系 =====
  // 全局方向字典（9大类+细分方向），长期缓存
  const { data: directionCatalog } = useQuery({
    queryKey: ['direction-catalog'],
    queryFn: () => settingsApi.directionCatalog(),
    staleTime: Infinity,
  })
  // 连续方向校验（回溯已选定分支链，判断是否连续同方向超阈值）
  const { data: directionCheck } = useQuery({
    queryKey: ['direction-check', projectId, selectedChapter?.id],
    queryFn: () => projectsApi.directionCheck(projectId, selectedChapter.chapterNo),
    enabled: !!selectedChapter?.id,
  })

  // ===== 分支影响体系 =====
  // 影响定义白名单（impactKey → 名称 映射，供台账/历史可读化）
  const { data: impactDefinitions } = useQuery({
    queryKey: ['impact-definitions', projectId],
    queryFn: () => impactApi.listDefinitions(projectId),
    staleTime: 5 * 60 * 1000,
  })
  // 影响变更历史（审计轨迹，倒序）
  const { data: impactHistory } = useQuery({
    queryKey: ['impact-history', projectId],
    queryFn: () => impactApi.history(projectId, 20),
    enabled: !!selectedChapter?.id,
  })
  // 影响→方向 弱推荐（基于当前 POV 人物影响状态，弱提示不强制）
  const { data: directionRecommend } = useQuery({
    queryKey: ['impact-direction-recommend', projectId, selectedChapter?.id],
    queryFn: () => impactApi.directionRecommend(
      projectId,
      Array.isArray(selectedChapter?.povCharacterIds) ? (selectedChapter!.povCharacterIds as number[]).map(Number) : [],
    ),
    enabled: !!selectedChapter?.id,
  })
  // impactKey → 定义 快查表
  const impactDefByKey = useMemo(
    () => new Map<string, any>((impactDefinitions ?? []).map((d: any) => [d.impactKey, d])),
    [impactDefinitions]
  )
  // 方向编码 → 定义 / 大类编码 → 元信息 快查表
  const directionByCode = useMemo(
    () => new Map<string, any>((directionCatalog?.directions ?? []).map((d: any) => [d.code, d])),
    [directionCatalog]
  )
  const categoryByCode = useMemo(
    () => new Map<string, any>((directionCatalog?.categories ?? []).map((c: any) => [c.code, c])),
    [directionCatalog]
  )
  // 叙事方向定向选择（可选：不选=AI自动推演并打标；选了=定向生成）
  const [targetMain, setTargetMain] = useState<string | null>(null)
  const [targetSecondary, setTargetSecondary] = useState<string[]>([])
  // 分支列表方向筛选（按大类，客户端过滤）
  const [directionFilter, setDirectionFilter] = useState<string | null>(null)
  // ⚡ 分支影响预览：按选项ID缓存预览数据 / 加载态 / 展开态
  const [impactPreviews, setImpactPreviews] = useState<Record<number, any[]>>({})
  const [impactLoading, setImpactLoading] = useState<Record<number, boolean>>({})
  const [impactExpanded, setImpactExpanded] = useState<Record<number, boolean>>({})
  // 影响台账（当前权威状态 + 变更历史）折叠开关
  const [impactLedgerOpen, setImpactLedgerOpen] = useState(false)
  // FUNC-03：因果链上下文（待兑现清单）
  const [causalCtx, setCausalCtx] = useState<any>(null)
  const [causalCtxLoading, setCausalCtxLoading] = useState(false)
  const [causalCtxOpen, setCausalCtxOpen] = useState(false)

  // 切换某分支选项的影响预览（首次展开时懒加载；预览=实际应用的计算结果）
  const toggleImpactPreview = async (optionId: number) => {
    const willExpand = !impactExpanded[optionId]
    setImpactExpanded((s) => ({ ...s, [optionId]: willExpand }))
    if (!willExpand || impactPreviews[optionId]) return
    setImpactLoading((s) => ({ ...s, [optionId]: true }))
    try {
      const items = await impactApi.preview(projectId, optionId)
      setImpactPreviews((s) => ({ ...s, [optionId]: items ?? [] }))
    } catch (err: any) {
      setImpactPreviews((s) => ({ ...s, [optionId]: [] }))
      toast(err.message || '影响预览加载失败', 'error')
    } finally {
      setImpactLoading((s) => ({ ...s, [optionId]: false }))
    }
  }

  // FUNC-03：加载因果链上下文（待兑现清单）
  const toggleCausalCtx = async () => {
    const willOpen = !causalCtxOpen
    setCausalCtxOpen(willOpen)
    if (!willOpen || causalCtx) return
    setCausalCtxLoading(true)
    try {
      const chNo = selectedChapter?.chapterNo
      const data = await causalChainApi.context(projectId, chNo)
      setCausalCtx(data)
    } catch {
      setCausalCtx(null)
    } finally {
      setCausalCtxLoading(false)
    }
  }

  // 选择分支 → 衍生下一章计划（捕获返回的新章节计划，供原地生成使用）
  const handleSelectBranch = async (optionId: number) => {
    try {
      const res = await chaptersApi.selectBranch(projectId, selectedChapter.id, optionId)
      setDerivedPlan(res?.nextChapterPlan || null)
      // 伏笔/因果抽取已改为后台异步执行，响应不再携带条数；
      // 列表页通过 invalidateQueries 自动刷新，此处统一提示即可。
      toast('已选择分支，下一章计划已生成', 'success')
      queryClient.invalidateQueries({ queryKey: ['branch-options', projectId, selectedChapter?.id] })
      queryClient.invalidateQueries({ queryKey: ['chapters', projectId] })
      queryClient.invalidateQueries({ queryKey: ['chapter-plans', projectId] })
      queryClient.invalidateQueries({ queryKey: ['foreshadow', projectId] })
    } catch (err: any) {
      toast(err.message || '选择分支失败', 'error')
    }
  }

  // 原地生成下一章（基于选定分支衍生的章节计划）
  const handleGenerateNextChapter = async () => {
    if (!effectiveDerivedPlan?.id) return
    try {
      await startGeneration({
        projectId,
        chapterPlanId: String(effectiveDerivedPlan.id),
        targetWords: effectiveDerivedPlan.targetWordCount || 3000,
        temperature: 0.8,
        autoRevise: true,
      })
      toast('下一章生成任务已启动', 'success')
    } catch (err: any) {
      toast(err.message || '启动生成失败', 'error')
    }
  }

  // 手动重新生成分支选项（可选定向生成：传入 targetDirections 则按指定方向约束产出）
  const handleGenerateBranches = async (targetDirections?: { main?: string; secondary?: string[] }) => {
    setBranchGenerating(true)
    setDerivedPlan(null)
    try {
      await chaptersApi.generateBranches(
        projectId,
        selectedChapter.id,
        targetDirections?.main ? { targetDirections } : undefined,
      )
      toast(targetDirections?.main ? '定向分支选项已生成' : '分支选项已重新生成（含奇遇走向）', 'success')
      await refetchBranches()
    } catch (err: any) {
      toast(err.message || '生成分支失败', 'error')
    } finally {
      setBranchGenerating(false)
    }
  }

  // ===== 文风校验（需求13） =====
  // 进入文风校验（18-SRS 方案C：结果内联右栏「章节分析」Tab，不再替换阅读区正文）
  const enterStyleMode = async () => {
    setRightTab('analysis')
    setAnalysisTool('style')
    setActiveExcerpt(undefined)
    setStyleReviseResult(null)
    if (!styleRecord) {
      try {
        const list = await chaptersApi.getStyleAudits(projectId, selectedChapter.id)
        if (list?.length) setStyleRecord(list[0])
      } catch {
        /* 无历史记录忽略 */
      }
    }
  }

  // 触发/重新校验
  const handleAuditStyle = async () => {
    setStyleLoading(true)
    setActiveExcerpt(undefined)
    setStyleReviseResult(null)
    setIgnoredIssues((prev) => new Set([...prev].filter((k) => !k.startsWith('style-'))))
    try {
      const record = await chaptersApi.auditStyle(projectId, selectedChapter.id)
      setStyleRecord(record)
      toast(`文风校验完成，综合得分 ${record.overallScore}`, 'success')
    } catch (err: any) {
      toast(err.message || '文风校验失败', 'error')
    } finally {
      setStyleLoading(false)
    }
  }

  // 一键修正文风问题（跳过被忽略的问题）
  const handleStyleRevise = async () => {
    if (!styleRecord?.id) return
    const ignoredIdx = [...ignoredIssues]
      .filter((k) => k.startsWith('style-'))
      .map((k) => Number(k.slice('style-'.length)))
      .filter((n) => Number.isInteger(n))
    setStyleReviseLoading(true)
    setStyleReviseResult(null)
    try {
      const result = await chaptersApi.reviseStyleAudit(projectId, selectedChapter.id, styleRecord.id, ignoredIdx)
      setStyleReviseResult(result)
    } catch (err: any) {
      toast(err.message || '文风修订失败', 'error')
    } finally {
      setStyleReviseLoading(false)
    }
  }

  // 确认保存修订为新版本
  const handleConfirmStyleRevise = async () => {
    if (!styleReviseResult?.revisedContent) return
    try {
      await chaptersApi.updateContent(projectId, selectedChapter.id, styleReviseResult.revisedContent)
      toast('文风修订已保存为新版本', 'success')
      queryClient.invalidateQueries({ queryKey: ['chapter-content', projectId, selectedChapter?.id] })
      queryClient.invalidateQueries({ queryKey: ['chapter-versions', projectId, selectedChapter?.id] })
      setStyleReviseResult(null)
      setStyleRecord(null) // 清空旧报告，提示重新校验
    } catch (err: any) {
      toast(err.message || '保存失败', 'error')
    }
  }

  // 查看历史校验记录列表
  const handleStyleHistory = async () => {
    try {
      const list = await chaptersApi.getStyleAudits(projectId, selectedChapter.id)
      setStyleHistoryList(list || [])
      setShowStyleHistory(true)
    } catch (err: any) {
      toast(err.message || '加载历史记录失败', 'error')
    }
  }

  // 查看单条校验记录详情
  const handleViewAuditDetail = async (aid: number | string) => {
    try {
      const detail = await chaptersApi.getStyleAuditDetail(projectId, selectedChapter.id, aid)
      setStyleRecord(detail)
      setShowStyleHistory(false)
      setActiveExcerpt(undefined)
      setStyleReviseResult(null)
    } catch (err: any) {
      toast(err.message || '加载详情失败', 'error')
    }
  }

  // 29维质量审计（手动触发）
  const handleQualityAudit = async () => {
    if (!selectedChapter?.id) return
    setQualityAuditLoading(true)
    setQualityAuditResult(null)
    setShowQualityAudit(true)
    setIgnoredIssues((prev) => new Set([...prev].filter((k) => !k.startsWith('quality-'))))
    try {
      const report = await chaptersApi.auditQuality(selectedChapter.id)
      setQualityAuditResult(report)
      toast(`质量审计完成，综合得分 ${report.overallScore}`, 'success')
    } catch (err: any) {
      toast(err.message || '质量审计失败', 'error')
      setShowQualityAudit(false)
    } finally {
      setQualityAuditLoading(false)
    }
  }

  // ===== 审计问题一键修改（质量/文风共用） =====
  // 忽略 / 撤销忽略某条问题
  const handleIgnoreIssue = (type: 'quality' | 'style', index: number) => {
    const key = `${type}-${index}`
    setIgnoredIssues((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // 单条问题修改：调用后端针对该问题重写，返回预览
  const handleFixSingle = async (type: 'quality' | 'style', issue: any, index: number) => {
    setFixingIssue({ type, issue, index })
    setFixLoading(true)
    setFixResult(null)
    try {
      const result = await chaptersApi.fixIssue(projectId, selectedChapter.id, { auditType: type, issue })
      setFixResult(result)
    } catch (err: any) {
      toast(err.message || '修复失败', 'error')
      setFixingIssue(null)
    } finally {
      setFixLoading(false)
    }
  }

  // 质量审计一键修改：打包 critical/major（跳过忽略项）
  const handleFixAllQuality = async () => {
    const issues = qualityAuditResult?.issues ?? []
    const ignoredIdx = [...ignoredIssues]
      .filter((k) => k.startsWith('quality-'))
      .map((k) => Number(k.slice('quality-'.length)))
      .filter((n) => Number.isInteger(n))
    setFixingIssue({ type: 'quality', issue: null, index: -1 })
    setFixAllLoading(true)
    setFixResult(null)
    try {
      const result = await chaptersApi.fixAllQuality(projectId, selectedChapter.id, { issues, ignoredIndices: ignoredIdx })
      setFixResult(result)
    } catch (err: any) {
      toast(err.message || '一键修改失败', 'error')
      setFixingIssue(null)
    } finally {
      setFixAllLoading(false)
    }
  }

  // 重新生成当前修复预览
  const handleRegenerateFix = async () => {
    if (!fixingIssue) return
    if (fixingIssue.index === -1) await handleFixAllQuality()
    else await handleFixSingle(fixingIssue.type, fixingIssue.issue, fixingIssue.index)
  }

  // 确认保存修复结果为新版本，并刷新对应审计
  const handleConfirmFix = async () => {
    if (!fixResult?.revisedContent || !fixingIssue) return
    const fixedType = fixingIssue.type
    try {
      await chaptersApi.updateContent(projectId, selectedChapter.id, fixResult.revisedContent)
      toast('修改已保存为新版本', 'success')
      queryClient.invalidateQueries({ queryKey: ['chapter-content', projectId, selectedChapter?.id] })
      queryClient.invalidateQueries({ queryKey: ['chapter-versions', projectId, selectedChapter?.id] })
      setFixResult(null)
      setFixingIssue(null)
      if (fixedType === 'quality') handleQualityAudit()
      else handleAuditStyle()
    } catch (err: any) {
      toast(err.message || '保存失败', 'error')
    }
  }

  // 保存编辑
  const saveMutation = useMutation({
    mutationFn: (data: any) => chaptersApi.update(projectId, selectedChapter.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chapters', projectId] })
      queryClient.invalidateQueries({ queryKey: ['chapter-content', projectId, selectedChapter?.id] })
      toast('保存成功', 'success')
      setMode('read')
    },
    onError: (err: any) => toast(err.message || '保存失败', 'error'),
  })

  // 选择章节
  const handleSelect = (chapter: any) => {
    setSelectedChapter(chapter)
    setMode('read')
    setEditContent('')
    setDerivedPlan(null)
    setAnalysisTool(null)
    setWordSearch(null)
    if (genStreaming) cancelGeneration()
  }

  // 进入编辑模式
  const startEdit = () => {
    setEditContent(content?.content || content?.text || '')
    setMode('edit')
  }

  // 保存内容
  const handleSave = () => {
    saveMutation.mutate({ content: editContent })
  }

  // 专注模式进入/退出（开源借鉴 PRD v1.1 M4：全屏暗色态，仅保留正文+字数+标题）
  const enterFocus = () => {
    setPrevMode(mode === 'edit' ? 'edit' : 'read')
    if (mode !== 'edit') setEditContent(content?.content || content?.text || '')
    setMode('focus')
  }
  const exitFocus = () => setMode(prevMode)

  // 专注态挂载后请求全屏；Esc 退出全屏时同步退出专注态
  useEffect(() => {
    if (mode !== 'focus') return
    focusShellRef.current?.requestFullscreen?.().catch(() => {})
    const onFsChange = () => {
      if (!document.fullscreenElement) setMode((m) => (m === 'focus' ? prevMode : m))
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // 词频分析结果（纯前端零 token，开源借鉴 PRD v1.1 M4）
  const wordfreqText =
    wordfreqScope === 'book' ? (bookText ?? '') : (content?.content || content?.text || '')
  const wordfreqResult = useMemo(
    () => (analysisTool === 'wordfreq' && wordfreqText ? analyzeWordFreq(wordfreqText) : null),
    [analysisTool, wordfreqText],
  )

  return (
    <div className="space-y-4">
      {/* 专注模式全屏覆盖层（开源借鉴 PRD v1.1 M4：暗色态，仅正文+字数+标题） */}
      {mode === 'focus' && (
        <div ref={focusShellRef} className="fixed inset-0 z-50 flex flex-col bg-[#0b0e13]">
          <div className="flex items-center justify-between border-b border-gray-800/60 px-6 py-3">
            <h2 className="truncate text-sm font-medium text-gray-300">
              第{selectedChapter?.chapterNo}章 {selectedChapter?.title}
            </h2>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-gray-500">
                {editContent.replace(/\s/g, '').length} 字
              </span>
              <Button size="sm" variant="outline" onClick={handleSave} loading={saveMutation.isPending}>
                <Save className="h-3.5 w-3.5" />
                保存
              </Button>
              <Button size="sm" variant="ghost" onClick={exitFocus}>
                <Minimize2 className="h-3.5 w-3.5" />
                退出专注（Esc）
              </Button>
            </div>
          </div>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="mx-auto w-full max-w-3xl flex-1 resize-none bg-transparent px-6 py-8 text-lg leading-9 text-gray-200 outline-none"
            placeholder="沉浸写作…"
          />
        </div>
      )}

      <h1 className="text-2xl font-bold text-gray-100">章节阅读</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* 左侧：章节列表 */}
        <div className="lg:col-span-3">
          <Card className="h-full">
            <CardContent className="overflow-y-auto p-3" style={{ maxHeight: '75vh' }}>
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="text-xs font-medium text-gray-400">章节列表</span>
                <div className="flex rounded border border-gray-700 p-0.5">
                  <button
                    onClick={() => setListView('flat')}
                    className={cn('rounded px-2.5 py-1.5 text-[10px]', listView === 'flat' ? 'bg-gray-700 text-gray-200' : 'text-gray-500')}
                  >
                    平铺
                  </button>
                  <button
                    onClick={() => setListView('tree')}
                    className={cn('rounded px-2.5 py-1.5 text-[10px]', listView === 'tree' ? 'bg-gray-700 text-gray-200' : 'text-gray-500')}
                  >
                    分支树
                  </button>
                </div>
              </div>
              {isLoading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
              ) : !activeChapters.length ? (
                <EmptyState message="暂无章节" />
              ) : listView === 'tree' ? (
                <div className="space-y-0.5">
                  {chapterTree.mainline.map((ch: any) => (
                    <div key={ch.id}>
                      <button
                        onClick={() => handleSelect(ch)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                          selectedChapter?.id === ch.id
                            ? 'bg-indigo-600/20 text-indigo-300'
                            : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                        )}
                      >
                        <ChevronRight className="h-3 w-3 shrink-0" />
                        <span className="flex-1 truncate">
                          {ch.volumeNo ? `卷${ch.volumeNo} ` : ''}第{ch.chapterNo}章 {ch.title}
                        </span>
                        {(chapterTree.branchMap.get(ch.id)?.length ?? 0) > 0 && (
                          <span className="shrink-0 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] text-amber-400">
                            {chapterTree.branchMap.get(ch.id)!.length}分支
                          </span>
                        )}
                      </button>
                      {(chapterTree.branchMap.get(ch.id) || []).map((branch: any) => (
                        <button
                          key={branch.id}
                          onClick={() => handleSelect(branch)}
                          className={cn(
                            'ml-5 flex w-[calc(100%-1.25rem)] items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-colors border-l border-amber-500/20',
                            selectedChapter?.id === branch.id
                              ? 'bg-amber-600/15 text-amber-300'
                              : 'text-gray-500 hover:bg-gray-800/60 hover:text-gray-300'
                          )}
                        >
                          <GitBranch className="h-3 w-3 shrink-0 text-amber-500/60" />
                          <span className="flex-1 truncate">第{branch.chapterNo}章 {branch.title}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {activeChapters.map((ch: any) => (
                    <button
                      key={ch.id}
                      onClick={() => handleSelect(ch)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                        selectedChapter?.id === ch.id
                          ? 'bg-indigo-600/20 text-indigo-300'
                          : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                      )}
                    >
                      <ChevronRight className="h-3 w-3 shrink-0" />
                      <span className="flex-1 truncate">
                        {ch.volumeNo ? `卷${ch.volumeNo} ` : ''}
                        第{ch.chapterNo}章 {ch.title}
                      </span>
                      {ch.branchParentChapterId && (
                        <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">分支</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 中间：阅读/编辑区 */}
        <div className="lg:col-span-5">
          {!selectedChapter ? (
            <Card className="flex h-96 items-center justify-center">
              <EmptyState
                icon={<BookOpen className="h-10 w-10" />}
                message="选择左侧章节开始阅读"
              />
            </Card>
          ) : (
            <Card className="h-full">
              {/* 章节头部信息 */}
              <div className="border-b border-gray-800 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-100">
                      第{selectedChapter.chapterNo}章 {selectedChapter.title}
                    </h2>
                    <div className="mt-1 flex items-center gap-3">
                      <Badge variant={statusConfig[selectedChapter.status]?.variant || 'default'}>
                        {statusConfig[selectedChapter.status]?.label || selectedChapter.status}
                      </Badge>
                      {selectedChapter.wordCount && (
                        <span className="text-xs text-gray-500">
                          {formatWordCount(selectedChapter.wordCount)}
                        </span>
                      )}
                      {selectedChapter.qualityScore && (
                        <span className="text-xs text-gray-500">
                          评分: {selectedChapter.qualityScore}/10
                        </span>
                      )}
                    </div>
                  </div>
                  {/* 模式切换（18-SRS 方案C R2：10→6 元素，分组 + 分隔线） */}
                  <div className="flex items-center gap-1">
                    <div className="flex rounded border border-gray-700 p-0.5">
                      <button
                        onClick={() => { setMode('read'); setAnalysisTool(null) }}
                        className={cn('flex items-center gap-1 rounded px-2.5 py-1.5 text-xs', mode === 'read' ? 'bg-amber-500/20 text-amber-300' : 'text-gray-500 hover:text-gray-300')}
                      >
                        <Eye className="h-3 w-3" />
                        阅读
                      </button>
                      <button
                        onClick={() => { startEdit(); setAnalysisTool(null) }}
                        className={cn('flex items-center gap-1 rounded px-2.5 py-1.5 text-xs', mode === 'edit' ? 'bg-amber-500/20 text-amber-300' : 'text-gray-500 hover:text-gray-300')}
                      >
                        <Edit3 className="h-3 w-3" />
                        编辑
                      </button>
                    </div>
                    <div className="mx-1 h-5 w-px bg-gray-700" />
                    <Button
                      variant={mode === 'versions' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setMode('versions')}
                    >
                      <History className="h-3.5 w-3.5" />
                      版本
                    </Button>
                    <Button
                      variant={mode === 'revise' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => { setMode('revise'); setReviseResult(null) }}
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      修订
                    </Button>
                    <div className="mx-1 h-5 w-px bg-gray-700" />
                    <Button
                      variant={mode === 'focus' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={enterFocus}
                      title="全屏免打扰写作（Esc 退出）"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                      专注
                    </Button>
                    {/* 导出 */}
                    <div className="relative">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-expanded={exportMenuOpen}
                        onClick={() => setExportMenuOpen(!exportMenuOpen)}
                      >
                        <Download className="h-3.5 w-3.5" />
                        导出
                      </Button>
                      {exportMenuOpen && (
                        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-36 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl">
                          <button onClick={() => handleExport('txt')} className="w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-800">TXT 整书</button>
                          <button onClick={() => handleExport('md')} className="w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-800">Markdown 整书</button>
                          {selectedChapter?.volumeNo && (
                            <>
                              <div className="my-1 border-t border-gray-800" />
                              <button onClick={() => handleExport('txt', selectedChapter.volumeNo)} className="w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-800">TXT 第{selectedChapter.volumeNo}卷</button>
                              <button onClick={() => handleExport('md', selectedChapter.volumeNo)} className="w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-800">MD 第{selectedChapter.volumeNo}卷</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 内容区域 */}
              <CardContent className="p-6">
                {/* 章信息仪表盘（天命P1#6） */}
                {selectedChapter.dashboard && (
                  <details className="mb-4 rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-2">
                    <summary className="cursor-pointer text-xs font-medium text-gray-400 hover:text-gray-200">
                      章信息仪表盘
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-400 md:grid-cols-3">
                      <span>类型：{({ progression: '推进', climax: '高潮', revelation: '揭露', buffer_price: '缓冲-代价', buffer_dialog: '缓冲-对话', buffer_clue: '缓冲-线索', singularity: '奇点' } as Record<string, string>)[selectedChapter.dashboard.chapterType] || selectedChapter.dashboard.chapterType || '推进'}</span>
                      {selectedChapter.dashboard.conflictRating && <span>冲突值：{selectedChapter.dashboard.conflictRating}</span>}
                      {selectedChapter.dashboard.isPeak && <span className="text-amber-400">峰值章节</span>}
                      <span>字数：{selectedChapter.dashboard.wordCount?.toLocaleString()}</span>
                      {selectedChapter.dashboard.styleScore != null && <span>文风得分：{selectedChapter.dashboard.styleScore}</span>}
                      {selectedChapter.dashboard.characters?.length > 0 && <span>出场：{selectedChapter.dashboard.characters.join('、')}</span>}
                      {selectedChapter.dashboard.hookType && <span>钩子：{selectedChapter.dashboard.hookType}{selectedChapter.dashboard.hookIntensity ? `(${selectedChapter.dashboard.hookIntensity})` : ''}</span>}
                    </div>
                  </details>
                )}

                {/* 阅读模式 */}
                {mode === 'read' && (
                  contentLoading ? (
                    <div className="flex justify-center py-12"><Spinner /></div>
                  ) : (
                    <>
                      <div className="prose-invert mx-auto max-w-2xl" ref={contentRef} onMouseUp={captureSelection}>
                        <div className="whitespace-pre-wrap text-base leading-8 text-gray-200">
                          {content?.content || content?.text || '暂无正文内容'}
                        </div>
                      </div>

                      {/* 选中文字操作栏 */}
                      {reviseSelectedText && mode === 'read' && (
                        <div className="mx-auto mt-3 flex max-w-2xl items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-4 py-2">
                          <span className="flex-1 truncate text-xs text-gray-400">
                            已选中：{reviseSelectedText.slice(0, 40)}{reviseSelectedText.length > 40 ? '…' : ''}
                          </span>
                          <Button size="sm" variant="outline" onClick={() => { setMode('revise'); setReviseResult(null) }}>
                            <Wand2 className="h-3 w-3" />
                            AI修订
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { setPerspectiveTarget(''); setShowPerspectiveDialog(true) }}>
                            <Users className="h-3 w-3" />
                            视角重写
                          </Button>
                          <button onClick={() => setReviseSelectedText('')} className="text-xs text-gray-500 hover:text-gray-300">清除</button>
                        </div>
                      )}

                      {/* 视角重写结果 */}
                      {perspectiveResult && mode === 'read' && (
                        <div className="mx-auto mt-4 max-w-2xl space-y-3 rounded-lg border border-purple-500/30 bg-purple-500/5 p-4">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-purple-300">
                              视角重写 → {perspectiveResult.targetCharacterName}
                            </span>
                            <button onClick={() => setPerspectiveResult(null)} className="text-xs text-gray-500 hover:text-gray-300">关闭</button>
                          </div>
                          <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-700 bg-gray-950 p-4">
                            <DiffView oldText={perspectiveResult.originalText || ''} newText={perspectiveResult.rewrittenText || ''} />
                          </div>
                          <p className="text-[11px] text-gray-600">
                            视角版本已自动保存（#{(perspectiveResult.versionIndex ?? 0) + 1}），原文不受影响。
                          </p>
                        </div>
                      )}
                    </>
                  )
                )}

                {/* 编辑模式 */}
                {mode === 'edit' && (
                  <div className="space-y-4">
                    {/* 查找替换工具栏 */}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setShowFindReplace(!showFindReplace)}
                      >
                        <Search className="h-3.5 w-3.5" />
                        查找替换
                      </Button>
                    </div>
                    {showFindReplace && (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/60 p-2">
                        <Input
                          value={findText}
                          onChange={(e) => setFindText(e.target.value)}
                          placeholder="查找..."
                          aria-label="查找"
                          className="h-7 w-40 text-xs"
                        />
                        <Input
                          value={replaceText}
                          onChange={(e) => setReplaceText(e.target.value)}
                          placeholder="替换为..."
                          aria-label="替换"
                          className="h-7 w-40 text-xs"
                        />
                        <span className="text-xs text-gray-500">{matchCount} 处匹配</span>
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={handleReplace} disabled={!matchCount}>
                          替换
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={handleReplaceAll} disabled={!matchCount}>
                          全部替换
                        </Button>
                      </div>
                    )}
                    <Textarea
                      rows={20}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="font-mono text-sm leading-relaxed"
                      placeholder="输入章节正文..."
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">
                        当前字数：{editContent.length}
                      </span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setMode('read')}>
                          取消
                        </Button>
                        <Button size="sm" onClick={handleSave} loading={saveMutation.isPending}>
                          <Save className="h-3.5 w-3.5" />
                          保存
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 词频/文风分析已迁移至右栏「章节分析」Tab（18-SRS 方案C R3：阅读区永显正文） */}

                {/* 版本历史模式 */}
                {mode === 'versions' && (
                  <div className="space-y-3">
                    {!versions?.length ? (
                      <EmptyState message="暂无版本历史" />
                    ) : (
                      versions.map((ver: any, i: number) => (
                        <div key={ver.id || i}>
                          <div className="rounded-lg border border-gray-800 p-4">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-gray-200">
                                版本 {versions.length - i}
                                {ver.isCurrent && <span className="ml-2 text-xs text-emerald-400">当前</span>}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500">
                                  {new Date(ver.createdAt).toLocaleString('zh-CN')}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => setDiffVersionId(diffVersionId === ver.id ? null : ver.id)}
                                >
                                  {diffVersionId === ver.id ? '收起对比' : '对比当前'}
                                </Button>
                              </div>
                            </div>
                            <p className="mt-2 text-sm text-gray-400 line-clamp-3">
                              {ver.content?.slice(0, 200) || ver.summary || '...'}
                            </p>
                            {ver.wordCount && (
                              <span className="mt-1 text-xs text-gray-600">
                                {formatWordCount(ver.wordCount)}
                              </span>
                            )}
                          </div>
                          {/* Diff对比展开区 */}
                          {diffVersionId === ver.id && (
                            <div className="mt-1 max-h-80 overflow-y-auto rounded-lg border border-gray-700 bg-gray-950 p-4">
                              <DiffView
                                oldText={ver.content || ''}
                                newText={content?.content || content?.text || ''}
                              />
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* AI修订模式 */}
                {mode === 'revise' && (
                  <div className="space-y-4">
                    {/* 选中文字提示 */}
                    {reviseSelectedText && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-amber-300">选中段落（重点修改）</span>
                          <button onClick={() => setReviseSelectedText('')} className="text-xs text-gray-500 hover:text-gray-300">清除</button>
                        </div>
                        <p className="mt-1 line-clamp-3 text-sm text-gray-400">{reviseSelectedText}</p>
                      </div>
                    )}

                    {/* 指令输入 */}
                    <div className="space-y-2">
                      <Textarea
                        rows={3}
                        value={reviseInstruction}
                        onChange={(e) => setReviseInstruction(e.target.value)}
                        placeholder="输入修改指令，如：把开头的对话改得更含蓄、增加环境描写、让张小凡的反应更符合他内向的性格..."
                        className="text-sm"
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">
                          {reviseSelectedText ? '已选中重点段落' : '提示：阅读模式下选中文字可指定重点修改区域'}
                        </span>
                        <Button size="sm" onClick={handleRevise} loading={reviseLoading} disabled={!reviseInstruction.trim()}>
                          <Wand2 className="h-3.5 w-3.5" />
                          AI修订
                        </Button>
                      </div>
                    </div>

                    {/* 修订结果 */}
                    {reviseResult && (
                      <div className="space-y-3">
                        {/* 修订说明 */}
                        {reviseResult.revisionNotes?.length > 0 && (
                          <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
                            <span className="text-xs font-medium text-gray-300">修订说明</span>
                            <ul className="mt-1 space-y-0.5">
                              {reviseResult.revisionNotes.map((n: string, i: number) => (
                                <li key={i} className="text-xs text-gray-400">• {n}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {/* Diff预览 */}
                        <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-700 bg-gray-950 p-4">
                          <DiffView
                            oldText={reviseResult.originalContent || ''}
                            newText={reviseResult.revisedContent || ''}
                          />
                        </div>
                        {/* 确认按钮 */}
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setReviseResult(null)}>
                            放弃
                          </Button>
                          <Button size="sm" onClick={handleConfirmRevise}>
                            <Save className="h-3.5 w-3.5" />
                            确认保存为新版本
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </CardContent>
            </Card>
          )}
        </div>

        {/* 右侧：剧情分支面板（选择下一章走向 + 原地生成）— 始终渲染以保持 3:5:4 布局 */}
        <div className="lg:col-span-4">
          {selectedChapter ? (
            <>
            <Card className="h-full">
              <CardContent className="overflow-y-auto p-4" style={{ maxHeight: '88vh' }}>
                {/* 18-SRS 方案C R1：右栏双Tab（剧情分支｜章节分析） */}
                <div className="mb-3 flex rounded border border-gray-700 p-0.5">
                  <button
                    onClick={() => setRightTab('branch')}
                    className={cn('flex flex-1 items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-xs', rightTab === 'branch' ? 'bg-amber-500/20 text-amber-300' : 'text-gray-500 hover:text-gray-300')}
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                    剧情分支
                  </button>
                  <button
                    onClick={() => setRightTab('analysis')}
                    className={cn('flex flex-1 items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-xs', rightTab === 'analysis' ? 'bg-amber-500/20 text-amber-300' : 'text-gray-500 hover:text-gray-300')}
                  >
                    <Feather className="h-3.5 w-3.5" />
                    章节分析
                  </button>
                </div>

                {rightTab === 'branch' && (
                <div>
                <div className="mb-1 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
                    <GitBranch className="h-4 w-4 text-indigo-400" />
                    剧情分支
                  </h3>
                </div>
                <p className="mb-2 text-xs text-gray-500">选择下一章走向</p>

                {/* 分支弧面板（12-SRS 动态叙事引擎：进度/汇合/废弃/提拔/回滚） */}
                <BranchArcPanel projectId={String(projectId)} />

                {/* 叙事方向（可选）：不选=AI自动推演并打标；选定=定向生成。两档合一，无需切换模式 */}
                <div className="mb-3 rounded-lg border border-gray-800 bg-gray-800/30 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-300">
                    <Compass className="h-3.5 w-3.5 text-indigo-400" />
                    叙事方向
                    <span className="font-normal text-gray-500">（可选，不选=AI自动推演）</span>
                  </p>
                  <select
                    value={targetMain ?? ''}
                    onChange={(e) => { setTargetMain(e.target.value || null); setTargetSecondary([]) }}
                    className="mb-2 w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-indigo-500"
                  >
                    <option value="">— 自动（不指定方向） —</option>
                    {(directionCatalog?.categories ?? []).map((cat: any) => (
                      <optgroup key={cat.code} label={cat.name}>
                        {(directionCatalog?.directions ?? [])
                          .filter((d: any) => d.category === cat.code)
                          .map((d: any) => (
                            <option key={d.code} value={d.code}>{d.name}</option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                  {/* 次方向（可选，≤2 个，不与主方向同大类） */}
                  {targetMain && (
                    <div className="mb-2">
                      <p className="mb-1 text-[11px] text-gray-500">次方向（可选，最多2个）</p>
                      <div className="flex flex-wrap gap-1">
                        {(directionCatalog?.directions ?? [])
                          .filter((d: any) => d.category !== directionByCode.get(targetMain)?.category)
                          .map((d: any) => {
                            const active = targetSecondary.includes(d.code)
                            return (
                              <button
                                key={d.code}
                                onClick={() =>
                                  setTargetSecondary((prev) =>
                                    active ? prev.filter((x) => x !== d.code) : prev.length < 2 ? [...prev, d.code] : prev
                                  )
                                }
                                className={cn(
                                  'rounded border px-1.5 py-0.5 text-[11px] transition-colors',
                                  active ? 'border-indigo-500/60 bg-indigo-600/30 text-indigo-200' : 'border-gray-700 text-gray-400 hover:text-gray-200'
                                )}
                              >
                                {d.name}
                              </button>
                            )
                          })}
                      </div>
                    </div>
                  )}
                  <Button
                    size="sm"
                    className="w-full"
                    loading={branchGenerating}
                    onClick={() => handleGenerateBranches(targetMain ? { main: targetMain, secondary: targetSecondary } : undefined)}
                  >
                    {targetMain ? <Target className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {targetMain ? '生成定向分支' : '自动生成分支'}
                  </Button>
                </div>

                {/* FUNC-03：待兑现因果链按钮 */}
                <button
                  onClick={toggleCausalCtx}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors',
                    causalCtxOpen ? 'border-orange-500/40 bg-orange-500/5' : 'border-gray-800 bg-gray-900/40 hover:border-gray-700',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <Link2 className="h-3 w-3 text-orange-400" />
                    待兑现因果链
                  </span>
                  <ChevronDown className={cn('h-3.5 w-3.5 text-gray-500 transition-transform', causalCtxOpen && 'rotate-180')} />
                </button>
                {causalCtxOpen && (
                  <div className="rounded-lg border border-orange-500/25 bg-orange-500/5 p-2.5">
                    {causalCtxLoading ? (
                      <p className="text-[11px] text-gray-500">正在加载因果链…</p>
                    ) : !causalCtx?.text ? (
                      <p className="text-[11px] text-gray-500">当前章节暂无待兑现因果线。</p>
                    ) : (
                      <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-orange-200/80">{causalCtx.text}</pre>
                    )}
                  </div>
                )}

                {/* 大类筛选芯片（客户端过滤分支列表） */}
                {(directionCatalog?.categories?.length ?? 0) > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    <button
                      onClick={() => setDirectionFilter(null)}
                      className={cn(
                        'rounded px-2.5 py-1.5 text-[11px] transition-colors',
                        !directionFilter ? 'bg-gray-600/60 text-gray-100' : 'bg-gray-800/60 text-gray-500 hover:text-gray-300'
                      )}
                    >
                      全部
                    </button>
                    {(directionCatalog?.categories ?? []).map((cat: any) => (
                      <button
                        key={cat.code}
                        onClick={() => setDirectionFilter(directionFilter === cat.code ? null : cat.code)}
                        className={cn(
                          'rounded px-2.5 py-1.5 text-[11px] transition-colors',
                          directionFilter === cat.code ? cn(cat.color, 'ring-1 ring-current') : 'bg-gray-800/60 text-gray-500 hover:text-gray-300'
                        )}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>
                )}

                {(() => {
                  const visibleOptions = (branchOptions?.options ?? []).filter((o: any) => {
                    if (!directionFilter) return true
                    const dir = o.mainDirection ? directionByCode.get(o.mainDirection) : null
                    return dir?.category === directionFilter
                  })
                  if (!branchOptions?.options?.length) {
                    return (
                      <p className="text-xs text-gray-600">
                        {branchGenerating ? '正在生成分支选项…' : '暂无分支选项，点击右上角按钮由 AI 推演下一章走向（含奇遇走向）。'}
                      </p>
                    )
                  }
                  if (!visibleOptions.length) {
                    return <p className="text-xs text-gray-600">当前大类下暂无分支选项。</p>
                  }
                  return (
                    <div className="space-y-2">
                      {visibleOptions.map((opt: any) => {
                        const mainDir = opt.mainDirection ? directionByCode.get(opt.mainDirection) : null
                        const mainCat = mainDir ? categoryByCode.get(mainDir.category) : null
                        return (
                          <div
                            key={opt.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => !opt.isSelected && !genStreaming && handleSelectBranch(opt.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); !opt.isSelected && !genStreaming && handleSelectBranch(opt.id) } }}
                            className={cn(
                              'w-full rounded-lg border p-3 text-left transition-colors',
                              opt.isSelected
                                ? 'border-indigo-500/60 bg-indigo-600/15'
                                : 'cursor-pointer border-gray-800 bg-gray-800/40 hover:border-indigo-500/40 hover:bg-gray-800',
                              (opt.isSelected || genStreaming) && 'cursor-default'
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5">
                                {/* 方向徽标（大类色标+方向名；未分类显示灰色） */}
                                {mainDir && mainCat ? (
                                  <Badge
                                    variant="default"
                                    className={cn('shrink-0 border-0 px-1.5 py-0 text-[10px]', mainCat.color)}
                                    title={mainDir.definition}
                                  >
                                    {mainDir.name}
                                  </Badge>
                                ) : (
                                  <Badge variant="default" className="shrink-0 border-0 bg-gray-700/60 px-1.5 py-0 text-[10px] text-gray-400">
                                    未分类
                                  </Badge>
                                )}
                                <span className={cn('truncate text-sm font-medium', opt.isSelected ? 'text-indigo-300' : 'text-gray-200')}>
                                  {opt.optionTitle}
                                </span>
                              </span>
                              <span className="flex shrink-0 items-center gap-1">
                                {/* ⚡ 影响预览切换（stopPropagation 防止触发分支选择） */}
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); toggleImpactPreview(opt.id) }}
                                  className={cn(
                                    'rounded p-1 transition-colors',
                                    impactExpanded[opt.id] ? 'bg-yellow-500/20 text-yellow-400' : 'text-gray-500 hover:bg-gray-700/60 hover:text-yellow-400'
                                  )}
                                  title="查看该走向的影响预览（数值/状态变化）"
                                >
                                  {impactLoading[opt.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                                </button>
                                {opt.derivedForeshadowCount > 0 && (
                                  <span
                                    title={`该分支已衍生 ${opt.derivedForeshadowCount} 条伏笔线索`}
                                    className="shrink-0 rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300"
                                  >
                                    伏笔×{opt.derivedForeshadowCount}
                                  </span>
                                )}
                                {opt.isSelected && (
                                  <Badge variant="default">已选择</Badge>
                                )}
                              </span>
                            </div>
                            {/* 次方向小徽标 */}
                            {opt.secondaryDirections?.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {opt.secondaryDirections.map((sc: string) => {
                                  const sd = directionByCode.get(sc)
                                  const scat = sd ? categoryByCode.get(sd.category) : null
                                  return sd ? (
                                    <span key={sc} className={cn('rounded px-1 py-0 text-[10px]', scat?.color ?? 'bg-gray-700/60 text-gray-400')}>
                                      {sd.name}
                                    </span>
                                  ) : null
                                })}
                              </div>
                            )}
                            <p className="mt-1 text-xs text-gray-400">{opt.optionDescription}</p>
                            {/* 分支弧提议（12-SRS：前提 + 预计章数 + 核心冲突） */}
                            {opt.branchPremise && (
                              <p className="mt-1 text-[11px] leading-relaxed text-indigo-300/80">
                                <span className="font-medium text-indigo-400">分支弧提议</span>
                                {' '}{opt.branchPremise}
                                <span className="ml-1 text-gray-500">
                                  （约{opt.estimatedLength ?? 2}章{opt.coreConflict ? `，核心冲突：${opt.coreConflict}` : ''}）
                                </span>
                              </p>
                            )}
                            {opt.sourceMaterials?.length > 0 && (
                              <div className="mt-2 flex flex-wrap items-center gap-1">
                                <span className="text-[10px] text-gray-500">借鉴素材</span>
                                {opt.sourceMaterials.map((m: any, i: number) => (
                                  <Badge
                                    key={i}
                                    variant="default"
                                    className={cn('border-0 px-1.5 py-0 text-[10px]', materialBadgeClass[m.label] || 'bg-gray-700/60 text-gray-400')}
                                    title={m.title}
                                  >
                                    {m.label}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            {opt.impactTags?.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {opt.impactTags.map((tag: string, i: number) => (
                                  <span key={i} className="rounded bg-gray-700/60 px-1.5 py-0.5 text-[10px] text-gray-400">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                            {/* ⚡ 影响预览展开区：数值前后对比 + 标签变化（预览=实际应用结果） */}
                            {impactExpanded[opt.id] && (
                              <div
                                className="mt-2 space-y-1.5 rounded-lg border border-yellow-500/25 bg-yellow-500/5 p-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <p className="flex items-center gap-1 text-[11px] font-medium text-yellow-400">
                                  <Zap className="h-3 w-3" />
                                  影响预览
                                </p>
                                {impactLoading[opt.id] ? (
                                  <p className="text-[11px] text-gray-500">正在计算影响…</p>
                                ) : !impactPreviews[opt.id]?.length ? (
                                  <p className="text-[11px] text-gray-500">该走向暂无绑定的影响变更。</p>
                                ) : (
                                  impactPreviews[opt.id].map((item: any, idx: number) => {
                                    const label = item.targetType === 'character'
                                      ? (item.characterName ?? `人物${item.targetId}`)
                                      : (item.region ? `世界·${item.region}` : '世界·全局')
                                    const before = item.before?.numericValues ?? {}
                                    const after = item.after?.numericValues ?? {}
                                    const changedKeys = Object.keys(after).filter((k) => after[k] !== before[k])
                                    const beforeTags: any[] = item.before?.tagStates ?? []
                                    const afterTags: any[] = item.after?.tagStates ?? []
                                    const addedTags = afterTags.filter((t) => !beforeTags.some((b) => b.tagKey === t.tagKey))
                                    const removedTags = beforeTags.filter((t) => !afterTags.some((b) => b.tagKey === t.tagKey))
                                    return (
                                      <div key={idx} className="text-[11px] leading-4">
                                        <span className="font-medium text-gray-300">{label}</span>
                                        {changedKeys.length > 0 && (
                                          <span className="ml-1 text-gray-400">
                                            {changedKeys.map((k) => {
                                              const def = impactDefByKey.get(k)
                                              const delta = after[k] - (before[k] ?? 0)
                                              return (
                                                <span key={k} className="mr-1.5">
                                                  {def?.name ?? k} {before[k] ?? 0}→{after[k]}
                                                  <span className={delta >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                                    （{delta >= 0 ? '+' : ''}{delta}）
                                                  </span>
                                                </span>
                                              )
                                            })}
                                          </span>
                                        )}
                                        {addedTags.map((t) => (
                                          <span key={t.tagKey} className="mr-1.5 text-sky-400">+{t.tagName}</span>
                                        ))}
                                        {removedTags.map((t) => (
                                          <span key={t.tagKey} className="mr-1.5 text-gray-500 line-through">-{t.tagName}</span>
                                        ))}
                                        {!changedKeys.length && !addedTags.length && !removedTags.length && (
                                          <span className="ml-1 text-gray-600">（无可见变化）</span>
                                        )}
                                      </div>
                                    )
                                  })
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      <p className="pt-1 text-[11px] text-gray-600">
                        选择后将衍生下一章计划；若下一章已生成则需先处理后才能改选。
                      </p>
                    </div>
                  )
                })()}

                {/* 连续方向告警（回溯已选定分支链，连续同方向超阈值时弱提示） */}
                {directionCheck?.warning && (
                  <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <p className="text-[11px] leading-4 text-amber-300/90">
                      「{directionCheck.categoryName}」方向已连续 {directionCheck.consecutiveCount} 章（阈值 {directionCheck.maxAllowed}），建议切换叙事方向以调节节奏。
                    </p>
                  </div>
                )}

                {/* 影响→方向 弱推荐（基于当前影响状态给出方向提示，仅供参考不强制） */}
                {!!directionRecommend?.length && (
                  <div className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-2">
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-cyan-300">
                      <Compass className="h-3.5 w-3.5" />
                      状态驱动方向参考
                    </p>
                    <div className="space-y-1">
                      {directionRecommend.map((r: any) => (
                        <p key={r.directionCode} className="text-[11px] leading-4 text-cyan-200/80">
                          <span className="font-medium text-cyan-300">{r.directionName}</span>
                          <span className="text-cyan-400/60"> · {r.reason}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* 后续走向推演（基于人物/宗门规制/岁时节令/文风的世界观推演） */}
                {branchOptions?.prediction && (
                  <div className="mt-4 rounded-lg border border-gray-800 bg-gray-800/30 p-3">
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-300">
                      <Feather className="h-3.5 w-3.5 text-violet-400" />
                      后续走向推演
                    </p>
                    <p className="text-xs leading-5 text-gray-400">{branchOptions.prediction}</p>
                  </div>
                )}

                {/* 选定分支后：原地生成下一章 */}
                {effectiveDerivedPlan && (
                  <div className="mt-4 border-t border-gray-800 pt-4">
                    <p className="mb-2 text-xs text-gray-400">
                      已选定走向，可立即生成下一章：
                      <span className="text-gray-200">第{effectiveDerivedPlan.chapterNo}章 {effectiveDerivedPlan.title}</span>
                    </p>
                    {!genStreaming && genPhase !== 'complete' ? (
                      <Button size="sm" className="w-full" onClick={handleGenerateNextChapter}>
                        <Sparkles className="h-3.5 w-3.5" />
                        立即生成下一章
                      </Button>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 text-indigo-300">
                            {genStreaming && <Loader2 className="h-3 w-3 animate-spin" />}
                            {({
                              queued: '排队中', context: '编排上下文', writing: '写作中',
                              auditing: '审计中', revising: '修订中', complete: '已完成', error: '错误',
                            } as Record<string, string>)[genPhase] || genPhase}
                          </span>
                          {genStreaming && (
                            <Button variant="ghost" size="sm" onClick={cancelGeneration}>取消</Button>
                          )}
                        </div>
                        {genStreaming && genText && (
                          <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950/50 p-2 text-xs text-gray-400">
                            {genText.slice(-400)}
                          </div>
                        )}
                        {genPhase === 'complete' && (
                          <p className="text-xs text-emerald-400">生成完成，左侧章节列表已刷新。</p>
                        )}
                      </div>
                    )}
                </div>
                )}
                </div>
                )}

                {/* 18-SRS 方案C：章节分析Tab（词频/文风内联展示，审计/润色触发原弹窗） */}
                {rightTab === 'analysis' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={enterStyleMode}
                        className={cn(
                          'flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-colors',
                          analysisTool === 'style'
                            ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300'
                            : 'border-gray-800 bg-gray-900/40 text-gray-400 hover:bg-gray-800'
                        )}
                      >
                        <Feather className="h-4 w-4" />
                        文风校验
                      </button>
                      <button
                        onClick={() => setAnalysisTool('wordfreq')}
                        title="正文高频词/口头禅统计（纯本地零token）"
                        className={cn(
                          'flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-colors',
                          analysisTool === 'wordfreq'
                            ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300'
                            : 'border-gray-800 bg-gray-900/40 text-gray-400 hover:bg-gray-800'
                        )}
                      >
                        <BarChart3 className="h-4 w-4" />
                        词频
                        <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] text-emerald-400">本地·零token</span>
                      </button>
                      <button
                        onClick={handleQualityAudit}
                        disabled={qualityAuditLoading}
                        className="flex flex-col items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-900/40 p-3 text-xs text-gray-400 transition-colors hover:bg-gray-800 disabled:opacity-50"
                      >
                        {qualityAuditLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                        质量审计
                      </button>
                      <button
                        onClick={() => setShowPolishModal(true)}
                        title="独立润色：不推进剧情，仅优化当前版本语言质量"
                        className="flex flex-col items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-900/40 p-3 text-xs text-gray-400 transition-colors hover:bg-gray-800"
                      >
                        <Sparkles className="h-4 w-4" />
                        润色
                      </button>
                    </div>

                    {analysisTool === 'wordfreq' && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <Button
                            variant={wordfreqScope === 'chapter' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setWordfreqScope('chapter')}
                          >
                            当前章
                          </Button>
                          <Button
                            variant={wordfreqScope === 'book' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setWordfreqScope('book')}
                            disabled={bookTextLoading}
                          >
                            {bookTextLoading ? '整书加载中…' : '整书'}
                          </Button>
                          {wordfreqResult && (
                            <span className="ml-2 text-xs text-gray-500">
                              有效字数 {wordfreqResult.totalChars}
                            </span>
                          )}
                        </div>

                        {wordfreqResult?.catchphrases.length ? (
                          <Card className="border-amber-500/30 bg-amber-500/5 p-3">
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="h-4 w-4 text-amber-400" />
                              <span className="text-sm font-medium text-amber-200">
                                疑似口头禅（每千字 &gt; 3 次）
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {wordfreqResult.catchphrases.map((i) => (
                                <Badge key={i.word} variant="warning">
                                  {i.word} ×{i.count}（{i.perKilo.toFixed(1)}/千字）
                                </Badge>
                              ))}
                            </div>
                          </Card>
                        ) : null}

                        {!wordfreqResult ? (
                          <EmptyState message={wordfreqText ? '正在统计…' : '暂无正文可分析'} />
                        ) : !wordfreqResult.items.length ? (
                          <EmptyState message="未检出高频词（词频 ≥3 才计入）" />
                        ) : (
                          <div className="grid grid-cols-1 gap-2">
                            {wordfreqResult.items.map((i, idx) => (
                              <div
                                key={i.word}
                                role="button"
                                tabIndex={0}
                                onClick={() => setWordSearch(i.word)}
                                onKeyDown={(e) => { if (e.key === 'Enter') setWordSearch(i.word) }}
                                className={cn(
                                  'flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors cursor-pointer',
                                  wordSearch === i.word
                                    ? 'border-indigo-500/70 bg-indigo-500/10'
                                    : 'border-gray-800 bg-gray-900/40 hover:border-gray-700',
                                )}
                              >
                                <span className="w-6 shrink-0 text-right font-mono text-xs text-gray-500">#{idx + 1}</span>
                                <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{i.word}</span>
                                {i.isCatchphrase && <Badge variant="warning">口头禅</Badge>}
                                <span className="shrink-0 text-xs text-gray-400">{i.count} 次</span>
                                <span className="w-20 shrink-0 text-right text-xs text-gray-600">{i.perKilo.toFixed(2)}/千字</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {analysisTool === 'style' && (
                      <div className="space-y-5">
                        {styleLoading ? (
                          <div className="flex flex-col items-center justify-center gap-2 py-12">
                            <Spinner />
                            <span className="text-xs text-gray-500">正在依据文风引擎配置校验本章…</span>
                          </div>
                        ) : !styleRecord ? (
                          <div className="flex flex-col items-center justify-center gap-3 py-12">
                            <Feather className="h-10 w-10 text-gray-600" />
                            <p className="text-sm text-gray-500">尚未对本章做文风校验</p>
                            <Button size="sm" onClick={handleAuditStyle}>
                              <Feather className="h-3.5 w-3.5" />
                              开始文风校验
                            </Button>
                          </div>
                        ) : (
                          <>
                            {/* 综合得分 */}
                            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-4">
                              <div className="flex items-baseline gap-3">
                                <span className="text-3xl font-bold text-gray-100">{styleRecord.overallScore}</span>
                                <span className={cn('text-sm font-medium', scoreGrade(styleRecord.overallScore).color)}>
                                  {scoreGrade(styleRecord.overallScore).label}
                                </span>
                                <span className="text-xs text-gray-500">综合文风得分 · 共 {styleRecord.issueCount} 个问题</span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button variant="ghost" size="sm" onClick={handleStyleHistory}>
                                  <History className="h-3.5 w-3.5" />
                                  历史
                                </Button>
                                <Button variant="outline" size="sm" onClick={handleAuditStyle} loading={styleLoading}>
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  重新校验
                                </Button>
                                <Button size="sm" onClick={handleStyleRevise} loading={styleReviseLoading} disabled={!styleRecord.issueCount}>
                                  <Wand2 className="h-3.5 w-3.5" />
                                  一键修改
                                </Button>
                              </div>
                            </div>

                            {/* 维度分项得分 */}
                            <div className="grid grid-cols-1 gap-2">
                              {Object.entries(styleRecord.dimensionScores || {}).map(([dim, score]: [string, any]) => {
                                const abnormal = score < 70
                                return (
                                  <div key={dim} className="rounded-lg border border-gray-800 p-2.5">
                                    <div className="mb-1 flex items-center justify-between text-xs">
                                      <span className={cn('font-medium', abnormal ? 'text-amber-300' : 'text-gray-300')}>
                                        {dim}{abnormal && <AlertTriangle className="ml-1 inline h-3 w-3" />}
                                      </span>
                                      <span className={cn(abnormal ? 'text-amber-400' : 'text-gray-400')}>{score}</span>
                                    </div>
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                                      <div
                                        className={cn('h-full rounded-full', abnormal ? 'bg-amber-500' : 'bg-emerald-500')}
                                        style={{ width: `${score}%` }}
                                      />
                                    </div>
                                  </div>
                                )
                              })}
                            </div>

                            {/* 修订结果预览 */}
                            {styleReviseResult && (
                              <div className="space-y-3 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4">
                                <span className="text-xs font-medium text-indigo-300">文风修订预览（确认后保存为新版本）</span>
                                {styleReviseResult.revisionNotes?.length > 0 && (
                                  <ul className="space-y-0.5">
                                    {styleReviseResult.revisionNotes.map((n: string, i: number) => (
                                      <li key={i} className="text-xs text-gray-400">• {n}</li>
                                    ))}
                                  </ul>
                                )}
                                <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-700 bg-gray-950 p-4">
                                  <DiffView oldText={styleReviseResult.originalContent || ''} newText={styleReviseResult.revisedContent || ''} />
                                </div>
                                <div className="flex justify-end gap-2">
                                  <Button variant="outline" size="sm" onClick={() => setStyleReviseResult(null)}>放弃</Button>
                                  <Button size="sm" onClick={handleConfirmStyleRevise}>
                                    <Save className="h-3.5 w-3.5" />
                                    确认保存为新版本
                                  </Button>
                                </div>
                              </div>
                            )}

                            {/* 问题清单（按维度分组，点击定位高亮原文） */}
                            {styleRecord.issueCount > 0 ? (
                              <div className="space-y-3">
                                <h4 className="text-sm font-medium text-gray-300">问题清单（点击可在下方正文定位）</h4>
                                {Object.entries(
                                  (styleRecord.issues || []).reduce((acc: Record<string, any[]>, issue: any) => {
                                    (acc[issue.dimension] = acc[issue.dimension] || []).push(issue)
                                    return acc
                                  }, {})
                                ).map(([dim, list]: [string, any]) => (
                                  <div key={dim} className="rounded-lg border border-gray-800">
                                    <div className="border-b border-gray-800 px-3 py-1.5 text-xs font-medium text-gray-400">
                                      {dim}（{list.length}）
                                    </div>
                                    <div className="divide-y divide-gray-800/60">
                                      {list.map((issue: any, i: number) => {
                                        const flatIdx = (styleRecord.issues as any[]).indexOf(issue)
                                        const ignored = ignoredIssues.has(`style-${flatIdx}`)
                                        const actionable = issue.severity === 'critical' || issue.severity === 'major'
                                        const locate = () => issue.excerpt && setActiveExcerpt(issue.excerpt)
                                        return (
                                          <div
                                            key={i}
                                            className={cn(
                                              'flex items-start justify-between gap-2 px-3 py-2 transition-colors',
                                              ignored && 'opacity-50'
                                            )}
                                          >
                                            <div
                                              role="button"
                                              tabIndex={0}
                                              onClick={locate}
                                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); locate() } }}
                                              className={cn(
                                                'min-w-0 flex-1 text-left',
                                                issue.excerpt ? 'cursor-pointer' : 'cursor-default'
                                              )}
                                            >
                                              <div className="flex items-center gap-2">
                                                <Badge variant={issue.severity === 'critical' ? 'destructive' : issue.severity === 'major' ? 'warning' : 'default'}>
                                                  {issue.severity}
                                                </Badge>
                                                {issue.aiFlavorType && (
                                                  <Badge variant="default" className="text-[10px] px-1 py-0 bg-purple-500/20 text-purple-400 border-0">
                                                    {({ empty_summary: '空泛总结', cliche_atmosphere: '套话氛围', adjective_stack: '形容堆叠', explanatory_dialogue: '解释腔', uniform_rhythm: '平均工整', cliche_metaphor: '陈词比喻', parallel_padding: '排比堆砌', psych_overload: '心理过载' } as Record<string, string>)[issue.aiFlavorType] || issue.aiFlavorType}
                                                  </Badge>
                                                )}
                                                <span className="text-sm text-gray-300">{issue.description}</span>
                                              </div>
                                              {issue.excerpt && (
                                                <p className="mt-1 truncate pl-1 text-xs text-amber-400/80">原文：{issue.excerpt}</p>
                                              )}
                                              {issue.suggestion && (
                                                <p className="mt-0.5 pl-1 text-xs text-gray-500">建议：{issue.suggestion}</p>
                                              )}
                                            </div>
                                            <div className="flex shrink-0 gap-1">
                                              <Button variant="ghost" size="sm" onClick={() => handleIgnoreIssue('style', flatIdx)}>
                                                {ignored ? '撤销' : '忽略'}
                                              </Button>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={!actionable || ignored}
                                                onClick={() => handleFixSingle('style', issue, flatIdx)}
                                              >
                                                <Wand2 className="h-3 w-3" />
                                                修改
                                              </Button>
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-emerald-400">未发现文风问题，本章符合文风引擎设定。</p>
                            )}

                            {/* 正文（高亮定位区） */}
                            <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-5">
                              <h4 className="mb-3 text-xs font-medium text-gray-500">正文{activeExcerpt ? '（已高亮定位违规片段）' : ''}</h4>
                              <div className="max-h-[32rem] overflow-y-auto">
                                <HighlightedContent
                                  content={content?.content || content?.text || ''}
                                  highlight={activeExcerpt}
                                  searchWord={wordSearch || undefined}
                                />
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 影响台账：变更历史审计轨迹（数值权威状态的来龙去脉） */}
            <Card className="mt-4">
              <CardContent className="p-4">
                <button
                  type="button"
                  onClick={() => setImpactLedgerOpen((o) => !o)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-gray-200">
                    <Zap className="h-4 w-4 text-yellow-400" />
                    影响台账
                  </span>
                  <ChevronRight className={cn('h-4 w-4 text-gray-500 transition-transform', impactLedgerOpen && 'rotate-90')} />
                </button>
                {impactLedgerOpen && (
                  <div className="mt-3 space-y-2">
                    {!impactHistory?.length ? (
                      <p className="text-xs text-gray-600">暂无影响变更记录。选择带 ⚡ 影响的分支后，变更将记录在此。</p>
                    ) : (
                      impactHistory.map((h: any) => {
                        const before = h.snapshotBefore?.numericValues ?? {}
                        const after = h.snapshotAfter?.numericValues ?? {}
                        const target: string = h.snapshotAfter?.target ?? h.snapshotBefore?.target ?? ''
                        const targetLabel = target.startsWith('character:')
                          ? `人物#${target.split(':')[1]}`
                          : target.startsWith('world:')
                            ? (target.split(':')[1] === 'global' ? '世界·全局' : `世界·${target.split(':')[1]}`)
                            : target
                        const changedKeys = Object.keys(after).filter((k) => after[k] !== before[k])
                        const bTags: any[] = h.snapshotBefore?.tagStates ?? []
                        const aTags: any[] = h.snapshotAfter?.tagStates ?? []
                        const addedTags = aTags.filter((t) => !bTags.some((b) => b.tagKey === t.tagKey))
                        const removedTags = bTags.filter((t) => !aTags.some((b) => b.tagKey === t.tagKey))
                        return (
                          <div key={h.id} className="rounded-lg border border-gray-800 bg-gray-800/30 p-2">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-medium text-gray-300">第{h.chapterNo}章 · {targetLabel}</span>
                              <span className="text-gray-600">{h.sourceType === 'branch' ? '分支选择' : h.sourceType}</span>
                            </div>
                            {(changedKeys.length > 0 || addedTags.length > 0 || removedTags.length > 0) && (
                              <div className="mt-1 text-[11px] leading-4 text-gray-400">
                                {changedKeys.map((k) => {
                                  const def = impactDefByKey.get(k)
                                  const delta = after[k] - (before[k] ?? 0)
                                  return (
                                    <span key={k} className="mr-1.5">
                                      {def?.name ?? k} {before[k] ?? 0}→{after[k]}
                                      <span className={delta >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                        （{delta >= 0 ? '+' : ''}{delta}）
                                      </span>
                                    </span>
                                  )
                                })}
                                {addedTags.map((t) => (
                                  <span key={t.tagKey} className="mr-1.5 text-sky-400">+{t.tagName}</span>
                                ))}
                                {removedTags.map((t) => (
                                  <span key={t.tagKey} className="mr-1.5 text-gray-500 line-through">-{t.tagName}</span>
                                ))}
                              </div>
                            )}
                            {h.operatorNote && <p className="mt-1 text-[10px] text-gray-600">{h.operatorNote}</p>}
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            </>
          ) : (
            <Card className="h-full">
              <CardContent className="flex h-48 flex-col items-center justify-center gap-2 p-4 text-center">
                <GitBranch className="h-8 w-8 text-gray-600" />
                <p className="text-xs leading-5 text-gray-500">
                  选择左侧章节后，可在此推演下一章走向
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* 独立润色弹窗（架构升级 Epic3） */}
      {selectedChapter?.id && (
        <PolishModal
          projectId={projectId}
          chapterPlanId={String(selectedChapter.id)}
          open={showPolishModal}
          onClose={() => setShowPolishModal(false)}
          onApplied={() => {
            queryClient.invalidateQueries({ queryKey: ['chapter-content', projectId, selectedChapter?.id] })
            queryClient.invalidateQueries({ queryKey: ['chapter-versions', projectId, selectedChapter?.id] })
          }}
        />
      )}

      {/* 视角重写对话框 */}
      <Dialog open={showPerspectiveDialog} onClose={() => setShowPerspectiveDialog(false)} title="段落视角重写">
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
            <span className="text-xs font-medium text-gray-400">选中段落</span>
            <p className="mt-1 line-clamp-4 text-sm text-gray-300">{reviseSelectedText}</p>
          </div>
          <Input
            label="目标视角人物 *"
            placeholder="如 张小凡（将以该人物的视角重写选中段落）"
            value={perspectiveTarget}
            onChange={(e) => setPerspectiveTarget(e.target.value)}
          />
          <p className="text-xs text-gray-500">
            重写后保持事件/场景/对话不变，仅切换内心体验与感知范围，结果自动存为视角版本（不影响原文）。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowPerspectiveDialog(false)}>取消</Button>
            <Button onClick={handlePerspectiveRewrite} loading={perspectiveLoading} disabled={!perspectiveTarget.trim()}>
              <Users className="h-3.5 w-3.5" />
              开始重写
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 文风校验历史记录 */}
      <Dialog open={showStyleHistory} onClose={() => setShowStyleHistory(false)} title="文风校验历史">
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {styleHistoryList.length === 0 ? (
            <EmptyState message="暂无历史校验记录" />
          ) : (
            styleHistoryList.map((r: any) => (
              <button
                key={r.id}
                onClick={() => handleViewAuditDetail(r.id)}
                className={cn(
                  'block w-full rounded-lg border p-3 text-left transition-colors hover:bg-gray-800/60',
                  styleRecord?.id === r.id ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-gray-700'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-lg font-bold', scoreGrade(r.overallScore).color)}>{r.overallScore}</span>
                    <span className="text-xs text-gray-500">{r.issueCount} 个问题</span>
                  </div>
                  <span className="text-xs text-gray-500">{new Date(r.createdAt).toLocaleString()}</span>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <Badge variant={r.status === 'completed' ? 'success' : 'default'}>{r.status}</Badge>
                  {styleRecord?.id === r.id && <span className="text-xs text-indigo-400">当前查看</span>}
                </div>
              </button>
            ))
          )}
        </div>
      </Dialog>

      {/* 29维质量审计结果 */}
      <Dialog open={showQualityAudit} onClose={() => setShowQualityAudit(false)} title="29维质量审计">
        <div className="space-y-4">
          {qualityAuditLoading && (
            <div className="flex flex-col items-center gap-3 py-10">
              <Spinner className="h-8 w-8" />
              <p className="text-sm text-gray-400">正在进行29维质量审计，请稍候...</p>
            </div>
          )}
          {!qualityAuditLoading && qualityAuditResult && (
            <>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
                <div className="flex items-center gap-3">
                  <span className={cn('text-3xl font-bold', scoreGrade(qualityAuditResult.overallScore).color)}>
                    {qualityAuditResult.overallScore}
                  </span>
                  <div>
                    <span className={cn('text-sm font-medium', scoreGrade(qualityAuditResult.overallScore).color)}>
                      {scoreGrade(qualityAuditResult.overallScore).label}
                    </span>
                    <p className="text-xs text-gray-500">
                      共 {qualityAuditResult.issues?.length ?? 0} 个问题
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={handleFixAllQuality}
                  loading={fixAllLoading}
                  disabled={!(qualityAuditResult.issues || []).some(
                    (i: any, idx: number) =>
                      (i.severity === 'critical' || i.severity === 'major' || i.severity === 'minor') && !ignoredIssues.has(`quality-${idx}`)
                  )}
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  一键修改
                </Button>
              </div>
              <div className="max-h-96 space-y-2 overflow-y-auto">
                {(qualityAuditResult.issues || []).map((issue: any, idx: number) => {
                  const ignored = ignoredIssues.has(`quality-${idx}`)
                  // minor 也可修改（info 为提醒类不修）
                  const actionable = issue.severity === 'critical' || issue.severity === 'major' || issue.severity === 'minor'
                  return (
                    <div key={idx} className={cn('rounded-lg border border-gray-700 p-3', ignored && 'opacity-50')}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={issue.severity === 'critical' ? 'destructive' : issue.severity === 'major' ? 'warning' : 'default'}>
                              {issue.severity}
                            </Badge>
                            <span className="text-xs font-medium text-gray-300">{issue.dimension}</span>
                          </div>
                          <p className="mt-1.5 text-sm text-gray-300">{issue.description}</p>
                          {issue.suggestion && (
                            <p className="mt-1 text-xs text-gray-500">建议：{issue.suggestion}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleIgnoreIssue('quality', idx)}>
                            {ignored ? '撤销' : '忽略'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!actionable || ignored}
                            onClick={() => handleFixSingle('quality', issue, idx)}
                          >
                            <Wand2 className="h-3 w-3" />
                            修改
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
                {(!qualityAuditResult.issues || qualityAuditResult.issues.length === 0) && (
                  <EmptyState message="未发现问题，章节质量优秀" />
                )}
              </div>
            </>
          )}
        </div>
      </Dialog>

      {/* 审计问题修改预览（质量/文风共用） */}
      <FixConfirmDialog
        open={!!fixingIssue && !!fixResult}
        title={fixingIssue?.index === -1 ? '一键修改预览' : '修改预览'}
        issue={fixingIssue?.issue ?? undefined}
        revisionNotes={fixResult?.revisionNotes}
        originalContent={fixResult?.originalContent}
        revisedContent={fixResult?.revisedContent}
        loading={fixLoading || fixAllLoading}
        onConfirm={handleConfirmFix}
        onRegenerate={handleRegenerateFix}
        onCancel={() => { setFixResult(null); setFixingIssue(null) }}
      />
    </div>
  )
}
