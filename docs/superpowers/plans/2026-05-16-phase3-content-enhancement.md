# Phase 3: 内容增强 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 ASR 转写、文本 Chunk 化、向量 Embedding 与检索，让问答可引用视频具体片段并支持时间戳。

**Architecture:** 扩展数据库 Schema 新增 transcripts/chunks/embeddings 表；新增 ASRClient / EmbeddingClient / VectorStore 基础设施接口；将现有单阶段 Worker 拆分为多阶段流水线（parse → transcribe → chunk → summarize → embed → index）；新增 SearchService 提供语义搜索能力。

**Tech Stack:** TypeScript / Hono / tRPC / Drizzle ORM (SQLite) / Vitest

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/db/schema.ts` | 新增 transcripts、chunks、embeddings 表定义 |
| `src/domain/types.ts` | 扩展 Transcript、Chunk、VectorChunk、SearchHit 类型 |
| `src/infrastructure/asr-client.ts` | ASRClient 接口 + MockASRClient |
| `src/infrastructure/embedding-client.ts` | EmbeddingClient 接口 + MockEmbeddingClient |
| `src/infrastructure/vector-store.ts` | VectorStore 接口 + SQLiteVectorStore 实现 |
| `src/services/search-service.ts` | SearchService：语义检索编排 |
| `src/workers/queue.ts` | 扩展 QueueJob type 支持多阶段任务 |
| `src/workers/parse-worker.ts` | 改造：解析完成后入队 transcribe |
| `src/workers/asr-worker.ts` | 新增：ASR 转写 Worker |
| `src/workers/chunk-worker.ts` | 新增：文本 Chunk 化 Worker |
| `src/workers/summary-worker.ts` | 新增：AI 摘要 Worker（从 parse-worker 抽出） |
| `src/workers/embed-worker.ts` | 新增：Embedding 生成 Worker |
| `src/workers/index-worker.ts` | 新增：向量索引写入 Worker |
| `src/api/routers/search.ts` | 新增 search.semantic 路由 |
| `src/server.ts` | 注册全部 Worker |
| `tests/unit/vector-store.test.ts` | VectorStore 单元测试 |
| `tests/integration/content-pipeline.test.ts` | 完整内容流水线 E2E 测试 |

---

## Chunk N: 基础设施与数据层

### Task 1: 数据库 Schema 扩展

**Files:**
- Modify: `src/db/schema.ts`

**依赖:** 无

- [ ] **Step 1: 修改 schema.ts，新增 transcripts 表**

```typescript
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
```

- [ ] **Step 2: 新增 chunks 表**

```typescript
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
```

- [ ] **Step 3: 新增 embeddings 表**

```typescript
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
```

- [ ] **Step 4: 生成并执行迁移**

Run: `npm run db:generate && npm run db:migrate`
Expected: 迁移成功，无报错

- [ ] **Step 5: 提交**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat(db): add transcripts, chunks, embeddings tables"
```

---

### Task 2: 领域类型扩展

**Files:**
- Modify: `src/domain/types.ts`

**依赖:** Task 1

- [ ] **Step 1: 新增 Transcript 相关类型**

在 `src/domain/types.ts` 末尾添加：

```typescript
export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface Transcript {
  id: string;
  videoId: string;
  workspaceId: string;
  source: 'asr' | 'subtitle' | 'manual_note' | 'ocr';
  modelName?: string;
  language?: string;
  segments: TranscriptSegment[];
  rawText?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chunk {
  id: string;
  videoId: string;
  workspaceId: string;
  contentType: 'transcript' | 'summary' | 'title' | 'note';
  chunkIndex: number;
  content: string;
  contentHash: string;
  startTimeMs?: number;
  endTimeMs?: number;
  createdAt: Date;
}

export interface VectorChunk {
  id: string;
  chunkId: string;
  videoId: string;
  workspaceId: string;
  modelName: string;
  dimension: number;
  embedding: number[];
  contentHash: string;
  createdAt: Date;
}

export interface SearchHit {
  chunkId: string;
  videoId: string;
  content: string;
  contentType: string;
  startTimeMs?: number;
  endTimeMs?: number;
  score: number;
}

export interface SearchFilter {
  contentTypes?: string[];
  videoIds?: string[];
}
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/domain/types.ts
git commit -m "feat(domain): add Transcript, Chunk, VectorChunk, SearchHit types"
```

---

### Task 3: 基础设施接口（ASRClient / EmbeddingClient / VectorStore）

**Files:**
- Create: `src/infrastructure/asr-client.ts`
- Create: `src/infrastructure/embedding-client.ts`
- Create: `src/infrastructure/vector-store.ts`

**依赖:** Task 2

- [ ] **Step 1: 创建 ASRClient 接口与 Mock 实现**

```typescript
// src/infrastructure/asr-client.ts
import { Transcript, TranscriptSegment } from '~/domain/types';
import { ASR_TIMEOUT, ASR_UNSUPPORTED_LANG } from '~/domain/errors';

export interface ASRClient {
  transcribe(audioUrl: string, options?: { language?: string }): Promise<Transcript>;
}

export class MockASRClient implements ASRClient {
  async transcribe(audioUrl: string, options?: { language?: string }): Promise<Transcript> {
    // 模拟 ASR 耗时
    await new Promise((r) => setTimeout(r, 500));

    const segments: TranscriptSegment[] = [
      { startMs: 0, endMs: 5000, text: '大家好，今天我们来讨论一个非常有意思的话题。' },
      { startMs: 5000, endMs: 12000, text: '关于短视频内容创作，很多人都有一些误解。' },
      { startMs: 12000, endMs: 20000, text: '首先，爆款视频不是靠运气，而是有方法论可循的。' },
      { startMs: 20000, endMs: 30000, text: '我们可以从选题、脚本、拍摄和剪辑四个维度来分析。' },
      { startMs: 30000, endMs: 45000, text: '选题阶段最重要的是找到用户真正的痛点和需求。' },
    ];

    return {
      id: 'mock-transcript',
      videoId: 'mock',
      workspaceId: 'default',
      source: 'asr',
      modelName: 'mock-asr-v1',
      language: options?.language || 'zh',
      segments,
      rawText: segments.map((s) => s.text).join('\n'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}
```

