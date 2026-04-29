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
});
