import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Spinner } from './ui'
import { useAllCharacters } from '../lib/useAllCharacters'
import { cn } from '../lib/utils'

interface CharacterMultiSelectProps {
  projectId?: string | number
  /** 已选中的人物ID（正数=诛仙库原生，负数=自定义人物） */
  value: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
}

/**
 * 角色多选器（含自定义人物）
 * 数据源：诛仙库原生人物（正数ID） + 本项目自定义人物（负数ID，名称带★前缀）。
 * 供章节计划选择 POV 视角人物等场景使用，选中后直接产出含负数ID的数组，
 * 无需再走"人名→ID"解析，自定义人物也能稳定带入生成上下文。
 */
export default function CharacterMultiSelect({
  projectId,
  value,
  onChange,
  placeholder = '搜索人物姓名…',
}: CharacterMultiSelectProps) {
  const [keyword, setKeyword] = useState('')
  // 不带关键字拉全量，客户端过滤；同时保证已选中的人物（可能不匹配当前关键字）能解析出名称
  const { characters, isLoading } = useAllCharacters(projectId)

  const filtered = useMemo(() => {
    const kw = keyword.trim()
    if (!kw) return characters
    return characters.filter((c) => c.rawName.includes(kw))
  }, [characters, keyword])

  const nameById = useMemo(
    () => new Map(characters.map((c) => [c.id, c.name])),
    [characters]
  )

  const toggle = (id: number) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  }

  return (
    <div className="space-y-2">
      {/* 已选 chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span
              key={id}
              className={cn(
                'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                id < 0
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300'
              )}
            >
              {nameById.get(id) ?? `人物${id}`}
              <button
                type="button"
                onClick={() => toggle(id)}
                className="rounded-full p-2 hover:bg-white/10"
                aria-label={`移除${nameById.get(id) ?? `人物${id}`}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 搜索框 */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-500" />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={placeholder}
          aria-label="搜索角色"
          className="w-full rounded-lg border border-gray-700 bg-gray-800 py-1.5 pl-8 pr-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {/* 候选列表 */}
      <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-800 bg-gray-900/40 p-1">
        {isLoading ? (
          <div className="flex justify-center py-3">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-3 text-center text-xs text-gray-500">无匹配人物</p>
        ) : (
          filtered.slice(0, 60).map((c) => {
            const selected = value.includes(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                aria-pressed={selected}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  selected ? 'bg-indigo-500/20 text-indigo-200' : 'text-gray-300 hover:bg-gray-800'
                )}
              >
                <span
                  className={cn(
                    'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                    selected ? 'border-indigo-400 bg-indigo-500' : 'border-gray-600'
                  )}
                >
                  {selected && <span className="text-[9px] leading-none text-white">✓</span>}
                </span>
                <span className={cn('truncate', c.source === 'custom' && 'text-amber-300')}>
                  {c.name}
                </span>
                {c.realm && (
                  <span className="ml-auto shrink-0 text-[10px] text-gray-500">{c.realm}</span>
                )}
              </button>
            )
          })
        )}
      </div>
      <p className="text-[10px] text-gray-500">★ 为本项目自定义人物（众生百态），选中后将带入章节生成上下文</p>
    </div>
  )
}
