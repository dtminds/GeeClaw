export const PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'geeclaw',
  'ark',
  'moonshot',
  'moonshot-global',
  'siliconflow',
  'minimax-portal',
  'minimax-portal-cn',
  'modelstudio',
  'ollama',
  'custom',
] as const;

export const BUILTIN_PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'geeclaw',
  'ark',
  'moonshot',
  'moonshot-global',
  'siliconflow',
  'minimax-portal',
  'minimax-portal-cn',
  'modelstudio',
  'ollama',
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];
export type BuiltinProviderType = (typeof BUILTIN_PROVIDER_TYPES)[number];

export const OLLAMA_PLACEHOLDER_API_KEY = 'ollama-local';

export type ProviderProtocol =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages';

export type ProviderModelInputModality = 'text' | 'image';

export type ProviderAuthMode =
  | 'api_key'
  | 'oauth_device'
  | 'oauth_browser'
  | 'local';

export type ProviderVendorCategory =
  | 'official'
  | 'compatible'
  | 'local'
  | 'custom';

export type ProviderModelCatalogMode =
  | 'builtin-only'
  | 'runtime-editable';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiProtocol?: ProviderProtocol;
  models?: ProviderConfiguredModel[];
  /** @deprecated legacy single-model field kept for migration compatibility */
  model?: string;
  /** @deprecated legacy provider-level fallback field kept for migration compatibility */
  fallbackModels?: string[];
  /** @deprecated legacy provider-level fallback field kept for migration compatibility */
  fallbackProviderIds?: string[];
  metadata?: ProviderAccount['metadata'];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderWithKeyInfo extends ProviderConfig {
  hasKey: boolean;
  keyMasked: string | null;
}

export interface ProviderTypeInfo {
  id: ProviderType;
  name: string;
  icon: string;
  invertIconInDark?: boolean;
  placeholder: string;
  model?: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  showBaseUrl?: boolean;
  showModelId?: boolean;
  showModelIdInDevModeOnly?: boolean;
  modelIdPlaceholder?: string;
  defaultModelId?: string;
  defaultModels?: ProviderConfiguredModel[];
  modelCatalogMode?: ProviderModelCatalogMode;
  isOAuth?: boolean;
  supportsApiKey?: boolean;
  apiKeyUrl?: string;
  docsUrl?: string;
  docsUrlZh?: string;
  codePlanPresetBaseUrl?: string;
  codePlanPresetModelId?: string;
  codePlanDocsUrl?: string;
  hidden?: boolean;
}

export interface ProviderCodePlanPreset {
  baseUrl: string;
  modelId: string;
}

export interface ProviderModelEntry extends Record<string, unknown> {
  id: string;
  name: string;
  reasoning?: boolean;
  input?: ProviderModelInputModality[];
  contextWindow?: number;
  maxTokens?: number;
}

export type ProviderConfiguredModel = string | ProviderModelEntry;

export interface ProviderBackendConfig {
  baseUrl: string;
  api: ProviderProtocol;
  apiKeyEnv: string;
  models?: ProviderModelEntry[];
  headers?: Record<string, string>;
}

export interface ProviderModelCatalogState {
  disabledBuiltinModelIds?: string[];
  disabledCustomModelIds?: string[];
  customModels?: ProviderConfiguredModel[];
  /**
   * Legacy compatibility layer for previously edited built-in models.
   * New UI no longer exposes built-in editing, but we keep existing values
   * until the user removes them by resetting/toggling models.
   */
  builtinModelOverrides?: ProviderConfiguredModel[];
}

export interface ProviderDefinition extends ProviderTypeInfo {
  category: ProviderVendorCategory;
  envVar?: string;
  providerConfig?: ProviderBackendConfig;
  supportedAuthModes: ProviderAuthMode[];
  defaultAuthMode: ProviderAuthMode;
  supportsMultipleAccounts: boolean;
}

export interface ProviderVendorInfo extends ProviderTypeInfo {
  category: ProviderVendorCategory;
  envVar?: string;
  supportedAuthModes: ProviderAuthMode[];
  defaultAuthMode: ProviderAuthMode;
  supportsMultipleAccounts: boolean;
}

export interface ProviderAccount {
  id: string;
  vendorId: ProviderType;
  label: string;
  authMode: ProviderAuthMode;
  baseUrl?: string;
  apiProtocol?: ProviderProtocol;
  models?: ProviderConfiguredModel[];
  /** @deprecated legacy single-model field kept for migration compatibility */
  model?: string;
  /** @deprecated legacy provider-level fallback field kept for migration compatibility */
  fallbackModels?: string[];
  /** @deprecated legacy provider-level fallback field kept for migration compatibility */
  fallbackAccountIds?: string[];
  enabled: boolean;
  isDefault: boolean;
  metadata?: {
    region?: string;
    email?: string;
    resourceUrl?: string;
    runtimeProviderKey?: string;
    modelCatalog?: ProviderModelCatalogState;
    /** @deprecated legacy field kept for migration compatibility */
    customModels?: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export type ProviderSecret =
  | {
      type: 'api_key';
      accountId: string;
      apiKey: string;
    }
  | {
      type: 'oauth';
      accountId: string;
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      scopes?: string[];
      email?: string;
      subject?: string;
    }
  | {
      type: 'local';
      accountId: string;
      apiKey?: string;
    };

export interface ModelSummary {
  id: string;
  name: string;
  vendorId: string;
  accountId?: string;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  contextWindow?: number;
  pricing?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  source: 'builtin' | 'remote' | 'gateway' | 'custom';
}
