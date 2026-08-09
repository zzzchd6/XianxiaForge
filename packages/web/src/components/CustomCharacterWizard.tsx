/**
 * 自定义人物三步向导（自定义人物模块）
 * 步骤：①种族/定位/姓名/立场 → ②内外性格 → ③先天禀赋
 * 左侧实时预览卡 + 顶部大骰子（跳过锁定项）+ 各项小骰子/锁定按钮 + 扮猪吃虎开关
 */
import { useEffect, useMemo, useState } from 'react'
import {
  RACE_CONFIG,
  findRaceCategory,
  findRaceSub,
  POSITION_OPTIONS,
  findPosition,
  INNER_PERSONALITY_OPTIONS,
  INNER_PERSONALITY_STANCE_SHIFT,
  OUTER_PERSONALITY_OPTIONS,
  OUTER_PERSONALITY_MIN,
  OUTER_PERSONALITY_MAX,
  TALENT_CONFIG,
  TALENT_MIN_COUNT,
  TALENT_MAX_COUNT,
  TALENT_MAX_PER_CATEGORY,
  FLAW_OPTIONS,
  findTalentByName,
  stanceLabel,
  type RandomLocks,
} from '@novel-studio/shared'
import { Dices, Lock, LockOpen, User, Sparkles, Check } from 'lucide-react'
import { Dialog, Button, Switch, useToast, Textarea } from './ui'
import { cn } from '../lib/utils'
import { customCharacterApi } from '../lib/api'

// ---- 表单状态 ----

interface WizardForm {
  name: string
  gender: 'male' | 'female'
  raceCategory: string
  raceSub: string
  position: string
  fakePosition: string | null
  stance: number
  innerPersonality: string
  outerPersonality: string[]
  talents: string[]
}

const DEFAULT_FORM: WizardForm = {
  name: '',
  gender: 'male',
  raceCategory: 'human',
  raceSub: 'commoner',
  position: 'chenjie',
  fakePosition: null,
  stance: 50,
  innerPersonality: '中庸',
  outerPersonality: [],
  talents: [],
}

interface CustomCharacterWizardProps {
  open: boolean
  onClose: () => void
  projectId: string
  /** 编辑模式：传入已有自定义人物（负数ID公开形态） */
  editing?: any | null
  /** 保存成功回调（返回后端公开形态人物） */
  onSaved?: (char: any) => void
}

const STEPS = ['种族与定位', '性格立场', '先天禀赋'] as const

// 天赋稀有度徽标样式
const rarityStyle: Record<string, string> = {
  rare: 'border-seal-500/50 text-[#d98a7c]',
  advanced: 'border-[rgba(192,154,82,0.5)] text-gold-300',
  common: 'border-gray-600 text-gray-400',
}

// 稀有度排序权重：稀有 → 高级 → 普通（同稀有度保持配置库原序）
const RARITY_ORDER: Record<string, number> = { rare: 0, advanced: 1, common: 2 }
const RARITY_LABEL: Record<string, string> = { rare: '稀', advanced: '高', common: '普' }

function sortByRarity<T extends { rarity: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9))
}

