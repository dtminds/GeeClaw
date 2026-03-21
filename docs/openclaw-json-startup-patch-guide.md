# OpenClaw Startup Patch Guide

This document explains how GeeClaw patches `openclaw.json` during startup, where each patch currently lives, and how to safely add new startup-time mutations later.

It is intended as a maintenance reference for future changes.

## Goal

GeeClaw treats `openclaw.json` as a runtime config file that can drift for several reasons:

- the user may edit it manually
- OpenClaw may repair or rewrite parts of it
- GeeClaw stores some source-of-truth data outside `openclaw.json` and needs to restore it
- bundled plugins and discovered skills may appear over time

Startup patching exists to repair that drift before the Gateway starts, and to finish a small amount of reconciliation after the Gateway reaches `running`.

## Single-Writer Rule

All startup-time mutations should go through:

- `electron/utils/openclaw-config-coordinator.ts`

The coordinator exposes:

- `readOpenClawConfigDocument()`
- `writeOpenClawConfigDocument()`
- `mutateOpenClawConfigDocument()`

Important properties of the coordinator:

- it serializes writes through an in-memory queue
- each mutation reads the latest file, applies a targeted patch, then writes back once
- it always ensures `commands.restart = true` on write

Do not add new startup logic that directly does its own `readFile(openclaw.json) -> mutate -> writeFile(openclaw.json)` flow.

## Startup Phases

There are two phases that matter.

### 1. Before Gateway Launch

Entry point:

- `electron/gateway/config-sync.ts`
- `syncGatewayConfigBeforeLaunch()`

Current order:

1. `syncAllChannelConfigToOpenClaw()`
2. `syncAllAgentConfigToOpenClaw()`
3. `syncProxyConfigToOpenClaw(appSettings)`
4. `sanitizeOpenClawConfig()`
5. `syncBundledPluginLoadPathsToOpenClaw()`
6. `ensureAlwaysEnabledBundledPluginsConfigured()`
7. `syncGatewayTokenToConfig(appSettings.gatewayToken)`
8. `syncBrowserConfigToOpenClaw()`
9. `ensureAlwaysEnabledSkillsConfigured()`
10. `syncAllProviderRuntimeConfigToOpenClaw()`

Why this order matters:

- `channels` and `agents` run first because their source of truth lives in GeeClaw stores; if they were deleted from `openclaw.json`, they must be restored before later startup patches touch the file
- `sanitize` runs after the store-backed sections are restored, so it repairs the latest config shape
- bundled plugin load paths run after sanitize so GeeClaw can rewrite the current app-resource plugin roots in one place
- always-enabled bundled plugin policy runs after load-path sync so protected plugin ids are already discoverable
- `skills` policy cleanup happens before Gateway launch, so policy skills start in the correct implicit-enable state
- `providers` run late because they patch multiple runtime-facing sections and should operate on the already-repaired document

### 2. After Gateway Reaches `running`

Entry point:

- `electron/main/index.ts`
- `reconcileSkillsAfterGatewayRunning()`

This phase currently handles only skill discovery reconciliation:

- call `skills.status`
- compare discovered skills with `openclaw.json.skills.entries`
- for newly discovered non-ignored skills, add `enabled: false`
- if `openclaw.json` changed, log the affected keys and restart the Gateway

Why this is after `running`:

- true skill discovery depends on the Gateway having already loaded the skill set

Why this restarts the Gateway:

- if skill discovery changed `openclaw.json`, then the already-running Gateway was started from stale skill config
- restarting ensures the current process loads the corrected skill set

## What Each Startup Patch Owns

### Channels

Main files:

- `electron/services/channels/channel-runtime-sync.ts`
- `electron/utils/channel-config.ts`
- `electron/utils/plugin-install.ts`

Responsibilities:

- restore `channels.*` from GeeClaw channel store
- restore managed plugin entries from GeeClaw store
- reconcile managed channel plugin state
- reconcile `plugins.allow` for managed channel plugins
- reconcile `plugins.entries.<pluginId>.enabled`
- reconcile GeeClaw-bundled plugin `plugins.load.paths` entries so managed channel plugins load from app resources
- remove stale managed `plugins.installs.<pluginId>` records left by the old mirror-to-user-extensions flow
- enforce always-enabled bundled plugin ids (`lossless-claw` today) by ensuring `plugins.allow` contains those ids, patching required `plugins.entries.<id>` defaults such as `enabled` and guarded `config` fields like `dbPath` resolved from GeeClaw's managed OpenClaw config directory, and reconciling required `plugins.slots` assignments such as `contextEngine: "lossless-claw"`
- reconcile managed `session` defaults during startup:
  - `session.dmScope = "per-channel-peer"`
  - `session.reset.mode = "daily"`
  - `session.reset.atHour = 4`
  - `session.resetByType.direct = { mode: "idle", idleMinutes: 960 }`
  - `session.resetByType.group = { mode: "idle", idleMinutes: 240 }`
  - `session.resetByType.thread = { mode: "daily", atHour: 4 }`
  - `session.maintenance.mode = "enforce"`
  - `session.maintenance.pruneAfter = "30d"`
  - `session.maintenance.maxEntries = 500`
  - `session.maintenance.rotateBytes = "10mb"`
  - `session.maintenance.resetArchiveRetention = "30d"`
  - `session.maintenance.maxDiskBytes = "500mb"`
  - `session.maintenance.highWaterBytes = "400mb"`
  - `session.threadBindings = { enabled: true, idleHours: 24, maxAgeHours: 0 }`
  - `session.agentToAgent = { maxPingPongTurns: 5 }`

Source of truth:

- GeeClaw channel store

### Agents

Main files:

- `electron/services/agents/agent-runtime-sync.ts`
- `electron/utils/agent-config.ts`

Responsibilities:

- restore `agents.*` and `bindings` from GeeClaw agent store
- repair missing agent runtime config in `openclaw.json`
- preserve store-backed agent definitions if the file was manually damaged

Source of truth:

- GeeClaw agent store

### Proxy

Main file:

- `electron/utils/openclaw-proxy.ts`

Responsibilities:

- sync GeeClaw proxy settings into OpenClaw channel config where upstream expects explicit channel proxy settings
- currently focused on Telegram channel proxy

Source of truth:

- GeeClaw app settings

### Sanitize

Main file:

- `electron/utils/openclaw-config-sanitize.ts`

Responsibilities:

- restore `agents.defaults.workspace`
- remove invalid `skills.enabled` or `skills.disabled` root keys
- remove stale plugin load paths
- ensure `commands.restart = true`
- mirror default channel account credentials to top-level channel config when required
- remove stale Moonshot/Kimi nested API key config

Source of truth:

- the current `openclaw.json` document plus local managed paths

### Gateway Token and Browser Defaults

Main file:

- `electron/utils/openclaw-gateway-config.ts`

Responsibilities:

- ensure `gateway.auth.mode = "token"`
- sync `gateway.auth.token`
- ensure `gateway.controlUi.allowedOrigins` includes `file://`
- ensure browser defaults exist

Source of truth:

- GeeClaw app settings and GeeClaw runtime expectations

### Skills Policy and Discovery

Main file:

- `electron/utils/skill-config.ts`

Before launch:

- `ensureAlwaysEnabledSkillsConfigured()`

Behavior:

- for `ALWAYS_ENABLED_SKILL_KEYS`, remove explicit `enabled` from `skills.entries.<skillKey>`
- if an entry only contains `enabled`, delete the whole entry
- this preserves OpenClaw's implicit-enable semantics

Important note:

- GeeClaw no longer does a post-start runtime loop that calls `skills.update(enabled: true)` for every policy skill
- doing that contradicted the startup-time cleanup and caused the keys to be written back one by one

After Gateway `running`:

- `ensureSkillEntriesDefaultDisabled()`

Behavior:

- ignore these discovery sources when deciding what to default-disable:
  - `openclaw-managed`
  - `openclaw-extra`
  - `openclaw-workspace`
  - `agents-skills-project`
- for newly discovered eligible keys, write `enabled: false`
- if the file changed, the main-process startup flow restarts the Gateway

Skill config write semantics:

- disabled state is persisted as `enabled: false`
- enabled state is implicit; GeeClaw removes explicit `enabled` instead of writing `enabled: true`

### Providers

Main files:

- `electron/services/providers/provider-runtime-sync.ts`
- `electron/utils/openclaw-provider-config.ts`
- `electron/utils/openclaw-auth.ts`

Responsibilities:

- sync provider auth into runtime config
- sync `models.providers.*`
- sync default provider model
- keep provider-related config aligned with GeeClaw provider state

Source of truth:

- GeeClaw provider store and secure storage

