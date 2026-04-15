import { BUILTIN_PROVIDER_TYPES, type ProviderAccount } from './types';

const CUSTOM_PROVIDER_KEY_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_RUNTIME_PROVIDER_KEYS = new Set<string>([
  ...BUILTIN_PROVIDER_TYPES,
  'google-gemini-cli',
  'openai-codex',
]);

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
  return segment.trim().toLowerCase();
}

export function getStoredCustomProviderRuntimeKey(
  metadata: ProviderAccount['metadata'] | undefined,
): string | undefined {
  const runtimeProviderKey = typeof metadata?.runtimeProviderKey === 'string'
    ? metadata.runtimeProviderKey.trim().toLowerCase()
    : '';

  if (!isValidCustomProviderKeySegment(runtimeProviderKey)) {
    return undefined;
  }

  return runtimeProviderKey;
}

export function isReservedRuntimeProviderKey(value: string): boolean {
  return RESERVED_RUNTIME_PROVIDER_KEYS.has(value.trim().toLowerCase());
}