export default function CustomCharacterWizard({ open, onClose, projectId, editing, onSaved }: CustomCharacterWizardProps) {
  const { toast } = useToast()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<WizardForm>(DEFAULT_FORM)
  const [locks, setLocks] = useState<RandomLocks>({})
  const [rolling, setRolling] = useState(false)
  const [saving, setSaving] = useState(false)
  const [regenBio, setRegenBio] = useState(false)
  const [aiNaming, setAiNaming] = useState(false)
  const [aiNames, setAiNames] = useState<string[]>([])
  const [smartDesc, setSmartDesc] = useState('')
  const [smartBusy, setSmartBusy] = useState(false)

  // 打开时初始化：编辑模式回填；创建模式先掷一次大骰子
  useEffect(() => {
    if (!open) return
    setStep(0)
    setLocks({})
    setRegenBio(false)
    setAiNames([])
    if (editing) {
      setForm({
        name: editing.name ?? '',
        gender: editing.gender === 'female' ? 'female' : 'male',
        raceCategory: editing.raceCategory ?? 'human',
        raceSub: editing.raceSub ?? 'commoner',
        position: editing.position ?? 'chenjie',
        fakePosition: editing.fakePosition ?? null,
        stance: editing.stance ?? 50,
        innerPersonality: editing.innerPersonality ?? '中庸',
        outerPersonality: editing.outerPersonality ?? [],
        talents: editing.talents ?? [],
      })
    } else {
      setForm(DEFAULT_FORM)
      rollAll({}, DEFAULT_FORM)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  const sub = findRaceSub(form.raceCategory, form.raceSub)
  const category = findRaceCategory(form.raceCategory)
  const pos = findPosition(form.position)
  const positiveTalents = form.talents.filter((t) => !!findTalentByName(t))
  const flawTalents = form.talents.filter((t) => FLAW_OPTIONS.includes(t))

  // 伪装定位候选：仅可选低于真实定位档次
  const fakeOptions = useMemo(
    () => POSITION_OPTIONS.filter((p) => p.rank < (pos?.rank ?? 0)),
    [pos]
  )

  // ---- 随机逻辑（全部走后端保证权重口径唯一） ----

  async function rollAll(useLocks: RandomLocks = locks, current: WizardForm = form) {
    setRolling(true)
    try {
      const draft = await customCharacterApi.random(projectId, { locks: useLocks as any, current })
      setForm((prev) => ({
        ...prev,
        ...draft,
        fakePosition: draft.fakePosition ?? null,
      }))
    } catch (e: any) {
      toast(`随机失败：${e.message}`, 'error')
    } finally {
      setRolling(false)
    }
  }

  /** 以文拟人 · 智能匹配：描述→后端映射合法枚举→回填表单（尊重锁定） */
  async function handleSmartMatch() {
    const desc = smartDesc.trim()
    if (desc.length < 5) { toast('请输入至少 5 个字的描述', 'info'); return }
    setSmartBusy(true)
    try {
      const res: any = await customCharacterApi.smartMatch(projectId, desc)
      setForm((prev) => {
        const next = { ...prev }
        if (!locks.name && res.name) next.name = res.name
        if (!locks.gender && res.gender) next.gender = res.gender
        if (!locks.race && res.raceCategory) {
          next.raceCategory = res.raceCategory
          if (res.raceSub) next.raceSub = res.raceSub
        }
        if (!locks.position && res.position) next.position = res.position
        if (!locks.stance && typeof res.stance === 'number') next.stance = res.stance
        if (!locks.innerPersonality && res.innerPersonality) next.innerPersonality = res.innerPersonality
        if (!locks.outerPersonality && Array.isArray(res.outerPersonality)) next.outerPersonality = res.outerPersonality
        if (!locks.talents && Array.isArray(res.talents)) next.talents = res.talents
        return next
      })
      toast('已按描述匹配参数，可继续微调', 'success')
    } catch (e: any) {
      toast(e.message || '智能匹配失败', 'error')
    } finally {
      setSmartBusy(false)
    }
  }

  /** 局部小骰子：只随机指定字段（其余全部临时锁定） */
  async function rollField(field: keyof RandomLocks) {
    const allLocked: RandomLocks = {
      race: true, position: true, name: true, gender: true,
      stance: true, innerPersonality: true, outerPersonality: true, talents: true,
      [field]: false,
    }
    await rollAll(allLocked, form)
  }

  /** 姓名小骰子：按当前种族+性别的姓名库规则（定位/立场参与风格轻度倾斜） */
  async function rollName() {
    setRolling(true)
    try {
      const data = await customCharacterApi.randomName(projectId, {
        raceCategory: form.raceCategory,
        raceSub: form.raceSub,
        gender: form.gender,
        position: form.position,
        stance: form.stance,
      })
      setForm((prev) => ({ ...prev, name: data.name }))
    } catch (e: any) {
      toast(`随机姓名失败：${e.message}`, 'error')
    } finally {
      setRolling(false)
    }
  }

  /** AI精取名：LLM出5候选供挑选（失败后端自动回落本地生成） */
  async function rollAiNames() {
    setAiNaming(true)
    try {
      const data = await customCharacterApi.aiName(projectId, {
        raceCategory: form.raceCategory,
        raceSub: form.raceSub,
        gender: form.gender,
        position: form.position,
        stance: form.stance,
      })
      setAiNames(data.names ?? [])
      if (data.source === 'local') toast('AI暂不可用，已用本地名库生成候选', 'info')
    } catch (e: any) {
      toast(`AI取名失败：${e.message}`, 'error')
    } finally {
      setAiNaming(false)
    }
  }

  /** 分类骰子：按稀有度权重随机该分类一条，替换/追加到已选 */
  async function rollTalentCategory(categoryId: string) {
    setRolling(true)
    try {
      const data = await customCharacterApi.random(projectId, {
        talentCategory: categoryId,
        excludeTalents: form.talents,
      })
      const name: string = data.talent
      setForm((prev) => {
        const positives = prev.talents.filter((t) => !!findTalentByName(t))
        const flaws = prev.talents.filter((t) => FLAW_OPTIONS.includes(t))
        const inCat = positives.filter((t) => findTalentByName(t)?.category.id === categoryId)
        let nextPositives: string[]
        if (inCat.length >= TALENT_MAX_PER_CATEGORY) {
          // 该分类已满2个：替换该分类最后一个
          nextPositives = positives.map((t) => (t === inCat[inCat.length - 1] ? name : t))
        } else if (positives.length >= TALENT_MAX_COUNT) {
          // 已达总上限：替换最后选的一个
          nextPositives = [...positives.slice(0, -1), name]
        } else {
          nextPositives = [...positives, name]
        }
        return { ...prev, talents: [...nextPositives, ...flaws] }
      })
    } catch (e: any) {
      toast(`随机天赋失败：${e.message}`, 'error')
    } finally {
      setRolling(false)
    }
  }

  // ---- 交互逻辑 ----

  /** 内在性格联动立场：换算偏移差值后 clamp 0-100 */
  function selectInner(inner: string) {
    setForm((prev) => {
      const oldShift = INNER_PERSONALITY_STANCE_SHIFT[prev.innerPersonality as keyof typeof INNER_PERSONALITY_STANCE_SHIFT] ?? 0
      const newShift = INNER_PERSONALITY_STANCE_SHIFT[inner as keyof typeof INNER_PERSONALITY_STANCE_SHIFT] ?? 0
      const stance = Math.max(0, Math.min(100, prev.stance - oldShift + newShift))
      return { ...prev, innerPersonality: inner, stance }
    })
  }

  function toggleOuter(tag: string) {
    setForm((prev) => {
      if (prev.outerPersonality.includes(tag)) {
        return { ...prev, outerPersonality: prev.outerPersonality.filter((t) => t !== tag) }
      }
      if (prev.outerPersonality.length >= OUTER_PERSONALITY_MAX) {
        toast(`外在性格最多选${OUTER_PERSONALITY_MAX}个`, 'info')
        return prev
      }
      return { ...prev, outerPersonality: [...prev.outerPersonality, tag] }
    })
  }

  function toggleTalent(name: string) {
    setForm((prev) => {
      if (prev.talents.includes(name)) {
        return { ...prev, talents: prev.talents.filter((t) => t !== name) }
      }
      const found = findTalentByName(name)
      if (found) {
        const positives = prev.talents.filter((t) => !!findTalentByName(t))
        if (positives.length >= TALENT_MAX_COUNT) {
          toast(`正向天赋最多选${TALENT_MAX_COUNT}个`, 'info')
          return prev
        }
        const inCat = positives.filter((t) => findTalentByName(t)?.category.id === found.category.id)
        if (inCat.length >= TALENT_MAX_PER_CATEGORY) {
          toast(`「${found.category.name}」类最多选${TALENT_MAX_PER_CATEGORY}个`, 'info')
          return prev
        }
      } else if (FLAW_OPTIONS.includes(name)) {
        if (prev.talents.some((t) => FLAW_OPTIONS.includes(t))) {
          toast('小缺陷最多选1个', 'info')
          return prev
        }
      }
      return { ...prev, talents: [...prev.talents, name] }
    })
  }

  function selectRaceSub(catId: string, subId: string) {
    setForm((prev) => ({ ...prev, raceCategory: catId, raceSub: subId }))
  }

  function selectPosition(key: string) {
    setForm((prev) => {
      const realRank = findPosition(key)?.rank ?? 0
      const fakeRank = prev.fakePosition ? findPosition(prev.fakePosition)?.rank ?? 0 : 0
      // 真实定位下调后伪装定位不再低于真实档次时自动清空
      return { ...prev, position: key, fakePosition: fakeRank >= realRank ? null : prev.fakePosition }
    })
  }

  // ---- 校验与保存 ----

  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!form.name.trim()) return '请填写姓名'
      if (!sub) return '请选择种族'
    }
    if (s === 1) {
      if (form.outerPersonality.length < OUTER_PERSONALITY_MIN) return `外在性格至少选${OUTER_PERSONALITY_MIN}个`
    }
    if (s === 2) {
      if (positiveTalents.length < TALENT_MIN_COUNT) return `正向天赋至少选${TALENT_MIN_COUNT}个`
      if (positiveTalents.length > TALENT_MAX_COUNT) return `正向天赋最多选${TALENT_MAX_COUNT}个`
    }
    return null
  }

  function nextStep() {
    const err = validateStep(step)
    if (err) return toast(err, 'error')
    setStep((s) => Math.min(s + 1, 2))
  }

  async function save() {
    for (let s = 0; s <= 2; s++) {
      const err = validateStep(s)
      if (err) return toast(err, 'error')
    }
    setSaving(true)
    try {
      const payload = { ...form, name: form.name.trim() }
      const saved = editing
        ? await customCharacterApi.update(projectId, editing.id, { ...payload, regenerateBio: regenBio })
        : await customCharacterApi.create(projectId, payload)
      toast(editing ? '人物已更新' : '人物已创建，小传已生成', 'success')
      onSaved?.(saved)
      onClose()
    } catch (e: any) {
      toast(`保存失败：${e.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  // ---- 小部件 ----

  function LockButton({ field }: { field: keyof RandomLocks }) {
    const locked = !!locks[field]
    return (
      <button
        type="button"
        title={locked ? '已锁定（大骰子跳过此项）' : '未锁定'}
        aria-label="锁定"
        aria-pressed={locked}
        onClick={() => setLocks((prev) => ({ ...prev, [field]: !locked }))}
        className={cn(
          'rounded p-2 transition-colors',
          locked ? 'text-gold-300 bg-gold-500/10' : 'text-gray-500 hover:text-gray-300'
        )}
      >
        {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
      </button>
    )
  }

  function DiceButton({ onClick, title }: { onClick: () => void; title: string }) {
    return (
      <button
        type="button"
        title={title}
        aria-label="随机生成"
        disabled={rolling}
        onClick={onClick}
        className="rounded p-2 text-gold-300/70 hover:text-gold-300 hover:bg-gold-500/10 transition-colors disabled:opacity-40"
      >
        <Dices className="h-3.5 w-3.5" />
      </button>
    )
  }

  const chipBase = 'cursor-pointer rounded border px-2 py-0.5 text-xs transition-colors select-none'
  const chipOn = 'border-gold-500/60 bg-gold-500/15 text-gold-300'
  const chipOff = 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'

  return (
    <Dialog open={open} onClose={onClose} title={editing ? '编辑自定义人物' : '创建自定义人物'} className="max-w-4xl">
      <div className="flex gap-5 max-h-[72vh]">
        {/* ===== 左侧预览卡 ===== */}
        <div className="w-60 shrink-0 flex flex-col gap-3 rounded-xl border border-[rgba(192,154,82,0.25)] bg-gray-900/60 p-4 overflow-y-auto">
          <div className="flex flex-col gap-2 rounded-lg border border-gray-700/60 bg-gray-900/40 p-2">
            <div className="text-[11px] uppercase tracking-wider text-gray-500">以文拟人 · 智能匹配</div>
            <Textarea
              rows={3}
              placeholder="描述你想要的人物，如「冷面剑修，外冷内热，身负血海深仇」…"
              aria-label="智能匹配"
              value={smartDesc}
              onChange={(e) => setSmartDesc(e.target.value)}
            />
            <Button size="sm" onClick={handleSmartMatch} loading={smartBusy} className="w-full">
              <Sparkles className="h-4 w-4" /> 智能匹配参数
            </Button>
          </div>
          <Button size="sm" onClick={() => rollAll()} loading={rolling} className="w-full">
            <Dices className="h-4 w-4" /> 一键全随机
          </Button>
          <div className="flex items-center gap-2">
            <User className="h-8 w-8 text-gold-300/70 shrink-0" />
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-gold-300 title-serif">
                {form.name || '未命名'}
                <span className="ml-1 text-xs text-gray-500">{form.gender === 'male' ? '♂' : '♀'}</span>
              </div>
              <div className="text-xs text-gray-400">{category?.name ?? ''}·{sub?.name ?? ''}</div>
            </div>
          </div>
          <div className="text-xs text-gray-300">
            定位：<span className="text-gold-300">{pos?.name ?? ''}</span>
            {form.fakePosition && (
              <span className="ml-1 text-seal-500 text-[#d98a7c]">（伪装「{findPosition(form.fakePosition)?.name}」）</span>
            )}
          </div>
          {/* 立场进度条 */}
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-gray-500">
              <span>浩然正气</span>
              <span className="text-gray-300">{stanceLabel(form.stance)} {form.stance}</span>
              <span>邪异诡道</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-800">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#7ec8a9,#cfaf6e,#b56a5f)]"
                style={{ width: `${Math.max(form.stance, 2)}%` }}
              />
            </div>
          </div>
          {sub && (
            <div className="space-y-1 text-xs">
              <div className="text-emerald-300/90">擅长：{sub.strengths.join('、')}</div>
              <div className="text-[#d98a7c]">短板：{sub.weaknesses.join('、')}</div>
            </div>
          )}
          <div className="text-xs text-gray-300">
            性格：<span className="text-gray-100">{form.innerPersonality}</span>
            {form.outerPersonality.length > 0 && (
              <span className="text-gray-400">｜{form.outerPersonality.join('、')}</span>
            )}
          </div>
          {form.talents.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {form.talents.map((t) => {
                const found = findTalentByName(t)
                return (
                  <span
                    key={t}
                    title={found?.entry.desc ?? '小缺陷'}
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[11px]',
                      found ? rarityStyle[found.entry.rarity] : 'border-gray-600 text-gray-500'
                    )}
                  >
                    {t}
                  </span>
                )
              })}
            </div>
          )}
          {/* 扮猪吃虎 */}
          <div className="mt-auto space-y-2 border-t border-gray-800 pt-3">
            <Switch
              checked={form.fakePosition != null}
              disabled={fakeOptions.length === 0}
              onChange={(on) =>
                setForm((prev) => ({ ...prev, fakePosition: on ? fakeOptions[0]?.key ?? null : null }))
              }
              label="扮猪吃虎"
            />
            {form.fakePosition != null && (
              <select
                value={form.fakePosition}
                onChange={(e) => setForm((prev) => ({ ...prev, fakePosition: e.target.value }))}
                aria-label="伪装定位"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100"
              >
                {fakeOptions.map((p) => (
                  <option key={p.key} value={p.key}>伪装为「{p.name}」</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* ===== 右侧步骤区 ===== */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 步骤指示 */}
          <div className="mb-3 flex items-center gap-2">
            {STEPS.map((label, i) => (
              <button
                key={label}
                onClick={() => i < step && setStep(i)}
                aria-current={i === step ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors',
                  i === step
                    ? 'bg-gold-500/15 text-gold-300 border border-gold-500/40'
                    : i < step
                      ? 'text-gold-300/70 hover:text-gold-300 cursor-pointer'
                      : 'text-gray-500'
                )}
              >
                <span className="font-semibold">{i + 1}</span> {label}
              </button>
            ))}
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {/* ---- 第一步：种族/定位/姓名/立场 ---- */}
            {step === 0 && (
              <>
                {/* 性别 + 姓名 */}
                <div className="flex items-end gap-3">
                  <div className="flex rounded-lg border border-gray-700 p-0.5">
                    {(['male', 'female'] as const).map((g) => (
                      <button
                        key={g}
                        onClick={() => setForm((prev) => ({ ...prev, gender: g }))}
                        aria-pressed={form.gender === g}
                        className={cn(
                          'rounded-md px-3 py-1.5 text-xs transition-colors',
                          form.gender === g ? 'bg-gold-500/15 text-gold-300' : 'text-gray-400 hover:text-gray-200'
                        )}
                      >
                        {g === 'male' ? '男' : '女'}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-1 text-xs text-gray-400">
                      姓名 <DiceButton onClick={rollName} title="按当前种族姓名库随机" /> <LockButton field="name" />
                      <LockButton field="gender" />
                      <button
                        type="button"
                        onClick={rollAiNames}
                        disabled={aiNaming}
                        title="AI按种族/定位/立场精取5个候选名"
                        aria-label="AI取名"
                        className={cn(
                          'ml-auto flex items-center gap-0.5 rounded border border-gold-500/40 px-2.5 py-1.5 text-[11px] text-gold-300 transition-colors hover:bg-gold-500/10',
                          aiNaming && 'cursor-wait opacity-60'
                        )}
                      >
                        <Sparkles size={11} /> {aiNaming ? '取名中…' : 'AI取名'}
                      </button>
                    </div>
                    <input
                      value={form.name}
                      onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="输入姓名或掷骰子"
                      aria-label="角色名"
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 placeholder:text-gray-500 focus:border-gold-500/60"
                    />
                    {aiNames.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {aiNames.map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => {
                              setForm((prev) => ({ ...prev, name: n }))
                              setAiNames([])
                            }}
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-xs transition-colors',
                              n === form.name
                                ? 'border-gold-500/70 bg-gold-500/15 text-gold-200'
                                : 'border-gray-600 text-gray-300 hover:border-gold-500/50 hover:text-gold-300'
                            )}
                          >
                            {n}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setAiNames([])}
                          className="text-[11px] text-gray-500 hover:text-gray-300"
                        >
                          收起
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 种族：7大类Tab + 小类标签 */}
                <div>
                  <div className="mb-1.5 flex items-center gap-1 text-xs text-gray-400">
                    种族（7大类56小类） <DiceButton onClick={() => rollField('race')} title="随机种族" /> <LockButton field="race" />
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {RACE_CONFIG.map((cat) => (
                      <button
                        key={cat.id}
                        title={cat.desc}
                        onClick={() => selectRaceSub(cat.id, cat.subs[0].id)}
                        className={cn(chipBase, form.raceCategory === cat.id ? chipOn : chipOff)}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(findRaceCategory(form.raceCategory)?.subs ?? []).map((s) => (
                      <button
                        key={s.id}
                        title={`${s.desc}\n擅长：${s.strengths.join('、')}\n短板：${s.weaknesses.join('、')}`}
                        onClick={() => selectRaceSub(form.raceCategory, s.id)}
                        className={cn(chipBase, form.raceSub === s.id ? chipOn : chipOff)}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 五档定位 */}
                <div>
                  <div className="mb-1.5 flex items-center gap-1 text-xs text-gray-400">
                    实力定位（模糊体感，不设具体境界） <DiceButton onClick={() => rollField('position')} title="随机定位" /> <LockButton field="position" />
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {POSITION_OPTIONS.map((p) => (
                      <button
                        key={p.key}
                        title={p.desc}
                        onClick={() => selectPosition(p.key)}
                        className={cn(
                          'rounded-lg border px-2 py-2 text-center transition-colors',
                          form.position === p.key
                            ? 'border-gold-500/60 bg-gold-500/15 text-gold-300'
                            : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                        )}
                      >
                        <div className="text-sm font-semibold title-serif">{p.name}</div>
                        <div className="mt-0.5 text-[10px] leading-tight text-gray-500 line-clamp-2">{p.desc.split('，')[0]}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 立场滑条 */}
                <div>
                  <div className="mb-1.5 flex items-center gap-1 text-xs text-gray-400">
                    立场（0=浩然正气 50=随心所欲 100=邪异诡道） <DiceButton onClick={() => rollField('stance')} title="随机立场" /> <LockButton field="stance" />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={form.stance}
                    onChange={(e) => setForm((prev) => ({ ...prev, stance: Number(e.target.value) }))}
                    aria-label="立场"
                    className="w-full accent-[#cfaf6e]"
                  />
                </div>
              </>
            )}

            {/* ---- 第二步：内在/外在性格 ---- */}
            {step === 1 && (
              <>
                <div>
                  <div className="mb-1.5 flex items-center gap-1 text-xs text-gray-400">
                    内在性格（单选，决定核心三观，联动立场±15） <DiceButton onClick={() => rollField('innerPersonality')} title="随机内在性格" /> <LockButton field="innerPersonality" />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {INNER_PERSONALITY_OPTIONS.map((p) => (
                      <button
                        key={p}
                        onClick={() => selectInner(p)}
                        className={cn(chipBase, 'px-3 py-1', form.innerPersonality === p ? chipOn : chipOff)}
                      >
                        {p}
                        <span className="ml-1 text-[10px] opacity-60">
                          {INNER_PERSONALITY_STANCE_SHIFT[p] > 0 ? `+${INNER_PERSONALITY_STANCE_SHIFT[p]}` : INNER_PERSONALITY_STANCE_SHIFT[p] || '±0'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center gap-1 text-xs text-gray-400">
                    外在性格（多选{OUTER_PERSONALITY_MIN}-{OUTER_PERSONALITY_MAX}个，决定日常行为，接入OOC审计）
                    <DiceButton onClick={() => rollField('outerPersonality')} title="随机外在性格" /> <LockButton field="outerPersonality" />
                    <span className="ml-auto text-gold-300/80">{form.outerPersonality.length}/{OUTER_PERSONALITY_MAX}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {OUTER_PERSONALITY_OPTIONS.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => toggleOuter(tag)}
                        className={cn(chipBase, 'px-3 py-1', form.outerPersonality.includes(tag) ? chipOn : chipOff)}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ---- 第三步：先天禀赋 ---- */}
            {step === 2 && (
              <>
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  选{TALENT_MIN_COUNT}-{TALENT_MAX_COUNT}个正向天赋（每类最多{TALENT_MAX_PER_CATEGORY}个）+ 可选1个小缺陷
                  <DiceButton onClick={() => rollField('talents')} title="随机全部天赋" /> <LockButton field="talents" />
                  <span className="ml-auto text-gold-300/80">已选 {positiveTalents.length}/{TALENT_MAX_COUNT} 正向{flawTalents.length ? ' +1缺陷' : ''}</span>
                </div>
                {TALENT_CONFIG.map((cat) => (
                  <div key={cat.id}>
                    <div className="mb-1.5 flex items-center gap-1 text-xs text-gray-300">
                      <Sparkles className="h-3 w-3 text-gold-300/60" /> {cat.name}
                      <DiceButton onClick={() => rollTalentCategory(cat.id)} title={`按稀有度权重随机一条${cat.name}`} />
                      <span className="text-[10px] text-gray-500">（稀有10%/高级30%/普通60%）</span>
                    </div>
                    <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto rounded-lg border border-gray-800 bg-gray-900/40 p-2">
                      {sortByRarity(cat.entries).map((entry) => {
                        const selected = form.talents.includes(entry.name)
                        return (
                          <button
                            key={entry.name}
                            title={`【${RARITY_LABEL[entry.rarity] ?? ''}】${entry.desc}`}
                            onClick={() => toggleTalent(entry.name)}
                            className={cn(
                              'inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[11px] transition-all',
                              selected
                                ? 'border-gold-300 bg-[linear-gradient(120deg,#cfaf6e,#a8833f)] font-semibold text-[#241b08] shadow-[0_0_10px_rgba(207,175,110,0.45)] scale-105'
                                : cn(rarityStyle[entry.rarity], 'opacity-75 hover:opacity-100 hover:bg-white/[0.04]')
                            )}
                          >
                            {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                            {entry.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
                <div>
                  <div className="mb-1.5 text-xs text-gray-400">小缺陷（可选1个，让人物更鲜活）</div>
                  <div className="flex flex-wrap gap-1.5">
                    {FLAW_OPTIONS.map((f) => {
                      const selected = form.talents.includes(f)
                      return (
                        <button
                          key={f}
                          onClick={() => toggleTalent(f)}
                          className={cn(
                            chipBase, 'inline-flex items-center gap-0.5 transition-all',
                            selected
                              ? 'border-gold-300 bg-[linear-gradient(120deg,#cfaf6e,#a8833f)] font-semibold text-[#241b08] shadow-[0_0_10px_rgba(207,175,110,0.45)] scale-105'
                              : chipOff
                          )}
                        >
                          {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                          {f}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {editing && (
                  <Switch checked={regenBio} onChange={setRegenBio} label="保存后重新生成人物小传" />
                )}
              </>
            )}
          </div>

          {/* 底部导航 */}
          <div className="mt-4 flex items-center justify-between border-t border-gray-800 pt-3">
            <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
            <div className="flex gap-2">
              {step > 0 && (
                <Button variant="outline" size="sm" onClick={() => setStep((s) => s - 1)}>上一步</Button>
              )}
              {step < 2 ? (
                <Button size="sm" onClick={nextStep}>下一步</Button>
              ) : (
                <Button size="sm" onClick={save} loading={saving}>
                  {saving ? '生成小传中…' : editing ? '保存修改' : '保存人物'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
