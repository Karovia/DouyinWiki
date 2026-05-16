import { eq } from 'drizzle-orm';
import { db, type DbClient } from '../db';
import { transcripts } from '../db/schema';
import { ASRClient } from '../infrastructure/asr-client';
import { QueueJob, JobResult, JobQueue } from './queue';
import { ImportService } from '../services/import-service';
import { AppError } from '../domain/errors';
import { nanoid } from 'nanoid';

export function registerASRWorker(
  queueInstance: JobQueue,
  asr: ASRClient,
  importService: ImportService,
  dbClient: DbClient = db
) {
  queueInstance.register('transcribe', async (job: QueueJob): Promise<JobResult> => {
    const { jobId, videoId, shareUrl, workspaceId } = job.payload;
    const retryCount = (job.payload as Record<string, unknown>)._retryCount as number ?? 0;

    try {
      await importService.updateJobStatus(jobId, workspaceId, 'transcribing', {
        step: 'transcribing',
      });

      const result = await asr.transcribe(shareUrl, { language: 'zh' });

      const transcriptId = nanoid();
      await dbClient.insert(transcripts).values({
        id: transcriptId,
        videoId,
        workspaceId,
        source: 'asr',
        modelName: result.modelName,
        language: result.language,
        segments: JSON.stringify(result.segments),
        rawText: result.rawText,
      });

      await importService.updateJobStatus(jobId, workspaceId, 'chunking', {
        step: 'chunking',
      });

      queueInstance.enqueue({
        id: `${jobId}-chunk`,
        type: 'chunk',
        payload: { jobId, videoId, shareUrl, workspaceId, transcriptId },
      });

      return { success: true };
    } catch (err) {
      console.error(`ASR worker failed for ${videoId}:`, err);

      const { retryable, errorCode, errorMessage } = classifyASRError(err);

      try {
        if (retryable && retryCount < 3) {
          await importService.updateJobStatus(jobId, workspaceId, 'failed_retryable', {
            step: 'transcribing',
            errorCode,
            errorMessage,
          });
          return { success: false, retryable: true, error: err instanceof Error ? err : new Error(errorMessage) };
        } else {
          await importService.updateJobStatus(jobId, workspaceId, 'failed_terminal', {
            step: 'transcribing',
            errorCode,
            errorMessage: retryable ? `${errorMessage} (max retries exceeded)` : errorMessage,
          });
          return { success: false, retryable: false, error: err instanceof Error ? err : new Error(errorMessage) };
        }
      } catch (updateErr) {
        console.error(`Failed to update job status for ${jobId}:`, updateErr);
        return { success: false, retryable: true, error: err instanceof Error ? err : new Error(String(err)) };
      }
    }
  });
}

function classifyASRError(err: unknown): {
  retryable: boolean;
  errorCode: string;
  errorMessage: string;
} {
  if (err instanceof AppError) {
    return { retryable: err.retryable, errorCode: err.code, errorMessage: err.message };
  }

  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    if (message.includes('unsupported') || message.includes('invalid')) {
      return { retryable: false, errorCode: 'ASR_INVALID_INPUT', errorMessage: err.message };
    }
    if (message.includes('timeout') || message.includes('network') || message.includes('rate limit')) {
      return { retryable: true, errorCode: 'ASR_NETWORK_ERROR', errorMessage: err.message };
    }
  }

  return { retryable: true, errorCode: 'ASR_UNKNOWN', errorMessage: err instanceof Error ? err.message : 'Unknown error' };
}
