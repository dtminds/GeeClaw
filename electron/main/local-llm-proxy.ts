import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { logger } from '../utils/logger';
import {
  GEECLAW_MODEL_UNAVAILABLE_MESSAGE,
  type GeeClawProviderConfig,
  createDefaultGeeClawProviderConfig,
  getActiveGeeClawProviderConfig,
  isGeeClawRegisteredModelId,
  startGeeClawProviderConfigRefresh,
  stopGeeClawProviderConfigRefresh,
} from '../utils/geeclaw-provider-config';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_START_PORT = 19100;
const DEFAULT_MAX_PORT = 19120;
const GEECLAW_PROXY_PREFIX = '/proxy';
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
  getConfig?: () => GeeClawProviderConfig;
  refreshConfig?: boolean;
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

function normalizeGeeClawModelId(modelId: string): string {
  const trimmed = modelId.trim();
  return trimmed.startsWith('geeclaw/') ? trimmed.slice('geeclaw/'.length) : trimmed;
}

function buildModelUnavailableResponseBody(): string {
  return JSON.stringify({
    error: {
      code: 'geeclaw_model_unavailable',
      message: GEECLAW_MODEL_UNAVAILABLE_MESSAGE,
      type: 'model_unavailable',
    },
  });
}

function writeModelUnavailableResponse(res: ServerResponse): void {
  res.statusCode = 503;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(buildModelUnavailableResponseBody());
}

type RequestBodyResolution = {
  body: Buffer | undefined;
  modelUnavailable: boolean;
};

function resolveGeeClawAutoModel(config: GeeClawProviderConfig): string | null {
  const allowedModels = new Set(config.allowedModels.map(normalizeGeeClawModelId));
  for (const candidate of config.autoModels) {
    const modelId = normalizeGeeClawModelId(candidate);
    if (allowedModels.has(modelId) && isGeeClawRegisteredModelId(modelId)) {
      return modelId;
    }
  }
  return null;
}

function resolveRequestBodyForGeeClawConfig(
  body: Buffer | undefined,
  config: GeeClawProviderConfig,
): RequestBodyResolution {
  if (!body || body.length === 0) {
    return { body, modelUnavailable: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    return { body, modelUnavailable: false };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { body, modelUnavailable: false };
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.model !== 'string' || !record.model.trim()) {
    return { body, modelUnavailable: false };
  }

  const requestedModel = normalizeGeeClawModelId(record.model);
  const allowedModels = new Set(config.allowedModels.map(normalizeGeeClawModelId));
  const shouldUseAuto = requestedModel === 'auto'
    || !allowedModels.has(requestedModel)
    || !isGeeClawRegisteredModelId(requestedModel);

  if (!shouldUseAuto) {
    return { body, modelUnavailable: false };
  }

  const autoModel = resolveGeeClawAutoModel(config);
  if (!autoModel) {
    return { body: undefined, modelUnavailable: true };
  }

  return {
    body: Buffer.from(JSON.stringify({
      ...record,
      model: autoModel,
    })),
    modelUnavailable: false,
  };
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
  private readonly fetchImpl: FetchImpl;
  private readonly getConfig: () => GeeClawProviderConfig;
  private readonly refreshConfig: boolean;

  constructor(options: LocalLlmProxyManagerOptions = {}) {
    this.host = options.host ?? LOOPBACK_HOST;
    this.startPort = options.startPort ?? DEFAULT_START_PORT;
    this.maxPort = options.maxPort ?? DEFAULT_MAX_PORT;
    this.fetchImpl = options.fetchImpl ?? proxyAwareFetch;
    this.refreshConfig = options.refreshConfig ?? false;
    const upstreamBaseUrl = options.upstreamBaseUrl?.trim().replace(/\/+$/, '');
    this.getConfig = options.getConfig ?? (() => {
      const activeConfig = getActiveGeeClawProviderConfig();
      if (!upstreamBaseUrl) {
        return activeConfig;
      }
      return {
        ...createDefaultGeeClawProviderConfig(),
        ...activeConfig,
        upstreamBaseUrl,
      };
    });
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
        if (this.refreshConfig) {
          startGeeClawProviderConfigRefresh();
        }
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

    if (this.refreshConfig) {
      stopGeeClawProviderConfigRefresh();
    }
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

      const config = this.getConfig();
      const upstreamUrl = buildUpstreamUrl(rawUrl, config.upstreamBaseUrl);
      const body = await readRequestBody(req);
      const resolvedBody = resolveRequestBodyForGeeClawConfig(body, config);
      if (resolvedBody.modelUnavailable) {
        writeModelUnavailableResponse(res);
        return;
      }
      const outgoingHeaders = toOutgoingHeaders(req.headers);
      const response = await this.fetchImpl(upstreamUrl, {
        method: req.method || 'GET',
        headers: outgoingHeaders,
        body: resolvedBody.body,
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

export const localLlmProxyManager = new LocalLlmProxyManager({ refreshConfig: true });

export function getLocalLlmProxyPort(): number | null {
  return localLlmProxyManager.getPort();
}
