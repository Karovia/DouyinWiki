export type JobType =
  | 'parse_metadata'
  | 'transcribe'
  | 'chunk'
  | 'summarize'
  | 'embed'
  | 'index';

export interface QueueJob {
  id: string;
  type: JobType;
  payload: {
    jobId: string;
    videoId: string;
    shareUrl: string;
    workspaceId: string;
    [key: string]: unknown;
  };
}

export interface JobResult {
  success: boolean;
  retryable?: boolean;
  error?: Error;
}

type JobHandler = (job: QueueJob) => Promise<JobResult>;

interface RetryEntry {
  job: QueueJob;
  retryCount: number;
  nextRetryAt: Date;
}

export class JobQueue {
  // 配置
  private maxConcurrency: number;
  private baseRetryDelayMs: number;
  private maxRetries: number;
  private jobTimeoutMs: number;

  // 状态
  private jobs: QueueJob[] = [];
  private retryJobs: RetryEntry[] = [];
  private handlers: Map<string, JobHandler> = new Map();
  private runningCount = 0;
  private isRunning = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(options?: {
    maxConcurrency?: number;
    baseRetryDelayMs?: number;
    maxRetries?: number;
    jobTimeoutMs?: number;
  }) {
    this.maxConcurrency = options?.maxConcurrency ?? 3;
    this.baseRetryDelayMs = options?.baseRetryDelayMs ?? 5000;
    this.maxRetries = options?.maxRetries ?? 3;
    this.jobTimeoutMs = options?.jobTimeoutMs ?? 30000;

    // 优雅处理进程退出
    this.setupGracefulShutdown();
  }

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  enqueue(job: QueueJob): void {
    if (this.stopped) {
      console.warn(`Queue is stopped, ignoring job ${job.id}`);
      return;
    }
    this.jobs.push(job);
    if (!this.isRunning) {
      this.processLoop();
    }
  }

  private async processLoop(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    while ((this.jobs.length > 0 || this.retryJobs.length > 0 || this.runningCount > 0) && !this.stopped) {
      // 优先处理重试队列中到期的任务
      this.processRetries();

      // 并发控制
      while (this.runningCount < this.maxConcurrency && this.jobs.length > 0 && !this.stopped) {
        const job = this.jobs.shift();
        if (!job) continue;

        this.runningCount++;
        // 不 await，让任务并行执行
        this.processJob(job).finally(() => {
          this.runningCount--;
        });
      }

      // 短暂休眠，避免 CPU 空转
      if (this.jobs.length === 0 && this.runningCount > 0) {
        await new Promise((r) => setTimeout(r, 50));
      } else if (this.jobs.length === 0 && this.retryJobs.length > 0) {
        // 等待下一个重试任务到期
        await new Promise((r) => setTimeout(r, 100));
      } else if (this.jobs.length === 0 && this.runningCount === 0) {
        break;
      }
    }

    this.isRunning = false;
  }

  private async processJob(job: QueueJob): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      console.error(`No handler registered for job type: ${job.type}`);
      return;
    }

    // 从 payload 中读取当前重试次数
    const currentRetryCount = (job.payload as unknown as Record<string, number>)._retryCount ?? 0;

    try {
      const result = await this.runWithTimeout(
        handler(job),
        this.jobTimeoutMs
      );

      if (!result.success) {
        if (result.retryable) {
          this.scheduleRetry(job, currentRetryCount);
        } else {
          console.error(`Job ${job.id} failed (terminal):`, result.error);
        }
      }
    } catch (err) {
      console.error(`Job ${job.id} threw unexpected error:`, err);
      this.scheduleRetry(job, currentRetryCount);
    }
  }

  private scheduleRetry(job: QueueJob, retryCount: number): void {
    if (retryCount >= this.maxRetries) {
      console.error(`Job ${job.id} exceeded max retries (${this.maxRetries}), giving up`);
      return;
    }

    const delay = this.baseRetryDelayMs * Math.pow(2, retryCount);
    const nextRetryAt = new Date(Date.now() + delay);

    this.retryJobs.push({
      job,
      retryCount: retryCount + 1,
      nextRetryAt,
    });

    console.log(`Job ${job.id} scheduled for retry ${retryCount + 1}/${this.maxRetries} at ${nextRetryAt.toISOString()}`);

    // 启动重试定时器检查
    if (!this.retryTimer) {
      this.retryTimer = setInterval(() => this.processRetries(), 1000);
    }

    // 如果主循环没在运行，尝试启动
    if (!this.isRunning && !this.stopped) {
      this.processLoop();
    }
  }

  private processRetries(): void {
    const now = new Date();
    const readyRetries: RetryEntry[] = [];
    const remainingRetries: RetryEntry[] = [];

    for (const entry of this.retryJobs) {
      if (entry.nextRetryAt <= now) {
        readyRetries.push(entry);
      } else {
        remainingRetries.push(entry);
      }
    }

    this.retryJobs = remainingRetries;

    for (const entry of readyRetries) {
      this.jobs.push(entry.job);
      // 将 retryCount 附加到 job 的 payload 中，供 processJob 读取
      (entry.job.payload as unknown as Record<string, number>)._retryCount = entry.retryCount;
    }

    // 如果没有剩余重试任务，清理定时器
    if (this.retryJobs.length === 0 && this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private async runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Job timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  }

  private setupGracefulShutdown(): void {
    const shutdown = () => {
      console.log('Shutting down job queue...');
      this.stopped = true;
      if (this.retryTimer) {
        clearInterval(this.retryTimer);
        this.retryTimer = null;
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

export const queue = new JobQueue({
  maxConcurrency: 3,
  baseRetryDelayMs: 5000,
  maxRetries: 3,
  jobTimeoutMs: 30000,
});
