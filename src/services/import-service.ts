import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { videos, ingestionJobs } from '../db/schema';
import { DouyinConnector } from '../infrastructure/douyin-connector';
import { ParsedUrl, ImportJob } from '../domain/types';
import { nanoid } from 'nanoid';

export class ImportService {
  constructor(private connector: DouyinConnector) {}

  async createImportJob(shareUrl: string, workspaceId: string = 'default'): Promise<ImportJob> {
    // 1. 解析 URL
    const parsed = await this.connector.parseUrl(shareUrl);

    // 2. 创建视频记录（pending 状态）
    const videoId = nanoid();
    try {
      await db.insert(videos).values({
        id: videoId,
        workspaceId,
        platform: parsed.platform,
        platformVideoId: parsed.platformVideoId,
        shareUrl,
        normalizedUrlHash: parsed.normalizedUrlHash,
        status: 'pending',
      });
    } catch (err: any) {
      // 视频表唯一索引冲突：同一 workspace + 同一 URL 已存在
      if (err?.message?.includes('UNIQUE constraint failed')) {
        const existingVideo = await db
          .select()
          .from(videos)
          .where(
            and(
              eq(videos.workspaceId, workspaceId),
              eq(videos.normalizedUrlHash, parsed.normalizedUrlHash)
            )
          )
          .limit(1);

        if (existingVideo[0]) {
          const job = await db
            .select()
            .from(ingestionJobs)
            .where(eq(ingestionJobs.videoId, existingVideo[0].id))
            .limit(1);
          return job[0] as ImportJob;
        }
      }
      throw err;
    }

    // 3. 创建导入任务（利用数据库唯一索引实现幂等）
    const jobId = nanoid();
    try {
      await db.insert(ingestionJobs).values({
        id: jobId,
        workspaceId,
        videoId,
        shareUrl,
        normalizedUrlHash: parsed.normalizedUrlHash,
        status: 'created',
        maxRetries: 3,
      });
    } catch (err: any) {
      // 任务表唯一索引冲突：同一 workspace + 同一 URL 已存在任务
      if (err?.message?.includes('UNIQUE constraint failed')) {
        const existingJob = await db
          .select()
          .from(ingestionJobs)
          .where(
            and(
              eq(ingestionJobs.workspaceId, workspaceId),
              eq(ingestionJobs.normalizedUrlHash, parsed.normalizedUrlHash)
            )
          )
          .limit(1);
        return existingJob[0] as ImportJob;
      }
      throw err;
    }

    const job = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, jobId))
      .limit(1);

    return job[0] as ImportJob;
  }

  async getJobStatus(jobId: string): Promise<ImportJob | null> {
    const result = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, jobId))
      .limit(1);

    return (result[0] as ImportJob) || null;
  }
}
