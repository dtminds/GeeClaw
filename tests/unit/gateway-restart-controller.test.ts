import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayRestartController } from '@electron/gateway/restart-controller';

describe('GatewayRestartController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops a deferred restart once a restart already completed after the request', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:00:00.000Z'));

    const controller = new GatewayRestartController();
    controller.markDeferredRestart('test', {
      state: 'starting',
      startLock: false,
    });

    vi.setSystemTime(new Date('2026-04-10T00:00:05.000Z'));
    controller.recordRestartCompleted();

    const executeRestart = vi.fn();
    controller.flushDeferredRestart('status:starting->running', {
      state: 'running',
      startLock: false,
      shouldReconnect: true,
    }, executeRestart);

    expect(executeRestart).not.toHaveBeenCalled();
  });
});
