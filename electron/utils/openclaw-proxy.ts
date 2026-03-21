import { getGeeClawChannelStore } from '../services/channels/store-instance';
import { resolveProxySettings, type ProxySettings } from './proxy';
import { logger } from './logger';
import { mutateOpenClawConfigDocument } from './openclaw-config-coordinator';
import type { OpenClawConfig } from './channel-config';

/**
 * Sync GeeClaw global proxy settings into OpenClaw channel config where the
 * upstream runtime expects an explicit per-channel proxy knob.
 */
export async function syncProxyConfigToOpenClaw(settings: ProxySettings): Promise<void> {
  const resolved = resolveProxySettings(settings);
  const nextProxy = settings.proxyEnabled
    ? (resolved.allProxy || resolved.httpsProxy || resolved.httpProxy)
    : '';

  const nextTelegramConfig = await mutateOpenClawConfigDocument<OpenClawConfig['channels'][string] | null>((document) => {
    const config = document as OpenClawConfig;
    const telegramConfig = config.channels?.telegram;

    if (!telegramConfig) {
      return { changed: false, result: null };
    }

    const currentProxy = typeof telegramConfig.proxy === 'string' ? telegramConfig.proxy : '';
    if (!nextProxy && !currentProxy) {
      return { changed: false, result: null };
    }

    if (!config.channels) {
      config.channels = {};
    }

    config.channels.telegram = {
      ...telegramConfig,
    };

    if (nextProxy) {
      config.channels.telegram.proxy = nextProxy;
    } else {
      delete config.channels.telegram.proxy;
    }

    return {
      changed: true,
      result: JSON.parse(JSON.stringify(config.channels.telegram)) as OpenClawConfig['channels'][string],
    };
  });

  if (!nextTelegramConfig) {
    return;
  }

  const channelStore = await getGeeClawChannelStore();
  const storedChannels = (channelStore.get('channels') as Record<string, unknown> | undefined) ?? {};
  channelStore.set('channels', {
    ...storedChannels,
    telegram: nextTelegramConfig,
  });

  if (!nextProxy && !('proxy' in nextTelegramConfig)) {
    // No-op for store shape; keep the config without a proxy field.
  }
  logger.info(`Synced Telegram proxy to OpenClaw config (${nextProxy || 'disabled'})`);
}
