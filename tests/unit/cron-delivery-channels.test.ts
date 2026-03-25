import { describe, expect, it } from 'vitest';

import { getCronDeliveryChannelOptions } from '@/pages/Cron/delivery-channels';
import type { ChannelGroup } from '@/types/channel';

describe('getCronDeliveryChannelOptions', () => {
  it('keeps enabled weixin visible but disabled in cron delivery options', () => {
    const channels: Pick<ChannelGroup, 'id' | 'type' | 'name' | 'accounts'>[] = [
      {
        id: 'openclaw-weixin',
        type: 'openclaw-weixin',
        name: '微信',
        accounts: [
          {
            id: 'openclaw-weixin:wx-bot',
            channelType: 'openclaw-weixin',
            accountId: 'wx-bot',
            name: 'wx-bot',
            status: 'connected',
            enabled: true,
            configured: true,
            isDefault: true,
          },
        ],
      },
      {
        id: 'wecom',
        type: 'wecom',
        name: '企业微信',
        accounts: [
          {
            id: 'wecom:default',
            channelType: 'wecom',
            accountId: 'default',
            name: 'default',
            status: 'connected',
            enabled: true,
            configured: true,
            isDefault: true,
          },
        ],
      },
    ];

    expect(getCronDeliveryChannelOptions(channels)).toEqual([
      {
        id: 'openclaw-weixin',
        type: 'openclaw-weixin',
        name: '微信',
        disabled: true,
      },
      {
        id: 'wecom',
        type: 'wecom',
        name: '企业微信',
        disabled: false,
      },
    ]);
  });

  it('hides channels that do not have any enabled accounts', () => {
    const channels: Pick<ChannelGroup, 'id' | 'type' | 'name' | 'accounts'>[] = [
      {
        id: 'openclaw-weixin',
        type: 'openclaw-weixin',
        name: '微信',
        accounts: [
          {
            id: 'openclaw-weixin:wx-bot',
            channelType: 'openclaw-weixin',
            accountId: 'wx-bot',
            name: 'wx-bot',
            status: 'disconnected',
            enabled: false,
            configured: true,
            isDefault: true,
          },
        ],
      },
    ];

    expect(getCronDeliveryChannelOptions(channels)).toEqual([]);
  });
});
