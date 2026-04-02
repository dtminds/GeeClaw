export type QuickActionKind = 'translate' | 'reply' | 'lookup' | 'customPrompt';
export type QuickActionOutputMode = 'copy' | 'paste';

export interface QuickActionDefinition {
  id: string;
  title: string;
  kind: QuickActionKind;
  shortcut: string;
  enabled: boolean;
  icon?: string;
  promptTemplate?: string;
  outputMode: QuickActionOutputMode;
}

export type QuickActionInputSource = 'clipboard';
export type QuickActionInvocationSource = 'shortcut' | 'ipc';

export interface QuickActionInput {
  text: string;
  source: QuickActionInputSource;
  obtainedAt: number;
}

export interface QuickActionContext {
  actionId: string;
  action: QuickActionDefinition;
  input: QuickActionInput;
  invokedAt: number;
  source: QuickActionInvocationSource;
}

export type QuickActionTriggerFailureReason = 'action-not-found' | 'action-disabled' | 'no-input';

export type QuickActionTriggerResult =
  | {
      success: true;
      context: QuickActionContext;
    }
  | {
      success: false;
      reason: QuickActionTriggerFailureReason;
    };

export interface QuickActionSettings {
  actions: QuickActionDefinition[];
  closeOnCopy: boolean;
  preferClipboardFallback: boolean;
}

export const DEFAULT_QUICK_ACTIONS: QuickActionSettings = {
  actions: [
    {
      id: 'translate',
      title: 'Translate',
      kind: 'translate',
      shortcut: 'CommandOrControl+Shift+1',
      enabled: true,
      outputMode: 'copy',
    },
    {
      id: 'reply',
      title: 'Reply',
      kind: 'reply',
      shortcut: 'CommandOrControl+Shift+2',
      enabled: true,
      outputMode: 'copy',
    },
    {
      id: 'lookup',
      title: 'Lookup',
      kind: 'lookup',
      shortcut: 'CommandOrControl+Shift+3',
      enabled: true,
      outputMode: 'copy',
    },
  ],
  closeOnCopy: true,
  preferClipboardFallback: true,
};
