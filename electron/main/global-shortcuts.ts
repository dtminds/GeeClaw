import { globalShortcut } from 'electron';
import type {
  QuickActionDefinition,
  QuickActionHotkeyStatus,
  QuickActionInvocationState,
} from '../services/quick-actions/types';

let registeredActionIds: string[] = [];
let lastInvocation: QuickActionInvocationState | null = null;

function recordInvocation(actionId: string, source: QuickActionInvocationState['source']): void {
  lastInvocation = {
    actionId,
    invokedAt: Date.now(),
    source,
  };
}

export function registerQuickActionShortcuts(
  actions: QuickActionDefinition[],
  onInvoke: (actionId: string) => void,
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
      recordInvocation(action.id, 'shortcut');
      onInvoke(action.id);
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

export function triggerQuickAction(actionId: string): void {
  recordInvocation(actionId, 'ipc');
}
