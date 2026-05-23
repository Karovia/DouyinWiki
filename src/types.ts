export interface WikiItem {
  id: string;
  title: string;
  author: string;
  timeAgo: string;
  duration: string;
  summary: string;
  imageUrl: string;
  hasVideo: boolean;
}

export interface TaskStatus {
  id: string;
  progress: number;
  status: 'processing' | 'completed' | 'failed' | 'idle';
  message: string;
}
