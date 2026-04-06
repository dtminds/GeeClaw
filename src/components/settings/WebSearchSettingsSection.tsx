import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Eye, EyeOff, Loader2, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toUserMessage } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import {
  WEB_SEARCH_SHARED_DEFAULTS,
  type WebSearchProviderAvailability,
  type WebSearchProviderDescriptor,
  type WebSearchProviderField,
  type WebSearchProvidersResponse,
  type WebSearchSettingsPatch,
  type WebSearchSettingsResponse,
} from '@/lib/web-search-settings';

const HIDDEN_PROVIDER_IDS = new Set(['duckduckgo', 'ollama']);
const AUTO_PROVIDER_KEY = '__auto__';

function normalizeSharedNumber(value: string, fallback: number, minimum: number, maximum?: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const clamped = Math.max(minimum, parsed);
  return typeof maximum === 'number' ? Math.min(maximum, clamped) : clamped;
}

function getFieldStringValue(fieldValue: unknown): string {
  return typeof fieldValue === 'string' ? fieldValue : '';
}

function getComparableProviderConfig(config: Record<string, unknown> | undefined): [string, unknown][] {
  return Object.entries(config ?? {})
    .filter(([, value]) => value !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
}

function hasSavedProviderConfig(
  currentConfig: Record<string, unknown> | undefined,
  savedConfig: Record<string, unknown> | undefined,
): boolean {
  const comparableSavedConfig = getComparableProviderConfig(savedConfig);
  if (comparableSavedConfig.length === 0) {
    return false;
  }

  const comparableCurrentConfig = getComparableProviderConfig(currentConfig);
  if (comparableCurrentConfig.length !== comparableSavedConfig.length) {
    return false;
  }

  return comparableCurrentConfig.every(([currentKey, currentValue], index) => {
    const [savedKey, savedValue] = comparableSavedConfig[index];
    return currentKey === savedKey && currentValue === savedValue;
  });
}

function providerHasSavedConfig(
  savedProviderConfigByProvider: Record<string, Record<string, unknown>>,
  providerId: string,
): boolean {
  return getComparableProviderConfig(savedProviderConfigByProvider[providerId]).length > 0;
}

function getLocalizedProviderRuntimeHint(
  provider: WebSearchProviderDescriptor,
  t: (key: string, options?: { defaultValue?: string }) => string,
): string {
  return t(`webSearch.providers.${provider.providerId}.runtimeHint`, {
    defaultValue: t('webSearch.provider.runtimeHint', {
      defaultValue: provider.runtimeRequirementHint,
    }),
  });
}

function formatProviderList(labels: string[], locale: string): string {
  if (labels.length === 0) {
    return '';
  }

  try {
    return new Intl.ListFormat(locale, {
      style: 'long',
      type: 'conjunction',
    }).format(labels);
  } catch {
    return labels.join(', ');
  }
}

function getAvailabilityLabel(
  availability: WebSearchProviderAvailability | undefined,
  t: (key: string) => string,
): string {
  switch (availability?.source) {
    case 'saved':
    case 'environment':
      return t('webSearch.provider.available');
    case 'built-in':
      return t('webSearch.provider.builtIn');
    case 'runtime-prereq':
      return t('webSearch.provider.runtimePrereq');
    default:
      return t('webSearch.provider.unavailable');
  }
}

function formatEnvFallbackLabel(
  provider: WebSearchProviderDescriptor,
  t: (key: string, options?: { envVars?: string }) => string,
): string {
  const envVars = provider.envVars.map((envVar) => (
    `${envVar} (${provider.envVarStatuses?.[envVar] ? t('webSearch.provider.available') : t('webSearch.provider.unavailable')})`
  ));

  return t('webSearch.provider.envFallback', {
    envVars: envVars.join(', '),
  });
}

function resolveSelectedProviderKey(
  currentSelectedProviderKey: string | undefined,
  defaultProvider: string,
  visibleProviders: WebSearchProviderDescriptor[],
): string {
  if (currentSelectedProviderKey === AUTO_PROVIDER_KEY) {
    return AUTO_PROVIDER_KEY;
  }

  if (currentSelectedProviderKey && currentSelectedProviderKey !== AUTO_PROVIDER_KEY) {
    const currentSelectionExists = visibleProviders.some((entry) => entry.providerId === currentSelectedProviderKey);
    if (currentSelectionExists) {
      return currentSelectedProviderKey;
    }
  }

  if (defaultProvider) {
    const defaultExists = visibleProviders.some((entry) => entry.providerId === defaultProvider);
    if (defaultExists) {
      return defaultProvider;
    }
  }

  return AUTO_PROVIDER_KEY;
}

export function WebSearchSettingsSection() {
  const { t, i18n } = useTranslation('settings');
  const loadFailedLabel = t('webSearch.toast.loadFailed');
  const [providers, setProviders] = useState<WebSearchProviderDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [pendingDeleteProviderId, setPendingDeleteProviderId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [defaultProvider, setDefaultProvider] = useState('');
  const [selectedProviderKey, setSelectedProviderKey] = useState(AUTO_PROVIDER_KEY);
  const [maxResults, setMaxResults] = useState(String(WEB_SEARCH_SHARED_DEFAULTS.maxResults));
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(WEB_SEARCH_SHARED_DEFAULTS.timeoutSeconds));
  const [cacheTtlMinutes, setCacheTtlMinutes] = useState(String(WEB_SEARCH_SHARED_DEFAULTS.cacheTtlMinutes));
  const [providerConfigByProvider, setProviderConfigByProvider] = useState<Record<string, Record<string, unknown>>>({});
  const [savedProviderConfigByProvider, setSavedProviderConfigByProvider] = useState<Record<string, Record<string, unknown>>>({});
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});

  const visibleProviders = providers.filter((entry) => !HIDDEN_PROVIDER_IDS.has(entry.providerId));

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const [providersResponse, settingsResponse] = await Promise.all([
          hostApiFetch<WebSearchProvidersResponse>('/api/settings/web-search/providers'),
          hostApiFetch<WebSearchSettingsResponse>('/api/settings/web-search'),
        ]);

        if (cancelled) {
          return;
        }

        const nextProviders = Array.isArray(providersResponse.providers) ? providersResponse.providers : [];
        const nextVisibleProviders = nextProviders.filter((entry) => !HIDDEN_PROVIDER_IDS.has(entry.providerId));
        const nextDefaultProvider = typeof settingsResponse.search.provider === 'string' ? settingsResponse.search.provider : '';
        const nextProviderConfigs = settingsResponse.providerConfigByProvider ?? {};

        setProviders(nextProviders);
        setEnabled(settingsResponse.search.enabled !== false);
        setDefaultProvider(nextDefaultProvider);
        setSelectedProviderKey(resolveSelectedProviderKey(undefined, nextDefaultProvider, nextVisibleProviders));
        setMaxResults(String(settingsResponse.search.maxResults ?? WEB_SEARCH_SHARED_DEFAULTS.maxResults));
        setTimeoutSeconds(String(settingsResponse.search.timeoutSeconds ?? WEB_SEARCH_SHARED_DEFAULTS.timeoutSeconds));
        setCacheTtlMinutes(String(settingsResponse.search.cacheTtlMinutes ?? WEB_SEARCH_SHARED_DEFAULTS.cacheTtlMinutes));
        setProviderConfigByProvider(nextProviderConfigs);
        setSavedProviderConfigByProvider(nextProviderConfigs);
      } catch (error) {
        if (!cancelled) {
          toast.error(`${loadFailedLabel}: ${toUserMessage(error)}`);
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
  }, [loadFailedLabel]);

  useEffect(() => {
    setSelectedProviderKey((current) => resolveSelectedProviderKey(current, defaultProvider, visibleProviders));
  }, [defaultProvider, visibleProviders]);

  const selectedProvider = visibleProviders.find((entry) => entry.providerId === selectedProviderKey) ?? null;
  const selectedProviderConfig = selectedProvider
    ? (providerConfigByProvider[selectedProvider.providerId] ?? {})
    : {};
  const savedSelectedProviderConfig = selectedProvider
    ? (savedProviderConfigByProvider[selectedProvider.providerId] ?? {})
    : {};
  const availableProviders = visibleProviders.filter((entry) => entry.availability?.available);
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  const automaticProviderHelp = availableProviders.length > 0
    ? t('webSearch.shared.autoReady', {
      providers: formatProviderList(
        availableProviders.map((entry) => entry.label),
        locale,
      ),
    })
    : t('webSearch.shared.autoUnavailable');
  const isAutoSelected = selectedProvider === null;
  const isAutoDefault = defaultProvider === '';
  const isSelectedProviderDefault = Boolean(selectedProvider && selectedProvider.providerId === defaultProvider);
  const selectedProviderHasSavedConfig = selectedProvider
    ? providerHasSavedConfig(savedProviderConfigByProvider, selectedProvider.providerId)
    : false;

  const syncFromSettings = (
    settingsResponse: WebSearchSettingsResponse,
    currentSelectionKey: string,
  ) => {
    const nextDefaultProvider = typeof settingsResponse.search.provider === 'string' ? settingsResponse.search.provider : '';
    const nextProviderConfigs = settingsResponse.providerConfigByProvider ?? {};

    setEnabled(settingsResponse.search.enabled !== false);
    setDefaultProvider(nextDefaultProvider);
    setSelectedProviderKey(resolveSelectedProviderKey(currentSelectionKey, nextDefaultProvider, visibleProviders));
    setMaxResults(String(settingsResponse.search.maxResults ?? WEB_SEARCH_SHARED_DEFAULTS.maxResults));
    setTimeoutSeconds(String(settingsResponse.search.timeoutSeconds ?? WEB_SEARCH_SHARED_DEFAULTS.timeoutSeconds));
    setCacheTtlMinutes(String(settingsResponse.search.cacheTtlMinutes ?? WEB_SEARCH_SHARED_DEFAULTS.cacheTtlMinutes));
    setProviderConfigByProvider(nextProviderConfigs);
    setSavedProviderConfigByProvider(nextProviderConfigs);
  };

  const handleProviderFieldChange = (providerId: string, fieldKey: string, value: unknown) => {
    setProviderConfigByProvider((current) => ({
      ...current,
      [providerId]: {
        ...(current[providerId] ?? {}),
        [fieldKey]: value,
      },
    }));
  };

  const handleSecretVisibilityToggle = (providerId: string, fieldKey: string) => {
    const compositeKey = `${providerId}:${fieldKey}`;
    setRevealedSecrets((current) => ({
      ...current,
      [compositeKey]: !current[compositeKey],
    }));
  };

  const handleSave = async () => {
    const payload: WebSearchSettingsPatch = {
      enabled,
      provider: defaultProvider || null,
      shared: {
        maxResults: normalizeSharedNumber(maxResults, WEB_SEARCH_SHARED_DEFAULTS.maxResults, 1, 10),
        timeoutSeconds: normalizeSharedNumber(timeoutSeconds, WEB_SEARCH_SHARED_DEFAULTS.timeoutSeconds, 1),
        cacheTtlMinutes: normalizeSharedNumber(cacheTtlMinutes, WEB_SEARCH_SHARED_DEFAULTS.cacheTtlMinutes, 0),
      },
    };

    if (selectedProvider) {
      payload.providerConfig = {
        providerId: selectedProvider.providerId,
        values: selectedProviderConfig,
      };
    }

    setSaving(true);
    try {
      const response = await hostApiFetch<{ settings?: WebSearchSettingsResponse }>('/api/settings/web-search', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.settings) {
        syncFromSettings(response.settings, selectedProviderKey);
      } else if (selectedProvider) {
        setSavedProviderConfigByProvider((current) => ({
          ...current,
          [selectedProvider.providerId]: {
            ...selectedProviderConfig,
          },
        }));
      }

      toast.success(t('webSearch.toast.saved'));
    } catch (error) {
      toast.error(`${t('webSearch.toast.saveFailed')}: ${toUserMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProviderConfig = async (providerId: string) => {
    setDeletingProviderId(providerId);
    try {
      const response = await hostApiFetch<{ settings?: WebSearchSettingsResponse }>(
        `/api/settings/web-search/providers/${providerId}`,
        { method: 'DELETE' },
      );

      if (response.settings) {
        syncFromSettings(response.settings, providerId);
      } else {
        setProviderConfigByProvider((current) => {
          const next = { ...current };
          delete next[providerId];
          return next;
        });
        setSavedProviderConfigByProvider((current) => {
          const next = { ...current };
          delete next[providerId];
          return next;
        });
      }

      setPendingDeleteProviderId(null);
      toast.success(t('webSearch.toast.deleted'));
    } catch (error) {
      toast.error(`${t('webSearch.toast.deleteFailed')}: ${toUserMessage(error)}`);
    } finally {
      setDeletingProviderId(null);
    }
  };

  const renderProviderField = (field: WebSearchProviderField) => {
    const fieldId = `web-search-provider-${selectedProvider?.providerId}-${field.key}`;
    const fieldValue = selectedProvider ? selectedProviderConfig[field.key] : undefined;

    if (field.type === 'boolean') {
      return (
        <div key={field.key} className="rounded-2xl border border-black/8 bg-black/[0.025] p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor={fieldId}>{field.label ?? field.key}</Label>
              {field.help ? <p className="text-sm text-muted-foreground">{field.help}</p> : null}
            </div>
            <Switch
              id={fieldId}
              checked={fieldValue === true}
              onCheckedChange={(checked) => {
                if (selectedProvider) {
                  handleProviderFieldChange(selectedProvider.providerId, field.key, checked);
                }
              }}
            />
          </div>
        </div>
      );
    }

    if (field.type === 'enum') {
      return (
        <div key={field.key} className="space-y-2">
          <Label htmlFor={fieldId}>{field.label ?? field.key}</Label>
          <Select
            id={fieldId}
            value={getFieldStringValue(fieldValue)}
            onChange={(event) => {
              if (selectedProvider) {
                handleProviderFieldChange(selectedProvider.providerId, field.key, event.target.value);
              }
            }}
            className="field-focus-ring h-[40px] rounded-xl border border-black/8 bg-black/[0.025] shadow-none dark:border-white/10 dark:bg-white/[0.03]"
          >
            {(field.enumValues ?? []).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
        </div>
      );
    }

    const compositeKey = `${selectedProvider?.providerId}:${field.key}`;
    const isSecret = field.type === 'secret';
    const revealed = revealedSecrets[compositeKey] === true;
    const helpText = isSecret ? undefined : field.help;

    return (
      <div key={field.key} className="space-y-2">
        <Label htmlFor={fieldId}>{field.label ?? field.key}</Label>
        <div className="relative">
          <Input
            id={fieldId}
            value={getFieldStringValue(fieldValue)}
            onChange={(event) => {
              if (selectedProvider) {
                handleProviderFieldChange(selectedProvider.providerId, field.key, event.target.value);
              }
            }}
            placeholder={field.placeholder}
            type={isSecret && !revealed ? 'password' : 'text'}
            className="field-focus-ring h-[40px] rounded-xl border border-black/8 bg-black/[0.025] pr-12 font-mono text-[13px] shadow-none dark:border-white/10 dark:bg-white/[0.03]"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {isSecret ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1 h-8 w-8 rounded-xl"
              onClick={() => {
                if (selectedProvider) {
                  handleSecretVisibilityToggle(selectedProvider.providerId, field.key);
                }
              }}
              aria-label={revealed ? t('webSearch.provider.hide') : t('webSearch.provider.reveal')}
            >
              {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          ) : null}
        </div>
        {helpText ? <p className="text-sm text-muted-foreground">{helpText}</p> : null}
        {isSecret && selectedProvider?.envVars.length ? (
          <p className="text-sm text-muted-foreground">
            {formatEnvFallbackLabel(selectedProvider, t)}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <h2 className="modal-title">{t('webSearch.title')}</h2>
        <p className="modal-description">{t('webSearch.description')}</p>
      </div>

      <section className="modal-section-surface rounded-3xl border p-5">
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="web-search-enabled">{t('webSearch.shared.enabled')}</Label>
            </div>
            <Switch
              id="web-search-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={loading}
            />
          </div>

          {enabled ? (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="web-search-max-results">{t('webSearch.shared.maxResults')}</Label>
                <Input
                  id="web-search-max-results"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10}
                  value={maxResults}
                  onChange={(event) => setMaxResults(event.target.value)}
                  className="field-focus-ring h-[40px] rounded-xl border border-black/8 bg-black/[0.025] shadow-none dark:border-white/10 dark:bg-white/[0.03]"
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="web-search-timeout-seconds">{t('webSearch.shared.timeoutSeconds')}</Label>
                <Input
                  id="web-search-timeout-seconds"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={timeoutSeconds}
                  onChange={(event) => setTimeoutSeconds(event.target.value)}
                  className="field-focus-ring h-[40px] rounded-xl border border-black/8 bg-black/[0.025] shadow-none dark:border-white/10 dark:bg-white/[0.03]"
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="web-search-cache-ttl-minutes">{t('webSearch.shared.cacheTtlMinutes')}</Label>
                <Input
                  id="web-search-cache-ttl-minutes"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={cacheTtlMinutes}
                  onChange={(event) => setCacheTtlMinutes(event.target.value)}
                  className="field-focus-ring h-[40px] rounded-xl border border-black/8 bg-black/[0.025] shadow-none dark:border-white/10 dark:bg-white/[0.03]"
                  disabled={loading}
                />
              </div>
            </div>
          ) : null}

          {!enabled ? (
            <div className="flex justify-end">
              <Button
                type="button"
                className="rounded-full"
                onClick={() => void handleSave()}
                disabled={loading || saving}
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('webSearch.actions.save')}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      {enabled ? (
        <section className="overflow-hidden rounded-[20px] border border-black/8 bg-card dark:border-white/10">
          <div className="grid xl:grid-cols-[225px_minmax(0,1fr)]">
            <div className="bg-card py-4">
              <div className="space-y-1">
                <div
                  className={cn(
                    'group flex items-center gap-2 px-4 py-0.5 transition-colors',
                    isAutoSelected
                      ? 'bg-black/[0.055] text-foreground dark:bg-white/[0.07]'
                      : 'text-foreground/88 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedProviderKey(AUTO_PROVIDER_KEY)}
                    className="flex min-h-10 min-w-0 flex-1 items-center gap-2 py-1 text-left"
                  >
                    <div className="min-w-0 flex-1 truncate text-[14px] font-normal text-foreground">
                      {t('webSearch.shared.providerAuto')}
                    </div>
                    {isAutoDefault ? (
                      <Star
                        className="mr-1 h-3.5 w-3.5 shrink-0 fill-current text-amber-500"
                        aria-label={t('webSearch.provider.default')}
                      />
                    ) : null}
                  </button>

                  <span className="ml-2 shrink-0 text-[11px] text-muted-foreground/70">
                    {t('webSearch.sidebar.auto')}
                  </span>
                </div>

                {visibleProviders.map((entry) => {
                  const isSelected = selectedProvider?.providerId === entry.providerId;
                  const isAvailable = entry.availability?.available === true;
                  const isDefault = defaultProvider === entry.providerId;

                  return (
                    <div
                      key={entry.providerId}
                      className={cn(
                        'group flex items-center gap-2 px-4 py-0.5 transition-colors',
                        isSelected
                          ? 'bg-black/[0.055] text-foreground dark:bg-white/[0.07]'
                          : 'text-foreground/88 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedProviderKey(entry.providerId)}
                        className="flex min-h-10 min-w-0 flex-1 items-center gap-2 py-1 text-left"
                      >
                        <div className="min-w-0 flex-1 truncate text-[14px] font-normal text-foreground">
                          {entry.label}
                        </div>
                        {isDefault ? (
                          <Star
                            className="mr-1 h-3.5 w-3.5 shrink-0 fill-current text-amber-500"
                            aria-label={t('webSearch.provider.default')}
                          />
                        ) : null}
                      </button>

                      <span
                        className={cn(
                          'ml-2 shrink-0 text-[11px]',
                          isAvailable
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-muted-foreground/40',
                        )}
                      >
                        {getAvailabilityLabel(entry.availability, t)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-black/6 bg-card dark:border-white/10 xl:border-l xl:border-t-0">
              {isAutoSelected ? (
                <div className="flex h-full flex-col p-4 md:p-5 xl:p-6">
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="flex min-w-0 items-center gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-[22px] font-semibold text-foreground">
                              {t('webSearch.auto.title')}
                            </h3>
                            {isAutoDefault ? (
                              <span className="inline-flex items-center rounded-full border border-black/8 bg-black/[0.045] px-2.5 py-1 text-[11px] font-medium text-foreground/75 dark:border-white/10 dark:bg-white/[0.08] dark:text-foreground/85">
                                {t('webSearch.provider.default')}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 text-[13px] text-muted-foreground">
                            {t('webSearch.auto.description')}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-dashed border-black/8 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.03]">
                      <p className="text-[15px] font-medium text-foreground">
                        {automaticProviderHelp}
                      </p>
                      {!isAutoDefault ? (
                        <Button
                          type="button"
                          onClick={() => setDefaultProvider('')}
                          className="mt-4 h-10 rounded-full px-5 text-[13px] font-medium shadow-none"
                        >
                          {t('webSearch.actions.setDefault')}
                        </Button>
                      ) : null}
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        className="rounded-full"
                        onClick={() => void handleSave()}
                        disabled={loading || saving}
                      >
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {t('webSearch.actions.save')}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : selectedProvider ? (
                <div className="flex h-full flex-col p-4 md:p-5 xl:p-6">
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="flex min-w-0 items-center gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-[22px] font-semibold text-foreground">{selectedProvider.label}</h3>
                            {isSelectedProviderDefault ? (
                              <span className="inline-flex items-center rounded-full border border-black/8 bg-black/[0.045] px-2.5 py-1 text-[11px] font-medium text-foreground/75 dark:border-white/10 dark:bg-white/[0.08] dark:text-foreground/85">
                                {t('webSearch.provider.default')}
                              </span>
                            ) : null}
                            {hasSavedProviderConfig(selectedProviderConfig, savedSelectedProviderConfig) ? (
                              <span className="inline-flex items-center rounded-full border border-black/8 bg-black/[0.045] px-2.5 py-1 text-[11px] font-medium text-foreground/75 dark:border-white/10 dark:bg-white/[0.08] dark:text-foreground/85">
                                {t('webSearch.provider.configured')}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                        {!isSelectedProviderDefault ? (
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-9 px-3 text-[13px] text-muted-foreground shadow-none"
                            onClick={() => setDefaultProvider(selectedProvider.providerId)}
                          >
                            {t('webSearch.actions.setDefault')}
                          </Button>
                        ) : null}
                        <a
                          href={selectedProvider.signupUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[13px] font-medium text-info hover:opacity-80"
                        >
                          {t('webSearch.provider.signup')}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        {selectedProvider.docsUrl ? (
                          <a
                            href={selectedProvider.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[13px] font-medium text-info hover:opacity-80"
                          >
                            {t('webSearch.provider.docs')}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                    </div>

                    <div className="space-y-4 border-t border-black/6 pt-5 dark:border-white/10">
                      {selectedProvider.runtimeRequirementHint ? (
                        <div className="rounded-2xl border border-black/8 bg-black/[0.025] p-4 dark:border-white/10 dark:bg-white/[0.03]">
                          <p className="text-sm text-muted-foreground">{getLocalizedProviderRuntimeHint(selectedProvider, t)}</p>
                        </div>
                      ) : null}

                      {selectedProvider.fields.length > 0 ? (
                        selectedProvider.fields.map(renderProviderField)
                      ) : (
                        <div className="rounded-2xl border border-black/8 bg-black/[0.025] px-4 py-3 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
                          {t('webSearch.provider.emptyFields')}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap justify-end gap-3 border-t border-black/6 pt-5 dark:border-white/10">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-full"
                        onClick={() => setPendingDeleteProviderId(selectedProvider.providerId)}
                        disabled={!selectedProviderHasSavedConfig || isSelectedProviderDefault || deletingProviderId === selectedProvider.providerId}
                        title={isSelectedProviderDefault ? t('webSearch.actions.deleteDisabledDefault') : undefined}
                      >
                        {deletingProviderId === selectedProvider.providerId ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        {t('webSearch.actions.delete')}
                      </Button>
                      <Button
                        type="button"
                        className="rounded-full"
                        onClick={() => void handleSave()}
                        disabled={loading || saving}
                      >
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {t('webSearch.actions.save')}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {pendingDeleteProviderId && createPortal(
        <div className="overlay-backdrop fixed inset-0 z-[140] flex items-center justify-center p-4">
          <div className="modal-card-surface w-full max-w-sm rounded-3xl border p-6 shadow-none">
            <div className="space-y-1">
              <p className="modal-title text-[17px]">{t('webSearch.deleteConfirm.title')}</p>
              <p className="modal-description">
                {t('webSearch.deleteConfirm.description', {
                  name: visibleProviders.find((entry) => entry.providerId === pendingDeleteProviderId)?.label ?? pendingDeleteProviderId,
                })}
              </p>
            </div>
            <div className="modal-footer mt-5">
              <button
                type="button"
                className="modal-secondary-button"
                onClick={() => setPendingDeleteProviderId(null)}
                disabled={deletingProviderId === pendingDeleteProviderId}
              >
                {t('webSearch.deleteConfirm.cancel')}
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-full bg-destructive px-5 text-[13px] font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
                disabled={deletingProviderId === pendingDeleteProviderId}
                onClick={() => void handleDeleteProviderConfig(pendingDeleteProviderId)}
              >
                {deletingProviderId === pendingDeleteProviderId ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : null}
                {t('webSearch.deleteConfirm.confirm')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default WebSearchSettingsSection;
