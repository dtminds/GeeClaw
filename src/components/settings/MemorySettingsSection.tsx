import { useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { toUserMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { SegmentedControl } from '@/components/ui/segmented-control';

type MemoryCardStatus = 'enabled' | 'disabled' | 'not-installed' | 'unavailable';

type AvailableProviderModelGroup = {
  providerId: string;
  providerName: string;
  modelRefs: string[];
};

type ManagedPluginStatus = {
  pluginId: string;
  displayName: string;
  stage: 'idle' | 'checking' | 'installing' | 'installed' | 'failed';
  message: string;
  targetVersion: string;
  installedVersion?: string | null;
  error?: string;
};

type MemorySettingsSnapshot = {
  availableModels: AvailableProviderModelGroup[];
  dreaming: {
    enabled: boolean;
    status: Extract<MemoryCardStatus, 'enabled' | 'disabled' | 'unavailable'>;
  };
  activeMemory: {
    enabled: boolean;
    agents: string[];
    model: string | null;
    modelMode: 'automatic' | 'custom';
    status: Extract<MemoryCardStatus, 'enabled' | 'disabled' | 'unavailable'>;
  };
  losslessClaw: {
    enabled: boolean;
    installedVersion: string | null;
    requiredVersion: string;
    summaryModel: string | null;
    summaryModelMode: 'automatic' | 'custom';
    status: MemoryCardStatus;
    installJob: ManagedPluginStatus | null;
  };
};

type MemorySettingsPatch = {
  dreaming?: {
    enabled?: boolean;
  };
  activeMemory?: {
    enabled?: boolean;
    model?: string | null;
  };
  losslessClaw?: {
    enabled?: boolean;
    summaryModel?: string | null;
  };
};

function buildStatusTone(status: MemoryCardStatus): string {
  if (status === 'enabled') return 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300';
  if (status === 'unavailable') return 'bg-amber-500/12 text-amber-700 dark:text-amber-300';
  if (status === 'not-installed') return 'bg-slate-500/12 text-slate-700 dark:text-slate-300';
  return 'bg-muted text-muted-foreground';
}

export function MemorySettingsSection() {
  const { t } = useTranslation('settings');
  const [settings, setSettings] = useState<MemorySettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [activeMemoryMode, setActiveMemoryMode] = useState<'automatic' | 'custom'>('automatic');
  const [activeMemoryModelDraft, setActiveMemoryModelDraft] = useState('');
  const [losslessMode, setLosslessMode] = useState<'automatic' | 'custom'>('automatic');
  const [losslessModelDraft, setLosslessModelDraft] = useState('');

  const applySnapshot = (snapshot: MemorySettingsSnapshot) => {
    setSettings(snapshot);
    setActiveMemoryMode(snapshot.activeMemory.modelMode);
    setActiveMemoryModelDraft(snapshot.activeMemory.model ?? '');
    setLosslessMode(snapshot.losslessClaw.summaryModelMode);
    setLosslessModelDraft(snapshot.losslessClaw.summaryModel ?? '');
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const snapshot = await hostApiFetch<MemorySettingsSnapshot>('/api/settings/memory');
        if (cancelled) return;
        applySnapshot(snapshot);
      } catch (error) {
        if (!cancelled) {
          toast.error(`${t('memory.toast.loadFailed')}: ${toUserMessage(error)}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    return subscribeHostEvent<ManagedPluginStatus | null>('openclaw:managed-plugin-status', (payload) => {
      if (payload && payload.pluginId !== 'lossless-claw') {
        return;
      }

      setSettings((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          losslessClaw: {
            ...current.losslessClaw,
            installJob: payload,
          },
        };
      });
    });
  }, []);

  const savePatch = async (patch: MemorySettingsPatch, savingId: string) => {
    setSavingKey(savingId);
    try {
      const response = await hostApiFetch<{ success: boolean; settings: MemorySettingsSnapshot }>('/api/settings/memory', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
      });
      applySnapshot(response.settings);
      toast.success(t('memory.toast.saved'));
    } catch (error) {
      toast.error(`${t('memory.toast.saveFailed')}: ${toUserMessage(error)}`);
    } finally {
      setSavingKey(null);
    }
  };

  const installLosslessClaw = async () => {
    setSavingKey('lossless-install');
    try {
      const response = await hostApiFetch<{ success: boolean; settings: MemorySettingsSnapshot }>(
        '/api/settings/memory/lossless-claw/install',
        { method: 'POST' },
      );
      applySnapshot(response.settings);
      toast.success(t('memory.toast.installSuccess'));
    } catch (error) {
      toast.error(`${t('memory.toast.installFailed')}: ${toUserMessage(error)}`);
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('memory.loading')}
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-6 text-sm text-muted-foreground">
        {t('memory.toast.loadFailed')}
      </div>
    );
  }

  const losslessInstallRunning = settings.losslessClaw.installJob?.stage === 'checking'
    || settings.losslessClaw.installJob?.stage === 'installing';
  const losslessNeedsInstall = settings.losslessClaw.status === 'not-installed';
  const losslessNeedsUpgrade = settings.losslessClaw.status === 'unavailable';
  const losslessNeedsAction = losslessNeedsInstall
    || losslessNeedsUpgrade
    || settings.losslessClaw.installJob?.stage === 'failed'
    || losslessInstallRunning;
  const losslessActionLabel = losslessInstallRunning
    ? (losslessNeedsUpgrade ? t('memory.actions.upgradeInProgress') : t('memory.actions.installInProgress'))
    : (losslessNeedsUpgrade ? t('memory.actions.upgrade') : t('memory.actions.install'));

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <h2 className="modal-title">{t('memory.title')}</h2>
        <p className="modal-description max-w-3xl">{t('memory.description')}</p>
      </div>

      <div className="grid gap-4">
        <Card className="border-border/60">
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>{t('memory.cards.dreaming.title')}</CardTitle>
                <CardDescription>{t('memory.cards.dreaming.description')}</CardDescription>
              </div>
              <Badge className={buildStatusTone(settings.dreaming.status)}>
                {t(`memory.status.${settings.dreaming.status}`)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">{t(`memory.copy.dreaming.${settings.dreaming.status}`)}</p>
              <Switch
                checked={settings.dreaming.enabled}
                disabled={savingKey !== null}
                onCheckedChange={(enabled) => { void savePatch({ dreaming: { enabled } }, 'dreaming-toggle'); }}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>{t('memory.cards.activeMemory.title')}</CardTitle>
                <CardDescription>{t('memory.cards.activeMemory.description')}</CardDescription>
              </div>
              <Badge className={buildStatusTone(settings.activeMemory.status)}>
                {t(`memory.status.${settings.activeMemory.status}`)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">{t(`memory.copy.activeMemory.${settings.activeMemory.status}`)}</p>
              <Switch
                checked={settings.activeMemory.enabled}
                disabled={savingKey !== null}
                onCheckedChange={(enabled) => { void savePatch({ activeMemory: { enabled } }, 'active-toggle'); }}
              />
            </div>
            {settings.activeMemory.enabled ? (
              <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-foreground">{t('memory.cards.activeMemory.modelTitle')}</div>
                    <p className="text-sm text-muted-foreground">{t('memory.cards.activeMemory.modelDescription')}</p>
                  </div>
                  <div className="w-[220px] shrink-0">
                    <SegmentedControl
                      ariaLabel={t('memory.cards.activeMemory.modelTitle')}
                      value={activeMemoryMode}
                      onValueChange={(value) => {
                        setActiveMemoryMode(value);
                        if (value === 'automatic') {
                          void savePatch({ activeMemory: { model: null } }, 'active-model-mode');
                        }
                      }}
                      options={[
                        { value: 'automatic', label: t('memory.modelMode.automatic') },
                        { value: 'custom', label: t('memory.modelMode.custom') },
                      ]}
                      fullWidth
                    />
                  </div>
                </div>
                {activeMemoryMode === 'custom' ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <select
                        value={activeMemoryModelDraft}
                        onChange={(event) => {
                          const nextModel = event.target.value;
                          setActiveMemoryModelDraft(nextModel);
                          void savePatch({
                            activeMemory: {
                              model: nextModel || null,
                            },
                          }, 'active-model-save');
                        }}
                        disabled={savingKey !== null}
                        className="modal-field-surface h-[44px] w-full appearance-none rounded-xl border px-3 pr-10 text-[13px] text-foreground outline-none disabled:pointer-events-none disabled:opacity-50"
                      >
                        <option value="" disabled hidden>{t('memory.modelPlaceholder')}</option>
                        {settings.availableModels.map((group) => (
                          <optgroup key={group.providerId} label={group.providerName}>
                            {group.modelRefs.map((modelRef) => (
                              <option key={modelRef} value={modelRef}>{modelRef}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground">
                        <ChevronDown className="h-4 w-4" />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>{t('memory.cards.losslessClaw.title')}</CardTitle>
                <CardDescription>{t('memory.cards.losslessClaw.description')}</CardDescription>
              </div>
              <Badge className={buildStatusTone(settings.losslessClaw.status)}>
                {t(`memory.status.${settings.losslessClaw.status}`)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>{t(`memory.copy.losslessClaw.${settings.losslessClaw.status}`)}</p>
                {settings.losslessClaw.installedVersion ? (
                  <p>
                    {t('memory.cards.losslessClaw.version', {
                      installed: settings.losslessClaw.installedVersion,
                      required: settings.losslessClaw.requiredVersion,
                    })}
                  </p>
                ) : null}
              </div>
              {losslessNeedsAction ? (
                <Button
                  type="button"
                  variant={losslessNeedsUpgrade ? 'outline' : 'default'}
                  disabled={savingKey !== null || losslessInstallRunning}
                  onClick={() => { void installLosslessClaw(); }}
                >
                  {(savingKey === 'lossless-install' || losslessInstallRunning) ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {losslessActionLabel}
                </Button>
              ) : (
                <Switch
                  checked={settings.losslessClaw.enabled}
                  disabled={savingKey !== null || losslessInstallRunning}
                  onCheckedChange={(enabled) => { void savePatch({ losslessClaw: { enabled } }, 'lossless-toggle'); }}
                />
              )}
            </div>
            {settings.losslessClaw.installJob ? (
              <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Loader2 className={`h-4 w-4 ${losslessInstallRunning ? 'animate-spin' : ''}`} />
                  <span>{settings.losslessClaw.installJob.message}</span>
                </div>
                <p className="text-sm text-muted-foreground">{t('memory.copy.losslessClaw.installingHint')}</p>
                {settings.losslessClaw.installJob.error ? (
                  <p className="text-sm text-destructive">{settings.losslessClaw.installJob.error}</p>
                ) : null}
              </div>
            ) : null}
            {settings.losslessClaw.enabled ? (
              <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-foreground">{t('memory.cards.losslessClaw.modelTitle')}</div>
                    <p className="text-sm text-muted-foreground">{t('memory.cards.losslessClaw.modelDescription')}</p>
                  </div>
                  <div className="w-[220px] shrink-0">
                    <SegmentedControl
                      ariaLabel={t('memory.cards.losslessClaw.modelTitle')}
                      value={losslessMode}
                      onValueChange={(value) => {
                        setLosslessMode(value);
                        if (value === 'automatic') {
                          void savePatch({ losslessClaw: { summaryModel: null } }, 'lossless-model-mode');
                        }
                      }}
                      options={[
                        { value: 'automatic', label: t('memory.modelMode.automatic') },
                        { value: 'custom', label: t('memory.modelMode.custom') },
                      ]}
                      fullWidth
                    />
                  </div>
                </div>
                {losslessMode === 'custom' ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <select
                        value={losslessModelDraft}
                        onChange={(event) => {
                          const nextModel = event.target.value;
                          setLosslessModelDraft(nextModel);
                          void savePatch({
                            losslessClaw: {
                              summaryModel: nextModel || null,
                            },
                          }, 'lossless-model-save');
                        }}
                        disabled={savingKey !== null}
                        className="modal-field-surface h-[44px] w-full appearance-none rounded-xl border px-3 pr-10 text-[13px] text-foreground outline-none disabled:pointer-events-none disabled:opacity-50"
                      >
                        <option value="" disabled hidden>{t('memory.modelPlaceholder')}</option>
                        {settings.availableModels.map((group) => (
                          <optgroup key={group.providerId} label={group.providerName}>
                            {group.modelRefs.map((modelRef) => (
                              <option key={modelRef} value={modelRef}>{modelRef}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground">
                        <ChevronDown className="h-4 w-4" />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
