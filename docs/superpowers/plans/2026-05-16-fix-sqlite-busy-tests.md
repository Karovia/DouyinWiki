# 修复 SQLITE_BUSY 测试并发问题

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 vitest 运行时的 SQLITE_BUSY 并发锁冲突，使全部 70 个测试稳定通过。

**Architecture:** 通过 vitest 配置排除 worktree 目录的测试文件；为集成测试提供独立内存数据库连接，避免多个测试文件共享同一 SQLite 文件。

**Tech Stack:** TypeScript / Vitest / Drizzle ORM / libsql / better-sqlite3

---

## 根因分析

1. **vitest 扫描范围过大**：默认扫描所有子目录中的 `.test.ts` 文件，包括 `.claude/worktrees/` 和 `.worktrees/phase3/` 中的测试文件
2. **全局共享数据库连接**：`src/db/index.ts` 导出全局 `db` 实例，所有测试（包括 worktree 中的）共享同一个 `file:./data/douyin-wiki.db`
3. **并行写冲突**：vitest 默认并行运行测试文件，多个进程同时写同一数据库文件触发 `SQLITE_BUSY`

---

## 文件结构变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `vitest.config.ts` | 创建 | vitest 配置：排除 worktree 目录，设置单线程模式 |
| `src/db/index.ts` | 修改 | 添加 `createDbClient(url)` 工厂函数，保留全局 `db` 导出 |
| `tests/helpers/db.ts` | 创建 | 测试辅助工具：创建内存数据库、执行迁移、清理数据 |
| `tests/integration/import-flow.test.ts` | 修改 | 使用独立内存数据库替代全局 `db` |

---

## Chunk 1: 基础配置与数据库工厂

### Task 1: 创建 vitest 配置排除 worktree 目录

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: 创建 vitest 配置文件**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.claude/**',
      '**/.worktrees/**',
    ],
    // 集成测试涉及数据库写操作，使用单线程避免文件锁冲突
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
```

- [ ] **Step 2: 验证 vitest 只扫描当前目录的测试文件**

Run: `npx vitest run --reporter=verbose 2>&1 | grep "Test Files"`
Expected: 只显示 2 个测试文件（`tests/unit/state-machine.test.ts` + `tests/integration/import-flow.test.ts`）

- [ ] **Step 3: 提交**

```bash
git add vitest.config.ts
git commit -m "test: add vitest config to exclude worktree directories"
```

### Task 2: 修改 src/db/index.ts 添加数据库工厂函数

**Files:**
- Modify: `src/db/index.ts`

- [ ] **Step 1: 读取当前文件内容**

当前内容：
```typescript
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

const client = createClient({
  url: process.env.DATABASE_URL || 'file:./data/douyin-wiki.db',
});

export const db = drizzle(client, { schema });

export type DbClient = typeof db;
export { schema };
```

- [ ] **Step 2: 添加 `createDbClient` 工厂函数**

```typescript
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

const client = createClient({
  url: process.env.DATABASE_URL || 'file:./data/douyin-wiki.db',
});

export const db = drizzle(client, { schema });

export type DbClient = typeof db;
export { schema };

/**
 * 创建独立的数据库连接（用于测试等需要隔离数据库的场景）
 * @param url 数据库 URL，默认使用内存数据库 `:memory:`
 */
export function createDbClient(url: string = ':memory:'): DbClient {
  const testClient = createClient({ url });
  return drizzle(testClient, { schema });
}
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/db/index.ts
git commit -m "feat(db): add createDbClient factory for isolated database connections"
```

---

## Chunk 2: 测试辅助工具与集成测试修复

### Task 3: 创建测试辅助工具

**Files:**
- Create: `tests/helpers/db.ts`

- [ ] **Step 1: 创建测试数据库辅助模块**

```typescript
import { createDbClient, type DbClient } from '../../src/db';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../../src/db/schema';

/**
 * 创建测试用内存数据库，自动执行迁移
 */
