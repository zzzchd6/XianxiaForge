import { useState, useCallback, useRef } from 'react'
import { generationApi } from '../lib/api'

// 生成阶段枚举
export type GenerationPhase =
  | 'idle'
  | 'queued'    // 排队等待
  | 'context'    // 编排上下文
  | 'writing'    // 写作中
  | 'auditing'   // 审计中
  | 'revising'   // 修订中
  | 'complete'   // 完成
  | 'error'      // 错误

// 审计报告类型
export interface AuditReport {
  score?: number
  issues?: string[]
  suggestions?: string[]
  passed?: boolean
}

// Hook状态
interface GenerationStreamState {
  text: string
  phase: GenerationPhase
  auditReport: AuditReport | null
  /** 本次生成从诛仙库检索到的素材快照（人物/门派/地点/功法/法宝/关系/前文） */
  retrievedContext: any | null
  /** 本章生成完成后产出的剧情分支选项（需求12） */
  branchOptions: any[] | null
  /** 产出分支选项的章节计划ID（需求12） */
  branchChapterPlanId: string | null
  /** 桥段重复度告警（连续性扫描） */
  plotDuplicationWarning: any | null
  /** 章末钩子轮换告警 */
  hookRotationWarning: any | null
  /** 实体自动维护扫描结果（09需求）：新人物/武器/功法/地点/动态更新数 */
  entitiesFound: { newCharacters: number; newWeapons: number; newTechniques: number; newLocations?: number; updates: number } | null
  /** 防瞬移告警（10-山河舆图 US-5） */
  teleportWarning: { warnings: { characterName: string; fromLocation: string; toLocation: string; display: string; estimated: boolean }[] } | null
  isStreaming: boolean
  error: string | null
  taskId: string | null
}

/**
 * SSE流式生成Hook
 * 连接后端SSE端点，实时接收生成文本和状态更新
 */
