import { globalShortcut } from 'electron';
import type { QuickActionTriggerResult } from '@shared/quick-actions';
import type {
  QuickActionDefinition,
  QuickActionInvocationEvent,
  QuickActionHotkeyStatus,
  QuickActionInvocationState,
} from '../services/quick-actions/types';

let registeredActionIds: string[] = [];
let lastInvocation: QuickActionInvocationState | null = null;
let quickActionDispatchHandler: ((event: QuickActionInvocationEvent) => unknown | Promise<unknown>) | null = null;

async function dispatchQuickAction(
  actionId: string,
  source: QuickActionInvocationState['source'],
): Promise<QuickActionTriggerResult | undefined> {
  const invocation = {
    actionId,
    invokedAt: Date.now(),
    source,
  } satisfies QuickActionInvocationEvent;
  lastInvocation = invocation;
  return await quickActionDispatchHandler?.(invocation) as QuickActionTriggerResult | undefined;
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
      void dispatchQuickAction(action.id, 'shortcut').catch((error) => {
        console.warn('[quick-actions] Failed to dispatch shortcut invocation', error);
      });
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
  handler: ((event: QuickActionInvocationEvent) => unknown | Promise<unknown>) | null,
): void {
  quickActionDispatchHandler = handler;
}

export function installQuickActionDispatchTarget(target: {
  webContents: {
    send: (channel: string, payload: QuickActionInvocationEvent) => void | Promise<void>;
  };
}): void {
  setQuickActionDispatchHandler((event) => {
    target.webContents.send('quickAction:invoked', event);
  });
}

export function clearQuickActionDispatchTarget(): void {
  setQuickActionDispatchHandler(null);
}

export function triggerQuickAction(actionId: string): Promise<QuickActionTriggerResult | undefined> {
  return dispatchQuickAction(actionId, 'ipc');
}
