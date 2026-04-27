import { invokeIpc } from '@/lib/api-client';
import { trackUiEvent } from './telemetry';
import { normalizeAppError } from './error-model';

const DEFAULT_HOST_API_BASE = 'http://127.0.0.1:13210';

let cachedHostApiToken: string | null = null;
let cachedHostApiBase: string | null = null;

async function getHostApiBase(): Promise<string> {
  if (cachedHostApiBase !== null) {
    return cachedHostApiBase;
  }

  try {
    const base = await invokeIpc<string>('hostapi:base');
    cachedHostApiBase = typeof base === 'string' && base ? base : DEFAULT_HOST_API_BASE;
    return cachedHostApiBase;
  } catch {
    cachedHostApiBase = DEFAULT_HOST_API_BASE;
    return cachedHostApiBase;
  }
}

async function getHostApiToken(): Promise<string> {
  if (cachedHostApiToken !== null) {
    return cachedHostApiToken;
  }

  try {
    const token = await invokeIpc<string>('hostapi:token');
    cachedHostApiToken = typeof token === 'string' ? token : '';
    return cachedHostApiToken;
  } catch {
    return '';
  }
}

type HostApiProxyResponse = {
  ok?: boolean;
  data?: {
    status?: number;
    ok?: boolean;
    json?: unknown;
    text?: string;
  };
  error?: { message?: string } | string;
  // backward compatibility fields
  success: boolean;
  status?: number;
  json?: unknown;
  text?: string;
};

type HostApiProxyData = {
  status?: number;
  ok?: boolean;
  json?: unknown;
  text?: string;
};

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // ignore body parse failure
    }
    throw normalizeAppError(new Error(message), {
      source: 'browser-fallback',
      status: response.status,
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

function resolveProxyErrorMessage(error: HostApiProxyResponse['error']): string {
  return typeof error === 'string'
    ? error
    : (error?.message || 'Host API proxy request failed');
}

function parseUnifiedProxyResponse<T>(
  response: HostApiProxyResponse,
  path: string,
  method: string,
  startedAt: number,
): T {
  if (!response.ok) {
    throw new Error(resolveProxyErrorMessage(response.error));
  }

  const data: HostApiProxyData = response.data ?? {};
  if (!data.ok) {
    const message = data.text
      || (typeof data.json === 'object' && data.json != null && 'error' in (data.json as Record<string, unknown>)
        ? String((data.json as Record<string, unknown>).error)
        : `HTTP ${data.status ?? 'unknown'}`);
    throw new Error(message);
  }

  trackUiEvent('hostapi.fetch', {
    path,
    method,
    source: 'ipc-proxy',
    durationMs: Date.now() - startedAt,
    status: data.status ?? 200,
  });

  if (data.status === 204) return undefined as T;
  if (data.json !== undefined) return data.json as T;
  return data.text as T;
}

function parseLegacyProxyResponse<T>(
  response: HostApiProxyResponse,
  path: string,
  method: string,
  startedAt: number,
): T {
  if (!response.success) {
    throw new Error(resolveProxyErrorMessage(response.error));
  }

  if (!response.ok) {
    const message = response.text
      || (typeof response.json === 'object' && response.json != null && 'error' in (response.json as Record<string, unknown>)
        ? String((response.json as Record<string, unknown>).error)
        : `HTTP ${response.status ?? 'unknown'}`);
    throw new Error(message);
  }

  trackUiEvent('hostapi.fetch', {
    path,
    method,
    source: 'ipc-proxy-legacy',
    durationMs: Date.now() - startedAt,
    status: response.status ?? 200,
  });

  if (response.status === 204) return undefined as T;
  if (response.json !== undefined) return response.json as T;
  return response.text as T;
}

function shouldFallbackToBrowser(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('invalid ipc channel: hostapi:fetch')
    || normalized.includes("no handler registered for 'hostapi:fetch'")
    || normalized.includes('no handler registered for "hostapi:fetch"')
    || normalized.includes('no handler registered for hostapi:fetch')
    || normalized.includes('window is not defined');
}

export async function hostApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const startedAt = Date.now();
  const method = init?.method || 'GET';
  // In Electron renderer, always proxy through main process to avoid CORS.
  try {
    const response = await invokeIpc<HostApiProxyResponse>('hostapi:fetch', {
      path,
      method,
      headers: headersToRecord(init?.headers),
      body: init?.body ?? null,
    });

    if (typeof response?.ok === 'boolean' && 'data' in response) {
      return parseUnifiedProxyResponse<T>(response, path, method, startedAt);
    }

    return parseLegacyProxyResponse<T>(response, path, method, startedAt);
  } catch (error) {
    const normalized = normalizeAppError(error, { source: 'ipc-proxy', path, method });
    const message = normalized.message;
    trackUiEvent('hostapi.fetch_error', {
      path,
      method,
      source: 'ipc-proxy',
      durationMs: Date.now() - startedAt,
      message,
      code: normalized.code,
    });
    if (!shouldFallbackToBrowser(message)) {
      throw normalized;
    }
  }

  // Browser-only fallback (non-Electron environments).
  const base = await getHostApiBase();
  const token = await getHostApiToken();
  const headers = headersToRecord(init?.headers);
  if (init?.body !== undefined && init.body !== null && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
  });
  trackUiEvent('hostapi.fetch', {
    path,
    method,
    source: 'browser-fallback',
    durationMs: Date.now() - startedAt,
    status: response.status,
  });
  try {
    return await parseResponse<T>(response);
  } catch (error) {
    throw normalizeAppError(error, { source: 'browser-fallback', path, method });
  }
}

export async function createHostEventSource(path = '/api/events'): Promise<EventSource> {
  const base = await getHostApiBase();
  const token = await getHostApiToken();
  const separator = path.includes('?') ? '&' : '?';
  return new EventSource(`${base}${path}${separator}token=${encodeURIComponent(token)}`);
}

export async function resolveHostApiBase(): Promise<string> {
  return getHostApiBase();
}
