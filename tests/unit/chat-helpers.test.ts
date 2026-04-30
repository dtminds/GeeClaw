import { describe, expect, it } from 'vitest';
import {
  hasEquivalentFinalAssistantMessage,
  stripRenderedPrefixFromStreamingText,
  type RawMessage,
} from '@/stores/chat';
import { getLatestTerminalAssistantRunError } from '@/stores/chat/utils';

describe('chat helper dedupe', () => {
  it('matches equivalent assistant finals by text and timestamp when ids differ', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'history-1',
        content: '你好 BOSS! 我是 YY。',
        timestamp: 1710000000,
      },
    ];

    const candidate: RawMessage = {
      role: 'assistant',
      id: 'run-run-1',
      content: '你好 BOSS! 我是 YY。',
      timestamp: 1710000001,
    };

    expect(hasEquivalentFinalAssistantMessage(messages, candidate, candidate.id)).toBe(true);
  });

  it('does not match a different assistant reply', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'history-1',
        content: '第一条回复',
        timestamp: 1710000000,
      },
    ];

    const candidate: RawMessage = {
      role: 'assistant',
      id: 'run-run-2',
      content: '第二条回复',
      timestamp: 1710000001,
    };

    expect(hasEquivalentFinalAssistantMessage(messages, candidate, candidate.id)).toBe(false);
  });

  it('strips the longest rendered suffix-prefix from a resumed streaming segment', () => {
    const text = '上海多云，约 15°C，午后防雨。🪻查 X 登录中。X 登录正常。✅';

    expect(stripRenderedPrefixFromStreamingText(text, [
      { text: '你好 BOSS，查天气。', ts: 1 },
      { text: '上海多云，约 15°C，午后防雨。🪻查 X 登录中。', ts: 2 },
    ])).toBe('X 登录正常。✅');
  });

  it('does not surface a stale terminal error after a newer user turn', () => {
    expect(getLatestTerminalAssistantRunError([
      {
        role: 'user',
        id: 'user-1',
        content: '你是什么模型？',
        timestamp: 1,
      },
      {
        role: 'assistant',
        id: 'assistant-error',
        content: [],
        stopReason: 'error',
        errorMessage: '404 Resource not found',
        timestamp: 2,
      },
      {
        role: 'user',
        id: 'user-2',
        content: '重试一下',
        timestamp: 3,
      },
    ], null)).toBeNull();
  });

  it('matches terminal assistant errors when gateway role casing differs', () => {
    expect(getLatestTerminalAssistantRunError([
      {
        role: 'user',
        id: 'user-1',
        content: '你是什么模型？',
        timestamp: 1,
      },
      {
        role: 'Assistant',
        id: 'assistant-error',
        content: [],
        stopReason: 'error',
        errorMessage: '404 Resource not found',
        timestamp: 2,
      } as unknown as RawMessage,
    ], null)).toMatchObject({ errorMessage: '404 Resource not found' });
  });

  it('matches terminal assistant errors surfaced as isError payload text', () => {
    expect(getLatestTerminalAssistantRunError([
      {
        role: 'user',
        id: 'user-1',
        content: '继续',
        timestamp: 1,
      },
      {
        role: 'assistant',
        id: 'assistant-incomplete-turn-error',
        content: "⚠️ Agent couldn't generate a response. Please try again.",
        isError: true,
        timestamp: 2,
      },
    ], null)).toMatchObject({ content: "⚠️ Agent couldn't generate a response. Please try again." });
  });

  it('allows small clock skew when finding terminal assistant errors after send start', () => {
    const sendStartedAt = 1_710_000_010_000;

    expect(getLatestTerminalAssistantRunError([
      {
        role: 'assistant',
        id: 'assistant-error',
        content: [],
        stopReason: 'error',
        errorMessage: '429 Resource exhausted',
        timestamp: sendStartedAt - 5_000,
      },
    ], sendStartedAt)).toMatchObject({ errorMessage: '429 Resource exhausted' });
  });

  it('does not surface terminal assistant errors outside the clock skew window', () => {
    const sendStartedAt = 1_710_000_010_000;

    expect(getLatestTerminalAssistantRunError([
      {
        role: 'assistant',
        id: 'assistant-error',
        content: [],
        stopReason: 'error',
        errorMessage: '429 Resource exhausted',
        timestamp: sendStartedAt - 11_000,
      },
    ], sendStartedAt)).toBeNull();
  });
});
