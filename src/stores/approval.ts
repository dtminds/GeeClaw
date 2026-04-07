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
};

function ensurePruneTimer(): void {
  if (approvalPruneTimer !== null) {
    return;
  }

  approvalPruneTimer = globalThis.setInterval(() => {
    useApprovalStore.setState((state) => ({
      queue: pruneApprovals(state.queue),
    }));
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
        queue: pruneApprovals(state.queue),
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

  pruneExpired: () => set((state) => ({
    queue: pruneApprovals(state.queue),
  })),
}));
