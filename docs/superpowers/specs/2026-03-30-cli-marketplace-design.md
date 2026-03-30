# CLI Marketplace Design

## Summary

GeeClaw should add a curated CLI marketplace for npm-distributed tools such as Feishu and WeCom CLIs.

The marketplace is intentionally narrow:

- only app-defined whitelist entries are shown,
- GeeClaw first detects whether a CLI is already installed,
- if the CLI is missing, the app offers one-click install,
- if the CLI is already present, the app offers reinstall,
- the UI only shows `已安装` or `未安装`,
- GeeClaw does not compare local and remote versions and does not surface upgrade availability.

The implementation should reuse GeeClaw's existing managed-runtime pattern: installation and detection live in Electron Main, while the renderer only talks through the host API layer.

## Goals

1. Let GeeClaw ship a curated list of npm-based CLIs without bundling each CLI into the app.
2. Detect whether each CLI is already available on the user's machine.
3. Install missing CLIs with a single user action and without admin privileges.
4. Support reinstall for any listed CLI without adding version-comparison logic.
5. Keep the renderer simple: `已安装 / 未安装` plus `安装 / 重新安装`.
6. Keep the implementation compatible with Windows, including `.cmd` wrappers and quoting.

## Non-Goals

1. Open npm search or free-form package installation.
2. Automatic upgrade prompts, latest-version comparison, or update badges.
3. Displaying the detected CLI source in the UI.
4. Managing arbitrary user Node/npm environments.
5. Adding uninstall in this increment.
6. Installing CLIs with machine-wide admin privileges.

## Product Decisions

### Marketplace Scope

The marketplace is backed by a bundled whitelist manifest. Users cannot search npm or enter package names manually.

Each marketplace item represents a known npm package and the command(s) GeeClaw expects after installation.

### UI States

Each CLI card shows:

- CLI name,
- short description,
- homepage or docs link,
- install status: `已安装` or `未安装`,
- primary action: `安装` or `重新安装`.

The UI does not display:

- current version,
- latest version,
- source (`system` vs GeeClaw-installed),
- upgrade availability.

### Reinstall Semantics

`重新安装` always reruns installation into GeeClaw's controlled user-level npm prefix.

GeeClaw does not attempt to determine whether the machine already has the latest version. Reinstall is an explicit user action that refreshes GeeClaw's controlled installation path.

## Existing Foundations

GeeClaw already has the architectural pieces needed for this feature:

- [src/lib/host-api.ts](../../../src/lib/host-api.ts) provides renderer access to Electron-owned HTTP routes.
- [electron/api/routes/skills.ts](../../../electron/api/routes/skills.ts) shows the existing host API route style for marketplace flows.
- [electron/gateway/clawhub.ts](../../../electron/gateway/clawhub.ts) demonstrates a Main-owned marketplace service pattern.
- [electron/utils/openclaw-runtime.ts](../../../electron/utils/openclaw-runtime.ts) and [electron/utils/mcporter-runtime.ts](../../../electron/utils/mcporter-runtime.ts) already implement PATH-based system command detection.
- [electron/utils/win-shell.ts](../../../electron/utils/win-shell.ts) already encapsulates Windows spawn quoting rules.
- [scripts/download-bundled-node.mjs](../../../scripts/download-bundled-node.mjs) already downloads a bundled Node runtime, but currently extracts only the bare `node` binary.

The new design should extend these patterns instead of introducing renderer-owned install logic or direct npm calls from React components.

## Architecture

### Main-Owned CLI Marketplace Service

Add a new Electron-side service, `CliMarketplaceService`, responsible for:

- reading the bundled CLI catalog manifest,
- detecting installation state,
- invoking bundled npm installation,
- returning normalized status data to the renderer.

Renderer code should only call host API routes such as:

- `GET /api/cli-marketplace/catalog`
- `POST /api/cli-marketplace/install`
- optional diagnostics routes if needed later

