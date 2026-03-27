import { shell } from 'electron';
import { logger } from './logger';

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export async function openSafeExternalUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    logger.warn(`Blocked openExternal for malformed URL: ${url}`);
    return false;
  }

  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    logger.warn(`Blocked openExternal for disallowed protocol: ${parsed.protocol}`);
    return false;
  }

  await shell.openExternal(url);
  return true;
}
