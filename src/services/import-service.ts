import { eq, and, count, sql } from 'drizzle-orm';
import { db } from '../db';
import { videos, ingestionJobs } from '../db/schema';
import { DouyinConnector } from '../infrastructure/douyin-connector';
import { ImportJob, JobStatus } from '../domain/types';
import { AppError } from '../domain/errors';
import {
  canCancel,
  canRetry,
  getRetryState,
  validateTransition,
} from '../domain/state-machine';
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

  async getJobStatus(jobId: string, workspaceId: string): Promise<ImportJob | null> {
    const result = await db
      .select()
      .from(ingestionJobs)
      .where(and(eq(ingestionJobs.id, jobId), eq(ingestionJobs.workspaceId, workspaceId)))
      .limit(1);

    return result[0] ? mapRowToImportJob(result[0] as Record<string, unknown>) : null;
  }

  /**
   * 列出任务（支持状态过滤、分页）
   */
  async listJobs(options: {
    workspaceId: string;
    status?: JobStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ items: ImportJob[]; total: number }> {
    const { workspaceId, status, limit = 20, offset = 0 } = options;

    const whereConditions = [eq(ingestionJobs.workspaceId, workspaceId)];
    if (status) {
      whereConditions.push(eq(ingestionJobs.status, status));
    }

    const whereClause = and(...whereConditions);

    // 查询总数
    const countResult = await db
      .select({ value: count() })
      .from(ingestionJobs)
      .where(whereClause);
    const total = countResult[0]?.value ?? 0;

    // 查询分页数据
    const rows = await db
      .select()
      .from(ingestionJobs)
      .where(whereClause)
      .limit(limit)
      .offset(offset)
      .orderBy(sql`${ingestionJobs.createdAt} DESC`);

    const items = rows.map((row) => mapRowToImportJob(row as Record<string, unknown>));

    return { items, total };
  }

  /**
   * 取消任务
   */
  async cancelJob(jobId: string, workspaceId: string): Promise<ImportJob> {
    const job = await this.getJobStatus(jobId, workspaceId);
    if (!job) {
      throw new AppError('JOB_NOT_FOUND', 'Job not found', false, 404);
    }

    if (!canCancel(job.status)) {
      throw new AppError(
        'JOB_CANNOT_CANCEL',
        `Cannot cancel job in status "${job.status}"`,
        false,
        409
      );
    }

    validateTransition(job.status, 'cancelled');

    await db
      .update(ingestionJobs)
      .set({
        status: 'cancelled',
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(ingestionJobs.id, jobId), eq(ingestionJobs.workspaceId, workspaceId)));

    const updated = await this.getJobStatus(jobId, workspaceId);
    if (!updated) {
      throw new AppError('JOB_NOT_FOUND', 'Job not found after update', false, 404);
    }
    return updated;
  }

  /**
   * 重试任务（从 failed_retryable 状态恢复）
   */
  async retryJob(jobId: string, workspaceId: string): Promise<ImportJob> {
    const job = await this.getJobStatus(jobId, workspaceId);
    if (!job) {
      throw new AppError('JOB_NOT_FOUND', 'Job not found', false, 404);
    }

    if (!canRetry(job.status)) {
      throw new AppError(
        'JOB_CANNOT_RETRY',
        `Cannot retry job in status "${job.status}"`,
        false,
        409
      );
    }

    const retryState = getRetryState(job.step);
    if (!retryState) {
      throw new AppError(
        'JOB_INVALID_RETRY_STATE',
        'Cannot determine retry state',
        false,
        500
      );
    }

    validateTransition(job.status, retryState);

    await db
      .update(ingestionJobs)
      .set({
        status: retryState,
        retryCount: 0,
        errorCode: null,
        errorMessage: null,
        nextRetryAt: null,
        lastErrorAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(ingestionJobs.id, jobId), eq(ingestionJobs.workspaceId, workspaceId)));

    const updated = await this.getJobStatus(jobId, workspaceId);
    if (!updated) {
      throw new AppError('JOB_NOT_FOUND', 'Job not found after update', false, 404);
    }
    return updated;
  }

  /**
   * 更新任务状态（供 Worker 调用）
   */
  async updateJobStatus(
    jobId: string,
    workspaceId: string,
    status: JobStatus,
    options?: {
      step?: string;
      progress?: number;
      errorCode?: string;
      errorMessage?: string;
      nextRetryAt?: Date;
    }
  ): Promise<ImportJob> {
    const job = await this.getJobStatus(jobId, workspaceId);
    if (!job) {
      throw new AppError('JOB_NOT_FOUND', 'Job not found', false, 404);
    }

    validateTransition(job.status, status);

    const updateData: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };

    if (options?.step !== undefined) {
      updateData.step = options.step;
    }
    if (options?.progress !== undefined) {
      updateData.progress = options.progress;
    }
    if (options?.errorCode !== undefined) {
      updateData.errorCode = options.errorCode;
    }
    if (options?.errorMessage !== undefined) {
      updateData.errorMessage = options.errorMessage;
    }
    if (options?.nextRetryAt !== undefined) {
      updateData.nextRetryAt = options.nextRetryAt;
    }

    // 如果进入终止状态，记录完成时间
    if (status === 'completed' || status === 'partial_completed' || status === 'failed_terminal' || status === 'cancelled') {
      updateData.finishedAt = new Date();
    }

    // 如果进入失败状态，记录错误时间和重试次数
    if (status === 'failed_retryable' || status === 'failed_terminal') {
      updateData.lastErrorAt = new Date();
      updateData.retryCount = (job.retryCount ?? 0) + 1;
    }

    await db
      .update(ingestionJobs)
      .set(updateData)
      .where(and(eq(ingestionJobs.id, jobId), eq(ingestionJobs.workspaceId, workspaceId)));

    const updated = await this.getJobStatus(jobId, workspaceId);
    if (!updated) {
      throw new AppError('JOB_NOT_FOUND', 'Job not found after update', false, 404);
    }
    return updated;
  }
}
