# Remote Agent Package Design

**Date:** 2026-04-03

## Summary

GeeClaw should evolve official preset agents from bundled app resources into versioned remote packages distributed through a catalog. The first version should keep the package model intentionally narrow:

- official packages only,
- local `catalog.json` as the source of available agents,
- one zip package per official agent,
- zip contents limited to `meta.json`, `files/`, and `skills/`,
- no install scripts in v1,
- no dirty-file detection or three-way merge in v1.

This gives GeeClaw a practical path to ship and update individual official agents without forcing a desktop app release for every preset change, while preserving the current managed-agent installation semantics for workspace files and skills.

## Problem

Preset agents are currently bundled into the application package. That creates several product and maintenance problems:

1. Updating a single preset requires shipping a new desktop build.
2. Preset delivery is tied to release cadence even when only agent content changed.
3. Post-install guidance is static and disconnected from the installed agent conversation flow.
4. The current model does not prepare GeeClaw for future remote catalog delivery.

At the same time, the app already has useful managed-agent behavior that should not be discarded:

- preset-defined `files/` are seeded into a managed workspace,
- preset-defined `skills/` are seeded with the existing skill-install logic,
- installed agents are tracked as managed agents with product restrictions,
- users expect existing chat history and local workspaces to remain stable.

The design should improve distribution flexibility without turning preset installation into an unbounded plugin system.

## Goals

1. Allow official agents to be installed and upgraded from versioned zip packages.
2. Use a local `catalog.json` first, with a smooth path to a future server API.
3. Preserve the current managed-agent workspace model and skill seeding logic.
4. Allow upgrades of existing official agents without deleting the workspace or affecting chat history.
5. Restrict upgrades so they only overwrite official managed content.
6. Support optional post-install and post-update user guidance via prompt text defined in package metadata.
7. Keep the first implementation small enough to ship before introducing install scripts, merges, or rollback orchestration.

## Non-Goals

1. Third-party agent packages.
2. Remote code execution or package-defined install scripts in v1.
3. Automatic dirty-file detection for managed files.
4. Three-way merge or conflict resolution for user-edited managed content.
5. Full transactional rollback during apply.
6. Auto-sending messages to agents after install or update.
7. Splitting distribution identity from runtime identity in v1. `agentId` is the only identifier.

## Existing Product Context

The app already contains the main building blocks for a managed preset workflow:

- [electron/utils/agent-presets.ts](/Users/lsave/workspace/AI/ClawX/electron/utils/agent-presets.ts) loads packaged preset metadata, files, and skills from bundled resources.
- [electron/utils/agent-config.ts](/Users/lsave/workspace/AI/ClawX/electron/utils/agent-config.ts) installs preset agents into OpenClaw config and seeds workspace content.
- [electron/utils/paths.ts](/Users/lsave/workspace/AI/ClawX/electron/utils/paths.ts) defines the current bundled preset directory resolution.
- [src/pages/Agents/MarketplacePresetDetailDialog.tsx](/Users/lsave/workspace/AI/ClawX/src/pages/Agents/MarketplacePresetDetailDialog.tsx) already exposes preset install state in the Agents marketplace UI.
- [electron/utils/cli-marketplace.ts](/Users/lsave/workspace/AI/ClawX/electron/utils/cli-marketplace.ts) provides a useful reference for job state and install progress reporting.

The new remote package flow should extend this managed-agent foundation instead of introducing a second installation model.

## Recommended Approach

The recommended v1 is a controlled remote package system for official agents:

1. GeeClaw ships a local `catalog.json` that lists available official packages.
2. Each package entry points to a zip download.
3. The zip is downloaded to a temporary directory.
4. GeeClaw verifies checksum and validates package structure.
5. GeeClaw applies the package by reusing existing managed file and skill seeding logic.
6. GeeClaw records a local managed state describing which files and skills belong to that official package.
7. After install or update, GeeClaw can guide the user into the new or updated agent conversation with an optional package-defined prompt.

This creates an immediate distribution win without taking on the larger surface area of script execution, package migrations, or merge semantics.

## Alternatives Considered

### 1. Keep Bundling Presets into the App

This is the lowest engineering change, but it keeps preset updates tightly coupled to desktop releases and does not solve the original flexibility problem.

### 2. Add Full Install Script Support in v1

This would maximize package flexibility, but it also introduces the hardest parts first:

- execution trust and signing,
- platform-specific script behavior,
- failure recovery,
- install artifact ownership,
- uninstall and upgrade semantics.

For official packages only, install scripts may still be worth adding later, but they should not block the first remote-package milestone.

### 3. Push All Post-Install Logic into Agent Conversation

This is flexible, but it is too nondeterministic to define installation success. Whether an agent completes those steps depends on user action, model behavior, and runtime conditions. It works well as a guided follow-up, not as the installer itself.

## Core Concepts

### 1. Official Agent Package

