/**
 * Channels State Store
 * Manages channel groups and account-level state.
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import {
  hasChannelRuntimeError,
  hasRecentChannelActivity,
  hasSuccessfulChannelProbe,
  hasSummaryRuntimeError,
  type ChannelRuntimeSummarySnapshot,
} from '@/lib/channel-status';
import { useGatewayStore } from './gateway';
import type { ChannelAccount, ChannelGroup, ChannelStatus, ChannelType } from '../types/channel';

interface GatewayChannelAccount {
  accountId?: string;
  configured?: boolean;
  connected?: boolean;
  running?: boolean;
  lastError?: string;
  name?: string;
  linked?: boolean;
  lastConnectedAt?: number | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  lastProbeAt?: number | null;
  probe?: {
    ok?: boolean | null;
  } | null;
}

interface ConfiguredAccountSummary {
  accountId: string;
  enabled: boolean;
  isDefault: boolean;
}

interface ConfiguredChannelSummary {
  defaultAccount: string;
  accounts: ConfiguredAccountSummary[];
}

interface ConfiguredAccountsResponse {
  success: boolean;
  channels?: Record<string, ConfiguredChannelSummary>;
}

interface ChannelsState {
  channels: ChannelGroup[];
  loading: boolean;
  error: string | null;
  fetchChannels: () => Promise<void>;
  deleteChannel: (channelType: string) => Promise<void>;
  deleteChannelAccount: (channelType: string, accountId: string) => Promise<void>;
  setDefaultAccount: (channelType: string, accountId: string) => Promise<void>;
  updateChannel: (channelId: string, updates: Partial<ChannelGroup>) => void;
  clearError: () => void;
}

function getAccountStatus(
  account?: GatewayChannelAccount,
  groupSummary?: Record<string, unknown>,
): ChannelStatus {
  const summarySignal: ChannelRuntimeSummarySnapshot | undefined = groupSummary
    ? {
        error: typeof groupSummary.error === 'string' ? groupSummary.error : null,
        lastError: typeof groupSummary.lastError === 'string' ? groupSummary.lastError : null,
      }
    : undefined;
  const groupError = hasSummaryRuntimeError(summarySignal);
  const groupConnected =
    groupSummary?.connected === true ||
    groupSummary?.linked === true ||
    groupSummary?.running === true;

  if (!account) {
    if (groupConnected && !groupError) {
      return 'connected';
    }
    return groupError ? 'error' : 'disconnected';
  }

  const hasDirectConnectionSignal =
    account.connected === true ||
    account.linked === true ||
    hasRecentChannelActivity(account) ||
    hasSuccessfulChannelProbe(account);

  if (hasDirectConnectionSignal) {
    return 'connected';
  }

  if (hasChannelRuntimeError(account)) {
    return 'error';
  }

  if (account.running) {
    return groupError ? 'error' : 'connected';
  }

  if (groupConnected) {
    return groupError ? 'error' : 'connected';
  }

  return groupError ? 'error' : 'disconnected';
}

function summarizeGroupStatus(accounts: ChannelAccount[]): ChannelStatus {
  if (accounts.some((account) => account.status === 'connected')) {
    return 'connected';
  }
  if (accounts.some((account) => account.status === 'connecting')) {
    return 'connecting';
  }
  if (accounts.some((account) => account.status === 'error')) {
    return 'error';
  }
  return 'disconnected';
}

function resolveRuntimeAccountId(
  account: GatewayChannelAccount,
  defaultAccountId: string,
  configuredAccountIds: Set<string>,
): string {
  const rawAccountId = typeof account.accountId === 'string' && account.accountId.trim()
    ? account.accountId.trim()
    : defaultAccountId;

  if (
    rawAccountId === 'default'
    && defaultAccountId !== 'default'
    && !configuredAccountIds.has('default')
  ) {
    return defaultAccountId;
  }

  return rawAccountId;
}

export const useChannelsStore = create<ChannelsState>((set) => ({
  channels: [],
  loading: false,
  error: null,

  fetchChannels: async () => {
    set({ loading: true, error: null });

    try {
      const [runtimeData, configData] = await Promise.all([
        useGatewayStore.getState().rpc<{
          channelOrder?: string[];
          channels?: Record<string, unknown>;
          channelAccounts?: Record<string, GatewayChannelAccount[]>;
          channelDefaultAccountId?: Record<string, string>;
        }>('channels.status', { probe: true }).catch(() => null),
        hostApiFetch<ConfiguredAccountsResponse>('/api/channels/configured-accounts')
          .catch((): ConfiguredAccountsResponse => ({ success: false })),
      ]);

      const runtimeChannels = runtimeData?.channels || {};
      const runtimeAccounts = runtimeData?.channelAccounts || {};
      const configuredChannels = configData.channels || {};
      const channelOrder = runtimeData?.channelOrder || [];

      const allChannelTypes = [...new Set([
        ...channelOrder,
        ...Object.keys(runtimeChannels),
        ...Object.keys(runtimeAccounts),
        ...Object.keys(configuredChannels),
      ])];

      const channels = allChannelTypes.map((channelType) => {
        const summary = runtimeChannels[channelType] as Record<string, unknown> | undefined;
        const groupError =
          typeof summary?.error === 'string'
            ? summary.error
            : typeof summary?.lastError === 'string'
              ? summary.lastError
              : undefined;
        const runtimeEntries = runtimeAccounts[channelType] || [];
        const configSummary = configuredChannels[channelType];
        const defaultAccountId = configSummary?.defaultAccount || runtimeData?.channelDefaultAccountId?.[channelType] || 'default';
        const configuredAccountIds = new Set(
          (configSummary?.accounts || []).map((entry: ConfiguredAccountSummary) => entry.accountId),
        );
        const runtimeEntriesByAccountId = runtimeEntries.reduce((map, entry) => {
          const accountId = resolveRuntimeAccountId(entry, defaultAccountId, configuredAccountIds);
          const previous = map.get(accountId);
          map.set(accountId, previous ? { ...previous, ...entry } : entry);
          return map;
        }, new Map<string, GatewayChannelAccount>());
        const accountIds = [...new Set([
          ...runtimeEntriesByAccountId.keys(),
          ...configuredAccountIds,
        ])].sort((left, right) => {
          if (left === defaultAccountId) return -1;
          if (right === defaultAccountId) return 1;
          return left.localeCompare(right);
        });

        const accounts: ChannelAccount[] = accountIds.map((accountId) => {
          const runtimeEntry = runtimeEntriesByAccountId.get(accountId);
          const configuredEntry = configSummary?.accounts.find(
            (entry: ConfiguredAccountSummary) => entry.accountId === accountId,
          );
          return {
            id: `${channelType}:${accountId}`,
            channelType: channelType as ChannelType,
            accountId,
            name: runtimeEntry?.name || accountId,
            status: getAccountStatus(runtimeEntry, summary),
            enabled: configuredEntry?.enabled ?? true,
            configured: configuredEntry !== undefined || runtimeEntry?.configured === true,
            isDefault: accountId === defaultAccountId,
            error:
              (typeof runtimeEntry?.lastError === 'string' ? runtimeEntry.lastError : undefined) ||
              (accountId === defaultAccountId ? groupError : undefined),
          };
        }).filter(acc => acc.configured);

        return {
          id: channelType,
          type: channelType as ChannelType,
          name: channelType,
          status: summarizeGroupStatus(accounts),
          configured: accounts.length > 0,
          defaultAccountId,
          accounts,
          error: groupError,
        } satisfies ChannelGroup;
      }).filter((channel) => channel.accounts.length > 0);

      set({ channels, loading: false });
    } catch (error) {
      set({ channels: [], loading: false, error: String(error) });
    }
  },

  deleteChannel: async (channelType) => {
    await hostApiFetch(`/api/channels/config/${encodeURIComponent(channelType)}`, {
      method: 'DELETE',
    });
    set((state) => ({
      channels: state.channels.filter((channel) => channel.type !== channelType),
    }));
  },

  deleteChannelAccount: async (channelType, accountId) => {
    await hostApiFetch(
      `/api/channels/config/${encodeURIComponent(channelType)}/accounts/${encodeURIComponent(accountId)}`,
      { method: 'DELETE' },
    );
    set((state) => ({
      channels: state.channels
        .map((channel) => (
          channel.type !== channelType
            ? channel
            : {
                ...channel,
                accounts: channel.accounts.filter((account) => account.accountId !== accountId),
              }
        ))
        .filter((channel) => channel.accounts.length > 0),
    }));
  },

  setDefaultAccount: async (channelType, accountId) => {
    await hostApiFetch(`/api/channels/config/${encodeURIComponent(channelType)}/default-account`, {
      method: 'PUT',
      body: JSON.stringify({ accountId }),
    });
    set((state) => ({
      channels: state.channels.map((channel) => (
        channel.type !== channelType
          ? channel
          : {
              ...channel,
              defaultAccountId: accountId,
              accounts: channel.accounts
                .map((account) => ({ ...account, isDefault: account.accountId === accountId }))
                .sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.accountId.localeCompare(right.accountId)),
            }
      )),
    }));
  },

  updateChannel: (channelId, updates) => {
    set((state) => ({
      channels: state.channels.map((channel) => (
        channel.id === channelId ? { ...channel, ...updates } : channel
      )),
    }));
  },

  clearError: () => set({ error: null }),
}));
