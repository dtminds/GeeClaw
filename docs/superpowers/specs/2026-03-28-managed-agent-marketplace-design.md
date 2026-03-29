# Managed Agent Marketplace Design

## Summary

GeeClaw should ship a built-in agent marketplace that lets users install curated agent presets into the managed OpenClaw profile. Presets must materialize as real entries under `openclaw.json > agents.list`, including preset-defined `id`, `workspace`, optional per-agent `skills` allowlist, and preset-specific workspace bootstrap files such as `AGENTS.md`, `SOUL.md`, or other locked persona content.

Installed preset agents are "managed" by GeeClaw. Managed status does not mean every field is immutable. Instead, GeeClaw applies targeted product rules:

- `id` stays fixed.
- `workspace` stays fixed.
- persona file locks are enforced per file by managed policy.
- `skills` remain editable, but preset-defined skills cannot be removed while the agent is managed.

Users can later choose "Unmanage" to convert a preset agent into a normal custom agent. Unmanaging preserves the current config snapshot and removes preset-origin restrictions.

## Problem

GeeClaw already supports multi-agent management, per-agent workspaces, and persona files, but it does not yet provide a first-class way to:

1. install curated preset agents from a built-in marketplace,
2. persist preset-defined per-agent `skills` allowlists into `openclaw.json`,
3. bundle preset-specific workspace files such as `AGENTS.md` and locked persona markdown files,
4. distinguish managed preset agents from normal custom agents,
5. enforce product restrictions consistently across both the agent management page and the chat-side persona editor.

Without that layer, "preset agents" would be little more than copy suggestions. Users could accidentally modify critical preset structure immediately after creation, and the app would have no stable way to explain which parts are template-owned versus user-owned.

## Goals

1. Provide a built-in marketplace tab within the Agents workspace for installing curated preset agents.
2. Install preset agents using the preset's declared `id`, `workspace`, preset package files, and optional per-agent `skills` allowlist.
3. Support per-agent skill scope in a product-friendly way:
   - `Default`: do not write an agent `skills` allowlist.
   - `Specified`: write `skills: string[]` with at most 6 skill keys.
4. Allow both managed and unmanaged agents to edit their skill scope at any time.
5. Prevent managed agents from removing skills that come from the preset definition.
6. Allow preset packages to provide locked workspace files, including `AGENTS.md` and persona markdown files.
7. Allow users to explicitly unmanage a preset agent and turn it into a fully custom agent.
8. Enforce the same restrictions server-side so UI-only bypasses are not possible.

## Non-Goals

1. Remote marketplace sync or server-delivered preset catalogs.
2. Preset version upgrades, migrations, or three-way merges.
3. Partial unmanage flows per field.
4. Preset cloning into a new `id` during v1.
5. Complex inheritance between preset and user overrides beyond the managed skill floor.

## Existing Product Context

The current app already has the major foundations needed for this feature:

- [electron/utils/agent-config.ts](../../../electron/utils/agent-config.ts) owns agent config reads, writes, and filesystem provisioning.
- [electron/services/agents/agent-runtime-sync.ts](../../../electron/services/agents/agent-runtime-sync.ts) syncs GeeClaw-managed agent state back into `openclaw.json`.
- [src/pages/Agents/index.tsx](../../../src/pages/Agents/index.tsx) already provides the main agent management UI.
- [src/pages/Chat/PersonaDrawer.tsx](../../../src/pages/Chat/PersonaDrawer.tsx) is a second editing surface for persona files and must therefore respect managed restrictions too.

This feature should extend those foundations instead of introducing a second agent system.

## Core Concepts

### 1. Preset Agent

A preset agent is a curated template bundled with GeeClaw. It defines:

- marketplace metadata for discovery and presentation,
- the OpenClaw-facing agent configuration to install,
- preset workspace files to seed into the agent workspace,
- managed policy metadata used by GeeClaw after installation.

The source of truth for a preset should be a directory package rather than a hard-coded TypeScript object. That package can include both metadata and locked workspace files.

### 2. Managed Agent

A managed agent is an installed preset agent that still follows GeeClaw preset rules.

Managed status means:

- the agent remains linked to a `presetId`,
- some fields are fixed by policy,
- locked persona files remain protected while other persona files may still be editable,
- preset workspace files such as `AGENTS.md` remain template-owned until unmanage,
- preset-origin skills form a non-removable minimum set,
- the user may still add extra skills within the v1 limit.

### 3. Unmanaged Agent

An unmanaged agent behaves like a normal custom agent.

Unmanaging:

- preserves current `workspace`, persona content, and selected skills,
- removes preset-owned locks,
- clears the preset skill floor,
- allows free future edits within normal product validation.

