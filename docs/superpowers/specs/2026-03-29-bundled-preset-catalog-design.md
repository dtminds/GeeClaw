# Bundled Premium Preset Catalog Design

**Date:** 2026-03-29

## Goal

Build a bundled preset marketplace that feels curated, opinionated, and genuinely useful for advanced users. The catalog should stay above 10 presets, but it should no longer optimize for raw quantity. It should optimize for distinct roles and higher-order skill leverage.

## Product Direction

The recommended approach is to ship a compact premium lineup under `resources/agent-presets/`, with each preset represented as its own directory package:

- `meta.json` defines install identity, category, icon, managed policy, and per-agent skill allowlist.
- `files/AGENTS.md`, `IDENTITY.md`, `USER.md`, `SOUL.md`, and `MEMORY.md` define locked persona guidance and working style.

The key change is curation philosophy:

- Fewer presets
- Stronger role separation
- Higher-value skill combinations
- Less overlap between presets

## Catalog Strategy

### Scope

Ship a curated catalog with roughly 12 to 14 presets.

The catalog must still cover the user's requested business surface:

- Content creation
- Data analysis
- Market research
- Product R&D
- Activity / campaign planning

But the catalog should prioritize differentiated roles such as:

- Engineering execution with superpower-style workflow skills
- Product strategy and opportunity validation
- UX / design direction
- Automation and orchestration
- Market intelligence
- Growth campaign execution
- Incident response
- Knowledge synthesis
- Delivery coordination
- Customer insight extraction
- Finance / investment tracking

### Skill Selection

Skill allowlists should prefer:

1. High-order skills already visible in the current GeeClaw environment, especially superpowers-style workflow skills
2. Reliable marketplace skills with strong leverage, such as research, automation, design, incident, orchestration, and document-processing capabilities
3. Channel or document skills only when they materially sharpen the preset's role

Each preset should stay within the existing `specified` skill scope limit of 6 skills.

Avoid repeating the same generic bundle across multiple presets. A preset only deserves to exist if its workflow is meaningfully distinct.

For flagship presets, prefer recognizable methodology bundles over generic utility bundles. In practice this means absorbing suites such as gstack into role-specific presets:

- Engineering execution: plan, implement, review, QA, ship
- Product strategy: office-hours style discovery plus cross-functional plan review
- Design leadership: design consultation, design review, benchmark, browse
- Incident response: investigate, freeze/guard, verify, canary
- Delivery coordination: ship, release notes, deploy, retro

### Persona Quality Bar

Every bundled preset should include the full persona pack:

- `AGENTS.md`: top-level operating rules and tool priorities
- `IDENTITY.md`: role definition
- `USER.md`: preferred collaboration pattern
- `SOUL.md`: tone and style
- `MEMORY.md`: long-term non-negotiables

Persona copy should be short, concrete, and role-specific. Avoid generic “万能助手” phrasing.

### Managed Policy

Use a consistent managed policy unless a preset needs something special:

- `managed: true`
- `managedPolicy.lockedFields: ["id", "workspace", "persona"]`
- `managedPolicy.canUnmanage: true`

### Platform Policy

Only add `platforms` when a preset genuinely depends on a platform-specific capability. Most premium presets should remain cross-platform.

## Information Architecture

Category breadth matters less than role clarity, but the catalog should still remain easy to scan. A practical premium set includes:

- `engineering`
- `design`
- `product`
- `research`
- `analytics`
- `marketing`
- `operations`
- `finance`
- `support`
- `productivity`

## Testing Strategy

Add a bundled-catalog regression check that asserts:

- The bundled preset count matches the curated lineup exactly
- Every bundled preset ships the full 5-file persona pack
- Premium flagship presets such as the engineering and automation presets retain their intended high-order skill stacks
- Existing flagship presets such as `stock-expert` still load as expected

This protects the catalog from regressing into either a sparse demo state or a bloated set of overlapping presets.

## Assumptions

- Preset skill slugs may include locally visible high-order skills that the product team chooses to preinstall later.
- Category and icon keys are currently descriptive metadata and do not need strict enum validation yet.
- Chinese-first preset naming is preferred for the built-in catalog because GeeClaw's existing preset and target workflow examples already follow that direction.
