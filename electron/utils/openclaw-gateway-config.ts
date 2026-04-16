import { mutateOpenClawConfigDocument } from './openclaw-config-coordinator';

export async function syncGatewayTokenToConfig(token: string, gatewayPort?: number): Promise<void> {
  const changed = await mutateOpenClawConfigDocument<boolean>((config) => {
    const gateway = (
      config.gateway && typeof config.gateway === 'object'
        ? { ...(config.gateway as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    const before = JSON.stringify(gateway);

    const auth = (
      gateway.auth && typeof gateway.auth === 'object'
        ? { ...(gateway.auth as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    auth.mode = 'token';
    auth.token = token;
    gateway.auth = auth;

    const controlUi = (
      gateway.controlUi && typeof gateway.controlUi === 'object'
        ? { ...(gateway.controlUi as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    const allowedOrigins = Array.isArray(controlUi.allowedOrigins)
      ? (controlUi.allowedOrigins as unknown[]).filter((value): value is string => typeof value === 'string')
      : [];
    if (!allowedOrigins.includes('file://')) {
      controlUi.allowedOrigins = [...allowedOrigins, 'file://'];
    }
    gateway.controlUi = controlUi;

    if (!gateway.mode) gateway.mode = 'local';
    if (typeof gatewayPort === 'number' && Number.isFinite(gatewayPort) && gatewayPort > 0) {
      gateway.port = gatewayPort;
    }

    const nextChanged = JSON.stringify(gateway) !== before;
    if (nextChanged) {
      config.gateway = gateway;
    }

    return { changed: nextChanged, result: nextChanged };
  });

  if (changed) {
    console.log('Synced gateway token to openclaw.json');
  }
}

export async function syncBrowserConfigToOpenClaw(): Promise<void> {
  const changed = await mutateOpenClawConfigDocument<boolean>((config) => {
    const browser = (
      config.browser && typeof config.browser === 'object'
        ? { ...(config.browser as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    let nextChanged = false;

    if (browser.enabled === undefined) {
      browser.enabled = true;
      nextChanged = true;
    }

    if (browser.defaultProfile === undefined) {
      browser.defaultProfile = 'openclaw';
      nextChanged = true;
    }

    if (nextChanged) {
      config.browser = browser;
    }

    return { changed: nextChanged, result: nextChanged };
  });

  if (!changed) return;

  console.log('Synced browser config to openclaw.json');
}
