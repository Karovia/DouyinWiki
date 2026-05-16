import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';
import { videos, ingestionJobs } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { ImportService } from '../../src/services/import-service';
import { VideoService } from '../../src/services/video-service';
import { MockDouyinConnector } from '../../src/infrastructure/douyin-connector';
import { MockLLMClient } from '../../src/infrastructure/llm-client';
import { MemoryQueue } from '../../src/workers/queue';
import { registerParseWorker } from '../../src/workers/parse-worker';

const TEST_WORKSPACE = 'test-workspace';
const VALID_URL = 'https://www.douyin.com/video/123456';

async function waitForWorker(ms = 2000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('import flow integration', () => {
  beforeEach(async () => {
    await db.delete(ingestionJobs);
    await db.delete(videos);
  });

  it('should create import job, process through worker, and complete successfully', async () => {
    const queue = new MemoryQueue();
    const connector = new MockDouyinConnector();
    const llm = new MockLLMClient();
    registerParseWorker(queue, connector, llm);

    const importService = new ImportService(connector);
    const videoService = new VideoService();

    // 1. 创建导入任务
    const job = await importService.createImportJob(VALID_URL, TEST_WORKSPACE);
    expect(job.status).toBe('created');
    expect(job.videoId).toBeDefined();

    // 2. 入队并等待 Worker 异步处理
    queue.enqueue({
      id: job.id,
      type: 'parse_metadata',
      payload: {
        jobId: job.id,
        videoId: job.videoId!,
        shareUrl: VALID_URL,
      },
    });

    await waitForWorker(2000);

    // 3. 查询任务状态应为 completed
    const jobStatus = await importService.getJobStatus(job.id);
    expect(jobStatus?.status).toBe('completed');
    expect(jobStatus?.step).toBe('completed');

    // 4. 查询视频列表应包含已导入视频
    const videoList = await videoService.list({ workspaceId: TEST_WORKSPACE });
    expect(videoList.total).toBe(1);
    expect(videoList.items[0].title).toContain('Mock Video');
    expect(videoList.items[0].aiSummary).toBeDefined();
    expect(videoList.items[0].status).toBe('completed');

    // 5. 视频详情可查询
    const detail = await videoService.detail(videoList.items[0].id, TEST_WORKSPACE);
    expect(detail).not.toBeNull();
    expect(detail?.platform).toBe('douyin');
    expect(detail?.shareUrl).toBe(VALID_URL);
  });

  it('should return existing job for duplicate URL (idempotency)', async () => {
    const connector = new MockDouyinConnector();
    const importService = new ImportService(connector);

    // 第一次导入
    const job1 = await importService.createImportJob(VALID_URL, TEST_WORKSPACE);
    expect(job1.status).toBe('created');

    // 第二次导入同一链接应返回已有任务
    const job2 = await importService.createImportJob(VALID_URL, TEST_WORKSPACE);
    expect(job2.id).toBe(job1.id);
    expect(job2.videoId).toBe(job1.videoId);
  });

  it('should isolate videos by workspace', async () => {
    const queue = new MemoryQueue();
    const connector = new MockDouyinConnector();
    const llm = new MockLLMClient();
    registerParseWorker(queue, connector, llm);

    const importService = new ImportService(connector);
    const videoService = new VideoService();

    // workspace-a 导入
    const jobA = await importService.createImportJob(VALID_URL, 'workspace-a');
    queue.enqueue({
      id: jobA.id,
      type: 'parse_metadata',
      payload: { jobId: jobA.id, videoId: jobA.videoId!, shareUrl: VALID_URL },
    });

    await waitForWorker(2000);

    // workspace-b 查询不到 workspace-a 的视频
    const listB = await videoService.list({ workspaceId: 'workspace-b' });
    expect(listB.total).toBe(0);

    // workspace-a 可以查询到自己的视频
    const listA = await videoService.list({ workspaceId: 'workspace-a' });
    expect(listA.total).toBe(1);
  });
});
