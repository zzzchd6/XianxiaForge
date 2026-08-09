import { useMemo, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Download, CheckSquare, Square, Upload, FileJson, Minus } from 'lucide-react'
import { Button, Dialog, Spinner, Switch, useToast } from './ui'
import { useProjectContext } from '../hooks/useCurrentProject'
import type { FileImportStats } from '../lib/api'

/** 导出模式实体节点（地图模块带 children=地点） */
export interface EntityNode {
  id: number
  name: string
  caption?: string
  children?: { id: number; name: string }[]
}

type DialogMode = 'project' | 'export' | 'import-file'

/** JSON 信封常量（14-SRS §2.1） */
const ENVELOPE_FORMAT = 'xianxia-studio/export'
const ENVELOPE_VERSION = 1

interface ImportFromProjectDialogProps {
  open: boolean
  title: string
  projectId: string
  /** project=跨项目引入（默认，原行为）/ export=导出到文件 / import-file=从文件导入 */
  mode?: DialogMode
  // ---- project 模式 ----
  /** 获取源项目实体清单 */
  listApi?: (projectId: string, sourceProjectId: number) => Promise<{ id: number; name: string }[]>
  /** 执行跨项目引入 */
  importApi?: (projectId: string, data: { sourceProjectId: number; ids: number[]; skipDuplicates?: boolean }) => Promise<any>
  // ---- export / import-file 共用 ----
  /** 模块标识（characters/weapons/techniques/maps），用于信封与文件扩展名 */
  module?: 'characters' | 'weapons' | 'techniques' | 'maps'
  moduleName?: string
  /** 当前项目实体清单（导出勾选列表 / 导入冲突标红） */
  listCurrentApi?: (projectId: string) => Promise<EntityNode[]>
  // ---- export 模式 ----
  exportApi?: (projectId: string, data: { ids: number[]; locationIds?: number[] }) => Promise<{ items: any[] }>
  // ---- import-file 模式 ----
  importFileApi?: (projectId: string, data: { items: any[]; conflictStrategy: string }) => Promise<FileImportStats>
  /** 地图模块允许「合并」策略 */
  allowMerge?: boolean
  onClose: () => void
  onDone: () => void
}

interface ProjectImportResult {
  created: number
  skippedDuplicate: number
  failed: number
  errors: { id: number; name: string; error: string }[]
}

/** Blob 下载 JSON 文件 */
function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function ImportFromProjectDialog(props: ImportFromProjectDialogProps) {
  const { mode = 'project' } = props
  if (mode === 'export') return <ExportView {...props} />
  if (mode === 'import-file') return <FileImportView {...props} />
  return <ProjectImportView {...props} />
}

// ============================================================
// project 模式：跨项目引入（原有行为）
// ============================================================

