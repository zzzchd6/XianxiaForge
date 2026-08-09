/**
 * API客户端封装
 * 基础地址: /api (通过Vite proxy转发到 http://localhost:3456)
 *
 * 重要：后端所有接口返回 {success, data} 信封格式，
 * 本模块在底层 request() 中统一解包，调用方直接拿到 data 内容。
 */

const BASE_URL = '/api'

/** 文件导入结果统计（14-SRS 四模块导入导出） */
export interface FileImportStats {
  imported: number
  skipped: number
  overwritten: number
  merged: number
  failed: number
  warnings: string[]
  errors: { name: string; error: string }[]
}

// 通用请求封装（自动解包 {success, data} 信封）
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`
  const config: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  }

  const response = await fetch(url, config)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    let msg = errorData.message || errorData.error || `请求失败: ${response.status}`
    // 附带 zod 校验细节，便于定位具体字段
    if (Array.isArray(errorData.details) && errorData.details.length) {
      const fieldErrors = errorData.details
        .slice(0, 3)
        .map((d: any) => `${(d.path || []).join('.') || '参数'}: ${d.message}`)
        .join('; ')
      msg = `${msg}（${fieldErrors}）`
    }
    throw new Error(msg)
  }

  // 处理204无内容响应
  if (response.status === 204) return undefined as T

  const json = await response.json()

  // 统一解包：后端返回 {success: true, data: ...} 信封格式
  // 有 data 字段时返回 data；若信封还携带其他顶层元数据（如 createdPlanCount/injectedCharacters），
  // 合并进 data（不覆盖 data 自身 key），调用方仍直接从结果读取
  if (json && typeof json === 'object' && 'success' in json) {
    const extras = Object.keys(json).filter((k) => k !== 'success' && k !== 'data')
    if (extras.length && Array.isArray(json.data)) {
      // 数组型 data（如 finalize 返回卷列表）：元数据以属性形式挂在数组上，不改变遍历语义
      for (const k of extras) (json.data as any)[k] = json[k]
      return json.data as T
    }
    if (extras.length && json.data && typeof json.data === 'object') {
      return { ...json.data, ...Object.fromEntries(extras.map((k) => [k, json[k]])) } as T
    }
    return json.data as T
  }
  return json as T
}

// GET请求
function get<T>(endpoint: string): Promise<T> {
  return request<T>(endpoint, { method: 'GET' })
}

// POST请求
function post<T>(endpoint: string, data?: unknown): Promise<T> {
  return request<T>(endpoint, {
    method: 'POST',
    body: data ? JSON.stringify(data) : undefined,
  })
}

// PUT请求
function put<T>(endpoint: string, data?: unknown): Promise<T> {
  return request<T>(endpoint, {
    method: 'PUT',
    body: data ? JSON.stringify(data) : undefined,
  })
}

// DELETE请求
function del<T>(endpoint: string): Promise<T> {
  return request<T>(endpoint, { method: 'DELETE' })
}

// PATCH请求
function patch<T>(endpoint: string, data?: unknown): Promise<T> {
  return request<T>(endpoint, {
    method: 'PATCH',
    body: data ? JSON.stringify(data) : undefined,
  })
}

// ============ 项目API ============
export const projectsApi = {
  list: () => get<any[]>('/projects'),
  get: (id: string) => get<any>(`/projects/${id}`),
  create: (data: { name: string; genre?: string; description?: string }) =>
    post<any>('/projects', { title: data.name, genre: data.genre, description: data.description }),
  update: (id: string, data: Partial<any>) => put<any>(`/projects/${id}`, data),
  delete: (id: string) => del<void>(`/projects/${id}`),
  // 创作统计（模块14 热力图）：按日聚合字数/章节数 + 连续创作天数
  creationStats: (id: string, days = 365) =>
    get<any>(`/projects/${id}/creation-stats?days=${days}`),
  // 方向分布统计（剧情方向体系）：volumeNo 可选，缺省=全量
  directionStats: (id: string, volumeNo?: number) =>
    get<any>(`/projects/${id}/direction-stats${volumeNo != null ? `?volumeNo=${volumeNo}` : ''}`),
  // 连续方向校验（剧情方向体系）
  directionCheck: (id: string, chapterNo: number) =>
    get<any>(`/projects/${id}/direction-check?chapterNo=${chapterNo}`),
  // ---- 架构升级 v1.3 ----
  // Epic2：手动触发后验更新工作流（chapterPlanId 缺省=最新已生成章节）
  postUpdate: (id: string, chapterPlanId?: number) =>
    post<any>(`/projects/${id}/post-update`, chapterPlanId != null ? { chapterPlanId } : {}),
  // Epic4：叙事债务聚合总览（三表逾期统计+健康度+回收建议）
  narrativeDebt: (id: string) => get<any>(`/projects/${id}/narrative-debt`),
  // Epic5：导出项目 zip（二进制下载，非 JSON 信封）
  exportZip: async (id: string, projectTitle?: string): Promise<void> => {
    const resp = await fetch(`${BASE_URL}/projects/${id}/export-package`)
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}))
      throw new Error(errData.error || `导出失败: ${resp.status}`)
    }
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectTitle || 'project'}-export.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
  // Epic5：导入项目 zip（multipart 上传，事务还原）
  importZip: async (file: File): Promise<any> => {
    const form = new FormData()
    form.append('file', file)
    const resp = await fetch(`${BASE_URL}/projects/import`, { method: 'POST', body: form })
    const json = await resp.json().catch(() => ({}))
    if (!resp.ok || json.success === false) {
      throw new Error(json.error || `导入失败: ${resp.status}`)
    }
    return json.data ?? json
  },
}

// ============ 叙事体检API ============
export const healthApi = {
  scoreTrend: (projectId: string) =>
    get<{ points: { chapterNo: number; title: string; score: number; createdAt: string }[] }>(
      `/projects/${projectId}/health/score-trend`
    ),
  // 全局待办中心聚合：超期伏笔 + 高优先级待处理 + 生成失败任务
  todo: (projectId: string) =>
    get<{
      overdueForeshadows: { id: number; title: string; plantChapter: number | null; chaptersOpen: number; tier: string }[]
      highPriorityPending: { id: number; title: string; priority: string }[]
      failedTasks: { id: number; chapterPlanId: number | null; error: string | null; createdAt: string | null }[]
      totalCount: number
    }>(`/projects/${projectId}/health/todo`),
}

// ============ 分支影响体系API ============
export const impactApi = {
  // 影响定义白名单（全局预设 + 项目自定义，含禁用项）
  listDefinitions: (projectId: string) => get<any[]>(`/projects/${projectId}/impact/definitions`),
  createDefinition: (projectId: string, data: any) => post<any>(`/projects/${projectId}/impact/definitions`, data),
  updateDefinition: (defId: number, data: any) => put<any>(`/impact/definitions/${defId}`, data),
  deleteDefinition: (defId: number) => del<void>(`/impact/definitions/${defId}`),
  // 影响状态查询（单一权威：最新已确认快照）
  characterState: (projectId: string, characterId: number, chapterNo?: number) =>
    get<any>(`/projects/${projectId}/impact/character-state?characterId=${characterId}${chapterNo != null ? `&chapterNo=${chapterNo}` : ''}`),
  worldState: (projectId: string, region?: string | null, chapterNo?: number) => {
    const params = new URLSearchParams();
    if (region) params.set('region', region);
    if (chapterNo != null) params.set('chapterNo', String(chapterNo));
    const qs = params.toString();
    return get<any>(`/projects/${projectId}/impact/world-state${qs ? `?${qs}` : ''}`);
  },
  // 分支选项影响链接明细（含隐藏项）
  links: (projectId: string, optionId: number) => get<any[]>(`/projects/${projectId}/impact/links/${optionId}`),
  // ⚡ 影响前后对比预览（不落库；chapterNo 缺省=来源章+1）
  preview: (projectId: string, optionId: number, chapterNo?: number) =>
    get<any[]>(`/projects/${projectId}/impact/branch-options/${optionId}/preview${chapterNo != null ? `?chapterNo=${chapterNo}` : ''}`),
  // 影响变更历史（倒序）
  history: (projectId: string, limit = 50) => get<any[]>(`/projects/${projectId}/impact/history?limit=${limit}`),
  // 候选影响对象人物（状态快照已出场人物，供项目设置选择默认影响对象）
  targetCandidates: (projectId: string) => get<any[]>(`/projects/${projectId}/impact/target-candidates`),
  // 方向→影响 自动映射建议（基准幅度，不落库）
  suggest: (projectId: string, directionCode: string, characterIds?: number[]) => {
    const params = new URLSearchParams({ directionCode });
    if (characterIds?.length) params.set('characterIds', characterIds.join(','));
    return get<any[]>(`/projects/${projectId}/impact/suggest?${params.toString()}`);
  },
  // 影响→方向 弱推荐（不强制）
  directionRecommend: (projectId: string, characterIds?: number[], chapterNo?: number) => {
    const params = new URLSearchParams();
    if (characterIds?.length) params.set('characterIds', characterIds.join(','));
    if (chapterNo != null) params.set('chapterNo', String(chapterNo));
    const qs = params.toString();
    return get<any[]>(`/projects/${projectId}/impact/direction-recommend${qs ? `?${qs}` : ''}`);
  },
  // 关系状态（阶段4）
  relationState: (projectId: string, charAId: number, charBId: number, chapterNo?: number) => {
    const params = new URLSearchParams({ charAId: String(charAId), charBId: String(charBId) });
    if (chapterNo != null) params.set('chapterNo', String(chapterNo));
    return get<any>(`/projects/${projectId}/impact/relation-state?${params.toString()}`);
  },
  relationContext: (projectId: string, characterIds: number[], chapterNo?: number) => {
    const params = new URLSearchParams({ characterIds: characterIds.join(',') });
    if (chapterNo != null) params.set('chapterNo', String(chapterNo));
    return get<any>(`/projects/${projectId}/impact/relation-context?${params.toString()}`);
  },
}

// ============ 因果链API（阶段4） ============
export const causalChainApi = {
  list: (projectId: string, opts?: { status?: string; upToChapter?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set('status', opts.status);
    if (opts?.upToChapter != null) params.set('upToChapter', String(opts.upToChapter));
    if (opts?.limit != null) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return get<any[]>(`/projects/${projectId}/causal-chains${qs ? `?${qs}` : ''}`);
  },
  get: (projectId: string, chainId: number) => get<any>(`/projects/${projectId}/causal-chains/${chainId}`),
  create: (projectId: string, data: any) => post<any>(`/projects/${projectId}/causal-chains`, data),
  updateStatus: (projectId: string, chainId: number, data: any) =>
    put<any>(`/projects/${projectId}/causal-chains/${chainId}/status`, data),
  expire: (projectId: string, currentChapter?: number) =>
    post<any>(`/projects/${projectId}/causal-chains/expire`, { currentChapter }),
  context: (projectId: string, chapterNo?: number) =>
    get<any>(`/projects/${projectId}/causal-chains/context${chapterNo != null ? `?chapterNo=${chapterNo}` : ''}`),
  stats: (projectId: string, chapterNo?: number) =>
    get<any>(`/projects/${projectId}/causal-chains/stats${chapterNo != null ? `?chapterNo=${chapterNo}` : ''}`),
}

// ============ 大纲API（模式归一化 PRD：one-shot 与 stepwise 统一入口） ============
export const outlinesApi = {
  list: (projectId: string) => get<any[]>(`/projects/${projectId}/outlines`),
  get: (projectId: string, id: string) => get<any>(`/projects/${projectId}/outlines/${id}`),
  create: (projectId: string, data: any) => post<any>(`/projects/${projectId}/outlines`, data),
  update: (projectId: string, id: string, data: any) => put<any>(`/projects/${projectId}/outlines/${id}`, data),
  delete: (projectId: string, id: string) => del<void>(`/projects/${projectId}/outlines/${id}`),
  /** 生成大纲：mode 缺省 one-shot；stepwise 必带 step(2|3|4|5) */
  generate: (projectId: string, data: any) => post<any>(`/projects/${projectId}/outlines/generate`, data),
  divine: (projectId: string, data: { direction?: string; count?: number }) =>
    post<any>(`/projects/${projectId}/outlines/divine`, data),
  /** 采纳推演结果为卷大纲（v1.5.1） */
  divineAdopt: (projectId: string, direction: any) =>
    post<any>(`/projects/${projectId}/outlines/divine/adopt`, { direction }),
  /** 读取分步草稿（续进；承接旧 snowflake_draft） */
  getStepwiseDraft: (projectId: string | number) => get<any>(`/projects/${projectId}/outlines/stepwise-draft`),
  /** 保存分步草稿（每步确认后） */
  saveStepwiseDraft: (projectId: string | number, draft: any) =>
    put<void>(`/projects/${projectId}/outlines/stepwise-draft`, draft),
  /** 分步完成后同构落库（story_outline + chapter_plan 含回标） */
  finalize: (projectId: string | number, data: any) =>
    post<any>(`/projects/${projectId}/outlines/finalize`, data),
}

// ============ 场景脚本API（原"场景小纲"） ============
export const scenesApi = {
  // 节点CRUD
  list: (projectId: string, outlineId: string) =>
    get<any[]>(`/projects/${projectId}/outlines/${outlineId}/scenes`),
  create: (projectId: string, outlineId: string, data: any) =>
    post<any>(`/projects/${projectId}/outlines/${outlineId}/scenes`, data),
  update: (projectId: string, outlineId: string, sceneId: string, data: any) =>
    put<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/${sceneId}`, data),
  delete: (projectId: string, outlineId: string, sceneId: string) =>
    del<void>(`/projects/${projectId}/outlines/${outlineId}/scenes/${sceneId}`),
  reorder: (projectId: string, outlineId: string, nodeIds: number[]) =>
    put<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/reorder`, { nodeIds }),

  // 人物关联
  addCharacter: (projectId: string, outlineId: string, sceneId: string, data: any) =>
    post<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/${sceneId}/characters`, data),
  updateCharacter: (projectId: string, outlineId: string, sceneId: string, assocId: string, data: any) =>
    put<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/${sceneId}/characters/${assocId}`, data),
  removeCharacter: (projectId: string, outlineId: string, sceneId: string, assocId: string) =>
    del<void>(`/projects/${projectId}/outlines/${outlineId}/scenes/${sceneId}/characters/${assocId}`),

  // 世界观要素关联
  addElement: (projectId: string, outlineId: string, sceneId: string, data: any) =>
    post<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/${sceneId}/elements`, data),
  updateElement: (projectId: string, outlineId: string, sceneId: string, assocId: string, data: any) =>
    put<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/${sceneId}/elements/${assocId}`, data),
  removeElement: (projectId: string, outlineId: string, sceneId: string, assocId: string) =>
    del<void>(`/projects/${projectId}/outlines/${outlineId}/scenes/${sceneId}/elements/${assocId}`),

  // 智能匹配素材（扫描节点文本，返回候选实体）
  matchMaterials: (projectId: string, outlineId: string, sceneId: string) =>
    post<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/${sceneId}/match-materials`),

  // 节点连线
  addRelation: (projectId: string, outlineId: string, sceneId: string, data: any) =>
    post<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/${sceneId}/relations`, data),
  removeRelation: (projectId: string, outlineId: string, sceneId: string, relationId: string) =>
    del<void>(`/projects/${projectId}/outlines/${outlineId}/scenes/${sceneId}/relations/${relationId}`),

  // 同步为章节计划（场景节点 → 章节计划）
  syncChapters: (projectId: string, outlineId: string, nodeIds?: number[], replaceExisting?: boolean) =>
    post<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/sync-chapters`, { nodeIds, replaceExisting }),

  // 从章节导入场景节点（章节计划/卷大纲章节 → 场景节点）
  importFromChapters: (projectId: string, outlineId: string, replace?: boolean) =>
    post<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/import-from-chapters`, { replace }),

  // 逻辑校验
  validate: (projectId: string, outlineId: string) =>
    post<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/validate`),

  // 导出
  export: (projectId: string, outlineId: string, format: 'json' | 'markdown' = 'markdown') =>
    get<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/export?format=${format}`),

  // 对话修改日志
  editLogs: (projectId: string, outlineId: string) =>
    get<any[]>(`/projects/${projectId}/outlines/${outlineId}/scenes/edit-logs`),
  rollback: (projectId: string, outlineId: string, logId: string) =>
    post<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/edit-logs/${logId}/rollback`),

  // AI生成场景
  generate: (projectId: string, outlineId: string, data?: { sceneCount?: number; guidance?: string }) =>
    post<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/generate`, data || {}),

  // AI对话修改
  chat: (projectId: string, outlineId: string, message: string) =>
    post<any>(`/projects/${projectId}/outlines/${outlineId}/scenes/chat`, { message }),
}

// ============ 章节API ============
export const chaptersApi = {
  list: (projectId: string) => get<any[]>(`/projects/${projectId}/chapters`),
  get: (projectId: string, id: string) => get<any>(`/projects/${projectId}/chapters/${id}`),
  create: (projectId: string, data: any) => post<any>(`/projects/${projectId}/chapters`, data),
  update: (projectId: string, id: string, data: any) => put<any>(`/projects/${projectId}/chapters/${id}`, data),
  delete: (projectId: string, id: string) => del<void>(`/projects/${projectId}/chapters/${id}`),
  getContent: (projectId: string, id: string) => get<any>(`/projects/${projectId}/chapters/${id}/content`),
  getVersions: (projectId: string, id: string) => get<any[]>(`/projects/${projectId}/chapters/${id}/versions`),
  // 对话式AI修订（返回修订结果，不自动保存）
  revise: (projectId: string, id: string, data: { instruction: string; selectedText?: string }) =>
    post<any>(`/projects/${projectId}/chapters/${id}/revise`, data),
  // 保存正文为新版本
  updateContent: (projectId: string, id: string, content: string) =>
    put<any>(`/projects/${projectId}/chapters/${id}/content`, { content }),
  // Epic3：独立润色（不推进剧情；返回 originalText/polishedText/diff/auditScore）
  polish: (projectId: string, id: string, level: 'light' | 'medium' | 'deep') =>
    post<any>(`/projects/${projectId}/chapters/${id}/polish`, { level }),
  // ---- 交互式剧情抉择（需求12：章间分支） ----
  // 获取某章已产出的分支选项（附带后续发展推演 prediction；支持 direction/category 方向筛选）
  getBranchOptions: (projectId: string, id: string, directionFilter?: { direction?: string; category?: string }) => {
    const qs = new URLSearchParams();
    if (directionFilter?.direction) qs.set('direction', directionFilter.direction);
    if (directionFilter?.category) qs.set('category', directionFilter.category);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return get<{ options: any[]; prediction: string | null }>(`/projects/${projectId}/chapters/${id}/branch-options${suffix}`);
  },
  // 基于当前正文手动产出/刷新分支选项（返回选项+推演）；body 可传定向生成约束 targetDirections/enabledCategories
  generateBranches: (projectId: string, id: string, body?: { targetDirections?: { main?: string; secondary?: string[] }; enabledCategories?: string[] }) =>
    post<{ options: any[]; prediction: string | null }>(`/projects/${projectId}/chapters/${id}/generate-branches`, body ?? {}),
  // 选定走向并衍生下一章计划（覆盖式重选）
  selectBranch: (projectId: string, id: string, optionId: string | number) =>
    post<any>(`/projects/${projectId}/chapters/${id}/select-branch/${optionId}`),
  // ---- 章节文风校验（需求13） ----
  // 触发章节文风校验并入库，返回校验记录
  auditStyle: (projectId: string, id: string) =>
    post<any>(`/projects/${projectId}/chapters/${id}/audit-style`),
  // 历史校验记录列表
  getStyleAudits: (projectId: string, id: string) =>
    get<any[]>(`/projects/${projectId}/chapters/${id}/style-audits`),
  // 单条校验记录详情
  getStyleAuditDetail: (projectId: string, id: string, aid: string | number) =>
    get<any>(`/projects/${projectId}/chapters/${id}/style-audits/${aid}`),
  // 基于校验结果一键修订（返回预览，不自动保存）；ignoredIndices 跳过被忽略的问题
  reviseStyleAudit: (projectId: string, id: string, aid: string | number, ignoredIndices?: number[]) =>
    post<any>(`/projects/${projectId}/chapters/${id}/style-audits/${aid}/revise`, { ignoredIndices: ignoredIndices ?? [] }),
  // 修复单条审计问题（质量/文风），返回预览不自动保存
  fixIssue: (projectId: string, id: string, data: { auditType: 'quality' | 'style'; issue: any }) =>
    post<any>(`/projects/${projectId}/chapters/${id}/fix-issue`, data),
  // 质量审计一键修复（优先 critical/major，没有时降级修 minor；跳过 ignoredIndices），返回预览不自动保存
  fixAllQuality: (projectId: string, id: string, data: { issues: any[]; ignoredIndices?: number[] }) =>
    post<any>(`/projects/${projectId}/chapters/${id}/fix-all-quality`, data),
  // ---- 单场景视角切换（模块6） ----
  rewritePerspective: (projectId: string, id: string, data: { selectedText: string; targetCharacterName: string; targetCharacterId?: number }) =>
    post<any>(`/projects/${projectId}/chapters/${id}/rewrite-perspective`, data),
  // ---- 29维质量审计（手动触发） ----
  auditQuality: (chapterPlanId: number) =>
    post<any>(`/chapters/${chapterPlanId}/audit-quality`, {}),
  // ---- 人物出场章节查询 ----
  byEntity: (projectId: string, entityId: number, entityType = 'character') =>
    get<any[]>(`/projects/${projectId}/chapters/by-entity?entityId=${entityId}&entityType=${entityType}`),
}

// ============ 剧情素材API（二期RAG人工干预） ============
export const plotMaterialsApi = {
  /** 浏览/搜索剧情素材（奇遇/伏笔/高光/任务链），供章节计划手动固定 */
  list: (projectId: string, opts?: { type?: string; keyword?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.type) params.set('type', opts.type);
    if (opts?.keyword) params.set('keyword', opts.keyword);
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return get<any[]>(`/projects/${projectId}/plot-materials${qs ? `?${qs}` : ''}`);
  },
}

// ============ 素材收藏API（改造7.2：素材选择器收藏开关） ============
export const materialsApi = {
  /** 切换剧情素材收藏状态（table 传素材对象里的实际 table 值，如 plot_material_encounter 或 encounter） */
  collect: (table: string, id: number, collected: boolean) =>
    post<{ id: number; collected: boolean }>('/materials/collect', { table, id, collected }),
}

// ============ 生成API ============
export const generationApi = {
  // 启动生成任务
  start: (data: {
    projectId: string
    chapterPlanId: string
    targetWords?: number
    temperature?: number
    autoRevise?: boolean
    stylePreset?: string
    skipAudit?: boolean
    forceContinue?: boolean
    llmConfig?: { maxTokens?: number }
  }) => post<any>('/generation/start', data),

  // 获取SSE流地址（用于EventSource）
  streamUrl: (taskId: string) => `${BASE_URL}/generation/stream/${taskId}`,

  // 取消生成任务
  cancel: (taskId: string) => post<void>(`/generation/cancel/${taskId}`),

  // 获取任务列表
  tasks: (projectId?: string) =>
    get<any[]>(projectId ? `/generation/tasks?projectId=${projectId}` : '/generation/tasks'),

  // 获取单个任务状态
  task: (taskId: string) => get<any>(`/generation/tasks/${taskId}`),

  // 批量入队
  batch: (data: {
    chapterPlanIds: number[]
    skipAudit?: boolean
    skipRevision?: boolean
    maxRetries?: number
    forceContinue?: boolean
  }) => post<any>('/generation/batch', data),

  // 队列状态
  queue: () => get<any>('/generation/queue'),

  // ---- 架构升级 v1.3 Epic1：管线断点续跑 ----
  // 任务步骤 checkpoint 列表（主管线5步 + 后验10步状态）
  checkpoints: (taskId: string) => get<any>(`/generation/tasks/${taskId}/checkpoints`),
  // 从失败/指定步骤重试入队（fromStep 缺省=首个未完成步骤）
  retry: (taskId: string, fromStep?: string) =>
    post<any>(`/generation/tasks/${taskId}/retry`, fromStep ? { fromStep } : {}),
  // 跳过首个失败/运行中步骤，从下一步继续
  skipStep: (taskId: string) => post<any>(`/generation/tasks/${taskId}/skip-step`),
}

// ============ 毒句式欠账门API（开源借鉴 PRD v1.1 M1） ============
export const debtGateApi = {
  /** 预览上一章 blocking 欠账清单 */
  check: (projectId: string | number, chapterPlanId: string | number) =>
    get<any>(`/projects/${projectId}/debt-gate/check?chapterPlanId=${chapterPlanId}`),
  /** 白名单列表 */
  listWhitelist: (projectId: string | number) =>
    get<any[]>(`/projects/${projectId}/deslop-whitelist`),
  /** 新增白名单 */
  addWhitelist: (projectId: string | number, pattern: string, reason?: string) =>
    post<any>(`/projects/${projectId}/deslop-whitelist`, { pattern, reason }),
  /** 删除白名单 */
  removeWhitelist: (projectId: string | number, id: number) =>
    del<void>(`/projects/${projectId}/deslop-whitelist/${id}`),
}

// ============ 对标素材/拆文API（开源借鉴 PRD v1.1 M5） ============
export const BENCHMARK_TYPE_LABELS: Record<string, string> = {
  character: '角色卡',
  plot_unit: '剧情单元',
  style: '文风分析',
  setting: '设定',
}

export const benchmarkApi = {
  /** 素材列表（pinned 优先） */
  list: (projectId: string | number) =>
    get<any[]>(`/projects/${projectId}/benchmark-materials`),
  /** 手动添加单条素材 */
  add: (
    projectId: string | number,
    data: { sourceBookTitle: string; materialType: string; title: string; contentMd: string; tags?: string[]; pinned?: boolean },
  ) => post<any>(`/projects/${projectId}/benchmark-materials`, data),
  /** 软删除素材 */
  remove: (projectId: string | number, id: number) =>
    del<void>(`/projects/${projectId}/benchmark-materials/${id}`),
  /** 置顶/取消置顶 */
  togglePin: (projectId: string | number, id: number, pinned: boolean) =>
    patch<any>(`/projects/${projectId}/benchmark-materials/${id}/pin`, { pinned }),
  /** 拆文 agent：LLM 拆解对标书文本并批量入库 */
  analyze: (projectId: string | number, sourceBookTitle: string, text: string) =>
    post<{ analyzed: number; inserted: { id: number; title: string; materialType: string }[] }>(
      `/projects/${projectId}/benchmark/analyze`,
      { sourceBookTitle, text },
    ),
  /**
   * 整本拆文：上传 TXT 文件 → SSE 流式返回进度
   * 返回 { response, taskId }：response 是 SSE ReadableStream，taskId 从响应头 X-Task-Id 读取
   */
  analyzeBook: async (
    projectId: string | number,
    file: File,
    sourceBookTitle: string,
    maxChapters: number = 5,
  ): Promise<{ response: Response; taskId: number | null }> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('sourceBookTitle', sourceBookTitle)
    formData.append('maxChapters', String(maxChapters))

    const response = await fetch(`/api/projects/${projectId}/benchmark/analyze-book`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error || `上传失败: ${response.status}`)
    }

    const taskId = response.headers.get('X-Task-Id')
    return { response, taskId: taskId ? Number(taskId) : null }
  },
}

// ============ 世界观API（诛仙库） ============
export const worldApi = {
  // 书籍列表（book_id 隔离，用于切换书籍）
  books: () => get<any[]>('/world/books'),
  // 书籍管理（system 书后端禁改禁删）
  createBook: (data: { bookName: string; author?: string; description?: string; coverUrl?: string }) =>
    post<any>('/world/books', data),
  updateBook: (id: number, data: { bookName?: string; author?: string; description?: string; coverUrl?: string }) =>
    put<any>(`/world/books/${id}`, data),
  deleteBook: (id: number) => del<any>(`/world/books/${id}`),

  // 跨书批量引入（复制式，target 须为 user 书）
  importSources: (bookId: number) =>
    get<any>(`/world/import/sources?bookId=${bookId}`),
  importEntities: (data: {
    sourceBookId: number
    targetBookId: number
    types: string[]
    entityIds?: Record<string, number[]>
    skipDuplicates?: boolean
  }) => post<any>('/world/import', data),

  // 文本批量抽取入库（LLM 结构化抽取 → 预览 → 确认）
  extractEntities: (data: { bookId: number; text: string; types: string[]; projectId?: number }) =>
    post<any>('/world/batch-import/extract', data),
  batchImportTask: (id: number) => get<any>(`/world/batch-import/${id}`),
  confirmBatchImport: (id: number, data: { result?: Record<string, any[]>; skipDuplicates?: boolean }) =>
    post<any>(`/world/batch-import/${id}/confirm`, data),

  // 人物
  characters: (params?: { keyword?: string; faction?: string; bookId?: number }) => {
    const query = new URLSearchParams(params as any).toString()
    return get<any>(`/world/characters${query ? `?${query}` : ''}`)
  },
  character: (id: string) => get<any>(`/world/characters/${id}`),

  // 关系图谱
  graph: (bookId: number) => get<any>(`/world/graph?bookId=${bookId}`),

  // 门派
  factions: (params?: { keyword?: string }) => {
    const query = new URLSearchParams(params as any).toString()
    return get<any>(`/world/factions${query ? `?${query}` : ''}`)
  },
  faction: (id: string) => get<any>(`/world/factions/${id}`),

  // 地点
  locations: (params?: { keyword?: string; bookId?: number }) => {
    const query = new URLSearchParams(params as any).toString()
    return get<any>(`/world/locations${query ? `?${query}` : ''}`)
  },
  location: (id: string) => get<any>(`/world/locations/${id}`),

  // 功法
  skills: (params?: { keyword?: string; bookId?: number }) => {
    const query = new URLSearchParams(params as any).toString()
    return get<any>(`/world/skills${query ? `?${query}` : ''}`)
  },
  skill: (id: string) => get<any>(`/world/skills/${id}`),

  // 法宝
  items: (params?: { keyword?: string; bookId?: number }) => {
    const query = new URLSearchParams(params as any).toString()
    return get<any>(`/world/items${query ? `?${query}` : ''}`)
  },
  item: (id: string) => get<any>(`/world/items/${id}`),

  // 妖兽
  monsters: (params?: { keyword?: string; bookId?: number }) => {
    const query = new URLSearchParams(params as any).toString()
    return get<any>(`/world/monsters${query ? `?${query}` : ''}`)
  },
  monster: (id: string) => get<any>(`/world/monsters/${id}`),

  // 丹药灵材毒物
  materials: (params?: { keyword?: string; itemType?: string; bookId?: number }) => {
    const query = new URLSearchParams(params as any).toString()
    return get<any>(`/world/materials${query ? `?${query}` : ''}`)
  },

  // 日常物品与信物
  dailyItems: (params?: { keyword?: string; itemType?: string; bookId?: number }) => {
    const query = new URLSearchParams(params as any).toString()
    return get<any>(`/world/daily-items${query ? `?${query}` : ''}`)
  },

  // 宗门规制
  factionRules: (params?: { keyword?: string; ruleType?: string }) => {
    const query = new URLSearchParams(params as any).toString()
    return get<any>(`/world/faction-rules${query ? `?${query}` : ''}`)
  },

  // 岁时节令与宗门事件
  seasonEvents: (params?: { keyword?: string; eventType?: string }) => {
    const query = new URLSearchParams(params as any).toString()
    return get<any>(`/world/season-events${query ? `?${query}` : ''}`)
  },

  // 文风引擎（全局配置 + 场景映射）
  style: (bookId: number | string = 1) => get<any>(`/world/style?bookId=${bookId}`),
  // 文风引擎跨书克隆（整套配置+场景映射，目标已有则跳过）
  importStyle: (data: { sourceBookId: number; targetBookId: number }) =>
    post<any>('/world/style/import', data),

  // 人物蒸馏（心智模型/决策启发式/人生阶段）
  characterDistill: (id: string) => get<any>(`/world/characters/${id}/distill`),

  // 功法蒸馏（属性/招式/关系/归档）
  skillDistill: (id: string) => get<any>(`/world/skills/${id}/distill`),

  // 世界观数据总览
  stats: (bookId: number | string = 1) => get<any>(`/world/stats?bookId=${bookId}`),

  // 全局搜索
  search: (keyword: string) => get<any>(`/world/search?keyword=${encodeURIComponent(keyword)}`),

  // ---- CRUD（新增/修改/软删除） ----
  create: (collection: string, data: Record<string, any>) =>
    post<any>(`/world/${collection}`, data),
  update: (collection: string, id: number, data: Record<string, any>) =>
    put<any>(`/world/${collection}/${id}`, data),
  remove: (collection: string, id: number) =>
    del<any>(`/world/${collection}/${id}`),
}

// ============ 设置API ============
export const settingsApi = {
  get: () => get<any>('/settings'),
  update: (data: any) => put<any>('/settings', data),
  testLlm: (data: { baseUrl: string; apiKey: string; model: string }) =>
    post<any>('/settings/test-llm', data),
  dbStatus: () => get<any>('/settings/db-status'),
  // 模块7：文风预设列表
  getStylePresets: () => get<any[]>('/settings/style-presets'),
  // 剧情方向体系：全局方向字典（9大类+细分方向）
  directionCatalog: () => get<{ categories: any[]; directions: any[] }>('/settings/direction-catalog'),
}

// ============ 用量统计API（开源借鉴 PRD v1.1 M3 / US-10） ============
export const usageApi = {
  /** 用量汇总：按日趋势/按角色拆分/成本估算 */
  summary: (params?: { projectId?: string | number; days?: number }) => {
    const q = new URLSearchParams()
    if (params?.projectId) q.set('projectId', String(params.projectId))
    if (params?.days) q.set('days', String(params.days))
    const qs = q.toString()
    return get<any>(`/usage/summary${qs ? `?${qs}` : ''}`)
  },
}

// ============ 伏笔台账API ============
export const foreshadowApi = {
  // 列表（可按状态/来源/仅超期过滤；返回数组，每项含计算后的 overdue/chaptersOpen 字段）
  list: (projectId: string, params?: { status?: string; sourceType?: string; overdueOnly?: boolean; threshold?: number }) => {
    const query = new URLSearchParams()
    if (params?.status) query.set('status', params.status)
    if (params?.sourceType) query.set('sourceType', params.sourceType)
    if (params?.overdueOnly) query.set('overdueOnly', 'true')
    if (params?.threshold) query.set('threshold', String(params.threshold))
    const qs = query.toString()
    return get<any[]>(`/projects/${projectId}/foreshadow${qs ? `?${qs}` : ''}`)
  },
  // 超期未回收提醒
  overdue: (projectId: string, threshold?: number) =>
    get<any[]>(`/projects/${projectId}/foreshadow/overdue${threshold ? `?threshold=${threshold}` : ''}`),
  // 草蛇灰线·伏笔健康检测（纯规则零LLM，返回问题清单）
  detection: (projectId: string) =>
    get<{ issues: any[]; scannedCount: number; currentChapter: number }>(`/projects/${projectId}/foreshadow/detection`),
  // 创建伏笔线
  create: (projectId: string, data: any) => post<any>(`/projects/${projectId}/foreshadow`, data),
  // 从场景节点 foreshadowing_note 提升为伏笔线
  promote: (projectId: string, data: { sceneNodeId: number; title?: string; plantChapter?: number; priority?: string }) =>
    post<any>(`/projects/${projectId}/foreshadow/promote`, data),
  // 更新（含状态流转/场景关联/回收章）
  update: (id: string, data: any) => put<any>(`/foreshadow/${id}`, data),
  // 推荐可绑定的伏笔手法素材（A2，语义召回 plot_material_foreshadow）
  suggestTechniques: (id: string, topN?: number) =>
    get<any[]>(`/foreshadow/${id}/suggest-techniques${topN ? `?topN=${topN}` : ''}`),
  // 分支衍生伏笔：推荐埋设章节（纯规则零LLM）
  suggestPlantChapters: (id: string) =>
    get<{ suggestions: any[]; upperBound: number; resolveChapter: number; tier: string }>(`/foreshadow/${id}/suggest-plant-chapters`),
  // 分支衍生伏笔：确认（is_confirmed=false → true）
  confirm: (id: string) => post<any>(`/foreshadow/${id}/confirm`),
  // 分支衍生伏笔：锚点回填（追加到待生成章节的 must_have_events）
  backfillAnchor: (id: string, chapterPlanId: number) =>
    post<any>(`/foreshadow/${id}/backfill-anchor`, { chapterPlanId }),
  // 分支衍生伏笔：修订回填（对已生成章节调用 Reviser，仅预览不落库）
  backfillRevise: (id: string, chapterId: number, intensity: 'light' | 'medium' | 'strong') =>
    post<any>(`/foreshadow/${id}/backfill-revise`, { chapterId, intensity }),
  // 分支衍生伏笔：标记已埋设（修订回填确认后）
  markPlanted: (id: string, data?: { backfillMethod?: string; backfillTargetChapterId?: number; plantChapter?: number }) =>
    post<any>(`/foreshadow/${id}/mark-planted`, data || {}),
  // 删除
  delete: (id: string) => del<void>(`/foreshadow/${id}`),
}

// ============ 任务链台账API（task_arc） ============
export const taskArcApi = {
  // 列表（可按状态过滤；解包后返回任务数组，状态统计由前端聚合）
  list: (projectId: string, status?: string) => {
    const query = new URLSearchParams()
    if (status) query.set('status', status)
    const qs = query.toString()
    return get<any[]>(`/projects/${projectId}/tasks${qs ? `?${qs}` : ''}`)
  },
  // 创建任务
  create: (projectId: string, data: any) => post<any>(`/projects/${projectId}/tasks`, data),
  // 更新（部分字段，含状态手动流转）
  update: (projectId: string, taskId: number, data: any) =>
    put<any>(`/projects/${projectId}/tasks/${taskId}`, data),
  // 删除（硬删）
  remove: (projectId: string, taskId: number) =>
    del<void>(`/projects/${projectId}/tasks/${taskId}`),
  // 确认生效
  confirm: (projectId: string, taskId: number) =>
    post<any>(`/projects/${projectId}/tasks/${taskId}/confirm`),
}

// ============ 动态叙事引擎API（12-SRS：叙事里程碑 + 分支弧 + 汇合引擎） ============
export const narrativeApi = {
  // ---- 叙事里程碑 ----
  milestones: (projectId: string) =>
    get<any[]>(`/projects/${projectId}/narrative/milestones`),
  extractMilestones: (projectId: string, outlineId?: number) =>
    post<any>(`/projects/${projectId}/narrative/milestones/extract`, outlineId ? { outlineId } : {}),
  createMilestone: (projectId: string, data: any) =>
    post<any>(`/projects/${projectId}/narrative/milestones`, data),
  updateMilestone: (projectId: string, mid: number, data: any) =>
    put<any>(`/projects/${projectId}/narrative/milestones/${mid}`, data),
  deleteMilestone: (projectId: string, mid: number) =>
    del<void>(`/projects/${projectId}/narrative/milestones/${mid}`),
  reorderMilestones: (projectId: string, orderedIds: number[]) =>
    post<any>(`/projects/${projectId}/narrative/milestones/reorder`, { orderedIds }),
  // ---- 分支弧 ----
  arcs: (projectId: string) =>
    get<any[]>(`/projects/${projectId}/narrative/arcs`),
  arc: (projectId: string, arcId: number) =>
    get<any>(`/projects/${projectId}/narrative/arcs/${arcId}`),
  converge: (projectId: string, arcId: number) =>
    post<any>(`/projects/${projectId}/narrative/arcs/${arcId}/converge`),
  extend: (projectId: string, arcId: number) =>
    post<any>(`/projects/${projectId}/narrative/arcs/${arcId}/extend`),
  abandon: (projectId: string, arcId: number) =>
    post<any>(`/projects/${projectId}/narrative/arcs/${arcId}/abandon`),
  promote: (projectId: string, arcId: number, data: { kind: string; ref: any }) =>
    post<any>(`/projects/${projectId}/narrative/arcs/${arcId}/promote`, data),
  rewriteLogs: (projectId: string, arcId: number) =>
    get<any[]>(`/projects/${projectId}/narrative/arcs/${arcId}/rewrite-logs`),
  rollback: (projectId: string, arcId: number) =>
    post<any>(`/projects/${projectId}/narrative/arcs/${arcId}/rollback`),
}

// ============ 状态追踪API（人物状态快照 + 剧情时间线，模块12） ============
export const stateApi = {
  // ---- 剧情时间线里程碑 ----
  timeline: (projectId: string, status?: string, branchAware: boolean = true) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (!branchAware) params.set('branchAware', 'false');
    const qs = params.toString();
    return get<{ milestones: any[]; branchPath: number[] }>(`/projects/${projectId}/state/timeline${qs ? `?${qs}` : ''}`);
  },
  createTimeline: (projectId: string, data: any) =>
    post<any>(`/projects/${projectId}/state/timeline`, data),
  updateTimeline: (id: string | number, data: any) =>
    put<any>(`/state/timeline/${id}`, data),
  confirmTimeline: (id: string | number) =>
    post<any>(`/state/timeline/${id}/confirm`),
  // 否决自动生效的抽取里程碑（v1.4 第三期）
  rejectTimeline: (id: string | number) =>
    post<any>(`/state/timeline/${id}/reject`),
  // ---- 人物状态快照 ----
  snapshots: (projectId: string, status?: string) =>
    get<any[]>(`/projects/${projectId}/state/snapshots${status ? `?status=${status}` : ''}`),
  createSnapshot: (projectId: string, data: any) =>
    post<any>(`/projects/${projectId}/state/snapshots`, data),
  updateSnapshot: (id: string | number, data: any) =>
    put<any>(`/state/snapshots/${id}`, data),
  confirmSnapshot: (id: string | number) =>
    post<any>(`/state/snapshots/${id}/confirm`),
  // 否决自动生效的抽取快照（v1.4 第三期）
  rejectSnapshot: (id: string | number) =>
    post<any>(`/state/snapshots/${id}/reject`),
  // ---- 引导初始化 / LLM抽取 ----
  bootstrap: (projectId: string, characterIds?: number[]) =>
    post<any>(`/projects/${projectId}/state/bootstrap`, { characterIds }),
  extract: (projectId: string, chapterNo: number) =>
    post<any>(`/projects/${projectId}/state/extract`, { chapterNo }),
}

// ============ 角色心智API（v1.4 PRD-A：声音配置 + 已知信息清单 + 记忆卡） ============
export const characterAspectsApi = {
  // ---- 角色声音配置（每人物一条，upsert） ----
  listVoices: (projectId: string, characterId?: number) =>
    get<any[]>(`/projects/${projectId}/voice-configs${characterId !== undefined ? `?characterId=${characterId}` : ''}`),
  upsertVoice: (projectId: string, characterId: number, data: any) =>
    put<any>(`/projects/${projectId}/characters/${characterId}/voice`, data),
  deleteVoice: (projectId: string, id: string | number) =>
    del<any>(`/projects/${projectId}/voice-configs/${id}`),
  // ---- 角色已知信息清单 ----
  listKnowledge: (projectId: string, characterId?: number) =>
    get<any[]>(`/projects/${projectId}/knowledge${characterId !== undefined ? `?characterId=${characterId}` : ''}`),
  createKnowledge: (projectId: string, data: any) =>
    post<any>(`/projects/${projectId}/knowledge`, data),
  updateKnowledge: (projectId: string, id: string | number, data: any) =>
    put<any>(`/projects/${projectId}/knowledge/${id}`, data),
  deleteKnowledge: (projectId: string, id: string | number) =>
    del<any>(`/projects/${projectId}/knowledge/${id}`),
  // 已回收伏笔 → 人物已知信息转化（伏笔回收联动）
  knowledgeFromForeshadow: (projectId: string, data: { foreshadowId: number; characterIds: number[]; acquiredChapter?: number }) =>
    post<any>(`/projects/${projectId}/knowledge/from-foreshadow`, data),
  // ---- 角色记忆卡 ----
  listMemoryCards: (projectId: string, characterId?: number) =>
    get<any[]>(`/projects/${projectId}/memory-cards${characterId !== undefined ? `?characterId=${characterId}` : ''}`),
  createMemoryCard: (projectId: string, data: any) =>
    post<any>(`/projects/${projectId}/memory-cards`, data),
  updateMemoryCard: (projectId: string, id: string | number, data: any) =>
    put<any>(`/projects/${projectId}/memory-cards/${id}`, data),
  deleteMemoryCard: (projectId: string, id: string | number) =>
    del<any>(`/projects/${projectId}/memory-cards/${id}`),
}

// ============ 人物成长弧光卡点API（模块3） ============
export const growthApi = {
  // 列表（可按人物过滤）
  list: (projectId: string, characterId?: number) =>
    get<any[]>(`/projects/${projectId}/growth-stages${characterId ? `?characterId=${characterId}` : ''}`),
  // 创建成长阶段
  create: (projectId: string, data: any) => post<any>(`/projects/${projectId}/growth-stages`, data),
  // 更新成长阶段
  update: (id: string | number, data: any) => put<any>(`/growth-stages/${id}`, data),
  // 删除成长阶段
  delete: (id: string | number) => del<void>(`/growth-stages/${id}`),
}

// ============ 人物关系动态推演API（模块8） ============
export const relationApi = {
  // 列表（项目自定义关系）
  list: (projectId: string) => get<any[]>(`/projects/${projectId}/relations`),
  // 关系推演（LLM生成3种走向）
  infer: (projectId: string, data: { charAId: number; charBId: number; charAName?: string; charBName?: string; event: string }) =>
    post<any>(`/projects/${projectId}/relations/infer`, data),
  // 确认创建关系
  create: (projectId: string, data: any) => post<any>(`/projects/${projectId}/relations`, data),
  // 更新关系
  update: (id: string | number, data: any) => put<any>(`/relations/${id}`, data),
  // 删除关系
  delete: (id: string | number) => del<void>(`/relations/${id}`),
}

// ============ 名场面+金句素材库API（模块11） ============
export const quotesApi = {
  // 列表（可按章节/人物/收藏/来源/分级/美化状态过滤）
  list: (projectId: string, params?: { chapterId?: number; characterName?: string; collected?: boolean; sourceType?: string; grade?: string; polishStatus?: string }) => {
    const query = new URLSearchParams()
    if (params?.chapterId) query.set('chapterId', String(params.chapterId))
    if (params?.characterName) query.set('characterName', params.characterName)
    if (params?.collected) query.set('collected', 'true')
    if (params?.sourceType) query.set('sourceType', params.sourceType)
    if (params?.grade) query.set('grade', params.grade)
    if (params?.polishStatus) query.set('polishStatus', params.polishStatus)
    const qs = query.toString()
    return get<any[]>(`/projects/${projectId}/quotes${qs ? `?${qs}` : ''}`)
  },
  // 手动创建金句
  create: (projectId: string, data: any) => post<any>(`/projects/${projectId}/quotes`, data),
  // 更新（收藏/取消收藏）
  update: (id: string | number, data: any) => put<any>(`/quotes/${id}`, data),
  // 删除
  delete: (id: string | number) => del<void>(`/quotes/${id}`),
  // 批量导入·LLM预筛粘贴文本（返回候选，不入库）
  importPreview: (projectId: string, text: string) =>
    post<any[]>(`/projects/${projectId}/quotes/import-preview`, { text }),
  // 批量导入·审阅后的金句入库（source_type=import）
  import: (projectId: string, quotes: any[]) =>
    post<any>(`/projects/${projectId}/quotes/import`, { quotes }),
  // 需求11：打磨任意句子（先评分判价值，有价值生成3版本，不入库）
  polishText: (projectId: string, text: string) =>
    post<any>(`/projects/${projectId}/quotes/polish-text`, { text }),
  // 对已入库金句（重新）美化，保存3版本
  polish: (id: string | number) => post<any>(`/quotes/${id}/polish`, {}),
  // 重新评分（更新分数与分级）
  rescore: (id: string | number) => post<any>(`/quotes/${id}/rescore`, {}),
  // 回写正文·diff预览
  applyPreview: (id: string | number, version: string) =>
    post<any>(`/quotes/${id}/apply-preview`, { version }),
  // 回写正文·确认替换
  apply: (id: string | number, version: string) =>
    post<any>(`/quotes/${id}/apply`, { version }),
}

// ============ 功法/法宝成长工坊API（模块9） ============
export const workshopApi = {
  // 实体列表
  list: (projectId: string, type: 'skill' | 'magic_item') =>
    get<any[]>(`/projects/${projectId}/workshop?type=${type}`),
  // 创建基础实体
  create: (projectId: string, data: any) => post<any>(`/projects/${projectId}/workshop`, data),
  // 实体详情（含成长信息）
  detail: (projectId: string, entityType: string, entityId: number) =>
    get<any>(`/projects/${projectId}/workshop/${entityType}/${entityId}`),
  // 融合
  fusion: (projectId: string, data: { entityType: string; entityAId: number; entityBId: number }) =>
    post<any>(`/projects/${projectId}/workshop/fusion`, data),
  // 变异
  mutation: (projectId: string, data: { entityType: string; entityId: number }) =>
    post<any>(`/projects/${projectId}/workshop/mutation`, data),
  // 强化
  upgrade: (projectId: string, data: { entityType: string; entityId: number }) =>
    post<any>(`/projects/${projectId}/workshop/upgrade`, data),
  // 进化
  evolution: (projectId: string, data: { entityType: string; entityId: number }) =>
    post<any>(`/projects/${projectId}/workshop/evolution`, data),
  // 确认预览结果入库
  confirm: (projectId: string, data: { entityType: string; entity: any; linkedCharacterIds?: number[]; breakthroughNarrative?: string }) =>
    post<any>(`/projects/${projectId}/workshop/confirm`, data),
  // 融合树（成长路径可视化）
  tree: (projectId: string, entityType: string, entityId: number) =>
    get<any>(`/projects/${projectId}/workshop/tree?entityType=${entityType}&entityId=${entityId}`),
  // 成长历史
  history: (projectId: string, entityType?: string, entityId?: number) => {
    const query = new URLSearchParams()
    if (entityType) query.set('entityType', entityType)
    if (entityId) query.set('entityId', String(entityId))
    const qs = query.toString()
    return get<any[]>(`/projects/${projectId}/workshop/history${qs ? `?${qs}` : ''}`)
  },
  // 回退
  revert: (projectId: string, recordId: number) =>
    post<any>(`/projects/${projectId}/workshop/revert/${recordId}`, {}),
  // 更新实体
  update: (projectId: string, entityType: string, entityId: number, data: any) =>
    put<any>(`/projects/${projectId}/workshop/${entityType}/${entityId}`, data),
  // 删除实体
  delete: (projectId: string, entityType: string, entityId: number) =>
    del<void>(`/projects/${projectId}/workshop/${entityType}/${entityId}`),
}

// ============ 自定义人物API（自定义人物模块，对外负数ID） ============
export const customCharacterApi = {
  // 列表（本项目自定义人物，软删除过滤）
  list: (projectId: string) => get<any[]>(`/projects/${projectId}/custom-characters`),
  // 详情（id 为负数ID）
  get: (projectId: string, id: number) => get<any>(`/projects/${projectId}/custom-characters/${id}`),
  // 章节动态采纳到正式小传（09-自动维护 US-3）
  adoptUpdate: (projectId: string, id: number, index: number) =>
    post<any>(`/projects/${projectId}/custom-characters/${id}/adopt-update`, { index }),
  // 章节动态忽略（09-自动维护 US-3）
  dismissUpdate: (projectId: string, id: number, index: number) =>
    post<any>(`/projects/${projectId}/custom-characters/${id}/dismiss-update`, { index }),
  // 整卡随机（大骰子/局部骰子；locks 锁定项不变；talentCategory 指定时为分类骰子）
  random: (projectId: string, data?: { locks?: Record<string, boolean>; current?: any; talentCategory?: string; excludeTalents?: string[] }) =>
    post<any>(`/projects/${projectId}/custom-characters/random`, data ?? {}),
  // 随机姓名（姓名小骰子，gender 缺省后端随机；position/stance 可选，名字风格轻度倾斜）
  randomName: (projectId: string, data: { raceCategory: string; raceSub: string; gender?: string; position?: string; stance?: number }) =>
    post<{ name: string; gender: string }>(`/projects/${projectId}/custom-characters/random-name`, data),
  // AI精取名（LLM出5候选，失败回落本地生成，source标记来源）
  aiName: (projectId: string, data: { raceCategory: string; raceSub: string; gender?: string; position?: string; stance?: number }) =>
    post<{ names: string[]; gender: string; source: 'ai' | 'local' }>(`/projects/${projectId}/custom-characters/ai-name`, data),
  // 保存人物（后端同步LLM生成小传，失败降级模板）
  create: (projectId: string, data: any) => post<any>(`/projects/${projectId}/custom-characters`, data),
  // 批量新建空白/随机人物（1-20 个）
  batchCreate: (projectId: string, data: { count: number; randomize?: boolean; generateBio?: boolean }) =>
    post<{ created: number; failed: number; errors: { name: string; error: string }[] }>(
      `/projects/${projectId}/custom-characters/batch-create`, data),
  // 更新（regenerateBio=true 重生小传；regenerateVerdict=true 重生判词）
  update: (projectId: string, id: number, data: any) =>
    put<any>(`/projects/${projectId}/custom-characters/${id}`, data),
  // 手动（重）生成判词（判词Skill：七言绝句+二字考语，同步入库）
  generateVerdict: (projectId: string, id: number) =>
    post<{ verdictPoem: string; verdictComment: string; annotation?: Record<string, string> }>(
      `/projects/${projectId}/custom-characters/${id}/generate-verdict`, {}),
  // 一键补全对白风格（13-SRS US-18，返回不保存，前端填充表单）
  autoVoice: (projectId: string, id: number) =>
    post<any>(`/projects/${projectId}/custom-characters/${id}/auto-voice`, {}),
  // 软删除
  delete: (projectId: string, id: number) =>
    del<any>(`/projects/${projectId}/custom-characters/${id}`),
  // 从世界观引用人物（快照复制）
  import: (projectId: string, worldCharacterId: number) =>
    post<any>(`/projects/${projectId}/custom-characters/import`, { worldCharacterId }),
  // 从其他项目引入人物（跨项目复制）
  importFromProject: (projectId: string, data: { sourceProjectId: number; ids: number[]; skipDuplicates?: boolean }) =>
    post<any>(`/projects/${projectId}/custom-characters/import-from-project`, data),
  importSourcesFromProject: (projectId: string, sourceProjectId: number) =>
    get<{ id: number; name: string }[]>(`/projects/${projectId}/custom-characters/import/sources?sourceProjectId=${sourceProjectId}`),
  // 诛仙库书籍列表（批量引用第一步）
  worldBooks: (projectId: string) =>
    get<{ bookId: number; bookName: string; author: string | null }[]>(`/projects/${projectId}/custom-characters/import/world-books`),
  // 指定书籍的诛仙库人物列表（批量引用第二步）
  worldSources: (projectId: string, bookId: number) =>
    get<{ id: number; name: string; allTitles: string[] | null; faction: string | null; realm: string | null; bookId: number }[]>(
      `/projects/${projectId}/custom-characters/import/world-sources?bookId=${bookId}`),
  // 从诛仙库批量引用人物到创作库
  importBatch: (projectId: string, worldCharacterIds: number[]) =>
    post<{ created: number; skippedDuplicate: number; failed: number; errors: { id: number; error: string }[] }>(
      `/projects/${projectId}/custom-characters/import/batch`, { worldCharacterIds }),
  // 从文本抽取人物候选（LLM，不入库）
  extractFromText: (projectId: string, data: { text: string; generateBio?: boolean }) =>
    post<{ candidates: Array<{ name: string; gender?: string; position?: string; innerPersonality?: string; outerPersonality?: string[]; talents?: string[]; description?: string }> }>(
      `/projects/${projectId}/custom-characters/extract-from-text`, data),
  // 预览确认后批量创建抽取的人物
  batchCreateFromCandidates: (projectId: string, characters: Array<Record<string, any>>) =>
    post<{ created: number; failed: number; errors: { name: string; error: string }[] }>(
      `/projects/${projectId}/custom-characters/batch-create-from-candidates`, { characters }),
  // 文字描述→参数智能匹配（LLM映射枚举，后端校验约束）
  smartMatch: (projectId: string, description: string) =>
    post<any>(`/projects/${projectId}/custom-characters/smart-match`, { description }),
  // 文件导出/导入（14-SRS US-23：人物+9张子表）
  exportFile: (projectId: string, ids: number[]) =>
    post<{ items: any[] }>(`/projects/${projectId}/custom-characters/export`, { ids }),
  importFile: (projectId: string, data: { items: any[]; conflictStrategy: string }) =>
    post<FileImportStats>(`/projects/${projectId}/custom-characters/import-file`, data),
}

// ============ 山河舆图API（10-需求：地图/地点/路径/距离） ============
export const mapApi = {
  // ---- 地图 ----
  listMaps: (projectId: string) => get<any[]>(`/projects/${projectId}/custom-maps`),
  createMap: (projectId: string, data: any) => post<any>(`/projects/${projectId}/custom-maps`, data),
  updateMap: (projectId: string, mapId: number, data: any) =>
    put<any>(`/projects/${projectId}/custom-maps/${mapId}`, data),
  deleteMap: (projectId: string, mapId: number) => del<any>(`/projects/${projectId}/custom-maps/${mapId}`),
  // ---- 地点 ----
  listLocations: (projectId: string, opts?: { mapId?: number; entityStatus?: string }) => {
    const params = new URLSearchParams();
    if (opts?.mapId) params.set('mapId', String(opts.mapId));
    if (opts?.entityStatus) params.set('entityStatus', opts.entityStatus);
    const qs = params.toString();
    return get<any[]>(`/projects/${projectId}/custom-locations${qs ? `?${qs}` : ''}`);
  },
  createLocation: (projectId: string, data: any) => post<any>(`/projects/${projectId}/custom-locations`, data),
  updateLocation: (projectId: string, locId: number, data: any) =>
    put<any>(`/projects/${projectId}/custom-locations/${locId}`, data),
  confirmLocation: (projectId: string, locId: number) =>
    post<any>(`/projects/${projectId}/custom-locations/${locId}/confirm`, {}),
  deleteLocation: (projectId: string, locId: number) => del<any>(`/projects/${projectId}/custom-locations/${locId}`),
  /** 批量软删地点（左侧导航一键删除） */
  batchDeleteLocations: (projectId: string, ids: number[]) =>
    post<{ deleted: number }>(`/projects/${projectId}/custom-locations/batch-delete`, { ids }),
  /** 诛仙库候选清单（含已导入标记） */
  zhuxianCandidates: (projectId: string) =>
    get<any[]>(`/projects/${projectId}/custom-locations/import-zhuxian/candidates`),
  /** 按勾选的诛仙库 ID 导入为草稿 */
  importZhuxian: (projectId: string, data: { zhuxianIds: number[]; mapId?: number }) =>
    post<{ imported: number; mapId?: number }>(`/projects/${projectId}/custom-locations/import-zhuxian`, data),
  /** 从文本抽取地点候选（LLM，不入库） */
  extractLocationsFromText: (projectId: string, data: { text: string }) =>
    post<{ candidates: any[] }>(`/projects/${projectId}/custom-locations/extract-from-text`, data),
  /** 确认候选后批量落草稿 */
  batchCreateLocationCandidates: (projectId: string, data: { candidates: any[]; mapId?: number }) =>
    post<{ created: number; failed: number; errors: { name: string; error: string }[]; mapId?: number }>(
      `/projects/${projectId}/custom-locations/batch-create-from-candidates`, data),
  distance: (projectId: string, from: number, to: number, mode: 'walk' | 'fly' | 'ship' | 'teleport' = 'fly') =>
    get<any>(`/projects/${projectId}/custom-locations/distance?from=${from}&to=${to}&mode=${mode}`),
  // ---- 路径 ----
  listLinks: (projectId: string) => get<any[]>(`/projects/${projectId}/custom-location-links`),
  createLink: (projectId: string, data: any) => post<any>(`/projects/${projectId}/custom-location-links`, data),
  deleteLink: (projectId: string, linkId: number) => del<any>(`/projects/${projectId}/custom-location-links/${linkId}`),
  // ---- 文件导出/导入（14-SRS US-26：地图+地点+路径） ----
  exportFile: (projectId: string, data: { ids: number[]; locationIds?: number[] }) =>
    post<{ items: any[] }>(`/projects/${projectId}/custom-locations/export`, data),
  importFile: (projectId: string, data: { items: any[]; conflictStrategy: string }) =>
    post<FileImportStats>(`/projects/${projectId}/custom-locations/import-file`, data),
}

// ============ 自定义武器API（自定义武器模块，接入成长工坊养成） ============
export const customWeaponsApi = {
  // 列表（本项目自定义武器，软删除过滤）
  list: (projectId: string) => get<any[]>(`/projects/${projectId}/custom-weapons`),
  // 词条配置库（门类/形制/材质/特质/祭炼/品级）
  catalog: (projectId: string) => get<any>(`/projects/${projectId}/custom-weapons/catalog`),
  // 详情
  get: (projectId: string, wid: number) => get<any>(`/projects/${projectId}/custom-weapons/${wid}`),
  // 确定性随机完整武器（大骰子；locked 锁定字段保留，base 为当前草稿）
  random: (projectId: string, data?: { base?: any; locked?: Record<string, boolean> }) =>
    post<any>(`/projects/${projectId}/custom-weapons/random`, data ?? {}),
  // LLM 随机名号（姓名小骰子）
  randomName: (projectId: string, data: { category: string; type: string; grade?: string; count?: number }) =>
    post<{ names: string[] }>(`/projects/${projectId}/custom-weapons/random-name`, data),
  // 保存武器入库
  create: (projectId: string, data: any) => post<any>(`/projects/${projectId}/custom-weapons`, data),
  // 更新
  update: (projectId: string, wid: number, data: any) =>
    put<any>(`/projects/${projectId}/custom-weapons/${wid}`, data),
  // 软删除
  delete: (projectId: string, wid: number) =>
    del<any>(`/projects/${projectId}/custom-weapons/${wid}`),
  // 养成：强化（原地升阶，直接落库）
  upgrade: (projectId: string, wid: number) =>
    post<any>(`/projects/${projectId}/custom-weapons/${wid}/upgrade`, {}),
  // 养成：进化（预览，需 confirm 入库）
  evolution: (projectId: string, wid: number) =>
    post<any>(`/projects/${projectId}/custom-weapons/${wid}/evolution`, {}),
  // 养成：变异（预览，需 confirm 入库）
  mutation: (projectId: string, wid: number) =>
    post<any>(`/projects/${projectId}/custom-weapons/${wid}/mutation`, {}),
  // 养成：融合（预览，需 confirm 入库）
  fusion: (projectId: string, data: { entityAId: number; entityBId: number }) =>
    post<any>(`/projects/${projectId}/custom-weapons/fusion`, data),
  // 养成：确认预览入库
  confirm: (projectId: string, preview: any) =>
    post<any>(`/projects/${projectId}/custom-weapons/confirm`, { preview }),
  // 养成历史
  history: (projectId: string, wid: number) =>
    get<any[]>(`/projects/${projectId}/custom-weapons/${wid}/history`),
  // 回退
  revert: (projectId: string, recordId: number) =>
    post<any>(`/projects/${projectId}/custom-weapons/revert/${recordId}`, {}),
  // 文案生成Skill：生成名号/化名/简介/招式（新版本置为当前）
  generateLore: (projectId: string, wid: number) =>
    post<any>(`/projects/${projectId}/custom-weapons/${wid}/generate-lore`, {}),
  // 获取武器文案（当前版本 + 历史版本）
  getLore: (projectId: string, wid: number) =>
    get<{ current: any; history: any[] }>(`/projects/${projectId}/custom-weapons/${wid}/lore`),
  // 切换生效文案版本
  setLoreCurrent: (projectId: string, loreId: number) =>
    post<any>(`/projects/${projectId}/custom-weapons/lore/${loreId}/set-current`, {}),
  // 方向组合式特质：按方向实时预览生成特质（零token）
  generateTraits: (projectId: string, data: { directions: any; category: string; type: string; grade?: string; baseMaterial: string; mainDao?: string }) =>
    post<any>(`/projects/${projectId}/custom-weapons/generate-traits`, data),
  // 五感兵器卡生成（LLM）
  generateSenseCard: (projectId: string, wid: number, data?: { module?: string; temperament?: string; pastType?: string; taboos?: string[]; reverseMode?: boolean }) =>
    post<any>(`/projects/${projectId}/custom-weapons/${wid}/generate-sense-card`, data ?? {}),
  // 老武器补全五感卡（兼容旧数据，自动包装旧特质+默认控制项）
  completeSenseCard: (projectId: string, wid: number) =>
    post<any>(`/projects/${projectId}/custom-weapons/${wid}/complete-sense-card`, {}),
  // 烙印系统
  scarDefinitions: (projectId: string) =>
    get<any[]>(`/projects/${projectId}/custom-weapons/scars/definitions`),
  listScars: (projectId: string, wid: number) =>
    get<any[]>(`/projects/${projectId}/custom-weapons/${wid}/scars`),
  addScar: (projectId: string, wid: number, data: { scarDefId?: string; name?: string; desc?: string; flaw?: string }) =>
    post<any>(`/projects/${projectId}/custom-weapons/${wid}/scars`, data),
  removeScar: (projectId: string, wid: number, traitId: string) =>
    del<any>(`/projects/${projectId}/custom-weapons/${wid}/scars/${traitId}`),
  // 因果羁绊
  scanBonds: (projectId: string) =>
    post<any>(`/projects/${projectId}/custom-weapons/bonds/scan`, {}),
  getWeaponBonds: (projectId: string, wid: number) =>
    get<any[]>(`/projects/${projectId}/custom-weapons/${wid}/bonds`),
  // 重铸
  recraft: (projectId: string, wid: number, keepTraitIds: string[]) =>
    post<any>(`/projects/${projectId}/custom-weapons/${wid}/recraft`, { keepTraitIds }),
  // 套装道号
  generateDaoTitle: (projectId: string, wid: number, charId: number) =>
    post<any>(`/projects/${projectId}/custom-weapons/${wid}/dao-title`, { charId }),
  // 走火入魔魔改/净化
  demonize: (projectId: string, wid: number) =>
    post<any>(`/projects/${projectId}/custom-weapons/${wid}/demonize`, {}),
  purify: (projectId: string, wid: number) =>
    post<any>(`/projects/${projectId}/custom-weapons/${wid}/purify`, {}),
  // 天命克制计算
  counter: (projectId: string, weaponAId: number, weaponBId: number) =>
    post<any>(`/projects/${projectId}/custom-weapons/counter`, { weaponAId, weaponBId }),
  // 老数据迁移（批量补全五感卡）
  migrate: (projectId: string) =>
    post<any>(`/projects/${projectId}/custom-weapons/migrate`, {}),
  // 路边摊淘宝批量生成（S级）
  streetBatch: (projectId: string, data: { batch: number; junkRatio?: number }) =>
    post<any>(`/projects/${projectId}/custom-weapons/random`, data),
  // 从世界观引用法宝（快照复制）
  import: (projectId: string, worldItemId: number) =>
    post<any>(`/projects/${projectId}/custom-weapons/import`, { worldItemId }),
  // 从其他项目引入法宝（跨项目复制）
  importFromProject: (projectId: string, data: { sourceProjectId: number; ids: number[]; skipDuplicates?: boolean }) =>
    post<any>(`/projects/${projectId}/custom-weapons/import-from-project`, data),
  importSourcesFromProject: (projectId: string, sourceProjectId: number) =>
    get<{ id: number; name: string }[]>(`/projects/${projectId}/custom-weapons/import/sources?sourceProjectId=${sourceProjectId}`),
  // 文字描述→参数智能匹配（LLM映射枚举，后端校验约束）
  smartMatch: (projectId: string, description: string) =>
    post<any>(`/projects/${projectId}/custom-weapons/smart-match`, { description }),
  // 文件导出/导入（14-SRS US-24：法宝+weapon_lore，特质名称映射）
  exportFile: (projectId: string, ids: number[]) =>
    post<{ items: any[] }>(`/projects/${projectId}/custom-weapons/export`, { ids }),
  importFile: (projectId: string, data: { items: any[]; conflictStrategy: string }) =>
    post<FileImportStats>(`/projects/${projectId}/custom-weapons/import-file`, data),
}

// ============ 自定义功法API（九大道则体系，无品级） ============
export const customTechniquesApi = {
  // 列表（本项目自定义功法，软删除过滤）
  list: (projectId: string) => get<any[]>(`/projects/${projectId}/custom-techniques`),
  // 词条配置库（道则/深度/体例/特质/神通/反噬/门槛/印记/技巧/演化/矛盾）
  catalog: (projectId: string) => get<any>(`/projects/${projectId}/custom-techniques/catalog`),
  // 给定主修道则的辅修兼容标注
  compat: (projectId: string, mainDao: string) =>
    get<{ id: string; compat: string }[]>(`/projects/${projectId}/custom-techniques/compat/${mainDao}`),
  // 详情
  get: (projectId: string, tid: number) => get<any>(`/projects/${projectId}/custom-techniques/${tid}`),
  // 确定性随机完整功法（大骰子；locked 锁定字段保留，base 为当前草稿）
  random: (projectId: string, data?: { base?: any; locked?: Record<string, boolean> }) =>
    post<any>(`/projects/${projectId}/custom-techniques/random`, data ?? {}),
  // LLM 随机名号（名号小骰子）
  randomName: (projectId: string, data: { mainDao: string; guidanceDepth: string; styleType?: string; count?: number }) =>
    post<{ names: string[] }>(`/projects/${projectId}/custom-techniques/random-name`, data),
  // 保存功法入库（默认自动生成详解）
  create: (projectId: string, data: any) => post<any>(`/projects/${projectId}/custom-techniques`, data),
  // 更新
  update: (projectId: string, tid: number, data: any) =>
    put<any>(`/projects/${projectId}/custom-techniques/${tid}`, data),
  // 软删除
  delete: (projectId: string, tid: number) =>
    del<any>(`/projects/${projectId}/custom-techniques/${tid}`),
  // 详解生成Skill（对已入库功法补生成/重生成）
  generateDescription: (projectId: string, tid: number) =>
    post<any>(`/projects/${projectId}/custom-techniques/${tid}/generate-description`, {}),
  // 反噬代价重生成（13-SRS US-20d，对已入库功法）
  generateBacklash: (projectId: string, tid: number) =>
    post<any>(`/projects/${projectId}/custom-techniques/${tid}/generate-backlash`, {}),
  // 天机独悟：道则组合运用方向+神通招式名预览生成（13-SRS US-20e，不落库）
  insightDirections: (projectId: string, data: { mainDao: string; assistDao: string[]; coreTraits: string[]; abilities?: { id: string; name: string; daoRealm: string }[] }) =>
    post<any>(`/projects/${projectId}/custom-techniques/insight-directions`, data),
  // 从世界观引用功法（快照复制）
  import: (projectId: string, worldSkillId: number) =>
    post<any>(`/projects/${projectId}/custom-techniques/import`, { worldSkillId }),
  // 从其他项目引入功法（跨项目复制）
  importFromProject: (projectId: string, data: { sourceProjectId: number; ids: number[]; skipDuplicates?: boolean }) =>
    post<any>(`/projects/${projectId}/custom-techniques/import-from-project`, data),
  importSourcesFromProject: (projectId: string, sourceProjectId: number) =>
    get<{ id: number; name: string }[]>(`/projects/${projectId}/custom-techniques/import/sources?sourceProjectId=${sourceProjectId}`),
  // 文字描述→参数智能匹配（LLM映射枚举，后端校验约束）
  smartMatch: (projectId: string, description: string) =>
    post<any>(`/projects/${projectId}/custom-techniques/smart-match`, { description }),
  // 文件导出/导入（14-SRS US-25：功法单表）
  exportFile: (projectId: string, ids: number[]) =>
    post<{ items: any[] }>(`/projects/${projectId}/custom-techniques/export`, { ids }),
  importFile: (projectId: string, data: { items: any[]; conflictStrategy: string }) =>
    post<FileImportStats>(`/projects/${projectId}/custom-techniques/import-file`, data),
}

// ============ 人物功法个人变种API（千人千面） ============
export const techniqueVariantsApi = {
  // 列出某人物的全部变种
  list: (projectId: string, characterId: number | string) =>
    get<any[]>(`/projects/${projectId}/characters/${characterId}/techniques`),
  // 生成变种（人物绑定功法时调用；lock 可锁定 rarity/originBias）
  generate: (projectId: string, characterId: number | string, techniqueId: number, lock?: { rarity?: string; originBias?: boolean }) =>
    post<any>(`/projects/${projectId}/characters/${characterId}/techniques/${techniqueId}/generate-variant`, lock ?? {}),
  // 重随变种（锁定项保持不变）
  reroll: (projectId: string, characterId: number | string, variantId: number, lock?: { rarity?: string; originBias?: boolean }) =>
    post<any>(`/projects/${projectId}/characters/${characterId}/techniques/${variantId}/reroll-variant`, lock ?? {}),
  // 成长迭代版本
  upgrade: (projectId: string, characterId: number | string, variantId: number, trigger?: string) =>
    put<any>(`/projects/${projectId}/characters/${characterId}/techniques/${variantId}/upgrade`, { trigger }),
  // 软删除
  delete: (projectId: string, characterId: number | string, variantId: number) =>
    del<any>(`/projects/${projectId}/characters/${characterId}/techniques/${variantId}`),
}

// ============ 人物武学档案API（功法+武器融合小传） ============
export const characterMartialApi = {
  // 获取武学档案（含可绑定功法/武器列表）
  get: (projectId: string, characterId: number | string) =>
    get<any>(`/projects/${projectId}/custom-characters/${characterId}/martial`),
  // 绑定功法/武器到人物
  bind: (projectId: string, characterId: number | string, body: { techniqueIds: number[]; weaponIds: number[] }) =>
    post<any>(`/projects/${projectId}/custom-characters/${characterId}/martial/bind`, body),
  // 生成融合武学小传（选1功法+1武器）
  generate: (projectId: string, characterId: number | string, body: { techniqueId: number; weaponId: number }) =>
    post<any>(`/projects/${projectId}/custom-characters/${characterId}/martial/generate`, body),
  // 软删除武学档案（全部）
  delete: (projectId: string, characterId: number | string) =>
    del<any>(`/projects/${projectId}/custom-characters/${characterId}/martial`),
  // 删除单条搭配记录
  deleteOne: (projectId: string, characterId: number | string, loreId: number) =>
    del<any>(`/projects/${projectId}/custom-characters/${characterId}/martial/${loreId}`),
  // 重新生成单条搭配的武学小传
  regenerate: (projectId: string, characterId: number | string, loreId: number) =>
    post<any>(`/projects/${projectId}/custom-characters/${characterId}/martial/${loreId}/regenerate`, {}),
}

// ============ 热点嗅探API ============
export interface HotspotSource {
  name: string
  label: string
  kind: 'page' | 'api'
  description: string
}
export interface HotspotBatch {
  id: number
  source_names: string[]
  status: string
  item_count: number
  note: string | null
  started_at: string
  finished_at: string | null
  insight_count: number
}
export interface HotspotNovel {
  id: number
  source: string
  rank: number | null
  title: string
  author: string | null
  category: string | null
  tags: string[]
  intro: string | null
  word_count: string | null
  popularity: string | null
  url: string | null
}
export interface HotspotInsight {
  id: number
  batch_id: number
  insight_type: string
  title: string
  content: string | null
  payload: Record<string, any>
  score: number
  status: 'new' | 'kept' | 'discarded' | 'pushed'
  source_novel_ids: number[]
  created_at: string
}
export interface HotspotCrawlResult {
  batchId: number
  itemCount: number
  status: string
  note: string
  perSource: Array<{ source: string; count: number; error?: string }>
}

export const hotspotApi = {
  sources: () => get<HotspotSource[]>('/hotspot/sources'),
  crawl: (sources: string[], limit = 30) =>
    post<HotspotCrawlResult>('/hotspot/crawl', { sources, limit }),
  batches: () => get<HotspotBatch[]>('/hotspot/batches'),
  novels: (batchId: number) => get<HotspotNovel[]>(`/hotspot/batches/${batchId}/novels`),
  analyze: (batchId: number) =>
    post<{ count: number; byType: Record<string, number> }>('/hotspot/analyze', { batchId }),
  insights: (params: { batchId?: number; type?: string; status?: string }) => {
    const q = new URLSearchParams()
    if (params.batchId) q.set('batchId', String(params.batchId))
    if (params.type) q.set('type', params.type)
    if (params.status) q.set('status', params.status)
    return get<HotspotInsight[]>(`/hotspot/insights?${q.toString()}`)
  },
  updateInsight: (id: number, status: string) =>
    patch<{ id: number; status: string }>(`/hotspot/insights/${id}`, { status }),
  push: (id: number, targetTable?: string) =>
    post<{ insightId: number; targetTable: string; targetId: number; embedded: boolean }>(
      `/hotspot/insights/${id}/push`,
      { targetTable },
    ),
  pushLog: (id: number) => get<any[]>(`/hotspot/insights/${id}/push-log`),
}

/** 可推送到素材库的灵感类型 */
export const HOTSPOT_MATERIAL_TYPES = ['encounter', 'foreshadow', 'highlight', 'task']
export const HOTSPOT_TYPE_LABELS: Record<string, string> = {
  encounter: '奇遇素材',
  foreshadow: '伏笔手法',
  highlight: '高光名场面',
  task: '任务链',
  trend: '趋势参考',
}
export const HOTSPOT_TARGET_TABLE_LABELS: Record<string, string> = {
  plot_material_encounter: '奇遇素材库',
  plot_material_foreshadow: '伏笔手法库',
  plot_material_highlight: '高光素材库',
  plot_material_task: '任务链素材库',
}

// ============ 素材知识库API（文风预设/领域知识 + 蒸馏ETL，旁路Python服务） ============
export const materialKbApi = {
  // 文风预设
  stylePresets: (q?: string) =>
    get<any[]>(`/material-kb/style-presets${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  stylePresetDetail: (id: number) => get<any>(`/material-kb/style-presets/${id}`),
  deleteStylePreset: (id: number) => del<{ deleted: number }>(`/material-kb/style-presets/${id}`),
  // 领域知识
  domainKnowledge: (params: { q?: string; type?: string; domain?: string }) => {
    const q = new URLSearchParams()
    if (params.q) q.set('q', params.q)
    if (params.type) q.set('type', params.type)
    if (params.domain) q.set('domain', params.domain)
    return get<any[]>(`/material-kb/domain-knowledge?${q.toString()}`)
  },
  domainKnowledgeDetail: (id: number) => get<any>(`/material-kb/domain-knowledge/${id}`),
  deleteDomainKnowledge: (id: number) =>
    del<{ deleted: number }>(`/material-kb/domain-knowledge/${id}`),
  // ETL（代理到 Python GUI 服务 8610）
  etlHealth: () => get<any>('/material-kb/etl/health'),
  etlRun: (kind: 'style' | 'domain' | 'material', params: Record<string, unknown>) =>
    post<{ task_id: string; cmd: string }>(`/material-kb/etl/run/${kind}`, params),
  // Python 侧返回 {tasks:[...]}，拍平为数组供前端直接 .map
  etlTasks: () =>
    get<{ tasks: any[] }>('/material-kb/etl/tasks').then((r: any) => r?.tasks ?? []),
  etlTaskLog: (tid: string, offset = 0) =>
    get<{ status: string; returncode: number | null; lines: string[]; next_offset: number; elapsed: number }>(
      `/material-kb/etl/task/${tid}?offset=${offset}`,
    ),
  etlBrowse: (dir?: string) =>
    get<any>(`/material-kb/etl/browse${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`),
  // RAG 检索测试
  recallTest: (params: { query: string; projectId?: number; topN?: number; minScore?: number }) =>
    post<any>('/material-kb/recall-test', params),
}

