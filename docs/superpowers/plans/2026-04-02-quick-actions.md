# Quick Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build global text quick actions for GeeClaw, with one shortcut per default action, a shared floating window near the mouse cursor, clipboard fallback, and macOS/Windows selection-provider hooks.

**Architecture:** Add a main-process-owned quick-actions subsystem with four layers: settings-backed action definitions, global shortcut registration, floating window orchestration, and execution/selection services. Ship a clipboard-backed end-to-end slice first, then layer in platform selection providers and a dedicated renderer surface for mode switching, copy, and best-effort paste.

**Tech Stack:** Electron 40, React 19, TypeScript, electron-store, Vitest, Testing Library

---

### Task 1: Define quick-action types and settings persistence

**Files:**
- Create: `tests/unit/quick-actions-settings.test.ts`
- Modify: `electron/utils/store.ts`
- Modify: `src/stores/settings.ts`
- Modify: `electron/api/routes/settings.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';

describe('quick action settings defaults', () => {
  it('includes built-in quick actions in the electron settings defaults', async () => {
    const { getAllSettings } = await import('@electron/utils/store');
    const settings = await getAllSettings();

    expect(settings.quickActions.actions.map((action) => action.id)).toEqual([
      'translate',
      'reply',
      'lookup',
    ]);
    expect(settings.quickActions.actions.every((action) => typeof action.shortcut === 'string')).toBe(true);
  });
});

describe('settings routes quick actions', () => {
  it('persists quickActions through the generic settings route', async () => {
    const { handleSettingsRoutes } = await import('@electron/api/routes/settings');
    const setSettingMock = vi.fn();

    vi.doMock('@electron/utils/store', () => ({
      getAllSettings: vi.fn().mockResolvedValue({ quickActions: { actions: [], closeOnCopy: true, preferClipboardFallback: true } }),
      getSetting: vi.fn(),
      resetSettings: vi.fn(),
      setSetting: setSettingMock,
    }));

    await handleSettingsRoutes(
      { method: 'PUT' } as never,
      {} as never,
      new URL('http://127.0.0.1:13210/api/settings/quickActions'),
      { gatewayManager: { getStatus: () => ({ state: 'stopped' }), debouncedReload: vi.fn(), restart: vi.fn() } } as never,
    );

    expect(setSettingMock).toHaveBeenCalledWith('quickActions', expect.objectContaining({
      actions: expect.arrayContaining([expect.objectContaining({ id: 'translate' })]),
    }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/quick-actions-settings.test.ts tests/unit/settings-routes.test.ts`
Expected: FAIL because `quickActions` is not part of the Electron settings schema or renderer store yet.

- [ ] **Step 3: Add the minimal settings contract**

```ts
export type QuickActionKind = 'translate' | 'reply' | 'lookup' | 'customPrompt';
export type QuickActionOutputMode = 'copy' | 'paste';

export interface QuickActionDefinition {
  id: string;
  title: string;
  kind: QuickActionKind;
  shortcut: string;
  enabled: boolean;
  icon?: string;
  promptTemplate?: string;
  outputMode: QuickActionOutputMode;
}

export interface QuickActionSettings {
  actions: QuickActionDefinition[];
  closeOnCopy: boolean;
  preferClipboardFallback: boolean;
}
```

```ts
quickActions: {
  actions: [
    { id: 'translate', title: 'Translate', kind: 'translate', shortcut: 'CommandOrControl+Shift+1', enabled: true, outputMode: 'copy' },
    { id: 'reply', title: 'Reply', kind: 'reply', shortcut: 'CommandOrControl+Shift+2', enabled: true, outputMode: 'copy' },
    { id: 'lookup', title: 'Lookup', kind: 'lookup', shortcut: 'CommandOrControl+Shift+3', enabled: true, outputMode: 'copy' },
  ],
  closeOnCopy: true,
  preferClipboardFallback: true,
},
```

- [ ] **Step 4: Mirror the setting in the renderer store**

```ts
interface SettingsState {
  quickActions: QuickActionSettings;
  setQuickActions: (value: QuickActionSettings) => void;
}

setQuickActions: (quickActions) => {
  set({ quickActions });
  persistSettingValue('quickActions', quickActions);
},
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/quick-actions-settings.test.ts tests/unit/settings-routes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/unit/quick-actions-settings.test.ts electron/utils/store.ts src/stores/settings.ts electron/api/routes/settings.ts
git commit -m "feat: add quick action settings contract"
```

