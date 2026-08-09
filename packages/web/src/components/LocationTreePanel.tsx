/**
 * US-11：左侧地点导航树
 * - 搜索过滤 + 匹配高亮；parentLocationId 构建树形；折叠/展开
 * - 选中金色背景；悬停出现编辑/删除按钮；draft 显示「待确认」标签
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight, ChevronDown, Search, Pencil, Trash2, CheckSquare } from 'lucide-react'
import { Card, CardContent, Input, Button } from './ui'
import { LocationTypeIcon } from '../pages/WorldMapPage'

interface LocationTreePanelProps {
  locations: any[]
  selectedLocId: number | null
  onSelect: (id: number) => void
  onEdit: (loc: any) => void
  onDelete: (loc: any) => void
  /** 批量删除（管理模式下勾选后一键删除） */
  onBatchDelete?: (ids: number[]) => void
}

interface TreeNode {
  loc: any
  children: TreeNode[]
}

/** 名称子串高亮（不区分大小写） */
function highlightName(name: string, q: string): ReactNode {
  if (!q) return name
  const idx = name.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return name
  return (
    <>
      {name.slice(0, idx)}
      <span className="text-amber-300">{name.slice(idx, idx + q.length)}</span>
      {name.slice(idx + q.length)}
    </>
  )
}

export default function LocationTreePanel({
  locations, selectedLocId, onSelect, onEdit, onDelete, onBatchDelete,
}: LocationTreePanelProps) {
  const [q, setQ] = useState('')
  // 收起的节点 id 集合（默认全展开）
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  // 管理模式：勾选框 + 批量删除
  const [manageMode, setManageMode] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())

  // 用 parentLocationId 构建树
  const tree = useMemo<TreeNode[]>(() => {
    const byId = new Map<number, TreeNode>()
    locations.forEach((l: any) => byId.set(l.id, { loc: l, children: [] }))
    const roots: TreeNode[] = []
    locations.forEach((l: any) => {
      const node = byId.get(l.id)!
      const parent = l.parentLocationId != null ? byId.get(l.parentLocationId) : undefined
      if (parent) parent.children.push(node)
      else roots.push(node)
    })
    return roots
  }, [locations])

  const query = q.trim()
  const searching = query.length > 0

  /** 搜索时：节点自身匹配或任一后代匹配则保留 */
  const filterTree = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((n) => ({ ...n, children: filterTree(n.children) }))
      .filter((n) => n.loc.name.toLowerCase().includes(query.toLowerCase()) || n.children.length > 0)

  const shownTree = searching ? filterTree(tree) : tree

  const toggleCollapse = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleCheck = (id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allChecked = locations.length > 0 && checkedIds.size === locations.length
  const toggleAll = () => {
    setCheckedIds(allChecked ? new Set() : new Set(locations.map((l: any) => l.id)))
  }

  const handleBatchDelete = () => {
    if (!onBatchDelete || checkedIds.size === 0) return
    if (window.confirm(`删除已勾选的 ${checkedIds.size} 个地点？关联路径将一并删除。`)) {
      onBatchDelete(Array.from(checkedIds))
      setCheckedIds(new Set())
      setManageMode(false)
    }
  }

  const renderNode = (node: TreeNode, depth: number): ReactNode => {
    const { loc, children } = node
    const isCollapsed = !searching && collapsed.has(loc.id)
    const isSelected = selectedLocId === loc.id
    const isDraft = loc.entityStatus === 'draft'
    return (
      <div key={loc.id}>
        <div
          className={`group flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-sm transition-colors ${
            manageMode && checkedIds.has(loc.id)
              ? 'bg-red-900/25 ring-1 ring-red-800/50 text-gray-100'
              : isSelected
                ? 'bg-amber-900/40 ring-1 ring-amber-700/50 text-amber-100'
                : 'text-gray-300 hover:bg-gray-800/60'
          }`}
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => (manageMode ? toggleCheck(loc.id) : onSelect(loc.id))}
          title={loc.name}
        >
          {/* 管理模式：勾选框 */}
          {manageMode && (
            <input
              type="checkbox"
              className="h-3.5 w-3.5 shrink-0 rounded border-gray-600 bg-gray-700 text-red-500 focus:ring-red-500/30"
              checked={checkedIds.has(loc.id)}
              onChange={() => toggleCheck(loc.id)}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          {/* 折叠箭头 */}
          {children.length > 0 ? (
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-700/60 hover:text-gray-200"
              onClick={(e) => { e.stopPropagation(); toggleCollapse(loc.id) }}
              aria-label={isCollapsed ? '展开' : '收起'}
            >
              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-[18px] shrink-0" />
          )}
          {/* US-11：类型小图标（复用 US-12 的 SVG 图标 16px 版） */}
          <LocationTypeIcon type={loc.locationType} size={16} />
          <span className="min-w-0 flex-1 truncate">
            {searching ? highlightName(loc.name, query) : loc.name}
          </span>
          {isDraft && (
            <span className="shrink-0 rounded bg-amber-900/50 px-1 py-px text-[10px] leading-4 text-amber-300">
              待确认
            </span>
          )}
          {/* 悬停操作按钮（管理模式下隐藏，避免误触） */}
          {!manageMode && (
          <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <button
              type="button"
              className="rounded p-0.5 text-gray-400 hover:bg-gray-700/60 hover:text-gold-300"
              onClick={(e) => { e.stopPropagation(); onEdit(loc) }}
              title="编辑地点"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rounded p-0.5 text-gray-400 hover:bg-red-900/40 hover:text-red-400"
              onClick={(e) => {
                e.stopPropagation()
                if (window.confirm(`删除地点「${loc.name}」？关联路径将一并删除。`)) onDelete(loc)
              }}
              title="删除地点"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
          )}
        </div>
        {!isCollapsed && children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-200">地点导航</h3>
          {locations.length > 0 && onBatchDelete && (
            <Button
              variant={manageMode ? 'default' : 'ghost'}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                setManageMode(!manageMode)
                setCheckedIds(new Set())
              }}
            >
              <CheckSquare className="mr-1 h-3 w-3" /> {manageMode ? '完成' : '管理'}
            </Button>
          )}
        </div>
        {/* 搜索框 */}
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
          <Input
            className="py-1.5 pl-8 text-xs"
            placeholder="搜索地点名称…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {locations.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-500">
            暂无地点。双击画布空白处即可新建地点。
          </p>
        ) : shownTree.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-500">未找到匹配「{query}」的地点</p>
        ) : (
          <div className="max-h-[520px] space-y-0.5 overflow-y-auto">
            {shownTree.map((n) => renderNode(n, 0))}
          </div>
        )}
        {/* 管理模式底部操作栏 */}
        {manageMode && locations.length > 0 && (
          <div className="mt-2 flex items-center justify-between border-t border-gray-700/50 pt-2">
            <button
              type="button"
              className="text-xs text-gray-400 hover:text-gray-200"
              onClick={toggleAll}
            >
              {allChecked ? '取消全选' : '全选'}
            </button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-red-900/60 px-2 text-xs text-red-400"
              disabled={checkedIds.size === 0}
              onClick={handleBatchDelete}
            >
              <Trash2 className="mr-1 h-3 w-3" /> 删除已选 {checkedIds.size > 0 ? `(${checkedIds.size})` : ''}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
