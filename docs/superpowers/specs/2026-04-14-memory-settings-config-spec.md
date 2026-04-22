# Memory Settings Config Spec

## Summary

This spec defines a small, user-facing memory settings page for another project.
Its only job is to manage a fixed subset of `openclaw.json` settings in a
beginner-friendly way.

The UI exposes three feature cards:

1. Dreaming
2. Active Memory
3. Lossless Claw

The page is intentionally shallow. It does not install plugins, debug provider
auth, or expose advanced memory tuning. It only:

- reads current state
- shows whether each feature is enabled, disabled, unavailable, or not installed
- lets the user change the supported settings
- writes the result back to `openclaw.json`

## Goals

- Provide one simple "Memory" settings page for non-technical users.
- Keep the UI language task-oriented instead of architecture-oriented.
- Map every editable field to a real `openclaw.json` key.
- Avoid inventing synthetic config fields that OpenClaw does not support.
- Keep plugin installation and environment setup out of V1.

## Non-Goals

- Plugin installation UI
- Advanced Dreaming controls such as sweep frequency or phase thresholds
- Advanced Active Memory tuning such as query mode or prompt style
- Advanced Lossless Claw tuning beyond summary model selection

## User Model

Target user: beginner or casual operator.

The page should answer these questions without requiring internal OpenClaw
knowledge:

- Is this feature on?
- If it is off, can I turn it on?
- If I cannot turn it on, why not?
- If the feature supports a dedicated model, what model is it using?

The page should avoid default exposure of terms like:

- embedding provider
- context engine
- plugin slot
- backend
- compaction

## Information Architecture

Single page with three cards in this order:

1. Dreaming
2. Active Memory
3. Lossless Claw

Each card contains:

- title
- one-sentence description
- status badge
- primary toggle
- optional advanced section
- unavailable reason or install hint
- docs link

## Feature Definitions

### 1. Dreaming

#### User-facing meaning

"Background memory cleanup and consolidation."

#### User-facing copy

- Title: `Dreaming`
- Description: `Organizes recent memory in the background and helps keep more important information.`

#### Statuses

- `Enabled`
- `Disabled`
- `Unavailable`

#### Config mapping

- `plugins.entries["memory-core"].config.dreaming.enabled`

This is a bundled OpenClaw memory-core setting.

#### Toggle behavior

- Turn on:
  - ensure object path exists
  - write `true`
- Turn off:
  - ensure object path exists
  - write `false`

#### V1 constraints

- Do not expose `dreaming.frequency`
- Do not expose phase-level settings
- Do not expose promotion thresholds

### 2. Active Memory

#### User-facing meaning

"Look up relevant memory before replying."

#### User-facing copy

- Title: `Active Memory`
- Description: `Searches relevant memory before generating a reply.`

#### Statuses

- `Enabled`
- `Disabled`
- `Unavailable`

#### Config mapping

Primary config lives under:

- `plugins.entries["active-memory"].enabled`
- `plugins.entries["active-memory"].config.enabled`
- `plugins.entries["active-memory"].config.agents`
- `plugins.entries["active-memory"].config.model`

Important note:

- `active-memory` is treated as a bundled OpenClaw capability in GeeClaw V1.
- GeeClaw does not perform installation probing for this card.

#### Toggle behavior

Global user-facing toggle should control feature behavior, not plugin
installation state.

- Turn on:
  - ensure `plugins.entries["active-memory"].enabled = true`
  - ensure `plugins.entries["active-memory"].config.enabled = true`
  - ensure `plugins.entries["active-memory"].config.agents = ["main"]` in single-agent mode
- Turn off:
  - keep `plugins.entries["active-memory"].enabled = true`
  - write `plugins.entries["active-memory"].config.enabled = false`

Rationale:

- keeping plugin `enabled` true preserves command availability and avoids
  conflating "installed" with "currently active"
- the official global session toggle semantics write
  `plugins.entries.active-memory.config.enabled`

#### Dedicated model selector

This card supports a dedicated model ref.

- Automatic:
  - unset `plugins.entries["active-memory"].config.model`
- Custom:
  - set `plugins.entries["active-memory"].config.model = "<provider/model>"`

Accepted value shape:

- full model ref string such as `openai/gpt-5.4-mini`
- do not normalize into provider + model subfields

#### V1 constraints

- Do not expose `queryMode`
- Do not expose `promptStyle`
- Do not expose `timeoutMs`
- Do not expose `maxSummaryChars`
- Do not expose `allowedChatTypes`
- Do not expose transcript persistence

### 3. Lossless Claw

#### User-facing meaning

"Preserve more conversation context in long chats."

#### User-facing copy

- Title: `Lossless Claw`
- Description: `Keeps more context available in long-running conversations.`

#### Statuses

- `Enabled`
- `Disabled`
- `Not Installed`
- `Unavailable`

#### Config mapping

This card manages the `lossless-claw` context engine plugin.

Primary keys:

- `plugins.slots.contextEngine`
- `plugins.entries["lossless-claw"].enabled`
- `plugins.entries["lossless-claw"].config.summaryModel`

Installation/version probe:

- check `~/.openclaw/extensions/lossless-claw/`
- read `~/.openclaw/extensions/lossless-claw/package.json`
- compare `package.json.version` against GeeClaw's pinned `lossless-claw` version

#### Toggle behavior

- Turn on:
  - ensure `plugins.entries["lossless-claw"].enabled = true`
  - write `plugins.slots.contextEngine = "lossless-claw"`
- Turn off:
  - write `plugins.slots.contextEngine = "legacy"`

If plugin is missing or version-mismatched:

- delete `plugins.slots.contextEngine`
- write `plugins.entries["lossless-claw"].enabled = false`
- preserve sibling `plugins.entries["lossless-claw"].config.*` values

