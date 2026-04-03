import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserWindowMock = vi.fn();
const clipboardReadTextMock = vi.fn();
const getCursorScreenPointMock = vi.fn();
const getDisplayNearestPointMock = vi.fn();
const unregisterAllMock = vi.fn();
const registerMock = vi.fn();

function createBrowserWindowInstance() {
  return {
    loadFile: vi.fn().mockResolvedValue(undefined),
    loadURL: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    setPosition: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    webContents: {
      send: vi.fn(),
    },
  };
}

vi.mock('electron', () => ({
  BrowserWindow: function BrowserWindow(...args: unknown[]) {
    return browserWindowMock(...args);
  },
  clipboard: {
    readText: () => clipboardReadTextMock(),
  },
  screen: {
    getCursorScreenPoint: () => getCursorScreenPointMock(),
    getDisplayNearestPoint: (...args: unknown[]) => getDisplayNearestPointMock(...args),
  },
  globalShortcut: {
    register: (...args: unknown[]) => registerMock(...args),
    unregisterAll: () => unregisterAllMock(),
  },
}));

describe('quick action service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('uses the clipboard-backed provider when triggering an action', async () => {
    clipboardReadTextMock.mockReturnValue('  clipboard text  ');
    const showMock = vi.fn();

    const { createQuickActionService } = await import('@electron/services/quick-actions/service');
    const { getQuickActionInput } = await import('@electron/services/quick-actions/selection-provider');
    const service = createQuickActionService({
      showWindow: showMock,
      getQuickActionInput,
      getActionById: () => ({
        id: 'translate',
        kind: 'translate',
        title: 'Translate',
        shortcut: 'CommandOrControl+Shift+1',
        enabled: true,
        outputMode: 'copy',
      }),
    } as never);

    const result = await service.trigger('translate');

    expect(showMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'translate',
        input: expect.objectContaining({ text: 'clipboard text', source: 'clipboard' }),
      }),
    );
    expect(result).toMatchObject({
      success: true,
      context: expect.objectContaining({
        actionId: 'translate',
      }),
    });
  });
});

describe('quick action window', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('creates a hidden floating browser window shell', async () => {
    const { createQuickActionWindow } = await import('@electron/main/quick-action-window');

    createQuickActionWindow();

    expect(browserWindowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 420,
        height: 320,
        show: false,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: expect.objectContaining({
          preload: expect.stringContaining('preload/index.js'),
          contextIsolation: true,
          sandbox: false,
        }),
      }),
    );
  });

  it('positions near the cursor and sends the invocation before showing and focusing', async () => {
    const browserWindowInstance = createBrowserWindowInstance();
    browserWindowMock.mockReturnValue(browserWindowInstance);
    getCursorScreenPointMock.mockReturnValue({ x: 100, y: 200 });
    getDisplayNearestPointMock.mockReturnValue({
      workArea: { x: 0, y: 0, width: 1440, height: 900 },
    });

    const { createQuickActionWindowController } = await import('@electron/main/quick-action-window');
    const controller = createQuickActionWindowController();
    const payload = {
      actionId: 'translate',
      action: {
        id: 'translate',
        kind: 'translate',
        title: 'Translate',
        shortcut: 'CommandOrControl+Shift+1',
        enabled: true,
        outputMode: 'copy',
      },
      input: {
        text: 'clipboard text',
        source: 'clipboard',
        obtainedAt: 1,
      },
      invokedAt: 2,
      source: 'shortcut',
    } as const;

    await controller.show(payload);

    expect(browserWindowInstance.loadFile).toHaveBeenCalledWith(
      expect.stringContaining('dist/index.html'),
      expect.objectContaining({ hash: '/quick-action' }),
    );
    expect(browserWindowInstance.setPosition).toHaveBeenCalledWith(112, 212);
    expect(browserWindowInstance.webContents.send).toHaveBeenCalledWith('quickAction:invoked', payload);
    expect(browserWindowInstance.show).toHaveBeenCalledTimes(1);
    expect(browserWindowInstance.focus).toHaveBeenCalledTimes(1);
    expect(
      browserWindowInstance.webContents.send.mock.invocationCallOrder[0],
    ).toBeLessThan(browserWindowInstance.show.mock.invocationCallOrder[0]);
    expect(
      browserWindowInstance.show.mock.invocationCallOrder[0],
    ).toBeLessThan(browserWindowInstance.focus.mock.invocationCallOrder[0]);

    const blurHandler = browserWindowInstance.on.mock.calls.find(([eventName]) => eventName === 'blur')?.[1] as
      | (() => void)
      | undefined;
    blurHandler?.();
    expect(browserWindowInstance.hide).toHaveBeenCalledTimes(1);
  });
});

describe('quick action dispatch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    registerMock.mockReturnValue(true);
  });

  it('awaits the async dispatch handler for explicit triggers', async () => {
    const {
      setQuickActionDispatchHandler,
      triggerQuickAction,
    } = await import('@electron/main/global-shortcuts');
    let resolved = false;
    let releaseHandler: (() => void) | null = null;
    let settled = false;

    setQuickActionDispatchHandler(
      () =>
        new Promise<void>((resolve) => {
          releaseHandler = () => {
            resolved = true;
            resolve();
          };
        }),
    );

    const triggerPromise = triggerQuickAction('translate');
    expect(triggerPromise).toBeInstanceOf(Promise);
    void triggerPromise.then(() => {
      settled = true;
    });
    expect(resolved).toBe(false);
    expect(settled).toBe(false);

    releaseHandler?.();
    await triggerPromise;

    expect(resolved).toBe(true);
    expect(settled).toBe(true);
  });
});