## Non-Startup Mutation Paths

Not every `openclaw.json` mutation happens during startup.

Common non-startup writers include:

- channel CRUD
- agent CRUD
- provider changes
- skill config changes from the Skills page

Rule:

- even outside startup, new `openclaw.json` mutations should still use the coordinator

## How To Add A New Startup Patch

When adding a new startup-time mutation, follow this decision process.

### Step 1. Decide whether it belongs before launch or after `running`

Put it in `syncGatewayConfigBeforeLaunch()` if:

- the desired value is already known before Gateway starts
- the Gateway should start with that value already repaired

Put it in the post-`running` phase if:

- it depends on runtime discovery from the Gateway
- the value cannot be known reliably before the Gateway loads

### Step 2. Put patch logic in a focused helper, not directly in `config-sync.ts`

Examples:

- agent-related changes belong near `agent-runtime-sync.ts`
- channel-related changes belong near `channel-runtime-sync.ts` or `channel-config.ts`
- provider-related changes belong near `provider-runtime-sync.ts` or `openclaw-provider-config.ts`
- skill-related changes belong near `skill-config.ts`

`config-sync.ts` should orchestrate order, not contain large mutation logic.

### Step 3. Use node-level patching inside `mutateOpenClawConfigDocument()`

Preferred style:

- read current document via the coordinator mutation callback
- mutate only the keys your feature owns
- preserve unrelated siblings
- return `changed: false` if no real mutation happened

Avoid:

- rebuilding large unrelated sections
- replacing entire top-level objects unless your helper fully owns them
- writing explicit enabled values where OpenClaw expects implicit enable semantics

### Step 4. Be explicit about source of truth

Every new startup patch should have a clear owner:

- GeeClaw store
- secure storage
- app settings
- runtime discovery
- managed filesystem path

If the source of truth is unclear, the patch will eventually fight with another subsystem.

### Step 5. Decide whether a post-patch Gateway restart is required

Ask:

- does this mutation change something the already-running Gateway has already loaded?

If yes:

- patch the file
- emit a log with enough detail to observe what changed
- restart the Gateway from the startup reconciliation flow

If no:

- patch only, no restart

## Development Checklist

Before shipping a new startup patch, check all of these:

1. Is the patch in the right phase: pre-launch vs post-`running`?
2. Does it use `mutateOpenClawConfigDocument()` instead of ad hoc file I/O?
3. Does it only mutate the keys it owns?
4. Does it preserve unrelated config sections?
5. Does it avoid writing explicit `enabled: true` where implicit enable is the intended upstream behavior?
6. If it changes runtime-loaded state after launch, does it trigger a Gateway restart?
7. Did you add or update a unit test for the mutation?

## Common Pitfalls

### 1. Fighting the source of truth

Example:

- startup deletes a key
- post-start runtime logic writes it back again

If that happens, the boundary between pre-launch repair and post-start runtime enforcement is wrong.

### 2. Overwriting unrelated config

Example:

- a skills patch accidentally rewrites channels, agents, or providers

This usually means the mutation rebuilt too much of the document instead of patching a narrow node.

### 3. Doing discovery-dependent work before discovery exists

Some mutations cannot be correct before the Gateway is already running.

If a value depends on `skills.status` or another runtime-discovered payload, it belongs in the post-`running` path.

### 4. Forgetting that post-start fixes may require restart

If a post-start patch changes loaded runtime behavior, patching the file alone is not enough.

## Recommended Reading Order In Code

If you need to modify this flow, read files in this order:

1. `electron/gateway/config-sync.ts`
2. `electron/utils/openclaw-config-coordinator.ts`
3. the focused helper for your domain:
   - `electron/services/channels/channel-runtime-sync.ts`
   - `electron/services/agents/agent-runtime-sync.ts`
   - `electron/utils/skill-config.ts`
   - `electron/services/providers/provider-runtime-sync.ts`
   - `electron/utils/openclaw-gateway-config.ts`
   - `electron/utils/openclaw-proxy.ts`
   - `electron/utils/openclaw-config-sanitize.ts`

## Current Mental Model

The safest way to think about startup patching is:

- `config-sync.ts` decides when each domain gets a chance to repair `openclaw.json`
- each domain helper owns a narrow part of the document
- the coordinator is the only safe write path
- anything discovered only after Gateway startup must be reconciled later
- if late reconciliation changes loaded runtime state, restart the Gateway
