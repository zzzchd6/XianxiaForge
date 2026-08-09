import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, Square, Sparkles, FileText, CheckCircle2, AlertTriangle, Database, ChevronDown, ListOrdered, Layers, SlidersHorizontal, RefreshCw, Trash2, ShieldCheck, Swords, MessagesSquare } from 'lucide-react'
import {
  Card, CardContent, CardHeader, CardTitle, Button, Badge, Input,
  Select, Spinner, EmptyState, Dialog, Switch, useToast,
} from '../components/ui'
import { useGenerationStream, GenerationPhase } from '../hooks/useGenerationStream'
import { generationApi, chaptersApi, projectsApi, debtGateApi, dualEngineApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import { cn } from '../lib/utils'

// 阶段显示配置
const phaseConfig: Record<GenerationPhase, { label: string; color: string }> = {
  idle: { label: '待命', color: 'text-gray-400' },
  queued: { label: '排队中', color: 'text-cyan-400' },
  context: { label: '编排上下文', color: 'text-blue-400' },
  writing: { label: '写作中', color: 'text-indigo-400' },
  auditing: { label: '审计中', color: 'text-amber-400' },
  revising: { label: '修订中', color: 'text-purple-400' },
  complete: { label: '已完成', color: 'text-emerald-400' },
  error: { label: '错误', color: 'text-red-400' },
}

// 章节计划状态配置（与后端 chapter_plan.status 对应）
const chapterStatusConfig: Record<string, { label: string; variant: 'default' | 'success' | 'warning' }> = {
  planned: { label: '待生成', variant: 'default' },
  writing: { label: '生成中', variant: 'warning' },
  generated: { label: '已生成', variant: 'success' },
  reviewed: { label: '已审', variant: 'default' },
  finalized: { label: '已定稿', variant: 'success' },
}

/* ------------------------------------------------------------------ */
/* 检索素材展示面板：本次生成从诛仙库拉取到的资料                       */
/* ------------------------------------------------------------------ */

/** 素材来源徽章：显式下发 / 自动关联 */
function SourceTag({ source }: { source: 'explicit' | 'auto' | null }) {
  if (source === 'explicit') {
    return <span className="ml-1.5 rounded bg-indigo-500/25 px-1 py-px text-[10px] leading-none text-indigo-200">显式</span>
  }
  if (source === 'auto') {
    return <span className="ml-1.5 rounded bg-emerald-500/25 px-1 py-px text-[10px] leading-none text-emerald-200">自动</span>
  }
  return null
}

function MaterialGroup({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={cn('mb-1.5 text-[11px] font-semibold uppercase tracking-wider', color)}>{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function RetrievedMaterialsPanel({ ctx }: { ctx: any }) {
  const [open, setOpen] = useState(true)
  if (!ctx) return null

  const counts = ctx.counts || {}
  const totalEntities =
    (counts.characters || 0) + (counts.factions || 0) + (counts.locations || 0) +
    (counts.skills || 0) + (counts.items || 0)

  // 判断某个实体来自"显式下发"还是"自动关联"
  const src = (explicit: any[] | undefined, auto: any[] | undefined, key: any): 'explicit' | 'auto' | null => {
    if (explicit?.includes(key)) return 'explicit'
    if (auto?.includes(key)) return 'auto'
    return null
  }

  const chipCls = 'inline-flex items-center rounded-md border px-2 py-1 text-xs'

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-sky-500/30 bg-sky-500/5">
      {/* 面板头部 */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2.5 transition-colors hover:bg-sky-500/10"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Database className="h-4 w-4 text-sky-300" />
          <span className="text-sm font-semibold text-sky-200">诛仙库检索素材</span>
          <span className="text-xs text-gray-500">
            {totalEntities} 个实体 · {counts.relations || 0} 条关系 · {counts.prevSummaries || 0} 段前文 · 约 {ctx.estimatedTokens ?? '—'} tokens
          </span>
        </div>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-gray-500 transition-transform', !open && '-rotate-90')} />
      </button>

      {open && (
        <div className="max-h-72 space-y-3 overflow-y-auto border-t border-sky-500/20 px-4 py-3">
          {totalEntities === 0 && (counts.relations || 0) === 0 && (
            <p className="text-xs text-gray-500">本次未检索到任何诛仙库素材（章节文本未命中实体，且未显式下发人物）。</p>
          )}

          {/* 人物 */}
          {(ctx.characters?.length ?? 0) > 0 && (
            <MaterialGroup label={`人物 · ${ctx.characters.length}`} color="text-emerald-300">
              {ctx.characters.map((c: any) => (
                <span key={c.id} className={cn(chipCls, 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100')}>
                  <span className="font-medium">{c.name}</span>
                  {[c.faction, c.realm].filter(Boolean).length > 0 && (
                    <span className="ml-1 text-emerald-300/60">{[c.faction, c.realm].filter(Boolean).join('·')}</span>
                  )}
                  <SourceTag source={src(ctx.explicit?.characters, ctx.autoLinked?.characters, c.id)} />
                </span>
              ))}
            </MaterialGroup>
          )}

          {/* 门派 */}
          {(ctx.factions?.length ?? 0) > 0 && (
            <MaterialGroup label={`门派 · ${ctx.factions.length}`} color="text-amber-300">
              {ctx.factions.map((f: any) => (
                <span key={f.id} className={cn(chipCls, 'border-amber-500/30 bg-amber-500/10 text-amber-100')}>
                  <span className="font-medium">{f.name}</span>
                  {f.camp && <span className="ml-1 text-amber-300/60">{f.camp}</span>}
                  <SourceTag source={src(ctx.explicit?.factions, ctx.autoLinked?.factions, f.id)} />
                </span>
              ))}
            </MaterialGroup>
          )}

          {/* 地点 */}
          {(ctx.locations?.length ?? 0) > 0 && (
            <MaterialGroup label={`地点 · ${ctx.locations.length}`} color="text-sky-300">
              {ctx.locations.map((l: any) => (
                <span key={l.id} className={cn(chipCls, 'border-sky-500/30 bg-sky-500/10 text-sky-100')}>
                  <span className="font-medium">{l.name}</span>
                  {l.level && <span className="ml-1 text-sky-300/60">{l.level}</span>}
                  <SourceTag source={src(ctx.explicit?.locations, ctx.autoLinked?.locations, l.name)} />
                </span>
              ))}
            </MaterialGroup>
          )}

          {/* 功法 */}
          {(ctx.skills?.length ?? 0) > 0 && (
            <MaterialGroup label={`功法 · ${ctx.skills.length}`} color="text-violet-300">
              {ctx.skills.map((s: any) => (
                <span key={s.id} className={cn(chipCls, 'border-violet-500/30 bg-violet-500/10 text-violet-100')}>
                  <span className="font-medium">{s.name}</span>
                  {s.grade && <span className="ml-1 text-violet-300/60">{s.grade}</span>}
                  <SourceTag source={src(ctx.explicit?.skills, ctx.autoLinked?.skills, s.id)} />
                </span>
              ))}
            </MaterialGroup>
          )}

          {/* 法宝 */}
          {(ctx.items?.length ?? 0) > 0 && (
            <MaterialGroup label={`法宝 · ${ctx.items.length}`} color="text-cyan-300">
              {ctx.items.map((it: any) => (
                <span key={it.id} className={cn(chipCls, 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100')}>
                  <span className="font-medium">{it.name}</span>
                  {it.grade && <span className="ml-1 text-cyan-300/60">{it.grade}</span>}
                  <SourceTag source={src(ctx.explicit?.items, ctx.autoLinked?.items, it.id)} />
                </span>
              ))}
            </MaterialGroup>
          )}

          {/* 人物关系 */}
          {(ctx.relations?.length ?? 0) > 0 && (
            <MaterialGroup label={`人物关系 · ${ctx.relations.length}`} color="text-indigo-300">
              {ctx.relations.map((r: any, i: number) => (
                <span key={i} className={cn(chipCls, 'border-indigo-500/30 bg-indigo-500/10 text-indigo-100')}>
                  <span className="font-medium">{r.charAName}</span>
                  <span className="mx-1 text-indigo-300/70">—{r.relType}→</span>
                  <span className="font-medium">{r.charBName}</span>
                </span>
              ))}
            </MaterialGroup>
          )}

          {/* 前文摘要 */}
          {(ctx.prevSummaries?.length ?? 0) > 0 && (
            <MaterialGroup label={`前文回顾 · ${ctx.prevSummaries.length}`} color="text-gray-400">
              {ctx.prevSummaries.map((s: string, i: number) => (
                <p key={i} className="w-full rounded-md border border-gray-700/60 bg-gray-900/60 px-2.5 py-1.5 text-xs leading-relaxed text-gray-400">
                  {s.length > 120 ? s.slice(0, 120) + '…' : s}
                </p>
              ))}
            </MaterialGroup>
          )}
        </div>
      )}
    </div>
  )
}

/** 项目级生成策略开关（v1.4 + 09-自动维护）：三节结构 / 角色声音 / 已知信息 / 实体库自动维护，存于 project.generationConfig */
function GenerationStrategyCard({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: !!projectId,
  })

  const genCfg = (project?.generationConfig || {}) as Record<string, any>
  const [whitelistOpen, setWhitelistOpen] = useState(false)
  // defaultOn=true 的开关未配置时视为开启（后端同样按缺省开启处理）
  const switches = [
    {
      key: 'debtGateEnabled',
      label: '毒句式欠账门',
      desc: '生成前检查上一章 blocking 级 AI 味（red评级/门禁critical·major），未清即拦截',
      defaultOn: true,
    },
    {
      key: 'threePartStructureEnabled',
      label: '三节结构',
      desc: '章节按开篇钩子25%/发展50%/收束钩子25%组织',
      defaultOn: false,
    },
    {
      key: 'characterVoiceEnabled',
      label: '角色声音注入',
      desc: '按人物声音配置（口头禅/语气/称呼）约束对白',
      defaultOn: false,
    },
    {
      key: 'characterKnowledgeEnabled',
      label: '已知信息清单',
      desc: '按人物已知信息写作，并启用第30维认知越界审计',
      defaultOn: false,
    },
    {
      key: 'autoExtractCustomEntities',
      label: '自动维护实体库',
      desc: '生成后自动识别新人物/武器/功法并建草稿，追踪已有人物动态',
      defaultOn: true,
    },
    {
      key: 'extractWeapons',
      label: '提取武器法宝',
      desc: '自动维护开启时，同步收录新出现的武器/法宝草稿',
      defaultOn: true,
    },
    {
      key: 'extractTechniques',
      label: '提取功法秘籍',
      desc: '自动维护开启时，同步收录新出现的功法/法术草稿',
      defaultOn: true,
    },
  ]

  const isOn = (s: { key: string; defaultOn: boolean }) =>
    s.defaultOn ? genCfg[s.key] !== false : genCfg[s.key] === true

  const toggle = async (key: string, value: boolean | string) => {
    try {
      // generationConfig 为整体覆盖，先合并当前配置再写回
      await projectsApi.update(projectId, {
        generationConfig: { ...genCfg, [key]: value },
      })
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    } catch (err: any) {
      toast(err.message || '开关保存失败', 'error')
    }
  }

  const sensitivity = (genCfg.entitySensitivity ?? 'balanced') as string

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <SlidersHorizontal className="h-3.5 w-3.5 text-indigo-400" />
          生成策略开关
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {switches.map((s) => (
          <div key={s.key} className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-300">{s.label}</label>
              <p className="mt-0.5 text-xs text-gray-500">{s.desc}</p>
            </div>
            <Switch
              checked={isOn(s)}
              onChange={(v) => toggle(s.key, v)}
            />
          </div>
        ))}
        {/* 新角色识别敏感度（09 US-5）：仅实体库自动维护开启时可调 */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <label className="block text-sm font-medium text-gray-300">新角色识别敏感度</label>
            <p className="mt-0.5 text-xs text-gray-500">严格=有对话才录 / 平衡=默认 / 宽松=提到名字就录</p>
          </div>
          <Select
            className="w-24"
            aria-label="新角色识别敏感度"
            options={[
              { value: 'strict', label: '严格' },
              { value: 'balanced', label: '平衡' },
              { value: 'loose', label: '宽松' },
            ]}
            value={sensitivity}
            disabled={genCfg.autoExtractCustomEntities === false}
            onChange={(e) => toggle('entitySensitivity', e.target.value as any)}
          />
        </div>
        <p className="text-[10px] text-gray-600">项目级配置，保存后对后续生成与审计生效</p>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setWhitelistOpen(true)}>
          <ShieldCheck className="mr-1 h-3 w-3" />
          去味豁免白名单管理
        </Button>
      </CardContent>
      <DeslopWhitelistDialog projectId={projectId} open={whitelistOpen} onClose={() => setWhitelistOpen(false)} />
    </Card>
  )
}

/** 去味豁免白名单管理弹窗（开源借鉴 PRD v1.1 M1）：pattern 子串命中拦截项原文/规则名即豁免 */
function DeslopWhitelistDialog({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [pattern, setPattern] = useState('')
  const [reason, setReason] = useState('')

  const { data: rows, isLoading } = useQuery({
    queryKey: ['deslop-whitelist', projectId],
    queryFn: () => debtGateApi.listWhitelist(projectId),
    enabled: open && !!projectId,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['deslop-whitelist', projectId] })

  const handleAdd = async () => {
    if (!pattern.trim()) { toast('豁免词不能为空', 'error'); return }
    try {
      await debtGateApi.addWhitelist(projectId, pattern.trim(), reason.trim() || undefined)
      setPattern(''); setReason('')
      refresh()
    } catch (err: any) { toast(err.message || '新增豁免词失败', 'error') }
  }

  const handleRemove = async (id: number) => {
    try {
      await debtGateApi.removeWhitelist(projectId, id)
      refresh()
    } catch (err: any) { toast(err.message || '删除失败', 'error') }
  }

  if (!open) return null
  return (
    <Dialog open onClose={onClose} title="去味豁免白名单">
      <div className="space-y-3 text-sm">
        <p className="text-xs text-gray-500">白名单中的词条以子串方式命中拦截项的原文或规则名时，该拦截项不再计为 blocking。另可在章节正文首 6 行加 <code className="text-gray-300">{'<!-- 去味:跳过 -->'}</code> 整章豁免。</p>
        <div className="flex gap-2">
          <Input placeholder="豁免词，如：不由得" value={pattern} onChange={(e) => setPattern(e.target.value)} className="flex-1" />
          <Input placeholder="理由（可选）" value={reason} onChange={(e) => setReason(e.target.value)} className="w-40" />
          <Button size="sm" onClick={handleAdd}>新增</Button>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : !rows?.length ? (
          <EmptyState message="暂无豁免词" />
        ) : (
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {rows.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-gray-200">{r.pattern}</span>
                  {r.reason && <span className="ml-2 text-xs text-gray-500">{r.reason}</span>}
                </div>
                <button onClick={() => handleRemove(r.id)} className="shrink-0 text-gray-500 hover:text-red-400" aria-label="删除豁免词">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 后验步骤配置（开源借鉴 PRD v1.1 M2 / US-11）：10步开关+三档预置+依赖提示 */
/* ------------------------------------------------------------------ */

const POST_UPDATE_STEP_META: { name: string; label: string; desc: string; zeroToken?: boolean }[] = [
  { name: 'post_state_extract', label: '人物状态快照抽取', desc: '更新人物境界/位置等状态，伏笔与任务流转的对比基础' },
  { name: 'post_foreshadow_flow', label: '伏笔状态流转', desc: '按正文推进伏笔埋设/回收状态' },
  { name: 'post_task_flow', label: '任务状态流转', desc: '按正文推进任务接取/完成状态' },
  { name: 'post_plot_duplication', label: '桥段重复度扫描', desc: '零token本地扫描，检测与历史章节桥段重复', zeroToken: true },
  { name: 'post_hook_rotation', label: '章末钩子轮换检测', desc: '零token本地检测章末钩子类型是否单一化', zeroToken: true },
  { name: 'post_causal_expire', label: '因果链逾期过期', desc: '零token本地维护，逾期因果链自动过期', zeroToken: true },
  { name: 'post_branch_generate', label: '剧情分支生成', desc: '生成剧情分支选项（token 消耗较大）' },
  { name: 'post_quote_extract', label: '金句提取', desc: '从正文提取金句入语录库' },
  { name: 'post_entity_extract', label: '自定义实体维护', desc: '识别新人物/武器/功法并建草稿' },
  { name: 'post_teleport_check', label: '防瞬移检测', desc: '零token本地检测人物位置跳变', zeroToken: true },
]

const POST_UPDATE_PRESETS: { key: string; label: string; desc: string; disabled: string[] }[] = [
  { key: 'full', label: '完整', desc: '全部 10 步执行', disabled: [] },
  { key: 'lite', label: '精简', desc: '关金句提取+防瞬移，省 token', disabled: ['post_quote_extract', 'post_teleport_check'] },
  { key: 'minimal', label: '极简', desc: '仅主管线写作+审计，后验全关', disabled: POST_UPDATE_STEP_META.map((s) => s.name) },
]

function PostUpdateConfigCard({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: !!projectId,
  })

  const genCfg = (project?.generationConfig || {}) as Record<string, any>
  const disabledSteps: string[] = Array.isArray(genCfg.postUpdateDisabledSteps) ? genCfg.postUpdateDisabledSteps : []
  const autoOn = genCfg.autoPostUpdate !== false

  const save = async (next: Record<string, any>) => {
    try {
      await projectsApi.update(projectId, { generationConfig: { ...genCfg, ...next } })
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    } catch (err: any) {
      toast(err.message || '保存失败', 'error')
    }
  }

  const toggleStep = (name: string, on: boolean) => {
    const next = on ? disabledSteps.filter((s) => s !== name) : [...disabledSteps, name]
    save({ postUpdateDisabledSteps: next })
  }

  const activePreset = POST_UPDATE_PRESETS.find((p) =>
    p.disabled.length === disabledSteps.length && p.disabled.every((d) => disabledSteps.includes(d))
  )?.key

  // 依赖提示：实体维护关闭与“自动维护实体库”开关冲突；状态快照关闭影响后续流转类步骤
  const entityConflict = disabledSteps.includes('post_entity_extract') && genCfg.autoExtractCustomEntities !== false
  const stateDisabled = disabledSteps.includes('post_state_extract')

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <ListOrdered className="h-3.5 w-3.5 text-cyan-400" />
            后验步骤配置
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">生成后自动执行</span>
            <Switch checked={autoOn} onChange={(v) => save({ autoPostUpdate: v })} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 三档预置模板 */}
        <div className="flex flex-wrap gap-2">
          {POST_UPDATE_PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={activePreset === p.key ? 'default' : 'outline'}
              className="h-8 text-xs"
              onClick={() => save({ postUpdateDisabledSteps: p.disabled })}
              title={p.desc}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {/* 依赖提示 */}
        {(entityConflict || stateDisabled) && (
          <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
            {entityConflict && (
              <p className="text-[11px] text-amber-300">提示：已关闭“自定义实体维护”，但上方“自动维护实体库”开关仍开启，二者冲突，建议同步关闭其一。</p>
            )}
            {stateDisabled && (
              <p className="text-[11px] text-amber-300">提示：关闭“人物状态快照抽取”后，伏笔/任务流转与防瞬移检测的对比基础可能不完整。</p>
            )}
          </div>
        )}
        {/* 10 步逐个开关 */}
        <div className="space-y-2.5">
          {POST_UPDATE_STEP_META.map((s) => {
            const on = !disabledSteps.includes(s.name)
            return (
              <div key={s.name} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-gray-300">
                    {s.label}
                    {s.zeroToken && <span className="rounded bg-emerald-500/15 px-1 py-px text-[10px] text-emerald-400">零token</span>}
                  </label>
                  <p className="mt-0.5 text-xs text-gray-500">{s.desc}</p>
                </div>
                <Switch checked={on && autoOn} disabled={!autoOn} onChange={(v) => toggleStep(s.name, v)} />
              </div>
            )
          })}
        </div>
        <p className="text-[10px] text-gray-600">项目级配置，关闭自动执行后各步开关不生效；手动补跑后验同样遵循此禁用清单</p>
      </CardContent>
    </Card>
  )
}

export default function GenerationConsole() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [selectedPlan, setSelectedPlan] = useState<any>(null)
  // 智能增强：自动预填冲突+冰山台词参数
  const [boostOpen, setBoostOpen] = useState(false)
  const [targetWords, setTargetWords] = useState(3000)
  const [temperature, setTemperature] = useState(0.8)
  const [autoRevise, setAutoRevise] = useState(true)
  const [stylePreset, setStylePreset] = useState('')
  const [advancedMode, setAdvancedMode] = useState(false)
  const [skipAudit, setSkipAudit] = useState(false)
  const [maxTokens, setMaxTokens] = useState(4096)
  const [statusFilter, setStatusFilter] = useState('all')
  const [showBranches, setShowBranches] = useState(false)
  const [taskDetail, setTaskDetail] = useState<any>(null)
  const [taskDetailLoading, setTaskDetailLoading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  // 管线检查点（架构升级 Epic1）
  const [taskCheckpoints, setTaskCheckpoints] = useState<any>(null)
  const [stepActionLoading, setStepActionLoading] = useState<string | null>(null)
  // 欠账门（开源借鉴 PRD v1.1 M1）：白名单弹窗 + 强制继续参数备份
  const [whitelistOpen, setWhitelistOpen] = useState(false)
  const lastStartParamsRef = useRef<any>(null)
  // 底部折叠栏（PRD v1.1：项目级配置默认收起，不占主视口）
  const [showProjectConfig, setShowProjectConfig] = useState(false)

  // 查看单任务详情
  const handleViewTask = async (taskId: number | string) => {
    setTaskDetailLoading(true)
    setTaskDetail(null)
    setTaskCheckpoints(null)
    try {
      const detail = await generationApi.task(String(taskId))
      setTaskDetail(detail)
      // 并行拉取步骤检查点（失败不阻断详情展示）
      generationApi.checkpoints(String(taskId)).then(setTaskCheckpoints).catch(() => {})
    } catch (err: any) {
      toast(err.message || '加载任务详情失败', 'error')
    } finally {
      setTaskDetailLoading(false)
    }
  }

  // Epic1：从失败/指定步骤重试入队（队列 worker 自动消费，断点续跑）
  const handleRetryTask = async (fromStep?: string) => {
    if (!taskDetail?.id) return
    setStepActionLoading(fromStep ? `retry-${fromStep}` : 'retry-auto')
    try {
      await generationApi.retry(String(taskDetail.id), fromStep)
      toast('任务已重新入队，将从检查点断点续跑', 'success')
      setTaskDetail(null)
      queryClient.invalidateQueries({ queryKey: ['generation-queue'] })
      queryClient.invalidateQueries({ queryKey: ['chapter-plans', projectId] })
    } catch (err: any) {
      toast(err.message || '重试失败', 'error')
    } finally {
      setStepActionLoading(null)
    }
  }

  // Epic1：跳过首个失败步骤，从下一步继续
  const handleSkipStep = async () => {
    if (!taskDetail?.id) return
    setStepActionLoading('skip')
    try {
      await generationApi.skipStep(String(taskDetail.id))
      toast('已跳过失败步骤并重新入队', 'success')
      setTaskDetail(null)
      queryClient.invalidateQueries({ queryKey: ['generation-queue'] })
    } catch (err: any) {
      toast(err.message || '跳过失败', 'error')
    } finally {
      setStepActionLoading(null)
    }
  }

  // Epic2：手动补跑后验更新工作流
  const handleManualPostUpdate = async () => {
    setStepActionLoading('post-update')
    try {
      const res = await projectsApi.postUpdate(projectId, taskDetail?.chapterPlanId ?? undefined)
      const failed = res?.failedCount ?? 0
      toast(failed > 0 ? `后验更新完成，${failed} 个步骤失败（详见日志）` : '后验更新全部完成', failed > 0 ? 'error' : 'success')
      generationApi.checkpoints(String(taskDetail.id)).then(setTaskCheckpoints).catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['chapter-plans', projectId] })
    } catch (err: any) {
      toast(err.message || '后验更新失败', 'error')
    } finally {
      setStepActionLoading(null)
    }
  }

  // 当前项目（全局状态，侧边栏可切换）
  const projectId = useCurrentProjectId()

  // 获取章节计划队列
  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ['chapter-plans', projectId],
    queryFn: () => chaptersApi.list(projectId),
  })

  // SSE流式生成Hook
  const {
    text, phase, auditReport, retrievedContext, isStreaming, error,
    branchOptions, plotDuplicationWarning, hookRotationWarning, entitiesFound, teleportWarning, startGeneration, cancelGeneration, reset,
  } = useGenerationStream()

  // 生成完成后刷新章节队列状态与实体库（09-自动维护草稿可能新增）
  useEffect(() => {
    if (phase === 'complete' || phase === 'error') {
      queryClient.invalidateQueries({ queryKey: ['chapter-plans', projectId] })
      queryClient.invalidateQueries({ queryKey: ['custom-characters', projectId] })
      queryClient.invalidateQueries({ queryKey: ['custom-weapons', projectId] })
      queryClient.invalidateQueries({ queryKey: ['custom-techniques', projectId] })
    }
  }, [phase, projectId, queryClient])

  // 分支选项就绪提示
  useEffect(() => {
    if (branchOptions?.length) {
      toast(`已生成 ${branchOptions.length} 个剧情分支选项，可前往章节阅读页选择走向`, 'success')
      queryClient.invalidateQueries({ queryKey: ['branch-options'] })
    }
  }, [branchOptions])

  // 开始生成
  const handleStart = async () => {
    if (!selectedPlan) {
      toast('请先选择要生成的章节', 'error')
      return
    }
    const params = {
      projectId,
      chapterPlanId: selectedPlan.id,
      targetWords,
      temperature,
      autoRevise,
      stylePreset: stylePreset || undefined,
      skipAudit: advancedMode ? skipAudit : undefined,
      maxTokens: advancedMode ? maxTokens : undefined,
    }
    lastStartParamsRef.current = params
    try {
      await startGeneration(params)
      toast('生成任务已入队', 'success')
    } catch (err: any) {
      toast(err.message || '启动失败', 'error')
    }
  }

  // 欠账门拦截后强制继续（二次确认后重新入队，留痕在生成日志）
  const handleForceContinue = async () => {
    const params = lastStartParamsRef.current
    if (!params) { toast('无上次启动参数，请重新选择章节', 'error'); return }
    if (!window.confirm('确认带欠账强制继续生成？本次拦截将留痕在生成日志。')) return
    try {
      await startGeneration({ ...params, forceContinue: true })
      toast('已强制继续，欠账已留痕', 'success')
    } catch (err: any) {
      toast(err.message || '启动失败', 'error')
    }
  }

  // ===== 批量选择 & 队列 =====
  const [selectedPlanIds, setSelectedPlanIds] = useState<number[]>([])

  const togglePlanSelection = (id: number) => {
    setSelectedPlanIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  // 队列状态轮询（3秒刷新）
  const { data: queueStatus } = useQuery({
    queryKey: ['generation-queue'],
    queryFn: () => generationApi.queue(),
    refetchInterval: 3000,
  })

  // 批量入队
  const handleBatchStart = async () => {
    if (selectedPlanIds.length === 0) {
      toast('请先勾选要批量生成的章节', 'error')
      return
    }
    try {
      const result = await generationApi.batch({
        chapterPlanIds: selectedPlanIds,
        skipAudit: !autoRevise,
        skipRevision: !autoRevise,
      })
      toast(`已入队 ${result.count} 个任务（批次 ${result.batchId.slice(0, 12)}…）`, 'success')
      setSelectedPlanIds([])
      queryClient.invalidateQueries({ queryKey: ['generation-queue'] })
    } catch (err: any) {
      toast(err.message || '批量入队失败', 'error')
    }
  }

  // 筛选任务列表：主章平坦，分支章按 parent（同卷同章号的非分支章节）编组
  const filteredTasks = (() => {
    const all = (tasks || []).filter((t: any) =>
      statusFilter === 'all' ? true : t.status === statusFilter
    );
    // 分离主线章和分支章
    const main = all.filter((t: any) => !t.branchSourceOptionId);
    const branch = all.filter((t: any) => t.branchSourceOptionId);
    // 主线章附加其下分支章列表
    return main.map((m: any) => ({
      ...m,
      _children: showBranches
        ? branch.filter((b: any) => b.volumeNo === m.volumeNo && b.chapterNo === m.chapterNo)
        : [],
    }));
  })()

  // 欠账门拦截错误解析（DEBT_GATE_BLOCKED: + JSON payload）
  const debtGatePayload = useMemo(() => {
    if (!error || !error.startsWith('DEBT_GATE_BLOCKED:')) return null
    try { return JSON.parse(error.slice('DEBT_GATE_BLOCKED:'.length)) } catch { return null }
  }, [error])

  // 生成前欠账预检（确认弹窗打开时预览上一章 blocking 清单）
  const { data: debtCheck } = useQuery({
    queryKey: ['debt-gate-check', projectId, selectedPlan?.id],
    queryFn: () => debtGateApi.check(projectId, selectedPlan.id),
    enabled: showConfirm && !!projectId && !!selectedPlan?.id,
  })

  // 智能增强：选中章节后自动拉取冲突+冰山预填
  const { data: conflictDraft } = useQuery({
    queryKey: ['dual-engine-draft', projectId, selectedPlan?.id],
    queryFn: () => dualEngineApi.conflictDraft(projectId, selectedPlan.id),
    enabled: !!projectId && !!selectedPlan?.id,
    staleTime: 30000,
  })
  const { data: icebergDraft } = useQuery({
    queryKey: ['dual-engine-iceberg-draft', projectId, selectedPlan?.id],
    queryFn: () => dualEngineApi.icebergDraft(projectId, selectedPlan.id),
    enabled: !!projectId && !!selectedPlan?.id,
    staleTime: 30000,
  })

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-100">生成控制台</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* 左侧：待生成队列 */}
        <div className="lg:col-span-3">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">章节队列</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBatchStart}
                  disabled={selectedPlanIds.length === 0}
                  className="h-8 px-2 text-xs"
                >
                  <Layers className="mr-1 h-3 w-3" />
                  批量生成{selectedPlanIds.length > 0 ? `(${selectedPlanIds.length})` : ''}
                </Button>
              </div>
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'planned', label: '待生成' },
                  { value: 'generated', label: '已生成' },
                  { value: 'finalized', label: '已定稿' },
                ]}
                className="mt-2"
              />
              <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors">
                <input
                  type="checkbox"
                  checked={showBranches}
                  onChange={(e) => setShowBranches(e.target.checked)}
                  className="h-3 w-3 accent-amber-500"
                />
                显示分支章节
              </label>
            </CardHeader>
            <CardContent className="space-y-2 overflow-y-auto" style={{ maxHeight: '60vh' }}>
              {tasksLoading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
              ) : filteredTasks.length === 0 ? (
                <EmptyState message="暂无章节计划" />
              ) : (
                filteredTasks.map((task: any) => (
                  <React.Fragment key={task.id}>
                    {/* ---- 主章节行 ---- */}
                    <div
                      className={cn(
                        'flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors',
                        selectedPlan?.id === task.id
                          ? 'border-indigo-500 bg-indigo-500/10'
                          : 'border-gray-800 hover:border-gray-700'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPlanIds.includes(task.id)}
                        onChange={(e) => { e.stopPropagation(); togglePlanSelection(task.id) }}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-500"
                      />
                      <div className="min-w-0 flex-1" role="button" tabIndex={0} onClick={() => setSelectedPlan(task)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedPlan(task) } }}>
                        <p className="text-sm font-medium text-gray-200">
                          第{task.volumeNo}卷·第{task.chapterNo}章：{task.title}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge
                            variant={chapterStatusConfig[task.status]?.variant || 'default'}
                          >
                            {chapterStatusConfig[task.status]?.label || task.status}
                          </Badge>
                          {task.mustHaveEvents?.length > 0 && (
                            <span className="shrink-0 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-400" title={task.mustHaveEvents.join('、')}>
                              ⚓{task.mustHaveEvents.length}
                            </span>
                          )}
                          {task._children?.length > 0 && (
                            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                              {task._children.length}分支
                            </span>
                          )}
                          <span className="text-xs text-gray-500">{task.targetWordCount || 3000}字</span>
                        </div>
                      </div>
                    </div>
                    {/* ---- 分支章节行（缩进+连线） ---- */}
                    {task._children?.map((child: any) => (
                      <div key={child.id}
                        className={cn(
                          'relative -mt-1 ml-5 flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors border-l-amber-500/30 bg-amber-500/[0.02]',
                          selectedPlan?.id === child.id
                            ? 'border-l-amber-500 border-indigo-500/40 bg-indigo-500/10'
                            : 'border-l-amber-500/30 border-gray-800/50 hover:border-gray-700'
                        )}
                      >
                        {/* 树连线 */}
                        <span className="absolute -left-3 top-0 h-1/2 w-3 rounded-bl-lg border-b border-l border-amber-500/20" />
                        <input
                          type="checkbox"
                          checked={selectedPlanIds.includes(child.id)}
                          onChange={(e) => { e.stopPropagation(); togglePlanSelection(child.id) }}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-amber-500"
                        />
                        <div className="min-w-0 flex-1" role="button" tabIndex={0} onClick={() => setSelectedPlan(child)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedPlan(child) } }}>
                          <p className="text-sm text-gray-300">
                            <span className="text-amber-400">↳</span>{' '}第{child.volumeNo}卷·第{child.chapterNo}章：{child.title}
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <Badge
                              variant={chapterStatusConfig[child.status]?.variant || 'default'}
                            >
                              {chapterStatusConfig[child.status]?.label || child.status}
                            </Badge>
                            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                              分支
                            </span>
                            <span className="text-xs text-gray-500">{child.targetWordCount || 3000}字</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </React.Fragment>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* 中间：生成预览（PRD v1.1：6→9 列扩展） */}
        <div className="lg:col-span-9">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">生成预览</CardTitle>
                {/* 当前阶段指示 */}
                <span className={cn('text-sm font-medium', phaseConfig[phase].color)} aria-live="polite">
                  {phase !== 'idle' && (
                    <span className="flex items-center gap-1.5">
                      {isStreaming && <span className="h-2 w-2 animate-pulse-dot rounded-full bg-current" />}
                      {phaseConfig[phase].label}
                    </span>
                  )}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {/* 操作按钮 */}
              <div className="mb-4 flex gap-2">
                <Button
                  onClick={() => { if (!selectedPlan) { toast('请先选择要生成的章节', 'error'); return } setShowConfirm(true) }}
                  disabled={isStreaming || !selectedPlan}
                  size="sm"
                >
                  <Play className="h-3.5 w-3.5" />
                  开始生成
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={cancelGeneration}
                  disabled={!isStreaming}
                >
                  <Square className="h-3.5 w-3.5" />
                  取消
                </Button>
                {(phase === 'complete' || phase === 'error') && (
                  <Button variant="ghost" size="sm" onClick={reset}>
                    重置
                  </Button>
                )}
              </div>

              {/* 生成参数（PRD v1.1：右栏上移，操作按钮下方紧凑一行） */}
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  目标字数
                  <input
                    type="number"
                    value={targetWords}
                    onChange={(e) => setTargetWords(Number(e.target.value))}
                    min={500}
                    max={10000}
                    step={500}
                    className="w-20 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 focus:border-indigo-500 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  温度
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    className="w-24 accent-indigo-500"
                  />
                  <span className="w-8 text-gray-300">{temperature.toFixed(1)}</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={autoRevise}
                    onChange={(e) => setAutoRevise(e.target.checked)}
                    className="h-3 w-3 accent-indigo-500"
                  />
                  自动修订
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  文风
                  <select
                    value={stylePreset}
                    onChange={(e) => setStylePreset(e.target.value)}
                    className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">默认</option>
                    <option value="hot_battle">热血打斗</option>
                    <option value="lyrical">细腻抒情</option>
                    <option value="daily_light">轻松日常</option>
                    <option value="eerie_mystery">悬疑诡异</option>
                  </select>
                </label>
                <button
                  onClick={() => setAdvancedMode(!advancedMode)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <ChevronDown className={cn('h-3 w-3 transition-transform', advancedMode && 'rotate-180')} />
                  高级
                </button>
                {selectedPlan && (
                  <span className="ml-auto hidden max-w-[240px] truncate text-xs text-gray-500 md:inline">
                    当前：{selectedPlan.chapterTitle || selectedPlan.title}
                  </span>
                )}
              </div>

              {advancedMode && (
                <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-gray-700/50 bg-gray-900/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <label id="gen-skip-audit-label" className="text-xs text-gray-400">跳过审计</label>
                    <button
                      aria-labelledby="gen-skip-audit-label"
                      onClick={() => setSkipAudit(!skipAudit)}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        skipAudit ? 'bg-amber-600/30 text-amber-300' : 'bg-gray-700 text-gray-400'
                      )}
                    >
                      {skipAudit ? '跳过' : '执行'}
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-gray-400">
                    最大Token
                    <input
                      type="range"
                      min={1000}
                      max={16000}
                      step={500}
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(Number(e.target.value))}
                      className="w-32 accent-indigo-500"
                    />
                    <span className="w-12 text-gray-300">{maxTokens}</span>
                  </label>
                </div>
              )}

              {/* 智能增强：自动预填冲突+冰山台词（v1.5.1） */}
              {selectedPlan && (
                <div className="mb-3 rounded-lg border border-sky-500/20 bg-sky-500/5">
                  <button
                    className="flex w-full items-center justify-between px-3 py-2 text-left"
                    onClick={() => setBoostOpen(!boostOpen)}
                  >
                    <span className="flex items-center gap-2 text-xs font-medium text-sky-300">
                      <Swords className="h-3.5 w-3.5" /> 智能增强
                      {conflictDraft && <Badge variant="default" className="text-[9px]">冲突参已就绪</Badge>}
                      {icebergDraft && <Badge variant="default" className="text-[9px]">台词已就绪</Badge>}
                    </span>
                    <ChevronDown className={cn('h-3.5 w-3.5 text-gray-500 transition-transform', boostOpen && 'rotate-180')} />
                  </button>
                  {boostOpen && (
                    <div className="space-y-2 border-t border-sky-500/10 px-3 py-2.5">
                      {/* 冲突参数 */}
                      {conflictDraft ? (
                        <div className="rounded border border-amber-500/15 bg-amber-500/5 p-2">
                          <div className="flex items-center gap-2 text-[11px] font-medium text-amber-300">
                            <Swords className="h-3 w-3" />冲突引擎
                          </div>
                          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                            <span className="text-gray-500">主角</span><span className="text-gray-200">{conflictDraft.config.protagonist?.name || '—'}</span>
                            <span className="text-gray-500">欲望</span><span className="text-gray-200 truncate">{conflictDraft.config.desire?.target?.slice(0, 30) || '—'}</span>
                            <span className="text-gray-500">阻力类型</span><span className="text-gray-200">{conflictDraft.config.resistance?.type || '—'}</span>
                            <span className="text-gray-500">代价</span><span className="text-gray-200 truncate">{conflictDraft.config.cost?.what_is_lost?.slice(0, 30) || '—'}</span>
                          </div>
                          {conflictDraft.missing?.length > 0 && (
                            <p className="mt-1.5 text-[10px] text-amber-400">⚠ {conflictDraft.missing.length} 项待确认：{conflictDraft.missing.slice(0,2).join('；')}</p>
                          )}
                        </div>
                      ) : (
                        <div className="flex justify-center py-2"><Spinner className="h-3 w-3" label="加载冲突参数" /></div>
                      )}
                      {/* 冰山台词 */}
                      {icebergDraft ? (
                        <div className="rounded border border-purple-500/15 bg-purple-500/5 p-2">
                          <div className="flex items-center gap-2 text-[11px] font-medium text-purple-300">
                            <MessagesSquare className="h-3 w-3" />冰山台词
                          </div>
                          <div className="mt-1.5 text-[11px]">
                            <span className="text-gray-500">场景</span> <span className="text-gray-200">{icebergDraft.config.scene_context?.setting || '—'}</span>
                            <span className="text-gray-500 ml-3">情绪</span> <span className="text-gray-200">{icebergDraft.config.scene_context?.mood || '—'}</span>
                          </div>
                          {icebergDraft.missing?.length > 0 && (
                            <p className="mt-1 text-[10px] text-purple-400">⚠ {icebergDraft.missing.length} 项待确认：{icebergDraft.missing.slice(0,2).join('；')}</p>
                          )}
                        </div>
                      ) : (
                        <div className="flex justify-center py-2"><Spinner className="h-3 w-3" label="加载台词参数" /></div>
                      )}
                      <p className="text-[10px] text-gray-600">数据从章节计划自动推导，无需手动填写。有 ⚠ 标记的项建议在大纲页补充信息后重新加载</p>
                    </div>
                  )}
                </div>
              )}

              {/* 检索素材面板（预览框上方：展示本次从诛仙库调用到的历史资料） */}
              <RetrievedMaterialsPanel ctx={retrievedContext} />

              {/* 生成文本区域（打字机效果） */}
              <div className="min-h-[300px] rounded-lg border border-gray-800 bg-gray-950 p-4">
                {error ? (
                  debtGatePayload ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-red-400">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span className="text-sm font-semibold">
                          欠账门拦截：上一章「{debtGatePayload.prevChapter?.title || ''}」残留 {debtGatePayload.issues?.length || 0} 处 blocking 级 AI 味
                        </span>
                      </div>
                      <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                        {(debtGatePayload.issues || []).map((it: any, i: number) => (
                          <div key={i} className="text-xs">
                            <span className="mr-1.5 rounded bg-red-500/20 px-1 py-px text-red-300">
                              {it.kind === 'flavor' ? 'AI味' : '门禁'}·{it.rule}
                            </span>
                            <span className="text-gray-400">{it.excerpt}</span>
                          </div>
                        ))}
                        {(debtGatePayload.exemptedCount ?? 0) > 0 && (
                          <p className="text-[11px] text-gray-500">另有 {debtGatePayload.exemptedCount} 处命中已被白名单豁免</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => setWhitelistOpen(true)}>豁免管理</Button>
                        <Button size="sm" variant="outline" onClick={handleForceContinue}>强制继续（留痕）</Button>
                      </div>
                      <p className="text-[11px] text-gray-600">建议：先到章节阅读页清理上一章 AI 味后再生成；或在上一章正文首行加 {'<!-- 去味:跳过 -->'} 整章豁免。</p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-red-400">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm">{error}</span>
                    </div>
                  )
                ) : text ? (
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
                    {text}
                    {isStreaming && (
                      <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-indigo-400" />
                    )}
                  </div>
                ) : (
                  <div className="flex h-64 items-center justify-center text-gray-600">
                    {isStreaming ? (
                      <div className="flex items-center gap-2">
                        <Spinner />
                        <span className="text-sm">{phase === 'queued' ? '排队等待中...' : '正在准备...'}</span>
                      </div>
                    ) : (
                      <span className="text-sm">选择章节后点击「开始生成」</span>
                    )}
                  </div>
                )}
              </div>

              {/* 审计报告 */}
              {auditReport && (
                <div className="mt-4 rounded-lg border border-gray-800 bg-gray-800/50 p-4">
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-300">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    审计报告
                  </h4>
                  <div className="space-y-2 text-sm text-gray-400">
                    {auditReport.score !== undefined && (
                      <p>质量评分：<span className="text-indigo-300">{auditReport.score}/10</span></p>
                    )}
                    {auditReport.passed !== undefined && (
                      <p>
                        审计结果：
                        <span className={auditReport.passed ? 'text-emerald-400' : 'text-red-400'}>
                          {auditReport.passed ? ' 通过' : ' 未通过'}
                        </span>
                      </p>
                    )}
                    {auditReport.issues?.map((issue, i) => (
                      <p key={i} className="text-amber-400">• {issue}</p>
                    ))}
                    {auditReport.suggestions?.map((s, i) => (
                      <p key={i} className="text-gray-500">→ {s}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* 桥段重复度告警 */}
              {plotDuplicationWarning && plotDuplicationWarning.warnings?.length > 0 && (
                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-300">
                    <AlertTriangle className="h-4 w-4" />
                    桥段重复度告警
                  </h4>
                  <div className="space-y-1.5 text-sm">
                    {plotDuplicationWarning.warnings.map((w: any, i: number) => (
                      <div key={i} className="flex items-center gap-2">
                        <Badge variant={w.level === 'red' ? 'destructive' : 'warning'}>
                          {w.level === 'red' ? '红色' : '黄色'}
                        </Badge>
                        <span className="text-gray-300">
                          「{w.fingerprint}」近{w.window}章出现{w.count}次
                        </span>
                      </div>
                    ))}
                    {plotDuplicationWarning.suggestion && (
                      <p className="mt-2 text-xs text-amber-400/80">建议：{plotDuplicationWarning.suggestion}</p>
                    )}
                  </div>
                </div>
              )}

              {/* 章末钩子轮换提示 */}
              {hookRotationWarning && hookRotationWarning.repetitive && (
                <div className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-cyan-300">
                    <AlertTriangle className="h-4 w-4" />
                    钩子轮换提示
                  </h4>
                  <p className="text-sm text-gray-300">
                    近5章钩子类型过于单一，「{hookRotationWarning.dominantType}」占比过高，建议下一章切换钩子类型以保持节奏变化。
                  </p>
                </div>
              )}

              {/* 实体自动维护扫描结果（09需求） */}
              {entitiesFound && (
                <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-300">
                    <Database className="h-4 w-4" />
                    实体库自动维护
                  </h4>
                  <p className="text-sm text-gray-300">
                    发现{[
                      entitiesFound.newCharacters ? `${entitiesFound.newCharacters}个新人物` : '',
                      entitiesFound.newWeapons ? `${entitiesFound.newWeapons}件新武器` : '',
                      entitiesFound.newTechniques ? `${entitiesFound.newTechniques}门新功法` : '',
                      entitiesFound.newLocations ? `${entitiesFound.newLocations}个新地点` : '',
                    ].filter(Boolean).join('、')}已自动建档（草稿）{entitiesFound.updates ? `，${entitiesFound.updates}条人物动态已记录` : ''}。
                  </p>
                  <p className="mt-1 text-xs text-gray-500">草稿可在【众生百态】【铸器天工】【道法自然】筛选“待补充”查看完善，新地点在【山河舆图】中确认坐标。</p>
                </div>
              )}

              {/* 防瞬移告警（10-山河舆图 US-5） */}
              {teleportWarning && teleportWarning.warnings.length > 0 && (
                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-300">
                    <AlertTriangle className="h-4 w-4" />
                    疑似瞬移提醒
                  </h4>
                  <ul className="space-y-1 text-sm text-gray-300">
                    {teleportWarning.warnings.map((w, i) => (
                      <li key={i}>
                        {w.characterName}：{w.fromLocation} → {w.toLocation}，御剑最快也需{w.display}{w.estimated ? '（两地未连路径，按直线估算）' : ''}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-gray-500">可在【山河舆图】为两地补充路径/传送阵，或在正文补充赶路过程。</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ===== 底部折叠栏（PRD v1.1：项目级低频配置默认收起） ===== */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/40">
        <button
          onClick={() => setShowProjectConfig(!showProjectConfig)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-gray-800/40"
        >
          <span className="flex items-center gap-2 text-xs text-gray-400">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            项目配置 · 后验步骤 · 生成队列
            {queueStatus && (queueStatus.runningCount + queueStatus.pendingCount) > 0 && (
              <Badge variant="warning" className="ml-1">
                {queueStatus.runningCount + queueStatus.pendingCount} 运行中
              </Badge>
            )}
          </span>
          <ChevronDown className={cn('h-4 w-4 text-gray-500 transition-transform', showProjectConfig && 'rotate-180')} />
        </button>
        {showProjectConfig && (
          <div className="space-y-4 border-t border-gray-800 p-4">
            <GenerationStrategyCard projectId={projectId} />
            <PostUpdateConfigCard projectId={projectId} />

            {/* 生成队列（原右栏卡片，移入折叠栏） */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <ListOrdered className="h-3.5 w-3.5 text-cyan-400" />
                  生成队列
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {queueStatus ? (
                  <>
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>并发数: {queueStatus.concurrency}</span>
                      <span>执行中: {queueStatus.runningCount}</span>
                      <span>等待中: {queueStatus.pendingCount}</span>
                    </div>
                    {queueStatus.running?.length > 0 && (
                      <div className="space-y-1">
                        {queueStatus.running.map((t: any) => (
                          <div key={t.id} role="button" tabIndex={0} onClick={() => handleViewTask(t.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleViewTask(t.id) } }} className="flex cursor-pointer items-center gap-2 rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-1.5 text-xs transition-colors hover:bg-indigo-500/20">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                            <span className="text-indigo-200">#{t.id}</span>
                            <span className="text-gray-400">{t.currentStep}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {queueStatus.pending?.length > 0 && (
                      <div className="space-y-1">
                        {queueStatus.pending.slice(0, 8).map((t: any) => (
                          <div key={t.id} role="button" tabIndex={0} onClick={() => handleViewTask(t.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleViewTask(t.id) } }} className="flex cursor-pointer items-center gap-2 rounded border border-gray-700/60 bg-gray-800/40 px-2 py-1.5 text-xs transition-colors hover:bg-gray-700/40">
                            <span className="h-1.5 w-1.5 rounded-full bg-cyan-500/60" />
                            <span className="text-gray-300">#{t.id}</span>
                            <span className="text-gray-500">位置 {t.position}</span>
                            {(t.retryCount || 0) > 0 && (
                              <span className="text-amber-400">重试{t.retryCount}</span>
                            )}
                          </div>
                        ))}
                        {queueStatus.pending.length > 8 && (
                          <p className="text-center text-xs text-gray-600">+{queueStatus.pending.length - 8} 更多</p>
                        )}
                      </div>
                    )}
                    {queueStatus.runningCount === 0 && queueStatus.pendingCount === 0 && (
                      <p className="text-center text-xs text-gray-600">队列为空</p>
                    )}
                  </>
                ) : (
                  <p className="text-center text-xs text-gray-600">加载中…</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* 单任务详情弹窗 */}
      {(taskDetail || taskDetailLoading) && (
        <Dialog open onClose={() => setTaskDetail(null)} title={`任务详情 #${taskDetail?.id || ''}`}>
          {taskDetailLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : taskDetail ? (
            <div className="space-y-4">
              {/* 基本信息 */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">状态：</span>
                  <Badge variant={taskDetail.status === 'completed' ? 'success' : taskDetail.status === 'failed' ? 'destructive' : 'warning'}>
                    {taskDetail.status}
                  </Badge>
                </div>
                <div><span className="text-gray-500">当前步骤：</span><span className="text-gray-200">{taskDetail.currentStep || '—'}</span></div>
                <div><span className="text-gray-500">类型：</span><span className="text-gray-200">{taskDetail.taskType}</span></div>
                <div><span className="text-gray-500">重试：</span><span className="text-gray-200">{taskDetail.retryCount || 0}/{taskDetail.maxRetries || 3}</span></div>
                {taskDetail.llmModel && <div><span className="text-gray-500">模型：</span><span className="text-gray-200">{taskDetail.llmModel}</span></div>}
                {taskDetail.tokensUsed != null && <div><span className="text-gray-500">Token：</span><span className="text-gray-200">{taskDetail.tokensUsed.toLocaleString()}</span></div>}
                {taskDetail.startedAt && <div><span className="text-gray-500">开始：</span><span className="text-gray-200">{new Date(taskDetail.startedAt).toLocaleString()}</span></div>}
                {taskDetail.completedAt && <div><span className="text-gray-500">完成：</span><span className="text-gray-200">{new Date(taskDetail.completedAt).toLocaleString()}</span></div>}
              </div>

              {/* 错误信息 */}
              {taskDetail.errorMessage && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                  <span className="font-medium">错误：</span>{taskDetail.errorMessage}
                </div>
              )}

              {/* 管线步骤检查点（架构升级 Epic1：断点续跑） */}
              {taskCheckpoints?.mainSteps?.length > 0 && (() => {
                const cps = taskCheckpoints.checkpoints || []
                const postSteps = cps.filter((c: any) => c.stepOrder >= 100)
                const retryable = taskDetail.status === 'failed' || taskDetail.status === 'completed'
                const statusIcon = (st: string) => {
                  if (st === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  if (st === 'failed') return <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                  if (st === 'running') return <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                  if (st === 'skipped') return <span className="h-2 w-2 rounded-full bg-gray-600" />
                  return <span className="h-2 w-2 rounded-full bg-gray-800" />
                }
                return (
                  <div>
                    <h4 className="mb-2 text-xs font-medium text-gray-400">管线步骤（支持从任意步骤断点续跑）</h4>
                    <div className="space-y-1">
                      {taskCheckpoints.mainSteps.map((s: any) => {
                        const cp = cps.find((c: any) => c.stepName === s.name)
                        const st = cp?.status || 'pending'
                        return (
                          <div key={s.name} className="flex items-center gap-2 rounded border border-gray-800 px-2 py-1.5 text-xs">
                            {statusIcon(st)}
                            <span className={cn('flex-1', st === 'failed' ? 'text-red-300' : 'text-gray-300')}>
                              {s.label}
                              {cp?.errorMessage && <span className="ml-2 text-red-400/80">{String(cp.errorMessage).slice(0, 60)}</span>}
                            </span>
                            <span className="text-gray-600">{st}</span>
                            {retryable && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-[10px]"
                                loading={stepActionLoading === `retry-${s.name}`}
                                onClick={() => handleRetryTask(s.name)}
                                title="从此步骤重新开始（之前步骤的产出从检查点恢复）"
                              >
                                从此重跑
                              </Button>
                            )}
                          </div>
                        )
                      })}
                      {/* 后验更新子步骤（order>=100） */}
                      {postSteps.length > 0 && (
                        <div className="mt-2 space-y-1 rounded-lg border border-gray-800/60 bg-gray-900/40 p-2">
                          <div className="text-[10px] font-medium text-gray-500">后验更新子步骤</div>
                          {postSteps.map((c: any) => (
                            <div key={c.stepName} className="flex items-center gap-2 text-xs">
                              {statusIcon(c.status)}
                              <span className={cn('flex-1 truncate', c.status === 'failed' ? 'text-red-300' : 'text-gray-400')}>{c.stepName}</span>
                              <span className="text-gray-600">{c.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* 失败任务：重试/跳过快捷操作 */}
                    {taskDetail.status === 'failed' && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" loading={stepActionLoading === 'retry-auto'} onClick={() => handleRetryTask()}>
                          <Play className="h-3.5 w-3.5" />
                          从失败步骤重试
                        </Button>
                        <Button size="sm" variant="outline" loading={stepActionLoading === 'skip'} onClick={handleSkipStep}>
                          跳过失败步骤
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* 手动补跑后验更新（架构升级 Epic2） */}
              {taskDetail.status === 'completed' && taskDetail.chapterPlanId && (
                <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-800/30 px-3 py-2">
                  <span className="text-xs text-gray-400">后验更新异常/被跳过时可手动补跑（状态抽取、伏笔回收、金句沉淀等 10 步）</span>
                  <Button size="sm" variant="outline" loading={stepActionLoading === 'post-update'} onClick={handleManualPostUpdate}>
                    <RefreshCw className="h-3 w-3" />
                    补跑后验更新
                  </Button>
                </div>
              )}

              {/* 生成日志时间线 */}
              {taskDetail.logs?.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-medium text-gray-400">执行日志（{taskDetail.logs.length}条）</h4>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {taskDetail.logs.map((log: any, i: number) => (
                      <div key={i} className="flex items-start gap-2 rounded border border-gray-800 px-2 py-1.5 text-xs">
                        <span className="shrink-0 text-gray-600">{new Date(log.createdAt).toLocaleTimeString()}</span>
                        <Badge className="shrink-0 bg-gray-700/50 text-gray-300 text-[10px]">{log.agentName}</Badge>
                        <span className="text-gray-300">{log.action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 生成结果摘要 */}
              {taskDetail.result && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
                  <span className="font-medium text-emerald-300">生成结果：</span>
                  <span className="text-gray-300"> {taskDetail.result.title || `第${taskDetail.result.chapterNo}章`}</span>
                  {taskDetail.result.wordCount && <span className="text-gray-500"> · {taskDetail.result.wordCount}字</span>}
                </div>
              )}
            </div>
          ) : null}
        </Dialog>
      )}

      {/* 生成前预览确认弹窗 */}
      <Dialog open={showConfirm} onClose={() => setShowConfirm(false)} title="确认生成">
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-400">章节</span>
              <span className="text-gray-200">第{selectedPlan?.chapterNo}章 {selectedPlan?.title}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">目标字数</span>
              <span className="text-gray-200">{targetWords}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">创造性（温度）</span>
              <span className="text-gray-200">{temperature.toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">自动修订</span>
              <span className="text-gray-200">{autoRevise ? '开启' : '关闭'}</span>
            </div>
            {stylePreset && (
              <div className="flex justify-between">
                <span className="text-gray-400">文风预设</span>
                <span className="text-gray-200">{stylePreset}</span>
              </div>
            )}
            {advancedMode && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-400">审计</span>
                  <span className="text-gray-200">{skipAudit ? '跳过' : '执行'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">最大Token</span>
                  <span className="text-gray-200">{maxTokens}</span>
                </div>
              </>
            )}
          </div>
          {/* 欠账门预检：上一章存在 blocking 欠账时警示 */}
          {debtCheck?.blocked && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs font-semibold text-amber-300">
                欠账门警示：上一章「{debtCheck.prevChapter?.title || ''}」残留 {debtCheck.issues?.length || 0} 处 blocking 级 AI 味，入队后将被拦截。
              </p>
              <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
                {(debtCheck.issues || []).slice(0, 10).map((it: any, i: number) => (
                  <p key={i} className="text-[11px] text-amber-200/80">· {it.rule}：{it.excerpt}</p>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-gray-500">可先清理上一章、配置豁免白名单，或拦截后选择强制继续。</p>
            </div>
          )}
          <p className="text-xs text-gray-500">确认后将开始 AI 生成，过程中可随时取消。</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowConfirm(false)}>取消</Button>
          <Button size="sm" onClick={() => { setShowConfirm(false); handleStart() }}>
            <Play className="h-3.5 w-3.5" />
            确认生成
          </Button>
        </div>
      </Dialog>

      {/* 去味豁免白名单（欠账门拦截面板入口） */}
      <DeslopWhitelistDialog projectId={projectId} open={whitelistOpen} onClose={() => setWhitelistOpen(false)} />
    </div>
  )
}
