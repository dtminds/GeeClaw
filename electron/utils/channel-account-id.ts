const CANONICAL_CHANNEL_ACCOUNT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const INVALID_CHANNEL_ACCOUNT_ID_ERROR =
  'Invalid accountId format. Use lowercase letters, numbers, hyphens, or underscores only (max 64 chars, must start with a letter or number).';

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
