import { readFile } from 'node:fs/promises';
import { app } from 'electron';
import {
  getDefaultProviderModelEntries,
} from '../shared/providers/config-models';
import {
  getProviderBackendConfig,
  getProviderDefinition,
} from '../shared/providers/registry';
import { getGeeClawProviderConfigPath, getGeeClawProviderConfigUrl } from './paths';
import { logger } from './logger';

const GEECLAW_PROVIDER_CONFIG_FETCH_TIMEOUT_MS = 15000;
export const GEECLAW_PROVIDER_CONFIG_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
export const GEECLAW_MODEL_UNAVAILABLE_MESSAGE = '当前模型暂不可用，请切换模型或稍后重试';

export interface GeeClawProviderConfig {
  version: 1;
  upstreamBaseUrl: string;
  autoModels: string[];
  allowedModels: string[];
}

let activeConfig: GeeClawProviderConfig = createDefaultGeeClawProviderConfig();
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function requirePlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[geeclaw-provider-config] Config must be an object');
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`[geeclaw-provider-config] ${field} is required`);
  }
  return value.trim();
}

export function normalizeModelId(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('geeclaw/') ? trimmed.slice('geeclaw/'.length) : trimmed;
}

function normalizeUpstreamBaseUrl(value: unknown): string {
  const raw = requireNonEmptyString(value, 'upstreamBaseUrl').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new Error('[geeclaw-provider-config] upstreamBaseUrl is invalid', { cause: error });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('[geeclaw-provider-config] upstreamBaseUrl must use http or https');
  }
  return raw;
}

function normalizeAllowedModels(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('[geeclaw-provider-config] allowedModels must be a non-empty array');
  }

  const seen = new Set<string>();
  const models: string[] = [];
  for (const entry of value) {
    const model = typeof entry === 'string' ? normalizeModelId(entry) : '';
    if (!model) {
      throw new Error('[geeclaw-provider-config] allowedModels is invalid');
    }
    if (seen.has(model)) {
      continue;
    }
    seen.add(model);
    models.push(model);
  }
  return models;
}

function normalizeAutoModels(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('[geeclaw-provider-config] autoModels must be a non-empty array');
  }

  const seen = new Set<string>();
  const models: string[] = [];
  for (const entry of value) {
    const model = typeof entry === 'string' ? normalizeModelId(entry) : '';
    if (!model) {
      throw new Error('[geeclaw-provider-config] autoModels is invalid');
    }
    if (seen.has(model)) {
      continue;
    }
    seen.add(model);
    models.push(model);
  }
  return models;
}

export function getGeeClawRegisteredModelIds(): string[] {
  return getDefaultProviderModelEntries(getProviderDefinition('geeclaw')).map((model) => model.id);
}

export function isGeeClawRegisteredModelId(modelId: string): boolean {
  const normalized = normalizeModelId(modelId);
  return getGeeClawRegisteredModelIds().includes(normalized);
}

export function createDefaultGeeClawProviderConfig(): GeeClawProviderConfig {
  const registeredModelIds = getGeeClawRegisteredModelIds();
  const allowedModels = registeredModelIds.filter((modelId) => modelId !== 'auto');
  const autoModel = allowedModels[0] ?? 'qwen3.6-plus';
  return {
    version: 1,
    upstreamBaseUrl: getProviderBackendConfig('geeclaw')?.baseUrl ?? 'https://geekai.co/api/v1',
    autoModels: [autoModel],
    allowedModels: allowedModels.length > 0 ? allowedModels : [autoModel],
  };
}

export function parseGeeClawProviderConfig(content: string): GeeClawProviderConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error('[geeclaw-provider-config] Config file is invalid JSON', { cause: error });
  }

  const record = requirePlainObject(parsed);
  if (record.version !== 1) {
    throw new Error('[geeclaw-provider-config] version must be 1');
  }

  const autoModels = normalizeAutoModels(record.autoModels);
  const allowedModels = normalizeAllowedModels(record.allowedModels);

  return {
    version: 1,
    upstreamBaseUrl: normalizeUpstreamBaseUrl(record.upstreamBaseUrl),
    autoModels,
    allowedModels,
  };
}

async function loadGeeClawProviderConfigFromRemote(configUrl: string): Promise<GeeClawProviderConfig> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEECLAW_PROVIDER_CONFIG_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(configUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`[geeclaw-provider-config] Failed to fetch config from ${configUrl}: HTTP ${response.status}`);
    }
    return parseGeeClawProviderConfig(await response.text());
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') {
      throw new Error(
        `[geeclaw-provider-config] Timed out fetching config from ${configUrl} after ${GEECLAW_PROVIDER_CONFIG_FETCH_TIMEOUT_MS}ms`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function resolveGeeClawProviderConfigRemoteUrl(): string | null {
  const overrideUrl = process.env.GEECLAW_PROVIDER_CONFIG_URL?.trim();
  if (overrideUrl) {
    return overrideUrl;
  }
  if (app.isPackaged) {
    return getGeeClawProviderConfigUrl();
  }
  return null;
}

export async function loadGeeClawProviderConfig(configPath?: string): Promise<GeeClawProviderConfig> {
  if (configPath) {
    return parseGeeClawProviderConfig(await readFile(configPath, 'utf8'));
  }

  const remoteUrl = resolveGeeClawProviderConfigRemoteUrl();
  if (remoteUrl) {
    return await loadGeeClawProviderConfigFromRemote(remoteUrl);
  }

  return parseGeeClawProviderConfig(await readFile(getGeeClawProviderConfigPath(), 'utf8'));
}

export function getActiveGeeClawProviderConfig(): GeeClawProviderConfig {
  return activeConfig;
}

export async function refreshGeeClawProviderConfig(): Promise<GeeClawProviderConfig> {
  try {
    activeConfig = await loadGeeClawProviderConfig();
    logger.info(
      `[geeclaw-provider-config] Refreshed config: upstream=${activeConfig.upstreamBaseUrl}, auto=${activeConfig.autoModels.join(',')}`,
    );
  } catch (error) {
    logger.warn('[geeclaw-provider-config] Failed to refresh config; keeping current config:', error);
  }
  return activeConfig;
}

export function startGeeClawProviderConfigRefresh(): void {
  if (refreshTimer) {
    return;
  }

  void refreshGeeClawProviderConfig();
  refreshTimer = setInterval(() => {
    void refreshGeeClawProviderConfig();
  }, GEECLAW_PROVIDER_CONFIG_REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
}

export function stopGeeClawProviderConfigRefresh(): void {
  if (!refreshTimer) {
    return;
  }
  clearInterval(refreshTimer);
  refreshTimer = null;
}
