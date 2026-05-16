import { JobStatus } from './types';

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

export function getNextState(current: JobStatus): JobStatus | null {
  const idx = FORWARD_STATES.indexOf(current);
  if (idx === -1 || idx >= FORWARD_STATES.length - 1) return null;
  return FORWARD_STATES[idx + 1];
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATES.includes(status);
}
