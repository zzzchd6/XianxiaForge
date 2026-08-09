import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  Plus, Trash2, Eye, History, ArrowUpCircle, Sparkles, Shuffle, Check, X,
  Dice5, Lock, Unlock, ChevronLeft, ChevronRight, Hammer, GitBranch, RotateCcw, Sword,
  ScrollText, BookOpen, Copy, Wand2, AlertTriangle, Zap, Search, Download, Pencil, Upload,
} from 'lucide-react'
import {
  Card, CardContent, Badge, Button, Select, Switch, Spinner, EmptyState, Dialog, useToast, Textarea, Input,
} from '../components/ui'
import { customWeaponsApi, worldApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import { cn } from '../lib/utils'
import TreasureHuntTab from './TreasureHunt'
import { ImportFromProjectDialog } from '../components/ImportFromProjectDialog'

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

const GRADE_COLORS: Record<string, string> = {
  '凡造': 'bg-gray-500/15 text-gray-300 border-gray-500/30',
  '灵淬': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  '宝胎': 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  '道纹': 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  '仙蜕': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  '神蕴': 'bg-red-500/15 text-red-300 border-red-500/30',
}

const RARITY_LABELS: Record<string, string> = { normal: '普通', rare: '稀有', legendary: '传说' }
const RARITY_TEXT: Record<string, string> = { normal: 'text-gray-300', rare: 'text-blue-300', legendary: 'text-amber-300' }

const GROWTH_TYPE_LABELS: Record<string, string> = {
  base: '原生', fusion: '融合', mutation: '变异', upgrade: '强化', evolution: '进化',
}

/** 底蕴层级释义（用于标签 hover 提示） */
const GRADE_DESC: Record<string, string> = {
  '凡造': '凡铁铸成，无灵气承载，最基础的兵刃',
  '灵淬': '灵气温养，可承载基础灵气，初具灵性',
  '宝胎': '灵材塑胎，禁制初成，已是难得的宝物',
  '道纹': '道纹缠身，神通自成，修士梦寐以求',
  '仙蜕': '仙材蜕变，超凡脱俗，蕴含天地法则',
  '神蕴': '神物蕴灵，先天灵宝，可遇不可求',
}

const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

/* ------------------------------------------------------------------ */
/* 词条解析器：把 ID 还原成名称/描述                                   */
/* ------------------------------------------------------------------ */

function makeResolver(catalog: any) {
  const categories: any[] = catalog?.categories || []
  const materials: any[] = catalog?.materials || []
  const soulLevels: any[] = catalog?.soulRefineLevels || []
  const traitPools: any[] = [
    ...(catalog?.forgeTraits || []), ...(catalog?.soakTraits || []),
    ...(catalog?.attachTraits || []), ...(catalog?.cavityTraits || []),
  ]
  const formIndex = new Map<string, { form: any; category: any }>()
  for (const c of categories) for (const f of c.forms || []) formIndex.set(f.id, { form: f, category: c })
  const matIndex = new Map(materials.map((m: any) => [m.id, m]))
  const traitIndex = new Map(traitPools.map((t: any) => [t.id, t]))
  const soulIndex = new Map(soulLevels.map((s: any) => [s.id, s]))
  const catIndex = new Map(categories.map((c: any) => [c.id, c]))
  return {
    categoryName: (id: string) => catIndex.get(id)?.name || id || '—',
    form: (type: string) => formIndex.get(type),
    formLabel: (category: string, type: string) => {
      const fi = formIndex.get(type)
      return fi ? `${fi.category.name}·${fi.form.name}` : `${catIndex.get(category)?.name || category}·${type}`
    },
    fitMonk: (type: string) => formIndex.get(type)?.form.fitMonk || '',
    material: (id: string) => matIndex.get(id),
    materialName: (id: string) => matIndex.get(id)?.name || id || '—',
    trait: (id: string) => traitIndex.get(id),
    traitName: (id: string) => traitIndex.get(id)?.name || id,
    soulName: (id: string) => soulIndex.get(id)?.name || (id === 'none' ? '无' : id || '无'),
  }
}

type Resolver = ReturnType<typeof makeResolver>

/* ------------------------------------------------------------------ */
/* 小工具组件                                                          */
/* ------------------------------------------------------------------ */

/** 点选标签（金色高亮=选中，灰=未选，禁用=相冲） */
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

/** 预览行旁的骰子/锁定小按钮 */
function MiniBtn({
  onClick, title, active, children,
}: { onClick?: () => void; title?: string; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'rounded p-2 transition-colors',
        active ? 'text-gold-300' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
      )}
    >
      {children}
    </button>
  )
}

