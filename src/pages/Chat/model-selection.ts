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

  const providerSeparatorIndex = normalizedPending.indexOf('/');
  if (providerSeparatorIndex < 0) {
    return false;
  }

  return normalizedPending.slice(providerSeparatorIndex + 1) === normalizedSession;
}

export function isModelMenuItemSelected(
  activeValue: string | null | undefined,
  providerId: string,
  model: string,
): boolean {
  const normalizedActive = normalizeModelValue(activeValue);
  const normalizedModelRef = normalizeModelValue(buildProviderModelRef(providerId, model));

  if (!normalizedActive || !normalizedModelRef) {
    return false;
  }

  if (normalizedActive === normalizedModelRef) {
    return true;
  }

  if (normalizedActive.includes('/')) {
    return false;
  }

  return normalizedActive === normalizeModelValue(model);
}

export function getModelDisplayLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const segments = trimmed.split('/').filter(Boolean);
  return segments[segments.length - 1] || trimmed;
}
