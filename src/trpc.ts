/**
 * 轻量 tRPC 客户端 — 手写 fetch，无需后端类型导入
 * 修复 415 错误：所有 mutation 使用 ?batch=1 格式
 */

const BASE = '/trpc';

// ─── 通用请求 ───

async function trpcQuery<T>(path: string, input: Record<string, unknown>): Promise<T> {
  // batch=1 格式：input 需要用 {"0": input} 包裹
  const batchInput = { '0': input };
  const encoded = encodeURIComponent(JSON.stringify(batchInput));
  const url = `${BASE}/${path}?batch=1&input=${encoded}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`tRPC query failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  // batch 格式返回数组
  const batchResult = Array.isArray(json) ? json[0] : json;
  if (batchResult.error) {
    throw new Error(batchResult.error.message || 'tRPC query error');
  }
  return batchResult.result.data as T;
}

async function trpcMutation<T>(path: string, input: Record<string, unknown>): Promise<T> {
  // 使用 batch=1 格式避免 tRPC v11 的 415 streaming 错误
  const url = `${BASE}/${path}?batch=1`;
  const body = JSON.stringify({ '0': input });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`tRPC mutation failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  // batch 格式返回数组
  const batchResult = Array.isArray(json) ? json[0] : json;
  if (batchResult.error) {
    throw new Error(batchResult.error.message || 'tRPC mutation error');
  }
  return batchResult.result.data as T;
}

// ─── Import API ───

export interface ImportCreateResult {
  jobId: string;
  status: string;
  videoId: string;
  isDuplicate: boolean;
}

export interface ImportStatusResult {
  found: boolean;
  jobId?: string;
  status?: string;
  progress?: number;
  currentStep?: string;
  errorCode?: string;
  errorMessage?: string;
  retryCount?: number;
  videoId?: string;
  video?: {
    id: string;
    title: string | null;
    authorName: string | null;
    coverUrl: string | null;
    status: string;
    aiSummary: string | null;
  } | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}

export const importApi = {
  create: (input: { shareUrl: string; workspaceId: string }) =>
    trpcMutation<ImportCreateResult>('import.create', input),

  status: (input: { jobId: string; workspaceId: string }) =>
    trpcQuery<ImportStatusResult>('import.status', input),

  retry: (input: { jobId: string; workspaceId: string }) =>
    trpcMutation<ImportCreateResult>('import.retry', input),
};

// ─── Videos API ───

export interface VideoItem {
  id: string;
  title: string | null;
  authorName: string | null;
  coverUrl: string | null;
  hasVideo: boolean;
  duration: number | null;
  description: string | null;
  shareUrl: string;
  aiSummary: string | null;
  tags: string[];
  status: string;
  platform: string;
  createdAt: number;
}

export interface VideosListResult {
  items: VideoItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface VideoDetailResult {
  found: boolean;
  video?: {
    id: string;
    title: string | null;
    authorName: string | null;
    authorId: string | null;
    coverUrl: string | null;
    hasVideo: boolean;
    duration: number | null;
    description: string | null;
    shareUrl: string;
    aiSummary: string | null;
    tags: string[];
    status: string;
    platform: string | null;
    createdAt: number | null;
  };
  transcripts?: Array<{
    id: string;
    source: string | null;
    modelName: string | null;
    content: string | null;
  }>;
  summaries?: Array<{
    id: string;
    content: string | null;
    promptVersion: string | null;
    modelName: string | null;
  }>;
}

export const videosApi = {
  list: (input: { workspaceId: string; limit: number; offset: number }) =>
    trpcQuery<VideosListResult>('videos.list', input),

  detail: (input: { videoId: string; workspaceId: string }) =>
    trpcQuery<VideoDetailResult>('videos.detail', input),

  delete: (input: { videoId: string; workspaceId: string }) =>
    trpcMutation<{ success: boolean }>('videos.delete', input),

  playUrl: (input: { videoId: string; workspaceId: string }) =>
    trpcMutation<{ playUrl: string }>('videos.playUrl', input),
};

// ─── QA API ───

export interface QaResult {
  answer: string;
  source?: 'summary' | 'video';
  error?: string;
}

export const qaApi = {
  ask: (input: { videoId: string; question: string; workspaceId: string }) =>
    trpcMutation<QaResult>('qa.ask', input),
};

// ─── MTA (More Than Asking) API ───

export interface CookingStep {
  step: number;
  title: string;
  description: string;
  timerSeconds: number | null;
  timerLabel: string | null;
}

export interface CookingRecipe {
  dishName: string;
  servings: string;
  ingredients: string[];
  steps: CookingStep[];
}

export interface MtaDetectResult {
  isCooking: boolean;
}

export interface MtaRecipeResult {
  recipe?: CookingRecipe;
  recipeId?: string;
  error?: string;
}

export interface MtaRecipeItem {
  id: string;
  videoId: string;
  videoTitle: string | null;
  coverUrl: string | null;
  dishName: string;
  servings: string | null;
  ingredients: string[];
  steps: CookingStep[];
  cooldown: string[];
  category: string;
  createdAt: number;
}

export interface MtaListResult {
  items: MtaRecipeItem[];
  total: number;
}

export interface MtaDetailResult {
  id: string;
  videoId: string;
  videoTitle: string | null;
  coverUrl: string | null;
  dishName: string;
  servings: string | null;
  ingredients: string[];
  steps: CookingStep[];
  category: string;
  createdAt: number;
}

export interface TrainingStep {
  step: number;
  title: string;
  description: string;
  sets?: number;
  reps?: number;
  timerSeconds?: number;
  timerLabel?: string;
  restSeconds?: number;
  restLabel?: string;
}

export interface TrainingPlan {
  workoutName: string;
  targetMuscle: string;
  duration: string;
  difficulty: string;
  warmup: string[];
  steps: TrainingStep[];
  cooldown: string[];
}

export interface TrainingPlanResult {
  plan?: TrainingPlan;
  planId?: string;
  error?: string;
}

export interface PlanningScheduleItem {
  time: string;
  activity: string;
  note?: string;
}

export interface PlanningStep {
  day: number;
  title: string;
  description: string;
  schedule: PlanningScheduleItem[];
  tips?: string;
}

export interface TravelPlan {
  planName: string;
  destination: string;
  duration: string;
  budgetLevel: string;
  theme: string;
  overview: string;
  steps: PlanningStep[];
  tips: string[];
}

export interface TravelPlanResult {
  plan?: TravelPlan;
  planId?: string;
  error?: string;
}

export interface ResearchDoc {
  id: string;
  workspaceId: string;
  videoId: string;
  title: string;
  topic: string;
  content: string;
  createdAt: Date | null;
}

export type MtaCategory = 'training' | 'recipes' | 'planning' | 'research';

export const mtaApi = {
  detectCooking: (input: { videoId: string; workspaceId: string }) =>
    trpcQuery<MtaDetectResult>('mta.detectCooking', input),

  generateRecipe: (input: { videoId: string; workspaceId: string; category?: MtaCategory }) =>
    trpcMutation<MtaRecipeResult>('mta.generateRecipe', input),

  list: (input: { workspaceId: string; limit?: number; offset?: number; category?: MtaCategory }) =>
    trpcQuery<MtaListResult>('mta.list', input),

  detail: (input: { recipeId: string; workspaceId: string }) =>
    trpcQuery<MtaDetailResult | null>('mta.detail', input),

  delete: (input: { recipeId: string; workspaceId: string }) =>
    trpcMutation<{ success: boolean }>('mta.delete', input),

  detectTraining: (input: { videoId: string; workspaceId: string }) =>
    trpcQuery<MtaDetectResult>('mta.detectTraining', input),

  generateTraining: (input: { videoId: string; workspaceId: string }) =>
    trpcMutation<TrainingPlanResult>('mta.generateTraining', input),

  detectPlanning: (input: { videoId: string; workspaceId: string }) =>
    trpcQuery<{ isPlanning: boolean }>('mta.detectPlanning', input),

  generatePlanning: (input: { videoId: string; workspaceId: string; category?: MtaCategory }) =>
    trpcMutation<TravelPlanResult>('mta.generatePlanning', input),

  research: (input: { videoId: string; workspaceId: string; topic: string }) =>
    trpcMutation<{ content?: string; error?: string }>('mta.research', input),

  researchSave: (input: { videoId: string; workspaceId: string; title: string; topic: string; content: string }) =>
    trpcMutation<{ docId: string }>('mta.researchSave', input),

  researchList: (input: { videoId: string; workspaceId: string }) =>
    trpcQuery<ResearchDoc[]>('mta.researchList', input),

  researchDetail: (input: { docId: string; workspaceId: string }) =>
    trpcQuery<ResearchDoc | null>('mta.researchDetail', input),

  researchDelete: (input: { docId: string; workspaceId: string }) =>
    trpcMutation<{ success: boolean }>('mta.researchDelete', input),

  researchExport: (input: { docId: string; workspaceId: string; format: 'pdf' | 'docx' | 'html' }) =>
    trpcMutation<{ base64?: string; filename?: string; mimeType?: string; error?: string }>('mta.researchExport', input),
};
