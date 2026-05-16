import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { videos, ingestionJobs } from '../db/schema';
import { DouyinConnector } from '../infrastructure/douyin-connector';
import { ImportJob } from '../domain/types';
import { nanoid } from 'nanoid';

function mapRowToImportJob(row: Record<string, unknown>): ImportJob {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    shareUrl: row.share_url as string,
    normalizedUrlHash: row.normalized_url_hash as string,
    status: row.status as ImportJob['status'],
    step: (row.step as string | null) ?? undefined,
    progress: (row.progress as number | null) ?? 0,
    retryCount: (row.retry_count as number | null) ?? 0,
    maxRetries: (row.max_retries as number | null) ?? 3,
    errorCode: (row.error_code as string | null) ?? undefined,
    errorMessage: (row.error_message as string | null) ?? undefined,
    videoId: (row.video_id as string | null) ?? undefined,
    nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at as string | number) : undefined,
    lastErrorAt: row.last_error_at ? new Date(row.last_error_at as string | number) : undefined,
    attemptedAt: row.attempted_at ? new Date(row.attempted_at as string | number) : undefined,
    createdAt: row.created_at ? new Date(row.created_at as string | number) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at as string | number) : new Date(),
  };
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed');
}

export class ImportService {
  constructor(private connector: DouyinConnector) {}

  async createImportJob(shareUrl: string, workspaceId: string = 'default'): Promise<ImportJob> {
    // 1. 解析 URL
    const parsed = await this.connector.parseUrl(shareUrl);

    try {
      // 2. 在事务中创建视频记录和导入任务
      const result = await db.transaction(async (tx) => {
        const videoId = nanoid();
        await tx.insert(videos).values({
          id: videoId,
          workspaceId,
          platform: parsed.platform,
          platformVideoId: parsed.platformVideoId,
          shareUrl,
          normalizedUrlHash: parsed.normalizedUrlHash,
          status: 'pending',
        });

        const jobId = nanoid();
        await tx.insert(ingestionJobs).values({
          id: jobId,
          workspaceId,
          videoId,
          shareUrl,
          normalizedUrlHash: parsed.normalizedUrlHash,
          status: 'created',
          maxRetries: 3,
        });

        return { jobId };
      });

      const job = await db
        .select()
        .from(ingestionJobs)
        .where(eq(ingestionJobs.id, result.jobId))
        .limit(1);

      return mapRowToImportJob(job[0] as Record<string, unknown>);
    } catch (err) {
      // 3. 捕获唯一约束冲突，返回已有任务
      if (isUniqueConstraintError(err)) {
        const existingJob = await db
          .select()
          .from(ingestionJobs)
          .where(
            and(
              eq(ingestionJobs.workspaceId, workspaceId),
              eq(ingestionJobs.normalizedUrlHash, parsed.normalizedUrlHash)
            )
          )
          .limit(1);

        if (existingJob[0]) {
          return mapRowToImportJob(existingJob[0] as Record<string, unknown>);
        }
      }
      throw err;
    }
  }

  async getJobStatus(jobId: string): Promise<ImportJob | null> {
    const result = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, jobId))
      .limit(1);

    return result[0] ? mapRowToImportJob(result[0] as Record<string, unknown>) : null;
  }
}
