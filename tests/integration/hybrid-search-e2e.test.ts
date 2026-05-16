import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, cleanTestDb } from '../helpers/db';
import { videos, chunks, embeddings } from '../../src/db/schema';
import { nanoid } from 'nanoid';
import { SQLiteVectorStore } from '../../src/infrastructure/vector-store';
import { SQLiteBM25Search } from '../../src/infrastructure/bm25-search';
import { HybridSearchService } from '../../src/services/search-service';
import { MockEmbeddingClient } from '../../src/infrastructure/embedding-client';
import { SimpleReranker } from '../../src/infrastructure/reranker';
import type { DbClient } from '../../src/db';

describe('Hybrid Search E2E', () => {
  let testDb: DbClient;
  let hybridService: HybridSearchService;
  const workspaceId = 'test-hybrid';

  beforeEach(async () => {
    testDb = await createTestDb();
    await cleanTestDb(testDb);

    const embeddingClient = new MockEmbeddingClient();
    const vectorStore = new SQLiteVectorStore(testDb);
    const bm25Search = new SQLiteBM25Search(testDb);
    const reranker = new SimpleReranker();

    hybridService = new HybridSearchService(
      embeddingClient,
      vectorStore,
      bm25Search,
      testDb,
      reranker
    );

    // Insert test data: 2 videos, 3 chunks each
    await testDb.insert(videos).values([
      {
        id: 'video-python',
        workspaceId,
        platform: 'douyin',
        shareUrl: 'https://douyin.com/video/py',
        normalizedUrlHash: 'hash-py',
        title: 'Python 编程教程',
        authorName: '编程达人',
        aiTags: JSON.stringify(['python', '编程', '教程']),
      },
      {
        id: 'video-cooking',
        workspaceId,
        platform: 'douyin',
        shareUrl: 'https://douyin.com/video/ck',
        normalizedUrlHash: 'hash-ck',
        title: '家常菜做法',
        authorName: '美食博主',
        aiTags: JSON.stringify(['美食', '烹饪', '教程']),
      },
    ]);

    await testDb.insert(chunks).values([
      // Python video
      { id: 'chunk-py-1', videoId: 'video-python', workspaceId, contentType: 'title', chunkIndex: 0, content: 'Python 编程教程', contentHash: 'h1' },
      { id: 'chunk-py-2', videoId: 'video-python', workspaceId, contentType: 'summary', chunkIndex: 0, content: '本视频讲解 Python 基础语法和常用库', contentHash: 'h2' },
      { id: 'chunk-py-3', videoId: 'video-python', workspaceId, contentType: 'transcript', chunkIndex: 0, content: '大家好今天我们来学习 Python 编程', contentHash: 'h3' },
      // Cooking video
      { id: 'chunk-ck-1', videoId: 'video-cooking', workspaceId, contentType: 'title', chunkIndex: 0, content: '家常菜做法大全', contentHash: 'h4' },
      { id: 'chunk-ck-2', videoId: 'video-cooking', workspaceId, contentType: 'summary', chunkIndex: 0, content: '分享几道简单易做的家常菜', contentHash: 'h5' },
      { id: 'chunk-ck-3', videoId: 'video-cooking', workspaceId, contentType: 'transcript', chunkIndex: 0, content: '今天我们来做红烧肉', contentHash: 'h6' },
    ]);

    // Insert embeddings
    const chunkContents = [
      'Python 编程教程',
      '本视频讲解 Python 基础语法和常用库',
      '大家好今天我们来学习 Python 编程',
      '家常菜做法大全',
      '分享几道简单易做的家常菜',
      '今天我们来做红烧肉',
    ];
    const embs = await embeddingClient.embed(chunkContents);

    await testDb.insert(embeddings).values(
      embs.map((emb, i) => ({
        id: nanoid(),
        chunkId: ['chunk-py-1', 'chunk-py-2', 'chunk-py-3', 'chunk-ck-1', 'chunk-ck-2', 'chunk-ck-3'][i],
        videoId: i < 3 ? 'video-python' : 'video-cooking',
        workspaceId,
        modelName: 'mock',
        dimension: embeddingClient.getDimension(),
        embedding: JSON.stringify(emb),
        contentHash: `h${i + 1}`,
        createdAt: new Date(),
      }))
    );
  });

  it('should return results for keyword matching query', async () => {
    const result = await hybridService.hybridSearch({
      workspaceId,
      query: 'Python',
      topK: 10,
    });

    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.grouped.length).toBeGreaterThan(0);

    const pythonGroup = result.grouped.find(g => g.videoId === 'video-python');
    expect(pythonGroup).toBeDefined();
  });

  it('should filter by contentType', async () => {
    const result = await hybridService.hybridSearch({
      workspaceId,
      query: 'Python',
      topK: 10,
      filters: { contentTypes: ['title'] },
    });

    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    expect(result.hits.every(h => h.contentType === 'title')).toBe(true);
  });

  it('should filter by aiTags', async () => {
    const result = await hybridService.hybridSearch({
      workspaceId,
      query: '教程',
      topK: 10,
      tagFilter: { aiTags: ['python'] },
    });

    // Only Python video results
    expect(result.grouped.length).toBe(1);
    expect(result.grouped[0].videoId).toBe('video-python');
  });

  it('should not leak cross-workspace data', async () => {
    const result = await hybridService.hybridSearch({
      workspaceId: 'other-workspace',
      query: 'Python',
      topK: 10,
    });

    expect(result.hits).toEqual([]);
    expect(result.grouped).toEqual([]);
  });

  it('should support rerank option', async () => {
    const result = await hybridService.hybridSearch({
      workspaceId,
      query: 'Python 编程',
      topK: 10,
      rerank: true,
    });

    expect(result.hits.length).toBeGreaterThan(0);
  });
});
