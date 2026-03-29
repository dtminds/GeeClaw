# Agent Marketplace Details And Platform Constraints Design

## Summary

This design extends the managed agent marketplace shipped in [2026-03-28-managed-agent-marketplace-design.md](./2026-03-28-managed-agent-marketplace-design.md).

Two gaps remain in the current experience:

1. marketplace presets can be installed, but they cannot be inspected in a dedicated detail surface before install,
2. presets cannot declare platform availability, so GeeClaw cannot prevent a Windows user from trying to install a macOS-only agent preset.

This increment adds:

- a preset detail dialog in the Agents marketplace,
- preset-level platform metadata,
- visible but disabled install actions for unsupported presets,
- server-side install rejection for unsupported platforms.

## Goals

1. Let users inspect a preset before installing it.
2. Show concrete preset information, including preset skills and managed files.
3. Allow preset packages to declare supported platforms.
4. Keep unsupported presets visible in the marketplace.
5. Disable install on unsupported platforms with clear explanation.
6. Enforce the same platform rule on the Electron side so UI bypasses cannot install unsupported presets.

## Non-Goals

1. Adding a new top-level route for preset details.
2. Adding platform editing for custom agents in this increment.
3. Hiding unsupported presets from the marketplace.
4. Runtime health checks that verify the required platform-specific CLI is actually installed.
5. Retroactively blocking already-installed agents from appearing in `My Agents`.

## Existing Foundations

The current implementation already exposes the core data needed for a detail dialog:

- [src/pages/Agents/index.tsx](../../../src/pages/Agents/index.tsx) renders the built-in agent marketplace cards.
- [src/types/agent.ts](../../../src/types/agent.ts) defines the preset summary type consumed by the renderer.
- [src/stores/agents.ts](../../../src/stores/agents.ts) loads preset summaries from `/api/agents/presets`.
- [electron/utils/agent-presets.ts](../../../electron/utils/agent-presets.ts) validates and reads bundled preset packages.
- [electron/utils/agent-config.ts](../../../electron/utils/agent-config.ts) builds preset summaries and performs preset installation.

The Skills marketplace also already has a well-formed detail dialog pattern in [src/pages/Skills/index.tsx](../../../src/pages/Skills/index.tsx). The Agents marketplace should reuse that interaction model instead of introducing a new route.

## Product Design

### Marketplace Detail Surface

Each marketplace card should offer a detail entry point. Clicking the card body or a dedicated secondary action should open a modal detail dialog.

The dialog should show:

- preset name,
- description,
- category,
- resulting `agentId`,
- resulting `workspace`,
- preset skill mode,
- preset-defined skills,
- managed files shipped by the preset package,
- supported platforms,
- current install availability,
- install action in the footer.

This is a dialog, not a route-level detail page. The marketplace remains a single-page workspace with richer inspection.

### Marketplace Card States

Each preset card should show:

- name and description,
- managed badge,
- preset skill count,
- platform badges,
- install state,
- a `View Details` action.

Install button states:

- `Installed`: disabled, existing behavior.
- `Install`: enabled when the preset supports the current platform.
- `Unavailable`: disabled when the preset does not support the current platform.

Unsupported presets must remain visible. The disabled state should be accompanied by short explanatory copy such as "Available on macOS only" or "Available on macOS and Linux".

### Detail Dialog States

The detail dialog footer should match the card state:

- installed preset: show disabled installed state,
- supported preset: show enabled install button,
- unsupported preset: show disabled install button plus explanation.

The detail dialog must still open for unsupported presets so the user can inspect why the preset exists and what it contains.

## Data Model

### Preset Package Metadata

Preset package `meta.json` gains an optional `platforms` field:

```json
{
  "platforms": ["darwin"]
}
```

Rules:

- omission means all desktop platforms are supported,
- allowed values are Node platform ids: `darwin`, `win32`, `linux`,
- the array must be non-empty,
- duplicate values are invalid.

`platforms` belongs to the preset package metadata, not to `openclaw.json`. OpenClaw runtime config does not need to know about GeeClaw marketplace install constraints.

### Renderer Summary Shape

