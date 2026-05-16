import { describe, it, expect } from 'vitest';
import {
  canTransition,
  getNextState,
  isTerminal,
  canRetry,
  canCancel,
  getRetryState,
  validateTransition,
} from '../../src/domain/state-machine';
import { AppError } from '../../src/domain/errors';

describe('state-machine', () => {
  it('created -> parsing_metadata', () => {
    expect(canTransition('created', 'parsing_metadata')).toBe(true);
  });

  it('created -> fetching_content (skip step) should fail', () => {
    expect(canTransition('created', 'fetching_content')).toBe(false);
  });

  it('completed -> any should fail', () => {
    expect(canTransition('completed', 'parsing_metadata')).toBe(false);
    expect(isTerminal('completed')).toBe(true);
  });

  it('transcribing -> partial_completed should succeed', () => {
    expect(canTransition('transcribing', 'partial_completed')).toBe(true);
  });

  it('getNextState', () => {
    expect(getNextState('created')).toBe('parsing_metadata');
    expect(getNextState('completed')).toBeNull();
  });

  describe('canRetry', () => {
    it('failed_retryable should be retryable', () => {
      expect(canRetry('failed_retryable')).toBe(true);
    });

    it('failed_terminal should not be retryable', () => {
      expect(canRetry('failed_terminal')).toBe(false);
    });

    it('completed should not be retryable', () => {
      expect(canRetry('completed')).toBe(false);
    });

    it('cancelled should not be retryable', () => {
      expect(canRetry('cancelled')).toBe(false);
    });

    it('created should not be retryable', () => {
      expect(canRetry('created')).toBe(false);
    });
  });

  describe('getRetryState', () => {
    it('should return step state when valid', () => {
      expect(getRetryState('transcribing')).toBe('transcribing');
      expect(getRetryState('embedding')).toBe('embedding');
    });

    it('should return parsing_metadata when step is null', () => {
      expect(getRetryState(null)).toBe('parsing_metadata');
    });

    it('should return parsing_metadata when step is undefined', () => {
      expect(getRetryState(undefined)).toBe('parsing_metadata');
    });

    it('should return parsing_metadata when step is empty', () => {
      expect(getRetryState('')).toBe('parsing_metadata');
    });

    it('should return parsing_metadata when step is invalid', () => {
      expect(getRetryState('invalid_state')).toBe('parsing_metadata');
    });
  });

  describe('canCancel', () => {
    it('non-terminal states should be cancellable', () => {
      expect(canCancel('created')).toBe(true);
      expect(canCancel('parsing_metadata')).toBe(true);
      expect(canCancel('transcribing')).toBe(true);
      expect(canCancel('failed_retryable')).toBe(true);
    });

    it('terminal states should not be cancellable', () => {
      expect(canCancel('completed')).toBe(false);
      expect(canCancel('partial_completed')).toBe(false);
      expect(canCancel('failed_terminal')).toBe(false);
      expect(canCancel('cancelled')).toBe(false);
    });
  });

  describe('validateTransition', () => {
    it('valid transition should not throw', () => {
      expect(() => validateTransition('created', 'parsing_metadata')).not.toThrow();
    });

    it('invalid transition should throw AppError', () => {
      expect(() => validateTransition('created', 'fetching_content')).toThrow(AppError);
    });

    it('thrown error should have correct code', () => {
      try {
        validateTransition('completed', 'parsing_metadata');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('JOB_INVALID_TRANSITION');
        expect((err as AppError).statusCode).toBe(409);
      }
    });

    it('terminal state transition should throw', () => {
      expect(() => validateTransition('completed', 'cancelled')).toThrow(AppError);
    });

    it('skip step transition should throw', () => {
      expect(() => validateTransition('created', 'chunking')).toThrow(AppError);
    });
  });
});
