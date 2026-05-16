import { EmbeddingClient } from '~/infrastructure/embedding-client';
import { VectorStore } from '~/infrastructure/vector-store';
import { BM25Search } from '~/infrastructure/bm25-search';
import { SearchHit, SearchFilter } from '~/domain/types';
import { like, or, and, inArray, eq } from 'drizzle-orm';
import { videos } from '../db/schema';
import { db, type DbClient } from '../db';
import type { Reranker } from '~/infrastructure/reranker';

export interface SemanticSearchOptions {
  workspaceId: string;
  query: string;
  topK?: number;
  filters?: SearchFilter;
}

export interface TagFilter {
  aiTags?: string[];      // AI tags must contain at least one
  tags?: string[];        // Video tags must contain at least one
}

export interface HybridSearchOptions extends SemanticSearchOptions {
  vectorWeight?: number;
  bm25Weight?: number;
  rerank?: boolean;
  tagFilter?: TagFilter;
}

export interface GroupedSearchResult {
  videoId: string;
  chunks: SearchHit[];
  bestScore: number;
  videoTitle?: string;
  videoCover?: string;
  authorName?: string;
}

export interface HybridSearchResult {
  hits: SearchHit[];
  grouped: GroupedSearchResult[];
  total: number;
}

// Score normalization to [0, 1]
export function normalizeScores(hits: SearchHit[]): SearchHit[] {
  if (hits.length === 0) return [];
  if (hits.length === 1) return [{ ...hits[0], score: 1 }];
  const scores = hits.map(h => h.score);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const range = max - min || 1;
  return hits.map(h => ({ ...h, score: (h.score - min) / range }));
}

// RRF: score = Σ 1 / (k + rank_i)
export function reciprocalRankFusion(
  bm25Hits: SearchHit[],
  vectorHits: SearchHit[],
  options: { k?: number } = {}
): SearchHit[] {
  const k = options.k ?? 60;
  const scores = new Map<string, { hit: SearchHit; rrfScore: number }>();

  for (let rank = 0; rank < bm25Hits.length; rank++) {
    const hit = bm25Hits[rank];
    const key = `${hit.videoId}:${hit.chunkId}`;
    const existing = scores.get(key);
    if (existing) {
      existing.rrfScore += 1 / (k + rank + 1);
    } else {
      scores.set(key, { hit, rrfScore: 1 / (k + rank + 1) });
    }
  }

  for (let rank = 0; rank < vectorHits.length; rank++) {
    const hit = vectorHits[rank];
    const key = `${hit.videoId}:${hit.chunkId}`;
    const existing = scores.get(key);
    if (existing) {
      existing.rrfScore += 1 / (k + rank + 1);
    } else {
      scores.set(key, { hit, rrfScore: 1 / (k + rank + 1) });
    }
  }

  return Array.from(scores.values())
    .map(({ hit, rrfScore }) => ({ ...hit, score: rrfScore }))
    .sort((a, b) => b.score - a.score);
}

