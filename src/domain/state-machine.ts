import { JobStatus } from './types';
import { AppError } from './errors';

const FORWARD_STATES: JobStatus[] = [
  'created',
  'parsing_metadata',
  'fetching_content',
  'transcribing',
  'chunking',
  'summarizing',
  'embedding',
  'indexing',
  'graph_updating',
  'completed',
];

const TERMINAL_STATES: JobStatus[] = [
  'completed',
  'partial_completed',
  'failed_terminal',
  'cancelled',
];

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (TERMINAL_STATES.includes(from)) return false;

  if (to === 'failed_retryable') return !TERMINAL_STATES.includes(from);
  if (to === 'failed_terminal') return !TERMINAL_STATES.includes(from);
  if (to === 'cancelled') return !TERMINAL_STATES.includes(from);
  if (to === 'partial_completed') return from === 'transcribing';

  const fromIndex = FORWARD_STATES.indexOf(from);
  const toIndex = FORWARD_STATES.indexOf(to);

  if (fromIndex === -1 || toIndex === -1) return false;

  // 正向流转只能按顺序，禁止跳步
  return toIndex === fromIndex + 1;
}

/**
 * 判断是否为重试转换：从 failed_retryable 回到之前的状态
 */
function isRetryTransition(from: JobStatus, to: JobStatus): boolean {
  if (from !== 'failed_retryable') return false;
  return FORWARD_STATES.includes(to);
}

export function getNextState(current: JobStatus): JobStatus | null {
  const idx = FORWARD_STATES.indexOf(current);
  if (idx === -1 || idx >= FORWARD_STATES.length - 1) return null;
  return FORWARD_STATES[idx + 1];
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

/**
 * 判断状态是否可以从 failed_retryable 重试
 */
export function canRetry(status: JobStatus): boolean {
  return status === 'failed_retryable';
}

/**
 * 返回重试后应该进入的状态
 * 使用 step 字段存储失败前的状态，重试时回到该状态
 * 如果 step 无效，则默认回到 parsing_metadata
 */
export function getRetryState(step: string | null | undefined): JobStatus | null {
  if (!step) return 'parsing_metadata';

  const validStep = FORWARD_STATES.includes(step as JobStatus);
  if (!validStep) return 'parsing_metadata';

  // 重试时回到失败前的状态（step 记录的是当前正在执行的步骤）
  return step as JobStatus;
}

/**
 * 判断状态是否可以被取消（只有非终止状态可以取消）
 */
export function canCancel(status: JobStatus): boolean {
  return !TERMINAL_STATES.includes(status);
}

/**
 * 验证状态转换，非法时抛出 AppError
 */
export function validateTransition(from: JobStatus, to: JobStatus): void {
  if (canTransition(from, to) || isRetryTransition(from, to)) {
    return;
  }
  throw new AppError(
    'JOB_INVALID_TRANSITION',
    `Invalid status transition from "${from}" to "${to}"`,
    false,
    409
  );
}
