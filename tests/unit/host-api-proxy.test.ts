import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handleMock = vi.fn();
const proxyAwareFetchMock = vi.fn();
const getHostApiBaseMock = vi.fn(() => 'http://127.0.0.1:14001');
const getHostApiTokenMock = vi.fn(() => 'test-token');

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => handleMock(...args),
  },
}));

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: (...args: unknown[]) => proxyAwareFetchMock(...args),
}));

vi.mock('@electron/api/server', () => ({
  getHostApiBase: () => getHostApiBaseMock(),
  getHostApiToken: () => getHostApiTokenMock(),
}));

describe('host api proxy handlers', () => {
  const originalEnv = process.env.GEECLAW_PORT_GEECLAW_HOST_API;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.GEECLAW_PORT_GEECLAW_HOST_API = '14001';
    proxyAwareFetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({ ok: true }),
      text: async () => '',
    });
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GEECLAW_PORT_GEECLAW_HOST_API;
    } else {
      process.env.GEECLAW_PORT_GEECLAW_HOST_API = originalEnv;
    }
  });

  it('uses the configured host api port when proxying renderer requests', async () => {
    const { registerHostApiProxyHandlers } = await import('@electron/main/ipc/host-api-proxy');
    registerHostApiProxyHandlers();

    const hostApiFetchHandler = handleMock.mock.calls.find(([channel]) => channel === 'hostapi:fetch')?.[1] as
      | ((_: unknown, request: { path: string; method?: string; headers?: Record<string, string> }) => Promise<unknown>)
      | undefined;

    expect(hostApiFetchHandler).toBeTypeOf('function');

    await hostApiFetchHandler?.(null, { path: '/api/settings' });

    expect(proxyAwareFetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:14001/api/settings',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  it('exposes the active host api base over IPC', async () => {
    const { registerHostApiProxyHandlers } = await import('@electron/main/ipc/host-api-proxy');
    registerHostApiProxyHandlers();

    const hostApiBaseHandler = handleMock.mock.calls.find(([channel]) => channel === 'hostapi:base')?.[1] as
      | (() => string)
      | undefined;

    expect(hostApiBaseHandler).toBeTypeOf('function');
    expect(hostApiBaseHandler?.()).toBe('http://127.0.0.1:14001');
  });
});
