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
      graph_status TEXT NOT NULL DEFAULT 'pending',
      graph_error TEXT,
      graph_built_at INTEGER,
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

  // graph_nodes 表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      business_id TEXT NOT NULL,
      canonical_key TEXT,
      label TEXT NOT NULL,
      properties TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);

  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_nodes_unique
    ON graph_nodes(workspace_id, node_type, business_id)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_workspace_type
    ON graph_nodes(workspace_id, node_type)
  `);

  // graph_edges 表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 0.5,
      computed_by TEXT NOT NULL,
      evidence TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);

  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_edges_unique
    ON graph_edges(workspace_id, source_node_id, target_node_id, relation_type)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_edges_source_type_weight
    ON graph_edges(workspace_id, source_node_id, relation_type, weight)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_edges_target_type_weight
    ON graph_edges(workspace_id, target_node_id, relation_type, weight)
  `);

  // entity_aliases 表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS entity_aliases (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      canonical_node_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'auto_detected',
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_entity_aliases_lookup
    ON entity_aliases(workspace_id, alias)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_entity_aliases_canonical
    ON entity_aliases(workspace_id, canonical_node_id)
  `);

  // workspaces 表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      settings TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // workspace_members 表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      invited_by TEXT,
      joined_at INTEGER DEFAULT (unixepoch())
    )
  `);

  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_members_unique
    ON workspace_members(workspace_id, user_id)
  `);

  // usage_logs 表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      operation TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      estimated_cost REAL,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_usage_logs_workspace
    ON usage_logs(workspace_id, created_at)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_usage_logs_type
    ON usage_logs(workspace_id, resource_type, created_at)
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
  await client.execute(`DELETE FROM graph_edges`);
  await client.execute(`DELETE FROM entity_aliases`);
  await client.execute(`DELETE FROM graph_nodes`);
  await client.execute(`DELETE FROM embeddings`);
  await client.execute(`DELETE FROM chunks`);
  await client.execute(`DELETE FROM transcripts`);
  await client.execute(`DELETE FROM ingestion_jobs`);
  await client.execute(`DELETE FROM videos`);
  await client.execute(`DELETE FROM usage_logs`);
  await client.execute(`DELETE FROM workspace_members`);
  await client.execute(`DELETE FROM workspaces`);
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
