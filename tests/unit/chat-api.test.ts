import { describe, expect, it } from 'vitest';

import { extractSessionTokenInfo } from '@/stores/chat/api';

describe('chat api helpers', () => {
  it('extracts finite token info fields from gateway session records', () => {
    expect(extractSessionTokenInfo({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: Number.NaN,
      contextTokens: 30,
      totalTokensFresh: true,
    })).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      contextTokens: 30,
      totalTokensFresh: true,
    });
  });

  it('returns null when a gateway session has no token info', () => {
    expect(extractSessionTokenInfo({
      inputTokens: '10',
      outputTokens: undefined,
      totalTokensFresh: 'yes',
    })).toBeNull();
  });
});
