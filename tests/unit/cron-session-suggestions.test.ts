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
      query: 'ops',
    })).toEqual([
      { sessionKey: '1', label: 'Ops Room', channel: 'openclaw-weixin', to: 'wechat:ops', accountId: 'bot-a' },
    ]);
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
