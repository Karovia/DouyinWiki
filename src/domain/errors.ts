export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean = false,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// 解析层错误
export const PARSE_INVALID_URL = (url: string) =>
  new AppError('PARSE_INVALID_URL', `Invalid URL format: ${url}`, false, 400);

export const PARSE_LINK_EXPIRED = () =>
  new AppError('PARSE_LINK_EXPIRED', 'Share link has expired', false, 400);

export const PARSE_PLATFORM_UNSUPPORTED = (platform: string) =>
  new AppError('PARSE_PLATFORM_UNSUPPORTED', `Platform not supported: ${platform}`, false, 400);

// ASR 层错误
export const ASR_TIMEOUT = () =>
  new AppError('ASR_TIMEOUT', 'ASR service timeout', true, 504);

export const ASR_UNSUPPORTED_LANG = () =>
  new AppError('ASR_UNSUPPORTED_LANG', 'Unsupported language', false, 400);

// LLM 层错误
export const LLM_RATE_LIMIT = () =>
  new AppError('LLM_RATE_LIMIT', 'LLM rate limit exceeded', true, 429);

export const LLM_INVALID_OUTPUT = () =>
  new AppError('LLM_INVALID_OUTPUT', 'LLM returned invalid output format', true, 502);

// 向量层错误
export const VEC_INSERT_FAILED = () =>
  new AppError('VEC_INSERT_FAILED', 'Vector insert failed', true, 502);

export const VEC_SEARCH_ERROR = () =>
  new AppError('VEC_SEARCH_ERROR', 'Vector search failed', true, 502);

// 任务层错误
export const JOB_MAX_RETRY_EXCEEDED = () =>
  new AppError('JOB_MAX_RETRY_EXCEEDED', 'Max retry count exceeded', false, 422);

export const JOB_CANCELLED = () =>
  new AppError('JOB_CANCELLED', 'Job was cancelled', false, 409);