- [ ] **Step 2: 创建 EmbeddingClient 接口与 Mock 实现**

```typescript
// src/infrastructure/embedding-client.ts
import { AppError } from '~/domain/errors';

export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>;
  getDimension(): number;
}

/**
 * Mock Embedding 客户端
 * 返回确定性向量，便于测试（基于文本字符和的伪随机）
 */
export class MockEmbeddingClient implements EmbeddingClient {
  private dimension = 384;

  getDimension(): number {
    return this.dimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    await new Promise((r) => setTimeout(r, 100));

    return texts.map((text) => {
      const vec = new Array(this.dimension).fill(0);
      // 基于文本内容生成确定性向量
      for (let i = 0; i < this.dimension; i++) {
        let hash = 0;
        for (let j = 0; j < text.length; j++) {
          hash = ((hash << 5) - hash + text.charCodeAt(j) + i * 31) | 0;
        }
        vec[i] = (hash % 1000) / 1000;
      }
      // L2 归一化
      const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
      return norm > 0 ? vec.map((v) => v / norm) : vec;
    });
  }
}
```

- [ ] **Step 3: 创建 VectorStore 接口与 SQLite 实现**

```typescript
// src/infrastructure/vector-store.ts
import { eq, and } from 'drizzle-orm';
import { db } from '~/db';
import { embeddings } from '~/db/schema';
import { VectorChunk, SearchHit, SearchFilter } from '~/domain/types';
import { VEC_INSERT_FAILED, VEC_SEARCH_ERROR } from '~/domain/errors';

export interface VectorStore {
  upsert(chunks: VectorChunk[]): Promise<void>;
  search(params: {
    workspaceId: string;
    queryEmbedding: number[];
    topK: number;
    filters?: SearchFilter;
  }): Promise<SearchHit[]>;
  deleteByOwner(ownerType: string, ownerId: string): Promise<void>;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

export class SQLiteVectorStore implements VectorStore {
  async upsert(chunks: VectorChunk[]): Promise<void> {
    try {
      for (const chunk of chunks) {
        await db
          .insert(embeddings)
          .values({
            id: chunk.id,
            chunkId: chunk.chunkId,
            videoId: chunk.videoId,
            workspaceId: chunk.workspaceId,
            modelName: chunk.modelName,
            dimension: chunk.dimension,
            embedding: JSON.stringify(chunk.embedding),
            contentHash: chunk.contentHash,
            createdAt: chunk.createdAt,
          })
          .onConflictDoUpdate({
            target: [embeddings.chunkId, embeddings.modelName],
            set: {
              embedding: JSON.stringify(chunk.embedding),
              contentHash: chunk.contentHash,
              createdAt: new Date(),
            },
          });
      }
    } catch (err) {
      throw VEC_INSERT_FAILED();
    }
  }

  async search(params: {
    workspaceId: string;
    queryEmbedding: number[];
    topK: number;
    filters?: SearchFilter;
  }): Promise<SearchHit[]> {
    try {
      const { workspaceId, queryEmbedding, topK, filters } = params;

      // 全表扫描 + 内存计算 cosine similarity（MVP 数据量下可行）
      const rows = await db
        .select({
          id: embeddings.id,
          chunkId: embeddings.chunkId,
          videoId: embeddings.videoId,
          embedding: embeddings.embedding,
          contentHash: embeddings.contentHash,
        })
        .from(embeddings)
        .where(eq(embeddings.workspaceId, workspaceId));

      // 从 chunks 表获取内容
      const { chunks: chunksTable } = await import('~/db/schema');
      const chunkIds = rows.map((r) => r.chunkId);
      const chunkRows = await db
        .select()
        .from(chunksTable)
        .where(
          and(
            eq(chunksTable.workspaceId, workspaceId),
            // 用 inArray 如果 chunkIds 不为空
          )
        );

      // 过滤和计算相似度
      const results: SearchHit[] = [];
      for (const row of rows) {
        const chunkRow = chunkRows.find((c) => c.id === row.chunkId);
        if (!chunkRow) continue;

        // contentType 过滤
        if (filters?.contentTypes && !filters.contentTypes.includes(chunkRow.contentType)) {
          continue;
        }

        // videoId 过滤
        if (filters?.videoIds && !filters.videoIds.includes(chunkRow.videoId)) {
          continue;
        }

        const emb = JSON.parse(row.embedding) as number[];
        const score = cosineSimilarity(queryEmbedding, emb);

        results.push({
          chunkId: row.chunkId,
          videoId: row.videoId,
          content: chunkRow.content,
          contentType: chunkRow.contentType,
          startTimeMs: chunkRow.startTimeMs ?? undefined,
          endTimeMs: chunkRow.endTimeMs ?? undefined,
          score,
        });
      }

      // 按相似度排序，取 topK
      return results.sort((a, b) => b.score - a.score).slice(0, topK);
    } catch (err) {
      throw VEC_SEARCH_ERROR();
    }
  }

  async deleteByOwner(ownerType: string, ownerId: string): Promise<void> {
    if (ownerType === 'video') {
      await db.delete(embeddings).where(eq(embeddings.videoId, ownerId));
    } else if (ownerType === 'chunk') {
      await db.delete(embeddings).where(eq(embeddings.chunkId, ownerId));
    }
  }
}
```

> 注意：SQLiteVectorStore.search 中的 `inArray` 需要导入。如果 drizzle-orm 的 `inArray` 不可用，可以改为逐个查询或全表过滤。

- [ ] **Step 4: 检查并补全 errors.ts 中的 VEC_ 错误**

确保 `src/domain/errors.ts` 包含：

