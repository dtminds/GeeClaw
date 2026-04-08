import { create } from 'zustand';
import { subscribeHostEvent } from '@/lib/host-events';
import {
  addApproval,
  getApprovalResolveMethod,
  parseApprovalNotification,
  pruneApprovals,
  removeApproval,
  type ApprovalDecision,
  type ApprovalRequest,
} from '@/lib/openclaw-approval';
import { useGatewayStore } from '@/stores/gateway';

let approvalInitPromise: Promise<void> | null = null;
let approvalNotificationUnsubscribe: (() => void) | null = null;
let approvalPruneTimer: ReturnType<typeof setInterval> | null = null;
const DEBUG_APPROVAL_ID_PREFIX = 'debug-approval:';

type ApprovalStoreState = {
  queue: ApprovalRequest[];
  busy: boolean;
  error: string | null;
  pendingDecisionId: string | null;
  isInitialized: boolean;
  init: () => Promise<void>;
  resolveActive: (decision: ApprovalDecision) => Promise<void>;
  clearError: () => void;
  pruneExpired: () => void;
  showDebugApproval: (kind?: ApprovalRequest['kind']) => void;
  clearDebugApprovals: () => void;
};

function isDebugApproval(id: string): boolean {
  return id.startsWith(DEBUG_APPROVAL_ID_PREFIX);
}

function buildDebugApproval(kind: ApprovalRequest['kind']): ApprovalRequest {
  const nowMs = Date.now();
  if (kind === 'plugin') {
    return {
      id: `${DEBUG_APPROVAL_ID_PREFIX}plugin`,
      kind: 'plugin',
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 24 * 60 * 60 * 1000,
      request: {
        command: 'Install demo plugin capability',
        agentId: 'debug-agent',
        sessionKey: 'agent:debug:main',
      },
      pluginTitle: 'Plugin approval needed',
      pluginDescription: 'This plugin wants permission to install and run inside GeeClaw.',
      pluginSeverity: 'medium',
      pluginId: 'debug/demo-plugin',
      allowedDecisions: ['allow-once', 'allow-always', 'deny'],
    };
  }

  return {
    id: `${DEBUG_APPROVAL_ID_PREFIX}exec`,
    kind: 'exec',
    createdAtMs: nowMs,
    expiresAtMs: nowMs + 24 * 60 * 60 * 1000,
    request: {
      command: 'npm run build',
      cwd: '/Users/demo/workspace/project',
      agentId: 'debug-agent',
      sessionKey: 'agent:debug:main',
      security: 'workspace-write',
      resolvedPath: '/opt/homebrew/bin/npm',
    },
    allowedDecisions: ['allow-once', 'allow-always', 'deny'],
  };
}

function pruneApprovalState(state: Pick<ApprovalStoreState, 'queue' | 'busy' | 'pendingDecisionId'>) {
  const nextQueue = pruneApprovals(state.queue);
  const pendingStillExists = state.pendingDecisionId
    ? nextQueue.some((entry) => entry.id === state.pendingDecisionId)
    : false;

  return {
    queue: nextQueue,
    busy: pendingStillExists ? state.busy : false,
    pendingDecisionId: pendingStillExists ? state.pendingDecisionId : null,
  };
}

function ensurePruneTimer(): void {
  if (approvalPruneTimer !== null) {
    return;
  }

  approvalPruneTimer = globalThis.setInterval(() => {
    useApprovalStore.setState((state) => pruneApprovalState(state));
  }, 1000);
}

export const useApprovalStore = create<ApprovalStoreState>((set, get) => ({
  queue: [],
  busy: false,
  error: null,
  pendingDecisionId: null,
  isInitialized: false,

  init: async () => {
    if (get().isInitialized) {
      return;
    }

    if (approvalInitPromise) {
      await approvalInitPromise;
      return;
    }

    approvalInitPromise = (async () => {
      if (!approvalNotificationUnsubscribe) {
        approvalNotificationUnsubscribe = subscribeHostEvent('gateway:notification', (payload) => {
          const parsed = parseApprovalNotification(payload as { method?: string; params?: unknown } | null | undefined);
          if (!parsed) {
            return;
          }

          if (parsed.type === 'requested') {
            set((state) => ({
              queue: addApproval(state.queue, parsed.entry),
              error: null,
            }));
            return;
          }

          set((state) => ({
            queue: removeApproval(state.queue, parsed.resolved.id),
            busy: state.pendingDecisionId === parsed.resolved.id ? false : state.busy,
            pendingDecisionId: state.pendingDecisionId === parsed.resolved.id ? null : state.pendingDecisionId,
          }));
        });
      }

      ensurePruneTimer();
      set((state) => ({
        isInitialized: true,
        ...pruneApprovalState(state),
      }));
    })().finally(() => {
      approvalInitPromise = null;
    });

    await approvalInitPromise;
  },

  resolveActive: async (decision) => {
    const active = get().queue[0];
    if (!active) {
      return;
    }

    if (isDebugApproval(active.id)) {
      set((state) => ({
        queue: state.queue.filter((entry) => !isDebugApproval(entry.id) || entry.id !== active.id),
        busy: false,
        error: null,
        pendingDecisionId: null,
      }));
      return;
    }

    if (get().busy || get().pendingDecisionId === active.id) {
      return;
    }

    if (active.expiresAtMs <= Date.now()) {
      set((state) => ({
        queue: pruneApprovals(state.queue),
        busy: false,
        pendingDecisionId: null,
      }));
      return;
    }

    set({ busy: true, error: null });

    try {
      await useGatewayStore.getState().rpc(
        getApprovalResolveMethod(active.kind),
        {
          id: active.id,
          decision,
        },
        10_000,
      );
      set({
        busy: true,
        pendingDecisionId: active.id,
      });
    } catch (error) {
      set({
        busy: false,
        pendingDecisionId: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  clearError: () => set({ error: null }),

  pruneExpired: () => set((state) => pruneApprovalState(state)),

  showDebugApproval: (kind = 'exec') => set((state) => ({
    queue: addApproval(state.queue, buildDebugApproval(kind)),
    busy: false,
    error: null,
    pendingDecisionId: null,
  })),

  clearDebugApprovals: () => set((state) => ({
    queue: state.queue.filter((entry) => !isDebugApproval(entry.id)),
    busy: state.pendingDecisionId && isDebugApproval(state.pendingDecisionId) ? false : state.busy,
    error: null,
    pendingDecisionId: state.pendingDecisionId && isDebugApproval(state.pendingDecisionId) ? null : state.pendingDecisionId,
  })),
}));
