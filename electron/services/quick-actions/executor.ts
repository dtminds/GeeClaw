import type {
  QuickActionDefinition,
  QuickActionInput,
  QuickActionRunResult,
} from '@shared/quick-actions';

interface QuickActionExecutorDeps {
  getActionById: (actionId: string) => Promise<QuickActionDefinition | null | undefined> | QuickActionDefinition | null | undefined;
  runPrompt: (prompt: string) => Promise<unknown>;
}

export interface QuickActionExecutor {
  run: (actionId: string, input: QuickActionInput) => Promise<QuickActionRunResult>;
}

export function buildQuickActionPrompt(action: QuickActionDefinition, input: QuickActionInput): string {
  switch (action.kind) {
    case 'translate':
      return `Translate the following text and return only the final translation:\n\n${input.text}`;
    case 'reply':
      return `Write a concise, directly usable reply to the following text. Return only the reply:\n\n${input.text}`;
    case 'lookup':
      return `Explain the following text briefly and clearly:\n\n${input.text}`;
    case 'customPrompt':
      return action.promptTemplate?.includes('{{input}}')
        ? action.promptTemplate.replaceAll('{{input}}', input.text)
        : `${action.promptTemplate?.trim() || input.text}\n\n${input.text}`;
    default:
      return input.text;
  }
}

function extractResultText(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload.trim();
  }

  if (!payload || typeof payload !== 'object') {
    return '';
  }

  if ('content' in payload && typeof payload.content === 'string') {
    return payload.content.trim();
  }

  if ('message' in payload && typeof payload.message === 'string') {
    return payload.message.trim();
  }

  if ('result' in payload) {
    return extractResultText(payload.result);
  }

  return '';
}

export function createQuickActionExecutor(deps: QuickActionExecutorDeps): QuickActionExecutor {
  return {
    async run(actionId: string, input: QuickActionInput): Promise<QuickActionRunResult> {
      const action = await deps.getActionById(actionId);
      if (!action) {
        return { success: false, reason: 'action-not-found' };
      }
      if (!action.enabled) {
        return { success: false, reason: 'action-disabled' };
      }

      const prompt = buildQuickActionPrompt(action, input);

      try {
        const payload = await deps.runPrompt(prompt);
        const text = extractResultText(payload);
        if (!text) {
          return {
            success: false,
            reason: 'empty-result',
          };
        }

        return {
          success: true,
          actionId: action.id,
          text,
          prompt,
        };
      } catch (error) {
        return {
          success: false,
          reason: 'gateway-error',
          message: String(error),
        };
      }
    },
  };
}