An official agent package is a zip archive for one `agentId`. In v1 the package is trusted because it comes from GeeClaw-controlled distribution, not because the package format is open to arbitrary external providers.

The package contains:

- `meta.json`
- `files/`
- `skills/`

No other top-level directories are supported in v1.

### 2. Catalog Entry

The catalog is GeeClaw's discovery and version surface. It answers:

- which official agents exist,
- which version is latest,
- where the package lives,
- whether the package applies to the current platform,
- whether the app version is compatible.

### 3. Managed Content Boundary

Managed content is the only content GeeClaw may overwrite during update.

In v1 managed content consists of:

- package-provided workspace files from `files/`,
- package-provided skills from `skills/`.

Everything else is outside the overwrite boundary.

### 4. Prompt-Based Follow-Up

Packages may define optional plain-text prompts:

- `postInstallPrompt`
- `postUpdatePrompt`

These prompts are not executed automatically. They only drive post-success UI behavior:

- if a prompt exists, the success dialog offers `Go Send`,
- if a prompt does not exist, the success dialog offers `Go Chat`.

`Go Send` routes the user to the target agent and pre-fills the input box with the prompt text. The message is not auto-sent.

## Data Model

### Catalog

The first implementation should read a local `catalog.json`. The recommended entry shape is:

```json
{
  "agentId": "research-analyst",
  "name": "Research Analyst",
  "description": "Structured market and product research specialist.",
  "emoji": "🔎",
  "category": "research",
  "version": "1.2.0",
  "platforms": ["darwin", "win32", "linux"],
  "downloadUrl": "https://cdn.example.com/agents/research-analyst-1.2.0.zip",
  "checksum": "sha256-...",
  "size": 182340,
  "minAppVersion": "0.13.0"
}
```

Field notes:

- `agentId` is the only package identifier in v1.
- `version` is the latest available package version for that `agentId`.
- `checksum` is required to reject corrupted or mismatched packages.
- `size` is optional for logic but useful for UI.
- `platforms` and `minAppVersion` gate install availability before download begins.

### Package Metadata

`meta.json` should keep the current preset metadata shape where possible and add:

```json
{
  "packageVersion": "1.2.0",
  "postInstallPrompt": "Please inspect this workspace, tell me what was installed, and guide me through the best first task to run with you.",
  "postUpdatePrompt": "Please summarize what changed in this update, check whether my current workspace still looks healthy, and tell me if I should adjust anything before continuing."
}
```

Rules:

- both prompt fields are optional,
- both prompt fields are plain strings,
- no variable interpolation,
- no conditional templating,
- `packageVersion` must match the catalog version for the downloaded package,
- `meta.agent.id` in package metadata must match the catalog entry.

### Local Managed State

GeeClaw should persist a local record for each installed official agent package. Minimum fields:

```json
{
  "agentId": "research-analyst",
  "packageVersion": "1.2.0",
  "managedFiles": ["AGENTS.md", "MEMORY.md"],
  "managedSkills": ["research-pack", "trend-scan"],
  "installedAt": "2026-04-03T12:00:00.000Z",
  "updatedAt": "2026-04-03T12:00:00.000Z",
  "sourceDownloadUrl": "https://cdn.example.com/agents/research-analyst-1.2.0.zip"
}
```

This state is not for dirty detection in v1. Its purpose is to define the overwrite boundary for updates and preserve installed package identity.

## Package Structure

Each official package zip should expand to a single package directory with this layout:

```text
<package-root>/
  meta.json
  files/
    AGENTS.md
    MEMORY.md
  skills/
    some-skill/
      SKILL.md
```

Validation rules:

1. `meta.json` must exist.
2. `files/` and `skills/` may be empty, but if present they must follow the same validation rules as today's bundled presets.
3. Unknown top-level entries should fail validation in v1 to keep the format strict.
4. Skill directories must contain `SKILL.md`.
5. Managed file names should continue to respect the current recognized file policy.

## Install Flow

### Preconditions

Before install begins:

- the app must confirm that the catalog entry supports the current platform,
- the app must confirm `minAppVersion` is satisfied,
- the target `agentId` must not already exist in the installed agent set.

### Install Steps

1. Read the selected catalog entry.
2. Download the zip into a temporary directory.
3. Verify checksum.
4. Extract the zip into a temporary working directory.
5. Validate the package structure and metadata.
6. Create the agent entry using the existing managed-agent config flow.
7. Seed `files/` into the managed workspace using the existing preset file logic.
8. Seed `skills/` using the existing preset skill logic.
9. Persist local managed state with `packageVersion`, managed file list, and managed skill list.
10. Show the install success dialog.

Install must be treated as failed if any validation step fails before apply.

## Update Flow

### Update Detection

An installed official agent is updateable when:

- local managed state exists for that `agentId`,
- the catalog still contains that `agentId`,
- the catalog version is newer than local `packageVersion`.