/** 解析后的特质条目（名称+稀有度+描述） */
function TraitLine({ id, r }: { id: string; r: Resolver }) {
  const t = r.trait(id)
  if (!t) return <div className="text-sm text-gray-400">· {id}</div>
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={cn('text-sm font-medium', RARITY_TEXT[t.rarity])}>{t.name}</span>
        <span className="text-[10px] text-gray-600">[{RARITY_LABELS[t.rarity]}]</span>
      </div>
      {t.desc && <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{t.desc}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 主页面                                                              */
/* ------------------------------------------------------------------ */

export default function CustomWeaponForge() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const projectId = useCurrentProjectId()

  const [activeTab, setActiveTab] = useState<'forge' | 'hunt'>('forge')
  // 实体状态筛选（09-自动维护 US-4）
  const [statusFilter, setStatusFilter] = useState<'all' | 'official' | 'draft'>('all')
  const [forgeOpen, setForgeOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [projectImportOpen, setProjectImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [fileImportOpen, setFileImportOpen] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [detail, setDetail] = useState<any>(null)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [upgradeResult, setUpgradeResult] = useState<any>(null)
  const [fusionMode, setFusionMode] = useState(false)
  const [fusionSel, setFusionSel] = useState<number[]>([])

  // 武器列表
  const { data: weapons = [], isLoading } = useQuery({
    queryKey: ['custom-weapons', projectId],
    queryFn: () => customWeaponsApi.list(projectId),
    enabled: !!projectId,
  })

  // 按实体状态过滤（09-自动维护 US-4）
  const filtered = useMemo(
    () => weapons.filter((w: any) => {
      if (statusFilter === 'draft') return w.entityStatus === 'draft'
      if (statusFilter === 'official') return w.entityStatus !== 'draft'
      return true
    }),
    [weapons, statusFilter]
  )
  const draftCount = useMemo(() => weapons.filter((w: any) => w.entityStatus === 'draft').length, [weapons])

  // 词条配置库
  const { data: catalog } = useQuery({
    queryKey: ['custom-weapons-catalog', projectId],
    queryFn: () => customWeaponsApi.catalog(projectId),
    enabled: !!projectId,
    staleTime: 10 * 60 * 1000,
  })

  const r = useMemo(() => makeResolver(catalog), [catalog])
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['custom-weapons', projectId] })

  // 养成：强化（原地升阶，直接落库；结果用醒目弹窗展示）
  const upgradeMut = useMutation({
    mutationFn: (w: any) => customWeaponsApi.upgrade(projectId, w.id),
    onSuccess: (res: any, w: any) => {
      setUpgradeResult({ ...res, weaponName: w.name, oldGrade: w.grade, oldGradeLevel: w.gradeLevel })
      invalidate()
    },
    onError: (e: any) => toast(e.message || '强化失败', 'error'),
  })

  // 养成：进化（预览）
  const evolutionMut = useMutation({
    mutationFn: (wid: number) => customWeaponsApi.evolution(projectId, wid),
    onSuccess: (res: any) => setPreview({ ...res, operation: 'evolution' }),
    onError: (e: any) => toast(e.message || '进化失败', 'error'),
  })

  // 养成：变异（预览）
  const mutationMut = useMutation({
    mutationFn: (wid: number) => customWeaponsApi.mutation(projectId, wid),
    onSuccess: (res: any) => setPreview({ ...res, operation: 'mutation' }),
    onError: (e: any) => toast(e.message || '变异失败', 'error'),
  })

  // 养成：融合（预览）
  const fusionMut = useMutation({
    mutationFn: () => customWeaponsApi.fusion(projectId, { entityAId: fusionSel[0], entityBId: fusionSel[1] }),
    onSuccess: (res: any) => { setPreview({ ...res, operation: 'fusion' }); setFusionMode(false); setFusionSel([]) },
    onError: (e: any) => toast(e.message || '融合失败', 'error'),
  })

  // 养成：确认入库
  const confirmMut = useMutation({
    mutationFn: () => customWeaponsApi.confirm(projectId, preview.preview),
    onSuccess: () => { toast('已确认入库', 'success'); setPreview(null); invalidate() },
    onError: (e: any) => toast(e.message || '入库失败', 'error'),
  })

  // 软删除
  const deleteMut = useMutation({
    mutationFn: (wid: number) => customWeaponsApi.delete(projectId, wid),
    onSuccess: () => { toast('已删除', 'success'); setDeleteTarget(null); invalidate() },
    onError: (e: any) => toast(e.message || '删除失败', 'error'),
  })

  // 文案生成（卡片快捷按钮）
  const loreMut = useMutation({
    mutationFn: (wid: number) => customWeaponsApi.generateLore(projectId, wid),
    onSuccess: (res: any) => {
      toast(`文案已生成：${res.data?.name || '完成'}`, 'success')
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['weapon-lore'] })
    },
    onError: (e: any) => toast(e.message || '文案生成失败', 'error'),
  })

  const toggleFusion = (id: number) => {
    setFusionSel((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 2 ? [...prev, id] : prev
    )
  }

  const TABS = [
    { key: 'forge' as const, label: '铸器' },
    { key: 'hunt' as const, label: '淘宝' },
  ]

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="title-serif text-2xl font-bold">
            <span className="text-gold-grad">铸器天工</span>
          </h1>
          <p className="mt-1 text-sm text-gray-400">铸炼本命神兵 · 淘宝拾遗</p>
        </div>
      </div>

      {/* Tab 导航 */}
      <div role="tablist" className="flex items-center gap-1 border-b border-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'relative px-4 py-2.5 text-sm transition-colors',
              activeTab === tab.key
                ? 'font-medium text-gold-300'
                : 'text-gray-500 hover:text-gray-300',
            )}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-gold-500 to-gold-300" />
            )}
          </button>
        ))}
      </div>

      {/* ===== 淘宝 Tab（常驻挂载，切走仅隐藏，暂存逛到的物品） ===== */}
      <div className={activeTab === 'hunt' ? '' : 'hidden'}>
        <TreasureHuntTab projectId={projectId} />
      </div>

      {/* ===== 锻造 Tab ===== */}
      {activeTab === 'forge' && (<>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Download className="h-4 w-4" /> 引用法宝
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
        <Button
          variant={fusionMode ? 'gold' : 'outline'}
          onClick={() => { setFusionMode((v) => !v); setFusionSel([]) }}
        >
          <GitBranch className="h-4 w-4" /> 融合
        </Button>
        <Button onClick={() => setForgeOpen(true)}>
          <Plus className="h-4 w-4" /> 铸成新法宝
        </Button>
      </div>

      {/* 状态筛选（09-自动维护 US-4） */}
      <div className="flex gap-1.5">
        <StatusChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>全部</StatusChip>
        <StatusChip active={statusFilter === 'official'} onClick={() => setStatusFilter('official')}>正式</StatusChip>
        <StatusChip active={statusFilter === 'draft'} onClick={() => setStatusFilter('draft')}>
          待补充{draftCount > 0 ? ` (${draftCount})` : ''}
        </StatusChip>
      </div>

      {/* 融合选择条 */}
      {fusionMode && (
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-medium text-gray-200">选择两把武器进行融合（{fusionSel.length}/2）</h3>
            <p className="mt-1 text-xs text-gray-500">融合将合并两器特质池，底蕴取高者并有概率+1阶（上限仙蜕），生成新武器预览。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {weapons.map((w: any) => (
                <SelTag key={w.id} active={fusionSel.includes(w.id)} onClick={() => toggleFusion(w.id)}>
                  <span className="flex items-center gap-1.5">
                    {w.name}
                    <span className={cn('rounded border px-1 text-[10px]', GRADE_COLORS[w.grade])}>{w.grade}</span>
                  </span>
                </SelTag>
              ))}
              {weapons.length === 0 && <span className="text-xs text-gray-600">暂无可融合武器</span>}
            </div>
            <div className="mt-4">
              <Button disabled={fusionSel.length !== 2 || fusionMut.isPending} onClick={() => fusionMut.mutate()}>
                <GitBranch className="h-4 w-4" /> 开始融合
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 武器列表 */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : weapons.length === 0 ? (
        <EmptyState icon={<Sword className="h-8 w-8" />} message="尚无自定义法宝，点击「铸成新法宝」开始四步点选" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Sword className="h-8 w-8" />} message={statusFilter === 'draft' ? '暂无待补充的草稿武器' : '暂无符合条件的武器'} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((w: any) => {
            const canEvolve = (w.grade === '道纹' && w.gradeLevel >= 3) || w.grade === '仙蜕'
            return (
              <Card key={w.id} className="transition-colors hover:border-gold-500/40">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="title-serif text-base font-bold text-gray-100">
                      {w.name}
                      {w.entityStatus === 'draft' && (
                        <span
                          className="ml-2 inline-block rounded border border-orange-500/40 bg-orange-500/15 px-1.5 py-0.5 align-middle text-[10px] font-normal text-orange-300"
                          title="章节生成自动建档的草稿，编辑保存后将转为正式武器"
                        >
                          待补充
                        </span>
                      )}
                    </h3>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge className={GRADE_COLORS[w.grade] || ''}>{w.grade}·第{w.gradeLevel}层</Badge>
                      {w.isEvolved && <Badge className="border-red-500/30 bg-red-500/15 text-red-300">进化</Badge>}
                    </div>
                  </div>

                  <p className="mt-1 text-xs text-gold-300/80">{r.formLabel(w.category, w.type)}</p>
                  <p className="mt-0.5 text-xs text-gray-500">材质：{r.materialName(w.baseMaterial)}</p>

                  {w.coreDirection?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {w.coreDirection.map((d: string, i: number) => (
                        <span key={i} className="rounded border border-gray-700 bg-gray-800/60 px-1.5 py-0.5 text-[10px] text-gray-400">{d}</span>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                    {(w.generatedTraits || []).length > 0 ? (
                      <>
                        <span>改锻 {countGenTraits(w, 'forge')}</span>
                        <span>浸养 {countGenTraits(w, 'infuse')}</span>
                        <span>加持 {countGenTraits(w, 'enchant')}</span>
                        <span>窍藏 {countGenTraits(w, 'hidden')}</span>
                      </>
                    ) : (
                      <>
                        <span>改锻 {w.forgeTraits?.length || 0}</span>
                        <span>浸养 {w.soakTraits?.length || 0}</span>
                        <span>附加 {w.attachTraits?.length || 0}</span>
                        <span>窍藏 {w.cavityTraits?.length || 0}</span>
                      </>
                    )}
                    {w.soulRefineLevel && w.soulRefineLevel !== 'none' && (
                      <span className="text-purple-300/80">本命：{r.soulName(w.soulRefineLevel)}</span>
                    )}
                  </div>

                  {w.fakeGrade && (
                    <p className="mt-1 text-[11px] text-amber-300/70">对外伪装：{w.fakeGrade}（敛藏锋芒）</p>
                  )}
                  {w.growthType && w.growthType !== 'base' && (
                    <p className="mt-0.5 text-[11px] text-gray-600">来源：{GROWTH_TYPE_LABELS[w.growthType] || w.growthType}</p>
                  )}

                  {/* 操作 */}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-gray-800 pt-3">
                    <Button size="sm" variant="outline" disabled={w.grade === '神蕴' || upgradeMut.isPending} onClick={() => upgradeMut.mutate(w)} title={w.grade === '神蕴' ? '已达神蕴顶阶，无法强化' : '同阶升层80%/跨阶50%成功率'}>
                      {upgradeMut.isPending && (upgradeMut.variables as any)?.id === w.id ? <Spinner className="h-3.5 w-3.5" /> : <ArrowUpCircle className="h-3.5 w-3.5" />} 强化
                      {w.grade === '神蕴' && <span className="ml-0.5 text-[10px] opacity-70">已顶阶</span>}
                    </Button>
                    <Button size="sm" variant="outline" disabled={!canEvolve || evolutionMut.isPending} onClick={() => evolutionMut.mutate(w.id)} title={canEvolve ? '进化为+1大阶终极形态（预览后确认）' : w.grade === '神蕴' ? '已达神蕴顶阶，无法进化' : '需道纹巅峰（第3层）以上'}>
                      {evolutionMut.isPending && evolutionMut.variables === w.id ? <Spinner className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />} 进化
                      {!canEvolve && <span className="ml-0.5 text-[10px] opacity-70">{w.grade === '神蕴' ? '已顶阶' : '需道纹3层'}</span>}
                    </Button>
                    <Button size="sm" variant="outline" disabled={mutationMut.isPending} onClick={() => mutationMut.mutate(w.id)}>
                      {mutationMut.isPending && mutationMut.variables === w.id ? <Spinner className="h-3.5 w-3.5" /> : <Shuffle className="h-3.5 w-3.5" />} 变异
                    </Button>
                    <Button size="sm" variant="outline" disabled={loreMut.isPending} onClick={() => loreMut.mutate(w.id)} title="生成名号/简介/招式文案">
                      {loreMut.isPending && loreMut.variables === w.id ? <Spinner className="h-3.5 w-3.5" /> : <ScrollText className="h-3.5 w-3.5" />} 文案
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDetail(w)} title="详情" aria-label="详情">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditTarget(w)} title="编辑" aria-label="编辑">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(w)} title="删除" aria-label="删除">
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 锻造弹窗（三步点选） */}
      {forgeOpen && (
        <ForgeDialog
          projectId={projectId}
          catalog={catalog}
          r={r}
          onClose={() => setForgeOpen(false)}
          onCreated={() => { setForgeOpen(false); invalidate() }}
        />
      )}

      {/* 编辑法宝弹窗（轻量编辑） */}
      {editTarget && (
        <WeaponEditDialog
          projectId={projectId}
          catalog={catalog}
          weapon={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); invalidate() }}
        />
      )}

      {/* 引用法宝弹窗 */}
      {importOpen && (
        <ImportWeaponDialog
          projectId={projectId}
          onClose={() => setImportOpen(false)}
          onImported={() => invalidate()}
        />
      )}

      {/* 从其他项目引入法宝 */}
      {projectImportOpen && (
        <ImportFromProjectDialog
          open={projectImportOpen}
          title="从项目引入·法宝"
          projectId={projectId}
          listApi={customWeaponsApi.importSourcesFromProject}
          importApi={customWeaponsApi.importFromProject}
          onClose={() => setProjectImportOpen(false)}
          onDone={() => invalidate()}
        />
      )}

      {/* 导出法宝到文件（14-SRS US-24） */}
      {exportOpen && (
        <ImportFromProjectDialog
          open={exportOpen}
          mode="export"
          title="导出法宝到文件"
          projectId={projectId}
          module="weapons"
          moduleName="法宝"
          listCurrentApi={async (pid) => ((await customWeaponsApi.list(pid)) as any[]).map((w) => ({ id: w.id, name: w.name }))}
          exportApi={(pid, data) => customWeaponsApi.exportFile(pid, data.ids)}
          onClose={() => setExportOpen(false)}
          onDone={() => invalidate()}
        />
      )}

      {/* 从文件导入法宝（14-SRS US-24） */}
      {fileImportOpen && (
        <ImportFromProjectDialog
          open={fileImportOpen}
          mode="import-file"
          title="从文件导入法宝"
          projectId={projectId}
          module="weapons"
          moduleName="法宝"
          listCurrentApi={async (pid) => ((await customWeaponsApi.list(pid)) as any[]).map((w) => ({ id: w.id, name: w.name }))}
          importFileApi={customWeaponsApi.importFile}
          onClose={() => setFileImportOpen(false)}
          onDone={() => invalidate()}
        />
      )}

      {/* 养成预览弹窗（进化/变异/融合） */}
      {preview && (
        <Dialog open onClose={() => setPreview(null)} title={`${GROWTH_TYPE_LABELS[preview.operation] || '养成'}结果预览`} className="max-w-2xl">
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            {preview.narrative && (
              <div className="rounded-lg bg-gray-800/50 p-3 text-sm italic text-gray-300">{preview.narrative}</div>
            )}
            {preview.breakthroughScene && (
              <div className="rounded-lg border border-gold-500/20 bg-gold-500/5 p-3 text-sm text-gold-200/90">
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-gold-500/70">突破场景</span>
                {preview.breakthroughScene}
              </div>
            )}
            {preview.preview && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="title-serif text-base font-bold text-gray-100">{preview.preview.name}</span>
                  <Badge className={GRADE_COLORS[preview.preview.grade] || ''}>{preview.preview.grade}·第{preview.preview.gradeLevel || 1}层</Badge>
                </div>
                <p className="text-xs text-gold-300/80">{r.formLabel(preview.preview.category, preview.preview.type)}</p>
                <p className="text-xs text-gray-500">材质：{r.materialName(preview.preview.baseMaterial)}</p>
                {preview.preview.coreDirection?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {preview.preview.coreDirection.map((d: string, i: number) => (
                      <span key={i} className="rounded border border-gray-700 bg-gray-800/60 px-1.5 py-0.5 text-[10px] text-gray-400">{d}</span>
                    ))}
                  </div>
                )}
                {(preview.preview.generatedTraits || []).length > 0 ? (
                  <GeneratedTraitBlock label="灵真温养" traits={(preview.preview.generatedTraits || []).filter((t: any) => t.type === 'infuse')} />
                ) : (
                  <TraitBlock label="灵真温养" ids={preview.preview.soakTraits} r={r} />
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-gray-800 pt-3">
              <Button variant="ghost" onClick={() => setPreview(null)}><X className="h-4 w-4" /> 取消</Button>
              {preview.preview && (
                <Button onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending}>
                  <Check className="h-4 w-4" /> 确认入库
                </Button>
              )}
            </div>
          </div>
        </Dialog>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <WeaponDetailDialog
          weapon={detail}
          projectId={projectId}
          r={r}
          onClose={() => setDetail(null)}
          onReverted={invalidate}
        />
      )}

      {/* 强化结果弹窗（成功/失败醒目展示） */}
      {upgradeResult && (
        <Dialog open onClose={() => setUpgradeResult(null)} title="强化结果" className="max-w-sm">
          <div className="space-y-4 text-center">
            {upgradeResult.upgraded ? (
              <div className="flex flex-col items-center gap-1.5">
                <ArrowUpCircle className="h-10 w-10 text-gold-300" />
                <p className="title-serif text-xl font-bold text-gold-200">强化成功</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5">
                <X className="h-10 w-10 text-red-400" />
                <p className="title-serif text-xl font-bold text-red-300">强化失败</p>
              </div>
            )}
            <p className="text-sm text-gray-300">「{upgradeResult.weaponName}」</p>
            <div className="flex items-center justify-center gap-2">
              <Badge className={GRADE_COLORS[upgradeResult.oldGrade] || ''}>{upgradeResult.oldGrade}·第{upgradeResult.oldGradeLevel}层</Badge>
              <span className="text-gray-500">→</span>
              <Badge className={GRADE_COLORS[upgradeResult.newGrade] || ''}>{upgradeResult.newGrade}·第{upgradeResult.newGradeLevel}层</Badge>
            </div>
            {upgradeResult.narrative && (
              <p className="rounded-lg bg-gray-800/50 p-3 text-sm italic text-gray-400">{upgradeResult.narrative}</p>
            )}
            <div className="flex justify-center pt-1">
              <Button onClick={() => setUpgradeResult(null)}>知道了</Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* 删除确认 */}
      {deleteTarget && (
        <Dialog open onClose={() => setDeleteTarget(null)} title="确认删除" className="max-w-sm">
          <p className="text-sm text-gray-300">
            确定要删除「<span className="font-semibold text-red-300">{deleteTarget.name}</span>」吗？此为软删除，数据不会物理移除。
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={() => deleteMut.mutate(deleteTarget.id)} disabled={deleteMut.isPending}>删除</Button>
          </div>
        </Dialog>
      )}
      </>)}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 特质分组渲染（详情/预览复用）                                       */
/* ------------------------------------------------------------------ */

function TraitBlock({ label, ids, r }: { label: string; ids?: string[]; r: Resolver }) {
  if (!ids || ids.length === 0) return null
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-500">{label}（{ids.length}）</div>
      <div className="space-y-1.5">
        {ids.map((id) => <TraitLine key={id} id={id} r={r} />)}
      </div>
    </div>
  )
}

/** 方向组合式特质分组渲染（GeneratedTrait 富对象：名+描述+稀有+道缺） */
function GeneratedTraitBlock({ label, traits }: { label: string; traits: any[] }) {
  if (!traits || traits.length === 0) return null
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-500">{label}（{traits.length}）</div>
      <div className="space-y-1.5">
        {traits.map((t) => (
          <div key={t.id} className="rounded border border-gray-800 bg-gray-900/40 px-2.5 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className={cn('text-sm font-medium', t.isRare ? 'text-amber-300' : 'text-gray-200')}>{t.name}</span>
              {t.isRare && <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[10px] text-amber-300">稀有</span>}
            </div>
            {t.desc && <p className="mt-0.5 text-xs leading-relaxed text-gray-400">{t.desc}</p>}
            {t.flaw && <p className="mt-0.5 text-xs leading-relaxed text-red-400/80">道缺：{t.flaw}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 详情弹窗（含成长历史 + 回退）                                       */
/* ------------------------------------------------------------------ */

function WeaponDetailDialog({
  weapon, projectId, r, onClose, onReverted,
}: { weapon: any; projectId: string; r: Resolver; onClose: () => void; onReverted: () => void }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: history = [] } = useQuery({
    queryKey: ['custom-weapons-history', projectId, weapon.id],
    queryFn: () => customWeaponsApi.history(projectId, weapon.id),
  })

  // 文案（lore）
  const { data: loreData } = useQuery({
    queryKey: ['weapon-lore', projectId, weapon.id],
    queryFn: () => customWeaponsApi.getLore(projectId, weapon.id),
  })
  const loreCurrent = loreData?.current
  const loreHistory: any[] = loreData?.history || []

  const loreGenMut = useMutation({
    mutationFn: () => customWeaponsApi.generateLore(projectId, weapon.id),
    onSuccess: () => {
      toast('文案生成完成', 'success')
      queryClient.invalidateQueries({ queryKey: ['weapon-lore', projectId, weapon.id] })
    },
    onError: (e: any) => toast(e.message || '文案生成失败', 'error'),
  })

  const loreSetMut = useMutation({
    mutationFn: (loreId: number) => customWeaponsApi.setLoreCurrent(projectId, loreId),
    onSuccess: () => {
      toast('已切换当前文案版本', 'success')
      queryClient.invalidateQueries({ queryKey: ['weapon-lore', projectId, weapon.id] })
    },
    onError: (e: any) => toast(e.message || '切换失败', 'error'),
  })

  const revertMut = useMutation({
    mutationFn: (recordId: number) => customWeaponsApi.revert(projectId, recordId),
    onSuccess: () => {
      toast('已回退', 'success')
      queryClient.invalidateQueries({ queryKey: ['custom-weapons-history', projectId, weapon.id] })
      onReverted()
    },
    onError: (e: any) => toast(e.message || '回退失败', 'error'),
  })

  const senseCardMut = useMutation({
    mutationFn: () => customWeaponsApi.completeSenseCard(projectId, weapon.id),
    onSuccess: () => {
      toast('五感兵器卡已生成', 'success')
      queryClient.invalidateQueries({ queryKey: ['weapon-lore', projectId, weapon.id] })
    },
    onError: (e: any) => toast(e.message || '五感卡生成失败', 'error'),
  })

  // 单模块重生成五感卡
  const [senseBusy, setSenseBusy] = useState('')
  const regenSenseModule = async (module: string) => {
    setSenseBusy(module)
    try {
      await customWeaponsApi.generateSenseCard(projectId, weapon.id, {
        module,
        temperament: weapon.temperament || undefined,
        pastType: weapon.pastType || undefined,
        taboos: weapon.taboos || [],
        reverseMode: weapon.reverseMode || false,
      })
      queryClient.invalidateQueries({ queryKey: ['weapon-lore', projectId, weapon.id] })
      toast(`「${module}」已重生成`, 'success')
    } catch (e: any) {
      toast(e.message || '重生成失败', 'error')
    } finally {
      setSenseBusy('')
    }
  }
  const copyText = (text: string) => { navigator.clipboard.writeText(text); toast('已复制', 'success') }

  return (
    <Dialog open onClose={onClose} title={weapon.name} className="max-w-3xl">
      <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
        {/* 概要 */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={GRADE_COLORS[weapon.grade] || ''}>{weapon.grade}·第{weapon.gradeLevel}层</Badge>
          <Badge variant="gold">{r.formLabel(weapon.category, weapon.type)}</Badge>
          {weapon.isEvolved && <Badge className="border-red-500/30 bg-red-500/15 text-red-300">进化形态</Badge>}
          {weapon.growthType && weapon.growthType !== 'base' && (
            <Badge className="border-gray-700 bg-gray-800 text-gray-300">{GROWTH_TYPE_LABELS[weapon.growthType] || weapon.growthType}</Badge>
          )}
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><dt className="text-[11px] uppercase tracking-wider text-gray-500">基础材质</dt><dd className="text-sm text-gray-200">{r.materialName(weapon.baseMaterial)}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wider text-gray-500">本命祭炼</dt><dd className="text-sm text-gray-200">{r.soulName(weapon.soulRefineLevel)}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wider text-gray-500">适配修士</dt><dd className="text-sm text-gray-200">{r.fitMonk(weapon.type) || '—'}</dd></div>
          {weapon.fakeGrade && <div><dt className="text-[11px] uppercase tracking-wider text-gray-500">对外伪装</dt><dd className="text-sm text-amber-300">{weapon.fakeGrade}</dd></div>}
          <div className="sm:col-span-2">
            <dt className="text-[11px] uppercase tracking-wider text-gray-500">核心方向</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {(weapon.coreDirection || []).map((d: string, i: number) => (
                <span key={i} className="rounded border border-gray-700 bg-gray-800/60 px-1.5 py-0.5 text-[11px] text-gray-300">{d}</span>
              ))}
            </dd>
          </div>
        </dl>

        {/* 特质全解：generatedTraits 优先（新武器），老四列兜底（老武器只读） */}
        <div className="space-y-3 border-t border-gray-800 pt-4">
          {(weapon.generatedTraits || []).length > 0 ? (
            <>
              <GeneratedTraitBlock label="道胎铸炼" traits={(weapon.generatedTraits || []).filter((t: any) => t.type === 'forge')} />
              <GeneratedTraitBlock label="灵真温养" traits={(weapon.generatedTraits || []).filter((t: any) => t.type === 'infuse')} />
              <GeneratedTraitBlock label="外相加持" traits={(weapon.generatedTraits || []).filter((t: any) => t.type === 'enchant')} />
              <GeneratedTraitBlock label="内景洞天" traits={(weapon.generatedTraits || []).filter((t: any) => t.type === 'hidden')} />
            </>
          ) : (
            <>
              <TraitBlock label="道胎铸炼" ids={weapon.forgeTraits} r={r} />
              <TraitBlock label="灵真温养" ids={weapon.soakTraits} r={r} />
              <TraitBlock label="外相加持" ids={weapon.attachTraits} r={r} />
              <TraitBlock label="内景洞天" ids={weapon.cavityTraits} r={r} />
            </>
          )}
        </div>

        {/* 武器文案（名号/化名/简介/招式） */}
        <div className="border-t border-gray-800 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
              <BookOpen className="h-4 w-4" /> 武器文案
            </div>
            <Button size="sm" variant="outline" onClick={() => loreGenMut.mutate()} disabled={loreGenMut.isPending}>
              {loreGenMut.isPending ? <Spinner className="h-3.5 w-3.5" /> : <ScrollText className="h-3.5 w-3.5" />}
              {loreCurrent ? '重新生成' : '生成文案'}
            </Button>
          </div>

          {!loreCurrent ? (
            <p className="text-xs text-gray-500">尚未生成文案。点击「生成文案」由 AI 撰写名号、简介与配套招式。</p>
          ) : (
            <div className="space-y-3">
              {/* 名号 + 化名 */}
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-gray-500">正式名号</span>
                  <p className="title-serif text-lg font-bold text-gold-200">{loreCurrent.name}</p>
                </div>
                {loreCurrent.fakeName && (
                  <div>
                    <span className="text-[11px] uppercase tracking-wider text-gray-500">对外化名</span>
                    <p className="text-sm text-amber-300/90">{loreCurrent.fakeName}</p>
                  </div>
                )}
              </div>
              {/* 简介 */}
              <div className="rounded-lg border border-gold-500/20 bg-gold-500/5 px-3 py-2">
                <span className="mb-0.5 block text-[11px] uppercase tracking-wider text-gold-500/70">一句话简介</span>
                <p className="text-sm leading-relaxed text-gray-200">{loreCurrent.intro}</p>
              </div>
              {/* 招式 */}
              {loreCurrent.moves?.length > 0 && (
                <div>
                  <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-gray-500">配套招式（{loreCurrent.moves.length}）</span>
                  <div className="space-y-1.5">
                    {loreCurrent.moves.map((m: any, i: number) => (
                      <div key={i} className="rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2">
                        <span className="text-sm font-medium text-gray-200">
                          {i + 1}. 「{m.name}」{i === loreCurrent.moves.length - 1 && <span className="ml-1 text-[10px] text-red-400/80">杀招</span>}
                        </span>
                        <p className="mt-0.5 text-xs leading-relaxed text-gray-400">{m.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 版本历史 */}
              {loreHistory.length > 1 && (
                <div className="border-t border-gray-800/60 pt-2">
                  <span className="mb-1 block text-[11px] text-gray-600">历史版本（{loreHistory.length}）</span>
                  <div className="space-y-1">
                    {loreHistory.filter((h: any) => h.id !== loreCurrent.id).map((h: any) => (
                      <div key={h.id} className="flex items-center justify-between rounded border border-gray-800/60 px-2.5 py-1.5">
                        <div className="min-w-0 flex-1">
                          <span className="text-xs text-gray-300">{h.name}</span>
                          <span className="ml-2 text-[10px] text-gray-600">{new Date(h.createdAt).toLocaleString()}</span>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => loreSetMut.mutate(h.id)} disabled={loreSetMut.isPending} title="设为当前版本" aria-label="设为当前版本">
                          <Check className="h-3.5 w-3.5 text-gold-400" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 五感兵器卡 */}
        <div className="border-t border-gray-800 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
              <Sparkles className="h-4 w-4" /> 五感兵器卡
            </div>
            {!loreCurrent?.realSkill && (
              <Button size="sm" variant="outline" onClick={() => senseCardMut.mutate()} disabled={senseCardMut.isPending}>
                {senseCardMut.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />} 补全五感卡
              </Button>
            )}
          </div>
          {loreCurrent?.realSkill ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <SenseCardModule title="真本事" content={loreCurrent.realSkill} busy={senseBusy === '真本事'} onRegen={() => regenSenseModule('真本事')} onCopy={copyText} wide />
              <SenseCardModule title="怪毛病" content={loreCurrent.weirdTrait} busy={senseBusy === '怪毛病'} onRegen={() => regenSenseModule('怪毛病')} onCopy={copyText} />
              <SenseCardModule title="前尘影事" content={loreCurrent.pastMemory} busy={senseBusy === '前尘影事'} onRegen={() => regenSenseModule('前尘影事')} onCopy={copyText} />
              <SenseCardModule title="江湖名头" content={[loreCurrent.jianghuNickname && `外号：${loreCurrent.jianghuNickname}`, loreCurrent.jianghuHeihua && `黑话：${loreCurrent.jianghuHeihua}`].filter(Boolean).join('\n')} busy={senseBusy === '江湖名头'} onRegen={() => regenSenseModule('江湖名头')} onCopy={copyText} />
              <SenseCardModule title="专属规矩" content={loreCurrent.rules} busy={senseBusy === '专属规矩'} onRegen={() => regenSenseModule('专属规矩')} onCopy={copyText} />
              <SenseCardModule title="剧情钩子" list={(loreCurrent.hooks || []).map((h: any) => (typeof h === 'string' ? h : h.content || h.title)).filter(Boolean)} busy={senseBusy === '剧情钩子'} onRegen={() => regenSenseModule('剧情钩子')} onCopy={copyText} />
              <SenseCardModule title="名场面草稿" list={(loreCurrent.famousScenes || []).map((s: any) => (typeof s === 'string' ? s : s.content)).filter(Boolean)} busy={senseBusy === '名场面草稿'} onRegen={() => regenSenseModule('名场面草稿')} onCopy={copyText} wide />
            </div>
          ) : (
            <p className="text-xs text-gray-500">尚未生成五感兵器卡。点击「补全五感卡」基于已有特质自动生成真本事、怪毛病、前尘、名头、规矩等写作素材。</p>
          )}
        </div>

        {/* 器灵 */}
        {loreCurrent?.spirit && (
          <div className="border-t border-gray-800 pt-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-300">
              <Zap className="h-4 w-4" /> 器灵
            </div>
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-3 py-2">
              <p className="text-sm leading-relaxed text-gray-300">{loreCurrent.spirit}</p>
            </div>
          </div>
        )}

        {/* 烙印 */}
        <ScarSection projectId={projectId} wid={weapon.id} />

        {/* 重铸 */}
        <RecraftSection projectId={projectId} weapon={weapon} r={r} />

        {/* 成长历史 */}
        <div className="border-t border-gray-800 pt-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-300">
            <History className="h-4 w-4" /> 成长历史
          </div>
          {history.length === 0 ? (
            <EmptyState message="暂无成长记录" />
          ) : (
            <div className="space-y-2">
              {history.map((rec: any) => (
                <div key={rec.id} className="rounded-lg border border-gray-800 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge className="border-gray-700 bg-gray-800 text-gray-300">{GROWTH_TYPE_LABELS[rec.operationType] || rec.operationType}</Badge>
                      <Badge className={rec.result === 'success' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}>
                        {rec.result === 'success' ? '成功' : '失败'}
                      </Badge>
                    </div>
                    {rec.operationType === 'upgrade' && (
                      <Button size="sm" variant="ghost" onClick={() => revertMut.mutate(rec.id)} disabled={revertMut.isPending}>
                        <RotateCcw className="h-3.5 w-3.5" /> 回退
                      </Button>
                    )}
                  </div>
                  {rec.operatorNote && <p className="mt-1 text-xs text-gray-400">{rec.operatorNote}</p>}
                  <p className="mt-1 text-[11px] text-gray-600">{new Date(rec.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 轻量编辑弹窗（19a：改名号/底蕴/伪装/方向/简介，保存即转正式）          */
/* ------------------------------------------------------------------ */

function WeaponEditDialog({
  projectId, catalog, weapon, onClose, onSaved,
}: { projectId: string; catalog: any; weapon: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [form, setForm] = useState({
    name: weapon.name || '',
    grade: weapon.grade || '凡造',
    fakeGrade: weapon.fakeGrade || '',
    coreDirection: Array.isArray(weapon.coreDirection) ? weapon.coreDirection.join('\n') : '',
    description: weapon.description || '',
  })
  const grades: string[] = catalog?.grades || ['凡造', '灵淬', '宝胎', '道纹', '仙蜕', '神蕴']
  const gradeIdx = grades.indexOf(weapon.grade)
  const lowerGrades = grades.slice(0, gradeIdx < 0 ? 0 : gradeIdx)

  const saveMut = useMutation({
    mutationFn: () => customWeaponsApi.update(projectId, weapon.id, {
      name: form.name.trim(),
      grade: form.grade,
      fakeGrade: form.fakeGrade || null,
      coreDirection: form.coreDirection.split('\n').map((s: string) => s.trim()).filter(Boolean),
      description: form.description.trim() || null,
    }),
    onSuccess: () => { toast('法宝已更新', 'success'); onSaved() },
    onError: (e: any) => toast(e.message || '保存失败', 'error'),
  })

  return (
    <Dialog open onClose={onClose} title="编辑法宝" className="max-w-xl">
      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
        <Input label="名号" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Select
          label="底蕴层级"
          value={form.grade}
          onChange={(e) => setForm({ ...form, grade: e.target.value })}
          options={grades.map((g) => ({ value: g, label: g }))}
        />
        <Select
          label="对外伪装底蕴（留空不伪装）"
          value={form.fakeGrade}
          onChange={(e) => setForm({ ...form, fakeGrade: e.target.value })}
          options={[
            { value: '', label: '不伪装' },
            ...lowerGrades.map((g) => ({ value: g, label: g })),
          ]}
        />
        <Textarea
          label="核心方向（每行一条）"
          rows={3}
          value={form.coreDirection}
          onChange={(e) => setForm({ ...form, coreDirection: e.target.value })}
        />
        <Textarea
          label="简介"
          rows={4}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        {weapon.entityStatus === 'draft' && (
          <p className="text-xs text-orange-300/80">该法宝为章节生成自动建档的草稿，保存后将转为正式法宝。</p>
        )}
        <div className="flex justify-end gap-2 border-t border-gray-800 pt-3">
          <Button variant="ghost" onClick={onClose}><X className="h-4 w-4" /> 取消</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.name.trim()}>
            {saveMut.isPending ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />} 保存
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 铸器弹窗（四步点选 + 骰子随机）                                     */
/* ------------------------------------------------------------------ */

function ForgeDialog({
  projectId, catalog, r, onClose, onCreated,
}: { projectId: string; catalog: any; r: Resolver; onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<any>(null)
  const [locked, setLocked] = useState<Record<string, boolean>>({})
  const [step, setStep] = useState(1)
  const [loreResult, setLoreResult] = useState<any>(null)
  const [generatingLore, setGeneratingLore] = useState(false)

  // ---- 方向组合式特质系统状态 ----
  const [selectedDirections, setSelectedDirections] = useState<Record<string, string[]>>({})
  const [traitPreview, setTraitPreview] = useState<any>(null)
  const [disabledDirs, setDisabledDirs] = useState<string[]>([])
  const [dirTab, setDirTab] = useState<'forge' | 'infuse' | 'enchant' | 'hidden'>('forge')
  // 器性设定
  const [temperament, setTemperament] = useState<string>('')
  const [pastType, setPastType] = useState<string>('')
  const [taboos, setTaboos] = useState<string[]>([])
  const [reverseMode, setReverseMode] = useState(false)
  const [lazyOpen, setLazyOpen] = useState(false)
  // 五感兵器卡
  const [senseCard, setSenseCard] = useState<any>(null)
  const [createdWid, setCreatedWid] = useState<number | null>(null)
  const [senseBusy, setSenseBusy] = useState<string>('')
  const [smartDesc, setSmartDesc] = useState('')
  const [smartBusy, setSmartBusy] = useState(false)

  // 打开时先全随机一把，填充预览（含方向/器性默认值）
  useEffect(() => {
    let alive = true
    customWeaponsApi.random(projectId, {})
      .then((d: any) => {
        if (!alive) return
        setDraft(d)
        setSelectedDirections(d?.selectedDirections || {})
        setDisabledDirs(d?.disabledDirections || [])
        if (d?.temperament) setTemperament(d.temperament)
        if (d?.pastType) setPastType(d.pastType)
        if (Array.isArray(d?.taboos)) setTaboos(d.taboos)
        setReverseMode(!!d?.reverseMode)
      })
      .catch(() => { if (alive) setDraft({}) })
    return () => { alive = false }
  }, [projectId])

  // 方向/基础变化时，防抖 300ms 调用零token特质预览
  useEffect(() => {
    if (!draft?.category || !draft?.type || !draft?.baseMaterial) return
    const t = setTimeout(() => {
      customWeaponsApi.generateTraits(projectId, {
        directions: selectedDirections,
        category: draft.category,
        type: draft.type,
        grade: draft.grade || '凡造',
        baseMaterial: draft.baseMaterial,
      })
        .then((res: any) => {
          setTraitPreview(res)
          if (Array.isArray(res?.disabledDirections)) setDisabledDirs(res.disabledDirections)
        })
        .catch(() => { /* 静默：预览失败不阻断 */ })
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, JSON.stringify(selectedDirections), draft?.category, draft?.type, draft?.grade, draft?.baseMaterial])

  if (!draft) {
    return (
      <Dialog open onClose={onClose} title="铸成新法宝" className="max-w-4xl">
        <div className="flex justify-center py-16"><Spinner /></div>
      </Dialog>
    )
  }

  const grades: string[] = catalog?.grades || ['凡造', '灵淬', '宝胎', '道纹', '仙蜕', '神蕴']
  const categories: any[] = catalog?.categories || []
  const materials: any[] = catalog?.materials || []
  const soulLevels: any[] = catalog?.soulRefineLevels || []
  const cavityLimit: Record<string, number> = catalog?.cavityLimit || {}
  const traitDirections: any[] = catalog?.traitDirections || []
  const temperaments: any[] = catalog?.temperaments || []
  const pastTypes: any[] = catalog?.pastTypes || []
  const tabooList: any[] = catalog?.taboos || []

  const toggleLock = (field: string) => setLocked((l) => ({ ...l, [field]: !l[field] }))
  const patch = (p: any) => setDraft((d: any) => ({ ...d, ...p }))

  // ---- 单字段骰子 ----
  const rollCategory = () => {
    if (!categories.length) return
    const cat = rand(categories)
    const form: any = rand(cat.forms)
    patch({ category: cat.id, type: form.id, coreDirection: form.coreDirection })
  }
  const rollType = () => {
    if (!categories.length) return
    const cat = categories.find((c: any) => c.id === draft.category) || categories[0]
    const form: any = rand(cat.forms)
    patch({ category: cat.id, type: form.id, coreDirection: form.coreDirection })
  }
  const setGrade = (grade: string) => {
    const limit = cavityLimit[grade] ?? 1
    patch({ grade, cavityTraits: (draft.cavityTraits || []).slice(0, limit) })
  }
  const rollGrade = () => setGrade(rand(grades))
  const rollMaterial = () => { if (materials.length) patch({ baseMaterial: rand(materials).id }) }

  // ---- 方向点选（含冲突互斥 + 维度上限） ----
  const dirMax = (rule?: string) => (rule === 'max2' ? 2 : 1)
  const toggleDirection = (catId: string, dim: any, dirId: string) => {
    if (disabledDirs.includes(dirId)) return
    const cur = selectedDirections[catId] || []
    if (cur.includes(dirId)) {
      setSelectedDirections((s) => ({ ...s, [catId]: cur.filter((x) => x !== dirId) }))
      return
    }
    // 维度内互斥：移除与目标冲突的方向
    const dirDef = dim.directions.find((d: any) => d.id === dirId)
    let next = cur.filter((id) => !(dirDef?.conflictDirs || []).includes(id))
    // 维度上限：single/max1/required1=1，max2=2
    const dimIds = dim.directions.map((d: any) => d.id)
    const inDim = next.filter((id) => dimIds.includes(id))
    const max = dirMax(dim.selectRule)
    if (inDim.length >= max) next = next.filter((id) => !dimIds.includes(id))
    next = [...next, dirId]
    setSelectedDirections((s) => ({ ...s, [catId]: next }))
  }

  // 单维度骰子：在该维度可用方向中随机选 1 个
  const rollDimension = (catId: string, dim: any) => {
    const eligible = dim.directions.filter((d: any) => !disabledDirs.includes(d.id))
    if (!eligible.length) return
    const pick: any = rand(eligible)
    const cur = selectedDirections[catId] || []
    const dimIds = dim.directions.map((d: any) => d.id)
    const next = [...cur.filter((id) => !dimIds.includes(id)), pick.id]
    setSelectedDirections((s) => ({ ...s, [catId]: next }))
  }

  // ---- 第四步：创建武器 + 文案 + 五感兵器卡 ----
  // 入库（create/update）与 LLM 生成解耦：入库成功即视为已保存，LLM 失败不阻塞"完成"
  const handleGenerate = async () => {
    if (!draft.category || !draft.type) { toast('请先完成基础构型', 'error'); setStep(1); return }
    if (!draft.baseMaterial) { toast('请先选择基础材质', 'error'); setStep(1); return }
    setGeneratingLore(true)
    try {
      let wid = createdWid
      // 名字保护：用户已定名（智能匹配/随机/手填）则保留，仅默认"·待命名"时才采用 LLM 名
      const userSetName = draft.name?.trim() || ''
      const isDefaultName = !userSetName || userSetName.endsWith('·待命名')
      if (!wid) {
        // 首次创建：先入库，确保"完成"立即可用
        const created = await customWeaponsApi.create(projectId, {
          name: userSetName || `${r.formLabel(draft.category, draft.type)}·待命名`,
          category: draft.category,
          type: draft.type,
          grade: draft.grade || '凡造',
          fakeGrade: draft.fakeGrade ?? null,
          baseMaterial: draft.baseMaterial,
          soulRefineLevel: draft.soulRefineLevel || 'none',
          coreDirection: draft.coreDirection || [],
          linkedCharacterIds: [],
          selectedDirections,
          generatedTraits: traitPreview?.traits || draft.generatedTraits || [],
          temperament: temperament || undefined,
          pastType: pastType || undefined,
          taboos,
          reverseMode,
        })
        wid = created.id
        setCreatedWid(wid)
      } else {
        // 已创建过（编辑后返回重试 / 全部重生成）：先回写当前草稿，避免编辑被丢弃
        await customWeaponsApi.update(projectId, wid, {
          category: draft.category,
          type: draft.type,
          grade: draft.grade || '凡造',
          baseMaterial: draft.baseMaterial,
          selectedDirections,
          generatedTraits: traitPreview?.traits || draft.generatedTraits || [],
          temperament: temperament || undefined,
          pastType: pastType || undefined,
          taboos,
        })
      }
      const weaponId = wid as number
      // 文案 + 五感卡为 LLM 生成，失败不阻塞入库与"完成"
      try {
        const lore = await customWeaponsApi.generateLore(projectId, weaponId)
        const loreData = lore.data || lore
        // 名字保护：仅默认名时才用 LLM 名覆盖数据库；用户已定名的保留原名
        const finalName = isDefaultName && loreData.name ? loreData.name : userSetName
        if (loreData.name && isDefaultName) await customWeaponsApi.update(projectId, weaponId, { name: loreData.name })
        setLoreResult({ ...loreData, weaponId })
        patch({ name: finalName || '' })
        const sense = await customWeaponsApi.generateSenseCard(projectId, weaponId, {
          temperament: temperament || undefined,
          pastType: pastType || undefined,
          taboos,
          reverseMode,
        })
        setSenseCard(sense?.data || sense)
        toast(`生成完成：${finalName || '已入库'}`, 'success')
      } catch (e: any) {
        toast(`武器已入库，但文案生成失败（${e.message || '未知错误'}）。可直接点击「完成」保存，或稍后重试生成。`, 'error')
      }
    } catch (e: any) {
      toast(e.message || '创建失败', 'error')
    } finally {
      setGeneratingLore(false)
    }
  }

  // 单模块重生成五感卡
  const regenSenseModule = async (module: string) => {
    if (!createdWid) return
    setSenseBusy(module)
    try {
      const res = await customWeaponsApi.generateSenseCard(projectId, createdWid, {
        module,
        temperament: temperament || undefined,
        pastType: pastType || undefined,
        taboos,
        reverseMode,
      })
      setSenseCard((prev: any) => ({ ...(prev || {}), ...(res?.data || res) }))
      toast(`「${module}」已重生成`, 'success')
    } catch (e: any) {
      toast(e.message || '重生成失败', 'error')
    } finally {
      setSenseBusy('')
    }
  }

  const copyText = (text: string) => {
    navigator.clipboard?.writeText(text)
      .then(() => toast('已复制', 'success'))
      .catch(() => toast('复制失败', 'error'))
  }

  // ---- 懒人一键生成：3 个二元问题 → 自动填充并跳到生成步 ----
  const handleLazy = async (opts: { path: string; style: string; line: string }) => {
    try {
      const res: any = await customWeaponsApi.random(projectId, {
        reverseMode: opts.path === 'evil',
        temperament: opts.style === 'funny' ? 'playful' : 'stern',
        pastType: opts.line === 'love' ? 'lover_death' : 'general_fall',
      } as any)
      setDraft(res)
      setSelectedDirections(res?.selectedDirections || {})
      setDisabledDirs(res?.disabledDirections || [])
      if (res?.temperament) setTemperament(res.temperament)
      if (res?.pastType) setPastType(res.pastType)
      if (Array.isArray(res?.taboos)) setTaboos(res.taboos)
      setReverseMode(!!res?.reverseMode)
      setLazyOpen(false)
      setStep(4)
      toast('懒人套餐已就绪，点击「创建武器并生成」', 'success')
    } catch (e: any) {
      toast(e.message || '一键生成失败', 'error')
    }
  }

  // ---- 一键全随机（尊重锁定） ----
  const rollAll = async () => {
    try {
      const res: any = await customWeaponsApi.random(projectId, { base: draft, locked })
      setDraft(res)
      setSelectedDirections(res?.selectedDirections || {})
      setDisabledDirs(res?.disabledDirections || [])
      if (res?.temperament) setTemperament(res.temperament)
      if (res?.pastType) setPastType(res.pastType)
      if (Array.isArray(res?.taboos)) setTaboos(res.taboos)
      setReverseMode(!!res?.reverseMode)
    } catch (e: any) {
      toast(e.message || '随机失败', 'error')
    }
  }

  // ---- 以文拟器 · 智能匹配（尊重锁定） ----
  const handleSmartMatch = async () => {
    const desc = smartDesc.trim()
    if (desc.length < 5) { toast('请输入至少 5 个字的描述', 'info'); return }
    setSmartBusy(true)
    try {
      const res: any = await customWeaponsApi.smartMatch(projectId, desc)
      const patchObj: Record<string, any> = {}
      if (!locked.type && res.category && res.type) {
        const cat = categories.find((c: any) => c.id === res.category)
        const form = cat?.forms.find((f: any) => f.id === res.type)
        if (form) {
          patchObj.category = res.category
          patchObj.type = res.type
          patchObj.coreDirection = form.coreDirection
        }
      }
      if (!locked.grade && res.grade) patchObj.grade = res.grade
      if (!locked.baseMaterial && res.baseMaterial) patchObj.baseMaterial = res.baseMaterial
      if (res.name) patchObj.name = res.name
      patch(patchObj)
      if (res.temperament) setTemperament(res.temperament)
      if (res.pastType) setPastType(res.pastType)
      if (Array.isArray(res.taboos)) setTaboos(res.taboos)
      if (typeof res.reverseMode === 'boolean') setReverseMode(res.reverseMode)
      toast('已按描述匹配参数，可继续微调', 'success')
    } catch (e: any) {
      toast(e.message || '智能匹配失败', 'error')
    } finally {
      setSmartBusy(false)
    }
  }

  // ---- 门类/形制点选 ----
  const selectCategory = (catId: string) => {
    const cat = categories.find((c: any) => c.id === catId)
    if (!cat) return
    const form = cat.forms[0]
    patch({ category: catId, type: form.id, coreDirection: form.coreDirection })
  }
  const selectForm = (catId: string, form: any) => {
    patch({ category: catId, type: form.id, coreDirection: form.coreDirection })
  }

  const toggleTaboo = (id: string) => {
    setTaboos((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      if (cur.length >= 2) { toast('忌讳最多选 2 项', 'info'); return cur }
      return [...cur, id]
    })
  }

  // ---- 敛藏锋芒 ----
  const gradeIdx = grades.indexOf(draft.grade)
  const lowerGrades = grades.slice(0, gradeIdx < 0 ? 0 : gradeIdx)
  const fakeOn = draft.fakeGrade != null

  const handleFinish = () => { onCreated() }

  const activeCat = categories.find((c: any) => c.id === draft.category)
  const activeCatDef = traitDirections.find((c: any) => c.id === dirTab)
  const previewTraits: any[] = traitPreview?.traits ?? draft.generatedTraits ?? []
  const stackCount: number = traitPreview?.stackCount ?? draft.stackInfo?.count ?? 0
  const rareProb: number = traitPreview?.rareProb ?? draft.stackInfo?.rareProb ?? 0
  const flawProb: number = traitPreview?.flawProb ?? draft.stackInfo?.flawProb ?? 0

  return (
    <Dialog open onClose={onClose} title="铸成新法宝" className="max-w-4xl">
      <div className="flex max-h-[70vh] flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        {/* 预览区 */}
        <div>
          <Card className="mb-3">
            <CardContent className="space-y-2 p-3">
              <div className="text-[11px] uppercase tracking-wider text-gray-500">以文拟器 · 智能匹配</div>
              <Textarea
                rows={3}
                placeholder="描述你想要的法宝，如「上古凶剑，嗜血好杀，曾随魔尊屠城」…"
                value={smartDesc}
                onChange={(e) => setSmartDesc(e.target.value)}
                aria-label="智能匹配输入"
              />
              <Button className="w-full" onClick={handleSmartMatch} disabled={smartBusy}>
                {smartBusy ? <Spinner className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />} 智能匹配参数
              </Button>
            </CardContent>
          </Card>
          <Button className="mb-3 w-full" onClick={rollAll}>
            <Dice5 className="h-4 w-4" /> 一键全随机
          </Button>
          <Card featured>
            <CardContent className="space-y-3 p-4">
              <div>
                <div className="mb-0.5 text-[11px] uppercase tracking-wider text-gray-500">名号</div>
                <span className="title-serif text-lg font-bold text-gray-100">{draft.name || '第四步生成'}</span>
              </div>
              <PreviewRow label="门类·形制" onDice={rollType} onLock={() => toggleLock('type')} locked={!!locked.type}>
                <span className="text-sm text-gold-200">{r.formLabel(draft.category, draft.type)}</span>
              </PreviewRow>
              <PreviewRow label="底蕴" onDice={rollGrade} onLock={() => toggleLock('grade')} locked={!!locked.grade}>
                <Badge className={GRADE_COLORS[draft.grade] || ''}>{draft.grade || '—'}</Badge>
              </PreviewRow>
              <PreviewRow label="材质" onDice={rollMaterial} onLock={() => toggleLock('baseMaterial')} locked={!!locked.baseMaterial}>
                <span className="text-sm text-gray-200">{r.materialName(draft.baseMaterial)}</span>
              </PreviewRow>
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-gray-500">核心方向</div>
                <div className="flex flex-wrap gap-1">
                  {(draft.coreDirection || []).map((d: string, i: number) => (
                    <span key={i} className="rounded border border-gray-700 bg-gray-800/60 px-1.5 py-0.5 text-[11px] text-gray-300">{d}</span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-gray-500">适配修士</div>
                <p className="text-xs text-gray-400">{r.fitMonk(draft.type) || '—'}</p>
              </div>

              {/* 敛藏锋芒 */}
              <div className="border-t border-gray-800 pt-3">
                <Switch
                  checked={fakeOn}
                  onChange={(on) => patch({ fakeGrade: on ? (lowerGrades[lowerGrades.length - 1] || null) : null })}
                  label="敛藏锋芒（对外伪装底蕴）"
                />
                {fakeOn && (
                  <div className="mt-2">
                    <Select
                      label="对外伪装底蕴"
                      value={draft.fakeGrade || ''}
                      onChange={(e) => patch({ fakeGrade: e.target.value || null })}
                      options={lowerGrades.length
                        ? lowerGrades.map((g) => ({ value: g, label: g }))
                        : [{ value: '', label: '（无更低底蕴可伪装）' }]}
                    />
                  </div>
                )}
              </div>

              {/* 生成特质预览（方向系统，实时防抖更新） */}
              <div className="border-t border-gray-800 pt-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-gray-500">
                  <Sparkles className="h-3 w-3 text-gold-400" /> 生成特质预览（{previewTraits.length}）
                </div>
                {previewTraits.length === 0 ? (
                  <p className="text-xs text-gray-600">尚未选择特质方向，前往「特质方向」点选。</p>
                ) : (
                  <div className="space-y-1.5">
                    {previewTraits.map((t: any) => (
                      <div
                        key={t.id}
                        className={cn(
                          'rounded-lg border px-2.5 py-1.5',
                          t.isRare ? 'border-gold-400/60 bg-gold-500/10' : 'border-gray-800 bg-gray-950/50'
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn('text-xs font-medium', t.isRare ? 'text-gold-200' : 'text-gray-200')}>{t.name}</span>
                          <Badge className={TRAIT_TYPE_BADGE[t.type] || ''}>{TRAIT_TYPE_LABELS[t.type] || t.type}</Badge>
                          {t.isRare && <Badge variant="gold">✨稀有</Badge>}
                          {t.flaw && <span className="rounded border border-gray-700 bg-gray-800/60 px-1 text-[10px] text-gray-400">⚠️瑕疵</span>}
                        </div>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{t.desc}</p>
                        {t.flaw && <p className="mt-0.5 text-[11px] text-amber-300/80">瑕疵：{t.flaw}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 点选区 */}
        <div>
          {/* 步骤指示 */}
          <div className="mb-4 flex items-center gap-2">
            {[{ n: 1, t: '基础构型' }, { n: 2, t: '特质方向' }, { n: 3, t: '器性设定' }, { n: 4, t: '生成' }].map((s) => (
              <button
                key={s.n}
                onClick={() => setStep(s.n)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors',
                  step === s.n ? 'border-gold-400 bg-gold-500/15 text-gold-200' : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-600'
                )}
              >
                <span className="font-bold">{s.n}</span> {s.t}
              </button>
            ))}
          </div>

          <div className="space-y-5">
            {/* 第一步：基础构型 */}
            {step === 1 && (
              <>
                <Section title="门类选择" hint="点击门类展开形制，选定形制自动填充核心方向与适配修士">
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map((c: any) => (
                      <SelTag key={c.id} active={draft.category === c.id} onClick={() => selectCategory(c.id)} title={c.desc}>
                        {c.name}
                      </SelTag>
                    ))}
                  </div>
                  {activeCat && (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-l-2 border-gold-500/30 pl-2">
                      {activeCat.forms.map((f: any) => (
                        <SelTag key={f.id} active={draft.type === f.id} onClick={() => selectForm(activeCat.id, f)} title={`${f.desc}｜适配：${f.fitMonk}`}>
                          {f.name}
                        </SelTag>
                      ))}
                    </div>
                  )}
                </Section>

                <Section title="底蕴层级" hint="六档底蕴，越高越稀有">
                  <div className="flex flex-wrap gap-1.5">
                    {grades.map((g) => (
                      <SelTag key={g} active={draft.grade === g} onClick={() => setGrade(g)} title={GRADE_DESC[g]}>
                        <span className="flex items-center gap-1">
                          <span className={cn('h-2 w-2 rounded-full', GRADE_COLORS[g]?.split(' ')[0])} />
                          {g}
                        </span>
                      </SelTag>
                    ))}
                  </div>
                </Section>

                <Section title="主材" hint="单选，决定兵刃的底材">
                  <div className="flex flex-wrap gap-1.5">
                    {materials.map((m: any) => (
                      <SelTag key={m.id} active={draft.baseMaterial === m.id} onClick={() => patch({ baseMaterial: m.id })} title={`${m.desc}｜适配：${m.fit}`}>
                        <span className={cn(RARITY_TEXT[m.rarity])}>{m.name}</span>
                      </SelTag>
                    ))}
                  </div>
                </Section>
              </>
            )}

            {/* 第二步：特质方向（方向组合式） */}
            {step === 2 && (
              <>
                {/* 四类特质 Tab */}
                <div className="flex flex-wrap gap-1.5">
                  {traitDirections.map((cat: any) => (
                    <DirectionTab
                      key={cat.id}
                      label={cat.label}
                      active={dirTab === cat.id}
                      count={(selectedDirections[cat.id] || []).length}
                      onClick={() => setDirTab(cat.id)}
                    />
                  ))}
                </div>

                {/* 当前类的维度行 */}
                {activeCatDef && (
                  <div className="space-y-3">
                    {activeCatDef.dimensions.map((dim: any) => (
                      <div key={dim.id} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-base leading-none">{dim.icon}</span>
                          <span className="text-sm font-medium text-gray-200">{dim.label}</span>
                          <span className="rounded border border-gray-700 bg-gray-800/60 px-1.5 py-0.5 text-[10px] text-gray-400">
                            {SELECT_RULE_LABELS[dim.selectRule] || dim.selectRule}
                          </span>
                          <MiniBtn onClick={() => rollDimension(activeCatDef.id, dim)} title={`随机${dim.label}`} >
                            <Dice5 className="h-3.5 w-3.5" />
                          </MiniBtn>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {dim.directions.map((dir: any) => {
                            const dis = disabledDirs.includes(dir.id)
                            return (
                              <SelTag
                                key={dir.id}
                                active={(selectedDirections[activeCatDef.id] || []).includes(dir.id)}
                                disabled={dis}
                                onClick={() => toggleDirection(activeCatDef.id, dim, dir.id)}
                                title={dis ? '与当前形制/道则不适配' : `${dir.hint}｜${dir.baseEffect}`}
                              >
                                {dir.label}
                              </SelTag>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 叠锻指示条（吸底） */}
                <StackingBar stackCount={stackCount} rareProb={rareProb} flawProb={flawProb} />
              </>
            )}

            {/* 第三步：器性设定 */}
            {step === 3 && (
              <>
                <div className="flex justify-end">
                  <Button variant="gold" size="sm" onClick={() => setLazyOpen((v) => !v)}>
                    <Wand2 className="h-4 w-4" /> 懒人一键生成
                  </Button>
                </div>
                {lazyOpen && <LazyModeForm onGenerate={handleLazy} />}

                <Section title="器性" hint="单选，决定兵器的脾性（悬停看适配）">
                  <div className="flex flex-wrap gap-1.5">
                    {temperaments.map((t: any) => (
                      <SelTag key={t.id} active={temperament === t.id} onClick={() => setTemperament(t.id)} title={`适配：${t.fitHint}`}>
                        {t.label}
                      </SelTag>
                    ))}
                  </div>
                </Section>

                <Section title="前尘类型" hint="单选，兵器的来历宿命">
                  <div className="flex flex-wrap gap-1.5">
                    {pastTypes.map((p: any) => (
                      <SelTag key={p.id} active={pastType === p.id} onClick={() => setPastType(p.id)} title={`适配：${p.fitHint}`}>
                        {p.label}
                      </SelTag>
                    ))}
                  </div>
                </Section>

                <Section title="专属忌讳" hint={`多选，最多 2 项（已选 ${taboos.length}/2）`}>
                  <div className="flex flex-wrap gap-1.5">
                    {tabooList.map((t: any) => (
                      <SelTag key={t.id} active={taboos.includes(t.id)} onClick={() => toggleTaboo(t.id)}>
                        {t.label}
                      </SelTag>
                    ))}
                  </div>
                </Section>

                <Section title="本命祭炼" hint="单选，默认无；越高与人器绑定越深">
                  <div className="grid gap-1.5">
                    {soulLevels.map((s: any) => (
                      <SelTag key={s.id} active={(draft.soulRefineLevel || 'none') === s.id} onClick={() => patch({ soulRefineLevel: s.id })} title={s.desc}>
                        <span className="font-medium">{s.name}</span>
                        <span className="ml-2 text-[11px] text-gray-500">{s.desc}</span>
                      </SelTag>
                    ))}
                  </div>
                </Section>

                <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                  <Switch checked={reverseMode} onChange={setReverseMode} label="反差感（器性/外表与内在反差，梗款更出彩）" />
                </div>
              </>
            )}

            {/* 第四步：生成（文案 + 五感兵器卡） */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="rounded-lg border border-gold-500/20 bg-gold-500/5 p-4 text-center">
                  <p className="text-sm text-gray-300">参数已就绪。点击下方按钮创建武器，并生成文案与五感兵器卡。</p>
                  <p className="mt-1 text-xs text-gray-500">叠锻 {stackCount} 层 · 方向特质 {previewTraits.length} 条</p>
                </div>

                {!loreResult ? (
                  <div className="flex justify-center py-6">
                    <Button onClick={handleGenerate} disabled={generatingLore}>
                      {generatingLore ? <Spinner className="h-4 w-4" /> : <Hammer className="h-4 w-4" />}
                      {generatingLore ? '正在铸器并生成…' : createdWid ? '重试生成文案' : '铸器并生成文案'}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* 武器文案 */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
                        <ScrollText className="h-4 w-4" /> 武器文案
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <div>
                          <span className="text-[11px] uppercase tracking-wider text-gray-500">正式名号</span>
                          <p className="title-serif text-xl font-bold text-gold-200">{loreResult.name}</p>
                        </div>
                        {loreResult.fakeName && (
                          <div>
                            <span className="text-[11px] uppercase tracking-wider text-gray-500">对外化名</span>
                            <p className="text-sm text-amber-300/90">{loreResult.fakeName}</p>
                          </div>
                        )}
                      </div>
                      <div className="rounded-lg border border-gold-500/20 bg-gold-500/5 px-3 py-2">
                        <span className="mb-0.5 block text-[11px] uppercase tracking-wider text-gold-500/70">一句话简介</span>
                        <p className="text-sm leading-relaxed text-gray-200">{loreResult.intro}</p>
                      </div>
                      {loreResult.moves?.length > 0 && (
                        <div>
                          <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-gray-500">配套招式（{loreResult.moves.length}）</span>
                          <div className="space-y-1.5">
                            {loreResult.moves.map((m: any, i: number) => (
                              <div key={i} className="rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2">
                                <span className="text-sm font-medium text-gray-200">
                                  {i + 1}. 「{m.name}」{i === loreResult.moves.length - 1 && <span className="ml-1 text-[10px] text-red-400/80">杀招</span>}
                                </span>
                                <p className="mt-0.5 text-xs leading-relaxed text-gray-400">{m.desc}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 五感兵器卡 */}
                    <div className="space-y-2 border-t border-gray-800 pt-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
                        <Zap className="h-4 w-4 text-gold-400" /> 五感兵器卡
                      </div>
                      {!senseCard ? (
                        <p className="text-xs text-gray-500">五感卡生成中或暂无内容。</p>
                      ) : (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <SenseCardModule title="真本事" moduleKey="真本事" busy={senseBusy === '真本事'} onRegen={() => regenSenseModule('真本事')} onCopy={copyText} content={senseCard.realSkill} />
                          <SenseCardModule title="怪毛病" moduleKey="怪毛病" busy={senseBusy === '怪毛病'} onRegen={() => regenSenseModule('怪毛病')} onCopy={copyText} content={senseCard.weirdTrait} />
                          <SenseCardModule title="前尘影事" moduleKey="前尘影事" busy={senseBusy === '前尘影事'} onRegen={() => regenSenseModule('前尘影事')} onCopy={copyText} content={senseCard.pastMemory} />
                          <SenseCardModule
                            title="江湖名头"
                            moduleKey="江湖名头"
                            busy={senseBusy === '江湖名头'}
                            onRegen={() => regenSenseModule('江湖名头')}
                            onCopy={copyText}
                            content={[senseCard.jianghuNickname && `外号：${senseCard.jianghuNickname}`, senseCard.jianghuHeihua && `黑话：${senseCard.jianghuHeihua}`].filter(Boolean).join('\n')}
                          />
                          <SenseCardModule title="专属规矩" moduleKey="专属规矩" busy={senseBusy === '专属规矩'} onRegen={() => regenSenseModule('专属规矩')} onCopy={copyText} content={senseCard.rules} />
                          <SenseCardModule
                            title="剧情钩子"
                            moduleKey="剧情钩子"
                            busy={senseBusy === '剧情钩子'}
                            onRegen={() => regenSenseModule('剧情钩子')}
                            onCopy={copyText}
                            list={(senseCard.hooks || []).map((h: any) => (typeof h === 'string' ? h : h.content || h.title)).filter(Boolean)}
                          />
                          <SenseCardModule
                            title="名场面草稿"
                            moduleKey="名场面草稿"
                            busy={senseBusy === '名场面草稿'}
                            onRegen={() => regenSenseModule('名场面草稿')}
                            onCopy={copyText}
                            list={(senseCard.famousScenes || []).map((s: any) => (typeof s === 'string' ? s : s.content)).filter(Boolean)}
                            wide
                          />
                        </div>
                      )}
                    </div>

                    {/* 重生成 */}
                    <div className="flex justify-center gap-2 pt-2">
                      <Button variant="outline" size="sm" onClick={() => setStep(1)} disabled={generatingLore}>
                        <Pencil className="h-3.5 w-3.5" /> 修改参数
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generatingLore}>
                        {generatingLore ? <Spinner className="h-3.5 w-3.5" /> : <Shuffle className="h-3.5 w-3.5" />} 全部重生成
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 底部导航（固定在弹窗底部） */}
          <div className="mt-4 flex shrink-0 items-center justify-between border-t border-gray-800 pt-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
                <ChevronLeft className="h-4 w-4" /> 上一步
              </Button>
              <Button variant="ghost" onClick={onClose}>取消</Button>
            </div>
            <div className="flex items-center gap-2">
              {step < 4 ? (
                <Button variant="outline" onClick={() => setStep((s) => Math.min(4, s + 1))}>
                  下一步 <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={handleFinish} disabled={!createdWid}>
                  <Hammer className="h-4 w-4" /> 铸成
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 方向组合式特质系统：常量 + 辅助组件                                  */
/* ------------------------------------------------------------------ */

/** 方向特质四类标签 */
const TRAIT_TYPE_LABELS: Record<string, string> = {
  forge: '改锻', infuse: '浸养', enchant: '加持', hidden: '窍藏',
}
const TRAIT_TYPE_BADGE: Record<string, string> = {
  forge: 'border-orange-500/30 bg-orange-500/15 text-orange-300',
  infuse: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
  enchant: 'border-blue-500/30 bg-blue-500/15 text-blue-300',
  hidden: 'border-purple-500/30 bg-purple-500/15 text-purple-300',
}

/** 按类统计 generatedTraits 数量 */
function countGenTraits(w: any, type: string): number {
  return (w.generatedTraits || []).filter((t: any) => t.type === type).length
}

/** 维度选择规则释义 */
const SELECT_RULE_LABELS: Record<string, string> = {
  single: '单选', max2: '最多2个', max1: '最多1个', required1: '必选1个',
}

/** 特质方向四类 Tab（含已选计数） */
function DirectionTab({
  label, active, count, onClick,
}: { label: string; active: boolean; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors',
        active ? 'border-gold-400 bg-gold-500/15 text-gold-200' : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-600'
      )}
    >
      {label}
      {count > 0 && (
        <span className={cn('rounded-full px-1.5 text-[10px]', active ? 'bg-gold-500/30 text-gold-100' : 'bg-gray-700 text-gray-300')}>{count}</span>
      )}
    </button>
  )
}

/** 叠锻指示条：层数 + 稀有/瑕疵概率，≥4层告警 */
function StackingBar({
  stackCount, rareProb, flawProb,
}: { stackCount: number; rareProb: number; flawProb: number }) {
  const danger = stackCount >= 4
  return (
    <div className={cn(
      'sticky bottom-0 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-xs',
      danger ? 'border-amber-500/40 bg-amber-500/10' : 'border-gray-800 bg-gray-900/80'
    )}
    >
      <span className={cn('flex items-center gap-1 font-medium', danger ? 'text-amber-300' : 'text-gray-300')}>
        {danger && <AlertTriangle className="h-3.5 w-3.5" />}
        当前叠锻：{stackCount}层
      </span>
      <span className={danger ? 'text-amber-300/90' : 'text-gray-400'}>稀有概率：{Math.round(rareProb * 100)}%</span>
      <span className={danger ? 'text-amber-300/90' : 'text-gray-400'}>瑕疵概率：{Math.round(flawProb * 100)}%</span>
      {danger && <span className="text-[11px] text-amber-400/80">叠锻过深，稀有与瑕疵并存</span>}
    </div>
  )
}

/** 五感兵器卡单模块卡片：标题 + 内容 + 骰子重生成 + 复制 */
function SenseCardModule({
  title, content, list, onRegen, onCopy, busy, wide,
}: {
  title: string; content?: string; list?: string[]; onRegen: () => void
  onCopy: (text: string) => void; busy?: boolean; wide?: boolean; moduleKey?: string
}) {
  const text = list ? list.join('\n') : (content || '')
  return (
    <div className={cn('rounded-lg border border-gray-800 bg-gray-950/50 p-3', wide && 'sm:col-span-2')}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gold-300/90">{title}</span>
        <span className="flex items-center gap-0.5">
          <MiniBtn onClick={onRegen} title={`重生成${title}`}>
            {busy ? <Spinner className="h-3 w-3" /> : <Dice5 className="h-3 w-3" />}
          </MiniBtn>
          <MiniBtn onClick={() => onCopy(text)} title="复制">
            <Copy className="h-3 w-3" />
          </MiniBtn>
        </span>
      </div>
      {list ? (
        list.length ? (
          <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-gray-300">
            {list.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        ) : <p className="text-xs text-gray-600">暂无</p>
      ) : content ? (
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-300">{content}</p>
      ) : (
        <p className="text-xs text-gray-600">暂无</p>
      )}
    </div>
  )
}

/** 懒人一键生成：3 个二元问题内联表单 */
function LazyModeForm({ onGenerate }: { onGenerate: (opts: { path: string; style: string; line: string }) => void }) {
  const [path, setPath] = useState<'good' | 'evil'>('good')
  const [style, setStyle] = useState<'serious' | 'funny'>('serious')
  const [line, setLine] = useState<'career' | 'love'>('career')
  const [busy, setBusy] = useState(false)

  const Bin = ({ value, active, onClick }: { value: string; active: boolean; onClick: () => void }) => (
    <SelTag active={active} onClick={onClick}>{value}</SelTag>
  )

  return (
    <div className="space-y-3 rounded-lg border border-gold-500/30 bg-gold-500/5 p-3">
      <p className="text-xs text-gray-400">回答 3 个问题，系统自动锻好一把并跳到生成步。</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 text-xs text-gray-500">阵营</span>
        <Bin value="正道" active={path === 'good'} onClick={() => setPath('good')} />
        <Bin value="邪道" active={path === 'evil'} onClick={() => setPath('evil')} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 text-xs text-gray-500">调性</span>
        <Bin value="正经" active={style === 'serious'} onClick={() => setStyle('serious')} />
        <Bin value="梗款" active={style === 'funny'} onClick={() => setStyle('funny')} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 text-xs text-gray-500">主线</span>
        <Bin value="事业线" active={line === 'career'} onClick={() => setLine('career')} />
        <Bin value="爱情线" active={line === 'love'} onClick={() => setLine('love')} />
      </div>
      <Button
        variant="gold"
        size="sm"
        disabled={busy}
        onClick={async () => { setBusy(true); try { await onGenerate({ path, style, line }) } finally { setBusy(false) } }}
      >
        {busy ? <Spinner className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />} 一键铸器
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 锻造弹窗内部小组件                                                  */
/* ------------------------------------------------------------------ */

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

/** 预览行：标签 + 值 + 骰子 + 锁 */
function PreviewRow({
  label, children, onDice, onLock, locked, diceBusy,
}: { label: string; children: React.ReactNode; onDice?: () => void; onLock?: () => void; locked?: boolean; diceBusy?: boolean }) {
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1">
        <span className="text-[11px] uppercase tracking-wider text-gray-500">{label}</span>
        <span className="ml-auto flex items-center">
          {onDice && (
            <MiniBtn onClick={onDice} title={`随机${label}`}>
              {diceBusy ? <Spinner className="h-3 w-3" /> : <Dice5 className="h-3 w-3" />}
            </MiniBtn>
          )}
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

/* ================================================================== */
/* 烙印分区（A级）                                                     */
/* ================================================================== */

function ScarSection({ projectId, wid }: { projectId: string; wid: number }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)

  const { data: scars = [] } = useQuery({
    queryKey: ['weapon-scars', projectId, wid],
    queryFn: () => customWeaponsApi.listScars(projectId, wid),
  })
  const { data: defs = [] } = useQuery({
    queryKey: ['scar-definitions', projectId],
    queryFn: () => customWeaponsApi.scarDefinitions(projectId),
    staleTime: 30 * 60 * 1000,
  })

  const addMut = useMutation({
    mutationFn: (scarDefId: string) => customWeaponsApi.addScar(projectId, wid, { scarDefId }),
    onSuccess: (res: any) => {
      toast(res.message || `烙印「${res.scar}」已添加`, 'success')
      queryClient.invalidateQueries({ queryKey: ['weapon-scars', projectId, wid] })
      setShowAdd(false)
    },
    onError: (e: any) => toast(e.message || '添加失败', 'error'),
  })

  const removeMut = useMutation({
    mutationFn: (traitId: string) => customWeaponsApi.removeScar(projectId, wid, traitId),
    onSuccess: () => {
      toast('烙印已移除', 'success')
      queryClient.invalidateQueries({ queryKey: ['weapon-scars', projectId, wid] })
    },
    onError: (e: any) => toast(e.message || '移除失败', 'error'),
  })

  return (
    <div className="border-t border-gray-800 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
          <AlertTriangle className="h-4 w-4 text-red-400" /> 烙印（{scars.length}）
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="h-3.5 w-3.5" /> 添加
        </Button>
      </div>

      {showAdd && (
        <div className="mb-3 flex flex-wrap gap-1.5 rounded-lg border border-gray-800 bg-gray-950/50 p-2">
          {defs.map((d: any) => (
            <button
              key={d.id}
              onClick={() => addMut.mutate(d.id)}
              disabled={addMut.isPending || scars.some((s: any) => s.classicId === d.id)}
              className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-40"
              title={d.trigger}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      {scars.length > 0 ? (
        <div className="space-y-1.5">
          {scars.map((s: any) => (
            <div key={s.id} className="flex items-start justify-between rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
              <div>
                <span className="text-sm font-medium text-red-300">{s.name}</span>
                <p className="mt-0.5 text-xs text-gray-400">{s.desc}</p>
                {s.flaw && <p className="mt-0.5 text-[11px] text-amber-300/70">代价：{s.flaw}</p>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => removeMut.mutate(s.id)} disabled={removeMut.isPending}>
                <X className="h-3.5 w-3.5 text-gray-500" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-600">暂无烙印。武器经历剧情事件后可留下永久痕迹。</p>
      )}
    </div>
  )
}

/* ================================================================== */
/* 重铸分区（A级）                                                     */
/* ================================================================== */

function RecraftSection({ projectId, weapon, r }: { projectId: string; weapon: any; r: Resolver }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState(false)
  const [keepIds, setKeepIds] = useState<string[]>([])

  const traits: any[] = weapon.generatedTraits || []

  const recraftMut = useMutation({
    mutationFn: () => customWeaponsApi.recraft(projectId, weapon.id, keepIds),
    onSuccess: (res: any) => {
      toast(`重铸完成：保留${res.kept}项，新生成${res.fresh}项`, 'success')
      setMode(false)
      setKeepIds([])
      queryClient.invalidateQueries({ queryKey: ['custom-weapons', projectId] })
    },
    onError: (e: any) => toast(e.message || '重铸失败', 'error'),
  })

  if (traits.length === 0) return null

  return (
    <div className="border-t border-gray-800 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
          <Hammer className="h-4 w-4" /> 重铸
        </div>
        {!mode && (
          <Button size="sm" variant="outline" onClick={() => setMode(true)}>
            <Hammer className="h-3.5 w-3.5" /> 开始重铸
          </Button>
        )}
      </div>

      {mode ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">勾选要保留的特质，其余将重新随机生成：</p>
          <div className="flex flex-wrap gap-1.5">
            {traits.map((t: any) => (
              <button
                key={t.id}
                onClick={() => setKeepIds((s) => s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id])}
                className={cn(
                  'rounded border px-2 py-1 text-[11px] transition-colors',
                  keepIds.includes(t.id)
                    ? 'border-gold-500/60 bg-gold-500/15 text-gold-300'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500',
                )}
              >
                {t.name}{t.isScar ? ' 🔴' : t.isRare ? ' ✨' : ''}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => recraftMut.mutate()} disabled={recraftMut.isPending}>
              {recraftMut.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Hammer className="h-3.5 w-3.5" />}
              确认重铸（保留{keepIds.length}项）
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setMode(false); setKeepIds([]) }}>取消</Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-600">保留部分特质，重新淬炼其余方向。重铸记录可回退。</p>
      )}
    </div>
  )
}

/* ================================================================== */
/* 引用法宝弹窗（从世界观导入）                                         */
/* ================================================================== */

function ImportWeaponDialog({
  projectId, onClose, onImported,
}: {
  projectId: string; onClose: () => void; onImported: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [importingId, setImportingId] = useState<number | null>(null)

  const { data: rawData, isLoading } = useQuery({
    queryKey: ['world-items-for-import', searchTerm],
    queryFn: () => worldApi.items(searchTerm ? { keyword: searchTerm } : undefined),
  })

  const items: any[] = Array.isArray(rawData) ? rawData : rawData?.items ?? rawData?.data ?? []

  const doSearch = () => setSearchTerm(keyword.trim())

  const handleImport = async (item: any) => {
    setImportingId(item.id)
    try {
      await customWeaponsApi.import(projectId, item.id)
      toast('已引用', 'success')
      queryClient.invalidateQueries({ queryKey: ['custom-weapons', projectId] })
      onImported()
      onClose()
    } catch (e: any) {
      toast(e.message || '引用失败', 'error')
    } finally {
      setImportingId(null)
    }
  }

  return (
    <Dialog open onClose={onClose} title="引用法宝·从世界观" className="max-w-2xl">
      <div className="space-y-4">
        {/* 搜索栏 */}
        <div className="flex items-center gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="搜索法宝名称…"
            aria-label="搜索"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-gold-500/50"
          />
          <Button variant="outline" onClick={doSearch}>
            <Search className="h-4 w-4" /> 搜索
          </Button>
        </div>

        {/* 结果列表 */}
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {isLoading && (
            <div className="flex items-center justify-center py-10">
              <Spinner className="h-6 w-6" />
            </div>
          )}

          {!isLoading && items.length === 0 && (
            <p className="py-10 text-center text-sm text-gray-500">
              {searchTerm ? '未找到匹配的法宝' : '输入关键词搜索世界观中的法宝'}
            </p>
          )}

          {!isLoading && items.map((item: any) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-lg border border-gray-700/60 bg-gray-800/40 px-4 py-3 transition-colors hover:border-gray-600"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-gray-200">{item.name}</span>
                  {item.grade && (
                    <Badge className={GRADE_COLORS[item.grade] || ''}>{item.grade}</Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  {[item.system, item.category].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={importingId === item.id}
                onClick={() => handleImport(item)}
                className="ml-3 shrink-0"
              >
                {importingId === item.id ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                引用
              </Button>
            </div>
          ))}
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

