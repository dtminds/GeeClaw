import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { getProviderConfig } from '../utils/provider-registry';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { logger } from '../utils/logger';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_START_PORT = 19100;
const DEFAULT_MAX_PORT = 19120;
const GEECLAW_PROXY_PREFIX = '/proxy';
const GEECLAW_UPSTREAM_BASE_URL = getProviderConfig('geeclaw')?.baseUrl ?? 'https://geekai.co/api/v1';
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

type FetchImpl = typeof proxyAwareFetch;

type LocalLlmProxyManagerOptions = {
  host?: string;
  startPort?: number;
  maxPort?: number;
  upstreamBaseUrl?: string;
  fetchImpl?: FetchImpl;
};

function toOutgoingHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const next: Record<string, string> = {};

  for (const [rawKey, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    const key = rawKey.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(key)) {
      continue;
    }

    next[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  return next;
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return Buffer.concat(chunks);
}

function buildUpstreamUrl(rawUrl: string, upstreamBaseUrl: string): string {
  const incoming = new URL(rawUrl, `http://${LOOPBACK_HOST}`);
  if (!incoming.pathname.startsWith(GEECLAW_PROXY_PREFIX)) {
    throw new Error(`Unsupported proxy path: ${incoming.pathname}`);
  }

  const upstreamPath = incoming.pathname === GEECLAW_PROXY_PREFIX
    ? ''
    : incoming.pathname.slice(GEECLAW_PROXY_PREFIX.length);
  const upstream = new URL(upstreamBaseUrl.endsWith('/') ? upstreamBaseUrl : `${upstreamBaseUrl}/`);
  const basePath = upstream.pathname.replace(/\/+$/, '');
  const normalizedUpstreamPath = basePath.endsWith('/v1') && (upstreamPath === '/v1' || upstreamPath.startsWith('/v1/'))
    ? upstreamPath.slice('/v1'.length)
    : upstreamPath;
  upstream.pathname = normalizedUpstreamPath
    ? `${basePath}${normalizedUpstreamPath.startsWith('/') ? normalizedUpstreamPath : `/${normalizedUpstreamPath}`}`
    : basePath || '/';
  upstream.search = incoming.search;

  return upstream.toString();
}

function copyResponseHeaders(res: ServerResponse, headers: Headers): void {
  headers.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      return;
    }
    res.setHeader(key, value);
  });
}

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return error.name === 'AbortError'
    || message === 'terminated'
    || message === 'aborted'
    || message.includes('abort');
}

export class LocalLlmProxyManager {
  private server: Server | null = null;
  private port: number | null = null;
  private readonly host: string;
  private readonly startPort: number;
  private readonly maxPort: number;
  private readonly upstreamBaseUrl: string;
  private readonly fetchImpl: FetchImpl;

  constructor(options: LocalLlmProxyManagerOptions = {}) {
    this.host = options.host ?? LOOPBACK_HOST;
    this.startPort = options.startPort ?? DEFAULT_START_PORT;
    this.maxPort = options.maxPort ?? DEFAULT_MAX_PORT;
    this.upstreamBaseUrl = options.upstreamBaseUrl ?? GEECLAW_UPSTREAM_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? proxyAwareFetch;
  }

  getPort(): number | null {
    return this.port;
  }

  async start(): Promise<{ port: number }> {
    if (this.server && this.port !== null) {
      return { port: this.port };
    }

    for (let port = this.startPort; port <= this.maxPort; port += 1) {
      const server = createServer(this.handleRequest);
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, this.host, () => {
            server.off('error', reject);
            resolve();
          });
        });
        this.server = server;
        this.port = port;
        logger.info(`Local LLM proxy listening on http://${this.host}:${port}${GEECLAW_PROXY_PREFIX}`);
        return { port };
      } catch (error) {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code === 'EADDRINUSE') {
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Failed to bind local LLM proxy on ${this.host}:${this.startPort}-${this.maxPort}`);
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = null;

    if (!server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private readonly handleRequest: RequestListener = async (req, res) => {
    const upstreamController = new AbortController();
    const abortUpstream = () => {
      if (!upstreamController.signal.aborted) {
        upstreamController.abort();
      }
    };

    req.once('aborted', abortUpstream);
    res.once('close', () => {
      if (!res.writableEnded) {
        abortUpstream();
      }
    });

    try {
      const rawUrl = req.url || '/';
      if (!rawUrl.startsWith(GEECLAW_PROXY_PREFIX)) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }

      const upstreamUrl = buildUpstreamUrl(rawUrl, this.upstreamBaseUrl);
      const body = await readRequestBody(req);
      const outgoingHeaders = toOutgoingHeaders(req.headers);
      const response = await this.fetchImpl(upstreamUrl, {
        method: req.method || 'GET',
        headers: outgoingHeaders,
        body,
        signal: upstreamController.signal,
      });

      res.statusCode = response.status;
      copyResponseHeaders(res, response.headers);

      if (!response.body) {
        res.end();
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const bodyStream = Readable.fromWeb(response.body as globalThis.ReadableStream<Uint8Array>);
        const cleanup = () => {
          bodyStream.off('error', onError);
          bodyStream.off('end', onEnd);
          res.off('close', onClose);
          res.off('error', onError);
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onEnd = () => {
          cleanup();
          resolve();
        };
        const onClose = () => {
          abortUpstream();
          bodyStream.destroy();
          cleanup();
          resolve();
        };

        bodyStream.on('error', onError);
        bodyStream.on('end', onEnd);
        res.on('close', onClose);
        res.on('error', onError);
        bodyStream.pipe(res);
      });
    } catch (error) {
      if (upstreamController.signal.aborted && isAbortLikeError(error)) {
        if (!res.writableEnded && !res.destroyed) {
          res.destroy();
        }
        return;
      }

      logger.warn('Local LLM proxy request failed:', error);
      if (res.destroyed) {
        return;
      }
      if (!res.headersSent) {
        res.statusCode = 502;
      }
      if (!res.writableEnded) {
        res.end('Bad Gateway');
      }
    }
  };
}

export const localLlmProxyManager = new LocalLlmProxyManager();

export function getLocalLlmProxyPort(): number | null {
  return localLlmProxyManager.getPort();
}
