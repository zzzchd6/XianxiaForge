/**
 * 双引擎工坊（PRD v1.3 冲突与台词双引擎生成模块）
 * - 场景A：三层冰山台词面板
 * - 场景B：冲突生成器（含组合成戏）
 * - 场景C：从大纲跳转而来时自动切到冲突页并预填（location.state.conflictDraft）
 * - 场景D：质量体检面板
 */
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Swords, MessagesSquare, Stethoscope } from 'lucide-react'
import { Tabs } from '../components/ui'
import IcebergPanel from '../components/dual-engine/IcebergPanel'
import ConflictPanel, { type ConflictDraftLike } from '../components/dual-engine/ConflictPanel'
import ValidatePanel from '../components/dual-engine/ValidatePanel'

export default function DualEngineWorkshop() {
  const location = useLocation()
  const draft = (location.state as any)?.conflictDraft as ConflictDraftLike | undefined

  const [tab, setTab] = useState(draft ? 'conflict' : 'iceberg')

  return (
    <div className="space-y-5">
      {/* 页头 */}
      <div>
        <h1 className="title-serif text-xl font-semibold tracking-wide text-gold-200">双引擎工坊</h1>
        <p className="mt-1 text-sm text-gray-500">
          冲突引擎（欲望→阻力→代价）× 冰山台词引擎（真相→表面→行为），生成有痛感、有潜台词的戏
        </p>
      </div>

      <Tabs
        tabs={[
          { id: 'iceberg', label: '冰山台词' },
          { id: 'conflict', label: '冲突引擎' },
          { id: 'validate', label: '质量体检' },
        ]}
        active={tab}
        onChange={setTab}
        className="max-w-md"
      />

      {tab === 'iceberg' && <IcebergPanel />}
      {tab === 'conflict' && <ConflictPanel initialDraft={draft ?? null} />}
      {tab === 'validate' && <ValidatePanel />}

      {/* 底部引擎说明（折叠态极简） */}
      <div className="flex items-center gap-4 border-t border-gray-800 pt-3 text-[11px] text-gray-600">
        <span className="flex items-center gap-1"><MessagesSquare className="h-3.5 w-3.5" />冰山台词：真话只给作者看，正文只有表面层+行为层</span>
        <span className="flex items-center gap-1"><Swords className="h-3.5 w-3.5" />冲突引擎：七寸映射+情绪曲线，爽点必须还账</span>
        <span className="flex items-center gap-1"><Stethoscope className="h-3.5 w-3.5" />质量体检：冰山四维/冲突四维/交叉五维</span>
      </div>
    </div>
  )
}
