export type WebSearchProviderField = {
  key: string;
  type: 'string' | 'boolean' | 'enum' | 'secret';
  label?: string;
  help?: string;
  placeholder?: string;
  sensitive?: boolean;
  enumValues?: string[];
};

export type WebSearchProviderAvailability = {
  available: boolean;
  source: 'saved' | 'environment' | 'missing';
};

export type WebSearchProviderDescriptor = {
  providerId: string;
  pluginId: string;
  label: string;
  hint: string;
  availability?: WebSearchProviderAvailability;
  envVarStatuses?: Record<string, boolean>;
  envVars: string[];
  signupUrl: string;
  docsUrl?: string;
  fields: WebSearchProviderField[];
};

export type WebSearchSettingsResponse = {
  search: {
    enabled: boolean;
    provider?: string;
    maxResults?: number;
    timeoutSeconds?: number;
    cacheTtlMinutes?: number;
  };
  providerConfigByProvider: Record<string, Record<string, unknown>>;
};

export type WebSearchProvidersResponse = {
  providers: WebSearchProviderDescriptor[];
};

export type WebSearchSettingsPatch = {
  enabled?: boolean;
  provider?: string;
  shared?: {
    maxResults?: number | null;
    timeoutSeconds?: number | null;
    cacheTtlMinutes?: number | null;
  };
  providerConfig?: {
    providerId: string;
    values: Record<string, unknown>;
  };
};

export const WEB_SEARCH_SHARED_DEFAULTS = {
  maxResults: 5,
  timeoutSeconds: 30,
  cacheTtlMinutes: 15,
} as const;
