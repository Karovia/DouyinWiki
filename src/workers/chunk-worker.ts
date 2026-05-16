import { eq } from 'drizzle-orm';
import { db } from '../db';
import { transcripts, chunks } from '../db/schema';
import { JobQueue, JobResult } from './queue';
import { ImportService } from '../services/import-service';
import { TranscriptSegment } from '../domain/types';
import { nanoid } from 'nanoid';
import { queue } from './queue';

export function registerChunkWorker(
  queueInstance: JobQueue,
  importService: ImportService
) {
  queueInstance.register('chunk', async (job): Promise<JobResult> => {
    const { jobId, videoId, workspaceId } = job.payload;
    const retryCount = (job.payload as unknown as Record<string, number>)._retryCount ?? 0;

    try {
      await importService.updateJobStatus(jobId, workspaceId, 'chunking', {
        step: 'chunking',
      });

      const transcriptRows = await db
        .select()
        .from(transcripts)
        .where(eq(transcripts.videoId, videoId))
        .limit(1);

      const transcript = transcriptRows[0];

      if (transcript?.segments) {
        const segments = JSON.parse(transcript.segments) as TranscriptSegment[];
        const chunkList = chunkTranscriptSegments(segments);

        for (let i = 0; i < chunkList.length; i++) {
          const item = chunkList[i];
          await db.insert(chunks).values({
            id: nanoid(),
            videoId,
            workspaceId,
            contentType: 'transcript',
            chunkIndex: i,
            content: item.content,
            contentHash: simpleHash(item.content),
            startTimeMs: item.startTimeMs,
            endTimeMs: item.endTimeMs,
          });
        }
      }

      queue.enqueue({
        id: `${jobId}-summarize`,
        type: 'summarize',
        payload: { jobId, videoId, shareUrl: job.payload.shareUrl, workspaceId },
      });

      return { success: true };
    } catch (err) {
      console.error(`Chunk worker failed for ${videoId}:`, err);
      if (retryCount < 3) {
        return { success: false, retryable: true, error: err instanceof Error ? err : new Error(String(err)) };
      }
      await importService.updateJobStatus(jobId, workspaceId, 'failed_terminal', {
        step: 'chunking',
        errorCode: 'CHUNK_FAILED',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      });
      return { success: false, retryable: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  });
}

function chunkTranscriptSegments(segments: TranscriptSegment[]): {
  content: string;
  startTimeMs: number;
  endTimeMs: number;
}[] {
  const result: { content: string; startTimeMs: number; endTimeMs: number }[] = [];
  let currentText = '';
  let currentStart = 0;
  let currentEnd = 0;

  for (const seg of segments) {
    if (currentText.length === 0) {
      currentStart = seg.startMs;
    }

    currentText += seg.text;
    currentEnd = seg.endMs;

    if (currentText.length >= 150 || seg.text.includes('。')) {
      result.push({
        content: currentText.trim(),
        startTimeMs: currentStart,
        endTimeMs: currentEnd,
      });
      currentText = '';
    }
  }

  if (currentText.trim()) {
    result.push({
      content: currentText.trim(),
      startTimeMs: currentStart,
      endTimeMs: currentEnd,
    });
  }

  return result;
}

function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(16);
}
