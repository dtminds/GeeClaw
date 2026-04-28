import http from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS,
  buildGatewayConnectFrame,
  probeGatewayReady,
} from '@electron/gateway/ws-client';

async function withHttpServer(
  handler: http.RequestListener,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test server did not bind to a TCP port');
  }

  try {
    await run(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

describe('gateway ws client handshake', () => {
  it('identifies GeeClaw as a backend client for the Electron gateway bridge', () => {
    const { frame } = buildGatewayConnectFrame({
      challengeNonce: 'nonce-1',
      token: 'token-1',
      deviceIdentity: null,
      platform: 'darwin',
    });

    expect(frame).toMatchObject({
      method: 'connect',
      params: {
        client: {
          id: 'gateway-client',
          displayName: 'GeeClaw',
          mode: 'backend',
        },
        caps: ['tool-events'],
      },
    });
  });

  it('allows slow Gateway warmup after connect.challenge before timing out the handshake ack', () => {
    expect(GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('uses the Gateway HTTP readyz probe for readiness checks', async () => {
    await withHttpServer((req, res) => {
      if (req.url === '/readyz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ready: true }));
        return;
      }

      res.writeHead(404);
      res.end();
    }, async (port) => {
      await expect(probeGatewayReady(port, 500)).resolves.toBe(true);
    });
  });
});
