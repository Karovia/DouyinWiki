import { z } from 'zod';
import { router, authedProcedure, throwTrpcError } from '../trpc';
import { VideoService } from '../../services/video-service';
import { SQLiteVectorStore } from '../../infrastructure/vector-store';

const vectorStore = new SQLiteVectorStore();
const videoService = new VideoService(vectorStore);

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

  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await videoService.deleteVideo(input.id, ctx.workspaceId);
        if (!result.deleted) {
          throw new Error('Video not found');
        }
        return { success: true };
      } catch (err) {
        throwTrpcError(err);
      }
    }),
});
