# Safety Settings Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old single safety policy with separate tool-permission and approval-policy settings across storage, config sync, Settings UI, and composer quick controls.

**Architecture:** Split safety persistence into two first-class app settings, keep OpenClaw synchronization centralized in `electron/utils/openclaw-safety-settings.ts`, and update the two renderer entry points to read/write the new safety payload directly. Preserve existing fixed guardrails under `tools.profile` and `tools.elevated.enabled`.

**Tech Stack:** Electron, React 19, TypeScript, Zustand, react-i18next, Vitest, Testing Library

---

## File Map

**Modify**
- `electron/utils/store.ts`
- `electron/utils/openclaw-safety-settings.ts`
- `electron/api/routes/settings.ts`
- `electron/main/ipc-handlers.ts`
- `src/stores/settings.ts`
- `src/pages/Settings/index.tsx`
- `src/pages/Chat/ChatInput.tsx`
- `src/i18n/locales/en/settings.json`
- `src/i18n/locales/zh/settings.json`
- `src/i18n/locales/en/chat.json`
- `src/i18n/locales/zh/chat.json`
- `tests/unit/openclaw-safety-settings.test.ts`
- `tests/unit/settings-routes.test.ts`
- `tests/unit/settings-dialog.test.tsx`
- `tests/unit/sidebar-settings-menu.test.tsx`
- `tests/unit/chat-input-preset-skills.test.tsx`
- `README.md`
- `README.zh-CN.md`

## Task 1: Red test the new safety config mapping

**Files:**
- Modify: `tests/unit/openclaw-safety-settings.test.ts`
- Test: `tests/unit/openclaw-safety-settings.test.ts`

- [ ] **Step 1: Write failing mapping tests for `toolPermission` and `approvalPolicy`**

```ts
await syncOpenClawSafetySettings({
  toolPermission: 'default',
  approvalPolicy: 'allowlist',
});

expect(config.tools.deny).toEqual(['group:automation']);
expect(config.tools.exec).toMatchObject({
  security: 'allowlist',
  ask: 'on-miss',
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/openclaw-safety-settings.test.ts`
Expected: FAIL because the helper still expects `securityPolicy` and writes the old values.

- [ ] **Step 3: Add failing route payload tests**

```ts
parseJsonBodyMock.mockResolvedValueOnce({
  toolPermission: 'strict',
  approvalPolicy: 'allowlist',
});

expect(setSettingMock).toHaveBeenCalledWith('toolPermission', 'strict');
expect(setSettingMock).toHaveBeenCalledWith('approvalPolicy', 'allowlist');
```

- [ ] **Step 4: Run route tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/settings-routes.test.ts`
Expected: FAIL because `/api/settings/safety` still validates `securityPolicy` and `workspaceOnly`.

## Task 2: Implement the main-process safety model

**Files:**
- Modify: `electron/utils/store.ts`
- Modify: `electron/utils/openclaw-safety-settings.ts`
- Modify: `electron/api/routes/settings.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Test: `tests/unit/openclaw-safety-settings.test.ts`
- Test: `tests/unit/settings-routes.test.ts`

- [ ] **Step 1: Replace the persisted safety fields**

```ts
export interface AppSettings {
  toolPermission: 'default' | 'strict' | 'full';
  approvalPolicy: 'allowlist' | 'full';
}

const defaults: AppSettings = {
  toolPermission: 'default',
  approvalPolicy: 'full',
};
```

- [ ] **Step 2: Rewrite the safety sync helper around the new fields**

```ts
function syncToolPermission(tools: Record<string, unknown>, toolPermission: ToolPermission): void {
  if (toolPermission === 'default') {
    tools.deny = ['group:automation'];
    return;
  }
  if (toolPermission === 'strict') {
    tools.deny = ['group:automation', 'group:runtime', 'group:fs', 'sessions_spawn', 'sessions_send'];
    return;
  }
  delete tools.deny;
}

function syncApprovalPolicy(tools: Record<string, unknown>, approvalPolicy: ApprovalPolicy): void {
  const exec = ensureMutableRecord(tools, 'exec');
  exec.security = approvalPolicy === 'allowlist' ? 'allowlist' : 'full';
  exec.ask = approvalPolicy === 'allowlist' ? 'on-miss' : 'off';
}
```

- [ ] **Step 3: Update the safety route contract and safety-key detection**

