import { z } from 'zod';
import { router, authedProcedure } from '../trpc';
import { SearchService } from '~/services/search-service';
import { MockEmbeddingClient } from '~/infrastructure/embedding-client';
import { SQLiteVectorStore } from '~/infrastructure/vector-store';

const embeddingClient = new MockEmbeddingClient();
const vectorStore = new SQLiteVectorStore();
const searchService = new SearchService(embeddingClient, vectorStore);

export const searchRouter = router({
  semantic: authedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(500),
        topK: z.number().min(1).max(100).default(20),
        contentTypes: z.array(z.string()).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const result = await searchService.semanticSearch({
        workspaceId: ctx.workspaceId,
        query: input.query,
        topK: input.topK,
        filters: input.contentTypes
          ? { contentTypes: input.contentTypes }
          : undefined,
      });

      return {
        hits: result.hits.map((hit) => ({
          chunkId: hit.chunkId,
          videoId: hit.videoId,
          content: hit.content,
          contentType: hit.contentType,
          startTimeMs: hit.startTimeMs,
          endTimeMs: hit.endTimeMs,
          score: hit.score,
        })),
        total: result.total,
      };
    }),
});
