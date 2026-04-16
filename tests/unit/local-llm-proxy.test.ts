import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';

import { LocalLlmProxyManager } from '@electron/main/local-llm-proxy';

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
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
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
    await listen(occupied, 19100);

    const upstream = createServer((_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });
    serversToClose.add(upstream);
    const upstreamPort = await listen(upstream);

    const manager = new LocalLlmProxyManager({
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`,
      startPort: 19100,
      maxPort: 19102,
    });
    managersToStop.add(manager);

    const { port } = await manager.start();

    expect(port).toBe(19101);
    expect(manager.getPort()).toBe(19101);
  });

  it('rewrites the /proxy prefix and preserves method, query, and body', async () => {
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
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`,
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
    expect(seenUrl).toBe('/v1/chat/completions?stream=true');
    expect(seenMethod).toBe('POST');
    expect(seenBody).toContain('"model":"geeclaw/qwen3.6-plus"');
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
});
