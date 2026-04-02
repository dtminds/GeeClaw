import { clipboard } from 'electron';
import type { QuickActionInput } from '@shared/quick-actions';

export async function getQuickActionInput(): Promise<QuickActionInput | null> {
  const clipboardText = clipboard.readText().trim();
  if (!clipboardText) {
    return null;
  }

  return {
    text: clipboardText,
    source: 'clipboard',
    obtainedAt: Date.now(),
  };
}
