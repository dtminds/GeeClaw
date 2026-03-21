import { describe, expect, it, vi } from 'vitest';
import { refreshGatewayAfterConfigChange } from '@electron/utils/gateway-refresh';

describe('refreshGatewayAfterConfigChange', () => {
  it('starts the gateway when config changes while it is stopped', async () => {
    const gatewayManager = {
      getStatus: () => ({ state: 'stopped' }),
      debouncedRestart: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
    };

    refreshGatewayAfterConfigChange(gatewayManager, 'channel:saveConfig (wecom)');
    await Promise.resolve();

    expect(gatewayManager.start).toHaveBeenCalledTimes(1);
    expect(gatewayManager.debouncedRestart).not.toHaveBeenCalled();
  });

  it('keeps using debounced restart while the gateway is already running', () => {
    const gatewayManager = {
      getStatus: () => ({ state: 'running' }),
      debouncedRestart: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
    };

    refreshGatewayAfterConfigChange(gatewayManager, 'channel:saveConfig (wecom)');

    expect(gatewayManager.debouncedRestart).toHaveBeenCalledTimes(1);
    expect(gatewayManager.start).not.toHaveBeenCalled();
  });
});
