# OpenClaw Sidecar Startup Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface explicit startup feedback when GeeClaw is extracting or updating the packaged OpenClaw sidecar so users understand long first-run waits.

**Architecture:** Keep the existing startup flow and sidecar extraction timing unchanged. Add a minimal main-process sidecar status publisher, forward it to the renderer as a host event / IPC event, and let the `Startup` page refine its existing `preparing` copy based on that status.

**Tech Stack:** Electron main/preload IPC, React 19, Zustand bootstrap flow, Vitest, Testing Library

---

### Task 1: Lock Startup Copy Behavior With Tests

**Files:**
- Create: `tests/unit/startup-sidecar-status.test.tsx`
- Test: `tests/unit/host-events.test.ts`

- [ ] **Step 1: Write the failing startup feedback test**

```tsx
it('shows OpenClaw runtime preparation copy while the packaged sidecar is extracting', async () => {
  subscribeHostEventMock.mockImplementation((eventName, handler) => {
    if (eventName === 'openclaw:sidecar-status') {
      sidecarHandler = handler;
    }
    return () => {};
  });

  const { Startup } = await import('@/pages/Startup');
  render(<Startup />);

  sidecarHandler?.({ stage: 'extracting', version: '2026.4.10' });

  expect(screen.getByText('正在准备 OpenClaw 运行时')).toBeInTheDocument();
  expect(screen.getByText('首次启动需要解压运行时，请保持窗口打开。')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/startup-sidecar-status.test.tsx`

Expected: FAIL because `Startup` does not yet subscribe to or render sidecar status copy.

- [ ] **Step 3: Add the IPC host-event mapping test**

```ts
it('maps openclaw sidecar status host events through IPC', async () => {
  const onMock = vi.mocked(window.electron.ipcRenderer.on);
  const cleanup = vi.fn();
  onMock.mockImplementation((_, cb) => {
    captured.push(cb);
    return cleanup;
  });

  const { subscribeHostEvent } = await import('@/lib/host-events');
  const handler = vi.fn();
  const unsubscribe = subscribeHostEvent('openclaw:sidecar-status', handler);

  expect(onMock).toHaveBeenCalledWith('openclaw:sidecar-status', expect.any(Function));
  captured[0]({ stage: 'extracting', version: '2026.4.10' });
  expect(handler).toHaveBeenCalledWith({ stage: 'extracting', version: '2026.4.10' });
  unsubscribe();
});
```

- [ ] **Step 4: Run the host-events test to verify it fails**

Run: `pnpm exec vitest run tests/unit/host-events.test.ts`

Expected: FAIL because `openclaw:sidecar-status` is not mapped yet.

### Task 2: Publish Sidecar Materialization Status From Main

**Files:**
- Create: `electron/utils/openclaw-sidecar-status.ts`
- Modify: `electron/utils/openclaw-sidecar.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/lib/host-events.ts`

- [ ] **Step 1: Add the shared sidecar status module**

```ts
export type OpenClawSidecarStage = 'idle' | 'extracting' | 'ready' | 'error';

export interface OpenClawSidecarStatus {
  stage: OpenClawSidecarStage;
  version?: string;
  previousVersion?: string;
  error?: string;
}
```

- [ ] **Step 2: Emit extracting / ready / error updates from sidecar materialization**

```ts
setOpenClawSidecarStatus({
  stage: 'extracting',
  version: archiveMetadata?.version,
  previousVersion: previousStamp,
});
```

- [ ] **Step 3: Forward sidecar status changes to the renderer**

```ts
subscribeOpenClawSidecarStatus((status) => {
  hostEventBus.emit('openclaw:sidecar-status', status);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('openclaw:sidecar-status', status);
  }
});
```

- [ ] **Step 4: Allow the new IPC / host-event channel through preload and host-events mapping**

```ts
'openclaw:sidecar-status',
```

### Task 3: Render Sidecar-Specific Preparing Copy

**Files:**
- Modify: `src/pages/Startup/index.tsx`
- Modify: `src/i18n/locales/zh/setup.json`
- Modify: `src/i18n/locales/en/setup.json`

- [ ] **Step 1: Subscribe to the sidecar status inside `Startup`**

```tsx
useEffect(() => {
  return subscribeHostEvent<OpenClawSidecarStatus>('openclaw:sidecar-status', setSidecarStatus);
}, []);
```

- [ ] **Step 2: Refine `loadingCopy` for extraction vs update**

```tsx
if (phase === 'preparing' && sidecarStatus?.stage === 'extracting') {
  const isUpgrade = Boolean(sidecarStatus.previousVersion && sidecarStatus.version && sidecarStatus.previousVersion !== sidecarStatus.version);
  return isUpgrade
    ? {
        title: t('startup.preparing.openclawUpdatingTitle', { version: sidecarStatus.version }),
        caption: t('startup.preparing.openclawUpdatingCaption', { version: sidecarStatus.version }),
      }
    : {
        title: t('startup.preparing.openclawExtractingTitle'),
        caption: t('startup.preparing.openclawExtractingCaption'),
      };
}
```

- [ ] **Step 3: Add locale strings**

```json
"openclawExtractingTitle": "正在准备 OpenClaw 运行时",
"openclawExtractingCaption": "首次启动需要解压运行时，请保持窗口打开。",
"openclawUpdatingTitle": "正在更新 OpenClaw 到 {{version}}",
"openclawUpdatingCaption": "正在替换内置运行时，请保持窗口打开。"
```

### Task 4: Verify

**Files:**
- Test: `tests/unit/startup-sidecar-status.test.tsx`
- Test: `tests/unit/host-events.test.ts`

- [ ] **Step 1: Run the focused tests**

Run: `pnpm exec vitest run tests/unit/startup-sidecar-status.test.tsx tests/unit/host-events.test.ts`

Expected: PASS

- [ ] **Step 2: Run a broader regression slice**

Run: `pnpm exec vitest run tests/unit/startup-invite.test.tsx tests/unit/openclaw-sidecar.test.ts tests/unit/openclaw-paths.test.ts`

Expected: PASS
