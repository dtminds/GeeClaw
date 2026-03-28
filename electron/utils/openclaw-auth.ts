/**
 * OpenClaw Auth Profiles Utility
 * Writes API keys to ~/.openclaw-geeclaw/agents/main/agent/auth-profiles.json
 * so the OpenClaw Gateway can load them for AI provider calls.
 *
 * Provider/runtime config patching lives in dedicated modules:
 * - openclaw-provider-config.ts
 * - openclaw-gateway-config.ts
 * - openclaw-config-sanitize.ts
 */
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { getOpenClawConfigDir } from './paths';
import { listConfiguredAgentIds } from './agent-config';
import { isOAuthProviderType } from './provider-keys';

const AUTH_STORE_VERSION = 1;
const AUTH_PROFILE_FILENAME = 'auth-profiles.json';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir: string): Promise<void> {
  if (!(await fileExists(dir))) {
    await mkdir(dir, { recursive: true });
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    if (!(await fileExists(filePath))) return null;
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureDir(join(filePath, '..'));
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

interface AuthProfileEntry {
  type: 'api_key';
  provider: string;
  key: string;
}

interface OAuthProfileEntry {
  type: 'oauth';
  provider: string;
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  projectId?: string;
}

export interface AuthProfilesStore {
  version: number;
  profiles: Record<string, AuthProfileEntry | OAuthProfileEntry>;
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
}

function removeProfilesForProvider(store: AuthProfilesStore, provider: string): boolean {
  const removedProfileIds = new Set<string>();

  for (const [profileId, profile] of Object.entries(store.profiles)) {
    if (profile?.provider !== provider) {
      continue;
    }

    delete store.profiles[profileId];
    removedProfileIds.add(profileId);
  }

  if (removedProfileIds.size === 0) {
    return false;
  }

  if (store.order) {
    for (const [orderProvider, profileIds] of Object.entries(store.order)) {
      const nextProfileIds = profileIds.filter((profileId) => !removedProfileIds.has(profileId));
      if (nextProfileIds.length > 0) {
        store.order[orderProvider] = nextProfileIds;
      } else {
        delete store.order[orderProvider];
      }
    }
  }

  if (store.lastGood) {
    for (const [lastGoodProvider, profileId] of Object.entries(store.lastGood)) {
      if (removedProfileIds.has(profileId)) {
        delete store.lastGood[lastGoodProvider];
      }
    }
  }

  return true;
}

function removeProfileFromStore(
  store: AuthProfilesStore,
  profileId: string,
  expectedType?: AuthProfileEntry['type'] | OAuthProfileEntry['type'],
): boolean {
  const profile = store.profiles[profileId];
  let changed = false;
  const shouldCleanReferences = !profile || !expectedType || profile.type === expectedType;

  if (profile && (!expectedType || profile.type === expectedType)) {
    delete store.profiles[profileId];
    changed = true;
  }

  if (shouldCleanReferences && store.order) {
    for (const [orderProvider, profileIds] of Object.entries(store.order)) {
      const nextProfileIds = profileIds.filter((id) => id !== profileId);
      if (nextProfileIds.length !== profileIds.length) {
        changed = true;
      }
      if (nextProfileIds.length > 0) {
        store.order[orderProvider] = nextProfileIds;
      } else {
        delete store.order[orderProvider];
      }
    }
  }

  if (shouldCleanReferences && store.lastGood) {
    for (const [lastGoodProvider, lastGoodProfileId] of Object.entries(store.lastGood)) {
      if (lastGoodProfileId === profileId) {
        delete store.lastGood[lastGoodProvider];
        changed = true;
      }
    }
  }

  return changed;
}

function getAuthProfilesPath(agentId = 'main'): string {
  return join(getOpenClawConfigDir(), 'agents', agentId, 'agent', AUTH_PROFILE_FILENAME);
}

export async function readOpenClawAuthProfiles(agentId = 'main'): Promise<AuthProfilesStore> {
  const filePath = getAuthProfilesPath(agentId);
  try {
    const data = await readJsonFile<AuthProfilesStore>(filePath);
    if (data?.version && data.profiles && typeof data.profiles === 'object') {
      return data;
    }
  } catch (error) {
    console.warn('Failed to read auth-profiles.json, creating fresh store:', error);
  }
  return { version: AUTH_STORE_VERSION, profiles: {} };
}

export async function writeOpenClawAuthProfiles(store: AuthProfilesStore, agentId = 'main'): Promise<void> {
  await writeJsonFile(getAuthProfilesPath(agentId), store);
}

export async function discoverOpenClawAgentIds(): Promise<string[]> {
  try {
    return await listConfiguredAgentIds();
  } catch {
    return ['main'];
  }
}

export async function saveOAuthTokenToOpenClaw(
  provider: string,
  token: { access: string; refresh: string; expires: number; email?: string; projectId?: string },
  agentId?: string
): Promise<void> {
  const agentIds = agentId ? [agentId] : await discoverOpenClawAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  for (const id of agentIds) {
    const store = await readOpenClawAuthProfiles(id);
    const profileId = `${provider}:default`;

    store.profiles[profileId] = {
      type: 'oauth',
      provider,
      access: token.access,
      refresh: token.refresh,
      expires: token.expires,
      email: token.email,
      projectId: token.projectId,
    };

    if (!store.order) store.order = {};
    if (!store.order[provider]) store.order[provider] = [];
    if (!store.order[provider].includes(profileId)) {
      store.order[provider].push(profileId);
    }

    if (!store.lastGood) store.lastGood = {};
    store.lastGood[provider] = profileId;

    await writeOpenClawAuthProfiles(store, id);
  }
  console.log(`Saved OAuth token for provider "${provider}" to OpenClaw auth-profiles (agents: ${agentIds.join(', ')})`);
}

export async function getOAuthTokenFromOpenClaw(
  provider: string,
  agentId = 'main'
): Promise<string | null> {
  try {
    const store = await readOpenClawAuthProfiles(agentId);
    const profileId = `${provider}:default`;
    const profile = store.profiles[profileId];

    if (profile && profile.type === 'oauth' && 'access' in profile) {
      return (profile as OAuthProfileEntry).access;
    }
  } catch (err) {
    console.warn(`[getOAuthToken] Failed to read token for ${provider}:`, err);
  }
  return null;
}

export async function saveProviderKeyToOpenClaw(
  provider: string,
  apiKey: string,
  agentId?: string
): Promise<void> {
  if (isOAuthProviderType(provider) && !apiKey) {
    console.log(`Skipping auth-profiles write for OAuth provider "${provider}" (no API key provided, using OAuth)`);
    return;
  }
  const agentIds = agentId ? [agentId] : await discoverOpenClawAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  for (const id of agentIds) {
    const store = await readOpenClawAuthProfiles(id);
    const profileId = `${provider}:default`;

    store.profiles[profileId] = { type: 'api_key', provider, key: apiKey };

    if (!store.order) store.order = {};
    if (!store.order[provider]) store.order[provider] = [];
    if (!store.order[provider].includes(profileId)) {
      store.order[provider].push(profileId);
    }

    if (!store.lastGood) store.lastGood = {};
    store.lastGood[provider] = profileId;

    await writeOpenClawAuthProfiles(store, id);
  }
  console.log(`Saved API key for provider "${provider}" to OpenClaw auth-profiles (agents: ${agentIds.join(', ')})`);
}

export async function removeProviderProfilesFromOpenClaw(
  provider: string,
  agentId?: string
): Promise<void> {
  const agentIds = agentId ? [agentId] : await discoverOpenClawAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  for (const id of agentIds) {
    const store = await readOpenClawAuthProfiles(id);
    if (removeProfilesForProvider(store, provider)) {
      await writeOpenClawAuthProfiles(store, id);
    }
  }

  console.log(`Removed auth profiles for provider "${provider}" from OpenClaw auth-profiles (agents: ${agentIds.join(', ')})`);
}

export async function removeProviderKeyFromOpenClaw(
  provider: string,
  agentId?: string
): Promise<void> {
  const agentIds = agentId ? [agentId] : await discoverOpenClawAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  for (const id of agentIds) {
    const store = await readOpenClawAuthProfiles(id);
    if (removeProfileFromStore(store, `${provider}:default`, 'api_key')) {
      await writeOpenClawAuthProfiles(store, id);
    }
  }
  console.log(`Removed API key for provider "${provider}" from OpenClaw auth-profiles (agents: ${agentIds.join(', ')})`);
}
