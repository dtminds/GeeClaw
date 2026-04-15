# Managed Plugin Installer Design

## Goal

GeeClaw should stop shipping `lossless-claw` inside the app package and instead ensure it is installed into the managed OpenClaw profile before the OpenClaw gateway starts. The solution must be generic so future managed plugins can reuse the same workflow without introducing per-plugin startup special cases.

## Scope

This design covers:

- managed plugin registry shape
- startup-time install and upgrade workflow
- staging, validation, cleanup, and atomic promotion
- startup blocking behavior for required plugins
- managed plugin status events for startup UI
- how managed plugin installation interacts with `openclaw.json` patching

This design does not cover:

- artifact-based plugin distribution
- background plugin installation after startup
- non-startup manual plugin management UI

## Current Context

GeeClaw already has a managed OpenClaw profile and performs several startup-time preparation steps before launching the gateway:

1. hydrate packaged OpenClaw sidecar when needed
2. resolve runtime paths and managed environment
3. ensure managed OpenClaw profile setup
4. patch `openclaw.json`
5. launch gateway

Today `lossless-claw` is still treated as a bundled plugin in config and UI flows. The new behavior needs to move plugin readiness into a dedicated startup-time installer that runs before gateway launch.

## Requirements

### Functional

1. `lossless-claw` must no longer be shipped as part of the packaged plugin bundle.
2. Before gateway launch, GeeClaw must determine the currently installed version of each managed plugin so startup status and cleanup logic have accurate context.
3. GeeClaw must install the pinned managed plugin package on every startup using the specified npm-pack workflow, replacing any existing copy.
4. Version upgrades use the same install flow as same-version refreshes and fresh installs.
5. Installation failures must remove `extensions/<pluginId>` to avoid partial installs being treated as valid.
6. Startup behavior must be policy-driven per plugin:
   - required plugins block gateway launch on failure
   - optional plugins report failure but do not block startup
7. The startup UI must show messages such as `正在安装 lossless-claw 插件…`.

### Non-functional

1. No `lossless-claw`-specific startup logic should be embedded directly in `config-sync.ts`.
2. The workflow must be reusable for future managed plugins.
3. The final plugin directory swap must be atomic.
4. Plugin installation and config patching must remain separate concerns.
5. Failed installs should be retried on every startup; there is no failure backoff.
6. Successful installs should also refresh the pinned plugin on every startup so GeeClaw never keeps an older dependency tree in place.

## High-Level Design

The solution is split into three layers:

### 1. Managed Plugin Registry

Create a new registry module, for example:

- `electron/utils/managed-plugin-registry.ts`

This module contains declarative plugin definitions only. The initial entry is `lossless-claw`.

Each managed plugin definition should include:

- `pluginId`
- `packageName`
- `targetVersion`
- `displayName`
- `installMessage`
- `requiredForStartup`
- `syncConfigOnStartup`

Optional future extension points may include:

- `configPolicyId`
- `postInstall`
- `verifyInstall`

### 2. Managed Plugin Installer

Create a new installer module, for example:

- `electron/utils/managed-plugin-installer.ts`

This module is responsible for:

- reading installed plugin version from `configDir/extensions/<pluginId>/package.json`
- installing or upgrading into a staging directory
- validating extracted plugin contents
- installing runtime dependencies
- atomically promoting staged content into the final `extensions/<pluginId>` directory
- deleting final plugin directories on failure
- emitting managed plugin status events

This module must not mutate `openclaw.json`.

### 3. Gateway Startup Integration

`electron/gateway/config-sync.ts` should call the managed plugin installer after managed profile setup and before `syncGatewayConfigBeforeLaunch(...)`.

Updated startup order:

1. `materializePackagedOpenClawSidecar()` when packaged
2. resolve runtime and managed environment
3. `ensureManagedProfileSetup(...)`
4. `ensureManagedPluginsReadyBeforeGatewayLaunch(...)`
5. `syncGatewayConfigBeforeLaunch(...)`
6. build gateway args and fork env
7. launch gateway

This guarantees that config patching only runs after managed plugin files are ready on disk.

## Managed Plugin Install Workflow

For each plugin in the registry, GeeClaw should run the following flow serially during startup:

### Step 1. Check installed version

Read:

- `join(getOpenClawConfigDir(), 'extensions', pluginId, 'package.json')`

If the file is missing or invalid, treat the plugin as not installed.

GeeClaw records the currently installed version for status/reporting, but still proceeds with a fresh staged install even when `package.json.version === targetVersion`.

### Step 2. Create staging workspace

Create a fresh staging directory under:

- `join(configDir, '.managed-plugin-staging', '<pluginId>-<timestamp>-<random>')`

Recommended staging subdirectories:

- `pack/` for the downloaded `.tgz`
- `package/` for the extracted npm package

### Step 3. Fetch package tarball

Run:

- `npm pack <spec@version> --ignore-scripts --json`

The command should run with GeeClaw-managed runtime path and bundled npm resolution, not user shell assumptions.

`spec@version` should be constructed from the registry entry:

- `<packageName>@<targetVersion>`

### Step 4. Extract package tarball

Extract the generated `.tgz` into the staging directory.

Expected output layout should include npm's standard `package/` root.

