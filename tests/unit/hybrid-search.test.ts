import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion, normalizeScores } from '../../src/services/search-service';
import { SearchHit } from '../../src/domain/types';

describe('Hybrid Search', () => {
  describe('normalizeScores', () => {
    it('should normalize to [0, 1] range', () => {
      const hits: SearchHit[] = [
        { chunkId: '1', videoId: 'v1', content: 'a', contentType: 'transcript', score: 10 },
        { chunkId: '2', videoId: 'v1', content: 'b', contentType: 'transcript', score: 5 },
        { chunkId: '3', videoId: 'v1', content: 'c', contentType: 'transcript', score: 0 },
      ];

      const normalized = normalizeScores(hits);
      expect(normalized[0].score).toBeCloseTo(1, 5);
      expect(normalized[1].score).toBeCloseTo(0.5, 5);
      expect(normalized[2].score).toBeCloseTo(0, 5);
    });

    it('should handle single result', () => {
      const hits: SearchHit[] = [
        { chunkId: '1', videoId: 'v1', content: 'a', contentType: 'transcript', score: 5 },
      ];

      const normalized = normalizeScores(hits);
      expect(normalized[0].score).toBe(1);
    });
  });

  describe('reciprocalRankFusion', () => {
    it('should fuse two ranked lists', () => {
      const bm25Hits: SearchHit[] = [
        { chunkId: 'a', videoId: 'v1', content: 'a', contentType: 'transcript', score: 1.0 },
        { chunkId: 'b', videoId: 'v1', content: 'b', contentType: 'transcript', score: 0.8 },
        { chunkId: 'c', videoId: 'v2', content: 'c', contentType: 'transcript', score: 0.6 },
      ];

      const vectorHits: SearchHit[] = [
        { chunkId: 'b', videoId: 'v1', content: 'b', contentType: 'transcript', score: 0.95 },
        { chunkId: 'a', videoId: 'v1', content: 'a', contentType: 'transcript', score: 0.85 },
        { chunkId: 'd', videoId: 'v2', content: 'd', contentType: 'transcript', score: 0.7 },
      ];

      const fused = reciprocalRankFusion(bm25Hits, vectorHits, { k: 60 });

      // a and b have same RRF score (rank 1+2 vs rank 2+1), but both should be top
      expect(fused.length).toBe(4); // a, b, c, d
      const topChunkIds = fused.slice(0, 2).map(h => h.chunkId);
      expect(topChunkIds).toContain('a');
      expect(topChunkIds).toContain('b');
    });

    it('should handle empty lists', () => {
      const fused = reciprocalRankFusion([], [], { k: 60 });
      expect(fused).toEqual([]);
    });
  });
});
