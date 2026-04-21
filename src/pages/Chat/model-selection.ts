export function normalizeModelValue(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function buildProviderModelRef(providerId: string, model: string): string {
  const trimmedProviderId = providerId.trim();
  const trimmedModel = model.trim();

  if (!trimmedProviderId) {
    return trimmedModel;
  }

  if (!trimmedModel) {
    return trimmedProviderId;
  }

  return trimmedModel.startsWith(`${trimmedProviderId}/`)
    ? trimmedModel
    : `${trimmedProviderId}/${trimmedModel}`;
}

interface ModelSelectionMessageLike {
  role?: string | null;
  content?: unknown;
  provider?: string | null;
  model?: string | null;
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((block): block is { type?: string; text?: string } => Boolean(block) && typeof block === 'object')
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text!.trim())
    .filter(Boolean)
    .join('\n');
}

function extractModelCommandValue(content: unknown): string | null {
  const messageText = extractMessageText(content).trim();
  if (!messageText) {
    return null;
  }

  const match = messageText.match(/^\/model\s+(.+)$/i);
  const value = match?.[1]?.trim();
  return value || null;
}

export function findModelSelectionHint(
  messages: Iterable<ModelSelectionMessageLike | null | undefined> | null | undefined,
  sessionValue?: string | null,
  allowedModelRefs?: Iterable<string | null | undefined> | null,
): string | null {
  const normalizedSession = normalizeModelValue(sessionValue);
  const entries = Array.isArray(messages) ? messages : Array.from(messages ?? []);
  const allowedRefs = allowedModelRefs
    ? new Set(
      Array.from(allowedModelRefs)
        .map((value) => normalizeModelValue(value))
        .filter(Boolean),
    )
    : null;
  let fallbackRuntimeRef: string | null = null;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = entries[index];
    if (!message) {
      continue;
    }

    if (message.role === 'user') {
      const explicitSelection = extractModelCommandValue(message.content);
      if (explicitSelection && (!allowedRefs || allowedRefs.has(normalizeModelValue(explicitSelection)))) {
        return explicitSelection;
      }
    }

    const providerId = message.provider?.trim();
    const model = message.model?.trim();
    if (!providerId || !model) {
      continue;
    }

    const runtimeRef = buildProviderModelRef(providerId, model);
    const normalizedRuntimeRef = normalizeModelValue(runtimeRef);
    if (allowedRefs && !allowedRefs.has(normalizedRuntimeRef)) {
      continue;
    }

    if (!normalizedSession) {
      return runtimeRef;
    }

    const normalizedModel = normalizeModelValue(model);
    if (normalizedRuntimeRef === normalizedSession || normalizedModel === normalizedSession) {
      return runtimeRef;
    }

    fallbackRuntimeRef ??= runtimeRef;
  }

  return fallbackRuntimeRef;
}

export function pendingModelSelectionMatchesSession(
  pendingValue: string | null | undefined,
  sessionValue: string | null | undefined,
): boolean {
  const normalizedPending = normalizeModelValue(pendingValue);
  const normalizedSession = normalizeModelValue(sessionValue);

  if (!normalizedPending || !normalizedSession) {
    return false;
  }

  if (normalizedPending === normalizedSession) {
    return true;
  }

  return false;
}

export function isModelMenuItemSelected(
  activeValue: string | null | undefined,
  providerId: string,
  model: string,
  bareModelOptionCount = 1,
): boolean {
  const normalizedActive = normalizeModelValue(activeValue);
  const normalizedModelRef = normalizeModelValue(buildProviderModelRef(providerId, model));
  const normalizedModel = normalizeModelValue(model);

  if (!normalizedActive || !normalizedModelRef || !normalizedModel) {
    return false;
  }

  if (normalizedActive === normalizedModelRef) {
    return true;
  }

  if (normalizedActive.includes('/')) {
    return false;
  }

  if (normalizedActive !== normalizedModel) {
    return false;
  }

  return bareModelOptionCount === 1;
}

export function getModelDisplayLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const segments = trimmed.split('/').filter(Boolean);
  return segments[segments.length - 1] || trimmed;
}
