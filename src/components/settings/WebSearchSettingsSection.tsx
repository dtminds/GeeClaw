import { useEffect, useState } from 'react';
import { ExternalLink, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toUserMessage } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import {
  WEB_SEARCH_SHARED_DEFAULTS,
  type WebSearchProviderAvailability,
  type WebSearchProviderDescriptor,
  type WebSearchProviderField,
  type WebSearchProvidersResponse,
  type WebSearchSettingsPatch,
  type WebSearchSettingsResponse,
} from '@/lib/web-search-settings';

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

function getLocalizedProviderHint(
  provider: WebSearchProviderDescriptor,
  t: (key: string, options?: { defaultValue?: string }) => string,
): string {
  return t(`webSearch.providers.${provider.providerId}.hint`, { defaultValue: provider.hint });
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
  return availability?.available ? t('webSearch.provider.available') : t('webSearch.provider.unavailable');
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

export function WebSearchSettingsSection() {
  const { t, i18n } = useTranslation('settings');
  const loadFailedLabel = t('webSearch.toast.loadFailed');
  const [providers, setProviders] = useState<WebSearchProviderDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState('');
  const [maxResults, setMaxResults] = useState(String(WEB_SEARCH_SHARED_DEFAULTS.maxResults));
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(WEB_SEARCH_SHARED_DEFAULTS.timeoutSeconds));
  const [cacheTtlMinutes, setCacheTtlMinutes] = useState(String(WEB_SEARCH_SHARED_DEFAULTS.cacheTtlMinutes));
  const [providerConfigByProvider, setProviderConfigByProvider] = useState<Record<string, Record<string, unknown>>>({});
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});

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

        setProviders(Array.isArray(providersResponse.providers) ? providersResponse.providers : []);
        setEnabled(settingsResponse.search.enabled === true);
        setProvider(typeof settingsResponse.search.provider === 'string' ? settingsResponse.search.provider : '');
        setMaxResults(String(settingsResponse.search.maxResults ?? WEB_SEARCH_SHARED_DEFAULTS.maxResults));
        setTimeoutSeconds(String(settingsResponse.search.timeoutSeconds ?? WEB_SEARCH_SHARED_DEFAULTS.timeoutSeconds));
        setCacheTtlMinutes(String(settingsResponse.search.cacheTtlMinutes ?? WEB_SEARCH_SHARED_DEFAULTS.cacheTtlMinutes));
        setProviderConfigByProvider(settingsResponse.providerConfigByProvider ?? {});
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

  const selectedProvider = providers.find((entry) => entry.providerId === provider) ?? null;
  const selectedProviderConfig = selectedProvider
    ? (providerConfigByProvider[selectedProvider.providerId] ?? {})
    : {};
  const availableProviders = providers.filter((entry) => entry.availability?.available);
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  const automaticProviderHelp = availableProviders.length > 0
    ? t('webSearch.shared.autoReady', {
      providers: formatProviderList(
        availableProviders.map((entry) => entry.label),
        locale,
      ),
    })
    : t('webSearch.shared.autoUnavailable');

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
      provider: provider || undefined,
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
        setEnabled(response.settings.search.enabled === true);
        setProvider(typeof response.settings.search.provider === 'string' ? response.settings.search.provider : '');
        setMaxResults(String(response.settings.search.maxResults ?? WEB_SEARCH_SHARED_DEFAULTS.maxResults));
        setTimeoutSeconds(String(response.settings.search.timeoutSeconds ?? WEB_SEARCH_SHARED_DEFAULTS.timeoutSeconds));
        setCacheTtlMinutes(String(response.settings.search.cacheTtlMinutes ?? WEB_SEARCH_SHARED_DEFAULTS.cacheTtlMinutes));
        setProviderConfigByProvider(response.settings.providerConfigByProvider ?? {});
      }

      toast.success(t('webSearch.toast.saved'));
    } catch (error) {
      toast.error(`${t('webSearch.toast.saveFailed')}: ${toUserMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const renderProviderField = (field: WebSearchProviderField) => {
    const fieldId = `web-search-provider-${selectedProvider?.providerId}-${field.key}`;
    const fieldValue = selectedProvider ? selectedProviderConfig[field.key] : undefined;

    if (field.type === 'boolean') {
      return (
        <div key={field.key} className="modal-field-surface rounded-2xl border p-4">
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
            className="modal-field-surface h-11 rounded-xl"
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
            className="modal-field-surface h-11 rounded-xl pr-12 font-mono text-[13px]"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {isSecret ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1 h-9 w-9 rounded-xl"
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
            <>
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
                    className="modal-field-surface h-11 rounded-xl"
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
                    className="modal-field-surface h-11 rounded-xl"
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
                    className="modal-field-surface h-11 rounded-xl"
                    disabled={loading}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
      </section>

      {enabled ? (
        <section className="modal-section-surface rounded-3xl border p-5">
          <div className="flex flex-col gap-5">
            <div className="space-y-2">
              <Label htmlFor="web-search-provider">{t('webSearch.shared.provider')}</Label>
              <Select
                id="web-search-provider"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                className="modal-field-surface h-11 rounded-xl"
                disabled={loading}
              >
                <option value="">{t('webSearch.shared.providerAuto')}</option>
                {providers.map((entry) => {
                  return (
                    <option key={entry.providerId} value={entry.providerId}>
                      {`${entry.label} · ${getAvailabilityLabel(entry.availability, t)}`}
                    </option>
                  );
                })}
              </Select>
              {!selectedProvider ? (
                <p className="text-sm text-muted-foreground">{automaticProviderHelp}</p>
              ) : null}
            </div>

            {selectedProvider ? (
              <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">{t('webSearch.provider.title')}</h3>
                <p className="text-sm text-muted-foreground">{getLocalizedProviderHint(selectedProvider, t)}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="rounded-full" asChild>
                  <a href={selectedProvider.signupUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {t('webSearch.provider.signup')}
                  </a>
                </Button>
                {selectedProvider.docsUrl ? (
                  <Button type="button" variant="outline" className="rounded-full" asChild>
                    <a href={selectedProvider.docsUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {t('webSearch.provider.docs')}
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>

              <div className="space-y-4">
                {Object.keys(selectedProviderConfig).length > 0 ? (
                  <div className="modal-field-surface rounded-2xl border px-4 py-3 text-sm text-muted-foreground">
                    {t('webSearch.provider.configured')}
                  </div>
                ) : null}
                {selectedProvider.fields.map(renderProviderField)}
              </div>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

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
  );
}

export default WebSearchSettingsSection;
