import type { QuickActionDefinition } from '@shared/quick-actions';

export type { QuickActionDefinition };

export interface QuickActionInvocationState {
  actionId: string;
  invokedAt: number;
  source: 'shortcut' | 'ipc';
}

export interface QuickActionHotkeyStatus {
  registered: boolean;
  registeredCount: number;
  registeredActionIds: string[];
  lastInvocation: QuickActionInvocationState | null;
}
