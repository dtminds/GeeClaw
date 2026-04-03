import type {
  QuickActionContext,
  QuickActionDefinition,
  QuickActionInput,
  QuickActionTriggerFailureReason,
  QuickActionTriggerResult,
} from '@shared/quick-actions';
import type { QuickActionInvocationEvent } from './types';

interface QuickActionServiceDeps {
  listActions?: () => Promise<QuickActionDefinition[]> | QuickActionDefinition[];
  getActionById: (actionId: string) => Promise<QuickActionDefinition | null | undefined> | QuickActionDefinition | null | undefined;
  getQuickActionInput: () => Promise<QuickActionInput | null>;
  showWindow: (context: QuickActionContext) => void | Promise<void>;
}

export interface QuickActionService {
  list: () => Promise<QuickActionDefinition[]>;
  getLastContext: () => QuickActionContext | null;
  handleInvocation: (event: QuickActionInvocationEvent) => Promise<QuickActionTriggerResult>;
  trigger: (actionId: string) => Promise<QuickActionTriggerResult>;
}

export function createQuickActionService(deps: QuickActionServiceDeps): QuickActionService {
  let lastContext: QuickActionContext | null = null;

  const buildContext = async (
    event: QuickActionInvocationEvent,
  ): Promise<{ context: QuickActionContext } | { reason: QuickActionTriggerFailureReason }> => {
    const action = await deps.getActionById(event.actionId);
    if (!action) {
      return { reason: 'action-not-found' };
    }
    if (!action.enabled) {
      return { reason: 'action-disabled' };
    }

    const input = await deps.getQuickActionInput();
    if (!input) {
      return { reason: 'no-input' };
    }

    return {
      context: {
        actionId: action.id,
        action,
        input,
        invokedAt: event.invokedAt,
        source: event.source,
      },
    };
  };

  const handleInvocation = async (event: QuickActionInvocationEvent): Promise<QuickActionTriggerResult> => {
    const result = await buildContext(event);
    if ('reason' in result) {
      return {
        success: false,
        reason: result.reason,
      };
    }

    const { context } = result;
    lastContext = context;
    await deps.showWindow(context);
    return {
      success: true,
      context,
    };
  };

  return {
    list: async () => (await deps.listActions?.()) ?? [],
    getLastContext: () => lastContext,
    handleInvocation,
    trigger: (actionId: string) =>
      handleInvocation({
        actionId,
        invokedAt: Date.now(),
        source: 'ipc',
      }),
  };
}
