import type { QuickActionInput } from '@shared/quick-actions';
import { clipboard } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { captureSelectionViaSimulatedCopy } from '../../simulated-copy';

const execFileAsync = promisify(execFile);

export async function getWindowsSelectedText(): Promise<QuickActionInput | null> {
  try {
    return await captureSelectionViaSimulatedCopy({
      readClipboard: () => clipboard.readText(),
      writeClipboard: (value) => {
        clipboard.writeText(value);
      },
      sendCopyShortcut: async () => {
        await execFileAsync('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys('^c')",
        ]);
      },
    });
  } catch {
    return null;
  }
}
