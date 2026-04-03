import { describe, expect, it } from 'vitest';

describe('quick action executor', () => {
  it('builds translate prompts from the selected input text', async () => {
    const { buildQuickActionPrompt } = await import('@electron/services/quick-actions/executor');

    expect(buildQuickActionPrompt(
      {
        id: 'translate',
        title: 'Translate',
        kind: 'translate',
        shortcut: 'CommandOrControl+Shift+1',
        enabled: true,
        outputMode: 'copy',
      },
      {
        text: 'Hello world',
        source: 'selection',
        obtainedAt: 1,
      },
    )).toContain('Translate the following text');
  });
});