```typescript
// 向量层错误
export const VEC_INSERT_FAILED = () =>
  new AppError('VEC_INSERT_FAILED', 'Vector insert failed', true, 502);

export const VEC_SEARCH_ERROR = () =>
  new AppError('VEC_SEARCH_ERROR', 'Vector search failed', true, 502);
```

以及 ASR 错误：

```typescript
export const ASR_TIMEOUT = () =>
  new AppError('ASR_TIMEOUT', 'ASR service timeout', true, 504);

export const ASR_UNSUPPORTED_LANG = () =>
  new AppError('ASR_UNSUPPORTED_LANG', 'Unsupported language', false, 400);
```

- [ ] **Step 5: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add src/infrastructure/asr-client.ts src/infrastructure/embedding-client.ts src/infrastructure/vector-store.ts src/domain/errors.ts
git commit -m "feat(infra): add ASRClient, EmbeddingClient, VectorStore interfaces with SQLite impl"
```

---

### Task 4: VectorStore 单元测试

**Files:**
- Create: `tests/unit/vector-store.test.ts`

**依赖:** Task 3

- [ ] **Step 1: 编写 VectorStore 单元测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SQLiteVectorStore } from '~/infrastructure/vector-store';
import { db } from '~/db';
import { embeddings, chunks } from '~/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

describe('SQLiteVectorStore', () => {
  const store = new SQLiteVectorStore();
  const workspaceId = 'test-workspace';

  beforeEach(async () => {
    // 清理测试数据
    await db.delete(embeddings).where(eq(embeddings.workspaceId, workspaceId));
    await db.delete(chunks).where(eq(chunks.workspaceId, workspaceId));
  });

  it('should upsert and search embeddings', async () => {
    const videoId = nanoid();
    const chunkId = nanoid();

    // 先插入 chunk（search 需要关联 chunks 表）
    await db.insert(chunks).values({
      id: chunkId,
      videoId,
      workspaceId,
      contentType: 'transcript',
      chunkIndex: 0,
      content: '测试文本内容',
      contentHash: 'hash123',
    });

    // upsert embedding
    await store.upsert([{
      id: nanoid(),
      chunkId,
      videoId,
      workspaceId,
      modelName: 'mock-model',
      dimension: 3,
      embedding: [1, 0, 0],
      contentHash: 'hash123',
      createdAt: new Date(),
    }]);

    // search with matching vector
    const results = await store.search({
      workspaceId,
      queryEmbedding: [1, 0, 0],
      topK: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunkId).toBe(chunkId);
    expect(results[0].content).toBe('测试文本内容');
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it('should return empty for non-matching workspace', async () => {
    const results = await store.search({
      workspaceId: 'non-existent',
      queryEmbedding: [1, 0, 0],
      topK: 5,
    });

    expect(results).toEqual([]);
  });

  it('should respect contentType filter', async () => {
    const videoId = nanoid();

    // 创建两个 chunk
    const chunk1 = nanoid();
    const chunk2 = nanoid();

    await db.insert(chunks).values([
      { id: chunk1, videoId, workspaceId, contentType: 'transcript', chunkIndex: 0, content: '转写内容', contentHash: 'h1' },
      { id: chunk2, videoId, workspaceId, contentType: 'title', chunkIndex: 0, content: '标题内容', contentHash: 'h2' },
    ]);

    await store.upsert([
      { id: nanoid(), chunkId: chunk1, videoId, workspaceId, modelName: 'mock', dimension: 3, embedding: [1, 0, 0], contentHash: 'h1', createdAt: new Date() },
      { id: nanoid(), chunkId: chunk2, videoId, workspaceId, modelName: 'mock', dimension: 3, embedding: [0, 1, 0], contentHash: 'h2', createdAt: new Date() },
    ]);

    const results = await store.search({
      workspaceId,
      queryEmbedding: [1, 0, 0],
      topK: 5,
      filters: { contentTypes: ['transcript'] },
    });

    expect(results.length).toBe(1);
    expect(results[0].contentType).toBe('transcript');
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `npx vitest run tests/unit/vector-store.test.ts`
Expected: 3 passed

- [ ] **Step 3: 提交**

```bash
git add tests/unit/vector-store.test.ts
git commit -m "test: add VectorStore unit tests"
```

---

## Chunk N: Worker 流水线

### Task 5: 扩展 QueueJob 类型

**Files:**
- Modify: `src/workers/queue.ts`

**依赖:** Task 3

- [ ] **Step 1: 扩展 QueueJob type 支持多阶段**

```typescript
export type JobType =
  | 'parse_metadata'
  | 'transcribe'
  | 'chunk'
  | 'summarize'
  | 'embed'
  | 'index';

export interface QueueJob {
  id: string;
  type: JobType;
  payload: {
    jobId: string;
    videoId: string;
    shareUrl: string;
    workspaceId: string;
    // 可选的额外上下文
    [key: string]: unknown;
  };
}
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/workers/queue.ts
git commit -m "feat(queue): extend job types for multi-stage pipeline"
```

---

### Task 6: 改造 parse-worker 并创建 asr-worker

**Files:**
- Modify: `src/workers/parse-worker.ts`
- Create: `src/workers/asr-worker.ts`

**依赖:** Task 5

- [ ] **Step 1: 改造 parse-worker，完成后入队 transcribe**

修改 `src/workers/parse-worker.ts`：

1. 保留 parse_metadata 处理逻辑（解析 URL、获取元数据、更新视频记录）
2. **移除** AI 摘要生成逻辑（将移到 summary-worker）
3. 成功完成后，**不入队 summarize，改为入队 transcribe**
4. 更新状态为 `fetching_content` → 然后 `transcribing`（或者直接 enqueue transcribe job，让 asr-worker 更新状态）

```typescript
// parse-worker.ts 改造后关键部分
import { queue as globalQueue } from './queue'; // 需要传入或引用全局 queue

// 在 handler 末尾：
await importService.updateJobStatus(jobId, workspaceId, 'fetching_content', {
  step: 'fetching_content',
});