/** 领域知识类型标签 */
export const KNOWLEDGE_TYPE_LABELS: Record<string, string> = {
  term: '术语',
  rule: '规则',
  pitfall: '雷区',
  expression: '表达',
  case: '案例',
}

// ============================================================
// 淘宝系统
// ============================================================

export const treasureApi = {
  hunt: (projectId: string, data?: { count?: number; fakeRatio?: number }) =>
    post<any>(`/projects/${projectId}/treasure/hunt`, data || {}),
  items: (projectId: string, params?: { type?: string; status?: string }) => {
    const q = new URLSearchParams()
    if (params?.type) q.set('type', params.type)
    if (params?.status) q.set('status', params.status)
    return get<any[]>(`/projects/${projectId}/treasure/items?${q.toString()}`)
  },
  detail: (projectId: string, id: number) =>
    get<any>(`/projects/${projectId}/treasure/${id}`),
  bind: (projectId: string, id: number, characterId: number, chapterNo?: number) =>
    post<any>(`/projects/${projectId}/treasure/${id}/bind`, { characterId, chapterNo }),
  collect: (projectId: string, id: number) =>
    post<any>(`/projects/${projectId}/treasure/${id}/collect`, {}),
  discard: (projectId: string, id: number) =>
    del<any>(`/projects/${projectId}/treasure/${id}`),
  updateNote: (projectId: string, id: number, note: string) =>
    put<any>(`/projects/${projectId}/treasure/${id}/note`, { note }),
  convert: (projectId: string, id: number) =>
    post<any>(`/projects/${projectId}/treasure/${id}/convert`, {}),
  records: (projectId: string) =>
    get<any[]>(`/projects/${projectId}/treasure/records`),
  getSettings: (projectId: string) =>
    get<any>(`/projects/${projectId}/treasure/settings`),
  updateSettings: (projectId: string, data: { fakeRatio?: number }) =>
    put<any>(`/projects/${projectId}/treasure/settings`, data),
}

