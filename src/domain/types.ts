export type Platform = 'douyin' | 'kuaishou' | 'bilibili';

export type JobStatus =
  | 'created'
  | 'parsing_metadata'
  | 'fetching_content'
  | 'transcribing'
  | 'chunking'
  | 'summarizing'
  | 'embedding'
  | 'indexing'
  | 'graph_updating'
  | 'completed'
  | 'partial_completed'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'cancelled';

export interface VideoMetadata {
  platformVideoId?: string;
  title?: string;
  description?: string;
  authorName?: string;
  authorId?: string;
  coverUrl?: string;
  duration?: number;
  viewCount?: number;
  likeCount?: number;
  tags?: string[];
}

export interface ParsedUrl {
  platform: Platform;
  platformVideoId?: string;
  normalizedUrl: string;
  normalizedUrlHash: string;
}

export interface ImportJob {
  id: string;
  workspaceId: string;
  shareUrl: string;
  normalizedUrlHash: string;
  status: JobStatus;
  step?: string;
  progress: number;
  retryCount: number;
  maxRetries: number;
  errorCode?: string;
  errorMessage?: string;
  videoId?: string;
  nextRetryAt?: Date;
  lastErrorAt?: Date;
  attemptedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Video {
  id: string;
  workspaceId: string;
  platform: Platform;
  platformVideoId?: string;
  shareUrl: string;
  normalizedUrlHash: string;
  title?: string;
  description?: string;
  authorName?: string;
  authorId?: string;
  coverUrl?: string;
  duration?: number;
  tags?: string[];
  aiSummary?: string;
  aiTags?: string[];
  viewCount?: number;
  likeCount?: number;
  status: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface Transcript {
  id: string;
  videoId: string;
  workspaceId: string;
  source: 'asr' | 'subtitle' | 'manual_note' | 'ocr';
  modelName?: string;
  language?: string;
  segments: TranscriptSegment[];
  rawText?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chunk {
  id: string;
  videoId: string;
  workspaceId: string;
  contentType: 'transcript' | 'summary' | 'title' | 'note';
  chunkIndex: number;
  content: string;
  contentHash: string;
  startTimeMs?: number;
  endTimeMs?: number;
  createdAt: Date;
}

export interface VectorChunk {
  id: string;
  chunkId: string;
  videoId: string;
  workspaceId: string;
  modelName: string;
  dimension: number;
  embedding: number[];
  contentHash: string;
  createdAt: Date;
}

export interface SearchHit {
  chunkId: string;
  videoId: string;
  content: string;
  contentType: string;
  startTimeMs?: number;
  endTimeMs?: number;
  score: number;
}

export interface SearchFilter {
  contentTypes?: string[];
  videoIds?: string[];
}
