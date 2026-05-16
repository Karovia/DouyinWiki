import { eq } from 'drizzle-orm';
import { db } from '../db';
import { videos, ingestionJobs } from '../db/schema';
import { DouyinConnector } from '../infrastructure/douyin-connector';
import { LLMClient } from '../infrastructure/llm-client';
import { MemoryQueue } from './queue';

export function registerParseWorker(
  queue: MemoryQueue,
  connector: DouyinConnector,
  llm: LLMClient
) {
  queue.register('parse_metadata', async (job) => {
    const { jobId, videoId, shareUrl } = job.payload;

    // 1. 读取 job 状态
    const jobRow = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, jobId))
      .limit(1);

    if (!jobRow[0]) return;

    // 2. 更新为 parsing_metadata
    await updateJobStatus(jobId, 'parsing_metadata');

    try {
      // 3. 解析 URL 和元数据
      const parsed = await connector.parseUrl(shareUrl);
      const metadata = await connector.fetchMetadata(parsed);

      // 4. 更新视频记录
      await db
        .update(videos)
        .set({
          platformVideoId: metadata.platformVideoId,
          title: metadata.title,
          description: metadata.description,
          authorName: metadata.authorName,
          authorId: metadata.authorId,
          coverUrl: metadata.coverUrl,
          duration: metadata.duration,
          viewCount: metadata.viewCount,
          likeCount: metadata.likeCount,
          tags: JSON.stringify(metadata.tags || []),
          status: 'parsed',
        })
        .where(eq(videos.id, videoId));

      // 5. 生成 AI 摘要（Phase 1 简化版）
      await updateJobStatus(jobId, 'summarizing');
      const summaryText = `${metadata.title || ''}\n${metadata.description || ''}`;
      const aiSummary = await llm.generateSummary(summaryText);
      const aiTags = await llm.generateTags(summaryText);

      await db
        .update(videos)
        .set({
          aiSummary,
          aiTags: JSON.stringify(aiTags),
          status: 'completed',
        })
        .where(eq(videos.id, videoId));

      // 6. 完成任务
      await updateJobStatus(jobId, 'completed');
    } catch (err) {
      console.error(`Parse worker failed for ${videoId}:`, err);
      await db
        .update(ingestionJobs)
        .set({
          status: 'failed_terminal',
          errorCode: err instanceof Error ? 'PARSE_FAILED' : 'UNKNOWN',
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
          finishedAt: new Date(),
        })
        .where(eq(ingestionJobs.id, jobId));

      await db
        .update(videos)
        .set({
          status: 'failed',
          errorCode: 'PARSE_FAILED',
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        })
        .where(eq(videos.id, videoId));
    }
  });
}

async function updateJobStatus(jobId: string, status: string) {
  await db
    .update(ingestionJobs)
    .set({ status, step: status, updatedAt: new Date() })
    .where(eq(ingestionJobs.id, jobId));
}
