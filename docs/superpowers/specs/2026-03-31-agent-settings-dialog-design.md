# Agent Settings Dialog Design

## Goal

Remove the standalone `Agents` management page and move agent-scoped management into chat, centered around a unified settings dialog for the current agent.

The new surface should:

- replace the current `PersonaDrawer` with a full `Agent Settings` dialog
- expose agent creation from the sidebar via a `+` entry
- keep agent editing scoped to the currently active chat agent
- remove the `unmanage` capability entirely
- split the old `persona` concept into explicit sections:
  - `Identity`
  - `Soul`
  - `Long-term Memory`
  - `Owner Profile`

## Current State

- `src/pages/Agents/index.tsx` currently combines:
  - agent list browsing
  - agent creation
  - agent deletion
  - single-agent settings
- `AgentSettingsModal` inside `src/pages/Agents/index.tsx` already owns:
  - rename
  - channel assignment display/removal
  - skill scope management
  - unmanage flow
- `src/pages/Chat/ChatToolbar.tsx` already has an agent-scoped entry point through `PersonaDrawer`.
- `src/pages/Chat/PersonaDrawer.tsx` loads and saves four persona-backed files through `/api/agents/:id/persona`:
  - `IDENTITY.md`
  - `SOUL.md`
  - `MEMORY.md`
  - `USER.md`

## Product Decision

### Remove Agents List Page

The product will no longer provide a dedicated `Agents` list page.

Implications:

- users create new agents from the sidebar `+` entry
- users manage the current agent from chat
- users delete an agent from that agent's settings dialog
- users do not browse or bulk-manage all agents from a separate page

### Remove Unmanage

The `unmanage` action must be removed from the UI and from this interaction model.

Marketplace-added or preset-managed agents remain managed. Users may rename them and manage allowed skills, but cannot convert them into unmanaged agents.

### Split Persona Into Explicit Sections

The UI should no longer present a top-level `Persona` concept.

Instead, agent settings should expose the concrete sections directly:

- `General`
- `Skills`
- `Identity`
- `Soul`
- `Long-term Memory`
- `Owner Profile`

`Soul` remains the user-facing label for `SOUL.md`.

## Target Structure

### Entry Point

`src/pages/Chat/ChatToolbar.tsx` becomes the primary entry point for current-agent settings.

Interaction:

- clicking the agent name, or a dedicated settings affordance beside it, opens the new dialog
- the old persona button is removed

### Dialog Shell

Create a new `AgentSettingsDialog` with a layout consistent with the app's settings surfaces:

- modal dialog, not side drawer
- left navigation rail for sections
- right content panel for the selected section
- shared modal surface classes from `src/styles/globals.css`

The dialog should feel like a true settings center rather than a narrow form sheet.

### Navigation Sections

The left navigation contains these sections in order:

1. `General`
2. `Skills`
3. `Identity`
4. `Soul`
5. `Long-term Memory`
6. `Owner Profile`

No `Persona` navigation item should remain.

## Section Responsibilities

### General

`General` is responsible for agent metadata and destructive actions.

It contains:

- editable agent name
- read-only agent id
- read-only model display
- delete agent action

It does not contain:

- channels management
- unmanage
- persona content

Channel management is intentionally dropped from this redesign because the requested scoped outcome is rename, skills, and delete.

### Skills

`Skills` migrates the existing skill scope UI from `AgentSettingsModal`.

Behavior to preserve:

- `default` vs `specified` skill scope
- search by name, slug, or description
- select up to 6 skills
- managed preset skills remain locked and non-removable
- save through existing `updateAgentSettings(agentId, { skillScope })`

The visual structure can be adjusted to fit the new dialog, but the capability and constraints should remain the same.

### Identity

`Identity` edits `IDENTITY.md`.

Behavior to preserve:

- load via `/api/agents/:id/persona`
- honor file lock state
- show create-on-save state when file does not yet exist
- save through the existing persona PUT endpoint

### Soul

`Soul` edits `SOUL.md`.

Behavior to preserve:

- keep soul template selection
- preserve template matching and custom mode behavior
- honor lock state
- save through the existing persona PUT endpoint

### Long-term Memory

`Long-term Memory` edits `MEMORY.md`.

Behavior to preserve:

- same loading and save flow as existing persona memory tab
- honor lock state

### Owner Profile

`Owner Profile` edits `USER.md`.

