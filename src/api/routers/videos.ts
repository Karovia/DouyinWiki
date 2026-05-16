import { z } from 'zod';
import { router, authedProcedure, throwTrpcError } from '../trpc';
import { VideoService } from '../../services/video-service';

const videoService = new VideoService();

export const videosRouter = router({
  list: authedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const result = await videoService.list({
          workspaceId: ctx.workspaceId,
          limit: input.limit,
          offset: input.offset,
        });
        return result;
      } catch (err) {
        throwTrpcError(err);
      }
    }),

  detail: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        const video = await videoService.detail(input.id, ctx.workspaceId);
        if (!video) {
          throw new Error('Video not found');
        }
        return video;
      } catch (err) {
        throwTrpcError(err);
      }
    }),
});
