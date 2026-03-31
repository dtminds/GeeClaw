import { useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { AlertCircle, Bot, Check, ChevronDown, Package2, Plus, RefreshCw, Search, Settings2, Trash2, X } from 'lucide-react';
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
import { useAgentsStore, type PresetInstallStage } from '@/stores/agents';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { useSkillsStore } from '@/stores/skills';
import { CHANNEL_ICONS, CHANNEL_NAMES, type ChannelGroup, type ChannelType } from '@/types/channel';
import type { AgentSummary } from '@/types/agent';
import type { Skill } from '@/types/skill';
import { cn } from '@/lib/utils';
import { MarketplacePresetDetailDialog } from './MarketplacePresetDetailDialog';
import { getPresetPlatformLabels } from './preset-platforms';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import weixinIcon from '@/assets/channels/weixin.svg';
import qqIcon from '@/assets/channels/qq.svg';

function getInstallStageLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  stage: PresetInstallStage,
) {
  return t(`marketplace.installState.${stage}`);
}

export function Agents() {
  const { t } = useTranslation('agents');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const {
    agents,
    presets,
    installingPresetId,
    installStage,
    installProgress,
    loading,
    error,
    fetchAgents,
    fetchPresets,
    createAgent,
    deleteAgent,
    installPreset,
  } = useAgentsStore();
  const { channels, fetchChannels } = useChannelsStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<AgentSummary | null>(null);
  const [activeTab, setActiveTab] = useState<'agents' | 'marketplace'>('agents');
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([fetchAgents(), fetchChannels(), fetchPresets()]);
  }, [fetchAgents, fetchChannels, fetchPresets]);

  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
    [agents],
  );
  const installedPresetIds = useMemo(
    () => new Set(
      agents
        .filter((agent) => agent.source === 'preset' && agent.presetId)
        .map((agent) => agent.presetId as string),
    ),
    [agents],
  );
  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? null,
    [activeAgentId, agents],
  );
  const activePreset = useMemo(
    () => presets.find((preset) => preset.presetId === activePresetId) ?? null,
    [activePresetId, presets],
  );

  const handleRefresh = () => {
    void Promise.all([fetchAgents(), fetchChannels(), fetchPresets()]);
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
              className="surface-hover h-9 rounded-full border-black/10 bg-transparent px-4 text-[13px] font-medium text-foreground/80 shadow-none transition-colors dark:border-white/10"
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

          <div
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-black/8 bg-black/[0.03] p-1 dark:border-white/10 dark:bg-white/[0.04]"
            role="tablist"
          >
            {(['agents', 'marketplace'] as const).map((tab) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    'rounded-full px-4 py-2 text-[13px] font-medium transition-colors',
                    active ? 'bg-foreground text-background' : 'text-foreground/65 hover:text-foreground',
                  )}
                >
                  {tab === 'agents' ? t('tabs.agents') : t('tabs.marketplace')}
                </button>
              );
            })}
          </div>

          {activeTab === 'marketplace' ? (
            <div className="space-y-5">

              <div className="grid gap-4 md:grid-cols-3">
                {presets.map((preset) => {
                  const platformLabels = getPresetPlatformLabels(t, preset.platforms);
                  const isInstalling = installingPresetId === preset.presetId;
                  const installLabel = installedPresetIds.has(preset.presetId)
                    ? t('marketplace.installed')
                    : isInstalling
                      ? getInstallStageLabel(t, installStage)
                    : preset.supportedOnCurrentPlatform
                      ? t('marketplace.install')
                      : t('marketplace.unavailable');
                  const installDisabled = installedPresetIds.has(preset.presetId)
                    || !preset.supportedOnCurrentPlatform
                    || !!installingPresetId;
                  return (
                    <div
                      key={preset.presetId}
                      className="modal-section-surface flex flex-col gap-4 rounded-3xl border p-5"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="flex h-9 w-9 items-center justify-center rounded-2xl bg-black/[0.04] text-xl dark:bg-white/[0.06]"
                            aria-hidden="true"
                          >
                            {preset.emoji}
                          </span>
                          <h3 className="text-[18px] font-semibold text-foreground">{preset.name}</h3>
                          {platformLabels.map((label) => (
                            <Badge
                              key={label}
                              variant="secondary"
                              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                            >
                              {label}
                            </Badge>
                          ))}
                        </div>
                        <p className="text-sm text-muted-foreground">{preset.description}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          variant="secondary"
                          onClick={() => setActivePresetId(preset.presetId)}
                          className="h-9 rounded-full flex-1 px-4 text-[13px] font-medium"
                        >
                          {t('marketplace.viewDetails')}
                        </Button>
                        <Button
                          onClick={() => void installPreset(preset.presetId)}
                          disabled={installDisabled}
                          className="h-9 rounded-full px-4 text-[13px] font-medium shadow-none"
                        >
                          {installLabel}
                        </Button>
                      </div>

                      {isInstalling && (
                        <div className="space-y-1.5">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                            <div
                              className="h-full rounded-full bg-foreground/75 transition-[width] duration-300"
                              style={{ width: `${installProgress}%` }}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {getInstallStageLabel(t, installStage)} · {t('marketplace.installProgress', { progress: installProgress })}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : sortedAgents.length === 0 ? (
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

      <MarketplacePresetDetailDialog
        preset={activePreset}
        open={!!activePreset}
        installed={activePreset ? installedPresetIds.has(activePreset.presetId) : false}
        isInstalling={activePreset ? installingPresetId === activePreset.presetId : false}
        installStage={installStage}
        installProgress={installProgress}
        disableInstall={!!installingPresetId}
        onClose={() => setActivePresetId(null)}
        onInstall={(presetId) => void installPreset(presetId)}
      />

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
        'surface-hover group relative flex items-start gap-4 overflow-hidden rounded-2xl border border-transparent bg-transparent p-4 text-left transition-all',
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
            {agent.managed && (
              <Badge className="rounded-full border-0 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary shadow-none">
                {t('managedBadge')}
              </Badge>
            )}
            {agent.source === 'preset' && (
              <Badge
                variant="secondary"
                className="rounded-full border-0 bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-foreground/70 shadow-none dark:bg-white/[0.08]"
              >
                {t('presetBadge')}
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
                'surface-hover-strong h-7 w-7 text-muted-foreground transition-all',
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

const inputClasses = 'modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px] shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-[14px] text-foreground/80 font-bold';

function normalizeSkillSearch(value: string): string {
  return value
    .normalize('NFKD')
    .trim()
    .toLowerCase();
}

function getSkillDescription(skill: Skill): string {
  const description = skill.description?.trim();
  if (description) {
    return description;
  }

  return `/${skill.slug || skill.id}`;
}

function SkillScopeOption({
  skill,
  selected,
  disabled,
  onSelect,
}: {
  skill: Skill;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('skills');
  const source = (skill.source || '').trim().toLowerCase();
  const sourceLabel = skill.isCore
    ? t('detail.coreSystem', { defaultValue: 'Core System' })
    : skill.isBundled
      ? t('source.badge.bundled', { defaultValue: 'Bundled' })
      : source === 'agents-skills-personal'
        ? t('source.badge.agentsPersonal', { defaultValue: 'Personal .agents' })
        : source === 'agents-skills-project'
          ? t('source.badge.agentsProject', { defaultValue: 'Project .agents' })
          : source === 'openclaw-extra'
            ? t('source.badge.extra', { defaultValue: 'Extra dirs' })
            : source === 'openclaw-managed'
              ? t('source.badge.managed', { defaultValue: 'Managed' })
              : source === 'workspace'
                ? t('source.badge.workspace', { defaultValue: 'Workspace' })
                : t('source.badge.unknown', { defaultValue: 'Skill' });

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors',
        selected ? 'surface-muted text-foreground' : 'surface-hover',
        disabled && !selected && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground">
        {selected ? <Check className="h-3.5 w-3.5 text-foreground" /> : <Package2 className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex flex-1 items-baseline gap-2 overflow-hidden">
        <span className="shrink-0 truncate text-[13px] font-medium text-foreground">{skill.name}</span>
        <span className="truncate text-[11px] text-muted-foreground">{getSkillDescription(skill)}</span>
      </span>
      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
        {sourceLabel}
      </span>
    </button>
  );
}

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="h-[32px] w-[32px]" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="h-[32px] w-[32px]" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="h-[32px] w-[32px]" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="h-[32px] w-[32px]" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="h-[32px] w-[32px]" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="h-[32px] w-[32px]" />;
    case 'openclaw-weixin':
      return <img src={weixinIcon} alt="Weixin" className="h-[32px] w-[32px]" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="h-[32px] w-[32px]" />;
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
    <div className="overlay-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
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
  const { fetchAgents, updateAgent, updateAgentSettings, unmanageAgent } = useAgentsStore();
  const { fetchChannels } = useChannelsStore();
  const { skills, fetchSkills } = useSkillsStore();
  const [name, setName] = useState(agent.name);
  const [savingName, setSavingName] = useState(false);
  const [savingSkills, setSavingSkills] = useState(false);
  const [unmanaging, setUnmanaging] = useState(false);
  const [unmanageConfirmStep, setUnmanageConfirmStep] = useState<'warning' | 'final' | null>(null);
  const [channelToRemove, setChannelToRemove] = useState<{ channelType: ChannelType; accountId: string } | null>(null);
  const [skillScopeMode, setSkillScopeMode] = useState<'default' | 'specified'>(agent.skillScope.mode);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(
    agent.skillScope.mode === 'specified' ? agent.skillScope.skills : [],
  );
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const skillSearchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setName(agent.name);
  }, [agent.name]);

  useEffect(() => {
    void fetchSkills();
  }, [fetchSkills]);

  useEffect(() => {
    setSkillScopeMode(agent.skillScope.mode);
    setSelectedSkills(agent.skillScope.mode === 'specified' ? agent.skillScope.skills : []);
  }, [agent.skillScope]);

  useEffect(() => {
    if (!skillPickerOpen) {
      setSkillSearch('');
      return;
    }

    const timeoutId = window.setTimeout(() => {
      skillSearchInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [skillPickerOpen]);

  const runtimeChannelsByType = useMemo(
    () => Object.fromEntries(channels.map((channel) => [channel.type, channel])),
    [channels],
  );
  const presetSkillSet = useMemo(() => new Set(agent.presetSkills), [agent.presetSkills]);
  const availableSkills = useMemo(
    () => skills.filter((skill) => skill.eligible !== false && skill.hidden !== true),
    [skills],
  );
  const availableSkillsById = useMemo(
    () => new Map(availableSkills.map((skill) => [skill.id, skill])),
    [availableSkills],
  );
  const filteredSkills = useMemo(() => {
    const normalizedQuery = normalizeSkillSearch(skillSearch);
    if (!normalizedQuery) {
      return availableSkills;
    }

    return availableSkills.filter((skill) => (
      [
        skill.name,
        skill.id,
        skill.slug || '',
        getSkillDescription(skill),
      ]
        .map((value) => normalizeSkillSearch(value))
        .some((value) => value.includes(normalizedQuery))
    ));
  }, [availableSkills, skillSearch]);

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

  const toggleSkill = (skillId: string) => {
    setSelectedSkills((current) => {
      const currentSet = new Set(current);
      if (currentSet.has(skillId)) {
        if (presetSkillSet.has(skillId) && agent.managed) {
          return current;
        }
        currentSet.delete(skillId);
      } else if (currentSet.size < 6) {
        currentSet.add(skillId);
      }
      return Array.from(currentSet);
    });
  };

  const handleSelectSkill = (skillId: string) => {
    if (selectedSkills.includes(skillId) || selectedSkills.length >= 6) {
      return;
    }

    toggleSkill(skillId);
    setSkillPickerOpen(false);
    setSkillSearch('');
  };

  const handleSaveSkills = async () => {
    if (skillScopeMode === 'specified' && selectedSkills.length === 0) {
      return;
    }

    setSavingSkills(true);
    try {
      await updateAgentSettings(agent.id, {
        skillScope: skillScopeMode === 'default'
          ? { mode: 'default' }
          : { mode: 'specified', skills: selectedSkills },
      });
      toast.success(t('toast.agentUpdated'));
    } catch (error) {
      toast.error(t('toast.agentUpdateFailed', { error: String(error) }));
    } finally {
      setSavingSkills(false);
    }
  };

  const handleUnmanage = async () => {
    setUnmanaging(true);
    try {
      await unmanageAgent(agent.id);
      setUnmanageConfirmStep(null);
      toast.success(t('toast.agentUnmanaged'));
    } catch (error) {
      toast.error(t('toast.agentUnmanageFailed', { error: String(error) }));
    } finally {
      setUnmanaging(false);
    }
  };

  const handleUnmanageConfirm = () => {
    if (unmanageConfirmStep === 'warning') {
      setUnmanageConfirmStep('final');
      return;
    }

    void handleUnmanage();
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
    <div className="overlay-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <Card className="modal-card-surface flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border shadow-2xl">
        <CardHeader className="flex shrink-0 flex-row items-start justify-between pb-2">
          <div>
            <CardTitle className="modal-title">
              {t('settingsDialog.title', { name: agent.name })}
            </CardTitle>
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
                  className={inputClasses}
                />
                <Button
                  variant="outline"
                  onClick={() => void handleSaveName()}
                  disabled={savingName || !name.trim() || name.trim() === agent.name}
                  className="modal-field-surface surface-hover h-[44px] rounded-xl px-4 text-[13px] font-medium text-foreground/80 shadow-none"
                >
                  {savingName ? <RefreshCw className="h-4 w-4 animate-spin" /> : t('common:actions.save')}
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="surface-muted space-y-1 rounded-2xl border border-transparent p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                  {t('settingsDialog.agentIdLabel')}
                </p>
                <p className="font-mono text-[13px] text-foreground">{agent.id}</p>
              </div>
              <div className="surface-muted space-y-1 rounded-2xl border border-transparent p-4">
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
              <div className="surface-muted rounded-2xl border border-dashed border-black/10 p-4 text-[13.5px] text-muted-foreground dark:border-white/10">
                {t('settingsDialog.noChannels')}
              </div>
            ) : (
              <div className="space-y-3">
                {assignedChannels.map((channel) => (
                  <div
                    key={`${channel.channelType}:${channel.accountId}`}
                    className="surface-muted flex items-center justify-between rounded-2xl border border-transparent p-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-[40px] w-[40px] shrink-0 items-center justify-center">
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

          <div className="space-y-4">
            <div>
              <h3 className="text-xl font-medium tracking-tight text-foreground">
                {t('settingsDialog.skillsTitle', 'Skills Scope')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {agent.managed && agent.presetSkills.length > 0
                  ? t('settingsDialog.skillsManagedHint', 'This managed agent can add extra skills, but preset skills cannot be removed until you unmanage it.')
                  : t('settingsDialog.skillsHint', 'Choose between the default skill scope or up to 6 specific skills.')}
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant={skillScopeMode === 'default' ? 'default' : 'outline'}
                disabled={!agent.canUseDefaultSkillScope}
                onClick={() => setSkillScopeMode('default')}
                className="h-9 rounded-full px-4 text-[13px]"
              >
                {t('settingsDialog.skillScope.default', 'Default')}
              </Button>
              <Button
                type="button"
                variant={skillScopeMode === 'specified' ? 'default' : 'outline'}
                onClick={() => setSkillScopeMode('specified')}
                className="h-9 rounded-full px-4 text-[13px]"
              >
                {t('settingsDialog.skillScope.specified', 'Specified')}
              </Button>
            </div>

            {skillScopeMode === 'specified' && (
              <div className="space-y-3 rounded-2xl border border-black/8 p-4 dark:border-white/10">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{t('settingsDialog.skillScope.selected', 'Selected skills')}</p>
                  <p className="text-xs text-muted-foreground">{selectedSkills.length} / 6</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {selectedSkills.map((skillId) => {
                    const skill = availableSkillsById.get(skillId);
                    const locked = agent.managed && presetSkillSet.has(skillId);
                    const label = skill?.name || skillId;
                    return (
                      <button
                        key={skillId}
                        type="button"
                        onClick={() => toggleSkill(skillId)}
                        disabled={locked}
                        title={locked ? t('settingsDialog.skillScope.preset', 'Preset') : undefined}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
                          locked
                            ? 'bg-primary/10 text-primary'
                            : 'bg-black/[0.04] text-foreground/80 hover:bg-black/[0.08] dark:bg-white/[0.08]',
                        )}
                      >
                        <span>{label}</span>
                        {locked ? (
                          <span className="text-[10px] uppercase tracking-[0.08em] text-primary/80">
                            {t('settingsDialog.skillScope.preset', 'Preset')}
                          </span>
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <Popover.Root open={skillPickerOpen} onOpenChange={setSkillPickerOpen}>
                  <Popover.Trigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="modal-field-surface surface-hover h-11 w-full justify-between rounded-2xl px-4 text-[13px] font-medium text-foreground shadow-none"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-left">
                        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {t('settingsDialog.skillScope.addSkill', 'Add skill')}
                        </span>
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Button>
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content
                      align="start"
                      side="bottom"
                      sideOffset={8}
                      className="z-50 w-[min(32rem,calc(100vw-5rem))] overflow-hidden rounded-[22px] border border-black/8 bg-white p-2 shadow-[0_20px_50px_rgba(15,23,42,0.12)] dark:border-white/10 dark:bg-card"
                    >
                      <div className="relative px-1 pb-2">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          ref={skillSearchInputRef}
                          value={skillSearch}
                          onChange={(event) => setSkillSearch(event.target.value)}
                          aria-label={t('settingsDialog.skillScope.search', 'Search skills')}
                          placeholder={t('settingsDialog.skillScope.searchPlaceholder', 'Search by name, slug, or description')}
                          className="modal-field-surface h-10 rounded-xl border-0 pl-9 pr-3 text-[13px] shadow-none"
                        />
                      </div>
                      <div className="max-h-64 overflow-y-auto pr-1">
                        {filteredSkills.length > 0 ? (
                          filteredSkills.map((skill) => {
                            const selected = selectedSkills.includes(skill.id);
                            return (
                              <SkillScopeOption
                                key={skill.id}
                                skill={skill}
                                selected={selected}
                                disabled={!selected && selectedSkills.length >= 6}
                                onSelect={() => handleSelectSkill(skill.id)}
                              />
                            );
                          })
                        ) : (
                          <div className="px-3 py-5 text-center text-[12px] text-muted-foreground">
                            {t('settingsDialog.skillScope.empty', 'No matching skills')}
                          </div>
                        )}
                      </div>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>

                <p className="text-xs text-muted-foreground">
                  {selectedSkills.length >= 6
                    ? t('settingsDialog.skillScope.maxReached', 'Skill limit reached')
                    : t('settingsDialog.skillScope.searchPlaceholder', 'Search by name, slug, or description')}
                </p>
              </div>
            )}

            <Button
              type="button"
              onClick={() => void handleSaveSkills()}
              disabled={savingSkills || (skillScopeMode === 'specified' && selectedSkills.length === 0)}
              className="modal-primary-button"
            >
              {savingSkills ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('settingsDialog.skillScope.save', 'Save Skills')}
            </Button>
          </div>

          {agent.managed && (
            <div className="space-y-3 rounded-2xl border border-black/8 p-4 dark:border-white/10">
              <h3 className="text-base font-semibold text-foreground">
                {t('settingsDialog.unmanageTitle', 'Managed preset')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('settingsDialog.unmanageDescription', 'Unmanaging keeps the current config but removes preset restrictions on persona files and preset skills.')}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setUnmanageConfirmStep('warning')}
                disabled={!agent.canUnmanage || unmanaging}
                className="rounded-full px-4"
              >
                {unmanaging ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('settingsDialog.unmanage', 'Unmanage')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={unmanageConfirmStep !== null}
        title={unmanageConfirmStep === 'final'
          ? t('settingsDialog.unmanageConfirm.secondTitle', 'Confirm unmanage')
          : t('settingsDialog.unmanageConfirm.firstTitle', 'Remove managed restrictions?')}
        message={unmanageConfirmStep === 'final'
          ? t('settingsDialog.unmanageConfirm.secondMessage', 'This action cannot be automatically restored. The current preset files stay as-is, but future edits will no longer be protected.')
          : t('settingsDialog.unmanageConfirm.firstMessage', 'This will unlock preset persona files and allow preset skills to be removed.')}
        confirmLabel={unmanageConfirmStep === 'final'
          ? t('settingsDialog.unmanageConfirm.secondConfirm', 'Unmanage now')
          : t('settingsDialog.unmanageConfirm.firstConfirm', 'Continue')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={handleUnmanageConfirm}
        onCancel={() => setUnmanageConfirmStep(null)}
      />

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
