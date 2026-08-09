/**
 * OpenAI-compatible LLM 客户端
 * 支持流式/非流式调用，支持项目级配置覆盖
 */
import OpenAI from 'openai';
import type { LlmConfig } from '../types.js';

/** 默认配置从环境变量读取 */
const DEFAULT_BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const DEFAULT_API_KEY = process.env.LLM_API_KEY || '';
const DEFAULT_MODEL = process.env.LLM_MODEL || 'gpt-4o';

/**
 * 主备模型自动切换（架构升级后续增强）
 * 环境变量：
 * - LLM_FALLBACK_MODELS：逗号分隔的备用模型清单（首选失败后逐个尝试）
 * - LLM_FALLBACK_BASE_URL / LLM_FALLBACK_API_KEY：备用供应商（可选，不设则同供应商换模型）
 * 动态读 env（settings 路由运行时可能改写 process.env）
 */
function getFallbackConfig(): { baseUrl: string; apiKey: string; models: string[] } {
  const models = (process.env.LLM_FALLBACK_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    baseUrl: process.env.LLM_FALLBACK_BASE_URL || process.env.LLM_BASE_URL || DEFAULT_BASE_URL,
    apiKey: process.env.LLM_FALLBACK_API_KEY || process.env.LLM_API_KEY || '',
    models,
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Token用量信息 */
export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  /** 项目级LLM配置覆盖 */
  configOverride?: LlmConfig;
  /** 是否启用思考模式（默认关闭以节省token） */
  thinking?: boolean;
  /** token用量回调（用于统计消耗） */
  onUsage?: (usage: UsageInfo, model: string) => void;
  /** 请求超时毫秒数（默认120000） */
  timeout?: number;
}

/**
 * 获取模型名称
 */
function getModel(configOverride?: LlmConfig): string {
  return configOverride?.model || DEFAULT_MODEL;
}

/**
 * 单次调用（不含容错切换），供主备切换循环复用
 */
async function callOnce(
  messages: ChatMessage[],
  options: ChatOptions,
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<string> {
  const client = new OpenAI({
    baseURL: baseUrl,
    apiKey,
    timeout: options.timeout ?? 120000,
    maxRetries: 0, // 我们自己管理重试
  });
  const response = await client.chat.completions.create({
    model,
    messages: messages as any,
    temperature: options.temperature ?? options.configOverride?.temperature ?? 0.8,
    max_tokens: options.maxTokens ?? options.configOverride?.maxTokens ?? 8192,
    top_p: options.topP ?? 1,
    stop: options.stop,
    // DeepSeek思考模式：默认关闭以节省token
    thinking: { type: options.thinking ? 'enabled' : 'disabled' },
  } as any);

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('LLM返回空内容');
  }

  // 上报token用量
  if (options.onUsage && response.usage) {
    options.onUsage({
      promptTokens: response.usage.prompt_tokens || 0,
      completionTokens: response.usage.completion_tokens || 0,
      totalTokens: response.usage.total_tokens || 0,
    }, model);
  }

  return content;
}

/**
 * 错误分类：认证失败不应切备用（同供应商 key 问题），其余均可尝试切换
 */
function isAuthError(error: any): boolean {
  return error?.status === 401;
}

/**
 * 非流式聊天补全（首选模型失败后自动切换备用模型）
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const primaryModel = getModel(options.configOverride);
  const primaryBaseUrl = options.configOverride?.baseUrl || DEFAULT_BASE_URL;
  const primaryKey = options.configOverride?.apiKey || DEFAULT_API_KEY;

  // 首选失败后尝试备用模型（仅当首选走默认供应商时才启用同供应商换模型，
  // 避免项目级自定义供应商场景下误切到全局备用）
  const useGlobalFallback = !options.configOverride?.baseUrl;
  const fallback = getFallbackConfig();

  let lastError: any = null;

  // 1. 首选模型
  try {
    return await callOnce(messages, options, primaryBaseUrl, primaryKey, primaryModel);
  } catch (error: any) {
    lastError = error;
    if (isAuthError(error) || !useGlobalFallback || fallback.models.length === 0) {
      throw classifyError(error);
    }
    console.warn(`[llm-fallback] 首选模型 ${primaryModel} 调用失败（${error.message}），尝试备用模型…`);
  }

  // 2. 备用模型逐个尝试
  for (const fbModel of fallback.models) {
    try {
      const content = await callOnce(messages, options, fallback.baseUrl, fallback.apiKey, fbModel);
      console.warn(`[llm-fallback] 已切换到备用模型 ${fbModel} 成功`);
      return content;
    } catch (error: any) {
      lastError = error;
      console.warn(`[llm-fallback] 备用模型 ${fbModel} 也失败：${error.message}`);
      if (isAuthError(error)) break; // 备用供应商认证失败没必要继续
    }
  }

  throw classifyError(lastError);
}

/**
 * 错误分类转友好文案
 */
function classifyError(error: any): Error {
  if (error.status === 429) {
    return new Error(`LLM API 限流: ${error.message}`);
  }
  if (error.status === 401) {
    return new Error(`LLM API 认证失败，请检查API Key配置`);
  }
  if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    return new Error(`LLM API 请求超时`);
  }
  return new Error(`LLM调用失败: ${error.message}`);
}

