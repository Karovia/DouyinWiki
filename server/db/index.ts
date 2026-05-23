import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql/node';
import * as schema from './schema';
import path from 'path';

const DB_PATH = process.env.COZE_PROJECT_ENV === 'PROD'
  ? 'file:/tmp/douyin-wiki.db'
  : `file:${path.resolve(process.cwd(), 'douyin-wiki.db')}`;

const client: Client = createClient({
  url: DB_PATH,
});

export const db = drizzle(client, { schema });

export type DB = typeof db;

/**
 * 初始化数据库表结构
 */
export async function initDatabase(): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // MTA 菜谱记录表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS mta_recipes (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'recipes',
      video_title TEXT,
      cover_url TEXT,
      dish_name TEXT NOT NULL,
      servings TEXT,
      ingredients TEXT NOT NULL,
      steps TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'douyin',
      platform_video_id TEXT,
      title TEXT,
      author_name TEXT,
      author_id TEXT,
      cover_url TEXT,
      duration INTEGER,
      description TEXT,
      share_url TEXT NOT NULL,
      ai_summary TEXT,
      tags TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      graph_status TEXT NOT NULL DEFAULT 'pending',
      normalized_url_hash TEXT,
      cover_file_key TEXT,
      video_file_key TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS ingestion_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      video_id TEXT,
      share_url TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'created',
      current_step TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS transcripts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      source TEXT NOT NULL,
      model_name TEXT,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      content TEXT NOT NULL,
      prompt_version TEXT NOT NULL DEFAULT 'v1',
      input_hash TEXT,
      output_schema_version TEXT NOT NULL DEFAULT 'v1',
      model_name TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  await client.execute('CREATE INDEX IF NOT EXISTS idx_videos_workspace ON videos(workspace_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_videos_platform_id ON videos(workspace_id, platform, platform_video_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_videos_url_hash ON videos(normalized_url_hash)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_jobs_idempotency ON ingestion_jobs(idempotency_key)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_jobs_workspace_status ON ingestion_jobs(workspace_id, status)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_transcripts_video ON transcripts(workspace_id, video_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_summaries_video ON summaries(workspace_id, video_id)');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS research_docs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      topic TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_research_docs_video ON research_docs(workspace_id, video_id)');

  // 确保 mta_recipes 表有 category 字段（迁移）
  await client.execute(`ALTER TABLE mta_recipes ADD COLUMN category TEXT NOT NULL DEFAULT 'recipes'`).catch(() => {});

  // 确保 mta_recipes 表有 cooldown 字段（迁移）
  const mtaColumnsResult = await client.execute("PRAGMA table_info(mta_recipes)");
  const mtaColumnNames = new Set(mtaColumnsResult.rows.map(r => r.name as string));
  if (!mtaColumnNames.has('cooldown')) {
    await client.execute('ALTER TABLE mta_recipes ADD COLUMN cooldown TEXT');
    console.log('Migrated: added cooldown column to mta_recipes');
  }

  // 确保默认 workspace 存在
  const defaultWorkspaceId = 'ws_default';
  const existing = await client.execute({
    sql: 'SELECT id FROM workspaces WHERE id = ?',
    args: [defaultWorkspaceId],
  });
  if (existing.rows.length === 0) {
    await client.execute({
      sql: 'INSERT INTO workspaces (id, name) VALUES (?, ?)',
      args: [defaultWorkspaceId, 'Default Workspace'],
    });
    console.log('Created default workspace:', defaultWorkspaceId);
  }

  // 迁移：为旧表添加新列
  const columnsResult = await client.execute("PRAGMA table_info(videos)");
  const columnNames = new Set(columnsResult.rows.map(r => r.name as string));
  if (!columnNames.has('cover_file_key')) {
    await client.execute('ALTER TABLE videos ADD COLUMN cover_file_key TEXT');
    console.log('Migrated: added cover_file_key column');
  }
  if (!columnNames.has('video_file_key')) {
    await client.execute('ALTER TABLE videos ADD COLUMN video_file_key TEXT');
    console.log('Migrated: added video_file_key column');
  }

  console.log('Database initialized:', DB_PATH);
}
