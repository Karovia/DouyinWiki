import { describe, it, expect, beforeEach } from 'vitest';
import { VideoService } from '~/services/video-service';
import { SQLiteVectorStore } from '~/infrastructure/vector-store';
import { createTestDb, cleanTestDb } from '../helpers/db';
import type { DbClient } from '~/db';
import { videos, transcripts, chunks, embeddings, graphEdges, graphNodes, ingestionJobs } from '~/db/schema';
import { eq, and } from 'drizzle-orm';

const workspaceId = 'test-ws-delete';

describe('cascade-delete', () => {
  let testDb: DbClient;
  let videoService: VideoService;

  beforeEach(async () => {
    testDb = await createTestDb();
    await cleanTestDb(testDb);
    const vectorStore = new SQLiteVectorStore(testDb);
    videoService = new VideoService(vectorStore, testDb);
  });

  it('deletes video and all related data', async () => {
    await testDb.insert(videos).values({
      id: 'del-v1', workspaceId, shareUrl: 'u1', normalizedUrlHash: 'h1', status: 'completed',
    });
    await testDb.insert(transcripts).values({
      id: 't1', videoId: 'del-v1', workspaceId, source: 'asr',
    });
    await testDb.insert(chunks).values({
      id: 'c1', videoId: 'del-v1', workspaceId, contentType: 'summary', chunkIndex: 0, content: 'test', contentHash: 'h',
    });
    await testDb.insert(graphNodes).values({
      id: 'video:del-v1', workspaceId, nodeType: 'video', businessId: 'del-v1', label: 'Test',
    });

    const result = await videoService.deleteVideo('del-v1', workspaceId);
    expect(result.deleted).toBe(true);

    const v = await testDb.select().from(videos).where(and(eq(videos.id, 'del-v1'), eq(videos.workspaceId, workspaceId)));
    expect(v).toHaveLength(0);

    const t = await testDb.select().from(transcripts).where(eq(transcripts.videoId, 'del-v1'));
    expect(t).toHaveLength(0);

    const c = await testDb.select().from(chunks).where(eq(chunks.videoId, 'del-v1'));
    expect(c).toHaveLength(0);

    const n = await testDb.select().from(graphNodes).where(eq(graphNodes.id, 'video:del-v1'));
    expect(n).toHaveLength(0);
  });
});
