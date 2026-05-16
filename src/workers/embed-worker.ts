import { eq } from 'drizzle-orm';
import { db } from '../db';
import { chunks } from '../db/schema';
import { EmbeddingClient } from '../infrastructure/embedding-client';
import { JobQueue, JobResult } from './queue';
import { ImportService } from '../services/import-service';

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

      const chunkRows = await db
        .select()
        .from(chunks)
        .where(eq(chunks.videoId, videoId));

      if (chunkRows.length === 0) {
        queueInstance.enqueue({
          id: `${jobId}-index`,
          type: 'index',
          payload: { jobId, videoId, shareUrl: job.payload.shareUrl, workspaceId, skipEmbedding: true },
        });
        return { success: true };
      }

      const texts = chunkRows.map((c) => c.content);
      const embeddingsList = await embeddingClient.embed(texts);
      const dimension = embeddingClient.getDimension();
      const modelName = 'mock-embedding';

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

      queueInstance.enqueue({
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
