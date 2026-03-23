/**
 * Providers Settings Component
 * Manage AI provider configurations and API keys
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Eye,
  EyeOff,
  Check,
  X,
  Loader2,
  Key,
  ExternalLink,
  Copy,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  useProviderStore,
  type ProviderAccount,
  type ProviderConfig,
  type ProviderVendorInfo,
} from '@/stores/providers';
import {
  PROVIDER_TYPE_INFO,
  getProviderDocsUrl,
  type ProviderType,
  getProviderIconUrl,
  getConfiguredProviderModels,
  normalizeProviderModelList,
  resolveProviderApiKeyForSave,
  shouldShowProviderModelId,
  shouldInvertInDark,
} from '@/lib/providers';
import {
  buildProviderAccountId,
  buildProviderListItems,
  type ProviderListItem,
} from '@/lib/provider-accounts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { invokeIpc } from '@/lib/api-client';
import { useSettingsStore } from '@/stores/settings';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { AiSettingIcon, Delete02Icon, PinIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

function getProtocolBaseUrlPlaceholder(
  apiProtocol: ProviderAccount['apiProtocol'],
): string {
  if (apiProtocol === 'anthropic-messages') {
    return 'https://api.example.com/anthropic';
  }
  return 'https://api.example.com/v1';
}

function providerModelsEqual(a?: string[], b?: string[]): boolean {
  const left = normalizeProviderModelList(a);
  const right = normalizeProviderModelList(b);
  return left.length === right.length && left.every((model, index) => model === right[index]);
}

type ArkMode = 'apikey' | 'codeplan';

function isArkCodePlanMode(
  vendorId: string,
  baseUrl: string | undefined,
  models: string[] | undefined,
  codePlanPresetBaseUrl?: string,
  codePlanPresetModelId?: string,
): boolean {
  if (vendorId !== 'ark' || !codePlanPresetBaseUrl || !codePlanPresetModelId) {
    return false;
  }

  const normalizedModels = normalizeProviderModelList(models);
  return (
    (baseUrl || '').trim() === codePlanPresetBaseUrl
    && normalizedModels.length === 1
    && normalizedModels[0] === codePlanPresetModelId
  );
}

function getAuthModeLabel(
  authMode: ProviderAccount['authMode'],
  t: (key: string) => string
): string {
  switch (authMode) {
    case 'api_key':
      return t('aiProviders.authModes.apiKey');
    case 'oauth_device':
      return t('aiProviders.authModes.oauthDevice');
    case 'oauth_browser':
      return t('aiProviders.authModes.oauthBrowser');
    case 'local':
      return t('aiProviders.authModes.local');
    default:
      return authMode;
  }
}

export function ProvidersSettings() {
  const { t } = useTranslation('settings');
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const {
    statuses,
    accounts,
    vendors,
    defaultAccountId,
    loading,
    refreshProviderSnapshot,
    createAccount,
    removeAccount,
    updateAccount,
    setDefaultAccount,
    validateAccountApiKey,
  } = useProviderStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const existingVendorIds = new Set(accounts.map((account) => account.vendorId));
  const displayProviders = useMemo(
    () => buildProviderListItems(accounts, statuses, vendors, defaultAccountId),
    [accounts, statuses, vendors, defaultAccountId],
  );

  // Fetch providers on mount
  useEffect(() => {
    refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  const handleAddProvider = async (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: {
      baseUrl?: string;
      models?: string[];
      authMode?: ProviderAccount['authMode'];
      apiProtocol?: ProviderAccount['apiProtocol'];
    }
  ) => {
    const vendor = vendorMap.get(type);
    const id = buildProviderAccountId(type, null, vendors);
    const effectiveApiKey = resolveProviderApiKeyForSave(type, apiKey);
    try {
      await createAccount({
        id,
        vendorId: type,
        label: name,
        authMode: options?.authMode || vendor?.defaultAuthMode || (type === 'ollama' ? 'local' : 'api_key'),
        baseUrl: options?.baseUrl,
        apiProtocol: type === 'custom' || type === 'ollama'
          ? (options?.apiProtocol || 'openai-completions')
          : undefined,
        models: normalizeProviderModelList(options?.models),
        enabled: true,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, effectiveApiKey);

      // Auto-set as default if no default is currently configured
      if (!defaultAccountId) {
        await setDefaultAccount(id);
      }

      setShowAddDialog(false);
      toast.success(t('aiProviders.toast.added'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedAdd')}: ${error}`);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      await removeAccount(providerId);
      toast.success(t('aiProviders.toast.deleted'));
    } catch (error) {
      const message = String(error);
      if (message.includes('BLOCKED_BY_FALLBACK:')) {
        const refs = message.split('BLOCKED_BY_FALLBACK:')[1] ?? '';
        toast.error(t('aiProviders.toast.blockedByFallback', { refs }), {
          duration: 6000,
        });
      } else {
        toast.error(`${t('aiProviders.toast.failedDelete')}: ${error}`);
      }
    }
  };


  const handleSetDefault = async (providerId: string) => {
    try {
      await setDefaultAccount(providerId);
      toast.success(t('aiProviders.toast.defaultUpdated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDefault')}: ${error}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl text-foreground font-normal tracking-tight">
          {t('aiProviders.title', 'AI Providers')}
        </h2>
        <Button onClick={() => setShowAddDialog(true)} className="rounded-full px-5 h-9 shadow-none font-medium text-[13px]">
          <Plus className="h-4 w-4 mr-2" />
          {t('aiProviders.add')}
        </Button>
      </div>

      {loading ? (
        <div className="surface-muted flex items-center justify-center rounded-3xl border border-transparent border-dashed py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : displayProviders.length === 0 ? (
        <div className="surface-muted flex flex-col items-center justify-center rounded-3xl border border-transparent border-dashed py-20 text-muted-foreground">
          <Key className="h-12 w-12 mb-4 opacity-50" />
          <h3 className="text-[15px] font-medium mb-1 text-foreground">{t('aiProviders.empty.title')}</h3>
          <p className="text-[13px] text-center mb-6 max-w-sm">
            {t('aiProviders.empty.desc')}
          </p>
          <Button
            onClick={() => setShowAddDialog(true)}
            className="rounded-full border border-transparent bg-primary px-6 text-primary-foreground shadow-sm hover:bg-primary/90 h-10"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('aiProviders.empty.cta')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {displayProviders.map((item) => (
            <ProviderCard
              key={item.account.id}
              item={item}
              allProviders={displayProviders}
              isDefault={item.account.id === defaultAccountId}
              isEditing={editingProvider === item.account.id}
              onEdit={() => setEditingProvider(item.account.id)}
              onCancelEdit={() => setEditingProvider(null)}
              onDelete={() => handleDeleteProvider(item.account.id)}
              onSetDefault={() => handleSetDefault(item.account.id)}
              onSaveEdits={async (payload) => {
                const updates: Partial<ProviderAccount> = {};
                if (payload.updates) {
                  if (payload.updates.baseUrl !== undefined) updates.baseUrl = payload.updates.baseUrl;
                  if (payload.updates.apiProtocol !== undefined) updates.apiProtocol = payload.updates.apiProtocol;
                  if (payload.updates.models !== undefined) updates.models = payload.updates.models;
                  updates.model = undefined;
                  updates.fallbackModels = [];
                  updates.fallbackAccountIds = [];
                }
                await updateAccount(
                  item.account.id,
                  updates,
                  payload.newApiKey
                );
                setEditingProvider(null);
              }}
              onValidateKey={(key, options) => validateAccountApiKey(item.account.id, key, options)}
              devModeUnlocked={devModeUnlocked}
            />
          ))}
        </div>
      )}

      {/* Add Provider Dialog */}
      {showAddDialog && (
        <AddProviderDialog
          existingVendorIds={existingVendorIds}
          vendors={vendors}
          onClose={() => setShowAddDialog(false)}
          onAdd={handleAddProvider}
          onValidateKey={(type, key, options) => validateAccountApiKey(type, key, options)}
          devModeUnlocked={devModeUnlocked}
        />
      )}
    </div>
  );
}

