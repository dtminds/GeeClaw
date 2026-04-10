# Agent Avatar Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add preset-based agent avatars across sidebar display, manual agent creation, marketplace installs, and agent settings updates.

**Architecture:** Introduce a shared preset registry and stable marketplace mapping that both the renderer and Electron routes can use. Persist only `avatarPresetId` plus a small source flag, then render through a single avatar component that supports full and compact sidebar modes.

**Tech Stack:** React 19, TypeScript, Zustand, Electron host API, Vitest, Testing Library

---

### Task 1: Shared Avatar Model

**Files:**
- Create: `src/shared/agent-avatar.ts`
- Test: `tests/unit/agent-avatar-shared.test.ts`

- [ ] Add failing shared tests for preset lookup, stable fallback mapping, and marketplace overwrite protection.
- [ ] Run `pnpm test tests/unit/agent-avatar-shared.test.ts` and confirm failure.
- [ ] Implement the shared avatar types, preset ids, default preset, stable agent-id hash mapping, and `shouldReplaceAgentAvatarOnMarketplaceSync`.
- [ ] Run `pnpm test tests/unit/agent-avatar-shared.test.ts` and confirm pass.

### Task 2: Persist Avatar Fields In Agent Snapshots

**Files:**
- Modify: `electron/utils/agent-config.ts`
- Modify: `electron/api/routes/agents.ts`
- Modify: `src/types/agent.ts`
- Modify: `src/stores/agents.ts`
- Test: `tests/unit/agents-api-routes.test.ts`
- Test: `tests/unit/agent-config-managed.test.ts`

- [ ] Add failing tests for create/update payloads carrying avatar fields and for marketplace install/update persistence behavior.
- [ ] Run targeted Vitest cases and confirm failure.
- [ ] Implement `avatarPresetId` and `avatarSource` in config read/write paths, API parsing, snapshot building, create flow, settings update flow, and marketplace install/update flow.
- [ ] Re-run targeted Vitest cases and confirm pass.

### Task 3: Avatar Rendering And Selection UI

**Files:**
- Create: `src/components/agents/AgentAvatar.tsx`
- Create: `src/components/agents/AgentAvatarPicker.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/pages/Chat/AddAgentDialog.tsx`
- Modify: `src/pages/Chat/agent-settings/AgentGeneralPanel.tsx`
- Test: `tests/unit/add-agent-dialog.test.tsx`
- Test: `tests/unit/sidebar-agent-avatar.test.tsx`
- Test: `tests/unit/agent-settings-dialog.test.tsx`

- [ ] Add failing UI tests for choosing an avatar in create/settings flows and for compact/full sidebar avatar rendering.
- [ ] Run targeted Vitest cases and confirm failure.
- [ ] Implement the shared avatar component and picker, wire create/settings flows to save avatar presets, and replace sidebar initials with compact/full avatar rendering.
- [ ] Re-run targeted Vitest cases and confirm pass.

### Task 4: Final Verification

**Files:**
- Modify as needed based on test fixes
- Review: `README.md`
- Review: `README.zh-CN.md`

- [ ] Run the relevant targeted tests for shared logic, API/config, and UI.
- [ ] Run a broader type or unit verification command if the targeted tests pass.
- [ ] Review `README.md` and `README.zh-CN.md` and update only if this feature changes documented behavior.
