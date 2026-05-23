/**
 * 导入 Worker：异步处理视频导入流水线
 *
 * 流水线步骤：
 * created → parsing_metadata → uploading_assets → summarizing → completed
 *
 * 每个步骤都有 try/catch，单步失败不会导致进程崩溃
 */
import { db } from '../db/index';
import { ingestionJobs, videos, summaries } from '../db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  JOB_STATUSES,
  isValidTransition,
  getProgressForStatus,
  type JobStatus,
  type ErrorCode,
  isRetryableError,
} from '../domain/types';
import { fetchDouyinVideoMeta, extractDouyinUrl } from '../connectors/douyin-connector';
import { generateSummary, generateTags } from '../connectors/llm-connector';
import { uploadFromUrl, deleteFile, getSignedUrl } from '../connectors/storage-connector';
import { registerJobHandler } from './worker-queue';

const MAX_RETRY = 3;

/**
 * 安全地更新任务状态
 */
async function updateJobStatus(
  jobId: string,
  newStatus: JobStatus,
  extra: {
    currentStep?: string | null;
    errorCode?: ErrorCode | null;
    errorMessage?: string | null;
  } = {},
): Promise<void> {
  const now = new Date();
  const updates: Record<string, unknown> = {
    status: newStatus,
    progress: getProgressForStatus(newStatus),
    updatedAt: now,
    ...extra,
  };

  if (newStatus === JOB_STATUSES.PARSING_METADATA && !extra.currentStep) {
    updates.startedAt = now;
  }

  if (JOB_STATUSES.COMPLETED === newStatus || JOB_STATUSES.PARTIAL_COMPLETED === newStatus) {
    updates.finishedAt = now;
  }

  await db.update(ingestionJobs)
    .set(updates)
    .where(eq(ingestionJobs.id, jobId));
}

/**
 * 标记任务失败
 */
async function markJobFailed(
  jobId: string,
  errorCode: ErrorCode,
  errorMessage: string,
): Promise<void> {
  const retryable = isRetryableError(errorCode);
  const jobRows = await db.select({ retryCount: ingestionJobs.retryCount })
    .from(ingestionJobs)
    .where(eq(ingestionJobs.id, jobId));

  const retryCount = (jobRows[0]?.retryCount ?? 0);
  const shouldRetry = retryable && retryCount < MAX_RETRY;

  await updateJobStatus(jobId, shouldRetry ? JOB_STATUSES.FAILED_RETRYABLE : JOB_STATUSES.FAILED_TERMINAL, {
    errorCode,
    errorMessage,
  });

  console.error(`[Worker] Job ${jobId} failed: ${errorCode} - ${errorMessage} (retryable: ${shouldRetry})`);
}

/**
 * 处理单个导入任务
 */
