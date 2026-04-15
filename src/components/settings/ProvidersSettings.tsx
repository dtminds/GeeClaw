/**
 * Providers Settings Component
 * Manage AI provider configurations and API keys
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Eye,
  EyeOff,
  Check,
  X,
  Loader2,
  ExternalLink,
  Copy,
  XCircle,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  useProviderStore,
  type ProviderAccount,
  type ProviderVendorInfo,
} from '@/stores/providers';
import {
  PROVIDER_TYPE_INFO,
  getProviderDocsUrl,
  getProviderCodePlanPreset,
  isProviderCodePlanMode,
  type ProviderType,
  type ProviderTypeInfo,
  getProviderIconUrl,
  getConfiguredProviderModelEntries,
  getEffectiveProviderModelEntries,
  normalizeProviderModelEntries,
  normalizeProviderModelList,
  providerModelEntriesEqual,
  resolveProviderApiKeyForSave,
  shouldShowProviderModelId,
  shouldInvertInDark,
  type ProviderModelCatalogMode,
  type ProviderModelCatalogState,
  type ProviderModelEntry,
  getDefaultProviderModelEntries,
} from '@/lib/providers';
import {
  buildProviderAccountId,
  buildProviderListItems,
  hasConfiguredCredentials,
  type ProviderListItem,
} from '@/lib/provider-accounts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { invokeIpc } from '@/lib/api-client';
import { useSettingsStore } from '@/stores/settings';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { normalizeOAuthFlowPayload, type OAuthFlowData } from '@/lib/oauth-flow';
import {
  AddCircleIcon,
  Delete02Icon,
  FileEditIcon,
  Image02Icon,
  TextSquareIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  buildCustomProviderRuntimeKey,
  isValidCustomProviderKeySegment,
  slugifyCustomProviderKeySegment,
} from '../../../shared/providers/runtime-provider-key';

function getProtocolBaseUrlPlaceholder(
  apiProtocol: ProviderAccount['apiProtocol'],
): string {
  if (apiProtocol === 'anthropic-messages') {
    return 'https://api.example.com/anthropic';
  }
  return 'https://api.example.com/v1';
}

type CodePlanMode = 'apikey' | 'codeplan';

function createProviderModelEntry(
  id: string,
  options?: {
    supportsImage?: boolean;
    contextWindow?: number;
    maxTokens?: number;
  },
): ProviderModelEntry {
  const normalizedId = id.trim();
  return {
    id: normalizedId,
    name: normalizedId,
    reasoning: false,
    ...(options?.supportsImage ? { input: ['text', 'image'] as const } : {}),
    ...(typeof options?.contextWindow === 'number' ? { contextWindow: options.contextWindow } : {}),
    ...(typeof options?.maxTokens === 'number' ? { maxTokens: options.maxTokens } : {}),
  };
}

type ProviderModelCatalogDraft = {
  disabledBuiltinModelIds: string[];
  disabledCustomModelIds: string[];
  customModels: ProviderModelEntry[];
  builtinModelOverrides: ProviderModelEntry[];
};

type ProviderModelListItem = {
  id: string;
  model: ProviderModelEntry;
  source: 'builtin' | 'custom';
  enabled: boolean;
};

type AgentModelSlotReferenceSnapshot = {
  primary: string | null;
  fallbacks: string[];
};

type AgentDefaultModelReferenceSnapshot = {
  model: AgentModelSlotReferenceSnapshot;
  imageModel: AgentModelSlotReferenceSnapshot;
  pdfModel: AgentModelSlotReferenceSnapshot;
  imageGenerationModel: AgentModelSlotReferenceSnapshot;
  videoGenerationModel: AgentModelSlotReferenceSnapshot;
  availableModels: Array<{
    providerId: string;
    modelRefs: string[];
  }>;
};

function collectReferencedModelRefs(snapshot: AgentDefaultModelReferenceSnapshot): Set<string> {
  return new Set(normalizeProviderModelList([
    snapshot.model.primary,
    ...snapshot.model.fallbacks,
    snapshot.imageModel.primary,
    ...snapshot.imageModel.fallbacks,
    snapshot.pdfModel.primary,
    ...snapshot.pdfModel.fallbacks,
    snapshot.imageGenerationModel.primary,
    ...snapshot.imageGenerationModel.fallbacks,
    snapshot.videoGenerationModel.primary,
    ...snapshot.videoGenerationModel.fallbacks,
  ]));
}

function getProviderModelCatalogMode(typeInfo?: Pick<ProviderTypeInfo, 'modelCatalogMode'>): ProviderModelCatalogMode {
  return typeInfo?.modelCatalogMode ?? 'builtin-only';
}

function normalizeProviderModelCatalogDraft(
  value?: ProviderModelCatalogState | null,
): ProviderModelCatalogDraft {
  return {
    disabledBuiltinModelIds: normalizeProviderModelList(value?.disabledBuiltinModelIds),
    disabledCustomModelIds: normalizeProviderModelList(value?.disabledCustomModelIds),
    customModels: normalizeProviderModelEntries(value?.customModels),
    builtinModelOverrides: normalizeProviderModelEntries(value?.builtinModelOverrides),
  };
}

function buildProviderModelCatalogDraft(
  provider: Pick<ProviderAccount, 'metadata' | 'models' | 'model' | 'fallbackModels'>,
  typeInfo?: Pick<ProviderTypeInfo, 'defaultModels' | 'defaultModelId'>,
): ProviderModelCatalogDraft {
  const explicitState = provider.metadata?.modelCatalog;
  if (explicitState) {
    return normalizeProviderModelCatalogDraft(explicitState);
  }

  const builtinModels = getDefaultProviderModelEntries(typeInfo);
  const builtinById = new Map(builtinModels.map((model) => [model.id, model] as const));
  const legacyEntries = getConfiguredProviderModelEntries(provider);
  const customModels: ProviderModelEntry[] = [];
  const builtinModelOverrides: ProviderModelEntry[] = [];

  for (const entry of legacyEntries) {
    const builtinEntry = builtinById.get(entry.id);
    if (!builtinEntry) {
      customModels.push(entry);
      continue;
    }
    if (!providerModelEntriesEqual([builtinEntry], [entry])) {
      builtinModelOverrides.push(entry);
    }
  }

  return {
    disabledBuiltinModelIds: [],
    disabledCustomModelIds: [],
    customModels,
    builtinModelOverrides,
  };
}

function buildProviderEffectiveModelEntries(
  typeInfo: Pick<ProviderTypeInfo, 'defaultModels' | 'defaultModelId'> | undefined,
  draft: ProviderModelCatalogDraft,
): ProviderModelEntry[] {
  const builtinModels = getDefaultProviderModelEntries(typeInfo);
  const builtinOverrideMap = new Map(draft.builtinModelOverrides.map((model) => [model.id, model] as const));
  const disabledBuiltinModelIds = new Set(draft.disabledBuiltinModelIds);
  const disabledCustomModelIds = new Set(draft.disabledCustomModelIds);

  return normalizeProviderModelEntries([
    ...builtinModels
      .map((model) => ({
        ...model,
        ...(builtinOverrideMap.get(model.id) ?? {}),
      }))
      .filter((model) => !disabledBuiltinModelIds.has(model.id)),
    ...draft.customModels.filter((model) => !disabledCustomModelIds.has(model.id)),
  ]);
}

function buildProviderModelListItems(
  typeInfo: Pick<ProviderTypeInfo, 'defaultModels' | 'defaultModelId'> | undefined,
  draft: ProviderModelCatalogDraft,
): ProviderModelListItem[] {
  const builtinModels = getDefaultProviderModelEntries(typeInfo);
  const builtinOverrideMap = new Map(draft.builtinModelOverrides.map((model) => [model.id, model] as const));
  const disabledBuiltinModelIds = new Set(draft.disabledBuiltinModelIds);
  const disabledCustomModelIds = new Set(draft.disabledCustomModelIds);

  return [
    ...builtinModels.map((model) => ({
      id: model.id,
      model: {
        ...model,
        ...(builtinOverrideMap.get(model.id) ?? {}),
      },
      source: 'builtin' as const,
      enabled: !disabledBuiltinModelIds.has(model.id),
    })),
    ...draft.customModels.map((model) => ({
      id: model.id,
      model,
      source: 'custom' as const,
      enabled: !disabledCustomModelIds.has(model.id),
    })),
  ];
}

function getProviderDraftState(
  account: ProviderAccount,
  configuredModels: string[],
  typeInfo?: ProviderTypeInfo,
): {
  baseUrl: string;
  apiProtocol: ProviderAccount['apiProtocol'];
  arkMode: CodePlanMode;
} {
  return {
    baseUrl: account.baseUrl || '',
    apiProtocol: account.apiProtocol || 'openai-completions',
    arkMode: isProviderCodePlanMode(
      account.baseUrl,
      configuredModels,
      typeInfo?.codePlanPresetBaseUrl,
      typeInfo?.codePlanPresetModelId,
    ) ? 'codeplan' : 'apikey',
  };
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

type ProviderModelDialogState = {
  mode: 'add' | 'edit';
  index: number | null;
  model?: ProviderModelEntry;
};

function ProviderModelDialog(props: {
  title: string;
  placeholder: string;
  initialValue?: ProviderModelEntry;
  onClose: () => void;
  onSave: (next: ProviderModelEntry) => void;
}) {
  const { t } = useTranslation('settings');
  const [modelId, setModelId] = useState(props.initialValue?.id ?? '');
  const [supportsImage, setSupportsImage] = useState(props.initialValue?.input?.includes('image') ?? false);
  const [advancedOpen, setAdvancedOpen] = useState(
    typeof props.initialValue?.contextWindow === 'number'
    || typeof props.initialValue?.maxTokens === 'number',
  );
  const [contextWindow, setContextWindow] = useState(
    typeof props.initialValue?.contextWindow === 'number' ? String(props.initialValue.contextWindow) : '',
  );
  const [maxTokens, setMaxTokens] = useState(
    typeof props.initialValue?.maxTokens === 'number' ? String(props.initialValue.maxTokens) : '',
  );

  const parseOptionalPositiveInteger = (value: string): number | undefined => {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

  const handleSave = () => {
    const nextId = modelId.trim();
    if (!nextId) {
      return;
    }

    props.onSave(createProviderModelEntry(nextId, {
      supportsImage,
      contextWindow: parseOptionalPositiveInteger(contextWindow),
      maxTokens: parseOptionalPositiveInteger(maxTokens),
    }));
  };

  return (
    createPortal(
      <div className="overlay-backdrop fixed inset-0 z-[160] flex items-center justify-center p-4">
        <Card
          role="dialog"
          aria-label={props.title}
          className="modal-card-surface w-full max-w-xl rounded-3xl border shadow-2xl"
        >
          <CardHeader className="relative pb-2">
            <CardTitle className="modal-title">{props.title}</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              className="modal-close-button absolute right-4 top-4 -mr-2 -mt-2"
              onClick={props.onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-5 p-6 pt-2">
            <div className="space-y-2">
              <Label htmlFor="provider-model-id" className="text-[14px] font-bold text-foreground/80">
                {t('aiProviders.models.dialog.id')}
              </Label>
              <Input
                id="provider-model-id"
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
                placeholder={props.placeholder}
                className="modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px]"
              />
            </div>

            <div className="space-y-3">
              <p className="text-[14px] font-bold text-foreground/80">{t('aiProviders.models.dialog.modalities.title')}</p>
              <div className="flex items-center gap-3">
                <label className="cursor-default">
                  <input
                    type="checkbox"
                    checked
                    disabled
                    aria-label={t('aiProviders.models.dialog.modalities.text')}
                    className="sr-only"
                  />
                  <span className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl border border-black/15 bg-black/[0.08] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] dark:border-white/15 dark:bg-white/[0.12]">
                    <HugeiconsIcon icon={TextSquareIcon} className="h-5 w-5" />
                    <span className="absolute right-1 top-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-foreground text-background">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  </span>
                </label>
                <label className="cursor-pointer">
                  <input
                    type="checkbox"
                    checked={supportsImage}
                    onChange={(event) => setSupportsImage(event.target.checked)}
                    aria-label={t('aiProviders.models.dialog.modalities.image')}
                    className="sr-only"
                  />
                  <span
                    className={cn(
                      'relative inline-flex h-11 w-11 items-center justify-center rounded-xl border transition-colors',
                      supportsImage
                        ? 'border-black/15 bg-black/[0.08] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] dark:border-white/15 dark:bg-white/[0.12]'
                        : 'border-black/8 bg-transparent text-muted-foreground hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.05]',
                    )}
                  >
                    <HugeiconsIcon icon={Image02Icon} className="h-5 w-5" />
                    {supportsImage ? (
                      <span className="absolute right-1 top-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-foreground text-background">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                    ) : null}
                  </span>
                </label>
              </div>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                className="inline-flex items-center gap-2 text-[13px] font-medium text-info hover:opacity-80"
                onClick={() => setAdvancedOpen((value) => !value)}
              >
                {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {t('aiProviders.models.dialog.advanced')}
              </button>
              {advancedOpen ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="provider-model-context-window" className="text-[13px] text-muted-foreground">
                      {t('aiProviders.models.dialog.contextWindow')}
                    </Label>
                    <Input
                      id="provider-model-context-window"
                      value={contextWindow}
                      onChange={(event) => setContextWindow(event.target.value)}
                      inputMode="numeric"
                      placeholder="200000"
                      className="modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="provider-model-max-tokens" className="text-[13px] text-muted-foreground">
                      {t('aiProviders.models.dialog.maxTokens')}
                    </Label>
                    <Input
                      id="provider-model-max-tokens"
                      value={maxTokens}
                      onChange={(event) => setMaxTokens(event.target.value)}
                      inputMode="numeric"
                      placeholder="65536"
                      className="modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px]"
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="modal-footer">
              <Button type="button" variant="ghost" className="modal-secondary-button shadow-none" onClick={props.onClose}>
                {t('aiProviders.dialog.cancel')}
              </Button>
              <Button
                type="button"
                className="modal-primary-button shadow-none"
                onClick={handleSave}
                disabled={!modelId.trim()}
              >
                {t('aiProviders.models.dialog.save')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>,
      document.body,
    )
  );
}

function ProviderModelConfigSection(props: {
  title: string;
  emptyLabel: string;
  items: ProviderModelListItem[];
  providerType?: ProviderType | string;
  providerEmoji?: string;
  canAddCustomModels: boolean;
  referencedModelIds?: Set<string>;
  onAdd: () => void;
  onToggle: (item: ProviderModelListItem, enabled: boolean) => void;
  onEdit: (item: ProviderModelListItem) => void;
  onDelete: (item: ProviderModelListItem) => void;
}) {
  const { t } = useTranslation('settings');
  const providerIconUrl = props.providerType ? getProviderIconUrl(props.providerType) : undefined;
  const invertProviderIcon = props.providerType ? shouldInvertInDark(props.providerType) : false;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[14px] font-bold text-foreground/80">{props.title}</p>
        {props.canAddCustomModels ? (
          <button
            type="button"
            onClick={props.onAdd}
            aria-label={t('aiProviders.models.addModel')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          >
            <HugeiconsIcon icon={AddCircleIcon} className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {props.items.length === 0 ? (
        <div className="modal-field-surface rounded-2xl border border-dashed px-4 py-5 text-[13px] text-muted-foreground">
          {props.emptyLabel}
        </div>
      ) : (
        <div className="space-y-2 p-2 rounded-xl border border-black/8 bg-card dark:border-white/10">
          {props.items.map((item) => {
            const canManageRow = item.source === 'custom';
            const isReferenced = props.referencedModelIds?.has(item.id) ?? false;
            return (
            <div
              key={`${item.source}:${item.id}`}
              className="flex items-center justify-between gap-4 rounded-xl px-2 py-1.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                  {providerIconUrl ? (
                    <img
                      src={providerIconUrl}
                      alt=""
                      className={cn('h-4 w-4', invertProviderIcon && 'dark:invert')}
                    />
                  ) : (
                    <span className="text-[14px] leading-none">{props.providerEmoji || '⚙️'}</span>
                  )}
                </span>
                <div className="flex min-w-0 items-center gap-1">
                  <p className={cn(
                    'truncate font-mono text-[13px] font-medium',
                    item.enabled ? 'text-foreground' : 'text-muted-foreground line-through',
                  )}
                  >
                    {item.model.id}
                  </p>
                  <span
                    title={t('aiProviders.models.modalities.text')}
                    className="inline-flex shrink-0 items-center justify-center text-foreground/70 dark:text-foreground/75"
                  >
                    <HugeiconsIcon icon={TextSquareIcon} className="h-4 w-4" />
                  </span>
                  {item.model.input?.includes('image') ? (
                    <span
                      title={t('aiProviders.models.modalities.image')}
                      className="inline-flex shrink-0 items-center justify-center text-foreground/70 dark:text-foreground/75"
                    >
                      <HugeiconsIcon icon={Image02Icon} className="h-4 w-4" />
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {canManageRow ? (
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        type="button"
                        aria-label={t('aiProviders.models.editModel')}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.08]"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        side="bottom"
                        align="end"
                        sideOffset={8}
                        collisionPadding={12}
                        className="z-[150] min-w-[148px] overflow-hidden rounded-2xl border border-black/8 bg-white p-1 text-popover-foreground shadow-[0_16px_36px_rgba(15,23,42,0.1)] outline-none dark:border-white/10 dark:bg-card"
                      >
                        <DropdownMenu.Item
                          onSelect={() => props.onEdit(item)}
                          className="flex cursor-default items-center gap-2 rounded-xl px-3 py-2 text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-accent/60"
                        >
                          <HugeiconsIcon icon={FileEditIcon} className="h-4 w-4" />
                          {t('aiProviders.models.editModel')}
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          onSelect={() => props.onDelete(item)}
                          disabled={isReferenced}
                          className="flex cursor-default items-center gap-2 rounded-xl px-3 py-2 text-[13px] text-destructive outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-destructive/10"
                        >
                          <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
                          {t('aiProviders.models.removeModel')}
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                ) : null}
                <Switch
                  checked={item.enabled}
                  onCheckedChange={(checked) => props.onToggle(item, checked)}
                  disabled={isReferenced}
                  aria-label={item.enabled ? t('aiProviders.list.enabled') : t('aiProviders.list.disabled')}
                />
              </div>
            </div>
            );
          })}
        </div>
      )}

      <p className="text-[12px] text-muted-foreground">{t('aiProviders.models.help')}</p>
    </div>
  );
}

type ProviderSidebarEntry =
  | {
      key: string;
      kind: 'account';
      vendorId: ProviderType;
      vendor?: ProviderVendorInfo;
      typeInfo?: ProviderTypeInfo;
      item: ProviderListItem;
      title: string;
      subtitle: string;
    }
  | {
      key: string;
      kind: 'placeholder';
      vendorId: ProviderType;
      vendor?: ProviderVendorInfo;
      typeInfo?: ProviderTypeInfo;
      title: string;
      subtitle: string;
    };

export function ProvidersSettings() {
  const { t } = useTranslation('settings');
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const {
    statuses,
    accounts,
    vendors,
    loading,
    refreshProviderSnapshot,
    createAccount,
    removeAccount,
    updateAccount,
    validateAccountApiKey,
  } = useProviderStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addDialogInitialType, setAddDialogInitialType] = useState<ProviderType | null>(null);
  const [selectedProviderKey, setSelectedProviderKey] = useState<string | null>(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<ProviderListItem | null>(null);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const vendorMap = useMemo(
    () => new Map(vendors.map((vendor) => [vendor.id, vendor])),
    [vendors],
  );
  const displayProviders = useMemo(
    () => buildProviderListItems(accounts, statuses, vendors, null),
    [accounts, statuses, vendors],
  );
  const existingVendorIds = useMemo(
    () => new Set(displayProviders.map((item) => item.account.vendorId)),
    [displayProviders],
  );
  const existingRuntimeProviderIds = useMemo(
    () => new Set(displayProviders.map((item) => item.runtimeProviderId)),
    [displayProviders],
  );
  const providerSidebarItems = useMemo<ProviderSidebarEntry[]>(
    () => {
      const orderedVendorIds = [
        ...PROVIDER_TYPE_INFO.map((provider) => provider.id),
        ...vendors
          .map((vendor) => vendor.id)
          .filter((vendorId) => !PROVIDER_TYPE_INFO.some((provider) => provider.id === vendorId)),
      ];
      const itemsByVendor = new Map<ProviderType, ProviderListItem[]>();
      for (const item of displayProviders) {
        const next = itemsByVendor.get(item.account.vendorId) || [];
        next.push(item);
        itemsByVendor.set(item.account.vendorId, next);
      }
      const sidebarItems: ProviderSidebarEntry[] = [];

      for (const vendorId of orderedVendorIds) {
        const vendor = vendorMap.get(vendorId);
        const typeInfo = PROVIDER_TYPE_INFO.find((provider) => provider.id === vendorId);
        const vendorName = vendorId === 'custom'
          ? t('aiProviders.custom')
          : (vendor?.name || typeInfo?.name || vendorId);
        const vendorItems = [...(itemsByVendor.get(vendorId) || [])]
          .sort((left, right) => right.account.updatedAt.localeCompare(left.account.updatedAt));

        if (vendorItems.length === 0) {
          sidebarItems.push({
            key: `vendor:${vendorId}`,
            kind: 'placeholder',
            vendorId,
            vendor,
            typeInfo,
            title: vendorName,
            subtitle: t('aiProviders.list.enableHint'),
          });
          continue;
        }

        for (const item of vendorItems) {
          const subtitleSegments = [];
          if (item.account.label.trim() !== vendorName) {
            subtitleSegments.push(vendorName);
          }
          subtitleSegments.push(
            hasConfiguredCredentials(item.account, item.status)
              ? t('aiProviders.card.configured')
              : t('aiProviders.list.needsSetup'),
          );

          sidebarItems.push({
            key: item.account.id,
            kind: 'account',
            vendorId,
            vendor: item.vendor || vendor,
            typeInfo,
            item,
            title: vendorName,
            subtitle: subtitleSegments.join(' · '),
          });
        }
      }

      return sidebarItems;
    },
    [displayProviders, t, vendorMap, vendors],
  );
  const selectedProviderEntry = useMemo<ProviderSidebarEntry | null>(
    () => {
      if (providerSidebarItems.length === 0) {
        return null;
      }

      if (selectedProviderKey) {
        const explicitlySelectedProvider = providerSidebarItems.find((item) => item.key === selectedProviderKey);
        if (explicitlySelectedProvider) {
          return explicitlySelectedProvider;
        }
      }

      return providerSidebarItems.find((item) => item.kind === 'account') || providerSidebarItems[0];
    },
    [providerSidebarItems, selectedProviderKey],
  );
  const selectedProvider = selectedProviderEntry?.kind === 'account' ? selectedProviderEntry.item : null;

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
      modelCatalog?: ProviderModelCatalogState;
      authMode?: ProviderAccount['authMode'];
      apiProtocol?: ProviderAccount['apiProtocol'];
      runtimeProviderKey?: string;
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
        models: [],
        metadata: (
          options?.modelCatalog || options?.runtimeProviderKey
            ? {
              ...(options?.modelCatalog ? { modelCatalog: options.modelCatalog } : {}),
              ...(options?.runtimeProviderKey ? { runtimeProviderKey: options.runtimeProviderKey } : {}),
            }
            : undefined
        ),
        enabled: true,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, effectiveApiKey);

      setSelectedProviderKey(id);
      setAddDialogInitialType(null);
      setShowAddDialog(false);
      toast.success(t('aiProviders.toast.added'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedAdd')}: ${error}`);
    }
  };

  const handleDeleteProvider = async (providerId: string, nextSelectionKey?: string) => {
    setDeletingAccountId(providerId);
    try {
      await removeAccount(providerId);
      if (nextSelectionKey) {
        setSelectedProviderKey(nextSelectionKey);
      }
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
    } finally {
      setDeletingAccountId(null);
      setPendingDeleteItem(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-normal tracking-tight text-foreground">
            {t('aiProviders.title', 'AI Providers')}
          </h2>
          <p className="text-[13px] text-muted-foreground">
            {t('aiProviders.description')}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            setAddDialogInitialType(null);
            setShowAddDialog(true);
          }}
          className="rounded-full px-4 h-9 shadow-none font-medium text-[13px] text-muted-foreground"
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('aiProviders.addAccount')}
        </Button>
      </div> */}

      {loading ? (
        <div className="surface-muted flex items-center justify-center rounded-3xl border border-transparent border-dashed py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-black/8 bg-card dark:border-white/10">
          <div className="grid xl:grid-cols-[225px_minmax(0,1fr)]">
            <div className="bg-card py-4">
              <div className="space-y-1">
                {providerSidebarItems.map((entry) => {
                  const isSelected = entry.key === selectedProviderEntry?.key;
                  const isEnabled = entry.kind === 'account';
                  const vendorName = entry.vendor?.name || entry.typeInfo?.name || entry.vendorId;

                  return (
                    <div
                      key={entry.key}
                      className={cn(
                        'group flex items-center gap-2 px-4 py-0.5 transition-colors',
                        isSelected
                          ? 'bg-black/[0.055] text-foreground dark:bg-white/[0.07]'
                          : 'text-foreground/88 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedProviderKey(entry.key)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <div className="flex h-10 w-5 shrink-0 items-center justify-center text-foreground">
                          {getProviderIconUrl(entry.vendorId) ? (
                            <img
                              src={getProviderIconUrl(entry.vendorId)}
                              alt={vendorName}
                              className={cn('h-4 w-4', shouldInvertInDark(entry.vendorId) && 'dark:invert')}
                            />
                          ) : (
                            <span className="text-lg">{entry.vendor?.icon || entry.typeInfo?.icon || '⚙️'}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 truncate text-[14px] font-normal text-foreground">
                          {entry.title}
                        </div>
                      </button>

                      <span
                        className={cn(
                          'ml-2 shrink-0 text-[11px]',
                          isEnabled
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-muted-foreground/40',
                        )}
                      >
                        {isEnabled ? t('aiProviders.list.enabled') : t('aiProviders.list.disabled')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-black/6 bg-card dark:border-white/10 xl:border-l xl:border-t-0">
              {selectedProvider ? (
                <ProviderCard
                  item={selectedProvider}
                  onDelete={() => setPendingDeleteItem(selectedProvider)}
                  onSaveAccount={async (updates, newApiKey) => {
                    const nextUpdates: Partial<ProviderAccount> = { ...updates };
                    const touchedProviderConfig = (
                      updates.baseUrl !== undefined
                      || updates.apiProtocol !== undefined
                      || updates.models !== undefined
                    );
                    if (touchedProviderConfig) {
                      nextUpdates.model = undefined;
                      nextUpdates.fallbackModels = [];
                      nextUpdates.fallbackAccountIds = [];
                    }

                    await updateAccount(
                      selectedProvider.account.id,
                      nextUpdates,
                      newApiKey
                    );
                  }}
                  onRefresh={refreshProviderSnapshot}
                  onValidateKey={(key, options) => validateAccountApiKey(selectedProvider.account.id, key, options)}
                  devModeUnlocked={devModeUnlocked}
                />
              ) : selectedProviderEntry?.kind === 'placeholder' ? (
                <ProviderInactiveCard
                  vendorId={selectedProviderEntry.vendorId}
                  vendor={selectedProviderEntry.vendor}
                  typeInfo={selectedProviderEntry.typeInfo}
                  adding={false}
                  onAddAccount={() => {
                    setAddDialogInitialType(selectedProviderEntry.vendorId);
                    setShowAddDialog(true);
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Add Provider Dialog */}
      {showAddDialog && (
        <AddProviderDialog
          initialType={addDialogInitialType}
          existingVendorIds={existingVendorIds}
          existingRuntimeProviderIds={existingRuntimeProviderIds}
          vendors={vendors}
          onClose={() => {
            setShowAddDialog(false);
            setAddDialogInitialType(null);
          }}
          onAdd={handleAddProvider}
          onValidateKey={(type, key, options) => validateAccountApiKey(type, key, options)}
          devModeUnlocked={devModeUnlocked}
        />
      )}

      {pendingDeleteItem && createPortal(
        <div className="overlay-backdrop fixed inset-0 z-[140] flex items-center justify-center p-4">
          <div className="modal-card-surface w-full max-w-sm rounded-3xl border p-6 shadow-none">
            <div className="space-y-1">
              <p className="modal-title text-[17px]">{t('aiProviders.card.deleteConfirmTitle')}</p>
              <p className="modal-description">
                {t('aiProviders.card.deleteConfirmDesc', { name: pendingDeleteItem.account.label })}
              </p>
            </div>
            <div className="modal-footer mt-5">
              <button
                type="button"
                className="modal-secondary-button"
                onClick={() => setPendingDeleteItem(null)}
                disabled={deletingAccountId === pendingDeleteItem.account.id}
              >
                {t('aiProviders.dialog.cancel')}
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-full bg-destructive px-5 text-[13px] font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
                disabled={deletingAccountId === pendingDeleteItem.account.id}
                onClick={() => {
                  const sibling = providerSidebarItems.find((entry) =>
                    entry.kind === 'account'
                    && entry.vendorId === pendingDeleteItem.account.vendorId
                    && entry.item.account.id !== pendingDeleteItem.account.id);
                  void handleDeleteProvider(
                    pendingDeleteItem.account.id,
                    sibling?.key || `vendor:${pendingDeleteItem.account.vendorId}`,
                  );
                }}
              >
                {deletingAccountId === pendingDeleteItem.account.id ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : null}
                {t('aiProviders.card.deleteConfirm')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

interface ProviderCardProps {
  item: ProviderListItem;
  onDelete: () => void;
  onSaveAccount: (updates: Partial<ProviderAccount>, newApiKey?: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onValidateKey: (
    key: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  devModeUnlocked: boolean;
}

interface ProviderInactiveCardProps {
  vendorId: ProviderType;
  vendor?: ProviderVendorInfo;
  typeInfo?: ProviderTypeInfo;
  adding: boolean;
  onAddAccount: () => void;
}

function ProviderInactiveCard({
  vendorId,
  vendor,
  typeInfo,
  adding,
  onAddAccount,
}: ProviderInactiveCardProps) {
  const { t, i18n } = useTranslation('settings');
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const providerName = vendorId === 'custom'
    ? t('aiProviders.custom')
    : (vendor?.name || typeInfo?.name || vendorId);
  const authModes = vendor?.supportedAuthModes ?? [];

  return (
    <div className="flex h-full flex-col p-4 md:p-5 xl:p-6">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center rounded-xl bg-black/[0.03] text-foreground dark:bg-white/[0.04] justify-center">
              {getProviderIconUrl(vendorId) ? (
                <img
                  src={getProviderIconUrl(vendorId)}
                  alt={providerName}
                  className={cn('h-5 w-5', shouldInvertInDark(vendorId) && 'dark:invert')}
                />
              ) : (
                <span className="text-xl">{vendor?.icon || typeInfo?.icon || '⚙️'}</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-[22px] font-semibold text-foreground">{providerName}</h3>
                <span className="inline-flex items-center rounded-full border border-black/8 bg-black/[0.045] px-2.5 py-1 text-[11px] font-medium text-foreground/75 dark:border-white/10 dark:bg-white/[0.08] dark:text-foreground/85">
                  {t('aiProviders.inactive.notEnabled')}
                </span>
              </div>
            </div>
          </div>

          {providerDocsUrl ? (
            <a
              href={providerDocsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-info hover:opacity-80"
            >
              {t('aiProviders.dialog.customDoc')}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>

        <div className="rounded-3xl border border-dashed border-black/8 bg-black/[0.02] p-5 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-[15px] font-medium text-foreground">
            {t('aiProviders.inactive.title')}
          </p>
          <Button
            onClick={onAddAccount}
            disabled={adding}
            className="mt-4 h-10 rounded-full px-5 text-[13px] font-medium shadow-none"
          >
            {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('aiProviders.addAccount')}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {authModes.length > 0 ? (
            <div className="rounded-2xl border border-black/8 bg-black/[0.025] p-4 dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                {t('aiProviders.inactive.authModes')}
              </p>
              <p className="mt-2 text-[13px] text-foreground">
                {authModes.map((mode) => getAuthModeLabel(mode, t)).join(' / ')}
              </p>
            </div>
          ) : null}
          {typeInfo?.defaultModelId ? (
            <div className="rounded-2xl border border-black/8 bg-black/[0.025] p-4 dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                {t('aiProviders.inactive.defaultModel')}
              </p>
              <p className="mt-2 break-all font-mono text-[13px] text-foreground">
                {typeInfo.defaultModelId}
              </p>
            </div>
          ) : null}
          {typeInfo?.defaultBaseUrl ? (
            <div className="rounded-2xl border border-black/8 bg-black/[0.025] p-4 dark:border-white/10 dark:bg-white/[0.03] md:col-span-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                {t('aiProviders.inactive.baseUrl')}
              </p>
              <p className="mt-2 break-all font-mono text-[13px] text-foreground">
                {typeInfo.defaultBaseUrl}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}



function ProviderCard({
  item,
  onDelete,
  onSaveAccount,
  onRefresh,
  onValidateKey,
  devModeUnlocked,
}: ProviderCardProps) {
  const { t, i18n } = useTranslation('settings');
  const { account, vendor, status } = item;
  const typeInfo = PROVIDER_TYPE_INFO.find((provider) => provider.id === account.vendorId);
  const modelCatalogMode = getProviderModelCatalogMode(typeInfo);
  const configuredModelEntries = useMemo(
    () => getEffectiveProviderModelEntries(account, typeInfo),
    [account, typeInfo],
  );
  const initialModelCatalog = useMemo(
    () => buildProviderModelCatalogDraft(account, typeInfo),
    [account, typeInfo],
  );
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const codePlanPreset = getProviderCodePlanPreset(typeInfo);
  const draftState = useMemo(
    () => getProviderDraftState(account, configuredModelEntries.map((model) => model.id), typeInfo),
    [account, configuredModelEntries, typeInfo],
  );
  const [newKey, setNewKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(draftState.baseUrl);
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>(draftState.apiProtocol);
  const [modelCatalog, setModelCatalog] = useState<ProviderModelCatalogDraft>(initialModelCatalog);
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [arkMode, setArkMode] = useState<CodePlanMode>(draftState.arkMode);
  const [modelDialogState, setModelDialogState] = useState<ProviderModelDialogState | null>(null);
  const [oauthFlowing, setOauthFlowing] = useState(false);
  const [oauthData, setOauthData] = useState<OAuthFlowData | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [referencedModelIds, setReferencedModelIds] = useState<Set<string>>(new Set());

  const effectiveDocsUrl = codePlanPreset && arkMode === 'codeplan'
    ? (typeInfo?.codePlanDocsUrl || providerDocsUrl)
    : providerDocsUrl;
  const canEditProtocol = account.vendorId === 'custom';
  const canEditModelConfig = Boolean(typeInfo?.showBaseUrl || showModelIdField);
  const supportsApiKeyMode = vendor?.supportedAuthModes.includes('api_key') ?? account.authMode === 'api_key';
  const preferredOAuthMode = vendor?.supportedAuthModes.includes('oauth_browser')
    ? 'oauth_browser'
    : (vendor?.supportedAuthModes.includes('oauth_device') ? 'oauth_device' : null);
  const supportsModeToggle = Boolean(supportsApiKeyMode && preferredOAuthMode);
  const [authModeSelection, setAuthModeSelection] = useState<'oauth' | 'apikey'>(
    account.authMode === 'api_key' ? 'apikey' : 'oauth',
  );
  const selectedAuthMode = supportsModeToggle
    ? (authModeSelection === 'oauth' ? preferredOAuthMode! : 'api_key')
    : account.authMode;
  const usesApiKeyAuth = selectedAuthMode === 'api_key';
  const usesOAuthAuth = selectedAuthMode === 'oauth_device' || selectedAuthMode === 'oauth_browser';
  const hasConfiguredAuth = hasConfiguredCredentials(account, status);
  const oauthConfigured = usesOAuthAuth && account.authMode === selectedAuthMode && hasConfiguredAuth;
  const apiKeyConfigured = status?.hasKey ?? false;
  const currentBaseUrl = account.baseUrl || undefined;
  const currentApiProtocol = account.apiProtocol || 'openai-completions';
  const hasBaseUrlChange = Boolean(typeInfo?.showBaseUrl) && (baseUrl.trim() || undefined) !== currentBaseUrl;
  const hasProtocolChange = canEditProtocol && apiProtocol !== currentApiProtocol;
  const effectiveModelEntries = useMemo(
    () => buildProviderEffectiveModelEntries(typeInfo, modelCatalog),
    [modelCatalog, typeInfo],
  );
  const modelListItems = useMemo(
    () => buildProviderModelListItems(typeInfo, modelCatalog),
    [modelCatalog, typeInfo],
  );
  const canAddCustomModels = modelCatalogMode === 'runtime-editable';
  const hasModelChange = showModelIdField && (
    !providerModelEntriesEqual(effectiveModelEntries, configuredModelEntries)
    || JSON.stringify(modelCatalog) !== JSON.stringify(initialModelCatalog)
  );
  const authModeChangeNeedsSave = usesApiKeyAuth && account.authMode !== 'api_key';
  const missingApiKeyForModeSwitch = authModeChangeNeedsSave && !apiKeyConfigured && !newKey.trim();
  const hasPendingChanges = Boolean(newKey.trim()) || hasBaseUrlChange || hasProtocolChange || hasModelChange || authModeChangeNeedsSave;
  const missingRequiredModel = showModelIdField && effectiveModelEntries.length === 0;
  const hasEditableFields = canEditModelConfig || usesApiKeyAuth || authModeChangeNeedsSave;
  const headerLink = usesApiKeyAuth && typeInfo?.apiKeyUrl
    ? { href: typeInfo.apiKeyUrl, label: t('aiProviders.oauth.getApiKey') }
    : (effectiveDocsUrl ? { href: effectiveDocsUrl, label: t('aiProviders.dialog.customDoc') } : null);
  const pendingOAuthRef = React.useRef<{ accountId: string } | null>(null);
  const sectionClassName = 'border-t border-black/6 pt-5 dark:border-white/10';
  const subtlePanelClassName = 'rounded-2xl border border-black/8 bg-black/[0.025] dark:border-white/10 dark:bg-white/[0.03]';
  const inputClassName = 'field-focus-ring h-[40px] rounded-xl border border-black/8 bg-black/[0.025] font-mono text-[13px] shadow-none dark:border-white/10 dark:bg-white/[0.03]';

  useEffect(() => {
    setNewKey('');
    setShowKey(false);
    setBaseUrl(draftState.baseUrl);
    setApiProtocol(draftState.apiProtocol);
    setModelCatalog(initialModelCatalog);
    setArkMode(draftState.arkMode);
    setModelDialogState(null);
    setOauthFlowing(false);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);
  }, [
    draftState.apiProtocol,
    draftState.arkMode,
    draftState.baseUrl,
    initialModelCatalog,
  ]);

  useEffect(() => {
    setAuthModeSelection(account.authMode === 'api_key' ? 'apikey' : 'oauth');
  }, [account.authMode]);

  useEffect(() => {
    let cancelled = false;

    const loadReferencedModelIds = async () => {
      try {
        const snapshot = await hostApiFetch<AgentDefaultModelReferenceSnapshot>('/api/agents/default-model');
        if (cancelled) {
          return;
        }

        const selectedRefs = collectReferencedModelRefs(snapshot);
        const group = snapshot.availableModels.find((item) => item.providerId === account.id);
        if (!group) {
          setReferencedModelIds(new Set());
          return;
        }

        const nextReferencedModelIds = new Set<string>();
        for (const modelRef of group.modelRefs) {
          if (!selectedRefs.has(modelRef)) {
            continue;
          }
          const separatorIndex = modelRef.indexOf('/');
          if (separatorIndex === -1 || separatorIndex === modelRef.length - 1) {
            continue;
          }
          nextReferencedModelIds.add(modelRef.slice(separatorIndex + 1));
        }

        setReferencedModelIds(nextReferencedModelIds);
      } catch {
        if (!cancelled) {
          setReferencedModelIds(new Set());
        }
      }
    };

    void loadReferencedModelIds();

    return () => {
      cancelled = true;
    };
  }, [account.id]);

  const resetDrafts = () => {
    setNewKey('');
    setShowKey(false);
    setBaseUrl(draftState.baseUrl);
    setApiProtocol(draftState.apiProtocol);
    setModelCatalog(initialModelCatalog);
    setArkMode(draftState.arkMode);
    setAuthModeSelection(account.authMode === 'api_key' ? 'apikey' : 'oauth');
    setModelDialogState(null);
  };

  useEffect(() => {
    const handleCode = (data: unknown) => {
      if (!pendingOAuthRef.current || pendingOAuthRef.current.accountId !== account.id) {
        return;
      }
      setOauthData(normalizeOAuthFlowPayload(data));
      setOauthError(null);
    };

    const handleSuccess = async (data: unknown) => {
      const payload = (data as { accountId?: string } | undefined) || undefined;
      const accountId = payload?.accountId || pendingOAuthRef.current?.accountId;
      if (!pendingOAuthRef.current || accountId !== pendingOAuthRef.current.accountId) {
        return;
      }

      pendingOAuthRef.current = null;
      setOauthFlowing(false);
      setOauthData(null);
      setManualCodeInput('');
      setOauthError(null);

      try {
        await onRefresh();
        toast.success(t('aiProviders.toast.updated'));
      } catch (error) {
        toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
      }
    };

    const handleError = (data: unknown) => {
      if (!pendingOAuthRef.current || pendingOAuthRef.current.accountId !== account.id) {
        return;
      }
      setOauthError((data as { message: string }).message);
      setOauthData(null);
      setOauthFlowing(false);
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
  }, [account.id, onRefresh, t]);

  const handleStartOAuth = async () => {
    if (!usesOAuthAuth) {
      return;
    }

    setOauthFlowing(true);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);

    try {
      pendingOAuthRef.current = { accountId: account.id };
      await hostApiFetch('/api/providers/oauth/start', {
        method: 'POST',
        body: JSON.stringify({
          provider: account.vendorId,
          accountId: account.id,
          label: account.label,
        }),
      });
    } catch (error) {
      setOauthError(String(error));
      setOauthFlowing(false);
      pendingOAuthRef.current = null;
    }
  };

  const handleCancelOAuth = async () => {
    setOauthFlowing(false);
    setOauthData(null);
    setManualCodeInput('');
    setOauthError(null);
    pendingOAuthRef.current = null;
    await hostApiFetch('/api/providers/oauth/cancel', {
      method: 'POST',
    });
  };

  const handleSubmitManualOAuthCode = async () => {
    const value = manualCodeInput.trim();
    if (!value) {
      return;
    }

    try {
      await hostApiFetch('/api/providers/oauth/submit', {
        method: 'POST',
        body: JSON.stringify({ code: value }),
      });
      setOauthError(null);
    } catch (error) {
      setOauthError(String(error));
    }
  };

  const handleSaveEdits = async () => {
    if (!hasPendingChanges) {
      return;
    }

    if (missingRequiredModel) {
      toast.error(t('aiProviders.toast.modelRequired'));
      return;
    }

    if (missingApiKeyForModeSwitch) {
      toast.error(t('aiProviders.toast.invalidKey'));
      return;
    }

    setSaving(true);
    try {
      let nextApiKey: string | undefined;

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
        nextApiKey = newKey.trim();
      }

      const updates: Partial<ProviderAccount> = {};
      if (hasBaseUrlChange) {
        updates.baseUrl = baseUrl.trim() || undefined;
      }
      if (hasProtocolChange) {
        updates.apiProtocol = apiProtocol || 'openai-completions';
      }
      if (hasModelChange) {
        updates.models = [];
        updates.metadata = {
          ...account.metadata,
          modelCatalog,
        };
      }
      if (authModeChangeNeedsSave) {
        updates.authMode = 'api_key';
      }

      // Keep Ollama key optional in UI, but persist a placeholder when
      // editing legacy configs that have no stored key.
      if (account.vendorId === 'ollama' && !status?.hasKey && !nextApiKey) {
        nextApiKey = resolveProviderApiKeyForSave(account.vendorId, '') as string;
      }

      if (!nextApiKey && Object.keys(updates).length === 0) {
        return;
      }

      await onSaveAccount(updates, nextApiKey);
      setNewKey('');
      setShowKey(false);
      toast.success(t('aiProviders.toast.updated'));
    } catch (error) {
      const message = String(error);
      if (message.includes('BLOCKED_BY_FALLBACK:')) {
        const refs = message.split('BLOCKED_BY_FALLBACK:')[1] ?? '';
        toast.error(t('aiProviders.toast.blockedByFallback', { refs }), {
          duration: 6000,
        });
      } else {
        toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
      }
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };

  return (
    <div className="flex h-full flex-col p-4 md:p-5 xl:p-6">
      <div className="space-y-5">
        <div className="space-y-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl  bg-black/[0.03] text-foreground dark:bg-white/[0.04]">
                {getProviderIconUrl(account.vendorId) ? (
                  <img
                    src={getProviderIconUrl(account.vendorId)}
                    alt={typeInfo?.name || account.vendorId}
                    className={cn('h-5 w-5', shouldInvertInDark(account.vendorId) && 'dark:invert')}
                  />
                ) : (
                  <span className="text-xl">{vendor?.icon || typeInfo?.icon || '⚙️'}</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-[22px] font-semibold text-foreground">
                    {vendor?.name || account.vendorId}
                  </h3>
                </div>
                {account.label && account.label !== (vendor?.name || account.vendorId) && (
                <p className="text-[12px] text-muted-foreground">
                  {account.label}
                </p>
                )}
                {account.vendorId === 'custom' && (
                  <p className="font-mono text-[12px] text-muted-foreground">
                    {item.runtimeProviderId}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              {headerLink && (
                <a
                  href={headerLink.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-info hover:opacity-80"
                >
                  {headerLink.label}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-muted-foreground hover:bg-black/[0.04] hover:text-destructive dark:hover:bg-white/[0.06]"
                onClick={onDelete}
                title={t('aiProviders.card.delete')}
              >
                <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {supportsModeToggle ? (
            <div className="max-w-[340px]">
              <SegmentedControl
                ariaLabel={t('aiProviders.dialog.authMode')}
                value={authModeSelection}
                onValueChange={setAuthModeSelection}
                options={[
                  { value: 'oauth', label: t('aiProviders.oauth.loginMode') },
                  { value: 'apikey', label: t('aiProviders.oauth.apikeyMode') },
                ]}
                fullWidth
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-black/8 bg-black/[0.03] px-3 py-1.5 text-[12px] font-medium text-foreground dark:border-white/10 dark:bg-white/[0.04]">
                {getAuthModeLabel(account.authMode, t)}
              </span>
              {hasConfiguredAuth ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-3 py-1.5 text-[12px] font-medium text-green-700 dark:text-green-400">
                  <div className="h-1.5 w-1.5 rounded-full bg-current" />
                  {t('aiProviders.card.configured')}
                </span>
              ) : null}
            </div>
          )}
        </div>

      {usesOAuthAuth && (
          <section className={sectionClassName}>
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-0.5">
                  <Label className="text-[14px] font-bold text-foreground/80">{t('aiProviders.dialog.authMode')}</Label>
                  <p className="text-[12px] text-muted-foreground">
                    {oauthConfigured ? t('aiProviders.card.configured') : t('aiProviders.oauth.loginPrompt')}
                  </p>
                </div>
                {oauthConfigured ? (
                  <div className="flex items-center gap-1.5 rounded-md bg-green-500/10 px-2 py-1 text-[11px] font-medium text-green-600 dark:text-green-500">
                    <div className="h-1.5 w-1.5 rounded-full bg-current" />
                    {t('aiProviders.card.configured')}
                  </div>
                ) : null}
              </div>

              <div className={cn(subtlePanelClassName, 'p-5')}>
                <p className="mb-4 text-[13px] font-medium text-foreground/80">
                  {t('aiProviders.oauth.loginPrompt')}
                </p>
                <Button
                  onClick={handleStartOAuth}
                  disabled={oauthFlowing}
                  className="h-10 w-full rounded-full px-5 text-[13px] font-medium shadow-none"
                >
                  {oauthFlowing ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('aiProviders.oauth.waiting')}</>
                  ) : (
                    t('aiProviders.oauth.loginButton')
                  )}
                </Button>
              </div>

              {oauthFlowing && (
                <div className={cn(subtlePanelClassName, 'relative overflow-hidden p-5')}>
                  <div className="absolute inset-0 animate-pulse bg-black/[0.02] dark:bg-white/[0.03]" />

                  <div className="relative z-10 flex flex-col items-center justify-center space-y-5 text-center">
                    {oauthError ? (
                      <div className="space-y-3 text-red-500">
                        <XCircle className="mx-auto h-10 w-10" />
                        <p className="text-[15px] font-semibold">{t('aiProviders.oauth.authFailed')}</p>
                        <p className="text-[13px] opacity-80">{oauthError}</p>
                        <Button variant="outline" size="sm" onClick={handleCancelOAuth} className="modal-secondary-button mt-2 shadow-none">
                          {t('aiProviders.oauth.tryAgain')}
                        </Button>
                      </div>
                    ) : !oauthData ? (
                      <div className="space-y-4 py-6">
                        <Loader2 className="mx-auto h-10 w-10 animate-spin text-info" />
                        <p className="animate-pulse text-[13px] font-medium text-muted-foreground">{t('aiProviders.oauth.requestingCode')}</p>
                      </div>
                    ) : oauthData.mode === 'manual' ? (
                      <div className="w-full space-y-5">
                        <div className="space-y-2">
                          <h3 className="text-[16px] font-semibold text-foreground">{t('aiProviders.oauth.manualTitle')}</h3>
                          <div className="modal-section-surface rounded-xl border p-4 text-left text-[13px] text-muted-foreground">
                            {oauthData.message || t('aiProviders.oauth.manualMessage')}
                          </div>
                        </div>

                        <Button
                          variant="secondary"
                          className="modal-secondary-button w-full shadow-none"
                          onClick={() => invokeIpc('shell:openExternal', oauthData.authorizationUrl)}
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          {t('aiProviders.oauth.manualOpenAuthorizationPage')}
                        </Button>

                        <Input
                          placeholder={t('aiProviders.oauth.manualInputPlaceholder')}
                          value={manualCodeInput}
                          onChange={(e) => setManualCodeInput(e.target.value)}
                          className="modal-field-surface field-focus-ring h-[44px] rounded-xl border font-mono text-[13px] shadow-sm"
                        />

                        <Button
                          className="modal-primary-button w-full"
                          onClick={handleSubmitManualOAuthCode}
                          disabled={!manualCodeInput.trim()}
                        >
                          {t('aiProviders.oauth.manualSubmit')}
                        </Button>

                        <Button variant="ghost" className="modal-secondary-button w-full shadow-none" onClick={handleCancelOAuth}>
                          {t('aiProviders.oauth.cancel')}
                        </Button>
                      </div>
                    ) : (
                      <div className="w-full space-y-5">
                        <div className="space-y-2">
                          <h3 className="text-[16px] font-semibold text-foreground">{t('aiProviders.oauth.approveLogin')}</h3>
                          <div className="mt-2 space-y-1.5 rounded-xl border border-black/8 bg-black/[0.03] p-4 text-left text-[13px] text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
                            <p>1. {t('aiProviders.oauth.step1')}</p>
                            <p>2. {t('aiProviders.oauth.step2')}</p>
                            <p>3. {t('aiProviders.oauth.step3')}</p>
                          </div>
                        </div>

                        <div className="flex items-center justify-center gap-3 rounded-xl border border-black/8 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.04]">
                          <code className="text-3xl font-mono font-bold tracking-[0.2em] text-foreground">
                            {oauthData.userCode}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 rounded-full hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
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
                          className="modal-secondary-button w-full shadow-none"
                          onClick={() => invokeIpc('shell:openExternal', oauthData.verificationUri)}
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          {t('aiProviders.oauth.openLoginPage')}
                        </Button>

                        <div className="flex items-center justify-center gap-2 pt-2 text-[13px] font-medium text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin text-info" />
                          <span>{t('aiProviders.oauth.waitingApproval')}</span>
                        </div>

                        <Button variant="ghost" className="modal-secondary-button w-full shadow-none" onClick={handleCancelOAuth}>
                          {t('aiProviders.oauth.cancel')}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}


        {canEditModelConfig && (
          <section className={sectionClassName}>
            <div className="space-y-4">
              {codePlanPreset && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.codePlanPreset')}</Label>
                    {typeInfo?.codePlanDocsUrl && (
                      <a
                        href={typeInfo.codePlanDocsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-info hover:opacity-80"
                      >
                        {t('aiProviders.dialog.codePlanDoc')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <SegmentedControl
                    ariaLabel={t('aiProviders.dialog.codePlanPreset')}
                    value={arkMode}
                    onValueChange={(nextMode) => {
                      if (nextMode === 'apikey') {
                        setArkMode('apikey');
                        setBaseUrl(typeInfo?.defaultBaseUrl || '');
                        if (effectiveModelEntries.length === 1 && effectiveModelEntries[0]?.id === codePlanPreset.modelId) {
                          setModelCatalog(initialModelCatalog);
                        }
                        return;
                      }

                      setArkMode('codeplan');
                      setBaseUrl(codePlanPreset.baseUrl);
                      setModelCatalog({
                        disabledBuiltinModelIds: getDefaultProviderModelEntries(typeInfo).map((model) => model.id),
                        disabledCustomModelIds: [],
                        customModels: [createProviderModelEntry(codePlanPreset.modelId)],
                        builtinModelOverrides: [],
                      });
                    }}
                    options={[
                      { value: 'apikey', label: t('aiProviders.authModes.apiKey') },
                      { value: 'codeplan', label: t('aiProviders.dialog.codePlanMode') },
                    ]}
                    fullWidth
                  />
                  {arkMode === 'codeplan' && (
                    <p className="text-[12px] text-muted-foreground">
                      {t('aiProviders.dialog.codePlanPresetDesc', {
                        baseUrl: codePlanPreset.baseUrl,
                        modelId: codePlanPreset.modelId,
                      })}
                    </p>
                  )}
                </div>
              )}
              {typeInfo?.showBaseUrl && (
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.baseUrl')}</Label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={getProtocolBaseUrlPlaceholder(apiProtocol)}
                    className={inputClassName}
                  />
                </div>
              )}
              {canEditProtocol && (
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                  <div className="flex flex-wrap gap-2 text-[13px]">
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-completions')}
                      className={cn(
                        'flex-1 rounded-xl border px-3 py-2 transition-colors',
                        apiProtocol === 'openai-completions'
                          ? 'border-black/12 bg-black/[0.06] font-medium text-foreground dark:border-white/10 dark:bg-white/[0.09]'
                          : 'border-black/8 bg-black/[0.025] text-muted-foreground hover:bg-black/[0.04] dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.05]',
                      )}
                    >
                      {t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-responses')}
                      className={cn(
                        'flex-1 rounded-xl border px-3 py-2 transition-colors',
                        apiProtocol === 'openai-responses'
                          ? 'border-black/12 bg-black/[0.06] font-medium text-foreground dark:border-white/10 dark:bg-white/[0.09]'
                          : 'border-black/8 bg-black/[0.025] text-muted-foreground hover:bg-black/[0.04] dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.05]',
                      )}
                    >
                      {t('aiProviders.protocols.openaiResponses', 'OpenAI Responses')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('anthropic-messages')}
                      className={cn(
                        'flex-1 rounded-xl border px-3 py-2 transition-colors',
                        apiProtocol === 'anthropic-messages'
                          ? 'border-black/12 bg-black/[0.06] font-medium text-foreground dark:border-white/10 dark:bg-white/[0.09]'
                          : 'border-black/8 bg-black/[0.025] text-muted-foreground hover:bg-black/[0.04] dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.05]',
                      )}
                    >
                      {t('aiProviders.protocols.anthropic', 'Anthropic')}
                    </button>
                  </div>
                </div>
              )}
              {showModelIdField ? (
                <ProviderModelConfigSection
                  title={t('aiProviders.sections.model')}
                  emptyLabel={t('aiProviders.models.empty')}
                  items={modelListItems}
                  providerType={account.vendorId}
                  providerEmoji={vendor?.icon || typeInfo?.icon}
                  canAddCustomModels={canAddCustomModels}
                  referencedModelIds={referencedModelIds}
                  onAdd={() => setModelDialogState({ mode: 'add', index: null })}
                  onToggle={(item, enabled) => {
                    if (item.source === 'builtin') {
                      setModelCatalog((current) => ({
                        ...current,
                        disabledBuiltinModelIds: enabled
                          ? current.disabledBuiltinModelIds.filter((id) => id !== item.id)
                          : normalizeProviderModelList([...current.disabledBuiltinModelIds, item.id]),
                      }));
                      return;
                    }

                    setModelCatalog((current) => ({
                      ...current,
                      disabledCustomModelIds: enabled
                        ? current.disabledCustomModelIds.filter((id) => id !== item.id)
                        : normalizeProviderModelList([...current.disabledCustomModelIds, item.id]),
                    }));
                  }}
                  onEdit={(item) => setModelDialogState({ mode: 'edit', index: null, model: item.model })}
                  onDelete={(item) => setModelCatalog((current) => ({
                    ...current,
                    customModels: current.customModels.filter((model) => model.id !== item.id),
                    disabledCustomModelIds: current.disabledCustomModelIds.filter((id) => id !== item.id),
                  }))}
                />
              ) : null}
            </div>
          </section>
        )}

        {usesApiKeyAuth && (
          <section className={sectionClassName}>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <Label className="text-[14px] font-bold text-foreground/80">{t('aiProviders.dialog.apiKey')}</Label>
                  <p className="text-[12px] text-muted-foreground">
                    {apiKeyConfigured
                      ? t('aiProviders.dialog.apiKeyConfigured')
                      : t('aiProviders.dialog.apiKeyMissing')}
                  </p>
                </div>
                {apiKeyConfigured ? (
                  <div className="flex items-center gap-1.5 rounded-md bg-green-500/10 px-2 py-1 text-[11px] font-medium text-green-600 dark:text-green-500">
                    <div className="h-1.5 w-1.5 rounded-full bg-current" />
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
                    className="flex items-center gap-1 text-[13px] text-info hover:underline hover:opacity-80"
                    tabIndex={-1}
                  >
                    {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              <div className="space-y-1.5 pt-1">
                <Label className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.replaceApiKey')}</Label>
                <div className="relative">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder={typeInfo?.requiresApiKey ? typeInfo?.placeholder : (typeInfo?.id === 'ollama' ? t('aiProviders.notRequired') : t('aiProviders.card.editKey'))}
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className={cn(inputClassName, 'pr-10')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  {t('aiProviders.dialog.replaceApiKeyHelp')}
                </p>
              </div>
            </div>
          </section>
        )}

        {hasEditableFields && (
          <div className="flex justify-end gap-2 border-t border-black/6 pt-5 dark:border-white/10">
            <button
              type="button"
              className="modal-secondary-button shadow-none"
              disabled={!hasPendingChanges || saving || validating}
              onClick={resetDrafts}
            >
              {t('aiProviders.dialog.reset')}
            </button>
            <button
              type="button"
              className="modal-primary-button inline-flex items-center gap-2 shadow-none disabled:opacity-50"
              disabled={validating || saving || !hasPendingChanges || missingRequiredModel || missingApiKeyForModeSwitch}
              onClick={handleSaveEdits}
            >
              {validating || saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t('aiProviders.dialog.save')}
            </button>
          </div>
        )}
      </div>
      {modelDialogState ? (
        <ProviderModelDialog
          title={t(
            modelDialogState.mode === 'add'
              ? 'aiProviders.models.dialog.addTitle'
              : 'aiProviders.models.dialog.editTitle',
          )}
          placeholder={typeInfo?.modelIdPlaceholder || 'provider/model-id'}
          initialValue={modelDialogState.model}
          onClose={() => setModelDialogState(null)}
          onSave={(nextModel) => {
            setModelCatalog((current) => {
              const nextEntries = current.customModels
                .filter((entry) => entry.id !== modelDialogState.model?.id)
                .concat(nextModel);

              return {
                ...current,
                customModels: normalizeProviderModelEntries(nextEntries),
                disabledCustomModelIds: current.disabledCustomModelIds.filter((id) => id !== nextModel.id),
              };
            });
            setModelDialogState(null);
          }}
        />
      ) : null}
    </div>
  );
}

interface AddProviderDialogProps {
  initialType?: ProviderType | null;
  existingVendorIds: Set<string>;
  existingRuntimeProviderIds: Set<string>;
  vendors: ProviderVendorInfo[];
  onClose: () => void;
  onAdd: (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: {
      baseUrl?: string;
      modelCatalog?: ProviderModelCatalogState;
      authMode?: ProviderAccount['authMode'];
      apiProtocol?: ProviderAccount['apiProtocol'];
      runtimeProviderKey?: string;
    }
  ) => Promise<void>;
  onValidateKey: (
    type: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  devModeUnlocked: boolean;
}

type SegmentedProtocol = NonNullable<ProviderAccount['apiProtocol']>;

function AddProviderDialog({
  initialType = null,
  existingVendorIds,
  existingRuntimeProviderIds,
  vendors,
  onClose,
  onAdd,
  onValidateKey,
  devModeUnlocked,
}: AddProviderDialogProps) {
  const { t, i18n } = useTranslation('settings');
  const [selectedType, setSelectedType] = useState<ProviderType | null>(initialType);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>('openai-completions');
  const [customProviderKeySegment, setCustomProviderKeySegment] = useState('');
  const [customProviderKeyTouched, setCustomProviderKeyTouched] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<ProviderModelCatalogDraft>(normalizeProviderModelCatalogDraft());
  const [arkMode, setArkMode] = useState<CodePlanMode>('apikey');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [modelDialogState, setModelDialogState] = useState<ProviderModelDialogState | null>(null);

  // OAuth Flow State
  const [oauthFlowing, setOauthFlowing] = useState(false);
  const [oauthData, setOauthData] = useState<OAuthFlowData | null>(null);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [oauthError, setOauthError] = useState<string | null>(null);
  // For providers that support both OAuth and API key, let the user choose.
  // Default to the vendor's declared auth mode instead of hard-coding OAuth.
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>('apikey');

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === selectedType);
  const modelCatalogMode = getProviderModelCatalogMode(typeInfo);
  const canAddCustomModels = modelCatalogMode === 'runtime-editable';
  const modelListItems = useMemo(
    () => buildProviderModelListItems(typeInfo, modelCatalog),
    [modelCatalog, typeInfo],
  );
  const effectiveModelEntries = useMemo(
    () => buildProviderEffectiveModelEntries(typeInfo, modelCatalog),
    [modelCatalog, typeInfo],
  );
  const providerDocsUrl = getProviderDocsUrl(typeInfo, i18n.language);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const codePlanPreset = getProviderCodePlanPreset(typeInfo);
  const effectiveDocsUrl = codePlanPreset && arkMode === 'codeplan'
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
      : ((selectedType === 'google' || selectedType === 'openai') ? 'oauth_browser' : null));
  const normalizedCustomProviderKeySegment = customProviderKeySegment.trim().toLowerCase();
  const customRuntimeProviderKey = selectedType === 'custom' && normalizedCustomProviderKeySegment
    ? buildCustomProviderRuntimeKey(normalizedCustomProviderKeySegment)
    : '';
  // Effective OAuth mode: pure OAuth providers, or dual-mode with oauth selected
  const useOAuthFlow = isOAuth && (!supportsApiKey || authMode === 'oauth');

  useEffect(() => {
    if (!initialType) {
      return;
    }

    const initialTypeInfo = PROVIDER_TYPE_INFO.find((provider) => provider.id === initialType);
    setSelectedType(initialType);
    setName(initialType === 'custom' ? t('aiProviders.custom') : (initialTypeInfo?.name || initialType));
    setApiKey('');
    setBaseUrl(initialTypeInfo?.defaultBaseUrl || '');
    setApiProtocol('openai-completions');
    setCustomProviderKeySegment(initialType === 'custom' ? slugifyCustomProviderKeySegment(t('aiProviders.custom')) : '');
    setCustomProviderKeyTouched(false);
    setModelCatalog(normalizeProviderModelCatalogDraft());
    setArkMode('apikey');
    setValidationError(null);
  }, [initialType, t]);

  useEffect(() => {
    if (selectedType !== 'custom' || customProviderKeyTouched) {
      return;
    }

    setCustomProviderKeySegment(slugifyCustomProviderKeySegment(name));
  }, [customProviderKeyTouched, name, selectedType]);

  useEffect(() => {
    if (!selectedVendor || !isOAuth || !supportsApiKey) {
      return;
    }
    setAuthMode(selectedVendor.defaultAuthMode === 'api_key' ? 'apikey' : 'oauth');
  }, [selectedVendor, isOAuth, supportsApiKey]);

  useEffect(() => {
    if (!codePlanPreset) {
      setArkMode('apikey');
    }
  }, [codePlanPreset]);

  // Keep refs to the latest values so event handlers see the current dialog state.
  const latestRef = React.useRef({ selectedType, typeInfo, onAdd, onClose, t });
  const pendingOAuthRef = React.useRef<{ accountId: string; label: string } | null>(null);
  useEffect(() => {
    latestRef.current = { selectedType, typeInfo, onAdd, onClose, t };
  });

  // Manage OAuth events
  useEffect(() => {
    const handleCode = (data: unknown) => {
      setOauthData(normalizeOAuthFlowPayload(data));
      setOauthError(null);
    };

    const handleSuccess = async () => {
      setOauthFlowing(false);
      setOauthData(null);
      setManualCodeInput('');
      setValidationError(null);

      const { onClose: close, t: translate } = latestRef.current;

      // device-oauth.ts already saved the provider config to the backend,
      // including the dynamically resolved baseUrl for the region (e.g. CN vs Global).
      // If we call add() here with undefined baseUrl, it will overwrite and erase it!
      // So we just fetch the latest list from the backend to update the UI.
      try {
        const store = useProviderStore.getState();
        await store.refreshProviderSnapshot();
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
    setManualCodeInput('');
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
    setManualCodeInput('');
    setOauthError(null);
    pendingOAuthRef.current = null;
    await hostApiFetch('/api/providers/oauth/cancel', {
      method: 'POST',
    });
  };

  const handleSubmitManualOAuthCode = async () => {
    const value = manualCodeInput.trim();
    if (!value) {
      return;
    }

    try {
      await hostApiFetch('/api/providers/oauth/submit', {
        method: 'POST',
        body: JSON.stringify({ code: value }),
      });
      setOauthError(null);
    } catch (error) {
      setOauthError(String(error));
    }
  };

  const availableTypes = PROVIDER_TYPE_INFO.filter((type) => {
    if (type.hidden) {
      return false;
    }

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
      if (selectedType === 'custom') {
        if (!normalizedCustomProviderKeySegment) {
          setValidationError(t('aiProviders.toast.customProviderIdRequired'));
          setSaving(false);
          return;
        }
        if (!isValidCustomProviderKeySegment(normalizedCustomProviderKeySegment)) {
          setValidationError(t('aiProviders.toast.customProviderIdInvalid'));
          setSaving(false);
          return;
        }
        if (existingRuntimeProviderIds.has(customRuntimeProviderKey)) {
          setValidationError(t('aiProviders.toast.customProviderIdDuplicate'));
          setSaving(false);
          return;
        }
      }

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

      const requiresModel = showModelIdField;
      if (requiresModel && effectiveModelEntries.length === 0) {
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
          modelCatalog,
          runtimeProviderKey: selectedType === 'custom' ? customRuntimeProviderKey : undefined,
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
                    setCustomProviderKeySegment(type.id === 'custom' ? slugifyCustomProviderKeySegment(t('aiProviders.custom')) : '');
                    setCustomProviderKeyTouched(false);
                    setModelCatalog(normalizeProviderModelCatalogDraft());
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
              <div className="modal-field-surface flex items-center gap-3 p-4 rounded-2xl border">
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
                        setCustomProviderKeySegment('');
                        setCustomProviderKeyTouched(false);
                        setModelCatalog(normalizeProviderModelCatalogDraft());
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

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-[14px] font-bold text-foreground/80">{t('aiProviders.dialog.displayName')}</Label>
                  <Input
                    id="name"
                    placeholder={typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px]"
                  />
                </div>

                {selectedType === 'custom' && (
                  <div className="space-y-2">
                    <Label htmlFor="providerId" className="text-[14px] font-bold text-foreground/80">{t('aiProviders.dialog.providerId')}</Label>
                    <div className="modal-field-surface flex h-[44px] items-center overflow-hidden rounded-xl border">
                      <span className="border-r border-black/8 px-3 font-mono text-[13px] text-muted-foreground dark:border-white/10">
                        custom-
                      </span>
                      <Input
                        id="providerId"
                        placeholder="my-provider"
                        value={customProviderKeySegment}
                        onChange={(e) => {
                          setCustomProviderKeyTouched(true);
                          setCustomProviderKeySegment(slugifyCustomProviderKeySegment(e.target.value));
                        }}
                        className="h-full border-0 bg-transparent font-mono text-[13px] shadow-none focus-visible:ring-0"
                      />
                    </div>
                    <p className="text-[12px] text-muted-foreground">
                      {t('aiProviders.dialog.providerIdHelp', {
                        value: customRuntimeProviderKey || 'custom-my-provider',
                      })}
                    </p>
                  </div>
                )}

                {/* Auth mode toggle for providers supporting both */}
                {isOAuth && supportsApiKey && (
                  <SegmentedControl
                    ariaLabel={t('aiProviders.dialog.authMode')}
                    value={authMode}
                    onValueChange={setAuthMode}
                    options={[
                      { value: 'oauth', label: t('aiProviders.oauth.loginMode') },
                      { value: 'apikey', label: t('aiProviders.oauth.apikeyMode') },
                    ]}
                    fullWidth
                    className="modal-field-surface"
                  />
                )}

                {codePlanPreset && (
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
                    <SegmentedControl
                      ariaLabel={t('aiProviders.dialog.codePlanPreset')}
                      value={arkMode}
                      onValueChange={(nextMode) => {
                        if (nextMode === 'apikey') {
                          setArkMode('apikey');
                          setBaseUrl(typeInfo?.defaultBaseUrl || '');
                          if (effectiveModelEntries.length === 1 && effectiveModelEntries[0]?.id === codePlanPreset.modelId) {
                            setModelCatalog(normalizeProviderModelCatalogDraft());
                          }
                          setValidationError(null);
                          return;
                        }

                        setArkMode('codeplan');
                        setBaseUrl(codePlanPreset.baseUrl);
                        setModelCatalog({
                          disabledBuiltinModelIds: getDefaultProviderModelEntries(typeInfo).map((model) => model.id),
                          disabledCustomModelIds: [],
                          customModels: [createProviderModelEntry(codePlanPreset.modelId)],
                          builtinModelOverrides: [],
                        });
                        setValidationError(null);
                      }}
                      options={[
                        { value: 'apikey', label: t('aiProviders.authModes.apiKey') },
                        { value: 'codeplan', label: t('aiProviders.dialog.codePlanMode') },
                      ]}
                      fullWidth
                    />
                    {arkMode === 'codeplan' && (
                      <p className="text-[12px] text-muted-foreground">
                        {t('aiProviders.dialog.codePlanPresetDesc', {
                          baseUrl: codePlanPreset.baseUrl,
                          modelId: codePlanPreset.modelId,
                        })}
                      </p>
                    )}
                  </div>
                )}

                {selectedType === 'custom' && (
                  <div className="space-y-2.5">
                    <Label className="text-[14px] font-bold text-foreground/80">{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                    <SegmentedControl<SegmentedProtocol>
                      ariaLabel={t('aiProviders.dialog.protocol', 'Protocol')}
                      value={apiProtocol || 'openai-completions'}
                      onValueChange={(nextProtocol) => setApiProtocol(nextProtocol)}
                      options={[
                        { value: 'openai-completions', label: t('aiProviders.protocols.openaiCompletions', 'OpenAI Completions') },
                        { value: 'openai-responses', label: t('aiProviders.protocols.openaiResponses', 'OpenAI Responses') },
                        { value: 'anthropic-messages', label: t('aiProviders.protocols.anthropic', 'Anthropic') },
                      ]}
                      fullWidth
                    />
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
                      className="modal-field-surface field-focus-ring h-[44px] rounded-xl font-mono text-[13px]"
                    />
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
                        className="modal-field-surface field-focus-ring pr-10 h-[44px] rounded-xl font-mono text-[13px]"
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
                                {t('aiProviders.oauth.tryAgain')}
                              </Button>
                            </div>
                          ) : !oauthData ? (
                            <div className="space-y-4 py-6">
                              <Loader2 className="text-info mx-auto h-10 w-10 animate-spin" />
                              <p className="text-[13px] font-medium text-muted-foreground animate-pulse">{t('aiProviders.oauth.requestingCode')}</p>
                            </div>
                          ) : oauthData.mode === 'manual' ? (
                            <div className="space-y-5 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-[16px] text-foreground">{t('aiProviders.oauth.manualTitle')}</h3>
                                <div className="modal-section-surface rounded-xl border p-4 text-left text-[13px] text-muted-foreground">
                                  {oauthData.message || t('aiProviders.oauth.manualMessage')}
                                </div>
                              </div>

                              <Button
                                variant="secondary"
                                className="modal-secondary-button w-full"
                                onClick={() => invokeIpc('shell:openExternal', oauthData.authorizationUrl)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                {t('aiProviders.oauth.manualOpenAuthorizationPage')}
                              </Button>

                              <Input
                                placeholder={t('aiProviders.oauth.manualInputPlaceholder')}
                                value={manualCodeInput}
                                onChange={(e) => setManualCodeInput(e.target.value)}
                                className="modal-field-surface field-focus-ring h-[44px] rounded-xl border font-mono text-[13px] shadow-sm"
                              />

                              <Button
                                className="modal-primary-button w-full"
                                onClick={handleSubmitManualOAuthCode}
                                disabled={!manualCodeInput.trim()}
                              >
                                {t('aiProviders.oauth.manualSubmit')}
                              </Button>

                              <Button variant="ghost" className="modal-secondary-button w-full" onClick={handleCancelOAuth}>
                                {t('aiProviders.oauth.cancel')}
                              </Button>
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
                                {t('aiProviders.oauth.cancel')}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {showModelIdField ? (
                <ProviderModelConfigSection
                  title={t('aiProviders.sections.model')}
                  emptyLabel={t('aiProviders.models.empty')}
                  items={modelListItems}
                  providerType={selectedType}
                  providerEmoji={typeInfo?.icon}
                  canAddCustomModels={canAddCustomModels}
                    onAdd={() => setModelDialogState({ mode: 'add', index: null })}
                    onToggle={(item, enabled) => {
                      if (item.source === 'builtin') {
                        setModelCatalog((current) => ({
                          ...current,
                          disabledBuiltinModelIds: enabled
                            ? current.disabledBuiltinModelIds.filter((id) => id !== item.id)
                            : normalizeProviderModelList([...current.disabledBuiltinModelIds, item.id]),
                        }));
                        return;
                      }

                      setModelCatalog((current) => ({
                        ...current,
                        disabledCustomModelIds: enabled
                          ? current.disabledCustomModelIds.filter((id) => id !== item.id)
                          : normalizeProviderModelList([...current.disabledCustomModelIds, item.id]),
                      }));
                    }}
                    onEdit={(item) => setModelDialogState({ mode: 'edit', index: null, model: item.model })}
                    onDelete={(item) => setModelCatalog((current) => ({
                      ...current,
                      customModels: current.customModels.filter((model) => model.id !== item.id),
                      disabledCustomModelIds: current.disabledCustomModelIds.filter((id) => id !== item.id),
                    }))}
                  />
                ) : null}
              </div>

              <Separator className="separator-subtle" />

              <div className="modal-footer">
                <Button
                  onClick={handleAdd}
                  className={cn("modal-primary-button px-8", useOAuthFlow && "hidden")}
                  disabled={!selectedType || saving || (showModelIdField && effectiveModelEntries.length === 0)}
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
      {modelDialogState ? (
        <ProviderModelDialog
          title={t(
            modelDialogState.mode === 'add'
              ? 'aiProviders.models.dialog.addTitle'
              : 'aiProviders.models.dialog.editTitle',
          )}
          placeholder={typeInfo?.modelIdPlaceholder || 'provider/model-id'}
          initialValue={modelDialogState.model}
          onClose={() => setModelDialogState(null)}
          onSave={(nextModel) => {
            setModelCatalog((current) => {
              const nextEntries = current.customModels
                .filter((entry) => entry.id !== modelDialogState.model?.id)
                .concat(nextModel);

              return {
                ...current,
                customModels: normalizeProviderModelEntries(nextEntries),
                disabledCustomModelIds: current.disabledCustomModelIds.filter((id) => id !== nextModel.id),
              };
            });
            setValidationError(null);
            setModelDialogState(null);
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}