### Update Confirmation

Before starting update, GeeClaw should show a confirmation dialog with explicit overwrite boundaries:

> This update will overwrite this official agent's managed files and skills. Chat history and other non-managed workspace content will not be affected.

No dirty-file detection is performed in v1. If the user manually edited a managed file and confirms update, the official version wins.

### Update Steps

1. Read the latest catalog entry for the installed `agentId`.
2. Download the zip into a temporary directory.
3. Verify checksum.
4. Extract into a temporary working directory.
5. Validate structure and metadata.
6. Reapply managed `files/` into the existing workspace.
7. Reapply managed `skills/` into the existing workspace.
8. Update local managed state with the new `packageVersion`, managed file list, and managed skill list.
9. Show the update success dialog.

Update must not:

- delete the workspace,
- reinitialize the agent from scratch,
- remove chat history,
- touch non-managed workspace content.

## UI and Interaction

### Agent Marketplace State

The agent marketplace should show three primary states for official packages:

- `Install`
- `Update`
- `Installed`

The state depends on whether the `agentId` exists locally and whether local `packageVersion` matches the catalog version.

### Progress Stages

Installation and update progress can use a simple stage model:

- `downloading`
- `verifying`
- `extracting`
- `applying`

This is sufficient for v1 user feedback and aligns with the existing job/progress approach used elsewhere in the product.

### Success Dialog Behavior

For install success:

- if `postInstallPrompt` exists, primary CTA is `Go Send`,
- otherwise, primary CTA is `Go Chat`.

For update success:

- if `postUpdatePrompt` exists, primary CTA is `Go Send`,
- otherwise, primary CTA is `Go Chat`.

Behavior:

- `Go Send` navigates to the target agent and fills the compose input with the prompt text,
- `Go Chat` navigates to the target agent with an empty compose input,
- neither action auto-sends a message.

### Copy Requirements

Install success copy should make the separation clear:

- official content installation succeeded,
- user still decides whether to send the suggested follow-up message.

Update success copy should also make the overwrite boundary clear:

- official managed content was updated,
- chat history and non-managed content were preserved.

## Error Handling

The first version should prefer explicit failure over partial or ambiguous state.

Failure cases include:

1. `catalog.json` missing or invalid.
2. download failure.
3. checksum mismatch.
4. invalid zip structure.
5. package `meta.agent.id` mismatch against the selected catalog entry.
6. package `packageVersion` mismatch against the selected catalog version.
7. apply failure while writing managed files or skills.

Failure behavior:

- stop the operation,
- preserve the currently installed agent when possible,
- present a user-visible failure message,
- keep enough stage or log detail for debugging.

Implementation guidance:

- do not write into the final workspace until download, checksum, extraction, and structural validation have completed,
- during update, do not delete the workspace as a pre-step,
- prefer item-by-item overwrite of managed content over destructive replacement of the whole directory.

## Why Install Scripts Are Deferred

Install scripts may become useful later for official packages that need CLI bootstrap or environment preparation. They are deferred from v1 for three reasons:

1. They expand the trust and execution model significantly.
2. They complicate failure recovery and upgrade semantics.
3. The prompt-based follow-up flow already covers a meaningful class of human-guided setup tasks without redefining install success.

When install scripts are revisited, they should be treated as a distinct second-phase design rather than quietly added to this package format.

## Testing Strategy

### Unit Tests

Add tests for:

- catalog entry parsing and validation,
- package metadata parsing and validation,
- package structure validation,
- version comparison,
- managed state read/write behavior,
- CTA selection rules for `postInstallPrompt` and `postUpdatePrompt`.

### Integration Tests

Add tests for:

- successful first install,
- successful update over an existing installed agent,
- update detection when catalog version is newer,
- workspace path stability across update,
- chat history preservation assumptions across update,
- navigation and compose prefill after `Go Send`,
- no prefill after `Go Chat`,
- failure on checksum mismatch,
- failure on invalid package structure,
- failure on metadata mismatch without corrupting the existing install.

## Documentation Impact

If this design is implemented, the product documentation should be updated in:

- [README.md](/Users/lsave/workspace/AI/ClawX/README.md)
- [README.zh-CN.md](/Users/lsave/workspace/AI/ClawX/README.zh-CN.md)

Documentation should explain:

- that official agents are versioned packages,
- that updates can happen independently of desktop releases,
- that updates overwrite only managed package content,
- that install and update success may offer a suggested follow-up message to send to the agent.

## Assumptions

1. Official remote packages are still fully controlled by the GeeClaw team.
2. `agentId` is sufficient as the only package identity in v1.
3. The current managed file and skill seeding logic can be reused with modest adaptation.
4. Users can accept coarse-grained overwrite confirmation for managed content in v1.
5. A later service-backed catalog can preserve the same client-facing data shape with minimal UI change.
