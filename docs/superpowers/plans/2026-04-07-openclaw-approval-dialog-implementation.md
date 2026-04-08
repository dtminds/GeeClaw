# OpenClaw Approval Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the existing `gateway:notification` / `gateway:rpc` transport to show a highest-priority, fully localized OpenClaw approval dialog anywhere in the app and send the user's decision back through Gateway RPC.

**Architecture:** Keep approval transport lossless and renderer-owned: parse generic Gateway notifications in a pure normalization module, manage queue/submission state in a dedicated Zustand store, and mount a single root-level approval overlay in both `App` render branches so startup pages and routed pages are both covered. Extend the shared Radix dialog wrapper just enough to support a z-index above existing modals and to block dismiss-until-resolved behavior without introducing a second modal system.

**Tech Stack:** Electron, React 19, TypeScript, Zustand, react-i18next, Radix Dialog, Vitest, Testing Library

---

## File Map

**Create**
- `src/lib/openclaw-approval.ts`
  Renderer-only approval types, notification parsing, allowed-decision normalization, queue helpers, resolve-method helper.
- `src/stores/approval.ts`
  Global approval queue store, single subscription bootstrap, RPC submission, prune timer, error/busy state.
- `src/components/approval/ApprovalDialog.tsx`
  Highest-priority blocking approval modal for exec/plugin approvals.
- `src/components/approval/ApprovalDialogRoot.tsx`
  Root host that initializes the approval store once and renders the dialog.
- `tests/unit/openclaw-approval.test.ts`
  Parser and queue helper regression coverage.
- `tests/unit/approval-store.test.ts`
  Store initialization, queue mutation, resolve RPC, error handling, prune coverage.
- `tests/unit/approval-dialog.test.tsx`
  Dialog rendering, allowed-decision filtering, busy/error state, button dispatch coverage.
- `tests/unit/approval-dialog-root.test.tsx`
  Root host init-once coverage.

**Modify**
- `src/App.tsx`
  Mount the root approval overlay in both boot branches.
- `src/components/ui/dialog.tsx`
  Add optional overlay/viewport class overrides so approval dialog can sit above all existing overlays.
- `src/i18n/locales/en/common.json`
  Add `approvalDialog.*` strings.
- `src/i18n/locales/zh/common.json`
  Add `approvalDialog.*` strings.
- `tests/unit/gateway-event-dispatch.test.ts`
  Add explicit passthrough regression for approval notifications.
- `README.md`
  Review for approval-dialog behavior changes; update only if user-facing behavior or architecture notes need to be documented.
- `README.zh-CN.md`
  Same review/update rule as English README.

**No expected behavior changes**
- `electron/main/index.ts`
- `electron/preload/index.ts`
- `src/lib/host-events.ts`
- `src/stores/gateway.ts`

The existing transport seam is already correct; add comments only if implementation reveals ambiguity.

## Execution Constraints

- Work on the current workspace branch directly. Do **not** create a git worktree for this feature.
- The branch is already created: `codex/openclaw-approval-dialog-plan`.
- Approval events must enter the renderer through `gateway:notification` only.
- The dialog must render above every existing in-app modal/overlay, including current `Dialog` usages and `Toaster`.
- The dialog must remain visible until a `*.approval.resolved` event removes it or local expiry pruning drops it.
- All user-facing strings must go through i18n; no English fallback literals should be embedded in JSX except defensive test defaults.

## Parallelization Plan

These scopes are independent enough to run in parallel after the interface is fixed:

- Worker 1 ownership:
  `src/lib/openclaw-approval.ts`, `tests/unit/openclaw-approval.test.ts`
- Worker 2 ownership:
  `src/components/ui/dialog.tsx`, `src/components/approval/ApprovalDialog.tsx`, `tests/unit/approval-dialog.test.tsx`
- Main thread ownership:
  `src/stores/approval.ts`, `src/components/approval/ApprovalDialogRoot.tsx`, `src/App.tsx`, i18n files, `tests/unit/approval-store.test.ts`, `tests/unit/approval-dialog-root.test.tsx`, `tests/unit/gateway-event-dispatch.test.ts`, README review