Behavior to preserve:

- same loading and save flow as existing persona master tab
- honor lock state

## Component Design

### New Top-Level Components

Create:

- `src/pages/Chat/AgentSettingsDialog.tsx`

Create a dedicated folder for section panels:

- `src/pages/Chat/agent-settings/AgentGeneralPanel.tsx`
- `src/pages/Chat/agent-settings/AgentSkillsPanel.tsx`
- `src/pages/Chat/agent-settings/AgentIdentityPanel.tsx`
- `src/pages/Chat/agent-settings/AgentSoulPanel.tsx`
- `src/pages/Chat/agent-settings/AgentMemoryPanel.tsx`
- `src/pages/Chat/agent-settings/AgentOwnerProfilePanel.tsx`

### Shared Persona Data Hook

Extract persona loading and saving logic from `PersonaDrawer` into a reusable hook:

- `src/pages/Chat/agent-settings/useAgentPersona.ts`

Responsibilities:

- fetch persona snapshot for an agent
- own drafts for the four files
- expose lock status
- expose save helpers
- expose soul template state and transitions
- expose reload and dirty-state information

This keeps the old persona API integration intact while removing the old persona-centric UI shell.

### Legacy Component Removal

Delete:

- `src/pages/Chat/PersonaDrawer.tsx`

Delete the standalone `Agents` page route and page component once the new dialog and sidebar create flow replace its remaining responsibilities.

## State and Save Strategy

### General

`General` saves name changes independently through `useAgentsStore.updateAgent()`.

### Skills

`Skills` saves independently through `useAgentsStore.updateAgentSettings()`.

### Persona-Derived Sections

`Identity`, `Soul`, `Long-term Memory`, and `Owner Profile` continue using the persona endpoint, but the UI should present them as separate sections rather than tabs inside a persona drawer.

The implementation may choose one of these save models:

- section-local save buttons
- a shared save bar that only applies to the active content section

Preferred approach:

- each markdown-derived section owns its own save action and dirty state messaging

Reason:

- it keeps failure scope small
- it matches the explicit section model
- it avoids implying that all sections are one monolithic persona object

## Sidebar Changes

Replace the current sidebar `Agents` navigation entry with a `+` action used to create a new agent.

Behavior:

- opens the existing add-agent dialog, or a direct successor with the same validation rules
- preserves current name/id validation
- on successful creation, the app should remain in a coherent chat context for the newly created agent

If the current sidebar pattern distinguishes navigation items from actions, the `+` entry should behave visually like an action rather than a route destination.

## Data Flow

- current agent identity continues to come from `useChatStore.currentAgentId`
- agent metadata continues to come from `useAgentsStore`
- skills catalog continues to come from `useSkillsStore`
- persona file data continues to come from `/api/agents/:id/persona`
- agent deletion continues to use `useAgentsStore.deleteAgent`
- agent creation continues to use `useAgentsStore.createAgent`

When settings change:

- rename updates the agents store snapshot
- skill scope updates the agents store snapshot and invalidates preset skill cache as today
- persona-derived sections refresh their local snapshot after save
- deleting the current agent must transition chat to a safe fallback agent instead of leaving chat bound to a missing agent

## Error Handling

- all sections should preserve existing toast-based success and error feedback
- locked markdown-backed sections should render read-only with explicit explanatory copy
- skill save should preserve current validation, including the zero-selected disallowance for `specified`
- delete must remain confirm-gated

## Testing

Add or update regression coverage for:

- `ChatToolbar` opening the new agent settings dialog
- dialog navigation between `General`, `Skills`, `Identity`, `Soul`, `Long-term Memory`, and `Owner Profile`
- rename flow from `General`
- skill scope editing and save from `Skills`
- `Soul` template switching and save
- file lock rendering for managed agents in markdown-backed sections
- deleting the current agent from `General`
- sidebar `+` action opening the create-agent flow
- absence of the old `Persona` button and old `Agents` page surface
- absence of `unmanage` UI

## Risks

- removing the `Agents` page changes discoverability, so the chat entry point and sidebar `+` affordance must be obvious
- deleting the current agent can break chat state if fallback session selection is not handled carefully
- extracting persona logic into shared panels can introduce regressions in soul template synchronization if the draft state is split incorrectly
- old tests may still target the `Agents` route, persona wording, or `unmanage` text and will need coordinated updates
