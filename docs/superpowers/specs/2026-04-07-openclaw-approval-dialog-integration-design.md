# OpenClaw Approval Dialog Integration Spec

> Scope: integrate OpenClaw exec/plugin approval requests into ClawX's existing Gateway notification pipeline so the Electron app can present an approval dialog and send the user's decision back through Gateway RPC.

**Goal:** allow ClawX to receive OpenClaw approval broadcasts, queue and render approval dialogs in the renderer, and submit `allow-once` / `allow-always` / `deny` decisions back to OpenClaw without introducing a second approval transport.

**Primary OpenClaw source paths**
- `/Users/lsave/workspace/AI/openclaw/src/gateway/server-methods/exec-approval.ts`
- `/Users/lsave/workspace/AI/openclaw/src/gateway/server-methods/plugin-approval.ts`
- `/Users/lsave/workspace/AI/openclaw/ui/src/ui/app-gateway.ts`
- `/Users/lsave/workspace/AI/openclaw/ui/src/ui/controllers/exec-approval.ts`
- `/Users/lsave/workspace/AI/openclaw/ui/src/ui/views/exec-approval.ts`

**Primary ClawX source paths**
- `/Users/lsave/workspace/AI/ClawX/electron/gateway/event-dispatch.ts`
- `/Users/lsave/workspace/AI/ClawX/electron/main/index.ts`
- `/Users/lsave/workspace/AI/ClawX/electron/preload/index.ts`
- `/Users/lsave/workspace/AI/ClawX/src/lib/host-events.ts`
- `/Users/lsave/workspace/AI/ClawX/src/stores/gateway.ts`
- `/Users/lsave/workspace/AI/ClawX/src/components/ui/dialog.tsx`
- `/Users/lsave/workspace/AI/ClawX/src/App.tsx`

---

## 1. Current ClawX Integration Surface

ClawX already has the exact transport seam needed for approvals.

### 1.1 Main-process Gateway notifications already reach the renderer

Current flow:

- `GatewayManager` emits `notification` for generic Gateway notifications.
- `electron/main/index.ts` forwards those notifications into `hostEventBus.emit('gateway:notification', notification)`.
- `electron/preload/index.ts` whitelists the IPC channel `gateway:notification`.
- `src/lib/host-events.ts` maps `gateway:notification` to renderer subscribers.
- `src/stores/gateway.ts` already subscribes to `gateway:notification` and routes agent/tool lifecycle events.

This means OpenClaw approval notifications do not require a new WebSocket client, a new host event bus event, or a new preload bridge.

### 1.2 Unknown Gateway notifications are already preserved

`electron/gateway/event-dispatch.ts` forwards unknown protocol events as:

```ts
emitter.emit('notification', { method: event, params: payload });
```

That behavior is exactly what OpenClaw approvals need, because approval notifications arrive as ordinary Gateway events such as:

- `exec.approval.requested`
- `exec.approval.resolved`
- `plugin.approval.requested`
- `plugin.approval.resolved`

No protocol-layer expansion is required as long as `gateway:notification` remains lossless.

### 1.3 Renderer-side Gateway RPC already exists

ClawX already exposes `gateway:rpc` through IPC and the unified API client. That is the correct path for sending approval decisions back to OpenClaw.

The approval integration should use the existing request path instead of adding a specialized IPC method.

---

## 2. What OpenClaw Actually Emits

### 2.1 Exec approval request event

OpenClaw broadcasts `exec.approval.requested` with a payload shaped like:

```ts
type ExecApprovalRequestPayload = {
  command: string;
  cwd?: string | null;
  host?: string | null;
  security?: string | null;
  ask?: string | null;
  agentId?: string | null;
  resolvedPath?: string | null;
  sessionKey?: string | null;
};

type ExecApprovalRequestEvent = {
  id: string;
  request: ExecApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
};
```

The request is valid only while pending. `expiresAtMs` is authoritative.

