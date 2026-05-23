import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * 工作区表（MVP 阶段使用默认 workspace）
 */
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

/**
 * 深度研究文档表
 */
export const researchDocs = sqliteTable('research_docs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  videoId: text('video_id').notNull(),

  title: text('title').notNull(),
  topic: text('topic').notNull(),
  content: text('content').notNull(), // Markdown 内容

  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

/**
 * 视频主数据表
 */
export const videos = sqliteTable('videos', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),

  // 平台信息
  platform: text('platform').notNull().default('douyin'),
  platformVideoId: text('platform_video_id'),

  // 元数据
  title: text('title'),
  authorName: text('author_name'),
  authorId: text('author_id'),
  coverUrl: text('cover_url'),
  coverFileKey: text('cover_file_key'), // 对象存储 key（持久化）
  duration: integer('duration'), // 秒
  description: text('description'),
  shareUrl: text('share_url').notNull(),

  // 视频文件
  videoFileKey: text('video_file_key'), // 对象存储 key（持久化）

  // 内容产物
  aiSummary: text('ai_summary'),
  tags: text('tags'), // JSON 数组

  // 状态
  status: text('status').notNull().default('created'),
  graphStatus: text('graph_status').notNull().default('pending'),

  // 幂等键
  normalizedUrlHash: text('normalized_url_hash'),

  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

/**
 * MTA 菜谱记录表
 */
export const mtaRecipes = sqliteTable('mta_recipes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  videoId: text('video_id').notNull(),

  // 分类：training / recipes / planning / research
  category: text('category').notNull().default('recipes'),

  // 视频快照
  videoTitle: text('video_title'),
  coverUrl: text('cover_url'),

  // 菜谱内容（JSON）
  dishName: text('dish_name').notNull(),
  servings: text('servings'),
  ingredients: text('ingredients').notNull(), // JSON 数组
  steps: text('steps').notNull(), // JSON 数组
  cooldown: text('cooldown'), // JSON 数组（training 类型用）

  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

/**
 * 导入任务表（状态机驱动）
 */
export const ingestionJobs = sqliteTable('ingestion_jobs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  videoId: text('video_id'),

  // 输入
  shareUrl: text('share_url').notNull(),

  // 幂等键
  idempotencyKey: text('idempotency_key').notNull(),

  // 状态机
  status: text('status').notNull().default('created'),
  currentStep: text('current_step'),
  progress: integer('progress').notNull().default(0), // 0-100

  // 错误信息
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  retryCount: integer('retry_count').notNull().default(0),

  // 时间戳
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

/**
 * 转写文本表
 */
export const transcripts = sqliteTable('transcripts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  videoId: text('video_id').notNull(),

  source: text('source').notNull(), // asr / subtitle / manual_note / ocr
  modelName: text('model_name'),
  content: text('content').notNull(),

  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

/**
 * 摘要表
 */
export const summaries = sqliteTable('summaries', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  videoId: text('video_id').notNull(),

  content: text('content').notNull(),
  promptVersion: text('prompt_version').notNull().default('v1'),
  inputHash: text('input_hash'),
  outputSchemaVersion: text('output_schema_version').notNull().default('v1'),
  modelName: text('model_name'),

  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

/**
 * LLM Provider 配置表
 */
export const llmProviders = sqliteTable('llm_providers', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  providerType: text('provider_type').notNull().default('openai_compatible'),
  baseUrl: text('base_url').notNull(),
  apiKeyEncrypted: text('api_key_encrypted').notNull(),
  defaultTextModel: text('default_text_model').notNull(),
  defaultVisionModel: text('default_vision_model'),
  defaultVideoModel: text('default_video_model'),
  capabilities: text('capabilities').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

/**
 * 应用设置表（key-value 存储）
 */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