function ProjectImportView({ open, title, projectId, listApi, importApi, onClose, onDone }: ImportFromProjectDialogProps) {
  const { toast } = useToast()
  const { projects } = useProjectContext()

  const [sourceProjectId, setSourceProjectId] = useState<string>('')
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [result, setResult] = useState<ProjectImportResult | null>(null)

  // 排除当前项目
  const otherProjects = useMemo(
    () => projects.filter((p: any) => String(p.id) !== projectId),
    [projects, projectId]
  )

  const { data: entities = [], isLoading } = useQuery({
    queryKey: ['import-from-project-sources', projectId, sourceProjectId],
    queryFn: () => listApi!(projectId, Number(sourceProjectId)),
    enabled: !!sourceProjectId,
  })

  const filtered = useMemo(() => {
    if (!keyword.trim()) return entities
    const kw = keyword.trim().toLowerCase()
    return entities.filter((e) => e.name.toLowerCase().includes(kw))
  }, [entities, keyword])

  const importMut = useMutation({
    mutationFn: () => importApi!(projectId, {
      sourceProjectId: Number(sourceProjectId),
      ids: [...selected],
      skipDuplicates,
    }),
    onSuccess: (res: any) => {
      setResult(res)
      toast(`引入完成：成功 ${res.created} 个`, 'success')
      onDone()
    },
    onError: (e: any) => toast(e.message || '引入失败', 'error'),
  })

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((e) => e.id)))
    }
  }

  // 结果视图
  if (result) {
    return (
      <Dialog open={open} onClose={onClose} title={title} className="max-w-md">
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-emerald-500/10 p-3">
              <div className="text-2xl font-bold text-emerald-400">{result.created}</div>
              <div className="text-xs text-gray-400">成功引入</div>
            </div>
            <div className="rounded-lg bg-amber-500/10 p-3">
              <div className="text-2xl font-bold text-amber-400">{result.skippedDuplicate}</div>
              <div className="text-xs text-gray-400">跳过重复</div>
            </div>
            <div className="rounded-lg bg-red-500/10 p-3">
              <div className="text-2xl font-bold text-red-400">{result.failed}</div>
              <div className="text-xs text-gray-400">失败</div>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="max-h-32 space-y-1 overflow-y-auto text-xs text-red-300">
              {result.errors.map((e) => (
                <p key={e.id}>{e.name}：{e.error}</p>
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

  return (
    <Dialog open={open} onClose={onClose} title={title} className="max-w-lg">
      <div className="space-y-3">
        {/* 源项目选择 */}
        <select
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-gold-500/50 focus:outline-none"
          value={sourceProjectId}
          onChange={(e) => { setSourceProjectId(e.target.value); setSelected(new Set()); setResult(null) }}
          aria-label="选择来源项目"
        >
          <option value="">选择源项目…</option>
          {otherProjects.map((p: any) => (
            <option key={p.id} value={String(p.id)}>{p.title || `项目 ${p.id}`}</option>
          ))}
        </select>

        {!sourceProjectId ? (
          <p className="py-8 text-center text-sm text-gray-500">请先选择要从哪个项目引入</p>
        ) : isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <>
            {/* 搜索 + 全选 */}
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-gold-500/50"
                placeholder="搜索名称…"
                aria-label="搜索"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <button
                type="button"
                className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-gray-400 hover:text-gray-200"
                onClick={toggleAll}
                aria-pressed={selected.size === filtered.length && filtered.length > 0}
              >
                {selected.size === filtered.length && filtered.length > 0
                  ? <CheckSquare className="h-4 w-4 text-gold-400" />
                  : <Square className="h-4 w-4" />}
                全选
              </button>
            </div>

            {/* 实体列表 */}
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">该项目暂无可引入的内容</p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {filtered.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-gray-700/60 bg-gray-800/40 px-3 py-2 hover:border-gray-600"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-gold-500 focus:ring-gold-500/30"
                    />
                    <span className="text-sm text-gray-200">{item.name}</span>
                  </label>
                ))}
              </div>
            )}

            {/* 底部操作 */}
            <div className="flex items-center justify-between border-t border-gray-700/50 pt-3">
              <Switch checked={skipDuplicates} onChange={setSkipDuplicates} label="跳过同名" />
              <Button
                disabled={selected.size === 0 || importMut.isPending}
                onClick={() => importMut.mutate()}
              >
                {importMut.isPending ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                引入 {selected.size > 0 ? `(${selected.size})` : ''}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}

// ============================================================
// export 模式：勾选实体 → 导出 .xianxia-{module}.json（14-SRS §2.1/§2.2）
// ============================================================

function ExportView({ open, title, projectId, module = 'characters', moduleName, listCurrentApi, exportApi, onClose, onDone }: ImportFromProjectDialogProps) {
  const { toast } = useToast()
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const { data: nodes = [], isLoading } = useQuery({
    queryKey: ['module-export-list', projectId, module],
    queryFn: () => listCurrentApi!(projectId),
    enabled: open,
  })

  const filtered = useMemo(() => {
    if (!keyword.trim()) return nodes
    const kw = keyword.trim().toLowerCase()
    return nodes
      .map((n) => ({ ...n, children: n.children?.filter((c) => c.name.toLowerCase().includes(kw)) }))
      .filter((n) => n.name.toLowerCase().includes(kw) || (n.children?.length ?? 0) > 0)
  }, [nodes, keyword])

  const toggleNode = (node: EntityNode) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (node.children?.length) {
        const allIn = node.children.every((c) => next.has(c.id))
        node.children.forEach((c) => { if (allIn) next.delete(c.id); else next.add(c.id) })
      } else {
        if (next.has(node.id)) next.delete(node.id)
        else next.add(node.id)
      }
      return next
    })
  }

  const toggleChild = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    const allIds = nodes.flatMap((n) => (n.children?.length ? n.children.map((c) => c.id) : [n.id]))
    if (allIds.every((id) => selected.has(id))) setSelected(new Set())
    else setSelected(new Set(allIds))
  }

  const exportMut = useMutation({
    mutationFn: async () => {
      // 地图模块：mapIds=含勾选地点的地图+整图勾选；locationIds=勾到的地点
      const mapParentIds = nodes.filter((n) => n.children?.some((c) => selected.has(c.id))).map((n) => n.id)
      const flatIds = nodes.filter((n) => !n.children?.length && selected.has(n.id)).map((n) => n.id)
      const ids = module === 'maps'
        ? [...new Set([...mapParentIds, ...flatIds])]
        : [...selected]
      const locationIds = module === 'maps' ? [...selected].filter((id) => !nodes.some((n) => n.id === id)) : undefined
      return exportApi!(projectId, { ids, locationIds })
    },
    onSuccess: (res: any) => {
      const items = res?.items ?? []
      const envelope = {
        format: ENVELOPE_FORMAT,
        version: ENVELOPE_VERSION,
        module,
        moduleName: moduleName ?? module,
        exportedAt: new Date().toISOString(),
        items,
      }
      downloadJson(`${moduleName ?? module}.xianxia-${module}.json`, envelope)
      toast(`已导出 ${items.length} 条${moduleName ?? ''}数据`, 'success')
      onDone()
      onClose()
    },
    onError: (e: any) => toast(e.message || '导出失败', 'error'),
  })

  return (
    <Dialog open={open} onClose={onClose} title={title} className="max-w-lg">
      <div className="space-y-3">
        {/* 搜索 + 全选 */}
        <div className="flex items-center gap-2">
          <input
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-gold-500/50"
            placeholder="搜索名称…"
            aria-label="搜索"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <button
            type="button"
            className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-gray-400 hover:text-gray-200"
            onClick={toggleAll}
          >
            {nodes.length > 0 && nodes.flatMap((n) => (n.children?.length ? n.children.map((c) => c.id) : [n.id])).every((id) => selected.has(id))
              ? <CheckSquare className="h-4 w-4 text-gold-400" />
              : <Square className="h-4 w-4" />}
            全选
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">暂无可导出的内容</p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {filtered.map((node) => {
              const childIds = node.children?.map((c) => c.id) ?? []
              const checkedCount = childIds.filter((id) => selected.has(id)).length
              const allChecked = childIds.length > 0 && checkedCount === childIds.length
              const someChecked = checkedCount > 0 && !allChecked
              const selfChecked = !node.children?.length && selected.has(node.id)
              return (
                <div key={node.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-gray-700/60 bg-gray-800/40 px-3 py-2 hover:border-gray-600">
                    <input
                      type="checkbox"
                      checked={allChecked || selfChecked}
                      ref={(el) => { if (el) el.indeterminate = someChecked }}
                      onChange={() => toggleNode(node)}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-gold-500 focus:ring-gold-500/30"
                    />
                    <span className="text-sm text-gray-200">{node.name}</span>
                    {node.caption && <span className="text-xs text-gray-500">{node.caption}</span>}
                    {node.children?.length ? (
                      <span className="ml-auto text-xs text-gray-500">{checkedCount}/{node.children.length} 地点</span>
                    ) : null}
                  </label>
                  {node.children && checkedCount > 0 && (
                    <div className="ml-6 mt-1 space-y-0.5">
                      {node.children.map((c) => (
                        <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-gray-800/40">
                          <input
                            type="checkbox"
                            checked={selected.has(c.id)}
                            onChange={() => toggleChild(c.id)}
                            className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-gold-500 focus:ring-gold-500/30"
                          />
                          <span className="text-xs text-gray-300">{c.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 底部操作 */}
        <div className="flex items-center justify-between border-t border-gray-700/50 pt-3">
          <p className="text-xs text-gray-500">导出为 .xianxia-{module}.json 文件</p>
          <Button
            disabled={selected.size === 0 || exportMut.isPending}
            onClick={() => exportMut.mutate()}
          >
            {exportMut.isPending ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            导出选中 {selected.size > 0 ? `(${selected.size})` : ''}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// ============================================================
// import-file 模式：读取 .xianxia-{module}.json → 预览冲突 → 导入（14-SRS §2.2/§2.3）
// ============================================================

type FileStrategy = 'skip' | 'overwrite' | 'merge'

function FileImportView({ open, title, projectId, module = 'characters', moduleName, listCurrentApi, importFileApi, allowMerge, onClose, onDone }: ImportFromProjectDialogProps) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<any[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [strategy, setStrategy] = useState<FileStrategy>('skip')
  const [result, setResult] = useState<FileImportStats | null>(null)

  // 当前项目已有实体名（冲突标红）
  const { data: currentNodes = [] } = useQuery({
    queryKey: ['module-import-conflict-names', projectId, module],
    queryFn: () => listCurrentApi!(projectId),
    enabled: open && !!listCurrentApi,
  })
  const existingNames = useMemo(() => {
    const s = new Set<string>()
    for (const n of currentNodes) s.add(n.name)
    return s
  }, [currentNodes])

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result))
        if (obj?.format !== ENVELOPE_FORMAT || obj?.version !== ENVELOPE_VERSION) {
          toast('无效文件：不是本系统导出的 JSON 文件', 'error')
          return
        }
        if (obj.module !== module) {
          toast(`文件属于「${obj.moduleName ?? obj.module}」模块，请在对应模块页面导入`, 'error')
          return
        }
        if (!Array.isArray(obj.items) || obj.items.length === 0) {
          toast('文件中没有可导入的数据', 'error')
          return
        }
        setItems(obj.items)
        setFileName(file.name)
        setResult(null)
      } catch {
        toast('文件解析失败：JSON 格式错误', 'error')
      }
    }
    reader.readAsText(file)
  }

  const importMut = useMutation({
    mutationFn: () => importFileApi!(projectId, { items: items!, conflictStrategy: strategy }),
    onSuccess: (res) => {
      setResult(res)
      toast(`导入完成：成功 ${res.imported}，覆盖 ${res.overwritten}${allowMerge ? `，合并 ${res.merged}` : ''}`, 'success')
      onDone()
    },
    onError: (e: any) => toast(e.message || '导入失败', 'error'),
  })

  // 结果视图
  if (result) {
    const cells = [
      { n: result.imported, label: '成功导入', cls: 'emerald' },
      { n: result.skipped, label: '跳过', cls: 'amber' },
      { n: result.overwritten, label: '覆盖', cls: 'sky' },
      ...(allowMerge ? [{ n: result.merged, label: '合并', cls: 'violet' }] : []),
      { n: result.failed, label: '失败', cls: 'red' },
    ]
    const colorMap: Record<string, string> = {
      emerald: 'bg-emerald-500/10 text-emerald-400',
      amber: 'bg-amber-500/10 text-amber-400',
      sky: 'bg-sky-500/10 text-sky-400',
      violet: 'bg-violet-500/10 text-violet-400',
      red: 'bg-red-500/10 text-red-400',
    }
    return (
      <Dialog open={open} onClose={onClose} title={title} className="max-w-md">
        <div className="space-y-4 py-2">
          <div className={`grid gap-3 text-center ${cells.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
            {cells.map((c) => (
              <div key={c.label} className={`rounded-lg p-3 ${colorMap[c.cls].split(' ')[0]}`}>
                <div className={`text-2xl font-bold ${colorMap[c.cls].split(' ')[1]}`}>{c.n}</div>
                <div className="text-xs text-gray-400">{c.label}</div>
              </div>
            ))}
          </div>
          {result.warnings.length > 0 && (
            <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg bg-amber-500/5 p-2 text-xs text-amber-300/90">
              {result.warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}
          {result.errors.length > 0 && (
            <div className="max-h-28 space-y-1 overflow-y-auto text-xs text-red-300">
              {result.errors.map((e, i) => <p key={i}>{e.name}：{e.error}</p>)}
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>完成</Button>
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onClose={onClose} title={title} className="max-w-lg">
      <div className="space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
            e.target.value = ''
          }}
        />

        {!items ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-gray-600 bg-gray-800/30 py-10 text-gray-400 hover:border-gold-500/50 hover:text-gray-200"
          >
            <Upload className="h-8 w-8" />
            <span className="text-sm">点击选择导出文件</span>
            <span className="text-xs text-gray-500">.xianxia-{module}.json</span>
          </button>
        ) : (
          <>
            {/* 文件信息 */}
            <div className="flex items-center gap-2 rounded-lg border border-gray-700/60 bg-gray-800/40 px-3 py-2 text-sm text-gray-300">
              <FileJson className="h-4 w-4 text-gold-400" />
              <span className="truncate">{fileName}</span>
              <span className="ml-auto shrink-0 text-xs text-gray-500">{items.length} 条</span>
              <button type="button" className="shrink-0 text-xs text-gray-400 hover:text-gray-200" onClick={() => { setItems(null); setFileName('') }}>
                重选
              </button>
            </div>

            {/* 预览列表（同名冲突标红） */}
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {items.map((item, i) => {
                const name = String(item?.name ?? '')
                const conflict = existingNames.has(name)
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${conflict ? 'border-red-500/50 bg-red-500/10' : 'border-gray-700/60 bg-gray-800/40'}`}
                  >
                    <span className={`text-sm ${conflict ? 'text-red-300' : 'text-gray-200'}`}>{name || '(未命名)'}</span>
                    {conflict && <span className="ml-auto shrink-0 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">同名冲突</span>}
                  </div>
                )
              })}
            </div>

            {/* 冲突策略 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">同名冲突时：</span>
              <div className="flex overflow-hidden rounded-lg border border-gray-700">
                {([['skip', '跳过'], ['overwrite', '覆盖'], ...(allowMerge ? [['merge', '合并']] : [])] as [FileStrategy, string][]).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setStrategy(val)}
                    className={`px-3 py-1.5 text-xs transition-colors ${strategy === val ? 'bg-gold-500/20 text-gold-300' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {strategy === 'merge' && <span className="text-[10px] text-gray-500">地点并入现有同名地图，坐标等比缩放</span>}
            </div>

            {/* 底部操作 */}
            <div className="flex items-center justify-end border-t border-gray-700/50 pt-3">
              <Button disabled={importMut.isPending} onClick={() => importMut.mutate()}>
                {importMut.isPending ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                导入 {items.length > 0 ? `(${items.length})` : ''}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
