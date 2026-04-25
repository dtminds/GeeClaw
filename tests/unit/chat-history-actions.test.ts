import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/error-model';
import {
  appendPendingOptimisticUserMessage,
  buildDesktopSessionMetadataSync,
  createHistoryRequestSnapshot,
  getHistoryRequestKey,
  isHistoryUnavailableDuringGatewayStartup,
  isSameHistoryRequest,
} from '@/stores/chat/history-actions';
import type { ChatState } from '@/stores/chat/state';
import type { DesktopSessionSummary, RawMessage } from '@/stores/chat';

const baseSession: DesktopSessionSummary = {
  id: 'desktop-1',
  gatewaySessionKey: 'agent:writer:geeclaw_main',
  title: '',
  lastMessagePreview: '',
  createdAt: 1,
  updatedAt: 1,
};

describe('chat history action helpers', () => {
  it('captures and compares history request snapshots', () => {
    const state = {
      currentSessionKey: 'agent:writer:geeclaw_main',
      currentDesktopSessionId: 'desktop-1',
      currentViewMode: 'session',
      selectedCronRun: null,
      historyRequestGeneration: 2,
    } as Pick<ChatState, 'currentSessionKey' | 'currentDesktopSessionId' | 'currentViewMode' | 'selectedCronRun' | 'historyRequestGeneration'>;

    const request = createHistoryRequestSnapshot(state);

    expect(request).toEqual({
      sessionKey: 'agent:writer:geeclaw_main',
      desktopSessionId: 'desktop-1',
      viewMode: 'session',
      cronRunId: '',
      generation: 2,
    });
    expect(getHistoryRequestKey(request)).toBe('agent:writer:geeclaw_main::desktop-1::session::::2');
    expect(isSameHistoryRequest(request, state)).toBe(true);
    expect(isSameHistoryRequest(request, { ...state, historyRequestGeneration: 3 })).toBe(false);
  });

  it('detects gateway startup history unavailability from structured and string errors', () => {
    expect(isHistoryUnavailableDuringGatewayStartup(
      new AppError('GATEWAY', 'warming', undefined, {
        gatewayErrorCode: 'CHAT_HISTORY_STARTUP_UNAVAILABLE',
      }),
    )).toBe(true);
    expect(isHistoryUnavailableDuringGatewayStartup(
      new Error('chat.history unavailable during gateway startup'),
    )).toBe(true);
    expect(isHistoryUnavailableDuringGatewayStartup(new Error('other failure'))).toBe(false);
  });

  it('preserves the pending optimistic user message when history only has an older matching send', () => {
    const sentAtMs = 1_700_000_000_000;
    const optimistic: RawMessage = {
      id: 'optimistic-user',
      role: 'user',
      content: '你好',
      timestamp: sentAtMs / 1000,
    };
    const historyMessages: RawMessage[] = [
      {
        id: 'old-user',
        role: 'user',
        content: '你好',
        timestamp: sentAtMs / 1000 - 20,
      },
    ];

    expect(appendPendingOptimisticUserMessage(historyMessages, {
      sending: true,
      lastUserMessageAt: sentAtMs,
      pendingOptimisticUserId: 'optimistic-user',
      pendingOptimisticUserAnchorAt: sentAtMs - 1_000,
      pendingOptimisticUserIndex: 1,
      messages: [
        {
          id: 'prev-assistant',
          role: 'assistant',
          content: 'previous reply',
          timestamp: sentAtMs / 1000 - 1,
        },
        optimistic,
      ],
    })).toEqual([...historyMessages, optimistic]);
  });

  it('does not duplicate the optimistic user message when history already contains the current send', () => {
    const sentAtMs = 1_700_000_000_000;
    const persisted: RawMessage = {
      id: 'persisted-user',
      role: 'user',
      content: '你好',
      timestamp: sentAtMs / 1000 + 5,
    };

    expect(appendPendingOptimisticUserMessage([persisted], {
      sending: true,
      lastUserMessageAt: sentAtMs,
      pendingOptimisticUserId: 'optimistic-user',
      pendingOptimisticUserAnchorAt: sentAtMs - 1_000,
      pendingOptimisticUserIndex: 0,
      messages: [{
        id: 'optimistic-user',
        role: 'user',
        content: '你好',
        timestamp: sentAtMs / 1000,
      }],
    })).toEqual([persisted]);
  });

  it('finds the most recent matching optimistic user message without relying on truthy timestamps', () => {
    const older: RawMessage = {
      id: 'older-user',
      role: 'user',
      content: 'older',
      timestamp: 0,
    };
    const latest: RawMessage = {
      id: 'latest-user',
      role: 'user',
      content: 'latest',
      timestamp: 0,
    };

    expect(appendPendingOptimisticUserMessage([], {
      sending: true,
      lastUserMessageAt: 0,
      pendingOptimisticUserId: null,
      pendingOptimisticUserAnchorAt: null,
      pendingOptimisticUserIndex: null,
      messages: [older, latest],
    })).toEqual([latest]);
  });

  it('builds desktop session title, preview, and timestamp metadata from messages', () => {
    const messages: RawMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Summarize the release notes for the desktop client',
        timestamp: 10,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'The release improves startup and settings.',
        timestamp: 12,
      },
    ];

    expect(buildDesktopSessionMetadataSync(baseSession, messages)).toEqual({
      patch: {
        title: 'Summarize the release notes for the desktop client',
        lastMessagePreview: 'The release improves startup and settings.',
        updatedAt: 12_000,
      },
      session: {
        ...baseSession,
        title: 'Summarize the release notes for the desktop client',
        lastMessagePreview: 'The release improves startup and settings.',
        updatedAt: 12_000,
      },
    });
  });

  it('returns null when desktop session metadata is already current', () => {
    const session = {
      ...baseSession,
      title: 'Existing',
      lastMessagePreview: 'Existing reply',
      updatedAt: 12_000,
    };
    const messages: RawMessage[] = [{
      id: 'assistant-1',
      role: 'assistant',
      content: 'Existing reply',
      timestamp: 12,
    }];

    expect(buildDesktopSessionMetadataSync(session, messages)).toBeNull();
  });
});
