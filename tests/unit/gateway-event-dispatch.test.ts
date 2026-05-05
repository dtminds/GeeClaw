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

  it('dispatches native gateway readiness and health events outside generic notifications', () => {
    const emit = vi.fn();

    dispatchProtocolEvent({ emit }, 'ready', { ready: true });
    dispatchProtocolEvent({ emit }, 'gateway.ready', { ready: true, phase: 'plugins' });
    dispatchProtocolEvent({ emit }, 'health', { ok: true, version: '1.2.3' });
    dispatchProtocolEvent({ emit }, 'presence', [{ mode: 'gateway', ts: 1 }]);

    expect(emit).toHaveBeenCalledWith('gateway:ready', { ready: true });
    expect(emit).toHaveBeenCalledWith('gateway:ready', { ready: true, phase: 'plugins' });
    expect(emit).toHaveBeenCalledWith('gateway:health', { ok: true, version: '1.2.3' });
    expect(emit).toHaveBeenCalledWith('gateway:presence', [{ mode: 'gateway', ts: 1 }]);
    expect(emit).not.toHaveBeenCalledWith('notification', expect.objectContaining({ method: 'health' }));
    expect(emit).not.toHaveBeenCalledWith('notification', expect.objectContaining({ method: 'presence' }));
  });

  it('supports both gateway channel status event spellings', () => {
    const emit = vi.fn();

    dispatchProtocolEvent({ emit }, 'channel.status', { channelId: 'wecom', status: 'connected' });
    dispatchProtocolEvent({ emit }, 'channel.status_changed', { channelId: 'telegram', status: 'running' });

    expect(emit).toHaveBeenCalledWith('channel:status', { channelId: 'wecom', status: 'connected' });
    expect(emit).toHaveBeenCalledWith('channel:status', { channelId: 'telegram', status: 'running' });
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
