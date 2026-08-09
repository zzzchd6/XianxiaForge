/**
 * ProjectWizard.tsx — 新书引导向导（v1.5+）
 *
 * 6步完成从创建项目到开始写作的全流程配置：
 *   1. 创建项目    2. 设定主角    3. 导入素材
 *   4. 配置文风    5. 搭建大纲    6. 开始写作
 *
 * 每步可跳过；完成后跳转到仪表盘。
 * 全部复用现有 API，不加新后端。
 */
import { useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import {
  BookOpen, UserPlus, FileText, Palette, ListTree, Rocket,
  ChevronRight, ChevronLeft, SkipForward, Check, Sparkles,
  Upload, Zap,
} from 'lucide-react'
import { cn } from '../lib/utils'
import {
  Card, Button, Badge, Spinner, Input, Textarea, Select,
  useToast,
} from '../components/ui'
import {
  projectsApi, outlinesApi, benchmarkApi,
  materialKbApi, customCharacterApi, worldApi,
} from '../lib/api'
import { useProjectContext, useSetCurrentProject } from '../hooks/useCurrentProject'

// ─── 步骤定义 ───────────────────────────────────────────────────

const STEPS = [
  { key: 'project',  icon: BookOpen,   label: '创建项目',  desc: '设定书名与世界观' },
  { key: 'protagonist', icon: UserPlus, label: '设定主角', desc: '快速创建主角模板' },
  { key: 'materials', icon: FileText,  label: '导入素材', desc: '拆文获取灵感资产' },
  { key: 'style',    icon: Palette,    label: '配置文风',  desc: '选择或跳过文风预设' },
  { key: 'outline',  icon: ListTree,   label: '搭建大纲',  desc: 'AI 生成或手动创建' },
  { key: 'finish',   icon: Rocket,     label: '开始写作',  desc: '进入生成管线' },
] as const

type StepKey = (typeof STEPS)[number]['key']

// ─── 步骤进度条组件 ─────────────────────────────────────────────

function StepTracker({ current }: { current: StepKey }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current)

  return (
    <div className="flex items-center justify-center gap-1 mb-8">
      {STEPS.map((step, i) => {
        const isCurrent = i === currentIdx
        const isPast = i < currentIdx
        return (
          <div key={step.key} className="flex items-center gap-1">
            {/* Step bubble */}
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors',
                isPast && 'bg-gold-500/20 text-gold-300 border border-gold-500/40',
                isCurrent && 'bg-gold-500 text-gray-950 ring-2 ring-gold-400/60',
                !isPast && !isCurrent && 'bg-gray-800 text-gray-500 border border-gray-700'
              )}
              title={step.label}
            >
              {isPast ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            {/* Connector */}
            {i < STEPS.length - 1 && (
              <div className={cn('h-px w-6', i < currentIdx ? 'bg-gold-500/40' : 'bg-gray-700')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Step 1: 创建项目 ────────────────────────────────────────────

function StepProject({ onNext, onSkip }: { onNext: (projectId: number) => void; onSkip: () => void }) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [genre, setGenre] = useState('xianxia')
  const [description, setDescription] = useState('')

  const createM = useMutation({
    mutationFn: () => projectsApi.create({ name, genre, description }),
    onSuccess: (r: any) => {
      toast('项目创建成功', 'success')
      onNext(r.id)
    },
    onError: (e: Error) => toast(`创建失败: ${e.message}`, 'error'),
  })

  const valid = name.trim().length >= 1

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-gray-100">创建你的第一本书</h2>
        <p className="text-sm text-gray-500 mt-1">只需书名即可开始，其余可后续补充</p>
      </div>

      <Input
        label="书名 *"
        placeholder="如：青云仙路"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <Select
        label="题材"
        value={genre}
        onChange={(e) => setGenre(e.target.value)}
        options={[
          { value: 'xianxia', label: '仙侠' },
          { value: 'xuanhuan', label: '玄幻' },
          { value: 'wuxia', label: '武侠' },
          { value: 'kehuan', label: '科幻' },
          { value: 'qihuan', label: '奇幻' },
          { value: 'xianshi', label: '现实' },
        ]}
      />

      <Textarea
        label="一句话简介（可选）"
        placeholder="一句话概括你的故事核心"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onSkip} className="flex-1">跳过，直接创建空项目</Button>
        <Button disabled={!valid || createM.isPending} onClick={() => createM.mutate()} className="flex-1" loading={createM.isPending}>
          创建并继续
        </Button>
      </div>
    </div>
  )
}

// ─── Step 2: 设定主角 ────────────────────────────────────────────

function StepProtagonist({ projectId, onNext, onSkip }: { projectId: number; onNext: () => void; onSkip: () => void }) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [gender, setGender] = useState('male')
  const [position, setPosition] = useState('protagonist')

  const createM = useMutation({
    mutationFn: async () => {
      // 先用随机姓名 + AI 取名兜底
      let charName = name.trim()
      if (!charName) {
        try {
          const aiName = await customCharacterApi.aiName(String(projectId), {
            raceCategory: 'human', raceSub: 'cultivator', gender,
          })
          charName = aiName.names?.[0] || '未命名'
        } catch {
          charName = gender === 'male' ? '林青云' : '苏清雪'
        }
      }
      return customCharacterApi.create(String(projectId), {
        name: charName,
        gender,
        position,
        raceCategory: 'human',
        raceSub: 'cultivator',
        realmStage: 'qi_refining',
        generateBio: true,
        generateVerdict: true,
      })
    },
    onSuccess: () => {
      toast('主角创建成功', 'success')
      onNext()
    },
    onError: (e: Error) => toast(`创建失败: ${e.message}`, 'error'),
  })

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-gray-100">设定你的主角</h2>
        <p className="text-sm text-gray-500 mt-1">快速创建一位角色作为故事主角</p>
      </div>

      <Input
        label="角色名（留空自动生成）"
        placeholder="如：林青云"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <Select
        label="性别"
        value={gender}
        onChange={(e) => setGender(e.target.value)}
        options={[
          { value: 'male', label: '男' },
          { value: 'female', label: '女' },
        ]}
      />

      <Select
        label="角色定位"
        value={position}
        onChange={(e) => setPosition(e.target.value)}
        options={[
          { value: 'protagonist', label: '主角' },
          { value: 'antihero', label: '反英雄' },
          { value: 'redeemer', label: '救赎者' },
        ]}
      />

      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onSkip} className="flex-1">跳过，后续再创建</Button>
        <Button onClick={() => createM.mutate()} className="flex-1" loading={createM.isPending}>
          创建主角并继续
        </Button>
      </div>
    </div>
  )
}

// ─── Step 3: 导入素材 ────────────────────────────────────────────

function StepMaterials({ projectId, onNext, onSkip }: { projectId: number; onNext: () => void; onSkip: () => void }) {
  const { toast } = useToast()
  const [sourceBook, setSourceBook] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<'light' | 'book' | 'skip'>('light')

  const analyzeM = useMutation({
    mutationFn: () => benchmarkApi.analyze(projectId, sourceBook.trim(), text),
    onSuccess: (r) => {
      toast(`拆文完成：产出 ${r.analyzed} 条，入库 ${r.inserted.length} 条`, 'success')
      onNext()
    },
    onError: (e: Error) => toast(`拆文失败: ${e.message}`, 'error'),
  })

  const uploadM = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('请选择文件')
      const { response } = await benchmarkApi.analyzeBook(projectId, file, sourceBook.trim() || file.name.replace(/\.txt$/i, ''), 5)
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || `上传失败`)
      }
      // SSE stream - just acknowledge
      return
    },
    onSuccess: () => {
      toast('整本拆文已启动，可在「对标素材」Tab 查看进度', 'success')
      onNext()
    },
    onError: (e: Error) => toast(`上传失败: ${e.message}`, 'error'),
  })

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-gray-100">导入对标素材</h2>
        <p className="text-sm text-gray-500 mt-1">拆解对标书获取角色卡/剧情单元/文风/设定，写作时自动参考</p>
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => setMode('light')}
          className={cn(
            'rounded-xl border p-4 text-left transition-colors',
            mode === 'light' ? 'border-gold-500/60 bg-gold-500/5' : 'border-gray-700 bg-gray-900/40 hover:border-gray-600'
          )}
        >
          <Zap className={cn('h-5 w-5 mb-2', mode === 'light' ? 'text-gold-400' : 'text-gray-500')} />
          <div className="text-sm font-medium text-gray-200">轻量拆文</div>
          <div className="text-xs text-gray-500 mt-1">粘贴章节文本<br />数十秒出结果</div>
        </button>

        <button
          type="button"
          onClick={() => setMode('book')}
          className={cn(
            'rounded-xl border p-4 text-left transition-colors',
            mode === 'book' ? 'border-gold-500/60 bg-gold-500/5' : 'border-gray-700 bg-gray-900/40 hover:border-gray-600'
          )}
        >
          <Upload className={cn('h-5 w-5 mb-2', mode === 'book' ? 'text-gold-400' : 'text-gray-500')} />
          <div className="text-sm font-medium text-gray-200">整本拆文</div>
          <div className="text-xs text-gray-500 mt-1">上传TXT整本书<br />默认拆前5章</div>
        </button>

        <button
          type="button"
          onClick={() => { onSkip(); return }}
          className="rounded-xl border border-gray-700 bg-gray-900/40 p-4 text-left hover:border-gray-600 transition-colors"
        >
          <SkipForward className="h-5 w-5 mb-2 text-gray-500" />
          <div className="text-sm font-medium text-gray-400">跳过</div>
          <div className="text-xs text-gray-500 mt-1">后续再导入<br />不阻塞写作</div>
        </button>
      </div>

      {/* Light mode form */}
      {mode === 'light' && (
        <div className="space-y-3 border border-gray-700 rounded-xl p-4 bg-gray-900/30">
          <Input
            label="对标书名"
            placeholder="如：仙逆"
            value={sourceBook}
            onChange={(e) => setSourceBook(e.target.value)}
          />
          <Textarea
            label="待拆解文本（至少100字）"
            rows={8}
            placeholder="粘贴对标书章节/片段原文"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-3 pt-1">
            <Button variant="outline" onClick={onSkip} className="flex-1">跳过</Button>
            <Button
              disabled={!sourceBook.trim() || text.trim().length < 100 || analyzeM.isPending}
              onClick={() => analyzeM.mutate()}
              className="flex-1"
              loading={analyzeM.isPending}
            >
              <Zap className="h-4 w-4" />开始拆文
            </Button>
          </div>
        </div>
      )}

      {/* Book mode form */}
      {mode === 'book' && (
        <div className="space-y-3 border border-gray-700 rounded-xl p-4 bg-gray-900/30">
          <Input
            label="对标书名"
            placeholder="如：仙逆"
            value={sourceBook}
            onChange={(e) => setSourceBook(e.target.value)}
          />
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">选择 TXT 文件</label>
            <input
              type="file"
              accept=".txt"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gold-500/10 file:text-gold-300 hover:file:bg-gold-500/20"
            />
            {file && <p className="text-xs text-gray-500 mt-1">已选择: {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>}
          </div>
          <div className="flex gap-3 pt-1">
            <Button variant="outline" onClick={onSkip} className="flex-1">跳过</Button>
            <Button
              disabled={!file || uploadM.isPending}
              onClick={() => uploadM.mutate()}
              className="flex-1"
              loading={uploadM.isPending}
            >
              <Upload className="h-4 w-4" />上传并拆解
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Step 4: 配置文风 ────────────────────────────────────────────

function StepStyle({ projectId, onNext, onSkip }: { projectId: number; onNext: () => void; onSkip: () => void }) {
  const { toast } = useToast()
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null)

  const presetsQ = useQuery({
    queryKey: ['wizard-style-presets'],
    queryFn: () => materialKbApi.stylePresets(),
    staleTime: 30_000,
  })

  const applyM = useMutation({
    mutationFn: async () => {
      // Apply style by updating project generation config
      if (selectedPresetId) {
        const preset = presetsQ.data?.find((p: any) => p.id === selectedPresetId)
        if (preset) {
          await projectsApi.update(String(projectId), {
            generationConfig: { stylePresetId: preset.id, styleName: preset.style_name },
          })
        }
      }
    },
    onSuccess: () => {
      toast(selectedPresetId ? '文风已配置' : '已跳过', 'success')
      onNext()
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const presets = presetsQ.data ?? []

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-gray-100">配置写作文风</h2>
        <p className="text-sm text-gray-500 mt-1">选择一个文风预设让 AI 以特定风格写作，或稍后配置</p>
      </div>

      {presetsQ.isLoading && (
        <div className="flex justify-center py-8"><Spinner /></div>
      )}

      {!presetsQ.isLoading && presets.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <Palette className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p>暂无文风预设</p>
          <p className="text-xs mt-1">你可以在「素材知识库」中蒸馏文风后再来配置</p>
        </div>
      )}

      {presets.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
          {presets.map((p: any) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedPresetId(selectedPresetId === p.id ? null : p.id)}
              className={cn(
                'rounded-xl border p-3 text-left transition-colors',
                selectedPresetId === p.id
                  ? 'border-gold-500/60 bg-gold-500/5'
                  : 'border-gray-700 bg-gray-900/40 hover:border-gray-600'
              )}
            >
              <div className="flex items-center gap-2">
                <Palette className={cn('h-4 w-4 shrink-0', selectedPresetId === p.id ? 'text-gold-400' : 'text-gray-500')} />
                <span className="text-sm font-medium text-gray-200 truncate">{p.style_name}</span>
              </div>
              {p.author && <div className="text-xs text-gray-500 mt-1 ml-6">作者: {p.author}</div>}
              {p.summary && <div className="text-xs text-gray-600 mt-1 ml-6 line-clamp-2">{p.summary}</div>}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onSkip} className="flex-1">跳过，使用默认文风</Button>
        <Button onClick={() => applyM.mutate()} className="flex-1" loading={applyM.isPending}>
          {selectedPresetId ? '应用并继续' : '跳过并继续'}
        </Button>
      </div>
    </div>
  )
}

// ─── Step 5: 搭建大纲 ────────────────────────────────────────────

function StepOutline({ projectId, onNext, onSkip }: { projectId: number; onNext: () => void; onSkip: () => void }) {
  const { toast } = useToast()
  const [volumeTitle, setVolumeTitle] = useState('第一卷')
  const [synopsis, setSynopsis] = useState('')
  const [chapterCount, setChapterCount] = useState(10)

  const createM = useMutation({
    mutationFn: () =>
      outlinesApi.create(String(projectId), {
        volumeNo: 1,
        title: volumeTitle.trim() || '第一卷',
        synopsis: synopsis.trim() || undefined,
        chapterPlans: Array.from({ length: chapterCount }, (_, i) => ({
          chapterNo: i + 1,
          title: `第${i + 1}章`,
          summary: '',
        })),
      }),
    onSuccess: () => {
      toast('大纲创建成功', 'success')
      onNext()
    },
    onError: (e: Error) => toast(`创建失败: ${e.message}`, 'error'),
  })

  const generateM = useMutation({
    mutationFn: () =>
      outlinesApi.generate(String(projectId), {
        mode: 'one-shot',
        volumeNo: 1,
        title: volumeTitle.trim() || '第一卷',
        stylePreset: undefined,
      }),
    onSuccess: (r: any) => {
      toast(`AI 大纲生成完成：${r.volumes?.length || r.createdPlanCount || 0} 章`, 'success')
      onNext()
    },
    onError: (e: Error) => toast(`生成失败: ${e.message}`, 'error'),
  })

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-gray-100">搭建第一卷大纲</h2>
        <p className="text-sm text-gray-500 mt-1">AI 可自动生成大纲，你也可以先跳过，后续在「大纲」页深度编排</p>
      </div>

      <Input
        label="卷名"
        placeholder="第一卷"
        value={volumeTitle}
        onChange={(e) => setVolumeTitle(e.target.value)}
      />

      <Textarea
        label="卷概要（可选，AI 生成时作为方向提示）"
        placeholder="如：平凡少年意外获得修仙功法，踏上修仙之路..."
        rows={3}
        value={synopsis}
        onChange={(e) => setSynopsis(e.target.value)}
      />

      <Select
        label="预估章节数"
        value={String(chapterCount)}
        onChange={(e) => setChapterCount(Number(e.target.value))}
        options={[
          { value: '5', label: '5 章（试水）' },
          { value: '10', label: '10 章（短卷）' },
          { value: '20', label: '20 章（中卷）' },
          { value: '30', label: '30 章（长卷）' },
        ]}
      />

      <div className="space-y-3 pt-2">
        <Button
          onClick={() => generateM.mutate()}
          className="w-full"
          loading={generateM.isPending}
          variant="gold"
        >
          <Sparkles className="h-4 w-4" />AI 智能生成大纲
        </Button>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onSkip} className="flex-1">跳过</Button>
          <Button variant="outline" onClick={() => createM.mutate()} className="flex-1" loading={createM.isPending}>
            仅创建空大纲
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Step 6: 完成 ────────────────────────────────────────────────

function StepFinish({ projectId }: { projectId: number }) {
  const navigate = useNavigate()
  const setCurrentProject = useSetCurrentProject()

  const handleStart = useCallback(() => {
    setCurrentProject(String(projectId))
    navigate('/')
  }, [projectId, navigate, setCurrentProject])

  return (
    <div className="max-w-lg mx-auto text-center space-y-6 py-8">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gold-500/10 ring-1 ring-gold-400/30">
        <Rocket className="h-8 w-8 text-gold-400" />
      </div>

      <div>
        <h2 className="text-xl font-semibold text-gray-100">一切就绪，开始写作吧</h2>
        <p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto">
          你的项目已配置好。现在可以进入仪表盘，在「大纲」页查看你的章节计划，在「生成」页启动 AI 写作。
        </p>
      </div>

      {/* Quick action cards */}
      <div className="grid grid-cols-2 gap-3 text-left">
        <button
          type="button"
          onClick={() => { setCurrentProject(String(projectId)); navigate('/outlines') }}
          className="rounded-xl border border-gray-700 bg-gray-900/40 p-4 hover:border-gold-500/40 transition-colors"
        >
          <ListTree className="h-5 w-5 text-gold-400 mb-2" />
          <div className="text-sm font-medium text-gray-200">编排大纲</div>
          <div className="text-xs text-gray-500 mt-1">细调章节计划与场景脚本</div>
        </button>

        <button
          type="button"
          onClick={() => { setCurrentProject(String(projectId)); navigate('/generation') }}
          className="rounded-xl border border-gray-700 bg-gray-900/40 p-4 hover:border-gold-500/40 transition-colors"
        >
          <Sparkles className="h-5 w-5 text-gold-400 mb-2" />
          <div className="text-sm font-medium text-gray-200">开始生成</div>
          <div className="text-xs text-gray-500 mt-1">启动 AI 多智能体写作管线</div>
        </button>
      </div>

      <Button onClick={handleStart} variant="gold" size="lg" className="w-full">
        进入仪表盘
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

// ─── 主导出组件 ──────────────────────────────────────────────────

export default function ProjectWizard() {
  const [step, setStep] = useState<StepKey>('project')
  const [projectId, setProjectId] = useState<number | null>(null)

  const goNext = (nextStep: StepKey) => setStep(nextStep)
  const goSkip = () => {
    const idx = STEPS.findIndex((s) => s.key === step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].key)
  }

  const handleProjectCreated = (pid: number) => {
    setProjectId(pid)
    setStep('protagonist')
  }

  const currentStep = STEPS.find((s) => s.key === step)!

  return (
    <div className="min-h-screen bg-gray-950 flex items-start justify-center pt-12 px-4">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-gold-200 tracking-wide">新书引导向导</h1>
          <p className="text-sm text-gray-500 mt-1">6 步完成创作准备，每步可跳过，随时可返回修改</p>
        </div>

        {/* Progress */}
        <StepTracker current={step} />

        {/* Step content */}
        <Card className="p-6">
          {step === 'project' && (
            <StepProject
              onNext={handleProjectCreated}
              onSkip={() => setStep('protagonist')}
            />
          )}

          {step === 'protagonist' && projectId && (
            <StepProtagonist
              projectId={projectId}
              onNext={() => setStep('materials')}
              onSkip={() => setStep('materials')}
            />
          )}

          {step === 'materials' && projectId && (
            <StepMaterials
              projectId={projectId}
              onNext={() => setStep('style')}
              onSkip={() => setStep('style')}
            />
          )}

          {step === 'style' && projectId && (
            <StepStyle
              projectId={projectId}
              onNext={() => setStep('outline')}
              onSkip={() => setStep('outline')}
            />
          )}

          {step === 'outline' && projectId && (
            <StepOutline
              projectId={projectId}
              onNext={() => setStep('finish')}
              onSkip={() => setStep('finish')}
            />
          )}

          {step === 'finish' && projectId && (
            <StepFinish projectId={projectId} />
          )}

          {step !== 'project' && step !== 'finish' && !projectId && (
            <div className="text-center py-8 text-gray-500">
              <Spinner />
              <p className="mt-2">加载中...</p>
            </div>
          )}
        </Card>

        {/* Step indicator (mobile-friendly) */}
        <div className="text-center mt-4 text-xs text-gray-600">
          步骤 {STEPS.findIndex((s) => s.key === step) + 1} / {STEPS.length} — {currentStep.label}
        </div>
      </div>
    </div>
  )
}
