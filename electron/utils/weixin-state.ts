import { chmod, mkdir, readFile, rm, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getOpenClawConfigDir } from './paths';

export const WEIXIN_CHANNEL_ID = 'openclaw-weixin';
export const WEIXIN_DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const WEIXIN_DEFAULT_BOT_TYPE = '3';

const DEFAULT_ACCOUNT_ID = 'default';
const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;
const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export interface WeixinAccountState {
  token?: string;
  savedAt?: string;
  baseUrl?: string;
  userId?: string;
}

function canonicalizeAccountId(value: string): string {
  if (VALID_ID_RE.test(value)) {
    return value.toLowerCase();
  }

  return value
    .toLowerCase()
    .replace(INVALID_CHARS_RE, '-')
    .replace(LEADING_DASH_RE, '')
    .replace(TRAILING_DASH_RE, '')
    .slice(0, 64);
}

export function normalizeWeixinAccountId(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return DEFAULT_ACCOUNT_ID;
  }

  const normalized = canonicalizeAccountId(trimmed);
  if (!normalized || BLOCKED_OBJECT_KEYS.has(normalized)) {
    return DEFAULT_ACCOUNT_ID;
  }

  return normalized;
}

export function getWeixinStateDir(): string {
  return join(getOpenClawConfigDir(), WEIXIN_CHANNEL_ID);
}

export function getWeixinAccountsDir(): string {
  return join(getWeixinStateDir(), 'accounts');
}

export function getWeixinAccountIndexPath(): string {
  return join(getWeixinStateDir(), 'accounts.json');
}

export function getWeixinAccountStatePath(accountId: string): string {
  return join(getWeixinAccountsDir(), `${normalizeWeixinAccountId(accountId)}.json`);
}

async function ensureWeixinStateDir(): Promise<void> {
  await mkdir(getWeixinStateDir(), { recursive: true });
}

async function ensureWeixinAccountsDir(): Promise<void> {
  await mkdir(getWeixinAccountsDir(), { recursive: true });
}

export async function listWeixinAccountIds(): Promise<string[]> {
  const indexPath = getWeixinAccountIndexPath();
  if (!existsSync(indexPath)) {
    return [];
  }

  try {
    const raw = await readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => (typeof entry === 'string' ? normalizeWeixinAccountId(entry) : ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function writeWeixinAccountIds(accountIds: string[]): Promise<void> {
  await ensureWeixinStateDir();
  const normalized = [...new Set(accountIds.map((entry) => normalizeWeixinAccountId(entry)).filter(Boolean))];
  await writeFile(getWeixinAccountIndexPath(), JSON.stringify(normalized, null, 2), 'utf8');
}

export async function registerWeixinAccountId(accountId: string): Promise<void> {
  const normalized = normalizeWeixinAccountId(accountId);
  const existing = await listWeixinAccountIds();
  if (existing.includes(normalized)) {
    return;
  }

  await writeWeixinAccountIds([...existing, normalized]);
}

export async function unregisterWeixinAccountId(accountId: string): Promise<void> {
  const normalized = normalizeWeixinAccountId(accountId);
  const existing = await listWeixinAccountIds();
  const next = existing.filter((entry) => entry !== normalized);
  if (next.length === existing.length) {
    return;
  }

  if (next.length === 0) {
    await removeWeixinAccountIndex();
    return;
  }

  await writeWeixinAccountIds(next);
}

async function removeWeixinAccountIndex(): Promise<void> {
  try {
    await unlink(getWeixinAccountIndexPath());
  } catch {
    // Ignore missing index file.
  }
}

export async function loadWeixinAccountState(accountId: string): Promise<WeixinAccountState | null> {
  const filePath = getWeixinAccountStatePath(accountId);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as WeixinAccountState;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveWeixinAccountState(
  accountId: string,
  update: { token?: string; baseUrl?: string; userId?: string },
): Promise<string> {
  const normalized = normalizeWeixinAccountId(accountId);
  await ensureWeixinAccountsDir();

  const existing = await loadWeixinAccountState(normalized);
  const token = update.token?.trim() || existing?.token?.trim();
  const baseUrl = update.baseUrl?.trim() || existing?.baseUrl?.trim();
  const userId = update.userId !== undefined
    ? update.userId.trim() || undefined
    : existing?.userId?.trim() || undefined;

  const nextState: WeixinAccountState = {
    ...(token ? { token, savedAt: new Date().toISOString() } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(userId ? { userId } : {}),
  };

  const filePath = getWeixinAccountStatePath(normalized);
  await writeFile(filePath, JSON.stringify(nextState, null, 2), 'utf8');
  try {
    await chmod(filePath, 0o600);
  } catch {
    // Best effort.
  }

  await registerWeixinAccountId(normalized);
  return normalized;
}

export async function deleteWeixinAccountState(accountId: string): Promise<void> {
  const normalized = normalizeWeixinAccountId(accountId);
  try {
    await unlink(getWeixinAccountStatePath(normalized));
  } catch {
    // Ignore missing state file.
  }
  await unregisterWeixinAccountId(normalized);
}

export async function clearAllWeixinState(): Promise<void> {
  await rm(getWeixinStateDir(), { recursive: true, force: true });
}

export async function readWeixinRouteTag(accountId?: string): Promise<string | undefined> {
  const configPath = join(getOpenClawConfigDir(), 'openclaw.json');
  if (!existsSync(configPath)) {
    return undefined;
  }

  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      channels?: Record<string, {
        routeTag?: string | number;
        accounts?: Record<string, { routeTag?: string | number }>;
      }>;
    };
    const section = parsed.channels?.[WEIXIN_CHANNEL_ID];
    if (!section) {
      return undefined;
    }

    if (accountId) {
      const normalized = normalizeWeixinAccountId(accountId);
      const accountRouteTag = section.accounts?.[normalized]?.routeTag;
      if (typeof accountRouteTag === 'number') {
        return String(accountRouteTag);
      }
      if (typeof accountRouteTag === 'string' && accountRouteTag.trim()) {
        return accountRouteTag.trim();
      }
    }

    if (typeof section.routeTag === 'number') {
      return String(section.routeTag);
    }
    if (typeof section.routeTag === 'string' && section.routeTag.trim()) {
      return section.routeTag.trim();
    }
  } catch {
    // Ignore malformed config here and proceed without route tag.
  }

  return undefined;
}
