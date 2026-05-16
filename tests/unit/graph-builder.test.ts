import { describe, it, expect, vi } from 'vitest';
import { GraphBuilder } from '~/domain/graph-builder';
import { SearchHit } from '~/infrastructure/vector-store';

const mockVectorStore = {
  upsert: vi.fn(),
  search: vi.fn(),
  deleteByOwner: vi.fn(),
};

describe('GraphBuilder', () => {
  it('generateMentionsEdges creates video->entity edges', () => {
    const builder = new GraphBuilder(mockVectorStore as any);
    const edges = builder.generateMentionsEdges('ws1', 'vid1', [
      { name: 'React', canonicalKey: 'react', type: 'technology', confidence: 0.9, isNew: true },
    ]);

    expect(edges).toHaveLength(1);
    expect(edges[0].sourceNodeId).toBe('video:vid1');
    expect(edges[0].targetNodeId).toBe('entity:react');
    expect(edges[0].relationType).toBe('mentions');
    expect(edges[0].weight).toBe(0.9);
  });

  it('generateMentionsEdges includes author edge', () => {
    const builder = new GraphBuilder(mockVectorStore as any);
    const edges = builder.generateMentionsEdges('ws1', 'vid1', [], 'author1');

    expect(edges).toHaveLength(1);
    expect(edges[0].targetNodeId).toBe('author:author1');
  });

  it('generateTopicEdges respects topK limit', async () => {
    mockVectorStore.search.mockResolvedValue([
      { videoId: 'vid2', chunkId: 'c1', content: 'a', contentType: 'summary', score: 0.9 },
      { videoId: 'vid3', chunkId: 'c2', content: 'b', contentType: 'summary', score: 0.8 },
      { videoId: 'vid4', chunkId: 'c3', content: 'c', contentType: 'summary', score: 0.7 },
    ] as SearchHit[]);

    const builder = new GraphBuilder(mockVectorStore as any, { topK: 2, minSimilarity: 0.5 });
    const edges = await builder.generateTopicEdges('ws1', 'vid1', [0.1, 0.2, 0.3]);

    expect(edges).toHaveLength(2);
    expect(mockVectorStore.search).toHaveBeenCalledWith(expect.objectContaining({ topK: 6 }));
  });
});
