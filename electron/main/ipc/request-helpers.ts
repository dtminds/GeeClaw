import type { AppSettings } from '../../utils/store';

export type AppRequest = {
  id?: string;
  module: string;
  action: string;
  payload?: unknown;
};

export type AppErrorCode = 'VALIDATION' | 'PERMISSION' | 'TIMEOUT' | 'GATEWAY' | 'INTERNAL' | 'UNSUPPORTED';

export type AppResponse = {
  id?: string;
  ok: boolean;
  data?: unknown;
  error?: {
    code: AppErrorCode;
    message: string;
    details?: unknown;
  };
};

export function mapAppErrorCode(error: unknown): AppErrorCode {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (msg.includes('timeout')) return 'TIMEOUT';
  if (msg.includes('permission') || msg.includes('denied') || msg.includes('forbidden')) return 'PERMISSION';
  if (msg.includes('gateway')) return 'GATEWAY';
  if (msg.includes('invalid') || msg.includes('required')) return 'VALIDATION';
  return 'INTERNAL';
}

const PROXY_KEYS: ReadonlyArray<keyof AppSettings> = [
  'proxyEnabled',
  'proxyServer',
  'proxyHttpServer',
  'proxyHttpsServer',
  'proxyAllServer',
  'proxyBypassRules',
];

export function isProxyKey(key: keyof AppSettings): boolean {
  return PROXY_KEYS.includes(key);
}
