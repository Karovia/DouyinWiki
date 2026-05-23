import { z } from 'zod';

/**
 * 创建导入任务输入
 */
export const createImportSchema = z.object({
  shareUrl: z.string().min(1, '请输入抖音分享链接'),
  workspaceId: z.string().default('ws_default'),
});

export type CreateImportInput = z.infer<typeof createImportSchema>;

/**
 * 查询导入任务状态输入
 */
export const importStatusSchema = z.object({
  jobId: z.string().min(1),
  workspaceId: z.string().default('ws_default'),
});

export type ImportStatusInput = z.infer<typeof importStatusSchema>;

/**
 * 重试导入任务输入
 */
export const retryImportSchema = z.object({
  jobId: z.string().min(1),
  workspaceId: z.string().default('ws_default'),
});

export type RetryImportInput = z.infer<typeof retryImportSchema>;

/**
 * 视频列表查询输入
 */
export const videosListSchema = z.object({
  workspaceId: z.string().default('ws_default'),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

export type VideosListInput = z.infer<typeof videosListSchema>;

/**
 * 视频详情查询输入
 */
export const videoDetailSchema = z.object({
  videoId: z.string().min(1),
  workspaceId: z.string().default('ws_default'),
});

export type VideoDetailInput = z.infer<typeof videoDetailSchema>;