### 2.2 Plugin approval request event

OpenClaw broadcasts `plugin.approval.requested` with a payload whose meaningful renderer fields live inside `request`:

```ts
type PluginApprovalRequestEvent = {
  id: string;
  request: {
    title: string;
    description?: string | null;
    severity?: string | null;
    pluginId?: string | null;
    agentId?: string | null;
    sessionKey?: string | null;
  };
  createdAtMs: number;
  expiresAtMs: number;
};
```

ClawX should normalize this into the same in-app queue shape as exec approvals, but preserve `kind: 'plugin'`.

### 2.3 Approval resolved events

OpenClaw broadcasts resolution for both exec and plugin approvals:

```ts
type ApprovalResolvedEvent = {
  id: string;
  decision?: 'allow-once' | 'allow-always' | 'deny' | null;
  resolvedBy?: string | null;
  ts?: number | null;
};
```

Renderer use is simple:

- remove the matching queue item
- clear active modal if it matches the resolved id
- do not infer success from local button press alone

### 2.4 Decision submission RPC methods

ClawX must call existing Gateway RPC methods:

- exec: `exec.approval.resolve`
- plugin: `plugin.approval.resolve`

Both accept:

```ts
{
  id: string;
  decision: 'allow-once' | 'allow-always' | 'deny';
}
```

No local persistence should be added in ClawX. OpenClaw owns approval semantics and any `allow-always` persistence.

---

## 3. Product Decision For ClawX

### 3.1 Reuse `gateway:notification`; do not mint approval-specific host events

ClawX should treat OpenClaw approval events as one more category of generic Gateway notification.

Reasons:

- the transport path already exists and is stable
- the preload bridge is already whitelisted for `gateway:notification`
- adding `gateway:approval-requested` and `gateway:approval-resolved` would duplicate data routing for no real gain
- keeping approval parsing in renderer preserves flexibility if OpenClaw adds more approval kinds later

### 3.2 Add a dedicated renderer approval store

Approval requests should not be folded into the existing `useGatewayStore` beyond lightweight detection.

Recommended split:

- `useGatewayStore` remains responsible for runtime connection/lifecycle state
- a new `useApprovalStore` owns:
  - parsed approval queue
  - active dialog state
  - submission busy/error state
  - event subscription and cleanup

This keeps approval UI state decoupled from generic gateway lifecycle state and avoids inflating `useGatewayStore` with modal-specific behavior.

### 3.3 Present one modal for the queue head, but preserve the full queue

ClawX should match OpenClaw's queue semantics:

- keep every pending approval in a queue
- display only the first pending item in a blocking modal
- show queue count when more than one item is pending
- drop expired entries locally using `expiresAtMs`

The queue should be robust to:

- duplicated request events
- out-of-order resolved events
- reconnects that replay still-pending approvals later

### 3.4 Keep the modal renderer-driven, not BrowserWindow-driven

The approval surface should be a React dialog inside the main renderer tree, not a separate BrowserWindow or native OS dialog.

Reasons:

- it matches the rest of ClawX modal architecture
- it naturally shares i18n/theme/dialog primitives
- it avoids focus and single-instance problems on macOS and Windows
- it is easier to keep synchronized with renderer queue state

---

## 4. Target ClawX Architecture

### 4.1 New renderer data model

Create a normalized approval type in renderer code:

```ts
type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

type ApprovalRequest = {
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
};
```

This should be a renderer-only normalization layer, modeled after OpenClaw's control UI parser.

### 4.2 New parser module

Add a small parser module dedicated to OpenClaw approval notifications.

Suggested file:

- `src/lib/openclaw-approval.ts`

Responsibilities:

- parse `gateway:notification` payloads where `method` is one of the four approval methods
- normalize exec and plugin request payloads into `ApprovalRequest`
- parse resolved payloads into `{ id, decision, resolvedBy, ts }`
- provide queue helpers:
  - `addApproval(queue, entry)`
  - `removeApproval(queue, id)`
  - `pruneApprovals(queue)`

