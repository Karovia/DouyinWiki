/**
 * LLM 业务调用入口
 * 封装 provider 选择和调用逻辑
 */
import { getDefaultProvider } from './provider-registry';
import { invoke as invokeOpenAICompatible } from './openai-compatible-provider';
import type { LlmMessage, LlmInvokeOptions, LlmInvokeResult } from './types';

/**
 * 使用默认 provider 调用 LLM
 */
export async function invokeDefaultLlm(
  workspaceId: string,
  messages: LlmMessage[],
  options: LlmInvokeOptions = {},
): Promise<LlmInvokeResult> {
  const provider = await getDefaultProvider(workspaceId);

  switch (provider.providerType) {
    case 'openai_compatible':
      return invokeOpenAICompatible(provider, messages, options);
    default:
      // 默认使用 openai_compatible
      return invokeOpenAICompatible(provider, messages, options);
  }
}