async function processJob(jobId: string): Promise<void> {
  console.log(`[Worker] Starting job: ${jobId}`);

  // Step 1: 获取任务信息
  const jobRows = await db.select()
    .from(ingestionJobs)
    .where(eq(ingestionJobs.id, jobId));

  const job = jobRows[0];

  if (!job) {
    console.error(`[Worker] Job not found: ${jobId}`);
    return;
  }

  // 跳过非 created/retryable 状态的任务
  if (job.status !== JOB_STATUSES.CREATED && job.status !== JOB_STATUSES.FAILED_RETRYABLE) {
    console.log(`[Worker] Job ${jobId} is in ${job.status}, skipping`);
    return;
  }

  // 先提取真实 URL（用户可能粘贴了整段分享文本）
  const realUrl = extractDouyinUrl(job.shareUrl) || job.shareUrl;

  try {
    // ============ Step 2: 解析元数据 ============
    if (!isValidTransition(job.status as JobStatus, JOB_STATUSES.PARSING_METADATA)) {
      throw new Error(`Invalid transition from ${job.status} to ${JOB_STATUSES.PARSING_METADATA}`);
    }

    await updateJobStatus(jobId, JOB_STATUSES.PARSING_METADATA, {
      currentStep: '正在解析视频信息...',
    });

    const metadata = await fetchDouyinVideoMeta(realUrl);

    // 先更新基础元数据（不含文件 key）
    await db.update(videos)
      .set({
        title: metadata.title || '无标题视频',
        authorName: metadata.authorName,
        authorId: metadata.authorId,
        coverUrl: metadata.coverUrl,
        duration: metadata.duration,
        description: metadata.description,
        tags: metadata.tags.length > 0 ? JSON.stringify(metadata.tags) : null,
        status: 'parsed',
        updatedAt: new Date(),
      })
      .where(eq(videos.id, job.videoId!));

    console.log(`[Worker] Metadata parsed: ${metadata.title}`);

    // ============ Step 3: 上传视频和封面到对象存储 ============
    if (isValidTransition(JOB_STATUSES.PARSING_METADATA, JOB_STATUSES.FETCHING_CONTENT)) {
      await updateJobStatus(jobId, JOB_STATUSES.FETCHING_CONTENT, {
        currentStep: '正在下载视频文件...',
      });
    }

    let videoFileKey: string | null = null;
    let coverFileKey: string | null = null;

    // 上传视频文件到对象存储
    if (metadata.videoPlayUrl) {
      try {
        console.log(`[Worker] Uploading video to object storage...`);
        videoFileKey = await uploadFromUrl(
          metadata.videoPlayUrl,
          `videos/${job.videoId}.mp4`,
          'video/mp4',
        );
        console.log(`[Worker] Video uploaded: ${videoFileKey}`);
      } catch (videoUploadError) {
        console.warn(`[Worker] Video upload failed (non-fatal):`, videoUploadError instanceof Error ? videoUploadError.message : videoUploadError);
        // 视频上传失败不是致命错误，继续流程
      }
    } else {
      console.warn(`[Worker] No video play URL found, skipping video upload`);
    }

    // 上传封面图到对象存储
    if (metadata.coverUrl) {
      try {
        console.log(`[Worker] Uploading cover image to object storage...`);
        coverFileKey = await uploadFromUrl(
          metadata.coverUrl,
          `covers/${job.videoId}.jpg`,
          'image/jpeg',
        );
        console.log(`[Worker] Cover uploaded: ${coverFileKey}`);
      } catch (coverUploadError) {
        console.warn(`[Worker] Cover upload failed (non-fatal):`, coverUploadError instanceof Error ? coverUploadError.message : coverUploadError);
      }
    }

    // 更新视频文件 key
    await db.update(videos)
      .set({
        videoFileKey,
        coverFileKey,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, job.videoId!));

    // ============ Step 4: 生成 AI 摘要 ============
    await updateJobStatus(jobId, JOB_STATUSES.SUMMARIZING, {
      currentStep: '正在生成 AI 摘要...',
    });

    // 构建封面 URL 给 LLM：优先使用对象存储签名 URL
    let coverUrlForLLM: string | undefined;
    if (coverFileKey) {
      try {
        coverUrlForLLM = await getSignedUrl(coverFileKey, 600); // 10 分钟有效
      } catch {
        coverUrlForLLM = undefined;
      }
    } else if (metadata.coverUrl) {
      coverUrlForLLM = metadata.coverUrl;
    }

    let summary: string;
    try {
      summary = await generateSummary({
        title: metadata.title || '无标题视频',
        authorName: metadata.authorName,
        description: metadata.description,
        coverUrl: coverUrlForLLM,
        pageText: metadata.tags.length > 0 ? `标签: ${metadata.tags.join(', ')}` : undefined,
      });
    } catch (llmError) {
      console.warn(`[Worker] LLM multimodal summary failed, falling back:`, llmError instanceof Error ? llmError.message : llmError);
      try {
        summary = await generateSummary({
          title: metadata.title || '无标题视频',
          authorName: metadata.authorName,
          description: metadata.description,
          coverUrl: undefined,
          pageText: metadata.tags.length > 0 ? `标签: ${metadata.tags.join(', ')}` : undefined,
        });
      } catch (fallbackError) {
        console.error(`[Worker] LLM text-only summary also failed:`, fallbackError instanceof Error ? fallbackError.message : fallbackError);
        summary = `${metadata.title || '无标题视频'}${metadata.authorName ? `，由${metadata.authorName}发布` : ''}。${metadata.description ? metadata.description : '暂无详细描述。'}`;
      }
    }

    // 保存摘要
    const summaryId = nanoid(16);
    await db.insert(summaries).values({
      id: summaryId,
      workspaceId: job.workspaceId,
      videoId: job.videoId!,
      content: summary,
      promptVersion: 'v1',
      outputSchemaVersion: 'v1',
      modelName: 'doubao-seed-2-0-mini-260215',
      createdAt: new Date(),
    });

    // 更新视频摘要
    await db.update(videos)
      .set({
        aiSummary: summary,
        status: 'summarized',
        updatedAt: new Date(),
      })
      .where(eq(videos.id, job.videoId!));

    console.log(`[Worker] Summary generated for job ${jobId}`);

    // ============ Step 5: 生成标签（如果元数据中没有） ============
    const existingTags = metadata.tags.length > 0 ? metadata.tags : null;
    let finalTags: string[];
    
    if (existingTags) {
      finalTags = existingTags;
    } else {
      try {
        finalTags = await generateTags({
          title: metadata.title || '无标题视频',
          authorName: metadata.authorName,
          description: metadata.description,
          aiSummary: summary,
        });
      } catch (tagError) {
        console.warn(`[Worker] Tag generation failed:`, tagError instanceof Error ? tagError.message : tagError);
        finalTags = ['短视频', '抖音'];
      }
    }

    // ============ Step 6: 标记完成 ============
    await updateJobStatus(jobId, JOB_STATUSES.COMPLETED, {
      currentStep: null,
    });

    await db.update(videos)
      .set({
        tags: JSON.stringify(finalTags),
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(videos.id, job.videoId!));

    console.log(`[Worker] Job ${jobId} completed successfully`);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Worker] Job ${jobId} error:`, error);
    await markJobFailed(jobId, 'LLM_INVALID_OUTPUT', message);
  }
}

/**
 * 删除视频及其云端文件
 */
export async function deleteVideoWithFiles(videoId: string): Promise<void> {
  const videoRows = await db.select()
    .from(videos)
    .where(eq(videos.id, videoId));

  const video = videoRows[0];

  if (!video) {
    throw new Error(`Video not found: ${videoId}`);
  }

  // 删除对象存储中的文件
  const deletePromises: Promise<boolean>[] = [];
  
  if (video.videoFileKey) {
    console.log(`[Worker] Deleting video file: ${video.videoFileKey}`);
    deletePromises.push(deleteFile(video.videoFileKey).catch(() => false));
  }
  
  if (video.coverFileKey) {
    console.log(`[Worker] Deleting cover file: ${video.coverFileKey}`);
    deletePromises.push(deleteFile(video.coverFileKey).catch(() => false));
  }

  await Promise.all(deletePromises);

  // 删除关联的摘要
  await db.$client.execute({ sql: 'DELETE FROM summaries WHERE video_id = ?', args: [videoId] });

  // 删除关联的 MTA 记录
  await db.$client.execute({ sql: 'DELETE FROM mta_recipes WHERE video_id = ?', args: [videoId] });

  // 删除关联的深度研究文档
  await db.$client.execute({ sql: 'DELETE FROM research_docs WHERE video_id = ?', args: [videoId] });

  // 删除关联的导入任务
  await db.$client.execute({ sql: 'DELETE FROM ingestion_jobs WHERE video_id = ?', args: [videoId] });

  // 删除视频记录
  await db.$client.execute({ sql: 'DELETE FROM videos WHERE id = ?', args: [videoId] });

  console.log(`[Worker] Video ${videoId} and associated files deleted`);
}

// 注册任务处理器
registerJobHandler(processJob);

console.log('[Worker] Import worker registered');
