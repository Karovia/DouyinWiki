import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphService } from '../../src/services/graph-service';
import { createTestDb, cleanTestDb, destroyTestDb } from '../helpers/db';
import { graphNodes, graphEdges, videos } from '../../src/db/schema';
import { eq, and } from 'drizzle-orm';
import type { DbClient } from '../../src/db';

const workspaceId = 'test-ws-gs';

describe('GraphService', () => {
  let testDb: DbClient;
  let service: GraphService;

  beforeEach(async () => {
    testDb = await createTestDb();
    await cleanTestDb(testDb);
    service = new GraphService(testDb);
  });

  afterEach(() => {
    destroyTestDb(testDb);
  });

  it('getNeighbors returns empty for isolated video', async () => {
    const result = await service.getNeighbors({ workspaceId, videoId: 'v1', limit: 10 });
    expect(result.edges).toHaveLength(0);
    expect(result.videoNeighbors).toHaveLength(0);
    expect(result.centerNode).toBeNull();
  });

  it('getNeighbors returns connected nodes', async () => {
    // 插入中心视频节点
    await testDb.insert(graphNodes).values({
      id: 'video:v1',
      workspaceId,
      nodeType: 'video',
      businessId: 'v1',
      label: 'Video 1',
    });

    // 插入邻居节点
    await testDb.insert(graphNodes).values([
      { id: 'video:v2', workspaceId, nodeType: 'video', businessId: 'v2', label: 'Video 2' },
      { id: 'entity:e1', workspaceId, nodeType: 'entity', businessId: 'e1', label: 'Entity 1' },
    ]);

    // 插入边
    await testDb.insert(graphEdges).values([
      { id: 'edge1', workspaceId, sourceNodeId: 'video:v1', targetNodeId: 'video:v2', relationType: 'same_topic', weight: 0.9, computedBy: 'test' },
      { id: 'edge2', workspaceId, sourceNodeId: 'video:v1', targetNodeId: 'entity:e1', relationType: 'mentions', weight: 0.8, computedBy: 'test' },
    ]);

    const result = await service.getNeighbors({ workspaceId, videoId: 'v1', limit: 10 });
    expect(result.edges).toHaveLength(2);
    expect(result.videoNeighbors).toHaveLength(1);
    expect(result.entityNeighbors).toHaveLength(1);
    expect(result.centerNode).not.toBeNull();
    expect(result.centerNode!.label).toBe('Video 1');
  });

  it('getSameAuthorVideos returns videos by same author', async () => {
    await testDb.insert(videos).values([
      { id: 'v1', workspaceId, shareUrl: 'u1', normalizedUrlHash: 'h1', authorId: 'a1', status: 'completed' },
      { id: 'v2', workspaceId, shareUrl: 'u2', normalizedUrlHash: 'h2', authorId: 'a1', status: 'completed' },
      { id: 'v3', workspaceId, shareUrl: 'u3', normalizedUrlHash: 'h3', authorId: 'a2', status: 'completed' },
    ]);

    const result = await service.getSameAuthorVideos(workspaceId, 'v1', 'a1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('v2');
  });

  it('getSameEntityVideos returns videos sharing entities', async () => {
    // 插入视频节点
    await testDb.insert(graphNodes).values([
      { id: 'video:v1', workspaceId, nodeType: 'video', businessId: 'v1', label: 'Video 1' },
      { id: 'video:v2', workspaceId, nodeType: 'video', businessId: 'v2', label: 'Video 2' },
      { id: 'video:v3', workspaceId, nodeType: 'video', businessId: 'v3', label: 'Video 3' },
      { id: 'entity:e1', workspaceId, nodeType: 'entity', businessId: 'e1', label: 'Entity 1' },
      { id: 'entity:e2', workspaceId, nodeType: 'entity', businessId: 'e2', label: 'Entity 2' },
    ]);

    // v1 mentions e1, e2
    // v2 mentions e1
    // v3 mentions e2
    await testDb.insert(graphEdges).values([
      { id: 'm1', workspaceId, sourceNodeId: 'video:v1', targetNodeId: 'entity:e1', relationType: 'mentions', weight: 0.9, computedBy: 'test' },
      { id: 'm2', workspaceId, sourceNodeId: 'video:v1', targetNodeId: 'entity:e2', relationType: 'mentions', weight: 0.8, computedBy: 'test' },
      { id: 'm3', workspaceId, sourceNodeId: 'video:v2', targetNodeId: 'entity:e1', relationType: 'mentions', weight: 0.7, computedBy: 'test' },
      { id: 'm4', workspaceId, sourceNodeId: 'video:v3', targetNodeId: 'entity:e2', relationType: 'mentions', weight: 0.6, computedBy: 'test' },
    ]);

    const result = await service.getSameEntityVideos(workspaceId, 'v1');
    expect(result).toHaveLength(2);
    // v2 shares 1 entity, v3 shares 1 entity
    expect(result.map((r) => r.videoId).sort()).toEqual(['v2', 'v3']);
  });

  it('getSameEntityVideos returns empty when no shared entities', async () => {
    const result = await service.getSameEntityVideos(workspaceId, 'v-no-entities');
    expect(result).toHaveLength(0);
  });
});
