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

  it('registers enabled quick-action shortcuts and emits production invocation events', async () => {
    const {
      getQuickActionHotkeyStatus,
      installQuickActionDispatchTarget,
      registerQuickActionShortcuts,
      triggerQuickAction,
    } = await import('@electron/main/global-shortcuts');
    const sendMock = vi.fn();
    installQuickActionDispatchTarget({
      webContents: {
        send: sendMock,
      },
    } as never);

    registerQuickActionShortcuts([
      { id: 'translate', shortcut: 'CommandOrControl+Shift+1', enabled: true },
      { id: 'reply', shortcut: 'CommandOrControl+Shift+2', enabled: false },
      { id: 'lookup', shortcut: '   ', enabled: true },
    ] as never);

    expect(unregisterAllMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledWith('CommandOrControl+Shift+1', expect.any(Function));
    expect(getQuickActionHotkeyStatus()).toEqual({
      registered: true,
      registeredCount: 1,
      registeredActionIds: ['translate'],
      lastInvocation: null,
    });

    const callback = registerMock.mock.calls[0][1] as () => void;
    callback();
    expect(sendMock).toHaveBeenCalledWith(
      'quickAction:invoked',
      expect.objectContaining({
        actionId: 'translate',
        source: 'shortcut',
      }),
    );
    expect(getQuickActionHotkeyStatus()).toMatchObject({
      registered: true,
      registeredCount: 1,
      registeredActionIds: ['translate'],
      lastInvocation: {
        actionId: 'translate',
        source: 'shortcut',
      },
    });

    triggerQuickAction('reply');
    expect(sendMock).toHaveBeenLastCalledWith(
      'quickAction:invoked',
      expect.objectContaining({
        actionId: 'reply',
        source: 'ipc',
      }),
    );
    expect(getQuickActionHotkeyStatus()).toMatchObject({
      lastInvocation: {
        actionId: 'reply',
        source: 'ipc',
      },
    });
  });

  it('replaces the dispatch target when a new window installs', async () => {
    const {
      installQuickActionDispatchTarget,
      registerQuickActionShortcuts,
    } = await import('@electron/main/global-shortcuts');
    const firstSendMock = vi.fn();
    const secondSendMock = vi.fn();

    installQuickActionDispatchTarget({
      webContents: {
        send: firstSendMock,
      },
    } as never);
    installQuickActionDispatchTarget({
      webContents: {
        send: secondSendMock,
      },
    } as never);

    registerQuickActionShortcuts([
      { id: 'translate', shortcut: 'CommandOrControl+Shift+1', enabled: true },
    ] as never);

    const callback = registerMock.mock.calls[0][1] as () => void;
    callback();

    expect(firstSendMock).not.toHaveBeenCalled();
    expect(secondSendMock).toHaveBeenCalledWith(
      'quickAction:invoked',
      expect.objectContaining({
        actionId: 'translate',
        source: 'shortcut',
      }),
    );
  });
});
