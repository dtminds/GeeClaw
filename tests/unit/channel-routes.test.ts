import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();
const saveChannelConfigMock = vi.fn();
const setDefaultChannelAccountMock = vi.fn();
const assignChannelAccountToAgentMock = vi.fn();
const clearChannelBindingMock = vi.fn();

vi.mock('@electron/utils/channel-config', () => ({
  cleanupDanglingManagedChannelPluginState: vi.fn(),
  deleteChannelConfig: vi.fn(),
  deleteChannelAccountConfig: vi.fn(),
  getChannelFormValues: vi.fn(),
  listConfiguredChannelAccounts: vi.fn(async () => ({})),
  listConfiguredChannels: vi.fn(async () => []),
  saveChannelConfig: (...args: unknown[]) => saveChannelConfigMock(...args),
  setDefaultChannelAccount: (...args: unknown[]) => setDefaultChannelAccountMock(...args),
  setChannelEnabled: vi.fn(),
  validateChannelConfig: vi.fn(async () => ({ valid: true, errors: [], warnings: [] })),
  validateChannelCredentials: vi.fn(async () => ({ valid: true, errors: [], warnings: [] })),
}));

vi.mock('@electron/utils/agent-config', () => ({
  assignChannelAccountToAgent: (...args: unknown[]) => assignChannelAccountToAgentMock(...args),
  clearAllBindingsForChannel: vi.fn(),
  clearChannelBinding: (...args: unknown[]) => clearChannelBindingMock(...args),
}));

vi.mock('@electron/utils/gateway-refresh', () => ({
  refreshGatewayAfterConfigChange: vi.fn(),
}));

vi.mock('@electron/utils/whatsapp-login', () => ({
  whatsAppLoginManager: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('@electron/utils/wecom-login', () => ({
  weComLoginManager: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('@electron/utils/weixin-login', () => ({
  weixinLoginManager: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('@electron/utils/plugin-install', () => ({
  ensureManagedChannelPluginInstalled: vi.fn(() => ({ installed: true })),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('channel API routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    parseJsonBodyMock.mockResolvedValue({});
  });

  it('rejects non-canonical account IDs when saving channel config', async () => {
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'feishu',
      accountId: 'Ops Bot',
      config: {
        appId: 'cli_test',
        appSecret: 'secret_test',
      },
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');

    const handled = await handleChannelRoutes(
      { method: 'POST' } as never,
      {} as never,
      new URL('http://127.0.0.1/api/channels/config'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('Invalid accountId format'),
      }),
    );
    expect(saveChannelConfigMock).not.toHaveBeenCalled();
  });

  it('rejects non-canonical account IDs on default-account and agent binding routes', async () => {
    const { handleChannelRoutes } = await import('@electron/api/routes/channels');

    parseJsonBodyMock.mockResolvedValue({ accountId: 'OpsBot' });
    await handleChannelRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://127.0.0.1/api/channels/config/feishu/default-account'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
        },
      } as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('Invalid accountId format'),
      }),
    );
    expect(setDefaultChannelAccountMock).not.toHaveBeenCalled();

    parseJsonBodyMock.mockResolvedValue({ agentId: 'main' });
    await handleChannelRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://127.0.0.1/api/channels/config/feishu/accounts/OpsBot/agent'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
        },
      } as never,
    );

    expect(assignChannelAccountToAgentMock).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenLastCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('Invalid accountId format'),
      }),
    );
  });
});
