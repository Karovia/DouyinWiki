import { eq } from 'drizzle-orm';
import { db, type DbClient } from '../db';
import { videos } from '../db/schema';
import { DouyinConnector } from '../infrastructure/douyin-connector';
import { JobQueue, JobResult } from './queue';
import { ImportService } from '../services/import-service';
import { AppError } from '../domain/errors';

export function registerParseWorker(
  queueInstance: JobQueue,
  connector: DouyinConnector,
  importService: ImportService,
  dbClient: DbClient = db
) {
  queueInstance.register('parse_metadata', async (job): Promise<JobResult> => {
    const { jobId, videoId, shareUrl, workspaceId } = job.payload;

    // 从 payload 中获取重试次数（由队列注入）
    const retryCount = (job.payload as unknown as Record<string, number>)._retryCount ?? 0;

    try {
      // 1. 更新为 parsing_metadata 状态
      await importService.updateJobStatus(jobId, workspaceId, 'parsing_metadata', {
        step: 'parsing_metadata',
      });

      // 2. 解析 URL 和元数据
      const parsed = await connector.parseUrl(shareUrl);
      const metadata = await connector.fetchMetadata(parsed);

      // 3. 更新视频记录
      await dbClient
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

      // 4. 更新状态并入队转写任务
      await importService.updateJobStatus(jobId, workspaceId, 'fetching_content', {
        step: 'fetching_content',
      });

      queueInstance.enqueue({
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

      // 错误分类
      const { retryable, errorCode, errorMessage } = classifyError(err);

      try {
        if (retryable && retryCount < 3) {
          // 可重试错误
          await importService.updateJobStatus(jobId, workspaceId, 'failed_retryable', {
            step: 'parsing_metadata',
            errorCode,
            errorMessage,
          });
          return { success: false, retryable: true, error: err instanceof Error ? err : new Error(errorMessage) };
        } else {
          // 不可重试错误或超过重试次数
          await importService.updateJobStatus(jobId, workspaceId, 'failed_terminal', {
            step: 'parsing_metadata',
            errorCode,
            errorMessage: retryable ? `${errorMessage} (max retries exceeded)` : errorMessage,
          });

          await dbClient
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
        // 状态更新失败，返回可重试让队列处理
        console.error(`Failed to update job status for ${jobId}:`, updateErr);
        return { success: false, retryable: true, error: err instanceof Error ? err : new Error(String(err)) };
      }
    }
  });
}

/**
 * 错误分类：判断错误是否可重试
 */
function classifyError(err: unknown): {
  retryable: boolean;
  errorCode: string;
  errorMessage: string;
} {
  // AppError 优先使用其自身的 retryable 标记
  if (err instanceof AppError) {
    return {
      retryable: err.retryable,
      errorCode: err.code,
      errorMessage: err.message,
    };
  }

  if (err instanceof Error) {
    const message = err.message.toLowerCase();

    // Terminal 错误（不可重试）
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

    // Retryable 错误（网络超时、连接错误等）
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

  // 默认：未知错误视为可重试
  return {
    retryable: true,
    errorCode: 'PARSE_UNKNOWN',
    errorMessage: err instanceof Error ? err.message : 'Unknown error',
  };
}
