/**
 * 众生百态 - 人物管理页面
 * 左右分栏：左侧人物列表 + 右侧详情（基础信息/小传/判词/武学/变种/成长）
 */
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, Badge, Button, Select, Switch, Spinner, EmptyState, Dialog, useToast, Input, Textarea } from '../components/ui'
import { customCharacterApi, characterMartialApi, growthApi, techniqueVariantsApi, characterAspectsApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import { cn } from '../lib/utils'
import CustomCharacterWizard from '../components/CustomCharacterWizard'
import { ImportFromProjectDialog } from '../components/ImportFromProjectDialog'
import { ImportFromWorldDialog } from '../components/ImportFromWorldDialog'
import { ExtractCharactersDialog } from '../components/ExtractCharactersDialog'
import { BatchCreateCharactersDialog } from '../components/BatchCreateCharactersDialog'
import { Plus, Search, Pencil, Trash2, RefreshCw, ChevronDown, ChevronRight, Swords, Users, Download, Wand2, CheckCircle2, Upload } from 'lucide-react'

// ============ 常量 ============
const POSITION_LABELS: Record<string, string> = { chenjie: '尘界', tongtu: '同途', dazhe: '达者', zhelong: '蛰龙', tianyou: '天游' }
const POSITION_COLORS: Record<string, string> = {
  chenjie: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
  tongtu: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  dazhe: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  zhelong: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  tianyou: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
}
const GENDER_LABELS: Record<string, string> = { male: '男', female: '女', other: '其他' }
const RACE_CATEGORY_LABELS: Record<string, string> = {
  human: '人族', demon_race: '妖族', ghost_race: '鬼族', spirit_race: '灵族',
  ancient_race: '上古遗种', mixed: '混血', other: '异种',
}
const STANCE_LABEL = (v: number) => v <= 20 ? '极正' : v <= 40 ? '偏正' : v <= 60 ? '中立' : v <= 80 ? '偏邪' : '极邪'

// ============ 主页面 ============
export default function CharacterGallery() {
  const projectId = useCurrentProjectId()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // 实体状态筛选（09-自动维护 US-4）
  const [statusFilter, setStatusFilter] = useState<'all' | 'official' | 'draft'>('all')
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editingChar, setEditingChar] = useState<any>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [projectImportOpen, setProjectImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [fileImportOpen, setFileImportOpen] = useState(false)
  const [extractOpen, setExtractOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)

  // 人物列表
  const { data: characters = [], isLoading } = useQuery({
    queryKey: ['custom-characters', projectId],
    queryFn: () => customCharacterApi.list(projectId),
    enabled: !!projectId,
  })

  const filtered = useMemo(
    () => characters.filter((c: any) => {
      if (search && !c.name?.includes(search)) return false
      if (statusFilter === 'draft') return c.entityStatus === 'draft'
      if (statusFilter === 'official') return c.entityStatus !== 'draft'
      return true
    }),
    [characters, search, statusFilter]
  )
  const draftCount = useMemo(() => characters.filter((c: any) => c.entityStatus === 'draft').length, [characters])

  const selected = characters.find((c: any) => c.id === selectedId) ?? null

  // 删除
  const deleteMut = useMutation({
    mutationFn: (id: number) => customCharacterApi.delete(projectId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-characters', projectId] })
      setSelectedId(null)
      toast('人物已删除', 'success')
    },
  })

  const handleDelete = (char: any) => {
    if (window.confirm(`确定删除「${char.name}」？此操作不可恢复。`)) {
      deleteMut.mutate(char.id)
    }
  }

  return (
    <div className="flex h-full flex-col bg-gray-950 text-gray-200">
      {/* 页头 */}
      <header className="flex items-center justify-between px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-gold-grad">众生百态</h1>
          <p className="mt-0.5 text-xs text-gray-500">角色塑造·武学绑定·成长轨迹</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Download className="h-4 w-4" /> 引用人物
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
          <Button variant="outline" onClick={() => setExtractOpen(true)}>
            <Wand2 className="h-4 w-4" /> 文本抽取
          </Button>
          <Button variant="outline" onClick={() => setBatchOpen(true)}>
            <Users className="h-4 w-4" /> 批量新建
          </Button>
          <Button onClick={() => { setEditingChar(null); setWizardOpen(true) }}>
            <Plus className="h-4 w-4" /> 新建人物
          </Button>
        </div>
      </header>

      {/* 主体分栏 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧列表 */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-gray-800">
          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索人物…"
                aria-label="搜索角色"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-8 pr-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-gold-500/50 focus:outline-none"
              />
            </div>
            {/* 状态筛选（09-自动维护 US-4） */}
            <div className="mt-2 flex gap-1.5">
              <Chip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>全部</Chip>
              <Chip active={statusFilter === 'official'} onClick={() => setStatusFilter('official')}>正式</Chip>
              <Chip active={statusFilter === 'draft'} onClick={() => setStatusFilter('draft')}>
                待补充{draftCount > 0 ? ` (${draftCount})` : ''}
              </Chip>
            </div>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
            {isLoading && <div className="flex justify-center py-8"><Spinner /></div>}
            {!isLoading && filtered.length === 0 && <EmptyState message="暂无人物" icon={<Users className="h-8 w-8" />} />}
            {filtered.map((char: any) => (
              <button
                key={char.id}
                onClick={() => setSelectedId(char.id)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors',
                  selectedId === char.id
                    ? 'border-gold-500/60 bg-gold-500/5'
                    : 'border-gray-800 bg-gray-900/50 hover:border-gray-700'
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-100">{char.name}</span>
                  {char.entityStatus === 'draft' && (
                    <span className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] text-warn" title="AI自动提取的草稿，待补充设定">
                      待补充
                    </span>
                  )}
                  <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', POSITION_COLORS[char.position] ?? POSITION_COLORS.chenjie)}>
                    {POSITION_LABELS[char.position] ?? char.position}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                  <span>{char.raceCategory?.[0]}{char.raceSub ? `·${char.raceSub[0]}` : ''}</span>
                  <span>{STANCE_LABEL(char.stance ?? 50)}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* 右侧详情 */}
        <main className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState message="选择左侧人物查看详情" icon={<Users className="h-10 w-10" />} />
            </div>
          ) : (
            <CharacterDetail
              key={selected.id}
              char={selected}
              projectId={projectId}
              onEdit={() => { setEditingChar(selected); setWizardOpen(true) }}
              onDelete={() => handleDelete(selected)}
            />
          )}
        </main>
      </div>

      {/* 新建/编辑向导 */}
      <CustomCharacterWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        projectId={projectId}
        editing={editingChar}
        onSaved={() => {
          setWizardOpen(false)
          queryClient.invalidateQueries({ queryKey: ['custom-characters', projectId] })
        }}
      />

      {/* 引用人物弹窗（从世界观按书批量引用） */}
      {importOpen && (
        <ImportFromWorldDialog
          open={importOpen}
          projectId={projectId}
          onClose={() => setImportOpen(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['custom-characters', projectId] })}
        />
      )}

      {/* 从其他项目引入人物 */}
      {projectImportOpen && (
        <ImportFromProjectDialog
          open={projectImportOpen}
          title="从项目引入·人物"
          projectId={projectId}
          listApi={customCharacterApi.importSourcesFromProject}
          importApi={customCharacterApi.importFromProject}
          onClose={() => setProjectImportOpen(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['custom-characters', projectId] })}
        />
      )}

      {/* 导出人物到文件（14-SRS US-23） */}
      {exportOpen && (
        <ImportFromProjectDialog
          open={exportOpen}
          mode="export"
          title="导出人物到文件"
          projectId={projectId}
          module="characters"
          moduleName="人物"
          listCurrentApi={async (pid) => ((await customCharacterApi.list(pid)) as any[]).map((c) => ({ id: c.id, name: c.name }))}
          exportApi={(pid, data) => customCharacterApi.exportFile(pid, data.ids)}
          onClose={() => setExportOpen(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['custom-characters', projectId] })}
        />
      )}

      {/* 从文件导入人物（14-SRS US-23） */}
      {fileImportOpen && (
        <ImportFromProjectDialog
          open={fileImportOpen}
          mode="import-file"
          title="从文件导入人物"
          projectId={projectId}
          module="characters"
          moduleName="人物"
          listCurrentApi={async (pid) => ((await customCharacterApi.list(pid)) as any[]).map((c) => ({ id: c.id, name: c.name }))}
          importFileApi={customCharacterApi.importFile}
          onClose={() => setFileImportOpen(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['custom-characters', projectId] })}
        />
      )}

      {/* 文本抽取人物 */}
      {extractOpen && (
        <ExtractCharactersDialog
          open={extractOpen}
          projectId={projectId}
          onClose={() => setExtractOpen(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['custom-characters', projectId] })}
        />
      )}

      {/* 批量新建人物 */}
      {batchOpen && (
        <BatchCreateCharactersDialog
          open={batchOpen}
          projectId={projectId}
          onClose={() => setBatchOpen(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['custom-characters', projectId] })}
        />
      )}
    </div>
  )
}

