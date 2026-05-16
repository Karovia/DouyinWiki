import { z } from 'zod';
import { router, authedProcedure, throwTrpcError } from '../trpc';
import { ImportService } from '../../services/import-service';
import { MockDouyinConnector } from '../../infrastructure/douyin-connector';
import { db } from '../../db';
import { queue } from '../../workers/queue';
import { JobStatus } from '../../domain/types';

// 依赖注入（Phase 1 简化版）
const connector = new MockDouyinConnector();
const importService = new ImportService(connector, db);

const jobStatusEnum = z.enum([
  'created',
  'parsing_metadata',
  'fetching_content',
  'transcribing',
  'chunking',
  'summarizing',
  'embedding',
  'indexing',
  'graph_updating',
  'completed',
  'partial_completed',
  'failed_retryable',
  'failed_terminal',
  'cancelled',
]);

export const importRouter = router({
  create: authedProcedure
    .input(z.object({ shareUrl: z.string().url() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const job = await importService.createImportJob(input.shareUrl, ctx.workspaceId);

        // 入队异步处理
        queue.enqueue({
          id: job.id,
          type: 'parse_metadata',
          payload: {
            jobId: job.id,
            videoId: job.videoId!,
            shareUrl: input.shareUrl,
            workspaceId: ctx.workspaceId,
          },
        });

        return { jobId: job.id, status: job.status };
      } catch (err) {
        throwTrpcError(err);
      }
    }),

  status: authedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        const job = await importService.getJobStatus(input.jobId, ctx.workspaceId);
        if (!job) {
          throw new Error('Job not found');
        }
        return {
          id: job.id,
          status: job.status,
          step: job.step,
          progress: job.progress,
          errorCode: job.errorCode,
          errorMessage: job.errorMessage,
          videoId: job.videoId,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        };
      } catch (err) {
        throwTrpcError(err);
      }
    }),

  list: authedProcedure
    .input(z.object({
      status: jobStatusEnum.optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const result = await importService.listJobs({
          workspaceId: ctx.workspaceId,
          status: input.status as JobStatus | undefined,
          limit: input.limit,
          offset: input.offset,
        });

        return {
          items: result.items.map((job) => ({
            id: job.id,
            status: job.status,
            step: job.step,
            progress: job.progress,
            errorCode: job.errorCode,
            errorMessage: job.errorMessage,
            videoId: job.videoId,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
          })),
          total: result.total,
        };
      } catch (err) {
        throwTrpcError(err);
      }
    }),

  cancel: authedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const job = await importService.cancelJob(input.jobId, ctx.workspaceId);
        return {
          id: job.id,
          status: job.status,
          updatedAt: job.updatedAt,
        };
      } catch (err) {
        throwTrpcError(err);
      }
    }),

  retry: authedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const job = await importService.retryJob(input.jobId, ctx.workspaceId);
        return {
          id: job.id,
          status: job.status,
          step: job.step,
          updatedAt: job.updatedAt,
        };
      } catch (err) {
        throwTrpcError(err);
      }
    }),
});
