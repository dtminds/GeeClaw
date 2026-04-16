const CANONICAL_CHANNEL_ACCOUNT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const INVALID_CHANNEL_ACCOUNT_ID_ERROR =
  'Invalid accountId format. Use lowercase letters, numbers, hyphens, or underscores only (max 64 chars, must start with a letter or number).';
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_INVALID_RE = /^[^a-z0-9]+/;
const TRAILING_DASH_RE = /-+$/;
const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function normalizeOptionalChannelAccountId(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed || undefined;
}

export function resolveChannelAccountId(value: string | null | undefined, fallback = 'default'): string {
  return normalizeOptionalChannelAccountId(value) ?? fallback;
}

export function isCanonicalChannelAccountId(value: string | null | undefined): boolean {
  const normalized = normalizeOptionalChannelAccountId(value);
  return normalized ? CANONICAL_CHANNEL_ACCOUNT_ID_RE.test(normalized) : false;
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function deriveChannelAccountIdFromExternalValue(
  value: string | null | undefined,
  fallbackPrefix = 'account',
): string {
  const trimmed = (value ?? '').trim();
  const normalizedPrefix = (fallbackPrefix || 'account')
    .toLowerCase()
    .replace(INVALID_CHARS_RE, '-')
    .replace(LEADING_INVALID_RE, '')
    .replace(TRAILING_DASH_RE, '')
    || 'account';

  if (!trimmed) {
    return `${normalizedPrefix}-${stableHash(normalizedPrefix)}`.slice(0, 64);
  }

  const candidate = trimmed
    .toLowerCase()
    .replace(INVALID_CHARS_RE, '-')
    .replace(LEADING_INVALID_RE, '')
    .replace(TRAILING_DASH_RE, '')
    .slice(0, 64);

  if (candidate && !BLOCKED_OBJECT_KEYS.has(candidate) && CANONICAL_CHANNEL_ACCOUNT_ID_RE.test(candidate)) {
    return candidate;
  }

  return `${normalizedPrefix}-${stableHash(trimmed)}`.slice(0, 64);
}
