import { create } from 'zustand';
import i18n from '@/i18n';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';
import { USER_STATUS_ACTIVE, type UserStatus } from '@shared/auth/user-status';

export type SessionStatus = 'checking' | 'authenticated' | 'unauthenticated';

export interface SessionAccount {
  id: string;
  email?: string;
  displayName?: string;
  userId?: number;
  apiKey?: string;
  openid?: string;
  nickName?: string;
  avatarUrl?: string;
  userStatus?: UserStatus;
  tokenExpiresIn?: number;
}

interface SessionResponse {
  status: 'authenticated' | 'unauthenticated';
  account: SessionAccount | null;
}

type SessionApiFailurePayload = {
  success?: boolean;
  error?: string;
  status?: unknown;
  account?: unknown;
};

interface SessionStoreState {
  status: SessionStatus;
  account: SessionAccount | null;
  isInitialized: boolean;
  init: () => Promise<void>;
  loginWithWechat: () => Promise<void>;
  submitInviteCode: (inviteCode: string) => Promise<void>;
  skipInviteCode: () => Promise<void>;
  logout: () => Promise<void>;
  // Compatibility methods
  loginMock: () => Promise<void>;
  logoutMock: () => Promise<void>;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown session error';
}

function parseSessionResponse(payload: unknown): SessionResponse {
  const maybe = (payload ?? {}) as SessionApiFailurePayload;
  if (maybe.success === false) {
    throw new Error(maybe.error || 'Session API returned success=false');
  }

  if (maybe.status === 'authenticated' || maybe.status === 'unauthenticated') {
    return {
      status: maybe.status,
      account: (maybe.account as SessionAccount | null | undefined) ?? null,
    };
  }

  throw new Error(`Invalid session payload: ${JSON.stringify(payload)}`);
}

function toUserFacingAuthMessage(error: unknown): string {
  const raw = toErrorMessage(error);
  const statusMatch = raw.match(/\((\d{3})\)/);
  const code = statusMatch?.[1] || 'unknown';
  return `登录失败（${code}），请稍后重试`;
}

function toUserFacingInviteCodeMessage(error: unknown): string {
  const raw = toErrorMessage(error);
  const normalized = raw.toLowerCase();
  if (
    normalized.includes('no active session')
    || normalized.includes('invite session expired')
    || normalized.includes('unauthorized')
    || normalized.includes('(401)')
  ) {
    return i18n.t('setup:startup.needsInvite.errors.sessionExpired');
  }
  if (normalized.includes('invite code is required')) {
    return i18n.t('setup:startup.needsInvite.errors.required');
  }
  if (normalized.includes('invalid invite code')) {
    return i18n.t('setup:startup.needsInvite.errors.invalid');
  }
  if (raw.trim() && !normalized.startsWith('invite bind request failed') && raw !== 'Unknown session error') {
    return raw;
  }
  return i18n.t('setup:startup.needsInvite.errors.generic');
}

function isLoginCanceledError(error: unknown): boolean {
  const raw = toErrorMessage(error).toLowerCase();
  return raw.includes('login window was closed before completing wechat authentication');
}

async function showAuthFailureNotice(message: string): Promise<void> {
  toast.error(message);
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  status: 'checking',
  account: null,
  isInitialized: false,

  init: async () => {
    if (get().isInitialized) return;

    set({ status: 'checking' });
    console.info('[SessionStore(Renderer)] init -> requesting /api/session');
    const raw = await hostApiFetch<unknown>('/api/session');
    const session = parseSessionResponse(raw);
    console.info('[SessionStore(Renderer)] init <-', {
      status: session.status,
      accountId: session.account?.id || null,
    });
    set({
      status: session.status,
      account: session.account,
      isInitialized: true,
    });
  },

  loginWithWechat: async () => {
    const previous = get();
    set({ status: 'checking' });
    try {
      console.info('[SessionStore(Renderer)] loginWithWechat -> requesting /api/session/wechat/login');
      const raw = await hostApiFetch<unknown>('/api/session/wechat/login', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      console.info('[SessionStore(Renderer)] loginWithWechat raw <-', raw);
      const session = parseSessionResponse(raw);
      console.info('[SessionStore(Renderer)] loginWithWechat <-', {
        status: session.status,
        accountId: session.account?.id || null,
      });
      set({
        status: session.status,
        account: session.account,
        isInitialized: true,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      console.error('[SessionStore(Renderer)] loginWithWechat failed:', message);
      if (!isLoginCanceledError(error)) {
        await showAuthFailureNotice(toUserFacingAuthMessage(error));
      }
      set({
        status: previous.status === 'authenticated' ? 'authenticated' : 'unauthenticated',
        account: previous.status === 'authenticated' ? previous.account : null,
        isInitialized: true,
      });
      throw error;
    }
  },

  submitInviteCode: async (inviteCode) => {
    const previous = get();
    try {
      console.info('[SessionStore(Renderer)] submitInviteCode -> requesting /api/session/invite-code');
      const raw = await hostApiFetch<unknown>('/api/session/invite-code', {
        method: 'POST',
        body: JSON.stringify({ inviteCode }),
      });
      const session = parseSessionResponse(raw);
      console.info('[SessionStore(Renderer)] submitInviteCode <-', {
        status: session.status,
        accountId: session.account?.id || null,
        userStatus: session.account?.userStatus ?? null,
      });
      set({
        status: session.status,
        account: session.account,
        isInitialized: true,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      console.error('[SessionStore(Renderer)] submitInviteCode failed:', message);
      await showAuthFailureNotice(toUserFacingInviteCodeMessage(error));
      set({
        status: previous.status,
        account: previous.account,
        isInitialized: true,
      });
      throw error;
    }
  },

  skipInviteCode: async () => {
    const current = get();
    if (current.status !== 'authenticated' || !current.account) {
      const error = new Error('No active session');
      await showAuthFailureNotice(toUserFacingInviteCodeMessage(error));
      throw error;
    }

    console.info(`[SessionStore(Renderer)] skipInviteCode -> setting userStatus=${USER_STATUS_ACTIVE} locally`);
    set({
      status: 'authenticated',
      account: {
        ...current.account,
        userStatus: USER_STATUS_ACTIVE,
      },
      isInitialized: true,
    });
  },

  logout: async () => {
    const previous = get();
    set({ status: 'checking' });
    try {
      console.info('[SessionStore(Renderer)] logout -> requesting /api/session/logout');
      const raw = await hostApiFetch<unknown>('/api/session/logout', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      console.info('[SessionStore(Renderer)] logout raw <-', raw);
      const session = parseSessionResponse(raw);
      console.info('[SessionStore(Renderer)] logout <-', {
        status: session.status,
        accountId: session.account?.id || null,
      });
      set({
        status: session.status,
        account: session.account,
        isInitialized: true,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      console.error('[SessionStore(Renderer)] logout failed:', message);
      await showAuthFailureNotice(message);
      set({
        status: previous.status,
        account: previous.account,
        isInitialized: true,
      });
      throw error;
    }
  },

  loginMock: async () => {
    await get().loginWithWechat();
  },

  logoutMock: async () => {
    await get().logout();
  },
}));
