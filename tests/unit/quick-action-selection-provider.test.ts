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
    });

    expect(input?.source).toBe('selection');
    expect(clipboardProvider).not.toHaveBeenCalled();
  });

  it('captures selected text through a simulated copy and restores the clipboard', async () => {
    const writes: string[] = [];
    let clipboardValue = 'original clipboard';
    const sendCopyShortcut = vi.fn(async () => {
      clipboardValue = 'selected text';
    });

    const { captureSelectionViaSimulatedCopy } = await import('@electron/services/quick-actions/simulated-copy');
    const input = await captureSelectionViaSimulatedCopy({
      readClipboard: async () => clipboardValue,
      writeClipboard: async (value) => {
        writes.push(value);
        clipboardValue = value;
      },
      sendCopyShortcut,
      sleep: async () => undefined,
      now: () => 123,
      sentinelFactory: () => '__geeclaw_test_sentinel__',
    });

    expect(sendCopyShortcut).toHaveBeenCalledTimes(1);
    expect(input).toEqual({
      text: 'selected text',
      source: 'selection',
      obtainedAt: 123,
    });
    expect(writes).toEqual([
      '__geeclaw_test_sentinel__',
      'original clipboard',
    ]);
    expect(clipboardValue).toBe('original clipboard');
  });
});
