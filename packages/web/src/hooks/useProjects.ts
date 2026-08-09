import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '../lib/api'

// 查询键常量
export const projectKeys = {
  all: ['projects'] as const,
  detail: (id: string) => ['projects', id] as const,
}

/**
 * 获取项目列表
 */
export function useProjects() {
  return useQuery({
    queryKey: projectKeys.all,
    queryFn: () => projectsApi.list(),
  })
}

/**
 * 获取单个项目详情
 */
export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: projectKeys.detail(id || ''),
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
  })
}

/**
 * 创建项目
 */
export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { name: string; genre?: string; description?: string }) =>
      projectsApi.create(data),
    onSuccess: () => {
      // 创建成功后刷新列表
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

/**
 * 更新项目
 */
export function useUpdateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<any> }) =>
      projectsApi.update(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.id) })
    },
  })
}

/**
 * 删除项目
 */
export function useDeleteProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}
