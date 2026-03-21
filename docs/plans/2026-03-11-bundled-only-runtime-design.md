# Bundled-Only OpenClaw Runtime Design

Date: 2026-03-11
Status: Draft
Owner: GeeClaw desktop

## Context

GeeClaw currently supports two OpenClaw runtime sources:

- bundled runtime shipped inside the app
- system-wide runtime discovered from `PATH`

PR 281 was manually merged into this branch with local adaptations. That work isolates GeeClaw-managed OpenClaw state under `~/.geeclaw/openclaw` instead of `~/.openclaw`, and injects `OPENCLAW_STATE_DIR` into spawned OpenClaw processes.

This document describes the next step: remove system-wide runtime mode entirely and keep bundled runtime only.

## Problem

Even after state isolation, keeping a selectable system-wide runtime still has product and support costs:

- support matrix doubles because GeeClaw behavior depends on an external OpenClaw version
- enterprise deployment becomes less predictable
- debugging gets harder because runtime source can drift per machine
- installer, settings UI, and process management all keep extra branches for system mode

The product goal is to make GeeClaw a one-click managed distribution where runtime behavior is fully controlled by the app.

## Goals

- GeeClaw always launches the bundled OpenClaw runtime
- GeeClaw stores all managed OpenClaw state under `~/.geeclaw/openclaw`
- GeeClaw can detect an existing system-wide OpenClaw installation or `~/.openclaw` state and offer one-time migration
- runtime, settings, and process code paths are simplified to bundled-only
- CLI and installer behavior no longer risk hijacking or depending on a system-wide `openclaw`

## Non-Goals

- removing support for importing legacy `~/.openclaw` data
- changing the bundled OpenClaw packaging strategy
- redesigning the full onboarding flow beyond the migration entry points needed for this change

## Product Decision

Adopt bundled-only runtime.

Migration should be explicit and one-time:

- detect `~/.openclaw` and/or a system `openclaw` command
- if GeeClaw state is still empty, show an import prompt
- copy supported data into `~/.geeclaw/openclaw`
- never write back into `~/.openclaw`

Do not keep a hidden fallback to system runtime. Once this ships, system OpenClaw is import-only, not run-time selectable.

## Required Code Changes

### 1. Runtime selection removal

Simplify runtime resolution so only bundled runtime remains:

- `electron/utils/openclaw-runtime.ts`
- `electron/gateway/config-sync.ts`
- `electron/gateway/manager.ts`
- `electron/gateway/supervisor.ts`
- `electron/utils/openclaw-cli.ts`

Expected changes:

- remove `OpenClawRuntimeSource = 'bundled' | 'system'` branching where not needed
- keep system detection only as a migration helper
- remove `spawn` path for external `openclaw` in normal gateway startup
- simplify gateway attach and foreign-process behavior that only exists for system mode

### 2. Settings and UI cleanup

Remove the user-facing runtime toggle and related persistence:

- `electron/utils/store.ts`
- `src/stores/settings.ts`
- `src/pages/Settings/index.tsx`
- `src/i18n/locales/en/settings.json`
- `src/i18n/locales/zh/settings.json`

Expected changes:

- remove `openclawRuntimeSource` from persisted settings
- remove runtime source buttons and text from Settings
- keep status display for bundled OpenClaw version/path if useful

### 3. Migration flow

Add a migration service and startup check:

- detect legacy state at `~/.openclaw`
- optionally detect a system `openclaw` binary for diagnostics only
- copy supported subtrees into `~/.geeclaw/openclaw`
- write a migration marker so the user is not prompted again

Recommended migration candidates:

- `openclaw.json`
- `.env`
- `skills/`
- `extensions/`
- `agents/`
- `credentials/`
- `media/`

Recommended safeguards:

- migrate only when GeeClaw target state is empty or user confirms overwrite
- keep a timestamped backup inside `~/.geeclaw/openclaw-backups/`
- run `openclaw doctor --fix --yes --non-interactive` against the target state after import

### 4. CLI and installer behavior

Avoid command-name conflicts with a system-wide OpenClaw installation.

Current risk:

- Linux installer creates `/usr/local/bin/openclaw`
- Windows installer adds GeeClaw CLI wrapper directory to user `PATH`

Recommended change:

