# Model Config Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split model providers from model configuration, remove startup provider gating, and align GeeClaw's model settings with OpenClaw's native `agents.defaults` schema.

**Architecture:** Treat provider accounts as inventory only, and store all selectable runtime models as explicit model refs under `agents.defaults`. Startup no longer blocks on provider setup; chat becomes responsible for distinguishing "no providers" from "no default chat model" and routing users to the correct settings page.

**Tech Stack:** Electron, React 19, TypeScript, Zustand, Vitest, React Router, i18next

---

### Task 1: Define model-config schema and migration coverage

**Files:**
- Modify: `electron/utils/agent-config.ts`
- Modify: `electron/api/routes/agents.ts`
- Test: `tests/unit/agent-config-managed.test.ts`
- Test: `tests/unit/openclaw-provider-config.test.ts`

- [ ] Add failing tests that describe the new settings snapshot shape and migration behavior from existing `model.primary` / `fallbacks`.
- [ ] Verify the new tests fail for the right reason using targeted Vitest invocations.
- [ ] Implement a full defaults-model snapshot/update layer that supports `model`, `imageModel`, `pdfModel`, `imageGenerationModel`, and `videoGenerationModel`, with omitted sections for auto mode.
- [ ] Re-run the targeted tests until they pass.
- [ ] Commit the schema/API change set.

### Task 2: Remove default-provider model semantics from runtime sync

**Files:**
- Modify: `electron/services/providers/provider-runtime-sync.ts`
- Modify: `electron/utils/openclaw-provider-config.ts`
- Test: `tests/unit/provider-runtime-sync-oauth.test.ts`
- Test: `tests/unit/openclaw-provider-config.test.ts`

- [ ] Add failing tests that prove default provider changes no longer overwrite the explicit chat-model selection.
- [ ] Verify the tests fail before implementation.
- [ ] Update runtime sync to preserve explicit model refs while still syncing provider catalogs and auth.
- [ ] Re-run the targeted tests until they pass.
- [ ] Commit the runtime-sync change set.

### Task 3: Remove startup/setup provider gating

**Files:**
- Modify: `src/stores/bootstrap.ts`
- Modify: `src/pages/Startup/index.tsx`
- Modify: `src/pages/Setup/index.tsx`
- Test: `tests/unit` (new bootstrap/startup focused tests if coverage is missing)

- [ ] Add failing tests, or extend existing ones, to describe bootstrap readiness without any configured provider.
- [ ] Verify those tests fail before code changes.
- [ ] Remove `needs_provider` from startup flow and strip provider setup from startup/setup screens.
- [ ] Re-run the targeted tests until they pass.
- [ ] Commit the startup-flow change set.

### Task 4: Split settings navigation and add model-config UI

**Files:**
- Modify: `src/lib/settings-modal.ts`
- Modify: `src/pages/Settings/index.tsx`
- Modify: `src/components/settings/ModelsSettingsSection.tsx`
- Modify: `src/components/settings/ProvidersSettings.tsx`
- Modify: `src/i18n/locales/zh/settings.json`
- Modify: `src/i18n/locales/en/settings.json`

- [ ] Add failing tests for the new settings sections and model-config page behavior if they exist; otherwise add narrow component tests around the new data flow.
- [ ] Verify the tests fail before implementation.
- [ ] Split the settings routes into provider inventory and model configuration, and replace textarea model editing with structured add/remove controls.
- [ ] Re-run the targeted tests until they pass.
- [ ] Commit the settings UI change set.

### Task 5: Gate chat on model readiness and route to the correct settings page

**Files:**
- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/pages/Chat/ChatInput.tsx`
- Test: `tests/unit/chat-input-preset-skills.test.tsx`
- Test: `tests/unit` (new chat gating tests as needed)

- [ ] Add failing tests for the two chat empty states: no provider inventory vs. no default chat model.
- [ ] Verify the tests fail before implementation.
- [ ] Implement composer disabling, CTA routing, and empty-state copy based on provider/model readiness.
- [ ] Re-run the targeted tests until they pass.
- [ ] Commit the chat gating change set.

### Task 6: Documentation and verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] Update docs to reflect the new settings split and removal of startup provider setup.
- [ ] Run targeted verification for backend, settings, chat, and i18n changes.
- [ ] Commit the docs/final verification change set.
