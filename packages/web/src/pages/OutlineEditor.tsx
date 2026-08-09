import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus, Sparkles, Edit2, GitBranch, Anchor, Bookmark, X, Trash2, Swords } from 'lucide-react'
import {
  Card, CardHeader, CardTitle, CardContent, Button, Badge, Dialog, Input, Textarea,
  Select, Spinner, EmptyState, useToast, Tabs,
} from '../components/ui'
import { outlinesApi, chaptersApi, dualEngineApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import { cn } from '../lib/utils'
import SceneOutlinePanel from './SceneOutlinePanel'
import MaterialPickerDialog, { type PinnedMaterial } from './MaterialPickerDialog'
import CharacterMultiSelect from '../components/CharacterMultiSelect'
import SnowflakeWizard from '../components/SnowflakeWizard'
import WorldAssetPicker, { type AssetSel, EMPTY_ASSET_SEL } from '../components/WorldAssetPicker'

export default function OutlineEditor() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('chapters')
  const [expandedVols, setExpandedVols] = useState<Set<string>>(new Set())
  const [showVolForm, setShowVolForm] = useState(false)
  const [showChapterForm, setShowChapterForm] = useState(false)
  const [showGenerateDialog, setShowGenerateDialog] = useState(false)
  // 模式归一化 PRD REQ-3：单入口弹窗内切换「快速生成/分步生成」
  const [genMode, setGenMode] = useState<'quick' | 'stepwise' | 'divine'>('quick')
  const [premise, setPremise] = useState('')
  const [editingVol, setEditingVol] = useState<any>(null)
  const [activeVolId, setActiveVolId] = useState<string>('')
  // 场景脚本选中的卷
  const [sceneOutlineId, setSceneOutlineId] = useState<string>('')

  // 双引擎工坊·大纲联动（PRD v1.3 场景C）：章节→冲突参数预填草稿后跳转
  const [draftLoadingId, setDraftLoadingId] = useState<number | null>(null)
  const handleConflictDraft = async (ch: any) => {
    setDraftLoadingId(ch.id)
    try {
      const draft = await dualEngineApi.conflictDraft(projectId, Number(ch.id))
      navigate('/dual-engine', { state: { conflictDraft: draft } })
    } catch (e: any) {
      toast(e.message || '冲突参数预填失败', 'error')
    } finally {
      setDraftLoadingId(null)
    }
  }

  // 天机推演
  const [divineDirection, setDivineDirection] = useState('')
  const [divineResult, setDivineResult] = useState<any>(null)
  const [divineLoading, setDivineLoading] = useState(false)

  // 卷大纲表单
  const [volForm, setVolForm] = useState({
    title: '', synopsis: '', keyEvents: '', characterArcs: '', volumeNo: 1,
  })

  // 章节计划表单
  const [chapterForm, setChapterForm] = useState({
    title: '', intent: '', targetWords: 3000,
    scenes: '', emotionGoal: '', conflictGoal: '', anchors: '', chapterType: 'progression',
  })
  // POV视角人物ID（正数=诛仙库原生，负数=自定义人物），由角色选择器产出
  const [povIds, setPovIds] = useState<number[]>([])
  // 正在编辑的章节计划（架构升级 Epic6：意图设定可后置修改），null=新建模式
  const [editingChapter, setEditingChapter] = useState<any>(null)

  // 固定素材（二期RAG人工干预）
  const [pinnedMaterials, setPinnedMaterials] = useState<PinnedMaterial[]>([])
  const [showMaterialPicker, setShowMaterialPicker] = useState(false)
  const handleToggleMaterial = (m: PinnedMaterial) => {
    setPinnedMaterials((prev) => {
      const key = `${m.table}:${m.id}`
      const exists = prev.some((p) => `${p.table}:${p.id}` === key)
      return exists ? prev.filter((p) => `${p.table}:${p.id}` !== key) : [...prev, m]
    })
  }

  // 当前项目（全局状态，侧边栏可切换）
  const projectId = useCurrentProjectId()

  // 获取大纲列表
  const { data: outlines, isLoading } = useQuery({
    queryKey: ['outlines', projectId],
    queryFn: () => outlinesApi.list(projectId),
    enabled: !!projectId,
  })

  // AI生成大纲
  const [generateError, setGenerateError] = useState('')
  // 16-SRS P2-1：四模块资产勾选（不勾选=后端全量注入；勾选=仅注入选中）
  // 模式归一化 PRD REQ-3.3：勾选逻辑收敛到 WorldAssetPicker 共享组件
  const [genSel, setGenSel] = useState<AssetSel>(EMPTY_ASSET_SEL)
  const resetGenSelection = () => setGenSel(EMPTY_ASSET_SEL)
  const generateMutation = useMutation({
    mutationFn: () => outlinesApi.generate(projectId, {
      premise,
      ...(genSel.characterIds.length ? { characterIds: genSel.characterIds } : {}),
      ...(genSel.weaponIds.length ? { weaponIds: genSel.weaponIds } : {}),
      ...(genSel.techniqueIds.length ? { techniqueIds: genSel.techniqueIds } : {}),
      ...(genSel.locationIds.length ? { locationIds: genSel.locationIds } : {}),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outlines', projectId] })
      queryClient.invalidateQueries({ queryKey: ['chapter-plans', projectId] })
      setShowGenerateDialog(false)
      setPremise('')
      setGenerateError('')
      resetGenSelection()
      toast('大纲生成成功', 'success')
    },
    onError: (err: any) => {
      setGenerateError(err.message || '生成失败')
      toast(err.message || '生成失败', 'error')
    },
  })

  // 创建/更新卷大纲
  const saveVolMutation = useMutation({
    mutationFn: (data: any) =>
      editingVol
        ? outlinesApi.update(projectId, editingVol.id, data)
        : outlinesApi.create(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outlines', projectId] })
      setShowVolForm(false)
      setEditingVol(null)
      toast(editingVol ? '卷大纲已更新' : '卷大纲已创建', 'success')
    },
    onError: (err: any) => toast(err.message || '保存失败', 'error'),
  })

  // 删除卷大纲
  const deleteVolMutation = useMutation({
    mutationFn: (id: string) => outlinesApi.delete(projectId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outlines', projectId] })
      toast('卷大纲已删除', 'success')
    },
    onError: (err: any) => toast(err.message || '删除失败', 'error'),
  })

  // 创建/更新章节计划（落库；Epic6：编辑模式走 PUT 更新意图字段）
  const saveChapterMutation = useMutation({
    mutationFn: (data: any) =>
      editingChapter
        ? chaptersApi.update(projectId, String(editingChapter.id), data)
        : chaptersApi.create(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outlines', projectId] })
      queryClient.invalidateQueries({ queryKey: ['chapter-plans', projectId] })
      setShowChapterForm(false)
      setEditingChapter(null)
      setChapterForm({
        title: '', intent: '', targetWords: 3000,
        scenes: '', emotionGoal: '', conflictGoal: '', anchors: '', chapterType: 'progression',
      })
      setPovIds([])
      setPinnedMaterials([])
      toast(editingChapter ? '章节计划已更新' : '章节计划已创建', 'success')
    },
    onError: (err: any) => toast(err.message || '保存失败', 'error'),
  })

  // 提交章节计划表单：新建时解析POV人名、计算章节号；编辑时仅更新意图字段
  const handleSaveChapter = () => {
    if (!chapterForm.title.trim()) {
      toast('请输入章节标题', 'error')
      return
    }

    // 意图字段（新建/编辑共用）
    const intentFields = {
      title: chapterForm.title,
      intent: chapterForm.intent || chapterForm.title,
      targetWordCount: chapterForm.targetWords || 3000,
      emotionTarget: chapterForm.emotionGoal || undefined,
      conflictTarget: chapterForm.conflictGoal ? Number(chapterForm.conflictGoal) : undefined,
      sceneBreakdown: chapterForm.scenes
        ? chapterForm.scenes.split('\n').filter(Boolean)
        : undefined,
      mustHaveEvents: chapterForm.anchors
        ? chapterForm.anchors.split('\n').map((s) => s.trim()).filter(Boolean)
        : undefined,
      povCharacterIds: povIds.length ? povIds : undefined,
      chapterType: chapterForm.chapterType || 'progression',
      pinnedMaterialIds: pinnedMaterials.length
        ? pinnedMaterials.map((m) => ({ table: m.table, id: m.id }))
        : undefined,
    }

    if (editingChapter) {
      saveChapterMutation.mutate(intentFields)
      return
    }

    const vol = outlines?.find((v: any) => String(v.id) === String(activeVolId))
    if (!vol) {
      toast('未找到所属卷大纲', 'error')
      return
    }
    const nextChapterNo = (vol.chapters?.length || 0) + 1
    saveChapterMutation.mutate({
      outlineId: Number(vol.id),
      volumeNo: vol.volumeNo || 1,
      chapterNo: nextChapterNo,
      ...intentFields,
    })
  }

  // Epic6：打开章节意图编辑弹窗（预填现有计划字段）
  const openEditChapter = (ch: any) => {
    setEditingChapter(ch)
    setChapterForm({
      title: ch.title || '',
      intent: ch.intent || '',
      targetWords: ch.targetWordCount || 3000,
      scenes: Array.isArray(ch.sceneBreakdown) ? ch.sceneBreakdown.join('\n') : ch.sceneBreakdown || '',
      emotionGoal: ch.emotionTarget || '',
      conflictGoal: ch.conflictTarget != null ? String(ch.conflictTarget) : '',
      anchors: Array.isArray(ch.mustHaveEvents) ? ch.mustHaveEvents.join('\n') : '',
      chapterType: ch.chapterType || 'progression',
    })
    setPovIds(Array.isArray(ch.povCharacterIds) ? ch.povCharacterIds.map(Number) : [])
    setPinnedMaterials(
      (Array.isArray(ch.pinnedMaterialIds) ? ch.pinnedMaterialIds : []).map((m: any) => ({
        table: m.table,
        id: m.id,
        tableLabel: m.table,
        title: '(已固定)',
      }))
    )
    setShowChapterForm(true)
  }

  // 切换卷展开/折叠
  const toggleVol = (id: string) => {
    setExpandedVols((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 打开编辑卷表单
  const openEditVol = (vol: any) => {
    setEditingVol(vol)
    setVolForm({
      title: vol.title || '',
      synopsis: vol.synopsis || '',
      keyEvents: Array.isArray(vol.keyEvents) ? vol.keyEvents.join('\n') : vol.keyEvents || '',
      characterArcs: Array.isArray(vol.characterArcs) ? vol.characterArcs.join('\n') : vol.characterArcs || '',
      volumeNo: vol.volumeNo || 1,
    })
    setShowVolForm(true)
  }

  // 保存卷大纲
  const handleSaveVol = () => {
    if (!volForm.title.trim()) {
      toast('请输入卷标题', 'error')
      return
    }
    saveVolMutation.mutate({
      title: volForm.title,
      synopsis: volForm.synopsis,
      volumeNo: volForm.volumeNo,
      keyEvents: volForm.keyEvents.split('\n').filter(Boolean),
      characterArcs: volForm.characterArcs.split('\n').filter(Boolean),
    })
  }

  // 天机推演：基于当前项目上下文推演未来剧情走向
  const handleDivine = async () => {
    setDivineLoading(true)
    setDivineResult(null)
    try {
      const res = await outlinesApi.divine(projectId, {
        direction: divineDirection || undefined,
        count: 3,
      })
      setDivineResult(res)
    } catch (err: any) {
      toast(err.message || '推演失败', 'error')
    } finally {
      setDivineLoading(false)
    }
  }

  // 场景脚本当前选中的卷大纲对象
  const sceneOutline = outlines?.find((v: any) => String(v.id) === sceneOutlineId)

  return (
    <div className="space-y-4">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">大纲编辑</h1>
        {activeTab === 'chapters' && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowGenerateDialog(true)}
              loading={generateMutation.isPending && genMode === 'quick'}
            >
              <Sparkles className="h-4 w-4" />
              AI生成大纲
            </Button>
            <Button onClick={() => { setEditingVol(null); setShowVolForm(true) }}>
              <Plus className="h-4 w-4" />
              新建卷
            </Button>
          </div>
        )}
      </div>

      {/* 二级Tab切换 */}
      <Tabs
        tabs={[
          { id: 'chapters', label: '章节目录' },
          { id: 'scenes', label: '场景编排' },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* ===== 场景脚本 Tab ===== */}
      {activeTab === 'scenes' && (
        <div className="space-y-3">
          {/* 卷选择器 */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">选择卷大纲：</span>
            <select
              id="scene-outline-select"
              aria-label="选择卷大纲"
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 focus:border-indigo-500"
              value={sceneOutlineId}
              onChange={(e) => setSceneOutlineId(e.target.value)}
            >
              <option value="">请选择...</option>
              {(outlines || []).map((vol: any) => (
                <option key={vol.id} value={String(vol.id)}>
                  第{vol.volumeNo}卷：{vol.title}
                </option>
              ))}
            </select>
          </div>

          {/* 场景脚本面板 */}
          {sceneOutlineId ? (
            <SceneOutlinePanel
              projectId={String(projectId)}
              outlineId={sceneOutlineId}
              outlineTitle={sceneOutline?.title || ''}
            />
          ) : (
            <EmptyState message="请先选择对应的卷大纲，再编排场景脚本" />
          )}
        </div>
      )}


      {/* ===== 章节目录 Tab（原卷级大纲 + 叙事里程碑合并） ===== */}
      {activeTab === 'chapters' && (<>
      {/* 大纲列表 */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : !outlines?.length ? (
        <EmptyState message="暂无大纲，点击「新建卷」或「AI生成大纲」开始" />
      ) : (
        <div className="space-y-3">
          {outlines.map((vol: any) => (
            <Card key={vol.id}>
              {/* 卷标题栏 */}
              <div
                className="flex cursor-pointer items-center gap-3 p-4"
                role="button"
                tabIndex={0}
                onClick={() => toggleVol(vol.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleVol(vol.id) } }}
              >
                {expandedVols.has(vol.id)
                  ? <ChevronDown className="h-4 w-4 text-gray-400" />
                  : <ChevronRight className="h-4 w-4 text-gray-400" />
                }
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-100">
                      第{vol.volumeNo}卷：{vol.title}
                    </span>
                    <Badge variant="default">
                      {vol.chapters?.length || 0} 章
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-gray-500 line-clamp-1">
                    {vol.synopsis}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="编辑"
                  onClick={(e) => { e.stopPropagation(); openEditVol(vol) }}
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="删除"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`确认删除「第${vol.volumeNo}卷：${vol.title}」？\n该卷下的章节计划与场景脚本将一并删除（已生成的正文不受影响），此操作不可恢复。`)) {
                      deleteVolMutation.mutate(String(vol.id))
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                </Button>
              </div>

              {/* 展开内容 */}
              {expandedVols.has(vol.id) && (
                <CardContent className="border-t border-gray-800 pt-4">

                  {/* 章节计划列表 */}
                  {vol.chapters?.length > 0 && (
                    <div className="mt-4">
                      <h4 className="mb-2 text-sm font-medium text-gray-400">章节计划</h4>
                      <div className="space-y-2">
                        {vol.chapters.map((ch: any, i: number) => (
                          <div
                            key={ch.id || i}
                            className="rounded-lg border border-gray-800 bg-gray-800/50 p-3"
                          >
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-1.5 text-sm font-medium text-gray-200">
                                第{ch.chapterNo || i + 1}章：{ch.title}
                                {ch.branchSourceOptionId && (
                                  <span
                                    className="inline-flex items-center gap-0.5 rounded bg-indigo-600/20 px-1.5 py-0.5 text-[10px] text-indigo-300"
                                    title="由剧情分支衍生"
                                  >
                                    <GitBranch className="h-3 w-3" />
                                    分支
                                  </span>
                                )}
                                {ch.mustHaveEvents?.length > 0 && (
                                  <span
                                    className="inline-flex items-center gap-0.5 rounded bg-amber-600/20 px-1.5 py-0.5 text-[10px] text-amber-300"
                                    title={`已设置 ${ch.mustHaveEvents.length} 个关键剧情锚点`}
                                  >
                                    <Anchor className="h-3 w-3" />
                                    锚点{ch.mustHaveEvents.length}
                                  </span>
                                )}
                              </span>
                              <span className="flex items-center gap-2 text-xs text-gray-500">
                                目标 {ch.targetWordCount || 3000} 字
                                <button
                                  className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-700 hover:text-gold-400"
                                  title="一键生成冲突戏（双引擎工坊）"
                                  aria-label="一键生成冲突戏"
                                  disabled={draftLoadingId === ch.id}
                                  onClick={(e) => { e.stopPropagation(); handleConflictDraft(ch) }}
                                >
                                  {draftLoadingId === ch.id
                                    ? <Spinner className="h-3 w-3" label="预填中" />
                                    : <Swords className="h-3 w-3" />}
                                </button>
                                <button
                                  className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-700 hover:text-indigo-400"
                                  title="编辑章节意图"
                                  aria-label="编辑章节意图"
                                  onClick={(e) => { e.stopPropagation(); openEditChapter(ch) }}
                                >
                                  <Edit2 className="h-3 w-3" />
                                </button>
                              </span>
                            </div>
                            {ch.intent && (
                              <p className="mt-1 text-xs text-gray-500">{ch.intent}</p>
                            )}
                            {ch.povCharacterNames?.length > 0 && (
                              <span className="mt-1 inline-block text-xs text-indigo-400">
                                POV: {ch.povCharacterNames.join('、')}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 新建章节计划按钮 */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3"
                    onClick={() => { setActiveVolId(vol.id); setShowChapterForm(true) }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加章节计划
                  </Button>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* 卷大纲表单弹窗 */}
      <Dialog
        open={showVolForm}
        onClose={() => { setShowVolForm(false); setEditingVol(null) }}
        title={editingVol ? '编辑卷大纲' : '新建卷大纲'}
      >
        <div className="space-y-4">
          <Input
            label="卷标题"
            value={volForm.title}
            onChange={(e) => setVolForm({ ...volForm, title: e.target.value })}
            placeholder="例如：青云入门"
          />
          <Textarea
            label="概要"
            rows={3}
            value={volForm.synopsis}
            onChange={(e) => setVolForm({ ...volForm, synopsis: e.target.value })}
            placeholder="本卷主要剧情概述..."
          />
          <Textarea
            label="关键事件（每行一个）"
            rows={3}
            value={volForm.keyEvents}
            onChange={(e) => setVolForm({ ...volForm, keyEvents: e.target.value })}
          />
          <Textarea
            label="人物弧线（每行一个）"
            rows={3}
            value={volForm.characterArcs}
            onChange={(e) => setVolForm({ ...volForm, characterArcs: e.target.value })}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowVolForm(false)}>取消</Button>
            <Button onClick={handleSaveVol} loading={saveVolMutation.isPending}>保存</Button>
          </div>
        </div>
      </Dialog>

      {/* 章节计划表单弹窗（新建 / Epic6 意图编辑共用） */}
      <Dialog
        open={showChapterForm}
        onClose={() => { setShowChapterForm(false); setEditingChapter(null) }}
        title={editingChapter ? '编辑章节意图' : '新建章节计划'}
      >
        <div className="space-y-4">
          <Input
            label="章节标题"
            value={chapterForm.title}
            onChange={(e) => setChapterForm({ ...chapterForm, title: e.target.value })}
          />
          <Textarea
            label="章节意图"
            rows={2}
            value={chapterForm.intent}
            onChange={(e) => setChapterForm({ ...chapterForm, intent: e.target.value })}
            placeholder="本章要达成什么叙事目标..."
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">POV视角人物</label>
            <CharacterMultiSelect
              projectId={projectId}
              value={povIds}
              onChange={setPovIds}
            />
          </div>
          <Input
            label="目标字数"
            type="number"
            value={chapterForm.targetWords}
            onChange={(e) => setChapterForm({ ...chapterForm, targetWords: Number(e.target.value) })}
          />
          <Select
            label="章节类型"
            value={chapterForm.chapterType}
            onChange={(e) => setChapterForm({ ...chapterForm, chapterType: e.target.value })}
            options={[
              { value: 'progression', label: '推进章（中度冲突）' },
              { value: 'climax', label: '高潮章（峰值）' },
              { value: 'revelation', label: '揭露章（信息解密）' },
              { value: 'buffer_price', label: '缓冲-代价（清算代价）' },
              { value: 'buffer_dialog', label: '缓冲-对话（关系演变）' },
              { value: 'buffer_clue', label: '缓冲-线索（伏笔整理）' },
              { value: 'singularity', label: '奇点事件（破格，受配额限制）' },
            ]}
          />
          <Textarea
            label="场景分解（每行一个场景）"
            rows={3}
            value={chapterForm.scenes}
            onChange={(e) => setChapterForm({ ...chapterForm, scenes: e.target.value })}
          />
          <Textarea
            label="关键剧情锚点（每行一个，本章必须发生的核心事件）"
            rows={3}
            value={chapterForm.anchors}
            onChange={(e) => setChapterForm({ ...chapterForm, anchors: e.target.value })}
            placeholder="例如：&#10;张小凡与碧瑶在滴血洞相遇&#10;张小凡首次催动噬魂&#10;（留空=不启用锚点约束）"
          />
          {/* 固定素材（二期RAG人工干预） */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-300">固定素材（可选）</label>
              <Button size="sm" variant="outline" onClick={() => setShowMaterialPicker(true)}>
                <Bookmark className="h-3 w-3" />
                选择素材
              </Button>
            </div>
            {pinnedMaterials.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {pinnedMaterials.map((m) => (
                  <span
                    key={`${m.table}:${m.id}`}
                    className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-300"
                  >
                    <span className="text-[10px] text-indigo-400/70">{m.tableLabel}</span>
                    {m.title}
                    <button
                      onClick={() => handleToggleMaterial(m)}
                      className="ml-0.5 text-indigo-400/70 hover:text-indigo-200"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500">未固定素材时按语义自动召回；固定后本章写作必定融入所选素材。</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="情绪目标"
              value={chapterForm.emotionGoal}
              onChange={(e) => setChapterForm({ ...chapterForm, emotionGoal: e.target.value })}
            />
            <Input
              label="冲突目标"
              value={chapterForm.conflictGoal}
              onChange={(e) => setChapterForm({ ...chapterForm, conflictGoal: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => { setShowChapterForm(false); setEditingChapter(null) }}>取消</Button>
            <Button onClick={handleSaveChapter} loading={saveChapterMutation.isPending}>
              {editingChapter ? '保存' : '添加'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 固定素材选择器 */}
      <MaterialPickerDialog
        projectId={projectId}
        open={showMaterialPicker}
        onClose={() => setShowMaterialPicker(false)}
        selected={pinnedMaterials}
        onToggle={handleToggleMaterial}
      />

      {/* AI生成大纲弹窗（模式归一化 PRD REQ-3：单入口，弹窗内切换快速/分步） */}
      <Dialog
        open={showGenerateDialog}
        onClose={() => setShowGenerateDialog(false)}
        title="AI生成大纲"
      >
        <div className="space-y-4">
          {/* 模式切换：快速生成（one-shot）/ 分步生成（stepwise 雪花法） */}
          <div className="flex rounded border border-gray-700 p-0.5">
            <button
              className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${
                genMode === 'quick' ? 'bg-amber-500/20 text-amber-300' : 'text-gray-400 hover:text-gray-200'
              }`}
              onClick={() => setGenMode('quick')}
            >
              快速生成
            </button>
            <button
              className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${
                genMode === 'stepwise' ? 'bg-amber-500/20 text-amber-300' : 'text-gray-400 hover:text-gray-200'
              }`}
              onClick={() => setGenMode('stepwise')}
            >
              分步生成（雪花法）
            </button>
            <button
              className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${
                genMode === 'divine' ? 'bg-amber-500/20 text-amber-300' : 'text-gray-400 hover:text-gray-200'
              }`}
              onClick={() => setGenMode('divine')}
            >
              自由推演
            </button>
          </div>

          {genMode === 'stepwise' ? (
            <SnowflakeWizard
              embedded
              projectId={projectId}
              onClose={() => setShowGenerateDialog(false)}
              onFinalized={() => {
                queryClient.invalidateQueries({ queryKey: ['outlines', projectId] })
                queryClient.invalidateQueries({ queryKey: ['chapter-plans', projectId] })
              }}
            />
          ) : genMode === 'divine' ? (
            // 自由推演模式（原天机推演 Tab 移入）
            <div className="space-y-4">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">引导方向（可选）</label>
                  <Input
                    value={divineDirection}
                    onChange={(e) => setDivineDirection(e.target.value)}
                    placeholder="如：偏向战斗、感情线、阴谋揭露..."
                    className="h-8 text-sm"
                  />
                </div>
                <Button size="sm" onClick={handleDivine} loading={divineLoading}>
                  <Sparkles className="h-3.5 w-3.5" />
                  推演
                </Button>
              </div>

              {divineResult && (
                <div className="space-y-3">
                  {divineResult.directions?.map((dir: any, i: number) => (
                    <Card key={i}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-indigo-300">
                          走向{i + 1}：{dir.title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {dir.chapters?.map((ch: any, ci: number) => (
                            <div key={ci} className="flex gap-2 text-sm">
                              <span className="shrink-0 text-gray-500">第{ch.chapterNo}章</span>
                              <span className="font-medium text-gray-200">{ch.title}</span>
                              <span className="text-gray-400">{ch.summary}</span>
                            </div>
                          ))}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={async () => {
                            try {
                              await outlinesApi.divineAdopt(projectId, dir)
                              toast(`已采纳为第${dir.title || 'N'}卷，刷新大纲可查看`, 'success')
                              queryClient.invalidateQueries({ queryKey: ['outlines', projectId] })
                              queryClient.invalidateQueries({ queryKey: ['chapter-plans', projectId] })
                            } catch (err: any) {
                              toast(err.message || '采纳失败', 'error')
                            }
                          }}
                        >
                          采纳为卷大纲
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                  {!divineResult.directions?.length && divineResult.raw && (
                    <pre className="whitespace-pre-wrap text-sm text-gray-300">{divineResult.raw}</pre>
                  )}
                </div>
              )}
            </div>
          ) : (
          <div className="space-y-4">
          <Textarea
            label="故事前提"
            rows={4}
            value={premise}
            onChange={(e) => setPremise(e.target.value)}
            placeholder="请输入故事前提，例如：一个平凡少年意外获得上古传承，踏上修仙之路..."
          />
          {/* 16-SRS P2-1：四模块资产勾选（可选；不勾选=全量注入）— 共享 WorldAssetPicker */}
          <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-900/30 p-3">
            <p className="text-xs font-medium text-gray-400">
              世界观资产注入（可选）：勾选后仅注入选中资产；不勾选则自动注入全部已有资产
            </p>
            <WorldAssetPicker
              projectId={projectId}
              enabled={showGenerateDialog && genMode === 'quick'}
              value={genSel}
              onChange={setGenSel}
            />
          </div>
          <p className="text-xs text-gray-500">
            AI将根据故事前提、诛仙世界观数据与已注入的世界观资产，自动生成卷级大纲和章节计划。
          </p>
          {generateError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {generateError}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => { setShowGenerateDialog(false); resetGenSelection() }}>取消</Button>
            <Button
              onClick={() => generateMutation.mutate()}
              loading={generateMutation.isPending}
              disabled={!premise.trim()}
            >
              <Sparkles className="h-4 w-4" />
              开始生成
            </Button>
          </div>
          </div>
          )}
        </div>
      </Dialog>
      </>)}
    </div>
  )
}
