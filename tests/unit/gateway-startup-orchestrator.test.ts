import { describe, expect, it, vi } from 'vitest';
import { runGatewayStartupSequence } from '@electron/gateway/startup-orchestrator';

describe('runGatewayStartupSequence', () => {
  it('retries attaching to the same running gateway before restarting the process', async () => {
    const waitForPortFree = vi.fn(async (_port: number, _signal?: AbortSignal) => {});
    const startProcess = vi.fn(async () => {});
    const delay = vi.fn(async () => {});
    const terminateOwnedProcess = vi.fn(async () => {});
    const onConnectedToExistingGateway = vi.fn();
    const onConnectedToManagedGateway = vi.fn();
    const findExistingGateway = vi
      .fn<() => Promise<{ port: number } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ port: 28788 });
    const waitForReady = vi.fn(async () => {});
    const connect = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Connect handshake timeout'))
      .mockResolvedValueOnce();

    await runGatewayStartupSequence({
      port: 28788,
      shouldWaitForPortFree: true,
      resetStartupStderrLines: () => {},
      getStartupStderrLines: () => [],
      assertLifecycle: () => {},
      findExistingGateway,
      connect,
      onConnectedToExistingGateway,
      waitForPortFree: waitForPortFree as unknown as (port: number) => Promise<void>,
      startProcess,
      waitForReady,
      onConnectedToManagedGateway,
      runDoctorRepair: async () => false,
      onDoctorRepairSuccess: () => {},
      delay,
      terminateOwnedProcess,
    } as Parameters<typeof runGatewayStartupSequence>[0]);

    expect(startProcess).toHaveBeenCalledTimes(1);
    expect(waitForReady).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect.mock.calls[0]?.[0]).toBe(28788);
    expect(connect.mock.calls[1]?.[0]).toBe(28788);
    expect(onConnectedToExistingGateway).toHaveBeenCalledTimes(1);
    expect(onConnectedToManagedGateway).not.toHaveBeenCalled();
    expect(terminateOwnedProcess).not.toHaveBeenCalled();
    expect(delay).toHaveBeenCalledWith(1000);
    expect(delay).toHaveBeenCalledWith(2000);
  });

  it('falls back to process restart after bounded attach retries fail', async () => {
    const waitForPortFree = vi.fn(async (_port: number, _signal?: AbortSignal) => {});
    const startProcess = vi.fn(async () => {});
    const delay = vi.fn(async () => {});
    const terminateOwnedProcess = vi.fn(async () => {});
    const findExistingGateway = vi
      .fn<() => Promise<{ port: number } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ port: 28788 })
      .mockResolvedValueOnce({ port: 28788 })
      .mockResolvedValueOnce(null);
    const waitForReady = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockResolvedValueOnce();
    const connect = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Connect handshake timeout'))
      .mockRejectedValueOnce(new Error('Connect handshake timeout'))
      .mockRejectedValueOnce(new Error('Connect handshake timeout'))
      .mockResolvedValueOnce();

    await runGatewayStartupSequence({
      port: 28788,
      shouldWaitForPortFree: true,
      resetStartupStderrLines: () => {},
      getStartupStderrLines: () => [],
      assertLifecycle: () => {},
      findExistingGateway,
      connect,
      onConnectedToExistingGateway: () => {},
      waitForPortFree: waitForPortFree as unknown as (port: number) => Promise<void>,
      startProcess,
      waitForReady,
      onConnectedToManagedGateway: () => {},
      runDoctorRepair: async () => false,
      onDoctorRepairSuccess: () => {},
      delay,
      terminateOwnedProcess,
    } as Parameters<typeof runGatewayStartupSequence>[0]);

    expect(delay).toHaveBeenCalledWith(1000);
    expect(delay).toHaveBeenCalledWith(2000);
    expect(delay).toHaveBeenCalledTimes(3);
    expect(connect).toHaveBeenCalledTimes(4);
    expect(startProcess).toHaveBeenCalledTimes(2);
    expect(terminateOwnedProcess).toHaveBeenCalledTimes(1);
  });

  it('terminates the previous owned process and waits for the port again before retrying a transient startup failure', async () => {
    const waitForPortFree = vi.fn(async (_port: number, _signal?: AbortSignal) => {});
    const startProcess = vi.fn(async () => {});
    const connect = vi.fn(async () => {});
    const terminateOwnedProcess = vi.fn(async () => {});
    const delay = vi.fn(async () => {});
    const waitForReady = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Connect handshake timeout'))
      .mockResolvedValueOnce();

    await runGatewayStartupSequence({
      port: 28788,
      shouldWaitForPortFree: true,
      resetStartupStderrLines: () => {},
      getStartupStderrLines: () => [],
      assertLifecycle: () => {},
      findExistingGateway: async () => null,
      connect,
      onConnectedToExistingGateway: () => {},
      waitForPortFree: waitForPortFree as unknown as (port: number) => Promise<void>,
      startProcess,
      waitForReady,
      onConnectedToManagedGateway: () => {},
      runDoctorRepair: async () => false,
      onDoctorRepairSuccess: () => {},
      delay,
      terminateOwnedProcess,
    } as Parameters<typeof runGatewayStartupSequence>[0]);

    expect(delay).toHaveBeenCalledWith(1000);
    expect(terminateOwnedProcess).toHaveBeenCalledTimes(1);
    expect(waitForPortFree).toHaveBeenCalledTimes(3);
    expect(waitForPortFree.mock.calls[0]?.[0]).toBe(28788);
    expect(waitForPortFree.mock.calls[0]?.[1]).toBeUndefined();
    expect(waitForPortFree.mock.calls[1]?.[0]).toBe(28788);
    expect(waitForPortFree.mock.calls[1]?.[1]).toBeInstanceOf(AbortSignal);
    expect(waitForPortFree.mock.calls[2]?.[0]).toBe(28788);
    expect(waitForPortFree.mock.calls[2]?.[1]).toBeUndefined();
    expect(startProcess).toHaveBeenCalledTimes(2);
    expect(waitForReady).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
