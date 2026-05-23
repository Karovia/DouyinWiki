/**
 * OpenAI-compatible Provider 实现
 * 调用 /v1/chat/completions 接口
 */
import type { LlmMessage, LlmInvokeOptions, LlmInvokeResult, LlmProviderConfig, LlmContentPart } from './types';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
  >;
}

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  model?: string;
}

/**
 * 将内部消息格式转换为 OpenAI-compatible 格式
 * - 过滤掉 video_url（除非 provider 支持 video）
 * - image_url 保持原样传递
 */
function formatMessages(
  messages: LlmMessage[],
  supportsVideo: boolean,
): OpenAIMessage[] {
  return messages.map((m) => {
    if (Array.isArray(m.content)) {
      const parts = m.content
        .filter((p: LlmContentPart) => {
          if (p.type === 'video_url') {
            return supportsVideo;
          }
          return true;
        })
        .map((p: LlmContentPart) => {
          if (p.type === 'text') {
            return { type: 'text' as const, text: p.text ?? '' };
          }
          if (p.type === 'image_url') {
            return {
              type: 'image_url' as const,
              image_url: {
                url: p.image_url.url,
                detail: p.image_url.detail,
              },
            };
          }
          return { type: 'text' as const, text: '' };
        });

      return {
        role: m.role,
        content: parts,
      };
    }

    return {
      role: m.role,
      content: m.content,
    };
  });
}

/**
 * 根据 capability 选择模型
 */
function selectModel(provider: LlmProviderConfig, options: LlmInvokeOptions): string {
  if (options.model) {
    return options.model;
  }

  switch (options.capability) {
    case 'vision':
      return provider.defaultVisionModel || provider.defaultTextModel;
    case 'video':
      return provider.defaultVideoModel || provider.defaultVisionModel || provider.defaultTextModel;
    case 'text':
    default:
      return provider.defaultTextModel;
  }
}

/**
 * 调用 OpenAI-compatible API
 */
export async function invoke(
  providerConfig: LlmProviderConfig,
  messages: LlmMessage[],
  options: LlmInvokeOptions = {},
): Promise<LlmInvokeResult> {
  const url = `${providerConfig.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

  const supportsVideo = providerConfig.capabilities.includes('video');
  const formattedMessages = formatMessages(messages, supportsVideo);
  const model = selectModel(providerConfig, options);

  const body: Record<string, unknown> = {
    model,
    messages: formattedMessages,
  };

  if (options.temperature !== undefined) {
    body.temperature = options.temperature;
  }

  if (options.maxTokens !== undefined) {
    body.max_tokens = options.maxTokens;
  }

  if (options.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${providerConfig.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as OpenAIResponse;

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM API returned empty content');
  }

  return {
    content,
    modelName: data.model || model,
    providerId: providerConfig.id,
  };
}