This module should be pure and unit-testable.

### 4.3 New approval store

Suggested file:

- `src/stores/approval.ts`

Store responsibilities:

- `queue: ApprovalRequest[]`
- `busy: boolean`
- `error: string | null`
- `isInitialized: boolean`
- `init()` subscribes to `gateway:notification`
- `resolveActive(decision)` submits the active decision via `invokeIpc('gateway:rpc', ...)` or the existing API client helper
- local timeout removal using `expiresAtMs`
- optional `clearError()` / `dismissResolved()` convenience actions

The store should subscribe once globally, similar to `useGatewayStore.init()`.

### 4.4 Global dialog mount point

Suggested files:

- `src/components/approval/ApprovalDialog.tsx`
- `src/App.tsx`

`ApprovalDialog` should mount once near the app root so approvals are visible regardless of the active page.

The dialog should use existing shared dialog primitives from `src/components/ui/dialog.tsx` and follow the modal styling conventions in `AGENTS.md`.

### 4.5 Existing transport remains unchanged

No approval-specific changes are required in these files beyond maybe comments/tests:

- `electron/gateway/ws-client.ts`
- `electron/gateway/client.ts`
- `electron/main/index.ts`
- `electron/preload/index.ts`
- `src/lib/host-events.ts`

The existing `gateway:notification` bridge is already the correct transport.

---

## 5. UI Contract

### 5.1 Dialog content for exec approvals

The dialog should show:

- title: `Exec approval needed`
- command text in monospace block
- metadata rows when available:
  - Host
  - Agent
  - Session
  - CWD
  - Resolved path
  - Security
  - Ask
- expiration text derived from `expiresAtMs`
- pending queue count when `queue.length > 1`

### 5.2 Dialog content for plugin approvals

The dialog should show:

- title from `pluginTitle` with fallback `Plugin approval needed`
- multiline description body when present
- metadata rows when available:
  - Severity
  - Plugin
  - Agent
  - Session
- expiration text and queue count same as exec approvals

### 5.3 Action buttons

Default button set:

- primary: `Allow once`
- secondary: `Always allow`
- destructive: `Deny`

Important nuance:

OpenClaw may disallow `allow-always` under some effective policies. The current OpenClaw control UI does not fully honor `allowedDecisions`, but ClawX should.

Therefore the normalized approval parser should preserve an optional `allowedDecisions` field when present, and the dialog should only render buttons that the request allows.

Safe fallback behavior:

- if `allowedDecisions` is missing, render all three buttons
- if it is present, render only the listed decisions

### 5.4 Submission behavior

When the user clicks a decision:

- disable all action buttons
- keep the dialog open while the RPC is in flight
- on success, wait for the resolved event to clear the queue; do not optimistically hide before local queue removal logic runs
- on RPC failure, show inline error state and re-enable buttons

### 5.5 Reconnect behavior

If the Gateway disconnects while an approval is visible:

- keep the current queue entry visible if it has not expired locally yet
- show RPC errors if the user tries to submit while disconnected
- allow the later `resolved` event to clear stale entries after reconnect

The UI should not silently discard approvals merely because transport state changed.

---

## 6. RPC Contract in ClawX

Decision submission should use existing Gateway RPC transport:

```ts
await invokeIpc('gateway:rpc', method, {
  id: active.id,
  decision,
}, 10_000);
```

Where:

- `method = 'exec.approval.resolve'` for `kind === 'exec'`
- `method = 'plugin.approval.resolve'` for `kind === 'plugin'`

ClawX should not add a host-API wrapper endpoint like `/api/approval/resolve` unless there is a broader strategic move away from `gateway:rpc`. For this feature, extra proxy layers add no value.

---

## 7. File-Level Change Plan

### 7.1 New files

