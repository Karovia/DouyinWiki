import { createDbClient, type DbClient } from '../../src/db';

/**
 * 创建测试用内存数据库，手动创建表结构（:memory: 数据库无法读取文件系统迁移）
 */
export async function createTestDb(): Promise<DbClient> {
  const testDb = createDbClient(':memory:');

  const client = (testDb as any).$client;

  // videos 表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'default',
      platform TEXT NOT NULL DEFAULT 'douyin',
      platform_video_id TEXT,
      share_url TEXT NOT NULL,
      normalized_url_hash TEXT NOT NULL,
      title TEXT,
      description TEXT,
      author_name TEXT,
      author_id TEXT,
      cover_url TEXT,
      duration INTEGER,
      tags TEXT,
      ai_summary TEXT,
      ai_tags TEXT,
      view_count INTEGER,
      like_count INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      error_code TEXT,
      error_message TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // ingestion_jobs 表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS ingestion_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'default',
      video_id TEXT REFERENCES videos(id),
      share_url TEXT NOT NULL,
      normalized_url_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      step TEXT,
      progress INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      error_code TEXT,
      error_message TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      next_retry_at INTEGER,
      last_error_at INTEGER,
      attempted_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // 创建唯一索引（幂等键）
  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_workspace_url
    ON videos(workspace_id, normalized_url_hash)
  `);

  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_workspace_url
    ON ingestion_jobs(workspace_id, normalized_url_hash)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_jobs_workspace_status
    ON ingestion_jobs(workspace_id, status)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_jobs_video
    ON ingestion_jobs(video_id)
  `);

  return testDb;
}

/**
 * 清理测试数据库中的所有数据（保留表结构）
 */
export async function cleanTestDb(testDb: DbClient): Promise<void> {
  const client = (testDb as any).$client;
  await client.execute(`DELETE FROM ingestion_jobs`);
  await client.execute(`DELETE FROM videos`);
}
