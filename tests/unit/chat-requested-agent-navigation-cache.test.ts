import { describe, expect, it } from 'vitest';
import {
  createRequestedAgentNavigationCache,
} from '@/pages/Chat/requested-agent-navigation-cache';

describe('requested agent navigation cache', () => {
  it('evicts the oldest keys once the bounded cache is full', () => {
    const cache = createRequestedAgentNavigationCache(2);

    cache.add('nav-1');
    cache.add('nav-2');
    cache.add('nav-3');

    expect(cache.has('nav-1')).toBe(false);
    expect(cache.has('nav-2')).toBe(true);
    expect(cache.has('nav-3')).toBe(true);
  });

  it('refreshes recency when an existing key is added again', () => {
    const cache = createRequestedAgentNavigationCache(2);

    cache.add('nav-1');
    cache.add('nav-2');
    cache.add('nav-1');
    cache.add('nav-3');

    expect(cache.has('nav-1')).toBe(true);
    expect(cache.has('nav-2')).toBe(false);
    expect(cache.has('nav-3')).toBe(true);
  });
});
