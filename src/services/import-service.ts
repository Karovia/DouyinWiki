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

    // 2. 幂等检查：同一 workspace + 同一 URL 是否已存在
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

    // 3. 创建视频记录（pending 状态）
    const videoId = nanoid();
    await db.insert(videos).values({
      id: videoId,
      workspaceId,
      platform: parsed.platform,
      platformVideoId: parsed.platformVideoId,
      shareUrl,
      normalizedUrlHash: parsed.normalizedUrlHash,
      status: 'pending',
    });

    // 4. 创建导入任务
    const jobId = nanoid();
    await db.insert(ingestionJobs).values({
      id: jobId,
      workspaceId,
      videoId,
      shareUrl,
      normalizedUrlHash: parsed.normalizedUrlHash,
      status: 'created',
      maxRetries: 3,
    });

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
