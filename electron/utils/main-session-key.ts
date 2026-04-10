import { readOpenClawConfig } from './channel-config';

const DEFAULT_MAIN_SESSION_KEY = 'geeclaw_main';

type OpenClawSessionConfig = {
  session?: {
    mainKey?: unknown;
  };
};

export function normalizeMainKey(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_MAIN_SESSION_KEY;
  const trimmed = value.trim().toLowerCase();
  return trimmed || DEFAULT_MAIN_SESSION_KEY;
}

export function isMainGatewaySessionKey(sessionKey: string, mainKey: string): boolean {
  if (!sessionKey.startsWith('agent:')) {
    return false;
  }

  const parts = sessionKey.split(':');
  return parts.length === 3 && Boolean(parts[1]) && parts[2] === mainKey;
}

export async function resolveConfiguredMainKey(): Promise<string> {
  const config = await readOpenClawConfig() as OpenClawSessionConfig | null;
  return normalizeMainKey(config?.session?.mainKey);
}
