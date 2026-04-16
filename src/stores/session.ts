import { create } from 'zustand';
import { shouldSkipE2ELogin } from '@/lib/e2e';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';
import { USER_STATUS_ACTIVE, type UserStatus } from '../../shared/auth/user-status';

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

function isLoginCanceledError(error: unknown): boolean {
  const raw = toErrorMessage(error).toLowerCase();
  return raw.includes('login window was closed before completing wechat authentication');
}

async function showAuthFailureNotice(message: string): Promise<void> {
  toast.error(message);
}

const E2E_SESSION_ACCOUNT: SessionAccount = {
  id: 'geeclaw-e2e',
  email: 'e2e@geeclaw.local',
  displayName: 'GeeClaw E2E',
  nickName: 'GeeClaw E2E',
  userId: 0,
  userStatus: USER_STATUS_ACTIVE,
};

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  status: 'checking',
  account: null,
  isInitialized: false,

  init: async () => {
    if (get().isInitialized) return;

    set({ status: 'checking' });
    if (shouldSkipE2ELogin()) {
      set({
        status: 'authenticated',
        account: E2E_SESSION_ACCOUNT,
        isInitialized: true,
      });
      return;
    }

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
    if (shouldSkipE2ELogin()) {
      set({
        status: 'authenticated',
        account: E2E_SESSION_ACCOUNT,
        isInitialized: true,
      });
      return;
    }

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
