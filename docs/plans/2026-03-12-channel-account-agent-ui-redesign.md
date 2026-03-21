# Channel Account And Agent Binding UI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `Channels` the primary workflow for managing multi-account channel configs and binding each account to an agent, while keeping `Agents` as a secondary ownership view.

**Architecture:** Persist channel credentials under `channels.<type>.accounts.<accountId>` and keep ownership in `bindings` keyed by `channel + accountId`, but move the UI mental model to “channel accounts choose an agent.” Add explicit default-account management per channel type, disallow deleting the current default account, and render all configured accounts in `Channels`, including disconnected placeholder accounts loaded from `openclaw.json`.

**Tech Stack:** Electron main-process host API, React 19 + Zustand renderer, TypeScript, `electron-store` JSON config via `openclaw.json`, existing `hostApiFetch` transport.

---

## Context

Current local behavior has the right persistence direction but the wrong primary UX:

- Multi-account storage already exists in `electron/utils/channel-config.ts`.
- Ownership already exists in `electron/utils/agent-config.ts` via `bindings`.
- `Channels` UI still collapses each channel type into one “primary” account.
- `Agents` UI currently acts like the main place to add/remove channel bindings.
- Deleting a default account is not explicitly prevented.
- There is no first-class “set this account as default” interaction.
- Entire-channel deletion does not currently clear stale bindings.
- Deleting `accounts.default` can leave top-level mirrored credentials behind.

The redesign should preserve the underlying storage model and correct the user-facing workflow.

## Non-Goals

- Do not redesign runtime protocol behavior or gateway session routing.
- Do not change the `bindings` schema shape.
- Do not add Japanese docs or locale work.
- Do not attempt a broad visual redesign beyond what is needed for clarity.

## Desired Product Behavior

1. `Channels` shows one section per channel type, with all configured accounts listed beneath it.
2. Each account row shows:
   - `accountId`
   - display name/status/error
   - bound agent
   - whether it is the default account
3. Adding another account happens from `Channels`, inside that channel type.
4. Each account can be assigned or reassigned to an agent from `Channels`.
5. The current default account cannot be deleted.
6. Users can switch which account is the default for a channel type.
7. `Agents` becomes a secondary view:
   - shows which channel accounts/channels belong to each agent
   - may still support unbind as a convenience
   - should no longer be the primary place to create channel accounts

## Data Model Target

Keep the existing split:

- Credentials/config:
  - `channels.<type>.accounts.<accountId>`
- Default marker:
  - `channels.<type>.defaultAccount`
- Ownership:
  - `bindings[]` with `match.channel` + `match.accountId`

Example:

```json
{
  "channels": {
    "telegram": {
      "defaultAccount": "default",
      "accounts": {
        "default": { "botToken": "...", "allowFrom": ["123"], "enabled": true },
        "ops-bot": { "botToken": "...", "allowFrom": ["456"], "enabled": true }
      },
      "botToken": "...",
      "allowFrom": ["123"],
      "enabled": true
    }
  },
  "bindings": [
    { "agentId": "main", "match": { "channel": "telegram", "accountId": "default" } },
    { "agentId": "ops", "match": { "channel": "telegram", "accountId": "ops-bot" } }
  ]
}
```

## Backend Changes

### Task 1: Add channel-account-centric host API endpoints

**Files:**
- Modify: `electron/api/routes/channels.ts`
- Modify: `electron/utils/channel-config.ts`
- Modify: `electron/utils/agent-config.ts`

**Step 1: Add a read endpoint that returns configured accounts per channel**

Implement a route in `electron/api/routes/channels.ts` that returns account metadata from config, for example:

- `GET /api/channels/configured-accounts`

Response shape should include:

```ts
{
  success: true,
  channels: {
    telegram: {
      defaultAccount: "default",
      accounts: [
        { accountId: "default", enabled: true },
        { accountId: "ops-bot", enabled: true }
      ]
    }
  }
}
```

