import type { ProviderAccount } from './types';

const CUSTOM_PROVIDER_RUNTIME_KEY_PREFIX = 'custom-';
const CUSTOM_PROVIDER_KEY_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugifyCustomProviderKeySegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function isValidCustomProviderKeySegment(value: string): boolean {
  return CUSTOM_PROVIDER_KEY_SEGMENT_PATTERN.test(value.trim().toLowerCase());
}

export function buildCustomProviderRuntimeKey(segment: string): string {
  return `${CUSTOM_PROVIDER_RUNTIME_KEY_PREFIX}${segment.trim().toLowerCase()}`;
}

export function getStoredCustomProviderRuntimeKey(
  metadata: ProviderAccount['metadata'] | undefined,
): string | undefined {
  const runtimeProviderKey = typeof metadata?.runtimeProviderKey === 'string'
    ? metadata.runtimeProviderKey.trim().toLowerCase()
    : '';

  if (!runtimeProviderKey.startsWith(CUSTOM_PROVIDER_RUNTIME_KEY_PREFIX)) {
    return undefined;
  }

  const segment = runtimeProviderKey.slice(CUSTOM_PROVIDER_RUNTIME_KEY_PREFIX.length);
  if (!isValidCustomProviderKeySegment(segment)) {
    return undefined;
  }

  return runtimeProviderKey;
}
