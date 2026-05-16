import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphBuilder } from '../../src/domain/graph-builder';
import { registerGraphWorker } from '../../src/workers/graph-worker';
import { registerIndexWorker } from '../../src/workers/index-worker';
import { JobQueue } from '../../src/workers/queue';
import { ImportService } from '../../src/services/import-service';
import { createTestDb, cleanTestDb, destroyTestDb } from '../helpers/db';
import { videos, graphEdges, graphNodes, embeddings, chunks } from '../../src/db/schema';
import { eq, and } from 'drizzle-orm';
import { MockDouyinConnector } from '../../src/infrastructure/douyin-connector';
import { SQLiteVectorStore } from '../../src/infrastructure/vector-store';
import type { DbClient } from '../../src/db';

const workspaceId = 'test-ws-graph';

async function waitForGraphStatus(
  testDb: DbClient,
  videoId: string,
  expectedStatus: string,
  timeoutMs = 5000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await testDb
      .select({ graphStatus: videos.graphStatus })
      .from(videos)
      .where(and(eq(videos.id, videoId), eq(videos.workspaceId, workspaceId)));
    if (rows[0]?.graphStatus === expectedStatus) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

describe('graph-worker', () => {
  let testDb: DbClient;
  let queue: JobQueue;
  let importService: ImportService;

  beforeEach(async () => {
    testDb = await createTestDb();
    await cleanTestDb(testDb);
    queue = new JobQueue({ maxConcurrency: 1, jobTimeoutMs: 10000 });
    importService = new ImportService(new MockDouyinConnector(), testDb);
  });

  afterEach(() => {
    destroyTestDb(testDb);
  });

  it('should build graph edges for a video', async () => {
    // 插入测试视频
    await testDb.insert(videos).values({
      id: 'test-video-1',
      workspaceId,
      shareUrl: 'https://douyin.com/video/1',
      normalizedUrlHash: 'hash1',
      aiTags: JSON.stringify(['React', 'TypeScript']),
      authorId: 'author1',
      authorName: 'TestAuthor',
      title: 'Test Video',
      status: 'completed',
      graphStatus: 'pending',
    });

    // 插入测试 chunk 和 embedding（用于 same_topic 边生成）
    await testDb.insert(chunks).values({
      id: 'chunk-1',
      videoId: 'test-video-1',
      workspaceId,
      contentType: 'summary',
      chunkIndex: 0,
      content: 'React tutorial',
      contentHash: 'hash-c1',
    });

    await testDb.insert(embeddings).values({
      id: 'emb-1',
      chunkId: 'chunk-1',
      videoId: 'test-video-1',
      workspaceId,
      modelName: 'mock-embedding',
      dimension: 3,
      embedding: JSON.stringify([0.1, 0.2, 0.3]),
      contentHash: 'hash-c1',
    });

    const vectorStore = new SQLiteVectorStore(testDb);
    const builder = new GraphBuilder(vectorStore);

    registerIndexWorker(queue, vectorStore, importService, testDb);
    registerGraphWorker(queue, builder, importService, testDb);

    queue.enqueue({
      id: 'job-graph-1',
      type: 'graph_building',
      payload: { jobId: 'j1', videoId: 'test-video-1', shareUrl: '', workspaceId },
    });

    const ready = await waitForGraphStatus(testDb, 'test-video-1', 'ready');
    expect(ready).toBe(true);

    const edges = await testDb.select().from(graphEdges)
      .where(eq(graphEdges.workspaceId, workspaceId));

    expect(edges.length).toBeGreaterThan(0);

    // 验证 mentions 边存在
    const mentionsEdges = edges.filter((e) => e.relationType === 'mentions');
    expect(mentionsEdges.length).toBeGreaterThanOrEqual(2); // React + TypeScript + author
  });

  it('should handle missing video gracefully', async () => {
    const builder = new GraphBuilder({ search: async () => [] } as any);
    registerGraphWorker(queue, builder, importService, testDb);

    queue.enqueue({
      id: 'job-graph-missing',
      type: 'graph_building',
      payload: { jobId: 'j-missing', videoId: 'non-existent', shareUrl: '', workspaceId },
    });

    await new Promise((r) => setTimeout(r, 500));

    const edges = await testDb.select().from(graphEdges)
      .where(eq(graphEdges.workspaceId, workspaceId));

    expect(edges.length).toBe(0);
  });
});