- stop installing the bundled wrapper as global `openclaw` by default
- either expose no global OpenClaw command, or expose a GeeClaw-specific alias such as `geeclaw-openclaw`
- keep CLI access inside the app and developer tooling via explicit command copy

### 4.1 Bare `openclaw` resolution policy

OpenClaw upstream may perform bare `openclaw` exec/spawn calls internally. GeeClaw cannot fully control those upstream call sites, so GeeClaw must control what `openclaw` resolves to inside the environment of any OpenClaw process it launches.

Recommended rule:

- do not rely on the machine's global `PATH`
- do enforce that the `PATH` inherited by a GeeClaw-launched OpenClaw process resolves `openclaw` to the expected GeeClaw-managed target

Recommended implementation:

1. Build a GeeClaw-controlled shim directory for runtime command resolution.
2. Place a shim named `openclaw` / `openclaw.cmd` in that directory.
3. For bundled mode, the shim dispatches to the bundled OpenClaw entry.
4. For legacy system mode, if still temporarily supported, the shim dispatches to the resolved `commandPath` for that system runtime.
5. Prepend this shim directory to `PATH` when launching:
   - Gateway
   - doctor repair
   - any other GeeClaw-managed OpenClaw subprocess

This makes all upstream bare `openclaw` lookups resolve deterministically inside GeeClaw-managed processes without mutating the user's global shell environment.

### 4.2 Startup guard

Add a preflight check using the exact child-process environment GeeClaw is about to launch:

- resolve `openclaw` with that effective `PATH`
- verify it points to the expected shim or target
- for bundled mode, fail startup if it does not
- emit a clear error explaining that GeeClaw could not guarantee internal OpenClaw self-invocation consistency

This is intentionally different from checking the machine's global `PATH`.

- global `PATH` mismatch should not block GeeClaw on its own
- effective child `PATH` mismatch should block startup, because it means GeeClaw failed to construct a deterministic runtime environment

Engineering rule for follow-up work:

- any GeeClaw-managed subprocess should prefer explicit absolute paths where possible
- for upstream code that cannot be changed, rely on the GeeClaw shim-first `PATH`
- do not introduce new bare `openclaw` exec/spawn calls in GeeClaw code unless they execute under the controlled shim-first environment

Files to review:

- `resources/cli/posix/openclaw`
- `resources/cli/win32/openclaw.cmd`
- `scripts/installer.nsh`
- `scripts/linux/after-install.sh`
- `scripts/linux/after-remove.sh`
- `electron/utils/openclaw-cli.ts`

### 5. Documentation updates

If bundled-only runtime ships, update:

- `README.md`
- `README.zh-CN.md`
- settings copy and onboarding copy

The docs should clearly say:

- GeeClaw ships and manages its own OpenClaw runtime
- GeeClaw stores managed state under `~/.geeclaw/openclaw`
- existing `~/.openclaw` users can import once during setup

## Suggested Implementation Order

1. Finish state isolation and land regression tests.
2. Add migration service and migration UI entry point.
3. Remove runtime selector from settings and persisted store.
4. Simplify runtime/process code to bundled-only.
5. Remove global `openclaw` installer behavior or rename the wrapper command.
6. Update docs and onboarding copy.

## Testing Plan

Add or update tests for:

- bundled runtime is always selected
- settings store no longer persists runtime source
- migration detection when `~/.openclaw` exists
- migration copies expected directories and writes marker files
- gateway launch env always includes `OPENCLAW_STATE_DIR=~/.geeclaw/openclaw`
- installer scripts no longer register conflicting `openclaw` commands

Manual verification:

- clean machine with no `~/.openclaw`
- machine with existing `~/.openclaw`
- machine with system `openclaw` on `PATH`
- Windows, macOS, Linux packaged builds

## Risks

- migration can copy very large `media/` or `agents/` trees
- partial migration can leave config referencing missing files
- removing global `openclaw` may affect users who rely on the current wrapper behavior
- startup code still contains assumptions about system runtime or foreign gateway processes
- failing to enforce a GeeClaw-controlled shim-first `PATH` can let upstream bare `openclaw` calls resolve to the wrong binary

## Acceptance Criteria

- user cannot choose system runtime in GeeClaw
- GeeClaw never launches a system `openclaw` binary during normal operation
- GeeClaw never writes runtime state into `~/.openclaw`
- first-run migration from legacy `~/.openclaw` works or can be skipped safely
- packaged app behaves consistently across supported platforms
