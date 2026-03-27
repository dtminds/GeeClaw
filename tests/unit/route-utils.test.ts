import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { requireJsonContentType, setCorsHeaders } from '@electron/api/route-utils';

function createRequest(method: string, headers: Record<string, string | undefined>): IncomingMessage {
  return {
    method,
    headers,
  } as IncomingMessage;
}

function createResponse(): ServerResponse & { headers: Map<string, string> } {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name, value);
    }),
  } as unknown as ServerResponse & { headers: Map<string, string> };
}

describe('route-utils', () => {
  it('allows bodyless mutation requests through the JSON content-type gate', () => {
    const request = createRequest('POST', {});
    expect(requireJsonContentType(request)).toBe(true);
  });

  it('accepts mutation requests with application/json bodies', () => {
    const request = createRequest('PUT', {
      'content-length': '42',
      'content-type': 'application/json; charset=utf-8',
    });
    expect(requireJsonContentType(request)).toBe(true);
  });

  it('rejects non-JSON mutation requests with a body', () => {
    const request = createRequest('POST', {
      'content-length': '8',
      'content-type': 'text/plain',
    });
    expect(requireJsonContentType(request)).toBe(false);
  });

  it('reflects only allowed origins in CORS headers', () => {
    const response = createResponse();
    setCorsHeaders(response, 'http://127.0.0.1:5173');

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:5173');
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization');
  });

  it('omits Access-Control-Allow-Origin for unknown origins', () => {
    const response = createResponse();
    setCorsHeaders(response, 'https://evil.example');

    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,PUT,DELETE,OPTIONS');
  });
});
