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
const getManagedAppEnvironmentEntriesMock = vi.fn();
const replaceManagedAppEnvironmentEntriesMock = vi.fn();
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

vi.mock('@electron/utils/app-env', () => ({
  getManagedAppEnvironmentEntries: (...args: unknown[]) => getManagedAppEnvironmentEntriesMock(...args),
  replaceManagedAppEnvironmentEntries: (...args: unknown[]) => replaceManagedAppEnvironmentEntriesMock(...args),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleSettingsRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getAllSettingsMock.mockResolvedValue({
      workspaceOnly: false,
      securityPolicy: 'moderate',
    });
    buildOpenClawSafetySettingsMock.mockReturnValue({
      configDir: '/Users/test/.openclaw-geeclaw',
      workspaceOnly: false,
      securityPolicy: 'moderate',
    });
    isSecurityPolicyMock.mockImplementation((value: unknown) => (
      value === 'moderate' || value === 'strict' || value === 'fullAccess'
    ));
    getManagedAppEnvironmentEntriesMock.mockResolvedValue([]);
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
    expect(setSettingMock).toHaveBeenCalledWith('workspaceOnly', false);
    expect(syncOpenClawSafetySettingsMock).toHaveBeenCalledWith({
      workspaceOnly: false,
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
      workspaceOnly: false,
      securityPolicy: 'strict',
    });
    buildOpenClawSafetySettingsMock.mockReturnValue({
      configDir: '/Users/test/.openclaw-geeclaw',
      workspaceOnly: false,
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
      workspaceOnly: false,
      securityPolicy: 'strict',
    });
    expect(debouncedReload).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it('reads and replaces managed app environment entries, restarting the gateway when running', async () => {
    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');
    getManagedAppEnvironmentEntriesMock.mockResolvedValueOnce([
      { key: 'NOTION_API_KEY', value: 'secret-notion' },
    ]);

    const res = {} as ServerResponse;
    await handleSettingsRoutes(
      { method: 'GET' } as IncomingMessage,
      res,
      new URL('http://127.0.0.1:3210/api/settings/environment'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'stopped' }),
          debouncedReload: vi.fn(),
          restart: vi.fn(),
        },
      } as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(res, 200, {
      entries: [{ key: 'NOTION_API_KEY', value: 'secret-notion' }],
    });

    parseJsonBodyMock.mockResolvedValueOnce({
      entries: [
        { key: 'NOTION_API_KEY', value: 'secret-notion' },
        { key: 'TAVILY_API_KEY', value: 'secret-tavily' },
      ],
    });

    const restart = vi.fn();
    await handleSettingsRoutes(
      { method: 'PUT' } as IncomingMessage,
      res,
      new URL('http://127.0.0.1:3210/api/settings/environment'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          restart,
        },
      } as never,
    );

    expect(replaceManagedAppEnvironmentEntriesMock).toHaveBeenCalledWith([
      { key: 'NOTION_API_KEY', value: 'secret-notion' },
      { key: 'TAVILY_API_KEY', value: 'secret-tavily' },
    ]);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenLastCalledWith(
      res,
      200,
      expect.objectContaining({ success: true }),
    );
  });
});
