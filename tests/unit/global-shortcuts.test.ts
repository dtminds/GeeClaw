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

  it('registers enabled quick-action shortcuts and tracks shortcut versus ipc invocation state', async () => {
    const {
      getQuickActionHotkeyStatus,
      registerQuickActionShortcuts,
      triggerQuickAction,
    } = await import('@electron/main/global-shortcuts');
    const onInvoke = vi.fn();

    registerQuickActionShortcuts([
      { id: 'translate', shortcut: 'CommandOrControl+Shift+1', enabled: true },
      { id: 'reply', shortcut: 'CommandOrControl+Shift+2', enabled: false },
      { id: 'lookup', shortcut: '   ', enabled: true },
    ] as never, onInvoke);

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
    expect(onInvoke).toHaveBeenCalledWith('translate');
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
    expect(getQuickActionHotkeyStatus()).toMatchObject({
      lastInvocation: {
        actionId: 'reply',
        source: 'ipc',
      },
    });
  });
});
