import type { QuickActionInput } from '@shared/quick-actions';

interface SimulatedCopyDeps {
  readClipboard: () => Promise<string> | string;
  writeClipboard: (value: string) => Promise<void> | void;
  sendCopyShortcut: () => Promise<void> | void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxAttempts?: number;
  pollIntervalMs?: number;
  sentinelFactory?: () => string;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function captureSelectionViaSimulatedCopy(
  deps: SimulatedCopyDeps,
): Promise<QuickActionInput | null> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const maxAttempts = deps.maxAttempts ?? 8;
  const pollIntervalMs = deps.pollIntervalMs ?? 50;
  const sentinel = deps.sentinelFactory?.() ?? `__geeclaw_selection_${now()}_${Math.random().toString(36).slice(2)}__`;
  const originalClipboard = await deps.readClipboard();

  await deps.writeClipboard(sentinel);

  try {
    await deps.sendCopyShortcut();

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await sleep(pollIntervalMs);
      const value = (await deps.readClipboard()).trim();
      if (!value || value === sentinel) {
        continue;
      }

      return {
        text: value,
        source: 'selection',
        obtainedAt: now(),
      };
    }

    return null;
  } finally {
    await deps.writeClipboard(originalClipboard);
  }
}