### 4. Skill Scope

GeeClaw should present per-agent skill allowlist configuration as a mode rather than as raw JSON.

- `Default`: the agent does not define `skills` in `openclaw.json`.
- `Specified`: the agent defines `skills: string[]`.

Validation rules:

- at most 6 skills in `Specified` mode,
- no duplicate skill keys,
- empty `Specified` is invalid,
- preset-defined skill count must also be `<= 6`.

## Product Rules

### Agent Installation Rules

When a user installs a preset:

1. GeeClaw creates a new agent entry with the preset's `id`.
2. GeeClaw writes the preset's `workspace`.
3. GeeClaw writes `skills` only if the preset declares `Specified` skill scope.
4. GeeClaw copies preset workspace files from the preset package into the agent workspace.
5. GeeClaw stores local management metadata that links the agent to the preset.

If the preset `id` already exists, installation must fail with a clear, user-friendly conflict.

### Managed Field Rules

For managed agents:

- display name remains editable.
- `id` is fixed.
- `workspace` is fixed.
- preset workspace files are template-owned and read-only while managed.
- `skills` are editable under policy.

For unmanaged agents:

- all normal custom-agent editing rules apply.

### Managed Skill Rules

Preset-defined skills are not fully immutable configuration. They are instead a required subset while the agent remains managed.

If a preset defines `skills = ["a", "b"]`, then while managed:

- `["a", "b"]` is valid,
- `["a", "b", "c"]` is valid,
- `["a", "c"]` is invalid because `b` was removed,
- `Default` mode is invalid because it would remove both preset skills.

If a preset defines no skills:

- the managed agent may use either `Default` or `Specified`,
- there is no preset skill floor.

### Unmanage Rules

When the user unmanages an agent:

1. the current agent config becomes the new custom baseline,
2. current `skills` remain exactly as they were,
3. current persona files remain exactly as they were,
4. preset locks are removed,
5. preset identity remains viewable in historical metadata if desired, but no longer affects validation.

## User Experience

### Agents Page Structure

The Agents area should become a two-view workspace:

1. `My Agents`
2. `Marketplace`

This keeps all agent-related actions in one place and avoids adding a new top-level sidebar concept.

### Marketplace View

Each preset card should show:

- icon,
- name,
- one-line description,
- scenario/category tags,
- whether it is managed after install,
- preset skill count if applicable.

Preset detail should show:

- resulting `agentId`,
- resulting `workspace`,
- skill scope summary,
- preset-defined skills,
- managed restrictions summary,
- primary call to action: `Install`.

### My Agents View

Installed preset agents should be visibly different from custom agents.

Recommended labels:

- `Managed`
- `From Marketplace`

The settings modal for a managed agent should show:

- editable display name,
- read-only `id`,
- read-only `workspace`,
- a skill scope editor with managed guidance,
- a managed persona section with per-file lock explanation,
- channel bindings,
- a primary management action: `Unmanage`.

### Skill Scope UI

The settings experience should not expose raw JSON.

Recommended interaction model:

1. A segmented control or radio group:
   - `Default`
   - `Specified`
2. When `Specified` is selected:
   - searchable skill picker,
   - selected skill chips,
   - count indicator such as `3 / 6`.

For managed agents:

- preset-owned skills render as locked chips,
- user-added skills render as removable chips,
- if preset-owned skills exist, `Default` mode is disabled with helper text.

Suggested helper copy:

- "This agent includes preset skills. You can add more skills, but preset skills cannot be removed while the agent is managed."

### Persona Editing UX

The chat-side persona drawer must support per-file managed locks.

For managed agents:

- content remains visible,
- locked persona files render read-only,
- unlocked persona files remain editable,
- save behavior only persists unlocked files,
- the drawer explains the lock state only for the active locked tab.

The current managed preset policy locks `IDENTITY.md` while keeping `USER.md`, `MEMORY.md`, and `SOUL.md` editable.

This rule must also be enforced on the API, not just in the UI.

Note: the current UI only edits persona files (`IDENTITY.md`, `USER.md`, `SOUL.md`, `MEMORY.md`). Preset packages may also include `AGENTS.md` and other bootstrap files. Those files should still be seeded and treated as managed even if v1 does not expose a dedicated editor for them.

## Data Model

### Bundled Preset Package

The source of truth for built-in presets should be a directory package under `resources/agent-presets/<presetId>/`.

Recommended layout:

```text
resources/agent-presets/
  stock-expert/
    meta.json
    files/
      AGENTS.md
      IDENTITY.md
      USER.md
      SOUL.md
      MEMORY.md
```

Rules:

