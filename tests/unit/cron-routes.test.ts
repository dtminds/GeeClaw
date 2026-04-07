import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleCronRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('creates cron jobs with normalized delivery account and channel alias', async () => {
    parseJsonBodyMock.mockResolvedValue({
      name: 'Weixin delivery',
      message: 'Send update',
      schedule: '0 9 * * *',
      enabled: true,
      delivery: {
        mode: 'announce',
        channel: 'wechat',
        to: 'wechat:wxid_target',
        accountId: 'wx-bot',
      },
    });

    const rpc = vi.fn().mockResolvedValue({
      id: 'job-1',
      name: 'Weixin delivery',
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 2,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      payload: { kind: 'agentTurn', message: 'Send update' },
      delivery: { mode: 'announce', channel: 'openclaw-weixin', to: 'wechat:wxid_target', accountId: 'wx-bot' },
      state: {},
    });

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    const handled = await handleCronRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/cron/jobs'),
      { gatewayManager: { rpc } } as never,
    );

    expect(handled).toBe(true);
    expect(rpc).toHaveBeenCalledWith('cron.add', expect.objectContaining({
      delivery: {
        mode: 'announce',
        channel: 'openclaw-weixin',
        to: 'wechat:wxid_target',
        accountId: 'wx-bot',
      },
    }));
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        id: 'job-1',
        delivery: {
          mode: 'announce',
          channel: 'openclaw-weixin',
          to: 'wechat:wxid_target',
          accountId: 'wx-bot',
        },
      }),
    );
  });

  it('updates cron jobs with normalized delivery patch fields', async () => {
    parseJsonBodyMock.mockResolvedValue({
      message: 'Updated prompt',
      delivery: {
        mode: 'announce',
        channel: 'wechat',
        to: 'wechat:wxid_next',
        accountId: 'wx-bot',
      },
    });

    const rpc = vi.fn().mockResolvedValue({
      id: 'job-2',
      name: 'Updated job',
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 3,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      payload: { kind: 'agentTurn', message: 'Updated prompt' },
      delivery: { mode: 'announce', channel: 'openclaw-weixin', to: 'wechat:wxid_next', accountId: 'wx-bot' },
      state: {},
    });

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    await handleCronRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/cron/jobs/job-2'),
      { gatewayManager: { rpc } } as never,
    );

    expect(rpc).toHaveBeenCalledWith('cron.update', {
      id: 'job-2',
      patch: {
        payload: { kind: 'agentTurn', message: 'Updated prompt' },
        delivery: {
          mode: 'announce',
          channel: 'openclaw-weixin',
          to: 'wechat:wxid_next',
          accountId: 'wx-bot',
        },
      },
    });
  });
});
