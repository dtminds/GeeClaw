import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bot, Check, Plus, RefreshCw, Settings2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApiFetch } from '@/lib/host-api';
import { useAgentsStore } from '@/stores/agents';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelGroup, type ChannelType } from '@/types/channel';
import type { AgentSummary } from '@/types/agent';
import { cn } from '@/lib/utils';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import weixinIcon from '@/assets/channels/weixin.svg';
import qqIcon from '@/assets/channels/qq.svg';

export function Agents() {
  const { t } = useTranslation('agents');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const { agents, loading, error, fetchAgents, createAgent, deleteAgent } = useAgentsStore();
  const { channels, fetchChannels } = useChannelsStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<AgentSummary | null>(null);

  useEffect(() => {
    void Promise.all([fetchAgents(), fetchChannels()]);
  }, [fetchAgents, fetchChannels]);

  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
    [agents],
  );
  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? null,
    [activeAgentId, agents],
  );

  const handleRefresh = () => {
    void Promise.all([fetchAgents(), fetchChannels()]);
  };

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-2.5rem)] flex-col items-center justify-center dark:bg-background -m-6">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col dark:bg-background ">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-10 pb-12 pt-16">
        <div className="mb-10 flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-3 md:mt-2">
            <Button
              variant="outline"
              onClick={handleRefresh}
              className="h-9 rounded-full border-black/10 bg-transparent px-4 text-[13px] font-medium text-foreground/80 shadow-none transition-colors hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5"
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              {t('refresh')}
            </Button>
            <Button
              onClick={() => setShowAddDialog(true)}
              className="h-9 rounded-full px-4 text-[13px] font-medium shadow-none"
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              {t('addAgent')}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-10 pr-2 -mr-2">
          {gatewayStatus.state !== 'running' && (
            <div className="mb-8 flex items-center gap-3 rounded-xl border border-yellow-500/50 bg-yellow-500/10 p-4">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                {t('gatewayWarning')}
              </span>
            </div>
          )}

          {error && (
            <div className="mb-8 flex items-center gap-3 rounded-xl border border-destructive/50 bg-destructive/10 p-4">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-sm font-medium text-destructive">{error}</span>
            </div>
          )}

          {sortedAgents.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-black/10 bg-black/[0.03] px-6 py-12 text-center text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
              {t('empty')}
            </div>
          ) : (
            <div className="space-y-3">
              {sortedAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onOpenSettings={() => setActiveAgentId(agent.id)}
                  onDelete={() => setAgentToDelete(agent)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {showAddDialog && (
        <AddAgentDialog
          existingAgentIds={agents.map((agent) => agent.id)}
          onClose={() => setShowAddDialog(false)}
          onCreate={async (name, id) => {
            await createAgent(name, id);
            setShowAddDialog(false);
            toast.success(t('toast.agentCreated'));
          }}
        />
      )}

      {activeAgent && (
        <AgentSettingsModal
          agent={activeAgent}
          channels={channels}
          onClose={() => setActiveAgentId(null)}
        />
      )}

      <ConfirmDialog
        open={!!agentToDelete}
        title={t('deleteDialog.title')}
        message={agentToDelete ? t('deleteDialog.message', { name: agentToDelete.name }) : ''}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!agentToDelete) return;
          try {
            await deleteAgent(agentToDelete.id);
            if (activeAgentId === agentToDelete.id) {
              setActiveAgentId(null);
            }
            toast.success(t('toast.agentDeleted'));
          } catch (deleteError) {
            toast.error(t('toast.agentDeleteFailed', { error: String(deleteError) }));
          } finally {
            setAgentToDelete(null);
          }
        }}
        onCancel={() => setAgentToDelete(null)}
      />
    </div>
  );
}

function AgentCard({
  agent,
  onOpenSettings,
  onDelete,
}: {
  agent: AgentSummary;
  onOpenSettings: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('agents');
  const channelsText = agent.channelAccounts.length > 0
    ? agent.channelAccounts
      .map(({ channelType, accountId }) => `${CHANNEL_NAMES[channelType as ChannelType] || channelType} / ${accountId}`)
      .join(', ')
    : t('none');

  return (
    <div
      className={cn(
        'group relative flex items-start gap-4 overflow-hidden rounded-2xl border border-transparent bg-transparent p-4 text-left transition-all hover:bg-black/5 dark:hover:bg-white/5',
        agent.isDefault && 'bg-black/[0.04] dark:bg-white/[0.06]',
      )}
    >
      <div className="mb-3 flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary shadow-sm">
        <Bot className="h-[22px] w-[22px]" />
      </div>
      <div className="mt-1 flex min-w-0 flex-1 flex-col py-0.5">
        <div className="mb-1 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[16px] font-semibold text-foreground">{agent.name}</h2>
            {agent.isDefault && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1 rounded-full border-0 bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] font-medium text-foreground/70 shadow-none dark:bg-white/[0.08]"
              >
                <Check className="h-3 w-3" />
                {t('defaultBadge')}
              </Badge>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!agent.isDefault && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                onClick={onDelete}
                title={t('deleteAgent')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 text-muted-foreground transition-all hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                !agent.isDefault && 'opacity-0 group-hover:opacity-100',
              )}
              onClick={onOpenSettings}
              title={t('settings')}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-[13.5px] leading-[1.5] text-muted-foreground">
          {t('modelLine', {
            model: agent.modelDisplay,
            suffix: agent.inheritedModel ? ` (${t('inherited')})` : '',
          })}
        </p>
        <p className="text-[13.5px] leading-[1.5] text-muted-foreground">
          {t('channelsLine', { channels: channelsText })}
        </p>
      </div>
    </div>
  );
}

