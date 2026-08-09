import { useMemo, useState } from 'react'

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

export interface GraphNode {
  id: number
  name: string
  type: string // 'character' | 'faction' | 'location' | ...
}

export interface GraphLink {
  source: number
  target: number
  relType: string
}

interface RelationGraphProps {
  nodes: GraphNode[]
  links: GraphLink[]
  width?: number
  height?: number
}

/* ------------------------------------------------------------------ */
/* 颜色映射                                                            */
/* ------------------------------------------------------------------ */

const typeColors: Record<string, string> = {
  character: 'fill-indigo-400',
  faction: 'fill-amber-400',
  location: 'fill-emerald-400',
  skill: 'fill-violet-400',
  item: 'fill-cyan-400',
  monster: 'fill-rose-400',
}

const typeStroke: Record<string, string> = {
  character: 'stroke-indigo-400',
  faction: 'stroke-amber-400',
  location: 'stroke-emerald-400',
  skill: 'stroke-violet-400',
  item: 'stroke-cyan-400',
  monster: 'stroke-rose-400',
}

/* ------------------------------------------------------------------ */
/* 组件                                                                */
/* ------------------------------------------------------------------ */

export default function RelationGraph({ nodes, links, width = 900, height = 600 }: RelationGraphProps) {
  const [hoveredLink, setHoveredLink] = useState<number | null>(null)
  const [hoveredNode, setHoveredNode] = useState<number | null>(null)

  // 圆形布局：节点均匀分布在圆周
  const positioned = useMemo(() => {
    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) / 2 - 70
    return nodes.map((node, i) => {
      const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2
      return { ...node, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) }
    })
  }, [nodes, width, height])

  const posMap = useMemo(() => {
    const m = new Map<number, { x: number; y: number }>()
    for (const n of positioned) m.set(n.id, { x: n.x, y: n.y })
    return m
  }, [positioned])

  if (!nodes.length) {
    return <div className="py-12 text-center text-sm text-gray-500">暂无人物数据，无法生成关系图谱</div>
  }

  return (
    <div className="space-y-2">
      {/* 图例 */}
      <div className="flex flex-wrap gap-3 px-1 text-[11px] text-gray-400">
        {Object.entries(typeColors).map(([type, cls]) => (
          <span key={type} className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} />
            {type === 'character' ? '人物' : type === 'faction' ? '门派' : type === 'location' ? '地点' : type}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full rounded-lg border border-gray-800 bg-gray-950"
        style={{ maxHeight: 520 }}
        role="img"
        aria-label="人物关系图"
      >
        {/* 连线 */}
        {links.map((link, i) => {
          const s = posMap.get(link.source)
          const t = posMap.get(link.target)
          if (!s || !t) return null
          const active = hoveredLink === i || hoveredNode === link.source || hoveredNode === link.target
          return (
            <line
              key={i}
              x1={s.x} y1={s.y} x2={t.x} y2={t.y}
              stroke="currentColor"
              className={active ? 'text-indigo-400' : 'text-gray-700'}
              strokeWidth={active ? 1.2 : 0.5}
              opacity={active ? 0.9 : 0.5}
              onMouseEnter={() => setHoveredLink(i)}
              onMouseLeave={() => setHoveredLink(null)}
            />
          )
        })}

        {/* 连线标签（hover 时显示） */}
        {hoveredLink !== null && (() => {
          const link = links[hoveredLink]
          const s = posMap.get(link.source)
          const t = posMap.get(link.target)
          if (!s || !t) return null
          const mx = (s.x + t.x) / 2
          const my = (s.y + t.y) / 2
          return (
            <text x={mx} y={my - 4} textAnchor="middle" className="fill-indigo-300 text-[10px]">
              {link.relType}
            </text>
          )
        })()}

        {/* 节点 */}
        {positioned.map((node) => {
          const active = hoveredNode === node.id
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={node.name}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              onFocus={() => setHoveredNode(node.id)}
              onBlur={() => setHoveredNode(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setHoveredNode((prev) => (prev === node.id ? null : node.id))
                }
              }}
              className="cursor-pointer"
            >
              <circle
                cx={node.x} cy={node.y}
                r={active ? 10 : 7}
                className={`${typeColors[node.type] || 'fill-gray-400'} transition-all`}
                stroke="currentColor"
                strokeWidth={active ? 2 : 0}
                style={{ stroke: active ? '#818cf8' : 'none' }}
              />
              <text
                x={node.x}
                y={node.y - 12}
                textAnchor="middle"
                className={`text-[9px] ${active ? 'fill-white font-bold' : 'fill-gray-400'}`}
              >
                {node.name}
              </text>
            </g>
          )
        })}
      </svg>

      <p className="text-center text-[11px] text-gray-600">
        共 {nodes.length} 个节点 · {links.length} 条关系 · 悬停查看详情
      </p>
    </div>
  )
}
