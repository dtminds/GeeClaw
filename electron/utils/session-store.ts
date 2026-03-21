import { randomUUID } from 'node:crypto';
import { safeStorage } from 'electron';
import type { BrowserWindow } from 'electron';
import { runWechatLoginFlow } from '../services/auth/wechat-auth';
import { logger } from './logger';

// Lazy-load electron-store (ESM module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sessionStoreInstance: any = null;

export interface SessionAccount {
  id: string;
  email?: string;
  displayName?: string;
  userId?: number;
  openid?: string;
  nickName?: string;
  avatarUrl?: string;
  userStatus?: number;
  tokenExpiresIn?: number;
}

interface SessionStoreShape {
  account: SessionAccount | null;
  deviceId: string;
  tokenEncrypted: string | null;
  tokenPlain: string | null;
}

export interface SessionState {
  status: 'authenticated' | 'unauthenticated';
  account: SessionAccount | null;
}

function maskValue(value: string | null | undefined, keepHead = 4, keepTail = 4): string {
  if (!value) return '(empty)';
  if (value.length <= keepHead + keepTail) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, keepHead)}***${value.slice(-keepTail)}`;
}

function encodeToken(token: string): { encrypted: string | null; plain: string | null } {
  if (safeStorage.isEncryptionAvailable()) {
    logger.info('[SessionStore] safeStorage encryption is available; storing encrypted token');
    return {
      encrypted: safeStorage.encryptString(token).toString('base64'),
      plain: null,
    };
  }
  logger.warn('[SessionStore] safeStorage encryption is NOT available; storing plain token in session store');
  return {
    encrypted: null,
    plain: token,
  };
}

function decodeToken(shape: SessionStoreShape): string | null {
  if (shape.tokenEncrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(shape.tokenEncrypted, 'base64'));
    } catch {
      logger.error('[SessionStore] Failed to decrypt tokenEncrypted from store');
      return null;
    }
  }
  if (shape.tokenEncrypted && !safeStorage.isEncryptionAvailable()) {
    logger.warn('[SessionStore] tokenEncrypted exists but safeStorage is unavailable during read');
  }
  return shape.tokenPlain || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function readFirstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readFirstNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function buildAccountFromUserInfo(userInfo: Record<string, unknown>): SessionAccount {
  const id = readFirstString(userInfo, ['id', 'userId', 'uid', 'openid', 'unionid']) || `wechat-${randomUUID()}`;
  const nickName = readFirstString(userInfo, ['nickName', 'nickname', 'displayName', 'name']);
  const displayName = nickName;
  const email = readFirstString(userInfo, ['email']);
  const openid = readFirstString(userInfo, ['openid']);
  const avatarUrl = readFirstString(userInfo, ['avatarUrl', 'avatar', 'headImgUrl']);
  const userId = readFirstNumber(userInfo, ['userId', 'uid', 'id']);
  const userStatus = readFirstNumber(userInfo, ['status']);
  const tokenExpiresIn = readFirstNumber(userInfo, ['expiresIn']);
  return {
    id,
    displayName,
    email,
    userId,
    openid,
    nickName,
    avatarUrl,
    userStatus,
    tokenExpiresIn,
  };
}

async function getSessionStore() {
  if (!sessionStoreInstance) {
    const Store = (await import('electron-store')).default;
    sessionStoreInstance = new Store<SessionStoreShape>({
      name: 'session',
      defaults: {
        account: null,
        deviceId: `geeclaw-${randomUUID()}`,
        tokenEncrypted: null,
        tokenPlain: null,
      },
    });
  }
  return sessionStoreInstance;
}

export async function getSessionState(): Promise<SessionState> {
  const store = await getSessionStore();
  const account = store.get('account') as SessionAccount | null;
  const tokenEncrypted = (store.get('tokenEncrypted') as string | null) || null;
  const tokenPlain = (store.get('tokenPlain') as string | null) || null;
  const token = decodeToken({ account, deviceId: '', tokenEncrypted, tokenPlain });
  const status = account && token ? 'authenticated' : 'unauthenticated';
  logger.info(
    `[SessionStore] getSessionState resolved status=${status}, hasAccount=${Boolean(account)}, hasToken=${Boolean(token)}, accountId=${account?.id || '(none)'}`,
  );
  return {
    status,
    account,
  };
}

export async function getSessionAccessToken(): Promise<string | null> {
  const store = await getSessionStore();
  const account = store.get('account') as SessionAccount | null;
  const tokenEncrypted = (store.get('tokenEncrypted') as string | null) || null;
  const tokenPlain = (store.get('tokenPlain') as string | null) || null;
  return decodeToken({ account, deviceId: '', tokenEncrypted, tokenPlain });
}

export async function loginWithWechat(mainWindow: BrowserWindow | null): Promise<SessionState> {
  logger.info('[SessionStore] loginWithWechat called');
  const store = await getSessionStore();
  const deviceId = (store.get('deviceId') as string | undefined)?.trim() || `geeclaw-${randomUUID()}`;
  if (store.get('deviceId') !== deviceId) {
    store.set('deviceId', deviceId);
  }
  logger.info(`[SessionStore] Using deviceId=${maskValue(deviceId, 8, 4)}`);

  const result = await runWechatLoginFlow(mainWindow, deviceId);
  logger.info(
    `[SessionStore] WeChat flow succeeded. token=${maskValue(result.token)}, rawResponseType=${typeof result.rawResponse}`,
  );
  const userInfoRecord = asRecord(result.userInfo) ?? {};
  const account = buildAccountFromUserInfo(userInfoRecord);
  const tokenStorage = encodeToken(result.token);

  store.set('account', account);
  store.set('tokenEncrypted', tokenStorage.encrypted);
  store.set('tokenPlain', tokenStorage.plain);
  logger.info(
    `[SessionStore] Session persisted. accountId=${account.id}, displayName=${account.displayName || '(none)'}, tokenEncrypted=${Boolean(tokenStorage.encrypted)}, tokenPlain=${Boolean(tokenStorage.plain)}`,
  );
  return {
    status: 'authenticated',
    account,
  };
}

export async function logoutSession(): Promise<SessionState> {
  logger.info('[SessionStore] logoutSession called; clearing account and tokens');
  const store = await getSessionStore();
  store.set('account', null);
  store.set('tokenEncrypted', null);
  store.set('tokenPlain', null);
  return {
    status: 'unauthenticated',
    account: null,
  };
}

export async function mockLogin(): Promise<SessionState> {
  logger.info('[SessionStore] mockLogin called');
  const store = await getSessionStore();
  const account: SessionAccount = {
    id: `mock-user-${randomUUID()}`,
    email: 'demo@geeclaw.local',
    displayName: 'Demo User',
  };
  const tokenStorage = encodeToken(`mock-token-${randomUUID()}`);
  store.set('account', account);
  store.set('tokenEncrypted', tokenStorage.encrypted);
  store.set('tokenPlain', tokenStorage.plain);
  return {
    status: 'authenticated',
    account,
  };
}

export async function mockLogout(): Promise<SessionState> {
  logger.info('[SessionStore] mockLogout called');
  return logoutSession();
}
