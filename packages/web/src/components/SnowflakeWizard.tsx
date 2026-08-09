/**
 * 雪花法渐进大纲向导（开源借鉴 PRD v1.1 M7 / US-08）
 * 模式归一化 PRD REQ-4：API 换新（outlinesApi.generate mode=stepwise / stepwise-draft / finalize），
 * step4/5 前置世界观资产勾选，step3 展示已注入人物库提示，支持 embedded 内嵌渲染（REQ-3.2）。
 * 五步培育：前提 → 主题与核心冲突 → 人物概要 → 卷结构 → 章节计划。
 * 每步生成后可编辑/重新生成，确认后保存草稿（中途退出可续进），全部完成后落库。
 */
import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Loader2, Plus, RefreshCw, Snowflake, Trash2 } from 'lucide-react'
import { Button, Dialog, Input, Textarea, Badge, useToast } from './ui'
import { outlinesApi } from '../lib/api'
import WorldAssetPicker, { type AssetSel, EMPTY_ASSET_SEL } from './WorldAssetPicker'

const STEPS = [
  { id: 1, label: '前提' },
  { id: 2, label: '主题冲突' },
  { id: 3, label: '人物概要' },
  { id: 4, label: '卷结构' },
  { id: 5, label: '章节计划' },
]

interface SnowflakeCharacter {
  name: string
  role: string
  motivation: string
  arc: string
}
interface SnowflakeVolume {
  volumeNumber?: number
  title: string
  summary?: string
  chapters?: {
    chapterNumber?: number
    title: string
    intent?: string
    targetEmotion?: string
    /** LLM 回标：借鉴素材与出场资产（finalize 同构落库用，编辑界面不展示但须透传） */
    basedOnMaterials?: { table: string; id: number }[]
    entities?: { characters?: string[]; weapons?: string[]; techniques?: string[]; locations?: string[] }
  }[]
}
interface SnowflakeDraft {
  step: number
  premise: string
  volumeCount: number
  theme?: string
  characters?: SnowflakeCharacter[]
  volumes?: SnowflakeVolume[]
}

