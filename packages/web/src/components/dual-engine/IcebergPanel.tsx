/**
 * 场景A：三层冰山台词面板（PRD v1.3 §7）
 * - 配置表单：场景/冲突背景/角色列表/掩饰策略/对话长度
 * - 三层折叠展示：真相层（只供作者看）/ 表面层（台词）/ 行为层（锚点动作）
 * - 分步重生成：重生真相层（连带后两步）/ 重生表面层（连带行为层）/ 重生行为层
 * - 质量四维评分 + 优化建议
 */
import { useState } from 'react'
import { Sparkles, RefreshCw, Copy, Trash2, Plus } from 'lucide-react'
import { Button, Input, Textarea, Select, Badge, Spinner, useToast } from '../ui'
import { dualEngineApi } from '../../lib/api'
import { useCurrentProjectId } from '../../hooks/useCurrentProject'
import { cn } from '../../lib/utils'
import { QualityReportView, SuggestionList, Collapse } from './shared'

interface CharacterForm {
  name: string
  identity: string
  relationship: string
}

const DISGUISE_OPTIONS = [
  { value: 'auto', label: '自动选择' },
  { value: 'irony', label: '反语（说反话）' },
  { value: 'diversion', label: '转移话题' },
  { value: 'politeness', label: '客套疏离' },
  { value: 'understatement', label: '轻描淡写' },
]

const LENGTH_OPTIONS = [
  { value: 'short', label: '短（4-6轮）' },
  { value: 'medium', label: '中（8-12轮）' },
  { value: 'long', label: '长（14-20轮）' },
]