/**
 * 流式聊天补全，返回 ReadableStream（首选模型失败后自动切换备用模型）
 */
export async function streamChatCompletion(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ReadableStream<string>> {
  const primaryModel = getModel(options.configOverride);
  const primaryBaseUrl = options.configOverride?.baseUrl || DEFAULT_BASE_URL;
  const primaryKey = options.configOverride?.apiKey || DEFAULT_API_KEY;
  const useGlobalFallback = !options.configOverride?.baseUrl;
  const fallback = getFallbackConfig();

  /** 单模型发起流式请求 */
  const createStream = async (baseUrl: string, apiKey: string, model: string) => {
    const client = new OpenAI({
      baseURL: baseUrl,
      apiKey,
      timeout: options.timeout ?? 120000,
      maxRetries: 0,
    });
    return client.chat.completions.create({
      model,
      messages: messages as any,
      temperature: options.temperature ?? options.configOverride?.temperature ?? 0.8,
      max_tokens: options.maxTokens ?? options.configOverride?.maxTokens ?? 8192,
      top_p: options.topP ?? 1,
      stop: options.stop,
      stream: true,
      // DeepSeek思考模式：默认关闭以节省token
      thinking: { type: options.thinking ? 'enabled' : 'disabled' },
    } as any);
  };

  const wrapStream = (stream: unknown): ReadableStream<string> => {
    const asyncStream = stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    return new ReadableStream<string>({
      async start(controller) {
        try {
          for await (const chunk of asyncStream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              controller.enqueue(content);
            }
          }
          controller.close();
        } catch (error: any) {
          controller.error(new Error(`流式读取中断: ${error.message}`));
        }
      },
    });
  };

  let lastError: any = null;

  // 1. 首选模型
  try {
    const stream = await createStream(primaryBaseUrl, primaryKey, primaryModel);
    return wrapStream(stream);
  } catch (error: any) {
    lastError = error;
    if (isAuthError(error) || !useGlobalFallback || fallback.models.length === 0) {
      throw classifyStreamError(error);
    }
    console.warn(`[llm-fallback] 流式首选模型 ${primaryModel} 失败（${error.message}），尝试备用模型…`);
  }

  // 2. 备用模型逐个尝试
  for (const fbModel of fallback.models) {
    try {
      const stream = await createStream(fallback.baseUrl, fallback.apiKey, fbModel);
      console.warn(`[llm-fallback] 流式已切换到备用模型 ${fbModel}`);
      return wrapStream(stream);
    } catch (error: any) {
      lastError = error;
      console.warn(`[llm-fallback] 流式备用模型 ${fbModel} 也失败：${error.message}`);
      if (isAuthError(error)) break;
    }
  }

  throw classifyStreamError(lastError);
}

function classifyStreamError(error: any): Error {
  if (error.status === 429) {
    return new Error(`LLM API 限流: ${error.message}`);
  }
  if (error.status === 401) {
    return new Error(`LLM API 认证失败，请检查API Key配置`);
  }
  return new Error(`LLM流式调用失败: ${error.message}`);
}

/**
 * 估算文本的token数
 * 中文约1.5字/token，英文约4字符/token
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // 统计中文字符数
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const otherChars = text.length - chineseChars;
  // 中文按1.5字/token，其他按4字符/token
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 测试LLM连接是否正常
 */
export async function testLlmConnection(configOverride?: LlmConfig): Promise<{
  success: boolean;
  model: string;
  message: string;
  latencyMs?: number;
}> {
  const start = Date.now();
  try {
    const result = await chatCompletion(
      [{ role: 'user', content: '请回复"连接成功"四个字。' }],
      { maxTokens: 20, configOverride }
    );
    return {
      success: true,
      model: getModel(configOverride),
      message: `连接成功，模型响应: ${result.slice(0, 50)}`,
      latencyMs: Date.now() - start,
    };
  } catch (error: any) {
    return {
      success: false,
      model: getModel(configOverride),
      message: error.message,
      latencyMs: Date.now() - start,
    };
  }
}
