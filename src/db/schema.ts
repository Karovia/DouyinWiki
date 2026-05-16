import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const videos = sqliteTable('videos', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().default('default'),
  platform: text('platform').notNull().default('douyin'),
  platformVideoId: text('platform_video_id'),
  shareUrl: text('share_url').notNull(),
  normalizedUrlHash: text('normalized_url_hash').notNull(),
  title: text('title'),
  description: text('description'),
  authorName: text('author_name'),
  authorId: text('author_id'),
  coverUrl: text('cover_url'),
  duration: integer('duration'),
  tags: text('tags'), // JSON array
  aiSummary: text('ai_summary'),
  aiTags: text('ai_tags'), // JSON array
  viewCount: integer('view_count'),
  likeCount: integer('like_count'),
  status: text('status').notNull().default('pending'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  graphStatus: text('graph_status').notNull().default('pending'),
  graphError: text('graph_error'),
  graphBuiltAt: integer('graph_built_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('idx_videos_workspace_url').on(table.workspaceId, table.normalizedUrlHash),
]);

export const ingestionJobs = sqliteTable('ingestion_jobs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().default('default'),
  videoId: text('video_id').references(() => videos.id),
  shareUrl: text('share_url').notNull(),
  normalizedUrlHash: text('normalized_url_hash').notNull(),
  status: text('status').notNull().default('created'),
  step: text('step'),
  progress: integer('progress').default(0),
  retryCount: integer('retry_count').default(0),
  maxRetries: integer('max_retries').default(3),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  nextRetryAt: integer('next_retry_at', { mode: 'timestamp' }),
  lastErrorAt: integer('last_error_at', { mode: 'timestamp' }),
  attemptedAt: integer('attempted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('idx_jobs_workspace_url').on(table.workspaceId, table.normalizedUrlHash),
]);

export const transcripts = sqliteTable('transcripts', {
  id: text('id').primaryKey(),
  videoId: text('video_id').notNull().references(() => videos.id),
  workspaceId: text('workspace_id').notNull().default('default'),
  source: text('source').notNull(), // 'asr' | 'subtitle' | 'manual_note' | 'ocr'
  modelName: text('model_name'),
  language: text('language').default('zh'),
  segments: text('segments'), // JSON: { start_ms, end_ms, text }[]
  rawText: text('raw_text'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('idx_transcripts_video_source').on(table.videoId, table.source),
]);

export const chunks = sqliteTable('chunks', {
  id: text('id').primaryKey(),
  videoId: text('video_id').notNull().references(() => videos.id),
  workspaceId: text('workspace_id').notNull().default('default'),
  contentType: text('content_type').notNull(), // 'transcript' | 'summary' | 'title' | 'note'
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  startTimeMs: integer('start_time_ms'),
  endTimeMs: integer('end_time_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('idx_chunks_video_type_idx').on(table.videoId, table.contentType, table.chunkIndex),
]);

export const embeddings = sqliteTable('embeddings', {
  id: text('id').primaryKey(),
  chunkId: text('chunk_id').notNull().references(() => chunks.id),
  videoId: text('video_id').notNull().references(() => videos.id),
  workspaceId: text('workspace_id').notNull().default('default'),
  modelName: text('model_name').notNull(),
  dimension: integer('dimension').notNull(),
  embedding: text('embedding').notNull(), // JSON array of floats
  contentHash: text('content_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('idx_embeddings_chunk_model').on(table.chunkId, table.modelName),
]);

export const graphNodes = sqliteTable('graph_nodes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  nodeType: text('node_type').notNull(), // 'video' | 'entity' | 'author'
  businessId: text('business_id').notNull(),
  canonicalKey: text('canonical_key'),
  label: text('label').notNull(),
  properties: text('properties'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('idx_graph_nodes_unique').on(table.workspaceId, table.nodeType, table.businessId),
  index('idx_graph_nodes_workspace_type').on(table.workspaceId, table.nodeType),
]);

export const graphEdges = sqliteTable('graph_edges', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  sourceNodeId: text('source_node_id').notNull(),
  targetNodeId: text('target_node_id').notNull(),
  relationType: text('relation_type').notNull(), // 'same_topic' | 'mentions'
  weight: real('weight').notNull().default(0.5),
  computedBy: text('computed_by').notNull(),
  evidence: text('evidence'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('idx_graph_edges_unique').on(
    table.workspaceId, table.sourceNodeId, table.targetNodeId, table.relationType
  ),
  index('idx_edges_source_type_weight').on(
    table.workspaceId, table.sourceNodeId, table.relationType, table.weight
  ),
  index('idx_edges_target_type_weight').on(
    table.workspaceId, table.targetNodeId, table.relationType, table.weight
  ),
]);

export const entityAliases = sqliteTable('entity_aliases', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  alias: text('alias').notNull(),
  canonicalNodeId: text('canonical_node_id').notNull(),
  source: text('source').notNull().default('auto_detected'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  index('idx_entity_aliases_lookup').on(table.workspaceId, table.alias),
  index('idx_entity_aliases_canonical').on(table.workspaceId, table.canonicalNodeId),
]);