This route must read from `openclaw.json`, not from gateway runtime only.

**Step 2: Add a helper to list configured account summaries**

In `electron/utils/channel-config.ts`, add a helper that reads:

- `channels.<type>.accounts`
- `channels.<type>.defaultAccount`

and returns normalized summaries for UI use.

Run:

```bash
pnpm exec eslint electron/utils/channel-config.ts electron/api/routes/channels.ts
```

Expected: PASS

**Step 3: Add account-specific deletion endpoint**

Implement:

- `DELETE /api/channels/config/:channelType/accounts/:accountId`

Behavior:

- If `accountId` is the current `defaultAccount`, reject with 400.
- Otherwise delete only that account config.
- Also clear only that account’s binding.
- If no accounts remain, delete the whole channel section.

This must not delete unrelated accounts of the same channel type.

**Step 4: Add default-account update endpoint**

Implement:

- `PUT /api/channels/config/:channelType/default-account`

Request:

```json
{ "accountId": "ops-bot" }
```

Behavior:

- Validate account exists.
- Update `defaultAccount`.
- Mirror that account’s credentials to top-level `channels.<type>` keys.
- Optionally clear old mirrored top-level keys first so stale data does not survive.

Run:

```bash
pnpm exec eslint electron/utils/channel-config.ts electron/api/routes/channels.ts
pnpm run typecheck
```

Expected: PASS

### Task 2: Fix persistence consistency bugs

**Files:**
- Modify: `electron/utils/channel-config.ts`
- Modify: `electron/api/routes/channels.ts`

**Step 1: Fix default-account deletion side effects**

Update `deleteChannelAccountConfig()` so:

- deleting `default` is disallowed by caller logic
- if deleting a non-default account, only that account is removed
- if that account had mirrored top-level keys by mistake, they are not copied back

**Step 2: Fix top-level mirror cleanup**

When changing default account, explicitly rebuild top-level mirrored keys from the new default account instead of leaving legacy keys in place.

Use a helper like:

```ts
function syncTopLevelFromDefaultAccount(section, defaultAccountId): void
```

This helper should:

- remove non-structural top-level keys
- copy keys from `accounts[defaultAccountId]`
- preserve structural keys: `enabled`, `defaultAccount`, `accounts`

**Step 3: Clear bindings when deleting a whole channel**

Local code currently deletes `channels.<type>` without clearing stale `bindings`.

Update `electron/api/routes/channels.ts` whole-channel delete path to also call:

- `clearAllBindingsForChannel(channelType)`

Run:

```bash
pnpm exec eslint electron/utils/channel-config.ts electron/api/routes/channels.ts
pnpm run typecheck
```

Expected: PASS

### Task 3: Make validation default-account aware instead of hardcoding `default`

**Files:**
- Modify: `electron/utils/channel-config.ts`

**Step 1: Update validation helpers**

Current `validateChannelConfig()` reads only default-account data.

Refactor it to:

- use `channels.<type>.defaultAccount` when present
- fall back to `default`
- still support legacy flat channel configs

**Step 2: Verify Discord/Telegram validation still works**

Run:

```bash
pnpm exec eslint electron/utils/channel-config.ts
pnpm run typecheck
```

Expected: PASS

## Renderer Changes

### Task 4: Extend channel store to expose all accounts, not only primary account

**Files:**
- Modify: `src/stores/channels.ts`
- Modify: `src/types/channel.ts`

**Step 1: Add channel account UI types**

Introduce a renderer type representing a channel account row, for example:

```ts
interface ChannelAccount {
  channelType: ChannelType;
  accountId: string;
  name: string;
  status: ChannelStatus;
  error?: string;
  isDefault: boolean;
  boundAgentId?: string | null;
}
```

Keep the current `Channel` type only if still needed for backward-compatible components; otherwise replace with grouped structures.

**Step 2: Read both runtime accounts and config-only accounts**

