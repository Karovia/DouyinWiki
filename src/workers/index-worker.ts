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

      if (vectorChunks && vectorChunks.length > 0) {
        await vectorStore.upsert(vectorChunks);
      }

      await db
        .update(videos)
        .set({ status: 'completed' })
        .where(eq(videos.id, videoId));

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
