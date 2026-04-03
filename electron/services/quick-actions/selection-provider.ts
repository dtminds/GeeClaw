import { clipboard } from 'electron';
import type { QuickActionInput } from '@shared/quick-actions';
import { getDarwinSelectedText } from './platform-selection/darwin/provider';
import { getWindowsSelectedText } from './platform-selection/win32/provider';

export async function getClipboardFallback(): Promise<QuickActionInput | null> {
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

export async function getPlatformSelection(): Promise<QuickActionInput | null> {
  if (process.platform === 'darwin') {
    return await getDarwinSelectedText();
  }

  if (process.platform === 'win32') {
    return await getWindowsSelectedText();
  }

  return null;
}

export async function resolveQuickActionInput(deps: {
  getPlatformSelection: () => Promise<QuickActionInput | null>;
  getClipboardFallback: () => Promise<QuickActionInput | null>;
}): Promise<QuickActionInput | null> {
  return (await deps.getPlatformSelection()) ?? (await deps.getClipboardFallback());
}

export async function getQuickActionInput(options?: {
  allowClipboardFallback?: boolean;
}): Promise<QuickActionInput | null> {
  if (options?.allowClipboardFallback === false) {
    return await getPlatformSelection();
  }

  return await resolveQuickActionInput({
    getPlatformSelection,
    getClipboardFallback,
  });
}
