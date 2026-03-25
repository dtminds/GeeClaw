import { create } from 'zustand';
import { buildProviderListItems, fetchProviderSnapshot } from '@/lib/provider-accounts';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { useSessionStore, type SessionAccount } from '@/stores/session';

export type BootstrapPhase =
  | 'idle'
  | 'checking_session'
  | 'needs_login'
  | 'needs_invite_code'
  | 'preparing'
  | 'needs_provider'
  | 'ready'
  | 'error';

interface BootstrapStoreState {
  phase: BootstrapPhase;
  error: string | null;
  init: () => Promise<void>;
  loginAndContinue: () => Promise<void>;
  submitInviteCodeAndContinue: (inviteCode: string) => Promise<void>;
  skipInviteCodeAndContinue: () => Promise<void>;
  logoutToLogin: () => Promise<void>;
  continueAfterProvider: () => Promise<void>;
  retry: () => Promise<void>;
}

let bootstrapInitPromise: Promise<void> | null = null;
const GATEWAY_READY_TIMEOUT_MS = 45000;

function isLoginCanceledError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes('login window was closed before completing wechat authentication');
}

function requiresInviteCode(account: SessionAccount | null | undefined): boolean {
  return account?.userStatus === 0;
}

async function waitForGatewayRunning(timeoutMs = GATEWAY_READY_TIMEOUT_MS): Promise<void> {
  const current = useGatewayStore.getState().status;
  if (current.state === 'running') {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const unsubscribe = useGatewayStore.subscribe((state) => {
      const nextStatus = state.status;
      if (nextStatus.state === 'running') {
        cleanup();
        resolve();
        return;
      }
      if (nextStatus.state === 'error') {
        cleanup();
        reject(new Error(nextStatus.error || 'Gateway failed to start'));
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        cleanup();
        reject(new Error(`Gateway did not become ready within ${timeoutMs}ms (last state: ${nextStatus.state})`));
      }
    });

    const timer = setTimeout(() => {
      cleanup();
      const latest = useGatewayStore.getState().status;
      reject(new Error(`Gateway did not become ready within ${timeoutMs}ms (last state: ${latest.state})`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      unsubscribe();
    };
  });
}

async function hasUsableProvider(): Promise<boolean> {
  const snapshot = await fetchProviderSnapshot();
  const items = buildProviderListItems(
    snapshot.accounts,
    snapshot.statuses,
    snapshot.vendors,
    snapshot.defaultAccountId,
  );

  const isUsable = (item: (typeof items)[number]) => {
    const { account, status } = item;
    if (account.authMode === 'oauth_device' || account.authMode === 'oauth_browser' || account.authMode === 'local') {
      return true;
    }
    return status?.hasKey ?? false;
  };

  const defaultItem = snapshot.defaultAccountId
    ? items.find((item) => item.account.id === snapshot.defaultAccountId)
    : null;

  return (defaultItem ? isUsable(defaultItem) : false) || items.some(isUsable);
}

async function ensureGatewayReady(): Promise<void> {
  await useGatewayStore.getState().init();
  let gateway = useGatewayStore.getState();

  if (gateway.status.state === 'running') {
    return;
  }

  if (gateway.status.state === 'starting' || gateway.status.state === 'reconnecting') {
    await waitForGatewayRunning();
    return;
  }

  await gateway.start();
  gateway = useGatewayStore.getState();
  if (gateway.status.state === 'running') {
    return;
  }
  await waitForGatewayRunning();
}

async function continueBootstrap(set: (patch: Partial<BootstrapStoreState>) => void): Promise<void> {
  set({ phase: 'preparing', error: null });

  if (!(await hasUsableProvider())) {
    set({ phase: 'needs_provider' });
    return;
  }

  await ensureGatewayReady();
  useSettingsStore.getState().markSetupComplete();
  set({ phase: 'ready', error: null });
}

async function continueFromAuthenticatedSession(
  set: (patch: Partial<BootstrapStoreState>) => void,
): Promise<void> {
  const session = useSessionStore.getState();
  if (requiresInviteCode(session.account)) {
    set({ phase: 'needs_invite_code', error: null });
    return;
  }

  await continueBootstrap(set);
}

export const useBootstrapStore = create<BootstrapStoreState>((set) => ({
  phase: 'idle',
  error: null,

  init: async () => {
    if (bootstrapInitPromise) {
      await bootstrapInitPromise;
      return;
    }

    bootstrapInitPromise = (async () => {
      try {
        set({ phase: 'checking_session', error: null });
        await useSessionStore.getState().init();
        const session = useSessionStore.getState();
        if (session.status !== 'authenticated') {
          try {
            await useGatewayStore.getState().stop();
          } catch {
            // ignore gateway stop failures when entering login screen
          }
          set({ phase: 'needs_login', error: null });
          return;
        }
        await continueFromAuthenticatedSession(set);
      } catch (error) {
        set({ phase: 'error', error: String(error) });
      } finally {
        bootstrapInitPromise = null;
      }
    })();

    await bootstrapInitPromise;
  },

  loginAndContinue: async () => {
    try {
      set({ phase: 'checking_session', error: null });
      await useSessionStore.getState().loginWithWechat();
      await continueFromAuthenticatedSession(set);
    } catch (error) {
      const session = useSessionStore.getState();
      if (isLoginCanceledError(error) || session.status !== 'authenticated') {
        set({ phase: 'needs_login', error: null });
        return;
      }
      set({ phase: 'error', error: String(error) });
    }
  },

  submitInviteCodeAndContinue: async (inviteCode) => {
    try {
      await useSessionStore.getState().submitInviteCode(inviteCode);
      await continueFromAuthenticatedSession(set);
    } catch (error) {
      const session = useSessionStore.getState();
      if (session.status !== 'authenticated') {
        set({ phase: 'needs_login', error: null });
        return;
      }
      if (requiresInviteCode(session.account)) {
        set({ phase: 'needs_invite_code', error: null });
        return;
      }
      set({ phase: 'error', error: String(error) });
    }
  },

  skipInviteCodeAndContinue: async () => {
    try {
      await useSessionStore.getState().skipInviteCode();
      await continueFromAuthenticatedSession(set);
    } catch (error) {
      const session = useSessionStore.getState();
      if (session.status !== 'authenticated') {
        set({ phase: 'needs_login', error: null });
        return;
      }
      if (requiresInviteCode(session.account)) {
        set({ phase: 'needs_invite_code', error: null });
        return;
      }
      set({ phase: 'error', error: String(error) });
    }
  },

  logoutToLogin: async () => {
    try {
      await useSessionStore.getState().logout();
    } finally {
      try {
        await useGatewayStore.getState().stop();
      } catch {
        // ignore gateway stop failures on logout
      }
      set({ phase: 'needs_login', error: null });
    }
  },

  continueAfterProvider: async () => {
    try {
      await continueBootstrap(set);
    } catch (error) {
      set({ phase: 'error', error: String(error) });
    }
  },

  retry: async () => {
    set({ phase: 'idle', error: null });
    await useBootstrapStore.getState().init();
  },
}));
