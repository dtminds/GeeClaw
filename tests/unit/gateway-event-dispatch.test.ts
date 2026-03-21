import { describe, expect, it, vi } from 'vitest';
import { dispatchProtocolEvent } from '@electron/gateway/event-dispatch';

describe('gateway event dispatch', () => {
  it('keeps agent events on the notification channel only', () => {
    const emit = vi.fn();

    dispatchProtocolEvent( { emit }, 'agent', {
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      stream: 'assistant',
      state: 'delta',
      message: { role: 'assistant', content: 'hello' },
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('notification', {
      method: 'agent',
      params: expect.objectContaining({
        runId: 'run-1',
        stream: 'assistant',
      }),
    });
  });

  it('still forwards chat events to chat-message', () => {
    const emit = vi.fn();

    dispatchProtocolEvent({ emit }, 'chat', {
      runId: 'run-2',
      sessionKey: 'agent:main:main',
      state: 'delta',
      message: { role: 'assistant', content: 'world' },
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('chat:message', {
      message: expect.objectContaining({
        runId: 'run-2',
        state: 'delta',
      }),
    });
  });
});
