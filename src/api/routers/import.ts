import { z } from 'zod';
import { router, authedProcedure, throwTrpcError } from '../trpc';
import { ImportService } from '../../services/import-service';
import { MockDouyinConnector } from '../../infrastructure/douyin-connector';
import { queue } from '../../workers/queue';

// 依赖注入（Phase 1 简化版）
const connector = new MockDouyinConnector();
const importService = new ImportService(connector);

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
});
