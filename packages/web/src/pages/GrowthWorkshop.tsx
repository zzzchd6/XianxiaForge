import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  Zap, Shuffle, ArrowUpCircle, Sparkles, Plus, Trash2, History,
  RotateCcw, Check, X, Loader2, GitBranch, Eye,
} from 'lucide-react'
import {
  Card, CardContent, Badge, Button, Input, Textarea, Select, Spinner, EmptyState, Dialog, Tabs, useToast,
} from '../components/ui'
import { workshopApi } from '../lib/api'
import { cn } from '../lib/utils'

const GRADE_COLORS: Record<string, string> = {
  '凡造': 'bg-gray-500/15 text-gray-300 border-gray-500/30',
  '灵淬': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  '宝胎': 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  '道纹': 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  '仙蜕': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  '神蕴': 'bg-red-500/15 text-red-300 border-red-500/30',
}

const RARITY_COLORS: Record<string, string> = {
  normal: 'text-gray-300',
  rare: 'text-blue-300',
  legendary: 'text-amber-300',
}

const RARITY_LABELS: Record<string, string> = {
  normal: '普通',
  rare: '稀有',
  legendary: '传说',
}

const GROWTH_TYPE_LABELS: Record<string, string> = {
  base: '原生',
  fusion: '融合',
  mutation: '变异',
  upgrade: '强化',
  evolution: '进化',
}

