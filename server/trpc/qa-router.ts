/**
 * 视频 Q&A tRPC 路由
 * 两层问答架构：
 *   第一层：基于 AI 摘要快速回答，同时判断信息是否足够
 *   第二层：信息不足时，用 LLM 直接观看视频进行深度分析
 */
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { db } from '../db/index';
import { videos } from '../db/schema';
import { eq } from 'drizzle-orm';
import { askWithSummary, askWithVideo } from '../connectors/llm-connector';
import { getSignedUrl } from '../connectors/storage-connector';

const t = initTRPC.create();

export const qaRouter = t.router({
  /**
   * 视频问答（两层架构）
   */
  ask: t.procedure
    .input(z.object({
      videoId: z.string(),
      question: z.string().min(1).max(500),
      workspaceId: z.string().default('ws_default'),
    }))
    .mutation(async ({ input }) => {
      // 查询视频信息
      const videoRows = await db.select()
        .from(videos)
        .where(eq(videos.id, input.videoId));

      const video = videoRows[0];

      if (!video) {
        return { answer: '', error: '视频不存在' };
      }

      if (!video.aiSummary) {
        return { answer: '', error: '视频尚未生成 AI 摘要，请等待处理完成' };
      }

      // 解析标签
      let tags: string[] = [];
      try {
        tags = video.tags ? JSON.parse(video.tags) : [];
      } catch {
        tags = [];
      }

      // 构建封面 URL（优先使用对象存储签名 URL）
      let coverUrl: string | undefined;
      if (video.coverFileKey) {
        try {
          coverUrl = await getSignedUrl(video.coverFileKey, 600);
        } catch {
          coverUrl = undefined;
        }
      } else if (video.coverUrl && video.coverUrl.startsWith('http')) {
        coverUrl = video.coverUrl;
      }

      // ── 第一层：基于摘要快速回答 ──
      try {
        const summaryResult = await askWithSummary({
          videoTitle: video.title ?? '无标题',
          aiSummary: video.aiSummary,
          tags,
          description: video.description ?? undefined,
          coverUrl,
          question: input.question,
        });

        // 摘要信息足够，直接返回
        if (!summaryResult.needsVideoAnalysis) {
          return { answer: summaryResult.answer, source: 'summary' as const };
        }

        // ── 第二层：信息不足，需要直接分析视频 ──
        // 检查是否有视频文件
        if (!video.videoFileKey) {
          // 没有视频文件，返回摘要级的回答并提示
          return {
            answer: summaryResult.answer + '\n\n（当前摘要信息不足以完整回答您的问题，且视频文件不可用于深度分析）',
            source: 'summary' as const,
          };
        }

        // 获取视频签名 URL（供 LLM 观看）
        let videoUrl: string;
        try {
          videoUrl = await getSignedUrl(video.videoFileKey, 600);
        } catch (err) {
          console.error('[QA] Failed to get video signed URL:', err);
          return {
            answer: summaryResult.answer + '\n\n（视频文件暂时无法访问，无法进行深度分析）',
            source: 'summary' as const,
          };
        }

        // 调用 LLM 直接观看视频
        try {
          const videoAnswer = await askWithVideo({
            videoTitle: video.title ?? '无标题',
            aiSummary: video.aiSummary,
            question: input.question,
            videoUrl,
            videoId: input.videoId,
          });

          return { answer: videoAnswer, source: 'video' as const };
        } catch (videoError) {
          console.error('[QA] Video analysis failed, falling back to summary:', videoError);
          // 视频分析失败，降级返回摘要回答
          return {
            answer: summaryResult.answer + '\n\n（深度视频分析暂时不可用，以上为基于摘要的回答）',
            source: 'summary' as const,
          };
        }
      } catch (error) {
        console.error('[QA] LLM error:', error);
        return { answer: '', error: 'AI 回答生成失败，请稍后重试' };
      }
    }),
});

export type QARouter = typeof qaRouter;
