import { describe, it, expect, beforeEach } from 'vitest';
import { SQLiteVectorStore } from '~/infrastructure/vector-store';
import { db } from '~/db';
import { embeddings, chunks, videos } from '~/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

describe('SQLiteVectorStore', () => {
  const store = new SQLiteVectorStore();
  const workspaceId = 'test-workspace';

  beforeEach(async () => {
    await db.delete(embeddings).where(eq(embeddings.workspaceId, workspaceId));
    await db.delete(chunks).where(eq(chunks.workspaceId, workspaceId));
    await db.delete(videos).where(eq(videos.workspaceId, workspaceId));
  });

  async function createVideo(videoId: string) {
    await db.insert(videos).values({
      id: videoId,
      workspaceId,
      platform: 'douyin',
      shareUrl: 'https://test.com/video/1',
      normalizedUrlHash: `hash-${videoId}`,
      status: 'pending',
    });
  }

  it('should upsert and search embeddings', async () => {
    const videoId = nanoid();
    const chunkId = nanoid();

    await createVideo(videoId);
    await db.insert(chunks).values({
      id: chunkId,
      videoId,
      workspaceId,
      contentType: 'transcript',
      chunkIndex: 0,
      content: '测试文本内容',
      contentHash: 'hash123',
    });

    await store.upsert([{
      id: nanoid(),
      chunkId,
      videoId,
      workspaceId,
      modelName: 'mock-model',
      dimension: 3,
      embedding: [1, 0, 0],
      contentHash: 'hash123',
      createdAt: new Date(),
    }]);

    const results = await store.search({
      workspaceId,
      queryEmbedding: [1, 0, 0],
      topK: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunkId).toBe(chunkId);
    expect(results[0].content).toBe('测试文本内容');
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it('should return empty for non-matching workspace', async () => {
    const results = await store.search({
      workspaceId: 'non-existent',
      queryEmbedding: [1, 0, 0],
      topK: 5,
    });

    expect(results).toEqual([]);
  });

  it('should respect contentType filter', async () => {
    const videoId = nanoid();
    const chunk1 = nanoid();
    const chunk2 = nanoid();

    await createVideo(videoId);
    await db.insert(chunks).values([
      { id: chunk1, videoId, workspaceId, contentType: 'transcript', chunkIndex: 0, content: '转写内容', contentHash: 'h1' },
      { id: chunk2, videoId, workspaceId, contentType: 'title', chunkIndex: 0, content: '标题内容', contentHash: 'h2' },
    ]);

    await store.upsert([
      { id: nanoid(), chunkId: chunk1, videoId, workspaceId, modelName: 'mock', dimension: 3, embedding: [1, 0, 0], contentHash: 'h1', createdAt: new Date() },
      { id: nanoid(), chunkId: chunk2, videoId, workspaceId, modelName: 'mock', dimension: 3, embedding: [0, 1, 0], contentHash: 'h2', createdAt: new Date() },
    ]);

    const results = await store.search({
      workspaceId,
      queryEmbedding: [1, 0, 0],
      topK: 5,
      filters: { contentTypes: ['transcript'] },
    });

    expect(results.length).toBe(1);
    expect(results[0].contentType).toBe('transcript');
  });
});
