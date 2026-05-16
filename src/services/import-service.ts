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
    workspaceId: (row.workspaceId ?? row.workspace_id) as string,
    shareUrl: (row.shareUrl ?? row.share_url) as string,
    normalizedUrlHash: (row.normalizedUrlHash ?? row.normalized_url_hash) as string,
    status: row.status as ImportJob['status'],
    step: (row.step as string | null) ?? undefined,
    progress: (row.progress as number | null) ?? 0,
    retryCount: ((row.retryCount as number | null) ?? row.retry_count as number | null) ?? 0,
    maxRetries: ((row.maxRetries as number | null) ?? row.max_retries as number | null) ?? 3,
    errorCode: ((row.errorCode as string | null) ?? row.error_code as string | null) ?? undefined,
    errorMessage: ((row.errorMessage as string | null) ?? row.error_message as string | null) ?? undefined,
    videoId: ((row.videoId as string | null) ?? row.video_id as string | null) ?? undefined,
    nextRetryAt: (row.nextRetryAt ?? row.next_retry_at) ? new Date((row.nextRetryAt ?? row.next_retry_at) as string | number) : undefined,
    lastErrorAt: (row.lastErrorAt ?? row.last_error_at) ? new Date((row.lastErrorAt ?? row.last_error_at) as string | number) : undefined,
    attemptedAt: (row.attemptedAt ?? row.attempted_at) ? new Date((row.attemptedAt ?? row.attempted_at) as string | number) : undefined,
    createdAt: (row.createdAt ?? row.created_at) ? new Date((row.createdAt ?? row.created_at) as string | number) : new Date(),
    updatedAt: (row.updatedAt ?? row.updated_at) ? new Date((row.updatedAt ?? row.updated_at) as string | number) : new Date(),
  };
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message.includes('UNIQUE constraint failed')) return true;
  if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT') return true;
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    if (cause.message.includes('UNIQUE constraint failed')) return true;
    if ((cause as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
    if ((cause as { code?: string }).code === 'SQLITE_CONSTRAINT') return true;
  }
  return false;
}

export class ImportService {
  constructor(private connector: DouyinConnector) {}

  async createImportJob(shareUrl: string, workspaceId: string = 'default'): Promise<ImportJob> {
    const parsed = await this.connector.parseUrl(shareUrl);

    try {
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

    const countResult = await db
      .select({ value: count() })
      .from(ingestionJobs)
      .where(whereClause);
    const total = countResult[0]?.value ?? 0;

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

    if (job.status === status) {
      return job;
    }

    validateTransition(job.status, status);

    const setData: {
      status: JobStatus;
      updatedAt: Date;
      step?: string;
      progress?: number;
      errorCode?: string | null;
      errorMessage?: string | null;
      nextRetryAt?: Date | null;
      finishedAt?: Date;
      lastErrorAt?: Date;
      retryCount?: number;
    } = {
      status,
      updatedAt: new Date(),
    };

    if (options?.step !== undefined) {
      setData.step = options.step;
    }
    if (options?.progress !== undefined) {
      setData.progress = options.progress;
    }
    if (options?.errorCode !== undefined) {
      setData.errorCode = options.errorCode;
    }
    if (options?.errorMessage !== undefined) {
      setData.errorMessage = options.errorMessage;
    }
    if (options?.nextRetryAt !== undefined) {
      setData.nextRetryAt = options.nextRetryAt;
    }

    if (status === 'completed' || status === 'partial_completed' || status === 'failed_terminal' || status === 'cancelled') {
      setData.finishedAt = new Date();
    }

    if (status === 'failed_retryable' || status === 'failed_terminal') {
      setData.lastErrorAt = new Date();
      setData.retryCount = (job.retryCount ?? 0) + 1;
    }

    await db
      .update(ingestionJobs)
      .set(setData)
      .where(and(eq(ingestionJobs.id, jobId), eq(ingestionJobs.workspaceId, workspaceId)));

    const updated = await this.getJobStatus(jobId, workspaceId);
    if (!updated) {
      throw new AppError('JOB_NOT_FOUND', 'Job not found after update', false, 404);
    }
    return updated;
  }
}
