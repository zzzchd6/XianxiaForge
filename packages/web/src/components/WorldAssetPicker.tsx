import { useQuery } from '@tanstack/react-query'
import AssetMultiSelect from './AssetMultiSelect'
import { customCharacterApi, customWeaponsApi, customTechniquesApi, mapApi } from '../lib/api'

export interface AssetSel {
  characterIds: number[]
  weaponIds: number[]
  techniqueIds: number[]
  locationIds: number[]
}

export const EMPTY_ASSET_SEL: AssetSel = { characterIds: [], weaponIds: [], techniqueIds: [], locationIds: [] }

interface WorldAssetPickerProps {
  projectId: string
  /** 仅在需要时拉取资产列表（如弹窗打开/分步向导 step4/5） */
  enabled: boolean
  value: AssetSel
  onChange: (sel: AssetSel) => void
}

/**
 * 世界观资产四模块勾选共享区块（模式归一化 PRD REQ-4.2：
 * 从 OutlineEditor 生成弹窗抽取，供快速生成与分步生成共用）。
 * 语义：勾选后仅注入选中资产；不勾选则后端自动全量注入。
 */
export default function WorldAssetPicker({ projectId, enabled, value, onChange }: WorldAssetPickerProps) {
  const active = enabled && !!projectId

  const { data: characters, isLoading: charsLoading } = useQuery({
    queryKey: ['gen-assets-characters', projectId],
    queryFn: () => customCharacterApi.list(projectId),
    enabled: active,
  })
  const { data: weapons, isLoading: weaponsLoading } = useQuery({
    queryKey: ['gen-assets-weapons', projectId],
    queryFn: () => customWeaponsApi.list(projectId),
    enabled: active,
  })
  const { data: techniques, isLoading: techniquesLoading } = useQuery({
    queryKey: ['gen-assets-techniques', projectId],
    queryFn: () => customTechniquesApi.list(projectId),
    enabled: active,
  })
  const { data: locations, isLoading: locationsLoading } = useQuery({
    queryKey: ['gen-assets-locations', projectId],
    queryFn: () => mapApi.listLocations(projectId),
    enabled: active,
  })

  return (
    <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-900/30 p-3">
      <p className="text-xs font-medium text-gray-400">
        世界观资产注入（可选）：勾选后仅注入选中资产；不勾选则自动注入全部已有资产
      </p>
      <details>
        <summary className="cursor-pointer text-sm text-gray-300 hover:text-indigo-300">
          众生百态·人物（已选 {value.characterIds.length}）
        </summary>
        <div className="pt-2">
          <AssetMultiSelect
            items={(characters || []).map((c: any) => ({ id: Number(c.id), name: c.name, meta: c.gender === 'female' ? '女' : '男' }))}
            isLoading={charsLoading}
            value={value.characterIds}
            onChange={(ids) => onChange({ ...value, characterIds: ids })}
            placeholder="搜索人物姓名…"
            emptyText="暂无自定义人物"
          />
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm text-gray-300 hover:text-indigo-300">
          铸器天工·武器（已选 {value.weaponIds.length}）
        </summary>
        <div className="pt-2">
          <AssetMultiSelect
            items={(weapons || []).map((w: any) => ({ id: Number(w.id), name: w.name, meta: w.grade }))}
            isLoading={weaponsLoading}
            value={value.weaponIds}
            onChange={(ids) => onChange({ ...value, weaponIds: ids })}
            placeholder="搜索武器名号…"
            emptyText="暂无自定义武器"
          />
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm text-gray-300 hover:text-indigo-300">
          道法自然·功法（已选 {value.techniqueIds.length}）
        </summary>
        <div className="pt-2">
          <AssetMultiSelect
            items={(techniques || []).map((t: any) => ({ id: Number(t.id), name: t.name }))}
            isLoading={techniquesLoading}
            value={value.techniqueIds}
            onChange={(ids) => onChange({ ...value, techniqueIds: ids })}
            placeholder="搜索功法名号…"
            emptyText="暂无自定义功法"
          />
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm text-gray-300 hover:text-indigo-300">
          山河舆图·地点（已选 {value.locationIds.length}）
        </summary>
        <div className="pt-2">
          <AssetMultiSelect
            items={(locations || []).map((l: any) => ({ id: Number(l.id), name: l.name }))}
            isLoading={locationsLoading}
            value={value.locationIds}
            onChange={(ids) => onChange({ ...value, locationIds: ids })}
            placeholder="搜索地点名称…"
            emptyText="暂无自定义地点"
          />
        </div>
      </details>
    </div>
  )
}
