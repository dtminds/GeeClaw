import { getGeeClawAppEnvStore } from '../services/app-env/store-instance';

export interface ManagedAppEnvironmentEntry {
  key: string;
  value: string;
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function normalizeEntry(
  rawEntry: unknown,
  index: number,
): ManagedAppEnvironmentEntry | null {
  if (!rawEntry || typeof rawEntry !== 'object') {
    throw new Error(`Environment entry at index ${index} must be an object`);
  }

  const key = typeof (rawEntry as { key?: unknown }).key === 'string'
    ? (rawEntry as { key: string }).key.trim()
    : '';
  const value = typeof (rawEntry as { value?: unknown }).value === 'string'
    ? (rawEntry as { value: string }).value
    : '';

  if (!key && !value.trim()) {
    return null;
  }

  if (!key) {
    throw new Error(`Environment entry at index ${index} is missing a key`);
  }

  if (!ENV_KEY_PATTERN.test(key)) {
    throw new Error(`Environment key "${key}" is invalid`);
  }

  if (!value.trim()) {
    throw new Error(`Environment key "${key}" is missing a value`);
  }

  return { key, value };
}

function normalizeManagedEntries(entries: unknown): ManagedAppEnvironmentEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const normalized: ManagedAppEnvironmentEntry[] = [];
  const seenKeys = new Set<string>();

  entries.forEach((entry, index) => {
    const normalizedEntry = normalizeEntry(entry, index);
    if (!normalizedEntry) {
      return;
    }

    const dedupeKey = normalizedEntry.key.toUpperCase();
    if (seenKeys.has(dedupeKey)) {
      throw new Error(`Duplicate environment key "${normalizedEntry.key}"`);
    }

    seenKeys.add(dedupeKey);
    normalized.push(normalizedEntry);
  });

  return normalized;
}

export async function getManagedAppEnvironmentEntries(): Promise<ManagedAppEnvironmentEntry[]> {
  const store = await getGeeClawAppEnvStore();
  return normalizeManagedEntries(store.get('managedEnvironmentEntries'));
}

export async function replaceManagedAppEnvironmentEntries(entries: unknown): Promise<ManagedAppEnvironmentEntry[]> {
  const normalizedEntries = normalizeManagedEntries(entries);
  const store = await getGeeClawAppEnvStore();
  store.set('managedEnvironmentEntries', normalizedEntries);
  return normalizedEntries;
}

export async function resolveGeeClawAppEnvironment(
  baseEnv: Record<string, string | undefined> = process.env,
): Promise<Record<string, string | undefined>> {
  const managedEntries = await getManagedAppEnvironmentEntries();

  return managedEntries.reduce<Record<string, string | undefined>>((resolvedEnv, entry) => {
    resolvedEnv[entry.key] = entry.value;
    return resolvedEnv;
  }, { ...baseEnv });
}
