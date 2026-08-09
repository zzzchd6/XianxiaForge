import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Spinner } from './ui'
import { cn } from '../lib/utils'

export interface AssetOption {
  id: number
  name: string
  /** 名称右侧的辅助标签（如定位/品级） */
  meta?: string
}

interface AssetMultiSelectProps {
  /** 候选资产列表（由调用方按模块拉取） */
  items: AssetOption[]
  isLoading?: boolean
  value: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
  emptyText?: string
}

/**
 * 通用资产多选器（16-SRS P2-1：AI生成大纲弹窗四模块勾选）
 * 交互模式对齐 CharacterMultiSelect：搜索过滤 + chips 展示 + 勾选列表。
 * 数据源由调用方注入（众生百态/铸器天工/道法自然/山河舆图各自 list API）。
 */
export default function AssetMultiSelect({
  items,
  isLoading = false,
  value,
  onChange,
  placeholder = '搜索名称…',
  emptyText = '无匹配资产',
}: AssetMultiSelectProps) {
  const [keyword, setKeyword] = useState('')

  const filtered = useMemo(() => {
    const kw = keyword.trim()
    if (!kw) return items
    return items.filter((i) => i.name.includes(kw))
  }, [items, keyword])

  const nameById = useMemo(() => new Map(items.map((i) => [i.id, i.name])), [items])

  const toggle = (id: number) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span
              key={id}
              className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300"
            >
              {nameById.get(id) ?? `资产${id}`}
              <button
                type="button"
                onClick={() => toggle(id)}
                className="rounded-full p-2 hover:bg-white/10"
                aria-label={`移除${nameById.get(id) ?? `资产${id}`}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-500" />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={placeholder}
          aria-label="搜索资产"
          className="w-full rounded-lg border border-gray-700 bg-gray-800 py-1.5 pl-8 pr-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-800 bg-gray-900/40 p-1">
        {isLoading ? (
          <div className="flex justify-center py-3">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-3 text-center text-xs text-gray-500">{emptyText}</p>
        ) : (
          filtered.slice(0, 60).map((i) => {
            const selected = value.includes(i.id)
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => toggle(i.id)}
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
                <span className="truncate">{i.name}</span>
                {i.meta && (
                  <span className="ml-auto shrink-0 text-[10px] text-gray-500">{i.meta}</span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
