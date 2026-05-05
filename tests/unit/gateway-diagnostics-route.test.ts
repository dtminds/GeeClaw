import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

function createResponse(): ServerResponse & { body?: unknown } {
  const res = {
    setHeader: vi.fn(),
    end: vi.fn((body: string) => {
      res.body = JSON.parse(body);
    }),
  } as unknown as ServerResponse & { body?: unknown };
  return res;
}

describe('gateway diagnostics route', () => {
  it('returns gateway status, diagnostics, and capability snapshot', async () => {
    const { handleGatewayRoutes } = await import('@electron/api/routes/gateway');
    const response = createResponse();
    const status = {
      state: 'running',
      port: 28788,
      gatewayReady: true,
    };
    const diagnostics = {
      consecutiveHeartbeatMisses: 0,
      consecutiveRpcFailures: 0,
      lastRpcSuccessAt: 1760000000000,
    };
    const capabilities = {
      core: {
        process: 'running',
        transport: 'connected',
        rpcRouter: 'ready',
      },
      openclawHealth: { state: 'healthy' },
      openclawStatus: { state: 'healthy' },
      presence: { state: 'unknown' },
      channels: { state: 'degraded', error: 'timeout' },
      memory: { state: 'unknown' },
      diagnostics,
    };

    const handled = await handleGatewayRoutes(
      { method: 'GET' } as IncomingMessage,
      response,
      new URL('http://127.0.0.1:13210/api/gateway/diagnostics'),
      {
        gatewayManager: {
          getStatus: vi.fn(() => status),
          getDiagnostics: vi.fn(() => diagnostics),
          getCapabilitySnapshot: vi.fn(() => capabilities),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      gateway: {
        status,
        diagnostics,
        capabilities,
      },
    });
    expect((response.body as { capturedAt?: string }).capturedAt).toEqual(expect.any(String));
  });
});
