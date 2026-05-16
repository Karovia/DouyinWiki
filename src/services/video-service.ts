import { eq, desc, and, count } from 'drizzle-orm';
import { db, type DbClient } from '../db';
import { videos, transcripts, chunks, embeddings, graphEdges, graphNodes, ingestionJobs } from '../db/schema';
import { Video } from '../domain/types';
import { VectorStore } from '../infrastructure/vector-store';

export interface ListVideosOptions {
  workspaceId: string;
  limit?: number;
  offset?: number;
}

function mapVideo(row: Record<string, unknown>): Video {
  return {
    id: row.id as string,
    workspaceId: row.workspaceId as string,
    platform: row.platform as Video['platform'],
    platformVideoId: (row.platformVideoId as string | null) ?? undefined,
    shareUrl: row.shareUrl as string,
    normalizedUrlHash: row.normalizedUrlHash as string,
    title: (row.title as string | null) ?? undefined,
    description: (row.description as string | null) ?? undefined,
    authorName: (row.authorName as string | null) ?? undefined,
    authorId: (row.authorId as string | null) ?? undefined,
    coverUrl: (row.coverUrl as string | null) ?? undefined,
    duration: (row.duration as number | null) ?? undefined,
    tags: row.tags ? JSON.parse(row.tags as string) : undefined,
    aiSummary: (row.aiSummary as string | null) ?? undefined,
    aiTags: row.aiTags ? JSON.parse(row.aiTags as string) : undefined,
    viewCount: (row.viewCount as number | null) ?? undefined,
    likeCount: (row.likeCount as number | null) ?? undefined,
    status: row.status as string,
    errorCode: (row.errorCode as string | null) ?? undefined,
    errorMessage: (row.errorMessage as string | null) ?? undefined,
    createdAt: row.createdAt ? new Date(row.createdAt as string | number | Date) : new Date(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt as string | number | Date) : new Date(),
  };
}

export class VideoService {
  constructor(
    private vectorStore: VectorStore,
    private dbClient: DbClient = db,
  ) {}

  async list(options: ListVideosOptions): Promise<{ items: Video[]; total: number }> {
    const { workspaceId, limit = 20, offset = 0 } = options;

    const rows = await this.dbClient
      .select()
      .from(videos)
      .where(eq(videos.workspaceId, workspaceId))
      .orderBy(desc(videos.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await this.dbClient
      .select({ count: count() })
      .from(videos)
      .where(eq(videos.workspaceId, workspaceId));

    return {
      items: rows.map(mapVideo),
      total: countResult[0]?.count ?? 0,
    };
  }

  async detail(id: string, workspaceId: string): Promise<Video | null> {
    const rows = await this.dbClient
      .select()
      .from(videos)
      .where(and(eq(videos.id, id), eq(videos.workspaceId, workspaceId)))
      .limit(1);

    return rows[0] ? mapVideo(rows[0] as Record<string, unknown>) : null;
  }

  async deleteVideo(id: string, workspaceId: string): Promise<{ deleted: boolean }> {
    const video = await this.detail(id, workspaceId);
    if (!video) return { deleted: false };

    // 1. 删除向量
    await this.vectorStore.deleteByOwner('video', id);

    // 2. 删除图谱边和节点
    const nodeId = `video:${id}`;
    await this.dbClient.delete(graphEdges).where(
      and(eq(graphEdges.workspaceId, workspaceId), eq(graphEdges.sourceNodeId, nodeId))
    );
    await this.dbClient.delete(graphEdges).where(
      and(eq(graphEdges.workspaceId, workspaceId), eq(graphEdges.targetNodeId, nodeId))
    );
    await this.dbClient.delete(graphNodes).where(
      and(eq(graphNodes.workspaceId, workspaceId), eq(graphNodes.id, nodeId))
    );

    // 3. 删除 embeddings, chunks, transcripts, jobs
    await this.dbClient.delete(embeddings).where(eq(embeddings.videoId, id));
    await this.dbClient.delete(chunks).where(eq(chunks.videoId, id));
    await this.dbClient.delete(transcripts).where(eq(transcripts.videoId, id));
    await this.dbClient.delete(ingestionJobs).where(eq(ingestionJobs.videoId, id));

    // 4. 删除视频
    await this.dbClient.delete(videos).where(and(eq(videos.id, id), eq(videos.workspaceId, workspaceId)));

    return { deleted: true };
  }
}
