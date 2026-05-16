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

      const videoRows = await db
        .select()
        .from(videos)
        .where(eq(videos.id, videoId))
        .limit(1);

      const video = videoRows[0];
      if (!video) {
        throw new Error('Video not found');
      }

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
