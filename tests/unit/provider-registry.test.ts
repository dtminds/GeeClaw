import { describe, expect, it } from 'vitest';

import { getProviderUiInfoList } from '../../shared/providers/registry';

describe('provider registry multiple-account policy', () => {
  it('only allows multiple accounts for custom and ollama providers', () => {
    const multiAccountProviderIds = getProviderUiInfoList()
      .filter((provider) => provider.supportsMultipleAccounts)
      .map((provider) => provider.id)
      .sort();

    expect(multiAccountProviderIds).toEqual(['custom', 'ollama']);
  });
});
