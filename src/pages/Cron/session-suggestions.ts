type SessionCandidate = {
  sessionKey: string;
  label: string;
  channel: string;
  to: string;
  accountId: string;
};

type DeliveryAccount = {
  accountId: string;
  enabled: boolean;
  isDefault: boolean;
};

export function filterCronSessionSuggestions(
  sessions: SessionCandidate[],
  params: {
    deliveryChannel: string;
    deliveryAccountId: string;
    deliveryDefaultAccountId: string;
    query: string;
  },
): SessionCandidate[] {
  if (!params.deliveryChannel || params.deliveryChannel === 'last') {
    return [];
  }

  const keyword = params.query.trim();

  return sessions.filter((session) => {
    if (session.channel !== params.deliveryChannel) {
      return false;
    }
    if (
      params.deliveryAccountId
      && session.accountId !== params.deliveryAccountId
      && !(session.accountId === 'default' && params.deliveryAccountId === params.deliveryDefaultAccountId)
    ) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    return session.to.includes(keyword) || session.label.includes(keyword);
  });
}

export function resolveCronDeliveryAccountId(
  accounts: DeliveryAccount[],
  selectedAccountId: string,
): string {
  if (selectedAccountId && accounts.some((account) => account.enabled && account.accountId === selectedAccountId)) {
    return selectedAccountId;
  }

  return accounts.find((account) => account.enabled && account.isDefault)?.accountId
    || accounts.find((account) => account.enabled)?.accountId
    || '';
}