Workers are not alone in the codebase. They must not revert unrelated edits and should adapt to any already-landed changes when integrating.

### Task 1: Build the Pure Approval Parser Layer

**Files:**
- Create: `src/lib/openclaw-approval.ts`
- Test: `tests/unit/openclaw-approval.test.ts`

- [ ] **Step 1: Write the failing parser and queue tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  addApproval,
  parseApprovalNotification,
  pruneApprovals,
  removeApproval,
} from '@/lib/openclaw-approval';

describe('openclaw approval parser', () => {
  it('parses exec approval requests and preserves allowed decisions', () => {
    const notification = {
      method: 'exec.approval.requested',
      params: {
        id: 'exec-1',
        createdAtMs: 1_710_000_000_000,
        expiresAtMs: 1_710_000_060_000,
        request: {
          command: 'mcporter --version',
          cwd: '/tmp/demo',
          host: 'gateway',
          security: 'allowlist',
          ask: 'on-miss',
          agentId: 'main',
          resolvedPath: '/opt/homebrew/bin/mcporter',
          sessionKey: 'agent:main:thread-1',
          allowedDecisions: ['allow-once', 'deny'],
        },
      },
    };

    expect(parseApprovalNotification(notification)).toEqual({
      type: 'requested',
      entry: expect.objectContaining({
        id: 'exec-1',
        kind: 'exec',
        allowedDecisions: ['allow-once', 'deny'],
      }),
    });
  });

  it('normalizes plugin approval requests into the shared queue shape', () => {
    const notification = {
      method: 'plugin.approval.requested',
      params: {
        id: 'plugin:123',
        createdAtMs: 10,
        expiresAtMs: 30,
        request: {
          title: 'Plugin approval needed',
          description: 'Needs install permission',
          severity: 'high',
          pluginId: 'market/foo',
          agentId: 'main',
          sessionKey: 'agent:main:thread-1',
        },
      },
    };

    expect(parseApprovalNotification(notification)).toEqual({
      type: 'requested',
      entry: expect.objectContaining({
        id: 'plugin:123',
        kind: 'plugin',
        pluginTitle: 'Plugin approval needed',
        pluginSeverity: 'high',
        pluginId: 'market/foo',
      }),
    });
  });

  it('deduplicates by id, keeps queue ordered oldest-first, and prunes expired entries', () => {
    const nowMs = 100;
    const queue = addApproval([], {
      id: 'first',
      kind: 'exec',
      createdAtMs: 10,
      expiresAtMs: 200,
      request: { command: 'echo first' },
      allowedDecisions: ['allow-once', 'allow-always', 'deny'],
    });
    const next = addApproval(queue, {
      id: 'second',
      kind: 'exec',
      createdAtMs: 20,
      expiresAtMs: 50,
      request: { command: 'echo second' },
      allowedDecisions: ['allow-once', 'allow-always', 'deny'],
    }, nowMs);

    expect(pruneApprovals(next, nowMs).map((entry) => entry.id)).toEqual(['first']);
    expect(removeApproval(next, 'first', nowMs).map((entry) => entry.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the parser tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/openclaw-approval.test.ts`

Expected: FAIL with `Cannot find module '@/lib/openclaw-approval'` or missing export errors.

- [ ] **Step 3: Implement the normalization module**

```ts
export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

export type ApprovalRequest = {
  id: string;
  kind: 'exec' | 'plugin';
  createdAtMs: number;
  expiresAtMs: number;
  request: {
    command: string;
    cwd?: string | null;
    host?: string | null;
    security?: string | null;
    ask?: string | null;
    agentId?: string | null;
    resolvedPath?: string | null;
    sessionKey?: string | null;
  };
  pluginTitle?: string;
  pluginDescription?: string | null;
  pluginSeverity?: string | null;
  pluginId?: string | null;
  allowedDecisions: ApprovalDecision[];
};

export type ApprovalResolved = {
  id: string;
  decision?: ApprovalDecision | null;
  resolvedBy?: string | null;
  ts?: number | null;
};

export function parseApprovalNotification(
  notification: { method?: string; params?: unknown } | null | undefined,
):
  | { type: 'requested'; entry: ApprovalRequest }
  | { type: 'resolved'; resolved: ApprovalResolved }
  | null {
  switch (notification?.method) {
    case 'exec.approval.requested':
      return parseExecApprovalRequested(notification.params);
    case 'plugin.approval.requested':
      return parsePluginApprovalRequested(notification.params);
    case 'exec.approval.resolved':
    case 'plugin.approval.resolved':
      return parseApprovalResolved(notification.params);
    default:
      return null;
  }
}

export function addApproval(queue: ApprovalRequest[], entry: ApprovalRequest, nowMs = Date.now()): ApprovalRequest[] {
  const next = pruneApprovals(queue, nowMs).filter((item) => item.id !== entry.id);
  next.push(entry);
  next.sort((left, right) => left.createdAtMs - right.createdAtMs);
  return next;
}

export function removeApproval(queue: ApprovalRequest[], id: string, nowMs = Date.now()): ApprovalRequest[] {
  return pruneApprovals(queue, nowMs).filter((entry) => entry.id !== id);
}

export function pruneApprovals(queue: ApprovalRequest[], nowMs = Date.now()): ApprovalRequest[] {
  return queue.filter((entry) => entry.expiresAtMs > nowMs);
}

export function getApprovalResolveMethod(kind: ApprovalRequest['kind']): 'exec.approval.resolve' | 'plugin.approval.resolve' {
  return kind === 'exec' ? 'exec.approval.resolve' : 'plugin.approval.resolve';
}
```

Implementation notes:
- Accept `allowedDecisions` only when it is a non-empty array of recognized decisions; otherwise default to all three decisions.
- Parse plugin request metadata from `payload.request`, not from the top-level payload.
- Keep this module free of React, Zustand, or transport imports.

- [ ] **Step 4: Run the parser tests again**

Run: `pnpm exec vitest run tests/unit/openclaw-approval.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/openclaw-approval.ts tests/unit/openclaw-approval.test.ts
git commit -m "feat: add openclaw approval parser"
```

### Task 2: Add the Global Approval Store

**Files:**
- Create: `src/stores/approval.ts`
- Test: `tests/unit/approval-store.test.ts`

- [ ] **Step 1: Write the failing store tests**

```ts
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApprovalStore } from '@/stores/approval';
import { useGatewayStore } from '@/stores/gateway';

const subscribeHostEventMock = vi.fn();

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (...args: unknown[]) => subscribeHostEventMock(...args),
}));

describe('approval store', () => {
  beforeEach(() => {
    useApprovalStore.setState({
      queue: [],
      busy: false,
      error: null,
      isInitialized: false,
    });
    subscribeHostEventMock.mockReset();
  });

  it('subscribes once and appends requested approvals', async () => {
    let handler: ((payload: unknown) => void) | null = null;
    subscribeHostEventMock.mockImplementation((eventName, nextHandler) => {
      expect(eventName).toBe('gateway:notification');
      handler = nextHandler;
      return () => {};
    });

    await useApprovalStore.getState().init();
    handler?.({
      method: 'exec.approval.requested',
      params: {
        id: 'exec-1',
        createdAtMs: 10,
        expiresAtMs: 1000,
        request: { command: 'echo hello' },
      },
    });

    expect(useApprovalStore.getState().queue.map((entry) => entry.id)).toEqual(['exec-1']);
  });

  it('uses gateway rpc with the correct resolve method and keeps the dialog until resolved', async () => {
    const rpcMock = vi.spyOn(useGatewayStore.getState(), 'rpc').mockResolvedValue(undefined);
    useApprovalStore.setState({
      queue: [{
        id: 'plugin:1',
        kind: 'plugin',
        createdAtMs: 1,
        expiresAtMs: Date.now() + 60_000,
        request: { command: 'Plugin approval needed' },
        pluginTitle: 'Plugin approval needed',
        allowedDecisions: ['allow-once', 'deny'],
      }],
      busy: false,
      error: null,
      isInitialized: true,
    });

    await act(async () => {
      await useApprovalStore.getState().resolveActive('deny');
    });

    expect(rpcMock).toHaveBeenCalledWith('plugin.approval.resolve', {
      id: 'plugin:1',
      decision: 'deny',
    }, 10_000);
    expect(useApprovalStore.getState().queue).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the store tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/approval-store.test.ts`

Expected: FAIL because `useApprovalStore` does not exist.

- [ ] **Step 3: Implement the approval store**

```ts
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

type ApprovalState = {
  queue: ApprovalRequest[];
  busy: boolean;
  error: string | null;
  isInitialized: boolean;
  init: () => Promise<void>;
  resolveActive: (decision: ApprovalDecision) => Promise<void>;
  clearError: () => void;
  pruneExpired: () => void;
};

export const useApprovalStore = create<ApprovalState>((set, get) => ({
  queue: [],
  busy: false,
  error: null,
  isInitialized: false,
  init: async () => {
    if (get().isInitialized) return;
    if (approvalInitPromise) return approvalInitPromise;

    approvalInitPromise = (async () => {
      if (!approvalNotificationUnsubscribe) {
        approvalNotificationUnsubscribe = subscribeHostEvent('gateway:notification', (payload) => {
          const parsed = parseApprovalNotification(payload as { method?: string; params?: unknown });
          if (!parsed) return;
          if (parsed.type === 'requested') {
            set((state) => ({ queue: addApproval(state.queue, parsed.entry), error: null }));
            return;
          }
          set((state) => ({ queue: removeApproval(state.queue, parsed.resolved.id) }));
        });
      }

      if (!approvalPruneTimer) {
        approvalPruneTimer = window.setInterval(() => {
          set((state) => ({ queue: pruneApprovals(state.queue) }));
        }, 1000);
      }

      set({ isInitialized: true });
    })().finally(() => {
      approvalInitPromise = null;
    });

    return approvalInitPromise;
  },
  resolveActive: async (decision) => {
    const active = get().queue[0];
    if (!active) return;
    set({ busy: true, error: null });
    try {
      await useGatewayStore.getState().rpc(
        getApprovalResolveMethod(active.kind),
        { id: active.id, decision },
        10_000,
      );
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ busy: false });
    }
  },
  clearError: () => set({ error: null }),
  pruneExpired: () => set((state) => ({ queue: pruneApprovals(state.queue) })),
}));
```

Implementation notes:
- Keep queue removal strictly event-driven for resolved items; do not optimistically remove after button click.
- Start a 1-second prune timer so expired approvals cannot starve newer queue items.
- Use `useGatewayStore.getState().rpc(...)`, not direct `invokeIpc(...)`, so transport policy remains centralized.

- [ ] **Step 4: Run the store tests again**

Run: `pnpm exec vitest run tests/unit/approval-store.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/approval.ts tests/unit/approval-store.test.ts
git commit -m "feat: add approval state store"
```

### Task 3: Build the Highest-Priority Approval Dialog

**Files:**
- Modify: `src/components/ui/dialog.tsx`
- Create: `src/components/approval/ApprovalDialog.tsx`
- Test: `tests/unit/approval-dialog.test.tsx`

- [ ] **Step 1: Write the failing dialog tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalDialog } from '@/components/approval/ApprovalDialog';
import { useApprovalStore } from '@/stores/approval';

describe('ApprovalDialog', () => {
  beforeEach(() => {
    useApprovalStore.setState({
      queue: [{
        id: 'exec-1',
        kind: 'exec',
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 29 * 60 * 1000,
        request: {
          command: 'mcporter --version',
          host: 'gateway',
          agentId: 'main',
          sessionKey: 'agent:main:thread-1',
          cwd: '/Users/demo/workspace',
          resolvedPath: '/opt/homebrew/bin/mcporter',
          security: 'allowlist',
          ask: 'on-miss',
        },
        allowedDecisions: ['allow-once', 'deny'],
      }],
      busy: false,
      error: null,
      isInitialized: true,
      resolveActive: vi.fn().mockResolvedValue(undefined),
      clearError: vi.fn(),
      init: vi.fn().mockResolvedValue(undefined),
      pruneExpired: vi.fn(),
    });
  });

  it('renders only allowed actions and uses the elevated overlay classes', () => {
    render(<ApprovalDialog />);

    expect(screen.getByRole('dialog', { name: 'Exec approval needed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Always allow' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    expect(document.querySelector('.z-\\[100100\\]')).toBeTruthy();
    expect(document.querySelector('.z-\\[100101\\]')).toBeTruthy();
  });

  it('forwards button clicks to the store', () => {
    const resolveActive = vi.fn().mockResolvedValue(undefined);
    useApprovalStore.setState({ resolveActive });

    render(<ApprovalDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    expect(resolveActive).toHaveBeenCalledWith('deny');
  });
});
```

- [ ] **Step 2: Run the dialog tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/approval-dialog.test.tsx`

Expected: FAIL because `ApprovalDialog` and dialog-layer override props do not exist.

- [ ] **Step 3: Extend the shared dialog wrapper and implement the approval modal**

```tsx
// src/components/ui/dialog.tsx
interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  hideCloseButton?: boolean;
  closeButtonClassName?: string;
  overlayClassName?: string;
  viewportClassName?: string;
}

const DialogContent = React.forwardRef<...>(({ overlayClassName, viewportClassName, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <div className={cn('fixed inset-0 z-[121] flex items-center justify-center p-4 md:p-5', viewportClassName)}>
      <DialogPrimitive.Content ref={ref} ... />
    </div>
  </DialogPortal>
));
```

```tsx
// src/components/approval/ApprovalDialog.tsx
export function ApprovalDialog() {
  const { t, i18n } = useTranslation('common');
  const queue = useApprovalStore((state) => state.queue);
  const busy = useApprovalStore((state) => state.busy);
  const error = useApprovalStore((state) => state.error);
  const resolveActive = useApprovalStore((state) => state.resolveActive);
  const active = queue[0];
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active?.id]);

  if (!active) return null;

  const allowed = active.allowedDecisions;
  const remaining = active.expiresAtMs <= nowMs
    ? t('approvalDialog.expired')
    : t('approvalDialog.expiresIn', {
        time: formatRelativeTime(active.expiresAtMs, {
          now: nowMs,
          locale: i18n.resolvedLanguage,
          style: 'short',
          numeric: 'always',
        }),
      });

  return (
    <Dialog open modal={true}>
      <DialogContent
        hideCloseButton
        overlayClassName="z-[100100] bg-[rgba(9,14,20,0.62)]"
        viewportClassName="z-[100101]"
        className="modal-card-surface w-[min(760px,calc(100vw-2rem))] max-w-[760px] rounded-[28px] border p-0"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {/* header, command/plugin body, metadata rows, inline error, queue count, action buttons */}
      </DialogContent>
    </Dialog>
  );
}
```

Implementation notes:
- Use `common` translations, not inline hard-coded JSX strings.
- Render metadata rows only when values are present.
- For exec approvals, show command in a monospace `modal-field-surface` block.
- For plugin approvals, show `pluginTitle` / `pluginDescription` / `pluginSeverity` instead of exec-specific rows.
- Use `Button` with `modal-primary-button`, `modal-secondary-button`, and a destructive-styled variant for deny if needed.
- The approval dialog must not expose a close button or close on overlay click / escape.

- [ ] **Step 4: Run the dialog tests again**

Run: `pnpm exec vitest run tests/unit/approval-dialog.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/dialog.tsx src/components/approval/ApprovalDialog.tsx tests/unit/approval-dialog.test.tsx
git commit -m "feat: add high priority approval dialog"
```

### Task 4: Mount the Dialog Globally and Localize It

**Files:**
- Create: `src/components/approval/ApprovalDialogRoot.tsx`
- Modify: `src/App.tsx`
- Modify: `src/i18n/locales/en/common.json`
- Modify: `src/i18n/locales/zh/common.json`
- Test: `tests/unit/approval-dialog-root.test.tsx`

- [ ] **Step 1: Write the failing root-host test**

```tsx
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalDialogRoot } from '@/components/approval/ApprovalDialogRoot';
import { useApprovalStore } from '@/stores/approval';

describe('ApprovalDialogRoot', () => {
  beforeEach(() => {
    useApprovalStore.setState({
      queue: [],
      busy: false,
      error: null,
      isInitialized: false,
      init: vi.fn().mockResolvedValue(undefined),
      resolveActive: vi.fn().mockResolvedValue(undefined),
      clearError: vi.fn(),
      pruneExpired: vi.fn(),
    });
  });

  it('initializes the approval store when mounted', () => {
    const init = vi.spyOn(useApprovalStore.getState(), 'init');
    render(<ApprovalDialogRoot />);
    expect(init).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the root-host test to verify it fails**

Run: `pnpm exec vitest run tests/unit/approval-dialog-root.test.tsx`

Expected: FAIL because `ApprovalDialogRoot` does not exist.

- [ ] **Step 3: Implement the root host, mount it in both App branches, and add i18n keys**

```tsx
// src/components/approval/ApprovalDialogRoot.tsx
export function ApprovalDialogRoot() {
  const init = useApprovalStore((state) => state.init);

  useEffect(() => {
    void init();
  }, [init]);

  return <ApprovalDialog />;
}
```

```tsx
// src/App.tsx
if (bootstrapPhase !== 'ready') {
  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <Startup />
        <ApprovalDialogRoot />
        <Toaster position="bottom-right" richColors closeButton style={{ zIndex: 99999 }} />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

return (
  <ErrorBoundary>
    <TooltipProvider delayDuration={300}>
      <Routes ... />
      {showSettingsOverlay && <Settings />}
      <GatewayRecoveryOverlay />
      <ApprovalDialogRoot />
      <Toaster position="bottom-right" richColors closeButton style={{ zIndex: 99999 }} />
      <UpdateAnnouncementDialog />
    </TooltipProvider>
  </ErrorBoundary>
);
```

```json
// src/i18n/locales/en/common.json
"approvalDialog": {
  "execTitle": "Exec approval needed",
  "pluginFallbackTitle": "Plugin approval needed",
  "expiresIn": "expires in {{time}}",
  "expired": "expired",
  "queueCount": "{{count}} pending",
  "labels": {
    "host": "Host",
    "agent": "Agent",
    "session": "Session",
    "cwd": "CWD",
    "resolved": "Resolved",
    "security": "Security",
    "ask": "Ask",
    "severity": "Severity",
    "plugin": "Plugin"
  },
  "actions": {
    "allowOnce": "Allow once",
    "allowAlways": "Always allow",
    "deny": "Deny"
  },
  "resolveFailed": "Failed to submit approval: {{error}}"
}
```

```json
// src/i18n/locales/zh/common.json
"approvalDialog": {
  "execTitle": "需要审批当前指令",
  "pluginFallbackTitle": "需要插件审批",
  "expiresIn": "{{time}}后过期",
  "expired": "已过期",
  "queueCount": "还有 {{count}} 个待处理",
  "labels": {
    "host": "主机",
    "agent": "智能体",
    "session": "会话",
    "cwd": "工作目录",
    "resolved": "解析路径",
    "security": "安全策略",
    "ask": "询问策略",
    "severity": "风险等级",
    "plugin": "插件"
  },
  "actions": {
    "allowOnce": "本次允许",
    "allowAlways": "始终允许",
    "deny": "拒绝"
  },
  "resolveFailed": "提交审批失败：{{error}}"
}
```

Implementation notes:
- `ApprovalDialogRoot` must be rendered in both the startup branch and the ready branch.
- Keep the dialog mounted at the `App` root, outside routed page trees and outside `MainLayout`.
- Use `common.approvalDialog.*` so this feature remains app-global instead of chat-specific.

- [ ] **Step 4: Run the root-host test again**

Run: `pnpm exec vitest run tests/unit/approval-dialog-root.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/approval/ApprovalDialogRoot.tsx src/App.tsx src/i18n/locales/en/common.json src/i18n/locales/zh/common.json tests/unit/approval-dialog-root.test.tsx
git commit -m "feat: mount approval dialog globally"
```

### Task 5: Lock Transport Regressions and Final Verification

**Files:**
- Modify: `tests/unit/gateway-event-dispatch.test.ts`
- Modify if needed after review: `README.md`
- Modify if needed after review: `README.zh-CN.md`

- [ ] **Step 1: Add the notification passthrough regression test**

```ts
it('forwards approval notifications through the generic notification channel unchanged', () => {
  const emit = vi.fn();

  dispatchProtocolEvent({ emit }, 'exec.approval.requested', {
    id: 'exec-1',
    createdAtMs: 10,
    expiresAtMs: 1000,
    request: { command: 'mcporter --version' },
  });

  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith('notification', {
    method: 'exec.approval.requested',
    params: {
      id: 'exec-1',
      createdAtMs: 10,
      expiresAtMs: 1000,
      request: { command: 'mcporter --version' },
    },
  });
});
```

- [ ] **Step 2: Run the focused regression suite**

Run:

```bash
pnpm exec vitest run \
  tests/unit/openclaw-approval.test.ts \
  tests/unit/approval-store.test.ts \
  tests/unit/approval-dialog.test.tsx \
  tests/unit/approval-dialog-root.test.tsx \
  tests/unit/gateway-event-dispatch.test.ts
```

Expected: PASS

- [ ] **Step 3: Run typecheck and the full unit suite**

Run:

```bash
pnpm run typecheck
pnpm test
```

Expected:
- `pnpm run typecheck`: PASS
- `pnpm test`: PASS

- [ ] **Step 4: Review documentation changes required by AGENTS.md**

Review:
- `README.md`
- `README.zh-CN.md`

Update only if one of these becomes true after implementation:
- approval dialogs are now a documented part of runtime behavior
- there is a new architecture note worth preserving about reusing `gateway:notification` / `gateway:rpc`
- there is a user-facing limitation or operator workflow that changed

- [ ] **Step 5: Commit**

```bash
git add tests/unit/gateway-event-dispatch.test.ts README.md README.zh-CN.md
git commit -m "test: cover approval notification passthrough"
```

## Spec Coverage Check

- Global highest-priority modal:
  Covered by Tasks 3 and 4 through dialog z-index override, non-dismissible modal behavior, and root mounting in both `App` branches.
- Full queue semantics:
  Covered by Tasks 1 and 2 through sorted queue helpers, resolved-event removal, and interval pruning.
- Existing transport reuse:
  Covered by Tasks 2 and 5 via `gateway:notification` parsing and `gateway:rpc` submission without new IPC or HTTP layers.
- Exec and plugin approval normalization:
  Covered by Task 1 parser tests and shared renderer type shape.
- Internationalization:
  Covered by Task 4 via `common.approvalDialog.*` resources and localized relative-expiry rendering.
- Allowed-decision filtering:
  Covered by Tasks 1 and 3 via normalized `allowedDecisions` and conditional button rendering.
- Reconnect / unresolved behavior:
  Covered by Task 2 because queue removal remains event-driven and approvals are only pruned on expiry.

## Placeholder Scan

- No `TODO` / `TBD` placeholders remain.
- All new files and modified files are named explicitly.
- Every test/run step includes an exact command.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-07-openclaw-approval-dialog-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, and keep ownership boundaries aligned with the parallelization plan above.

**2. Inline Execution** - execute the tasks in this session in order, batching verification at the task boundaries.
