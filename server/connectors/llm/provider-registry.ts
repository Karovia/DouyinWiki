/**
 * LLM Provider 注册表
 * 从数据库读取 llm_providers 配置，提供默认 provider 查询
 */
import { eq, and } from 'drizzle-orm';
import { db } from '../../db/index';
import { llmProviders } from '../../db/schema';
import { decryptApiKey } from '../../utils/crypto';
import type { LlmProviderConfig } from './types';

function parseCapabilities(capStr: string): string[] {
  return capStr.split(',').map((c) => c.trim()).filter(Boolean);
}

function rowToConfig(row: typeof llmProviders.$inferSelect): LlmProviderConfig {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    providerType: row.providerType,
    baseUrl: row.baseUrl,
    apiKey: decryptApiKey(row.apiKeyEncrypted),
    defaultTextModel: row.defaultTextModel,
    defaultVisionModel: row.defaultVisionModel,
    defaultVideoModel: row.defaultVideoModel,
    capabilities: parseCapabilities(row.capabilities),
    isDefault: row.isDefault,
    enabled: row.enabled,
  };
}

/**
 * 获取 workspace 下的默认 provider
 */
export async function getDefaultProvider(workspaceId: string): Promise<LlmProviderConfig> {
  const rows = await db
    .select()
    .from(llmProviders)
    .where(
      and(
        eq(llmProviders.workspaceId, workspaceId),
        eq(llmProviders.isDefault, true),
        eq(llmProviders.enabled, true),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    // 如果没有默认 provider，尝试找任意一个启用的 provider
    const fallbackRows = await db
      .select()
      .from(llmProviders)
      .where(
        and(
          eq(llmProviders.workspaceId, workspaceId),
          eq(llmProviders.enabled, true),
        ),
      )
      .limit(1);

    if (fallbackRows.length === 0) {
      throw new Error(
        `未找到 LLM Provider 配置。请先前往设置页面配置 Provider（workspace: ${workspaceId}）。`,
      );
    }

    return rowToConfig(fallbackRows[0]);
  }

  return rowToConfig(rows[0]);
}

/**
 * 根据 ID 获取 provider
 */
export async function getProviderById(
  workspaceId: string,
  providerId: string,
): Promise<LlmProviderConfig> {
  const rows = await db
    .select()
    .from(llmProviders)
    .where(
      and(
        eq(llmProviders.workspaceId, workspaceId),
        eq(llmProviders.id, providerId),
        eq(llmProviders.enabled, true),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    throw new Error(
      `Provider ${providerId} 不存在或已禁用（workspace: ${workspaceId}）。`,
    );
  }

  return rowToConfig(rows[0]);
}
