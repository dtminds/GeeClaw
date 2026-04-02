import type {
  QuickActionContext,
  QuickActionDefinition,
  QuickActionTriggerResult,
} from '@shared/quick-actions';
import { invokeIpc } from './api-client';

export async function getQuickActionLastContext(): Promise<QuickActionContext | null> {
  return await invokeIpc<QuickActionContext | null>('quickAction:getLastContext');
}

export async function listQuickActions(): Promise<QuickActionDefinition[]> {
  return await invokeIpc<QuickActionDefinition[]>('quickAction:list');
}

export async function triggerQuickAction(actionId: string): Promise<QuickActionTriggerResult> {
  return await invokeIpc<QuickActionTriggerResult>('quickAction:trigger', actionId);
}

export function subscribeQuickActionInvoked(
  listener: (context: QuickActionContext) => void,
): () => void {
  const unsubscribe = window.electron.ipcRenderer.on('quickAction:invoked', (payload) => {
    listener(payload as QuickActionContext);
  });

  return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}

export async function closeQuickActionWindow(): Promise<void> {
  await invokeIpc('window:close');
}
