# Preset Agent Emoji Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate preset agent metadata from unused `iconKey` and redundant `workspace` fields to a simpler `emoji` + `agent.id` shape, and render the emoji in the Agents marketplace UI.

**Architecture:** Preset package validation becomes the source of truth for the new `emoji` field and stops accepting `agent.workspace`. The backend summary/API and renderer types drop preset workspace entirely. The marketplace card and detail dialog render the preset emoji while install/default workspace behavior continues to come from managed-agent path helpers.

**Tech Stack:** Electron, React 19, TypeScript, Vitest, Testing Library

---

## File Structure

### Create

- `docs/superpowers/plans/2026-03-30-preset-agent-emoji-metadata.md`
  Purpose: Record the implementation steps for the preset metadata migration.

### Modify

- `tests/unit/agent-presets.test.ts`
  Purpose: Lock the new preset schema (`emoji`, no `agent.workspace`) and bundled fixture expectations.
- `tests/unit/agent-config-managed.test.ts`
  Purpose: Lock preset summary/install behavior after the schema change.
- `tests/unit/agents-page-marketplace.test.tsx`
  Purpose: Lock emoji rendering in marketplace UI and removal of workspace from detail content.
- `electron/utils/agent-presets.ts`
  Purpose: Validate and normalize the migrated preset metadata.
- `electron/utils/agent-config.ts`
  Purpose: Remove preset summary workspace/iconKey fields and surface `emoji`.
- `src/types/agent.ts`
  Purpose: Align renderer-facing preset types with backend payload changes.
- `src/pages/Agents/index.tsx`
  Purpose: Render preset emoji in marketplace cards without disturbing existing user edits.
- `src/pages/Agents/MarketplacePresetDetailDialog.tsx`
  Purpose: Render preset emoji in the dialog header and remove workspace from the summary.
- `resources/agent-presets/*/meta.json`
  Purpose: Replace `iconKey` with `emoji` and drop `agent.workspace`.

## Task 1: Write Failing Schema Tests

**Files:**
- Modify: `tests/unit/agent-presets.test.ts`
- Modify: `tests/unit/agent-config-managed.test.ts`

- [ ] **Step 1: Write the failing tests**

Add assertions that bundled/custom preset metadata exposes `emoji`, no longer exposes `agent.workspace`, and no longer requires `agent.workspace` during validation.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/agent-presets.test.ts tests/unit/agent-config-managed.test.ts`

Expected: FAIL because the current schema still requires `iconKey` and `agent.workspace`.

## Task 2: Write Failing UI Test

**Files:**
- Modify: `tests/unit/agents-page-marketplace.test.tsx`

- [ ] **Step 1: Write the failing test**

Add assertions that marketplace cards/detail headers render the preset emoji and the detail dialog no longer shows a `Workspace` field/value.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/agents-page-marketplace.test.tsx`

Expected: FAIL because the current UI neither renders emoji nor removes workspace from preset details.

## Task 3: Implement The Metadata Migration

**Files:**
- Modify: `electron/utils/agent-presets.ts`
- Modify: `electron/utils/agent-config.ts`
- Modify: `src/types/agent.ts`
- Modify: `resources/agent-presets/*/meta.json`

- [ ] **Step 1: Replace `iconKey` with `emoji` in preset validation/types**

Require a non-empty `emoji` string, remove `agent.workspace` from recognized keys and normalized meta, and keep install-time workspace derivation unchanged.

- [ ] **Step 2: Update preset summaries**

Expose `emoji` instead of `iconKey` and remove preset `workspace` from the renderer payload.

- [ ] **Step 3: Migrate bundled preset metadata**

Update every bundled preset `meta.json` to the new shape.

## Task 4: Implement The UI Rendering

**Files:**
- Modify: `src/pages/Agents/index.tsx`
- Modify: `src/pages/Agents/MarketplacePresetDetailDialog.tsx`

- [ ] **Step 1: Render emoji in marketplace cards**

Add a lightweight emoji badge/label ahead of the preset title while preserving the existing layout edits in the worktree.

- [ ] **Step 2: Render emoji in detail header and remove workspace summary**

Show the emoji alongside the preset title and keep the summary focused on agent ID only.

## Task 5: Verify And Check Docs Scope

**Files:**
- Inspect: `README.md`
- Inspect: `README.zh-CN.md`

- [ ] **Step 1: Run targeted verification**

Run: `pnpm exec vitest run tests/unit/agent-presets.test.ts tests/unit/agent-config-managed.test.ts tests/unit/agents-page-marketplace.test.tsx`

Expected: PASS

- [ ] **Step 2: Confirm README impact**

Check whether preset metadata format or marketplace emoji display is documented in either README. Update only if those docs currently describe the old fields or detail layout.