interface ProviderCardProps {
  item: ProviderListItem;
  allProviders: ProviderListItem[];
  isDefault: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onSaveEdits: (payload: { newApiKey?: string; updates?: Partial<ProviderConfig> }) => Promise<void>;
  onValidateKey: (
    key: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  devModeUnlocked: boolean;
}



function ProviderCard({
  item,
  allProviders: _allProviders,
  isDefault,
  isEditing,
  onEdit,
  onCancelEdit,
  onDelete,
  onSetDefault,
  onSaveEdits,
  onValidateKey,
  devModeUnlocked,
}: ProviderCardProps) {
  const { t, i18n } = useTranslation('settings');
  const { account, vendor, status } = item;
  const configuredModels = useMemo(
    () => getConfiguredProviderModels(account),
    [account],
  );
  const [newKey, setNewKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(account.baseUrl || '');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>(
    account.apiProtocol || 'openai-completions'
  );
  const [modelsText, setModelsText] = useState(configuredModels.join('\n'));
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [arkMode, setArkMode] = useState<ArkMode>('apikey');

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === account.vendorId);
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const codePlanPreset = typeInfo?.codePlanPresetBaseUrl && typeInfo?.codePlanPresetModelId
    ? {
        baseUrl: typeInfo.codePlanPresetBaseUrl,
        modelId: typeInfo.codePlanPresetModelId,
      }
    : null;
  const effectiveDocsUrl = account.vendorId === 'ark' && arkMode === 'codeplan'
    ? (typeInfo?.codePlanDocsUrl || providerDocsUrl)
    : providerDocsUrl;
  const canEditProtocol = account.vendorId === 'custom';
  const canEditModelConfig = Boolean(typeInfo?.showBaseUrl || showModelIdField);

  useEffect(() => {
    if (isEditing) {
      setNewKey('');
      setShowKey(false);
      setBaseUrl(account.baseUrl || '');
      setApiProtocol(account.apiProtocol || 'openai-completions');
      setModelsText(configuredModels.join('\n'));
      setArkMode(
        isArkCodePlanMode(
          account.vendorId,
          account.baseUrl,
          configuredModels,
          typeInfo?.codePlanPresetBaseUrl,
          typeInfo?.codePlanPresetModelId,
        ) ? 'codeplan' : 'apikey'
      );
    }
  }, [
    isEditing,
    account.apiProtocol,
    account.baseUrl,
    account.vendorId,
    configuredModels,
    typeInfo?.codePlanPresetBaseUrl,
    typeInfo?.codePlanPresetModelId,
  ]);

  const handleSaveEdits = async () => {
    setSaving(true);
    try {
      const payload: { newApiKey?: string; updates?: Partial<ProviderConfig> } = {};
      const normalizedModels = normalizeProviderModelList(modelsText.split('\n'));

      if (newKey.trim()) {
        setValidating(true);
        const result = await onValidateKey(newKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: canEditProtocol ? apiProtocol : undefined,
        });
        setValidating(false);
        if (!result.valid) {
          toast.error(result.error || t('aiProviders.toast.invalidKey'));
          setSaving(false);
          return;
        }
        payload.newApiKey = newKey.trim();
      }

      {
        if (showModelIdField && normalizedModels.length === 0) {
          toast.error(t('aiProviders.toast.modelRequired'));
          setSaving(false);
          return;
        }

        const updates: Partial<ProviderConfig> = {};
        if (typeInfo?.showBaseUrl && (baseUrl.trim() || undefined) !== (account.baseUrl || undefined)) {
          updates.baseUrl = baseUrl.trim() || undefined;
        }
        if (canEditProtocol && apiProtocol !== (account.apiProtocol || 'openai-completions')) {
          updates.apiProtocol = apiProtocol || 'openai-completions';
        }
        if (showModelIdField && !providerModelsEqual(normalizedModels, configuredModels)) {
          updates.models = normalizedModels;
        }
        if (Object.keys(updates).length > 0) {
          payload.updates = updates;
        }
      }

      // Keep Ollama key optional in UI, but persist a placeholder when
      // editing legacy configs that have no stored key.
      if (account.vendorId === 'ollama' && !status?.hasKey && !payload.newApiKey) {
        payload.newApiKey = resolveProviderApiKeyForSave(account.vendorId, '') as string;
      }

      if (!payload.newApiKey && !payload.updates) {
        onCancelEdit();
        setSaving(false);
        return;
      }

      await onSaveEdits(payload);
      setNewKey('');
      toast.success(t('aiProviders.toast.updated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };

  return (
    <div
      className={cn(
        "group flex flex-col p-4 rounded-2xl transition-all relative overflow-hidden",
        isDefault
          ? "border border-info/20 bg-card shadow-sm ring-1 ring-info/20"
          : "surface-muted border border-transparent"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={cn("h-[42px] w-[42px] shrink-0 flex items-center justify-center text-foreground rounded-full group-hover:scale-105 transition-transform", isDefault ? "surface-muted" : "bg-white dark:bg-[#1a1a19]")}>
            {getProviderIconUrl(account.vendorId) ? (
              <img src={getProviderIconUrl(account.vendorId)} alt={typeInfo?.name || account.vendorId} className={cn('h-5 w-5', shouldInvertInDark(account.vendorId) && 'dark:invert')} />
            ) : (
              <span className="text-xl">{vendor?.icon || typeInfo?.icon || '⚙️'}</span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[15px]">{account.label}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[13px] text-muted-foreground">
              <span className="capitalize">{vendor?.name || account.vendorId}</span>
              <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
              <span>{getAuthModeLabel(account.authMode, t)}</span>
              {configuredModels.length > 0 && (
                <>
                  <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                  <span className="truncate max-w-[240px]">
                    {configuredModels.slice(0, 2).join(', ')}
                    {configuredModels.length > 2 ? ` +${configuredModels.length - 2}` : ''}
                  </span>
                </>
              )}
              <span className="flex items-center gap-1">
                {status?.hasKey ? (
                  <><div className="w-1.5 h-1.5 rounded-full bg-green-500" /> {t('aiProviders.card.configured')}</>
                ) : (
                  <><div className="w-1.5 h-1.5 rounded-full bg-red-500" /> {t('aiProviders.dialog.apiKeyMissing')}</>
                )}
              </span>
            </div>
          </div>
        </div>

        {!isEditing && (
          <div className="flex items-center gap-1 transition-opacity">
            {isDefault ?
              <span className="flex items-center gap-1 rounded-full border border-info/20 bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info">
                <Check className="h-3 w-3" />
                默认提供商
              </span>
            :
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground hover:bg-card hover:text-info"
                onClick={onSetDefault}
                title={t('aiProviders.card.setDefault')}
              >
                <HugeiconsIcon icon={PinIcon} className="h-4 w-4" />
              </Button>
            }
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-white dark:hover:bg-[#1a1a19]"
              onClick={onEdit}
              title={t('aiProviders.card.editKey')}
            >
              <HugeiconsIcon icon={AiSettingIcon} className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={isDefault}
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-white dark:hover:bg-[#1a1a19] disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => setConfirmingDelete(true)}
              title={isDefault ? t('aiProviders.card.deleteDisabledDefault') : t('aiProviders.card.delete')}
            >
              <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {confirmingDelete && createPortal(
        <div className="overlay-backdrop fixed inset-0 z-[140] flex items-center justify-center p-4">
          <div className="modal-card-surface w-full max-w-sm rounded-3xl border shadow-2xl p-6 flex flex-col gap-4">
            <div>
              <p className="modal-title text-[17px]">{t('aiProviders.card.deleteConfirmTitle')}</p>
              <p className="modal-description mt-1">
                {t('aiProviders.card.deleteConfirmDesc', { name: account.label })}
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="modal-secondary-button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
              >
                {t('aiProviders.dialog.cancel')}
              </button>
              <button
                type="button"
                className="rounded-full px-5 h-9 text-[13px] font-medium bg-destructive text-white hover:bg-destructive/90 transition-colors disabled:opacity-50"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await onDelete();
                  } finally {
                    setDeleting(false);
                    setConfirmingDelete(false);
                  }
                }}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : null}
                {t('aiProviders.card.deleteConfirm')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {isEditing && (
        <div className="space-y-4 mt-4 pt-4 border-t border-black/5 dark:border-white/5">
          {effectiveDocsUrl && (
            <div className="flex justify-end -mt-2 mb-2">
              <a
                href={effectiveDocsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-info inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-80"
              >
                {t('aiProviders.dialog.customDoc')}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          {canEditModelConfig && (
            <div className="modal-section-surface space-y-3 rounded-xl border p-4">
              <p className="text-[14px] font-bold text-foreground/80">{t('aiProviders.sections.model')}</p>
              {typeInfo?.showBaseUrl && (
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.baseUrl')}</Label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={getProtocolBaseUrlPlaceholder(apiProtocol)}
                    className="modal-field-surface field-focus-ring h-[40px] rounded-xl font-mono text-[13px] shadow-sm"
                  />
                </div>
              )}
              {account.vendorId === 'ark' && codePlanPreset && (
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.codePlanPreset')}</Label>
                    {typeInfo?.codePlanDocsUrl && (
                      <a
                        href={typeInfo.codePlanDocsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-info inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-80"
                      >
                        {t('aiProviders.dialog.codePlanDoc')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="flex gap-2 text-[13px]">
                    <button
                      type="button"
                      onClick={() => {
                        setArkMode('apikey');
                        setBaseUrl(typeInfo?.defaultBaseUrl || '');
                        const normalizedModels = normalizeProviderModelList(modelsText.split('\n'));
                        if (normalizedModels.length === 1 && normalizedModels[0] === codePlanPreset.modelId) {
                          setModelsText(typeInfo?.defaultModelId || '');
                        }
                      }}
                      className={cn("flex-1 rounded-lg border px-3 py-1.5 transition-colors", arkMode === 'apikey' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "surface-hover-strong border-transparent text-muted-foreground")}
                    >
                      {t('aiProviders.authModes.apiKey')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setArkMode('codeplan');
                        setBaseUrl(codePlanPreset.baseUrl);
                        setModelsText(codePlanPreset.modelId);
                      }}
                      className={cn("flex-1 rounded-lg border px-3 py-1.5 transition-colors", arkMode === 'codeplan' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "surface-hover-strong border-transparent text-muted-foreground")}
                    >
                      {t('aiProviders.dialog.codePlanMode')}
                    </button>
                  </div>
                  {arkMode === 'codeplan' && (
                    <p className="text-[12px] text-muted-foreground">
                      {t('aiProviders.dialog.codePlanPresetDesc')}
                    </p>
                  )}
                </div>
              )}
              {canEditProtocol && (
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                  <div className="flex gap-2 text-[13px]">
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-completions')}
                      className={cn("flex-1 rounded-lg border px-3 py-1.5 transition-colors", apiProtocol === 'openai-completions' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "surface-hover-strong border-transparent text-muted-foreground")}
                    >
                      {t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-responses')}
                      className={cn("flex-1 rounded-lg border px-3 py-1.5 transition-colors", apiProtocol === 'openai-responses' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "surface-hover-strong border-transparent text-muted-foreground")}
                    >
                      {t('aiProviders.protocols.openaiResponses', 'OpenAI Responses')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('anthropic-messages')}
                      className={cn("flex-1 rounded-lg border px-3 py-1.5 transition-colors", apiProtocol === 'anthropic-messages' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "surface-hover-strong border-transparent text-muted-foreground")}
                    >
                      {t('aiProviders.protocols.anthropic', 'Anthropic')}
                    </button>
                  </div>
                </div>
              )}
              {showModelIdField && (
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.modelIds')}</Label>
                  <textarea
                    value={modelsText}
                    onChange={(e) => setModelsText(e.target.value)}
                    placeholder={typeInfo?.modelIdPlaceholder || 'provider/model-id'}
                    className="modal-field-surface field-focus-ring min-h-24 w-full rounded-xl border px-3 py-2 text-[13px] font-mono outline-none shadow-sm"
                  />
                  <p className="text-[12px] text-muted-foreground">
                    {t('aiProviders.dialog.modelIdsHelp')}
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="modal-section-surface space-y-3 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[14px] font-bold text-foreground/80">{t('aiProviders.dialog.apiKey')}</Label>
                <p className="text-[12px] text-muted-foreground">
                  {status?.hasKey
                    ? t('aiProviders.dialog.apiKeyConfigured')
                    : t('aiProviders.dialog.apiKeyMissing')}
                </p>
              </div>
              {status?.hasKey ? (
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-green-600 dark:text-green-500 bg-green-500/10 px-2 py-1 rounded-md">
                  <div className="w-1.5 h-1.5 rounded-full bg-current" />
                  {t('aiProviders.card.configured')}
                </div>
              ) : null}
            </div>
            {typeInfo?.apiKeyUrl && (
              <div className="flex justify-start">
                <a
                  href={typeInfo.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-info flex items-center gap-1 text-[13px] hover:underline hover:opacity-80"
                  tabIndex={-1}
                >
                  {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            <div className="space-y-1.5 pt-1">
              <Label className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.replaceApiKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder={typeInfo?.requiresApiKey ? typeInfo?.placeholder : (typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : t('aiProviders.card.editKey'))}
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className="modal-field-surface field-focus-ring pr-10 h-[40px] rounded-xl font-mono text-[13px] shadow-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleSaveEdits}
                  className="modal-field-surface surface-hover h-[40px] rounded-xl px-4"
                  disabled={
                    validating
                    || saving
                    || (
                      !newKey.trim()
                      && (baseUrl.trim() || undefined) === (account.baseUrl || undefined)
                      && (!canEditProtocol || apiProtocol === (account.apiProtocol || 'openai-completions'))
                      && providerModelsEqual(normalizeProviderModelList(modelsText.split('\n')), configuredModels)
                    )
                    || Boolean(showModelIdField && normalizeProviderModelList(modelsText.split('\n')).length === 0)
                  }
                >
                  {validating || saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 text-green-500" />
                  )}
                </Button>
                <Button variant="ghost" onClick={onCancelEdit} className="surface-hover-strong h-[40px] w-[40px] rounded-xl p-0">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {t('aiProviders.dialog.replaceApiKeyHelp')}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface AddProviderDialogProps {
  existingVendorIds: Set<string>;
  vendors: ProviderVendorInfo[];
  onClose: () => void;
  onAdd: (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: {
      baseUrl?: string;
      models?: string[];
      authMode?: ProviderAccount['authMode'];
      apiProtocol?: ProviderAccount['apiProtocol'];
    }
  ) => Promise<void>;
  onValidateKey: (
    type: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  devModeUnlocked: boolean;
}

function AddProviderDialog({
  existingVendorIds,
  vendors,
  onClose,
  onAdd,
  onValidateKey,
  devModeUnlocked,
}: AddProviderDialogProps) {
  const { t, i18n } = useTranslation('settings');
  const [selectedType, setSelectedType] = useState<ProviderType | null>(null);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>('openai-completions');
  const [modelsText, setModelsText] = useState('');
  const [arkMode, setArkMode] = useState<ArkMode>('apikey');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // OAuth Flow State
  const [oauthFlowing, setOauthFlowing] = useState(false);
  const [oauthData, setOauthData] = useState<{
    verificationUri: string;
    userCode: string;
    expiresIn: number;
  } | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  // For providers that support both OAuth and API key, let the user choose.
  // Default to the vendor's declared auth mode instead of hard-coding OAuth.
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>('apikey');

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === selectedType);
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const codePlanPreset = typeInfo?.codePlanPresetBaseUrl && typeInfo?.codePlanPresetModelId
    ? {
        baseUrl: typeInfo.codePlanPresetBaseUrl,
        modelId: typeInfo.codePlanPresetModelId,
      }
    : null;
  const effectiveDocsUrl = selectedType === 'ark' && arkMode === 'codeplan'
    ? (typeInfo?.codePlanDocsUrl || providerDocsUrl)
    : providerDocsUrl;
  const isOAuth = typeInfo?.isOAuth ?? false;
  const supportsApiKey = typeInfo?.supportsApiKey ?? false;
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const selectedVendor = selectedType ? vendorMap.get(selectedType) : undefined;
  const preferredOAuthMode = selectedVendor?.supportedAuthModes.includes('oauth_browser')
    ? 'oauth_browser'
    : (selectedVendor?.supportedAuthModes.includes('oauth_device')
      ? 'oauth_device'
      : (selectedType === 'google' ? 'oauth_browser' : null));
  // Effective OAuth mode: pure OAuth providers, or dual-mode with oauth selected
  const useOAuthFlow = isOAuth && (!supportsApiKey || authMode === 'oauth');

  useEffect(() => {
    if (!selectedVendor || !isOAuth || !supportsApiKey) {
      return;
    }
    setAuthMode(selectedVendor.defaultAuthMode === 'api_key' ? 'apikey' : 'oauth');
  }, [selectedVendor, isOAuth, supportsApiKey]);

  useEffect(() => {
    if (selectedType !== 'ark') {
      setArkMode('apikey');
    }
  }, [selectedType]);

  // Keep refs to the latest values so event handlers see the current dialog state.
  const latestRef = React.useRef({ selectedType, typeInfo, onAdd, onClose, t });
  const pendingOAuthRef = React.useRef<{ accountId: string; label: string } | null>(null);
  useEffect(() => {
    latestRef.current = { selectedType, typeInfo, onAdd, onClose, t };
  });

  // Manage OAuth events
  useEffect(() => {
    const handleCode = (data: unknown) => {
      setOauthData(data as { verificationUri: string; userCode: string; expiresIn: number });
      setOauthError(null);
    };

    const handleSuccess = async (data: unknown) => {
      setOauthFlowing(false);
      setOauthData(null);
      setValidationError(null);

      const { onClose: close, t: translate } = latestRef.current;
      const payload = (data as { accountId?: string } | undefined) || undefined;
      const accountId = payload?.accountId || pendingOAuthRef.current?.accountId;

      // device-oauth.ts already saved the provider config to the backend,
      // including the dynamically resolved baseUrl for the region (e.g. CN vs Global).
      // If we call add() here with undefined baseUrl, it will overwrite and erase it!
      // So we just fetch the latest list from the backend to update the UI.
      try {
        const store = useProviderStore.getState();
        await store.refreshProviderSnapshot();

        // Auto-set as default if no default is currently configured
        if (!store.defaultAccountId && accountId) {
          await store.setDefaultAccount(accountId);
        }
      } catch (err) {
        console.error('Failed to refresh providers after OAuth:', err);
      }

      pendingOAuthRef.current = null;
      close();
      toast.success(translate('aiProviders.toast.added'));
    };

    const handleError = (data: unknown) => {
      setOauthError((data as { message: string }).message);
      setOauthData(null);
      pendingOAuthRef.current = null;
    };

    const offCode = subscribeHostEvent('oauth:code', handleCode);
    const offSuccess = subscribeHostEvent('oauth:success', handleSuccess);
    const offError = subscribeHostEvent('oauth:error', handleError);

    return () => {
      offCode();
      offSuccess();
      offError();
    };
  }, []);

  const handleStartOAuth = async () => {
    if (!selectedType) return;

    if (selectedType === 'minimax-portal' && existingVendorIds.has('minimax-portal-cn')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }
    if (selectedType === 'minimax-portal-cn' && existingVendorIds.has('minimax-portal')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }

    setOauthFlowing(true);
    setOauthData(null);
    setOauthError(null);

    try {
      const vendor = vendorMap.get(selectedType);
      const supportsMultipleAccounts = vendor?.supportsMultipleAccounts ?? selectedType === 'custom';
      const accountId = supportsMultipleAccounts ? `${selectedType}-${crypto.randomUUID()}` : selectedType;
      const label = name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType;
      pendingOAuthRef.current = { accountId, label };
      await hostApiFetch('/api/providers/oauth/start', {
        method: 'POST',
        body: JSON.stringify({ provider: selectedType, accountId, label }),
      });
    } catch (e) {
      setOauthError(String(e));
      setOauthFlowing(false);
      pendingOAuthRef.current = null;
    }
  };

  const handleCancelOAuth = async () => {
    setOauthFlowing(false);
    setOauthData(null);
    setOauthError(null);
    pendingOAuthRef.current = null;
    await hostApiFetch('/api/providers/oauth/cancel', {
      method: 'POST',
    });
  };

  const availableTypes = PROVIDER_TYPE_INFO.filter((type) => {
    const vendor = vendorMap.get(type.id);
    if (!vendor) {
      return !existingVendorIds.has(type.id) || type.id === 'custom';
    }
    return vendor.supportsMultipleAccounts || !existingVendorIds.has(type.id);
  });

  const handleAdd = async () => {
    if (!selectedType) return;

    if (selectedType === 'minimax-portal' && existingVendorIds.has('minimax-portal-cn')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }
    if (selectedType === 'minimax-portal-cn' && existingVendorIds.has('minimax-portal')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }

    setSaving(true);
    setValidationError(null);

    try {
      // Validate key first if the provider requires one and a key was entered
      const requiresKey = typeInfo?.requiresApiKey ?? false;
      if (requiresKey && !apiKey.trim()) {
        setValidationError(t('aiProviders.toast.invalidKey')); // reusing invalid key msg or should add 'required' msg? null checks
        setSaving(false);
        return;
      }
      if (requiresKey && apiKey) {
        const result = await onValidateKey(selectedType, apiKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: selectedType === 'custom' || selectedType === 'ollama'
            ? apiProtocol
            : undefined,
        });
        if (!result.valid) {
          setValidationError(result.error || t('aiProviders.toast.invalidKey'));
          setSaving(false);
          return;
        }
      }

      const normalizedModels = normalizeProviderModelList(modelsText.split('\n'));
      const requiresModel = showModelIdField;
      if (requiresModel && normalizedModels.length === 0) {
        setValidationError(t('aiProviders.toast.modelRequired'));
        setSaving(false);
        return;
      }

      await onAdd(
        selectedType,
        name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType,
        apiKey.trim(),
        {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: selectedType === 'custom' || selectedType === 'ollama'
            ? apiProtocol
            : undefined,
          models: normalizedModels,
          authMode: useOAuthFlow ? (preferredOAuthMode || 'oauth_device') : selectedType === 'ollama'
            ? 'local'
            : (isOAuth && supportsApiKey && authMode === 'apikey')
              ? 'api_key'
              : vendorMap.get(selectedType)?.defaultAuthMode || 'api_key',
        }
      );
    } catch {
      // error already handled via toast in parent
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="overlay-backdrop fixed inset-0 z-[140] flex items-center justify-center p-4">
      <Card className="modal-card-surface w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden">
        <CardHeader className="relative pb-2 shrink-0">
          <CardTitle className="modal-title">{t('aiProviders.dialog.title')}</CardTitle>
          <CardDescription className="modal-description">
            {t('aiProviders.dialog.desc')}
          </CardDescription>
          <Button
            variant="ghost"
            size="icon"
            className="modal-close-button absolute right-4 top-4 -mr-2 -mt-2"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="overflow-y-auto flex-1 p-6">
          {!selectedType ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {availableTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => {
                    setSelectedType(type.id);
                    setName(type.id === 'custom' ? t('aiProviders.custom') : type.name);
                    setBaseUrl(type.defaultBaseUrl || '');
                    setApiProtocol('openai-completions');
                    setModelsText(type.defaultModelId || '');
                    setArkMode('apikey');
                  }}
                    className="surface-hover rounded-2xl border border-black/5 p-4 text-center transition-colors group dark:border-white/5"
                >
                  <div className="modal-field-surface h-12 w-12 mx-auto mb-3 flex items-center justify-center rounded-xl group-hover:scale-105 transition-transform">
                    {getProviderIconUrl(type.id) ? (
                      <img src={getProviderIconUrl(type.id)} alt={type.name} className={cn('h-6 w-6', shouldInvertInDark(type.id) && 'dark:invert')} />
                    ) : (
                      <span className="text-2xl">{type.icon}</span>
                    )}
                  </div>
                  <p className="font-medium text-[13px]">{type.id === 'custom' ? t('aiProviders.custom') : type.name}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="modal-field-surface flex items-center gap-3 p-4 rounded-2xl border shadow-sm">
                <div className="surface-muted h-10 w-10 shrink-0 flex items-center justify-center rounded-xl">
                  {getProviderIconUrl(selectedType!) ? (
                    <img src={getProviderIconUrl(selectedType!)} alt={typeInfo?.name} className={cn('h-6 w-6', shouldInvertInDark(selectedType!) && 'dark:invert')} />
                  ) : (
                    <span className="text-xl">{typeInfo?.icon}</span>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-[15px]">{typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedType(null);
                        setValidationError(null);
                        setBaseUrl('');
                        setApiProtocol('openai-completions');
                        setModelsText('');
                        setArkMode('apikey');
                      }}
                      className="text-info text-[13px] font-medium hover:opacity-80"
                    >
                      {t('aiProviders.dialog.change')}
                    </button>
                    {effectiveDocsUrl && (
                      <>
                        <span className="text-foreground/20">|</span>
                        <a
                          href={effectiveDocsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-info inline-flex items-center gap-1 text-[13px] font-medium hover:opacity-80"
                        >
                          {t('aiProviders.dialog.customDoc')}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="modal-section-surface space-y-4 p-5 rounded-2xl border shadow-sm">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-[14px] font-bold text-foreground/80">{t('aiProviders.dialog.displayName')}</Label>
                  <Input
                    id="name"
                    placeholder={typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px] shadow-sm"
                  />
                </div>

                {/* Auth mode toggle for providers supporting both */}
                {isOAuth && supportsApiKey && (
                  <div className="modal-field-surface flex rounded-xl border overflow-hidden text-[13px] font-medium shadow-sm p-1 gap-1">
                    <button
                      onClick={() => setAuthMode('oauth')}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg transition-colors',
                        authMode === 'oauth' ? 'surface-muted-strong text-foreground' : 'surface-hover text-muted-foreground'
                      )}
                    >
                      {t('aiProviders.oauth.loginMode')}
                    </button>
                    <button
                      onClick={() => setAuthMode('apikey')}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg transition-colors',
                        authMode === 'apikey' ? 'surface-muted-strong text-foreground' : 'surface-hover text-muted-foreground'
                      )}
                    >
                      {t('aiProviders.oauth.apikeyMode')}
                    </button>
                  </div>
                )}

                {/* API Key input — shown for non-OAuth providers or when apikey mode is selected */}
                {(!isOAuth || (supportsApiKey && authMode === 'apikey')) && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="apiKey" className="text-[14px] font-bold text-foreground/80">{t('aiProviders.dialog.apiKey')}</Label>
                      {typeInfo?.apiKeyUrl && (
                        <a
                          href={typeInfo.apiKeyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-info flex items-center gap-1 text-[13px] font-medium hover:opacity-80"
                          tabIndex={-1}
                        >
                          {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        id="apiKey"
                        type={showKey ? 'text' : 'password'}
                        placeholder={typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : typeInfo?.placeholder}
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setValidationError(null);
                        }}
                        className="modal-field-surface field-focus-ring pr-10 h-[44px] rounded-xl font-mono text-[13px] shadow-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {validationError && (
                      <p className="text-[13px] text-red-500 font-medium">{validationError}</p>
                    )}
                    <p className="text-[12px] text-muted-foreground">
                      {t('aiProviders.dialog.apiKeyStored')}
                    </p>
                  </div>
                )}

                {typeInfo?.showBaseUrl && (
                  <div className="space-y-2">
                    <Label htmlFor="baseUrl" className="text-[14px] font-bold text-foreground/80">{t('aiProviders.dialog.baseUrl')}</Label>
                    <Input
                      id="baseUrl"
                      placeholder={getProtocolBaseUrlPlaceholder(apiProtocol)}
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      className="modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px] shadow-sm"
                    />
                  </div>
                )}

                {selectedType === 'ark' && codePlanPreset && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-[14px] font-bold text-foreground/80">{t('aiProviders.dialog.codePlanPreset')}</Label>
                      {typeInfo?.codePlanDocsUrl && (
                        <a
                          href={typeInfo.codePlanDocsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-info inline-flex items-center gap-1 text-[13px] font-medium hover:opacity-80"
                          tabIndex={-1}
                        >
                          {t('aiProviders.dialog.codePlanDoc')}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex gap-2 text-[13px]">
                      <button
                        type="button"
                        onClick={() => {
                          setArkMode('apikey');
                          setBaseUrl(typeInfo?.defaultBaseUrl || '');
                          const normalizedModels = normalizeProviderModelList(modelsText.split('\n'));
                          if (normalizedModels.length === 1 && normalizedModels[0] === codePlanPreset.modelId) {
                            setModelsText(typeInfo?.defaultModelId || '');
                          }
                          setValidationError(null);
                        }}
                        className={cn("flex-1 rounded-lg border px-3 py-1.5 transition-colors", arkMode === 'apikey' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "surface-hover-strong border-transparent text-muted-foreground")}
                      >
                        {t('aiProviders.authModes.apiKey')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setArkMode('codeplan');
                          setBaseUrl(codePlanPreset.baseUrl);
                          setModelsText(codePlanPreset.modelId);
                          setValidationError(null);
                        }}
                        className={cn("flex-1 rounded-lg border px-3 py-1.5 transition-colors", arkMode === 'codeplan' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "surface-hover-strong border-transparent text-muted-foreground")}
                      >
                        {t('aiProviders.dialog.codePlanMode')}
                      </button>
                    </div>
                    {arkMode === 'codeplan' && (
                      <p className="text-[12px] text-muted-foreground">
                        {t('aiProviders.dialog.codePlanPresetDesc')}
                      </p>
                    )}
                  </div>
                )}

                {selectedType === 'custom' && (
                  <div className="space-y-2.5">
                    <Label className="text-[14px] font-bold text-foreground/80">{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                    <div className="flex gap-2 text-[13px]">
                      <button
                        type="button"
                        onClick={() => setApiProtocol('openai-completions')}
                        className={cn("flex-1 rounded-lg border px-3 py-1.5 transition-colors", apiProtocol === 'openai-completions' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "surface-hover-strong border-transparent text-muted-foreground")}
                      >
                        {t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setApiProtocol('openai-responses')}
                        className={cn("flex-1 rounded-lg border px-3 py-1.5 transition-colors", apiProtocol === 'openai-responses' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "surface-hover-strong border-transparent text-muted-foreground")}
                      >
                        {t('aiProviders.protocols.openaiResponses', 'OpenAI Responses')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setApiProtocol('anthropic-messages')}
                        className={cn("flex-1 rounded-lg border px-3 py-1.5 transition-colors", apiProtocol === 'anthropic-messages' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "surface-hover-strong border-transparent text-muted-foreground")}
                      >
                        {t('aiProviders.protocols.anthropic', 'Anthropic')}
                      </button>
                    </div>
                  </div>
                )}

                {showModelIdField && (
                  <div className="space-y-2">
                    <Label htmlFor="modelIds" className="text-[14px] font-bold text-foreground/80">{t('aiProviders.dialog.modelIds')}</Label>
                    <textarea
                      id="modelIds"
                      placeholder={typeInfo?.modelIdPlaceholder || 'provider/model-id'}
                      value={modelsText}
                      onChange={(e) => {
                        setModelsText(e.target.value);
                        setValidationError(null);
                      }}
                      className="modal-field-surface field-focus-ring min-h-28 w-full rounded-xl border px-3 py-2 font-mono text-[13px] outline-none shadow-sm"
                    />
                    <p className="text-[12px] text-muted-foreground">
                      {t('aiProviders.dialog.modelIdsHelp')}
                    </p>
                  </div>
                )}
                {/* Device OAuth Trigger — only shown when in OAuth mode */}
                {useOAuthFlow && (
                  <div className="space-y-4 pt-2">
                    <div className="rounded-xl border border-info/20 bg-info/10 p-5 text-center">
                      <p className="text-info mb-4 block text-[13px] font-medium">
                        {t('aiProviders.oauth.loginPrompt')}
                      </p>
                      <Button
                        onClick={handleStartOAuth}
                        disabled={oauthFlowing}
                        className="modal-primary-button w-full"
                      >
                        {oauthFlowing ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('aiProviders.oauth.waiting')}</>
                        ) : (
                          t('aiProviders.oauth.loginButton')
                        )}
                      </Button>
                    </div>

                    {/* OAuth Active State Modal / Inline View */}
                    {oauthFlowing && (
                      <div className="modal-field-surface mt-4 p-5 border rounded-2xl shadow-sm relative overflow-hidden">
                        {/* Background pulse effect */}
                        <div className="absolute inset-0 bg-blue-500/5 animate-pulse" />

                        <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-5">
                          {oauthError ? (
                            <div className="text-red-500 space-y-3">
                              <XCircle className="h-10 w-10 mx-auto" />
                              <p className="font-semibold text-[15px]">{t('aiProviders.oauth.authFailed')}</p>
                              <p className="text-[13px] opacity-80">{oauthError}</p>
                              <Button variant="outline" size="sm" onClick={handleCancelOAuth} className="modal-secondary-button mt-2">
                                Try Again
                              </Button>
                            </div>
                          ) : !oauthData ? (
                            <div className="space-y-4 py-6">
                              <Loader2 className="text-info mx-auto h-10 w-10 animate-spin" />
                              <p className="text-[13px] font-medium text-muted-foreground animate-pulse">{t('aiProviders.oauth.requestingCode')}</p>
                            </div>
                          ) : (
                            <div className="space-y-5 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-[16px] text-foreground">{t('aiProviders.oauth.approveLogin')}</h3>
                                <div className="surface-muted mt-2 space-y-1.5 rounded-xl p-4 text-left text-[13px] text-muted-foreground">
                                  <p>1. {t('aiProviders.oauth.step1')}</p>
                                  <p>2. {t('aiProviders.oauth.step2')}</p>
                                  <p>3. {t('aiProviders.oauth.step3')}</p>
                                </div>
                              </div>

                              <div className="modal-section-surface flex items-center justify-center gap-3 p-4 border rounded-xl shadow-inner">
                                <code className="text-3xl font-mono tracking-[0.2em] font-bold text-foreground">
                                  {oauthData.userCode}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="surface-hover-strong h-10 w-10 rounded-full"
                                  onClick={() => {
                                    navigator.clipboard.writeText(oauthData.userCode);
                                    toast.success(t('aiProviders.oauth.codeCopied'));
                                  }}
                                >
                                  <Copy className="h-5 w-5" />
                                </Button>
                              </div>

                              <Button
                                variant="secondary"
                                className="modal-secondary-button w-full"
                                onClick={() => invokeIpc('shell:openExternal', oauthData.verificationUri)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                {t('aiProviders.oauth.openLoginPage')}
                              </Button>

                              <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-muted-foreground pt-2">
                                <Loader2 className="text-info h-4 w-4 animate-spin" />
                                <span>{t('aiProviders.oauth.waitingApproval')}</span>
                              </div>

                              <Button variant="ghost" className="modal-secondary-button w-full" onClick={handleCancelOAuth}>
                                Cancel
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator className="separator-subtle" />

              <div className="modal-footer">
                <Button
                  onClick={handleAdd}
                  className={cn("modal-primary-button px-8", useOAuthFlow && "hidden")}
                  disabled={!selectedType || saving || (showModelIdField && normalizeProviderModelList(modelsText.split('\n')).length === 0)}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {t('aiProviders.dialog.add')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>,
    document.body,
  );
}