// ============ 右侧详情组件 ============
function CharacterDetail({ char, projectId, onEdit, onDelete }: {
  char: any; projectId: string; onEdit: () => void; onDelete: () => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const negId = -Math.abs(char.id)

  // 重新生成小传
  const bioMut = useMutation({
    mutationFn: () => customCharacterApi.update(projectId, char.id, { regenerateBio: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-characters', projectId] })
      toast('小传已重新生成', 'success')
    },
    onError: () => toast('生成失败', 'error'),
  })

  // 重生成判词
  const verdictMut = useMutation({
    mutationFn: () => customCharacterApi.generateVerdict(projectId, char.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-characters', projectId] })
      toast('判词已重新生成', 'success')
    },
    onError: () => toast('判词生成失败', 'error'),
  })

  return (
    <div className="p-6">
      {/* 顶部：名字 + 操作 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-100">{char.name}</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> 编辑</Button>
          <Button variant="destructive" size="sm" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /> 删除</Button>
        </div>
      </div>

      {/* AI草稿引导（09-自动维护 US-4）：引导用户补全必填字段，保存后自动转正 */}
      {char.entityStatus === 'draft' && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-warn/40 bg-warn/10 p-3">
          <p className="text-xs leading-relaxed text-warn">
            该人物为章节生成时自动提取的草稿，仅含名字与描写片段。请补全种族/定位/性格等字段，保存后将自动转为正式人物。
          </p>
          <Button size="sm" variant="outline" className="shrink-0" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> 补全设定
          </Button>
        </div>
      )}

      {/* 1. 基础信息 */}
      <Section title="基础信息">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <InfoItem label="性别" value={GENDER_LABELS[char.gender] ?? char.gender} />
          <InfoItem label="种族" value={`${RACE_CATEGORY_LABELS[char.raceCategory] ?? char.raceCategory ?? ''}·${char.raceSub ?? ''}`} />
          <div className="flex items-center gap-2">
            <span className="text-gray-500">实力定位</span>
            <span className={cn('rounded border px-1.5 py-0.5 text-xs font-medium', POSITION_COLORS[char.position] ?? POSITION_COLORS.chenjie)}>
              {POSITION_LABELS[char.position] ?? char.position}
            </span>
          </div>
          <InfoItem label="伪装定位" value={char.disguisePosition ? (POSITION_LABELS[char.disguisePosition] ?? char.disguisePosition) : '无'} />
          <InfoItem label="立场" value={`${STANCE_LABEL(char.stance ?? 50)} (${char.stance ?? 50})`} />
          <InfoItem label="内在性格" value={char.innerPersonality} />
          <InfoItem label="外在性格" value={char.outerPersonality} />
          <InfoItem label="天赋" value={Array.isArray(char.talents) ? char.talents.join('、') : char.talents} />
          <InfoItem label="擅长" value={char.strength} />
          <InfoItem label="短板" value={char.flaw} />
        </div>
      </Section>

      {/* 1.5 章节动态（09-自动维护 US-3：时间线 + 采纳/忽略） */}
      <ChapterUpdatesSection char={char} projectId={projectId} />

      {/* 2. 人物小传 */}
      <Section title="人物小传">
        <p className="text-sm leading-relaxed text-gray-300">{char.description || '暂无小传'}</p>
        <Button variant="ghost" size="sm" className="mt-2" loading={bioMut.isPending} onClick={() => bioMut.mutate()}>
          <RefreshCw className="h-3.5 w-3.5" /> 重新生成
        </Button>
      </Section>

      {/* 3. 判词·考语 */}
      <Section title="判词·考语">
        {char.verdictPoem ? (
          <div>
            <p className="whitespace-pre-line text-sm leading-relaxed text-gold-300">{char.verdictPoem}</p>
            {char.verdictComment && <p className="mt-2 text-xs text-gray-400">考语：{char.verdictComment}</p>}
          </div>
        ) : (
          <p className="text-sm text-gray-500">暂无判词</p>
        )}
        <Button variant="ghost" size="sm" className="mt-2" loading={verdictMut.isPending} onClick={() => verdictMut.mutate()}>
          <RefreshCw className="h-3.5 w-3.5" /> 重生成
        </Button>
      </Section>

      {/* 4. 声音配置（注入式声音方案） */}
      <VoiceSection projectId={projectId} negId={negId} />

      {/* 5. 已知信息清单（信息差写作 + 认知越界审计参照） */}
      <KnowledgeSection projectId={projectId} negId={negId} />

      {/* 6. 武学档案 */}
      <MartialSection char={char} projectId={projectId} negId={negId} />

      {/* 7. 千人千面 */}
      <VariantsSection projectId={projectId} negId={negId} />

      {/* 8. 成长阶段 */}
      <GrowthSection projectId={projectId} charId={char.id} />
    </div>
  )
}

// ============ 武学档案区块（功法为主，功法×武器多对多搭配） ============
function MartialSection({ char, projectId, negId }: { char: any; projectId: string; negId: number }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: martial, isLoading } = useQuery({
    queryKey: ['character-martial', projectId, negId],
    queryFn: () => characterMartialApi.get(projectId, negId),
  })

  const lores: any[] = martial?.lores ?? []
  const techniques: any[] = martial?.techniques ?? []
  const weapons: any[] = martial?.weapons ?? []

  // 按功法分组
  const grouped = useMemo(() => {
    const map = new Map<number, { technique: any; combos: any[] }>()
    for (const lore of lores) {
      const tid = lore.techniqueId
      if (!map.has(tid)) {
        const tech = techniques.find((t: any) => t.id === tid)
        map.set(tid, { technique: tech ?? { id: tid, name: `功法#${tid}` }, combos: [] })
      }
      map.get(tid)!.combos.push(lore)
    }
    return Array.from(map.values())
  }, [lores, techniques])

  // 新搭配表单
  const [newTechId, setNewTechId] = useState<number | ''>('')
  const [newWpnId, setNewWpnId] = useState<number | ''>('')

  const genMut = useMutation({
    mutationFn: () => characterMartialApi.generate(projectId, negId, { techniqueId: Number(newTechId), weaponId: Number(newWpnId) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['character-martial', projectId, negId] })
      toast('武学搭配已生成', 'success')
      setNewTechId('')
      setNewWpnId('')
    },
    onError: (e: any) => toast(e?.message || '生成失败，需先生成功法详解与武器文案', 'error'),
  })

  const regenMut = useMutation({
    mutationFn: (loreId: number) => characterMartialApi.regenerate(projectId, negId, loreId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['character-martial', projectId, negId] })
      toast('已重新生成', 'success')
    },
    onError: (e: any) => toast(e?.message || '重新生成失败', 'error'),
  })

  const delMut = useMutation({
    mutationFn: (loreId: number) => characterMartialApi.deleteOne(projectId, negId, loreId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['character-martial', projectId, negId] })
      toast('搭配已删除', 'success')
    },
    onError: () => toast('删除失败', 'error'),
  })

  // 绑定管理：bound 标记派生当前已绑定ID集合；bind 接口为"集合覆盖"语义，
  // 切换单个实体时需传完整的功法/武器ID集合。绑定后随人物进入生成上下文。
  const boundTechIds = useMemo(
    () => techniques.filter((t: any) => t.bound).map((t: any) => Number(t.id)),
    [techniques]
  )
  const boundWpnIds = useMemo(
    () => weapons.filter((w: any) => w.bound).map((w: any) => Number(w.id)),
    [weapons]
  )

  const bindMut = useMutation({
    mutationFn: (body: { techniqueIds: number[]; weaponIds: number[] }) =>
      characterMartialApi.bind(projectId, negId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['character-martial', projectId, negId] })
      toast('绑定已更新', 'success')
    },
    onError: (e: any) => toast(e?.message || '绑定失败', 'error'),
  })

  const toggleTechBind = (id: number) => {
    const next = boundTechIds.includes(id) ? boundTechIds.filter((x) => x !== id) : [...boundTechIds, id]
    bindMut.mutate({ techniqueIds: next, weaponIds: boundWpnIds })
  }
  const toggleWpnBind = (id: number) => {
    const next = boundWpnIds.includes(id) ? boundWpnIds.filter((x) => x !== id) : [...boundWpnIds, id]
    bindMut.mutate({ techniqueIds: boundTechIds, weaponIds: next })
  }

  const weaponName = (wid: number) => weapons.find((w: any) => w.id === wid)?.name ?? `武器#${wid}`

  return (
    <Section title="武学档案">
      {isLoading ? <Spinner className="mx-auto my-4" /> : (
        <div className="space-y-4">
          {/* 已有搭配（按功法分组） */}
          {grouped.length === 0 && <p className="text-sm text-gray-500">暂无武学搭配，选择功法与武器生成</p>}
          {grouped.map(({ technique, combos }) => (
            <div key={technique.id} className="rounded-lg border border-gray-800 bg-gray-900/40">
              <div className="border-b border-gray-800 px-3 py-2">
                <span className="text-sm font-medium text-gold-300">{technique.name}</span>
                <span className="ml-2 text-xs text-gray-500">{combos.length} 种武器搭配</span>
              </div>
              <div className="space-y-3 p-3">
                {combos.map((lore: any) => (
                  <div key={lore.id} className="rounded-lg border border-gray-700/60 bg-gray-800/40 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Swords className="h-3.5 w-3.5 text-gray-500" />
                        <span className="text-sm font-medium text-gray-200">{weaponName(lore.weaponId)}</span>
                        <Badge className="text-[10px]">v{lore.version ?? 1}</Badge>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-8 px-1.5 text-xs" loading={regenMut.isPending && regenMut.variables === lore.id} onClick={() => regenMut.mutate(lore.id)}>
                          <RefreshCw className="h-3 w-3" /> 重生成
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-red-400 hover:text-red-300" aria-label="删除" onClick={() => { if (window.confirm('删除此搭配？')) delMut.mutate(lore.id) }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {/* 融合招式 */}
                    {(lore.fusedMoves ?? []).length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {(lore.fusedMoves as any[]).map((m: any, i: number) => (
                          <div key={i} className="rounded border border-gray-700/40 bg-gray-900/50 px-2 py-1.5">
                            <span className="text-xs font-medium text-gray-300">{m.name}</span>
                            {m.desc && <p className="mt-0.5 text-[11px] leading-snug text-gray-500">{m.desc}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* 武学小传 */}
                    {lore.biography && <p className="mt-2 text-xs leading-relaxed text-gray-400">{lore.biography}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* 绑定武学（绑定后随人物进入生成上下文） */}
          <div className="space-y-2 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
            <p className="text-xs text-gray-500">
              绑定武学 <span className="text-gray-600">（点选切换；绑定的功法/武器会在该人物登场时带入章节生成）</span>
            </p>
            {techniques.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-8 shrink-0 text-[10px] text-gray-500">功法</span>
                {techniques.map((t: any) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTechBind(Number(t.id))}
                    disabled={bindMut.isPending}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50',
                      t.bound
                        ? 'border-gold-500/50 bg-gold-500/15 text-gold-300'
                        : 'border-gray-700 bg-gray-800/60 text-gray-400 hover:border-gray-600'
                    )}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
            {weapons.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-8 shrink-0 text-[10px] text-gray-500">武器</span>
                {weapons.map((w: any) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => toggleWpnBind(Number(w.id))}
                    disabled={bindMut.isPending}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50',
                      w.bound
                        ? 'border-gold-500/50 bg-gold-500/15 text-gold-300'
                        : 'border-gray-700 bg-gray-800/60 text-gray-400 hover:border-gray-600'
                    )}
                  >
                    {w.name}
                  </button>
                ))}
              </div>
            )}
            {techniques.length === 0 && weapons.length === 0 && (
              <p className="text-xs text-gray-600">暂无可绑定的功法/武器（请先在「道法自然」「铸器天工」中创建）</p>
            )}
          </div>

          {/* 生成新搭配 */}
          <div className="rounded-lg border border-dashed border-gray-700 p-3">
            <p className="mb-2 text-xs text-gray-500">生成新搭配</p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={newTechId}
                onChange={(e) => setNewTechId(e.target.value ? Number(e.target.value) : '')}
                aria-label="选择功法"
                className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-200 focus:border-gold-500/50 focus:outline-none"
              >
                <option value="">选择功法</option>
                {techniques.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <span className="text-xs text-gray-600">×</span>
              <select
                value={newWpnId}
                onChange={(e) => setNewWpnId(e.target.value ? Number(e.target.value) : '')}
                aria-label="选择武器"
                className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-200 focus:border-gold-500/50 focus:outline-none"
              >
                <option value="">选择武器</option>
                {weapons.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <Button size="sm" loading={genMut.isPending} disabled={!newTechId || !newWpnId} onClick={() => genMut.mutate()}>
                <Swords className="h-3.5 w-3.5" /> 生成
              </Button>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}

// ============ 千人千面区块 ============
function VariantsSection({ projectId, negId }: { projectId: string; negId: number }) {
  const { data: variants = [], isLoading } = useQuery({
    queryKey: ['technique-variants', projectId, negId],
    queryFn: () => techniqueVariantsApi.list(projectId, negId),
  })

  return (
    <Section title="千人千面">
      {isLoading ? <Spinner className="mx-auto my-4" /> : variants.length === 0 ? (
        <p className="text-sm text-gray-500">暂无变种数据</p>
      ) : (
        <div className="space-y-2">
          {variants.map((v: any) => (
            <div key={v.id} className="rounded-lg border border-gray-800 bg-gray-900/60 p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-200">{v.variantName}</span>
                <Badge className="text-[10px]">{v.rarity}</Badge>
              </div>
              {v.loreSnippet && <p className="mt-1 text-xs text-gray-400">{v.loreSnippet}</p>}
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ============ 成长阶段区块（默认折叠） ============
function GrowthSection({ projectId, charId }: { projectId: string; charId: number }) {
  const [open, setOpen] = useState(false)

  const { data: stages = [], isLoading } = useQuery({
    queryKey: ['growth-stages', projectId, charId],
    queryFn: () => growthApi.list(projectId, charId),
    enabled: open,
  })

  return (
    <div className="border-t border-gray-800 pt-4">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-gray-100">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        成长阶段
      </button>
      {open && (
        <div className="mt-3">
          {isLoading ? <Spinner className="mx-auto my-4" /> : stages.length === 0 ? (
            <p className="text-sm text-gray-500">暂无成长阶段</p>
          ) : (
            <div className="relative ml-2 space-y-4 border-l border-gray-700 pl-4">
              {stages.map((s: any) => (
                <div key={s.id} className="relative">
                  <div className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-gold-500 bg-gray-950" />
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-200">{s.stageName}</span>
                    <Badge className="text-[10px]">{s.stageType}</Badge>
                  </div>
                  {s.description && <p className="mt-1 text-xs text-gray-400">{s.description}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============ 章节动态区块（09-自动维护 US-3：时间线 + 采纳/忽略） ============
const UPDATE_CATEGORY_LABELS: Record<string, string> = {
  realm: '境界', item: '法宝', personality: '性格', relationship: '关系', other: '其他',
}

function ChapterUpdatesSection({ char, projectId }: { char: any; projectId: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const updates: any[] = Array.isArray(char.chapterUpdates) ? char.chapterUpdates : []

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['custom-characters', projectId] })

  const adoptMut = useMutation({
    mutationFn: (index: number) => customCharacterApi.adoptUpdate(projectId, char.id, index),
    onSuccess: () => {
      invalidate()
      toast('已采纳到人物小传', 'success')
    },
    onError: () => toast('采纳失败', 'error'),
  })

  const dismissMut = useMutation({
    mutationFn: (index: number) => customCharacterApi.dismissUpdate(projectId, char.id, index),
    onSuccess: invalidate,
    onError: () => toast('操作失败', 'error'),
  })

  // 无动态时不占位（置于所有 hooks 之后，保证 hook 调用顺序稳定）
  if (updates.length === 0) return null

  return (
    <Section title={`章节动态 (${updates.length})`}>
      <div className="relative ml-2 space-y-3 border-l border-gray-700 pl-4">
          {updates.map((u: any, i: number) => (
            <div key={`${u.chapterNo}-${i}`} className="relative">
              <div className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-gold-500 bg-gray-950" />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge className="text-[10px]">{UPDATE_CATEGORY_LABELS[u.category] ?? u.category}</Badge>
                    <span className="text-xs text-gray-500">
                      {u.volumeNo != null ? `第${u.volumeNo}卷` : ''}第{u.chapterNo}章
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-200">{u.updateText}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                    loading={adoptMut.isPending && adoptMut.variables === i}
                    onClick={() => adoptMut.mutate(i)} title="追加到人物小传">
                    <CheckCircle2 className="h-3 w-3" /> 采纳
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-gray-500"
                    loading={dismissMut.isPending && dismissMut.variables === i}
                    onClick={() => dismissMut.mutate(i)} title="忽略此条">
                    <Trash2 className="h-3 w-3" /> 忽略
                  </Button>
                </div>
              </div>
            </div>
          ))}
      </div>
    </Section>
  )
}

// ============ 声音配置区块（每人物一条，upsert） ============
const EMPTY_VOICE_FORM = {
  speechStyle: '',
  catchphrases: '',
  addressHabit: '',
  toneBase: '',
  exampleQuotes: '',
  forbiddenExpressions: '',
  enabled: true,
}

function VoiceSection({ projectId, negId }: { projectId: string; negId: number }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [form, setForm] = useState(EMPTY_VOICE_FORM)
  const [hydrated, setHydrated] = useState(false)

  const { data: voices = [], isLoading } = useQuery({
    queryKey: ['voice-config', projectId, negId],
    queryFn: () => characterAspectsApi.listVoices(projectId, negId),
  })
  const existing = voices[0] ?? null

  // 数据到达后回填表单（仅一次）
  if (!hydrated && !isLoading) {
    setHydrated(true)
    if (existing) {
      setForm({
        speechStyle: existing.speechStyle ?? '',
        catchphrases: existing.catchphrases ?? '',
        addressHabit: existing.addressHabit ?? '',
        toneBase: existing.toneBase ?? '',
        exampleQuotes: (existing.exampleQuotes ?? []).join('\n'),
        forbiddenExpressions: (existing.forbiddenExpressions ?? []).join('\n'),
        enabled: existing.enabled ?? true,
      })
    }
  }

  const saveMut = useMutation({
    mutationFn: () =>
      characterAspectsApi.upsertVoice(projectId, negId, {
        speechStyle: form.speechStyle || null,
        catchphrases: form.catchphrases || null,
        addressHabit: form.addressHabit || null,
        toneBase: form.toneBase || null,
        exampleQuotes: form.exampleQuotes.split('\n').map((s) => s.trim()).filter(Boolean),
        forbiddenExpressions: form.forbiddenExpressions.split('\n').map((s) => s.trim()).filter(Boolean),
        enabled: form.enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voice-config', projectId, negId] })
      toast('声音配置已保存', 'success')
    },
    onError: () => toast('保存失败', 'error'),
  })

  // 一键补全（13-SRS US-18）：LLM 生成6个字段填充表单，不自动保存
  const autoVoiceMut = useMutation({
    mutationFn: () => customCharacterApi.autoVoice(projectId, negId),
    onSuccess: (data: any) => {
      setForm((f) => ({
        ...f,
        speechStyle: data?.speechStyle || f.speechStyle,
        catchphrases: data?.catchphrases || f.catchphrases,
        addressHabit: data?.addressHabit || f.addressHabit,
        toneBase: data?.toneBase || f.toneBase,
        exampleQuotes: Array.isArray(data?.exampleQuotes) && data.exampleQuotes.length
          ? data.exampleQuotes.join('\n') : f.exampleQuotes,
        forbiddenExpressions: Array.isArray(data?.forbiddenExpressions) && data.forbiddenExpressions.length
          ? data.forbiddenExpressions.join('\n') : f.forbiddenExpressions,
      }))
      toast('已生成对白风格，请检查后手动保存', 'success')
    },
    onError: () => toast('对白风格生成失败，请稍后重试', 'error'),
  })

  const set = (key: string, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }))

  return (
    <Section title="声音配置·对白风格">
      {isLoading ? <Spinner className="mx-auto my-4" /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="说话风格" value={form.speechStyle} onChange={(e) => set('speechStyle', e.target.value)} placeholder="如：语简意赅，喜用古语，少用虚词" />
            <Input label="口头禅/高频用词" value={form.catchphrases} onChange={(e) => set('catchphrases', e.target.value)} placeholder="如：常以“倒也”收尾" />
            <Input label="称呼习惯" value={form.addressHabit} onChange={(e) => set('addressHabit', e.target.value)} placeholder="如：对长辈称“前辈”，不称师尊" />
            <Input label="基调" value={form.toneBase} onChange={(e) => set('toneBase', e.target.value)} placeholder="如：淡漠疏离，偶露锋铓" />
          </div>
          <Textarea label="示例台词（每行一条）" rows={3} value={form.exampleQuotes} onChange={(e) => set('exampleQuotes', e.target.value)} placeholder="每行一条典型台词，供生成时参照" />
          <Textarea label="禁用表达（每行一条）" rows={2} value={form.forbiddenExpressions} onChange={(e) => set('forbiddenExpressions', e.target.value)} placeholder="该人物绝不会说的话/词，审计时参照" />
          <div className="flex items-center justify-between">
            <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} label="启用（随生成注入）" />
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" loading={autoVoiceMut.isPending}
                onClick={() => autoVoiceMut.mutate()} title="AI 根据人物设定一键生成对白风格（填充表单不保存）">
                <Wand2 className="h-3.5 w-3.5" /> 一键补全
              </Button>
              <Button size="sm" loading={saveMut.isPending} onClick={() => saveMut.mutate()}>保存声音配置</Button>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}

// ============ 已知信息清单区块（信息差写作 + 认知越界审计参照） ============
const INFO_LEVEL_LABELS: Record<string, string> = { core: '核心', common: '一般', secret: '秘密' }
const INFO_LEVEL_VARIANTS: Record<string, 'gold' | 'default' | 'seal'> = { core: 'gold', common: 'default', secret: 'seal' }

function KnowledgeSection({ projectId, negId }: { projectId: string; negId: number }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [content, setContent] = useState('')
  const [level, setLevel] = useState('common')
  const [chapter, setChapter] = useState('')

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['character-knowledge', projectId, negId],
    queryFn: () => characterAspectsApi.listKnowledge(projectId, negId),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['character-knowledge', projectId, negId] })

  const addMut = useMutation({
    mutationFn: () =>
      characterAspectsApi.createKnowledge(projectId, {
        characterId: negId,
        knowledgeContent: content.trim(),
        infoLevel: level,
        sourceType: 'manual',
        acquiredChapter: chapter ? Number(chapter) : null,
        enabled: true,
      }),
    onSuccess: () => {
      invalidate()
      setContent('')
      setChapter('')
      toast('已知信息已添加', 'success')
    },
    onError: () => toast('添加失败', 'error'),
  })

  const toggleMut = useMutation({
    mutationFn: (row: any) => characterAspectsApi.updateKnowledge(projectId, row.id, { enabled: !row.enabled }),
    onSuccess: invalidate,
    onError: () => toast('更新失败', 'error'),
  })

  const delMut = useMutation({
    mutationFn: (id: number) => characterAspectsApi.deleteKnowledge(projectId, id),
    onSuccess: () => {
      invalidate()
      toast('已删除', 'success')
    },
    onError: () => toast('删除失败', 'error'),
  })

  return (
    <Section title="已知信息清单">
      {isLoading ? <Spinner className="mx-auto my-4" /> : (
        <div className="space-y-3">
          {/* 新增表单 */}
          <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
            <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="该人物已知晓的具体事实，如：知晓陈长青已换骨" />
            <div className="mt-2 flex items-end gap-2">
              <Select label="信息层级" className="w-32" options={[
                { value: 'core', label: '核心' },
                { value: 'common', label: '一般' },
                { value: 'secret', label: '秘密' },
              ]} value={level} onChange={(e) => setLevel(e.target.value)} />
              <Input label="获知章节" className="w-28" type="number" value={chapter} onChange={(e) => setChapter(e.target.value)} placeholder="可选" />
              <Button size="sm" disabled={!content.trim()} onClick={() => addMut.mutate()}>添加</Button>
            </div>
          </div>

          {/* 已有清单 */}
          {items.length === 0 ? (
            <p className="text-sm text-gray-500">暂无已知信息，可手动录入或等伏笔回收联动生成</p>
          ) : (
            <div className="space-y-1.5">
              {items.map((row: any) => (
                <div key={row.id} className={cn('flex items-start gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-2.5', !row.enabled && 'opacity-50')}>
                  <Badge variant={INFO_LEVEL_VARIANTS[row.infoLevel] ?? 'default'} className="mt-0.5 shrink-0 text-[10px]">
                    {INFO_LEVEL_LABELS[row.infoLevel] ?? row.infoLevel}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-200">{row.knowledgeContent}</p>
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      {row.acquiredChapter != null && `第${row.acquiredChapter}章得知 · `}
                      {row.sourceType === 'manual' ? '手动录入' : row.sourceType === 'foreshadow' ? '伏笔回收' : '时间线'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch checked={!!row.enabled} onChange={() => toggleMut.mutate(row)} />
                    <Button variant="ghost" size="sm" className="h-7 px-1.5 text-red-400 hover:text-red-300" aria-label="删除"
                      onClick={() => { if (window.confirm('删除这条已知信息？')) delMut.mutate(row.id) }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

// ============ 辅助子组件 ============
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-800 pt-4 mt-5">
      <h3 className="mb-3 text-sm font-semibold text-gray-300">{title}</h3>
      {children}
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <span className="text-xs text-gray-500">{label}</span>
      <p className="text-gray-200">{value || '—'}</p>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
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

// ============ 引用人物弹窗已迁移至 components/ImportFromWorldDialog（按书批量引用） ============