export async function createTestDb(): Promise<DbClient> {
  const testDb = createDbClient(':memory:');

  // 执行 Drizzle 迁移以创建表结构
  // 注意：drizzle-orm/libsql/migrator 的 migrate 需要 migrations 文件夹路径
  // 由于内存数据库无法读取文件系统迁移，我们手动创建表
  const client = (testDb as any).$client;

  // videos 表
  await client.execute(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'default',
      platform TEXT NOT NULL DEFAULT 'douyin',
      platform_video_id TEXT,
      share_url TEXT NOT NULL,
      normalized_url_hash TEXT NOT NULL UNIQUE,
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
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // 创建唯一索引（幂等键）
  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_workspace_hash
    ON videos(workspace_id, normalized_url_hash)
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
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add tests/helpers/db.ts
git commit -m "test: add test database helper with in-memory schema creation"
```

### Task 4: 修改集成测试使用独立内存数据库

**Files:**
- Modify: `tests/integration/import-flow.test.ts`

- [ ] **Step 1: 修改测试文件使用独立数据库**

将测试文件重写为使用 `createTestDb` 和 `cleanTestDb`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, cleanTestDb } from '../helpers/db';
import { ingestionJobs, videos } from '../../src/db/schema';
import { ImportService } from '../../src/services/import-service';
import { MockDouyinConnector } from '../../src/infrastructure/douyin-connector';
import type { DbClient } from '../../src/db';

describe('import-flow integration', () => {
  let testDb: DbClient;
  let connector: MockDouyinConnector;
  let importService: ImportService;

  beforeEach(async () => {
    testDb = await createTestDb();
    await cleanTestDb(testDb);
    connector = new MockDouyinConnector();
    // 注意：ImportService 内部使用全局 db，需要重构以支持注入
  });

  // ... 后续测试用例
});
```

- [ ] **Step 2: 检查 ImportService 是否支持数据库注入**

读取 `src/services/import-service.ts`，确认其是否直接导入全局 `db`。

如果 `ImportService` 直接导入全局 `db`，需要修改为支持注入：

```typescript
// src/services/import-service.ts 修改方案
export class ImportService {
  constructor(
    private connector: DouyinConnector,
    private db: DbClient = globalDb  // 默认使用全局 db，测试时可注入
  ) {}
  // ...
}
```

- [ ] **Step 3: 修改 ImportService 支持数据库注入**

如果当前 `ImportService` 直接导入全局 `db`，需要修改构造函数注入 `db`。

- [ ] **Step 4: 完成集成测试修改**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, cleanTestDb } from '../helpers/db';
import { ImportService } from '../../src/services/import-service';
import { MockDouyinConnector } from '../../src/infrastructure/douyin-connector';
import type { DbClient } from '../../src/db';

describe('import-flow integration', () => {
  let testDb: DbClient;
  let importService: ImportService;

  beforeEach(async () => {
    testDb = await createTestDb();
    await cleanTestDb(testDb);
    const connector = new MockDouyinConnector();
    importService = new ImportService(connector, testDb);
  });

  describe('workspace isolation', () => {
    it('should isolate jobs between workspaces', async () => {
      const jobA = await importService.createImportJob(
        'https://www.douyin.com/video/123',
        'workspace-a'
      );
      const jobB = await importService.createImportJob(
        'https://www.douyin.com/video/123',
        'workspace-b'
      );

      expect(jobA.id).not.toBe(jobB.id);

      const listA = await importService.listJobs({ workspaceId: 'workspace-a' });
      expect(listA.items).toHaveLength(1);
      expect(listA.items[0].id).toBe(jobA.id);

      const listB = await importService.listJobs({ workspaceId: 'workspace-b' });
      expect(listB.items).toHaveLength(1);
      expect(listB.items[0].id).toBe(jobB.id);
    });

    it('should prevent cross-workspace job access', async () => {
      const job = await importService.createImportJob(
        'https://www.douyin.com/video/456',
        'workspace-a'
      );
      const status = await importService.getJobStatus(job.id, 'workspace-b');
      expect(status).toBeNull();
    });
  });

  describe('full import flow', () => {
    it('should complete full import flow', async () => {
      const job = await importService.createImportJob(
        'https://www.douyin.com/video/789',
        'default'
      );
      expect(job.status).toBe('created');

      await importService.updateJobStatus(job.id, 'default', 'parsing_metadata', {
        step: 'parsing_metadata',
      });
      await importService.updateJobStatus(job.id, 'default', 'fetching_content', {
        step: 'fetching_content',
      });
      await importService.updateJobStatus(job.id, 'default', 'transcribing', {
        step: 'transcribing',
      });
      await importService.updateJobStatus(job.id, 'default', 'chunking', {
        step: 'chunking',
      });
      await importService.updateJobStatus(job.id, 'default', 'summarizing', {
        step: 'summarizing',
        progress: 50,
      });
      await importService.updateJobStatus(job.id, 'default', 'embedding', {
        step: 'embedding',
      });
      await importService.updateJobStatus(job.id, 'default', 'indexing', {
        step: 'indexing',
      });
      await importService.updateJobStatus(job.id, 'default', 'graph_updating', {
        step: 'graph_updating',
      });
      await importService.updateJobStatus(job.id, 'default', 'completed', {
        step: 'completed',
        progress: 100,
      });

      const final = await importService.getJobStatus(job.id, 'default');
      expect(final?.status).toBe('completed');
      expect(final?.progress).toBe(100);
    });
  });

  describe('idempotency', () => {
    it('should be idempotent for same workspace and URL', async () => {
      const url = 'https://www.douyin.com/video/999';
      const job1 = await importService.createImportJob(url, 'default');
      const job2 = await importService.createImportJob(url, 'default');
      expect(job1.id).toBe(job2.id);
    });

    it('should allow same URL in different workspaces', async () => {
      const url = 'https://www.douyin.com/video/999';
      const job1 = await importService.createImportJob(url, 'workspace-x');
      const job2 = await importService.createImportJob(url, 'workspace-y');
      expect(job1.id).not.toBe(job2.id);
    });
  });

  describe('state machine validation', () => {
    it('should reject invalid state transitions', async () => {
      const job = await importService.createImportJob(
        'https://www.douyin.com/video/111',
        'default'
      );
      await expect(
        importService.updateJobStatus(job.id, 'default', 'completed')
      ).rejects.toThrow();
    });

    it('should reject transition from terminal state', async () => {
      const job = await importService.createImportJob(
        'https://www.douyin.com/video/222',
        'default'
      );
      await importService.updateJobStatus(job.id, 'default', 'parsing_metadata', {
        step: 'parsing_metadata',
      });
      await importService.updateJobStatus(job.id, 'default', 'fetching_content', {
        step: 'fetching_content',
      });
      await importService.updateJobStatus(job.id, 'default', 'transcribing', {
        step: 'transcribing',
      });
      await importService.updateJobStatus(job.id, 'default', 'chunking', {
        step: 'chunking',
      });
      await importService.updateJobStatus(job.id, 'default', 'summarizing', {
        step: 'summarizing',
      });
      await importService.updateJobStatus(job.id, 'default', 'embedding', {
        step: 'embedding',
      });
      await importService.updateJobStatus(job.id, 'default', 'indexing', {
        step: 'indexing',
      });
      await importService.updateJobStatus(job.id, 'default', 'graph_updating', {
        step: 'graph_updating',
      });
      await importService.updateJobStatus(job.id, 'default', 'completed', {
        step: 'completed',
      });
      await expect(
        importService.updateJobStatus(job.id, 'default', 'parsing_metadata')
      ).rejects.toThrow();
    });
  });

  describe('cancel and retry', () => {
    it('should cancel a job', async () => {
      const job = await importService.createImportJob(
        'https://www.douyin.com/video/333',
        'default'
      );
      await importService.updateJobStatus(job.id, 'default', 'parsing_metadata', {
        step: 'parsing_metadata',
      });
      const cancelled = await importService.cancelJob(job.id, 'default');
      expect(cancelled.status).toBe('cancelled');
      await expect(
        importService.updateJobStatus(job.id, 'default', 'summarizing')
      ).rejects.toThrow();
    });

    it('should retry a failed job', async () => {
      const job = await importService.createImportJob(
        'https://www.douyin.com/video/444',
        'default'
      );
      await importService.updateJobStatus(job.id, 'default', 'parsing_metadata', {
        step: 'parsing_metadata',
      });
      await importService.updateJobStatus(job.id, 'default', 'failed_retryable', {
        step: 'parsing_metadata',
        errorCode: 'PARSE_TIMEOUT',
        errorMessage: 'Timeout',
      });
      const retried = await importService.retryJob(job.id, 'default');
      expect(retried.status).toBe('parsing_metadata');
      expect(retried.retryCount).toBe(0);
    });
  });
});
```

- [ ] **Step 5: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 运行集成测试**

Run: `npx vitest run tests/integration/import-flow.test.ts`
Expected: 全部通过

- [ ] **Step 7: 运行全部测试**

Run: `npx vitest run`
Expected: 全部 70 个测试通过，0 失败

- [ ] **Step 8: 提交**

```bash
git add tests/integration/import-flow.test.ts src/services/import-service.ts
git commit -m "test: fix integration tests using isolated in-memory database"
```

---

## 验收标准

- [ ] `npx vitest run` 全部通过（70/70）
- [ ] `npx tsc --noEmit` 无编译错误
- [ ] 集成测试使用独立内存数据库，不与其他测试或 worktree 冲突
- [ ] vitest 配置排除 worktree 目录
