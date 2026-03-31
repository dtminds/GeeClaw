# Plaza Dashboard Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move preset agent marketplace into the dashboard plaza, make it the default plaza tab, and align preset cards/detail dialog with inspiration plaza styling.

**Architecture:** Extract preset marketplace UI into dashboard-scoped presentation components that reuse the existing agents store for catalog and install state. Keep agent management focused on CRUD/settings while the plaza page owns inspiration and preset browsing through a shared tabbed shell and matching visual language.

**Tech Stack:** React 19, TypeScript, Zustand, react-i18next, Vitest, Testing Library

---

### Task 1: Define plaza-facing presentation boundaries

**Files:**
- Modify: `src/pages/Dashboard/index.tsx`
- Create: `src/components/dashboard/PresetAgentsPlazaSection.tsx`
- Modify: `src/components/dashboard/index.ts`

- [ ] **Step 1: Add dashboard tests that describe the new plaza shell**

Write tests that expect:

- the top running status section still renders
- the plaza tabs render
- the preset agent tab is selected by default
- switching to inspiration tab reveals inspiration content

- [ ] **Step 2: Run the targeted dashboard tests and verify they fail**

Run: `pnpm exec vitest run tests/unit/dashboard-plaza.test.tsx`
Expected: FAIL because the dashboard page does not yet render the new tab shell.

- [ ] **Step 3: Implement the dashboard tab shell with preset tab default**

Update the dashboard page to render `DashboardSettingsSection` above a two-tab plaza switcher and mount the preset and inspiration sections under it.

- [ ] **Step 4: Re-run the dashboard tests**

Run: `pnpm exec vitest run tests/unit/dashboard-plaza.test.tsx`
Expected: PASS

### Task 2: Move preset marketplace into plaza presentation

**Files:**
- Create: `src/components/dashboard/PresetAgentsPlazaSection.tsx`
- Modify: `src/pages/Agents/MarketplacePresetDetailDialog.tsx`
- Modify: `src/pages/Agents/preset-platforms.ts` (only if label helpers need reuse)

- [ ] **Step 1: Add failing preset plaza tests**

Write tests that expect:

- preset cards render in the plaza
- category chips filter the preset grid
- clicking a preset opens a detail dialog
- install CTA/progress still reflect store state

- [ ] **Step 2: Run the targeted preset plaza tests and verify they fail**

Run: `pnpm exec vitest run tests/unit/dashboard-plaza.test.tsx`
Expected: FAIL because preset plaza UI does not exist yet.

- [ ] **Step 3: Implement `PresetAgentsPlazaSection`**

Use existing agents store data and install actions, but render cards and filters with the inspiration plaza visual pattern.

- [ ] **Step 4: Rework preset detail dialog styling**

Align the preset detail dialog with the inspiration modal shell while preserving platform badges, skill list, agent id summary, install button, and progress bar.

- [ ] **Step 5: Re-run the targeted tests**

Run: `pnpm exec vitest run tests/unit/dashboard-plaza.test.tsx`
Expected: PASS

### Task 3: Simplify the agents page

**Files:**
- Modify: `src/pages/Agents/index.tsx`
- Modify: `tests/unit/agents-page-marketplace.test.tsx`
- Modify: `tests/unit/agent-settings-modal.test.tsx` (translation fixtures only if needed)

- [ ] **Step 1: Add or update a failing agents page test**

Expect the agents page to:

- render management content
- not render the marketplace tab
- not render preset marketplace cards

- [ ] **Step 2: Run the agents page test and verify it fails**

Run: `pnpm exec vitest run tests/unit/agents-page-marketplace.test.tsx`
Expected: FAIL because the page still shows marketplace UI.

- [ ] **Step 3: Remove marketplace UI from `Agents`**

Delete the marketplace tab/panel and any now-unused preset detail dialog state from the agents page while preserving existing management features.

- [ ] **Step 4: Re-run the agents page test**

Run: `pnpm exec vitest run tests/unit/agents-page-marketplace.test.tsx`
Expected: PASS

### Task 4: Update copy and exports

**Files:**
- Modify: `src/i18n/locales/zh/dashboard.json`
- Modify: `src/i18n/locales/en/dashboard.json`
- Modify: `src/i18n/locales/zh/agents.json`
- Modify: `src/i18n/locales/en/agents.json`
- Modify: `src/i18n/locales/zh/common.json`
- Modify: `src/i18n/locales/en/common.json`

- [ ] **Step 1: Add failing assertions for new text labels where needed**

Cover:

- plaza tab labels
- preset plaza heading/description
- renamed sidebar/dashboard wording where product copy changed

- [ ] **Step 2: Update locale files**

Add the plaza-specific copy and remove now-unused marketplace tab strings from the agents page where appropriate.

- [ ] **Step 3: Re-run relevant unit tests**

Run: `pnpm exec vitest run tests/unit/dashboard-plaza.test.tsx tests/unit/agents-page-marketplace.test.tsx`
Expected: PASS

### Task 5: Verify and doc-sync

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`

- [ ] **Step 1: Check whether README wording needs updates**

Only update docs if user-visible navigation or feature placement is described there.

- [ ] **Step 2: Run focused verification**

Run: `pnpm exec vitest run tests/unit/dashboard-plaza.test.tsx tests/unit/agents-page-marketplace.test.tsx tests/unit/agent-settings-modal.test.tsx`
Expected: PASS

- [ ] **Step 3: Run type verification for touched files**

Run: `pnpm exec tsc --noEmit --pretty false`
Expected: PASS
