# Agent-Scoped Skill Management Design

## Goal

GeeClaw should manage skills from the agent's point of view instead of pretending there is one globally correct installed-skill view.

The key outcomes are:

- skill discovery should always respect the selected agent workspace
- `agents.list[].skills` should become the only product runtime control plane for skill membership
- the Skills page should become the main place to manage which skills belong to a specific agent
- agent workspace-local skills should be first-class and should not be forced through fake global semantics
- preset agent skills should remain locked to that agent

## Scope

This design covers:

- moving skill management to an agent-scoped model
- how the Installed Skills page should work with an explicit `agentId`
- how Agent Settings and Chat input should use agent-scoped skill discovery
- how GeeClaw should write `agents.list[].skills`
- migration from the current `default` / `specified` skill-scope model

This design does not cover:

- upstream OpenClaw changes
- global skill enable / disable as the main user workflow
- automatic skill learning or dynamic envelope expansion
- automatic integration skill attachment

## Current Context

### OpenClaw constraints that matter

OpenClaw already gives GeeClaw two important primitives:

- `agents.list[].skills` controls the runtime-visible skills for an agent
- `skills.status({ agentId })` reports discovered skills from that agent's workspace view

Important runtime distinction:

- `skills.status()` without `agentId` means the default agent workspace view
- `skills.status({ agentId })` means that specific agent workspace view

That distinction matters because skills stored inside an agent workspace are semantically only visible to that agent.

### The current product problem

GeeClaw currently mixes incompatible ideas:

- a global Skills page driven by `skills.status()` without `agentId`
- agent-level skill scope in `agents.list[].skills`
- agent-local workspace skills that only exist in a specific workspace view

This creates bad semantics:

- the Installed Skills page may show skills that are only visible to the default agent
- those skills look globally manageable when they are not
- Agent Settings and Chat input do not consistently use agent-scoped discovery

### Root cause

The root cause is:

- skill discovery view
- skill runtime membership

are both agent-scoped, but the product still presents Installed Skills as if they were global.

They should be modeled around the selected agent instead.

## Core Idea

GeeClaw should stop treating Installed Skills as a global activation surface.

Instead:

- the Installed Skills page should first select an agent
- all installed-skill queries should use `skills.status({ agentId })`
- all skill membership actions should directly manage that agent's `agents.list[].skills`

The mental model becomes:

- choose an agent
- inspect what that agent can see
- decide what that agent should load

This matches both OpenClaw semantics and workspace-local skill reality.

## Product Principles

### 1. Discovery must respect agent workspace

If a skill lives only in one agent workspace, only that agent should discover and manage it.

### 2. Runtime membership is per-agent

Skill membership should be materialized directly into each agent's `agents.list[].skills`.

### 3. No fake global activation model

Do not layer `global-on / on-demand / disabled` on top of agent-local discovery.

### 4. The Skills page should own skill membership management

Agent Settings can show summary information, but the primary membership UI should live on the Installed Skills page.

### 5. Preset ownership stays strong

Preset-required skills remain pinned to that preset agent and cannot be removed from that agent in the UI.

## Proposed Model

## 1. Installed Skills becomes agent-scoped

The Installed tab should no longer be interpreted as:

- "all installed skills in a global product view"

It should mean:

- "skills visible to the currently selected agent"

The selected agent becomes part of the page state.

Default:

- `main`

All installed-skill data on that page should come from:

- `skills.status({ agentId })`

not from:

- `skills.status()` without `agentId`

## 2. Skills page layout keeps the current 2-level structure

The page should keep the current top-level structure:

- first level: `已安装 | 市场`

Within `已安装`, the second-level controls should stay on one row:

- left: agent selector
- right: the existing installed-skill filters

Current installed-skill filters should remain the product surface:

- `全部`
- `已启用`
- `内置`
- `Extra`
- `Managed`
- `全局`

Important note:

- these are existing filter categories and should be reused
- this redesign should not invent a new second-row taxonomy

The meaning of those filters should now be:

- counts and results within the selected agent's discovered skill view

not a fake global view.

## 3. Skill membership is edited directly per agent

For the selected agent, GeeClaw should manage skill membership directly.

That means:

- adding a skill adds it to that agent's `agents.list[].skills`
- removing a skill removes it from that agent's `agents.list[].skills`

This replaces the earlier plan of:

- global enable
- global disable
- on-demand
- inherit global skills

Those concepts are removed from the main design.

## 4. Preset-required skills remain locked

Preset agent skills are still special:

- they belong to that preset agent
- they are always included in that agent's runtime skill list
- the user cannot remove them from that agent in the Skills UI

