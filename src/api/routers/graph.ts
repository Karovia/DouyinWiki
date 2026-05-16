import { z } from 'zod';
import { router, authedProcedure, throwTrpcError } from '../trpc';
import { GraphService } from '~/services/graph-service';

const graphService = new GraphService();

export const graphRouter = router({
  neighbors: authedProcedure
    .input(z.object({
      videoId: z.string(),
      relationTypes: z.array(z.enum(['same_topic', 'mentions'])).optional(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input, ctx }) => {
      try {
        return graphService.getNeighbors({
          workspaceId: ctx.workspaceId,
          videoId: input.videoId,
          relationTypes: input.relationTypes,
          limit: input.limit,
        });
      } catch (err) {
        throwTrpcError(err);
      }
    }),

  sameAuthor: authedProcedure
    .input(z.object({
      videoId: z.string(),
      authorId: z.string(),
      limit: z.number().min(1).max(50).default(10),
    }))
    .query(async ({ input, ctx }) => {
      try {
        return graphService.getSameAuthorVideos(
          ctx.workspaceId, input.videoId, input.authorId, input.limit
        );
      } catch (err) {
        throwTrpcError(err);
      }
    }),

  sameEntity: authedProcedure
    .input(z.object({
      videoId: z.string(),
      limit: z.number().min(1).max(50).default(10),
    }))
    .query(async ({ input, ctx }) => {
      try {
        return graphService.getSameEntityVideos(
          ctx.workspaceId, input.videoId, input.limit
        );
      } catch (err) {
        throwTrpcError(err);
      }
    }),
});
