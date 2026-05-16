import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const videos = sqliteTable('videos', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().default('default'),
  platform: text('platform').notNull().default('douyin'),
  platformVideoId: text('platform_video_id'),
  shareUrl: text('share_url').notNull(),
  normalizedUrlHash: text('normalized_url_hash').notNull().unique(),
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
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

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
