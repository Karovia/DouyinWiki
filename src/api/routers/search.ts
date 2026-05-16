import { z } from 'zod';
import { router, authedProcedure } from '../trpc';
import { SearchService, HybridSearchService } from '~/services/search-service';
import { MockEmbeddingClient } from '~/infrastructure/embedding-client';
import { SQLiteVectorStore } from '~/infrastructure/vector-store';
import { SQLiteBM25Search } from '~/infrastructure/bm25-search';
import { SimpleReranker } from '~/infrastructure/reranker';
import { db } from '~/db';

const embeddingClient = new MockEmbeddingClient();
const vectorStore = new SQLiteVectorStore();
const bm25Search = new SQLiteBM25Search();
const reranker = new SimpleReranker();

const searchService = new SearchService(embeddingClient, vectorStore);
const hybridService = new HybridSearchService(
  embeddingClient,
  vectorStore,
  bm25Search,
  db,
  reranker
);

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

  hybrid: authedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(500),
        topK: z.number().min(1).max(100).default(20),
        contentTypes: z.array(z.string()).optional(),
        aiTags: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        vectorWeight: z.number().min(0).max(1).default(0.5),
        bm25Weight: z.number().min(0).max(1).default(0.5),
        rerank: z.boolean().default(false),
      })
    )
    .query(async ({ input, ctx }) => {
      const result = await hybridService.hybridSearch({
        workspaceId: ctx.workspaceId,
        query: input.query,
        topK: input.topK,
        filters: input.contentTypes
          ? { contentTypes: input.contentTypes }
          : undefined,
        tagFilter: {
          aiTags: input.aiTags,
          tags: input.tags,
        },
        vectorWeight: input.vectorWeight,
        bm25Weight: input.bm25Weight,
        rerank: input.rerank,
      });

      return {
        hits: result.hits,
        grouped: result.grouped,
        total: result.total,
      };
    }),
});
