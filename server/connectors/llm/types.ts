/**
 * 项目自己的 LLM 类型定义
 * 不依赖任何外部 SDK
 */

export type LlmRole = 'system' | 'user' | 'assistant';

export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
  | { type: 'video_url'; video_url: { url: string; fps?: number } };

export interface LlmMessage {
  role: LlmRole;
  content: string | LlmContentPart[];
}

export interface LlmInvokeOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  capability?: 'text' | 'vision' | 'video';
}

export interface LlmInvokeResult {
  content: string;
  modelName: string;
  providerId: string;
}

/**
 * Provider 配置（从数据库读取后解密）
 */
export interface LlmProviderConfig {
  id: string;
  workspaceId: string;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  defaultTextModel: string;
  defaultVisionModel: string | null;
  defaultVideoModel: string | null;
  capabilities: string[];
  isDefault: boolean;
  enabled: boolean;
}