If a preset skill is shown in the Installed page for that preset agent, it should appear:

- enabled
- locked

## 5. No shared global membership layer

There is no product-level shared skill set in this design.

If the user wants `pdf` on five agents, they add `pdf` to five agents.

This is a deliberate tradeoff:

- less batch convenience
- much clearer semantics

That tradeoff is acceptable because it matches real agent visibility and avoids global-state confusion.

## Runtime Materialization

## 1. `agents.list[].skills` is the only membership source of truth

GeeClaw should treat `agents.list[].skills` as the only product runtime artifact for skill membership.

Recommended baseline:

```json5
{
  agents: {
    defaults: {
      skills: []
    },
    list: [
      {
        id: "main",
        skills: ["pdf", "weather"]
      },
      {
        id: "researcher",
        skills: ["pdf", "xlsx", "longbridge"]
      }
    ]
  }
}
```

Key rule:

- every product-visible agent should get an explicit `skills` list

That includes:

- `main`
- custom agents
- preset agents

## 2. Runtime compilation rule

For a normal agent:

`agent.skills = manualSelectedSkills + presetRequiredSkills`

Where:

- `manualSelectedSkills` are the skills the user enabled for that agent
- `presetRequiredSkills` are locked for preset agents

The final written list should be:

- deduplicated
- stable-sorted
- explicit in `agents.list[].skills`

Recommended stable order:

1. preset-required skills
2. manually selected skills
3. alphabetical inside each bucket

## 3. `skills.entries.enabled` is no longer the main control surface

This redesign removes global enable / disable from the main workflow.

That means:

- Installed Skills membership should not be modeled through `skills.entries.<id>.enabled`
- the normal add / remove workflow should only touch `agents.list[].skills`

If `enabled = false` continues to exist in the codebase, it should be treated as:

- a low-level block / quarantine mechanism
- not the primary user mental model

## 4. Effective skill count warning

The product should not hard-cap per-agent skills in the first version of this redesign.

Instead:

- show a strong warning when the selected agent's effective enabled skill count exceeds 20

The warning intent is:

- too many loaded skills can significantly degrade model focus and output quality

This warning should be computed from the selected agent's effective runtime skill list.

## UX Design

## 1. Installed Skills is the main management surface

The Installed tab should become the primary place to manage skills for an agent.

The user flow is:

1. open Skills
2. stay on `已安装`
3. choose an agent from the left-side selector
4. use the right-side filter row to inspect that agent's visible skills
5. add or remove skills for that agent

This is now the main membership-management flow.

## 2. Agent Settings no longer needs full skill management UI

Agent Settings should stop duplicating the full skill-management surface.

Recommended role after the redesign:

- show a summary of enabled skills
- show preset-required locked skills
- link or route the user to Skills page for full management

This avoids maintaining two competing skill-management UIs.

## 3. Chat input should use the same agent-scoped candidate source

The chat composer is also an agent-scoped runtime surface.

So:

- slash picker
- toolbar skill picker
- recommendation logic

should all use the current chat agent's:

- `skills.status({ agentId })`

The same selected-agent logic should be used consistently across:

- Skills page
- Agent-specific pickers
- Chat composer

## Data Model Changes in GeeClaw

Suggested local product state:

```ts
type AgentSkillSelectionState = {
  manualSkills: string[];
};
```

Derived inputs:

- preset-required skills from preset metadata
- discovered skill candidates from `skills.status({ agentId })`

Important distinction:

- candidate discovery comes from `skills.status({ agentId })`
- runtime membership comes from `agents.list[].skills`

The page should not confuse those two concepts.

## Migration Plan

## Phase 1. Move the product model to explicit per-agent skill lists

Changes:

- stop designing around a global skill policy model
- make `agents.list[].skills` the primary membership state
- treat Installed Skills as agent-scoped

## Phase 2. Migrate existing `skillScope`

Migration rules:

- old `specified` -> keep its skill list as the agent's manual selected skills
- old `default` -> materialize the agent's current effective runtime-visible skills into that agent's manual selected skills

The reason for the `default` migration is:

- migrating `default` to an empty list would silently strip many existing agents

So the migration should prefer preserving current behavior over purity.

## Phase 3. Rebuild the Installed Skills page around `agentId`

Changes:

- add the agent selector to the Installed tab
- default it to `main`
- fetch installed skills with explicit `agentId`
- keep the current filter row structure and existing filter categories

## Phase 4. Reduce Agent Settings to a summary role

Changes:

- remove or greatly shrink the full Agent skill picker
- keep summary and preset-lock visibility
- route users to Skills page for full management

