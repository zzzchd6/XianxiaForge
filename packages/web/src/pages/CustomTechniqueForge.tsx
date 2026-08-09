import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  Plus, Trash2, Eye, Sparkles, Dice5, Lock, Unlock, ChevronLeft, ChevronRight,
  ScrollText, BookOpen, Dices, Download, RefreshCw, Copy, Upload,
} from 'lucide-react'
import {
  Card, CardContent, Badge, Button, Spinner, EmptyState, Dialog, useToast, Textarea,
} from '../components/ui'
import { customTechniquesApi, customCharacterApi, techniqueVariantsApi, worldApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import { ImportFromProjectDialog } from '../components/ImportFromProjectDialog'
import { cn } from '../lib/utils'

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

const COMPAT_STYLE: Record<string, string> = {
  high: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  mid: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  clash: 'border-red-500/40 bg-red-500/15 text-red-300',
}
const COMPAT_SHORT: Record<string, string> = { high: '高兼容', mid: '中兼容', clash: '对冲' }

// 道则组合「化学反应」文案（13-SRS US-20c：预设特殊对文案，其余按兼容度走通用文案）
const REACTION_TEXT: Record<string, string> = {
  // 对冲
  'gengjin|kunearth': '锐重相冲——至坚对至厚，功成则惊天，败则道基崩',
  'mingshi|xingzhi': '蚀质相冲——衰朽侵形质，肉身难久持，须以灵药续命',
  'lingqi|mingshi': '蚀能相冲——灵气随修随散，事倍功半，进境迟滞',
  // 高兼容
  'mingshi|thunder': '电蚀相生——雷腐合一，衰变中藏雷机，成毁由心',
  'suishi|void': '宙宇相映——时空交织，一念可跨山河，身法通玄',
  'lingqi|xingzhi': '质能互化——形质与灵气相生，万物可炼，炼化通神',
  'gengjin|xingzhi': '锐质相成——以形载锐，器成则利，铸体成兵',
  'gengjin|lingqi': '锐能合一——金锐得灵气而愈锋，一剑可裂山岳',
  'kunearth|xingzhi': '厚载万物——土德孕育形质，根基浑厚，后劲绵长',
  'thunder|xingzhi': '雷炼形质——雷霆淬体，破而后立，肉身成圣',
  'lingqi|thunder': '雷灵相激——灵气化雷，声势骇人，出手便是天威',
  'gengjin|shenhun': '剑意封魂——锐气为魂之载，一剑可慑三魂七魄',
  'lingqi|shenhun': '神御灵气——神魂驭气，意到气到，方寸之内尽在掌中',
}
const REACTION_FALLBACK: Record<string, string> = {
  high: '道则共鸣，相辅相成，修时事半功倍',
  mid: '道则相融，稳步可修',
  clash: '道则相冲，凶险异常，非大毅力不可驾驭',
}
const REACTION_STYLE: Record<string, string> = {
  high: 'border-gold-500/50 bg-gold-500/10 text-gold-200',
  mid: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  clash: 'border-red-500/50 bg-red-500/10 text-red-200',
}

const GUIDANCE_LABELS: Record<string, string> = {
  rudimentary: '入门指引', complete: '完整传承', essential: '直指本源',
}
const GUIDANCE_COLORS: Record<string, string> = {
  rudimentary: 'border-gray-500/30 bg-gray-500/15 text-gray-300',
  complete: 'border-blue-500/30 bg-blue-500/15 text-blue-300',
  essential: 'border-purple-500/30 bg-purple-500/15 text-purple-300',
}
const RARITY_LABELS: Record<string, string> = { normal: '普通', rare: '稀有', legendary: '传说' }
const RARITY_TEXT: Record<string, string> = { normal: 'text-gray-300', rare: 'text-blue-300', legendary: 'text-amber-300' }
const BACKLASH_RISK_COLOR: Record<string, string> = {
  '低': 'text-gray-400', '中': 'text-amber-300', '中高': 'text-orange-300', '高': 'text-red-300', '极高': 'text-red-400',
}

/* ------------------------------------------------------------------ */
/* 词条解析器                                                          */
/* ------------------------------------------------------------------ */

function makeResolver(catalog: any) {
  const daoRules: any[] = catalog?.daoRules || []
  const coreTraits: any[] = catalog?.coreTraits || []
  const practicePaths: any[] = catalog?.practicePaths || []
  const abilities: any[] = catalog?.abilities || []
  const backlashes: any[] = catalog?.backlashes || []
  const inheritances: any[] = catalog?.inheritances || []
  const thresholds: any[] = catalog?.thresholds || []
  const usageSkills: any[] = catalog?.usageSkills || []
  const evolutions: any[] = catalog?.evolutions || []
  const conflicts: any[] = catalog?.inherentConflicts || []
  const idx = (arr: any[]) => new Map(arr.map((x) => [x.id, x]))
  const daoIdx = idx(daoRules)
  return {
    daoName: (id: string) => daoIdx.get(id)?.name?.replace('道则', '') || id || '—',
    daoFull: (id: string) => daoIdx.get(id)?.name || id || '—',
    dao: (id: string) => daoIdx.get(id),
    coreTrait: (id: string) => coreTraits.find((t) => t.id === id),
    coreTraitName: (id: string) => coreTraits.find((t) => t.id === id)?.name || id,
    pathName: (id: string) => practicePaths.find((p) => p.id === id)?.name || id,
    ability: (id: string) => abilities.find((a) => a.id === id),
    abilityName: (id: string) => abilities.find((a) => a.id === id)?.name || id,
    backlash: (id: string) => backlashes.find((b) => b.id === id),
    backlashName: (id: string) => backlashes.find((b) => b.id === id)?.name || id,
    inheritanceName: (id: string) => inheritances.find((i) => i.id === id)?.name || id,
    thresholdName: (id: string) => thresholds.find((t) => t.id === id)?.name || id,
    skillText: (id: string) => usageSkills.find((s) => s.id === id)?.text || id,
    evolutionName: (id: string) => evolutions.find((e) => e.id === id)?.name || id,
    conflictName: (id: string) => conflicts.find((c) => c.id === id)?.name || id,
  }
}
type Resolver = ReturnType<typeof makeResolver>

/* ------------------------------------------------------------------ */
/* 小组件                                                              */
/* ------------------------------------------------------------------ */

function SelTag({
  active, disabled, onClick, title, children,
}: { active: boolean; disabled?: boolean; onClick?: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
        disabled
          ? 'cursor-not-allowed border-gray-800 bg-gray-900/40 text-gray-600 opacity-60'
          : active
            ? 'border-gold-400 bg-gold-500/15 text-gold-200'
            : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-600'
      )}
    >
      {children}
    </button>
  )
}

