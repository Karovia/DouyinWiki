import { eq } from 'drizzle-orm';
import { db } from '../db';
import { videos } from '../db/schema';
import { DouyinConnector } from '../infrastructure/douyin-connector';
import { JobQueue, JobResult } from './queue';
import { ImportService } from '../services/import-service';
import { AppError } from '../domain/errors';
import { queue } from './queue';

export function registerParseWorker(
  queueInstance: JobQueue,
  connector: DouyinConnector,
  importService: ImportService
) {
  queueInstance.register('parse_metadata', async (job): Promise<JobResult> => {
    const { jobId, videoId, shareUrl, workspaceId } = job.payload;

    const retryCount = (job.payload as unknown as Record<string, number>)._retryCount ?? 0;

    try {
      await importService.updateJobStatus(jobId, workspaceId, 'parsing_metadata', {
        step: 'parsing_metadata',
      });

      const parsed = await connector.parseUrl(shareUrl);
      const metadata = await connector.fetchMetadata(parsed);

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

      await importService.updateJobStatus(jobId, workspaceId, 'fetching_content', {
        step: 'fetching_content',
      });

      // 入队 transcribe 任务
      queue.enqueue({
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
    } catch (err) {
      console.error(`Parse worker failed for ${videoId}:`, err);

      const { retryable, errorCode, errorMessage } = classifyError(err);

      try {
        if (retryable && retryCount < 3) {
          await importService.updateJobStatus(jobId, workspaceId, 'failed_retryable', {
            step: 'parsing_metadata',
            errorCode,
            errorMessage,
          });
          return { success: false, retryable: true, error: err instanceof Error ? err : new Error(errorMessage) };
        } else {
          await importService.updateJobStatus(jobId, workspaceId, 'failed_terminal', {
            step: 'parsing_metadata',
            errorCode,
            errorMessage: retryable ? `${errorMessage} (max retries exceeded)` : errorMessage,
          });

          await db
            .update(videos)
            .set({
              status: 'failed',
              errorCode,
              errorMessage: retryable ? `${errorMessage} (max retries exceeded)` : errorMessage,
            })
            .where(eq(videos.id, videoId));

          return { success: false, retryable: false, error: err instanceof Error ? err : new Error(errorMessage) };
        }
      } catch (updateErr) {
        console.error(`Failed to update job status for ${jobId}:`, updateErr);
        return { success: false, retryable: true, error: err instanceof Error ? err : new Error(String(err)) };
      }
    }
  });
}

function classifyError(err: unknown): {
  retryable: boolean;
  errorCode: string;
  errorMessage: string;
} {
  if (err instanceof AppError) {
    return {
      retryable: err.retryable,
      errorCode: err.code,
      errorMessage: err.message,
    };
  }

  if (err instanceof Error) {
    const message = err.message.toLowerCase();

    if (
      message.includes('invalid url') ||
      message.includes('parse_invalid_url') ||
      message.includes('unsupported platform') ||
      message.includes('parse_platform_unsupported') ||
      message.includes('link expired') ||
      message.includes('parse_link_expired')
    ) {
      return {
        retryable: false,
        errorCode: 'PARSE_INVALID_INPUT',
        errorMessage: err.message,
      };
    }

    if (
      message.includes('timeout') ||
      message.includes('etimedout') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('network') ||
      message.includes('rate limit') ||
      message.includes('too many requests')
    ) {
      return {
        retryable: true,
        errorCode: 'PARSE_NETWORK_ERROR',
        errorMessage: err.message,
      };
    }
  }

  return {
    retryable: true,
    errorCode: 'PARSE_UNKNOWN',
    errorMessage: err instanceof Error ? err.message : 'Unknown error',
  };
}
