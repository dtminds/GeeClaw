import { logger } from './logger';

type GatewayRefreshTarget = {
  getStatus(): { state: string };
  debouncedRestart: (delayMs?: number) => void;
  start: () => Promise<void>;
};

export function refreshGatewayAfterConfigChange(
  gatewayManager: GatewayRefreshTarget,
  reason: string,
): void {
  const { state } = gatewayManager.getStatus();

  if (state === 'stopped' || state === 'error') {
    logger.info(`Gateway is ${state}; starting after ${reason}`);
    void gatewayManager.start().catch((error) => {
      logger.warn(`Failed to start Gateway after ${reason}:`, error);
    });
    return;
  }

  logger.info(`Scheduling Gateway restart after ${reason}`);
  gatewayManager.debouncedRestart();
}