Update `fetchChannels()` to merge:

- runtime `channels.status`
- config account summaries from the new host API endpoint
- agent ownership from `useAgentsStore().channelOwners` or a richer per-account ownership source

If current agent snapshot only exposes per-channel primary ownership, extend backend snapshot or add a new map keyed by `channelType:accountId`.

**Step 3: Stop collapsing to one primary account**

Remove the logic that picks only `primaryAccount`.

Instead, produce all account rows for each channel type.

Run:

```bash
pnpm exec eslint src/stores/channels.ts src/types/channel.ts
pnpm run typecheck
```

Expected: PASS

### Task 5: Redesign the `Channels` page around channel types with nested account rows

**Files:**
- Modify: `src/pages/Channels/index.tsx`
- Modify: `src/i18n/locales/zh/channels.json`
- Modify: `src/i18n/locales/en/channels.json`

**Step 1: Render grouped channel sections**

Each channel type card/section should show:

- channel logo + description
- “Add account” button
- list of account rows

Each account row should show:

- account label
- default badge
- agent assignment
- status badge
- actions: edit, set default, delete

**Step 2: Add “Add account” flow inside channel section**

Open `ChannelConfigModal` with:

- selected channel type pre-filled
- optional `accountId` empty/new
- agent picker included in modal state

**Step 3: Add account row actions**

For each account row:

- `Edit`: reopen config modal for that `channelType + accountId`
- `Set default`: call new default-account endpoint
- `Delete`: call account-specific delete endpoint, disabled for default
- `Change agent`: allow selecting another agent and update binding only

**Step 4: Make the default badge obvious**

Add a clear `Default` badge next to the account row and disable delete action with explanatory tooltip or helper text.

Run:

```bash
pnpm exec eslint src/pages/Channels/index.tsx
pnpm run typecheck
```

Expected: PASS

### Task 6: Upgrade `ChannelConfigModal` to manage account identity and agent binding in one flow

**Files:**
- Modify: `src/components/channels/ChannelConfigModal.tsx`
- Modify: `src/stores/agents.ts`

**Step 1: Replace implicit `agentId -> accountId` mode with explicit account form state**

The modal should accept props like:

```ts
{
  channelType?: ChannelType;
  initialAccountId?: string;
  initialAgentId?: string | null;
  mode: "create-account" | "edit-account";
}
```

Do not make `agentId` the identity of the account anymore.

**Step 2: Add explicit account ID field when creating non-default accounts**

Rules:

- creating default account should remain possible only once
- new additional accounts must have a user-visible `accountId`
- validate uniqueness within the channel type

**Step 3: Add agent picker to modal**

After saving config to `/api/channels/config`, perform the binding update as a second action:

- bind selected agent to `channel + accountId`
- if no agent selected, leave unbound and let fallback rules apply

If binding update fails after config save:

- show a partial-success error
- do not silently roll back config

**Step 4: Support editing existing account**

Editing should:

- load `GET /api/channels/config/:type?accountId=...`
- keep the same `accountId`
- allow reassigning agent
- allow switching default via explicit action, not by renaming account

Run:

```bash
pnpm exec eslint src/components/channels/ChannelConfigModal.tsx src/stores/agents.ts
pnpm run typecheck
```

Expected: PASS

### Task 7: Reduce `Agents` page to a secondary ownership/inspection view

**Files:**
- Modify: `src/pages/Agents/index.tsx`
- Modify: `src/i18n/locales/zh/agents.json`
- Modify: `src/i18n/locales/en/agents.json`

**Step 1: Change the copy**

Update subtitle and helper text to clarify:

- this page shows agent ownership
- primary channel/account management happens in `Channels`

**Step 2: Replace “Add Channel” primary action**

Either:

- remove it entirely, or
- change it to deep-link users into the `Channels` page with a suggested target agent

Recommended: remove it as the primary path to avoid split-brain UX.

