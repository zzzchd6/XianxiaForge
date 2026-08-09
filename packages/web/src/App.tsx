import { useState, lazy, Suspense } from 'react'
import { Routes, Route, NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  Globe,
  ListTree,
  Sparkles,
  BookOpen,
  Bookmark,
  Settings,
  Clock,
  Users,
  Quote,
  Activity,
  PieChart,
  Sword,
  Flame,
  Database,
  ScrollText,
  Map,
  ChevronDown,
  ListTodo,
  ListChecks,
  Scale,
} from 'lucide-react'
import { cn } from './lib/utils'
import { ProjectProvider, useProjectContext } from './hooks/useCurrentProject'
import logoEmblem from './assets/logo-emblem.png'
import sealVertical from './assets/seal-vertical.png'
import { Meander, Mountains, Cloud } from './components/ornaments'
import Dashboard from './pages/Dashboard'
import WorldBrowser from './pages/WorldBrowser'
import OutlineEditor from './pages/OutlineEditor'
import GenerationConsole from './pages/GenerationConsole'
import ChapterReader from './pages/ChapterReader'
import ForeshadowLedger from './pages/ForeshadowLedger'
import TimelinePage from './pages/TimelinePage'
import CharacterGallery from './pages/CharacterGallery'
import QuoteLibrary from './pages/QuoteLibrary'
import CustomWeaponForge from './pages/CustomWeaponForge'
import CustomTechniqueForge from './pages/CustomTechniqueForge'
import HealthCheck from './pages/HealthCheck'
import GameConsole from './pages/GameConsole'
import DirectionStats from './pages/DirectionStats'
import SettingsPage from './pages/Settings'
import HotspotSniffer from './pages/HotspotSniffer'
import MaterialKnowledge from './pages/MaterialKnowledge'
import TechniqueLibrary from './pages/TechniqueLibrary'
import ProjectWizard from './pages/ProjectWizard'

// 待办中心（懒加载，代码分割）
const TodoCenter = lazy(() => import('./pages/TodoCenter'))

// 征途录·任务链台账（懒加载，代码分割）
const TaskLedger = lazy(() => import('./pages/TaskLedger'))

// 山河舆图（10-需求，懒加载，代码分割）
const WorldMapPage = lazy(() => import('./pages/WorldMapPage'))

// 叙事债务仪表盘（架构升级 Epic4，懒加载）
const NarrativeDebtPage = lazy(() => import('./pages/NarrativeDebtPage'))

// 双引擎工坊（PRD v1.3 冲突与台词双引擎，懒加载）
const DualEngineWorkshop = lazy(() => import('./pages/DualEngineWorkshop'))

// 侧边栏导航项配置（按创作工作流分组）
const navGroups: { group: string; items: { to: string; icon: any; label: string }[] }[] = [
  {
    group: '创作主线',
    items: [
      { to: '/', icon: LayoutDashboard, label: '仪表盘' },
      { to: '/outlines', icon: ListTree, label: '大纲' },
      { to: '/generation', icon: Sparkles, label: '生成' },
      { to: '/chapters', icon: BookOpen, label: '章节' },
    ],
  },
  {
    group: '世界搭建',
    items: [
      { to: '/world', icon: Globe, label: '世界观' },
      { to: '/characters', icon: Users, label: '众生百态' },
      { to: '/weapons', icon: Sword, label: '铸器天工' },
      { to: '/techniques', icon: ScrollText, label: '道法自然' },
      { to: '/maps', icon: Map, label: '山河舆图' },
    ],
  },
  {
    group: '叙事工程',
    items: [
      { to: '/foreshadow', icon: Bookmark, label: '伏笔因果' },
      { to: '/narrative-debt', icon: Scale, label: '叙事全景' },
      { to: '/timeline', icon: Clock, label: '时间线' },
      { to: '/health', icon: Activity, label: '叙事体检' },
    ],
  },
  {
    group: '素材配置',
    items: [
      { to: '/hotspot', icon: Flame, label: '热点嗅探' },
      { to: '/material-kb', icon: Database, label: '素材知识库' },
      { to: '/quotes', icon: Quote, label: '金句库' },
      { to: '/settings', icon: Settings, label: '设置' },
    ],
  },
]