`AgentPresetSummary` should be expanded to include:

- `platforms?: Array<'darwin' | 'win32' | 'linux'>`
- `supportedOnCurrentPlatform: boolean`

The renderer should use these fields to render platform badges and disabled install states. No separate preset-detail endpoint is needed in v1 because the existing preset list is small and already contains the detail payload needed by the dialog.

## Validation And Enforcement

### Preset Validation

[electron/utils/agent-presets.ts](../../../electron/utils/agent-presets.ts) should validate the new `platforms` field when reading bundled preset packages.

Validation failures should include:

- unsupported platform key,
- empty array,
- duplicate values,
- wrong type.

### Install Enforcement

[electron/utils/agent-config.ts](../../../electron/utils/agent-config.ts) should reject `installPresetAgent(presetId)` when the preset declares platforms and the current `process.platform` is not included.

This validation must happen even if the UI already disabled install. The host API is the authority.

Failure messages should be user-facing and precise, for example:

- `Preset "stock-expert" is only available on macOS`
- `Preset "foo" is not available on Windows`

The exact copy may be localized in the renderer if the backend returns a plain compatibility failure. The important rule is that install must fail deterministically and clearly.

## UI Behavior

### Platform Presentation

Platform badges should map Node platform ids to product labels:

- `darwin` -> `macOS`
- `win32` -> `Windows`
- `linux` -> `Linux`

If `platforms` is omitted, the preset should render a neutral `All Platforms` badge instead of three separate badges.

### Unsupported Copy

Unsupported presets should use short, localized copy in two places:

- marketplace card helper text,
- detail dialog helper text.

The copy should describe supported targets rather than exposing raw ids. Examples:

- `Available on macOS only`
- `Available on Windows and Linux`

### Scope Guard

This increment only changes marketplace discovery and install gating.

It does not add:

- custom agent platform editing,
- agent settings platform editing,
- persona or skill policy changes,
- new preset upgrade logic.

## API And State Flow

1. Renderer loads preset summaries from `/api/agents/presets`.
2. Electron reads preset packages, validates `platforms`, and annotates each summary with `supportedOnCurrentPlatform`.
3. Renderer shows cards and detail dialog from that single summary list.
4. User clicks install.
5. Renderer still calls the existing install route.
6. Electron revalidates platform compatibility before writing any managed agent config.

This keeps the compatibility rule in one place while giving the renderer enough data to explain the disabled state.

## Testing Strategy

### Electron Unit Tests

Add or extend tests for:

- preset parsing accepts omitted `platforms`,
- preset parsing accepts valid platform arrays,
- preset parsing rejects invalid platform arrays,
- preset summaries expose `platforms` and `supportedOnCurrentPlatform`,
- install rejects unsupported presets on the current platform.

### Renderer Unit Tests

Add or extend tests for:

- marketplace cards render `View Details`,
- detail dialog shows preset skills and managed files,
- unsupported presets render disabled install buttons,
- unsupported presets remain visible in the marketplace,
- supported presets still install normally.

### Docs

If this behavior ships, update [README.md](../../../README.md) and [README.zh-CN.md](../../../README.zh-CN.md) to mention:

- built-in marketplace presets can have platform restrictions,
- unsupported presets stay visible but cannot be installed on the current device.

## Implementation Impact

Expected primary files:

- `resources/agent-presets/*/meta.json`
- [electron/utils/agent-presets.ts](../../../electron/utils/agent-presets.ts)
- [electron/utils/agent-config.ts](../../../electron/utils/agent-config.ts)
- [src/types/agent.ts](../../../src/types/agent.ts)
- [src/stores/agents.ts](../../../src/stores/agents.ts)
- [src/pages/Agents/index.tsx](../../../src/pages/Agents/index.tsx)
- `tests/unit/agent-presets.test.ts`
- `tests/unit/agent-config-managed.test.ts`
- `tests/unit/agents-page-marketplace.test.tsx`
- `tests/unit/agents-api-routes.test.ts`

The preferred implementation is to keep this as an additive change on top of the existing marketplace rather than a structural rewrite.
