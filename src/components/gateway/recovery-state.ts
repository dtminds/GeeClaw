import type { GatewayStatus } from '@/types/gateway';

export type GatewayRecoveryPhase = 'idle' | 'recovering' | 'failed';

export interface GatewayRecoveryUiState {
  phase: GatewayRecoveryPhase;
  sessionActive: boolean;
  error: string | null;
}

export const DEFAULT_GATEWAY_RECOVERY_UI_STATE: GatewayRecoveryUiState = {
  phase: 'idle',
  sessionActive: false,
  error: null,
};

export function getNextGatewayRecoveryUiState(
  current: GatewayRecoveryUiState,
  status: GatewayStatus,
): GatewayRecoveryUiState {
  switch (status.state) {
    case 'running':
      return DEFAULT_GATEWAY_RECOVERY_UI_STATE;
    case 'starting':
    case 'reconnecting':
      return {
        phase: 'recovering',
        sessionActive: true,
        error: null,
      };
    case 'error':
      if (!current.sessionActive) {
        return current;
      }
      return {
        phase: 'failed',
        sessionActive: true,
        error: status.error ?? current.error ?? null,
      };
    case 'stopped':
    default:
      if (!current.sessionActive) {
        return DEFAULT_GATEWAY_RECOVERY_UI_STATE;
      }
      if (current.phase === 'failed') {
        return current;
      }
      return {
        phase: 'recovering',
        sessionActive: true,
        error: current.error,
      };
  }
}
