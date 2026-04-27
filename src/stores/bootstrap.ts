import { create } from 'zustand';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { useSessionStore } from '@/stores/session';

export type BootstrapPhase =
  | 'idle'
  | 'checking_session'
  | 'needs_login'
  | 'preparing'
  | 'warming_gateway_services'
  | 'ready'
  | 'error';

interface BootstrapStoreState {
  phase: BootstrapPhase;
  error: string | null;
  serviceWarmupDeadlineAt: number | null;
  init: () => Promise<void>;
  loginAndContinue: () => Promise<void>;
  logoutToLogin: () => Promise<void>;
  retry: () => Promise<void>;
}

let bootstrapInitPromise: Promise<void> | null = null;
const GATEWAY_READY_TIMEOUT_MS = 45000;
const GATEWAY_SERVICE_WARMUP_TIMEOUT_MS = 7000;
const GATEWAY_SERVICE_WARMUP_MIN_VISIBLE_MS = 900;
const GATEWAY_SERVICE_WARMUP_RETRY_INTERVAL_MS = 500;
const MAIN_AGENT_MAIN_SESSION_KEY = 'agent:main:geeclaw_main';

function isLoginCanceledError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes('login window was closed before completing wechat authentication');
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

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGatewayWarmupError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes('unavailable during gateway startup')
    || message.includes('rpc timeout: chat.history');
}

async function warmupGatewayServices(): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < GATEWAY_SERVICE_WARMUP_TIMEOUT_MS) {
    const remainingMs = GATEWAY_SERVICE_WARMUP_TIMEOUT_MS - (Date.now() - startedAt);
    try {
      await useGatewayStore.getState().rpc(
        'chat.history',
        { sessionKey: MAIN_AGENT_MAIN_SESSION_KEY, limit: 1 },
        Math.max(1, Math.min(2000, remainingMs)),
      );
      return;
    } catch (error) {
      if (!isRetryableGatewayWarmupError(error)) {
        return;
      }
      await delay(Math.min(GATEWAY_SERVICE_WARMUP_RETRY_INTERVAL_MS, remainingMs));
    }
  }
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
  set({ phase: 'preparing', error: null, serviceWarmupDeadlineAt: null });
  await ensureGatewayReady();
  set({
    phase: 'warming_gateway_services',
    error: null,
    serviceWarmupDeadlineAt: Date.now() + GATEWAY_SERVICE_WARMUP_TIMEOUT_MS,
  });
  await Promise.all([
    warmupGatewayServices(),
    delay(GATEWAY_SERVICE_WARMUP_MIN_VISIBLE_MS),
  ]);
  useSettingsStore.getState().markSetupComplete();
  set({ phase: 'ready', error: null, serviceWarmupDeadlineAt: null });
}

export const useBootstrapStore = create<BootstrapStoreState>((set) => ({
  phase: 'idle',
  error: null,
  serviceWarmupDeadlineAt: null,

  init: async () => {
    if (bootstrapInitPromise) {
      await bootstrapInitPromise;
      return;
    }

    bootstrapInitPromise = (async () => {
      try {
        set({ phase: 'checking_session', error: null, serviceWarmupDeadlineAt: null });
        await useSessionStore.getState().init();
        const session = useSessionStore.getState();
        if (session.status !== 'authenticated') {
          try {
            await useGatewayStore.getState().stop();
          } catch {
            // ignore gateway stop failures when entering login screen
          }
          set({ phase: 'needs_login', error: null, serviceWarmupDeadlineAt: null });
          return;
        }
        await continueBootstrap(set);
      } catch (error) {
        set({ phase: 'error', error: String(error), serviceWarmupDeadlineAt: null });
      } finally {
        bootstrapInitPromise = null;
      }
    })();

    await bootstrapInitPromise;
  },

  loginAndContinue: async () => {
    try {
      set({ phase: 'checking_session', error: null, serviceWarmupDeadlineAt: null });
      await useSessionStore.getState().loginWithWechat();
      await continueBootstrap(set);
    } catch (error) {
      const session = useSessionStore.getState();
      if (isLoginCanceledError(error) || session.status !== 'authenticated') {
        set({ phase: 'needs_login', error: null, serviceWarmupDeadlineAt: null });
        return;
      }
      set({ phase: 'error', error: String(error), serviceWarmupDeadlineAt: null });
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
      set({ phase: 'needs_login', error: null, serviceWarmupDeadlineAt: null });
    }
  },

  retry: async () => {
    set({ phase: 'idle', error: null, serviceWarmupDeadlineAt: null });
    await useBootstrapStore.getState().init();
  },
}));
