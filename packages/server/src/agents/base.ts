/**
 * Agent基类 - 封装LLM调用、JSON解析、重试逻辑
 */
import { chatCompletion, streamChatCompletion, type ChatMessage, type ChatOptions } from '../llm/client.js';

export abstract class BaseAgent {
  protected name: string;
  protected maxRetries: number;

  constructor(name: string, maxRetries: number = 3) {
    this.name = name;
    this.maxRetries = maxRetries;
  }

  /**
   * 构建消息数组
   */
  protected buildMessages(system: string, user: string): ChatMessage[] {
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  /**
   * 从LLM回复中提取JSON对象
   * 支持 ```json ... ``` 代码块和裸JSON
   */
  protected parseJsonResponse<T = any>(text: string): T {
    // 尝试从markdown代码块中提取
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim()) as T;
      } catch {
        // 继续尝试其他方式
      }
    }

    // 尝试直接解析整个文本
    try {
      return JSON.parse(text.trim()) as T;
    } catch {
      // 继续尝试
    }

    // 尝试找到第一个 { 和最后一个 } 之间的内容
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        // 继续尝试
      }
    }

    // 尝试找到第一个 [ 和最后一个 ] 之间的内容
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(text.slice(firstBracket, lastBracket + 1)) as T;
      } catch {
        // 解析失败
      }
    }

    throw new Error(`[${this.name}] 无法从LLM回复中解析JSON: ${text.slice(0, 200)}...`);
  }

  /**
   * 带重试的LLM调用
   */
  protected async callWithRetry(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.log(`第${attempt}次调用LLM...`);
        const result = await chatCompletion(messages, options);
        return result;
      } catch (error: any) {
        lastError = error;
        this.log(`第${attempt}次调用失败: ${error.message}`, 'warn');

        // 如果是认证错误，不重试
        if (error.message.includes('认证失败')) {
          break;
        }

        // 限流时等待后重试
        if (error.message.includes('限流') && attempt < this.maxRetries) {
          const waitMs = attempt * 2000;
          this.log(`等待${waitMs}ms后重试...`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
    }

    throw new Error(`[${this.name}] LLM调用失败（已重试${this.maxRetries}次）: ${lastError?.message}`);
  }

  /**
   * 带重试的流式LLM调用
   */
  protected async streamWithRetry(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<ReadableStream<string>> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.log(`第${attempt}次流式调用LLM...`);
        return await streamChatCompletion(messages, options);
      } catch (error: any) {
        lastError = error;
        this.log(`第${attempt}次流式调用失败: ${error.message}`, 'warn');

        if (error.message.includes('认证失败')) {
          break;
        }

        if (error.message.includes('限流') && attempt < this.maxRetries) {
          const waitMs = attempt * 2000;
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
    }

    throw new Error(`[${this.name}] 流式LLM调用失败: ${lastError?.message}`);
  }

  /**
   * 日志记录
   */
  protected log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${this.name}]`;
    switch (level) {
      case 'info':
        console.log(`${prefix} ${message}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}`);
        break;
      case 'error':
        console.error(`${prefix} ${message}`);
        break;
    }
  }
}
