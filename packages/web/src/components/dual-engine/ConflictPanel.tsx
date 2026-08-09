/**
 * 场景B：冲突生成器面板（PRD v1.3 §8）
 * - 配置表单：主角/渴望/阻力/代价/场景（支持场景C大纲预填 initialDraft）
 * - 三阶段结果：欲望蓄势 → 阻力碾压 → 代价落地 + 完整戏文
 * - 情绪曲线四项指标 + 质量四维 + 分步重生成
 * - 组合成戏：调用 §9 组合工作流（冲突+冰山台词一体化）
 */
import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw, Copy, Layers } from 'lucide-react'
import { Button, Input, Textarea, Select, Badge, Spinner, useToast } from '../ui'
import { dualEngineApi } from '../../lib/api'
import { useCurrentProjectId } from '../../hooks/useCurrentProject'
import { cn } from '../../lib/utils'
import { QualityReportView, EmotionCurveView, CrossValidationView, SuggestionList, Collapse } from './shared'

const RESISTANCE_TYPE_OPTIONS = [
  { value: 'rejection', label: '拒绝（想被接纳而不得）' },
  { value: 'humiliation', label: '羞辱（当众折辱尊严）' },
  { value: 'negation_of_effort', label: '否定努力（心血归零）' },
  { value: 'negation_of_desire', label: '否定渴望（你根本不配想要）' },
  { value: 'physical', label: '物理压制（实力碾压）' },
]

const PRECISION_OPTIONS = [
  { value: 'auto', label: '自动（按欲望类型匹配七寸）' },
  { value: 'high', label: '高精准（直戳最痛处）' },
  { value: 'medium', label: '中精准' },
  { value: 'low', label: '低精准' },
]

const IRREVERSIBILITY_OPTIONS = [
  { value: 'reversible', label: '可逆（能弥补）' },
  { value: 'partially_reversible', label: '部分可逆' },
  { value: 'irreversible', label: '不可逆（永远失去）' },
  { value: 'existential', label: '存在性（动摇道心/自我）' },
]

const DESIRE_TYPE_OPTIONS = [
  { value: '', label: '自动推断' },
  { value: 'power', label: '力量' },
  { value: 'dignity', label: '尊严' },
  { value: 'protection', label: '守护' },
  { value: 'revenge', label: '复仇' },
  { value: 'freedom', label: '自由' },
  { value: 'promise', label: '承诺' },
]

export interface ConflictDraftLike {
  source: { chapterPlanId: number; sceneNodeId?: number }
  config: any
  missing: string[]
}

