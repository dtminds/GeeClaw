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
});
