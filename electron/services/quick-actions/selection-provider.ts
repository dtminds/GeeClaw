import { clipboard } from 'electron';

export interface QuickActionInput {
  text: string;
  source: 'clipboard';
  obtainedAt: number;
}

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
