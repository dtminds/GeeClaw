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

export type QuickActionInputSource = 'selection' | 'clipboard';
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

export type QuickActionRunFailureReason =
  | 'action-not-found'
  | 'action-disabled'
  | 'gateway-error'
  | 'empty-result';

export type QuickActionTriggerResult =
  | {
      success: true;
      context: QuickActionContext;
    }
  | {
      success: false;
      reason: QuickActionTriggerFailureReason;
    };

export type QuickActionRunResult =
  | {
      success: true;
      actionId: string;
      text: string;
      prompt: string;
    }
  | {
      success: false;
      reason: QuickActionRunFailureReason;
      message?: string;
    };

export interface QuickActionCopyResult {
  success: true;
}

export interface QuickActionPasteResult {
  success: true;
  pasted: boolean;
}

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
