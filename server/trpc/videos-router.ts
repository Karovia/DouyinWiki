import { router, publicProcedure } from './trpc';
import { videosListSchema, videoDetailSchema } from './schemas';
import { z } from 'zod';
import { videos, transcripts, summaries } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { deleteVideoWithFiles } from '../workers/import-worker';
import { getSignedUrl } from '../connectors/storage-connector';

export const videosRouter = router({
  /**
   * 分页查询视频列表
   */
  list: publicProcedure
    .input(videosListSchema)
    .query(async (opts) => {
      const { workspaceId, limit, offset } = opts.input;
      const { ctx } = opts;

      const items = await ctx.db
        .select()
        .from(videos)
        .where(eq(videos.workspaceId, workspaceId))
        .orderBy(desc(videos.createdAt))
        .limit(limit)
        .offset(offset);

      // 查询总数
      const countResult = await ctx.db
        .select({ id: videos.id })
        .from(videos)
        .where(eq(videos.workspaceId, workspaceId));

      // 为有 coverFileKey 的视频生成签名封面 URL
      const itemsWithSignedUrls = await Promise.all(
        items.map(async (v) => {
          let coverUrl = v.coverUrl;
          if (v.coverFileKey) {
            try {
              coverUrl = await getSignedUrl(v.coverFileKey, 3600);
            } catch {
              // 签名失败，使用原始 URL
            }
          }
          return {
            id: v.id,
            title: v.title ?? '无标题',
            authorName: v.authorName,
            authorId: v.authorId,
            coverUrl,
            hasVideo: !!v.videoFileKey,
            duration: v.duration,
            description: v.description,
            shareUrl: v.shareUrl,
            aiSummary: v.aiSummary,
            tags: v.tags ? JSON.parse(v.tags) as string[] : [],
            status: v.status,
            platform: v.platform,
            createdAt: v.createdAt?.getTime() ?? null,
          };
        })
      );

      return {
        items: itemsWithSignedUrls,
        total: countResult.length,
        limit,
        offset,
      };
    }),

  /**
   * 查询视频详情
   */
  detail: publicProcedure
    .input(videoDetailSchema)
    .query(async (opts) => {
      const { videoId, workspaceId } = opts.input;
      const { ctx } = opts;

      const videoRows = await ctx.db
        .select()
        .from(videos)
        .where(and(
          eq(videos.id, videoId),
          eq(videos.workspaceId, workspaceId),
        ));

      const video = videoRows[0];

      if (!video) {
        return { found: false };
      }

      // 查询转写文本
      const transcriptList = await ctx.db
        .select()
        .from(transcripts)
        .where(and(
          eq(transcripts.videoId, videoId),
          eq(transcripts.workspaceId, workspaceId),
        ));

      // 查询摘要
      const summaryList = await ctx.db
        .select()
        .from(summaries)
        .where(and(
          eq(summaries.videoId, videoId),
          eq(summaries.workspaceId, workspaceId),
        ));

      // 生成签名封面 URL
      let coverUrl = video.coverUrl;
      if (video.coverFileKey) {
        try {
          coverUrl = await getSignedUrl(video.coverFileKey, 3600);
        } catch {
          // 签名失败，使用原始 URL
        }
      }

      return {
        found: true,
        video: {
          id: video.id,
          title: video.title ?? '无标题',
          authorName: video.authorName,
          authorId: video.authorId,
          coverUrl,
          hasVideo: !!video.videoFileKey,
          duration: video.duration,
          description: video.description,
          shareUrl: video.shareUrl,
          aiSummary: video.aiSummary,
          tags: video.tags ? JSON.parse(video.tags) as string[] : [],
          status: video.status,
          platform: video.platform,
          createdAt: video.createdAt?.getTime() ?? null,
        },
        transcripts: transcriptList.map((t) => ({
          id: t.id,
          source: t.source,
          modelName: t.modelName,
          content: t.content,
        })),
        summaries: summaryList.map((s) => ({
          id: s.id,
          content: s.content,
          promptVersion: s.promptVersion,
          modelName: s.modelName,
        })),
      };
    }),

  /**
   * 获取视频播放签名 URL
   */
  playUrl: publicProcedure
    .input(z.object({
      videoId: z.string(),
      workspaceId: z.string(),
    }))
    .mutation(async (opts) => {
      const { videoId, workspaceId } = opts.input;
      const { ctx } = opts;

      const videoRows = await ctx.db
        .select({ videoFileKey: videos.videoFileKey })
        .from(videos)
        .where(and(
          eq(videos.id, videoId),
          eq(videos.workspaceId, workspaceId),
        ));

      const video = videoRows[0];

      if (!video || !video.videoFileKey) {
        throw new Error('视频文件不存在');
      }

      const playUrl = await getSignedUrl(video.videoFileKey, 7200); // 2 小时有效
      return { playUrl };
    }),

  /**
   * 删除视频（同时删除云端文件）
   */
  delete: publicProcedure
    .input(z.object({
      videoId: z.string(),
      workspaceId: z.string(),
    }))
    .mutation(async (opts) => {
      const { videoId, workspaceId } = opts.input;

      await deleteVideoWithFiles(videoId);

      return { success: true, videoId };
    }),
});