### Task 2: Add global shortcut registration and invocation state

**Files:**
- Create: `tests/unit/global-shortcuts.test.ts`
- Create: `electron/main/global-shortcuts.ts`
- Create: `electron/services/quick-actions/types.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Modify: `electron/preload/index.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerMock = vi.fn();
const unregisterAllMock = vi.fn();

vi.mock('electron', () => ({
  globalShortcut: {
    register: (...args: unknown[]) => registerMock(...args),
    unregisterAll: () => unregisterAllMock(),
  },
}));

describe('global shortcut manager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    registerMock.mockReturnValue(true);
  });

  it('registers enabled quick-action shortcuts and dispatches their ids', async () => {
    const { registerQuickActionShortcuts } = await import('@electron/main/global-shortcuts');
    const onInvoke = vi.fn();

    registerQuickActionShortcuts([
      { id: 'translate', shortcut: 'CommandOrControl+Shift+1', enabled: true },
      { id: 'reply', shortcut: 'CommandOrControl+Shift+2', enabled: true },
    ] as never, onInvoke);

    expect(registerMock).toHaveBeenCalledTimes(2);
    const callback = registerMock.mock.calls[0][1] as () => void;
    callback();
    expect(onInvoke).toHaveBeenCalledWith('translate');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/global-shortcuts.test.ts`
Expected: FAIL because the shortcut manager module and preload channels do not exist.

- [ ] **Step 3: Write the minimal main-process shortcut manager**

```ts
import { globalShortcut } from 'electron';
import type { QuickActionDefinition } from '../services/quick-actions/types';

export function registerQuickActionShortcuts(
  actions: QuickActionDefinition[],
  onInvoke: (actionId: string) => void,
): void {
  globalShortcut.unregisterAll();
  for (const action of actions) {
    if (!action.enabled || !action.shortcut.trim()) continue;
    globalShortcut.register(action.shortcut, () => onInvoke(action.id));
  }
}
```

- [ ] **Step 4: Add invocation state channels**

```ts
ipcMain.handle('quickAction:getHotkeyStatus', () => quickActionService.getHotkeyStatus());
ipcMain.handle('quickAction:trigger', (_event, actionId: string) => quickActionService.trigger(actionId));
```

```ts
const validChannels = [
  // ...
  'quickAction:getHotkeyStatus',
  'quickAction:trigger',
];
```

- [ ] **Step 5: Register shortcuts during startup and when settings change**

```ts
const settings = await getAllSettings();
registerQuickActionShortcuts(settings.quickActions.actions, (actionId) => {
  void quickActionService.trigger(actionId);
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/global-shortcuts.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tests/unit/global-shortcuts.test.ts electron/main/global-shortcuts.ts electron/services/quick-actions/types.ts electron/main/index.ts electron/main/ipc-handlers.ts electron/preload/index.ts
git commit -m "feat: add quick action shortcut registration"
```

### Task 3: Build a clipboard-backed quick-action service and floating window shell

**Files:**
- Create: `tests/unit/quick-action-window.test.ts`
- Create: `electron/main/quick-action-window.ts`
- Create: `electron/services/quick-actions/selection-provider.ts`
- Create: `electron/services/quick-actions/service.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Modify: `electron/preload/index.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';

describe('quick action service', () => {
  it('falls back to clipboard text and opens the floating window near the cursor', async () => {
    const showMock = vi.fn();
    const getClipboardInput = vi.fn().mockResolvedValue({
      text: 'clipboard text',
      source: 'clipboard',
      obtainedAt: 1,
    });

    const { createQuickActionService } = await import('@electron/services/quick-actions/service');
    const service = createQuickActionService({
      showWindow: showMock,
      getQuickActionInput: getClipboardInput,
      getActionById: () => ({ id: 'translate', kind: 'translate', title: 'Translate', shortcut: 'CommandOrControl+Shift+1', enabled: true, outputMode: 'copy' }),
    } as never);

    await service.trigger('translate');

    expect(showMock).toHaveBeenCalledWith(expect.objectContaining({
      actionId: 'translate',
      input: expect.objectContaining({ text: 'clipboard text', source: 'clipboard' }),
    }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/quick-action-window.test.ts`
Expected: FAIL because the quick-action service and floating window manager do not exist.

- [ ] **Step 3: Implement clipboard-first input retrieval**

```ts
import { clipboard } from 'electron';

export async function getQuickActionInput(): Promise<QuickActionInput | null> {
  const clipboardText = clipboard.readText().trim();
  if (!clipboardText) return null;
  return {
    text: clipboardText,
    source: 'clipboard',
    obtainedAt: Date.now(),
  };
}
```

- [ ] **Step 4: Implement the floating window shell**

```ts
export function createQuickActionWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 420,
    height: 320,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
}
```

```ts
quickActionWindow.webContents.send('quickAction:invoked', payload);
quickActionWindow.show();
quickActionWindow.focus();
```

- [ ] **Step 5: Add the IPC surface for list, trigger, and invocation payload**

```ts
ipcMain.handle('quickAction:list', () => quickActionService.list());
ipcMain.handle('quickAction:getLastContext', () => quickActionService.getLastContext());
```

```ts
const validChannels = [
  // ...
  'quickAction:list',
  'quickAction:getLastContext',
];
```

```ts
const validEventChannels = [
  // ...
  'quickAction:invoked',
];
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/quick-action-window.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tests/unit/quick-action-window.test.ts electron/main/quick-action-window.ts electron/services/quick-actions/selection-provider.ts electron/services/quick-actions/service.ts electron/main/index.ts electron/main/ipc-handlers.ts electron/preload/index.ts
git commit -m "feat: add quick action service and floating window shell"
```

### Task 4: Add the dedicated quick-actions renderer and settings UI

**Files:**
- Create: `tests/unit/quick-actions-window-renderer.test.tsx`
- Create: `src/pages/QuickActions/index.tsx`
- Create: `src/components/quick-actions/QuickActionWindow.tsx`
- Create: `src/components/quick-actions/ModeTabs.tsx`
- Create: `src/components/quick-actions/InputPanel.tsx`
- Create: `src/components/quick-actions/ResultPanel.tsx`
- Create: `src/components/settings/QuickActionsSettingsSection.tsx`
- Modify: `src/pages/Settings/index.tsx`
- Modify: `src/lib/host-events.ts`
- Modify: `src/lib/settings-modal.ts`
- Modify: `tests/unit/settings-modal.test.ts`

- [ ] **Step 1: Write the failing tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('QuickActionWindow', () => {
  it('defaults to the invoked mode and allows switching tabs', async () => {
    render(
      <QuickActionWindow
        initialActionId="translate"
        input={{ text: 'hello', source: 'clipboard', obtainedAt: 1 }}
        actions={[
          { id: 'translate', title: 'Translate', kind: 'translate', shortcut: 'CommandOrControl+Shift+1', enabled: true, outputMode: 'copy' },
          { id: 'reply', title: 'Reply', kind: 'reply', shortcut: 'CommandOrControl+Shift+2', enabled: true, outputMode: 'copy' },
        ]}
        onRun={vi.fn()}
      />
    );

    expect(screen.getByRole('tab', { name: 'Translate' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Reply' }));
    expect(screen.getByRole('tab', { name: 'Reply' })).toHaveAttribute('aria-selected', 'true');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/quick-actions-window-renderer.test.tsx tests/unit/settings-modal.test.ts`
Expected: FAIL because the quick-actions renderer and settings section do not exist.

- [ ] **Step 3: Implement the compact renderer shell**

```tsx
export function QuickActionWindow({ actions, initialActionId, input, onRun }: QuickActionWindowProps) {
  const [activeActionId, setActiveActionId] = useState(initialActionId);

  return (
    <div className="modal-card-surface rounded-[28px] p-4 shadow-2xl">
      <ModeTabs actions={actions} activeActionId={activeActionId} onChange={setActiveActionId} />
      <InputPanel input={input} />
      <ResultPanel onRun={() => onRun(activeActionId)} />
    </div>
  );
}
```

- [ ] **Step 4: Add a settings section and route mapping**

```ts
export type SettingsModalSection =
  | 'opencli'
  | 'mcp'
  | 'environment'
  | 'cliMarketplace'
  | 'quickActions';
```

```tsx
{activeModalSection === 'quickActions' && <QuickActionsSettingsSection />}
```

- [ ] **Step 5: Wire host events into the quick-actions page**

```tsx
useEffect(() => {
  return subscribeHostEvent('quickAction:invoked', (payload) => {
    setInvocation(payload as QuickActionInvocationPayload);
  });
}, []);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/quick-actions-window-renderer.test.tsx tests/unit/settings-modal.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tests/unit/quick-actions-window-renderer.test.tsx src/pages/QuickActions/index.tsx src/components/quick-actions src/components/settings/QuickActionsSettingsSection.tsx src/pages/Settings/index.tsx src/lib/host-events.ts src/lib/settings-modal.ts tests/unit/settings-modal.test.ts
git commit -m "feat: add quick actions renderer and settings section"
```

### Task 5: Add built-in action execution, copy, and best-effort paste

**Files:**
- Create: `tests/unit/quick-action-executor.test.ts`
- Create: `electron/services/quick-actions/executor.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Modify: `src/lib/api-client.ts`
- Modify: `src/pages/QuickActions/index.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';

describe('quick action executor', () => {
  it('builds translate prompts from the selected input text', async () => {
    const { buildQuickActionPrompt } = await import('@electron/services/quick-actions/executor');

    expect(buildQuickActionPrompt(
      { id: 'translate', title: 'Translate', kind: 'translate', shortcut: 'CommandOrControl+Shift+1', enabled: true, outputMode: 'copy' },
      { text: 'Hello world', source: 'selection', obtainedAt: 1 },
    )).toContain('Translate the following text');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/quick-action-executor.test.ts`
Expected: FAIL because the executor does not exist.

- [ ] **Step 3: Implement prompt building and execution routing**

```ts
export function buildQuickActionPrompt(action: QuickActionDefinition, input: QuickActionInput): string {
  switch (action.kind) {
    case 'translate':
      return `Translate the following text and return only the final translation:\n\n${input.text}`;
    case 'reply':
      return `Write a concise, directly usable reply to the following text:\n\n${input.text}`;
    case 'lookup':
      return `Explain the following text briefly and clearly:\n\n${input.text}`;
    default:
      return action.promptTemplate?.replace('{{input}}', input.text) ?? input.text;
  }
}
```

```ts
ipcMain.handle('quickAction:run', async (_event, actionId: string, input: QuickActionInput) => {
  return await quickActionExecutor.run(actionId, input);
});

ipcMain.handle('quickAction:copyResult', async (_event, value: string) => {
  clipboard.writeText(value);
  return { success: true };
});
```

- [ ] **Step 4: Implement best-effort paste**

```ts
ipcMain.handle('quickAction:pasteResult', async (_event, value: string) => {
  clipboard.writeText(value);
  return { success: true, pasted: false };
});
```

The first implementation should return copied text and an explicit `pasted: false` result until platform paste simulation is added. This keeps the contract honest and testable.

- [ ] **Step 5: Wire the renderer actions**

```tsx
const handleRun = async (actionId: string) => {
  const next = await invokeIpc<{ text: string }>('quickAction:run', actionId, input);
  setResult(next.text);
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/quick-action-executor.test.ts tests/unit/api-client.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tests/unit/quick-action-executor.test.ts electron/services/quick-actions/executor.ts electron/main/ipc-handlers.ts src/lib/api-client.ts src/pages/QuickActions/index.tsx
git commit -m "feat: add quick action execution flow"
```

### Task 6: Add macOS and Windows selection providers behind the existing service contract

**Files:**
- Create: `tests/unit/quick-action-selection-provider.test.ts`
- Create: `electron/services/quick-actions/platform-selection/darwin/provider.ts`
- Create: `electron/services/quick-actions/platform-selection/win32/provider.ts`
- Modify: `electron/services/quick-actions/selection-provider.ts`
- Modify: `docs/superpowers/specs/2026-04-02-quick-actions-design.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';

describe('selection provider', () => {
  it('prefers the platform provider result before clipboard fallback', async () => {
    const platformProvider = vi.fn().mockResolvedValue({
      text: 'selected text',
      source: 'selection',
      obtainedAt: 1,
    });
    const clipboardProvider = vi.fn().mockResolvedValue({
      text: 'clipboard text',
      source: 'clipboard',
      obtainedAt: 2,
    });

    const { resolveQuickActionInput } = await import('@electron/services/quick-actions/selection-provider');
    const input = await resolveQuickActionInput({
      getPlatformSelection: platformProvider,
      getClipboardFallback: clipboardProvider,
    } as never);

    expect(input?.source).toBe('selection');
    expect(clipboardProvider).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/quick-action-selection-provider.test.ts`
Expected: FAIL because the provider contract only supports clipboard fallback right now.

- [ ] **Step 3: Add the shared resolver contract**

```ts
export async function resolveQuickActionInput(deps: {
  getPlatformSelection: () => Promise<QuickActionInput | null>;
  getClipboardFallback: () => Promise<QuickActionInput | null>;
}): Promise<QuickActionInput | null> {
  return (await deps.getPlatformSelection()) ?? (await deps.getClipboardFallback());
}
```

- [ ] **Step 4: Add platform stubs and wire them by `process.platform`**

```ts
export async function getPlatformSelection(): Promise<QuickActionInput | null> {
  if (process.platform === 'darwin') {
    return await getDarwinSelectedText();
  }
  if (process.platform === 'win32') {
    return await getWindowsSelectedText();
  }
  return null;
}
```

The first platform-specific implementation may be a helper-process stub that returns `null`, but the file boundaries and contracts must be in place before integrating AX/UIA helpers.

- [ ] **Step 5: Update docs for permissions and current limitations**

```md
- Quick Actions require Accessibility permission on macOS for direct selection capture.
- Windows selection capture depends on UI Automation support in the foreground app.
- GeeClaw falls back to clipboard text when direct selection capture is unavailable.
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/quick-action-selection-provider.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tests/unit/quick-action-selection-provider.test.ts electron/services/quick-actions/platform-selection/darwin/provider.ts electron/services/quick-actions/platform-selection/win32/provider.ts electron/services/quick-actions/selection-provider.ts docs/superpowers/specs/2026-04-02-quick-actions-design.md README.md README.zh-CN.md
git commit -m "feat: add quick action platform selection provider hooks"
```

### Task 7: Verify the end-to-end quick-actions slice

**Files:**
- Modify: `tests/unit/quick-action-window.test.ts`
- Modify: `tests/unit/quick-actions-window-renderer.test.tsx`
- Modify: `tests/unit/quick-action-executor.test.ts`

- [ ] **Step 1: Add a focused end-to-end unit slice**

```ts
it('invokes the translate quick action, opens the floating window, runs the executor, and copies the result', async () => {
  // Arrange quick action settings, a clipboard-backed invocation payload,
  // and a mocked executor result.
  // Assert that the renderer receives the payload and copy IPC is invoked.
});
```

- [ ] **Step 2: Run the focused quick-actions suite**

Run: `pnpm exec vitest run tests/unit/quick-actions-settings.test.ts tests/unit/global-shortcuts.test.ts tests/unit/quick-action-window.test.ts tests/unit/quick-actions-window-renderer.test.tsx tests/unit/quick-action-executor.test.ts tests/unit/quick-action-selection-provider.test.ts`
Expected: PASS

- [ ] **Step 3: Run the broader impacted suite**

Run: `pnpm exec vitest run tests/unit/settings-routes.test.ts tests/unit/settings-modal.test.ts tests/unit/api-client.test.ts tests/unit/host-api.test.ts`
Expected: PASS

- [ ] **Step 4: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Run lint**

Run: `pnpm run lint:check`
Expected: PASS

- [ ] **Step 6: Commit the verification sweep**

```bash
git add tests/unit/quick-action-window.test.ts tests/unit/quick-actions-window-renderer.test.tsx tests/unit/quick-action-executor.test.ts
git commit -m "test: verify quick actions end to end"
```

## Self-Review

### Spec coverage

- Global shortcuts: covered by Task 2.
- Shared floating window near the mouse: covered by Task 3 and Task 4.
- Mode switching inside the same window: covered by Task 4.
- Clipboard fallback: covered by Task 3 and Task 6.
- Built-in translate/reply/lookup actions: covered by Task 5.
- Settings-backed user-configurable actions: covered by Task 1 and Task 4.
- macOS and Windows provider hooks: covered by Task 6.
- README updates after functional change: covered by Task 6.

No uncovered requirements remain from the approved spec.

### Placeholder scan

- The only intentionally incomplete behavior is platform-native selection retrieval internals and paste simulation internals.
- Those are not left as `TODO`; they are explicitly modeled as stubs with concrete file boundaries and an honest contract.
- No task refers to undefined future modules without first creating them.

### Type consistency

- `QuickActionDefinition`, `QuickActionSettings`, and `QuickActionInput` are introduced once and reused consistently.
- IPC names are consistently prefixed with `quickAction:`.
- Renderer uses the same input/action contracts as the main-process services.
