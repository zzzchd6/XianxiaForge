/**
 * 双引擎错误类型（PRD v1.3 §10.1.6 错误码映射用）
 * 路由层根据 EngineError.code 映射 HTTP 状态码与错误码字符串。
 */

export type EngineErrorCode =
  | 'INVALID_CONFIG'          // 400
  | 'LLM_UNAVAILABLE'         // 502
  | 'LLM_OUTPUT_PARSE_ERROR'  // 422
  | 'VALIDATION_FAILED'       // 200（返回当前最优结果+失败项清单）
  | 'RATE_LIMITED'            // 429
  | 'NOT_FOUND';              // 404（request_id 不存在）

export class EngineError extends Error {
  code: EngineErrorCode;
  status: number;
  /** 附加数据（如解析失败时的原始输出、校验失败时的最优结果） */
  data?: any;

  constructor(code: EngineErrorCode, status: number, message: string, data?: any) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

/** 将未知错误归一为 EngineError（LLM 调用错误按文案分类） */
export function toEngineError(error: any): EngineError {
  if (error instanceof EngineError) return error;
  const msg: string = error?.message || String(error);
  if (msg.includes('限流')) {
    return new EngineError('RATE_LIMITED', 429, '生成请求过于频繁，已排队，请稍后重试');
  }
  if (msg.includes('无法从LLM回复中解析JSON')) {
    return new EngineError('LLM_OUTPUT_PARSE_ERROR', 422, msg);
  }
  if (msg.includes('超时') || msg.includes('认证失败') || msg.includes('LLM调用失败') || msg.includes('LLM返回空内容')) {
    return new EngineError('LLM_UNAVAILABLE', 502, msg);
  }
  return new EngineError('LLM_UNAVAILABLE', 502, msg);
}