No renderer component should call `window.electron.ipcRenderer.invoke(...)` directly for this feature. The existing host-api and api-client boundary remains authoritative.

### Whitelist Catalog Manifest

Store a bundled manifest under an app-owned path such as `resources/cli-marketplace/catalog.json`.

Each entry should contain only the data needed to render and install a curated npm CLI:

```json
[
  {
    "id": "feishu-cli",
    "title": "Feishu CLI",
    "packageName": "@example/feishu-cli",
    "binNames": ["feishu"],
    "description": "Official Feishu command line tool",
    "homepage": "https://example.com/feishu-cli",
    "platforms": ["darwin", "win32", "linux"],
    "installArgs": []
  }
]
```

Rules:

- `id`, `title`, `packageName`, and `binNames` are required,
- `binNames` must be non-empty,
- omission of `platforms` means all desktop platforms are supported,
- `installArgs` is optional and exists only for package-specific install flags,
- version fields are intentionally omitted because this increment does not compare versions.

## Installation Model

### Bundled Runtime

GeeClaw should stop treating the bundled Node download as `node` only. To support npm installs, the build must preserve a minimal npm-capable runtime from the official Node distribution.

Required packaged files:

- Windows:
  - `node.exe`
  - `npm`
  - `npm.cmd`
  - `npx`
  - `npx.cmd`
  - `node_modules/npm/**`
- macOS/Linux:
  - `bin/node`
  - `bin/npm`
  - `bin/npx`
  - `lib/node_modules/npm/**`

This remains based on the official Node distribution already downloaded by [scripts/download-bundled-node.mjs](../../../scripts/download-bundled-node.mjs); GeeClaw is not introducing a second npm source.

### Controlled User-Level Global Prefix

GeeClaw should install npm CLIs into a user-level prefix that the app controls, rather than relying on whatever global prefix the user's own npm configuration happens to use.

Recommended locations:

- Windows: `%AppData%/GeeClaw/npm-global`
- macOS/Linux: `~/.geeclaw/npm-global`

Although implementation uses a controlled prefix, this still behaves as a user-level global install:

- no admin rights required,
- stable writable location,
- reinstall remains deterministic,
- GeeClaw does not mutate machine-wide locations.

### Install Command

For a catalog entry with package `packageName`, GeeClaw runs:

```bash
npm install -g <packageName>
```

The spawned process should inject stable npm environment variables, including:

- `npm_config_prefix=<geeclaw-user-prefix>`
- `npm_config_update_notifier=false`
- `npm_config_fund=false`
- `npm_config_audit=false`

GeeClaw may also add proxy-related env if the app already has proxy settings configured.

## Detection Model

### User-Facing Status

The user-visible status is binary:

- `已安装`
- `未安装`

An entry is considered installed if either of the following is true:

1. one of its declared commands is available on the system PATH,
2. one of its declared commands exists in GeeClaw's controlled user prefix.

### Internal Source Tracking

Even though the UI does not show origin, the service should still retain internal source information:

- `system`
- `geeclaw`
- `none`

This internal field is useful for:

- logs,
- diagnostics,
- command resolution inside GeeClaw,
- future troubleshooting if installation reports conflict with runtime behavior.

### Command Discovery

Use the same strategy as existing runtime detectors:

- Windows: `where.exe <bin>`
- macOS/Linux: `which -a <bin>` plus fallback directory checks when appropriate

GeeClaw should check:

1. system PATH candidates first,
2. then the controlled user prefix bin directory.

The resulting UI status still collapses to `已安装 / 未安装`.

## Windows Compatibility

Windows is the highest-risk platform for this feature. The implementation must follow the repository's existing command execution patterns.

Rules:

- invoke `npm.cmd` by absolute path when using the bundled npm runtime,
- use [electron/utils/win-shell.ts](../../../electron/utils/win-shell.ts) helpers for command preparation and quoting,
- use `where.exe` for PATH discovery,
- treat `.cmd` wrappers as first-class executables during detection and execution,
- avoid shell-string concatenation in renderer or ad-hoc command building in Main.

