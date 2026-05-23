/**
 * 导入任务状态定义
 */
export const JOB_STATUSES = {
  CREATED: 'created',
  PARSING_METADATA: 'parsing_metadata',
  FETCHING_CONTENT: 'fetching_content',
  TRANSCRIBING: 'transcribing',
  CHUNKING: 'chunking',
  SUMMARIZING: 'summarizing',
  EMBEDDING: 'embedding',
  INDEXING: 'indexing',
  GRAPH_UPDATING: 'graph_updating',
  COMPLETED: 'completed',
  PARTIAL_COMPLETED: 'partial_completed',
  FAILED_RETRYABLE: 'failed_retryable',
  FAILED_TERMINAL: 'failed_terminal',
  CANCELLED: 'cancelled',
} as const;

export type JobStatus = typeof JOB_STATUSES[keyof typeof JOB_STATUSES];

/**
 * 正向状态流转顺序
 */
const FORWARD_TRANSITIONS: JobStatus[] = [
  JOB_STATUSES.CREATED,
  JOB_STATUSES.PARSING_METADATA,
  JOB_STATUSES.FETCHING_CONTENT,
  JOB_STATUSES.TRANSCRIBING,
  JOB_STATUSES.CHUNKING,
  JOB_STATUSES.SUMMARIZING,
  JOB_STATUSES.EMBEDDING,
  JOB_STATUSES.INDEXING,
  JOB_STATUSES.GRAPH_UPDATING,
  JOB_STATUSES.COMPLETED,
];

const TERMINAL_STATES: Set<JobStatus> = new Set([
  JOB_STATUSES.COMPLETED,
  JOB_STATUSES.PARTIAL_COMPLETED,
  JOB_STATUSES.FAILED_TERMINAL,
  JOB_STATUSES.CANCELLED,
]);

/**
 * 状态转换校验
 */
export function isValidTransition(from: JobStatus, to: JobStatus): boolean {
  // 终止状态不可再转换
  if (TERMINAL_STATES.has(from)) return false;

  // 任何非终止状态都可以转到失败状态
  if (to === JOB_STATUSES.FAILED_RETRYABLE || to === JOB_STATUSES.FAILED_TERMINAL) return true;

  // 可重试失败可以回到 created
  if (from === JOB_STATUSES.FAILED_RETRYABLE && to === JOB_STATUSES.CREATED) return true;

  // 正向流转：to 必须是 from 之后的步骤
  const fromIdx = FORWARD_TRANSITIONS.indexOf(from);
  const toIdx = FORWARD_TRANSITIONS.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return false;

  return toIdx === fromIdx + 1;
}

/**
 * 获取下一个状态
 */
export function getNextStatus(current: JobStatus): JobStatus | null {
  const idx = FORWARD_TRANSITIONS.indexOf(current);
  if (idx === -1 || idx >= FORWARD_TRANSITIONS.length - 1) return null;
  return FORWARD_TRANSITIONS[idx + 1];
}

/**
 * 根据当前状态计算进度百分比
 */
export function getProgressForStatus(status: JobStatus): number {
  const progressMap: Record<JobStatus, number> = {
    [JOB_STATUSES.CREATED]: 0,
    [JOB_STATUSES.PARSING_METADATA]: 15,
    [JOB_STATUSES.FETCHING_CONTENT]: 30,
    [JOB_STATUSES.TRANSCRIBING]: 45,
    [JOB_STATUSES.CHUNKING]: 55,
    [JOB_STATUSES.SUMMARIZING]: 70,
    [JOB_STATUSES.EMBEDDING]: 80,
    [JOB_STATUSES.INDEXING]: 90,
    [JOB_STATUSES.GRAPH_UPDATING]: 95,
    [JOB_STATUSES.COMPLETED]: 100,
    [JOB_STATUSES.PARTIAL_COMPLETED]: 100,
    [JOB_STATUSES.FAILED_RETRYABLE]: 0,
    [JOB_STATUSES.FAILED_TERMINAL]: 0,
    [JOB_STATUSES.CANCELLED]: 0,
  };
  return progressMap[status] ?? 0;
}

/**
 * 获取状态的中文显示名
 */
export function getStatusLabel(status: JobStatus): string {
  const labelMap: Record<JobStatus, string> = {
    [JOB_STATUSES.CREATED]: '已创建',
    [JOB_STATUSES.PARSING_METADATA]: '解析元数据',
    [JOB_STATUSES.FETCHING_CONTENT]: '获取内容',
    [JOB_STATUSES.TRANSCRIBING]: '语音转写',
    [JOB_STATUSES.CHUNKING]: '文本切分',
    [JOB_STATUSES.SUMMARIZING]: 'AI 摘要生成',
    [JOB_STATUSES.EMBEDDING]: '向量化',
    [JOB_STATUSES.INDEXING]: '索引入库',
    [JOB_STATUSES.GRAPH_UPDATING]: '图谱更新',
    [JOB_STATUSES.COMPLETED]: '已完成',
    [JOB_STATUSES.PARTIAL_COMPLETED]: '部分完成',
    [JOB_STATUSES.FAILED_RETRYABLE]: '失败（可重试）',
    [JOB_STATUSES.FAILED_TERMINAL]: '失败（不可重试）',
    [JOB_STATUSES.CANCELLED]: '已取消',
  };
  return labelMap[status] ?? status;
}

/**
 * 错误码定义
 */
export const ERROR_CODES = {
  PARSE_INVALID_URL: 'PARSE_INVALID_URL',
  PARSE_LINK_EXPIRED: 'PARSE_LINK_EXPIRED',
  ASR_TIMEOUT: 'ASR_TIMEOUT',
  ASR_UNSUPPORTED_LANG: 'ASR_UNSUPPORTED_LANG',
  LLM_RATE_LIMIT: 'LLM_RATE_LIMIT',
  LLM_INVALID_OUTPUT: 'LLM_INVALID_OUTPUT',
  VEC_INSERT_FAILED: 'VEC_INSERT_FAILED',
  VEC_SEARCH_ERROR: 'VEC_SEARCH_ERROR',
  JOB_MAX_RETRY_EXCEEDED: 'JOB_MAX_RETRY_EXCEEDED',
  JOB_CANCELLED: 'JOB_CANCELLED',
  GRAPH_BUILD_FAILED: 'GRAPH_BUILD_FAILED',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

/**
 * 判断错误是否可重试
 */
export function isRetryableError(errorCode: ErrorCode): boolean {
  const retryableCodes = new Set<ErrorCode>([
    ERROR_CODES.ASR_TIMEOUT,
    ERROR_CODES.LLM_RATE_LIMIT,
    ERROR_CODES.VEC_INSERT_FAILED,
    ERROR_CODES.VEC_SEARCH_ERROR,
    ERROR_CODES.GRAPH_BUILD_FAILED,
  ]);
  return retryableCodes.has(errorCode);
}
