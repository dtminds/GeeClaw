import WebSocket from 'ws';
import type { DeviceIdentity } from '../utils/device-identity';
import type { PendingGatewayRequest } from './request-store';
import {
  buildDeviceAuthPayload,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from '../utils/device-identity';
import { logger } from '../utils/logger';

export const GATEWAY_CONNECT_CHALLENGE_TIMEOUT_MS = 10_000;
export const GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS = 60_000;

export async function probeGatewayReady(
  port: number,
  timeoutMs = 1500,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
      method: 'HEAD',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForGatewayReady(options: {
  port: number;
  getProcessExitCode: () => number | null;
  retries?: number;
  intervalMs?: number;
}): Promise<void> {
  const retries = options.retries ?? 2400;
  const intervalMs = options.intervalMs ?? 200;

  for (let i = 0; i < retries; i++) {
    const exitCode = options.getProcessExitCode();
    if (exitCode !== null) {
      logger.error(`Gateway process exited before ready (code=${exitCode})`);
      throw new Error(`Gateway process exited before becoming ready (code=${exitCode})`);
    }

    try {
      const ready = await probeGatewayReady(options.port, 1500);
      if (ready) {
        logger.debug(`Gateway ready after ${i + 1} attempt(s)`);
        return;
      }
    } catch {
      // Gateway not ready yet.
    }

    if (i > 0 && i % 10 === 0) {
      logger.debug(`Still waiting for Gateway... (attempt ${i + 1}/${retries})`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  logger.error(`Gateway failed to become ready after ${retries} attempts on port ${options.port}`);
  throw new Error(`Gateway failed to start after ${retries} retries (port ${options.port})`);
}

export function buildGatewayConnectFrame(options: {
  challengeNonce: string;
  token: string;
  deviceIdentity: DeviceIdentity | null;
  platform: string;
}): { connectId: string; frame: Record<string, unknown> } {
  const connectId = `connect-${Date.now()}`;
  const role = 'operator';
  const scopes = ['operator.admin'];
  const signedAtMs = Date.now();
  const clientId = 'gateway-client';
  const clientMode = 'backend';

  const device = (() => {
    if (!options.deviceIdentity) return undefined;

    const payload = buildDeviceAuthPayload({
      deviceId: options.deviceIdentity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token: options.token ?? null,
      nonce: options.challengeNonce,
    });
    const signature = signDevicePayload(options.deviceIdentity.privateKeyPem, payload);
    return {
      id: options.deviceIdentity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(options.deviceIdentity.publicKeyPem),
      signature,
      signedAt: signedAtMs,
      nonce: options.challengeNonce,
    };
  })();

  return {
    connectId,
    frame: {
      type: 'req',
      id: connectId,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: clientId,
          displayName: 'GeeClaw',
          version: '0.1.0',
          platform: options.platform,
          mode: clientMode,
        },
        auth: {
          token: options.token,
        },
        // Match OpenClaw webchat's live tool subscription without switching
        // the Electron bridge into browser-only `webchat` mode.
        caps: ['tool-events'],
        role,
        scopes,
        device,
      },
    },
  };
}

export async function connectGatewaySocket(options: {
  port: number;
  token: string;
  deviceIdentity: DeviceIdentity | null;
  platform: string;
  pendingRequests: Map<string, PendingGatewayRequest>;
  onHandshakeComplete: (ws: WebSocket) => void;
  onMessage: (message: unknown) => void;
  onCloseAfterHandshake: (code: number) => void;
}): Promise<WebSocket> {
  logger.debug(`Connecting Gateway WebSocket (ws://127.0.0.1:${options.port}/ws)`);

  return await new Promise<WebSocket>((resolve, reject) => {
    const wsUrl = `ws://127.0.0.1:${options.port}/ws`;
    const ws = new WebSocket(wsUrl);
    let handshakeComplete = false;
    let connectId: string | null = null;
    let handshakeTimeout: NodeJS.Timeout | null = null;
    let challengeTimer: NodeJS.Timeout | null = null;
    let challengeReceived = false;
    let settled = false;

    const cleanupHandshakeRequest = () => {
      if (challengeTimer) {
        clearTimeout(challengeTimer);
        challengeTimer = null;
      }
      if (handshakeTimeout) {
        clearTimeout(handshakeTimeout);
        handshakeTimeout = null;
      }
      if (connectId && options.pendingRequests.has(connectId)) {
        const request = options.pendingRequests.get(connectId);
        if (request) {
          clearTimeout(request.timeout);
        }
        options.pendingRequests.delete(connectId);
      }
    };

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanupHandshakeRequest();
      resolve(ws);
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanupHandshakeRequest();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const sendConnectHandshake = async (challengeNonce: string) => {
      const connectPayload = buildGatewayConnectFrame({
        challengeNonce,
        token: options.token,
        deviceIdentity: options.deviceIdentity,
        platform: options.platform,
      });
      connectId = connectPayload.connectId;

      ws.send(JSON.stringify(connectPayload.frame));
      logger.debug('Sent connect handshake with challenge nonce');

      const requestTimeout = setTimeout(() => {
        if (!handshakeComplete) {
          logger.error('Gateway connect handshake timed out');
          ws.close();
          rejectOnce(new Error('Connect handshake timeout'));
        }
      }, GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS);
      handshakeTimeout = requestTimeout;

      options.pendingRequests.set(connectId, {
        resolve: () => {
          handshakeComplete = true;
          logger.debug('Gateway connect handshake completed');
          options.onHandshakeComplete(ws);
          resolveOnce();
        },
        reject: (error) => {
          logger.error('Gateway connect handshake failed:', error);
          rejectOnce(error);
        },
        timeout: requestTimeout,
      });
    };

    challengeTimer = setTimeout(() => {
      if (!challengeReceived && !settled) {
        logger.error('Gateway connect.challenge not received within timeout');
        ws.close();
        rejectOnce(new Error('Timed out waiting for connect.challenge from Gateway'));
      }
    }, GATEWAY_CONNECT_CHALLENGE_TIMEOUT_MS);

    ws.on('open', () => {
      logger.debug('Gateway WebSocket opened, waiting for connect.challenge...');
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (
          !challengeReceived &&
          typeof message === 'object' && message !== null &&
          message.type === 'event' && message.event === 'connect.challenge'
        ) {
          challengeReceived = true;
          if (challengeTimer) {
            clearTimeout(challengeTimer);
            challengeTimer = null;
          }
          const nonce = message.payload?.nonce as string | undefined;
          if (!nonce) {
            rejectOnce(new Error('Gateway connect.challenge missing nonce'));
            return;
          }
          logger.debug('Received connect.challenge, sending handshake');
          void sendConnectHandshake(nonce);
          return;
        }

        options.onMessage(message);
      } catch (error) {
        logger.debug('Failed to parse Gateway WebSocket message:', error);
      }
    });

    ws.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || 'unknown';
      logger.warn(`Gateway WebSocket closed (code=${code}, reason=${reasonStr}, handshake=${handshakeComplete ? 'ok' : 'pending'})`);
      if (!handshakeComplete) {
        rejectOnce(new Error(`WebSocket closed before handshake: ${reasonStr}`));
        return;
      }
      cleanupHandshakeRequest();
      options.onCloseAfterHandshake(code);
    });

    ws.on('error', (error) => {
      if (error.message?.includes('closed before handshake') || (error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        logger.debug(`Gateway WebSocket connection error (transient): ${error.message}`);
      } else {
        logger.error('Gateway WebSocket error:', error);
      }
      if (!handshakeComplete) {
        rejectOnce(error);
      }
    });
  });
}
