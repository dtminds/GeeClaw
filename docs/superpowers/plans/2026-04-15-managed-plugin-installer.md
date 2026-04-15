# Managed Plugin Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop bundling `lossless-claw` with GeeClaw, install or upgrade it before gateway startup using a generic managed plugin workflow, and surface install progress/failure in startup UI.

**Architecture:** Add a registry-driven managed plugin installer in Electron main that stages npm-packed plugin installs under the managed OpenClaw config directory, validates and atomically promotes them into `extensions/<pluginId>`, emits status events to the renderer, and blocks gateway startup only for plugins marked as required. Keep `openclaw.json` patching separate from file installation, but make startup config syncing run only after required managed plugins are ready.

**Tech Stack:** Electron main/preload, React startup UI, TypeScript, Vitest, child_process spawn, filesystem staging/promote workflow.

---

### Task 1: Lock the startup contract with failing tests

**Files:**
- Create: `tests/unit/managed-plugin-installer.test.ts`
- Modify: `tests/unit/gateway-config-sync.test.ts`
- Test: `tests/unit/managed-plugin-installer.test.ts`, `tests/unit/gateway-config-sync.test.ts`

- [ ] **Step 1: Write failing installer tests for version checks, validation, dependency install, cleanup, and atomic promotion**

Add table-driven cases covering:
- exact-version reinstall
- missing plugin installs
- version mismatch reinstalls
- missing `openclaw.extensions` fails and removes final dir
- dependency install failure fails and removes final dir

- [ ] **Step 2: Run installer tests to verify they fail**

Run: `pnpm test tests/unit/managed-plugin-installer.test.ts`
Expected: FAIL because installer modules do not exist yet.

- [ ] **Step 3: Write failing startup integration tests**

Extend `tests/unit/gateway-config-sync.test.ts` so that:
- required managed plugin failure rejects `prepareGatewayLaunchContext`
- successful required plugin install runs before `syncGatewayConfigBeforeLaunch`

- [ ] **Step 4: Run gateway config tests to verify they fail**

Run: `pnpm test tests/unit/gateway-config-sync.test.ts`
Expected: FAIL because startup does not yet call managed plugin installer.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/managed-plugin-installer.test.ts tests/unit/gateway-config-sync.test.ts
git commit -m "test: lock managed plugin startup workflow"
```

### Task 2: Implement registry, installer, and status store

**Files:**
- Create: `electron/utils/managed-plugin-registry.ts`
- Create: `electron/utils/managed-plugin-installer.ts`
- Create: `electron/utils/managed-plugin-status.ts`
- Modify: `electron/utils/plugin-install.ts`
- Test: `tests/unit/managed-plugin-installer.test.ts`

- [ ] **Step 1: Implement managed plugin registry with `lossless-claw` as the first required plugin**

Registry entry should define:
- `pluginId: 'lossless-claw'`
- `packageName: '@martian-engineering/lossless-claw'`
- `targetVersion`
- `displayName`
- `installMessage`
- `requiredForStartup: true`
- `syncConfigOnStartup: true`

- [ ] **Step 2: Implement managed plugin status store**

Expose:
- current status getter
- setter
- subscription helper

Status payload should include:
- `pluginId`
- `displayName`
- `stage`
- `message`
- `targetVersion`
- `installedVersion`
- optional `error`

- [ ] **Step 3: Implement installer helpers**

Implement helper functions for:
- reading installed version from `extensions/<pluginId>/package.json`
- creating staging directories
- running `npm pack <pkg>@<version> --ignore-scripts --json`
- extracting npm tarballs
- validating `package.json.openclaw.extensions`
- running `npm install --omit=dev --ignore-scripts --silent` only when dependencies exist
- removing staging and final plugin dirs on failure
- atomic `rename(...)` promotion

- [ ] **Step 4: Run installer tests to verify they pass**

Run: `pnpm test tests/unit/managed-plugin-installer.test.ts`
Expected: PASS

- [ ] **Step 5: Remove bundled assumptions for `lossless-claw`**

Update `electron/utils/plugin-install.ts` so startup config sync no longer assumes `lossless-claw` is bundled with app resources.

- [ ] **Step 6: Commit**

```bash
git add electron/utils/managed-plugin-registry.ts electron/utils/managed-plugin-installer.ts electron/utils/managed-plugin-status.ts electron/utils/plugin-install.ts tests/unit/managed-plugin-installer.test.ts
git commit -m "feat: add managed plugin installer core"
```

### Task 3: Wire managed plugin installation into gateway startup

**Files:**
- Modify: `electron/gateway/config-sync.ts`
- Modify: `tests/unit/gateway-config-sync.test.ts`
- Test: `tests/unit/gateway-config-sync.test.ts`

- [ ] **Step 1: Integrate managed plugin preparation after managed profile setup**

Call `ensureManagedPluginsReadyBeforeGatewayLaunch(...)` after `ensureManagedProfileSetup(...)` and before `syncGatewayConfigBeforeLaunch(...)`.

- [ ] **Step 2: Ensure required plugin failures block startup**

If a required managed plugin fails to install:
- cleanup must already have removed `extensions/<pluginId>`
- `prepareGatewayLaunchContext(...)` should reject

- [ ] **Step 3: Ensure startup config sync runs only after plugin readiness**

Keep installer responsibilities file-based only. Do not move config mutation into the installer.

- [ ] **Step 4: Run gateway config tests to verify they pass**

Run: `pnpm test tests/unit/gateway-config-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/gateway/config-sync.ts tests/unit/gateway-config-sync.test.ts
git commit -m "feat: install managed plugins before gateway startup"
```

### Task 4: Surface managed plugin status to renderer and startup UI

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/lib/host-events.ts`
- Modify: `src/pages/Startup/index.tsx`
- Create: `tests/unit/startup-managed-plugin-status.test.tsx`
- Test: `tests/unit/startup-managed-plugin-status.test.tsx`