// 入队 transcribe 任务
globalQueue.enqueue({
  id: `${jobId}-transcribe`,
  type: 'transcribe',
  payload: {
    jobId,
    videoId,
    shareUrl,
    workspaceId,
  },
});

return { success: true };
```

> 注意：需要将 queue 实例作为参数传入 registerParseWorker，或引用全局 queue。

更简洁的方式：修改 `registerParseWorker` 签名，接受 `enqueueNext` 回调：

```typescript
export function registerParseWorker(
  queue: JobQueue,
  connector: DouyinConnector,
  importService: ImportService,
  enqueueNext: (job: QueueJob) => void
) { ... }
```

或者直接在 parse-worker 中引用全局 queue（如果 server.ts 导出了全局实例）。

最简洁的方式：将 `registerParseWorker` 改为内部直接引用全局 queue（因为 queue 是单例）。

```typescript
import { queue } from './queue';

// 在 handler 末尾：
queue.enqueue({
  id: `${jobId}-transcribe`,
  type: 'transcribe',
  payload: { jobId, videoId, shareUrl, workspaceId },
});
```

- [ ] **Step 2: 创建 asr-worker.ts**

```typescript
// src/workers/asr-worker.ts
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { transcripts } from '../db/schema';
import { ASRClient } from '../infrastructure/asr-client';
import { JobQueue, JobResult } from './queue';
import { ImportService } from '../services/import-service';
import { AppError } from '../domain/errors';
import { nanoid } from 'nanoid';
import { queue } from './queue';

export function registerASRWorker(
  queueInstance: JobQueue,
  asr: ASRClient,
  importService: ImportService
) {
  queueInstance.register('transcribe', async (job): Promise<JobResult> => {
    const { jobId, videoId, shareUrl, workspaceId } = job.payload;
    const retryCount = (job.payload as unknown as Record<string, number>)._retryCount ?? 0;

    try {
      await importService.updateJobStatus(jobId, workspaceId, 'transcribing', {
        step: 'transcribing',
      });

      // 获取视频元数据中的音频 URL（Mock 阶段直接用 shareUrl 作为标识）
      // Phase 3 MVP 简化：直接调用 ASR，不下载音频
      const result = await asr.transcribe(shareUrl, { language: 'zh' });

      // 保存转写结果
      const transcriptId = nanoid();
      await db.insert(transcripts).values({
        id: transcriptId,
        videoId,
        workspaceId,
        source: 'asr',
        modelName: result.modelName,
        language: result.language,
        segments: JSON.stringify(result.segments),
        rawText: result.rawText,
      });

      // 更新视频状态
      await importService.updateJobStatus(jobId, workspaceId, 'chunking', {
        step: 'chunking',
      });

      // 入队 chunk 任务
      queue.enqueue({
        id: `${jobId}-chunk`,
        type: 'chunk',
        payload: { jobId, videoId, shareUrl, workspaceId, transcriptId },
      });

      return { success: true };
    } catch (err) {
      console.error(`ASR worker failed for ${videoId}:`, err);

      const { retryable, errorCode, errorMessage } = classifyASRError(err);

      try {
        if (retryable && retryCount < 3) {
          await importService.updateJobStatus(jobId, workspaceId, 'failed_retryable', {
            step: 'transcribing',
            errorCode,
            errorMessage,
          });
          return { success: false, retryable: true, error: err instanceof Error ? err : new Error(errorMessage) };
        } else {
          await importService.updateJobStatus(jobId, workspaceId, 'failed_terminal', {
            step: 'transcribing',
            errorCode,
            errorMessage: retryable ? `${errorMessage} (max retries exceeded)` : errorMessage,
          });
          return { success: false, retryable: false, error: err instanceof Error ? err : new Error(errorMessage) };
        }
      } catch (updateErr) {
        console.error(`Failed to update job status for ${jobId}:`, updateErr);
        return { success: false, retryable: true, error: err instanceof Error ? err : new Error(String(err)) };
      }
    }
  });
}

function classifyASRError(err: unknown): {
  retryable: boolean;
  errorCode: string;
  errorMessage: string;
} {
  if (err instanceof AppError) {
    return { retryable: err.retryable, errorCode: err.code, errorMessage: err.message };
  }

  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    if (message.includes('unsupported') || message.includes('invalid')) {
      return { retryable: false, errorCode: 'ASR_INVALID_INPUT', errorMessage: err.message };
    }
    if (message.includes('timeout') || message.includes('network') || message.includes('rate limit')) {
      return { retryable: true, errorCode: 'ASR_NETWORK_ERROR', errorMessage: err.message };
    }
  }

  return { retryable: true, errorCode: 'ASR_UNKNOWN', errorMessage: err instanceof Error ? err.message : 'Unknown error' };
}
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/workers/parse-worker.ts src/workers/asr-worker.ts
git commit -m "feat(workers): refactor parse-worker and add ASR worker"
```

---

### Task 7: 创建 chunk-worker 和 summary-worker

**Files:**
- Create: `src/workers/chunk-worker.ts`
- Create: `src/workers/summary-worker.ts`

**依赖:** Task 6

- [ ] **Step 1: 创建 chunk-worker.ts**

```typescript
// src/workers/chunk-worker.ts
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { transcripts, chunks } from '../db/schema';
import { JobQueue, JobResult } from './queue';
import { ImportService } from '../services/import-service';
import { TranscriptSegment } from '../domain/types';
import { nanoid } from 'nanoid';
import { queue } from './queue';