// ============ 叙事技法库API（技法原子浏览/筛选/状态管理） ============
export const techniqueApi = {
  list: (params?: { category?: string; level?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.level) qs.set('level', params.level);
    if (params?.status) qs.set('status', params.status);
    const q = qs.toString();
    return get<any[]>(`/techniques${q ? `?${q}` : ''}`);
  },
  get: (techniqueId: string) => get<any>(`/techniques/${techniqueId}`),
  update: (techniqueId: string, data: any) => put<any>(`/techniques/${techniqueId}`, data),
}

// ============ 冲突与台词双引擎API（PRD v1.3） ============
// 冰山台词引擎：三层冰山（真相层/表面层/行为层）+ 质量体检 + 分步重生成
export const dualEngineApi = {
  /** 冰山台词生成（场景A） */
  generateIceberg: (projectId: string, config: any) =>
    post<any>(`/v1/dialogue/iceberg`, { projectId: Number(projectId), config }),
  /** 冰山台词分步重生成：step ∈ truth|surface|behavior */
  regenerateIceberg: (requestId: number, step: string, overrides?: any) =>
    post<any>(`/v1/dialogue/iceberg/regenerate`, { request_id: requestId, step, ...(overrides ? { overrides } : {}) }),
  /** 冲突生成（场景B）：欲望→阻力→代价三阶段 */
  generateConflict: (projectId: string, config: any) =>
    post<any>(`/v1/conflict/generate`, { projectId: Number(projectId), config }),
  /** 冲突分步重生成：step ∈ desire|resistance|cost */
  regenerateConflict: (requestId: number, step: string, overrides?: any) =>
    post<any>(`/v1/conflict/regenerate`, { request_id: requestId, step, ...(overrides ? { overrides } : {}) }),
  /** 组合工作流（冲突+台词一体化整场戏） */
  composeConflict: (projectId: string, config: any) =>
    post<any>(`/v1/conflict/compose`, { projectId: Number(projectId), config }),
  /** 质量体检（场景D）：module ∈ dialogue|conflict|compose */
  validate: (module: string, content: string, config?: any) =>
    post<any>(`/v1/validate`, { module, content, ...(config ? { config } : {}) }),
  /** 大纲联动（场景C）：章节/场景节点 → 冲突参数预填草稿 */
  conflictDraft: (projectId: string, chapterPlanId: number, sceneNodeId?: number) =>
    get<any>(`/v1/outline/conflict-draft?projectId=${projectId}&chapterPlanId=${chapterPlanId}${sceneNodeId ? `&sceneNodeId=${sceneNodeId}` : ''}`),
  /** 冰山台词预填草稿（v1.5.1）：章节 → 场景上下文+真相层+表面层预填 */
  icebergDraft: (projectId: string, chapterPlanId: number) =>
    get<any>(`/v1/outline/iceberg-draft?projectId=${projectId}&chapterPlanId=${chapterPlanId}`),
}
