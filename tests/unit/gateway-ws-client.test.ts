import { describe, expect, it } from 'vitest';
import { buildGatewayConnectFrame } from '@electron/gateway/ws-client';

describe('gateway ws client handshake', () => {
  it('identifies GeeClaw as a ui client for the Electron gateway bridge', () => {
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
          displayName: 'GeeClaw',
          mode: 'ui',
        },
        caps: ['tool-events'],
      },
    });
  });
});
