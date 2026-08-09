/**
 * 场景脚本面板（原"场景小纲"） - 拖拽编排系统
 * 布局：左侧素材池(拖拽源) + 中间画布(节点卡片，拖拽目标 + 排序)
 * 点击节点卡片打开「场景节点编辑器」大弹窗：时间/地点/人物/功法/法宝/妖兽框 + 迷你素材池 + 智能匹配
 */
import { useState, useCallback, useMemo, createContext, useContext } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent, DragStartEvent, DragOverlay, useDraggable,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  rectSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus, GripVertical, Link2, Star, Trash2, Search,
  User, MapPin, Sword, Shield, Bug, Bookmark,
  ChevronLeft, ChevronRight, Sparkles, MessageSquare,
  Download, CheckCircle2, X, Pencil, History,
  FlaskConical, Gift, AlertTriangle, Info, XCircle, Clock, ListChecks, List, LayoutGrid,
} from 'lucide-react'
import {
  Card, CardContent, Button, Badge, Input, Textarea,
  Select, Spinner, EmptyState, useToast, Dialog,
} from '../components/ui'
import { scenesApi, worldApi, foreshadowApi, mapApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import { useAllCharacters } from '../lib/useAllCharacters'
import { cn } from '../lib/utils'

// ============ 类型 ============
interface SceneNode {
  id: number
  title: string
  timeSetting?: string
  locationDesc?: string
  coreEvent?: string
  effectAndResult?: string
  foreshadowingNote?: string
  sceneType: 'key' | 'transition' | 'foreshadow'
  isKeyPlot: boolean
  sortOrder: number
  /** v1.4 PRD-B 分支感知：linear 线性 / branch_point 分支点 */
  nodeType?: 'linear' | 'branch_point'
  /** 分支组标识（同一分支点的多条并行路径共用） */
  branchGroupId?: string | null
  /** 路径标签（如：甲线/黑化线） */
  pathLabel?: string | null
  characters: any[]
  elements: any[]
  relations: any[]
}

interface SceneOutlinePanelProps {
  projectId: string
  outlineId: string
  outlineTitle: string
}

/** 正在拖拽的素材 */
interface MaterialDrag {
  type: string
  item: any
}

// 素材分类配置
const MATERIAL_CATEGORIES = [
  { key: 'characters', label: '人物', icon: User, color: 'text-indigo-400' },
  { key: 'locations', label: '地点', icon: MapPin, color: 'text-emerald-400' },
  { key: 'skills', label: '功法', icon: Sword, color: 'text-amber-400' },
  { key: 'items', label: '法宝', icon: Shield, color: 'text-purple-400' },
  { key: 'monsters', label: '妖兽', icon: Bug, color: 'text-red-400' },
  { key: 'materials', label: '灵材', icon: FlaskConical, color: 'text-lime-400' },
  { key: 'dailyItems', label: '信物', icon: Gift, color: 'text-pink-400' },
  { key: 'foreshadow', label: '伏笔', icon: Bookmark, color: 'text-cyan-400' },
]

// 场景类型配置
const SCENE_TYPE_CONFIG: Record<string, { label: string; color: string; border: string }> = {
  key: { label: '关键剧情', color: 'text-red-300', border: 'border-l-red-500' },
  transition: { label: '过渡', color: 'text-gray-400', border: 'border-l-gray-600' },
  foreshadow: { label: '伏笔', color: 'text-cyan-300', border: 'border-l-cyan-500' },
}

/** 素材分类 key → scene_node_element.element_type（人物单独走 character 关联表） */
const MATERIAL_TO_ELEMENT: Record<string, string> = {
  locations: 'location',
  skills: 'skill',
  items: 'item',
  monsters: 'monster',
  materials: 'material',
  dailyItems: 'daily_item',
}

/** 编辑器内的素材框配置（可关联的 7 类） */
const EDITOR_BOXES = [
  { type: 'characters', label: '人物', icon: User, color: 'text-indigo-400', chip: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' },
  { type: 'locations', label: '地点', icon: MapPin, color: 'text-emerald-400', chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  { type: 'skills', label: '功法', icon: Sword, color: 'text-amber-400', chip: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  { type: 'items', label: '法宝', icon: Shield, color: 'text-purple-400', chip: 'border-purple-500/30 bg-purple-500/10 text-purple-300' },
  { type: 'monsters', label: '妖兽', icon: Bug, color: 'text-red-400', chip: 'border-red-500/30 bg-red-500/10 text-red-300' },
  { type: 'materials', label: '灵材', icon: FlaskConical, color: 'text-lime-400', chip: 'border-lime-500/30 bg-lime-500/10 text-lime-300' },
  { type: 'dailyItems', label: '信物', icon: Gift, color: 'text-pink-400', chip: 'border-pink-500/30 bg-pink-500/10 text-pink-300' },
]

const boxLabel = (type: string) => EDITOR_BOXES.find((b) => b.type === type)?.label || type

// ============ 素材池书籍切换（主池 + 迷你池共享） ============
interface BookSelection {
  bookId: number
  setBookId: (id: number) => void
  books: any[]
}
const BookContext = createContext<BookSelection>({ bookId: 1, setBookId: () => {}, books: [] })
const useBookSelection = () => useContext(BookContext)

/** 紧凑书籍下拉（素材池头部用） */
function BookSelect() {
  const { bookId, setBookId, books } = useBookSelection()
  return (
    <select
      value={bookId}
      onChange={(e) => setBookId(Number(e.target.value))}
      className="max-w-[110px] rounded-md border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300 focus:border-indigo-500"
      title="切换素材来源书籍"
    >
      {books.length === 0 && <option value={1}>诛仙</option>}
      {books.map((b: any) => (
        <option key={b.bookId ?? b.id} value={b.bookId ?? b.id}>
          {(b.bookName ?? b.name ?? `书${b.bookId ?? b.id}`).slice(0, 8)}
        </option>
      ))}
    </select>
  )
}

// ============ 素材数据 Hook（主池 + 迷你池共用） ============
function useMaterials(category: string, keyword: string) {
  // 人物分类走合并数据源：本项目自定义人物（★、负数ID）排前 + 诛仙库人物
  const projectId = useCurrentProjectId()
  const { bookId } = useBookSelection()
  const mergedChars = useAllCharacters(projectId, keyword || undefined, category === 'characters', bookId)

  const othersQuery = useQuery({
    queryKey: ['scene-materials', category, keyword, bookId],
    queryFn: () => {
      const params: any = { bookId, ...(keyword ? { keyword } : {}) }
      switch (category) {
        case 'locations': return worldApi.locations(params)
        case 'skills': return worldApi.skills(params)
        case 'items': return worldApi.items(params)
        case 'monsters': return worldApi.monsters(params)
        case 'materials': return worldApi.materials(params)
        case 'dailyItems': return worldApi.dailyItems(params)
        default: return Promise.resolve([])
      }
    },
    enabled: category !== 'characters',
    staleTime: 5 * 60 * 1000,
  })

  if (category === 'characters') {
    return { data: mergedChars.characters, isLoading: mergedChars.isLoading }
  }
  return { data: othersQuery.data, isLoading: othersQuery.isLoading }
}

// ============ 可排序节点卡片（同时是素材拖放目标） ============
function SortableNodeCard({
  node, onOpen, onDelete, materialDragActive,
}: {
  node: SceneNode
  onOpen: () => void
  onDelete: () => void
  materialDragActive: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: node.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const typeConfig = SCENE_TYPE_CONFIG[node.sceneType] || SCENE_TYPE_CONFIG.transition
  // 拖素材悬停到卡片上时高亮
  const showDropHint = materialDragActive && isOver

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative cursor-pointer rounded-lg border border-l-4 bg-gray-900 p-3 transition-colors',
        typeConfig.border,
        showDropHint
          ? 'border-indigo-400 ring-2 ring-indigo-500/60 bg-indigo-500/10'
          : 'border-gray-800 hover:border-gray-700',
      )}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      title="点击编辑场景"
    >
      <div className="flex items-start gap-2">
        {/* 拖拽手柄（排序） */}
        <button
          className="mt-0.5 cursor-grab text-gray-600 hover:text-gray-400 active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
          aria-label="拖拽排序"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="flex-1 min-w-0">
          {/* 标题行 */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-200 truncate">{node.title}</span>
            {node.isKeyPlot && <Star className="h-3 w-3 shrink-0 text-amber-400 fill-amber-400" />}
            <Badge variant="default" className="shrink-0 text-[10px] px-1.5 py-0">
              {typeConfig.label}
            </Badge>
            {/* v1.4 分支标识：分支点/路径标签 */}
            {node.nodeType === 'branch_point' && (
              <span
                className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400"
                title={`分支点${node.branchGroupId ? `（分组：${node.branchGroupId}）` : ''}：后续场景从此处分叉`}
              >
                分支点
              </span>
            )}
            {node.pathLabel && (
              <span
                className="shrink-0 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300"
                title={`属于分支路径「${node.pathLabel}」${node.branchGroupId ? `（分组：${node.branchGroupId}）` : ''}`}
              >
                {node.pathLabel}
              </span>
            )}
          </div>

          {/* 摘要信息 */}
          {node.coreEvent && (
            <p className="mt-1 text-xs text-gray-500 line-clamp-2">{node.coreEvent}</p>
          )}

          {/* 关联标签 */}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {node.characters?.slice(0, 3).map((ch: any) => (
              <span key={ch.id} className="inline-flex items-center gap-0.5 rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] text-indigo-300">
                <User className="h-2.5 w-2.5" />
                {ch.roleNote || `#${ch.characterId}`}
              </span>
            ))}
            {node.elements?.slice(0, 2).map((el: any) => (
              <span key={el.id} className="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                <MapPin className="h-2.5 w-2.5" />
                {el.elementNote || el.elementType}
              </span>
            ))}
            {node.relations?.length > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-300">
                <Link2 className="h-2.5 w-2.5" />
                {node.relations.length} 连线
              </span>
            )}
          </div>
        </div>

        {/* 编辑 / 删除按钮 */}
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            className="rounded p-2 text-gray-600 hover:text-indigo-300"
            title="编辑"
            aria-label="编辑"
            onClick={(e) => { e.stopPropagation(); onOpen() }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded p-2 text-gray-600 hover:text-red-400"
            title="删除"
            aria-label="删除"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ============ 软木板卡片视图节点卡（开源借鉴 PRD v1.1 M4b，网格拖拽换位） ============
function CorkboardNodeCard({
  node, index, onOpen, onDelete, materialDragActive,
}: {
  node: SceneNode
  index: number
  onOpen: () => void
  onDelete: () => void
  materialDragActive: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: node.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const typeConfig = SCENE_TYPE_CONFIG[node.sceneType] || SCENE_TYPE_CONFIG.transition
  const showDropHint = materialDragActive && isOver
  const materialCount = (node.characters?.length || 0) + (node.elements?.length || 0)

  return (
    <div
      ref={setNodeRef}
      style={style}
      id={`scene-node-${node.id}`}
      className={cn(
        'group relative flex h-40 cursor-pointer flex-col rounded-lg border bg-gray-900 p-3 shadow-md transition-colors',
        typeConfig.border,
        'border-l-4',
        showDropHint
          ? 'border-indigo-400 ring-2 ring-indigo-500/60 bg-indigo-500/10'
          : 'border-gray-800 hover:border-gray-600',
      )}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      title="点击编辑场景"
    >
      {/* 头部：序号+拖拽手柄+操作 */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono text-gray-600">#{index + 1}</span>
        <button
          className="cursor-grab text-gray-600 hover:text-gray-400 active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
          aria-label="拖拽排序"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <span className="flex-1" />
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            className="rounded p-1 text-gray-600 hover:text-indigo-300"
            aria-label="编辑"
            onClick={(e) => { e.stopPropagation(); onOpen() }}
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            className="rounded p-1 text-gray-600 hover:text-red-400"
            aria-label="删除"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* 标题+徽章 */}
      <div className="mt-1 flex items-center gap-1.5">
        <span className="truncate text-sm font-medium text-gray-200">{node.title}</span>
        {node.isKeyPlot && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <Badge variant="default" className="px-1.5 py-0 text-[10px]">{typeConfig.label}</Badge>
        {node.nodeType === 'branch_point' && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">分支点</span>
        )}
        {node.pathLabel && (
          <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300">{node.pathLabel}</span>
        )}
      </div>

      {/* 核心事件 */}
      {node.coreEvent && (
        <p className="mt-1.5 flex-1 overflow-hidden text-xs leading-5 text-gray-500 line-clamp-3">{node.coreEvent}</p>
      )}

      {/* 底部：关联素材数 */}
      <div className="mt-auto flex items-center gap-2 pt-1 text-[10px] text-gray-600">
        <span className="inline-flex items-center gap-0.5">
          <Link2 className="h-2.5 w-2.5" />
          {materialCount} 个关联素材
        </span>
        {node.relations?.length > 0 && <span>{node.relations.length} 连线</span>}
      </div>
    </div>
  )
}

// ============ 素材池可拖拽条目 ============
function DraggableMaterialItem({ type, item }: { type: string; item: any }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `mat-${type}-${item.charId ?? item.id ?? item.name}`,
    data: { kind: 'material', materialType: type, item },
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'w-full cursor-grab rounded-md border border-gray-800 bg-gray-800/50 px-2.5 py-2 text-left text-xs text-gray-300 transition-colors hover:border-indigo-500/50 hover:bg-gray-800 active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
      title="拖拽到场景节点添加"
    >
      <span className="font-medium text-gray-200">{item.name}</span>
      {item.faction && <span className="ml-1 text-gray-500">· {item.faction}</span>}
      {item.grade && <span className="ml-1 text-gray-500">· {item.grade}</span>}
      {item.level && <span className="ml-1 text-gray-500">· {item.level}</span>}
    </div>
  )
}

// ============ 素材池面板（拖拽源） ============
function MaterialPool() {
  const [activeCategory, setActiveCategory] = useState('characters')
  const [keyword, setKeyword] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const { data: materials, isLoading } = useMaterials(activeCategory, keyword)

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 py-4">
        <button onClick={() => setCollapsed(false)} className="rounded p-1 text-gray-500 hover:text-gray-300">
          <ChevronRight className="h-4 w-4" />
        </button>
        {MATERIAL_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => { setCollapsed(false); setActiveCategory(cat.key) }}
            className={cn('rounded p-1.5', cat.color)}
            title={cat.label}
          >
            <cat.icon className="h-4 w-4" />
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-1 px-3 py-2">
        <span className="text-xs font-medium text-gray-400">素材池</span>
        <div className="flex items-center gap-1">
          <BookSelect />
          <button onClick={() => setCollapsed(true)} className="rounded p-0.5 text-gray-500 hover:text-gray-300">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 分类标签 */}
      <div className="flex flex-wrap gap-1 px-3 pb-2">
        {MATERIAL_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors',
              activeCategory === cat.key
                ? 'bg-gray-700 text-gray-200'
                : 'text-gray-500 hover:text-gray-300'
            )}
          >
            <cat.icon className={cn('h-3 w-3', cat.color)} />
            {cat.label}
          </button>
        ))}
      </div>

      {/* 搜索 */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-500" />
          <input
            className="w-full rounded-md border border-gray-700 bg-gray-800 py-1.5 pl-7 pr-2 text-xs text-gray-200 placeholder:text-gray-600 focus:border-indigo-500"
            placeholder="搜索素材..."
            aria-label="搜索"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
      </div>

      <p className="px-3 pb-1.5 text-[10px] text-gray-600">拖拽素材到场景节点添加</p>

      {/* 素材列表（可拖拽） */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner className="h-4 w-4" /></div>
        ) : !materials?.length ? (
          <p className="py-4 text-center text-xs text-gray-600">暂无素材</p>
        ) : (
          <div className="space-y-1">
            {materials.slice(0, 30).map((item: any) => (
              <DraggableMaterialItem key={item.id || item.charId || item.name} type={activeCategory} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============ 备注输入（失焦提交） ============
function NoteInput({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value)
  return (
    <input
      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-gray-200 hover:border-gray-700 focus:border-indigo-500 focus:bg-gray-800 focus:outline-none"
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== value) onCommit(v) }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )
}

// ============ 素材框（编辑器内，某类已关联素材的增删改） ============
function MaterialBox({
  box, rows, onRemove, onUpdateNote,
}: {
  box: typeof EDITOR_BOXES[number]
  rows: { assocId: number; note: string }[]
  onRemove: (assocId: number) => void
  onUpdateNote: (assocId: number, note: string) => void
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <box.icon className={cn('h-4 w-4', box.color)} />
        <span className="text-sm font-medium text-gray-200">{box.label}</span>
        <span className="text-xs text-gray-600">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-1 text-center text-[11px] text-gray-600">点击右侧素材池添加，或使用智能匹配</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div key={row.assocId} className="flex items-center gap-1.5 rounded-md border border-gray-800 bg-gray-950/60 px-2 py-1">
              <box.icon className={cn('h-3 w-3 shrink-0', box.color)} />
              <NoteInput value={row.note} onCommit={(v) => onUpdateNote(row.assocId, v)} placeholder="名称/备注" />
              <button
                className="shrink-0 rounded p-2 text-gray-600 hover:text-red-400"
                title="移除"
                aria-label="移除"
                onClick={() => onRemove(row.assocId)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============ 迷你素材池（编辑器内，点击添加） ============
function MiniPool({
  onAdd, isLinked,
}: {
  onAdd: (type: string, item: any) => void
  isLinked: (type: string, entityId: number) => boolean
}) {
  const [activeCategory, setActiveCategory] = useState('characters')
  const [keyword, setKeyword] = useState('')
  const { data: materials, isLoading } = useMaterials(activeCategory, keyword)

  return (
    <div className="flex h-full flex-col rounded-lg border border-gray-800 bg-gray-900/60">
      <div className="flex items-center justify-between gap-1 px-3 pt-2.5">
        <span className="text-xs font-medium text-gray-400">素材池</span>
        <BookSelect />
      </div>
      <div className="flex flex-wrap gap-1 px-3 py-2">
        {EDITOR_BOXES.map((cat) => (
          <button
            key={cat.type}
            onClick={() => setActiveCategory(cat.type)}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors',
              activeCategory === cat.type ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300'
            )}
          >
            <cat.icon className={cn('h-3 w-3', cat.color)} />
            {cat.label}
          </button>
        ))}
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-500" />
          <input
            className="w-full rounded-md border border-gray-700 bg-gray-800 py-1.5 pl-7 pr-2 text-xs text-gray-200 placeholder:text-gray-600 focus:border-indigo-500"
            placeholder="搜索素材..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3" style={{ maxHeight: '320px' }}>
        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner className="h-4 w-4" /></div>
        ) : !materials?.length ? (
          <p className="py-4 text-center text-xs text-gray-600">暂无素材</p>
        ) : (
          <div className="space-y-1">
            {materials.slice(0, 30).map((item: any) => {
              const entityId = item.charId ?? item.id
              const linked = isLinked(activeCategory, entityId)
              return (
                <button
                  key={item.id || item.charId || item.name}
                  disabled={linked}
                  onClick={() => onAdd(activeCategory, item)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
                    linked
                      ? 'cursor-not-allowed border-gray-800 bg-gray-900/40 text-gray-600'
                      : 'border-gray-800 bg-gray-800/50 text-gray-300 hover:border-indigo-500/50 hover:bg-gray-800'
                  )}
                  title={linked ? '已添加' : '点击添加'}
                >
                  <span className="truncate">
                    <span className="font-medium">{item.name}</span>
                    {item.faction && <span className="ml-1 text-gray-500">· {item.faction}</span>}
                    {item.grade && <span className="ml-1 text-gray-500">· {item.grade}</span>}
                  </span>
                  {linked ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <Plus className="h-3 w-3 shrink-0 text-gray-500" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ============ 节点连线管理 ============
const RELATION_TYPES = [
  { value: 'causal', label: '因果' },
  { value: 'sequential', label: '顺承' },
  { value: 'foreshadow_echo', label: '伏笔呼应' },
]

function RelationSection({
  node, allNodes, projectId, outlineId, refresh,
}: {
  node: SceneNode
  allNodes: SceneNode[]
  projectId: string
  outlineId: string
  refresh: () => void
}) {
  const { toast } = useToast()
  const [targetId, setTargetId] = useState('')
  const [relType, setRelType] = useState('sequential')
  const [adding, setAdding] = useState(false)

  const sceneId = String(node.id)
  const otherNodes = allNodes.filter((n) => n.id !== node.id)
  const nodeTitle = (id: number) => allNodes.find((n) => n.id === id)?.title || `#${id}`
  const relLabel = (t: string) => RELATION_TYPES.find((r) => r.value === t)?.label || t

  const addRelation = async () => {
    if (!targetId) return
    try {
      await scenesApi.addRelation(projectId, outlineId, sceneId, {
        targetNodeId: Number(targetId),
        relationType: relType,
      })
      refresh()
      setTargetId('')
      setAdding(false)
      toast('连线已添加', 'success')
    } catch (err: any) {
      toast(err.message || '添加连线失败', 'error')
    }
  }

  const removeRelation = async (relationId: number) => {
    try {
      await scenesApi.removeRelation(projectId, outlineId, sceneId, String(relationId))
      refresh()
      toast('连线已删除', 'success')
    } catch (err: any) {
      toast(err.message || '删除连线失败', 'error')
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300">节点连线</h3>
        <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}>
          <Link2 className="h-3 w-3" />
          {adding ? '收起' : '添加连线'}
        </Button>
      </div>

      {/* 添加连线表单 */}
      {adding && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-gray-700/50 bg-gray-800/30 p-3">
          <div className="min-w-[180px] flex-1">
            <Select
              label="目标节点"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              options={[
                { value: '', label: '选择节点...' },
                ...otherNodes.map((n) => ({ value: String(n.id), label: n.title || `#${n.id}` })),
              ]}
            />
          </div>
          <div className="w-32">
            <Select
              label="连线类型"
              value={relType}
              onChange={(e) => setRelType(e.target.value)}
              options={RELATION_TYPES}
            />
          </div>
          <Button size="sm" disabled={!targetId} onClick={addRelation}>
            <Plus className="h-3 w-3" />
            连接
          </Button>
        </div>
      )}

      {/* 已有连线列表 */}
      {node.relations.length === 0 ? (
        <p className="text-xs text-gray-600">暂无连线，点击「添加连线」建立节点间的因果/顺承/伏笔关系</p>
      ) : (
        <div className="space-y-1.5">
          {node.relations.map((r: any) => (
            <div key={r.id} className="group flex items-center gap-2 rounded-md border border-gray-700/40 bg-gray-800/20 px-3 py-1.5">
              <Link2 className="h-3 w-3 shrink-0 text-gray-500" />
              <Badge variant="default" className="text-[10px]">{relLabel(r.relationType)}</Badge>
              <span className="text-xs text-gray-300">→ {nodeTitle(r.targetNodeId)}</span>
              {r.description && <span className="text-[10px] text-gray-600">({r.description})</span>}
              <button
                onClick={() => removeRelation(r.id)}
                className="ml-auto rounded p-0.5 text-gray-500 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                title="删除连线"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ============ 场景节点编辑器主体 ============
function EditorBody({
  node, allNodes, projectId, outlineId, onClose,
}: {
  node: SceneNode
  allNodes: SceneNode[]
  projectId: string
  outlineId: string
  onClose: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const sceneId = String(node.id)

  // 文本字段表单（仅初始化一次，避免刷新覆盖用户输入）
  const [form, setForm] = useState({
    title: node.title || '',
    timeSetting: node.timeSetting || '',
    locationDesc: node.locationDesc || '',
    coreEvent: node.coreEvent || '',
    effectAndResult: node.effectAndResult || '',
    foreshadowingNote: node.foreshadowingNote || '',
    sceneType: node.sceneType || 'transition',
    isKeyPlot: node.isKeyPlot || false,
    nodeType: node.nodeType || 'linear',
    branchGroupId: node.branchGroupId || '',
    pathLabel: node.pathLabel || '',
  })

  // 智能匹配候选
  const [candidates, setCandidates] = useState<any | null>(null)

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['scene-nodes', projectId, outlineId] })
  }, [queryClient, projectId, outlineId])

  // 保存文本字段
  const saveMutation = useMutation({
    mutationFn: () => scenesApi.update(projectId, outlineId, sceneId, form),
    onSuccess: () => { refresh(); toast('场景已保存', 'success') },
    onError: (err: any) => toast(err.message || '保存失败', 'error'),
  })

  // 智能匹配
  const matchMutation = useMutation({
    mutationFn: () => scenesApi.matchMaterials(projectId, outlineId, sceneId),
    onSuccess: (data: any) => setCandidates(data),
    onError: (err: any) => toast(err.message || '匹配失败', 'error'),
  })

  // 提升为伏笔线
  const promoteMutation = useMutation({
    mutationFn: () => foreshadowApi.promote(projectId, {
      sceneNodeId: node.id,
      title: form.foreshadowingNote.slice(0, 30) || node.title,
      plantChapter: undefined,
      priority: 'normal',
    }),
    onSuccess: () => {
      refresh()
      toast('已提升为伏笔线，可在伏笔台账中查看', 'success')
    },
    onError: (err: any) => toast(err.message || '提升失败', 'error'),
  })

  // ---- US-2：山河舆图地点选择器（10-需求：可搜索下拉 + scene_node_element 写入） ----
  const { data: projectLocations = [] } = useQuery({
    queryKey: ['locations', projectId],
    queryFn: () => mapApi.listLocations(projectId),
    enabled: !!projectId,
  })
  const [locSearch, setLocSearch] = useState('')
  const linkedLocEls = useMemo(
    () => node.elements.filter((e: any) => e.elementType === 'location'),
    [node.elements]
  )
  const filteredLocs = useMemo(() => {
    const kw = locSearch.trim()
    if (!kw) return []
    return projectLocations.filter((l: any) => l.name.includes(kw)).slice(0, 6)
  }, [locSearch, projectLocations])

  const linkLocation = useCallback(async (loc: any) => {
    if (linkedLocEls.some((e: any) => e.elementId === loc.id && e.elementSource === 'custom')) {
      toast('该地点已关联', 'info')
      return
    }
    try {
      await scenesApi.addElement(projectId, outlineId, sceneId, {
        elementType: 'location', elementId: loc.id, elementSource: 'custom', elementNote: loc.name,
      })
      setForm((f: any) => ({ ...f, locationDesc: loc.name }))
      setLocSearch('')
      refresh()
      toast(`已关联地点「${loc.name}」`, 'success')
    } catch (err: any) {
      toast(err.message || '关联失败', 'error')
    }
  }, [projectId, outlineId, sceneId, linkedLocEls, refresh, toast])

  const unlinkLocation = useCallback(async (assocId: number) => {
    try {
      await scenesApi.removeElement(projectId, outlineId, sceneId, String(assocId))
      refresh()
    } catch (err: any) {
      toast(err.message || '移除失败', 'error')
    }
  }, [projectId, outlineId, sceneId, refresh, toast])

  // 已关联 id 集合（用于去重禁用）
  const linkedCharIds = useMemo(() => new Set(node.characters.map((c: any) => c.characterId)), [node.characters])
  const linkedElIdsByType = useMemo(() => {
    const m: Record<string, Set<number>> = {}
    for (const el of node.elements) {
      (m[el.elementType] ||= new Set()).add(el.elementId)
    }
    return m
  }, [node.elements])

  const isLinked = useCallback((type: string, entityId: number) => {
    if (type === 'characters') return linkedCharIds.has(entityId)
    return (linkedElIdsByType[MATERIAL_TO_ELEMENT[type]] || new Set()).has(entityId)
  }, [linkedCharIds, linkedElIdsByType])

  // 添加素材
  const addMaterial = useCallback(async (type: string, item: any) => {
    try {
      if (type === 'characters') {
        await scenesApi.addCharacter(projectId, outlineId, sceneId, {
          characterId: item.charId ?? item.id,
          appearanceType: 'core_support',
          roleNote: item.name,
        })
      } else {
        await scenesApi.addElement(projectId, outlineId, sceneId, {
          elementType: MATERIAL_TO_ELEMENT[type],
          elementId: item.id,
          elementNote: item.name,
          elementSource: item.source || 'native',
        })
      }
      refresh()
      toast(`已添加${boxLabel(type)}：${item.name}`, 'success')
    } catch (err: any) {
      toast(err.message || '添加失败', 'error')
    }
  }, [projectId, outlineId, sceneId, refresh, toast])

  // 移除关联
  const removeAssoc = useCallback(async (type: string, assocId: number) => {
    try {
      if (type === 'characters') {
        await scenesApi.removeCharacter(projectId, outlineId, sceneId, String(assocId))
      } else {
        await scenesApi.removeElement(projectId, outlineId, sceneId, String(assocId))
      }
      refresh()
      toast('已移除', 'success')
    } catch (err: any) {
      toast(err.message || '移除失败', 'error')
    }
  }, [projectId, outlineId, sceneId, refresh, toast])

  // 修改备注
  const updateNote = useCallback(async (type: string, assocId: number, note: string) => {
    try {
      if (type === 'characters') {
        await scenesApi.updateCharacter(projectId, outlineId, sceneId, String(assocId), { roleNote: note })
      } else {
        await scenesApi.updateElement(projectId, outlineId, sceneId, String(assocId), { elementNote: note })
      }
      refresh()
    } catch (err: any) {
      toast(err.message || '修改失败', 'error')
    }
  }, [projectId, outlineId, sceneId, refresh, toast])

  // 把某类框的已关联数据整理成行
  const rowsFor = (type: string): { assocId: number; note: string }[] => {
    if (type === 'characters') {
      return node.characters.map((c: any) => ({ assocId: c.id, note: c.roleNote || `#${c.characterId}` }))
    }
    const elType = MATERIAL_TO_ELEMENT[type]
    return node.elements
      .filter((e: any) => e.elementType === elType)
      .map((e: any) => ({ assocId: e.id, note: e.elementNote || e.elementType }))
  }

  const totalCandidates = candidates
    ? EDITOR_BOXES.reduce((s, b) => s + ((candidates[b.type] || []).filter((c: any) => !isLinked(b.type, c.id)).length), 0)
    : 0

  return (
    <div className="max-h-[78vh] space-y-5 overflow-y-auto pr-1">
      {/* ---- 基本信息 ---- */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-300">基本信息</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Input label="场景标题" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <Input label="时间" value={form.timeSetting} onChange={(e) => setForm({ ...form, timeSetting: e.target.value })} placeholder="如：三日后黄昏" />
          <Input label="地点" value={form.locationDesc} onChange={(e) => setForm({ ...form, locationDesc: e.target.value })} placeholder="如：青云门·通天峰" />
          {/* US-2：山河舆图地点关联（scene_node_element） */}
          <div className="col-span-2">
            {linkedLocEls.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {linkedLocEls.map((el: any) => {
                  const loc = projectLocations.find((l: any) => l.id === el.elementId)
                  return (
                    <span key={el.id} className="inline-flex items-center gap-1 rounded-full border border-gold-600/30 bg-gold-500/10 px-2 py-0.5 text-xs text-gold-300">
                      <MapPin className="h-3 w-3" />
                      {loc?.name || el.elementNote || `地点#${el.elementId}`}
                      <button type="button" onClick={() => unlinkLocation(el.id)} className="text-gray-500 hover:text-red-400">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
            <div className="relative">
              <Input
                placeholder="从山河舆图关联地点：输入地名搜索…"
                value={locSearch}
                onChange={(e) => setLocSearch(e.target.value)}
              />
              {filteredLocs.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
                  {filteredLocs.map((loc: any) => (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => linkLocation(loc)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-gold-400" />
                      <span>{loc.name}</span>
                      {loc.entityStatus === 'draft' && <span className="text-[10px] text-amber-400">待补充</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Select
            label="场景类型"
            value={form.sceneType}
            onChange={(e) => setForm({ ...form, sceneType: e.target.value as SceneNode['sceneType'] })}
            options={[
              { value: 'key', label: '关键剧情' },
              { value: 'transition', label: '过渡' },
              { value: 'foreshadow', label: '伏笔' },
            ]}
          />
          <label className="flex items-end gap-2 pb-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={form.isKeyPlot}
              onChange={(e) => setForm({ ...form, isKeyPlot: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-indigo-500 focus:ring-indigo-500"
            />
            重点剧情标记
          </label>
          {/* v1.4 分支感知：节点类型 / 分支组 / 路径标签 */}
          <Select
            label="节点类型"
            value={form.nodeType}
            onChange={(e) => setForm({ ...form, nodeType: e.target.value as 'linear' | 'branch_point' })}
            options={[
              { value: 'linear', label: '线性场景' },
              { value: 'branch_point', label: '分支点（从此分叉）' },
            ]}
          />
          <Input
            label="分支组"
            value={form.branchGroupId}
            onChange={(e) => setForm({ ...form, branchGroupId: e.target.value })}
            placeholder="并行路径共用的分组标识"
          />
          <Input
            label="路径标签"
            value={form.pathLabel}
            onChange={(e) => setForm({ ...form, pathLabel: e.target.value })}
            placeholder="如：甲线 / 黑化线"
          />
          <div className="col-span-2">
            <Textarea label="核心事件" rows={3} value={form.coreEvent} onChange={(e) => setForm({ ...form, coreEvent: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Textarea label="作用与结果" rows={2} value={form.effectAndResult} onChange={(e) => setForm({ ...form, effectAndResult: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Textarea label="伏笔关联" rows={2} value={form.foreshadowingNote} onChange={(e) => setForm({ ...form, foreshadowingNote: e.target.value })} />
            {form.foreshadowingNote.trim() && (
              <div className="mt-1.5 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  loading={promoteMutation.isPending}
                  onClick={() => promoteMutation.mutate()}
                >
                  <Bookmark className="h-3 w-3" />
                  提升为伏笔线
                </Button>
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>保存修改</Button>
        </div>
      </section>

      {/* ---- 素材编排 ---- */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 左：关联素材框 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-300">关联素材</h3>
            <Button size="sm" variant="outline" onClick={() => matchMutation.mutate()} loading={matchMutation.isPending}>
              <Sparkles className="h-3 w-3" />
              智能匹配
            </Button>
          </div>

          {/* 智能匹配建议 */}
          {candidates && (
            <div className="space-y-2 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-indigo-300">匹配建议（点击添加）</span>
                <button onClick={() => setCandidates(null)} className="text-xs text-gray-500 hover:text-gray-300">收起</button>
              </div>
              {totalCandidates === 0 ? (
                <p className="text-xs text-gray-500">未匹配到未添加的素材</p>
              ) : (
                EDITOR_BOXES.map((box) => {
                  const list = (candidates[box.type] || []).filter((c: any) => !isLinked(box.type, c.id))
                  if (!list.length) return null
                  return (
                    <div key={box.type} className="flex flex-wrap items-center gap-1.5">
                      <span className="w-8 shrink-0 text-[11px] text-gray-500">{box.label}</span>
                      {list.map((c: any) => (
                        <button
                          key={`${c.source || 'native'}-${c.id}`}
                          onClick={() => addMaterial(box.type, c)}
                          className={cn('inline-flex items-center gap-0.5 rounded-md border px-2 py-0.5 text-[11px] transition-colors hover:brightness-125', box.chip)}
                        >
                          <Plus className="h-3 w-3" />
                          {c.source === 'custom' && (
                            <span className="rounded bg-gold-500/20 px-1 text-[9px] text-gold-300">自</span>
                          )}
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )
                })
              )}
            </div>
          )}

          {/* 5 个素材框 */}
          {EDITOR_BOXES.map((box) => (
            <MaterialBox
              key={box.type}
              box={box}
              rows={rowsFor(box.type)}
              onRemove={(assocId) => removeAssoc(box.type, assocId)}
              onUpdateNote={(assocId, note) => updateNote(box.type, assocId, note)}
            />
          ))}
        </div>

        {/* 右：迷你素材池 */}
        <MiniPool onAdd={addMaterial} isLinked={isLinked} />
      </section>

      {/* ---- 节点连线 ---- */}
      <RelationSection node={node} allNodes={allNodes} projectId={projectId} outlineId={outlineId} refresh={refresh} />

      <div className="flex justify-end border-t border-gray-800 pt-3">
        <Button variant="outline" onClick={onClose}>完成</Button>
      </div>
    </div>
  )
}

// ============ 场景节点编辑器（大弹窗） ============
function SceneNodeEditor({
  nodeId, projectId, outlineId, onClose,
}: {
  nodeId: number
  projectId: string
  outlineId: string
  onClose: () => void
}) {
  // 与主面板共享缓存，增删改后自动刷新
  const { data: nodes } = useQuery({
    queryKey: ['scene-nodes', projectId, outlineId],
    queryFn: () => scenesApi.list(projectId, outlineId),
  })
  const node = nodes?.find((n: any) => n.id === nodeId)

  return (
    <Dialog open onClose={onClose} title={`编辑场景：${node?.title || ''}`} className="max-w-4xl">
      {!node ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <EditorBody key={node.id} node={node} allNodes={nodes || []} projectId={projectId} outlineId={outlineId} onClose={onClose} />
      )}
    </Dialog>
  )
}

// ============ 主面板 ============
export default function SceneOutlinePanel({ projectId, outlineId, outlineTitle }: SceneOutlinePanelProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [editorNodeId, setEditorNodeId] = useState<number | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  // 视图模式：列表 / 软木板卡片（开源借鉴 PRD v1.1 M4b）
  const [viewMode, setViewMode] = useState<'list' | 'corkboard'>('list')
  // 当前拖拽中的素材（用于 DragOverlay 与卡片高亮）
  const [activeMaterial, setActiveMaterial] = useState<MaterialDrag | null>(null)
  // 素材池来源书籍（默认 1=诛仙），主池与迷你池共享
  const [poolBookId, setPoolBookId] = useState(1)
  const { data: poolBooks } = useQuery({
    queryKey: ['world-books'],
    queryFn: () => worldApi.books(),
    staleTime: 10 * 60 * 1000,
  })

  // 加载场景节点
  const { data: nodes, isLoading } = useQuery({
    queryKey: ['scene-nodes', projectId, outlineId],
    queryFn: () => scenesApi.list(projectId, outlineId),
    enabled: !!projectId && !!outlineId,
  })

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // 把素材加入指定节点
  const addMaterialToNode = useCallback(async (nodeId: number, type: string, item: any) => {
    const sceneId = String(nodeId)
    try {
      if (type === 'characters') {
        await scenesApi.addCharacter(projectId, outlineId, sceneId, {
          characterId: item.charId ?? item.id,
          appearanceType: 'core_support',
          roleNote: item.name,
        })
      } else {
        await scenesApi.addElement(projectId, outlineId, sceneId, {
          elementType: MATERIAL_TO_ELEMENT[type] || type,
          elementId: item.id,
          elementNote: item.name,
          elementSource: item.source || 'native',
        })
      }
      queryClient.invalidateQueries({ queryKey: ['scene-nodes', projectId, outlineId] })
      toast(`已添加${boxLabel(type)}：${item.name}`, 'success')
    } catch (err: any) {
      toast(err.message || '添加失败', 'error')
    }
  }, [projectId, outlineId, queryClient, toast])

  // 拖拽开始：记录素材
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current
    if (data?.kind === 'material') {
      setActiveMaterial({ type: data.materialType, item: data.item })
    }
  }, [])

  // 拖拽结束：素材入节点 或 节点排序
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    const data = active.data.current

    // 素材 → 节点卡片
    if (data?.kind === 'material') {
      setActiveMaterial(null)
      if (over) {
        const nodeId = typeof over.id === 'number' ? over.id : Number(over.id)
        if (!isNaN(nodeId)) {
          addMaterialToNode(nodeId, data.materialType, data.item)
        }
      }
      return
    }

    // 节点排序
    if (!over || active.id === over.id || !nodes) return
    const oldIndex = nodes.findIndex((n: any) => n.id === active.id)
    const newIndex = nodes.findIndex((n: any) => n.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(nodes, oldIndex, newIndex)
    const nodeIds = reordered.map((n: any) => n.id)
    queryClient.setQueryData(['scene-nodes', projectId, outlineId], reordered)
    scenesApi.reorder(projectId, outlineId, nodeIds).catch(() => {
      queryClient.invalidateQueries({ queryKey: ['scene-nodes', projectId, outlineId] })
    })
  }, [nodes, projectId, outlineId, queryClient, addMaterialToNode])

  const handleDragCancel = useCallback(() => setActiveMaterial(null), [])

  // 创建节点
  const createMutation = useMutation({
    mutationFn: (data: any) => scenesApi.create(projectId, outlineId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scene-nodes', projectId, outlineId] })
      setShowAddDialog(false)
      setNewTitle('')
      toast('场景节点已创建', 'success')
    },
    onError: (err: any) => toast(err.message || '创建失败', 'error'),
  })

  // 删除节点
  const deleteMutation = useMutation({
    mutationFn: (sceneId: number) => scenesApi.delete(projectId, outlineId, String(sceneId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scene-nodes', projectId, outlineId] })
      toast('节点已删除', 'success')
    },
    onError: (err: any) => toast(err.message || '删除失败', 'error'),
  })

  // AI生成场景
  const [showAiGenDialog, setShowAiGenDialog] = useState(false)
  const [aiGenCount, setAiGenCount] = useState(8)
  const [aiGenGuidance, setAiGenGuidance] = useState('')
  const generateMutation = useMutation({
    mutationFn: () => scenesApi.generate(projectId, outlineId, { sceneCount: aiGenCount, guidance: aiGenGuidance }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['scene-nodes', projectId, outlineId] })
      setShowAiGenDialog(false)
      setAiGenGuidance('')
      toast(`AI已生成 ${Array.isArray(data) ? data.length : ''} 个场景节点`, 'success')
    },
    onError: (err: any) => toast(err.message || 'AI生成失败', 'error'),
  })

  // AI对话修改
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [showChat, setShowChat] = useState(false)
  const chatMutation = useMutation({
    mutationFn: (message: string) => scenesApi.chat(projectId, outlineId, message),
    onSuccess: (data: any) => {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: data.summary || '操作完成' }])
      if (data.applied) {
        queryClient.invalidateQueries({ queryKey: ['scene-nodes', projectId, outlineId] })
      }
    },
    onError: (err: any) => {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: `错误：${err.message}` }])
    },
  })

  const handleChatSend = () => {
    const msg = chatInput.trim()
    if (!msg || chatMutation.isPending) return
    setChatMessages((prev) => [...prev, { role: 'user', content: msg }])
    setChatInput('')
    chatMutation.mutate(msg)
  }

  // 修改日志 & 回滚
  const [showEditLogs, setShowEditLogs] = useState(false)
  const { data: editLogs, isLoading: editLogsLoading } = useQuery({
    queryKey: ['scene-edit-logs', projectId, outlineId],
    queryFn: () => scenesApi.editLogs(projectId, outlineId),
    enabled: showEditLogs,
  })
  const rollbackMutation = useMutation({
    mutationFn: (logId: string) => scenesApi.rollback(projectId, outlineId, logId),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['scene-nodes', projectId, outlineId] })
      queryClient.invalidateQueries({ queryKey: ['scene-edit-logs', projectId, outlineId] })
      toast(data?.message || '回滚成功', 'success')
    },
    onError: (err: any) => toast(err.message || '回滚失败', 'error'),
  })

  // 同步为章节计划
  const syncMutation = useMutation({
    mutationFn: () => scenesApi.syncChapters(projectId, outlineId),
    onSuccess: (data: any) => {
      toast(`已同步 ${Array.isArray(data) ? data.length : ''} 个章节计划`, 'success')
    },
    onError: (err: any) => toast(err.message || '同步失败', 'error'),
  })

  // 从章节导入场景节点
  const [showImportDialog, setShowImportDialog] = useState(false)
  const importMutation = useMutation({
    mutationFn: (replace: boolean) => scenesApi.importFromChapters(projectId, outlineId, replace),
    onSuccess: (data: any) => {
      setShowImportDialog(false)
      toast(`已导入 ${data.imported ?? ''} 个场景节点（来源：${data.source || '章节'}）`, 'success')
      queryClient.invalidateQueries({ queryKey: ['scene-nodes', projectId, outlineId] })
    },
    onError: (err: any) => toast(err.message || '导入失败', 'error'),
  })

  // 逻辑校验
  const [validateResult, setValidateResult] = useState<any>(null)
  const [highlightNodeId, setHighlightNodeId] = useState<number | null>(null)
  const validateMutation = useMutation({
    mutationFn: () => scenesApi.validate(projectId, outlineId),
    onSuccess: (data: any) => {
      setValidateResult(data)
      if (data.valid && data.issues?.length === 0) {
        toast('校验通过，无问题', 'success')
      } else if (data.errorCount > 0) {
        toast(`发现 ${data.errorCount} 个错误、${data.warningCount} 个警告`, 'error')
      }
    },
    onError: (err: any) => toast(err.message || '校验失败', 'error'),
  })

  // 点击校验问题 → 滚动定位并高亮对应场景节点
  const jumpToNode = useCallback((nodeId?: number) => {
    if (!nodeId) return
    const el = document.getElementById(`scene-node-${nodeId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightNodeId(nodeId)
      setTimeout(() => setHighlightNodeId((cur) => (cur === nodeId ? null : cur)), 2000)
    }
  }, [])

  // 导出
  const handleExport = async (format: 'json' | 'markdown') => {
    try {
      const data = await scenesApi.export(projectId, outlineId, format)
      const content = typeof data.content === 'string' ? data.content : JSON.stringify(data.content, null, 2)
      const ext = format === 'markdown' ? 'md' : 'json'
      const blob = new Blob([content], { type: format === 'markdown' ? 'text/markdown' : 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `场景脚本_${outlineTitle}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
      toast('导出成功', 'success')
    } catch (err: any) {
      toast(err.message || '导出失败', 'error')
    }
  }

  // 校验侧边栏的级别/维度元信息
  const LEVEL_META: Record<string, { icon: any; cls: string; box: string; label: string }> = {
    error: { icon: XCircle, cls: 'text-red-400', box: 'border-red-500/30 bg-red-500/5', label: '错误' },
    warning: { icon: AlertTriangle, cls: 'text-amber-400', box: 'border-amber-500/30 bg-amber-500/5', label: '警告' },
    info: { icon: Info, cls: 'text-gray-400', box: 'border-gray-700 bg-gray-800/30', label: '提示' },
  }
  const DIMENSION_META: Record<string, { label: string; icon: any }> = {
    timeline: { label: '时间线', icon: Clock },
    location: { label: '地点', icon: MapPin },
    structure: { label: '结构', icon: ListChecks },
    character: { label: '人物', icon: User },
    combat: { label: '战力', icon: Sword },
  }

  return (
    <BookContext.Provider value={{ bookId: poolBookId, setBookId: setPoolBookId, books: poolBooks || [] }}>
    <div className="flex h-[calc(100vh-220px)] gap-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* 左侧：素材池（拖拽源） */}
        <div className="w-[220px] shrink-0 rounded-xl border border-gray-800 bg-gray-900">
          <MaterialPool />
        </div>

        {/* 中间：拖拽画布 */}
        <div className="flex flex-1 flex-col rounded-xl border border-gray-800 bg-gray-900/50">
          {/* 画布工具栏 */}
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2">
            <span className="text-xs text-gray-500">
              {outlineTitle} · {nodes?.length || 0} 个场景 · 点击节点编辑，拖素材到节点添加
            </span>
            <div className="flex gap-2">
              {/* 视图切换：列表 / 软木板卡片（开源借鉴 PRD v1.1 M4b） */}
              <div className="flex overflow-hidden rounded-lg border border-gray-700">
                <button
                  className={cn('flex items-center gap-1 px-2 py-1 text-xs transition-colors', viewMode === 'list' ? 'bg-indigo-600/30 text-indigo-200' : 'text-gray-500 hover:text-gray-300')}
                  onClick={() => setViewMode('list')}
                  title="列表视图"
                >
                  <List className="h-3 w-3" />
                  列表
                </button>
                <button
                  className={cn('flex items-center gap-1 px-2 py-1 text-xs transition-colors', viewMode === 'corkboard' ? 'bg-indigo-600/30 text-indigo-200' : 'text-gray-500 hover:text-gray-300')}
                  onClick={() => setViewMode('corkboard')}
                  title="软木板卡片视图"
                >
                  <LayoutGrid className="h-3 w-3" />
                  卡片
                </button>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowAiGenDialog(true)}>
                <Sparkles className="h-3 w-3" />
                AI生成
              </Button>
              <Button
                size="sm"
                variant={showChat ? 'default' : 'outline'}
                onClick={() => setShowChat(!showChat)}
              >
                <MessageSquare className="h-3 w-3" />
                对话修改
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddDialog(true)}>
                <Plus className="h-3 w-3" />
                新增节点
              </Button>
            </div>
          </div>

          {/* 交付操作栏 */}
          <div className="flex items-center gap-2 border-b border-gray-800/50 px-4 py-1.5">
            <Button size="sm" variant="ghost" onClick={() => setShowImportDialog(true)}>
              <ChevronLeft className="h-3 w-3" />
              从章节导入
            </Button>
            <Button size="sm" variant="ghost" onClick={() => syncMutation.mutate()} loading={syncMutation.isPending}>
              <ChevronRight className="h-3 w-3" />
              导出为章节计划
            </Button>
            <Button size="sm" variant="ghost" onClick={() => validateMutation.mutate()} loading={validateMutation.isPending}>
              <CheckCircle2 className="h-3 w-3" />
              校验
            </Button>
            <Button size="sm" variant="ghost" onClick={() => handleExport('markdown')}>
              <Download className="h-3 w-3" />
              导出MD
            </Button>
            <Button size="sm" variant="ghost" onClick={() => handleExport('json')}>
              <Download className="h-3 w-3" />
              导出JSON
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowEditLogs(true)}>
              <History className="h-3 w-3" />
              修改日志
            </Button>
          </div>

          {/* 节点列表 */}
          <div className="flex-1 overflow-y-auto p-4">
            {isLoading ? (
              <div className="flex justify-center py-12"><Spinner /></div>
            ) : !nodes?.length ? (
              <EmptyState message="暂无场景节点，点击「AI生成」或「新增节点」开始" />
            ) : viewMode === 'corkboard' ? (
              /* 软木板卡片视图（开源借鉴 PRD v1.1 M4b）：网格卡片 + 拖拽换位（复用 reorder 写回） */
              <SortableContext
                items={nodes.map((n: any) => n.id)}
                strategy={rectSortingStrategy}
              >
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
                  {nodes.map((node: any, index: number) => (
                    <CorkboardNodeCard
                      key={node.id}
                      node={node}
                      index={index}
                      onOpen={() => setEditorNodeId(node.id)}
                      onDelete={() => deleteMutation.mutate(node.id)}
                      materialDragActive={!!activeMaterial}
                    />
                  ))}
                </div>
              </SortableContext>
            ) : (
              <SortableContext
                items={nodes.map((n: any) => n.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {nodes.map((node: any, index: number) => (
                    <div
                      key={node.id}
                      id={`scene-node-${node.id}`}
                      className={cn(
                        'flex items-center gap-2 rounded-lg transition-colors',
                        highlightNodeId === node.id && 'bg-indigo-500/10 ring-1 ring-indigo-500/50'
                      )}
                    >
                      <span className="w-5 shrink-0 text-center text-[10px] text-gray-600">
                        {index + 1}
                      </span>
                      <div className="flex-1">
                        <SortableNodeCard
                          node={node}
                          onOpen={() => setEditorNodeId(node.id)}
                          onDelete={() => deleteMutation.mutate(node.id)}
                          materialDragActive={!!activeMaterial}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </SortableContext>
            )}
          </div>

          {/* 对话修改面板 */}
          {showChat && (
            <div className="border-t border-gray-800">
              {chatMessages.length > 0 && (
                <div className="max-h-[120px] overflow-y-auto px-4 py-2 space-y-1.5">
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={cn('text-xs', msg.role === 'user' ? 'text-indigo-300' : 'text-gray-400')}>
                      <span className="font-medium">{msg.role === 'user' ? '你：' : 'AI：'}</span>
                      {msg.content}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 px-4 py-2">
                <input
                  className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 placeholder:text-gray-600 focus:border-indigo-500"
                  placeholder="输入修改指令，如：在第2个场景后加一段打斗戏..."
                  aria-label="输入消息"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSend() } }}
                  disabled={chatMutation.isPending}
                />
                <Button
                  size="sm"
                  onClick={handleChatSend}
                  loading={chatMutation.isPending}
                  disabled={!chatInput.trim()}
                >
                  发送
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* 右侧：一致性校验结果侧边栏 */}
        {validateResult && (
          <div className="flex w-[300px] shrink-0 flex-col rounded-xl border border-gray-800 bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-indigo-400" />
                <span className="text-sm font-semibold text-gray-100">一致性校验</span>
              </div>
              <button className="rounded p-2 text-gray-500 hover:bg-gray-800 hover:text-gray-300" aria-label="关闭" onClick={() => setValidateResult(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 概览徽章 */}
            <div className="flex flex-wrap items-center gap-2 border-b border-gray-800/50 px-4 py-2">
              <Badge variant={validateResult.errorCount > 0 ? 'destructive' : 'success'}>
                {validateResult.errorCount || 0} 错误
              </Badge>
              <Badge variant={validateResult.warningCount > 0 ? 'warning' : 'default'}>
                {validateResult.warningCount || 0} 警告
              </Badge>
              <span className="text-[11px] text-gray-500">
                {validateResult.totalNodes} 节点 · {validateResult.keyPlotCount} 关键剧情
              </span>
            </div>

            {/* 问题列表 */}
            <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
              {validateResult.issues?.length > 0 ? (
                validateResult.issues.map((issue: any, i: number) => {
                  const lv = LEVEL_META[issue.level] || LEVEL_META.info
                  const dim = DIMENSION_META[issue.dimension]
                  const LvIcon = lv.icon
                  const DimIcon = dim?.icon
                  return (
                    <button
                      key={i}
                      onClick={() => jumpToNode(issue.nodeId)}
                      disabled={!issue.nodeId}
                      className={cn(
                        'w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
                        lv.box,
                        issue.nodeId ? 'cursor-pointer hover:brightness-125' : 'cursor-default'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <LvIcon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', lv.cls)} />
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex items-center gap-1.5">
                            <span className={cn('text-[10px] font-medium', lv.cls)}>{lv.label}</span>
                            {dim && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-gray-800/80 px-1 py-px text-[10px] text-gray-400">
                                {DimIcon && <DimIcon className="h-2.5 w-2.5" />}
                                {dim.label}
                              </span>
                            )}
                            {issue.nodeId && <span className="text-[10px] text-indigo-400/70">点击定位</span>}
                          </div>
                          <p className="text-xs leading-relaxed text-gray-300">{issue.message}</p>
                        </div>
                      </div>
                    </button>
                  )
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-emerald-400">
                  <CheckCircle2 className="mb-2 h-8 w-8" />
                  <p className="text-sm">全部通过，无问题</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 拖拽素材的悬浮预览 */}
        <DragOverlay>
          {activeMaterial ? (
            <div className="rounded-lg border border-indigo-500 bg-gray-800 px-3 py-1.5 text-xs font-medium text-indigo-200 shadow-lg">
              {activeMaterial.item.name}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* 场景节点编辑器（大弹窗） */}
      {editorNodeId !== null && (
        <SceneNodeEditor
          nodeId={editorNodeId}
          projectId={projectId}
          outlineId={outlineId}
          onClose={() => setEditorNodeId(null)}
        />
      )}

      {/* 新增节点弹窗 */}
      <Dialog open={showAddDialog} onClose={() => setShowAddDialog(false)} title="新增场景节点">
        <div className="space-y-4">
          <Input
            label="场景标题"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="如：张小凡初遇碧瑶"
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>取消</Button>
            <Button
              onClick={() => createMutation.mutate({ title: newTitle || '未命名场景' })}
              loading={createMutation.isPending}
              disabled={!newTitle.trim()}
            >
              创建
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 从章节导入弹窗 */}
      <Dialog open={showImportDialog} onClose={() => setShowImportDialog(false)} title="从章节导入场景节点">
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            将已有章节转为场景节点，优先读取「章节计划」，若无则读取「卷大纲」中的章节列表。
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>取消</Button>
            <Button
              variant="outline"
              onClick={() => importMutation.mutate(false)}
              loading={importMutation.isPending}
            >
              追加导入
            </Button>
            <Button
              onClick={() => importMutation.mutate(true)}
              loading={importMutation.isPending}
            >
              替换导入
            </Button>
          </div>
          <p className="text-xs text-gray-500">追加：保留现有节点，新节点排在后面；替换：清空现有节点后重新导入。</p>
        </div>
      </Dialog>

      {/* AI生成场景弹窗 */}
      <Dialog open={showAiGenDialog} onClose={() => setShowAiGenDialog(false)} title="AI生成场景节点">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label htmlFor="ai-gen-count" className="text-sm text-gray-300">生成数量</label>
            <input
              id="ai-gen-count"
              type="number"
              min={3}
              max={20}
              className="w-20 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-indigo-500"
              value={aiGenCount}
              onChange={(e) => setAiGenCount(Number(e.target.value))}
            />
            <span className="text-xs text-gray-500">个场景</span>
          </div>
          <Textarea
            label="额外指导（可选）"
            rows={3}
            value={aiGenGuidance}
            onChange={(e) => setAiGenGuidance(e.target.value)}
            placeholder="如：重点突出张小凡与碧瑶的初遇，增加悬念感..."
          />
          <p className="text-xs text-gray-500">
            AI将根据卷大纲「{outlineTitle}」的关键事件和人物弧线，自动拆解为场景节点。
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowAiGenDialog(false)}>取消</Button>
            <Button
              onClick={() => generateMutation.mutate()}
              loading={generateMutation.isPending}
            >
              <Sparkles className="h-4 w-4" />
              开始生成
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 修改日志对话框 */}
      <Dialog open={showEditLogs} onClose={() => setShowEditLogs(false)} title="AI修改日志" className="max-w-2xl">
        <div className="space-y-3">
          {editLogsLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : !editLogs?.length ? (
            <EmptyState message="暂无AI修改记录，使用「对话修改」后会自动记录" />
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {[...editLogs].reverse().map((log: any) => (
                <div key={log.id} className="rounded-lg border border-gray-700/50 bg-gray-800/30 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={log.applyStatus === 'applied' ? 'success' : log.applyStatus === 'rolled_back' ? 'warning' : 'default'}>
                          {log.applyStatus === 'applied' ? '已应用' : log.applyStatus === 'rolled_back' ? '已回滚' : '待确认'}
                        </Badge>
                        {log.operationType && (
                          <span className="text-[10px] text-gray-500">{log.operationType}</span>
                        )}
                        <span className="text-[10px] text-gray-600">
                          {new Date(log.createdAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-300">{log.userInstruction}</p>
                    </div>
                    {log.applyStatus === 'applied' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        loading={rollbackMutation.isPending}
                        onClick={() => { if (confirm('确认回滚此次修改？将恢复到修改前的场景状态。')) rollbackMutation.mutate(String(log.id)) }}
                      >
                        回滚
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end border-t border-gray-800 pt-3">
            <Button variant="outline" onClick={() => setShowEditLogs(false)}>关闭</Button>
          </div>
        </div>
      </Dialog>
    </div>
    </BookContext.Provider>
  )
}
