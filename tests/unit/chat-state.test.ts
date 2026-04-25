import { describe, expect, it } from 'vitest';

import {
  createChatInitialState,
  createConversationResetState,
  createEmptyToolRuntimeState,
} from '@/stores/chat/state';

describe('chat store state helpers', () => {
  it('creates fresh runtime collections for each initial state', () => {
    const first = createChatInitialState();
    const second = createChatInitialState();

    expect(first.toolStreamById).not.toBe(second.toolStreamById);
    expect(first.toolResultHistoryReloadedIds).not.toBe(second.toolResultHistoryReloadedIds);

    first.toolStreamById.set('tool-1', {} as never);
    first.toolResultHistoryReloadedIds.add('tool-1');

    expect(second.toolStreamById.size).toBe(0);
    expect(second.toolResultHistoryReloadedIds.size).toBe(0);
  });

  it('resets conversation-specific runtime fields without changing selection fields', () => {
    expect(createConversationResetState()).toEqual({
      messages: [],
      ...createEmptyToolRuntimeState(),
      activeRunId: null,
      error: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingOptimisticUserId: null,
      pendingOptimisticUserAnchorAt: null,
      pendingOptimisticUserIndex: null,
      pendingToolImages: [],
      pendingToolHiddenCount: 0,
    });
  });
});
