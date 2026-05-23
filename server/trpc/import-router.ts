import { router, publicProcedure } from './trpc';
import { createImportSchema, importStatusSchema, retryImportSchema } from './schemas';
import { ingestionJobs, videos } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createHash } from 'crypto';
import {
  JOB_STATUSES,
  isValidTransition,
  getProgressForStatus,
  type JobStatus,
} from '../domain/types';
import { enqueueJob } from '../workers/worker-queue';

/**
 * 生成幂等键
 */
function generateIdempotencyKey(workspaceId: string, shareUrl: string): string {
  const normalized = shareUrl.trim().toLowerCase();
  const hash = createHash('sha256').update(`${workspaceId}:douyin:${normalized}`).digest('hex').slice(0, 16);
  return hash;
}

/**
 * 规范化 URL 并生成 hash
 */
function normalizeUrl(url: string): { normalized: string; hash: string } {
  const normalized = url.trim().toLowerCase();
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return { normalized, hash };
}

export const importRouter = router({
  /**
   * 创建导入任务
   * 支持幂等：同一 workspace 内重复链接返回已有任务
   */
  create: publicProcedure
    .input(createImportSchema)
    .mutation(async (opts) => {
      const { shareUrl, workspaceId } = opts.input;
      const { ctx } = opts;

      // 生成幂等键
      const idempotencyKey = generateIdempotencyKey(workspaceId, shareUrl);
      const { hash: urlHash } = normalizeUrl(shareUrl);

      // 检查幂等键是否已存在
      const existingJobs = await ctx.db
        .select()
        .from(ingestionJobs)
        .where(eq(ingestionJobs.idempotencyKey, idempotencyKey));

      if (existingJobs.length > 0) {
        const existingJob = existingJobs[0]!;
        return {
          jobId: existingJob.id,
          status: existingJob.status as JobStatus,
          videoId: existingJob.videoId,
          isDuplicate: true,
        };
      }

      // 创建 video 记录
      const videoId = nanoid(16);
      const jobId = nanoid(16);

      const now = new Date();
      await ctx.db.insert(videos).values({
        id: videoId,
        workspaceId,
        shareUrl,
        normalizedUrlHash: urlHash,
        status: 'created',
        createdAt: now,
        updatedAt: now,
      });

      // 创建导入任务
      await ctx.db.insert(ingestionJobs).values({
        id: jobId,
        workspaceId,
        videoId,
        shareUrl,
        idempotencyKey,
        status: JOB_STATUSES.CREATED,
        progress: 0,
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      // 将任务加入处理队列
      enqueueJob(jobId);

      return {
        jobId,
        status: JOB_STATUSES.CREATED as JobStatus,
        videoId,
        isDuplicate: false,
      };
    }),

  /**
   * 查询导入任务状态
   */
  status: publicProcedure
    .input(importStatusSchema)
    .query(async (opts) => {
      const { jobId, workspaceId } = opts.input;
      const { ctx } = opts;

      const jobs = await ctx.db
        .select()
        .from(ingestionJobs)
        .where(and(
          eq(ingestionJobs.id, jobId),
          eq(ingestionJobs.workspaceId, workspaceId),
        ));

      const job = jobs[0];
      if (!job) {
        return { found: false };
      }

      // 查询关联的视频信息
      let videoInfo: typeof videos.$inferSelect | null = null;
      if (job.videoId) {
        const videoRows = await ctx.db
          .select()
          .from(videos)
          .where(eq(videos.id, job.videoId));
        videoInfo = videoRows[0] ?? null;
      }

      return {
        found: true,
        jobId: job.id,
        status: job.status as JobStatus,
        currentStep: job.currentStep,
        progress: job.progress,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        retryCount: job.retryCount,
        videoId: job.videoId,
        video: videoInfo ? {
          id: videoInfo.id,
          title: videoInfo.title,
          authorName: videoInfo.authorName,
          coverUrl: videoInfo.coverUrl,
          status: videoInfo.status,
          aiSummary: videoInfo.aiSummary,
        } : null,
        createdAt: job.createdAt?.getTime() ?? null,
        updatedAt: job.updatedAt?.getTime() ?? null,
      };
    }),

  /**
   * 重试可恢复的失败任务
   */
  retry: publicProcedure
    .input(retryImportSchema)
    .mutation(async (opts) => {
      const { jobId, workspaceId } = opts.input;
      const { ctx } = opts;

      const jobs = await ctx.db
        .select()
        .from(ingestionJobs)
        .where(and(
          eq(ingestionJobs.id, jobId),
          eq(ingestionJobs.workspaceId, workspaceId),
        ));

      const job = jobs[0];
      if (!job) {
        return { success: false, error: '任务不存在' };
      }

      if (job.status !== JOB_STATUSES.FAILED_RETRYABLE) {
        return { success: false, error: '当前状态不允许重试' };
      }

      // 重置任务状态
      const newRetryCount = (job.retryCount ?? 0) + 1;
      const MAX_RETRY = 3;
      if (newRetryCount > MAX_RETRY) {
        await ctx.db
          .update(ingestionJobs)
          .set({
            status: JOB_STATUSES.FAILED_TERMINAL,
            errorCode: 'JOB_MAX_RETRY_EXCEEDED',
            errorMessage: `已超过最大重试次数 (${MAX_RETRY})`,
            updatedAt: new Date(),
          })
          .where(eq(ingestionJobs.id, jobId));
        return { success: false, error: '已超过最大重试次数' };
      }

      if (!isValidTransition(job.status as JobStatus, JOB_STATUSES.CREATED)) {
        return { success: false, error: '非法状态转换' };
      }

      await ctx.db
        .update(ingestionJobs)
        .set({
          status: JOB_STATUSES.CREATED,
          retryCount: newRetryCount,
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(ingestionJobs.id, jobId));

      // 重新加入队列
      enqueueJob(jobId);

      return { success: true, jobId };
    }),
});
