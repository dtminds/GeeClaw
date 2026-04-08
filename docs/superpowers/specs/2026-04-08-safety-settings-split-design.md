# Safety Settings Split Spec

> Scope: refactor ClawX safety settings so the product exposes separate "Tool Permission" and "Approval Policy" controls whose semantics map directly to managed OpenClaw runtime config.

**Goal:** replace the current single `securityPolicy` UI with two independent settings, remove the unrelated managed-directory row from Settings, and make the persisted settings map one-to-one to `openclaw.json.tools.deny`, `openclaw.json.tools.exec`, and `exec-approvals.json.defaults`.

**Primary source paths**
- `/Users/lsave/workspace/AI/ClawX/src/pages/Settings/index.tsx`
- `/Users/lsave/workspace/AI/ClawX/src/pages/Chat/ChatInput.tsx`
- `/Users/lsave/workspace/AI/ClawX/src/stores/settings.ts`
- `/Users/lsave/workspace/AI/ClawX/electron/utils/store.ts`
- `/Users/lsave/workspace/AI/ClawX/electron/api/routes/settings.ts`
- `/Users/lsave/workspace/AI/ClawX/electron/utils/openclaw-safety-settings.ts`
- `/Users/lsave/workspace/AI/ClawX/tests/unit/openclaw-safety-settings.test.ts`
- `/Users/lsave/workspace/AI/ClawX/tests/unit/settings-routes.test.ts`

---

## 1. Product Decision

ClawX should stop modeling safety as one coarse mode. The product surface now has two orthogonal decisions:

- `toolPermission`: which tool groups GeeClaw denies through `tools.deny`
- `approvalPolicy`: how command execution approval behaves through `tools.exec.*` and `exec-approvals.json.defaults`

The previous managed-directory row in Settings is not a safety control and should be removed from the Safety page.

Because the product has not shipped publicly yet, this change does not need backward-compatibility migration from `securityPolicy`. New source-of-truth fields can replace it directly.

## 2. Settings Model

Persist two new app settings:

```ts
type ToolPermission = 'default' | 'strict' | 'full';
type ApprovalPolicy = 'allowlist' | 'full';
```

`workspaceOnly` and `securityPolicy` should no longer participate in the safety API, safety UI, or OpenClaw safety sync logic.

The safety settings payload returned by `/api/settings/safety` should be:

```ts
type OpenClawSafetySettings = {
  toolPermission: ToolPermission;
  approvalPolicy: ApprovalPolicy;
};
```

## 3. Config Mapping

### 3.1 Tool Permission -> `openclaw.json.tools.deny`

- `default` -> `["group:automation"]`
- `strict` -> `["group:automation", "group:runtime", "group:fs", "sessions_spawn", "sessions_send"]`
- `full` -> no deny list

Implementation detail: when `toolPermission === 'full'`, delete `tools.deny` instead of writing `[]`. That matches existing "fully allowed" behavior and avoids persisting a no-op value.

### 3.2 Approval Policy -> `openclaw.json.tools.exec`

- `allowlist`
  - `tools.exec.security = "allowlist"`
  - `tools.exec.ask = "on-miss"`
- `full`
  - `tools.exec.security = "full"`
  - `tools.exec.ask = "off"`

### 3.3 Approval Policy -> `exec-approvals.json.defaults`

- `allowlist`
  - `security = "allowlist"`
  - `ask = "on-miss"`
  - `askFallback = "allowlist"`
  - `autoAllowSkills = true`
- `full`
  - `security = "full"`
  - `ask = "off"`
  - `askFallback = "full"`
  - `autoAllowSkills = true`

### 3.4 Fixed Guardrails

This refactor should preserve the existing hard-coded safety invariants that are not part of the user-facing controls:

- `tools.profile = "full"`
- `tools.elevated.enabled = false`

Those defaults remain GeeClaw-owned runtime policy and should still be written on every sync.

## 4. Settings UI

The Settings safety page should become a single list-style container with two rows, not separate cards:

1. Tool Permission
   - left: title + explanatory subtitle
   - right: dropdown select
2. Approval Policy
   - left: title + explanatory subtitle
   - right: dropdown select

Rows should be separated with the same neutral, system-consistent treatment used elsewhere in Settings.

Remove:

- the managed directory row
- the old three-option safety-policy button group
- any lingering `workspaceOnly` safety copy

## 5. Chat Composer Safety Controls

The composer safety quick control should expose the same two settings independently:

- tool permission select
- approval policy select

The composer does not need to copy the Settings page row layout; it should stay compact and menu-friendly. The important requirement is parity of behavior and terminology.

## 6. Copy

### 6.1 Tool Permission labels

- Default: deny automation/control capabilities while keeping normal assistant tools available
- Strict: only allow low-risk querying/conversation, with no command execution or file access
- Full: do not apply extra tool-deny restrictions

### 6.2 Approval Policy labels

- `allow-list`: only commands that match approved safety rules run directly; everything else requires confirmation
- unrestricted/full: all commands are allowed by default without manual approval

The default approval policy should be the unrestricted/full option.

## 7. Runtime Flow

Saving either safety control should:

1. persist the app settings
2. sync managed OpenClaw config through `syncOpenClawSafetySettings`
3. trigger Gateway reload when the Gateway is running

Startup config reconciliation should continue to call `syncOpenClawSafetySettings(appSettings)` before launch so manual edits to managed config are overwritten by GeeClaw's source of truth.

## 8. Testing

Required regression coverage:

- `openclaw-safety-settings`
  - tool-permission mapping only mutates `tools.deny`
  - approval-policy mapping mutates `tools.exec` and `exec-approvals.json.defaults`
  - sibling config under `tools.*` is preserved
- `settings-routes`
  - GET/PUT shape uses `toolPermission` + `approvalPolicy`
  - saving still debounces Gateway reload when running
- renderer tests
  - Settings page renders two selects and saves each independently
  - composer safety control renders two selects and saves each independently

## 9. Docs Review Rule

This is a user-facing settings change, so `README.md` and `README.zh-CN.md` must be reviewed during implementation. Update them only if they currently describe the old Safety UI or old single-mode semantics.