- `meta.json` is required.
- `files/` is optional.
- files under `files/` are copied into the installed agent workspace preserving file names.
- files under `files/` are treated as preset-managed while the agent remains managed.
- the canonical agent instruction file name is `AGENTS.md`, matching the existing runtime bootstrap behavior. v1 should not introduce a parallel `AGENT.md` naming scheme.

The app may still normalize `meta.json` into an in-memory `AgentPreset` object for renderer and main-process use, but the authoring source should be the filesystem package.

Suggested `meta.json` shape:

```ts
type AgentSkillScope =
  | { mode: 'default' }
  | { mode: 'specified'; skills: string[] };

interface AgentPresetMeta {
  presetId: string;
  name: string;
  description: string;
  iconKey: string;
  category: string;
  managed: true;
  agent: {
    id: string;
    workspace: string;
    model?: string | { primary?: string; fallbacks?: string[] };
    skillScope: AgentSkillScope;
  };
  managedPolicy?: {
    lockedFields: Array<'id' | 'workspace' | 'persona'>;
    canUnmanage: boolean;
  };
}
```

Recognized v1 preset-managed workspace files:

- `AGENTS.md`
- `IDENTITY.md`
- `USER.md`
- `SOUL.md`
- `MEMORY.md`

Future versions may extend this to other bootstrap files such as `BOOT.md`, `HEARTBEAT.md`, or `TOOLS.md`.

### GeeClaw Local Metadata

Keep GeeClaw-only metadata out of `openclaw.json`. Store it alongside the agent runtime store.

```ts
interface ManagedAgentMetadata {
  agentId: string;
  source: 'preset';
  presetId: string;
  managed: boolean;
  lockedFields: Array<'id' | 'workspace' | 'persona'>;
  presetSkills: string[];
  managedFiles: string[];
  installedAt: string;
  unmanagedAt?: string;
}
```

Custom agents may either omit metadata or use:

```ts
interface CustomAgentMetadata {
  agentId: string;
  source: 'custom';
  managed: false;
}
```

### OpenClaw Agent Representation

GeeClaw should continue writing standard OpenClaw agent entries only.

Examples:

`Default` skill scope:

```json
{
  "id": "researcher",
  "workspace": "~/.openclaw-geeclaw/workspace-researcher"
}
```

`Specified` skill scope:

```json
{
  "id": "stockexpert",
  "workspace": "~/.openclaw-geeclaw/workspace-stockexpert",
  "skills": ["stock-analyzer", "stock-announcements", "stock-explorer"]
}
```

No GeeClaw-only metadata should leak into `openclaw.json`.

### Preset File Seeding

During install, GeeClaw should seed any recognized files found under the preset package's `files/` directory into the target workspace. This seed step should happen before the first runtime sync that depends on those files.

If a target file already exists because of a conflicting prior partial install, the install should fail rather than silently merging template-owned content.

## API Design

### `GET /api/agents`

Extend each returned `AgentSummary` with:

- `source: 'custom' | 'preset'`
- `managed: boolean`
- `presetId?: string`
- `lockedFields: string[]`
- `managedFiles: string[]`
- `skillScope: { mode: 'default' | 'specified'; skills: string[] }`
- `presetSkills: string[]`
- `canUseDefaultSkillScope: boolean`

### `GET /api/agents/presets`

Returns bundled marketplace preset metadata for list and detail views.

### `POST /api/agents/presets/install`

Request:

```json
{
  "presetId": "stock-expert"
}
```

Behavior:

- validates preset,
- ensures preset skill count `<= 6`,
- ensures target `id` is unused,
- resolves preset package files,
- installs the agent,
- persists management metadata,
- returns the updated agent snapshot.

### `PUT /api/agents/:id`

This route should evolve from "rename only" to a structured update endpoint, or a new sibling route should be added for agent settings updates. The design requirement is that GeeClaw must support updating:

- display name,
- skill scope mode,
- specified skills.

Validation must enforce:

- max 6 skills,
- managed preset skills cannot be removed,
- managed agent with preset skills cannot switch to `Default`.

### `POST /api/agents/:id/unmanage`

Converts a managed preset agent to a normal custom agent.

### `GET /api/agents/:id/persona`

Extend response with:

- `editable: boolean`
- `lockedFiles: Array<'identity' | 'master' | 'soul' | 'memory'>`
- optional explanatory message

### `PUT /api/agents/:id/persona`

Must reject writes to managed persona files.

## Validation Rules

### Preset Validation

A preset is invalid if:

- `presetId` is empty,
- `agent.id` is invalid,
- `agent.skillScope.mode === 'specified'` and skill count is 0,
- `agent.skillScope.mode === 'specified'` and skill count is greater than 6,
- `agent.skillScope.skills` contains duplicates,
- `meta.json` references unsupported preset structure,
- `files/` contains unsupported or duplicate managed file names.