The app should not rely on the user having a system Node installation or a working `npm` on PATH.

## API Shape

### Catalog Response

`GET /api/cli-marketplace/catalog` should return all bundled whitelist entries together with computed installation state.

Example shape:

```ts
type CliMarketplaceCatalogItem = {
  id: string;
  title: string;
  description: string;
  homepage?: string;
  installed: boolean;
  actionLabel: '安装' | '重新安装';
  source: 'system' | 'geeclaw' | 'none';
};
```

The renderer may ignore `source` initially, but keeping it in the payload is worthwhile for debugging and future diagnostics.

### Install Route

`POST /api/cli-marketplace/install` accepts:

```json
{
  "id": "feishu-cli"
}
```

Behavior:

1. resolve the catalog entry by `id`,
2. verify current platform support,
3. run bundled npm install into GeeClaw's controlled prefix,
4. re-detect command availability,
5. return success or a normalized error.

There is no separate reinstall route in v1. The same install endpoint handles both install and reinstall.

## Renderer Behavior

The renderer should remain intentionally small:

- load catalog entries from the host API,
- render cards or list rows,
- show `已安装` or `未安装`,
- show `安装` or `重新安装`,
- surface install errors inline or via toast.

The renderer should not:

- compare versions,
- guess command paths,
- probe npm registry metadata,
- make direct IPC calls,
- construct shell commands.

## Error Handling

Normalize install failures into clear categories:

1. Network failure
   - npm package download or registry access failed
2. Prefix or filesystem failure
   - GeeClaw could not write to its controlled install directory
3. Unsupported platform
   - whitelist entry is not allowed on the current desktop platform
4. Runtime packaging failure
   - bundled npm runtime is incomplete or missing

If install succeeds but the user terminal does not immediately recognize the command, GeeClaw should explain that reopening the terminal or adding the GeeClaw user-level bin directory to PATH may be required. This is a usability note, not an install failure.

## Documentation Impact

README updates are required when this work ships.

The docs should explicitly describe:

- GeeClaw now provides a curated CLI marketplace,
- GeeClaw checks whether supported CLIs are already installed,
- missing CLIs can be installed with one click,
- installation uses a GeeClaw-managed user-level npm prefix,
- the app UI does not show upgrade availability,
- reinstall reruns installation without comparing versions,
- terminal recognition may require reopening the terminal window.

Both [README.md](../../../README.md) and [README.zh-CN.md](../../../README.zh-CN.md) should be reviewed in the implementation PR because the feature changes the product surface and installation behavior.

## Testing Strategy

### Electron Tests

Add or extend tests for:

- catalog manifest validation,
- current-platform filtering,
- system PATH detection for declared `binNames`,
- controlled-prefix detection,
- install route success path,
- install route failure when bundled npm runtime is incomplete,
- Windows command resolution behavior,
- reinstall behavior using the same install endpoint.

### Renderer Tests

Add or extend tests for:

- `已安装` state rendering,
- `未安装` state rendering,
- action label switching between `安装` and `重新安装`,
- install error presentation,
- absence of any upgrade badge or version comparison UI.

### Manual Verification

Before shipping, verify on at least:

- a clean Windows machine with no system Node/npm CLI installed,
- a Windows machine where the target CLI already exists on PATH,
- a macOS machine with no target CLI installed,
- repeated reinstall of the same CLI into GeeClaw's controlled prefix.

## Open Questions Resolved In This Design

The design intentionally resolves the earlier product questions as follows:

- system-installed CLI counts as installed,
- missing CLI is installed with user-level privileges only,
- marketplace entries are whitelist-only,
- the UI does not distinguish source,
- GeeClaw does not show upgrade availability,
- reinstall is always allowed and does not require a version comparison step.
