import { describe, expect, it } from 'vitest';
import type { GatewayStatus } from '@/types/gateway';
import {
  DEFAULT_GATEWAY_RECOVERY_UI_STATE,
  getNextGatewayRecoveryUiState,
} from '@/components/gateway/recovery-state';

function makeStatus(overrides: Partial<GatewayStatus>): GatewayStatus {
  return {
    state: 'running',
    port: 28788,
    ...overrides,
  };
}

describe('gateway recovery ui state', () => {
  it('enters recovering mode when the gateway starts or reconnects', () => {
    const nextState = getNextGatewayRecoveryUiState(
      DEFAULT_GATEWAY_RECOVERY_UI_STATE,
      makeStatus({ state: 'starting' }),
    );

    expect(nextState).toEqual({
      phase: 'recovering',
      sessionActive: true,
      error: null,
    });
  });

  it('ignores a plain stopped state when no recovery session is active', () => {
    const nextState = getNextGatewayRecoveryUiState(
      DEFAULT_GATEWAY_RECOVERY_UI_STATE,
      makeStatus({ state: 'stopped' }),
    );

    expect(nextState).toEqual(DEFAULT_GATEWAY_RECOVERY_UI_STATE);
  });

  it('moves to failed mode when a recovery session ends in error', () => {
    const recoveringState = getNextGatewayRecoveryUiState(
      DEFAULT_GATEWAY_RECOVERY_UI_STATE,
      makeStatus({ state: 'reconnecting' }),
    );

    const failedState = getNextGatewayRecoveryUiState(
      recoveringState,
      makeStatus({ state: 'error', error: 'Gateway failed to restart' }),
    );

    expect(failedState).toEqual({
      phase: 'failed',
      sessionActive: true,
      error: 'Gateway failed to restart',
    });
  });

  it('resets back to idle once the gateway is running again', () => {
    const failedState = {
      phase: 'failed' as const,
      sessionActive: true,
      error: 'Gateway failed to restart',
    };

    const nextState = getNextGatewayRecoveryUiState(
      failedState,
      makeStatus({ state: 'running' }),
    );

    expect(nextState).toEqual(DEFAULT_GATEWAY_RECOVERY_UI_STATE);
  });
});
