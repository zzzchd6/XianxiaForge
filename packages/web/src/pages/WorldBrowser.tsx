import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Search, Users, Shield, MapPin, Zap, Gem, Bug, FlaskConical, Package,
  ScrollText, CalendarDays, Network, Sparkles, Feather, Brain, Route,
  Layers, ArrowRight, Landmark, Plus, Pencil, Trash2, BookOpen,
  FolderInput, ChevronDown,
} from 'lucide-react'
import {
  Card, CardContent, Badge, Input, Textarea, Button, Spinner, EmptyState, Dialog, useToast,
  Select, Switch,
} from '../components/ui'
import { worldApi, chaptersApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import { findPosition, findRaceCategory, findRaceSub, stanceLabel } from '@xianxiaforge/shared'
import { cn } from '../lib/utils'
import RelationPanel from '../components/RelationPanel'
import RelationGraph from '../components/RelationGraph'

/* ------------------------------------------------------------------ */
/* 配置                                                                */
/* ------------------------------------------------------------------ */

type SectionId = 'bestiary' | 'rules' | 'events' | 'style' | 'graph'

const sections: { id: SectionId; label: string; en: string; icon: any; desc: string }[] = [
  { id: 'bestiary', label: '实体图鉴', en: 'BESTIARY', icon: Layers, desc: '人物·门派·地点·功法·法宝·妖兽·丹药·日常' },
  { id: 'graph', label: '关系图谱', en: 'RELATION GRAPH', icon: Network, desc: '人物关系网络·力导向可视化' },
  { id: 'rules', label: '宗门规制', en: 'SECT RULES', icon: ScrollText, desc: '门规·作息·层级·奖惩' },
  { id: 'events', label: '岁时节令', en: 'SEASONAL EVENTS', icon: CalendarDays, desc: '宗门大典·世俗节日·四季物候' },
  { id: 'style', label: '文风引擎', en: 'STYLE ENGINE', icon: Feather, desc: '萧鼎仙侠风格铁律与场景映射' },
]

interface CatConfig {
  id: string
  label: string
  icon: any
  statKey: string
  text: string
  chip: string
  ring: string
  bar: string
}

const entityCategories: CatConfig[] = [
  { id: 'characters', label: '人物', icon: Users, statKey: 'characters', text: 'text-emerald-300', chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', ring: 'hover:border-emerald-500/60', bar: 'bg-emerald-400' },
  { id: 'factions', label: '门派', icon: Shield, statKey: 'factions', text: 'text-amber-300', chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30', ring: 'hover:border-amber-500/60', bar: 'bg-amber-400' },
  { id: 'locations', label: '地点', icon: MapPin, statKey: 'locations', text: 'text-sky-300', chip: 'bg-sky-500/15 text-sky-300 border-sky-500/30', ring: 'hover:border-sky-500/60', bar: 'bg-sky-400' },
  { id: 'skills', label: '功法', icon: Zap, statKey: 'skills', text: 'text-violet-300', chip: 'bg-violet-500/15 text-violet-300 border-violet-500/30', ring: 'hover:border-violet-500/60', bar: 'bg-violet-400' },
  { id: 'items', label: '法宝', icon: Gem, statKey: 'items', text: 'text-cyan-300', chip: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30', ring: 'hover:border-cyan-500/60', bar: 'bg-cyan-400' },
  { id: 'monsters', label: '妖兽', icon: Bug, statKey: 'monsters', text: 'text-rose-300', chip: 'bg-rose-500/15 text-rose-300 border-rose-500/30', ring: 'hover:border-rose-500/60', bar: 'bg-rose-400' },
  { id: 'materials', label: '丹药灵材', icon: FlaskConical, statKey: 'materials', text: 'text-lime-300', chip: 'bg-lime-500/15 text-lime-300 border-lime-500/30', ring: 'hover:border-lime-500/60', bar: 'bg-lime-400' },
  { id: 'daily', label: '日常信物', icon: Package, statKey: 'dailyItems', text: 'text-teal-300', chip: 'bg-teal-500/15 text-teal-300 border-teal-500/30', ring: 'hover:border-teal-500/60', bar: 'bg-teal-400' },
]

const mappingTypeLabels: Record<string, string> = {
  emotion: '情绪',
  scene_function: '场景功能',
  conflict_level: '冲突烈度',
  character_perspective: '人物视角',
  story_stage: '故事阶段',
}

const severityVariant: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = {
  轻微: 'success',
  一般: 'default',
  严重: 'warning',
  极重: 'destructive',
}

/** 分类 id → 后端 API collection 名*/
const collectionMap: Record<string, string> = {
  characters: 'characters',
  factions: 'factions',
  locations: 'locations',
  skills: 'skills',
  items: 'items',
  monsters: 'monsters',
  materials: 'materials',
  daily: 'daily-items',
  'faction-rules': 'faction-rules',
  'season-events': 'season-events',
}

/** 表单字段定义 */
interface FieldDef {
  key: string
  label: string
  type: 'text' | 'textarea' | 'array'  // array = 逗号分隔 → text[]
  required?: boolean
  placeholder?: string
}

const formFields: Record<string, FieldDef[]> = {
  characters: [
    { key: 'name', label: '姓名', type: 'text', required: true },
    { key: 'realm', label: '境界', type: 'text' },
    { key: 'faction', label: '门派', type: 'text' },
    { key: 'combatType', label: '战斗类型', type: 'text' },
    { key: 'personality', label: '性格', type: 'textarea' },
    { key: 'allTitles', label: '别称', type: 'array', placeholder: '逗号分隔' },
    { key: 'coreSkills', label: '核心功法', type: 'array', placeholder: '逗号分隔' },
    { key: 'growthLine', label: '成长线', type: 'array', placeholder: '逗号分隔' },
    { key: 'plotTags', label: '情节标签', type: 'array', placeholder: '逗号分隔' },
    { key: 'exclusiveItems', label: '专属法宝', type: 'array', placeholder: '逗号分隔' },
  ],
  factions: [
    { key: 'name', label: '门派名', type: 'text', required: true },
    { key: 'camp', label: '阵营', type: 'text' },
    { key: 'leader', label: '掌门', type: 'text' },
    { key: 'headquarters', label: '总部', type: 'text' },
    { key: 'townTreasure', label: '镇派之宝', type: 'text' },
    { key: 'cultivationFeature', label: '修炼特点', type: 'textarea' },
    { key: 'forceRelations', label: '势力关系', type: 'array', placeholder: '逗号分隔' },
  ],
  locations: [
    { key: 'name', label: '地点名', type: 'text', required: true },
    { key: 'level', label: '级别', type: 'text' },
    { key: 'parentRegion', label: '上级区域', type: 'text' },
    { key: 'relatedFaction', label: '关联门派', type: 'text' },
    { key: 'environment', label: '环境', type: 'textarea' },
    { key: 'keyEvents', label: '关键事件', type: 'array', placeholder: '逗号分隔' },
    { key: 'dangerLevel', label: '危险等级', type: 'text' },
    { key: 'specialFunctions', label: '特殊功能', type: 'textarea' },
  ],
  skills: [
    { key: 'name', label: '功法名', type: 'text', required: true },
    { key: 'grade', label: '品阶', type: 'text' },
    { key: 'faction', label: '所属门派', type: 'text' },
    { key: 'skillType', label: '类型', type: 'text' },
    { key: 'threshold', label: '修炼门槛', type: 'textarea' },
    { key: 'coreEffect', label: '核心效果', type: 'textarea' },
    { key: 'counter', label: '克制', type: 'textarea' },
    { key: 'famousUsage', label: '著名使用', type: 'array', placeholder: '逗号分隔' },
  ],
  items: [
    { key: 'name', label: '法宝名', type: 'text', required: true },
    { key: 'grade', label: '品阶', type: 'text' },
    { key: 'system', label: '体系', type: 'text' },
    { key: 'owners', label: '持有者', type: 'array', placeholder: '逗号分隔' },
    { key: 'appearance', label: '外观', type: 'textarea' },
    { key: 'coreAbilities', label: '核心能力', type: 'textarea' },
    { key: 'useLimit', label: '使用限制', type: 'textarea' },
    { key: 'evolution', label: '进化', type: 'textarea' },
    { key: 'relatedPlots', label: '相关情节', type: 'array', placeholder: '逗号分隔' },
  ],
  monsters: [
    { key: 'name', label: '妖兽名', type: 'text', required: true },
    { key: 'level', label: '等级', type: 'text' },
    { key: 'race', label: '种族', type: 'text' },
    { key: 'habitat', label: '栖息地', type: 'text' },
    { key: 'coreAbilities', label: '核心能力', type: 'array', placeholder: '逗号分隔' },
    { key: 'combatLevel', label: '战斗力', type: 'text' },
    { key: 'relatedPlot', label: '相关情节', type: 'textarea' },
  ],
  materials: [
    { key: 'name', label: '名称', type: 'text', required: true },
    { key: 'itemType', label: '类别', type: 'text' },
    { key: 'grade', label: '品阶', type: 'text' },
    { key: 'coreEffect', label: '核心功效', type: 'textarea' },
    { key: 'sideEffect', label: '副作用', type: 'textarea' },
    { key: 'origin', label: '产地', type: 'text' },
    { key: 'usageScene', label: '使用场景', type: 'array', placeholder: '逗号分隔' },
  ],
  daily: [
    { key: 'name', label: '名称', type: 'text', required: true },
    { key: 'itemType', label: '类别', type: 'text' },
    { key: 'grade', label: '品阶', type: 'text' },
    { key: 'relatedFaction', label: '关联门派', type: 'text' },
    { key: 'material', label: '材质', type: 'text' },
    { key: 'appearance', label: '外观', type: 'textarea' },
    { key: 'usageScene', label: '使用场景', type: 'array', placeholder: '逗号分隔' },
    { key: 'emotionalTag', label: '情绪标签', type: 'array', placeholder: '逗号分隔' },
  ],
  'faction-rules': [
    { key: 'ruleName', label: '规制名', type: 'text', required: true },
    { key: 'ruleType', label: '类型', type: 'text' },
    { key: 'factionName', label: '所属门派', type: 'text' },
    { key: 'ruleContent', label: '内容', type: 'textarea' },
    { key: 'severity', label: '严重程度', type: 'text' },
    { key: 'enforcement', label: '执行方式', type: 'textarea' },
    { key: 'relatedPlots', label: '相关情节', type: 'array', placeholder: '逗号分隔' },
  ],
  'season-events': [
    { key: 'eventName', label: '事件名', type: 'text', required: true },
    { key: 'eventType', label: '类型', type: 'text' },
    { key: 'cycleDescription', label: '周期描述', type: 'text' },
    { key: 'relatedFaction', label: '关联门派', type: 'text' },
    { key: 'atmosphere', label: '氛围', type: 'textarea' },
    { key: 'traditions', label: '传统习俗', type: 'array', placeholder: '逗号分隔' },
    { key: 'relatedPlots', label: '相关情节', type: 'array', placeholder: '逗号分隔' },
  ],
}

/* ------------------------------------------------------------------ */
/* 数据获取：把某个集合的所有分页一次拉全（客户端过滤）                  */
/* ------------------------------------------------------------------ */

function useAllRows(key: string, bookId: number, fetchFn: (params: any) => Promise<any[]>) {
  return useQuery({
    queryKey: ['world-all', key, bookId],
    queryFn: async () => {
      const pageSize = 100
      let page = 1
      let all: any[] = []
      for (;;) {
        const batch = await fetchFn({ page, pageSize, bookId })
        all = all.concat(batch || [])
        if (!batch || batch.length < pageSize) break
        page += 1
        if (page > 10) break
      }
      return all
    },
    staleTime: 5 * 60 * 1000,
  })
}

const listFetchers: Record<string, (params: any) => Promise<any[]>> = {
  characters: (p) => worldApi.characters(p),
  factions: (p) => worldApi.factions(p),
  locations: (p) => worldApi.locations(p),
  skills: (p) => worldApi.skills(p),
  items: (p) => worldApi.items(p),
  monsters: (p) => worldApi.monsters(p),
  materials: (p) => worldApi.materials(p),
  daily: (p) => worldApi.dailyItems(p),
}

/* ------------------------------------------------------------------ */
/* 小工具组件                                                         */
/* ------------------------------------------------------------------ */

function DetailField({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined || value === '') return null
  const display = Array.isArray(value) ? value.filter(Boolean).join('、') : String(value)
  if (!display) return null
  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="text-sm leading-relaxed text-gray-200">{display}</dd>
    </div>
  )
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs', className)}>
      {children}
    </span>
  )
}

function SectionHeading({ title, en, desc }: { title: string; en: string; desc?: string }) {
  return (
    <div className="flex items-end gap-3">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-gray-600">{en}</div>
        <h2 className="font-serif text-2xl font-bold text-gray-100">{title}</h2>
      </div>
      {desc && <p className="mb-1 hidden text-xs text-gray-500 sm:block">{desc}</p>}
    </div>
  )
}

/** 把实体压缩成卡片摘要 */
function summarize(cat: string, e: any): { badge?: string; desc?: string; sub?: string } {
  switch (cat) {
    case 'characters': return { badge: e.realm, desc: e.personality, sub: e.faction }
    case 'factions': return { badge: e.camp, desc: e.cultivationFeature, sub: e.headquarters }
    case 'locations': return { badge: e.level, desc: e.environment, sub: e.relatedFaction }
    case 'skills': return { badge: e.grade, desc: e.coreEffect, sub: e.faction }
    case 'items': return { badge: e.grade, desc: e.coreAbilities, sub: e.owners }
    case 'monsters': return { badge: e.level, desc: e.coreAbilities, sub: e.habitat }
    case 'materials': return { badge: e.itemType, desc: e.coreEffect, sub: e.origin }
    case 'daily': return { badge: e.itemType, desc: e.appearance, sub: (e.emotionalTag || []).filter(Boolean).join(' · ') }
    default: return {}
  }
}

/* ------------------------------------------------------------------ */
/* 新增/编辑 表单弹窗                                                  */
/* ------------------------------------------------------------------ */

function EntityFormDialog({
  collection,
  categoryLabel,
  entity,
  bookId,
  onClose,
  onSaved,
}: {
  collection: string
  categoryLabel: string
  entity?: any  // 有则编辑模式，无则新增模式
  bookId: number
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const fields = formFields[collection] || []
  const isEdit = !!entity

  // 初始化表单值
  const [form, setForm] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of fields) {
      const val = entity?.[f.key]
      if (f.type === 'array') {
        init[f.key] = Array.isArray(val) ? val.filter(Boolean).join(', ') : (val || '')
      } else {
        init[f.key] = val != null ? String(val) : ''
      }
    }
    return init
  })
  const [saving, setSaving] = useState(false)

  const setField = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = async () => {
    // 构建提交数据
    const data: Record<string, any> = {}
    for (const f of fields) {
      const raw = (form[f.key] || '').trim()
      if (!raw) continue
      if (f.type === 'array') {
        data[f.key] = raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
      } else {
        data[f.key] = raw
      }
    }

    // 校验必填
    const requiredField = fields.find((f) => f.required)
    if (requiredField && !data[requiredField.key]) {
      toast(`请填写{requiredField.label}`, 'error')
      return
    }

    setSaving(true)
    try {
      if (isEdit) {
        await worldApi.update(collection, entity.id, data)
        toast(`${categoryLabel}「${data[requiredField?.key || 'name'] || entity.name}」已更新`, 'success')
      } else {
        await worldApi.create(collection, { ...data, bookId })
        toast(`${categoryLabel}「${data[requiredField?.key || 'name']}」已创建`, 'success')
      }
      onSaved()
      onClose()
    } catch (err: any) {
      toast(err.message || '操作失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={isEdit ? `编辑${categoryLabel}` : `新增${categoryLabel}`} className="max-w-2xl">
      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
        {fields.map((f) =>
          f.type === 'textarea' ? (
            <Textarea
              key={f.key}
              label={f.label + (f.required ? ' *' : '')}
              rows={3}
              value={form[f.key] || ''}
              placeholder={f.placeholder}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          ) : (
            <Input
              key={f.key}
              label={f.label + (f.required ? ' *' : '')}
              value={form[f.key] || ''}
              placeholder={f.placeholder}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          )
        )}
      </div>
      <div className="mt-5 flex justify-end gap-3 border-t border-gray-800 pt-4">
        <Button variant="outline" onClick={onClose}>取消</Button>
        <Button onClick={handleSubmit} loading={saving}>{isEdit ? '保存修改' : '创建'}</Button>
      </div>
    </Dialog>
  )
}

/** 删除确认弹窗 */
function DeleteConfirmDialog({
  name,
  onConfirm,
  onClose,
}: {
  name: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog open onClose={onClose} title="确认删除" className="max-w-sm">
      <p className="text-sm text-gray-300">
        确定要删除「<span className="font-semibold text-red-300">{name}</span>」吗？此操作为软删除，数据不会物理移除。      </p>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="outline" onClick={onClose}>取消</Button>
        <Button variant="destructive" onClick={onConfirm}>删除</Button>
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 跨书引入选择器                                                      */
/* ------------------------------------------------------------------ */

const IMPORT_TYPE_ORDER: { key: string; label: string }[] = [
  { key: 'characters', label: '人物' },
  { key: 'factions', label: '门派' },
  { key: 'locations', label: '地点' },
  { key: 'skills', label: '功法' },
  { key: 'items', label: '法宝' },
  { key: 'monsters', label: '妖兽' },
  { key: 'materials', label: '丹药灵材' },
  { key: 'daily', label: '日常信物' },
  { key: 'factionRules', label: '宗门规制' },
  { key: 'seasonEvents', label: '岁时节令' },
]

function ImportDialog({
  books,
  currentBookId,
  onClose,
  onDone,
}: {
  books?: any[]
  currentBookId: number
  onClose: () => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const sourceOptions = (books || [])
    .filter((b) => b.bookId !== currentBookId)
    .map((b) => ({ value: String(b.bookId), label: `${b.bookName}${b.author ? ' · ' + b.author : ''}` }))
  const [sourceBookId, setSourceBookId] = useState<number>(Number(sourceOptions[0]?.value || 1))
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [selection, setSelection] = useState<Record<string, Set<number>>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any | null>(null)

  const currentBook = (books || []).find((b) => b.bookId === currentBookId)
  const isSystemTarget = currentBook?.sourceType === 'system'

  const { data: sources, isLoading } = useQuery({
    queryKey: ['import-sources', sourceBookId],
    queryFn: () => worldApi.importSources(sourceBookId),
    enabled: !!sourceBookId,
  })

  const totalSelected = Object.values(selection).reduce((s, set) => s + set.size, 0)

  const toggleType = (key: string, allIds: number[]) => {
    setSelection((prev) => {
      const cur = prev[key]
      const next = { ...prev }
      if (cur && cur.size === allIds.length) next[key] = new Set<number>()
      else next[key] = new Set<number>(allIds)
      return next
    })
  }
  const toggleOne = (key: string, id: number) => {
    setSelection((prev) => {
      const set = new Set(prev[key] || [])
      if (set.has(id)) set.delete(id)
      else set.add(id)
      return { ...prev, [key]: set }
    })
  }

  const handleImport = async () => {
    const types = IMPORT_TYPE_ORDER.map((t) => t.key).filter((k) => selection[k]?.size)
    if (!types.length) { toast('请至少选择一类实体', 'error'); return }
    const entityIds: Record<string, number[]> = {}
    for (const t of types) entityIds[t] = [...selection[t]]
    setRunning(true)
    try {
      const res = await worldApi.importEntities({
        sourceBookId, targetBookId: currentBookId, types, entityIds, skipDuplicates,
      })
      setResult(res)
      onDone()
    } catch (e: any) {
      toast(e?.message || '引入失败', 'error')
    } finally {
      setRunning(false)
    }
  }

  // ---- 结果视图 ----
  if (result) {
    const byType = result.byType || {}
    return (
      <Dialog open onClose={onClose} title="引入完成" className="max-w-xl">
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: '新增', value: result.created, cls: 'text-ok' },
              { label: '跳过重复', value: result.skippedDuplicate, cls: 'text-warn' },
              { label: '失败', value: result.failed, cls: 'text-bad' },
              { label: '关系', value: result.relationsCopied, cls: 'text-indigo-300' },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border border-gray-800 bg-gray-950/60 px-2 py-3 text-center">
                <div className={cn('font-serif text-2xl font-black', c.cls)}>{c.value}</div>
                <div className="mt-0.5 text-xs text-gray-500">{c.label}</div>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {IMPORT_TYPE_ORDER.filter((t) => byType[t.key]).map((t) => {
              const s = byType[t.key]
              return (
                <div key={t.key} className="flex items-center justify-between rounded border border-gray-800 bg-gray-900 px-3 py-1.5 text-sm">
                  <span className="text-gray-300">{t.label}</span>
                  <span className="text-xs text-gray-500">
                    新增 <span className="text-ok">{s.created}</span>
                    {s.skipped > 0 && <> · 跳过 <span className="text-warn">{s.skipped}</span></>}
                    {s.failed > 0 && <> · 失败 <span className="text-bad">{s.failed}</span></>}
                  </span>
                </div>
              )
            })}
          </div>
          {result.errors?.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded border border-bad/30 bg-bad/5 p-2 text-xs text-bad">
              {result.errors.slice(0, 20).map((e: any, i: number) => (
                <div key={i}>[{e.type}] #{e.sourceId}: {e.error}</div>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>完成</Button>
          </div>
        </div>
      </Dialog>
    )
  }

  // ---- 选择视图 ----
  return (
    <Dialog open onClose={onClose} title="跨书引入实体" className="max-w-2xl">
      <div className="space-y-4">
        {isSystemTarget && (
          <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            当前书籍《{currentBook?.bookName}》为系统内置书，不可写入。请切换到用户创建的书后再引入。
          </div>
        )}

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Select
              label="源书籍（从这里复制）"
              options={sourceOptions.length ? sourceOptions : [{ value: '', label: '无可用源书' }]}
              value={String(sourceBookId)}
              onChange={(e) => { setSourceBookId(Number(e.target.value)); setSelection({}); setExpanded({}) }}
            />
          </div>
          <div className="pb-1 text-xs text-gray-500">
            目标：<span className="text-gray-300">{currentBook?.bookName || `#${currentBookId}`}</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
            {IMPORT_TYPE_ORDER.filter((t) => (sources as any)?.[t.key]?.length).map((t) => {
              const list: { id: number; name: string }[] = (sources as any)[t.key]
              const allIds = list.map((x) => x.id)
              const sel = selection[t.key]
              const selCount = sel?.size || 0
              const allChecked = selCount === allIds.length && allIds.length > 0
              const isOpen = expanded[t.key]
              return (
                <div key={t.key} className="rounded-lg border border-gray-800 bg-gray-900">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-indigo-500"
                      checked={allChecked}
                      aria-label="全选"
                      ref={(el) => { if (el) el.indeterminate = selCount > 0 && !allChecked }}
                      onChange={() => toggleType(t.key, allIds)}
                    />
                    <span className="text-sm font-medium text-gray-200">{t.label}</span>
                    <Badge variant={selCount ? 'default' : 'gold'} className="!py-0">
                      {selCount ? `${selCount}/${allIds.length}` : allIds.length}
                    </Badge>
                    <div className="flex-1" />
                    <button
                      onClick={() => toggleType(t.key, allIds)}
                      className="text-xs text-indigo-300 hover:text-indigo-200"
                    >
                      {allChecked ? '清空' : '全选'}
                    </button>
                    <button
                      onClick={() => setExpanded((p) => ({ ...p, [t.key]: !p[t.key] }))}
                      className="rounded p-0.5 text-gray-500 hover:text-gray-300"
                    >
                      <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="grid max-h-40 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto border-t border-gray-800 px-3 py-2">
                      {list.map((x) => (
                        <label key={x.id} className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-200">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-indigo-500"
                            checked={sel?.has(x.id) || false}
                            onChange={() => toggleOne(t.key, x.id)}
                          />
                          <span className="truncate">{x.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {sources && IMPORT_TYPE_ORDER.every((t) => !(sources as any)?.[t.key]?.length) && (
              <EmptyState message="该源书暂无可引入的实体" />
            )}
          </div>
        )}

        <Switch checked={skipDuplicates} onChange={setSkipDuplicates} label="跳过目标书中的同名实体（推荐开启）" />

        <div className="flex items-center justify-between border-t border-gray-800 pt-3">
          <span className="text-sm text-gray-400">已选 <span className="font-serif text-base font-bold text-indigo-300">{totalSelected}</span> 项</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleImport} disabled={running || isSystemTarget || !totalSelected}>
              {running ? '引入中…' : '开始引入'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 文本批量抽取入库                                                    */
/* ------------------------------------------------------------------ */

const FIELD_LABELS: Record<string, string> = {
  faction: '门派', realm: '境界', combatType: '战斗', personality: '性格', allTitles: '称号',
  coreSkills: '功法', growthLine: '成长', plotTags: '标签', camp: '阵营', headquarters: '总坛',
  leader: '首领', townTreasure: '镇派宝', cultivationFeature: '修炼特色', forceRelations: '势力关系',
  level: '层级', parentRegion: '上级区域', relatedFaction: '相关门派', environment: '环境',
  dangerLevel: '危险等级', specialFunctions: '功用', keyEvents: '关键事件', grade: '品阶',
  skillType: '类型', threshold: '门槛', coreEffect: '效果', counter: '克制', famousUsage: '著名使用',
  system: '体系', appearance: '外观', coreAbilities: '能力', useLimit: '限制', evolution: '进化',
  owners: '持有者', relatedPlots: '相关剧情', race: '种族', habitat: '栖息地', combatLevel: '战力',
  relatedPlot: '相关剧情', itemType: '类别', sideEffect: '副作用', origin: '产地', usageScene: '场景',
  material: '材质', emotionalTag: '情感标签',
}

function ExtractDialog({
  books,
  currentBookId,
  onClose,
  onDone,
}: {
  books?: any[]
  currentBookId: number
  onClose: () => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [phase, setPhase] = useState<'input' | 'preview' | 'done'>('input')
  const [text, setText] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set(IMPORT_TYPE_ORDER.map((t) => t.key)))
  const [extracting, setExtracting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [taskId, setTaskId] = useState<number | null>(null)
  const [preview, setPreview] = useState<Record<string, any[]> | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [insertResult, setInsertResult] = useState<any | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)

  const currentBook = (books || []).find((b) => b.bookId === currentBookId)
  const isSystemTarget = currentBook?.sourceType === 'system'

  const toggleType = (key: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleExtract = async () => {
    if (text.trim().length < 10) { toast('文本太短，至少需要 10 个字', 'error'); return }
    if (!selectedTypes.size) { toast('请至少选择一类实体', 'error'); return }
    setExtracting(true)
    setExtractError(null)
    try {
      const res = await worldApi.extractEntities({
        bookId: currentBookId, text: text.trim(), types: [...selectedTypes],
      })
      setTaskId(res.taskId)
      setPreview(res.result)
      setExcluded(new Set())
      setPhase('preview')
    } catch (e: any) {
      const msg = e?.message || '抽取失败'
      let hint = '请稍后重试'
      if (msg.includes('超时')) hint = 'LLM 响应超时，请稍后重试或缩短文本'
      else if (msg.includes('限流')) hint = 'LLM 限流，请稍等片刻再试'
      else if (msg.includes('解析') || msg.includes('JSON')) hint = '模型返回格式异常，请调整文本后重试'
      setExtractError(`${msg}（${hint}）`)
      toast(msg, 'error')
    } finally {
      setExtracting(false)
    }
  }

  const toggleExclude = (type: string, idx: number) => {
    const k = `${type}#${idx}`
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  /** 过滤掉被排除的实体，得到待入库 result */
  const buildFilteredResult = (): Record<string, any[]> => {
    const out: Record<string, any[]> = {}
    if (!preview) return out
    for (const t of IMPORT_TYPE_ORDER) {
      const list = preview[t.key] || []
      out[t.key] = list.filter((_, idx) => !excluded.has(`${t.key}#${idx}`))
    }
    return out
  }

  const includedCount = preview
    ? IMPORT_TYPE_ORDER.reduce((s, t) => s + (preview[t.key] || []).filter((_, i) => !excluded.has(`${t.key}#${i}`)).length, 0)
    : 0

  const handleConfirm = async () => {
    if (!taskId) return
    if (!includedCount) { toast('没有可入库的实体', 'error'); return }
    setConfirming(true)
    try {
      const res = await worldApi.confirmBatchImport(taskId, { result: buildFilteredResult(), skipDuplicates: true })
      setInsertResult(res)
      setPhase('done')
      onDone()
    } catch (e: any) {
      toast(e?.message || '入库失败', 'error')
    } finally {
      setConfirming(false)
    }
  }

  const renderFields = (ent: any) => {
    const chips = Object.keys(ent)
      .filter((k) => k !== 'name' && ent[k] !== undefined && ent[k] !== null && ent[k] !== '' && !(Array.isArray(ent[k]) && ent[k].length === 0))
      .map((k) => {
        const v = Array.isArray(ent[k]) ? ent[k].join('、') : ent[k]
        return <span key={k} className="rounded bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-400"><span className="text-gray-500">{FIELD_LABELS[k] || k}:</span> {v}</span>
      })
    return chips.length ? <div className="mt-1 flex flex-wrap gap-1">{chips}</div> : null
  }

  // ---- 完成视图 ----
  if (phase === 'done' && insertResult) {
    const byType = insertResult.byType || {}
    return (
      <Dialog open onClose={onClose} title="入库完成" className="max-w-xl">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '新增', value: insertResult.created, cls: 'text-ok' },
              { label: '跳过重复', value: insertResult.skippedDuplicate, cls: 'text-warn' },
              { label: '失败', value: insertResult.failed, cls: 'text-bad' },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border border-gray-800 bg-gray-950/60 px-2 py-3 text-center">
                <div className={cn('font-serif text-2xl font-black', c.cls)}>{c.value}</div>
                <div className="mt-0.5 text-xs text-gray-500">{c.label}</div>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {IMPORT_TYPE_ORDER.filter((t) => byType[t.key]).map((t) => {
              const s = byType[t.key]
              return (
                <div key={t.key} className="flex items-center justify-between rounded border border-gray-800 bg-gray-900 px-3 py-1.5 text-sm">
                  <span className="text-gray-300">{t.label}</span>
                  <span className="text-xs text-gray-500">
                    新增 <span className="text-ok">{s.created}</span>
                    {s.skipped > 0 && <> · 跳过 <span className="text-warn">{s.skipped}</span></>}
                    {s.failed > 0 && <> · 失败 <span className="text-bad">{s.failed}</span></>}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="flex justify-end"><Button onClick={onClose}>完成</Button></div>
        </div>
      </Dialog>
    )
  }

  // ---- 预览视图 ----
  if (phase === 'preview' && preview) {
    return (
      <Dialog open onClose={onClose} title="抽取结果预览" className="max-w-2xl">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">勾选要入库的实体（默认全选），同名实体将自动跳过。目标：《{currentBook?.bookName}》</p>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {IMPORT_TYPE_ORDER.filter((t) => (preview[t.key] || []).length).map((t) => (
              <div key={t.key} className="rounded-lg border border-gray-800 bg-gray-900">
                <div className="flex items-center gap-2 border-b border-gray-800 px-3 py-2">
                  <span className="text-sm font-medium text-gray-200">{t.label}</span>
                  <Badge variant="gold" className="!py-0">{(preview[t.key] || []).length}</Badge>
                </div>
                <div className="space-y-1.5 px-3 py-2">
                  {(preview[t.key] || []).map((ent: any, idx: number) => {
                    const on = !excluded.has(`${t.key}#${idx}`)
                    return (
                      <label key={idx} className={cn('block cursor-pointer rounded border px-2 py-1.5 transition-colors', on ? 'border-gray-800 bg-gray-950/40' : 'border-gray-800/50 bg-transparent opacity-45')}>
                        <div className="flex items-center gap-2">
                          <input type="checkbox" className="h-4 w-4 accent-indigo-500" checked={on} onChange={() => toggleExclude(t.key, idx)} />
                          <span className="text-sm font-medium text-gray-100">{ent.name}</span>
                        </div>
                        {on && renderFields(ent)}
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
            {IMPORT_TYPE_ORDER.every((t) => !(preview[t.key] || []).length) && (
              <EmptyState message="未能从文本中抽取到任何实体，请检查文本内容或实体类型选择" />
            )}
          </div>
          <div className="flex items-center justify-between border-t border-gray-800 pt-3">
            <span className="text-sm text-gray-400">待入库 <span className="font-serif text-base font-bold text-indigo-300">{includedCount}</span> 项</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPhase('input')}>返回修改</Button>
              <Button onClick={handleConfirm} disabled={confirming || !includedCount}>{confirming ? '入库中…' : '确认入库'}</Button>
            </div>
          </div>
        </div>
      </Dialog>
    )
  }

  // ---- 输入视图 ----
  return (
    <Dialog open onClose={onClose} title="文本批量入库" className="max-w-2xl">
      <div className="space-y-4">
        {isSystemTarget && (
          <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            当前书籍《{currentBook?.bookName}》为系统内置书，不可写入。请切换到用户创建的书后再入库。
          </div>
        )}
        {extractError && (
          <div className="rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-sm text-bad">
            <span className="font-medium">抽取失败：</span>{extractError}
          </div>
        )}
        <Textarea
          label="粘贴设定 / 章节文本"
          placeholder="例如：青云门乃正道领袖，掌门道玄真人坐镇通天峰。门下有大竹峰、小竹峰等七脉，镇派之宝为诛仙古剑……"
          rows={9}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div>
          <div className="mb-1.5 text-sm font-medium text-gray-300">抽取实体类型</div>
          <div className="flex flex-wrap gap-2">
            {IMPORT_TYPE_ORDER.map((t) => {
              const on = selectedTypes.has(t.key)
              return (
                <button
                  key={t.key}
                  onClick={() => toggleType(t.key)}
                  className={cn('rounded-lg border px-3 py-1 text-sm transition-colors', on ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200' : 'border-gray-700 bg-gray-900 text-gray-500 hover:border-gray-600')}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-gray-800 pt-3">
          <span className="text-xs text-gray-500">
            {text.trim().length} 字 · 已选 {selectedTypes.size} 类
            {extracting && <span className="ml-2 text-indigo-300">LLM 抽取约需 10 秒，请稍候…</span>}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleExtract} loading={extracting} disabled={extracting || isSystemTarget || text.trim().length < 10 || !selectedTypes.size}>
              {extracting ? '拆解中…' : '开始拆解'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 书籍切换器（book_id 隔离）                                         */
/* ------------------------------------------------------------------ */

function BookSwitcher({
  books,
  bookId,
  onChange,
}: {
  books?: any[]
  bookId: number
  onChange: (id: number) => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [form, setForm] = useState({ bookName: '', author: '', description: '' })
  const [deleting, setDeleting] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [extractOpen, setExtractOpen] = useState(false)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['world-books'] })

  const openCreate = () => {
    setEditing(null)
    setForm({ bookName: '', author: '', description: '' })
    setDialogOpen(true)
  }
  const openEdit = (b: any) => {
    setEditing(b)
    setForm({ bookName: b.bookName || '', author: b.author || '', description: b.description || '' })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.bookName.trim()) { toast('请填写书籍名称', 'error'); return }
    setSaving(true)
    try {
      if (editing) {
        await worldApi.updateBook(editing.bookId, {
          bookName: form.bookName.trim(),
          author: form.author.trim() || undefined,
          description: form.description.trim() || undefined,
        })
        toast('书籍已更新', 'success')
      } else {
        const created = await worldApi.createBook({
          bookName: form.bookName.trim(),
          author: form.author.trim() || undefined,
          description: form.description.trim() || undefined,
        })
        toast('书籍已创建', 'success')
        if (created?.bookId) onChange(created.bookId)
      }
      invalidate()
      setDialogOpen(false)
    } catch (e: any) {
      toast(e?.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    try {
      await worldApi.deleteBook(deleting.bookId)
      toast('书籍已删除', 'success')
      if (deleting.bookId === bookId) onChange(1)
      invalidate()
      setDeleting(null)
    } catch (e: any) {
      toast(e?.message || '删除失败', 'error')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">
      <div className="flex items-center gap-2 pr-2 text-gray-400">
        <BookOpen className="h-4 w-4 text-indigo-300" />
        <span className="text-sm font-medium">当前书籍</span>
      </div>
      {!books || books.length === 0 ? (
        <span className="text-xs text-gray-600">加载中…</span>
      ) : (
        books.map((b) => (
          <div
            key={b.bookId}
            className={cn(
              'group flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-all',
              b.bookId === bookId
                ? 'border-indigo-500/60 bg-indigo-500/15 shadow-sm shadow-indigo-900/30'
                : 'border-gray-800 bg-gray-950/60 hover:border-gray-600 hover:bg-gray-900'
            )}
          >
            <button onClick={() => onChange(b.bookId)} className="flex items-center gap-2">
              <span
                className={cn(
                  'font-serif text-sm font-bold',
                  b.bookId === bookId ? 'text-indigo-200' : 'text-gray-300 group-hover:text-gray-100'
                )}
              >
                {b.bookName}
              </span>
              {b.author && (
                <span className="text-xs text-gray-500 group-hover:text-gray-400">{b.author}</span>
              )}
            </button>
            {b.sourceType === 'system' ? (
              <span className="rounded border border-gray-700 px-1 text-[10px] text-gray-500">系统</span>
            ) : (
              <span className="flex items-center gap-0.5">
                <button
                  onClick={() => openEdit(b)}
                  title="编辑书籍"
                  aria-label="编辑"
                  className="rounded p-2 text-gray-500 transition-colors hover:text-indigo-300"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setDeleting(b)}
                  title="删除书籍"
                  aria-label="删除"
                  className="rounded p-2 text-gray-500 transition-colors hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>
        ))
      )}
      <button
        onClick={openCreate}
        className="flex items-center gap-1 rounded-lg border border-dashed border-gray-700 px-3 py-1.5 text-sm text-gray-400 transition-colors hover:border-indigo-500/60 hover:text-indigo-300"
      >
        <Plus className="h-3.5 w-3.5" /> 新建书籍
      </button>
      {books && books.length > 1 && (
        <button
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-1 rounded-lg border border-dashed border-gray-700 px-3 py-1.5 text-sm text-gray-400 transition-colors hover:border-indigo-500/60 hover:text-indigo-300"
        >
          <FolderInput className="h-3.5 w-3.5" /> 引入实体
        </button>
      )}
      {books && books.length > 0 && (
        <button
          onClick={() => setExtractOpen(true)}
          className="flex items-center gap-1 rounded-lg border border-dashed border-gray-700 px-3 py-1.5 text-sm text-gray-400 transition-colors hover:border-indigo-500/60 hover:text-indigo-300"
        >
          <Sparkles className="h-3.5 w-3.5" /> 文本入库
        </button>
      )}

      {/* 创建/编辑弹窗 */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? '编辑书籍' : '新建书籍'}>
        <div className="space-y-4">
          <Input
            label="书籍名称"
            placeholder="例如：我的仙侠世界"
            value={form.bookName}
            onChange={(e) => setForm((f) => ({ ...f, bookName: e.target.value }))}
          />
          <Input
            label="作者（可选）"
            placeholder="例如：佚名"
            value={form.author}
            onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
          />
          <Textarea
            label="简介（可选）"
            placeholder="一句话描述这本书的世界观…"
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
          </div>
        </div>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!deleting} onClose={() => setDeleting(null)} title="删除书籍">
        <div className="space-y-4">
          <p className="text-sm text-gray-300">
            确定删除《{deleting?.bookName}》吗？该书的世界观实体将一并失效，此操作不可撤销。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete}>确认删除</Button>
          </div>
        </div>
      </Dialog>

      {/* 跨书引入 */}
      {importOpen && (
        <ImportDialog
          books={books}
          currentBookId={bookId}
          onClose={() => setImportOpen(false)}
          onDone={() => {
            invalidate()
            queryClient.invalidateQueries({ queryKey: ['world-stats'] })
            queryClient.invalidateQueries({ queryKey: ['world-all'] })
          }}
        />
      )}

      {/* 文本批量入库 */}
      {extractOpen && (
        <ExtractDialog
          books={books}
          currentBookId={bookId}
          onClose={() => setExtractOpen(false)}
          onDone={() => {
            invalidate()
            queryClient.invalidateQueries({ queryKey: ['world-stats'] })
            queryClient.invalidateQueries({ queryKey: ['world-all'] })
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 头部：氛围层+ 数据总览                                               */
/* ------------------------------------------------------------------ */

function Header({ stats, onJump }: { stats: any; onJump: (section: SectionId, cat?: string) => void }) {
  const total = stats
    ? entityCategories.reduce((s, c) => s + (stats?.[c.statKey] || 0), 0) + (stats.factionRules || 0) + (stats.seasonEvents || 0)
    : 0

  const statChips = [
    ...entityCategories.map((c) => ({
      label: c.label, value: stats?.[c.statKey] || 0, icon: c.icon, text: c.text,
      onClick: () => onJump('bestiary', c.id),
    })),
    { label: '宗门规制', value: stats?.factionRules ?? 0, icon: ScrollText, text: 'text-orange-300', onClick: () => onJump('rules') },
    { label: '岁时节令', value: stats?.seasonEvents ?? 0, icon: CalendarDays, text: 'text-fuchsia-300', onClick: () => onJump('events') },
    { label: '人物关系', value: stats?.relations ?? 0, icon: Network, text: 'text-indigo-300', onClick: () => onJump('bestiary', 'characters') },
  ]

  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
      {/* 氛围背景层*/}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(900px 320px at 12% -10%, rgba(16,185,129,0.10), transparent 60%),' +
            'radial-gradient(700px 300px at 88% 0%, rgba(244,63,94,0.09), transparent 55%),' +
            'radial-gradient(1000px 420px at 50% 130%, rgba(56,189,248,0.07), transparent 60%)',
        }}
      />
      {/* 巨型水印字*/}
      <div className="pointer-events-none absolute -right-4 -top-10 select-none font-serif text-[150px] font-black leading-none text-gray-100/[0.04]">
        誅仙
      </div>

      <div className="relative px-6 pb-5 pt-7 sm:px-8">
        <div className="flex items-start gap-4">
          {/* 印章 */}
          <div className="flex h-14 w-14 shrink-0 rotate-[-4deg] items-center justify-center rounded-lg bg-gradient-to-br from-red-600 to-red-800 shadow-lg shadow-red-900/40 ring-1 ring-red-500/50">
            <span className="font-serif text-2xl font-black text-red-50">…</span>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-500">
              WORLDVIEW · 设定百科
            </div>
            <h1 className="font-serif text-3xl font-black tracking-wide text-gray-50 sm:text-4xl">
              世界观            </h1>
            <p className="mt-1 text-sm text-gray-400">
              诛仙库 · 共收录<span className="font-serif text-base font-bold text-emerald-300">{total}</span> 条设定              <span className="mx-2 text-gray-700">|</span>
              <span className="text-gray-500">人物 / 门派 / 地点 / 功法 / 法宝 / 妖兽 / 丹药 / 信物 / 规制 / 岁时</span>
            </p>
          </div>
        </div>

        {/* 数据总览区*/}
        <div className="mt-6 flex flex-wrap gap-2">
          {statChips.map((s, i) => (
            <button
              key={s.label}
              onClick={s.onClick}
              className="animate-rise group flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-1.5 transition-all hover:-translate-y-0.5 hover:border-gray-600 hover:bg-gray-900"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <s.icon className={cn('h-3.5 w-3.5', s.text)} />
              <span className="font-serif text-base font-bold leading-none text-gray-100">{s.value}</span>
              <span className="text-xs text-gray-500 group-hover:text-gray-300">{s.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 实体详情弹窗                                                        */
/* ------------------------------------------------------------------ */

function CharacterDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const [tab, setTab] = useState<'profile' | 'relations' | 'distill' | 'appearances'>('profile')
  const projectId = useCurrentProjectId()
  const { data: char, isLoading } = useQuery({ queryKey: ['character-detail', id], queryFn: () => worldApi.character(String(id)) })
  const { data: distill } = useQuery({ queryKey: ['character-distill', id], queryFn: () => worldApi.characterDistill(String(id)) })
  const { data: appearances } = useQuery({
    queryKey: ['entity-appearances', id],
    queryFn: () => chaptersApi.byEntity(projectId, id, 'character'),
    enabled: !!projectId,
  })

  const relCount = char?.relations?.length ?? 0
  const distillCount = (distill?.mentalModels?.length ?? 0) + (distill?.heuristics?.length ?? 0) + (distill?.lifeStages?.length ?? 0)

  return (
    <Dialog open onClose={onClose} title={char?.name || '人物详情'} className="max-w-3xl">
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <>
          {/* 顶部标签 */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {char?.realm && <Chip className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">{char.realm}</Chip>}
            {char?.faction && <Chip className="border-amber-500/30 bg-amber-500/15 text-amber-300">{char.faction}</Chip>}
            {char?.combatType && <Chip className="border-gray-700 bg-gray-800 text-gray-300">{char.combatType}</Chip>}
          </div>

          <div className="mb-4 flex gap-1 rounded-lg bg-gray-800/60 p-1" role="tablist">
            {([
              { id: 'profile', label: '设定' },
              { id: 'relations', label: `关系 (${relCount})` },
              { id: 'distill', label: `深度蒸馏 (${distillCount})` },
              { id: 'appearances', label: `出场 (${appearances?.length ?? 0})` },
            ] as const).map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  tab === t.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="max-h-[55vh] overflow-y-auto pr-1">
            {tab === 'profile' && (
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DetailField label="别称" value={char?.allTitles} />
                <DetailField label="核心功法" value={char?.coreSkills} />
                <DetailField label="性格" value={char?.personality} />
                <DetailField label="成长线" value={char?.growthLine} />
                <DetailField label="专属法宝" value={char?.exclusiveItems} />
                <DetailField label="情节标签" value={char?.plotTags} />
                <div className="sm:col-span-2">
                  <DetailField label="写作画像" value={char?.writingProfile ? JSON.stringify(char.writingProfile) : null} />
                </div>
              </dl>
            )}

            {tab === 'relations' && (
              relCount === 0 ? (
                <EmptyState message="暂无人物关系记录" />
              ) : (
                <div className="space-y-2">
                  {char.relations.map((r: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2">
                      <Badge variant="default">{r.relType}</Badge>
                      <ArrowRight className={cn('h-3.5 w-3.5', r.direction === 'out' ? 'text-gray-600' : 'rotate-180 text-gray-600')} />
                      <span className="text-sm font-medium text-gray-200">{r.otherName}</span>
                      {r.interactCount > 0 && (
                        <span className="ml-auto text-xs text-gray-500">互动 {r.interactCount}</span>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}

            {tab === 'distill' && (
              distillCount === 0 ? (
                <EmptyState icon={<Brain className="h-8 w-8" />} message="该人物暂无蒸馏数据（心智模型 / 启发式 / 人生阶段）" />
              ) : (
                <div className="space-y-5">
                  {(distill?.mentalModels?.length ?? 0) > 0 && (
                    <div>
                      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-300"><Brain className="h-4 w-4" />心智模型</h4>
                      <div className="space-y-2">
                        {distill.mentalModels.map((m: any) => (
                          <div key={m.modelId} className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
                            <div className="font-medium text-gray-100">{m.modelName}</div>
                            <div className="mt-0.5 text-sm text-gray-400">{m.oneLiner}</div>
                            {m.application && <div className="mt-1 text-xs text-gray-500">适用：{m.application}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(distill?.heuristics?.length ?? 0) > 0 && (
                    <div>
                      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300"><Route className="h-4 w-4" />决策启发式</h4>
                      <div className="space-y-2">
                        {distill.heuristics.map((h: any) => (
                          <div key={h.heuristicId} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                            <div className="font-medium text-gray-100">{h.ruleName}</div>
                            <div className="mt-0.5 text-sm text-gray-400">{h.ruleText}</div>
                            {h.scenario && <div className="mt-1 text-xs text-gray-500">触发：{h.scenario}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(distill?.lifeStages?.length ?? 0) > 0 && (
                    <div>
                      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky-300"><CalendarDays className="h-4 w-4" />人生阶段</h4>
                      <div className="relative space-y-0 border-l border-gray-800 pl-4">
                        {distill.lifeStages.map((s: any) => (
                          <div key={s.stageId} className="relative pb-4">
                            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-sky-400 ring-4 ring-sky-400/15" />
                            <div className="font-medium text-gray-100">{s.stageName}</div>
                            {s.personalityState && <div className="mt-0.5 text-sm text-gray-400">{s.personalityState}</div>}
                            {s.eventsText && <div className="mt-1 text-xs text-gray-500">{s.eventsText}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            )}

            {tab === 'appearances' && (
              !appearances?.length ? (
                <EmptyState message="暂未出现在任何章节计划中" />
              ) : (
                <div className="space-y-2">
                  {appearances.map((ch: any) => (
                    <div key={ch.id} className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2">
                      <BookOpen className="h-4 w-4 shrink-0 text-gray-500" />
                      <span className="text-sm text-gray-200">第{ch.chapterNo}章 {ch.title}</span>
                      <Badge variant="default" className="ml-auto">{ch.status}</Badge>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </>
      )}
    </Dialog>
  )
}

function SkillDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const [tab, setTab] = useState<'profile' | 'distill'>('profile')
  const { data: skill, isLoading } = useQuery({ queryKey: ['skill-detail', id], queryFn: () => worldApi.skill(String(id)) })
  const { data: distill } = useQuery({ queryKey: ['skill-distill', id], queryFn: () => worldApi.skillDistill(String(id)) })

  const distillCount = (distill?.attributes?.length ?? 0) + (distill?.moves?.length ?? 0) + (distill?.relations?.length ?? 0)

  return (
    <Dialog open onClose={onClose} title={skill?.name || '功法详情'} className="max-w-3xl">
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <>
          {/* 顶部标签 */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {skill?.grade && <Chip className="border-violet-500/30 bg-violet-500/15 text-violet-300">{skill.grade}</Chip>}
            {skill?.faction && <Chip className="border-amber-500/30 bg-amber-500/15 text-amber-300">{skill.faction}</Chip>}
            {skill?.skillType && <Chip className="border-gray-700 bg-gray-800 text-gray-300">{skill.skillType}</Chip>}
          </div>

          <div className="mb-4 flex gap-1 rounded-lg bg-gray-800/60 p-1">
            {([
              { id: 'profile', label: '设定' },
              { id: 'distill', label: `深度蒸馏 (${distillCount})` },
            ] as const).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  tab === t.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="max-h-[55vh] overflow-y-auto pr-1">
            {tab === 'profile' && (
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DetailField label="品阶" value={skill?.grade} />
                <DetailField label="所属门派" value={skill?.faction} />
                <DetailField label="类型" value={skill?.skillType} />
                <DetailField label="修炼门槛" value={skill?.threshold} />
                <DetailField label="核心效果" value={skill?.coreEffect} />
                <DetailField label="克制" value={skill?.counter} />
                <div className="sm:col-span-2">
                  <DetailField label="著名使用" value={skill?.famousUsage} />
                </div>
              </dl>
            )}

            {tab === 'distill' && (
              distillCount === 0 && !(distill?.archive?.length) ? (
                <EmptyState icon={<Zap className="h-8 w-8" />} message="该功法暂无蒸馏数据（属性 / 招式 / 关系）" />
              ) : (
                <div className="space-y-5">
                  {(distill?.attributes?.length ?? 0) > 0 && (
                    <div>
                      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-300"><Gem className="h-4 w-4" />功法属性</h4>
                      <div className="space-y-2">
                        {distill.attributes.map((a: any) => (
                          <div key={a.id} className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {a.grade && <span className="font-medium text-gray-100">{a.grade}</span>}
                              {a.element && a.element !== '未知' && <Chip className="border-sky-500/30 bg-sky-500/15 text-sky-300">{a.element}</Chip>}
                              {a.difficulty && <Chip className="border-rose-500/30 bg-rose-500/15 text-rose-300">难度：{a.difficulty}</Chip>}
                            </div>
                            {a.effect && <div className="mt-1.5 text-sm leading-relaxed text-gray-400">{a.effect}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(distill?.moves?.length ?? 0) > 0 && (
                    <div>
                      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300"><Zap className="h-4 w-4" />招式</h4>
                      <div className="space-y-2">
                        {distill.moves.map((m: any) => (
                          <div key={m.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                            <div className="font-medium text-gray-100">{m.moveName}</div>
                            {m.effect && <div className="mt-0.5 text-sm text-gray-400">{m.effect}</div>}
                            {m.requirement && <div className="mt-1 text-xs text-gray-500">施展条件：{m.requirement}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(distill?.relations?.length ?? 0) > 0 && (
                    <div>
                      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky-300"><Network className="h-4 w-4" />功法关系</h4>
                      <div className="space-y-2">
                        {distill.relations.map((r: any) => (
                          <div key={r.id} className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2">
                            <Badge variant="default">{r.relationType}</Badge>
                            <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-600" />
                            <div className="min-w-0">
                              <span className="text-sm font-medium text-gray-200">{r.targetTechnique}</span>
                              {r.description && <div className="mt-0.5 text-xs leading-relaxed text-gray-500">{r.description}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(distill?.archive?.length ?? 0) > 0 && (
                    <div>
                      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-400"><ScrollText className="h-4 w-4" />蒸馏归档</h4>
                      <div className="space-y-2">
                        {distill.archive.map((arc: any) => (
                          <details key={arc.id} className="rounded-lg border border-gray-800 bg-gray-950/50">
                            <summary className="cursor-pointer select-none px-3 py-2 text-xs text-gray-500 hover:text-gray-300">
                              {arc.distillSource} · {arc.distillVersion} · 原始 JSON
                            </summary>
                            <pre className="max-h-64 overflow-auto border-t border-gray-800 p-3 text-[11px] leading-relaxed text-gray-500">
                              {JSON.stringify(arc.contentJson, null, 2)}
                            </pre>
                          </details>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </>
      )}
    </Dialog>
  )
}

function FactionDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: fac, isLoading } = useQuery({ queryKey: ['faction-detail', id], queryFn: () => worldApi.faction(String(id)) })
  return (
    <Dialog open onClose={onClose} title={fac?.name || '门派详情'} className="max-w-2xl">
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DetailField label="阵营" value={fac?.camp} />
            <DetailField label="掌门" value={fac?.leader} />
            <DetailField label="总部" value={fac?.headquarters} />
            <DetailField label="镇派之宝" value={fac?.townTreasure} />
            <DetailField label="修炼特点" value={fac?.cultivationFeature} />
            <DetailField label="势力关系" value={fac?.forceRelations} />
          </dl>
          {fac?.members?.length > 0 && (
            <div className="mt-5 border-t border-gray-800 pt-4">
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
                <Users className="h-4 w-4" />门派成员（{fac.members.length}）              </h4>
              <div className="flex flex-wrap gap-2">
                {fac.members.map((m: any) => (
                  <Chip key={m.id} className="border-gray-700 bg-gray-800/80 text-gray-200">
                    <span className="font-medium">{m.charName}</span>
                    {m.position && <span className="ml-1.5 text-gray-500">{m.position}</span>}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

function GenericDetail({ category, entity, onClose }: { category: CatConfig; entity: any; onClose: () => void }) {
  const fields: Record<string, [string, any][]> = {
    locations: [['级别', entity.level], ['上级区域', entity.parentRegion], ['环境', entity.environment], ['关联门派', entity.relatedFaction], ['关键事件', entity.keyEvents], ['危险等级', entity.dangerLevel], ['特殊功能', entity.specialFunctions]],
    skills: [['品阶', entity.grade], ['所属门派', entity.faction], ['类型', entity.skillType], ['修炼门槛', entity.threshold], ['核心效果', entity.coreEffect], ['克制', entity.counter], ['著名使用', entity.famousUsage]],
    items: [['品阶', entity.grade], ['体系', entity.system], ['持有者', entity.owners], ['外观', entity.appearance], ['核心能力', entity.coreAbilities], ['使用限制', entity.useLimit], ['进化', entity.evolution], ['相关情节', entity.relatedPlots]],
    monsters: [['等级', entity.level], ['种族', entity.race], ['栖息地', entity.habitat], ['核心能力', entity.coreAbilities], ['战斗力', entity.combatLevel], ['相关情节', entity.relatedPlot]],
    materials: [['类别', entity.itemType], ['品阶', entity.grade], ['核心功效', entity.coreEffect], ['副作用', entity.sideEffect], ['产地', entity.origin], ['使用场景', entity.usageScene]],
    daily: [['类别', entity.itemType], ['品阶', entity.grade], ['关联门派', entity.relatedFaction], ['材质', entity.material], ['外观', entity.appearance], ['使用场景', entity.usageScene], ['情绪标签', entity.emotionalTag]],
  }
  return (
    <Dialog open onClose={onClose} title={entity.name} className="max-w-2xl">
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(fields[category.id] || []).map(([label, value]) => (
            <DetailField key={label} label={label} value={value} />
          ))}
        </dl>
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* 实体图鉴                                                            */
/* ------------------------------------------------------------------ */

function BestiarySection({ category, onCategoryChange, bookId }: { category: CatConfig; onCategoryChange: (id: string) => void; bookId: number }) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: rows, isLoading } = useAllRows(category.id, bookId, listFetchers[category.id] ?? (async () => []))

  // CRUD 状态
  const [formOpen, setFormOpen] = useState(false)
  const [editEntity, setEditEntity] = useState<any>(null)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)

  const collection = collectionMap[category.id] || category.id

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['world-all', category.id] })
    queryClient.invalidateQueries({ queryKey: ['world-stats'] })
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await worldApi.remove(collection, deleteTarget.id)
      toast(`已删除「{deleteTarget.name}」`, 'success')
      invalidate()
    } catch (err: any) {
      toast(err.message || '删除失败', 'error')
    }
    setDeleteTarget(null)
  }

  // 类型字段（用于动态过滤器）
  const typeField = category.id === 'materials' || category.id === 'daily' ? 'itemType' : null

  const typeOptions = useMemo(() => {
    if (!typeField || !rows) return []
    return Array.from(new Set(rows.map((r) => r[typeField]).filter(Boolean))) as string[]
  }, [rows, typeField])

  const filtered = useMemo(() => {
    if (!rows) return []
    const kw = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (typeFilter && r[typeField as string] !== typeFilter) return false
      if (!kw) return true
      const hay = [r.name, r.personality, r.coreEffect, r.coreAbilities, r.appearance, r.faction, r.origin, (r.emotionalTag || []).join(' ')].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(kw)
    })
  }, [rows, search, typeFilter, typeField])

  const [selected, setSelected] = useState<any>(null)

  return (
    <div className="space-y-4">
      {/* 分类切换 */}
      <div className="flex flex-wrap gap-1.5">
        {entityCategories.map((c) => (
          <button
            key={c.id}
            onClick={() => { onCategoryChange(c.id); setTypeFilter('') }}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all',
              c.id === category.id
                ? cn('border-transparent text-gray-950 shadow-sm', c.bar)
                : 'border-gray-800 bg-gray-900 text-gray-400 hover:border-gray-600 hover:text-gray-200'
            )}
          >
            <c.icon className="h-3.5 w-3.5" />
            {c.label}
          </button>
        ))}
      </div>

      {(
      <>
      {/* 搜索 + 类型过滤 + 新增按钮 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input placeholder={`搜索${category.label}...`} className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {typeOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setTypeFilter('')}
              className={cn('rounded-md border px-2.5 py-1 text-xs transition-colors', !typeFilter ? 'border-gray-500 bg-gray-700 text-white' : 'border-gray-800 bg-gray-900 text-gray-400 hover:text-gray-200')}
            >
              全部
            </button>
            {typeOptions.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={cn('rounded-md border px-2.5 py-1 text-xs transition-colors', typeFilter === t ? 'border-gray-500 bg-gray-700 text-white' : 'border-gray-800 bg-gray-900 text-gray-400 hover:text-gray-200')}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 sm:ml-auto">
          <span className="text-xs text-gray-600">{filtered.length} 条</span>
          <Button size="sm" onClick={() => { setEditEntity(null); setFormOpen(true) }}>
            <Plus className="h-3.5 w-3.5" />新增{category.label}
          </Button>
        </div>
      </div>

      {/* 卡片网格 */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <EmptyState message={`没有匹配的{category.label}`} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((entity: any, i) => {
            const s = summarize(category.id, entity)
            return (
              <Card
                key={entity.id}
                className={cn('group cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg', category.ring)}
                style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(entity)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(entity) } }}
              >
                <CardContent className="animate-rise p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-serif text-base font-bold text-gray-100 group-hover:text-white">{entity.name}</h3>
                    <div className="flex items-center gap-1">
                      {s.badge && <Chip className={category.chip}>{s.badge}</Chip>}
                      {/* 编辑/删除按钮（hover显示）*/}
                      <button
                        className="hidden rounded p-2 text-gray-500 hover:bg-gray-700 hover:text-indigo-300 group-hover:block focus:block"
                        title="编辑"
                        aria-label="编辑"
                        onClick={(e) => { e.stopPropagation(); setEditEntity(entity); setFormOpen(true) }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="hidden rounded p-2 text-gray-500 hover:bg-gray-700 hover:text-red-300 group-hover:block focus:block"
                        title="删除"
                        aria-label="删除"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(entity) }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-gray-500 group-hover:text-gray-400">
                    {s.desc || '暂无描述'}
                  </p>
                  {s.sub && <p className={cn('mt-2 truncate text-xs', category.text)}>{s.sub}</p>}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 详情弹窗 */}
      {selected && category.id === 'characters' && <CharacterDetail id={selected.id} onClose={() => setSelected(null)} />}
      {selected && category.id === 'factions' && <FactionDetail id={selected.id} onClose={() => setSelected(null)} />}
      {selected && category.id === 'skills' && <SkillDetail id={selected.id} onClose={() => setSelected(null)} />}
      {selected && !['characters', 'factions', 'skills'].includes(category.id) && (
        <GenericDetail category={category} entity={selected} onClose={() => setSelected(null)} />
      )}

      {/* 新增/编辑弹窗 */}
      {formOpen && (
        <EntityFormDialog
          collection={collection}
          categoryLabel={category.label}
          entity={editEntity}
          bookId={bookId}
          onClose={() => { setFormOpen(false); setEditEntity(null) }}
          onSaved={invalidate}
        />
      )}

      {/* 删除确认 */}
      {deleteTarget && (
        <DeleteConfirmDialog
          name={deleteTarget.name}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 宗门规制                                                            */
/* ------------------------------------------------------------------ */

function RulesSection({ bookId }: { bookId: number }) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data: rows, isLoading } = useAllRows('faction-rules', bookId, (p) => worldApi.factionRules(p))

  const [formOpen, setFormOpen] = useState(false)
  const [editEntity, setEditEntity] = useState<any>(null)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['world-all', 'faction-rules'] })
    queryClient.invalidateQueries({ queryKey: ['world-stats'] })
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await worldApi.remove('faction-rules', deleteTarget.id)
      toast(`已删除「{deleteTarget.ruleName}」`, 'success')
      invalidate()
    } catch (err: any) {
      toast(err.message || '删除失败', 'error')
    }
    setDeleteTarget(null)
  }

  const typeOptions = useMemo(() => (rows ? Array.from(new Set(rows.map((r) => r.ruleType).filter(Boolean))) as string[] : []), [rows])
  const filtered = useMemo(() => {
    if (!rows) return []
    const kw = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (typeFilter && r.ruleType !== typeFilter) return false
      if (!kw) return true
      return [r.ruleName, r.ruleContent, r.factionName].filter(Boolean).join(' ').toLowerCase().includes(kw)
    })
  }, [rows, search, typeFilter])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input placeholder="搜索规制..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setTypeFilter('')} className={cn('rounded-md border px-2.5 py-1 text-xs', !typeFilter ? 'border-gray-500 bg-gray-700 text-white' : 'border-gray-800 bg-gray-900 text-gray-400 hover:text-gray-200')}>全部</button>
          {typeOptions.map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)} className={cn('rounded-md border px-2.5 py-1 text-xs', typeFilter === t ? 'border-gray-500 bg-gray-700 text-white' : 'border-gray-800 bg-gray-900 text-gray-400 hover:text-gray-200')}>{t}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <span className="text-xs text-gray-600">{filtered.length} 条</span>
          <Button size="sm" onClick={() => { setEditEntity(null); setFormOpen(true) }}>
            <Plus className="h-3.5 w-3.5" />新增规制
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <EmptyState message="没有匹配的规制" />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((r: any, i) => (
            <Card key={r.id} className="group animate-rise transition-colors hover:border-orange-500/40" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 shrink-0 text-orange-400" />
                    <h3 className="font-serif font-bold text-gray-100">{r.ruleName}</h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {r.ruleType && <Chip className="border-gray-700 bg-gray-800 text-gray-300">{r.ruleType}</Chip>}
                    {r.severity && <Badge variant={severityVariant[r.severity] || 'default'}>{r.severity}</Badge>}
                    <button className="hidden rounded p-2 text-gray-500 hover:bg-gray-700 hover:text-indigo-300 group-hover:block focus:block" title="编辑" aria-label="编辑" onClick={() => { setEditEntity(r); setFormOpen(true) }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button className="hidden rounded p-2 text-gray-500 hover:bg-gray-700 hover:text-red-300 group-hover:block focus:block" title="删除" aria-label="删除" onClick={() => setDeleteTarget(r)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-gray-400">{r.ruleContent}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                  {r.factionName && <span>所属：<span className="text-amber-400/80">{r.factionName}</span></span>}
                  {r.enforcement && <span>执行：{r.enforcement}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {formOpen && (
        <EntityFormDialog collection="faction-rules" categoryLabel="宗门规制" entity={editEntity} bookId={bookId} onClose={() => { setFormOpen(false); setEditEntity(null) }} onSaved={invalidate} />
      )}
      {deleteTarget && (
        <DeleteConfirmDialog name={deleteTarget.ruleName} onConfirm={handleDelete} onClose={() => setDeleteTarget(null)} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 岁时节令                                                            */
/* ------------------------------------------------------------------ */

function EventsSection({ bookId }: { bookId: number }) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data: rows, isLoading } = useAllRows('season-events', bookId, (p) => worldApi.seasonEvents(p))

  const [formOpen, setFormOpen] = useState(false)
  const [editEntity, setEditEntity] = useState<any>(null)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['world-all', 'season-events'] })
    queryClient.invalidateQueries({ queryKey: ['world-stats'] })
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await worldApi.remove('season-events', deleteTarget.id)
      toast(`已删除「{deleteTarget.eventName}」`, 'success')
      invalidate()
    } catch (err: any) {
      toast(err.message || '删除失败', 'error')
    }
    setDeleteTarget(null)
  }

  const typeOptions = useMemo(() => (rows ? Array.from(new Set(rows.map((r) => r.eventType).filter(Boolean))) as string[] : []), [rows])
  const filtered = useMemo(() => {
    if (!rows) return []
    const kw = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (typeFilter && r.eventType !== typeFilter) return false
      if (!kw) return true
      return [r.eventName, r.atmosphere, r.relatedFaction].filter(Boolean).join(' ').toLowerCase().includes(kw)
    })
  }, [rows, search, typeFilter])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input placeholder="搜索节令事件..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setTypeFilter('')} className={cn('rounded-md border px-2.5 py-1 text-xs', !typeFilter ? 'border-gray-500 bg-gray-700 text-white' : 'border-gray-800 bg-gray-900 text-gray-400 hover:text-gray-200')}>全部</button>
          {typeOptions.map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)} className={cn('rounded-md border px-2.5 py-1 text-xs', typeFilter === t ? 'border-gray-500 bg-gray-700 text-white' : 'border-gray-800 bg-gray-900 text-gray-400 hover:text-gray-200')}>{t}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <span className="text-xs text-gray-600">{filtered.length} 条</span>
          <Button size="sm" onClick={() => { setEditEntity(null); setFormOpen(true) }}>
            <Plus className="h-3.5 w-3.5" />新增事件
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <EmptyState message="没有匹配的节令事件" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((ev: any, i) => (
            <Card key={ev.id} className="group animate-rise transition-colors hover:border-fuchsia-500/40" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-serif text-base font-bold text-gray-100">{ev.eventName}</h3>
                  <div className="flex items-center gap-1.5">
                    {ev.eventType && <Chip className="border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-300">{ev.eventType}</Chip>}
                    <button className="hidden rounded p-2 text-gray-500 hover:bg-gray-700 hover:text-indigo-300 group-hover:block focus:block" title="编辑" aria-label="编辑" onClick={() => { setEditEntity(ev); setFormOpen(true) }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button className="hidden rounded p-2 text-gray-500 hover:bg-gray-700 hover:text-red-300 group-hover:block focus:block" title="删除" aria-label="删除" onClick={() => setDeleteTarget(ev)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {ev.cycleDescription && <p className="mt-1 text-xs text-fuchsia-300/70">{ev.cycleDescription}</p>}
                {ev.atmosphere && <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-gray-500">{ev.atmosphere}</p>}
                {(ev.traditions?.length > 0) && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {ev.traditions.slice(0, 3).map((t: string, j: number) => (
                      <Chip key={j} className="border-gray-800 bg-gray-950/60 text-gray-400">{t}</Chip>
                    ))}
                  </div>
                )}
                {ev.relatedFaction && <p className="mt-2 text-xs text-amber-400/70">{ev.relatedFaction}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {formOpen && (
        <EntityFormDialog collection="season-events" categoryLabel="岁时节令" entity={editEntity} bookId={bookId} onClose={() => { setFormOpen(false); setEditEntity(null) }} onSaved={invalidate} />
      )}
      {deleteTarget && (
        <DeleteConfirmDialog name={deleteTarget.eventName} onConfirm={handleDelete} onClose={() => setDeleteTarget(null)} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 文风引擎                                                            */
/* ------------------------------------------------------------------ */

function RatioBars({ data }: { data: any }) {
  if (!data || typeof data !== 'object') return null
  const entries = Object.entries(data)
  if (!entries.length) return null
  const max = Math.max(...entries.map(([, v]) => Number(v) || 0), 1)
  return (
    <div className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-xs text-gray-400">{k}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400" style={{ width: `${((Number(v) || 0) / max) * 100}%` }} />
          </div>
          <span className="w-10 shrink-0 text-right text-xs text-gray-500">{String(v)}</span>
        </div>
      ))}
    </div>
  )
}

function StyleImportDialog({ books, currentBookId, onClose, onDone }: {
  books?: any[]; currentBookId: number; onClose: () => void; onDone: () => void
}) {
  const { toast } = useToast()
  const sourceOptions = (books || [])
    .filter((b) => b.bookId !== currentBookId)
    .map((b) => ({ value: String(b.bookId), label: `${b.bookName}${b.author ? ' · ' + b.author : ''}` }))
  const [sourceBookId, setSourceBookId] = useState<number>(Number(sourceOptions[0]?.value || 1))
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ cloned: boolean; configCopied: number; mappingsCopied: number; reason?: string } | null>(null)

  const currentBook = (books || []).find((b) => b.bookId === currentBookId)
  const isSystemTarget = currentBook?.sourceType === 'system'

  const handleImport = async () => {
    setRunning(true)
    try {
      const res = await worldApi.importStyle({ sourceBookId, targetBookId: currentBookId })
      setResult(res)
      if (res.cloned) { toast('文风引入成功', 'success'); onDone() }
    } catch (e: any) {
      toast(e?.message || '引入失败', 'error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="跨书引入文风" className="max-w-md">
      <div className="space-y-4">
        {isSystemTarget && (
          <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            当前书籍《{currentBook?.bookName}》为系统内置书，不可写入。请切换到用户创建的书后再引入。
          </div>
        )}
        {result ? (
          <div className="space-y-3">
            {result.cloned ? (
              <div className="rounded-lg border border-ok/30 bg-ok/5 px-4 py-3 text-sm text-ok">
                引入成功：全局配置 {result.configCopied} 套 · 场景映射 {result.mappingsCopied} 条
              </div>
            ) : (
              <div className="rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
                {result.reason || '未引入'}
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={onClose}>完成</Button>
            </div>
          </div>
        ) : (
          <>
            <Select
              label="源书籍（从这里复制文风）"
              options={sourceOptions.length ? sourceOptions : [{ value: '', label: '无可用源书' }]}
              value={String(sourceBookId)}
              onChange={(e) => setSourceBookId(Number(e.target.value))}
            />
            <p className="text-xs text-gray-500">
              将复制源书的全局文风配置与全部场景映射。若当前书已有文风配置，则跳过不覆盖。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>取消</Button>
              <Button disabled={!sourceBookId || isSystemTarget || running} onClick={handleImport}>
                {running ? <Spinner className="h-4 w-4" /> : <FolderInput className="h-4 w-4" />} 引入
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}

function StyleSection({ bookId, books }: { bookId: number; books?: any[] }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['world-style', bookId], queryFn: () => worldApi.style(bookId), staleTime: 5 * 60 * 1000 })
  const cfg = data?.globalConfig
  const mappingsByType = data?.mappingsByType || {}

  const [importOpen, setImportOpen] = useState(false)
  const canImport = (books || []).length > 1
  const importDialog = importOpen ? (
    <StyleImportDialog
      books={books}
      currentBookId={bookId}
      onClose={() => setImportOpen(false)}
      onDone={() => { queryClient.invalidateQueries({ queryKey: ['world-style', bookId] }); setImportOpen(false) }}
    />
  ) : null

  if (isLoading) return <div className="flex justify-center py-16"><Spinner /></div>

  if (!cfg) return (
    <div className="space-y-4">
      <EmptyState message="暂无文风配置" />
      {canImport && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FolderInput className="h-4 w-4" /> 从其他书引入文风
          </Button>
        </div>
      )}
      {importDialog}
    </div>
  )

  return (
    <div className="space-y-6">
      {/* 全局风格 */}
      <Card className="overflow-hidden">
        <div className="border-b border-gray-800 bg-gradient-to-r from-indigo-950/40 via-gray-900 to-gray-900 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/20 ring-1 ring-indigo-500/40">
              <Feather className="h-5 w-5 text-indigo-300" />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-gray-500">GLOBAL STYLE</div>
              <h3 className="font-serif text-xl font-bold text-gray-100">{cfg.styleName}</h3>
            </div>
            <div className="flex-1" />
            {canImport && (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <FolderInput className="h-3.5 w-3.5" /> 引入文风
              </Button>
            )}
          </div>
        </div>
        <CardContent className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-300"><Brain className="h-4 w-4" />心智模型</h4>
              <ul className="space-y-1.5">
                {(cfg.mentalModels || []).map((m: string, i: number) => (
                  <li key={i} className="rounded-md border border-gray-800 bg-gray-950/50 px-3 py-1.5 text-sm text-gray-300">{m}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300"><Route className="h-4 w-4" />决策启发式</h4>
              <ul className="space-y-1.5">
                {(cfg.decisionHeuristics || []).map((m: string, i: number) => (
                  <li key={i} className="rounded-md border border-gray-800 bg-gray-950/50 px-3 py-1.5 text-sm text-gray-300">{m}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <h4 className="mb-2 text-sm font-semibold text-sky-300">描写比例</h4>
              <RatioBars data={cfg.descriptionRatio} />
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold text-emerald-300">核心意象</h4>
              <div className="flex flex-wrap gap-1.5">
                {(cfg.coreImagery || []).map((w: string, i: number) => (
                  <Chip key={i} className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">{w}</Chip>
                ))}
              </div>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold text-rose-300">禁用词</h4>
              <div className="flex flex-wrap gap-1.5">
                {(cfg.forbiddenWords || []).map((w: string, i: number) => (
                  <Chip key={i} className="border-rose-500/30 bg-rose-500/10 text-rose-300 line-through">{w}</Chip>
                ))}
              </div>
            </div>
            {(cfg.perspectiveRules?.length > 0) && (
              <div>
                <h4 className="mb-2 text-sm font-semibold text-gray-300">视角规则</h4>
                <ul className="list-inside list-disc space-y-1 text-sm text-gray-400">
                  {cfg.perspectiveRules.map((r: string, i: number) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
            {(cfg.antiPatterns?.length > 0) && (
              <div>
                <h4 className="mb-2 text-sm font-semibold text-rose-300">反模式（避免写法）</h4>
                <ul className="list-inside list-disc space-y-1 text-sm text-gray-400">
                  {cfg.antiPatterns.map((r: string, i: number) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 场景映射 */}
      <div>
        <SectionHeading title="场景文风映射" en="SCENE MAPPING" desc="按场景参数动态调整文风" />
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Object.entries(mappingsByType).map(([type, list]: [string, any]) => (
            <Card key={type}>
              <CardContent className="p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-indigo-300">
                  <Sparkles className="h-4 w-4" />
                  {mappingTypeLabels[type] || type}
                  <span className="text-xs font-normal text-gray-600">（{list.length} 条规则）</span>
                </h4>
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {list.map((m: any) => (
                    <div key={m.mappingId} className="rounded-lg border border-gray-800 bg-gray-950/50 p-3">
                      <div className="flex items-center gap-2">
                        <Chip className="border-indigo-500/30 bg-indigo-500/10 text-indigo-300">{m.triggerKey}</Chip>
                        <ArrowRight className="h-3 w-3 text-gray-600" />
                        <span className="truncate text-xs text-gray-400">{m.description || JSON.stringify(m.resultValue)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      {importDialog}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 主页面                                                             */
/* ------------------------------------------------------------------ */

export default function WorldBrowser() {
  const [bookId, setBookId] = useState(1)
  const [section, setSection] = useState<SectionId>('bestiary')
  const [categoryId, setCategoryId] = useState('characters')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<any[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)

  // 书籍列表（用于切换书籍，book_id 隔离）
  const { data: books } = useQuery({ queryKey: ['world-books'], queryFn: () => worldApi.books(), staleTime: 10 * 60 * 1000 })

  const { data: stats } = useQuery({ queryKey: ['world-stats', bookId], queryFn: () => worldApi.stats(bookId), staleTime: 5 * 60 * 1000 })

  // 关系图谱数据（仅在 graph 分区时获取）
  const { data: graphData, isLoading: graphLoading } = useQuery({
    queryKey: ['world-graph', bookId],
    queryFn: () => worldApi.graph(bookId),
    enabled: section === 'graph',
    staleTime: 5 * 60 * 1000,
  })

  const category = entityCategories.find((c) => c.id === categoryId) || entityCategories[0]

  const handleJump = (s: SectionId, cat?: string) => {
    setSection(s)
    if (cat) setCategoryId(cat)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSearch = async () => {
    const kw = searchKeyword.trim()
    if (!kw) { setSearchResults(null); return }
    setSearchLoading(true)
    try {
      const res = await worldApi.search(kw)
      // 后端返回 { characters: [...], factions: [...], ... } 对象，展平为数组
      const typeLabels: Record<string, string> = {
        characters: '人物', factions: '门派', locations: '地点',
        skills: '功法', items: '法宝', monsters: '妖兽',
      }
      if (res && typeof res === 'object' && !Array.isArray(res)) {
        const flat = Object.entries(res).flatMap(([key, items]: [string, any]) =>
          (Array.isArray(items) ? items : []).map((item: any) => ({ ...item, type: typeLabels[key] || key }))
        )
        setSearchResults(flat)
      } else {
        setSearchResults(Array.isArray(res) ? res : [])
      }
    } catch {
      setSearchResults([])
    } finally {
      setSearchLoading(false)
    }
  }

  const activeSection = sections.find((s) => s.id === section)!

  return (
    <div className="space-y-5">
      {/* 书籍切换器（最顶部）*/}
      <BookSwitcher books={books} bookId={bookId} onChange={setBookId} />

      <Header stats={stats} onJump={handleJump} />

      {/* 全局搜索 */}
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <Input
              className="pl-9"
              placeholder="全局搜索人物、功法、地点、妖兽…"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <Button variant="outline" onClick={handleSearch} loading={searchLoading}>搜索</Button>
        </div>
        {searchResults !== null && (
          <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-gray-500">搜索结果（{searchResults.length}）</span>
              <button onClick={() => setSearchResults(null)} className="text-xs text-gray-500 hover:text-gray-300">关闭</button>
            </div>
            {searchResults.length === 0 ? (
              <p className="py-2 text-center text-sm text-gray-600">未找到匹配结果</p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {searchResults.map((r: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-800">
                    <Badge variant="default" className="shrink-0 text-[10px]">{r.type || r.category || '实体'}</Badge>
                    <span className="text-sm text-gray-200">{r.name || r.title}</span>
                    {r.description && <span className="truncate text-xs text-gray-500">{r.description}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 分区导航 */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={cn(
              'group rounded-xl border px-4 py-3 text-left transition-all',
              section === s.id
                ? 'border-indigo-500/50 bg-indigo-500/10 shadow-md shadow-indigo-900/20'
                : 'border-gray-800 bg-gray-900 hover:border-gray-600'
            )}
          >
            <div className="flex items-center gap-2">
              <s.icon className={cn('h-4 w-4', section === s.id ? 'text-indigo-300' : 'text-gray-500 group-hover:text-gray-300')} />
              <span className={cn('font-serif text-base font-bold', section === s.id ? 'text-white' : 'text-gray-300')}>{s.label}</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-gray-600">{s.desc}</div>
          </button>
        ))}
      </div>

      {/* 分区标题 */}
      <SectionHeading title={activeSection.label} en={activeSection.en} desc={activeSection.desc} />

      {section === 'bestiary' && <BestiarySection category={category} onCategoryChange={setCategoryId} bookId={bookId} />}
      {section === 'graph' && (
        graphLoading
          ? <div className="flex justify-center py-16"><Spinner /></div>
          : <RelationGraph nodes={graphData?.nodes || []} links={graphData?.links || []} />
      )}
      {section === 'rules' && <RulesSection bookId={bookId} />}
      {section === 'events' && <EventsSection bookId={bookId} />}
      {section === 'style' && <StyleSection bookId={bookId} books={books} />}

      {/* 模块8：人物关系动态推演*/}
      <RelationPanel />
    </div>
  )
}
