import { createDbClient, type DbClient } from '../../src/db';
import { mkdtempSync, unlinkSync, rmdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dbCounter = 0;

/**
 * 创建测试用独立数据库（使用临时文件，每个测试完全隔离）
 * 使用临时文件而非 :memory:，因为 libsql 的 :memory: 在 transaction 中会使用不同连接导致表不可见
 */
export async function createTestDb(): Promise<DbClient> {
  const dbName = `testdb_${Date.now()}_${++dbCounter}`;
  const tmpDir = mkdtempSync(join(tmpdir(), 'douyin-wiki-test-'));
  const dbPath = join(tmpDir, `${dbName}.db`);
  const testDb = createDbClient(`file:${dbPath}`);

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

  // transcripts 表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS transcripts (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id),
      workspace_id TEXT NOT NULL DEFAULT 'default',
      source TEXT NOT NULL,
      model_name TEXT,
      language TEXT DEFAULT 'zh',
      segments TEXT,
      raw_text TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);

  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transcripts_video_source
    ON transcripts(video_id, source)
  `);

  // chunks 表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id),
      workspace_id TEXT NOT NULL DEFAULT 'default',
      content_type TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      start_time_ms INTEGER,
      end_time_ms INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_video_type_idx
    ON chunks(video_id, content_type, chunk_index)
  `);

  // embeddings 表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS embeddings (
      id TEXT PRIMARY KEY,
      chunk_id TEXT NOT NULL REFERENCES chunks(id),
      video_id TEXT NOT NULL REFERENCES videos(id),
      workspace_id TEXT NOT NULL DEFAULT 'default',
      model_name TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      embedding TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_chunk_model
    ON embeddings(chunk_id, model_name)
  `);

  // FTS5 virtual table (with content=chunks mapping for external content + metadata columns)
  await client.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
      content,
      chunk_id,
      video_id,
      workspace_id,
      content_type,
      tokenize='porter unicode61'
    )
  `);

  // Triggers to sync chunks table to fts_chunks
  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS fts_chunks_insert AFTER INSERT ON chunks BEGIN
      INSERT INTO fts_chunks(rowid, content, chunk_id, video_id, workspace_id, content_type)
      VALUES (new.rowid, new.content, new.id, new.video_id, new.workspace_id, new.content_type);
    END
  `);

  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS fts_chunks_delete AFTER DELETE ON chunks BEGIN
      INSERT INTO fts_chunks(fts_chunks, rowid, content, chunk_id, video_id, workspace_id, content_type)
      VALUES ('delete', old.rowid, old.content, old.id, old.video_id, old.workspace_id, old.content_type);
    END
  `);

  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS fts_chunks_update AFTER UPDATE ON chunks BEGIN
      INSERT INTO fts_chunks(fts_chunks, rowid, content, chunk_id, video_id, workspace_id, content_type)
      VALUES ('delete', old.rowid, old.content, old.id, old.video_id, old.workspace_id, old.content_type);
      INSERT INTO fts_chunks(rowid, content, chunk_id, video_id, workspace_id, content_type)
      VALUES (new.rowid, new.content, new.id, new.video_id, new.workspace_id, new.content_type);
    END
  `);

  // 将临时目录路径附加到 testDb 上，便于后续清理
  (testDb as any).$testDbPath = dbPath;
  (testDb as any).$testDbDir = tmpDir;

  return testDb;
}

/**
 * 清理测试数据库中的所有数据（保留表结构）
 */
export async function cleanTestDb(testDb: DbClient): Promise<void> {
  const client = (testDb as any).$client;
  await client.execute(`DELETE FROM embeddings`);
  await client.execute(`DELETE FROM chunks`);
  await client.execute(`DELETE FROM transcripts`);
  await client.execute(`DELETE FROM ingestion_jobs`);
  await client.execute(`DELETE FROM videos`);
}

/**
 * 销毁测试数据库（删除数据文件）
 */
export function destroyTestDb(testDb: DbClient): void {
  const dbPath = (testDb as any).$testDbPath;
  const dbDir = (testDb as any).$testDbDir;
  if (dbPath) {
    try { unlinkSync(dbPath); } catch {}
  }
  if (dbDir) {
    try { rmdirSync(dbDir); } catch {}
  }
}
