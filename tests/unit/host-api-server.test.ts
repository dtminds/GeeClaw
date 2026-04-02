import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo, Server } from 'node:net';

const loggerErrorMock = vi.fn();
const loggerInfoMock = vi.fn();

vi.mock('@electron/utils/logger', () => ({
  logger: {
    error: (...args: unknown[]) => loggerErrorMock(...args),
    info: (...args: unknown[]) => loggerInfoMock(...args),
  },
}));

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe('host-api server', () => {
  const originalEnv = process.env.GEECLAW_PORT_GEECLAW_HOST_API;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.GEECLAW_PORT_GEECLAW_HOST_API = '0';
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GEECLAW_PORT_GEECLAW_HOST_API;
    } else {
      process.env.GEECLAW_PORT_GEECLAW_HOST_API = originalEnv;
    }
  });

  it('reads the host api port from environment when no explicit port is provided', async () => {
    const { startHostApiServer } = await import('@electron/api/server');
    const server = startHostApiServer({} as never);

    await new Promise((resolve) => server.once('listening', resolve));

    const address = server.address() as AddressInfo | null;
    expect(address?.port).toBeTypeOf('number');
    expect(address?.port).not.toBe(3210);

    await closeServer(server);
  });

  it('handles bind errors through a server error listener', async () => {
    const { startHostApiServer } = await import('@electron/api/server');
    const server = startHostApiServer({} as never);

    await new Promise((resolve) => server.once('listening', resolve));

    expect(server.listenerCount('error')).toBeGreaterThan(0);

    server.emit('error', {
      code: 'EACCES',
      message: 'listen EACCES: permission denied 127.0.0.1:0',
      name: 'Error',
    } as NodeJS.ErrnoException);

    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Host API server failed to bind port 0'),
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Set GEECLAW_PORT_GEECLAW_HOST_API env var to override the default port.'),
    );

    await closeServer(server);
  });
});
