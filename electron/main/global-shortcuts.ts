import { globalShortcut } from 'electron';
import type {
  QuickActionDefinition,
  QuickActionHotkeyStatus,
  QuickActionInvocationState,
} from '../services/quick-actions/types';

let registeredActionIds: string[] = [];
let lastInvocation: QuickActionInvocationState | null = null;
let quickActionDispatchHandler: ((actionId: string) => void) | null = null;

function recordInvocation(actionId: string, source: QuickActionInvocationState['source']): void {
  lastInvocation = {
    actionId,
    invokedAt: Date.now(),
    source,
  };
}

function dispatchQuickAction(actionId: string, source: QuickActionInvocationState['source']): void {
  recordInvocation(actionId, source);
  quickActionDispatchHandler?.(actionId);
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

export function setQuickActionDispatchHandler(handler: ((actionId: string) => void) | null): void {
  quickActionDispatchHandler = handler;
}

export function triggerQuickAction(actionId: string): void {
  dispatchQuickAction(actionId, 'ipc');
}
