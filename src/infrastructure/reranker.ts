import { SearchHit } from '../domain/types';

export interface Reranker {
  rerank(query: string, hits: SearchHit[]): Promise<SearchHit[]>;
}

/**
 * Simple rule-based Reranker
 * - Exact match boost
 * - Term match boost
 * - Content-type priority boost
 */
export class SimpleReranker implements Reranker {
  async rerank(query: string, hits: SearchHit[]): Promise<SearchHit[]> {
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1);

    const reranked = hits.map(hit => {
      let boost = 0;
      const contentLower = hit.content.toLowerCase();

      // Exact match boost
      if (contentLower.includes(queryLower)) {
        boost += 0.3;
      }

      // Term match boost
      for (const term of queryTerms) {
        if (contentLower.includes(term)) {
          boost += 0.1;
        }
      }

      // Content-type priority: title > summary > transcript > note
      const typePriority: Record<string, number> = {
        title: 0.2,
        summary: 0.15,
        transcript: 0.05,
        note: 0.05,
      };
      boost += typePriority[hit.contentType] || 0;

      return {
        ...hit,
        score: hit.score + boost,
      };
    });

    return reranked.sort((a, b) => b.score - a.score);
  }
}
