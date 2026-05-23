/**
 * 简易任务队列（MVP: 内存队列 + 轮询）
 * 后续可升级为 Redis + BullMQ
 */

type JobHandler = (jobId: string) => Promise<void>;

const queue: string[] = [];
let isProcessing = false;
let handler: JobHandler | null = null;

/**
 * 注册任务处理器
 */
export function registerJobHandler(fn: JobHandler): void {
  handler = fn;
}

/**
 * 将任务加入队列
 */
export function enqueueJob(jobId: string): void {
  if (!queue.includes(jobId)) {
    queue.push(jobId);
    console.log(`[Queue] Job enqueued: ${jobId}, queue size: ${queue.length}`);
  }
  processNext();
}

/**
 * 处理队列中的下一个任务
 */
async function processNext(): Promise<void> {
  if (isProcessing || queue.length === 0 || !handler) return;

  isProcessing = true;
  const jobId = queue.shift()!;

  try {
    console.log(`[Queue] Processing job: ${jobId}`);
    await handler(jobId);
    console.log(`[Queue] Job completed: ${jobId}`);
  } catch (error) {
    console.error(`[Queue] Job failed: ${jobId}`, error);
  } finally {
    isProcessing = false;
    // 继续处理下一个
    if (queue.length > 0) {
      // 使用 setImmediate 避免堆栈溢出
      setImmediate(() => processNext());
    }
  }
}

/**
 * 获取队列状态
 */
export function getQueueStatus(): { queueSize: number; isProcessing: boolean } {
  return {
    queueSize: queue.length,
    isProcessing,
  };
}
