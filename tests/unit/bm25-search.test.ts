import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, cleanTestDb } from '../helpers/db';
import { SQLiteBM25Search } from '../../src/infrastructure/bm25-search';
import { videos, chunks } from '../../src/db/schema';
import type { DbClient } from '../../src/db';

describe('SQLiteBM25Search', () => {
  let testDb: DbClient;
  let bm25: SQLiteBM25Search;
  const workspaceId = 'test-bm25';

  beforeEach(async () => {
    testDb = await createTestDb();
    await cleanTestDb(testDb);
    bm25 = new SQLiteBM25Search(testDb);

    // Insert test video
    await testDb.insert(videos).values({
      id: 'video-1',
      workspaceId,
      platform: 'douyin',
      shareUrl: 'https://douyin.com/video/1',
      normalizedUrlHash: 'hash1',
      title: 'Python 教程',
      aiTags: JSON.stringify(['python', '编程']),
    });

    // Insert test chunks
    await testDb.insert(chunks).values([
      { id: 'chunk-1', videoId: 'video-1', workspaceId, contentType: 'transcript', chunkIndex: 0, content: 'Python 是一种流行的编程语言', contentHash: 'h1' },
      { id: 'chunk-2', videoId: 'video-1', workspaceId, contentType: 'summary', chunkIndex: 0, content: '本视频介绍 Python 基础语法', contentHash: 'h2' },
      { id: 'chunk-3', videoId: 'video-1', workspaceId, contentType: 'title', chunkIndex: 0, content: 'Python 入门教程', contentHash: 'h3' },
    ]);
  });

  it('should search chunks by keyword', async () => {
    const results = await bm25.search({
      workspaceId,
      query: 'Python',
      topK: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.content.includes('Python'))).toBe(true);
  });

  it('should respect workspace isolation', async () => {
    const results = await bm25.search({
      workspaceId: 'other-workspace',
      query: 'Python',
      topK: 10,
    });

    expect(results).toEqual([]);
  });

  it('should filter by contentType', async () => {
    const results = await bm25.search({
      workspaceId,
      query: 'Python',
      topK: 10,
      filters: { contentTypes: ['title'] },
    });

    expect(results.length).toBe(1);
    expect(results[0].contentType).toBe('title');
  });

  it('should return BM25 scores', async () => {
    const results = await bm25.search({
      workspaceId,
      query: 'Python',
      topK: 10,
    });

    expect(results[0].score).toBeGreaterThan(0);
  });
});
