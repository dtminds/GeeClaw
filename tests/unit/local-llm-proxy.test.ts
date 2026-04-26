import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { LocalLlmProxyManager } from '@electron/main/local-llm-proxy';
import { logger } from '@electron/utils/logger';

function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve server address'));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function waitFor<T>(read: () => T | null | undefined, timeoutMs = 200): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = read();
    if (value !== null && value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for value');
}

describe('LocalLlmProxyManager', () => {
  const serversToClose = new Set<Server>();
  const managersToStop = new Set<LocalLlmProxyManager>();

  afterEach(async () => {
    for (const manager of managersToStop) {
      await manager.stop();
    }
    managersToStop.clear();

    for (const server of serversToClose) {
      await closeServer(server);
    }
    serversToClose.clear();
  });

  it('falls back from port 19100 when it is already occupied', async () => {
    const occupied = createServer();
    serversToClose.add(occupied);
    const occupiedPort = await listen(occupied);

    const upstream = createServer((_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });
    serversToClose.add(upstream);
    const upstreamPort = await listen(upstream);

    const manager = new LocalLlmProxyManager({
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`,
      startPort: occupiedPort,
      maxPort: occupiedPort + 2,
    });
    managersToStop.add(manager);

    const { port } = await manager.start();

    expect(port).toBeGreaterThan(occupiedPort);
    expect(port).toBeLessThanOrEqual(occupiedPort + 2);
    expect(manager.getPort()).toBe(port);
  });

  it('rewrites the /proxy prefix under the configured upstream base path and preserves method, query, and body', async () => {
    let seenUrl = '';
    let seenMethod = '';
    let seenBody = '';

    const upstream = createServer(async (req, res) => {
      seenUrl = req.url || '';
      seenMethod = req.method || '';
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      seenBody = Buffer.concat(chunks).toString('utf8');
      res.statusCode = 201;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
    serversToClose.add(upstream);
    const upstreamPort = await listen(upstream);

    const manager = new LocalLlmProxyManager({
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/api/v1`,
      startPort: 19110,
      maxPort: 19112,
    });
    managersToStop.add(manager);
    const { port } = await manager.start();

    const response = await fetch(`http://127.0.0.1:${port}/proxy/v1/chat/completions?stream=true`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'geeclaw/qwen3.6-plus', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(seenUrl).toBe('/api/v1/chat/completions?stream=true');
    expect(seenMethod).toBe('POST');
    expect(JSON.parse(seenBody).model).toBe('qwen3.6-plus');
  });

  it('replaces auto model requests with the configured registered auto target', async () => {
    let seenBody = '';

    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      seenBody = Buffer.concat(chunks).toString('utf8');
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
    serversToClose.add(upstream);
    const upstreamPort = await listen(upstream);

    const manager = new LocalLlmProxyManager({
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/api/v1`,
      startPort: 19140,
      maxPort: 19142,
      getConfig: () => ({
        version: 1,
        upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/api/v1`,
        autoModels: ['future-model', 'qwen3.6-plus'],
        allowedModels: ['future-model', 'qwen3.6-plus'],
      }),
    });
    managersToStop.add(manager);
    const { port } = await manager.start();

    const response = await fetch(`http://127.0.0.1:${port}/proxy/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'geeclaw/auto', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(seenBody)).toEqual({
      model: 'qwen3.6-plus',
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it('falls back to auto when the requested model is not allowed by config', async () => {
    let seenBody = '';

    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      seenBody = Buffer.concat(chunks).toString('utf8');
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
    serversToClose.add(upstream);
    const upstreamPort = await listen(upstream);

    const manager = new LocalLlmProxyManager({
      startPort: 19150,
      maxPort: 19152,
      getConfig: () => ({
        version: 1,
        upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/api/v1`,
        autoModels: ['future-model', 'qwen3.6-plus'],
        allowedModels: ['qwen3.6-plus'],
      }),
    });
    managersToStop.add(manager);
    const { port } = await manager.start();

    const response = await fetch(`http://127.0.0.1:${port}/proxy/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(seenBody).model).toBe('qwen3.6-plus');
  });

  it('returns a model unavailable error when the configured auto target is not registered', async () => {
    let upstreamHit = false;
    const upstream = createServer((_req, res) => {
      upstreamHit = true;
      res.statusCode = 200;
      res.end('ok');
    });
    serversToClose.add(upstream);
    const upstreamPort = await listen(upstream);

    const manager = new LocalLlmProxyManager({
      startPort: 19160,
      maxPort: 19162,
      getConfig: () => ({
        version: 1,
        upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/api/v1`,
        autoModels: ['not-yet-registered-model'],
        allowedModels: ['not-yet-registered-model'],
      }),
    });
    managersToStop.add(manager);
    const { port } = await manager.start();

    const response = await fetch(`http://127.0.0.1:${port}/proxy/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'geeclaw/auto', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'geeclaw_model_unavailable',
        message: '当前模型暂不可用，请切换模型或稍后重试',
        type: 'model_unavailable',
      },
    });
    expect(upstreamHit).toBe(false);
  });

  it('passes through streaming upstream responses', async () => {
    const upstream = createServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      res.write('data: first\\n\\n');
      setTimeout(() => {
        res.end('data: second\\n\\n');
      }, 10);
    });
    serversToClose.add(upstream);
    const upstreamPort = await listen(upstream);

    const manager = new LocalLlmProxyManager({
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`,
      startPort: 19120,
      maxPort: 19122,
    });
    managersToStop.add(manager);
    const { port } = await manager.start();

    const response = await fetch(`http://127.0.0.1:${port}/proxy/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ stream: true }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toBe('data: first\\n\\ndata: second\\n\\n');
  });

  it('aborts the upstream fetch without warning when the client disconnects', async () => {
    let upstreamSignal: AbortSignal | undefined;

    const manager = new LocalLlmProxyManager({
      startPort: 19130,
      maxPort: 19132,
      upstreamBaseUrl: 'http://127.0.0.1:9',
      fetchImpl: async (_url, init) => {
        upstreamSignal = init?.signal;
        if (!upstreamSignal) {
          throw new Error('missing abort signal');
        }

        return await new Promise<Response>((_resolve, reject) => {
          upstreamSignal!.addEventListener('abort', () => reject(new TypeError('terminated')), { once: true });
        });
      },
    });
    managersToStop.add(manager);
    const { port } = await manager.start();

    const request = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/proxy/v1/chat/completions',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
    });
    request.write(JSON.stringify({ stream: true }));
    request.end();

    await waitFor(() => upstreamSignal);

    const requestClosed = new Promise<void>((resolve, reject) => {
      request.once('close', resolve);
      request.once('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') {
          resolve();
          return;
        }
        reject(error);
      });
    });
    request.destroy();
    await requestClosed;

    await waitFor(() => upstreamSignal?.aborted ? true : undefined);
    expect(upstreamSignal?.aborted).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not log the upstream service URL when a proxy request fails', async () => {
    const manager = new LocalLlmProxyManager({
      startPort: 19170,
      maxPort: 19172,
      upstreamBaseUrl: 'https://secret-upstream.example.com/private/v1',
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED https://secret-upstream.example.com/private/v1/chat/completions');
      },
    });
    managersToStop.add(manager);
    const { port } = await manager.start();

    const response = await fetch(`http://127.0.0.1:${port}/proxy/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'qwen3.6-plus', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(response.status).toBe(502);
    const logged = vi.mocked(logger.warn).mock.calls.flat().map(String).join('\n');
    expect(logged).toContain('<redacted-url>');
    expect(logged).not.toContain('secret-upstream.example.com');
    expect(logged).not.toContain('/private/v1');
  });
});
