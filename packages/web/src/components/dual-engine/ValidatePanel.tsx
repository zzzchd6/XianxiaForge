/**
 * 场景D：质量体检面板（PRD v1.3 §10.1.5）
 * - 粘贴已写好的对话/冲突戏文 → 独立校验打分
 * - dialogue：解析「角色名："台词"（行为）」格式，冰山四维评分
 * - conflict：需提供冲突配置 JSON，冲突四维评分 + 情绪曲线
 * - compose：交叉校验五维（LLM 打分）
 */
import { useState } from 'react'
import { Stethoscope } from 'lucide-react'
import { Button, Textarea, Select, Badge, Spinner, useToast } from '../ui'
import { dualEngineApi } from '../../lib/api'
import { QualityReportView, EmotionCurveView, Collapse } from './shared'

const MODULE_OPTIONS = [
  { value: 'dialogue', label: '对话体检（冰山四维，规则打分）' },
  { value: 'conflict', label: '冲突戏体检（冲突四维，需配置）' },
  { value: 'compose', label: '整场戏交叉校验（五维，LLM打分）' },
]

const PLACEHOLDERS: Record<string, string> = {
  dialogue: '每行一条，格式：角色名："台词"（行为描写）\n例：\n沈青梧："这点伤算什么。（指尖在袖中悄悄掐诀压住颤抖）"\n顾长风："师姐好好歇着。（目光避开她袖口的血迹）"',
  conflict: '按「欲望段 / 阻力段 / 代价段」用空行分隔粘贴，并在下方提供冲突配置 JSON',
  compose: '粘贴完整的一场戏（冲突+台词整合稿），并在下方提供冲突配置 JSON',
}

const CONFLICT_CONFIG_EXAMPLE = `{
  "protagonist": { "name": "沈青梧", "identity": "落霞峰首席弟子" },
  "desire": { "target": "夺得筑基丹名额", "why_it_matters": "妹妹的解药全靠它" },
  "resistance": { "source": "执法堂长老当众发难", "type": "humiliation", "precision": "high" },
  "cost": { "what_is_lost": "暴露底牌被执法堂盯上", "irreversibility": "irreversible", "emotional_weight": 4 },
  "scene_setting": "演武场·宗门大比决赛"
}`

export default function ValidatePanel() {
  const { toast } = useToast()
  const [module, setModule] = useState('dialogue')
  const [content, setContent] = useState('')
  const [configJson, setConfigJson] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any | null>(null)

  const handleValidate = async () => {
    if (!content.trim()) { toast('请粘贴待体检的文本', 'error'); return }
    let config: any
    if (configJson.trim()) {
      try {
        config = JSON.parse(configJson)
      } catch {
        toast('配置 JSON 格式错误，请检查', 'error')
        return
      }
    }
    if (module !== 'dialogue' && !config) {
      toast('conflict / compose 模块必须提供冲突配置 JSON', 'error')
      return
    }
    setLoading(true)
    try {
      const data = await dualEngineApi.validate(module, content.trim(), config)
      setResult(data)
      toast('体检完成', 'success')
    } catch (e: any) {
      toast(e.message || '体检失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]">
      {/* 左侧：输入 */}
      <div className="space-y-4">
        <Select label="体检模块" options={MODULE_OPTIONS} value={module} onChange={(e) => { setModule(e.target.value); setResult(null) }} />
        <Textarea
          label="待体检文本"
          rows={10}
          placeholder={PLACEHOLDERS[module]}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <Textarea
          label={module === 'dialogue' ? '冰山配置 JSON（可选，提供角色 true_intent 可启用偏差度维度）' : '冲突配置 JSON（必填）'}
          rows={8}
          className="font-mono text-xs"
          placeholder={CONFLICT_CONFIG_EXAMPLE}
          value={configJson}
          onChange={(e) => setConfigJson(e.target.value)}
        />
        {module === 'dialogue' && (
          <p className="text-[11px] text-gray-600">
            提示：对话体检缺省只做规则维度打分；提供冰山配置 JSON（角色带 true_intent）可额外启用「偏差度」语义维度。
          </p>
        )}
        <Button variant="gold" className="w-full" onClick={handleValidate} disabled={loading}>
          {loading ? <Spinner className="mr-2 h-4 w-4" label="体检中" /> : <Stethoscope className="mr-2 h-4 w-4" />}
          {loading ? '体检中…' : '开始质量体检'}
        </Button>
      </div>

      {/* 右侧：报告 */}
      <div className="space-y-3">
        {!result && !loading && (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-gray-700 text-sm text-gray-500">
            粘贴已有文本，体检后给出分维度评分与优化建议
          </div>
        )}
        {loading && (
          <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 rounded-lg border border-gray-700 bg-gray-900/40">
            <Spinner className="h-6 w-6" label="体检中" />
            <span className="text-sm text-gray-400">
              {module === 'compose' ? 'LLM 五维交叉校验中，约需 20-40 秒…' : '规则打分中…'}
            </span>
          </div>
        )}
        {result && (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="seal">模块：{result.module}</Badge>
              {result.parsed_lines != null && <Badge>解析出 {result.parsed_lines} 条对话</Badge>}
            </div>
            {result.quality_score && (
              <Collapse title="体检报告" defaultOpen>
                <QualityReportView report={result.quality_score} />
              </Collapse>
            )}
            {result.emotion_curve && (
              <Collapse title="情绪曲线" defaultOpen>
                <EmotionCurveView curve={result.emotion_curve} />
              </Collapse>
            )}
          </>
        )}
      </div>
    </div>
  )
}