**Step 3: Show account-level ownership**

If backend supports it, list entries like:

- `telegram/default`
- `telegram/ops-bot`

instead of only `telegram`

Run:

```bash
pnpm exec eslint src/pages/Agents/index.tsx
pnpm run typecheck
```

Expected: PASS

## Testing

### Task 8: Add focused verification for persistence rules

**Files:**
- Create or Modify: suitable tests under existing Electron utility test structure if present
- If no clean harness exists, document manual verification in the plan PR notes

**Step 1: Verify account persistence scenarios manually or with unit tests**

Cover:

- save default account
- save second account
- set second account as default
- delete non-default account
- reject deleting default account
- delete whole channel clears bindings

**Step 2: Verify UI scenarios manually**

Manual checklist:

1. Create `telegram/default`, bind to `main`
2. Add `telegram/ops-bot`, bind to `ops`
3. Confirm both rows appear in `Channels`
4. Confirm default badge is shown on the correct row
5. Change default to `ops-bot`
6. Confirm top-level `channels.telegram.*` mirrors `accounts["ops-bot"]`
7. Confirm delete is disabled for current default
8. Delete the non-default row
9. Confirm only that row disappears and binding is cleared

**Step 3: Final verification commands**

Run:

```bash
pnpm exec eslint src/pages/Channels/index.tsx src/components/channels/ChannelConfigModal.tsx src/pages/Agents/index.tsx src/stores/channels.ts src/stores/agents.ts electron/api/routes/channels.ts electron/utils/channel-config.ts electron/utils/agent-config.ts
pnpm run typecheck
```

Expected: PASS

## Docs

### Task 9: Update product docs if behavior changed materially

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Step 1: Update multi-agent/channel management explanation**

Document that:

- channels support multiple accounts
- each account can be assigned to an agent
- default account is explicit and can be changed
- channel account management happens in `Channels`

**Step 2: Do not add Japanese docs**

Per current branch constraints, skip `README.ja-JP.md`.

## Risks To Watch

- Leaving stale mirrored top-level keys when switching or deleting default accounts.
- Showing duplicate rows when runtime account discovery and config account discovery overlap.
- Breaking WhatsApp, which is plugin-managed and does not use the same `channels.<type>.accounts` path.
- Treating `agentId` as `accountId` too aggressively in UI state; the new flow must decouple them.
- If account-level ownership is not returned from backend, the renderer may need a richer snapshot than current `channelOwners`.

## Recommended Implementation Order

1. Backend account endpoints and cleanup fixes
2. Richer account-aware snapshot data if needed
3. Channel store multi-account normalization
4. `ChannelConfigModal` refactor
5. `Channels` page grouped account UI
6. `Agents` page demotion to secondary ownership view
7. Final verification and docs

## Open Questions To Resolve During Implementation

- Should account IDs be editable after creation, or treated as immutable keys?
  - Recommendation: immutable after creation
- Should unbound accounts be allowed?
  - Recommendation: yes, but display “Unassigned” clearly
- Should changing default account also auto-rebind default ownership to the default agent?
  - Recommendation: no; default-account selection and binding are separate concerns

## Suggested Commit Sequence

```bash
git add electron/utils/channel-config.ts electron/api/routes/channels.ts electron/utils/agent-config.ts
git commit -m "feat: add channel account management APIs"

git add src/stores/channels.ts src/types/channel.ts src/components/channels/ChannelConfigModal.tsx
git commit -m "feat: normalize multi-account channel state"

git add src/pages/Channels/index.tsx src/pages/Agents/index.tsx src/i18n/locales/en/channels.json src/i18n/locales/zh/channels.json src/i18n/locales/en/agents.json src/i18n/locales/zh/agents.json
git commit -m "feat: move channel account binding flow into channels workspace"
```

Plan complete and saved to `docs/plans/2026-03-12-channel-account-agent-ui-redesign.md`. Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?