const inputClasses = 'modal-field-surface h-[44px] rounded-xl font-mono text-[13px] focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-[14px] text-foreground/80 font-bold';

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="h-[20px] w-[20px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="h-[20px] w-[20px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="h-[20px] w-[20px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="h-[20px] w-[20px] dark:invert" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="h-[20px] w-[20px] dark:invert" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="h-[20px] w-[20px] dark:invert" />;
    case 'openclaw-weixin':
      return <img src={weixinIcon} alt="Weixin" className="h-[20px] w-[20px]" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="h-[20px] w-[20px] dark:invert" />;
    default:
      return <span className="text-[20px] leading-none">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

function AddAgentDialog({
  existingAgentIds,
  onClose,
  onCreate,
}: {
  existingAgentIds: string[];
  onClose: () => void;
  onCreate: (name: string, id: string) => Promise<void>;
}) {
  const { t } = useTranslation('agents');
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState('');
  const [saving, setSaving] = useState(false);
  const normalizedAgentId = agentId.trim().toLowerCase();
  const isIdFormatValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedAgentId);
  const isIdDuplicate = existingAgentIds.includes(normalizedAgentId);
  const idError = !normalizedAgentId
    ? null
    : (!isIdFormatValid
      ? t('createDialog.idFormatError')
      : (isIdDuplicate ? t('createDialog.idDuplicateError') : null));

  const handleSubmit = async () => {
    if (!name.trim() || !normalizedAgentId || !isIdFormatValid || isIdDuplicate) return;
    setSaving(true);
    try {
      await onCreate(name.trim(), normalizedAgentId);
    } catch (error) {
      toast.error(t('toast.agentCreateFailed', { error: String(error) }));
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="modal-card-surface w-full max-w-md overflow-hidden rounded-3xl border shadow-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="modal-title">
            {t('createDialog.title')}
          </CardTitle>
          <CardDescription className="modal-description">
            {t('createDialog.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6 pt-4">
          <div className="space-y-2.5">
            <Label htmlFor="agent-name" className={labelClasses}>{t('createDialog.nameLabel')}</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('createDialog.namePlaceholder')}
              className={inputClasses}
            />
          </div>
          <div className="space-y-2.5">
            <Label htmlFor="agent-id" className={labelClasses}>{t('createDialog.idLabel')}</Label>
            <Input
              id="agent-id"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              placeholder={t('createDialog.idPlaceholder')}
              className={cn(inputClasses, idError && 'border-destructive focus-visible:ring-destructive/30 focus-visible:border-destructive')}
            />
            <p className={cn('text-[12px]', idError ? 'text-destructive' : 'text-muted-foreground')}>
              {idError || t('createDialog.idHint')}
            </p>
          </div>
          <div className="modal-footer">
            <Button
              variant="outline"
              onClick={onClose}
              className="modal-secondary-button"
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => void handleSubmit()}
              disabled={saving || !name.trim() || !normalizedAgentId || !isIdFormatValid || isIdDuplicate}
              className="modal-primary-button"
            >
              {saving ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  {t('creating')}
                </>
              ) : (
                t('common:actions.save')
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AgentSettingsModal({
  agent,
  channels,
  onClose,
}: {
  agent: AgentSummary;
  channels: ChannelGroup[];
  onClose: () => void;
}) {
  const { t } = useTranslation('agents');
  const { updateAgent, fetchAgents } = useAgentsStore();
  const { fetchChannels } = useChannelsStore();
  const [name, setName] = useState(agent.name);
  const [savingName, setSavingName] = useState(false);
  const [channelToRemove, setChannelToRemove] = useState<{ channelType: ChannelType; accountId: string } | null>(null);

  useEffect(() => {
    setName(agent.name);
  }, [agent.name]);

  const runtimeChannelsByType = useMemo(
    () => Object.fromEntries(channels.map((channel) => [channel.type, channel])),
    [channels],
  );

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === agent.name) return;
    setSavingName(true);
    try {
      await updateAgent(agent.id, name.trim());
      toast.success(t('toast.agentUpdated'));
    } catch (error) {
      toast.error(t('toast.agentUpdateFailed', { error: String(error) }));
    } finally {
      setSavingName(false);
    }
  };

  const assignedChannels = agent.channelAccounts.map(({ channelType, accountId }) => {
    const runtimeChannel = runtimeChannelsByType[channelType];
    const runtimeAccount = runtimeChannel?.accounts.find((account) => account.accountId === accountId);
    return {
      channelType: channelType as ChannelType,
      accountId,
      status: runtimeAccount?.status || 'disconnected',
      error: runtimeAccount?.error,
      isDefault: runtimeAccount?.isDefault || false,
    };
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="modal-card-surface flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border shadow-2xl">
        <CardHeader className="flex shrink-0 flex-row items-start justify-between pb-2">
          <div>
            <CardTitle className="modal-title">
              {t('settingsDialog.title', { name: agent.name })}
            </CardTitle>
            <CardDescription className="modal-description">
              {t('settingsDialog.description')}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="modal-close-button -mr-2 -mt-2"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="flex-1 space-y-6 overflow-y-auto p-6 pt-4">
          <div className="space-y-4">
            <div className="space-y-2.5">
              <Label htmlFor="agent-settings-name" className={labelClasses}>{t('settingsDialog.nameLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="agent-settings-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  readOnly={agent.isDefault}
                  className={inputClasses}
                />
                {!agent.isDefault && (
                  <Button
                    variant="outline"
                    onClick={() => void handleSaveName()}
                    disabled={savingName || !name.trim() || name.trim() === agent.name}
                    className="modal-field-surface h-[44px] rounded-xl px-4 text-[13px] font-medium text-foreground/80 shadow-none hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                  >
                    {savingName ? <RefreshCw className="h-4 w-4 animate-spin" /> : t('common:actions.save')}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-transparent bg-black/5 p-4 dark:bg-white/5">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                  {t('settingsDialog.agentIdLabel')}
                </p>
                <p className="font-mono text-[13px] text-foreground">{agent.id}</p>
              </div>
              <div className="space-y-1 rounded-2xl border border-transparent bg-black/5 p-4 dark:bg-white/5">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                  {t('settingsDialog.modelLabel')}
                </p>
                <p className="text-[13.5px] text-foreground">
                  {agent.modelDisplay}
                  {agent.inheritedModel ? ` (${t('inherited')})` : ''}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-xl font-medium tracking-tight text-foreground">
                {t('settingsDialog.channelsTitle')}
              </h3>
            </div>

            {assignedChannels.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-black/5 p-4 text-[13.5px] text-muted-foreground dark:border-white/10 dark:bg-white/5">
                {t('settingsDialog.noChannels')}
              </div>
            ) : (
              <div className="space-y-3">
                {assignedChannels.map((channel) => (
                  <div
                    key={`${channel.channelType}:${channel.accountId}`}
                    className="flex items-center justify-between rounded-2xl border border-transparent bg-black/5 p-4 dark:bg-white/5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full border border-black/5 bg-black/5 text-foreground shadow-sm dark:border-white/10 dark:bg-white/5">
                        <ChannelLogo type={channel.channelType} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[15px] font-semibold text-foreground">
                            {CHANNEL_NAMES[channel.channelType]}
                          </p>
                          {channel.isDefault && (
                            <Badge className="rounded-full border-0 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary shadow-none">
                              {t('defaultBadge')}
                            </Badge>
                          )}
                        </div>
                        <p className="font-mono text-[13px] text-muted-foreground">{channel.accountId}</p>
                        {channel.error && (
                          <p className="mt-1 text-xs text-destructive">{channel.error}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={channel.status} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setChannelToRemove({ channelType: channel.channelType, accountId: channel.accountId })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!channelToRemove}
        title={t('removeChannelDialog.title')}
        message={channelToRemove ? t('removeChannelDialog.message', {
          name: `${CHANNEL_NAMES[channelToRemove.channelType] || channelToRemove.channelType} / ${channelToRemove.accountId}`,
        }) : ''}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!channelToRemove) return;
          try {
            await hostApiFetch(`/api/channels/config/${encodeURIComponent(channelToRemove.channelType)}/accounts/${encodeURIComponent(channelToRemove.accountId)}/agent`, {
              method: 'PUT',
              body: JSON.stringify({ agentId: null }),
            });
            await Promise.all([fetchAgents(), fetchChannels()]);
            toast.success(t('toast.channelRemoved', {
              channel: `${CHANNEL_NAMES[channelToRemove.channelType] || channelToRemove.channelType} / ${channelToRemove.accountId}`,
            }));
          } catch (error) {
            toast.error(t('toast.channelRemoveFailed', { error: String(error) }));
          } finally {
            setChannelToRemove(null);
          }
        }}
        onCancel={() => setChannelToRemove(null)}
      />
    </div>
  );
}

export default Agents;
