/**
 * 合并人物数据源 Hook（自定义人物模块）
 * 诛仙库原生人物（正数ID） + 本项目自定义人物（负数ID，名称带★标记），
 * 供场景素材池、影响目标选择、关系面板等所有人物选择器统一消费。
 */
import { useQuery } from '@tanstack/react-query'
import { findPosition, findRaceCategory, findRaceSub } from '@novel-studio/shared'
import { worldApi, customCharacterApi } from './api'

/** 合并后的统一人物条目 */
export interface MergedCharacter {
  /** 正数=诛仙库原生人物，负数=自定义人物 */
  id: number
  /** 自定义人物名称带★前缀（如"★沧溟子"） */
  name: string
  /** 原始名称（不带★，用于正文/表单提交） */
  rawName: string
  /** 人物来源 */
  source: 'zhuxian' | 'custom'
  /** 原生=修为境界；自定义=五档定位名 */
  realm?: string
  /** 原生=门派；自定义=种族大类·小类 */
  faction?: string
  personality?: string
  /** 原始数据行（详情展示用） */
  raw: any
}

/** 自定义人物行 → 统一条目（负数ID，名称带★） */
export function toMergedCustomCharacter(c: any): MergedCharacter {
  return {
    id: c.id,
    name: `★${c.name}`,
    rawName: c.name,
    source: 'custom',
    realm: findPosition(c.position)?.name ?? c.position,
    faction: `${findRaceCategory(c.raceCategory)?.name ?? c.raceCategory}·${findRaceSub(c.raceCategory, c.raceSub)?.name ?? c.raceSub}`,
    personality: [c.innerPersonality, ...(c.outerPersonality ?? [])].filter(Boolean).join('、'),
    raw: c,
  }
}

/** 诛仙库人物行 → 统一条目 */
export function toMergedZhuxianCharacter(c: any): MergedCharacter {
  return {
    id: c.id,
    name: c.name,
    rawName: c.name,
    source: 'zhuxian',
    realm: c.realm,
    faction: c.faction,
    personality: c.personality,
    raw: c,
  }
}

/**
 * 合并数据源：诛仙库人物 + 本项目自定义人物
 * @param projectId 项目ID（空则只返回诛仙库人物）
 * @param keyword 关键字过滤（两个数据源统一按名称过滤）
 * @param enabled 是否启用查询（供按需加载的选择器使用）
 * @param bookId 书籍ID（可选，按书籍隔离诛仙库人物；不传则跨书）
 */
export function useAllCharacters(projectId?: string | number, keyword?: string, enabled = true, bookId?: number) {
  const zhuxianQuery = useQuery({
    queryKey: ['all-characters-zhuxian', keyword ?? '', bookId ?? 'all'],
    queryFn: () => worldApi.characters({ ...(keyword ? { keyword } : {}), ...(bookId ? { bookId } : {}) }),
    enabled,
    staleTime: 5 * 60 * 1000,
  })

  const customQuery = useQuery({
    queryKey: ['custom-characters', String(projectId ?? '')],
    queryFn: () => customCharacterApi.list(String(projectId)),
    enabled: enabled && projectId != null && projectId !== '',
    staleTime: 30 * 1000,
  })

  const zhuxianList: MergedCharacter[] = Array.isArray(zhuxianQuery.data)
    ? zhuxianQuery.data.map(toMergedZhuxianCharacter)
    : []
  const customListAll: MergedCharacter[] = Array.isArray(customQuery.data)
    ? customQuery.data.map(toMergedCustomCharacter)
    : []
  // 自定义人物在前端按关键字过滤（后端列表接口不带keyword）
  const customList = keyword
    ? customListAll.filter((c) => c.rawName.includes(keyword))
    : customListAll

  // 自定义人物排前（本项目专属，优先展示）
  const characters: MergedCharacter[] = [...customList, ...zhuxianList]

  return {
    characters,
    customCharacters: customList,
    zhuxianCharacters: zhuxianList,
    isLoading: zhuxianQuery.isLoading || customQuery.isLoading,
    refetchCustom: customQuery.refetch,
  }
}

/**
 * 人物姓名解析器：负数ID→自定义人物名（带★），正数ID→诛仙库人物名。
 * 供 RelationPanel 等只有ID需要显示名称的场景使用。
 */
export function useCharacterNameResolver(projectId?: string | number) {
  const { characters } = useAllCharacters(projectId)
  const nameById = new Map<number, string>(characters.map((c) => [c.id, c.name]))
  return (id: number, fallback?: string) => nameById.get(id) ?? fallback ?? `人物${id}`
}
