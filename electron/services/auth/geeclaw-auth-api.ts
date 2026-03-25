import { app } from 'electron';

export const GEECLAW_AUTH_API_ORIGIN = 'https://api-test.geeclaw.cn';

export function buildGeeclawAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    'Geeclaw-Token': accessToken,
    'GC-version': app.getVersion(),
  };
}
