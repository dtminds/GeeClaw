import type { ProviderAccount } from '../../shared/providers/types';
import { getStoredCustomProviderRuntimeKey } from '../../shared/providers/runtime-provider-key';

const MULTI_INSTANCE_PROVIDER_TYPES = new Set(['custom', 'ollama']);

export const OPENCLAW_PROVIDER_KEY_MINIMAX = 'minimax-portal';
export const OPENCLAW_PROVIDER_KEY_MOONSHOT = 'moonshot';
export const OPENCLAW_PROVIDER_KEY_MOONSHOT_GLOBAL = 'moonshot-global';
export const OAUTH_PROVIDER_TYPES = ['minimax-portal', 'minimax-portal-cn'] as const;
export const OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEYS = [
  OPENCLAW_PROVIDER_KEY_MINIMAX,
] as const;

const OAUTH_PROVIDER_TYPE_SET = new Set<string>(OAUTH_PROVIDER_TYPES);
const OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEY_SET = new Set<string>(OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEYS);

const PROVIDER_KEY_ALIASES: Record<string, string> = {
  'minimax-portal-cn': OPENCLAW_PROVIDER_KEY_MINIMAX,
};

export function isMultiInstanceProviderType(type: string): boolean {
  return MULTI_INSTANCE_PROVIDER_TYPES.has(type);
}

export function getOpenClawProviderKeyForType(
  type: string,
  providerId: string,
  metadata?: ProviderAccount['metadata'],
): string {
  if (type === 'custom') {
    const explicitRuntimeKey = getStoredCustomProviderRuntimeKey(metadata);
    if (explicitRuntimeKey) {
      return explicitRuntimeKey;
    }
  }

  if (isMultiInstanceProviderType(type)) {
    const prefix = `${type}-`;
    if (providerId.startsWith(prefix) && !providerId.slice(prefix.length).includes('-')) {
      return providerId;
    }
    const suffix = providerId.replace(/-/g, '').slice(0, 8);
    return `${type}-${suffix}`;
  }

  return PROVIDER_KEY_ALIASES[type] ?? type;
}

export function isOAuthProviderType(type: string): boolean {
  return OAUTH_PROVIDER_TYPE_SET.has(type);
}

export function isMiniMaxProviderType(type: string): boolean {
  return type === OPENCLAW_PROVIDER_KEY_MINIMAX || type === 'minimax-portal-cn';
}

export function getOAuthProviderTargetKey(type: string): string | undefined {
  if (!isOAuthProviderType(type)) return undefined;
  return OPENCLAW_PROVIDER_KEY_MINIMAX;
}

export function getOAuthProviderApi(type: string): 'anthropic-messages' | undefined {
  if (!isOAuthProviderType(type)) return undefined;
  return 'anthropic-messages';
}

export function getOAuthProviderDefaultBaseUrl(type: string): string | undefined {
  if (!isOAuthProviderType(type)) return undefined;
  if (type === OPENCLAW_PROVIDER_KEY_MINIMAX) return 'https://api.minimax.io/anthropic';
  if (type === 'minimax-portal-cn') return 'https://api.minimaxi.com/anthropic';
  return undefined;
}

export function normalizeOAuthBaseUrl(_type: string, baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  return baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
}

export function usesOAuthAuthHeader(providerKey: string): boolean {
  return providerKey === OPENCLAW_PROVIDER_KEY_MINIMAX;
}

export function getOAuthApiKeyEnv(providerKey: string): string | undefined {
  if (providerKey === OPENCLAW_PROVIDER_KEY_MINIMAX) return 'minimax-oauth';
  return undefined;
}

export function isOpenClawOAuthPluginProviderKey(provider: string): boolean {
  return OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEY_SET.has(provider);
}
