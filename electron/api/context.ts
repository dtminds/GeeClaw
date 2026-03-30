import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import type { ClawHubService } from '../gateway/clawhub';
import type { CliMarketplaceService } from '../utils/cli-marketplace';
import type { HostEventBus } from './event-bus';

export interface HostApiContext {
  gatewayManager: GatewayManager;
  clawHubService: ClawHubService;
  cliMarketplaceService: CliMarketplaceService;
  eventBus: HostEventBus;
  mainWindow: BrowserWindow | null;
}
