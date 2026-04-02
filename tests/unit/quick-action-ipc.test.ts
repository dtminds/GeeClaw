import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpcMock = vi.fn();

vi.mock('../../src/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

describe('quick action renderer ipc api', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('passes through a failed trigger result so callers can detect no-op outcomes', async () => {
    invokeIpcMock.mockResolvedValue({
      success: false,
      reason: 'no-input',
    });

    const { triggerQuickAction } = await import('@/lib/quick-actions');
    const result = await triggerQuickAction('translate');

    expect(invokeIpcMock).toHaveBeenCalledWith('quickAction:trigger', 'translate');
    expect(result).toEqual({
      success: false,
      reason: 'no-input',
    });
  });

  it('loads the last context through the quick action wrapper', async () => {
    invokeIpcMock.mockResolvedValue({
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
    });

    const { getQuickActionLastContext } = await import('@/lib/quick-actions');
    const result = await getQuickActionLastContext();

    expect(invokeIpcMock).toHaveBeenCalledWith('quickAction:getLastContext');
    expect(result).toMatchObject({
      actionId: 'translate',
      input: {
        text: 'clipboard text',
      },
    });
  });
});
