import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, CircleHelp, Pencil, Plus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChannelConfigModal } from '@/components/channels/ChannelConfigModal';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { useChannelsStore } from '@/stores/channels';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import {
  CHANNEL_ICONS,
  CHANNEL_META,
  CHANNEL_NAMES,
  getPrimaryChannels,
  type ChannelAccount,
  type ChannelGroup,
  type ChannelType,
} from '@/types/channel';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

interface ModalState {
  type: ChannelType;
  accountId?: string;
}

interface DeleteState {
  type: ChannelType;
  accountId?: string;
}

export function Channels() {
  const { t } = useTranslation('channels');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const {
    channels,
    loading,
    error,
    fetchChannels,
    deleteChannel,
    deleteChannelAccount,
    setDefaultAccount,
  } = useChannelsStore();
  const {
    agents,
    explicitChannelAccountBindings,
    fetchAgents,
  } = useAgentsStore();

  const [modalState, setModalState] = useState<ModalState | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [deleteWholeChannel, setDeleteWholeChannel] = useState<ChannelType | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([fetchChannels(), fetchAgents()]);
  }, [fetchAgents, fetchChannels]);

  useEffect(() => {
    const unsubscribe = subscribeHostEvent('gateway:channel-status', () => {
      void Promise.all([fetchChannels(), fetchAgents()]);
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchAgents, fetchChannels]);

  const configuredTypes = useMemo(
    () => new Set(channels.map((channel) => channel.type)),
    [channels],
  );

  const supportedTypes = useMemo(
    () => getPrimaryChannels().filter((type) => !configuredTypes.has(type)),
    [configuredTypes],
  );

  const agentOptions = useMemo(
    () => [...agents].sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name)),
    [agents],
  );

  const refreshAll = async () => {
    await Promise.all([fetchChannels(), fetchAgents()]);
  };

  const handleBindAgent = async (channelType: ChannelType, accountId: string, agentId: string) => {
    const busyId = `${channelType}:${accountId}:bind`;
    setBusyKey(busyId);
    try {
      await hostApiFetch(`/api/channels/config/${encodeURIComponent(channelType)}/accounts/${encodeURIComponent(accountId)}/agent`, {
        method: 'PUT',
        body: JSON.stringify({ agentId: agentId || null }),
      });
      await fetchAgents();
      toast.success(
        agentId
          ? t('toast.accountBound', { defaultValue: 'Account bound to agent' })
          : t('toast.accountUnbound', { defaultValue: 'Account unbound' }),
      );
    } catch (bindError) {
      toast.error(t('toast.configFailed', { error: String(bindError) }));
    } finally {
      setBusyKey(null);
    }
  };

  const handleSetDefault = async (channelType: ChannelType, accountId: string) => {
    const busyId = `${channelType}:${accountId}:default`;
    setBusyKey(busyId);
    try {
      await setDefaultAccount(channelType, accountId);
      await fetchAgents();
      toast.success(t('toast.defaultUpdated', { defaultValue: 'Default account updated' }));
    } catch (setDefaultError) {
      toast.error(t('toast.configFailed', { error: String(setDefaultError) }));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteState?.accountId) return;

    const { type, accountId } = deleteState;
    const busyId = `${type}:${accountId}:delete`;
    setBusyKey(busyId);
    try {
      await deleteChannelAccount(type, accountId);
      await fetchAgents();
      toast.success(t('toast.accountDeleted', { defaultValue: 'Account deleted' }));
    } catch (deleteError) {
      toast.error(t('toast.configFailed', { error: String(deleteError) }));
    } finally {
      setBusyKey(null);
      setDeleteState(null);
    }
  };

  const handleDeleteChannel = async () => {
    if (!deleteWholeChannel) return;

    const channelType = deleteWholeChannel;
    setBusyKey(`${channelType}:delete-all`);
    try {
      await deleteChannel(channelType);
      await fetchAgents();
      toast.success(t('toast.channelDeleted', { defaultValue: 'Channel deleted' }));
    } catch (deleteError) {
      toast.error(t('toast.configFailed', { error: String(deleteError) }));
    } finally {
      setBusyKey(null);
      setDeleteWholeChannel(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-10 pb-12 pt-16">
      <div className="mb-10 flex items-start justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('subtitle', 'Manage channel accounts, default accounts, and which agent each account routes to')}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void refreshAll()}
          className="h-9 rounded-full border-black/10 bg-transparent px-4 text-[13px] font-medium text-foreground/80 shadow-none transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
        >
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          {t('refresh')}
        </Button>
      </div>

      {gatewayStatus.state !== 'running' && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-yellow-500/50 bg-yellow-500/10 p-4">
          <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
          <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
            {t('gatewayWarning')}
          </span>
        </div>
      )}

      {error && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-destructive/50 bg-destructive/10 p-4">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <span className="text-sm font-medium text-destructive">{error}</span>
        </div>
      )}

      <div className="space-y-10 pb-14">
        <section className="space-y-5">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-foreground">
              {t('configured', 'Configured Channels')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('configuredDesc', 'Each channel can contain multiple accounts, and each account can route to a different agent.')}
            </p>
          </div>

          {channels.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-black/10 bg-black/[0.03] px-6 py-10 text-center text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
              {t('emptyConfigured', 'No channel accounts configured yet. Add one from the supported channel list below.')}
            </div>
          ) : (
            <div className="space-y-5">
              {channels.map((channel) => (
                <ChannelGroupCard
                  key={channel.id}
                  channel={channel}
                  agents={agentOptions}
                  explicitBindingMap={explicitChannelAccountBindings}
                  busyKey={busyKey}
                  onAddAccount={() => setModalState({ type: channel.type })}
                  onEditAccount={(accountId) => setModalState({ type: channel.type, accountId })}
                  onDeleteAccount={(accountId) => setDeleteState({ type: channel.type, accountId })}
                  onDeleteChannel={() => setDeleteWholeChannel(channel.type)}
                  onSetDefault={(accountId) => void handleSetDefault(channel.type, accountId)}
                  onBindAgent={(accountId, agentId) => void handleBindAgent(channel.type, accountId, agentId)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-5">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-foreground">
              {t('available', 'Supported Channels')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('availableDesc', 'Create the first account for a new channel type.')}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {supportedTypes.map((type) => {
              const meta = CHANNEL_META[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setModalState({ type })}
                  className="group flex items-start gap-4 rounded-2xl border border-transparent bg-transparent p-4 text-left transition-all hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full border border-black/5 bg-black/5 text-foreground shadow-sm dark:border-white/10 dark:bg-white/5">
                    <ChannelLogo type={type} />
                  </div>
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="mb-1 flex items-center gap-2">
                      <h3 className="truncate text-[16px] font-semibold text-foreground">{meta.name}</h3>
                      {meta.isPlugin && (
                        <Badge
                          variant="secondary"
                          className="rounded-full border-0 bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] font-medium text-foreground/70 shadow-none dark:bg-white/[0.08]"
                        >
                          {t('pluginBadge', 'Plugin')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[13.5px] leading-[1.5] text-muted-foreground">
                      {t(meta.description.replace('channels:', ''))}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {modalState && (
        <ChannelConfigModal
          fixedType={modalState.type}
          accountId={modalState.accountId}
          allowExistingConfig={Boolean(modalState.accountId)}
          onClose={() => setModalState(null)}
          onChannelSaved={async () => {
            await refreshAll();
            setModalState(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteState}
        title={t('deleteAccountTitle', 'Delete account')}
        message={deleteState?.accountId
          ? t('deleteAccountMessage', { defaultValue: 'Delete account {{accountId}} from this channel?', accountId: deleteState.accountId })
          : ''}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={() => void handleDeleteAccount()}
        onCancel={() => setDeleteState(null)}
      />

      <ConfirmDialog
        open={!!deleteWholeChannel}
        title={t('deleteChannelTitle', 'Delete channel')}
        message={deleteWholeChannel
          ? t('deleteChannelMessage', { defaultValue: 'Delete all accounts under {{name}}?', name: CHANNEL_NAMES[deleteWholeChannel] || deleteWholeChannel })
          : ''}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={() => void handleDeleteChannel()}
        onCancel={() => setDeleteWholeChannel(null)}
      />
    </div>
  );
}

function ChannelGroupCard({
  channel,
  agents,
  explicitBindingMap,
  busyKey,
  onAddAccount,
  onEditAccount,
  onDeleteAccount,
  onDeleteChannel,
  onSetDefault,
  onBindAgent,
}: {
  channel: ChannelGroup;
  agents: Array<{ id: string; name: string; isDefault: boolean }>;
  explicitBindingMap: Record<string, string>;
  busyKey: string | null;
  onAddAccount: () => void;
  onEditAccount: (accountId: string) => void;
  onDeleteAccount: (accountId: string) => void;
  onDeleteChannel: () => void;
  onSetDefault: (accountId: string) => void;
  onBindAgent: (accountId: string, agentId: string) => void;
}) {
  const { t } = useTranslation('channels');
  const meta = CHANNEL_META[channel.type];

  return (
    <div className="rounded-3xl border border-black/5 bg-white/70 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-black/5 bg-black/5 text-foreground shadow-sm dark:border-white/10 dark:bg-white/5">
            <ChannelLogo type={channel.type} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-foreground">{meta.name}</h3>
              {meta.isPlugin && (
                <Badge
                  variant="secondary"
                  className="rounded-full border-0 bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] font-medium text-foreground/70 shadow-none dark:bg-white/[0.08]"
                >
                  {t('pluginBadge', 'Plugin')}
                </Badge>
              )}
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t(meta.description.replace('channels:', ''))}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={onAddAccount}
            className="h-9 rounded-full border-black/10 bg-transparent px-4 text-[13px] font-medium text-foreground/80 shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
          >
            <Plus className="mr-2 h-3.5 w-3.5" />
            {t('addAccount', 'Add Account')}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDeleteChannel}
            disabled={busyKey === `${channel.type}:delete-all`}
            className="h-9 w-9 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {channel.accounts.map((account) => (
          <ChannelAccountRow
            key={account.id}
            channel={channel}
            account={account}
            agents={agents}
            explicitBindingMap={explicitBindingMap}
            busyKey={busyKey}
            onEdit={() => onEditAccount(account.accountId)}
            onDelete={() => onDeleteAccount(account.accountId)}
            onSetDefault={() => onSetDefault(account.accountId)}
            onBindAgent={(agentId) => onBindAgent(account.accountId, agentId)}
          />
        ))}
      </div>
    </div>
  );
}

function ChannelAccountRow({
  channel,
  account,
  agents,
  explicitBindingMap,
  busyKey,
  onEdit,
  onDelete,
  onSetDefault,
  onBindAgent,
}: {
  channel: ChannelGroup;
  account: ChannelAccount;
  agents: Array<{ id: string; name: string; isDefault: boolean }>;
  explicitBindingMap: Record<string, string>;
  busyKey: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onBindAgent: (agentId: string) => void;
}) {
  const { t } = useTranslation('channels');
  const statusTone =
    account.status === 'connected'
      ? 'bg-green-500'
      : account.status === 'connecting'
        ? 'bg-yellow-500 animate-pulse'
        : account.status === 'error'
          ? 'bg-destructive'
          : 'bg-muted-foreground';
  const selectedAgentId = explicitBindingMap[`${channel.type}:${account.accountId}`] || '';

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03] lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <div className={`h-2.5 w-2.5 rounded-full ${statusTone}`} />
          <p className="truncate font-mono text-[13px] font-semibold text-foreground">{account.accountId}</p>
          {account.isDefault && (
            <Badge className="rounded-full border-0 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary shadow-none">
              {t('defaultBadge', 'default')}
            </Badge>
          )}
          {!account.enabled && (
            <Badge variant="secondary" className="rounded-full border-0 px-2 py-0.5 text-[10px] shadow-none">
              {t('disabledBadge', 'disabled')}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {t('accountStatus', {
            status: t(`status.${account.status}`),
          })}
        </p>
        {account.error && (
          <p className="text-xs text-destructive">{account.error}</p>
        )}
      </div>

      <div className="flex flex-col gap-2 lg:min-w-[360px] lg:max-w-[460px] lg:items-end">
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
            {t('boundAgent', 'Bound Agent')}
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground"
                aria-label={t('bindingHelpLabel', 'Channel-agent binding help')}
              >
                <CircleHelp className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs whitespace-normal text-xs leading-5">
              {t('bindingHelp')}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative lg:w-[220px]">
            <select
              value={selectedAgentId}
              disabled={busyKey === `${channel.type}:${account.accountId}:bind`}
              onChange={(event) => onBindAgent(event.target.value)}
              className="h-10 w-full appearance-none rounded-xl border border-black/10 bg-white/85 px-4 pr-10 text-sm text-foreground shadow-sm outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-background"
            >
              <option value="">{t('unassigned', 'Unassigned')}</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}{agent.isDefault ? ` (${t('defaultBadge', 'default')})` : ''}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>

          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onSetDefault}
              disabled={account.isDefault || busyKey === `${channel.type}:${account.accountId}:default`}
              title={t('setDefault', 'Set Default')}
              aria-label={t('setDefault', 'Set Default')}
              className="h-9 w-9 rounded-full text-muted-foreground hover:bg-black/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
            >
              <Star className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onEdit}
              className="h-9 w-9 rounded-full text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              disabled={account.isDefault}
              className="h-9 w-9 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="h-[22px] w-[22px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="h-[22px] w-[22px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="h-[22px] w-[22px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="h-[22px] w-[22px] dark:invert" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="h-[22px] w-[22px] dark:invert" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="h-[22px] w-[22px] dark:invert" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="h-[22px] w-[22px] dark:invert" />;
    default:
      return <span className="text-[22px]">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

export default Channels;
