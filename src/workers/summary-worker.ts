import { eq } from 'drizzle-orm';
import { db, type DbClient } from '../db';
import { videos, transcripts } from '../db/schema';
import { LLMClient } from '../infrastructure/llm-client';
import { QueueJob, JobResult, JobQueue } from './queue';
import { ImportService } from '../services/import-service';

export function registerSummaryWorker(
  queueInstance: JobQueue,
  llm: LLMClient,
  importService: ImportService,
  dbClient: DbClient = db
) {
  queueInstance.register('summarize', async (job: QueueJob): Promise<JobResult> => {
    const { jobId, videoId, workspaceId } = job.payload;
    const retryCount = ((job.payload as Record<string, unknown>)._retryCount as number) ?? 0;

    try {
      await importService.updateJobStatus(jobId, workspaceId, 'summarizing', {
        step: 'summarizing',
      });

      // 获取视频元数据
      const videoRows = await dbClient
        .select()
        .from(videos)
        .where(eq(videos.id, videoId))
        .limit(1);

      const video = videoRows[0];
      if (!video) {
        throw new Error('Video not found');
      }

      // 获取转写文本
      const transcriptRows = await dbClient
        .select({ rawText: transcripts.rawText })
        .from(transcripts)
        .where(eq(transcripts.videoId, videoId))
        .limit(1);

      const transcript = transcriptRows[0]?.rawText || '';

      // 使用 analyzeContent 一次性生成摘要、标签和实体
      const analysis = await llm.analyzeContent({
        title: video.title || '',
        transcript,
      });

      await dbClient
        .update(videos)
        .set({
          aiSummary: analysis.summary,
          aiTags: JSON.stringify(analysis.tags),
        })
        .where(eq(videos.id, videoId));

      // 入队 embed 任务
      queueInstance.enqueue({
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
