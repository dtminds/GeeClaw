# Gateway Embedded Reconcile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure GeeClaw always reconciles OpenClaw back to embedded ownership after startup auto-repair, app quit, and any service side effects introduced by `openclaw doctor --fix`.

**Architecture:** Keep the current default mode as embedded and add a focused reconciliation layer in the gateway supervisor/manager flow. Reconciliation treats doctor-installed service listeners as managed residue: disable respawn, clear the listener, wait for the port to free, then let GeeClaw own the next launch.

**Tech Stack:** Electron main process, TypeScript, Vitest

---

### Task 1: Define embedded-mode reconciliation behavior

**Files:**
- Modify: `electron/gateway/supervisor.ts`
- Test: `tests/unit/gateway-supervisor.test.ts`

- [ ] Add failing tests for explicit embedded reconciliation helpers that disable respawn and clear gateway listeners.
- [ ] Run: `pnpm test tests/unit/gateway-supervisor.test.ts`
- [ ] Implement the minimal supervisor helpers needed to reconcile service-installed listeners back to embedded mode.
- [ ] Run: `pnpm test tests/unit/gateway-supervisor.test.ts`

### Task 2: Reconcile after doctor repair and during quit cleanup

**Files:**
- Modify: `electron/gateway/manager.ts`
- Test: `tests/unit/gateway-doctor-repair.test.ts`
- Test: `tests/unit/gateway-manager-stop.test.ts`

- [ ] Add failing tests proving doctor-success and quit cleanup invoke embedded reconciliation.
- [ ] Run: `pnpm test tests/unit/gateway-doctor-repair.test.ts tests/unit/gateway-manager-stop.test.ts`
- [ ] Implement the minimal manager wiring so startup recovery and app quit both converge on embedded mode.
- [ ] Run: `pnpm test tests/unit/gateway-doctor-repair.test.ts tests/unit/gateway-manager-stop.test.ts`

### Task 3: Verify startup flow still respects the existing ownership model

**Files:**
- Modify: `electron/gateway/manager.ts`
- Test: `tests/unit/gateway-supervisor.test.ts`
- Test: `tests/unit/gateway-manager-stop.test.ts`

- [ ] Run a focused regression pass on the changed gateway lifecycle tests.
- [ ] Run: `pnpm test tests/unit/gateway-supervisor.test.ts tests/unit/gateway-doctor-repair.test.ts tests/unit/gateway-manager-stop.test.ts`
- [ ] If the contract changed, update inline comments to match the new embedded reconciliation behavior.