export default function GrowthWorkshop() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [projectId] = useState('3')
  // 旧自定义功法已退役（由自定义功法模块取代），成长工坊固定为法宝
  const entityType = 'magic_item' as const
  const [activeTab, setActiveTab] = useState('list')
  const [showCreate, setShowCreate] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [selectedForFusion, setSelectedForFusion] = useState<number[]>([])
  const [selectedEntity, setSelectedEntity] = useState<any>(null)
  const [historyEntity, setHistoryEntity] = useState<any>(null)
  const [treeEntity, setTreeEntity] = useState<any>(null)
  const [editForm, setEditForm] = useState<any>(null)

  // 实体列表
  const { data: entities = [], isLoading } = useQuery({
    queryKey: ['workshop', projectId, entityType],
    queryFn: () => workshopApi.list(projectId, entityType),
  })

  // 成长历史
  const { data: history = [] } = useQuery({
    queryKey: ['workshop-history', projectId, historyEntity?.id],
    queryFn: () => workshopApi.history(projectId, entityType, historyEntity.id),
    enabled: !!historyEntity,
  })

  // 融合树
  const { data: treeData } = useQuery({
    queryKey: ['workshop-tree', projectId, entityType, treeEntity?.id],
    queryFn: () => workshopApi.tree(projectId, entityType, treeEntity.id),
    enabled: !!treeEntity,
  })

  // 实体详情
  const { data: entityDetail } = useQuery({
    queryKey: ['workshop-detail', projectId, entityType, selectedEntity?.id],
    queryFn: () => workshopApi.detail(projectId, entityType, selectedEntity.id),
    enabled: !!selectedEntity,
  })

  // 更新实体
  const updateEntityMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => workshopApi.update(projectId, entityType, id, data),
    onSuccess: () => {
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['workshop-detail'] })
      setSelectedEntity(null)
      toast('实体已更新', 'success')
    },
    onError: (e: any) => toast(e.message || '更新失败', 'error'),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['workshop', projectId] })

  // 创建
  const createMutation = useMutation({
    mutationFn: (data: any) => workshopApi.create(projectId, { ...data, entityType }),
    onSuccess: () => { toast('创建成功', 'success'); setShowCreate(false); invalidate() },
    onError: (e: any) => toast(e.message, 'error'),
  })

  // 融合
  const fusionMutation = useMutation({
    mutationFn: () => workshopApi.fusion(projectId, { entityType, entityAId: selectedForFusion[0], entityBId: selectedForFusion[1] }),
    onSuccess: (res) => { setPreview({ ...res, operation: 'fusion' }); invalidate() },
    onError: (e: any) => toast(e.message, 'error'),
  })

  // 变异
  const mutationMutation = useMutation({
    mutationFn: (entityId: number) => workshopApi.mutation(projectId, { entityType, entityId }),
    onSuccess: (res) => { setPreview({ ...res, operation: 'mutation' }); invalidate() },
    onError: (e: any) => toast(e.message, 'error'),
  })

  // 强化
  const upgradeMutation = useMutation({
    mutationFn: (entityId: number) => workshopApi.upgrade(projectId, { entityType, entityId }),
    onSuccess: (res) => {
      if (res.upgraded) toast(`强化成功！${res.newGrade}第${res.newGradeLevel}层`, 'success')
      else toast('强化失败...', 'error')
      invalidate()
    },
    onError: (e: any) => toast(e.message, 'error'),
  })

  // 进化
  const evolutionMutation = useMutation({
    mutationFn: (entityId: number) => workshopApi.evolution(projectId, { entityType, entityId }),
    onSuccess: (res) => { setPreview({ ...res, operation: 'evolution' }); invalidate() },
    onError: (e: any) => toast(e.message, 'error'),
  })

  // 确认入库
  const confirmMutation = useMutation({
    mutationFn: () => workshopApi.confirm(projectId, { entityType, entity: preview.preview, linkedCharacterIds: [], breakthroughNarrative: preview.breakthroughScene }),
    onSuccess: () => { toast('已入库', 'success'); setPreview(null); invalidate() },
    onError: (e: any) => toast(e.message, 'error'),
  })

  // 回退
  const revertMutation = useMutation({
    mutationFn: (recordId: number) => workshopApi.revert(projectId, recordId),
    onSuccess: () => { toast('已回退', 'success'); setHistoryEntity(null); invalidate() },
    onError: (e: any) => toast(e.message, 'error'),
  })

  // 删除
  const deleteMutation = useMutation({
    mutationFn: (entityId: number) => workshopApi.delete(projectId, entityType, entityId),
    onSuccess: () => { toast('已删除', 'success'); invalidate() },
    onError: (e: any) => toast(e.message, 'error'),
  })

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">成长工坊</h1>
          <p className="text-sm text-gray-400 mt-1">法宝融合·变异·强化·进化</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> 创建
          </Button>
        </div>
      </div>

      {/* 操作标签页 */}
      <Tabs
        tabs={[
          { id: 'list', label: '实体列表' },
          { id: 'fusion', label: '融合' },
          { id: 'mutation', label: '变异' },
          { id: 'upgrade', label: '强化' },
          { id: 'evolution', label: '进化' },
          { id: 'tree', label: '融合树' },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* 实体列表 */}
      {activeTab === 'list' && (
        <div className="space-y-3">
          {isLoading ? <Spinner /> : entities.length === 0 ? (
            <EmptyState message={`暂无自定义法宝，点击"创建"开始`} />
          ) : (
            <div className="grid gap-3">
              {entities.map((e: any) => (
                <Card key={e.id} className="border-gray-700/50">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-100">{e.name}</span>
                          <Badge className={GRADE_COLORS[e.grade] || ''}>{e.grade} · 第{e.gradeLevel}层</Badge>
                          <Badge className="bg-gray-700/50 text-gray-300">{GROWTH_TYPE_LABELS[e.growthType] || e.growthType}</Badge>
                          {e.isEvolved && <Badge className="bg-red-500/15 text-red-300 border-red-500/30">进化</Badge>}
                        </div>
                        <p className="text-sm text-gray-400 mt-1">{e.coreEffect || e.coreAbilities || e.description || '—'}</p>
                        {e.effects?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {e.effects.map((ef: any, i: number) => (
                              <span key={i} className={cn('text-xs px-1.5 py-0.5 rounded bg-gray-800', RARITY_COLORS[ef.rarity])}>
                                {ef.name}({RARITY_LABELS[ef.rarity]})
                              </span>
                            ))}
                          </div>
                        )}
                        {e.sideEffects && <p className="text-xs text-red-400/70 mt-1">副作用：{e.sideEffects}</p>}
                      </div>
                      <div className="flex items-center gap-1 ml-3">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedEntity(e)} title="详情" aria-label="详情">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setTreeEntity(e)} title="融合树" aria-label="融合树">
                          <GitBranch className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setHistoryEntity(e)} title="成长历史" aria-label="成长历史">
                          <History className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { if (window.confirm('确认删除此法宝？')) deleteMutation.mutate(e.id) }} title="删除" aria-label="删除">
                          <Trash2 className="h-4 w-4 text-red-400" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 融合 */}
      {activeTab === 'fusion' && (
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-gray-200 mb-3">选择两个同类实体进行融合</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {entities.map((e: any) => (
                <div
                  key={e.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedForFusion(prev =>
                      prev.includes(e.id) ? prev.filter(id => id !== e.id) :
                      prev.length < 2 ? [...prev, e.id] : prev
                    )
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault()
                      setSelectedForFusion(prev =>
                        prev.includes(e.id) ? prev.filter(id => id !== e.id) :
                        prev.length < 2 ? [...prev, e.id] : prev
                      )
                    }
                  }}
                  className={cn(
                    'p-3 rounded-lg border cursor-pointer transition-colors',
                    selectedForFusion.includes(e.id) ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-700 hover:border-gray-500'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-200">{e.name}</span>
                    <Badge className={GRADE_COLORS[e.grade] || ''}>{e.grade}</Badge>
                  </div>
                </div>
              ))}
            </div>
            <Button
              disabled={selectedForFusion.length !== 2 || fusionMutation.isPending}
              onClick={() => fusionMutation.mutate()}
            >
              {fusionMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
              开始融合
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 变异 */}
      {activeTab === 'mutation' && (
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-gray-200 mb-1">随机异变</h3>
            <p className="text-xs text-gray-400 mb-4">70%品级不变 / 20%升1阶 / 10%降1阶 / 5%逆天异变。原实体保留，生成变异版本。</p>
            <div className="grid gap-2 mb-4">
              {entities.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-700">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-200">{e.name}</span>
                    <Badge className={GRADE_COLORS[e.grade] || ''}>{e.grade} · 第{e.gradeLevel}层</Badge>
                  </div>
                  <Button size="sm" variant="outline" disabled={mutationMutation.isPending} onClick={() => mutationMutation.mutate(e.id)}>
                    <Shuffle className="h-3.5 w-3.5 mr-1" /> 异变
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 强化 */}
      {activeTab === 'upgrade' && (
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-gray-200 mb-1">强化提升</h3>
            <p className="text-xs text-gray-400 mb-4">同品级内成功率80%，跨品级冲击成功率50%（失败掉1层）。不新增特效，仅提升强度。</p>
            <div className="grid gap-2">
              {entities.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-700">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-200">{e.name}</span>
                    <Badge className={GRADE_COLORS[e.grade] || ''}>{e.grade} · 第{e.gradeLevel}层</Badge>
                    <span className="text-xs text-gray-500">{e.gradeLevel >= 3 ? '跨阶50%' : '同阶80%'}</span>
                  </div>
                  <Button size="sm" variant="outline" disabled={upgradeMutation.isPending || e.grade === '神蕴'} onClick={() => upgradeMutation.mutate(e.id)}>
                    <ArrowUpCircle className="h-3.5 w-3.5 mr-1" /> 强化
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 进化 */}
      {activeTab === 'evolution' && (
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-gray-200 mb-1">终极进化</h3>
            <p className="text-xs text-gray-400 mb-4">需道纹巅峰（第3层）以上。100%成功，品级+1大阶，解锁专属传说特效。原实体保留。</p>
            <div className="grid gap-2">
              {entities.map((e: any) => {
                const canEvolve = (e.grade === '道纹' && e.gradeLevel >= 3) || e.grade === '仙蜕'
                return (
                  <div key={e.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-700">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-200">{e.name}</span>
                      <Badge className={GRADE_COLORS[e.grade] || ''}>{e.grade} · 第{e.gradeLevel}层</Badge>
                      {!canEvolve && <span className="text-xs text-gray-500">未达条件</span>}
                    </div>
                    <Button size="sm" variant="outline" disabled={!canEvolve || evolutionMutation.isPending} onClick={() => evolutionMutation.mutate(e.id)}>
                      <Sparkles className="h-3.5 w-3.5 mr-1" /> 进化
                    </Button>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 融合树 */}
      {activeTab === 'tree' && (
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-gray-200 mb-1">成长血缘树</h3>
            <p className="text-xs text-gray-400 mb-4">选择一个实体查看其融合/变异/进化的完整来源路径</p>
            <div className="grid gap-2 mb-4">
              {entities.map((e: any) => (
                <div
                  key={e.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setTreeEntity(e)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault()
                      setTreeEntity(e)
                    }
                  }}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors',
                    treeEntity?.id === e.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-700 hover:border-gray-500'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-200">{e.name}</span>
                    <Badge className={GRADE_COLORS[e.grade] || ''}>{e.grade}</Badge>
                  </div>
                </div>
              ))}
            </div>
            {treeEntity && treeData && (
              <div className="mt-4 p-4 rounded-lg bg-gray-800/30 border border-gray-700">
                <p className="text-xs text-gray-400 mb-3">「{treeEntity.name}」的成长来源：</p>
                <TreeNodeView node={treeData.tree} depth={0} />
                {treeData.descendants?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <p className="text-xs text-gray-400 mb-2">衍生后代：</p>
                    {treeData.descendants.map((d: any) => (
                      <div key={d.id} className="flex items-center gap-2 text-sm text-gray-300 mb-1">
                        <span className="text-indigo-400">→</span>
                        <span>{d.name}</span>
                        <Badge className={GRADE_COLORS[d.grade] || ''}>{d.grade}</Badge>
                        <span className="text-xs text-gray-500">{GROWTH_TYPE_LABELS[d.growthType]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 预览弹窗 */}
      {preview && (
        <Dialog open onClose={() => setPreview(null)} title={`${GROWTH_TYPE_LABELS[preview.operation] || '操作'}结果预览`}>
          <div className="space-y-4">
            {preview.narrative && (
              <div className="p-3 rounded-lg bg-gray-800/50 text-sm text-gray-300 italic">{preview.narrative}</div>
            )}
            {preview.validationErrors?.length > 0 && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                <p className="font-medium mb-1">校验警告：</p>
                {preview.validationErrors.map((e: string, i: number) => <p key={i}>• {e}</p>)}
              </div>
            )}
            {preview.preview && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-100">{preview.preview.name}</span>
                  <Badge className={GRADE_COLORS[preview.preview.grade] || ''}>{preview.preview.grade} · 第{preview.preview.gradeLevel}层</Badge>
                </div>
                <p className="text-sm text-gray-400">{preview.preview.coreEffect || preview.preview.description}</p>
                {preview.preview.effects?.length > 0 && (
                  <div className="space-y-1">
                    {preview.preview.effects.map((ef: any, i: number) => (
                      <div key={i} className={cn('text-sm', RARITY_COLORS[ef.rarity])}>
                        [{RARITY_LABELS[ef.rarity]}] {ef.name}：{ef.description}
                      </div>
                    ))}
                  </div>
                )}
                {preview.preview.sideEffects && <p className="text-sm text-red-400/70">副作用：{preview.preview.sideEffects}</p>}
              </div>
            )}
            {preview.upgraded !== undefined && (
              <div className="text-sm text-gray-300">
                结果：<span className={preview.upgraded ? 'text-green-400' : 'text-red-400'}>{preview.upgraded ? '强化成功' : '强化失败'}</span>
                {' → '}{preview.newGrade} 第{preview.newGradeLevel}层
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setPreview(null)}><X className="h-4 w-4 mr-1" /> 关闭</Button>
              {preview.preview && (
                <Button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
                  <Check className="h-4 w-4 mr-1" /> 确认入库
                </Button>
              )}
            </div>
          </div>
        </Dialog>
      )}

      {/* 创建弹窗 */}
      {showCreate && <CreateEntityDialog onClose={() => setShowCreate(false)} onCreate={(data) => createMutation.mutate(data)} />}

      {/* 历史弹窗 */}
      {historyEntity && (
        <Dialog open onClose={() => setHistoryEntity(null)} title={`成长历史 - ${historyEntity.name}`}>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {history.length === 0 ? <EmptyState message="暂无成长记录" /> : history.map((r: any) => (
              <div key={r.id} className="p-3 rounded-lg border border-gray-700 text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-gray-700/50 text-gray-300">{GROWTH_TYPE_LABELS[r.operationType] || r.operationType}</Badge>
                    <Badge className={r.result === 'success' ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}>
                      {r.result === 'success' ? '成功' : '失败'}
                    </Badge>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => revertMutation.mutate(r.id)}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> 回退
                  </Button>
                </div>
                {r.operatorNote && <p className="text-gray-400 mt-1 text-xs">{r.operatorNote}</p>}
                <p className="text-gray-500 text-xs mt-1">{new Date(r.createdAt).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </Dialog>
      )}

      {/* 实体详情/编辑弹窗 */}
      {selectedEntity && (
        <Dialog open onClose={() => { setSelectedEntity(null); setEditForm(null) }} title={`详情 - ${selectedEntity.name}`}>
          {!editForm ? (
            /* 只读详情视图 */
            <div className="space-y-4">
              {entityDetail ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-100">{entityDetail.name}</span>
                    <Badge className={GRADE_COLORS[entityDetail.grade] || ''}>{entityDetail.grade} · 第{entityDetail.gradeLevel}层</Badge>
                    <Badge className="bg-gray-700/50 text-gray-300">{GROWTH_TYPE_LABELS[entityDetail.growthType] || entityDetail.growthType}</Badge>
                    {entityDetail.isEvolved && <Badge className="bg-red-500/15 text-red-300 border-red-500/30">进化</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {entityDetail.itemType && <div><span className="text-gray-500">法宝类型：</span><span className="text-gray-200">{entityDetail.itemType}</span></div>}
                    {entityDetail.threshold && <div><span className="text-gray-500">修炼门槛：</span><span className="text-gray-200">{entityDetail.threshold}</span></div>}
                    {entityDetail.counter && <div><span className="text-gray-500">克制/破解：</span><span className="text-gray-200">{entityDetail.counter}</span></div>}
                  </div>
                  <div className="text-sm">
                    <span className="text-gray-500">核心效果：</span>
                    <p className="text-gray-200 mt-1">{entityDetail.coreEffect || entityDetail.coreAbilities || '—'}</p>
                  </div>
                  {entityDetail.description && (
                    <div className="text-sm">
                      <span className="text-gray-500">简介：</span>
                      <p className="text-gray-300 mt-1">{entityDetail.description}</p>
                    </div>
                  )}
                  {entityDetail.effects?.length > 0 && (
                    <div className="text-sm">
                      <span className="text-gray-500">特效列表：</span>
                      <div className="mt-1 space-y-1">
                        {entityDetail.effects.map((ef: any, i: number) => (
                          <div key={i} className={cn('flex items-center gap-2', RARITY_COLORS[ef.rarity])}>
                            <Badge className="bg-gray-700/50 text-gray-300 text-xs">{RARITY_LABELS[ef.rarity]}</Badge>
                            <span>{ef.name}</span>
                            {ef.description && <span className="text-gray-500 text-xs">— {ef.description}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {entityDetail.sideEffects && (
                    <div className="text-sm">
                      <span className="text-gray-500">副作用：</span>
                      <p className="text-red-400/80 mt-1">{entityDetail.sideEffects}</p>
                    </div>
                  )}
                  {entityDetail.famousUsage && (
                    <div className="text-sm">
                      <span className="text-gray-500">经典使用：</span>
                      <p className="text-gray-300 mt-1 italic">{entityDetail.famousUsage}</p>
                    </div>
                  )}
                  <div className="flex justify-end pt-2">
                    <Button size="sm" onClick={() => setEditForm({
                      name: entityDetail.name || '',
                      coreEffect: entityDetail.coreEffect || entityDetail.coreAbilities || '',
                      description: entityDetail.description || '',
                      sideEffects: entityDetail.sideEffects || '',
                    })}>
                      编辑
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex justify-center py-8"><Spinner /></div>
              )}
            </div>
          ) : (
            /* 编辑表单 */
            <div className="space-y-3">
              <Input label="名称" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              <Textarea label="核心效果" value={editForm.coreEffect} onChange={(e) => setEditForm({ ...editForm, coreEffect: e.target.value })} rows={2} />
              <Textarea label="简介" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={2} />
              <Textarea label="副作用/反噬" value={editForm.sideEffects} onChange={(e) => setEditForm({ ...editForm, sideEffects: e.target.value })} rows={2} />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setEditForm(null)}>取消</Button>
                <Button
                  disabled={updateEntityMut.isPending || !editForm.name.trim()}
                  onClick={() => {
                    const data: any = { name: editForm.name, description: editForm.description, sideEffects: editForm.sideEffects }
                    data.coreAbilities = editForm.coreEffect
                    updateEntityMut.mutate({ id: selectedEntity.id, data })
                  }}
                >
                  {updateEntityMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                  保存
                </Button>
              </div>
            </div>
          )}
        </Dialog>
      )}
    </div>
  )
}

// 创建实体弹窗
function CreateEntityDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (data: any) => void }) {
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('凡造')
  const [subType, setSubType] = useState('')
  const [coreEffect, setCoreEffect] = useState('')
  const [sideEffects, setSideEffects] = useState('')
  const [description, setDescription] = useState('')

  const handleSubmit = () => {
    if (!name.trim()) return
    const data: any = { name, grade, gradeLevel: 1, description, sideEffects, effects: [] }
    data.itemType = subType; data.coreAbilities = coreEffect
    onCreate(data)
  }

  return (
    <Dialog open onClose={onClose} title="创建自定义法宝">
      <div className="space-y-3">
        <Input label="名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：太极玄清道" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="品级" value={grade} onChange={(e) => setGrade(e.target.value)} options={['凡造', '灵淬', '宝胎', '道纹', '仙蜕', '神蕴'].map(g => ({ value: g, label: g }))} />
          <Input label="法宝类型" value={subType} onChange={(e) => setSubType(e.target.value)} placeholder="攻击/防御/辅助..." />
        </div>
        <Textarea label="核心效果" value={coreEffect} onChange={(e) => setCoreEffect(e.target.value)} rows={2} placeholder="描述核心能力..." />
        <Textarea label="副作用/反噬" value={sideEffects} onChange={(e) => setSideEffects(e.target.value)} rows={2} placeholder="天道平衡，越强反噬越重..." />
        <Textarea label="简介" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={!name.trim()}>创建</Button>
        </div>
      </div>
    </Dialog>
  )
}

// 融合树节点递归渲染
function TreeNodeView({ node, depth }: { node: any; depth: number }) {
  if (!node) return null
  const indent = depth * 20
  return (
    <div style={{ marginLeft: indent }}>
      <div className="flex items-center gap-2 py-1">
        {depth > 0 && <span className="text-gray-600">└─</span>}
        <span className={cn('text-sm', node.isDeleted ? 'text-gray-500 line-through' : 'text-gray-200')}>{node.name}</span>
        <Badge className={GRADE_COLORS[node.grade] || ''}>{node.grade}·{node.gradeLevel}层</Badge>
        <span className="text-xs text-gray-500">{GROWTH_TYPE_LABELS[node.growthType] || node.growthType}</span>
        {node.isEvolved && <span className="text-xs text-red-400">进化</span>}
      </div>
      {node.children?.map((child: any, i: number) => (
        <TreeNodeView key={`${child.id}-${i}`} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}
