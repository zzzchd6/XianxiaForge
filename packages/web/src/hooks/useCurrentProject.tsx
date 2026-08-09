import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useProjects } from './useProjects'

const STORAGE_KEY = 'xianxiaforge:currentProjectId'

interface ProjectContextValue {
  /** 当前生效项目ID（已解析为有效值；列表未加载时为空串） */
  currentProjectId: string
  /** 项目全量列表（便于消费方复用，避免重复查询） */
  projects: any[]
  setCurrentProjectId: (id: string) => void
}

const ProjectContext = createContext<ProjectContextValue>({
  currentProjectId: '',
  projects: [],
  setCurrentProjectId: () => {},
})

function readStored(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

/**
 * 全局"当前项目"状态源。
 *
 * bug 修复（8.1）：此前前端从未实现当前项目概念，所有页面硬取 projects[0]，
 * 后端 list 按 createdAt 升序 → projects[0] 恒为第一个项目 → 新建的第二个项目无法使用。
 *
 * - localStorage 持久化，刷新后保持选择
 * - 存储的ID若已不在项目列表（如被删除），自动回退 projects[0]（与旧默认行为一致）
 * - 必须挂载在 QueryClientProvider 内（内部使用 useProjects）
 */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const { data } = useProjects()
  const projects = useMemo(() => data || [], [data])
  const [storedId, setStoredId] = useState<string>(readStored)

  // 解析为有效ID：存储值在列表中则用之，否则回退第一个项目
  const currentProjectId = useMemo(() => {
    if (!projects.length) return storedId || ''
    const ids = projects.map((p: any) => String(p.id))
    return ids.includes(storedId) ? storedId : String(projects[0].id)
  }, [projects, storedId])

  const setCurrentProjectId = useCallback((id: string) => {
    setStoredId(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      /* localStorage 不可用时忽略（仅丢失持久化，不影响本次会话） */
    }
  }, [])

  const value = useMemo(
    () => ({ currentProjectId, projects, setCurrentProjectId }),
    [currentProjectId, projects, setCurrentProjectId]
  )

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

/** 获取完整项目上下文（currentProjectId + projects 列表 + 切换函数） */
export function useProjectContext() {
  return useContext(ProjectContext)
}

/** 获取当前项目ID（string；加载中为空串，消费方 query 用 enabled:!!projectId 守卫） */
export function useCurrentProjectId(): string {
  return useContext(ProjectContext).currentProjectId
}

/** 获取当前项目完整对象（未加载/不存在时为 null） */
export function useCurrentProject(): any {
  const { currentProjectId, projects } = useContext(ProjectContext)
  return projects.find((p: any) => String(p.id) === currentProjectId) || null
}

/** 切换当前项目（写 state + localStorage） */
export function useSetCurrentProject() {
  return useContext(ProjectContext).setCurrentProjectId
}