### Step 5. Validate plugin manifest

Inside the extracted package root:

1. read `package.json`
2. verify `packageJson.openclaw.extensions` exists and is non-empty

If validation fails, installation fails.

### Step 6. Install runtime dependencies

If `package.json.dependencies` is non-empty, run inside the extracted plugin root:

- `npm install --omit=dev --ignore-scripts --silent`

This should also use GeeClaw-managed runtime path and bundled npm resolution.

### Step 7. Promote staged install atomically

Once the staged plugin directory is complete:

1. delete the existing final directory:
   - `configDir/extensions/<pluginId>`
2. atomically `rename(...)` the completed staged plugin root into the final location

If promotion succeeds:

- report the plugin as installed
- delete leftover staging directories

### Step 8. Failure cleanup

On any failure during steps 3-7:

1. delete the staging directory
2. delete `configDir/extensions/<pluginId>`
3. emit failed status with error summary

This intentionally removes the final plugin directory so GeeClaw never treats a partial install as valid on the next startup.

## Status Model and UI Events

Create a dedicated host event instead of overloading sidecar status:

- `openclaw:managed-plugin-status`

Suggested payload:

```ts
type ManagedPluginStage =
  | 'idle'
  | 'checking'
  | 'installing'
  | 'installed'
  | 'failed';

type ManagedPluginStatus = {
  pluginId: string;
  displayName: string;
  stage: ManagedPluginStage;
  message: string;
  targetVersion: string;
  installedVersion?: string | null;
  error?: string;
};
```

### UI behavior

Startup should display the currently active managed plugin message when a plugin is being processed, for example:

- `正在安装 lossless-claw 插件…`

If a required plugin fails, startup should surface:

- plugin name
- failure summary
- retry action via existing startup retry behavior

There should be no ignore-and-continue action for required plugins.

## Failure and Blocking Policy

Each registry entry controls whether startup continues:

- if `requiredForStartup = true`, install failure blocks gateway launch
- if `requiredForStartup = false`, install failure is reported but startup continues

`lossless-claw` should initially be configured as:

- `requiredForStartup: true`

There is no automatic retry backoff. GeeClaw retries installation on every startup.

## Relationship to `openclaw.json`

Managed plugin installation and config patching should remain separate.

### Installer responsibilities

- make the plugin directory exist at the required version
- clean up failed installs
- expose runtime status

### Config patch responsibilities

- write `plugins.entries`
- write `plugins.slots`
- write plugin-owned default config

This remains in existing startup config sync code, but should be driven by plugin policy metadata rather than assuming every managed plugin must be patched.

Registry entries should declare:

- `syncConfigOnStartup: boolean`

For `lossless-claw`, this should remain enabled because memory settings and context engine behavior still depend on config patching.

## Config Behavior When Install Fails

If a required managed plugin fails during startup:

1. startup stops before gateway launch
2. config sync that depends on the plugin should not run for that plugin in the failed startup
3. UI should treat the plugin as unavailable

For `lossless-claw`, this means startup must not proceed into a state where:

- `plugins.slots.contextEngine = 'lossless-claw'`
- the plugin is treated as ready
- the gateway launches without the plugin directory present

## File Responsibilities

### New files

- `electron/utils/managed-plugin-registry.ts`
  - managed plugin definitions

- `electron/utils/managed-plugin-installer.ts`
  - version checks, staging installs, cleanup, atomic promotion, event emission

- `electron/utils/managed-plugin-status.ts`
  - current managed plugin status snapshot and subscriptions

### Existing files to modify

- `electron/gateway/config-sync.ts`
  - call the managed plugin installer before config patching

- `electron/main/index.ts`
  - emit managed plugin status events to renderer

- `electron/preload/index.ts`
  - expose host event subscription for managed plugin status

- `src/lib/host-events.ts`
  - add `openclaw:managed-plugin-status`

- `src/pages/Startup/index.tsx`
  - render managed plugin install message and failure state

- `electron/utils/openclaw-memory-settings.ts`
  - read plugin readiness from managed plugin install state instead of assuming bundled presence

- `electron/utils/plugin-install.ts`
  - stop assuming `lossless-claw` is bundled with the app package

## Testing Strategy

### Unit tests

Add tests covering:

1. plugin already installed at exact target version
   - installer still refreshes the plugin through staging and atomic promotion

2. plugin missing
   - installer runs pack, extract, validate, npm install, promotion

3. plugin installed at wrong version
   - installer reinstalls into staging and atomically promotes

4. missing `openclaw.extensions`
   - install fails and final directory is removed

5. dependency install failure
   - install fails and final directory is removed

6. required plugin failure
   - gateway launch context preparation rejects before gateway startup

7. optional plugin failure
   - startup continues and status reports failed

8. startup UI consumes managed plugin status event
   - installing and failed messages render correctly

### Regression tests

Retain or update tests around:

- managed profile setup
- gateway config sync ordering
- memory settings install-status handling
- bundled plugin load path reconciliation

## Recommendation

Implement the managed plugin installer as a generic startup-time service and register `lossless-claw` as the first managed plugin. This preserves clean separation between:

- plugin file installation
- config patching
- startup UI state

and avoids baking `lossless-claw`-specific logic into future startup flows.
