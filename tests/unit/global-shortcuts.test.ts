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
