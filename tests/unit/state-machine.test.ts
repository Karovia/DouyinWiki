import { describe, it, expect } from 'vitest';
import { canTransition, getNextState, isTerminal } from '../../src/domain/state-machine';

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
});