export function groupByVideo(
  hits: SearchHit[],
  videoInfo: Map<string, { title?: string; coverUrl?: string; authorName?: string }>
): GroupedSearchResult[] {
  const groups = new Map<string, GroupedSearchResult>();

  for (const hit of hits) {
    const existing = groups.get(hit.videoId);
    if (existing) {
      existing.chunks.push(hit);
      if (hit.score > existing.bestScore) {
        existing.bestScore = hit.score;
      }
    } else {
      const info = videoInfo.get(hit.videoId) || {};
      groups.set(hit.videoId, {
        videoId: hit.videoId,
        chunks: [hit],
        bestScore: hit.score,
        videoTitle: info.title,
        videoCover: info.coverUrl,
        authorName: info.authorName,
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.bestScore - a.bestScore);
}

export class SearchService {
  constructor(
    private embeddingClient: EmbeddingClient,
    private vectorStore: VectorStore
  ) {}

  async semanticSearch(options: SemanticSearchOptions): Promise<{
    hits: SearchHit[];
    total: number;
  }> {
    const { workspaceId, query, topK = 20, filters } = options;

    // 1. 将查询文本转为向量
    const [queryEmbedding] = await this.embeddingClient.embed([query]);

    // 2. 向量检索
    const hits = await this.vectorStore.search({
      workspaceId,
      queryEmbedding,
      topK,
      filters,
    });

    return {
      hits,
      total: hits.length,
    };
  }
}

export class HybridSearchService {
  constructor(
    private embeddingClient: EmbeddingClient,
    private vectorStore: VectorStore,
    private bm25Search: BM25Search,
    private dbClient: DbClient = db,
    private reranker?: Reranker
  ) {}

  private async filterVideoIdsByTags(
    workspaceId: string,
    tagFilter: TagFilter
  ): Promise<string[]> {
    const conditions = [eq(videos.workspaceId, workspaceId)];

    if (tagFilter.aiTags && tagFilter.aiTags.length > 0) {
      // SQLite doesn't support JSON_CONTAINS, use LIKE approximation
      const aiTagConditions = tagFilter.aiTags.map(tag =>
        like(videos.aiTags, `%"${tag}"%`)
      );
      conditions.push(or(...aiTagConditions));
    }

    if (tagFilter.tags && tagFilter.tags.length > 0) {
      const tagConditions = tagFilter.tags.map(tag =>
        like(videos.tags, `%"${tag}"%`)
      );
      conditions.push(or(...tagConditions));
    }

    const rows = await this.dbClient
      .select({ id: videos.id })
      .from(videos)
      .where(and(...conditions));

    return rows.map(r => r.id);
  }

  async hybridSearch(options: HybridSearchOptions): Promise<HybridSearchResult> {
    const {
      workspaceId,
      query,
      topK = 20,
      filters,
      vectorWeight = 0.5,
      bm25Weight = 0.5,
      rerank = false,
      tagFilter,
    } = options;

    // 1. Get videoIds from tag filter (if any)
    let allowedVideoIds: string[] | undefined;
    if (tagFilter && (tagFilter.aiTags?.length || tagFilter.tags?.length)) {
      allowedVideoIds = await this.filterVideoIdsByTags(workspaceId, tagFilter);
      if (allowedVideoIds.length === 0) {
        return { hits: [], grouped: [], total: 0 };
      }
    }

    const combinedFilters: SearchFilter = {
      ...filters,
      ...(allowedVideoIds ? { videoIds: allowedVideoIds } : {}),
    };

    // 2. Embed query
    const [queryEmbedding] = await this.embeddingClient.embed([query]);

    // 3. Run BM25 and vector search in parallel
    const [bm25Hits, vectorHits] = await Promise.all([
      this.bm25Search.search({ workspaceId, query, topK: topK * 2, filters: combinedFilters }),
      this.vectorStore.search({ workspaceId, queryEmbedding, topK: topK * 2, filters: combinedFilters }),
    ]);

    // 4. Normalize scores
    const normalizedBm25 = normalizeScores(bm25Hits);
    const normalizedVector = normalizeScores(vectorHits);

    let fusedHits: SearchHit[];
    if (vectorWeight === 1.0 && bm25Weight === 0) {
      fusedHits = normalizedVector;
    } else if (bm25Weight === 1.0 && vectorWeight === 0) {
      fusedHits = normalizedBm25;
    } else {
      fusedHits = reciprocalRankFusion(normalizedBm25, normalizedVector, { k: 60 });
    }

    // 5. Rerank if enabled
    if (rerank && this.reranker) {
      fusedHits = await this.reranker.rerank(query, fusedHits);
    }

    // 6. Get video info for grouping
    const finalHits = fusedHits.slice(0, topK);
    const videoIds = [...new Set(finalHits.map(h => h.videoId))];
    const videoRows = await this.dbClient
      .select()
      .from(videos)
      .where(
        and(
          eq(videos.workspaceId, workspaceId),
          inArray(videos.id, videoIds)
        )
      );

    const videoInfo = new Map<string, { title?: string; coverUrl?: string; authorName?: string }>();
    for (const v of videoRows) {
      videoInfo.set(v.id, {
        title: v.title || undefined,
        coverUrl: v.coverUrl || undefined,
        authorName: v.authorName || undefined,
      });
    }

    const grouped = groupByVideo(finalHits, videoInfo);

    return {
      hits: finalHits,
      grouped,
      total: finalHits.length,
    };
  }
}
