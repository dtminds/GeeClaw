# GeeClaw Main Session Key Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move GeeClaw's fixed per-agent session from `agent:{agentId}:main` to `agent:{agentId}:geeclaw_main` so OpenClaw HEARTBEAT traffic in `:main` never appears in the app's session UI.

**Architecture:** Keep the "fixed main session per agent" product behavior, but redefine the key and make all main-session detection compare against the resolved agent main-session key instead of checking `endsWith(':main')`. Update the Electron desktop-session store and the renderer chat/session surfaces together so they agree on creation, dedupe, fallback, cleanup, and previews.

**Tech Stack:** Electron, React 19, TypeScript, Zustand, Vitest

---

### Task 1: Lock The New Main Session Key Contract In Tests

**Files:**
- Modify: `tests/unit/desktop-sessions.test.ts`
- Modify: `tests/unit/chat-store-session-selection.test.ts`
- Modify: `tests/unit/chat-sessions-panel.test.tsx`
- Modify: `tests/unit/sidebar-agent-avatar.test.tsx`
- Modify: `tests/unit/chat-requested-agent-navigation.test.tsx`

- [ ] **Step 1: Write the failing test updates**

Add assertions that the canonical fixed session key is `agent:{agentId}:geeclaw_main`, that UI grouping uses the resolved key instead of `:main`, and that requested-agent navigation still targets the fixed session entry.

- [ ] **Step 2: Run the focused test set to verify it fails**

Run: `pnpm test tests/unit/desktop-sessions.test.ts tests/unit/chat-store-session-selection.test.ts tests/unit/chat-sessions-panel.test.tsx tests/unit/sidebar-agent-avatar.test.tsx tests/unit/chat-requested-agent-navigation.test.tsx`

Expected: failures mentioning `agent:{agentId}:main`, old main-session grouping, or old fallback behavior.

### Task 2: Update Electron Main Session Semantics

**Files:**
- Modify: `electron/utils/agent-config.ts`
- Modify: `electron/utils/desktop-sessions.ts`
- Test: `tests/unit/desktop-sessions.test.ts`

- [ ] **Step 1: Change the default fixed session key builder**

Update the agent-config helper so the fallback main key is `geeclaw_main` instead of `main`.

- [ ] **Step 2: Remove hard-coded `:main` detection from desktop session normalization**

Make desktop-session dedupe and default-key generation treat GeeClaw-owned fixed sessions by key shape or the generated default key, not by the raw `:main` suffix.

- [ ] **Step 3: Run the Electron/session utility tests**

Run: `pnpm test tests/unit/desktop-sessions.test.ts`

Expected: PASS

### Task 3: Update Renderer Store Selection And Fallback Logic

**Files:**
- Modify: `src/stores/chat.ts`
- Test: `tests/unit/chat-store-session-selection.test.ts`
- Test: `tests/unit/chat-requested-agent-navigation.test.tsx`

- [ ] **Step 1: Replace `:main` suffix checks with resolved per-agent main-session-key checks**

Update session selection, reconciliation, delete fallback, cleanup protection, and send-target switching so every branch uses the resolved GeeClaw main session key.

- [ ] **Step 2: Remove fallback reads of `agent:{agentId}:main` in renderer code**

All fallback construction in the chat store should target `agent:{agentId}:geeclaw_main`.

- [ ] **Step 3: Run the focused renderer/store tests**

Run: `pnpm test tests/unit/chat-store-session-selection.test.ts tests/unit/chat-requested-agent-navigation.test.tsx`

Expected: PASS

### Task 4: Update Session UI Surfaces

**Files:**
- Modify: `src/pages/Chat/ChatSessionsPanel.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Test: `tests/unit/chat-sessions-panel.test.tsx`
- Test: `tests/unit/sidebar-agent-avatar.test.tsx`

- [ ] **Step 1: Make ChatSessionsPanel resolve the fixed session via the agent main-session key**

Keep the current UI split if desired, but identify the fixed session by the resolved key rather than `:main`.

- [ ] **Step 2: Make Sidebar previews use the resolved fixed session**

The agent list should summarize the fixed GeeClaw session, not any `:main` session.

- [ ] **Step 3: Run the focused UI tests**

Run: `pnpm test tests/unit/chat-sessions-panel.test.tsx tests/unit/sidebar-agent-avatar.test.tsx`

Expected: PASS

### Task 5: End-To-End Focused Verification

**Files:**
- Modify: `src/i18n/locales/en/chat.json` only if copy needs correction
- Modify: `src/i18n/locales/zh/chat.json` only if copy needs correction

- [ ] **Step 1: Run the combined focused regression suite**

Run: `pnpm test tests/unit/desktop-sessions.test.ts tests/unit/chat-store-session-selection.test.ts tests/unit/chat-sessions-panel.test.tsx tests/unit/sidebar-agent-avatar.test.tsx tests/unit/chat-requested-agent-navigation.test.tsx`

Expected: PASS

- [ ] **Step 2: Run a type check for changed surfaces**

Run: `pnpm run typecheck`

Expected: PASS
