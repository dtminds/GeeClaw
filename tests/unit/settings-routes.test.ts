import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const applyProxySettingsMock = vi.fn();
const getAllSettingsMock = vi.fn();
const getSettingMock = vi.fn();
const resetSettingsMock = vi.fn();
const setSettingMock = vi.fn();
const buildOpenClawSafetySettingsMock = vi.fn();
const isSecurityPolicyMock = vi.fn();
const syncOpenClawSafetySettingsMock = vi.fn();
const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/main/proxy', () => ({
  applyProxySettings: (...args: unknown[]) => applyProxySettingsMock(...args),
}));

vi.mock('@electron/utils/store', () => ({
  getAllSettings: (...args: unknown[]) => getAllSettingsMock(...args),
  getSetting: (...args: unknown[]) => getSettingMock(...args),
  resetSettings: (...args: unknown[]) => resetSettingsMock(...args),
  setSetting: (...args: unknown[]) => setSettingMock(...args),
}));

vi.mock('@electron/utils/openclaw-safety-settings', () => ({
  buildOpenClawSafetySettings: (...args: unknown[]) => buildOpenClawSafetySettingsMock(...args),
  isSecurityPolicy: (...args: unknown[]) => isSecurityPolicyMock(...args),
  syncOpenClawSafetySettings: (...args: unknown[]) => syncOpenClawSafetySettingsMock(...args),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleSettingsRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getAllSettingsMock.mockResolvedValue({
      workspaceOnly: true,
      securityPolicy: 'moderate',
    });
    buildOpenClawSafetySettingsMock.mockReturnValue({
      configDir: '/Users/test/.openclaw-geeclaw',
      workspaceOnly: true,
      securityPolicy: 'moderate',
    });
    isSecurityPolicyMock.mockImplementation((value: unknown) => (
      value === 'moderate' || value === 'strict' || value === 'fullAccess'
    ));
  });

  it('debounces a gateway reload after saving safety settings while running', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({ workspaceOnly: true });
    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');

    const debouncedReload = vi.fn();
    const restart = vi.fn();
    const handled = await handleSettingsRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/settings/safety'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload,
          restart,
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(setSettingMock).toHaveBeenCalledWith('workspaceOnly', true);
    expect(syncOpenClawSafetySettingsMock).toHaveBeenCalledWith({
      workspaceOnly: true,
      securityPolicy: 'moderate',
    });
    expect(debouncedReload).toHaveBeenCalledTimes(1);
    expect(restart).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({ success: true }),
    );
  });

  it('persists safety settings without scheduling reload when gateway is stopped', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({ securityPolicy: 'strict' });
    getAllSettingsMock.mockResolvedValue({
      workspaceOnly: true,
      securityPolicy: 'strict',
    });
    buildOpenClawSafetySettingsMock.mockReturnValue({
      configDir: '/Users/test/.openclaw-geeclaw',
      workspaceOnly: true,
      securityPolicy: 'strict',
    });
    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');

    const debouncedReload = vi.fn();
    const restart = vi.fn();
    await handleSettingsRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/settings/safety'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'stopped' }),
          debouncedReload,
          restart,
        },
      } as never,
    );

    expect(setSettingMock).toHaveBeenCalledWith('securityPolicy', 'strict');
    expect(syncOpenClawSafetySettingsMock).toHaveBeenCalledWith({
      workspaceOnly: true,
      securityPolicy: 'strict',
    });
    expect(debouncedReload).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });
});