export default function ConflictPanel({ initialDraft }: { initialDraft?: ConflictDraftLike | null }) {
  const projectId = useCurrentProjectId()
  const { toast } = useToast()

  // 主角
  const [pName, setPName] = useState('')
  const [pIdentity, setPIdentity] = useState('')
  const [pStatus, setPStatus] = useState('')
  // 渴望
  const [desireTarget, setDesireTarget] = useState('')
  const [desireWhy, setDesireWhy] = useState('')
  const [desireType, setDesireType] = useState('')
  // 阻力
  const [resSource, setResSource] = useState('')
  const [resType, setResType] = useState('negation_of_effort')
  const [resPrecision, setResPrecision] = useState('auto')
  // 代价
  const [costLost, setCostLost] = useState('')
  const [costIrrev, setCostIrrev] = useState('partially_reversible')
  const [costWeight, setCostWeight] = useState(3)
  // 场景
  const [sceneSetting, setSceneSetting] = useState('')

  const [draftNotice, setDraftNotice] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [regenStep, setRegenStep] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [result, setResult] = useState<any | null>(null)
  const [composeResult, setComposeResult] = useState<any | null>(null)

  // 场景C预填
  useEffect(() => {
    if (!initialDraft) return
    const cfg = initialDraft.config || {}
    if (cfg.protagonist?.name) setPName(cfg.protagonist.name)
    if (cfg.protagonist?.identity) setPIdentity(cfg.protagonist.identity)
    if (cfg.desire?.target) setDesireTarget(cfg.desire.target)
    if (cfg.desire?.why_it_matters) setDesireWhy(cfg.desire.why_it_matters)
    if (cfg.resistance?.source) setResSource(cfg.resistance.source)
    if (cfg.resistance?.type) setResType(cfg.resistance.type)
    if (cfg.resistance?.precision) setResPrecision(cfg.resistance.precision)
    if (cfg.cost?.what_is_lost) setCostLost(cfg.cost.what_is_lost)
    if (cfg.cost?.irreversibility) setCostIrrev(cfg.cost.irreversibility)
    if (cfg.cost?.emotional_weight) setCostWeight(cfg.cost.emotional_weight)
    if (cfg.scene_setting) setSceneSetting(cfg.scene_setting)
    setDraftNotice(initialDraft.missing || [])
  }, [initialDraft])

  const buildConfig = () => ({
    protagonist: {
      name: pName.trim(),
      identity: pIdentity.trim(),
      ...(pStatus.trim() ? { current_status: pStatus.trim() } : {}),
    },
    desire: {
      target: desireTarget.trim(),
      why_it_matters: desireWhy.trim(),
      ...(desireType ? { desire_type: desireType } : {}),
    },
    resistance: { source: resSource.trim(), type: resType, precision: resPrecision },
    cost: { what_is_lost: costLost.trim(), irreversibility: costIrrev, emotional_weight: costWeight },
    scene_setting: sceneSetting.trim(),
  })

  const checkRequired = () => {
    if (!pName.trim() || !pIdentity.trim()) return '请填写主角姓名与身份'
    if (!desireTarget.trim() || !desireWhy.trim()) return '请填写具体渴望与为什么在乎'
    if (!resSource.trim()) return '请填写阻力来源'
    if (!costLost.trim()) return '请填写代价（失去什么）'
    if (!sceneSetting.trim()) return '请填写场景设定'
    return null
  }

  const handleGenerate = async () => {
    const err = checkRequired()
    if (err) { toast(err, 'error'); return }
    setLoading(true)
    setComposeResult(null)
    try {
      const data = await dualEngineApi.generateConflict(projectId, buildConfig())
      setResult(data)
      toast('冲突三阶段生成完成', 'success')
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
      const data = await dualEngineApi.regenerateConflict(result.request_id, step)
      setResult(data)
      toast('分阶段重生成完成', 'success')
    } catch (e: any) {
      toast(e.message || '重生成失败', 'error')
    } finally {
      setRegenStep(null)
    }
  }

  const handleCompose = async () => {
    const err = checkRequired()
    if (err) { toast(err, 'error'); return }
    setComposing(true)
    try {
      const data = await dualEngineApi.composeConflict(projectId, { conflict_config: buildConfig() })
      setComposeResult(data)
      if (data.cross_validation?.passed) toast('组合成戏完成，交叉校验通过', 'success')
      else toast('组合完成，但交叉校验未通过，请查看失败项', 'info')
    } catch (e: any) {
      toast(e.message || '组合生成失败', 'error')
    } finally {
      setComposing(false)
    }
  }

  const handleCopyCompose = async () => {
    if (!composeResult?.full_text) return
    await navigator.clipboard.writeText(composeResult.full_text)
    toast('完整戏文已复制', 'success')
  }

  const busy = loading || regenStep !== null || composing

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* 左侧：冲突三要素表单 */}
      <div className="space-y-4">
        {draftNotice.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-3">
            <div className="text-xs font-semibold text-amber-300">已从大纲预填，以下内容需手动补齐：</div>
            <ul className="mt-1 space-y-0.5">
              {draftNotice.map((m, i) => <li key={i} className="text-xs text-gray-400">· {m}</li>)}
            </ul>
          </div>
        )}

        <div className="rounded-lg border border-gray-700/70 bg-gray-900/50 p-3">
          <div className="mb-2 text-xs font-semibold tracking-wide text-gold-300">主角</div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="姓名" value={pName} onChange={(e) => setPName(e.target.value)} />
            <Input placeholder="身份，例：外门杂役弟子" value={pIdentity} onChange={(e) => setPIdentity(e.target.value)} />
          </div>
          <Input className="mt-2" placeholder="当前处境（可选），例：灵根被废，贬为洒扫" value={pStatus} onChange={(e) => setPStatus(e.target.value)} />
        </div>

        <div className="rounded-lg border border-gray-700/70 bg-gray-900/50 p-3">
          <div className="mb-2 text-xs font-semibold tracking-wide text-gold-300">渴望（要具体，不要抽象）</div>
          <Textarea rows={2} placeholder="他此刻最想得到什么？例：在宗门大比赢下赵玄，拿到筑基丹名额" value={desireTarget} onChange={(e) => setDesireTarget(e.target.value)} />
          <Textarea className="mt-2" rows={2} placeholder="为什么在乎？得不到会怎样？例：输了就要替赵玄试药，妹妹的解药再无着落" value={desireWhy} onChange={(e) => setDesireWhy(e.target.value)} />
          <Select className="mt-2" options={DESIRE_TYPE_OPTIONS} value={desireType} onChange={(e) => setDesireType(e.target.value)} />
        </div>

        <div className="rounded-lg border border-gray-700/70 bg-gray-900/50 p-3">
          <div className="mb-2 text-xs font-semibold tracking-wide text-gold-300">阻力（谁/什么在拦他）</div>
          <Textarea rows={2} placeholder="阻力来源，例：赵玄背后是执法堂长老，当众发难" value={resSource} onChange={(e) => setResSource(e.target.value)} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Select options={RESISTANCE_TYPE_OPTIONS} value={resType} onChange={(e) => setResType(e.target.value)} />
            <Select options={PRECISION_OPTIONS} value={resPrecision} onChange={(e) => setResPrecision(e.target.value)} />
          </div>
        </div>

        <div className="rounded-lg border border-gray-700/70 bg-gray-900/50 p-3">
          <div className="mb-2 text-xs font-semibold tracking-wide text-gold-300">代价（爽点的账要还）</div>
          <Textarea rows={2} placeholder="最终失去什么？例：赢了比试，却暴露底牌，被执法堂盯上" value={costLost} onChange={(e) => setCostLost(e.target.value)} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Select options={IRREVERSIBILITY_OPTIONS} value={costIrrev} onChange={(e) => setCostIrrev(e.target.value)} />
            <Select
              options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `情感重量 ${n} 分` }))}
              value={String(costWeight)}
              onChange={(e) => setCostWeight(Number(e.target.value))}
            />
          </div>
        </div>

        <Textarea label="场景设定" rows={2} placeholder="例：演武场·宗门大比决赛，万人围观" value={sceneSetting} onChange={(e) => setSceneSetting(e.target.value)} />

        <div className="grid grid-cols-2 gap-3">
          <Button variant="gold" onClick={handleGenerate} disabled={busy}>
            {loading ? <Spinner className="mr-2 h-4 w-4" label="生成中" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {loading ? '三阶段生成中…' : '生成冲突三阶段'}
          </Button>
          <Button variant="outline" onClick={handleCompose} disabled={busy}>
            {composing ? <Spinner className="mr-2 h-4 w-4" label="组合中" /> : <Layers className="mr-2 h-4 w-4" />}
            {composing ? '组合编排中…' : '组合成戏（含台词）'}
          </Button>
        </div>
      </div>

      {/* 右侧：结果展示 */}
      <div className="space-y-3">
        {!result && !composeResult && !busy && (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-gray-700 text-sm text-gray-500">
            填写左侧冲突三要素后点击「生成冲突三阶段」
            <span className="mt-1 text-xs text-gray-600">欲望蓄势 → 阻力碾压 → 代价落地，期待与憋屈拉满</span>
          </div>
        )}
        {busy && !result && !composeResult && (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 rounded-lg border border-gray-700 bg-gray-900/40">
            <Spinner className="h-6 w-6" label="生成中" />
            <span className="text-sm text-gray-400">正在生成冲突三阶段，约需 30-60 秒…</span>
          </div>
        )}

        {result && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="seal">请求 #{result.request_id}</Badge>
              {result.resolved_desire_type && <Badge>欲望类型：{result.resolved_desire_type}</Badge>}
              <Badge>{result.tokens_used ?? 0} tokens</Badge>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" className="h-8 px-2.5 text-xs" onClick={() => handleRegenerate('desire')} disabled={busy}>
                  <RefreshCw className={cn('mr-1 h-3.5 w-3.5', regenStep === 'desire' && 'animate-spin')} />重生欲望
                </Button>
                <Button variant="outline" className="h-8 px-2.5 text-xs" onClick={() => handleRegenerate('resistance')} disabled={busy}>
                  <RefreshCw className={cn('mr-1 h-3.5 w-3.5', regenStep === 'resistance' && 'animate-spin')} />重生阻力
                </Button>
                <Button variant="outline" className="h-8 px-2.5 text-xs" onClick={() => handleRegenerate('cost')} disabled={busy}>
                  <RefreshCw className={cn('mr-1 h-3.5 w-3.5', regenStep === 'cost' && 'animate-spin')} />重生代价
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-gray-600">联动规则：重生欲望会连带重建阻力与代价；重生阻力会连带重建代价。</p>

            {result.emotion_curve && <EmotionCurveView curve={result.emotion_curve} />}

            <Collapse title="Phase 1 · 欲望蓄势" defaultOpen>
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{result.desire_phase}</pre>
            </Collapse>
            <Collapse title="Phase 2 · 阻力碾压" defaultOpen>
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{result.resistance_phase}</pre>
            </Collapse>
            <Collapse title="Phase 3 · 代价落地" defaultOpen>
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{result.cost_phase}</pre>
            </Collapse>
            <Collapse title="完整戏文（三阶段拼接）">
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-950/60 p-3 text-sm leading-relaxed text-gray-200">{result.full_scene}</pre>
            </Collapse>

            {result.quality_score && (
              <Collapse title="质量体检（冲突四维）" badge={<Badge variant={result.quality_score.passed ? 'success' : 'destructive'}>{Math.round(result.quality_score.total)} 分</Badge>}>
                <div className="space-y-3">
                  <QualityReportView report={result.quality_score} />
                  <SuggestionList suggestions={result.suggestions} />
                </div>
              </Collapse>
            )}
          </>
        )}

        {composeResult && (
          <Collapse title="组合成戏成果（冲突 + 冰山台词一体化）" defaultOpen>
            <div className="space-y-3">
              {!composeResult.cross_validation?.passed && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/[0.05] p-3 text-xs text-red-300">
                  交叉校验未通过（重试已耗尽），以下为当前最优结果，建议人工微调后使用「质量体检」复检。
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">消耗 {composeResult.tokens_used ?? 0} tokens · 执行步骤：{(composeResult.executed_steps || []).join(' → ')}</span>
                <Button variant="ghost" className="h-7 px-2 text-xs" onClick={handleCopyCompose}>
                  <Copy className="mr-1 h-3 w-3" />复制全文
                </Button>
              </div>
              <pre className="max-h-[480px] overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-950/60 p-3 text-sm leading-relaxed text-gray-200">
                {composeResult.full_text}
              </pre>
              {composeResult.cross_validation && <CrossValidationView report={composeResult.cross_validation} />}
            </div>
          </Collapse>
        )}
      </div>
    </div>
  )
}
