# Agent Marketplace Install Hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Temporarily disable installable agent marketplace actions for the test build while keeping marketplace browsing and preset inspection available.

**Architecture:** The renderer treats installable preset actions as temporarily paused. Existing installed and platform-unavailable states remain unchanged. Both the marketplace card and preset detail dialog use the same localized tooltip copy so there is no alternate install path in the UI.

**Tech Stack:** React 19, TypeScript, i18next, Radix Tooltip, Vitest, Testing Library

---

## File Structure

### Create

- `docs/superpowers/specs/2026-03-30-agent-marketplace-install-hold-design.md`
  Purpose: Record the temporary marketplace install hold for this test package.
- `docs/superpowers/plans/2026-03-30-agent-marketplace-install-hold.md`
  Purpose: Record the implementation steps for the temporary hold.

### Modify

- `tests/unit/agents-page-marketplace.test.tsx`
  Purpose: Lock the disabled install state and hover tooltip in the marketplace card and detail dialog.
- `src/pages/Agents/index.tsx`
  Purpose: Disable installable marketplace card actions and show the temporary tooltip.
- `src/pages/Agents/MarketplacePresetDetailDialog.tsx`
  Purpose: Disable installable detail-dialog actions and show the same tooltip.
- `src/i18n/locales/zh/agents.json`
  Purpose: Add the Chinese tooltip copy.
- `src/i18n/locales/en/agents.json`
  Purpose: Add the English tooltip copy.

## Task 1: Lock The Temporary Hold In Tests

**Files:**
- Modify: `tests/unit/agents-page-marketplace.test.tsx`

- [ ] **Step 1: Write the failing test**

Add assertions that the supported preset `Install` button is disabled and that hovering its trigger reveals `Not open yet`. Add the same expectation for the detail dialog footer action.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/agents-page-marketplace.test.tsx`

Expected: FAIL because the current supported preset `Install` action is still enabled and there is no tooltip.

## Task 2: Implement The Temporary Hold

**Files:**
- Modify: `src/pages/Agents/index.tsx`
- Modify: `src/pages/Agents/MarketplacePresetDetailDialog.tsx`
- Modify: `src/i18n/locales/zh/agents.json`
- Modify: `src/i18n/locales/en/agents.json`

- [ ] **Step 1: Add localized tooltip copy**

Add `marketplace.comingSoon` with `暂未开放` in Chinese and `Not open yet` in English.

- [ ] **Step 2: Disable installable card actions**

Only the card action that would normally show `Install` becomes temporarily disabled. Wrap its trigger so a tooltip can still open on hover.

- [ ] **Step 3: Disable installable detail actions**

Apply the same temporary disabled state and tooltip in the preset detail dialog footer.

- [ ] **Step 4: Re-run the marketplace test**

Run: `pnpm exec vitest run tests/unit/agents-page-marketplace.test.tsx`

Expected: PASS

## Task 3: Verify Scope

**Files:**
- Inspect: `README.md`
- Inspect: `README.zh-CN.md`

- [ ] **Step 1: Confirm README impact**

Verify whether the temporary hold changes documented behavior enough to require README updates. If the marketplace docs do not promise currently-installable presets for this test package, leave them unchanged.