## Phase 5. Align Chat input with the same data model

Changes:

- fetch chat skill candidates using explicit `agentId`
- stop relying on the default global skill store snapshot for slash picker and recommendations

## Implementation Map

### 1. Installed Skills page

Primary files:

- [src/pages/Skills/index.tsx](/Users/lsave/workspace/AI/ClawX/src/pages/Skills/index.tsx)
- [src/stores/skills.ts](/Users/lsave/workspace/AI/ClawX/src/stores/skills.ts)

Target behavior:

- add selected-agent state for the Installed tab
- default to `main`
- fetch installed skills with explicit `agentId`
- keep the existing installed filter row and labels
- make counts reflect the selected agent's view

### 2. Agent runtime materialization

Primary files:

- [electron/utils/agent-config.ts](/Users/lsave/workspace/AI/ClawX/electron/utils/agent-config.ts)
- [electron/gateway/config-sync.ts](/Users/lsave/workspace/AI/ClawX/electron/gateway/config-sync.ts)

Target behavior:

- materialize explicit per-agent `skills`
- set `agents.defaults.skills = []`
- merge preset-required locked skills into each affected agent

Recommended new module:

- `electron/services/agents/agent-skill-membership-sync.ts`

### 3. Agent Settings

Primary files:

- [src/pages/Chat/agent-settings/AgentSkillsPanel.tsx](/Users/lsave/workspace/AI/ClawX/src/pages/Chat/agent-settings/AgentSkillsPanel.tsx)
- [src/stores/agents.ts](/Users/lsave/workspace/AI/ClawX/src/stores/agents.ts)
- [src/types/agent.ts](/Users/lsave/workspace/AI/ClawX/src/types/agent.ts)

Target behavior:

- stop being the primary skill picker
- show enabled-skill summary
- show preset-required locked skills
- link to the Installed Skills page for editing

### 4. Chat composer and slash picker

Primary files:

- [src/pages/Chat/ChatInput.tsx](/Users/lsave/workspace/AI/ClawX/src/pages/Chat/ChatInput.tsx)
- [src/pages/Chat/slash-picker.ts](/Users/lsave/workspace/AI/ClawX/src/pages/Chat/slash-picker.ts)

Target behavior:

- fetch visible skills with explicit `agentId`
- use that list for slash picker, toolbar picker, and recommendations

### 5. Preset metadata handling

Primary files:

- [electron/utils/agent-presets.ts](/Users/lsave/workspace/AI/ClawX/electron/utils/agent-presets.ts)
- [electron/utils/agent-config.ts](/Users/lsave/workspace/AI/ClawX/electron/utils/agent-config.ts)

Target behavior:

- preserve preset-required skill pins
- expose them as locked in UI

## Why this design is better than the current one

The old model asks:

- "what are the installed skills?"

The new model asks:

- "what can this agent see?"
- "which of those should this agent load?"

That is the correct product question.

It is better because it:

- respects workspace-local skill semantics
- removes fake global activation concepts
- makes Installed Skills and runtime behavior line up
- removes duplicated management surfaces
- keeps preset ownership intact

## Risks and Open Questions

1. Migrating old `default` agents requires a careful "preserve current behavior" strategy, or users will perceive massive breakage.
2. Some existing Skills page logic assumes a single global `skills` store; that logic will need to split into agent-scoped Installed data and Marketplace data.
3. Existing sessions may keep stale skill snapshots after `agents.list[].skills` changes, so session refresh behavior still needs to be defined.
4. The current Installed filter categories include existing source semantics that should be preserved even though the underlying discovery view becomes agent-scoped.

## Self-Consistency Checks

1. Installed Skills is always viewed through an explicit selected agent, defaulting to `main`.
2. Installed skill counts and filters are calculated from that selected agent's discovered skill view.
3. Adding or removing a skill edits that selected agent's `agents.list[].skills`.
4. Preset-required skills stay locked to their preset agent.
5. Chat input and slash picker use the current agent's discovery view, not the default agent's discovery view.
6. Every product-visible agent ends up with an explicit `agents.list[].skills`.

## Recommended First Implementation Slice

If only one slice is implemented first, it should be this:

1. add agent selection to Installed Skills
2. fetch installed skills with `skills.status({ agentId })`
3. wire add / remove to per-agent `agents.list[].skills`
4. migrate old `skillScope` to explicit per-agent skill lists
5. switch Chat input to the same agent-scoped skill discovery path

That slice already changes the product from:

- "global installed skills with ambiguous semantics"

to:

- "agent-scoped discovery plus explicit agent runtime membership"
