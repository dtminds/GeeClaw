import { hostApiFetch } from '@/lib/host-api';
import type {
  ProviderAccount,
  ProviderType,
  ProviderVendorInfo,
  ProviderWithKeyInfo,
} from '@/lib/providers';
import { getConfiguredProviderModels } from '@/lib/providers';
import { getStoredCustomProviderRuntimeKey } from '../../shared/providers/runtime-provider-key';

export interface ProviderSnapshot {
  accounts: ProviderAccount[];
  statuses: ProviderWithKeyInfo[];
  vendors: ProviderVendorInfo[];
  defaultAccountId: string | null;
}

export interface ProviderListItem {
  account: ProviderAccount;
  vendor?: ProviderVendorInfo;
  status?: ProviderWithKeyInfo;
  runtimeProviderId: string;
}

const BROWSER_OAUTH_RUNTIME_PROVIDER_IDS: Partial<Record<ProviderType, string>> = {
  google: 'google-gemini-cli',
  openai: 'openai-codex',
};

const MULTI_INSTANCE_PROVIDER_TYPES = new Set<ProviderType>(['custom', 'ollama']);

function getMetadataRuntimeProviderId(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? null : trimmed;
}

function getMultiInstanceRuntimeProviderId(vendorId: ProviderType, accountId: string): string {
  const prefix = `${vendorId}-`;
  if (accountId.startsWith(prefix) && !accountId.slice(prefix.length).includes('-')) {
    return accountId;
  }

  const suffix = accountId.replace(/-/g, '').slice(0, 8);
  return `${vendorId}-${suffix}`;
}

export async function fetchProviderSnapshot(): Promise<ProviderSnapshot> {
  const [accounts, statuses, vendors, defaultInfo] = await Promise.all([
    hostApiFetch<ProviderAccount[]>('/api/provider-accounts'),
    hostApiFetch<ProviderWithKeyInfo[]>('/api/providers'),
    hostApiFetch<ProviderVendorInfo[]>('/api/provider-vendors'),
    hostApiFetch<{ accountId: string | null }>('/api/provider-accounts/default'),
  ]);

  return {
    accounts,
    statuses,
    vendors,
    defaultAccountId: defaultInfo.accountId,
  };
}

export function hasConfiguredCredentials(
  account: ProviderAccount,
  status?: ProviderWithKeyInfo,
): boolean {
  if (account.authMode === 'oauth_device' || account.authMode === 'oauth_browser' || account.authMode === 'local') {
    return true;
  }
  return status?.hasKey ?? false;
}

export function getProviderAccountRuntimeKey(
  account: Pick<ProviderAccount, 'id' | 'vendorId' | 'authMode' | 'metadata'>,
): string {
  const metadataRuntimeProviderId = account.authMode === 'oauth_browser'
    ? getMetadataRuntimeProviderId(account.metadata?.resourceUrl)
    : null;

  if (metadataRuntimeProviderId) {
    return metadataRuntimeProviderId;
  }

  if (account.authMode === 'oauth_browser') {
    const browserOAuthProviderId = BROWSER_OAUTH_RUNTIME_PROVIDER_IDS[account.vendorId];
    if (browserOAuthProviderId) {
      return browserOAuthProviderId;
    }
  }

  if (account.vendorId === 'custom') {
    const explicitRuntimeProviderId = getStoredCustomProviderRuntimeKey(account.metadata);
    if (explicitRuntimeProviderId) {
      return explicitRuntimeProviderId;
    }
  }

  if (MULTI_INSTANCE_PROVIDER_TYPES.has(account.vendorId)) {
    return getMultiInstanceRuntimeProviderId(account.vendorId, account.id);
  }

  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }

  return account.vendorId;
}

export function pickPreferredAccount(
  accounts: ProviderAccount[],
  defaultAccountId: string | null,
  vendorId: ProviderType | string,
  statusMap: Map<string, ProviderWithKeyInfo>,
): ProviderAccount | null {
  const sameVendor = accounts.filter((account) => account.vendorId === vendorId);
  if (sameVendor.length === 0) return null;

  return (
    (defaultAccountId ? sameVendor.find((account) => account.id === defaultAccountId) : undefined)
    || sameVendor.find((account) => hasConfiguredCredentials(account, statusMap.get(account.id)))
    || sameVendor[0]
  );
}

export function buildProviderAccountId(
  vendorId: ProviderType,
  existingAccountId: string | null,
  vendors: ProviderVendorInfo[],
): string {
  if (existingAccountId) {
    return existingAccountId;
  }

  const vendor = vendors.find((candidate) => candidate.id === vendorId);
  return vendor?.supportsMultipleAccounts ? `${vendorId}-${crypto.randomUUID()}` : vendorId;
}

export function legacyProviderToAccount(provider: ProviderWithKeyInfo): ProviderAccount {
  return {
    id: provider.id,
    vendorId: provider.type,
    label: provider.name,
    authMode: provider.type === 'ollama' ? 'local' : 'api_key',
    baseUrl: provider.baseUrl,
    models: getConfiguredProviderModels(provider),
    model: provider.model,
    fallbackModels: provider.fallbackModels,
    fallbackAccountIds: provider.fallbackProviderIds,
    enabled: provider.enabled,
    isDefault: false,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

export function buildProviderListItems(
  accounts: ProviderAccount[],
  statuses: ProviderWithKeyInfo[],
  vendors: ProviderVendorInfo[],
  defaultAccountId: string | null,
): ProviderListItem[] {
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const statusMap = new Map(statuses.map((status) => [status.id, status]));

  if (accounts.length > 0) {
    return accounts
      .map((account) => ({
        account,
        vendor: vendorMap.get(account.vendorId),
        status: statusMap.get(account.id),
        runtimeProviderId: getProviderAccountRuntimeKey(account),
      }))
      .sort((left, right) => {
        if (left.account.id === defaultAccountId) return -1;
        if (right.account.id === defaultAccountId) return 1;
        return right.account.updatedAt.localeCompare(left.account.updatedAt);
      });
  }

  return statuses.map((status) => {
    const account = legacyProviderToAccount(status);
    return {
      account,
      vendor: vendorMap.get(status.type),
      status,
      runtimeProviderId: getProviderAccountRuntimeKey(account),
    };
  });
}
