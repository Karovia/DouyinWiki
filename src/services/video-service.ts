import { eq, desc, and, count } from 'drizzle-orm';
import { db } from '../db';
import { videos } from '../db/schema';
import { Video } from '../domain/types';

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
  async list(options: ListVideosOptions): Promise<{ items: Video[]; total: number }> {
    const { workspaceId, limit = 20, offset = 0 } = options;

    const rows = await db
      .select()
      .from(videos)
      .where(eq(videos.workspaceId, workspaceId))
      .orderBy(desc(videos.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: count() })
      .from(videos)
      .where(eq(videos.workspaceId, workspaceId));

    return {
      items: rows.map(mapVideo),
      total: countResult[0]?.count ?? 0,
    };
  }

  async detail(id: string, workspaceId: string): Promise<Video | null> {
    const rows = await db
      .select()
      .from(videos)
      .where(and(eq(videos.id, id), eq(videos.workspaceId, workspaceId)))
      .limit(1);

    return rows[0] ? mapVideo(rows[0] as Record<string, unknown>) : null;
  }
}
