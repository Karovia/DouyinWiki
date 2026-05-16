import { eq } from 'drizzle-orm';
import { db } from '../db';
import { videos } from '../db/schema';
import { LLMClient } from '../infrastructure/llm-client';
import { QueueJob, JobResult } from './queue';
import { ImportService } from '../services/import-service';
import { queue } from './queue';

export function registerSummaryWorker(
  queueInstance: typeof queue,
  llm: LLMClient,
  importService: ImportService
) {
  queueInstance.register('summarize', async (job: QueueJob): Promise<JobResult> => {
    const { jobId, videoId, workspaceId } = job.payload;
    const retryCount = ((job.payload as Record<string, unknown>)._retryCount as number) ?? 0;

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