export default function SnowflakeWizard({ projectId, onClose, onFinalized, embedded = false }: {
  projectId: string
  onClose: () => void
  onFinalized: () => void
  /** 内嵌渲染（模式归一化 REQ-3.2：分步生成内嵌于「AI生成大纲」弹窗，不另起 Dialog） */
  embedded?: boolean
}) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<SnowflakeDraft>({ step: 1, premise: '', volumeCount: 3 })
  const [loaded, setLoaded] = useState(false)
  // step4/5 资产勾选（不勾选=后端全量注入）
  const [assetSel, setAssetSel] = useState<AssetSel>(EMPTY_ASSET_SEL)
  // step3：后端返回的已注入人物库数量提示
  const [injectedCharCount, setInjectedCharCount] = useState(0)

  // 载入草稿（续进；承接旧 snowflake_draft 结构，旧草稿可续进）
  useEffect(() => {
    outlinesApi.getStepwiseDraft(projectId)
      .then((d) => {
        if (d && typeof d === 'object' && d.premise) {
          setDraft({ step: d.step || 1, premise: d.premise || '', volumeCount: d.volumeCount || 3, theme: d.theme, characters: d.characters, volumes: d.volumes })
          toast(`已恢复渐进草稿（第${d.step || 1}步）`, 'info')
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const saveDraftM = useMutation({
    mutationFn: (d: SnowflakeDraft) => outlinesApi.saveStepwiseDraft(projectId, d),
  })

  /** step4/5 携带资产勾选（只传非空项；空=后端全量注入） */
  const assetSelPayload = () => ({
    ...(assetSel.characterIds.length ? { characterIds: assetSel.characterIds } : {}),
    ...(assetSel.weaponIds.length ? { weaponIds: assetSel.weaponIds } : {}),
    ...(assetSel.techniqueIds.length ? { techniqueIds: assetSel.techniqueIds } : {}),
    ...(assetSel.locationIds.length ? { locationIds: assetSel.locationIds } : {}),
  })

  const genM = useMutation({
    mutationFn: (step: number) =>
      outlinesApi.generate(projectId, {
        mode: 'stepwise',
        step,
        premise: draft.premise,
        theme: draft.theme,
        characters: draft.characters,
        volumes: draft.volumes,
        volumeCount: draft.volumeCount,
        ...(step >= 4 ? assetSelPayload() : {}),
      }),
    onSuccess: (data: any, step: number) => {
      if (typeof data?.injectedCharacters === 'number') setInjectedCharCount(data.injectedCharacters)
      if (step === 2 && data.theme) {
        setDraft((d) => ({ ...d, theme: String(data.theme) }))
      } else if (step === 3 && Array.isArray(data.characters)) {
        setDraft((d) => ({ ...d, characters: data.characters.map((ch: any) => ({ name: String(ch.name || ''), role: String(ch.role || ''), motivation: String(ch.motivation || ''), arc: String(ch.arc || '') })) }))
      } else if (step === 4 && Array.isArray(data.volumes)) {
        setDraft((d) => ({ ...d, volumes: data.volumes.map((v: any, i: number) => ({ volumeNumber: v.volumeNumber || i + 1, title: String(v.title || ''), summary: v.summary ? String(v.summary) : '' })) }))
      } else if (step === 5 && Array.isArray(data.volumes)) {
        setDraft((d) => ({
          ...d,
          volumes: data.volumes.map((v: any, i: number) => ({
            volumeNumber: v.volumeNumber || i + 1,
            title: String(v.title || ''),
            summary: v.summary ? String(v.summary) : '',
            chapters: Array.isArray(v.chapters) ? v.chapters.map((ch: any) => ({
              chapterNumber: ch.chapterNumber, title: String(ch.title || ''), intent: ch.intent, targetEmotion: ch.targetEmotion,
              // 透传回标字段：finalize 同构落库（pinnedMaterialIds/requiredEntityIds）依赖
              basedOnMaterials: Array.isArray(ch.basedOnMaterials) ? ch.basedOnMaterials : undefined,
              entities: ch.entities && typeof ch.entities === 'object' ? ch.entities : undefined,
            })) : [],
          })),
        }))
      }
      toast('生成成功，可编辑后确认', 'success')
    },
    onError: (e: Error) => toast(e.message || '生成失败', 'error'),
  })

  const finalizeM = useMutation({
    mutationFn: () => outlinesApi.finalize(projectId, {
      premise: draft.premise,
      theme: draft.theme,
      characters: draft.characters,
      volumes: draft.volumes,
      ...assetSelPayload(),
    }),
    onSuccess: (r: any) => {
      // 信封解包后 r 为卷数组（createdPlanCount 以属性挂载）
      toast(`渐进大纲已落库：${r?.length ?? 0} 卷、${r?.createdPlanCount ?? 0} 章计划`, 'success')
      onFinalized()
      onClose()
    },
    onError: (e: Error) => toast(e.message || '落库失败', 'error'),
  })

  /** 确认当前步：保存草稿并前进 */
  const confirmStep = () => {
    const next: SnowflakeDraft = { ...draft, step: Math.min(draft.step + 1, 5) }
    setDraft(next)
    saveDraftM.mutate(next)
  }

  const stepReady = (() => {
    switch (draft.step) {
      case 1: return draft.premise.trim().length > 0
      case 2: return !!draft.theme?.trim()
      case 3: return !!draft.characters?.length
      case 4: return !!draft.volumes?.length
      case 5: return !!draft.volumes?.some((v) => v.chapters?.length)
      default: return false
    }
  })()

  if (!loaded) return null

  const content = (
    <div className="space-y-4">
      {/* 步骤条 */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1">
            {i > 0 && <div className="h-px w-4 bg-gray-700" />}
            <button
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                draft.step === s.id ? 'bg-indigo-600/40 text-indigo-200 ring-1 ring-indigo-500/60'
                : draft.step > s.id ? 'text-emerald-400' : 'text-gray-600'
              }`}
              onClick={() => draft.step > s.id && setDraft((d) => ({ ...d, step: s.id }))}
              disabled={draft.step <= s.id}
            >
              {s.id}. {s.label}
            </button>
          </div>
        ))}
      </div>

      {/* Step1：前提 */}
      {draft.step === 1 && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">用一句话描述这本书（雪花法第一片雪花）。后续每一步都基于已确认内容逐步展开。</p>
          <Textarea
            rows={3}
            value={draft.premise}
            onChange={(e) => setDraft({ ...draft, premise: e.target.value })}
            placeholder="例：一个灵根废弃的少年靠一枚残印逆袭，却卷入仙门与魔渊的千年布局"
          />
          <Input
            label="目标卷数"
            type="number"
            value={draft.volumeCount}
            min={1}
            max={20}
            onChange={(e) => setDraft({ ...draft, volumeCount: Number(e.target.value) || 3 })}
          />
        </div>
      )}

      {/* Step2：主题与核心冲突 */}
      {draft.step === 2 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => genM.mutate(2)} loading={genM.isPending && genM.variables === 2}>
              <Snowflake className="h-3.5 w-3.5" />
              {draft.theme ? '重新生成' : '生成主题与核心冲突'}
            </Button>
            <span className="text-xs text-gray-500">生成后可自由编辑</span>
          </div>
          <Textarea
            rows={6}
            value={draft.theme ?? ''}
            onChange={(e) => setDraft({ ...draft, theme: e.target.value })}
            placeholder="点上方按钮生成，或直接手写：主题立意 + 核心冲突…"
          />
        </div>
      )}

      {/* Step3：人物概要 */}
      {draft.step === 3 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => genM.mutate(3)} loading={genM.isPending && genM.variables === 3}>
              <Snowflake className="h-3.5 w-3.5" />
              {draft.characters?.length ? '重新生成' : '生成人物概要'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDraft({ ...draft, characters: [...(draft.characters ?? []), { name: '', role: '', motivation: '', arc: '' }] })}>
              <Plus className="h-3.5 w-3.5" />手动添加
            </Button>
          </div>
          {/* REQ-4.3：注入完整人物库后展示提示 */}
          {injectedCharCount > 0 && (
            <p className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-3 py-2 text-xs text-indigo-300">
              已注入 {injectedCharCount} 位项目人物库角色，生成的人物将避免与已有设定冲突
            </p>
          )}
          {(draft.characters ?? []).map((ch, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
              <div className="grid grid-cols-2 gap-2">
                <Input value={ch.name} onChange={(e) => updateChar(i, { name: e.target.value })} placeholder="姓名" aria-label="姓名" />
                <Input value={ch.role} onChange={(e) => updateChar(i, { role: e.target.value })} placeholder="定位（主角/反派/导师…）" aria-label="定位" />
              </div>
              <Input value={ch.motivation} onChange={(e) => updateChar(i, { motivation: e.target.value })} placeholder="核心动机" aria-label="动机" />
              <div className="flex items-start gap-2">
                <Input className="flex-1" value={ch.arc} onChange={(e) => updateChar(i, { arc: e.target.value })} placeholder="成长弧" aria-label="成长弧" />
                <Button size="sm" variant="ghost" onClick={() => removeChar(i)} aria-label="删除人物">
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                </Button>
              </div>
            </div>
          ))}
          {!draft.characters?.length && <p className="text-xs text-gray-600">暂无，点「生成人物概要」或「手动添加」</p>}
        </div>
      )}

      {/* Step4：卷结构 */}
      {draft.step === 4 && (
        <div className="space-y-3">
          {/* REQ-4.2：世界观资产注入勾选（生成前可调整） */}
          <details>
            <summary className="cursor-pointer text-xs font-medium text-gray-400 hover:text-indigo-300">
              世界观资产注入（可选，生成卷结构时约束）
            </summary>
            <div className="pt-2">
              <WorldAssetPicker projectId={projectId} enabled value={assetSel} onChange={setAssetSel} />
            </div>
          </details>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => genM.mutate(4)} loading={genM.isPending && genM.variables === 4}>
              <Snowflake className="h-3.5 w-3.5" />
              {draft.volumes?.length ? '重新生成' : '生成卷结构'}
            </Button>
            <span className="text-xs text-gray-500">共 {draft.volumeCount} 卷，生成后可编辑</span>
          </div>
          {(draft.volumes ?? []).map((v, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
              <div className="flex items-center gap-2">
                <Badge variant="default">第{v.volumeNumber ?? i + 1}卷</Badge>
                <Input className="flex-1" value={v.title} onChange={(e) => updateVol(i, { title: e.target.value })} placeholder="卷名" aria-label="卷名" />
              </div>
              <Textarea rows={2} value={v.summary ?? ''} onChange={(e) => updateVol(i, { summary: e.target.value })} placeholder="本卷概述（目标与卷末高潮）" aria-label="卷概述" />
            </div>
          ))}
          {!draft.volumes?.length && <p className="text-xs text-gray-600">暂无，点「生成卷结构」</p>}
        </div>
      )}

      {/* Step5：章节计划 */}
      {draft.step === 5 && (
        <div className="space-y-3">
          {/* REQ-4.2：世界观资产注入勾选（章节 entities 回标仅命中勾选/注入资产） */}
          <details>
            <summary className="cursor-pointer text-xs font-medium text-gray-400 hover:text-indigo-300">
              世界观资产注入（可选，章节出场资产回标以此为准）
            </summary>
            <div className="pt-2">
              <WorldAssetPicker projectId={projectId} enabled value={assetSel} onChange={setAssetSel} />
            </div>
          </details>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => genM.mutate(5)} loading={genM.isPending && genM.variables === 5}>
              <Snowflake className="h-3.5 w-3.5" />
              {draft.volumes?.some((v) => v.chapters?.length) ? '重新生成章节' : '生成章节计划'}
            </Button>
            <span className="text-xs text-gray-500">确认后落库为正式卷章计划（覆盖旧 planned 计划）</span>
          </div>
          {(draft.volumes ?? []).map((v, i) => (
            <div key={i} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
              <div className="flex items-center gap-2">
                <Badge variant="default">第{v.volumeNumber ?? i + 1}卷</Badge>
                <span className="text-sm font-medium text-gray-200">{v.title}</span>
                <span className="text-xs text-gray-600">{v.chapters?.length ?? 0} 章</span>
              </div>
              {!!v.chapters?.length && (
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {v.chapters.map((ch, ci) => (
                    <div key={ci} className="flex items-baseline gap-2 text-xs">
                      <span className="shrink-0 font-mono text-gray-600">#{ch.chapterNumber ?? ci + 1}</span>
                      <span className="shrink-0 text-gray-300">{ch.title}</span>
                      {ch.intent && <span className="truncate text-gray-600">{ch.intent}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 底部操作 */}
      <div className="flex items-center justify-between border-t border-gray-800 pt-3">
        <span className="text-xs text-gray-600">
          {genM.isPending && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
          每步确认后自动保存，中途退出可续进
        </span>
        <div className="flex gap-2">
          {draft.step > 1 && (
            <Button variant="outline" size="sm" onClick={() => setDraft({ ...draft, step: draft.step - 1 })}>
              上一步
            </Button>
          )}
          {draft.step < 5 ? (
            <Button size="sm" disabled={!stepReady} onClick={confirmStep}>
              确认，下一步
            </Button>
          ) : (
            <Button size="sm" disabled={!stepReady} onClick={() => finalizeM.mutate()} loading={finalizeM.isPending}>
              <RefreshCw className="h-3.5 w-3.5" />
              完成并落库
            </Button>
          )}
        </div>
      </div>
    </div>
  )

  // embedded：内嵌于「AI生成大纲」弹窗（REQ-3.2）；否则保持独立 Dialog
  if (embedded) return content

  return (
    <Dialog open onClose={onClose} title="渐进式大纲（雪花法）" className="max-w-3xl">
      {content}
    </Dialog>
  )

  function updateChar(i: number, patch: Partial<SnowflakeCharacter>) {
    setDraft((d) => ({ ...d, characters: (d.characters ?? []).map((c, ci) => (ci === i ? { ...c, ...patch } : c)) }))
  }
  function removeChar(i: number) {
    setDraft((d) => ({ ...d, characters: (d.characters ?? []).filter((_, ci) => ci !== i) }))
  }
  function updateVol(i: number, patch: Partial<SnowflakeVolume>) {
    setDraft((d) => ({ ...d, volumes: (d.volumes ?? []).map((v, vi) => (vi === i ? { ...v, ...patch } : v)) }))
  }
}
