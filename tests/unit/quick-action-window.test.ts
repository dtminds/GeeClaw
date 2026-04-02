import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserWindowMock = vi.fn();
const clipboardReadTextMock = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: browserWindowMock,
  clipboard: {
    readText: () => clipboardReadTextMock(),
  },
}));

describe('quick action service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

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
      getActionById: () => ({
        id: 'translate',
        kind: 'translate',
        title: 'Translate',
        shortcut: 'CommandOrControl+Shift+1',
        enabled: true,
        outputMode: 'copy',
      }),
    } as never);

    await service.trigger('translate');

    expect(showMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'translate',
        input: expect.objectContaining({ text: 'clipboard text', source: 'clipboard' }),
      }),
    );
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
});
