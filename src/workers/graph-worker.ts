import { eq, and, sql } from 'drizzle-orm';
import { db, type DbClient } from '../db';
import { videos, graphNodes, graphEdges, embeddings } from '../db/schema';
import { JobQueue, QueueJob, JobResult } from './queue';
import { GraphBuilder, GraphEdge } from '../domain/graph-builder';
import { ImportService } from '../services/import-service';
import { videoNodeId, entityNodeId, authorNodeId } from '../domain/graph-ids';

export function registerGraphWorker(
  queueInstance: JobQueue,
  graphBuilder: GraphBuilder,
  importService: ImportService,
  dbClient: DbClient = db
) {
  queueInstance.register('graph_building', async (job: QueueJob): Promise<JobResult> => {
    const { jobId, videoId, workspaceId } = job.payload;
    const retryCount = ((job.payload as Record<string, unknown>)._retryCount as number) ?? 0;

    if (!videoId || !workspaceId) {
      return { success: false, retryable: false, error: new Error('Missing videoId or workspaceId') };
    }

    try {
      // 尝试更新 job 状态，但 ingestion job 可能不存在（如直接调用 graph_building）
      if (jobId) {
        try {
          await importService.updateJobStatus(jobId, workspaceId, 'graph_updating', {
            step: 'graph_updating',
          });
        } catch {
          // 忽略 job 不存在的错误
        }
      }

      await dbClient.update(videos)
        .set({ graphStatus: 'building', updatedAt: new Date() })
        .where(and(eq(videos.id, videoId), eq(videos.workspaceId, workspaceId)));

      // 1. 获取视频 embedding
      const videoEmbedding = await getVideoEmbedding(videoId, dbClient);

      // 2. 生成 same_topic 边
      let edges: GraphEdge[] = [];
      if (videoEmbedding) {
        const topicEdges = await graphBuilder.generateTopicEdges(workspaceId, videoId, videoEmbedding);
        edges.push(...topicEdges);
      }

      // 3. 获取视频信息
      const videoRow = await dbClient.select().from(videos)
        .where(and(eq(videos.id, videoId), eq(videos.workspaceId, workspaceId)))
        .limit(1);

      const video = videoRow[0];
      if (!video) {
        throw new Error('Video not found');
      }

      const authorId = video.authorId;
      const aiTags = video.aiTags ? JSON.parse(video.aiTags) as string[] : [];
      const mockEntities = aiTags.map((tag: string) => ({
        name: tag,
        canonicalKey: tag.toLowerCase().replace(/[\s\-_\.]+/g, ''),
        type: 'concept' as const,
        confidence: 0.7,
        isNew: true,
      }));

      // 4. 确保节点存在
      await upsertVideoNode(workspaceId, videoId, video.title || videoId, dbClient);
      await upsertEntityNodes(workspaceId, mockEntities, dbClient);
      if (authorId) {
        await upsertAuthorNode(workspaceId, authorId, video.authorName || authorId, dbClient);
      }

      // 5. 生成 mentions 边
      const mentionEdges = graphBuilder.generateMentionsEdges(workspaceId, videoId, mockEntities, authorId || undefined);
      edges.push(...mentionEdges);

      // 6. 幂等写入边
      await upsertEdges(edges, dbClient);

      // 7. 更新成功状态
      await dbClient.update(videos)
        .set({ graphStatus: 'ready', graphBuiltAt: new Date(), updatedAt: new Date() })
        .where(and(eq(videos.id, videoId), eq(videos.workspaceId, workspaceId)));

      // 更新 ingestion_jobs 为 completed（graph_updating 是最后一步）
      if (jobId) {
        try {
          await importService.updateJobStatus(jobId, workspaceId, 'completed', {
            step: 'completed',
            progress: 100,
          });
        } catch {
          // 忽略 job 不存在的错误
        }
      }

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await dbClient.update(videos)
        .set({ graphStatus: 'failed', graphError: message, updatedAt: new Date() })
        .where(eq(videos.id, videoId));

      if (retryCount < 3) {
        return { success: false, retryable: true, error: new Error(message) };
      }

      if (jobId) {
        try {
          await importService.updateJobStatus(jobId, workspaceId, 'failed_terminal', {
            step: 'graph_updating',
            errorCode: 'GRAPH_BUILD_FAILED',
            errorMessage: message,
          });
        } catch {
          // 忽略 job 不存在的错误
        }
      }

      return { success: false, retryable: false, error: new Error(message) };
    }
  });
}

async function getVideoEmbedding(videoId: string, dbClient: DbClient): Promise<number[] | null> {
  const rows = await dbClient.select({ embedding: embeddings.embedding })
    .from(embeddings)
    .where(eq(embeddings.videoId, videoId))
    .limit(1);
  if (!rows[0]) return null;
  return JSON.parse(rows[0].embedding) as number[];
}

async function upsertVideoNode(workspaceId: string, videoId: string, label: string, dbClient: DbClient): Promise<void> {
  const nodeId = videoNodeId(videoId);
  await dbClient.insert(graphNodes).values({
    id: nodeId, workspaceId, nodeType: 'video', businessId: videoId, label,
  }).onConflictDoNothing();
}

async function upsertEntityNodes(
  workspaceId: string,
  entities: { canonicalKey: string; name: string }[],
  dbClient: DbClient
): Promise<void> {
  for (const entity of entities) {
    const nodeId = entityNodeId(entity.canonicalKey);
    await dbClient.insert(graphNodes).values({
      id: nodeId, workspaceId, nodeType: 'entity', businessId: entity.canonicalKey,
      canonicalKey: entity.canonicalKey, label: entity.name,
      properties: JSON.stringify({ type: 'concept', confidence: 0.7 }),
    }).onConflictDoNothing();
  }
}

async function upsertAuthorNode(workspaceId: string, authorId: string, label: string, dbClient: DbClient): Promise<void> {
  const nodeId = authorNodeId(authorId);
  await dbClient.insert(graphNodes).values({
    id: nodeId, workspaceId, nodeType: 'author', businessId: authorId, label,
  }).onConflictDoNothing();
}

async function upsertEdges(edges: GraphEdge[], dbClient: DbClient): Promise<void> {
  if (edges.length === 0) return;
  await dbClient.insert(graphEdges)
    .values(edges)
    .onConflictDoUpdate({
      target: [graphEdges.workspaceId, graphEdges.sourceNodeId, graphEdges.targetNodeId, graphEdges.relationType],
      set: {
        weight: sql`excluded.weight`,
        evidence: sql`excluded.evidence`,
        updatedAt: new Date(),
      },
    });
}