- `src/lib/openclaw-approval.ts`
  - approval payload types
  - notification parsers
  - queue helper functions

- `src/stores/approval.ts`
  - global approval queue store
  - host event subscription
  - decision submission

- `src/components/approval/ApprovalDialog.tsx`
  - queue-head modal
  - metadata rendering
  - action buttons and error state

### 7.2 Existing files to modify

- `src/App.tsx`
  - mount the global approval dialog once
  - ensure store init happens at app boot or via dialog mount

- `src/lib/host-events.ts`
  - likely no logic change
  - optional comment clarifying that approval events ride over `gateway:notification`

- `src/stores/gateway.ts`
  - no approval state ownership
  - optional comment clarifying division of responsibility

- `electron/gateway/event-dispatch.ts`
  - likely no behavior change
  - add/adjust tests to document that unknown notification methods remain forwarded losslessly

### 7.3 Tests to add

- `tests/unit/openclaw-approval.test.ts`
  - parse exec approval requested
  - parse plugin approval requested
  - parse approval resolved
  - queue add/remove/prune behavior
  - `allowedDecisions` rendering input when present

- `tests/unit/approval-store.test.ts`
  - subscribes to `gateway:notification`
  - adds request events to queue
  - removes resolved ids
  - resolves active request via correct RPC method
  - keeps queue stable on malformed notification payloads

- `tests/unit/gateway-event-dispatch.test.ts`
  - explicit regression asserting approval notifications still pass through the generic notification channel unchanged

---

## 8. Non-Goals

This integration should not attempt to:

- reimplement OpenClaw's approval manager in ClawX
- persist `allow-always` rules in ClawX settings
- invent approval-specific HTTP endpoints
- add a second WebSocket connection just for approvals
- support approval issuance from ClawX itself beyond relaying the user's decision

OpenClaw remains the authority for pending approvals, expiration, authorization, and durable trust decisions.

---

## 9. Risks and Guardrails

### 9.1 Risk: duplicate transport paths

If ClawX adds approval-specific host events while also keeping `gateway:notification`, the renderer can process the same approval twice.

Guardrail:

- approvals must enter the renderer through one path only: `gateway:notification`

### 9.2 Risk: optimistic queue clearing

If ClawX removes the queue item immediately on button click and the RPC fails, the user loses the approval request while it is still pending in OpenClaw.

Guardrail:

- only remove on resolved event or on a confirmed local timeout/prune pass

### 9.3 Risk: modal implementation hides allowed-decision constraints

OpenClaw may reject `allow-always` for requests that require approval every time.

Guardrail:

- support optional `allowedDecisions`
- treat missing `allowedDecisions` as backward-compatible fallback, not as a guarantee that every action is valid

### 9.4 Risk: queue starvation by stale entries

If the renderer never prunes expired requests, one stale approval can block newer ones.

Guardrail:

- prune on every queue mutation
- prune on an interval or on dialog render
- remove expired entries using `expiresAtMs`

---

## 10. Recommended Implementation Sequence

1. Add the pure parser/queue module.
2. Add store-level tests and the approval store.
3. Mount a minimal dialog showing queue-head text and actions.
4. Wire decision submission through `gateway:rpc`.
5. Add metadata, allowed-decision filtering, and queue-count polish.
6. Add regression coverage for generic notification passthrough.

---

## 11. Acceptance Criteria

The feature is complete when all of the following are true:

- an incoming `exec.approval.requested` notification produces a visible dialog in ClawX
- an incoming `plugin.approval.requested` notification produces a visible dialog in ClawX
- multiple pending requests are queued and surfaced one at a time
- clicking a decision sends the correct Gateway RPC method with `{ id, decision }`
- a later `*.approval.resolved` notification removes the request from the queue
- malformed or unrelated `gateway:notification` payloads do not break the dialog
- no new approval-specific main-process transport is introduced when `gateway:notification` already carries the data
