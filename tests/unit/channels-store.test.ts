import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

import { hostApiFetch } from '@/lib/host-api';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';

describe('Channels Store', () => {
  beforeEach(() => {
    useChannelsStore.setState({
      channels: [],
      loading: false,
      error: null,
    });
    vi.mocked(hostApiFetch).mockReset();
  });

  it('maps runtime accounts without an accountId onto the configured default account', async () => {
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      channels: {
        wecom: {
          defaultAccount: 'xyclaw',
          accounts: [
            {
              accountId: 'xyclaw',
              enabled: true,
              isDefault: true,
            },
          ],
        },
      },
    });

    useGatewayStore.setState({
      rpc: vi.fn().mockResolvedValue({
        channels: {
          wecom: {
            connected: true,
          },
        },
        channelAccounts: {
          wecom: [
            {
              configured: true,
              connected: true,
            },
          ],
        },
        channelDefaultAccountId: {
          wecom: 'xyclaw',
        },
      }),
    } as Partial<ReturnType<typeof useGatewayStore.getState>>);

    await useChannelsStore.getState().fetchChannels();

    expect(useChannelsStore.getState().channels).toHaveLength(1);
    expect(useChannelsStore.getState().channels[0]?.accounts).toEqual([
      expect.objectContaining({
        accountId: 'xyclaw',
        isDefault: true,
        status: 'connected',
      }),
    ]);
  });

  it('maps runtime default alias onto the configured default account when no real default account exists', async () => {
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      channels: {
        wecom: {
          defaultAccount: 'xyclaw',
          accounts: [
            {
              accountId: 'xyclaw',
              enabled: true,
              isDefault: true,
            },
          ],
        },
      },
    });

    useGatewayStore.setState({
      rpc: vi.fn().mockResolvedValue({
        channels: {
          wecom: {
            connected: true,
          },
        },
        channelAccounts: {
          wecom: [
            {
              accountId: 'default',
              configured: true,
              connected: true,
            },
          ],
        },
        channelDefaultAccountId: {
          wecom: 'xyclaw',
        },
      }),
    } as Partial<ReturnType<typeof useGatewayStore.getState>>);

    await useChannelsStore.getState().fetchChannels();

    expect(useChannelsStore.getState().channels).toHaveLength(1);
    expect(useChannelsStore.getState().channels[0]?.accounts).toEqual([
      expect.objectContaining({
        accountId: 'xyclaw',
        isDefault: true,
        status: 'connected',
      }),
    ]);
  });
});