export default function IcebergPanel() {
  const projectId = useCurrentProjectId()
  const { toast } = useToast()

  const [scene, setScene] = useState('')
  const [conflictContext, setConflictContext] = useState('')
  const [disguise, setDisguise] = useState('auto')
  const [length, setLength] = useState('medium')
  const [characters, setCharacters] = useState<CharacterForm[]>([
    { name: '', identity: '', relationship: '' },
    { name: '', identity: '', relationship: '' },
  ])

  const [loading, setLoading] = useState(false)
  const [regenStep, setRegenStep] = useState<string | null>(null)
  const [result, setResult] = useState<any | null>(null)

  const updateCharacter = (idx: number, patch: Partial<CharacterForm>) =>
    setCharacters((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)))

  const buildConfig = () => ({
    scene: scene.trim(),
    conflict_context: conflictContext.trim(),
    disguise_strategy: disguise,
    dialogue_length: length,
    characters: characters
      .filter((c) => c.name.trim() && c.identity.trim())
      .map((c) => ({
        name: c.name.trim(),
        identity: c.identity.trim(),
        ...(c.relationship.trim() ? { relationship: c.relationship.trim() } : {}),
      })),
  })

  const handleGenerate = async () => {
    const config = buildConfig()
    if (!config.scene || !config.conflict_context || config.characters.length < 1) {
      toast('请填写场景、冲突背景，并至少填写一个角色的姓名与身份', 'error')
      return
    }
    setLoading(true)
    try {
      const data = await dualEngineApi.generateIceberg(projectId, config)
      setResult(data)
      toast('冰山台词生成完成', 'success')
    } catch (e: any) {
      toast(e.message || '生成失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleRegenerate = async (step: string) => {
    if (!result?.request_id) return
    setRegenStep(step)
    try {
      const data = await dualEngineApi.regenerateIceberg(result.request_id, step)
      setResult(data)
      toast('分步重生成完成', 'success')
    } catch (e: any) {
      toast(e.message || '重生成失败', 'error')
    } finally {
      setRegenStep(null)
    }
  }

  const handleCopy = async () => {
    if (!result?.full_dialogue) return
    await navigator.clipboard.writeText(result.full_dialogue)
    toast('完整对话已复制', 'success')
  }

  const busy = loading || regenStep !== null

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* 左侧：配置表单 */}
      <div className="space-y-4">
        <Textarea
          label="场景描述"
          rows={3}
          placeholder="例：落霞峰后山月夜，师姐重伤昏迷，主角替她护法，仇家搜山逼近"
          value={scene}
          onChange={(e) => setScene(e.target.value)}
        />
        <Textarea
          label="冲突背景（角色间未说破的矛盾）"
          rows={3}
          placeholder="例：主角隐瞒了自己以寿元换丹药救师姐的事实；师姐察觉却不敢问"
          value={conflictContext}
          onChange={(e) => setConflictContext(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select label="掩饰策略" options={DISGUISE_OPTIONS} value={disguise} onChange={(e) => setDisguise(e.target.value)} />
          <Select label="对话长度" options={LENGTH_OPTIONS} value={length} onChange={(e) => setLength(e.target.value)} />
        </div>

        {/* 角色列表 */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-300">登场角色（{characters.length}）</span>
            <Button
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setCharacters((prev) => [...prev, { name: '', identity: '', relationship: '' }])}
              disabled={characters.length >= 10}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />添加角色
            </Button>
          </div>
          <div className="space-y-3">
            {characters.map((c, idx) => (
              <div key={idx} className="rounded-lg border border-gray-700/70 bg-gray-900/50 p-3">
                <div className="grid grid-cols-[1fr_2fr_auto] items-end gap-2">
                  <Input label={idx === 0 ? '姓名' : undefined} placeholder="姓名" value={c.name} onChange={(e) => updateCharacter(idx, { name: e.target.value })} />
                  <Input label={idx === 0 ? '身份' : undefined} placeholder="身份，例：落霞峰首席弟子" value={c.identity} onChange={(e) => updateCharacter(idx, { identity: e.target.value })} />
                  <Button
                    variant="ghost"
                    className="h-9 w-9 p-0 text-gray-500 hover:text-red-400"
                    onClick={() => setCharacters((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={characters.length <= 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Input className="mt-2" placeholder="与其他角色的关系（可选）" value={c.relationship} onChange={(e) => updateCharacter(idx, { relationship: e.target.value })} />
              </div>
            ))}
          </div>
        </div>

        <Button variant="gold" className="w-full" onClick={handleGenerate} disabled={busy}>
          {loading ? <Spinner className="mr-2 h-4 w-4" label="生成中" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {loading ? '三步生成中（真相→表面→行为）…' : '生成冰山台词'}
        </Button>
      </div>

      {/* 右侧：结果展示 */}
      <div className="space-y-3">
        {!result && !busy && (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-gray-700 text-sm text-gray-500">
            填写左侧配置后点击「生成冰山台词」
            <span className="mt-1 text-xs text-gray-600">真相层只给你看，表面层+行为层才是正文</span>
          </div>
        )}
        {busy && !result && (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 rounded-lg border border-gray-700 bg-gray-900/40">
            <Spinner className="h-6 w-6" label="生成中" />
            <span className="text-sm text-gray-400">正在生成三层冰山，约需 20-40 秒…</span>
          </div>
        )}
        {result && (
          <>
            {/* 操作栏 */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="seal">请求 #{result.request_id}</Badge>
              <Badge>{result.tokens_used ?? 0} tokens</Badge>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" className="h-8 px-2.5 text-xs" onClick={() => handleRegenerate('truth')} disabled={busy}>
                  <RefreshCw className={cn('mr-1 h-3.5 w-3.5', regenStep === 'truth' && 'animate-spin')} />
                  重生真相层
                </Button>
                <Button variant="outline" className="h-8 px-2.5 text-xs" onClick={() => handleRegenerate('surface')} disabled={busy}>
                  <RefreshCw className={cn('mr-1 h-3.5 w-3.5', regenStep === 'surface' && 'animate-spin')} />
                  重生表面层
                </Button>
                <Button variant="outline" className="h-8 px-2.5 text-xs" onClick={() => handleRegenerate('behavior')} disabled={busy}>
                  <RefreshCw className={cn('mr-1 h-3.5 w-3.5', regenStep === 'behavior' && 'animate-spin')} />
                  重生行为层
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-gray-600">联动规则：重生真相层会连带重建表面层与行为层；重生表面层会连带重建行为层。</p>

            {/* 真相层 */}
            <Collapse title="第一层·真相（作者专属，不进正文）" defaultOpen badge={<Badge variant="seal">真实意图</Badge>}>
              <div className="space-y-2">
                {(result.truth_layer?.characters || []).map((ch: any) => (
                  <div key={ch.name} className="rounded-md bg-gray-950/60 p-2.5 text-sm">
                    <div className="font-medium text-gold-300">{ch.name}</div>
                    <div className="mt-1 space-y-0.5 text-xs leading-relaxed text-gray-300">
                      <div><span className="text-gray-500">真实意图：</span>{ch.true_intent}</div>
                      <div><span className="text-gray-500">真实情绪：</span>{ch.true_emotion}</div>
                      {ch.core_tension && <div><span className="text-gray-500">核心张力：</span>{ch.core_tension}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </Collapse>

            {/* 表面层 */}
            <Collapse title="第二层·表面台词（说出口的话）" defaultOpen>
              <div className="space-y-1.5">
                {(result.surface_layer || []).map((l: any, i: number) => (
                  <div key={i} className="text-sm leading-relaxed text-gray-200">
                    <span className="font-medium text-gold-300">{l.speaker}：</span>
                    <span className="text-gray-300">「{l.line}」</span>
                  </div>
                ))}
              </div>
            </Collapse>

            {/* 行为层 */}
            <Collapse title="第三层·行为锚点（泄露真相的小动作）" defaultOpen>
              <div className="space-y-1.5">
                {(result.behavior_layer || []).map((l: any, i: number) => (
                  <div key={i} className="text-sm leading-relaxed">
                    <span className="font-medium text-gold-300">{l.speaker}：</span>
                    <span className="text-gray-400">{l.action}</span>
                  </div>
                ))}
              </div>
            </Collapse>

            {/* 完整对话 */}
            <Collapse
              title="整合后的完整对话"
              defaultOpen
              badge={
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); handleCopy(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleCopy(); } }}
                  className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-xs text-gray-400 transition-colors hover:text-gold-300"
                >
                  <Copy className="h-3 w-3" />复制
                </span>
              }
            >
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-950/60 p-3 text-sm leading-relaxed text-gray-200">
                {result.full_dialogue}
              </pre>
            </Collapse>

            {/* 质量评分 */}
            {result.quality_score && (
              <Collapse title="质量体检（冰山四维）" badge={<Badge variant={result.quality_score.passed ? 'success' : 'destructive'}>{Math.round(result.quality_score.total)} 分</Badge>}>
                <div className="space-y-3">
                  <QualityReportView report={result.quality_score} />
                  <SuggestionList suggestions={result.suggestions} />
                </div>
              </Collapse>
            )}
          </>
        )}
      </div>
    </div>
  )
}
