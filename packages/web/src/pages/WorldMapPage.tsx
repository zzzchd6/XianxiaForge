/**
 * 山河舆图（10-需求规格说明书）
 * US-1 SVG画布：缩放/拖拽/布点/地点CRUD/详情/底图dataURL
 * US-3 多地图Tab切换 + 上级区域（parentMap/parentLocation）
 * US-4 路径绘制 + 旅行时间估算展示（US-5 距离查询入口）
 * US-8 草稿地点（诛仙库导入/AI提取）以虚线圈展示，可一键转正
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, Pencil, CheckCircle2, Settings2, Route, ZoomIn, ZoomOut, Maximize2, Download, MapPin, Wand2, Upload,
} from 'lucide-react'
import {
  Card, CardContent, Button, Input, Textarea, Select, Badge, Dialog, useToast, Spinner, Tabs,
} from '../components/ui'
import { mapApi } from '../lib/api'
import { useCurrentProjectId } from '../hooks/useCurrentProject'
import LocationTreePanel from '../components/LocationTreePanel'
import { ImportZhuxianDialog } from '../components/ImportZhuxianDialog'
import { ExtractLocationsDialog } from '../components/ExtractLocationsDialog'
import { ImportFromProjectDialog } from '../components/ImportFromProjectDialog'
// US-14：系统默认底图（渲染层兜底，不存数据库）
import defaultMapBg from '../assets/default-map-bg.png'

// ============ 常量 ============

const LOCATION_TYPE_LABELS: Record<string, string> = {
  sect: '宗门', city: '城池', secret_realm: '秘境', danger: '险地',
  teleport: '传送阵', battlefield: '战场', generic: '通用',
}
const LOCATION_TYPE_COLORS: Record<string, string> = {
  sect: '#c084fc', city: '#fbbf24', secret_realm: '#34d399', danger: '#f87171',
  teleport: '#60a5fa', battlefield: '#fb923c', generic: '#9ca3af',
}
const DANGER_LABELS: Record<string, string> = { safe: '安全', normal: '寻常', danger: '凶险', deadly: '绝地' }
const LINK_TYPE_LABELS: Record<string, string> = {
  main_road: '官道', path: '小径', teleport: '传送阵', secret_path: '秘道',
}
const MODE_LABELS: Record<string, string> = { walk: '步行', fly: '御剑', ship: '舟船', teleport: '传送' }

// ============ 主页面 ============

export default function WorldMapPage() {
  const projectId = useCurrentProjectId()
  const qc = useQueryClient()
  const { toast } = useToast()

  // ---- 数据 ----
  const { data: maps = [], isLoading: mapsLoading } = useQuery({
    queryKey: ['maps', projectId],
    queryFn: () => mapApi.listMaps(projectId),
    enabled: !!projectId,
  })
  const [activeMapId, setActiveMapId] = useState<number | null>(null)
  // 切换项目时重置地图/选中/位置覆盖状态，避免残留旧项目的 activeMapId 导致新项目显示「加载中」
  useEffect(() => {
    setActiveMapId(null)
    setSelectedLocId(null)
    setPosOverride({})
    fittedRef.current = null
  }, [projectId])
  useEffect(() => {
    if (!activeMapId && maps.length) setActiveMapId(maps[0].id)
  }, [maps, activeMapId])
  const activeMap = maps.find((m: any) => m.id === activeMapId) || null

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', projectId, activeMapId],
    queryFn: () => mapApi.listLocations(projectId, { mapId: activeMapId ?? undefined }),
    enabled: !!projectId && !!activeMapId,
  })
  const { data: links = [] } = useQuery({
    queryKey: ['location-links', projectId],
    queryFn: () => mapApi.listLinks(projectId),
    enabled: !!projectId,
  })
  const locById = useMemo(() => new Map(locations.map((l: any) => [l.id, l])), [locations])
  const visibleLinks = useMemo(
    () => links.filter((lk: any) => locById.has(lk.fromLocationId) && locById.has(lk.toLocationId)),
    [links, locById]
  )

  // ---- 画布视图 ----
  const svgRef = useRef<SVGSVGElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 0.5 })
  // US-13a：移除「布点」模式，双击空白处直接新建地点
  const [mode, setMode] = useState<'select' | 'link'>('select')
  const [selectedLocId, setSelectedLocId] = useState<number | null>(null)
  // US-11：xl 以下响应式 Tab（地点列表/地点详情）
  const [mobileTab, setMobileTab] = useState<'list' | 'detail'>('list')
  const [linkFromId, setLinkFromId] = useState<number | null>(null)
  const [posOverride, setPosOverride] = useState<Record<number, { x: number; y: number }>>({})
  const panRef = useRef<{ active: boolean; sx: number; sy: number; ox: number; oy: number }>({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 })
  const locDragRef = useRef<{ id: number } | null>(null)
  const movedRef = useRef(false)

  // 缩放（wheel 需 passive:false 才能 preventDefault）
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setTransform((t) => {
        const factor = e.deltaY < 0 ? 1.12 : 0.9
        const k = Math.min(4, Math.max(0.15, t.k * factor))
        const ratio = k / t.k
        return { k, x: mx - (mx - t.x) * ratio, y: my - (my - t.y) * ratio }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /** 屏幕坐标 → 地图世界坐标 */
  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: Math.round((clientX - rect.left - transform.x) / transform.k),
      y: Math.round((clientY - rect.top - transform.y) / transform.k),
    }
  }

  /** 自适应缩放：让地图范围完整显示 */
  const fitView = () => {
    if (!activeMap || !containerRef.current) return
    const cw = containerRef.current.clientWidth || 800
    const ch = containerRef.current.clientHeight || 560
    const w = activeMap.maxX - activeMap.minX || 2000
    const h = activeMap.maxY - activeMap.minY || 1500
    const k = Math.min(cw / w, ch / h) * 0.92
    setTransform({
      k,
      x: (cw - w * k) / 2 - activeMap.minX * k,
      y: (ch - h * k) / 2 - activeMap.minY * k,
    })
  }
  // 首次地图就绪时自适应
  const fittedRef = useRef<number | null>(null)
  useEffect(() => {
    if (activeMap && fittedRef.current !== activeMap.id) {
      fittedRef.current = activeMap.id
      fitView()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap?.id])

  const zoomBy = (factor: number) => {
    const el = containerRef.current
    if (!el) return
    const mx = el.clientWidth / 2
    const my = el.clientHeight / 2
    setTransform((t) => {
      const k = Math.min(4, Math.max(0.15, t.k * factor))
      const ratio = k / t.k
      return { k, x: mx - (mx - t.x) * ratio, y: my - (my - t.y) * ratio }
    })
  }

  // US-11：从导航树选中地点 → 平移画布使该地点居中并选中
  const panToLocation = (locId: number) => {
    const loc = locById.get(locId)
    if (!loc || !containerRef.current) return
    const p = posOverride[locId] || loc
    const cw = containerRef.current.clientWidth
    const ch = containerRef.current.clientHeight
    setTransform((t) => ({ k: t.k, x: cw / 2 - p.x * t.k, y: ch / 2 - p.y * t.k }))
    setSelectedLocId(locId)
  }

  // ---- 变更操作 ----
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['locations'] })
    qc.invalidateQueries({ queryKey: ['maps'] })
    qc.invalidateQueries({ queryKey: ['location-links'] })
  }
  const updateLocMut = useMutation({
    mutationFn: ({ id, ...data }: any) => mapApi.updateLocation(projectId, id, data),
    onSuccess: invalidateAll,
  })
  const confirmLocMut = useMutation({
    mutationFn: (id: number) => mapApi.confirmLocation(projectId, id),
    onSuccess: () => { toast('地点已转正'); invalidateAll() },
  })
  const deleteLocMut = useMutation({
    mutationFn: (id: number) => mapApi.deleteLocation(projectId, id),
    onSuccess: () => { toast('地点已删除'); setSelectedLocId(null); invalidateAll() },
  })
  const batchDeleteLocMut = useMutation({
    mutationFn: (ids: number[]) => mapApi.batchDeleteLocations(projectId, ids),
    onSuccess: (res: any) => { toast(`已删除 ${res.deleted ?? ''} 个地点`); setSelectedLocId(null); invalidateAll() },
    onError: (e: any) => toast(e.message || '批量删除失败', 'error'),
  })
  const deleteLinkMut = useMutation({
    mutationFn: (id: number) => mapApi.deleteLink(projectId, id),
    onSuccess: () => { toast('路径已删除'); invalidateAll() },
  })
  const createMapMut = useMutation({
    mutationFn: (data: any) => mapApi.createMap(projectId, data),
    onSuccess: (row: any) => {
      toast('地图已创建')
      invalidateAll()
      setActiveMapId(row.id)
      setMapDialog({ open: false })
    },
    onError: (e: any) => toast(e.message || '创建失败', 'error'),
  })
  const updateMapMut = useMutation({
    mutationFn: ({ id, ...data }: any) => mapApi.updateMap(projectId, id, data),
    onSuccess: () => {
      toast('地图已保存')
      invalidateAll()
      setMapDialog({ open: false })
    },
    onError: (e: any) => toast(e.message || '保存失败', 'error'),
  })
  const deleteMapMut = useMutation({
    mutationFn: (id: number) => mapApi.deleteMap(projectId, id),
    onSuccess: () => {
      toast('地图已删除')
      setActiveMapId(null)
      fittedRef.current = null
      invalidateAll()
    },
    onError: (e: any) => toast(e.message || '删除失败', 'error'),
  })
  // ---- 弹窗状态 ----
  const [locDialog, setLocDialog] = useState<{ open: boolean; loc?: any; preset?: { x: number; y: number } }>({ open: false })
  const [linkDialog, setLinkDialog] = useState<{ open: boolean; from?: number; to?: number }>({ open: false })
  const [mapDialog, setMapDialog] = useState<{ open: boolean; map?: any }>({ open: false })
  const [importOpen, setImportOpen] = useState(false)
  const [extractOpen, setExtractOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [fileImportOpen, setFileImportOpen] = useState(false)

  // ---- 画布交互 ----
  const onSvgMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    movedRef.current = false
    panRef.current = { active: true, sx: e.clientX, sy: e.clientY, ox: transform.x, oy: transform.y }
  }
  const onLocMouseDown = (e: React.MouseEvent, loc: any) => {
    e.stopPropagation()
    if (e.button !== 0) return
    movedRef.current = false
    locDragRef.current = { id: loc.id }
  }
  const onSvgMouseMove = (e: React.MouseEvent) => {
    if (locDragRef.current) {
      const p = screenToWorld(e.clientX, e.clientY)
      movedRef.current = true
      setPosOverride((prev) => ({ ...prev, [locDragRef.current!.id]: p }))
      return
    }
    if (panRef.current.active) {
      const dx = e.clientX - panRef.current.sx
      const dy = e.clientY - panRef.current.sy
      if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true
      setTransform((t) => ({ ...t, x: panRef.current.ox + dx, y: panRef.current.oy + dy }))
    }
  }
  const onSvgMouseUp = (e: React.MouseEvent) => {
    // 地点拖拽结束：保存新坐标（不触发转正）
    if (locDragRef.current) {
      const id = locDragRef.current.id
      locDragRef.current = null
      if (movedRef.current) {
        const p = posOverride[id]
        if (p) updateLocMut.mutate({ id, x: p.x, y: p.y })
      } else {
        handleLocClick(id)
      }
      return
    }
    if (panRef.current.active) {
      panRef.current.active = false
      // US-13a：原「布点」分支已移除，新建地点改为双击空白处触发
    }
  }
  const handleLocClick = (id: number) => {
    if (mode === 'link') {
      if (linkFromId == null) {
        setLinkFromId(id)
      } else if (linkFromId !== id) {
        setLinkDialog({ open: true, from: linkFromId, to: id })
        setLinkFromId(null)
      } else {
        setLinkFromId(null)
      }
      return
    }
    setSelectedLocId(id)
  }

  const selectedLoc = selectedLocId != null ? locById.get(selectedLocId) : null
  const draftCount = locations.filter((l: any) => l.entityStatus === 'draft').length
  // US-14：未上传自定义底图时兜底系统默认底图
  const bgSrc = activeMap?.bgImage || defaultMapBg

  // US-11：左侧地点导航树（xl 三栏与移动端 Tab 各渲染一份，状态各自独立）
  const treePanel = (
    <LocationTreePanel
      locations={locations}
      selectedLocId={selectedLocId}
      onSelect={panToLocation}
      onEdit={(loc) => setLocDialog({ open: true, loc })}
      onDelete={(loc) => deleteLocMut.mutate(loc.id)}
      onBatchDelete={(ids) => batchDeleteLocMut.mutate(ids)}
    />
  )

  // 右栏内容：地点详情 + 旅行时间 + 路径列表（US-11：xl 三栏与移动端 Tab 复用）
  const rightPanel = (
    <div className="space-y-4">
      {/* 地点详情 */}
      <Card>
        <CardContent className="pt-4">
          <h3 className="mb-2 text-sm font-medium text-gray-200">地点详情</h3>
          {!selectedLoc ? (
            <p className="text-xs text-gray-500">点击地图上的地点查看详情。</p>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-gold-200">{selectedLoc.name}</span>
                <Badge>{LOCATION_TYPE_LABELS[selectedLoc.locationType] || selectedLoc.locationType}</Badge>
                <Badge variant={selectedLoc.dangerLevel === 'deadly' ? 'destructive' : selectedLoc.dangerLevel === 'danger' ? 'warning' : 'default'}>
                  {DANGER_LABELS[selectedLoc.dangerLevel] || selectedLoc.dangerLevel}
                </Badge>
                {selectedLoc.entityStatus === 'draft' && <Badge variant="warning">待补充</Badge>}
              </div>
              {selectedLoc.description && <p className="text-xs leading-relaxed text-gray-400">{selectedLoc.description}</p>}
              {selectedLoc.affiliatedFaction && (
                <p className="text-xs text-gray-400">所属势力：<span className="text-gray-200">{selectedLoc.affiliatedFaction}</span></p>
              )}
              {selectedLoc.parentLocationId && locById.get(selectedLoc.parentLocationId) && (
                <p className="text-xs text-gray-400">上级区域：<span className="text-gray-200">{locById.get(selectedLoc.parentLocationId).name}</span></p>
              )}
              {selectedLoc.metadata?.level && (
                <p className="text-xs text-gray-500">原著层级：{selectedLoc.metadata.level}{selectedLoc.metadata.parentRegion ? `（${selectedLoc.metadata.parentRegion}）` : ''}</p>
              )}
              {Array.isArray(selectedLoc.metadata?.keyEvents) && selectedLoc.metadata.keyEvents.length > 0 && (
                <div className="text-xs text-gray-500">
                  关键事件：{selectedLoc.metadata.keyEvents.slice(0, 3).join('；')}
                </div>
              )}
              <p className="text-[10px] text-gray-600">坐标（{Math.round(selectedLoc.x)}，{Math.round(selectedLoc.y)}）</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setLocDialog({ open: true, loc: selectedLoc })}>
                  <Pencil className="mr-1 h-3 w-3" /> 编辑
                </Button>
                {selectedLoc.entityStatus === 'draft' && (
                  <Button size="sm" variant="outline" onClick={() => confirmLocMut.mutate(selectedLoc.id)} disabled={confirmLocMut.isPending}>
                    <CheckCircle2 className="mr-1 h-3 w-3" /> 转正
                  </Button>
                )}
                <Button
                  size="sm" variant="outline"
                  className="text-red-400"
                  onClick={() => { if (window.confirm(`删除地点「${selectedLoc.name}」？关联路径将一并删除。`)) deleteLocMut.mutate(selectedLoc.id) }}
                >
                  <Trash2 className="mr-1 h-3 w-3" /> 删除
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* US-4/US-5：旅行时间估算 */}
      <TravelTimePanel projectId={projectId} locations={locations} />

      {/* 路径列表 */}
      <Card>
        <CardContent className="pt-4">
          <h3 className="mb-2 text-sm font-medium text-gray-200">路径（{visibleLinks.length}）</h3>
          {visibleLinks.length === 0 ? (
            <p className="text-xs text-gray-500">暂无路径。点击工具条「连路径」后依次点击两个地点。</p>
          ) : (
            <ul className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
              {visibleLinks.map((lk: any) => (
                <li key={lk.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-800/50 px-2 py-1.5">
                  <span className="truncate text-gray-300">
                    {locById.get(lk.fromLocationId)?.name} ↔ {locById.get(lk.toLocationId)?.name}
                    <span className="ml-1 text-gray-500">（{LINK_TYPE_LABELS[lk.linkType] || lk.linkType}）</span>
                  </span>
                  <button type="button" className="shrink-0 text-gray-500 hover:text-red-400" onClick={() => deleteLinkMut.mutate(lk.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )

  // ---- 渲染 ----
  return (
    <div className="space-y-4">
      {/* 头部：地图Tab + 操作 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gold-200 title-serif">山河舆图</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            {activeMap ? `当前「${activeMap.name}」：${locations.length} 个地点${draftCount ? `（${draftCount} 待补充）` : ''}，${visibleLinks.length} 条路径` : '加载中…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Download className="mr-1 h-3.5 w-3.5" /> 导入诛仙库地点
          </Button>
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
            <Download className="mr-1 h-3.5 w-3.5" /> 导出到文件
          </Button>
          <Button variant="outline" size="sm" onClick={() => setFileImportOpen(true)}>
            <Upload className="mr-1 h-3.5 w-3.5" /> 文件导入
          </Button>
          <Button variant="outline" size="sm" onClick={() => setExtractOpen(true)}>
            <Wand2 className="mr-1 h-3.5 w-3.5" /> 文本抽取
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMapDialog({ open: true, map: undefined })}>
            <Plus className="mr-1 h-3.5 w-3.5" /> 新建地图
          </Button>
          <Button variant="outline" size="sm" onClick={() => activeMap && setMapDialog({ open: true, map: activeMap })} disabled={!activeMap}>
            <Settings2 className="mr-1 h-3.5 w-3.5" /> 地图设置
          </Button>
        </div>
      </div>

      {/* US-3：多地图Tab（带删除按钮） */}
      {maps.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {maps.map((m: any) => {
            const isActive = m.id === activeMapId
            return (
              <div
                key={m.id}
                className={`group flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-amber-900/40 text-amber-200 ring-1 ring-amber-700/50'
                    : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
                }`}
                onClick={() => { setActiveMapId(m.id); setSelectedLocId(null); setPosOverride({}) }}
              >
                <span>{m.name}</span>
                {maps.length > 1 && (
                  <button
                    type="button"
                    className="ml-0.5 rounded p-0.5 text-gray-500 opacity-0 transition-opacity hover:bg-red-900/40 hover:text-red-400 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (window.confirm(`删除地图「${m.name}」及其下所有地点？`)) {
                        deleteMapMut.mutate(m.id)
                      }
                    }}
                    title="删除地图"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_1fr_320px]">
        {/* 左：地点导航树（US-11，xl 三栏显示） */}
        <div className="hidden xl:block">{treePanel}</div>
        {/* 中：画布 */}
        <Card>
          <CardContent className="p-0">
            {/* 工具条 */}
            <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 px-3 py-2">
              <Button size="sm" variant={mode === 'select' ? 'default' : 'outline'} onClick={() => { setMode('select'); setLinkFromId(null) }}>
                <MapPin className="mr-1 h-3.5 w-3.5" /> 选择
              </Button>
              {/* US-13a：「布点」按钮已移除，双击画布空白处即可新建地点 */}
              <Button size="sm" variant={mode === 'link' ? 'default' : 'outline'} onClick={() => setMode(mode === 'link' ? 'select' : 'link')}>
                <Route className="mr-1 h-3.5 w-3.5" /> {mode === 'link' ? (linkFromId != null ? '点击终点…' : '点击起点…') : '连路径'}
              </Button>
              <div className="mx-2 h-5 w-px bg-gray-700" />
              <Button size="sm" variant="outline" onClick={() => zoomBy(1.25)}><ZoomIn className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="outline" onClick={() => zoomBy(0.8)}><ZoomOut className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="outline" onClick={fitView}><Maximize2 className="mr-1 h-3.5 w-3.5" /> 适配</Button>
              <span className="ml-auto text-xs text-gray-500">
                {mode === 'link' ? '依次点击两个地点以连路径' : `双击空白处新建地点；缩放 ${Math.round(transform.k * 100)}%`}
              </span>
            </div>

            {/* SVG 画布（US-13b/c：水墨米黄渐变背景 + 自适应高度） */}
            <div
              ref={containerRef}
              className="relative min-h-[480px] h-[calc(100vh-260px)] w-full overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #e8dfc8, #f5f0e1)' }}
            >
              {mapsLoading ? (
                <div className="flex h-full items-center justify-center"><Spinner label="加载地图" /></div>
              ) : !activeMap ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">暂无地图，点击右上角「新建地图」开始</div>
              ) : (
                <svg
                  ref={svgRef}
                  className="h-full w-full cursor-grab active:cursor-grabbing"
                  onMouseDown={onSvgMouseDown}
                  onMouseMove={onSvgMouseMove}
                  onMouseUp={onSvgMouseUp}
                  onMouseLeave={() => { panRef.current.active = false; locDragRef.current = null }}
                  onDoubleClick={(e) => {
                    // US-13a：双击空白处（svg 本体或背景 rect）新建地点
                    const t = e.target as Element
                    if ((e.target === svgRef.current || t.getAttribute?.('data-bg')) && activeMapId) {
                      const p = screenToWorld(e.clientX, e.clientY)
                      setLocDialog({ open: true, preset: p })
                    }
                  }}
                >
                  {/* US-12：选中态脉冲光圈动画 */}
                  <style>{`@keyframes wm-pulse {0%,100%{opacity:.9}50%{opacity:.3}} .wm-pulse{animation:wm-pulse 1.6s ease-in-out infinite}`}</style>
                  <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
                    {/* 地图背景（米黄色，模拟宣纸；data-bg 供双击新建识别） */}
                    <rect
                      data-bg="1"
                      x={activeMap.minX} y={activeMap.minY}
                      width={activeMap.maxX - activeMap.minX} height={activeMap.maxY - activeMap.minY}
                      fill="#f5f0e1"
                    />
                    {/* 底图（US-14：始终渲染，未上传自定义底图时用系统默认底图兜底） */}
                    <image
                      href={bgSrc}
                      xlinkHref={bgSrc}
                      x={activeMap.minX} y={activeMap.minY}
                      width={activeMap.maxX - activeMap.minX} height={activeMap.maxY - activeMap.minY}
                      opacity={activeMap.bgOpacity ?? 0.7}
                      preserveAspectRatio="xMidYMid meet"
                    />
                    {/* 地图边界 */}
                    <rect
                      x={activeMap.minX} y={activeMap.minY}
                      width={activeMap.maxX - activeMap.minX} height={activeMap.maxY - activeMap.minY}
                      fill="none" stroke="rgba(192,154,82,0.25)" strokeDasharray="8 6"
                    />
                    {/* 路径（US-13d：缩放 < 0.6 时隐藏） */}
                    {transform.k >= 0.6 && visibleLinks.map((lk: any) => {
                      const a = locById.get(lk.fromLocationId)!
                      const b = locById.get(lk.toLocationId)!
                      const pa = posOverride[a.id] || a
                      const pb = posOverride[b.id] || b
                      const isTeleport = lk.linkType === 'teleport'
                      return (
                        <g key={lk.id}>
                          <line
                            x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                            stroke={isTeleport ? '#60a5fa' : 'rgba(192,154,82,0.45)'}
                            strokeWidth={lk.linkType === 'main_road' ? 3 : 1.5}
                            strokeDasharray={isTeleport ? '4 6' : lk.linkType === 'secret_path' ? '2 4' : undefined}
                          />
                        </g>
                      )
                    })}
                    {/* 地点（US-12：类型 SVG 图标 + 深色名称条） */}
                    {locations.map((loc: any) => {
                      const p = posOverride[loc.id] || loc
                      const isDraft = loc.entityStatus === 'draft'
                      const isSelected = selectedLocId === loc.id
                      const isLinkFrom = linkFromId === loc.id
                      // US-12：名称背景条宽度按字数近似估算
                      const labelW = (loc.name.length + (isDraft ? 3 : 0)) * 13 + 16
                      // 名称标签反向补偿：缩小时放大标签保证可读（屏幕字号不低于 11px）
                      const labelScale = transform.k > 0 ? Math.min(3, Math.max(1, 0.75 / transform.k)) : 1
                      const labelY = 16 + 4 * labelScale
                      return (
                        <g
                          key={loc.id}
                          transform={`translate(${p.x},${p.y})`}
                          className="cursor-pointer"
                          onMouseDown={(e) => onLocMouseDown(e, loc)}
                        >
                          <title>{isDraft ? `${loc.name}：位置为 AI 推测，请拖拽调整` : loc.name}</title>
                          {/* 选中态：金色脉冲光圈 */}
                          {isSelected && <circle r={24} fill="none" stroke="#facc15" strokeWidth={2} className="wm-pulse" />}
                          {/* 连路径起点提示 */}
                          {isLinkFrom && <circle r={18} fill="none" stroke="#facc15" strokeWidth={2} opacity={0.9} />}
                          {/* draft：橙色虚线外圈 */}
                          {isDraft && <circle r={20} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3 3" />}
                          {/* US-12：类型 SVG 图标（图标中心对准地点坐标；选中放大 1.15，draft 半透明） */}
                          <g transform={isSelected ? 'scale(1.15)' : undefined} opacity={isDraft ? 0.6 : 1}>
                            <svg x={-16} y={-16} width={32} height={32} viewBox="0 0 32 32" overflow="visible">
                              <LocationTypeIconPaths type={loc.locationType} />
                            </svg>
                          </g>
                          {/* US-12：深色名称背景条（始终显示，缩小时反向放大保证可读） */}
                          <g style={{ pointerEvents: 'none' }} transform={`translate(0,${labelY}) scale(${labelScale})`}>
                            <rect x={-labelW / 2} y={0} width={labelW} height={20} rx={4} fill="rgba(0,0,0,0.7)" />
                            <text
                              x={0} y={14} textAnchor="middle" fontSize={13} fontWeight={500}
                              fill={isSelected ? '#fde68a' : '#fff'}
                              style={{ userSelect: 'none' }}
                            >
                              {loc.name}
                              {isDraft && <tspan fill="#fb923c" fontSize={11}> 待确认</tspan>}
                            </text>
                          </g>
                        </g>
                      )
                    })}
                  </g>
                </svg>
              )}
              {/* 图例（US-13b：米黄底深灰字，与画布背景融合） */}
              <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-2 rounded-lg bg-[#f5f0e1]/90 px-2 py-1.5 text-[10px] text-gray-600">
                {Object.entries(LOCATION_TYPE_LABELS).map(([k, v]) => (
                  <span key={k} className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: LOCATION_TYPE_COLORS[k] }} />{v}
                  </span>
                ))}
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full border border-dashed border-amber-500" />待补充草稿</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 右：详情 + 旅行时间 + 路径列表（xl 三栏显示，xl 以下走下方 Tab） */}
        <div className="hidden xl:block">{rightPanel}</div>
      </div>

      {/* US-11：xl 以下响应式降级——画布在上，Tab 切换地点列表/地点详情 */}
      <div className="space-y-4 xl:hidden">
        <Tabs
          tabs={[{ id: 'list', label: '地点列表' }, { id: 'detail', label: '地点详情' }]}
          active={mobileTab}
          onChange={(id) => setMobileTab(id as 'list' | 'detail')}
        />
        {mobileTab === 'list' ? treePanel : rightPanel}
      </div>

      {/* 弹窗们 */}
      <LocationDialog
        open={locDialog.open}
        onClose={() => setLocDialog({ open: false })}
        projectId={projectId}
        mapId={activeMapId}
        loc={locDialog.loc}
        preset={locDialog.preset}
        locations={locations}
        onSaved={invalidateAll}
      />
      <LinkDialog
        open={linkDialog.open}
        onClose={() => setLinkDialog({ open: false })}
        projectId={projectId}
        from={linkDialog.from}
        to={linkDialog.to}
        locById={locById}
        onSaved={invalidateAll}
      />
      <MapSettingsDialog
        open={mapDialog.open}
        onClose={() => setMapDialog({ open: false })}
        projectId={projectId}
        map={mapDialog.map}
        maps={maps}
        onSaved={invalidateAll}
        createMap={createMapMut.mutate}
        updateMap={(id, data) => updateMapMut.mutate({ id, ...data })}
        isSaving={createMapMut.isPending || updateMapMut.isPending}
        onDelete={mapDialog.map && maps.length > 1 ? () => {
          if (window.confirm(`删除地图「${mapDialog.map.name}」及其下所有地点？`)) {
            deleteMapMut.mutate(mapDialog.map.id)
            setMapDialog({ open: false })
          }
        } : undefined}
      />
      {/* 诛仙库多选导入 */}
      {importOpen && (
        <ImportZhuxianDialog
          open={importOpen}
          projectId={projectId}
          mapId={activeMapId ?? undefined}
          onClose={() => setImportOpen(false)}
          onDone={invalidateAll}
        />
      )}
      {/* 文本抽取地点 */}
      {extractOpen && (
        <ExtractLocationsDialog
          open={extractOpen}
          projectId={projectId}
          mapId={activeMapId ?? undefined}
          onClose={() => setExtractOpen(false)}
          onDone={invalidateAll}
        />
      )}

      {/* 导出地图到文件（14-SRS US-26：按地图分组，可勾选整图或单独地点） */}
      {exportOpen && (
        <ImportFromProjectDialog
          open={exportOpen}
          mode="export"
          title="导出地图到文件"
          projectId={projectId}
          module="maps"
          moduleName="地图"
          listCurrentApi={async (pid) => {
            const [ms, locs] = await Promise.all([mapApi.listMaps(pid), mapApi.listLocations(pid)])
            return (ms as any[]).map((m) => ({
              id: m.id,
              name: m.name,
              children: (locs as any[]).filter((l) => l.mapId === m.id).map((l) => ({ id: l.id, name: l.name })),
            }))
          }}
          exportApi={(pid, data) => mapApi.exportFile(pid, data)}
          onClose={() => setExportOpen(false)}
          onDone={invalidateAll}
        />
      )}

      {/* 从文件导入地图（14-SRS US-26：跳过/覆盖/合并三策略） */}
      {fileImportOpen && (
        <ImportFromProjectDialog
          open={fileImportOpen}
          mode="import-file"
          title="从文件导入地图"
          projectId={projectId}
          module="maps"
          moduleName="地图"
          allowMerge
          listCurrentApi={async (pid) => {
            const ms = await mapApi.listMaps(pid)
            return (ms as any[]).map((m) => ({ id: m.id, name: m.name }))
          }}
          importFileApi={mapApi.importFile}
          onClose={() => setFileImportOpen(false)}
          onDone={invalidateAll}
        />
      )}
    </div>
  )
}

// ============ 旅行时间估算面板（US-4/US-5） ============

function TravelTimePanel({ projectId, locations }: { projectId: string; locations: any[] }) {
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [mode, setMode] = useState('fly')
  const [result, setResult] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const query = async () => {
    if (!fromId || !toId) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const r = await mapApi.distance(projectId, Number(fromId), Number(toId), mode as any)
      setResult(r)
    } catch (e: any) {
      setError(e.message || '查询失败')
    } finally {
      setLoading(false)
    }
  }

  const opts = locations.map((l: any) => ({ value: String(l.id), label: l.name }))
  return (
    <Card>
      <CardContent className="pt-4">
        <h3 className="mb-2 text-sm font-medium text-gray-200">旅行时间估算</h3>
        <div className="space-y-2">
          <Select options={[{ value: '', label: '选择出发地…' }, ...opts]} value={fromId} onChange={(e) => setFromId(e.target.value)} />
          <Select options={[{ value: '', label: '选择目的地…' }, ...opts]} value={toId} onChange={(e) => setToId(e.target.value)} />
          <Select
            options={Object.entries(MODE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          />
          <Button size="sm" className="w-full" onClick={query} disabled={!fromId || !toId || fromId === toId || loading}>
            {loading ? '估算中…' : '估算路程'}
          </Button>
          {error && <p className="text-xs text-red-400">{error}</p>}
          {result && (
            <div className="rounded-lg bg-gray-800/60 p-2 text-xs text-gray-300">
              <p>
                {MODE_LABELS[mode]}约需 <span className="font-semibold text-gold-300">{result.display}</span>
                {result.estimated && <span className="text-gray-500">（未连路径，按直线估算）</span>}
              </p>
              {Array.isArray(result.pathNames) && result.pathNames.length > 2 && (
                <p className="mt-1 text-gray-500">途经：{result.pathNames.join(' → ')}</p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ============ 地点新建/编辑弹窗 ============

function LocationDialog({
  open, onClose, projectId, mapId, loc, preset, locations, onSaved,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  mapId: number | null
  loc?: any
  preset?: { x: number; y: number }
  locations: any[]
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [form, setForm] = useState<any>({})
  useEffect(() => {
    if (!open) return
    if (loc) {
      setForm({ ...loc })
    } else {
      setForm({
        name: '', x: preset?.x ?? 500, y: preset?.y ?? 500,
        locationType: 'generic', dangerLevel: 'normal',
        description: '', affiliatedFaction: '', parentLocationId: '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const saveMut = useMutation({
    mutationFn: (data: any) =>
      loc
        ? mapApi.updateLocation(projectId, loc.id, data)
        : mapApi.createLocation(projectId, data),
    onSuccess: () => {
      toast(loc ? '地点已保存并转正' : '地点已创建')
      onSaved()
      onClose()
    },
    onError: (e: any) => toast(e.message || '保存失败', 'error'),
  })

  const parentOpts = locations.filter((l: any) => !loc || l.id !== loc.id)
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))

  return (
    <Dialog open={open} onClose={onClose} title={loc ? `编辑地点：${loc.name}` : '新建地点'}>
      <div className="space-y-3">
        <Input label="名称" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="如：青云山" />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="类型"
            options={Object.entries(LOCATION_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
            value={form.locationType ?? 'generic'}
            onChange={(e) => set('locationType', e.target.value)}
          />
          <Select
            label="危险等级"
            options={Object.entries(DANGER_LABELS).map(([v, l]) => ({ value: v, label: l }))}
            value={form.dangerLevel ?? 'normal'}
            onChange={(e) => set('dangerLevel', e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="坐标 X" type="number" value={form.x ?? 0} onChange={(e) => set('x', Number(e.target.value))} />
          <Input label="坐标 Y" type="number" value={form.y ?? 0} onChange={(e) => set('y', Number(e.target.value))} />
        </div>
        <Input label="所属势力（可选）" value={form.affiliatedFaction ?? ''} onChange={(e) => set('affiliatedFaction', e.target.value)} placeholder="如：青云门" />
        <Select
          label="上级区域（可选，US-3）"
          options={[{ value: '', label: '无' }, ...parentOpts.map((l: any) => ({ value: String(l.id), label: l.name }))]}
          value={form.parentLocationId ? String(form.parentLocationId) : ''}
          onChange={(e) => set('parentLocationId', e.target.value ? Number(e.target.value) : null)}
        />
        <Textarea label="环境描述" rows={3} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="地形地貌、氛围、关键特征…" />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            onClick={() => {
              if (!form.name?.trim()) { toast('请填写地点名称', 'error'); return }
              const payload: any = {
                name: form.name.trim(),
                x: Number(form.x) || 0,
                y: Number(form.y) || 0,
                locationType: form.locationType,
                dangerLevel: form.dangerLevel,
                description: form.description || null,
                affiliatedFaction: form.affiliatedFaction || null,
                // ''（未选）需归一为 null，否则后端 zod 校验 number 失败导致创建 400
                parentLocationId: form.parentLocationId || null,
              }
              if (!loc) payload.mapId = mapId ?? undefined
              // 编辑保存即转正（confirm），拖拽移动不转正
              if (loc) payload.confirm = true
              saveMut.mutate(payload)
            }}
            disabled={saveMut.isPending}
          >
            {saveMut.isPending ? '保存中…' : loc ? '保存（转正）' : '创建'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// ============ 路径新建弹窗（US-4） ============

function LinkDialog({
  open, onClose, projectId, from, to, locById, onSaved,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  from?: number
  to?: number
  locById: Map<number, any>
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [form, setForm] = useState<any>({})
  useEffect(() => {
    if (open) setForm({ linkType: 'path', travelTimeWalk: '', travelTimeFly: '', travelTimeShip: '', description: '' })
  }, [open])

  const saveMut = useMutation({
    mutationFn: (data: any) => mapApi.createLink(projectId, data),
    onSuccess: () => { toast('路径已保存'); onSaved(); onClose() },
    onError: (e: any) => toast(e.message || '保存失败', 'error'),
  })
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))

  return (
    <Dialog open={open} onClose={onClose} title="新建路径">
      <p className="mb-3 text-sm text-gray-400">
        {locById.get(from ?? -1)?.name} ↔ {locById.get(to ?? -1)?.name}
      </p>
      <div className="space-y-3">
        <Select
          label="路径类型"
          options={Object.entries(LINK_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
          value={form.linkType ?? 'path'}
          onChange={(e) => set('linkType', e.target.value)}
        />
        <div className="grid grid-cols-3 gap-3">
          <Input label="步行(分)" type="number" value={form.travelTimeWalk ?? ''} onChange={(e) => set('travelTimeWalk', e.target.value)} placeholder="自动" />
          <Input label="御剑(分)" type="number" value={form.travelTimeFly ?? ''} onChange={(e) => set('travelTimeFly', e.target.value)} placeholder="自动" />
          <Input label="舟船(分)" type="number" value={form.travelTimeShip ?? ''} onChange={(e) => set('travelTimeShip', e.target.value)} placeholder="自动" />
        </div>
        <Textarea label="备注（可选）" rows={2} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
        <p className="text-xs text-gray-500">留空的时间将在估算时按两地直线距离自动推算。</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            onClick={() => saveMut.mutate({
              fromLocationId: from,
              toLocationId: to,
              linkType: form.linkType,
              travelTimeWalk: form.travelTimeWalk ? Number(form.travelTimeWalk) : null,
              travelTimeFly: form.travelTimeFly ? Number(form.travelTimeFly) : null,
              travelTimeShip: form.travelTimeShip ? Number(form.travelTimeShip) : null,
              description: form.description || null,
            })}
            disabled={saveMut.isPending}
          >
            {saveMut.isPending ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// ============ 地图设置弹窗（新建 + 编辑，US-1底图 / US-3上级地图） ============

function MapSettingsDialog({
  open, onClose, projectId, map, maps, onSaved, createMap, updateMap, isSaving, onDelete,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  map?: any
  maps: any[]
  onSaved: () => void
  createMap: (data: any) => void
  updateMap: (id: number, data: any) => void
  isSaving: boolean
  onDelete?: () => void
}) {
  const { toast } = useToast()
  const [form, setForm] = useState<any>({})
  const isNew = !map
  useEffect(() => {
    if (open) {
      setForm({
        name: map?.name ?? '新地图',
        description: map?.description ?? '',
        bgOpacity: map?.bgOpacity ?? 0.7,
        bgImage: map?.bgImage ?? null,
        parentMapId: map?.parentMapId ?? '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, map?.id])

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))

  /** 底图上传：FileReader 转 dataURL（限2MB，项目无文件上传设施） */
  const onPickBg = (file: File | null) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast('底图不能超过 2MB', 'error'); return }
    const reader = new FileReader()
    reader.onload = () => set('bgImage', String(reader.result))
    reader.readAsDataURL(file)
  }

  const handleSave = () => {
    if (!form.name?.trim()) { toast('请填写地图名称', 'error'); return }
    const payload = {
      name: form.name.trim(),
      description: form.description || null,
      bgImage: form.bgImage ?? null,
      bgOpacity: Number(form.bgOpacity),
      // ''（未选）需归一为 null，否则后端 zod 校验 number 失败导致保存 400（底图也存不进）
      parentMapId: form.parentMapId || null,
    }
    if (isNew) {
      createMap(payload)
    } else {
      updateMap(map.id, payload)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={isNew ? '新建地图' : `地图设置：${map.name}`}>
      <div className="space-y-3">
        <Input label="地图名称" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="如：中原大地、青云山周边" autoFocus />
        <Textarea label="描述（可选）" rows={2} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-300">底图（图片≤2MB，自动转内嵌存储）</label>
          <div className="flex items-center gap-2">
            <input
              type="file" accept="image/*"
              className="text-xs text-gray-400 file:mr-2 file:rounded-lg file:border-gray-700 file:bg-gray-800 file:px-3 file:py-1.5 file:text-xs file:text-gray-200"
              onChange={(e) => onPickBg(e.target.files?.[0] ?? null)}
            />
            {form.bgImage && (
              <>
                <span className="text-xs text-gray-500">已选择</span>
                <Button size="sm" variant="outline" onClick={() => set('bgImage', null)}>移除</Button>
              </>
            )}
          </div>
          {/* US-14：未上传自定义底图时预览系统默认底图 */}
          <div className="mt-2 overflow-hidden rounded-lg border border-gray-700" style={{ maxHeight: 120 }}>
            <img src={form.bgImage ?? defaultMapBg} alt="底图预览" className="w-full object-contain" style={{ maxHeight: 120 }} />
          </div>
          <p className="mt-1 text-[11px] text-gray-500">未上传自定义底图时使用系统默认底图。</p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-300">底图透明度：{Math.round((form.bgOpacity ?? 0.7) * 100)}%</label>
          <input
            type="range" min={0} max={1} step={0.05}
            value={form.bgOpacity ?? 0.7}
            onChange={(e) => set('bgOpacity', Number(e.target.value))}
            className="w-full"
          />
        </div>
        <Select
          label="上级地图（可选，层级嵌套）"
          options={[{ value: '', label: '无（顶级）' }, ...maps.filter((m: any) => !map || m.id !== map.id).map((m: any) => ({ value: String(m.id), label: m.name }))]}
          value={form.parentMapId ? String(form.parentMapId) : ''}
          onChange={(e) => set('parentMapId', e.target.value ? Number(e.target.value) : null)}
        />
        <div className="flex items-center justify-between pt-1">
          {onDelete ? (
            <Button variant="outline" className="text-red-400" onClick={onDelete}>
              <Trash2 className="mr-1 h-3 w-3" /> 删除地图
            </Button>
          ) : isNew ? <span /> : <span className="text-xs text-gray-600">至少保留一张地图</span>}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? '保存中…' : isNew ? '创建' : '保存'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

// ============ US-12：地点类型 SVG 图标（viewBox 0 0 32 32） ============

/** 各类型轮廓 path（危险地/城池用 evenodd 挖出感叹号/门洞，露出背景色） */
const TYPE_SHAPES: Record<string, { d: string; evenodd?: boolean }> = {
  // 宗门：主峰 + 侧峰带底座
  sect: { d: 'M16 3 L22 14 L26 9 L31 27 L1 27 L10 14 Z' },
  // 城池：凸字形城墙 + 门洞
  city: { d: 'M4 27 V14 H8 V9 H12 V5 H20 V9 H24 V14 H28 V27 Z M13 27 V21 A3 3 0 0 1 19 21 V27 Z', evenodd: true },
  // 秘境：菱形（内部光点在细节层）
  secret_realm: { d: 'M16 3 L29 16 L16 29 L3 16 Z' },
  // 险地：三角形 + 感叹号挖孔
  danger: { d: 'M16 3 L30 28 H2 Z M14.6 11.5 h2.8 l-0.6 9 h-1.6 Z M16 22.9 a1.7 1.7 0 1 0 0.02 0 Z', evenodd: true },
  // 传送阵：八边形（内部八卦线条在细节层）
  teleport: { d: 'M11 3 H21 L29 11 V21 L21 29 H11 L3 21 V11 Z' },
  // 战场：双剑交叉
  battlefield: { d: 'M6 3 L9.5 3 L27 24 L24 27 Z M23.5 26.5 l3 -3 3 3 -3 3 Z M26 3 L22.5 3 L5 24 L8 27 Z M8.5 26.5 l-3 -3 -3 3 3 3 Z' },
  // 通用：实心圆
  generic: { d: 'M16 5 a11 11 0 1 0 0.02 0 Z' },
}

/** 图标 path 内容（供画布内联 <svg> 与 HTML 上下文复用），双层渲染保证任意背景可见 */
export function LocationTypeIconPaths({ type }: { type: string }) {
  const shape = TYPE_SHAPES[type] || TYPE_SHAPES.generic
  const color = LOCATION_TYPE_COLORS[type] || '#9ca3af'
  const fr = shape.evenodd ? 'evenodd' : undefined
  return (
    <>
      {/* 底层：白色粗描边 */}
      <path d={shape.d} fill="none" stroke="#fff" strokeWidth={3} strokeLinejoin="round" fillRule={fr} />
      {/* 上层：类型色填充 + 深色细描边 */}
      <path d={shape.d} fill={color} stroke="#1a1a1a" strokeWidth={1} strokeLinejoin="round" fillRule={fr} />
      {/* 秘境：内部光点 */}
      {type === 'secret_realm' && <circle cx={16} cy={16} r={3} fill="#ecfdf5" stroke="#1a1a1a" strokeWidth={0.8} />}
      {/* 传送阵：内部八卦线条 */}
      {type === 'teleport' && (
        <g fill="none" stroke="#1a1a1a" strokeWidth={1.4} opacity={0.75}>
          <circle cx={16} cy={16} r={7.5} />
          <path d="M16 8.5 V13 M16 19 V23.5 M8.5 16 H13 M19 16 H23.5" strokeLinecap="round" />
          <circle cx={16} cy={16} r={2.2} fill="#1a1a1a" stroke="none" />
        </g>
      )}
    </>
  )
}

/** 独立 SVG 图标（HTML 上下文用，如地点导航树的 16px 小图标） */
export function LocationTypeIcon({ type, size = 32 }: { type: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0" aria-hidden>
      <LocationTypeIconPaths type={type} />
    </svg>
  )
}