### Agent Skill Scope Validation

For all agents:

- `Default` means omit `skills`,
- `Specified` means `1 <= skills.length <= 6`,
- all skills must be unique strings.

For managed agents:

- the resulting skill set must be a superset of `presetSkills`,
- `Default` is allowed only when `presetSkills.length === 0`.

## Error Handling

Introduce explicit business errors for the renderer to map cleanly.

Recommended codes:

- `AGENT_PRESET_NOT_FOUND`
- `AGENT_PRESET_INVALID`
- `AGENT_PRESET_ALREADY_INSTALLED`
- `AGENT_MANAGED_FIELD_LOCKED`
- `AGENT_MANAGED_PERSONA_LOCKED`
- `AGENT_SKILL_SCOPE_TOO_LARGE`
- `AGENT_PRESET_SKILL_REMOVAL_FORBIDDEN`
- `AGENT_DEFAULT_SKILL_SCOPE_FORBIDDEN`

## Implementation Boundaries

### Main Process

Main-process logic should own:

- preset catalog loading,
- preset package filesystem reads,
- install validation,
- managed metadata persistence,
- server-side access rules,
- agent skill scope validation,
- persona write blocking,
- preset file seeding.

### Renderer

Renderer should own:

- marketplace browsing UI,
- skill scope controls,
- locked chip rendering,
- read-only persona presentation,
- unmanage confirmation flow.

Renderer must not decide policy on its own. It may pre-disable invalid actions, but the main process remains the final authority.

## File-Level Design Direction

Primary implementation areas:

- `resources/agent-presets/*`
- [electron/utils/agent-config.ts](../../../electron/utils/agent-config.ts)
- [electron/api/routes/agents.ts](../../../electron/api/routes/agents.ts)
- [electron/services/agents/store-instance.ts](../../../electron/services/agents/store-instance.ts)
- [electron/services/agents/agent-runtime-sync.ts](../../../electron/services/agents/agent-runtime-sync.ts)
- [electron/utils/paths.ts](../../../electron/utils/paths.ts)
- [src/types/agent.ts](../../../src/types/agent.ts)
- [src/stores/agents.ts](../../../src/stores/agents.ts)
- [src/pages/Agents/index.tsx](../../../src/pages/Agents/index.tsx)
- [src/pages/Chat/PersonaDrawer.tsx](../../../src/pages/Chat/PersonaDrawer.tsx)

The runtime sync layer should continue syncing only OpenClaw-compatible agent fields and should not write GeeClaw management metadata into `openclaw.json`.

## Testing Strategy

### Unit Tests

1. preset installation writes `id`, `workspace`, and `skills` correctly,
2. invalid presets with more than 6 skills fail,
3. preset installation seeds `AGENTS.md` and persona files from the preset package,
4. managed agents can add extra skills but cannot remove preset skills,
5. managed agents with preset skills cannot switch to `Default`,
6. managed agents with no preset skills can switch between `Default` and `Specified`,
7. unmanaging preserves current skill selection,
8. persona write attempts fail while managed,
9. persona writes succeed after unmanage,
10. GeeClaw metadata does not leak into `openclaw.json`.

### UI Verification

1. marketplace cards and detail drawer render preset metadata,
2. managed agents display badges,
3. locked skill chips render correctly,
4. `Default` mode disables correctly for managed agents with preset skills,
5. persona drawer shows read-only messaging for managed agents.

## Rollout Plan

### v1 Scope

Ship the following together:

1. marketplace view inside Agents,
2. bundled preset install flow,
3. managed-agent metadata,
4. per-agent skill scope editor with `Default` vs `Specified`,
5. 6-skill limit,
6. preset skill floor enforcement,
7. persona read-only enforcement,
8. unmanage flow.

### Deferred

After v1, consider:

1. preset updates,
2. marketplace search and categories expansion,
3. preset cloning,
4. richer managed-vs-custom diff views,
5. telemetry for install and unmanage adoption.

## Decisions

The following decisions are now fixed for implementation:

1. Marketplace lives inside the existing Agents workspace, not as a new top-level navigation item.
2. The source of truth for a preset is a directory package under `resources/agent-presets/<presetId>/`, not a hard-coded inline object only.
3. Preset packages may seed managed workspace files, including `AGENTS.md` and persona markdown files.
4. Managed agents keep `id`, `workspace`, and persona editing locked.
5. `skills` are editable for both managed and unmanaged agents.
6. Managed agents cannot remove preset-defined skills until they are unmanaged.
7. Skill scope is represented as `Default` or `Specified`.
8. `Specified` mode supports at most 6 skills.
9. Unmanage preserves current config and removes preset restrictions.
