import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutateOpenClawConfigDocumentMock = vi.fn(async (
  mutator: (
    config: Record<string, unknown>,
  ) => Promise<{ changed: boolean; result: unknown }> | { changed: boolean; result: unknown },
) => {
  const config = {
    gateway: {
      auth: {
        mode: 'token',
        token: 'gateway-token',
      },
      controlUi: {
        allowedOrigins: ['file://'],
      },
      mode: 'local',
      port: 28788,
    },
  } satisfies Record<string, unknown>;

  const outcome = await mutator(config);
  return outcome.result;
});

vi.mock('@electron/utils/openclaw-config-coordinator', () => ({
  mutateOpenClawConfigDocument: mutateOpenClawConfigDocumentMock,
}));

describe('syncGatewayTokenToConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('does not log a config sync when managed gateway config is already present', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { syncGatewayTokenToConfig } = await import('@electron/utils/openclaw-gateway-config');

    await syncGatewayTokenToConfig('gateway-token', 28788);

    expect(mutateOpenClawConfigDocumentMock).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
