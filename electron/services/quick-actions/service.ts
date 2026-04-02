import type { QuickActionDefinition } from '@shared/quick-actions';
import type { QuickActionInvocationEvent } from './types';
import type { QuickActionInput } from './selection-provider';

export interface QuickActionContext {
  actionId: string;
  action: QuickActionDefinition;
  input: QuickActionInput;
  invokedAt: number;
  source: QuickActionInvocationEvent['source'];
}

interface QuickActionServiceDeps {
  listActions?: () => Promise<QuickActionDefinition[]> | QuickActionDefinition[];
  getActionById: (actionId: string) => Promise<QuickActionDefinition | null | undefined> | QuickActionDefinition | null | undefined;
  getQuickActionInput: () => Promise<QuickActionInput | null>;
  showWindow: (context: QuickActionContext) => void | Promise<void>;
}

export interface QuickActionService {
  list: () => Promise<QuickActionDefinition[]>;
  getLastContext: () => QuickActionContext | null;
  handleInvocation: (event: QuickActionInvocationEvent) => Promise<QuickActionContext | null>;
  trigger: (actionId: string) => Promise<QuickActionContext | null>;
}

export function createQuickActionService(deps: QuickActionServiceDeps): QuickActionService {
  let lastContext: QuickActionContext | null = null;

  const buildContext = async (event: QuickActionInvocationEvent): Promise<QuickActionContext | null> => {
    const action = await deps.getActionById(event.actionId);
    if (!action || !action.enabled) {
      return null;
    }

    const input = await deps.getQuickActionInput();
    if (!input) {
      return null;
    }

    return {
      actionId: action.id,
      action,
      input,
      invokedAt: event.invokedAt,
      source: event.source,
    };
  };

  const handleInvocation = async (event: QuickActionInvocationEvent): Promise<QuickActionContext | null> => {
    const context = await buildContext(event);
    if (!context) {
      return null;
    }

    lastContext = context;
    await deps.showWindow(context);
    return context;
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
