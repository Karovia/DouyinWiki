/**
 * Settings tRPC Router
 * LLM Provider CRUD + App Settings
 */
import { router, publicProcedure } from './trpc';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { eq, and, desc } from 'drizzle-orm';
import { llmProviders, appSettings } from '../db/schema';
import { encryptApiKey, decryptApiKey } from '../utils/crypto';

// ── Input Schemas ──────────────────────────────────────────────

const workspaceIdSchema = z.string().default('ws_default');

const createProviderSchema = z.object({
  workspaceId: workspaceIdSchema,
  name: z.string().min(1).max(100),
  providerType: z.string().default('openai_compatible'),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  defaultTextModel: z.string().min(1),
  defaultVisionModel: z.string().optional(),
  defaultVideoModel: z.string().optional(),
  capabilities: z.string().default('text,vision'),
  setDefault: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

const updateProviderSchema = z.object({
  id: z.string(),
  workspaceId: workspaceIdSchema,
  name: z.string().min(1).max(100).optional(),
  providerType: z.string().optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  defaultTextModel: z.string().min(1).optional(),
  defaultVisionModel: z.string().optional(),
  defaultVideoModel: z.string().optional(),
  capabilities: z.string().optional(),
  enabled: z.boolean().optional(),
});

const providerIdSchema = z.object({
  id: z.string(),
  workspaceId: workspaceIdSchema,
});

const setDefaultSchema = z.object({
  id: z.string(),
  workspaceId: workspaceIdSchema,
});

const testProviderSchema = z.object({
  id: z.string(),
  workspaceId: workspaceIdSchema,
});

// ── Helper: 序列化 provider 为响应格式（隐藏 apiKey）────────────

function serializeProvider(row: typeof llmProviders.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    providerType: row.providerType,
    baseUrl: row.baseUrl,
    hasApiKey: !!row.apiKeyEncrypted,
    defaultTextModel: row.defaultTextModel,
    defaultVisionModel: row.defaultVisionModel,
    defaultVideoModel: row.defaultVideoModel,
    capabilities: row.capabilities,
    isDefault: row.isDefault,
    enabled: row.enabled,
    createdAt: row.createdAt?.getTime() ?? null,
    updatedAt: row.updatedAt?.getTime() ?? null,
  };
}

// ── Router ─────────────────────────────────────────────────────

export const settingsRouter = router({
  providers: router({
    /**
     * 列出 workspace 下的所有 provider
     * 不返回完整 apiKey，只返回 hasApiKey 布尔值
     */
    list: publicProcedure
      .input(z.object({ workspaceId: workspaceIdSchema }))
      .query(async (opts) => {
        const { workspaceId } = opts.input;
        const { ctx } = opts;

        const rows = await ctx.db
          .select()
          .from(llmProviders)
          .where(eq(llmProviders.workspaceId, workspaceId))
          .orderBy(desc(llmProviders.createdAt));

        return {
          items: rows.map(serializeProvider),
        };
      }),

    /**
     * 创建 provider，加密存储 apiKey
     * 如果 setDefault 为 true，将其他 provider 的 isDefault 设为 false
     */
    create: publicProcedure
      .input(createProviderSchema)
      .mutation(async (opts) => {
        const input = opts.input;
        const { ctx } = opts;

        const id = nanoid();
        const now = new Date();

        await ctx.db.transaction(async (tx) => {
          if (input.setDefault) {
            await tx
              .update(llmProviders)
              .set({ isDefault: false })
              .where(eq(llmProviders.workspaceId, input.workspaceId));
          }

          await tx.insert(llmProviders).values({
            id,
            workspaceId: input.workspaceId,
            name: input.name,
            providerType: input.providerType,
            baseUrl: input.baseUrl,
            apiKeyEncrypted: encryptApiKey(input.apiKey),
            defaultTextModel: input.defaultTextModel,
            defaultVisionModel: input.defaultVisionModel ?? null,
            defaultVideoModel: input.defaultVideoModel ?? null,
            capabilities: input.capabilities,
            isDefault: input.setDefault,
            enabled: input.enabled,
            createdAt: now,
            updatedAt: now,
          });
        });

        const [row] = await ctx.db
          .select()
          .from(llmProviders)
          .where(eq(llmProviders.id, id))
          .limit(1);

        return { provider: row ? serializeProvider(row) : null };
      }),

    /**
     * 更新 provider
     * apiKey 为空或不传时不覆盖旧 key
     */
    update: publicProcedure
      .input(updateProviderSchema)
      .mutation(async (opts) => {
        const input = opts.input;
        const { ctx } = opts;

        const [existing] = await ctx.db
          .select()
          .from(llmProviders)
          .where(
            and(
              eq(llmProviders.id, input.id),
              eq(llmProviders.workspaceId, input.workspaceId)
            )
          )
          .limit(1);

        if (!existing) {
          throw new Error('Provider 不存在');
        }

        const updateData: Partial<typeof llmProviders.$inferInsert> = {
          updatedAt: new Date(),
        };

        if (input.name !== undefined) updateData.name = input.name;
        if (input.providerType !== undefined) updateData.providerType = input.providerType;
        if (input.baseUrl !== undefined) updateData.baseUrl = input.baseUrl;
        if (input.apiKey !== undefined && input.apiKey.length > 0) {
          updateData.apiKeyEncrypted = encryptApiKey(input.apiKey);
        }
        if (input.defaultTextModel !== undefined) updateData.defaultTextModel = input.defaultTextModel;
        if (input.defaultVisionModel !== undefined) updateData.defaultVisionModel = input.defaultVisionModel ?? null;
        if (input.defaultVideoModel !== undefined) updateData.defaultVideoModel = input.defaultVideoModel ?? null;
        if (input.capabilities !== undefined) updateData.capabilities = input.capabilities;
        if (input.enabled !== undefined) updateData.enabled = input.enabled;

        await ctx.db
          .update(llmProviders)
          .set(updateData)
          .where(eq(llmProviders.id, input.id));

        const [row] = await ctx.db
          .select()
          .from(llmProviders)
          .where(eq(llmProviders.id, input.id))
          .limit(1);

        return { provider: row ? serializeProvider(row) : null };
      }),

    /**
     * 删除 provider
     * 如果删除的是默认 provider，自动选择另一个 enabled provider 作为默认
     */
    delete: publicProcedure
      .input(providerIdSchema)
      .mutation(async (opts) => {
        const { id, workspaceId } = opts.input;
        const { ctx } = opts;

        const [existing] = await ctx.db
          .select()
          .from(llmProviders)
          .where(
            and(
              eq(llmProviders.id, id),
              eq(llmProviders.workspaceId, workspaceId)
            )
          )
          .limit(1);

        if (!existing) {
          throw new Error('Provider 不存在');
        }

        await ctx.db.transaction(async (tx) => {
          await tx
            .delete(llmProviders)
            .where(eq(llmProviders.id, id));

          if (existing.isDefault) {
            const [nextDefault] = await tx
              .select()
              .from(llmProviders)
              .where(
                and(
                  eq(llmProviders.workspaceId, workspaceId),
                  eq(llmProviders.enabled, true)
                )
              )
              .orderBy(desc(llmProviders.createdAt))
              .limit(1);

            if (nextDefault) {
              await tx
                .update(llmProviders)
                .set({ isDefault: true })
                .where(eq(llmProviders.id, nextDefault.id));
            }
          }
        });

        return { success: true };
      }),

    /**
     * 设置默认 provider
     * 同一 workspace 下只能有一个默认
     */
    setDefault: publicProcedure
      .input(setDefaultSchema)
      .mutation(async (opts) => {
        const { id, workspaceId } = opts.input;
        const { ctx } = opts;

        const [existing] = await ctx.db
          .select()
          .from(llmProviders)
          .where(
            and(
              eq(llmProviders.id, id),
              eq(llmProviders.workspaceId, workspaceId)
            )
          )
          .limit(1);

        if (!existing) {
          throw new Error('Provider 不存在');
        }

        await ctx.db.transaction(async (tx) => {
          await tx
            .update(llmProviders)
            .set({ isDefault: false })
            .where(eq(llmProviders.workspaceId, workspaceId));

          await tx
            .update(llmProviders)
            .set({ isDefault: true })
            .where(eq(llmProviders.id, id));
        });

        return { success: true };
      }),

    /**
     * 测试连接
     * 调用 ${baseUrl}/v1/chat/completions，发送轻量 prompt
     * 成功返回耗时，失败返回错误（不泄露 apiKey）
     */
    test: publicProcedure
      .input(testProviderSchema)
      .mutation(async (opts) => {
        const { id, workspaceId } = opts.input;
        const { ctx } = opts;

        const [provider] = await ctx.db
          .select()
          .from(llmProviders)
          .where(
            and(
              eq(llmProviders.id, id),
              eq(llmProviders.workspaceId, workspaceId)
            )
          )
          .limit(1);

        if (!provider) {
          throw new Error('Provider 不存在');
        }

        let apiKey: string;
        try {
          apiKey = decryptApiKey(provider.apiKeyEncrypted);
        } catch {
          return {
            success: false,
            error: 'API Key 解密失败，请检查 APP_SECRET 配置',
          };
        }

        const startTime = Date.now();

        try {
          const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: provider.defaultTextModel,
              messages: [
                { role: 'user', content: 'Hi' },
              ],
              max_tokens: 5,
            }),
          });

          const elapsed = Date.now() - startTime;

          if (!response.ok) {
            const errorBody = await response.text();
            return {
              success: false,
              error: `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
            };
          }

          return {
            success: true,
            elapsedMs: elapsed,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '请求失败',
          };
        }
      }),

    /**
     * 获取模型列表（可选）
     * 调用 ${baseUrl}/v1/models
     */
    models: publicProcedure
      .input(providerIdSchema)
      .query(async (opts) => {
        const { id, workspaceId } = opts.input;
        const { ctx } = opts;

        const [provider] = await ctx.db
          .select()
          .from(llmProviders)
          .where(
            and(
              eq(llmProviders.id, id),
              eq(llmProviders.workspaceId, workspaceId)
            )
          )
          .limit(1);

        if (!provider) {
          throw new Error('Provider 不存在');
        }

        let apiKey: string;
        try {
          apiKey = decryptApiKey(provider.apiKeyEncrypted);
        } catch {
          return {
            success: false,
            error: 'API Key 解密失败，请检查 APP_SECRET 配置',
            models: [],
          };
        }

        try {
          const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/v1/models`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          });

          if (!response.ok) {
            const errorBody = await response.text();
            return {
              success: false,
              error: `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
              models: [],
            };
          }

          const data = await response.json() as { data?: Array<{ id: string }> };
          return {
            success: true,
            models: (data.data ?? []).map((m) => m.id),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '请求失败',
            models: [],
          };
        }
      }),
  }),

  /**
   * 获取应用设置
   */
  get: publicProcedure
    .input(z.object({ key: z.string() }))
    .query(async (opts) => {
      const { key } = opts.input;
      const { ctx } = opts;

      const rows = await ctx.db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .limit(1);

      return { value: rows[0]?.value ?? null };
    }),

  /**
   * 设置应用设置
   */
  set: publicProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(async (opts) => {
      const { key, value } = opts.input;
      const { ctx } = opts;

      await ctx.db
        .insert(appSettings)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value, updatedAt: new Date() },
        });

      return { success: true };
    }),
});
