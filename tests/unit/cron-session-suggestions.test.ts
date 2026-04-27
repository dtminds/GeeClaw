import { describe, expect, it } from 'vitest';

import { filterCronSessionSuggestions, resolveCronDeliveryAccountId } from '@/pages/Cron/session-suggestions';

describe('cron session suggestions', () => {
  it('filters suggestions by delivery channel, account, and search term', () => {
    const sessions = [
      { sessionKey: '1', label: 'Ops Room', channel: 'openclaw-weixin', to: 'wechat:ops', accountId: 'bot-a' },
      { sessionKey: '2', label: 'Sales Room', channel: 'openclaw-weixin', to: 'wechat:sales', accountId: 'bot-b' },
      { sessionKey: '3', label: 'WeCom Group', channel: 'wecom', to: 'wecom:group', accountId: 'default' },
    ];

    expect(filterCronSessionSuggestions(sessions, {
      deliveryChannel: 'openclaw-weixin',
      deliveryAccountId: 'bot-a',
      deliveryDefaultAccountId: 'bot-a',
      query: 'ops',
    })).toEqual([
      { sessionKey: '1', label: 'Ops Room', channel: 'openclaw-weixin', to: 'wechat:ops', accountId: 'bot-a' },
    ]);
  });

  it('does not show suggestions before a delivery channel is selected', () => {
    const sessions = [
      { sessionKey: '1', label: 'Ops Room', channel: 'openclaw-weixin', to: 'wechat:ops', accountId: 'bot-a' },
      { sessionKey: '2', label: 'WeCom Group', channel: 'wecom', to: 'wecom:group', accountId: 'bot-b' },
    ];

    expect(filterCronSessionSuggestions(sessions, {
      deliveryChannel: '',
      deliveryAccountId: '',
      deliveryDefaultAccountId: '',
      query: '',
    })).toEqual([]);
  });

  it('does not show suggestions for the special last delivery channel', () => {
    const sessions = [
      { sessionKey: '1', label: 'Last Room', channel: 'last', to: 'last-target', accountId: 'default' },
    ];

    expect(filterCronSessionSuggestions(sessions, {
      deliveryChannel: 'last',
      deliveryAccountId: '',
      deliveryDefaultAccountId: '',
      query: '',
    })).toEqual([]);
  });

  it('keeps legacy default-account suggestions only for the selected channel default account', () => {
    const sessions = [
      { sessionKey: '1', label: 'Legacy Room', channel: 'wecom', to: 'wecom:legacy', accountId: 'default' },
      { sessionKey: '2', label: 'Other Bot Room', channel: 'wecom', to: 'wecom:other', accountId: 'bot-b' },
    ];

    expect(filterCronSessionSuggestions(sessions, {
      deliveryChannel: 'wecom',
      deliveryAccountId: 'bot-default',
      deliveryDefaultAccountId: 'bot-default',
      query: '',
    })).toEqual([
      { sessionKey: '1', label: 'Legacy Room', channel: 'wecom', to: 'wecom:legacy', accountId: 'default' },
    ]);

    expect(filterCronSessionSuggestions(sessions, {
      deliveryChannel: 'wecom',
      deliveryAccountId: 'bot-a',
      deliveryDefaultAccountId: 'bot-default',
      query: '',
    })).toEqual([]);
  });

  it('prefers the selected account, otherwise falls back to the default or first enabled account', () => {
    const accounts = [
      { accountId: 'bot-a', enabled: true, isDefault: false },
      { accountId: 'bot-b', enabled: true, isDefault: true },
    ];

    expect(resolveCronDeliveryAccountId(accounts, 'bot-a')).toBe('bot-a');
    expect(resolveCronDeliveryAccountId(accounts, '')).toBe('bot-b');
    expect(resolveCronDeliveryAccountId([
      { accountId: 'bot-a', enabled: true, isDefault: false },
      { accountId: 'bot-b', enabled: true, isDefault: false },
    ], '')).toBe('bot-a');
  });
});