- [ ] **Step 1: Add main-process event emission for managed plugin status**

Mirror the sidecar-status pattern for a new `openclaw:managed-plugin-status` event.

- [ ] **Step 2: Expose preload subscription surface**

Update preload event allowlist and host event typings so renderer can subscribe.

- [ ] **Step 3: Update startup UI**

During preparing state:
- show the current managed plugin install message when stage is `checking` or `installing`
- on `failed`, show plugin-specific error and retry action

- [ ] **Step 4: Add renderer test coverage**

Verify startup page reacts to `openclaw:managed-plugin-status` for:
- install in progress
- required plugin failure

- [ ] **Step 5: Run UI status tests to verify they pass**

Run: `pnpm test tests/unit/startup-managed-plugin-status.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add electron/main/index.ts electron/preload/index.ts src/lib/host-events.ts src/pages/Startup/index.tsx tests/unit/startup-managed-plugin-status.test.tsx
git commit -m "feat: surface managed plugin install status during startup"
```

### Task 5: Reconcile memory settings with managed plugin readiness

**Files:**
- Modify: `electron/utils/openclaw-memory-settings.ts`
- Modify: `tests/unit/settings-routes.test.ts`
- Modify: `tests/unit/settings-dialog.test.tsx`
- Test: `tests/unit/settings-routes.test.ts`, `tests/unit/settings-dialog.test.tsx`

- [ ] **Step 1: Update memory settings to derive lossless readiness from managed plugin install result**

Ensure:
- missing plugin => `not-installed`
- install failure or version mismatch => `unavailable`
- ready plugin + slot active => `enabled`

- [ ] **Step 2: Adjust settings tests**

Update expectations for the new managed install behavior without assuming bundled presence.

- [ ] **Step 3: Run settings tests to verify they pass**

Run: `pnpm test tests/unit/settings-routes.test.ts tests/unit/settings-dialog.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add electron/utils/openclaw-memory-settings.ts tests/unit/settings-routes.test.ts tests/unit/settings-dialog.test.tsx
git commit -m "fix: align memory settings with managed plugin readiness"
```

### Task 6: Final verification and cleanup

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Remove packaged dependency assumptions**

Ensure `lossless-claw` is no longer documented or shipped as an app-bundled plugin dependency.

- [ ] **Step 2: Review docs for startup behavior changes**

Update docs only if user-facing startup behavior or packaging assumptions changed materially.

- [ ] **Step 3: Run focused verification**

Run:

```bash
pnpm test tests/unit/managed-plugin-installer.test.ts tests/unit/gateway-config-sync.test.ts tests/unit/plugin-install.test.ts tests/unit/openclaw-plugin-bundler.test.ts tests/unit/after-pack.test.ts tests/unit/startup-managed-plugin-status.test.tsx tests/unit/settings-routes.test.ts tests/unit/settings-dialog.test.tsx
```

Expected:
- all targeted tests pass

- [ ] **Step 4: Run type-level verification if touched files require it**

Run:

```bash
pnpm run typecheck
```

Expected:
- exit code 0

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml README.md README.zh-CN.md
git commit -m "refactor: manage lossless-claw at startup"
```