export function useGenerationStream() {
  const [state, setState] = useState<GenerationStreamState>({
    text: '',
    phase: 'idle',
    auditReport: null,
    retrievedContext: null,
    branchOptions: null,
    branchChapterPlanId: null,
    plotDuplicationWarning: null,
    hookRotationWarning: null,
    entitiesFound: null,
    teleportWarning: null,
    isStreaming: false,
    error: null,
    taskId: null,
  })

  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectCountRef = useRef(0)
  const maxReconnect = 3

  // 清理SSE连接
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }, [])

  // 连接到SSE流
  const connectStream = useCallback((taskId: string) => {
    cleanup()

    const url = generationApi.streamUrl(taskId)
    const es = new EventSource(url)
    eventSourceRef.current = es

    es.onopen = () => {
      reconnectCountRef.current = 0
      setState((prev) => ({ ...prev, isStreaming: true, error: null }))
    }

    // 后端发送的是无名SSE事件（只有data:行），统一通过onmessage接收
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data)
        const { type, data } = parsed

        switch (type) {
          case 'status': {
            // 后端发送 {step, status}，映射到前端phase
            const stepToPhase: Record<string, GenerationPhase> = {
              queued: 'queued',
              retry_wait: 'queued',
              loading: 'context',
              building_context: 'context',
              initializing: 'context',
              writing: 'writing',
              auditing: 'auditing',
              revising: 'revising',
              completed: 'complete',
              cancelled: 'idle',
            }
            const newPhase = stepToPhase[data.step] || undefined
            setState((prev) => ({
              ...prev,
              phase: newPhase || prev.phase,
            }))
            break
          }

          case 'token': {
            // 轮询模式下的日志消息，或完整内容
            if (data.content) {
              setState((prev) => ({
                ...prev,
                text: data.content,
                phase: 'writing',
              }))
            }
            // data.log 是日志信息，不显示为正文
            break
          }

          case 'audit': {
            setState((prev) => ({
              ...prev,
              auditReport: {
                score: data.overallScore,
                issues: data.issues?.map((i: any) => `[${i.severity}] ${i.description}`) || [],
                suggestions: data.issues?.map((i: any) => i.suggestion).filter(Boolean) || [],
                passed: (data.issues?.filter((i: any) => i.severity === 'critical') || []).length === 0,
              },
              phase: 'auditing',
            }))
            break
          }

          case 'context': {
            // 后端在构建完上下文后下发本次检索到的诛仙库素材快照
            setState((prev) => ({ ...prev, retrievedContext: data }))
            break
          }

          case 'branch_ready': {
            // 章节生成完成后，后端产出下一章剧情分支选项（需求12）
            setState((prev) => ({
              ...prev,
              branchOptions: Array.isArray(data.options) ? data.options : [],
              branchChapterPlanId: data.chapterPlanId != null ? String(data.chapterPlanId) : null,
            }))
            break
          }

          case 'plot_duplication_warning': {
            // 桥段重复度告警（连续性扫描）
            setState((prev) => ({ ...prev, plotDuplicationWarning: data }))
            break
          }

          case 'hook_rotation_warning': {
            // 章末钩子轮换告警
            setState((prev) => ({ ...prev, hookRotationWarning: data }))
            break
          }

          case 'entities_extracted': {
            // 实体自动维护扫描结果（09需求）
            setState((prev) => ({ ...prev, entitiesFound: data }))
            break
          }

          case 'teleport_warning': {
            // 防瞬移告警（10-山河舆图 US-5）
            setState((prev) => ({ ...prev, teleportWarning: data }))
            break
          }

          case 'complete': {
            setState((prev) => ({
              ...prev,
              phase: 'complete',
              isStreaming: false,
              text: data.content || prev.text,
              entitiesFound: data.entitiesFound ?? prev.entitiesFound,
            }))
            cleanup()
            break
          }

          case 'error': {
            setState((prev) => ({
              ...prev,
              phase: 'error',
              isStreaming: false,
              error: data.message || data.error || '生成过程中发生错误',
            }))
            cleanup()
            break
          }
        }
      } catch {
        // 忽略解析失败的消息
      }
    }

    es.onerror = () => {
      // EventSource原生错误（连接断开等）
      if (reconnectCountRef.current < maxReconnect) {
        reconnectCountRef.current++
        es.close()
        setTimeout(() => connectStream(taskId), 1000 * reconnectCountRef.current)
      } else {
        setState((prev) => ({
          ...prev,
          phase: 'error',
          isStreaming: false,
          error: '连接断开，请重试',
        }))
        cleanup()
      }
    }
  }, [cleanup])

  // 启动生成
  const startGeneration = useCallback(async (params: {
    projectId: string
    chapterPlanId: string
    targetWords?: number
    temperature?: number
    autoRevise?: boolean
    stylePreset?: string
    skipAudit?: boolean
    maxTokens?: number
    forceContinue?: boolean
  }) => {
    // 重置状态
    setState({
      text: '',
      phase: 'context',
      auditReport: null,
      retrievedContext: null,
      branchOptions: null,
      branchChapterPlanId: null,
      plotDuplicationWarning: null,
      hookRotationWarning: null,
      entitiesFound: null,
      teleportWarning: null,
      isStreaming: true,
      error: null,
      taskId: null,
    })

    try {
      const { skipAudit, maxTokens: mt, ...rest } = params
      const body: any = { ...rest }
      if (skipAudit !== undefined) body.skipAudit = skipAudit
      if (mt !== undefined) body.llmConfig = { maxTokens: mt }
      const result = await generationApi.start(body)
      const taskId = result.taskId || result.id
      setState((prev) => ({ ...prev, taskId }))
      connectStream(taskId)
      return result
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        phase: 'error',
        isStreaming: false,
        error: err.message || '启动生成失败',
      }))
      throw err
    }
  }, [connectStream])

  // 取消生成
  const cancelGeneration = useCallback(async () => {
    if (state.taskId) {
      try {
        await generationApi.cancel(state.taskId)
      } catch {
        // 忽略取消错误
      }
    }
    cleanup()
    setState((prev) => ({
      ...prev,
      phase: 'idle',
      isStreaming: false,
    }))
  }, [state.taskId, cleanup])

  // 重置状态
  const reset = useCallback(() => {
    cleanup()
    setState({
      text: '',
      phase: 'idle',
      auditReport: null,
      retrievedContext: null,
      branchOptions: null,
      branchChapterPlanId: null,
      plotDuplicationWarning: null,
      hookRotationWarning: null,
      entitiesFound: null,
      teleportWarning: null,
      isStreaming: false,
      error: null,
      taskId: null,
    })
  }, [cleanup])

  return {
    ...state,
    startGeneration,
    cancelGeneration,
    reset,
  }
}
