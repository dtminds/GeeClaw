import { globalShortcut } from 'electron';
import type {
  QuickActionDefinition,
  QuickActionInvocationEvent,
  QuickActionHotkeyStatus,
  QuickActionInvocationState,
} from '../services/quick-actions/types';

let registeredActionIds: string[] = [];
let lastInvocation: QuickActionInvocationState | null = null;
let quickActionDispatchHandler: ((event: QuickActionInvocationEvent) => void) | null = null;

function dispatchQuickAction(actionId: string, source: QuickActionInvocationState['source']): void {
  const invocation = {
    actionId,
    invokedAt: Date.now(),
    source,
  } satisfies QuickActionInvocationEvent;
  lastInvocation = invocation;
  quickActionDispatchHandler?.(invocation);
}

export function registerQuickActionShortcuts(
  actions: QuickActionDefinition[],
): void {
  globalShortcut.unregisterAll();
  registeredActionIds = [];

  for (const action of actions) {
    if (!action.enabled) {
      continue;
    }

    const shortcut = action.shortcut.trim();
    if (!shortcut) {
      continue;
    }

    const registered = globalShortcut.register(shortcut, () => {
      dispatchQuickAction(action.id, 'shortcut');
    });

    if (registered) {
      registeredActionIds.push(action.id);
    }
  }
}

export function getQuickActionHotkeyStatus(): QuickActionHotkeyStatus {
  return {
    registered: registeredActionIds.length > 0,
    registeredCount: registeredActionIds.length,
    registeredActionIds: [...registeredActionIds],
    lastInvocation,
  };
}

export function setQuickActionDispatchHandler(
  handler: ((event: QuickActionInvocationEvent) => void) | null,
): void {
  quickActionDispatchHandler = handler;
}

export function installQuickActionDispatchTarget(target: {
  webContents: Pick<Electron.WebContents, 'send'>;
}): void {
  setQuickActionDispatchHandler((event) => {
    target.webContents.send('quickAction:invoked', event);
  });
}

export function clearQuickActionDispatchTarget(): void {
  setQuickActionDispatchHandler(null);
}

export function triggerQuickAction(actionId: string): void {
  dispatchQuickAction(actionId, 'ipc');
}
