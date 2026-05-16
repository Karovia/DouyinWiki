import { describe, it, expect } from 'vitest';
import { videoNodeId, entityNodeId, authorNodeId, parseNodeId } from '../../src/domain/graph-ids';
import { normalizeUndirectedEdge } from '../../src/domain/graph-utils';

describe('graph-ids', () => {
  it('videoNodeId', () => {
    expect(videoNodeId('abc123')).toBe('video:abc123');
  });

  it('entityNodeId', () => {
    expect(entityNodeId('react')).toBe('entity:react');
  });

  it('authorNodeId', () => {
    expect(authorNodeId('u456')).toBe('author:u456');
  });

  it('parseNodeId', () => {
    expect(parseNodeId('video:abc')).toEqual({ type: 'video', businessId: 'abc' });
    expect(parseNodeId('entity:foo:bar')).toEqual({ type: 'entity', businessId: 'foo:bar' });
  });
});

describe('graph-utils', () => {
  it('normalizeUndirectedEdge orders lexicographically', () => {
    expect(normalizeUndirectedEdge('b', 'a')).toEqual(['a', 'b']);
    expect(normalizeUndirectedEdge('a', 'b')).toEqual(['a', 'b']);
  });
});
