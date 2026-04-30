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

  it('forwards approval notifications unchanged through the generic notification channel', () => {
    const emit = vi.fn();

    dispatchProtocolEvent({ emit }, 'exec.approval.requested', {
      id: 'exec-1',
      createdAtMs: 10,
      expiresAtMs: 1_000,
      request: { command: 'mcporter --version' },
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('notification', {
      method: 'exec.approval.requested',
      params: {
        id: 'exec-1',
        createdAtMs: 10,
        expiresAtMs: 1_000,
        request: { command: 'mcporter --version' },
      },
    });
  });

  it('forwards session-scoped tool events through the generic notification channel', () => {
    const emit = vi.fn();

    dispatchProtocolEvent({ emit }, 'session.tool', {
      runId: 'run-continuation',
      sessionKey: 'agent:main:main',
      stream: 'tool',
      data: {
        toolCallId: 'tool-1',
        name: 'read',
        phase: 'start',
      },
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('notification', {
      method: 'session.tool',
      params: expect.objectContaining({
        runId: 'run-continuation',
        sessionKey: 'agent:main:main',
        stream: 'tool',
        data: expect.objectContaining({
          toolCallId: 'tool-1',
          phase: 'start',
        }),
      }),
    });
  });
});
