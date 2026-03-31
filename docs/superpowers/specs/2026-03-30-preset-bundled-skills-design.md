# Preset Bundled Skills Design

## Goal

Support preset-specific bundled skills that are fetched at build time from public GitHub repositories, packaged inside preset resources, and copied into the target Agent workspace during preset installation.

This design keeps the current runtime contract:

- App-level preinstalled skills remain app-scoped and are exposed through the OpenClaw config directory.
- Preset-specific skills remain preset-scoped and are copied into the installed Agent workspace under `SKILLS/`.
- Adding a preset Agent is still a local installation flow, but the UI should present it as a visible installation process with progress states.

## Non-Goals

- No GitLab support in this phase.
- No runtime network download during preset installation.
- No change to the existing preset-managed skill visibility model.
- No unification of app-level preinstalled skills and preset-bundled skills into one physical manifest file.

## Current State

### App-level preinstalled skills

- Declared in `resources/skills/preinstalled-manifest.json`.
- Fetched during packaging by `scripts/bundle-preinstalled-skills.mjs`.
- Bundled into `build/preinstalled-skills`.
- Shipped as app resources and exposed through OpenClaw skill load paths.

### Preset-bundled skills

- Preset loader already reads `resources/agent-presets/<presetId>/skills/*`.
- Preset install already copies these skills into `workspace/SKILLS/<slug>/...`.
- Preset metadata currently only declares runtime `agent.skillScope.skills`, not build-time skill sources.

## Problem

Preset metadata can declare required skill slugs, but there is no build-time source of truth for fetching the preset-private skill contents that should ship with the app.

The existing app-level preinstalled skills manifest is close in spirit, but its lifecycle is different:

- App-level skills are globally visible.
- Preset-bundled skills are only materialized when a preset Agent is installed.

Trying to reuse a single manifest for both concerns would blur packaging scope, installation semantics, and ownership.

## Decision

Introduce a preset-local build manifest:

- Path: `resources/agent-presets/<presetId>/skills.manifest.json`

Keep `meta.json` focused on runtime Agent behavior:

- preset identity
- managed policy
- model
- `agent.skillScope`

Use `skills.manifest.json` only for build-time acquisition of preset-private skill payloads.

## Manifest Boundary

### `meta.json`

`meta.json` remains the runtime contract for a preset and continues to answer:

- What is this preset?
- What Agent ID/model/skill scope does it install?
- What managed restrictions apply?

### `skills.manifest.json`

`skills.manifest.json` becomes the build contract for preset-private bundled skills and answers:

- Which skill slugs must be bundled into this preset package?
- Where should the build fetch them from?
- Which repo path/ref should be used?

It must not describe app-global preinstalled skills.

## Proposed `skills.manifest.json` Schema

```json
{
  "version": 1,
  "skills": [
    {
      "slug": "stock-analyzer",
      "delivery": "bundled",
      "source": {
        "type": "github",
        "repo": "org/repo",
        "repoPath": "skills/stock-analyzer",
        "ref": "main",
        "version": "main"
      }
    }
  ]
}
```

### Required fields

- `version`
  - Initial value: `1`
- `skills`
  - Array of preset-private bundled skill specs
- `skills[].slug`
  - Must match the target directory name under `preset/skills/`
- `skills[].delivery`
  - Only allowed value in this phase: `"bundled"`
- `skills[].source.type`
  - Only allowed value in this phase: `"github"`
- `skills[].source.repo`
  - GitHub `owner/repo`
- `skills[].source.repoPath`
  - Path inside repo to copy
- `skills[].source.ref`
  - Branch, tag, or commit-ish to fetch

### Optional fields

- `skills[].source.version`
  - Human-friendly requested version label for lock output; defaults to `ref`

## Consistency Rules

Build validation must enforce:

1. Every `skills.manifest.json` entry produces a bundled skill directory with `SKILL.md`.
2. Every bundled skill slug must be unique within a preset.
3. Every slug in `skills.manifest.json` must appear in `meta.json.agent.skillScope.skills`.
4. A preset may reference additional app-global skills in `meta.json.agent.skillScope.skills` without listing them in `skills.manifest.json`.
5. `skills.manifest.json` must not reference skills that are meant to stay app-global only.

This gives a clean model:

- `meta.json.agent.skillScope.skills` = runtime enabled slugs
- `skills.manifest.json.skills` = subset of slugs that are preset-private and bundled into the preset package

## Build Pipeline

Add a new script:

- `scripts/bundle-agent-preset-skills.mjs`

### Responsibilities

1. Read all preset directories under `resources/agent-presets/`.
2. For each preset with `skills.manifest.json`:
   - validate manifest schema
   - validate consistency against `meta.json`
   - fetch declared GitHub repo subsets
   - copy resulting skill contents into generated preset output
3. Generate a build output tree at:
   - `build/agent-presets/<presetId>/...`
4. Preserve unmanaged preset files and persona files from source preset resources.
5. Write a preset skill lock file for reproducibility.

### Output shape

```text
build/agent-presets/<presetId>/
  meta.json
  files/
  skills/
    <slug>/
      SKILL.md
      ...
  .skills-lock.json
```

### Why generate `build/agent-presets`

Runtime preset loading reads packaged `resources/agent-presets`. The build must therefore produce a fully resolved preset package tree, not a detached shared skill bundle.

## Packaging Changes

Packaging should prefer generated preset resources when present.

Expected direction:

- Keep source presets in `resources/agent-presets` for authoring.
- Bundle generated presets from `build/agent-presets` into packaged `resources/agent-presets`.

This keeps runtime loading unchanged while letting build output replace authoring-time partial resources.

## Runtime Installation Behavior

No network download is added to preset installation.

The current install flow remains:

1. Validate preset availability/platform support.
2. Create the Agent config entry.
3. Seed preset-managed files into workspace.
4. Copy preset-bundled skills into `workspace/SKILLS`.
5. Persist config and management metadata.

This preserves:

- offline installation
- deterministic packaged output
- stable tests
- no dependency on GitHub availability at runtime

## UI Installation Experience

Although installation remains local, the UI should present it as a real installation flow instead of an instant opaque mutation.

### Proposed states

- `idle`
- `preparing`
- `installing_files`
- `installing_skills`
- `finalizing`
- `completed`
- `failed`

### Progress model

Initial version can be step-based rather than byte-based.

Example mapping:

- `preparing` = 10%
- `installing_files` = 35%
- `installing_skills` = 70%
- `finalizing` = 90%
- `completed` = 100%

This is sufficient because the work is local and relatively fast; users mainly need visibility that installation is happening.

### UX rules

- Disable duplicate install attempts while a preset install is in progress.
- Show the current preset being installed.
- Surface step label text instead of pretending to show network download progress.
- If install fails, show the error and return to idle.

## Data Model Changes

### Preset loader

Extend preset package representation to include optional manifest metadata for validation/build only when reading from source/build output.

Runtime install path still only needs:

- `meta`
- `files`
- `skills`

No runtime dependency on source URLs should remain after packaging.

### Lock file

Generate a preset-local lock file, for example:

- `build/agent-presets/<presetId>/.skills-lock.json`

Suggested contents:

- generated timestamp
- preset id
- bundled skill slugs
- repo
- repo path
- ref
- resolved commit

## Why Not Download On Preset Install

Runtime download would be more flexible, but it introduces unnecessary system complexity in this phase:

- network failure handling
- retry/cancel/resume
- caching strategy
- auth/rate limits
- integrity verification
- rollback behavior
- nondeterministic installs over time

For curated preset packages, build-time bundling is the better default. The UI can still present installation progress without turning preset install into a remote package manager.

## Testing

Add or extend tests for:

1. preset manifest schema validation
2. mismatch between `skills.manifest.json` and `meta.json.agent.skillScope.skills`
3. generated preset package includes bundled skill files
4. runtime preset install still copies bundled skills into `workspace/SKILLS`
5. install progress UI transitions across local installation stages

## Migration Strategy

Phase 1:

- Introduce `skills.manifest.json`
- Add bundling script for preset-private skills
- Package generated preset tree
- Keep runtime install logic unchanged

Phase 2:

- Add install progress UI
- Surface step-based progress in preset marketplace install actions

## Open Questions Resolved

### Should app-global and preset-private skills share one manifest?

No. They may share a schema shape, but should live in separate manifests because lifecycle and visibility differ.

### Should preset install download from GitHub at runtime?

No. Build-time bundling remains the default. Install UI may show progress for local installation steps.