Do not delete the `lossless-claw` entry when switching off.

#### Dedicated summary model selector

This card supports a dedicated summary model.

- Automatic:
  - unset `plugins.entries["lossless-claw"].config.summaryModel`
- Custom:
  - set `plugins.entries["lossless-claw"].config.summaryModel = "<provider/model>"`

Accepted value shape:

- full model ref string such as `openai/gpt-5.4-mini`

#### V1 constraints

- Do not expose `expansionModel`
- Do not expose provider override fields
- Do not expose database or DAG tuning
- Do not expose large-file settings

## Read Model

The host app should compute card state from two inputs:

1. parsed `openclaw.json`
2. local plugin install/version probe results

### Dreaming state

- Enabled:
  - `plugins.entries["memory-core"].config.dreaming.enabled === true`
- Disabled:
  - otherwise
- Unavailable:
  - memory-core missing or write path blocked

### Active Memory state

- Enabled:
  - `plugins.entries["active-memory"].config.enabled === true`
- Disabled:
  - otherwise
- Unavailable:
  - config cannot be parsed or required write path is blocked

### Lossless Claw state

- Not Installed:
  - `~/.openclaw/extensions/lossless-claw/package.json` cannot be found
- Enabled:
  - plugin version matches GeeClaw pin and `plugins.slots.contextEngine === "lossless-claw"`
- Disabled:
  - plugin version matches GeeClaw pin and slot is not `lossless-claw`
- Unavailable:
  - plugin directory exists but installed version does not match GeeClaw pin

## Write Model

All writes should be:

- scoped to the current card
- immediate
- minimal
- non-destructive toward unrelated config

Rules:

- create missing object layers as needed
- do not erase sibling config
- prefer restoring stable defaults instead of deleting entire blocks

Examples:

- turning Dreaming off writes `dreaming.enabled = false`
- turning Lossless Claw off writes `plugins.slots.contextEngine = "legacy"`
- if `lossless-claw` is missing or version-mismatched, disable by deleting `plugins.slots.contextEngine` and forcing `plugins.entries["lossless-claw"].enabled = false`

## Single-Agent Assumption

V1 assumes a single default agent.

When enabling Active Memory, write:

- `plugins.entries["active-memory"].config.agents = ["main"]`

If the host product later supports agent selection, this field should instead
reflect the selected agent ids.

## Validation Rules

### General

- unrelated keys must remain untouched
- model selectors accept full `provider/model` refs only

### Dreaming

- boolean only

### Active Memory

- if model is set, it must be a non-empty string
- if enabled, ensure `config.agents` contains at least one agent id

### Lossless Claw

- if enabled, require plugin installed
- if enabled, require installed version to match GeeClaw pin
- if summary model is set, it must be a non-empty string

## Runtime Dependency Policy

The page itself does not install or repair dependencies.

### Lossless Claw

If `lossless-claw` is missing:

- show `Not Installed`
- disable the toggle
- allow docs link

If `lossless-claw` version does not match GeeClaw pin:

- show `Unavailable`
- disable the toggle
- allow docs link

### Active Memory

If `active-memory` is missing:

- show `Not Installed`
- disable the toggle
- allow docs link

## Suggested User Copy

### Dreaming

- Enabled: `Background memory organization is on.`
- Disabled: `Background memory organization is off.`
- Unavailable: `This feature is not available right now.`

### Active Memory

- Enabled: `Relevant memory is checked before replies.`
- Disabled: `Replies are generated without active memory lookup.`
- Unavailable: `This feature cannot be configured right now.`

### Lossless Claw

- Enabled: `Long conversations keep more context available.`
- Disabled: `Standard context management is being used.`
- Not Installed: `This plugin is not installed.`
- Unavailable: `Installed plugin version does not match GeeClaw requirements.`

## Acceptance Criteria

1. The page shows exactly three cards: Dreaming, Active Memory, Lossless Claw.
2. Each card can render a stable status from config plus local install/version probe data.
3. Dreaming toggle reads and writes `plugins.entries["memory-core"].config.dreaming.enabled`.
4. Active Memory toggle reads and writes `plugins.entries["active-memory"].config.enabled`.
5. Active Memory model selector reads and writes `plugins.entries["active-memory"].config.model`.
6. Lossless Claw toggle switches `plugins.slots.contextEngine` between `legacy` and `lossless-claw`.
7. Lossless Claw summary model selector reads and writes `plugins.entries["lossless-claw"].config.summaryModel`.
8. If `lossless-claw` is missing or version-mismatched, GeeClaw disables stale runtime activation by deleting `plugins.slots.contextEngine` and setting `plugins.entries["lossless-claw"].enabled = false`.
9. Unrelated config values survive every save operation unchanged.

## Risks

- `active-memory` is bundled, but its config contract is still sourced from official docs rather than a GeeClaw-owned implementation.
- `lossless-claw` config is plugin-owned, not part of OpenClaw core schema.
- `lossless-claw` pin drift must stay aligned with GeeClaw's chosen plugin version.
- If the host app supports multiple agents later, Active Memory agent targeting
  must be expanded beyond the hard-coded `["main"]` assumption.

## Source References

- Active Memory docs:
  - https://docs.openclaw.ai/concepts/active-memory
- Context engine docs:
  - https://docs.openclaw.ai/concepts/context-engine
- Memory config reference:
  - https://docs.openclaw.ai/reference/memory-config
- Local repo references:
  - `docs/reference/memory-config.md:367`
  - `docs/reference/memory-config.md:467`
  - `docs/concepts/context-engine.md:29`
  - `src/config/schema.help.ts:1031`
  - `src/config/schema.help.ts:1033`
