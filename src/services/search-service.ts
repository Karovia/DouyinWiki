import { EmbeddingClient } from '~/infrastructure/embedding-client';
import { VectorStore } from '~/infrastructure/vector-store';
import { BM25Search } from '~/infrastructure/bm25-search';
import { SearchHit, SearchFilter } from '~/domain/types';

export interface SemanticSearchOptions {
  workspaceId: string;
  query: string;
  topK?: number;
  filters?: SearchFilter;
}

export interface HybridSearchOptions extends SemanticSearchOptions {
  vectorWeight?: number;
  bm25Weight?: number;
  rerank?: boolean;
}

export interface GroupedSearchResult {
  videoId: string;
  chunks: SearchHit[];
  bestScore: number;
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
    private bm25Search: BM25Search
  ) {}

  async hybridSearch(options: HybridSearchOptions): Promise<HybridSearchResult> {
    const {
      workspaceId,
      query,
      topK = 20,
      filters,
      vectorWeight = 0.5,
      bm25Weight = 0.5,
    } = options;

    // 1. Embed query
    const [queryEmbedding] = await this.embeddingClient.embed([query]);

    // 2. Run BM25 and vector search in parallel
    const [bm25Hits, vectorHits] = await Promise.all([
      this.bm25Search.search({ workspaceId, query, topK, filters }),
      this.vectorStore.search({ workspaceId, queryEmbedding, topK, filters }),
    ]);

    // 3. Normalize scores from both sources
    const normalizedBm25 = normalizeScores(bm25Hits);
    const normalizedVector = normalizeScores(vectorHits);

    let fusedHits: SearchHit[];

    // 4. If only one source is weighted, return only that source
    if (vectorWeight === 1.0 && bm25Weight === 0) {
      fusedHits = normalizedVector;
    } else if (bm25Weight === 1.0 && vectorWeight === 0) {
      fusedHits = normalizedBm25;
    } else {
      // 5. Fuse with RRF
      fusedHits = reciprocalRankFusion(normalizedBm25, normalizedVector, { k: 60 });
    }

    return {
      hits: fusedHits,
      grouped: [],
      total: fusedHits.length,
    };
  }
}