```ts
type SafetyPatch = Partial<Pick<AppSettings, 'toolPermission' | 'approvalPolicy'>>;

function patchTouchesSafety(patch: Partial<AppSettings>): boolean {
  return Object.keys(patch).some((key) => key === 'toolPermission' || key === 'approvalPolicy');
}
```

- [ ] **Step 4: Run the main-process tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/openclaw-safety-settings.test.ts tests/unit/settings-routes.test.ts`
Expected: PASS

## Task 3: Red test the renderer safety UI contract

**Files:**
- Modify: `tests/unit/settings-dialog.test.tsx`
- Modify: `tests/unit/chat-input-preset-skills.test.tsx`
- Test: `tests/unit/settings-dialog.test.tsx`
- Test: `tests/unit/chat-input-preset-skills.test.tsx`

- [ ] **Step 1: Add failing Settings-page assertions for two selects**

```ts
expect(screen.getByText('工具权限')).toBeInTheDocument();
expect(screen.getByText('审批策略')).toBeInTheDocument();
expect(screen.queryByText('默认项目目录')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the Settings UI test to verify it fails**

Run: `pnpm exec vitest run tests/unit/settings-dialog.test.tsx`
Expected: FAIL because the page still renders the old card layout and directory row.

- [ ] **Step 3: Add failing composer assertions for split safety controls**

```ts
expect(screen.getByText(/工具权限/)).toBeInTheDocument();
expect(screen.getByText(/审批策略/)).toBeInTheDocument();
```

- [ ] **Step 4: Run the composer UI test to verify it fails**

Run: `pnpm exec vitest run tests/unit/chat-input-preset-skills.test.tsx`
Expected: FAIL because the composer still exposes one `securityPolicy` selector.

## Task 4: Implement the renderer split safety UI

**Files:**
- Modify: `src/stores/settings.ts`
- Modify: `src/pages/Settings/index.tsx`
- Modify: `src/pages/Chat/ChatInput.tsx`
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/zh/settings.json`
- Modify: `src/i18n/locales/en/chat.json`
- Modify: `src/i18n/locales/zh/chat.json`
- Test: `tests/unit/settings-dialog.test.tsx`
- Test: `tests/unit/chat-input-preset-skills.test.tsx`

- [ ] **Step 1: Replace renderer state/types with the new safety payload**

```ts
type ToolPermission = 'default' | 'strict' | 'full';
type ApprovalPolicy = 'allowlist' | 'full';

type SafetySettingsInfo = {
  toolPermission: ToolPermission;
  approvalPolicy: ApprovalPolicy;
};
```

- [ ] **Step 2: Refactor Settings safety UI into a two-row list with selects**

```tsx
<div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
  <div className="flex items-center justify-between gap-6 p-6">
    <div className="space-y-1">
      <h3>{t('safety.toolPermission.title')}</h3>
      <p>{t('safety.toolPermission.description')}</p>
    </div>
    <Select ... />
  </div>
</div>
```

- [ ] **Step 3: Refactor composer safety controls to independent selects**

```tsx
<DropdownMenuSub>
  <DropdownMenuSubTrigger>{t('composer.safety.toolPermission')}</DropdownMenuSubTrigger>
  ...
</DropdownMenuSub>
<DropdownMenuSub>
  <DropdownMenuSubTrigger>{t('composer.safety.approvalPolicy')}</DropdownMenuSubTrigger>
  ...
</DropdownMenuSub>
```

- [ ] **Step 4: Run the renderer tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/settings-dialog.test.tsx tests/unit/chat-input-preset-skills.test.tsx`
Expected: PASS

## Task 5: Final verification and docs review

**Files:**
- Modify if needed: `README.md`
- Modify if needed: `README.zh-CN.md`

- [ ] **Step 1: Review README files for outdated Safety UI wording**

```md
Search for "securityPolicy", "Safety", "默认项目目录", and old three-mode descriptions.
```

- [ ] **Step 2: Run focused verification**

Run: `pnpm exec vitest run tests/unit/openclaw-safety-settings.test.ts tests/unit/settings-routes.test.ts tests/unit/settings-dialog.test.tsx tests/unit/chat-input-preset-skills.test.tsx`
Expected: PASS

- [ ] **Step 3: Run type checking**

Run: `pnpm run typecheck`
Expected: PASS
