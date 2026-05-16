export interface QueueJob {
  id: string;
  type: 'parse_metadata';
  payload: {
    jobId: string;
    videoId: string;
    shareUrl: string;
  };
}

type JobHandler = (job: QueueJob) => Promise<void>;

export class MemoryQueue {
  private jobs: QueueJob[] = [];
  private handlers: Map<string, JobHandler> = new Map();
  private running = false;

  register(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  enqueue(job: QueueJob) {
    this.jobs.push(job);
    if (!this.running) {
      this.processLoop();
    }
  }

  private async processLoop() {
    this.running = true;
    while (this.jobs.length > 0) {
      const job = this.jobs.shift();
      if (!job) continue;

      const handler = this.handlers.get(job.type);
      if (handler) {
        try {
          await handler(job);
        } catch (err) {
          console.error(`Job ${job.id} failed:`, err);
        }
      }

      // 简单节流，避免 CPU 占满
      await new Promise((r) => setTimeout(r, 100));
    }
    this.running = false;
  }
}

export const queue = new MemoryQueue();
