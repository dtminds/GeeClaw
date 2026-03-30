# Bundled Premium Preset Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broad preset batch with a curated premium catalog of more than 10 distinct marketplace agents and regression tests that lock in the exact lineup.

**Architecture:** Each preset remains a directory-backed package under `resources/agent-presets/<presetId>/`, using `meta.json` plus bundled persona files. No runtime schema changes are needed; the work is mainly catalog curation, persona authoring, and preset-loader regression coverage.

**Tech Stack:** Markdown persona files, JSON preset metadata, Electron preset loader, Vitest

---

## File Structure

### Create

- `docs/superpowers/specs/2026-03-29-bundled-preset-catalog-design.md`
  Purpose: Document the premium catalog strategy, differentiation rules, and quality bar.
- `docs/superpowers/plans/2026-03-29-bundled-preset-catalog-expansion.md`
  Purpose: Document the implementation plan for the premium catalog.
- `resources/agent-presets/<presetId>/meta.json`
  Purpose: Define each premium preset's metadata and skill allowlist.
- `resources/agent-presets/<presetId>/files/AGENTS.md`
- `resources/agent-presets/<presetId>/files/IDENTITY.md`
- `resources/agent-presets/<presetId>/files/USER.md`
- `resources/agent-presets/<presetId>/files/SOUL.md`
- `resources/agent-presets/<presetId>/files/MEMORY.md`
  Purpose: Provide the full persona pack for each premium preset.

### Modify

- `tests/unit/agent-presets.test.ts`
  Purpose: Lock the exact bundled lineup, persona completeness, and flagship skill stacks.
- `README.md`
  Purpose: Document the premium catalog direction.
- `README.zh-CN.md`
  Purpose: Mirror the same catalog direction in Chinese.

## Task 1: Define The Premium Catalog

**Files:**
- Create: `docs/superpowers/specs/2026-03-29-bundled-preset-catalog-design.md`
- Create: `docs/superpowers/plans/2026-03-29-bundled-preset-catalog-expansion.md`

- [ ] Write the premium catalog design spec with differentiation rules, role boundaries, and flagship skill-stack principles.
- [ ] Write the implementation plan with curation, bundle structure, and regression strategy.

## Task 2: Curate The Premium Preset Packages

**Files:**
- Create or modify: `resources/agent-presets/<presetId>/meta.json`
- Create or modify: `resources/agent-presets/<presetId>/files/*.md`

- [ ] Remove overlapping or low-signal preset packages from the broad expansion.
- [ ] Keep a premium lineup of roughly 12 to 14 presets including the existing flagship `stock-expert`.
- [ ] Make each preset role-distinct, with no redundant generic skill bundles.
- [ ] Use higher-order skill stacks where appropriate, especially for engineering, strategy, automation, and incident workflows.
- [ ] Keep each preset within 6 curated skills.
- [ ] Give every preset a full 5-file persona pack.
- [ ] Keep managed policy consistent with existing managed presets.

## Task 3: Lock The Catalog With Tests

**Files:**
- Modify: `tests/unit/agent-presets.test.ts`

- [ ] Add a bundled-catalog regression test that asserts the exact curated preset id set.
- [ ] Add a bundled-catalog regression test that asserts every bundled preset ships `AGENTS.md`, `IDENTITY.md`, `USER.md`, `SOUL.md`, and `MEMORY.md`.
- [ ] Add assertions for flagship premium presets such as engineering and automation skill stacks.
- [ ] Preserve the existing `stock-expert` bundle assertions.

## Task 4: Verify

**Files:**
- Test: `tests/unit/agent-presets.test.ts`

- [ ] Run `pnpm exec vitest run tests/unit/agent-presets.test.ts`
- [ ] Run `pnpm exec tsc --noEmit --pretty false`
- [ ] Run `pnpm run lint:check`
- [ ] Report the final bundled preset count, flagship presets, and the main categories covered.