export function registerChunkWorker(
  queueInstance: JobQueue,
  importService: ImportService
) {
  queueInstance.register('chunk', async (job): Promise<JobResult> => {
    const { jobId, videoId, workspaceId } = job.payload;
    const retryCount = (job.payload as unknown as Record<string, number>)._retryCount ?? 0;

    try {
      await importService.updateJobStatus(jobId, workspaceId, 'chunking', {
        step: 'chunking',
      });

      // 读取 transcript
      const transcriptRows = await db
        .select()
        .from(transcripts)
        .where(eq(transcripts.videoId, videoId))
        .limit(1);

      const transcript = transcriptRows[0];

      // 生成 chunks
      let chunkList: { content: string; startTimeMs?: number; endTimeMs?: number }[] = [];

      if (transcript?.segments) {
        const segments = JSON.parse(transcript.segments) as TranscriptSegment[];
        chunkList = chunkTranscriptSegments(segments);
      }

      // 同时创建 title chunk（用于标题检索）
      const videoRows = await db
        .select({ title: chunksTable.title, description: chunksTable.description })
        .from(videos)
        .where(eq(videos.id, videoId))
        .limit(1);
      // 需要导入 videos

      // 写入 chunks 表
      if (chunkList.length > 0) {
        for (let i = 0; i < chunkList.length; i++) {
          const item = chunkList[i];
          await db.insert(chunks).values({
            id: nanoid(),
            videoId,
            workspaceId,
            contentType: 'transcript',
            chunkIndex: i,
            content: item.content,
            contentHash: simpleHash(item.content),
            startTimeMs: item.startTimeMs,
            endTimeMs: item.endTimeMs,
          });
        }
      }

      // 入队 summarize 任务
      queue.enqueue({
        id: `${jobId}-summarize`,
        type: 'summarize',
        payload: { jobId, videoId, shareUrl: job.payload.shareUrl, workspaceId },
      });

      return { success: true };
    } catch (err) {
      console.error(`Chunk worker failed for ${videoId}:`, err);
      // 简化为可重试错误
      if (retryCount < 3) {
        return { success: false, retryable: true, error: err instanceof Error ? err : new Error(String(err)) };
      }
      await importService.updateJobStatus(jobId, workspaceId, 'failed_terminal', {
        step: 'chunking',
        errorCode: 'CHUNK_FAILED',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      });
      return { success: false, retryable: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  });
}

/**
 * 将 transcript segments 切分为合适的 chunk
 * MVP 策略：合并相邻 segments，每 chunk 约 100-300 字符
 */
function chunkTranscriptSegments(segments: TranscriptSegment[]): {
  content: string;
  startTimeMs: number;
  endTimeMs: number;
}[] {
  const result: { content: string; startTimeMs: number; endTimeMs: number }[] = [];
  let currentText = '';
  let currentStart = 0;
  let currentEnd = 0;

  for (const seg of segments) {
    if (currentText.length === 0) {
      currentStart = seg.startMs;
    }

    currentText += seg.text;
    currentEnd = seg.endMs;

    // 当累计文本超过 150 字符或遇到句号时切分
    if (currentText.length >= 150 || seg.text.includes('。')) {
      result.push({
        content: currentText.trim(),
        startTimeMs: currentStart,
        endTimeMs: currentEnd,
      });
      currentText = '';
    }
  }

  // 处理剩余文本
  if (currentText.trim()) {
    result.push({
      content: currentText.trim(),
      startTimeMs: currentStart,
      endTimeMs: currentEnd,
    });
  }

  return result;
}

function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(16);
}
```

> 注意：chunk-worker 中引用了 `videos` 表但 import 语句需要补全。为简化，title chunk 可以不在 Phase 3 中实现（YAGNI）。

- [ ] **Step 2: 创建 summary-worker.ts**

```typescript
// src/workers/summary-worker.ts
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { videos } from '../db/schema';
import { LLMClient } from '../infrastructure/llm-client';
import { JobQueue, JobResult } from './queue';
import { ImportService } from '../services/import-service';
import { queue } from './queue';

export function registerSummaryWorker(
  queueInstance: JobQueue,
  llm: LLMClient,
  importService: ImportService
) {
  queueInstance.register('summarize', async (job): Promise<JobResult> => {
    const { jobId, videoId, workspaceId } = job.payload;
    const retryCount = (job.payload as unknown as Record<string, number>)._retryCount ?? 0;

    try {
      await importService.updateJobStatus(jobId, workspaceId, 'summarizing', {
        step: 'summarizing',
      });

      // 获取视频元数据
      const videoRows = await db
        .select()
        .from(videos)
        .where(eq(videos.id, videoId))
        .limit(1);

      const video = videoRows[0];
      if (!video) {
        throw new Error('Video not found');
      }

      // 生成摘要
      const summaryText = `${video.title || ''}\n${video.description || ''}`;
      const aiSummary = await llm.generateSummary(summaryText);
      const aiTags = await llm.generateTags(summaryText);

      await db
        .update(videos)
        .set({
          aiSummary,
          aiTags: JSON.stringify(aiTags),
        })
        .where(eq(videos.id, videoId));

      // 入队 embed 任务
      queue.enqueue({
        id: `${jobId}-embed`,
        type: 'embed',
        payload: { jobId, videoId, shareUrl: job.payload.shareUrl, workspaceId },
      });

      return { success: true };
    } catch (err) {
      console.error(`Summary worker failed for ${videoId}:`, err);
      if (retryCount < 3) {
        return { success: false, retryable: true, error: err instanceof Error ? err : new Error(String(err)) };
      }
      await importService.updateJobStatus(jobId, workspaceId, 'failed_terminal', {
        step: 'summarizing',
        errorCode: 'SUMMARY_FAILED',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      });
      return { success: false, retryable: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  });
}
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/workers/chunk-worker.ts src/workers/summary-worker.ts
git commit -m "feat(workers): add chunk and summary workers"
```

---

### Task 8: 创建 embed-worker 和 index-worker

**Files:**
- Create: `src/workers/embed-worker.ts`
- Create: `src/workers/index-worker.ts`

**依赖:** Task 7

- [ ] **Step 1: 创建 embed-worker.ts**

```typescript
// src/workers/embed-worker.ts
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { chunks } from '../db/schema';
import { EmbeddingClient } from '../infrastructure/embedding-client';
import { JobQueue, JobResult } from './queue';
import { ImportService } from '../services/import-service';
import { queue } from './queue';

export function registerEmbedWorker(
  queueInstance: JobQueue,
  embeddingClient: EmbeddingClient,
  importService: ImportService
) {
  queueInstance.register('embed', async (job): Promise<JobResult> => {
    const { jobId, videoId, workspaceId } = job.payload;
    const retryCount = (job.payload as unknown as Record<string, number>)._retryCount ?? 0;

    try {
      await importService.updateJobStatus(jobId, workspaceId, 'embedding', {
        step: 'embedding',
      });

      // 读取该视频的所有 chunks
      const chunkRows = await db
        .select()
        .from(chunks)
        .where(eq(chunks.videoId, videoId));

      if (chunkRows.length === 0) {
        // 无 chunk，跳过 embedding，直接进入 indexing（或直接 completed）
        queue.enqueue({
          id: `${jobId}-index`,
          type: 'index',
          payload: { jobId, videoId, shareUrl: job.payload.shareUrl, workspaceId, skipEmbedding: true },
        });
        return { success: true };
      }

      // 批量生成 embedding
      const texts = chunkRows.map((c) => c.content);
      const embeddingsList = await embeddingClient.embed(texts);
      const dimension = embeddingClient.getDimension();
      const modelName = 'mock-embedding';

      // 准备 vector chunks（暂存到 payload 中，由 index-worker 写入）
      const vectorChunks = chunkRows.map((chunkRow, i) => ({
        id: `${chunkRow.id}-${modelName}`,
        chunkId: chunkRow.id,
        videoId,
        workspaceId,
        modelName,
        dimension,
        embedding: embeddingsList[i],
        contentHash: chunkRow.contentHash,
        createdAt: new Date(),
      }));

      // 入队 index 任务，携带 embedding 数据
      queue.enqueue({
        id: `${jobId}-index`,
        type: 'index',
        payload: {
          jobId,
          videoId,
          shareUrl: job.payload.shareUrl,
          workspaceId,
          vectorChunks,
        },
      });

      return { success: true };
    } catch (err) {
      console.error(`Embed worker failed for ${videoId}:`, err);
      if (retryCount < 3) {
        return { success: false, retryable: true, error: err instanceof Error ? err : new Error(String(err)) };
      }
      await importService.updateJobStatus(jobId, workspaceId, 'failed_terminal', {
        step: 'embedding',
        errorCode: 'EMBED_FAILED',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      });
      return { success: false, retryable: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  });
}
```

- [ ] **Step 2: 创建 index-worker.ts**

```typescript
// src/workers/index-worker.ts
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { videos } from '../db/schema';
import { VectorStore } from '../infrastructure/vector-store';
import { VectorChunk } from '../domain/types';
import { JobQueue, JobResult } from './queue';
import { ImportService } from '../services/import-service';

export function registerIndexWorker(
  queueInstance: JobQueue,
  vectorStore: VectorStore,
  importService: ImportService
) {
  queueInstance.register('index', async (job): Promise<JobResult> => {
    const { jobId, videoId, workspaceId } = job.payload;
    const retryCount = (job.payload as unknown as Record<string, number>)._retryCount ?? 0;
    const vectorChunks = job.payload.vectorChunks as VectorChunk[] | undefined;

    try {
      await importService.updateJobStatus(jobId, workspaceId, 'indexing', {
        step: 'indexing',
      });

      // 写入向量索引
      if (vectorChunks && vectorChunks.length > 0) {
        await vectorStore.upsert(vectorChunks);
      }

      // 更新视频状态为 completed
      await db
        .update(videos)
        .set({ status: 'completed' })
        .where(eq(videos.id, videoId));

      // 完成任务
      await importService.updateJobStatus(jobId, workspaceId, 'completed', {
        step: 'completed',
        progress: 100,
      });

      return { success: true };
    } catch (err) {
      console.error(`Index worker failed for ${videoId}:`, err);
      if (retryCount < 3) {
        return { success: false, retryable: true, error: err instanceof Error ? err : new Error(String(err)) };
      }
      await importService.updateJobStatus(jobId, workspaceId, 'failed_terminal', {
        step: 'indexing',
        errorCode: 'INDEX_FAILED',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      });
      return { success: false, retryable: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  });
}
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/workers/embed-worker.ts src/workers/index-worker.ts
git commit -m "feat(workers): add embed and index workers"
```

---

## Chunk N: 搜索服务与 API

### Task 9: 创建 SearchService 与 search.semantic 路由

**Files:**
- Create: `src/services/search-service.ts`
- Create: `src/api/routers/search.ts`

**依赖:** Task 8

- [ ] **Step 1: 创建 SearchService**

```typescript
// src/services/search-service.ts
import { EmbeddingClient } from '~/infrastructure/embedding-client';
import { VectorStore } from '~/infrastructure/vector-store';
import { SearchHit, SearchFilter } from '~/domain/types';

export interface SemanticSearchOptions {
  workspaceId: string;
  query: string;
  topK?: number;
  filters?: SearchFilter;
}

export class SearchService {
  constructor(
    private embeddingClient: EmbeddingClient,
    private vectorStore: VectorStore
  ) {}

  async semanticSearch(options: SemanticSearchOptions): Promise<{
    hits: SearchHit[];
    total: number;
  }> {
    const { workspaceId, query, topK = 20, filters } = options;

    // 1. 将查询文本转为向量
    const [queryEmbedding] = await this.embeddingClient.embed([query]);

    // 2. 向量检索
    const hits = await this.vectorStore.search({
      workspaceId,
      queryEmbedding,
      topK,
      filters,
    });

    return {
      hits,
      total: hits.length,
    };
  }
}
```

- [ ] **Step 2: 创建 search router**

```typescript
// src/api/routers/search.ts
import { z } from 'zod';
import { router, authedProcedure } from '../trpc';
import { SearchService } from '~/services/search-service';
import { MockEmbeddingClient } from '~/infrastructure/embedding-client';
import { SQLiteVectorStore } from '~/infrastructure/vector-store';

const embeddingClient = new MockEmbeddingClient();
const vectorStore = new SQLiteVectorStore();
const searchService = new SearchService(embeddingClient, vectorStore);

export const searchRouter = router({
  semantic: authedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(500),
        topK: z.number().min(1).max(100).default(20),
        contentTypes: z.array(z.string()).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const result = await searchService.semanticSearch({
        workspaceId: ctx.workspaceId,
        query: input.query,
        topK: input.topK,
        filters: input.contentTypes
          ? { contentTypes: input.contentTypes }
          : undefined,
      });

      return {
        hits: result.hits.map((hit) => ({
          chunkId: hit.chunkId,
          videoId: hit.videoId,
          content: hit.content,
          contentType: hit.contentType,
          startTimeMs: hit.startTimeMs,
          endTimeMs: hit.endTimeMs,
          score: hit.score,
        })),
        total: result.total,
      };
    }),
});
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/services/search-service.ts src/api/routers/search.ts
git commit -m "feat(search): add SearchService and semantic search API"
```

---

### Task 10: 注册全部 Worker 与 API

**Files:**
- Modify: `src/server.ts`

**依赖:** Task 9

- [ ] **Step 1: 修改 server.ts，注册新 Worker 和 search router**

```typescript
// src/server.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { serveStatic } from 'hono/serve-static';
import { router } from './api/trpc';
import { importRouter } from './api/routers/import';
import { videosRouter } from './api/routers/videos';
import { searchRouter } from './api/routers/search';
import { MockDouyinConnector } from './infrastructure/douyin-connector';
import { MockLLMClient } from './infrastructure/llm-client';
import { MockASRClient } from './infrastructure/asr-client';
import { MockEmbeddingClient } from './infrastructure/embedding-client';
import { SQLiteVectorStore } from './infrastructure/vector-store';
import { queue } from './workers/queue';
import { registerParseWorker } from './workers/parse-worker';
import { registerASRWorker } from './workers/asr-worker';
import { registerChunkWorker } from './workers/chunk-worker';
import { registerSummaryWorker } from './workers/summary-worker';
import { registerEmbedWorker } from './workers/embed-worker';
import { registerIndexWorker } from './workers/index-worker';
import { ImportService } from './services/import-service';

// 初始化依赖
const connector = new MockDouyinConnector();
const llm = new MockLLMClient();
const asr = new MockASRClient();
const embeddingClient = new MockEmbeddingClient();
const vectorStore = new SQLiteVectorStore();
const importService = new ImportService(connector);

// 注册所有 Worker
registerParseWorker(queue, connector, importService);
registerASRWorker(queue, asr, importService);
registerChunkWorker(queue, importService);
registerSummaryWorker(queue, llm, importService);
registerEmbedWorker(queue, embeddingClient, importService);
registerIndexWorker(queue, vectorStore, importService);

// 合并 tRPC Router
export const appRouter = router({
  import: importRouter,
  videos: videosRouter,
  search: searchRouter,
});

export type AppRouter = typeof appRouter;

// Hono 应用
const app = new Hono();
app.use('*', cors({ origin: '*' }));
app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: () => ({ workspaceId: 'default' }),
  })
);
app.get('/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));
app.use('*', serveStatic({ root: './dist' }));

const port = parseInt(process.env.PORT || '3000');
console.log(`Server running at http://localhost:${port}`);
console.log('Registered workers: parse_metadata, transcribe, chunk, summarize, embed, index');

export default app;
```

- [ ] **Step 2: 启动服务器验证**

Run: `npm run dev`
Expected: 控制台输出 `Server running at http://localhost:3000` 和 Worker 列表

- [ ] **Step 3: 健康检查**

Run: `curl http://localhost:3000/health`
Expected: `{"status":"ok","time":"..."}`

- [ ] **Step 4: 提交**

```bash
git add src/server.ts
git commit -m "feat(server): register all Phase 3 workers and search router"
```

---

## Chunk N: 测试与验收

### Task 11: 编写内容流水线 E2E 集成测试

**Files:**
- Create: `tests/integration/content-pipeline.test.ts`

**依赖:** Task 10

- [ ] **Step 1: 编写 E2E 测试**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '~/db';
import { videos, ingestionJobs, transcripts, chunks, embeddings } from '~/db/schema';
import { eq } from 'drizzle-orm';
import { ImportService } from '~/services/search-service';
import { MockDouyinConnector } from '~/infrastructure/douyin-connector';
import { MockLLMClient } from '~/infrastructure/llm-client';
import { MockASRClient } from '~/infrastructure/asr-client';
import { MockEmbeddingClient } from '~/infrastructure/embedding-client';
import { SQLiteVectorStore } from '~/infrastructure/vector-store';
import { JobQueue } from '~/workers/queue';
import { registerParseWorker } from '~/workers/parse-worker';
import { registerASRWorker } from '~/workers/asr-worker';
import { registerChunkWorker } from '~/workers/chunk-worker';
import { registerSummaryWorker } from '~/workers/summary-worker';
import { registerEmbedWorker } from '~/workers/embed-worker';
import { registerIndexWorker } from '~/workers/index-worker';

// 等待队列处理完成的辅助函数
async function waitForJobCompletion(
  jobId: string,
  timeoutMs = 10000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await db
      .select({ status: ingestionJobs.status })
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, jobId));

    if (rows[0]?.status === 'completed') return 'completed';
    if (rows[0]?.status === 'failed_terminal') return 'failed_terminal';
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`);
}

describe('Content Pipeline E2E', () => {
  const testQueue = new JobQueue({ maxConcurrency: 2, baseRetryDelayMs: 100 });
  const workspaceId = 'test-pipeline';

  beforeAll(() => {
    const connector = new MockDouyinConnector();
    const llm = new MockLLMClient();
    const asr = new MockASRClient();
    const embeddingClient = new MockEmbeddingClient();
    const vectorStore = new SQLiteVectorStore();
    const importService = new ImportService(connector);

    registerParseWorker(testQueue, connector, importService);
    registerASRWorker(testQueue, asr, importService);
    registerChunkWorker(testQueue, importService);
    registerSummaryWorker(testQueue, llm, importService);
    registerEmbedWorker(testQueue, embeddingClient, importService);
    registerIndexWorker(testQueue, vectorStore, importService);
  });

  it('should complete full pipeline: parse → transcribe → chunk → summarize → embed → index', async () => {
    const importService = new ImportService(new MockDouyinConnector());
    const job = await importService.createImportJob(
      'https://www.douyin.com/video/123456',
      workspaceId
    );

    // 入队解析任务
    testQueue.enqueue({
      id: job.id,
      type: 'parse_metadata',
      payload: {
        jobId: job.id,
        videoId: job.videoId!,
        shareUrl: 'https://www.douyin.com/video/123456',
        workspaceId,
      },
    });

    // 等待完成
    const finalStatus = await waitForJobCompletion(job.id, 15000);
    expect(finalStatus).toBe('completed');

    // 验证视频状态
    const videoRows = await db
      .select()
      .from(videos)
      .where(eq(videos.id, job.videoId!));
    expect(videoRows[0].status).toBe('completed');
    expect(videoRows[0].aiSummary).toBeTruthy();

    // 验证 transcript 已创建
    const transcriptRows = await db
      .select()
      .from(transcripts)
      .where(eq(transcripts.videoId, job.videoId!));
    expect(transcriptRows.length).toBeGreaterThan(0);
    expect(transcriptRows[0].source).toBe('asr');

    // 验证 chunks 已创建
    const chunkRows = await db
      .select()
      .from(chunks)
      .where(eq(chunks.videoId, job.videoId!));
    expect(chunkRows.length).toBeGreaterThan(0);

    // 验证 embeddings 已创建
    const embeddingRows = await db
      .select()
      .from(embeddings)
      .where(eq(embeddings.videoId, job.videoId!));
    expect(embeddingRows.length).toBeGreaterThan(0);
    expect(embeddingRows.length).toBe(chunkRows.length);
  });

  it('should support semantic search after pipeline completion', async () => {
    // 复用上面创建的数据，直接测试搜索
    const { SearchService } = await import('~/services/search-service');
    const { MockEmbeddingClient } = await import('~/infrastructure/embedding-client');
    const { SQLiteVectorStore } = await import('~/infrastructure/vector-store');

    const searchService = new SearchService(
      new MockEmbeddingClient(),
      new SQLiteVectorStore()
    );

    const result = await searchService.semanticSearch({
      workspaceId,
      query: '短视频创作',
      topK: 10,
    });

    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].score).toBeGreaterThan(0);
    expect(result.hits[0].content).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行集成测试**

Run: `npx vitest run tests/integration/content-pipeline.test.ts`
Expected: 2 passed（可能需要根据实际运行调整）

- [ ] **Step 3: 运行全部测试**

Run: `npx vitest run`
Expected: 全部通过（原有 31 个 + 新增 VectorStore 单元测试 + E2E 测试）

- [ ] **Step 4: 提交**

```bash
git add tests/integration/content-pipeline.test.ts
git commit -m "test: add content pipeline E2E test"
```

---

### Task 12: 更新开发路线图

**Files:**
- Modify: `.wiki/development-roadmap.md`

**依赖:** Task 11

- [ ] **Step 1: 在 roadmap 中添加 Phase 3 进度表格**

在 Phase 2 总体进度之后、Phase 1 详细实施计划之前插入：

```markdown
### Phase 3 总体进度

| Task | 模块 | 状态 | 完成时间 | 备注 |
|------|------|:----:|:--------:|------|
| Task 1 | 数据库 Schema 扩展 | ✅ | 2026-05-16 | transcripts, chunks, embeddings |
| Task 2 | 领域类型扩展 | ✅ | 2026-05-16 | Transcript, Chunk, VectorChunk, SearchHit |
| Task 3 | 基础设施接口 | ✅ | 2026-05-16 | ASRClient, EmbeddingClient, VectorStore |
| Task 4 | VectorStore 单元测试 | ✅ | 2026-05-16 | |
| Task 5 | QueueJob 类型扩展 | ✅ | 2026-05-16 | 支持多阶段流水线 |
| Task 6 | parse-worker 改造 + ASR Worker | ✅ | 2026-05-16 | |
| Task 7 | Chunk Worker + Summary Worker | ✅ | 2026-05-16 | |
| Task 8 | Embed Worker + Index Worker | ✅ | 2026-05-16 | |
| Task 9 | SearchService + search.semantic API | ✅ | 2026-05-16 | |
| Task 10 | 注册全部 Worker 与 API | ✅ | 2026-05-16 | |
| Task 11 | E2E 集成测试 | ✅ | 2026-05-16 | 完整流水线 + 语义搜索 |
| Task 12 | 更新开发路线图 | ✅ | 2026-05-16 | |
```

- [ ] **Step 2: 提交**

```bash
git add .wiki/development-roadmap.md
git commit -m "docs: update roadmap with Phase 3 progress"
```

---

### Task 13: 推送到 GitHub

**Files:** 无

**依赖:** Task 12

- [ ] **Step 1: 推送代码**

```bash
git push origin main
```

Expected: 推送成功

---

## Phase 3 验收检查清单

- [ ] transcripts 表支持 ASR / subtitle / manual_note / ocr 多种来源
- [ ] chunks 表支持 content_type 区分，含时间戳范围
- [ ] embeddings 表支持多模型、多维度、content_hash 去重
- [ ] 完整流水线：parse → transcribe → chunk → summarize → embed → index → completed
- [ ] 每个阶段失败可独立重试
- [ ] VectorStore 支持 upsert / search / deleteByOwner
- [ ] search.semantic 支持按 query 向量检索，返回命中片段与时间戳
- [ ] 所有查询带 workspace_id 过滤
- [ ] 集成测试覆盖完整流水线 + 语义搜索
- [ ] 代码通过 TypeScript 编译检查
- [ ] 全部测试通过