function MiniBtn({
  onClick, title, active, children,
}: { onClick?: () => void; title?: string; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn('rounded p-2 transition-colors', active ? 'text-gold-300' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300')}
    >
      {children}
    </button>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h4 className="text-sm font-semibold text-gray-200">{title}</h4>
        {hint && <span className="text-[11px] text-gray-500">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function PreviewRow({
  label, children, onDice, onLock, locked,
}: { label: string; children: React.ReactNode; onDice?: () => void; onLock?: () => void; locked?: boolean }) {
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1">
        <span className="text-[11px] uppercase tracking-wider text-gray-500">{label}</span>
        <span className="ml-auto flex items-center">
          {onDice && <MiniBtn onClick={onDice} title={`随机${label}`}><Dice5 className="h-3 w-3" /></MiniBtn>}
          {onLock && (
            <MiniBtn onClick={onLock} title={locked ? '已锁定（全随机时保留）' : '锁定'} active={locked}>
              {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
            </MiniBtn>
          )}
        </span>
      </div>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 主页面                                                              */
/* ------------------------------------------------------------------ */

export default function CustomTechniqueForge() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const projectId = useCurrentProjectId()

  const [forgeOpen, setForgeOpen] = useState(false)
  const [copySource, setCopySource] = useState<any>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [projectImportOpen, setProjectImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [fileImportOpen, setFileImportOpen] = useState(false)
  const [detail, setDetail] = useState<any>(null)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  // 实体状态筛选（09-自动维护 US-4）
  const [statusFilter, setStatusFilter] = useState<'all' | 'official' | 'draft'>('all')

  const { data: techniques = [], isLoading } = useQuery({
    queryKey: ['custom-techniques', projectId],
    queryFn: () => customTechniquesApi.list(projectId),
    enabled: !!projectId,
  })
  const { data: catalog } = useQuery({
    queryKey: ['custom-techniques-catalog', projectId],
    queryFn: () => customTechniquesApi.catalog(projectId),
    enabled: !!projectId,
  })

  const r = useMemo(() => makeResolver(catalog), [catalog])
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['custom-techniques', projectId] })

  // 按实体状态过滤（09-自动维护 US-4）
  const filtered = useMemo(
    () => techniques.filter((t: any) => {
      if (statusFilter === 'draft') return t.entityStatus === 'draft'
      if (statusFilter === 'official') return t.entityStatus !== 'draft'
      return true
    }),
    [techniques, statusFilter]
  )
  const draftCount = useMemo(() => techniques.filter((t: any) => t.entityStatus === 'draft').length, [techniques])

  const handleCopy = (t: any) => {
    const { id, createdAt, updatedAt, isDeleted, description, linkedCharacterIds, ...rest } = t
    setCopySource({ ...rest, name: `${t.name}（副本）` })
    setForgeOpen(true)
  }

  const descMut = useMutation({
    mutationFn: (tid: number) => customTechniquesApi.generateDescription(projectId, tid),
    onSuccess: () => { toast('功法详解已重新生成', 'success'); invalidate() },
    onError: (e: any) => toast(e.message || '生成失败', 'error'),
  })
  const deleteMut = useMutation({
    mutationFn: (tid: number) => customTechniquesApi.delete(projectId, tid),
    onSuccess: () => { toast('已删除', 'success'); setDeleteTarget(null); invalidate() },
    onError: (e: any) => toast(e.message || '删除失败', 'error'),
  })

  if (!projectId) {
    return <div className="flex justify-center py-16"><Spinner /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="title-serif text-2xl font-bold">
            <span className="text-gold-grad">道法自然</span>
          </h1>
          <p className="mt-1 text-sm text-gray-400">九大本源道则 · 三步点选 · 骰子随机 · 功法无品级，威力取决于领悟深度与运用技巧</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Download className="h-4 w-4" /> 引用功法
          </Button>
          <Button variant="outline" onClick={() => setProjectImportOpen(true)}>
            <Download className="h-4 w-4" /> 从项目引入
          </Button>
          <Button variant="outline" onClick={() => setExportOpen(true)}>
            <Download className="h-4 w-4" /> 导出到文件
          </Button>
          <Button variant="outline" onClick={() => setFileImportOpen(true)}>
            <Upload className="h-4 w-4" /> 文件导入
          </Button>
          <Button onClick={() => setForgeOpen(true)}>
            <Plus className="h-4 w-4" /> 创立新功法
          </Button>
        </div>
      </div>

      {/* 状态筛选（09-自动维护 US-4） */}
      <div className="flex gap-1.5">
        <StatusChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>全部</StatusChip>
        <StatusChip active={statusFilter === 'official'} onClick={() => setStatusFilter('official')}>正式</StatusChip>
        <StatusChip active={statusFilter === 'draft'} onClick={() => setStatusFilter('draft')}>
          待补充{draftCount > 0 ? ` (${draftCount})` : ''}
        </StatusChip>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : techniques.length === 0 ? (
        <EmptyState icon={<BookOpen className="h-8 w-8" />} message="尚无自定义功法，点击「创立新功法」开始三步点选" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<BookOpen className="h-8 w-8" />} message={statusFilter === 'draft' ? '暂无待补充的草稿功法' : '暂无符合条件的功法'} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t: any) => (
            <Card key={t.id} className="transition-colors hover:border-gold-500/40">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="title-serif text-base font-bold text-gray-100">
                    {t.name}
                    {t.entityStatus === 'draft' && (
                      <span
                        className="ml-2 inline-block rounded border border-orange-500/40 bg-orange-500/15 px-1.5 py-0.5 align-middle text-[10px] font-normal text-orange-300"
                        title="章节生成自动建档的草稿，编辑保存后将转为正式功法"
                      >
                        待补充
                      </span>
                    )}
                  </h3>
                  <Badge className={GUIDANCE_COLORS[t.guidanceDepth] || ''}>{GUIDANCE_LABELS[t.guidanceDepth] || t.guidanceDepth}</Badge>
                </div>
                <p className="mt-1 text-xs text-gold-300/80">
                  {r.daoFull(t.mainDao)}
                  {(t.assistDao || []).length > 0 && ` + ${(t.assistDao || []).map((d: string) => r.daoName(d)).join('、')}`}
                </p>
                {t.isClash || (t.daoConflictRisk) ? (
                  <p className="mt-0.5 text-[11px] text-red-300/80">⚠ 对冲融合·极高风险</p>
                ) : null}

                {t.coreDirection?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.coreDirection.map((d: string, i: number) => (
                      <span key={i} className="rounded border border-gray-700 bg-gray-800/60 px-1.5 py-0.5 text-[10px] text-gray-400">{d}</span>
                    ))}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                  <span>特质 {t.coreTraits?.length || 0}</span>
                  <span>神通 {t.abilities?.length || 0}</span>
                  <span>反噬 {t.backlash?.length || 0}</span>
                  <span>传承：{r.inheritanceName(t.inheritance)}</span>
                </div>
                {t.inherentConflict && (
                  <p className="mt-1 text-[11px] text-purple-300/80">先天矛盾：{r.conflictName(t.inherentConflict)}</p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-gray-800 pt-3">
                  <Button size="sm" variant="outline" disabled={descMut.isPending} onClick={() => descMut.mutate(t.id)} title="重新生成500-700字功法详解">
                    {descMut.isPending && descMut.variables === t.id ? <Spinner className="h-3.5 w-3.5" /> : <ScrollText className="h-3.5 w-3.5" />} 详解
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDetail(t)} title="详情" aria-label="预览"><Eye className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleCopy(t)} title="基于此功法复制创建" aria-label="复制">
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(t)} title="删除" aria-label="删除"><Trash2 className="h-4 w-4 text-red-400" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {forgeOpen && (
        <ForgeDialog
          projectId={projectId}
          catalog={catalog}
          r={r}
          initialData={copySource}
          onClose={() => { setForgeOpen(false); setCopySource(null) }}
          onCreated={() => { setForgeOpen(false); setCopySource(null); invalidate() }}
        />
      )}

      {importOpen && (
        <ImportTechniqueDialog
          projectId={projectId}
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); invalidate() }}
        />
      )}

      {/* 从其他项目引入功法 */}
      {projectImportOpen && (
        <ImportFromProjectDialog
          open={projectImportOpen}
          title="从项目引入·功法"
          projectId={projectId}
          listApi={customTechniquesApi.importSourcesFromProject}
          importApi={customTechniquesApi.importFromProject}
          onClose={() => setProjectImportOpen(false)}
          onDone={() => invalidate()}
        />
      )}

      {/* 导出功法到文件（14-SRS US-25） */}
      {exportOpen && (
        <ImportFromProjectDialog
          open={exportOpen}
          mode="export"
          title="导出功法到文件"
          projectId={projectId}
          module="techniques"
          moduleName="功法"
          listCurrentApi={async (pid) => ((await customTechniquesApi.list(pid)) as any[]).map((t) => ({ id: t.id, name: t.name }))}
          exportApi={(pid, data) => customTechniquesApi.exportFile(pid, data.ids)}
          onClose={() => setExportOpen(false)}
          onDone={() => invalidate()}
        />
      )}

      {/* 从文件导入功法（14-SRS US-25） */}
      {fileImportOpen && (
        <ImportFromProjectDialog
          open={fileImportOpen}
          mode="import-file"
          title="从文件导入功法"
          projectId={projectId}
          module="techniques"
          moduleName="功法"
          listCurrentApi={async (pid) => ((await customTechniquesApi.list(pid)) as any[]).map((t) => ({ id: t.id, name: t.name }))}
          importFileApi={customTechniquesApi.importFile}
          onClose={() => setFileImportOpen(false)}
          onDone={() => invalidate()}
        />
      )}

      {detail && <TechniqueDetailDialog technique={detail} r={r} projectId={projectId} onChanged={invalidate} onClose={() => setDetail(null)} />}

      {deleteTarget && (
        <Dialog open onClose={() => setDeleteTarget(null)} title="删除功法" className="max-w-sm">
          <p className="text-sm text-gray-300">确定删除功法「{deleteTarget.name}」？此操作为软删除。</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate(deleteTarget.id)}>
              {deleteMut.isPending ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />} 删除
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 引用功法弹窗                                                        */
/* ------------------------------------------------------------------ */

function ImportTechniqueDialog({ projectId, onClose, onImported }: { projectId: string; onClose: () => void; onImported: () => void }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['world-skills-import', keyword],
    queryFn: () => worldApi.skills(keyword ? { keyword } : undefined),
  })
  const skills = Array.isArray(data) ? data : data?.skills ?? data?.data ?? []

  const importMut = useMutation({
    mutationFn: (worldSkillId: number) => customTechniquesApi.import(projectId, worldSkillId),
    onSuccess: () => {
      toast('功法已引用', 'success')
      queryClient.invalidateQueries({ queryKey: ['custom-techniques', projectId] })
      onImported()
    },
    onError: (e: any) => toast(e.message || '引用失败', 'error'),
  })

  return (
    <Dialog open onClose={onClose} title="引用功法·从世界观" className="max-w-lg">
      <div className="space-y-3">
        <input
          className="w-full rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-gold-500/50"
          placeholder="搜索功法名称…"
          aria-label="搜索"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />

        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-red-400">加载失败，请重试</p>
        ) : skills.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">未找到匹配的功法</p>
        ) : (
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {skills.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-700/60 bg-gray-800/40 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-200">{item.name}</span>
                  <span className="ml-2 text-[11px] text-gray-500">
                    {[item.grade, item.skillType].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={importMut.isPending}
                  onClick={() => importMut.mutate(item.id)}
                >
                  {importMut.isPending && importMut.variables === item.id ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />} 引用
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 详情弹窗                                                            */
/* ------------------------------------------------------------------ */

function TechniqueDetailDialog({ technique: t, r, projectId, onChanged, onClose }: { technique: any; r: Resolver; projectId: string; onChanged: () => void; onClose: () => void }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const regenDescMut = useMutation({
    mutationFn: () => customTechniquesApi.generateDescription(projectId, t.id),
    onSuccess: () => {
      toast('详解已重新生成', 'success')
      queryClient.invalidateQueries({ queryKey: ['custom-techniques', projectId] })
      onChanged()
    },
    onError: (e: any) => toast(e.message || '生成失败', 'error'),
  })
  // 反噬描述重生成（13-SRS US-20d）
  const regenBacklashMut = useMutation({
    mutationFn: () => customTechniquesApi.generateBacklash(projectId, t.id),
    onSuccess: () => {
      toast('反噬描述已重新生成', 'success')
      queryClient.invalidateQueries({ queryKey: ['custom-techniques', projectId] })
      onChanged()
    },
    onError: (e: any) => toast(e.message || '生成失败', 'error'),
  })
  // 天机独悟神通改名（13-SRS US-20e）：展示时覆盖预设神通名
  const renameOf = (id: string) => ((t.insightRenames || []) as { id: string; newName: string }[]).find((rn) => rn.id === id)?.newName
  const bm = t.bodyMark || {}
  const abilitiesByRealm = useMemo(() => {
    const realms = ['入微', '化境', '合道', '超脱']
    return realms.map((realm) => ({
      realm,
      items: (t.abilities || []).map((id: string) => r.ability(id)).filter((a: any) => a && a.daoRealm === realm),
    })).filter((g) => g.items.length > 0)
  }, [t, r])

  return (
    <Dialog open onClose={onClose} title={t.name} className="max-w-3xl">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge className={GUIDANCE_COLORS[t.guidanceDepth] || ''}>{GUIDANCE_LABELS[t.guidanceDepth]}</Badge>
          {t.fakeDepth && <Badge className="border-amber-500/30 bg-amber-500/15 text-amber-300">对外：{GUIDANCE_LABELS[t.fakeDepth]}</Badge>}
          {(t.coreDirection || []).map((d: string, i: number) => (
            <span key={i} className="rounded border border-gray-700 bg-gray-800/60 px-1.5 py-0.5 text-[10px] text-gray-400">{d}</span>
          ))}
        </div>

        <DetailBlock label="道则构型">
          主修 {r.daoFull(t.mainDao)}
          {(t.assistDao || []).length > 0 && `；辅修 ${(t.assistDao || []).map((d: string) => r.daoFull(d)).join('、')}`}
          。行功路线：{r.pathName(t.practicePath)}。传承：{r.inheritanceName(t.inheritance)}。
        </DetailBlock>

        <DetailBlock label="本源运用方向">
          {(t.coreTraits || []).map((id: string) => r.coreTraitName(id)).join('、') || '—'}
        </DetailBlock>

        <DetailBlock label="适配门槛">
          {(Array.isArray(t.threshold) ? t.threshold : []).map((id: string) => r.thresholdName(id)).join('、') || '—'}
        </DetailBlock>

        <DetailBlock label="分道境神通">
          {abilitiesByRealm.map((g) => (
            <div key={g.realm} className="mt-1">
              <span className="text-gold-300/80">{g.realm}境：</span>
              {g.items.map((a: any) => renameOf(a.id) || a.name).join('、')}
            </div>
          ))}
        </DetailBlock>

        <DetailBlock label="典型运用技巧">
          {(t.usageSkills || []).map((id: string) => r.skillText(id)).join('；') || '—'}
        </DetailBlock>

        <DetailBlock label="反噬代价">
          {(t.backlash || []).map((id: string) => {
            const b = r.backlash(id)
            return b ? `${b.name}（${b.risk}）` : id
          }).join('、') || '—'}
          {t.backlashText ? (
            <p className="mt-1.5 rounded border border-red-500/20 bg-red-500/5 p-2 text-[12px] leading-relaxed text-red-200/80">{t.backlashText}</p>
          ) : (
            <p className="mt-1 text-[11px] text-gray-500">反噬描述生成中…（若长时间未出现可点下方「重生成反噬」）</p>
          )}
        </DetailBlock>

        {(t.evolution || []).length > 0 && (
          <DetailBlock label="演化方向">{(t.evolution || []).map((id: string) => r.evolutionName(id)).join('、')}</DetailBlock>
        )}
        {t.inherentConflict && (
          <DetailBlock label="先天矛盾"><span className="text-purple-300">{r.conflictName(t.inherentConflict)}</span></DetailBlock>
        )}

        {bm.appearance && (
          <DetailBlock label="身体印记">
            外貌：{bm.appearance}；气场：{bm.aura}；行为：{bm.behavior}；气息：{bm.breath}
          </DetailBlock>
        )}

        {t.description && (
          <div className="rounded-lg border border-gold-500/20 bg-gold-500/5 p-3">
            <div className="mb-1 text-[11px] uppercase tracking-wider text-gold-300/70">功法详解</div>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-300">{t.description}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={regenBacklashMut.isPending} onClick={() => regenBacklashMut.mutate()}>
            {regenBacklashMut.isPending ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />} 重生成反噬
          </Button>
          <Button size="sm" variant="outline" disabled={regenDescMut.isPending} onClick={() => regenDescMut.mutate()}>
            {regenDescMut.isPending ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />} 重新生成详解
          </Button>
        </div>

        {(t.moves || []).length > 0 && (
          <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-gray-400">配套招式</div>
            <div className="space-y-2">
              {(t.moves || []).map((m: any, i: number) => {
                const isKill = (m.tier || '').includes('杀招') || i === (t.moves || []).length - 1
                return (
                  <div key={i} className="text-[13px] leading-relaxed">
                    <span className={isKill ? 'font-semibold text-red-300' : 'font-semibold text-gold-200'}>「{m.name}」</span>
                    {m.tier && <span className="ml-1 text-[10px] text-gray-500">（{m.tier}）</span>}
                    <span className="ml-1 text-gray-300">{m.desc}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <VariantPanel technique={t} projectId={projectId} onChanged={onChanged} />
      </div>
    </Dialog>
  )
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-[11px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-[13px] leading-relaxed text-gray-300">{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 个人变种面板（千人千面）                                             */
/* ------------------------------------------------------------------ */

const VARIANT_RARITY: Record<string, { label: string; cls: string }> = {
  common: { label: '普通变种', cls: 'border-gray-600 bg-gray-700/40 text-gray-300' },
  remarkable: { label: '显著变种', cls: 'border-sky-500/40 bg-sky-500/15 text-sky-300' },
  rare: { label: '稀有异变', cls: 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-300' },
}

function VariantPanel({ technique, projectId, onChanged }: { technique: any; projectId: string; onChanged: () => void }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [linkedIds, setLinkedIds] = useState<number[]>(() => (technique.linkedCharacterIds || []) as number[])
  const [bindId, setBindId] = useState<string>('')

  useEffect(() => {
    setLinkedIds((technique.linkedCharacterIds || []) as number[])
  }, [technique.id, technique.linkedCharacterIds])

  // 全部自定义人物（负数对外ID）
  const { data: characters = [] } = useQuery({
    queryKey: ['custom-characters', projectId],
    queryFn: () => customCharacterApi.list(projectId),
    enabled: !!projectId,
  })
  const charName = (negId: number) => characters.find((c: any) => Number(c.id) === Number(negId))?.name || `人物${negId}`

  // 每个已绑定人物的本功法变种
  const linkedKey = [...linkedIds].sort().join(',')
  const { data: variantByChar, isLoading } = useQuery({
    queryKey: ['technique-variants', projectId, linkedKey],
    queryFn: async () => {
      const map: Record<string, any> = {}
      await Promise.all(linkedIds.map(async (cid) => {
        const list = await techniqueVariantsApi.list(projectId, cid)
        map[String(cid)] = (list || []).find((v: any) => Number(v.baseTechniqueId) === Number(technique.id)) || null
      }))
      return map
    },
    enabled: !!projectId && linkedIds.length > 0,
  })

  const invalidateVariants = () => queryClient.invalidateQueries({ queryKey: ['technique-variants'] })
  const unlinked = characters.filter((c: any) => !linkedIds.includes(Number(c.id)))

  const bindGenerateMut = useMutation({
    mutationFn: async (cid: number) => {
      const newLinked = [...linkedIds, cid]
      await customTechniquesApi.update(projectId, technique.id, { linkedCharacterIds: newLinked })
      setLinkedIds(newLinked)
      await techniqueVariantsApi.generate(projectId, cid, Number(technique.id))
    },
    onSuccess: () => { toast('已绑定并生成个人变种', 'success'); invalidateVariants(); onChanged() },
    onError: (e: any) => toast(e.message || '绑定生成失败', 'error'),
  })

  const genMut = useMutation({
    mutationFn: (cid: number) => techniqueVariantsApi.generate(projectId, cid, Number(technique.id)),
    onSuccess: () => { toast('个人变种已生成', 'success'); invalidateVariants() },
    onError: (e: any) => toast(e.message || '生成失败', 'error'),
  })

  const rerollMut = useMutation({
    mutationFn: ({ cid, vid }: { cid: number; vid: number }) => techniqueVariantsApi.reroll(projectId, cid, vid),
    onSuccess: () => { toast('已重随变种', 'success'); invalidateVariants() },
    onError: (e: any) => toast(e.message || '重随失败', 'error'),
  })

  const upgradeMut = useMutation({
    mutationFn: ({ cid, vid, trigger }: { cid: number; vid: number; trigger: string }) =>
      techniqueVariantsApi.upgrade(projectId, cid, vid, trigger),
    onSuccess: () => { toast('变种已成长迭代', 'success'); invalidateVariants() },
    onError: (e: any) => toast(e.message || '迭代失败', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: ({ cid, vid }: { cid: number; vid: number }) => techniqueVariantsApi.delete(projectId, cid, vid),
    onSuccess: () => { toast('已删除变种', 'success'); invalidateVariants() },
    onError: (e: any) => toast(e.message || '删除失败', 'error'),
  })

  const handleUpgrade = (cid: number, vid: number) => {
    const trigger = window.prompt('成长触发条件（如：历经生死大战后顿悟）', '剧情推进后成长')
    if (trigger === null) return
    upgradeMut.mutate({ cid, vid, trigger })
  }

  return (
    <div className="rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-fuchsia-300/80">个人变种 · 千人千面</div>
        <span className="text-[11px] text-gray-500">同一功法绑定不同人物，自动衍生差异化修炼变种</span>
      </div>

      {/* 已绑定人物的变种 */}
      {linkedIds.length === 0 ? (
        <p className="text-xs text-gray-500">尚未绑定人物。绑定后将依据人物天赋/心性/出身/种族四因子自动生成专属变种。</p>
      ) : isLoading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : (
        <div className="space-y-2">
          {linkedIds.map((cid) => {
            const v = variantByChar?.[String(cid)]
            const negId = Number(cid)
            return (
              <div key={cid} className="rounded-md border border-gray-800 bg-gray-900/60 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-200">{charName(negId)}</span>
                  {v ? (
                    <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', VARIANT_RARITY[v.rarity]?.cls)}>
                      {VARIANT_RARITY[v.rarity]?.label || v.rarity}{v.version > 1 ? ` · v${v.version}` : ''}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-500">未生成</span>
                  )}
                </div>
                {v ? (
                  <>
                    <div className="mt-1 text-[13px] text-gold-300/90">《{v.variantName}》</div>
                    <div className="mt-1 text-[11px] text-gray-400">
                      修炼速度 {v.cultivationEffect?.speed || '持平'} · 瓶颈 {v.cultivationEffect?.bottleneck || '—'} · 风险 {v.cultivationEffect?.risk || '—'}
                    </div>
                    {(v.exclusiveSkill || []).length > 0 && (
                      <div className="mt-1 text-[11px] text-gray-400">专属技巧：{(v.exclusiveSkill || []).join('、')}</div>
                    )}
                    {v.cultivationEffect?.note && (
                      <div className="mt-1 text-[11px] leading-relaxed text-gray-500">{v.cultivationEffect.note}</div>
                    )}
                    {v.description && (
                      <div className="mt-2 rounded border border-fuchsia-500/20 bg-fuchsia-500/5 p-2">
                        <div className="mb-0.5 text-[10px] uppercase tracking-wider text-fuchsia-300/70">个人化变种详解</div>
                        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-gray-300">{v.description}</p>
                      </div>
                    )}
                    {(v.traitOffset || []).length > 0 && (
                      <div className="mt-1 text-[11px] text-gray-400">特质偏移：{(v.traitOffset || []).map((t: any) => `${t.name}（${t.change}）`).join('；')}</div>
                    )}
                    {(v.abilityVariant || []).length > 0 && (
                      <div className="mt-1 text-[11px] text-gray-400">神通变化：{(v.abilityVariant || []).map((a: any) => `${a.baseName}→${a.variantName}`).join('；')}</div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => genMut.mutate(negId)}>重新生成</Button>
                      <Button size="sm" variant="ghost" onClick={() => rerollMut.mutate({ cid: negId, vid: Number(v.id) })}>骰子重随</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleUpgrade(negId, Number(v.id))}>成长迭代</Button>
                      <Button size="sm" variant="destructive" onClick={() => deleteMut.mutate({ cid: negId, vid: Number(v.id) })}>删除</Button>
                    </div>
                  </>
                ) : (
                  <div className="mt-2">
                    <Button size="sm" variant="ghost" onClick={() => genMut.mutate(negId)}>生成变种</Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 绑定新人物并生成 */}
      {unlinked.length > 0 && (
        <div className="mt-3 flex items-center gap-2 border-t border-gray-800 pt-2">
          <select
            value={bindId}
            onChange={(e) => setBindId(e.target.value)}
            className="h-8 flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 text-xs text-gray-200 outline-none focus:border-fuchsia-500/60"
          >
            <option value="">选择人物绑定…</option>
            {unlinked.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!bindId || bindGenerateMut.isPending}
            onClick={() => bindId && bindGenerateMut.mutate(Number(bindId))}
          >
            绑定并生成
          </Button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 三步锻造弹窗                                                        */
/* ------------------------------------------------------------------ */

const STEPS = [
  { n: 1, label: '道则构型' },
  { n: 2, label: '行功根骨' },
  { n: 3, label: '衍化配置' },
]

function ForgeDialog({
  projectId, catalog, r, initialData, onClose, onCreated,
}: { projectId: string; catalog: any; r: Resolver; initialData?: any; onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<any>(null)
  const [locked, setLocked] = useState<Record<string, boolean>>({})
  const [step, setStep] = useState(1)
  const [nameBusy, setNameBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [smartDesc, setSmartDesc] = useState('')
  const [smartBusy, setSmartBusy] = useState(false)
  // 天机独悟（13-SRS US-20e）：LLM 运用方向 + 神通改名
  const [insightBusy, setInsightBusy] = useState(false)
  const [insightDirections, setInsightDirections] = useState<{ name: string; desc: string }[]>([])
  const [insightRenames, setInsightRenames] = useState<{ id: string; newName: string }[]>(
    () => (initialData?.insightRenames || []) as { id: string; newName: string }[]
  )
  const [customDirection, setCustomDirection] = useState('')
  // 后台生成详解完成后刷新列表（须置于任何提前返回之前，保证 hook 调用顺序稳定）
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['custom-techniques', projectId] })

  useEffect(() => {
    if (initialData) {
      setDraft(initialData)
      return
    }
    let alive = true
    customTechniquesApi.random(projectId, {})
      .then((d) => { if (alive) setDraft(d) })
      .catch(() => { if (alive) setDraft({}) })
    return () => { alive = false }
  }, [projectId])

  const daoRules: any[] = catalog?.daoRules || []
  const guidanceLevels: any[] = catalog?.guidanceLevels || []
  const styleTypes: any[] = catalog?.styleTypes || []
  const coreTraits: any[] = catalog?.coreTraits || []
  const practicePaths: any[] = catalog?.practicePaths || []
  const abilities: any[] = catalog?.abilities || []
  const backlashes: any[] = catalog?.backlashes || []
  const inheritances: any[] = catalog?.inheritances || []
  const usageSkills: any[] = catalog?.usageSkills || []
  const evolutions: any[] = catalog?.evolutions || []
  const conflicts: any[] = catalog?.inherentConflicts || []
  const compatLabels: Record<string, string> = catalog?.compatLabels || {}
  const daoRealms: string[] = catalog?.daoRealms || ['入微', '化境', '合道', '超脱']

  // 核心特质冲突互斥（须置于任何提前返回之前，保证 hook 调用顺序稳定）
  const blockedTraitTags = useMemo(() => {
    const set = new Set<string>()
    for (const id of draft?.coreTraits || []) {
      coreTraits.find((t) => t.id === id)?.conflictTags?.forEach((tag: string) => set.add(tag))
    }
    return set
  }, [draft?.coreTraits, coreTraits])

  if (!draft) {
    return (
      <Dialog open onClose={onClose} title="创立新功法" className="max-w-4xl">
        <div className="flex justify-center py-16"><Spinner /></div>
      </Dialog>
    )
  }

  const daoSet: string[] = [draft.mainDao, ...(draft.assistDao || [])].filter(Boolean)
  const fitsDao = (fitDao: string[]) => !fitDao || fitDao.length === 0 || fitDao.some((d) => daoSet.includes(d))

  const toggleLock = (field: string) => setLocked((l) => ({ ...l, [field]: !l[field] }))
  const patch = (p: any) => setDraft((d: any) => ({ ...d, ...p }))

  const rollAll = async () => {
    try {
      const res = await customTechniquesApi.random(projectId, { base: draft, locked })
      setDraft(res)
    } catch (e: any) {
      toast(e.message || '随机失败', 'error')
    }
  }

  const handleSmartMatch = async () => {
    const desc = smartDesc.trim()
    if (desc.length < 5) { toast('请输入至少 5 个字的描述', 'info'); return }
    setSmartBusy(true)
    try {
      const res = await customTechniquesApi.smartMatch(projectId, desc)
      // 锁定项不被覆盖；仅回填后端校验通过的合法字段
      const patchObj: Record<string, any> = {}
      for (const [k, v] of Object.entries(res || {})) {
        if (!locked[k]) patchObj[k] = v
      }
      patch(patchObj)
      toast('已按描述匹配参数，可继续微调', 'success')
    } catch (e: any) {
      toast(e.message || '智能匹配失败', 'error')
    } finally {
      setSmartBusy(false)
    }
  }

  const rollName = async () => {
    if (!draft.mainDao || !draft.guidanceDepth) return
    setNameBusy(true)
    try {
      const res = await customTechniquesApi.randomName(projectId, {
        mainDao: draft.mainDao, guidanceDepth: draft.guidanceDepth, styleType: draft.styleType, count: 1,
      })
      const name = res.names?.[0]
      if (name) patch({ name })
      else toast('命名失败，请重试', 'error')
    } catch (e: any) {
      toast(e.message || '命名失败', 'error')
    } finally {
      setNameBusy(false)
    }
  }

  // 兼容度（客户端计算，与后端 daoCompat 同规则：冲3/高10/其余中）
  const CLASH: string[][] = [['gengjin', 'kunearth'], ['mingshi', 'xingzhi'], ['mingshi', 'lingqi']]
  const HIGH: string[][] = [
    ['thunder', 'mingshi'], ['void', 'suishi'], ['xingzhi', 'lingqi'], ['gengjin', 'xingzhi'],
    ['gengjin', 'lingqi'], ['kunearth', 'xingzhi'], ['thunder', 'xingzhi'], ['thunder', 'lingqi'],
    ['gengjin', 'shenhun'], ['lingqi', 'shenhun'],
  ]
  const pairKey = (a: string, b: string) => [a, b].sort().join('|')
  const clashSet = new Set(CLASH.map(([a, b]) => pairKey(a, b)))
  const highSet = new Set(HIGH.map(([a, b]) => pairKey(a, b)))
  const compatOf = (a: string, b: string): string => {
    if (a === b) return 'mid'
    const k = pairKey(a, b)
    if (clashSet.has(k)) return 'clash'
    if (highSet.has(k)) return 'high'
    return 'mid'
  }

  const selectMainDao = (id: string) => {
    // 切换主修后剔除与新主修对冲的辅修
    const assist = (draft.assistDao || []).filter((d: string) => d !== id && compatOf(id, d) !== 'clash')
    patch({ mainDao: id, assistDao: assist })
  }
  const toggleAssist = (id: string, compat: string) => {
    const cur: string[] = draft.assistDao || []
    if (cur.includes(id)) { patch({ assistDao: cur.filter((x) => x !== id) }); return }
    if (compat === 'clash' && cur.length > 0) { toast('对冲道则建议单独融合，请先清空其他辅修', 'info') }
    if (cur.length >= 3) { toast('辅修最多3门', 'info'); return }
    patch({ assistDao: [...cur, id] })
  }

  const toggleInArray = (field: string, id: string, max: number) => {
    const cur: string[] = draft[field] || []
    if (cur.includes(id)) patch({ [field]: cur.filter((x) => x !== id) })
    else if (cur.length >= max) toast(`最多选择 ${max} 项`, 'info')
    else patch({ [field]: [...cur, id] })
  }

  // 天机独悟：依道则组合 LLM 推演独有运用方向 + 神通改名（13-SRS US-20e）
  const handleInsight = async () => {
    if (!draft.mainDao) return
    setInsightBusy(true)
    try {
      const res = await customTechniquesApi.insightDirections(projectId, {
        mainDao: draft.mainDao,
        assistDao: draft.assistDao || [],
        coreTraits: draft.coreTraits || [],
        abilities: (draft.abilities || []).map((id: string) => {
          const a = abilities.find((x: any) => x.id === id)
          return { id, name: a?.name || id, daoRealm: a?.daoRealm || '' }
        }),
      })
      setInsightDirections(res.directions || [])
      setInsightRenames(res.abilityRenames || [])
      // 自动选入核心方向（去重）
      const cur: string[] = draft.coreDirection || []
      const add = (res.directions || []).map((d: any) => d.name).filter((n: string) => n && !cur.includes(n))
      if (add.length) patch({ coreDirection: [...cur, ...add] })
      toast('天机独悟已推演完成', 'success')
    } catch (e: any) {
      toast(e.message || '天机独悟推演失败', 'error')
    } finally {
      setInsightBusy(false)
    }
  }

  const addCustomDirection = () => {
    const v = customDirection.trim()
    if (!v) return
    toggleInArray('coreDirection', v, 10)
    setCustomDirection('')
  }

  const handleCreate = async () => {
    if (!draft.name?.trim()) { toast('请填写或随机功法名号', 'error'); setStep(1); return }
    setCreating(true)
    try {
      // 先传 generateDescription:false——后端仅 DB 插入、秒回，不阻塞等 LLM
      const newRow = await customTechniquesApi.create(projectId, {
        name: draft.name.trim(),
        mainDao: draft.mainDao,
        assistDao: draft.assistDao || [],
        guidanceDepth: draft.guidanceDepth,
        fakeDepth: draft.fakeDepth ?? null,
        styleType: draft.styleType,
        threshold: draft.threshold || [],
        coreTraits: draft.coreTraits || [],
        practicePath: draft.practicePath,
        bodyMark: draft.bodyMark || {},
        usageSkills: draft.usageSkills || [],
        abilities: draft.abilities || [],
        backlash: draft.backlash || [],
        insightRenames,
        inheritance: draft.inheritance,
        evolution: draft.evolution || [],
        inherentConflict: draft.inherentConflict ?? null,
        coreDirection: draft.coreDirection || [],
        fitMonk: draft.fitMonk || [],
        linkedCharacterIds: [],
        generateDescription: false,
      })
      // 立即反馈 + 关弹窗，详解与反噬在后台慢慢生成（fire-and-forget，弹窗卸载不受影响）
      toast('功法创建成功，详解与反噬后台生成中…', 'success')
      onCreated()
      customTechniquesApi.generateDescription(projectId, newRow.id)
        .then(() => { invalidate(); toast('功法详解已生成', 'success') })
        .catch(() => { toast('详解生成失败，可点「详解」按钮重试', 'error') })
    } catch (e: any) {
      toast(e.message || '创建失败', 'error')
    } finally {
      setCreating(false)
    }
  }

  const assistCompatList = daoRules.filter((d) => d.id !== draft.mainDao)

  return (
    <Dialog open onClose={onClose} title="创立新功法" className="max-w-4xl">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-5">
        {/* 左列：预览 */}
        <div className="md:col-span-2">
          <Card className="mb-3">
            <CardContent className="space-y-2 p-3">
              <div className="text-[11px] uppercase tracking-wider text-gray-500">以文拟功 · 智能匹配</div>
              <Textarea
                rows={3}
                placeholder="描述你想要的功法，如「以雷入道、杀伐凌厉、残缺上古剑修传承」…"
                value={smartDesc}
                onChange={(e) => setSmartDesc(e.target.value)}
              />
              <Button className="w-full" onClick={handleSmartMatch} disabled={smartBusy}>
                {smartBusy ? <Spinner className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />} 智能匹配参数
              </Button>
            </CardContent>
          </Card>
          <Button className="mb-3 w-full" onClick={rollAll}>
            <Dices className="h-4 w-4" /> 一键全随机
          </Button>
          <Card featured>
            <CardContent className="space-y-3 p-4">
              <div>
                <div className="mb-0.5 text-[11px] uppercase tracking-wider text-gray-500">名号</div>
                <div className="flex items-center gap-1">
                  <span className="title-serif text-lg font-bold text-gray-100">{draft.name || '—'}</span>
                  <MiniBtn onClick={rollName} title="LLM随机名号"><Dice5 className="h-3.5 w-3.5" /></MiniBtn>
                  {nameBusy && <Spinner className="h-3 w-3" />}
                </div>
              </div>
              <PreviewRow label="道则" onLock={() => toggleLock('mainDao')} locked={!!locked.mainDao}>
                <span className="text-sm text-gold-200">
                  {r.daoFull(draft.mainDao)}
                  {(draft.assistDao || []).length > 0 && ` + ${(draft.assistDao || []).map((d: string) => r.daoName(d)).join('、')}`}
                </span>
                {draft.isClash && <span className="ml-1 text-[11px] text-red-300">⚠ 对冲融合</span>}
              </PreviewRow>
              <PreviewRow label="传法指引" onLock={() => toggleLock('guidanceDepth')} locked={!!locked.guidanceDepth}>
                <Badge className={GUIDANCE_COLORS[draft.guidanceDepth] || ''}>{GUIDANCE_LABELS[draft.guidanceDepth] || '—'}</Badge>
              </PreviewRow>
              <PreviewRow label="体例" onLock={() => toggleLock('styleType')} locked={!!locked.styleType}>
                <span className="text-sm text-gray-200">{styleTypes.find((s) => s.id === draft.styleType)?.name || '—'}</span>
              </PreviewRow>
              <div>
                <div className="mb-0.5 text-[11px] uppercase tracking-wider text-gray-500">核心方向</div>
                <div className="flex flex-wrap gap-1">
                  {(draft.coreDirection || []).map((d: string, i: number) => (
                    <span key={i} className="rounded border border-gray-700 bg-gray-800/60 px-1.5 py-0.5 text-[10px] text-gray-400">{d}</span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-0.5 text-[11px] uppercase tracking-wider text-gray-500">适配修士</div>
                <span className="text-xs text-gray-400">{(draft.fitMonk || []).join('、') || '—'}</span>
              </div>
              <div>
                <div className="mb-0.5 text-[11px] uppercase tracking-wider text-gray-500">适配门槛</div>
                <span className="text-xs text-gray-400">{(draft.threshold || []).map((id: string) => r.thresholdName(id)).join('、') || '—'}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 右列：步骤区 */}
        <div className="md:col-span-3">
          <div className="mb-4 flex gap-2">
            {STEPS.map((s) => (
              <button
                key={s.n}
                type="button"
                onClick={() => setStep(s.n)}
                aria-current={step === s.n ? 'step' : undefined}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-xs transition-colors',
                  step === s.n ? 'border-gold-400 bg-gold-500/15 text-gold-200' : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-600'
                )}
              >
                {s.n}. {s.label}
              </button>
            ))}
          </div>

          <div className="max-h-[62vh] space-y-5 overflow-y-auto pr-1">
            {step === 1 && (
              <>
                <Section title="主修道则" hint="九大本源道则单选，悬停可见道则真意">
                  <div className="grid grid-cols-3 gap-1.5">
                    {daoRules.map((d: any) => (
                      <SelTag key={d.id} active={draft.mainDao === d.id} onClick={() => selectMainDao(d.id)} title={`道则真意：${d.trueIntent || d.essence}`}>
                        <div className="font-medium">{d.name.replace('道则', '')}</div>
                        <div className="text-[10px] text-gray-500">{d.xianxiaDesc || d.essence}</div>
                      </SelTag>
                    ))}
                  </div>
                </Section>

                <Section title="辅修道则" hint="0-3门，标注与主修的兼容度">
                  <div className="grid grid-cols-2 gap-1.5">
                    {assistCompatList.map((d: any) => {
                      const compat = compatOf(draft.mainDao, d.id)
                      const active = (draft.assistDao || []).includes(d.id)
                      return (
                        <SelTag key={d.id} active={active} onClick={() => toggleAssist(d.id, compat)} title={compatLabels[compat]}>
                          <span className="flex items-center justify-between gap-1">
                            <span>{d.name.replace('道则', '')}</span>
                            <span className={cn('rounded border px-1 text-[10px]', COMPAT_STYLE[compat])}>{COMPAT_SHORT[compat]}</span>
                          </span>
                        </SelTag>
                      )
                    })}
                  </div>
                </Section>

                {/* 道则共鸣·冲克（13-SRS US-20c：文案+颜色+边框） */}
                {(draft.assistDao || []).length > 0 && (
                  <Section title="道则共鸣·冲克" hint="道则组合的化学反应">
                    <div className="space-y-1.5">
                      {(() => {
                        const list: { key: string; label: string; text: string; compat: string }[] = []
                        for (let i = 0; i < daoSet.length; i++) {
                          for (let j = i + 1; j < daoSet.length; j++) {
                            const k = pairKey(daoSet[i], daoSet[j])
                            const compat = compatOf(daoSet[i], daoSet[j])
                            list.push({
                              key: k,
                              label: `${r.daoName(daoSet[i])}×${r.daoName(daoSet[j])}`,
                              compat,
                              text: REACTION_TEXT[k] || REACTION_FALLBACK[compat],
                            })
                          }
                        }
                        return list.map((rp) => (
                          <div key={rp.key} className={cn('rounded-lg border px-2.5 py-1.5 text-xs leading-relaxed', REACTION_STYLE[rp.compat])}>
                            <span className="font-medium">{rp.label}</span>
                            <span className="ml-1.5 opacity-90">{rp.text}</span>
                          </div>
                        ))
                      })()}
                    </div>
                  </Section>
                )}

                <Section title="传法指引深度" hint="非品级，仅讲解完备度">
                  <div className="space-y-1.5">
                    {guidanceLevels.map((g: any) => (
                      <SelTag key={g.id} active={draft.guidanceDepth === g.id} onClick={() => patch({ guidanceDepth: g.id })}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{g.name}</span>
                          <span className="text-[10px] text-gray-500">{g.position}</span>
                        </div>
                        <div className="text-[10px] text-gray-500">{g.desc}</div>
                      </SelTag>
                    ))}
                  </div>
                </Section>

                <Section title="功法体例" hint="单选">
                  <div className="grid grid-cols-2 gap-1.5">
                    {styleTypes.map((s: any) => (
                      <SelTag key={s.id} active={draft.styleType === s.id} onClick={() => patch({ styleType: s.id, coreDirection: s.coreDirection })} title={s.feature}>
                        <div className="font-medium">{s.name}</div>
                        <div className="text-[10px] text-gray-500">{s.position}</div>
                      </SelTag>
                    ))}
                  </div>
                </Section>
              </>
            )}

            {step === 2 && (
              <>
                <Section title="本源运用方向·基础" hint={`道则永久特质，2-3项（已选${(draft.coreTraits || []).length}）`}>
                  <div className="flex flex-wrap gap-1.5">
                    {coreTraits.filter((t: any) => fitsDao(t.fitDao)).map((t: any) => {
                      const active = (draft.coreTraits || []).includes(t.id)
                      const conflict = !active && (t.conflictTags || []).some((tag: string) => blockedTraitTags.has(tag))
                      return (
                        <SelTag key={t.id} active={active} disabled={conflict} onClick={() => toggleInArray('coreTraits', t.id, 3)} title={conflict ? '与已选特质相冲' : t.desc}>
                          <span className={cn(RARITY_TEXT[t.rarity])}>{t.name}</span>
                          <span className="ml-1 text-[10px] text-gray-600">{RARITY_LABELS[t.rarity]}</span>
                        </SelTag>
                      )
                    })}
                  </div>
                </Section>

                {/* 天机独悟（13-SRS US-20e）：AI 独有运用方向 + 自定义 */}
                <Section title="天机独悟·独有方向" hint="依道则组合 AI 推演，可选入核心方向或自定义">
                  <div className="space-y-2">
                    <Button variant="outline" size="sm" onClick={handleInsight} disabled={insightBusy || !draft.mainDao}>
                      {insightBusy ? <Spinner className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />} AI推演独有方向
                    </Button>
                    {insightDirections.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {insightDirections.map((d) => {
                          const active = (draft.coreDirection || []).includes(d.name)
                          return (
                            <SelTag key={d.name} active={active} onClick={() => toggleInArray('coreDirection', d.name, 10)} title={d.desc}>
                              <span className="text-purple-300">{d.name}</span>
                              <span className="ml-1 rounded border border-purple-500/40 bg-purple-500/15 px-1 text-[9px] text-purple-300">天机独悟</span>
                            </SelTag>
                          )
                        })}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        className="h-8 flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-gold-500/60"
                        placeholder="自定义方向名（如：雷腐蚀魂）"
                        value={customDirection}
                        onChange={(e) => setCustomDirection(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addCustomDirection() }}
                      />
                      <Button size="sm" variant="ghost" onClick={addCustomDirection}>添加</Button>
                    </div>
                    {(draft.coreDirection || []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(draft.coreDirection || []).map((d: string) => (
                          <span key={d} className="inline-flex items-center gap-1 rounded border border-gray-700 bg-gray-800/60 px-1.5 py-0.5 text-[10px] text-gray-300">
                            {d}
                            <button type="button" className="text-gray-500 hover:text-red-300" onClick={() => toggleInArray('coreDirection', d, 10)}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Section>

                <Section title="行功路线" hint="单选，决定修炼节奏与风险">
                  <div className="grid grid-cols-2 gap-1.5">
                    {practicePaths.map((p: any) => (
                      <SelTag key={p.id} active={draft.practicePath === p.id} onClick={() => patch({ practicePath: p.id })} title={p.desc}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-[10px] text-gray-500">{p.risk}</span>
                        </div>
                      </SelTag>
                    ))}
                  </div>
                </Section>

                <Section title="身体印记" hint="按主修道则自动生成">
                  <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-3 text-xs leading-relaxed text-gray-400">
                    {draft.bodyMark?.appearance ? (
                      <>
                        <div>外貌：{draft.bodyMark.appearance}</div>
                        <div>气场：{draft.bodyMark.aura}</div>
                        <div>行为：{draft.bodyMark.behavior}</div>
                        <div>气息：{draft.bodyMark.breath}</div>
                      </>
                    ) : '—'}
                  </div>
                </Section>

                <Section title="典型运用技巧" hint={`3-5项（已选${(draft.usageSkills || []).length}）`}>
                  <div className="flex flex-wrap gap-1.5">
                    {usageSkills.filter((s: any) => daoSet.includes(s.dao)).map((s: any) => (
                      <SelTag key={s.id} active={(draft.usageSkills || []).includes(s.id)} onClick={() => toggleInArray('usageSkills', s.id, 5)}>
                        {s.text}
                      </SelTag>
                    ))}
                  </div>
                </Section>
              </>
            )}

            {step === 3 && (
              <>
                <Section title="配套神通" hint={`分道境阶梯，6-8项（已选${(draft.abilities || []).length}）`}>
                  {daoRealms.map((realm) => {
                    const pool = abilities.filter((a: any) => a.daoRealm === realm && fitsDao(a.fitDao))
                    if (pool.length === 0) return null
                    return (
                      <div key={realm} className="mb-2">
                        <div className="mb-1 text-[11px] text-gold-300/70">{realm}境</div>
                        <div className="flex flex-wrap gap-1.5">
                          {pool.map((a: any) => {
                            const renamed = insightRenames.find((rn) => rn.id === a.id)
                            return (
                              <SelTag key={a.id} active={(draft.abilities || []).includes(a.id)} onClick={() => toggleInArray('abilities', a.id, 8)} title={a.desc}>
                                {renamed ? (
                                  <>
                                    <span className="text-purple-300">{renamed.newName}</span>
                                    <span className="ml-1 text-[9px] text-gray-500">({a.name})</span>
                                  </>
                                ) : a.name}
                              </SelTag>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </Section>

                <Section title="反噬代价" hint={`对冲强制高风险+长期风险（已选${(draft.backlash || []).length}）`}>
                  <div className="flex flex-wrap gap-1.5">
                    {backlashes.map((b: any) => (
                      <SelTag key={b.id} active={(draft.backlash || []).includes(b.id)} onClick={() => toggleInArray('backlash', b.id, 4)} title={b.desc}>
                        <span>{b.name}</span>
                        <span className={cn('ml-1 text-[10px]', BACKLASH_RISK_COLOR[b.risk])}>{b.risk}</span>
                      </SelTag>
                    ))}
                  </div>
                </Section>

                <Section title="传承方式" hint="单选">
                  <div className="grid grid-cols-2 gap-1.5">
                    {inheritances.map((i: any) => (
                      <SelTag key={i.id} active={draft.inheritance === i.id} onClick={() => patch({ inheritance: i.id })} title={i.desc}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{i.name}</span>
                          <span className="text-[10px] text-gray-500">保密{i.secrecy}</span>
                        </div>
                      </SelTag>
                    ))}
                  </div>
                </Section>

                <Section title="演化方向" hint={`2-3个（已选${(draft.evolution || []).length}）`}>
                  <div className="flex flex-wrap gap-1.5">
                    {evolutions.map((e: any) => (
                      <SelTag key={e.id} active={(draft.evolution || []).includes(e.id)} onClick={() => toggleInArray('evolution', e.id, 3)} title={e.desc}>
                        {e.name}
                      </SelTag>
                    ))}
                  </div>
                </Section>

                <Section title="先天矛盾" hint="可选，戏剧冲突钩子">
                  <div className="flex flex-wrap gap-1.5">
                    <SelTag active={draft.inherentConflict == null} onClick={() => patch({ inherentConflict: null })}>无</SelTag>
                    {conflicts.map((cf: any) => (
                      <SelTag key={cf.id} active={draft.inherentConflict === cf.id} onClick={() => patch({ inherentConflict: cf.id })} title={cf.desc}>
                        {cf.name}
                      </SelTag>
                    ))}
                  </div>
                </Section>
              </>
            )}
          </div>

          {/* 底部导航 */}
          <div className="mt-4 flex items-center justify-between border-t border-gray-800 pt-4">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
              <ChevronLeft className="h-4 w-4" /> 上一步
            </Button>
            <div className="flex items-center gap-2">
              {step < 3 ? (
                <Button variant="outline" onClick={() => setStep((s) => Math.min(3, s + 1))}>
                  下一步 <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? <Spinner className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />} 完成创建
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

/* 状态筛选小标签（09-自动维护 US-4） */
function StatusChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs transition-colors',
        active ? 'border-gold-500/60 bg-gold-500/10 text-gold-300' : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
      )}
    >
      {children}
    </button>
  )
}
