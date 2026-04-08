import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const subscribeHostEventMock = vi.fn();

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (...args: unknown[]) => subscribeHostEventMock(...args),
}));

describe('approval store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    subscribeHostEventMock.mockReset();
  });

  it('subscribes once and appends requested approvals', async () => {
    let handler: ((payload: unknown) => void) | null = null;
    subscribeHostEventMock.mockImplementation((eventName: string, nextHandler: (payload: unknown) => void) => {
      expect(eventName).toBe('gateway:notification');
      handler = nextHandler;
      return () => {};
    });

    const { useApprovalStore } = await import('@/stores/approval');
    useApprovalStore.setState({
      ...useApprovalStore.getState(),
      queue: [],
      busy: false,
      error: null,
      isInitialized: false,
    });

    await useApprovalStore.getState().init();

    handler?.({
      method: 'exec.approval.requested',
      params: {
        id: 'exec-1',
        createdAtMs: 10,
        expiresAtMs: Date.now() + 60_000,
        request: {
          command: 'echo hello',
        },
      },
    });

    expect(useApprovalStore.getState().queue.map((entry) => entry.id)).toEqual(['exec-1']);
  });

  it('removes approvals only after the resolved event arrives', async () => {
    let handler: ((payload: unknown) => void) | null = null;
    subscribeHostEventMock.mockImplementation((_eventName: string, nextHandler: (payload: unknown) => void) => {
      handler = nextHandler;
      return () => {};
    });

    const { useApprovalStore } = await import('@/stores/approval');
    useApprovalStore.setState({
      ...useApprovalStore.getState(),
      queue: [],
      busy: false,
      error: null,
      isInitialized: false,
    });

    await useApprovalStore.getState().init();

    handler?.({
      method: 'plugin.approval.requested',
      params: {
        id: 'plugin:1',
        createdAtMs: 10,
        expiresAtMs: Date.now() + 60_000,
        request: {
          title: 'Plugin approval needed',
          description: 'Needs install permission',
        },
      },
    });

    expect(useApprovalStore.getState().queue.map((entry) => entry.id)).toEqual(['plugin:1']);

    handler?.({
      method: 'plugin.approval.resolved',
      params: {
        id: 'plugin:1',
        decision: 'deny',
        ts: Date.now(),
      },
    });

    expect(useApprovalStore.getState().queue).toEqual([]);
  });

  it('uses gateway rpc with the correct resolve method and keeps the queue item until resolved', async () => {
    const { useGatewayStore } = await import('@/stores/gateway');
    const rpcMock = vi.spyOn(useGatewayStore.getState(), 'rpc').mockResolvedValue(undefined);

    const { useApprovalStore } = await import('@/stores/approval');
    useApprovalStore.setState({
      ...useApprovalStore.getState(),
      queue: [{
        id: 'plugin:1',
        kind: 'plugin',
        createdAtMs: 1,
        expiresAtMs: Date.now() + 60_000,
        request: { command: 'Plugin approval needed' },
        pluginTitle: 'Plugin approval needed',
        pluginDescription: 'Needs install permission',
        pluginSeverity: null,
        pluginId: null,
        allowedDecisions: ['allow-once', 'deny'],
      }],
      busy: false,
      error: null,
      isInitialized: true,
    });

    await act(async () => {
      await useApprovalStore.getState().resolveActive('deny');
    });

    expect(rpcMock).toHaveBeenCalledWith('plugin.approval.resolve', {
      id: 'plugin:1',
      decision: 'deny',
    }, 10_000);
    expect(useApprovalStore.getState().queue.map((entry) => entry.id)).toEqual(['plugin:1']);
    expect(useApprovalStore.getState().busy).toBe(true);
    expect(useApprovalStore.getState().pendingDecisionId).toBe('plugin:1');
    expect(useApprovalStore.getState().error).toBeNull();
  });

  it('ignores duplicate submissions while waiting for the resolved event', async () => {
    const { useGatewayStore } = await import('@/stores/gateway');
    const rpcMock = vi.spyOn(useGatewayStore.getState(), 'rpc').mockResolvedValue(undefined);

    const { useApprovalStore } = await import('@/stores/approval');
    useApprovalStore.setState({
      ...useApprovalStore.getState(),
      queue: [{
        id: 'exec-duplicate',
        kind: 'exec',
        createdAtMs: 1,
        expiresAtMs: Date.now() + 60_000,
        request: { command: 'echo hello' },
        allowedDecisions: ['allow-once', 'deny'],
      }],
      busy: false,
      error: null,
      pendingDecisionId: null,
      isInitialized: true,
    });

    await act(async () => {
      await useApprovalStore.getState().resolveActive('allow-once');
      await useApprovalStore.getState().resolveActive('deny');
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('exec.approval.resolve', {
      id: 'exec-duplicate',
      decision: 'allow-once',
    }, 10_000);
    expect(useApprovalStore.getState().pendingDecisionId).toBe('exec-duplicate');
    expect(useApprovalStore.getState().busy).toBe(true);
  });

  it('does not submit expired approvals and prunes them locally first', async () => {
    const { useGatewayStore } = await import('@/stores/gateway');
    const rpcMock = vi.spyOn(useGatewayStore.getState(), 'rpc').mockResolvedValue(undefined);

    const { useApprovalStore } = await import('@/stores/approval');
    useApprovalStore.setState({
      ...useApprovalStore.getState(),
      queue: [{
        id: 'exec-expired',
        kind: 'exec',
        createdAtMs: 1,
        expiresAtMs: Date.now() - 1,
        request: { command: 'echo expired' },
        allowedDecisions: ['allow-once', 'deny'],
      }],
      busy: false,
      error: null,
      pendingDecisionId: null,
      isInitialized: true,
    });

    await act(async () => {
      await useApprovalStore.getState().resolveActive('deny');
    });

    expect(rpcMock).not.toHaveBeenCalled();
    expect(useApprovalStore.getState().queue).toEqual([]);
    expect(useApprovalStore.getState().busy).toBe(false);
    expect(useApprovalStore.getState().pendingDecisionId).toBeNull();
  });

  it('clears busy state when pruning the pending approval after expiry', async () => {
    const { useApprovalStore } = await import('@/stores/approval');
    useApprovalStore.setState({
      ...useApprovalStore.getState(),
      queue: [{
        id: 'exec-stuck',
        kind: 'exec',
        createdAtMs: 1,
        expiresAtMs: Date.now() - 1,
        request: { command: 'echo stuck' },
        allowedDecisions: ['allow-once', 'deny'],
      }],
      busy: true,
      error: null,
      pendingDecisionId: 'exec-stuck',
      isInitialized: true,
    });

    act(() => {
      useApprovalStore.getState().pruneExpired();
    });

    expect(useApprovalStore.getState().queue).toEqual([]);
    expect(useApprovalStore.getState().busy).toBe(false);
    expect(useApprovalStore.getState().pendingDecisionId).toBeNull();
  });

  it('surfaces rpc failures and does not clear the queue', async () => {
    const { useGatewayStore } = await import('@/stores/gateway');
    vi.spyOn(useGatewayStore.getState(), 'rpc').mockRejectedValue(new Error('gateway offline'));

    const { useApprovalStore } = await import('@/stores/approval');
    useApprovalStore.setState({
      ...useApprovalStore.getState(),
      queue: [{
        id: 'exec-2',
        kind: 'exec',
        createdAtMs: 1,
        expiresAtMs: Date.now() + 60_000,
        request: { command: 'mcporter --version' },
        pluginTitle: undefined,
        pluginDescription: undefined,
        pluginSeverity: undefined,
        pluginId: undefined,
        allowedDecisions: ['allow-once', 'allow-always', 'deny'],
      }],
      busy: false,
      error: null,
      isInitialized: true,
    });

    await act(async () => {
      await useApprovalStore.getState().resolveActive('allow-once');
    });

    expect(useApprovalStore.getState().queue.map((entry) => entry.id)).toEqual(['exec-2']);
    expect(useApprovalStore.getState().error).toContain('gateway offline');
    expect(useApprovalStore.getState().busy).toBe(false);
  });

  it('adds and clears debug approvals for local styling work', async () => {
    const { useApprovalStore } = await import('@/stores/approval');
    useApprovalStore.setState({
      ...useApprovalStore.getState(),
      queue: [],
      busy: false,
      error: null,
      pendingDecisionId: null,
      isInitialized: true,
    });

    useApprovalStore.getState().showDebugApproval('exec');
    useApprovalStore.getState().showDebugApproval('plugin');

    expect(useApprovalStore.getState().queue.map((entry) => entry.id)).toEqual([
      'debug-approval:exec',
      'debug-approval:plugin',
    ]);

    useApprovalStore.getState().clearDebugApprovals();

    expect(useApprovalStore.getState().queue).toEqual([]);
  });

  it('resolves debug approvals locally without sending gateway rpc', async () => {
    const { useGatewayStore } = await import('@/stores/gateway');
    const rpcMock = vi.spyOn(useGatewayStore.getState(), 'rpc').mockResolvedValue(undefined);

    const { useApprovalStore } = await import('@/stores/approval');
    useApprovalStore.setState({
      ...useApprovalStore.getState(),
      queue: [{
        id: 'debug-approval:exec',
        kind: 'exec',
        createdAtMs: 1,
        expiresAtMs: Date.now() + 60_000,
        request: { command: 'echo debug approval' },
        allowedDecisions: ['allow-once', 'allow-always', 'deny'],
      }],
      busy: false,
      error: null,
      pendingDecisionId: null,
      isInitialized: true,
    });

    await act(async () => {
      await useApprovalStore.getState().resolveActive('allow-once');
    });

    expect(rpcMock).not.toHaveBeenCalled();
    expect(useApprovalStore.getState().queue).toEqual([]);
  });
});