// 侧边栏项目切换器（bug修复8.1：此前无当前项目概念，所有页面硬取projects[0]）
function ProjectSwitcher() {
  const { projects, currentProjectId, setCurrentProjectId } = useProjectContext()
  const [open, setOpen] = useState(false)
  const current = projects.find((p: any) => String(p.id) === currentProjectId)

  return (
    <div className="relative mx-3 mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-2 text-left transition-colors hover:border-gold-600/50"
      >
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-widest text-gray-500">当前项目</div>
          <div className="truncate text-[13px] font-medium text-gold-200">{current?.title || '加载中…'}</div>
        </div>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-gray-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
          {projects.map((p: any) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setCurrentProjectId(String(p.id)); setOpen(false) }}
              className={cn(
                'block w-full truncate px-3 py-2 text-left text-[13px] transition-colors hover:bg-white/[0.05]',
                String(p.id) === currentProjectId ? 'text-gold-300' : 'text-gray-300'
              )}
            >
              {p.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// 侧边栏导航组件
function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col overflow-hidden border-r border-gray-700 bg-gradient-to-b from-gray-900 to-gray-950">
      {/* Logo区域 */}
      <div className="flex h-16 items-center gap-3 border-b border-gray-700 px-4">
        <img
          src={logoEmblem}
          alt="指尖仙侠"
          className="h-9 w-9 shrink-0 drop-shadow-[0_0_10px_rgba(110,150,255,0.4)]"
        />
        <div className="flex flex-col leading-tight">
          <span className="text-gold-grad title-serif text-base font-semibold tracking-[0.2em]">指尖仙侠</span>
          <span className="text-[9px] font-medium tracking-[0.32em] text-gold-500/80">XIANXIA FORGE</span>
        </div>
      </div>

      {/* 品牌下回纹细带 */}
      <Meander className="mx-3 mt-2 h-2 text-gold-500 opacity-35" units={8} />

      {/* 当前项目切换器 */}
      <ProjectSwitcher />

      {/* 导航链接（分组） */}
      <nav className="mt-3 flex-1 overflow-y-auto px-3 pb-4">
        {navGroups.map((g) => (
          <div key={g.group} className="mb-2">
            <div className="mb-1 mt-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-600 first:mt-0">
              {g.group}
            </div>
            <div className="space-y-0.5">
              {g.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium tracking-wide transition-colors',
                      isActive
                        ? 'bg-[rgba(192,154,82,0.07)] text-gold-300'
                        : 'text-gray-400 hover:bg-white/[0.03] hover:text-gray-200'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded bg-gradient-to-b from-gold-400 to-gold-600" />
                      )}
                      <span
                        className={cn(
                          'h-[5px] w-[5px] shrink-0 rounded-full',
                          isActive ? 'bg-gold-400' : 'bg-current opacity-40'
                        )}
                      />
                      <item.icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* 底部：远山云影 + 版本信息 + 朱印 */}
      <div className="relative px-4 pb-4">
        <Mountains className="mb-2 h-11 w-full text-gold-500 opacity-[0.16]" />
        <div className="flex items-end gap-3">
          <img
            src={sealVertical}
            alt="指尖仙侠印"
            className="h-16 w-8 shrink-0 rounded-[4px] object-cover shadow-[0_2px_10px_rgba(0,0,0,0.5)] ring-1 ring-gold-600/40"
          />
          <div className="pb-0.5">
            <p className="text-[11px] tracking-[1.5px] text-gray-500">
              指尖仙侠 <span className="text-gold-500">v1.0</span>
            </p>
            <p className="mt-0.5 text-[10px] text-gray-600">AI 多智能体创作工坊</p>
          </div>
        </div>
      </div>
    </aside>
  )
}

// 主布局组件
function Layout() {
  return (
    <div className="min-h-screen bg-gray-950">
      {/* 背景装饰云（低透明度线稿，固定不随滚动） */}
      <Cloud className="pointer-events-none fixed -right-10 -top-8 z-0 w-[420px] -rotate-[8deg] text-gold-500 opacity-[0.05]" />
      <Cloud className="pointer-events-none fixed bottom-[6%] left-[200px] z-0 w-[300px] rotate-6 -scale-x-100 text-gold-500 opacity-[0.04]" />
      <Sidebar />
      <main className="relative z-[1] ml-56 min-h-screen">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

// 应用根组件
export default function App() {
  return (
    <ProjectProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="game" element={<GameConsole />} />
          <Route path="characters" element={<CharacterGallery />} />
          <Route path="weapons" element={<CustomWeaponForge />} />
          <Route path="techniques" element={<CustomTechniqueForge />} />
          <Route path="world" element={<WorldBrowser />} />
          <Route
            path="maps"
            element={
              <Suspense fallback={<div className="flex justify-center py-12 text-gray-500">加载中…</div>}>
                <WorldMapPage />
              </Suspense>
            }
          />
          <Route path="outlines" element={<OutlineEditor />} />
          <Route path="generation" element={<GenerationConsole />} />
          <Route
            path="dual-engine"
            element={
              <Suspense fallback={<div className="flex justify-center py-12 text-gray-500">加载中…</div>}>
                <DualEngineWorkshop />
              </Suspense>
            }
          />
          <Route path="chapters" element={<ChapterReader />} />
          <Route path="foreshadow" element={<ForeshadowLedger />} />
          <Route
            path="tasks"
            element={
              <Suspense fallback={<div className="flex justify-center py-12 text-gray-500">加载中…</div>}>
                <TaskLedger />
              </Suspense>
            }
          />
          <Route
            path="todo"
            element={
              <Suspense fallback={<div className="flex justify-center py-12 text-gray-500">加载中…</div>}>
                <TodoCenter />
              </Suspense>
            }
          />
          <Route path="timeline" element={<TimelinePage />} />
          <Route path="quotes" element={<QuoteLibrary />} />
          <Route path="health" element={<HealthCheck />} />
          <Route
            path="narrative-debt"
            element={
              <Suspense fallback={<div className="flex justify-center py-12 text-gray-500">加载中…</div>}>
                <NarrativeDebtPage />
              </Suspense>
            }
          />
          <Route path="direction-stats" element={<DirectionStats />} />
          <Route path="hotspot" element={<HotspotSniffer />} />
          <Route path="material-kb" element={<MaterialKnowledge />} />
          <Route path="technique-library" element={<TechniqueLibrary />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        {/* 全屏页面（无侧边栏） */}
        <Route path="wizard" element={<ProjectWizard />} />
      </Routes>
    </ProjectProvider>
  )
}
