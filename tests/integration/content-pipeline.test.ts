import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, cleanTestDb } from '../helpers/db';
import { videos, ingestionJobs, transcripts, chunks, embeddings } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { ImportService } from '../../src/services/import-service';
import { MockDouyinConnector } from '../../src/infrastructure/douyin-connector';
import { MockLLMClient } from '../../src/infrastructure/llm-client';
import { MockASRClient } from '../../src/infrastructure/asr-client';
import { MockEmbeddingClient } from '../../src/infrastructure/embedding-client';
import { SQLiteVectorStore } from '../../src/infrastructure/vector-store';
import { JobQueue } from '../../src/workers/queue';
import { registerParseWorker } from '../../src/workers/parse-worker';
import { registerASRWorker } from '../../src/workers/asr-worker';
import { registerChunkWorker } from '../../src/workers/chunk-worker';
import { registerSummaryWorker } from '../../src/workers/summary-worker';
import { registerEmbedWorker } from '../../src/workers/embed-worker';
import { registerIndexWorker } from '../../src/workers/index-worker';
import type { DbClient } from '../../src/db';

async function waitForJobCompletion(
  importService: ImportService,
  jobId: string,
  timeoutMs = 15000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await importService.getJobStatus(jobId, 'test-pipeline');
    if (job?.status === 'completed') return 'completed';
    if (job?.status === 'failed_terminal') return 'failed_terminal';
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`);
}

describe('Content Pipeline E2E', () => {
  let testDb: DbClient;
  let testQueue: JobQueue;
  let importService: ImportService;
  const workspaceId = 'test-pipeline';

  beforeEach(async () => {
    testDb = await createTestDb();
    await cleanTestDb(testDb);

    const connector = new MockDouyinConnector();
    const llm = new MockLLMClient();
    const asr = new MockASRClient();
    const embeddingClient = new MockEmbeddingClient();
    const vectorStore = new SQLiteVectorStore(testDb);

    importService = new ImportService(connector, testDb);

    testQueue = new JobQueue({
      maxConcurrency: 2,
      baseRetryDelayMs: 100,
      maxRetries: 2,
      jobTimeoutMs: 30000,
    });

    registerParseWorker(testQueue, connector, importService, testDb);
    registerASRWorker(testQueue, asr, importService, testDb);
    registerChunkWorker(testQueue, importService, testDb);
    registerSummaryWorker(testQueue, llm, importService, testDb);
    registerEmbedWorker(testQueue, embeddingClient, importService, testDb);
    registerIndexWorker(testQueue, vectorStore, importService, testDb);
  });

  it('should complete full pipeline: parse -> transcribe -> chunk -> summarize -> embed -> index', async () => {
    const job = await importService.createImportJob(
      'https://www.douyin.com/video/123456',
      workspaceId
    );

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

    const finalStatus = await waitForJobCompletion(importService, job.id, 15000);
    expect(finalStatus).toBe('completed');

    // 验证视频状态
    const videoRows = await testDb
      .select()
      .from(videos)
      .where(eq(videos.id, job.videoId!));
    expect(videoRows[0].status).toBe('completed');
    expect(videoRows[0].aiSummary).toBeTruthy();

    // 验证 transcript 已创建
    const transcriptRows = await testDb
      .select()
      .from(transcripts)
      .where(eq(transcripts.videoId, job.videoId!));
    expect(transcriptRows.length).toBeGreaterThan(0);
    expect(transcriptRows[0].source).toBe('asr');

    // 验证 chunks 已创建
    const chunkRows = await testDb
      .select()
      .from(chunks)
      .where(eq(chunks.videoId, job.videoId!));
    expect(chunkRows.length).toBeGreaterThan(0);

    // 验证 embeddings 已创建
    const embeddingRows = await testDb
      .select()
      .from(embeddings)
      .where(eq(embeddings.videoId, job.videoId!));
    expect(embeddingRows.length).toBeGreaterThan(0);
    expect(embeddingRows.length).toBe(chunkRows.length);
  });

  it('should support semantic search after pipeline completion', async () => {
    // 先运行流水线
    const job = await importService.createImportJob(
      'https://www.douyin.com/video/789012',
      workspaceId
    );

    testQueue.enqueue({
      id: job.id,
      type: 'parse_metadata',
      payload: {
        jobId: job.id,
        videoId: job.videoId!,
        shareUrl: 'https://www.douyin.com/video/789012',
        workspaceId,
      },
    });

    await waitForJobCompletion(importService, job.id, 15000);

    // 测试语义搜索
    const { SearchService } = await import('../../src/services/search-service');
    const { MockEmbeddingClient } = await import('../../src/infrastructure/embedding-client');
    const { SQLiteVectorStore } = await import('../../src/infrastructure/vector-store');

    const searchService = new SearchService(
      new MockEmbeddingClient(),
      new SQLiteVectorStore(testDb)
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
