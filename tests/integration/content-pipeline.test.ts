import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '~/db';
import { videos, ingestionJobs, transcripts, chunks, embeddings } from '~/db/schema';
import { eq } from 'drizzle-orm';
import { ImportService } from '~/services/import-service';
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

async function waitForJobCompletion(
  jobId: string,
  timeoutMs = 15000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await db
      .select({ status: ingestionJobs.status })
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, jobId));

    if (rows[0]?.status === 'completed') return 'completed';
    if (rows[0]?.status === 'failed_terminal') return 'failed_terminal';
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`);
}

describe('Content Pipeline E2E', () => {
  const testQueue = new JobQueue({ maxConcurrency: 2, baseRetryDelayMs: 100 });
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

  beforeEach(async () => {
    await db.delete(embeddings);
    await db.delete(chunks);
    await db.delete(transcripts);
    await db.delete(ingestionJobs);
    await db.delete(videos);
  });

  it('should complete full pipeline: parse → transcribe → chunk → summarize → embed → index', async () => {
    const workspaceId = 'test-pipeline';
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

    const finalStatus = await waitForJobCompletion(job.id, 15000);
    expect(finalStatus).toBe('completed');

    const videoRows = await db
      .select()
      .from(videos)
      .where(eq(videos.id, job.videoId!));
    expect(videoRows[0].status).toBe('completed');
    expect(videoRows[0].aiSummary).toBeTruthy();

    const transcriptRows = await db
      .select()
      .from(transcripts)
      .where(eq(transcripts.videoId, job.videoId!));
    expect(transcriptRows.length).toBeGreaterThan(0);
    expect(transcriptRows[0].source).toBe('asr');

    const chunkRows = await db
      .select()
      .from(chunks)
      .where(eq(chunks.videoId, job.videoId!));
    expect(chunkRows.length).toBeGreaterThan(0);

    const embeddingRows = await db
      .select()
      .from(embeddings)
      .where(eq(embeddings.videoId, job.videoId!));
    expect(embeddingRows.length).toBeGreaterThan(0);
    expect(embeddingRows.length).toBe(chunkRows.length);
  });

  it('should support semantic search after pipeline completion', async () => {
    const workspaceId = 'search-test';
    const { SearchService } = await import('~/services/search-service');
    const searchService = new SearchService(embeddingClient, vectorStore);

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

    const finalStatus = await waitForJobCompletion(job.id, 15000);
    expect(finalStatus).toBe('completed');

    const result = await searchService.semanticSearch({
      workspaceId,
      query: '短视频创作',
      topK: 10,
    });

    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].score).toBeGreaterThan(0);
    expect(result.hits[0].content).toBeTruthy();
  });

  it('should isolate pipeline data between workspaces', async () => {
    const workspaceA = 'workspace-a';
    const workspaceB = 'workspace-b';

    const jobA = await importService.createImportJob(
      'https://www.douyin.com/video/aaaaaa',
      workspaceA
    );
    const jobB = await importService.createImportJob(
      'https://www.douyin.com/video/bbbbbb',
      workspaceB
    );

    testQueue.enqueue({
      id: jobA.id,
      type: 'parse_metadata',
      payload: {
        jobId: jobA.id,
        videoId: jobA.videoId!,
        shareUrl: 'https://www.douyin.com/video/aaaaaa',
        workspaceId: workspaceA,
      },
    });

    testQueue.enqueue({
      id: jobB.id,
      type: 'parse_metadata',
      payload: {
        jobId: jobB.id,
        videoId: jobB.videoId!,
        shareUrl: 'https://www.douyin.com/video/bbbbbb',
        workspaceId: workspaceB,
      },
    });

    const finalA = await waitForJobCompletion(jobA.id, 15000);
    const finalB = await waitForJobCompletion(jobB.id, 15000);
    expect(finalA).toBe('completed');
    expect(finalB).toBe('completed');

    const { SearchService } = await import('~/services/search-service');
    const searchService = new SearchService(embeddingClient, vectorStore);

    const resultA = await searchService.semanticSearch({
      workspaceId: workspaceA,
      query: '创作',
      topK: 10,
    });
    expect(resultA.hits.length).toBeGreaterThan(0);

    const resultB = await searchService.semanticSearch({
      workspaceId: workspaceB,
      query: '创作',
      topK: 10,
    });
    expect(resultB.hits.length).toBeGreaterThan(0);

    const hasCrossWorkspace = resultA.hits.some((h) => h.videoId === jobB.videoId) ||
      resultB.hits.some((h) => h.videoId === jobA.videoId);
    expect(hasCrossWorkspace).toBe(false);
  });
});
