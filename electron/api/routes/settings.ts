import type { IncomingMessage, ServerResponse } from 'http';
import { applyProxySettings } from '../../main/proxy';
import { getAllSettings, getSetting, resetSettings, setSetting, type AppSettings } from '../../utils/store';
import {
  getManagedAppEnvironmentEntries,
  replaceManagedAppEnvironmentEntries,
  resolveGeeClawAppEnvironment,
} from '../../utils/app-env';
import {
  applyWebSearchSettingsPatch,
  buildWebSearchProviderAvailabilityMap,
  buildWebSearchProviderEnvVarStatusMap,
  deleteWebSearchProviderConfig,
  readWebSearchSettingsSnapshot,
  type WebSearchSettingsPatch,
} from '../../utils/openclaw-web-search-config';
import { listWebSearchProviderDescriptors } from '../../utils/openclaw-web-search-provider-registry';
import {
  mutateOpenClawConfigDocument,
  readOpenClawConfigDocument,
} from '../../utils/openclaw-config-coordinator';
import {
  applyMemorySettingsPatch,
  readMemorySettingsSnapshot,
  type MemorySettingsPatch,
} from '../../utils/openclaw-memory-settings';
import {
  buildOpenClawSafetySettings,
  isApprovalPolicy,
  isToolPermission,
  syncOpenClawSafetySettings,
} from '../../utils/openclaw-safety-settings';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

async function handleProxySettingsChange(ctx: HostApiContext): Promise<void> {
  const settings = await getAllSettings();
  await applyProxySettings(settings);
  if (ctx.gatewayManager.getStatus().state === 'running') {
    await ctx.gatewayManager.restart();
  }
}

function patchTouchesProxy(patch: Partial<AppSettings>): boolean {
  return Object.keys(patch).some((key) => (
    key === 'proxyEnabled' ||
    key === 'proxyServer' ||
    key === 'proxyHttpServer' ||
    key === 'proxyHttpsServer' ||
    key === 'proxyAllServer' ||
    key === 'proxyBypassRules'
  ));
}

function patchTouchesSafety(patch: Partial<AppSettings>): boolean {
  return Object.keys(patch).some((key) => (
    key === 'toolPermission' ||
    key === 'approvalPolicy'
  ));
}

async function handleSafetySettingsChange(ctx: HostApiContext): Promise<void> {
  const settings = await getAllSettings();
  await syncOpenClawSafetySettings(settings);
  if (ctx.gatewayManager.getStatus().state === 'running') {
    ctx.gatewayManager.debouncedReload();
  }
}

export async function handleSettingsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/settings/safety' && req.method === 'GET') {
    const settings = await getAllSettings();
    sendJson(res, 200, buildOpenClawSafetySettings(settings));
    return true;
  }

  if (url.pathname === '/api/settings/safety' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<Partial<Pick<AppSettings, 'toolPermission' | 'approvalPolicy'>>>(req);
      const patch: Partial<Pick<AppSettings, 'toolPermission' | 'approvalPolicy'>> = {};

      if ('toolPermission' in body) {
        if (!isToolPermission(body.toolPermission)) {
          sendJson(res, 400, { success: false, error: 'toolPermission is invalid' });
          return true;
        }
        patch.toolPermission = body.toolPermission;
      }

      if ('approvalPolicy' in body) {
        if (!isApprovalPolicy(body.approvalPolicy)) {
          sendJson(res, 400, { success: false, error: 'approvalPolicy is invalid' });
          return true;
        }
        patch.approvalPolicy = body.approvalPolicy;
      }

      if (Object.keys(patch).length === 0) {
        sendJson(res, 400, { success: false, error: 'No safety settings provided' });
        return true;
      }

      if (patch.toolPermission) {
        await setSetting('toolPermission', patch.toolPermission);
      }
      if (patch.approvalPolicy) {
        await setSetting('approvalPolicy', patch.approvalPolicy);
      }

      await handleSafetySettingsChange(ctx);
      sendJson(res, 200, { success: true, settings: buildOpenClawSafetySettings(await getAllSettings()) });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings' && req.method === 'GET') {
    sendJson(res, 200, await getAllSettings());
    return true;
  }

  if (url.pathname === '/api/settings' && req.method === 'PUT') {
    try {
      const patch = await parseJsonBody<Partial<AppSettings>>(req);
      const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
      for (const [key, value] of entries) {
        await setSetting(key, value);
      }
      if (patchTouchesSafety(patch)) {
        await handleSafetySettingsChange(ctx);
      }
      if (patchTouchesProxy(patch)) {
        await handleProxySettingsChange(ctx);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/environment' && req.method === 'GET') {
    try {
      sendJson(res, 200, {
        entries: await getManagedAppEnvironmentEntries(),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/environment' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ entries?: unknown }>(req);
      if (!Array.isArray(body.entries)) {
        sendJson(res, 400, { success: false, error: 'entries must be an array' });
        return true;
      }

      const entries = await replaceManagedAppEnvironmentEntries(body.entries);
      if (ctx.gatewayManager.getStatus().state === 'running') {
        await ctx.gatewayManager.restart();
      }

      sendJson(res, 200, { success: true, entries });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/web-search/providers' && req.method === 'GET') {
    try {
      const descriptors = listWebSearchProviderDescriptors();
      const [config, runtimeEnv] = await Promise.all([
        readOpenClawConfigDocument(),
        resolveGeeClawAppEnvironment({}),
      ]);
      const snapshot = readWebSearchSettingsSnapshot(config);
      const availabilityByProvider = buildWebSearchProviderAvailabilityMap(
        snapshot.providerConfigByProvider,
        runtimeEnv,
      );
      const envVarStatusByProvider = buildWebSearchProviderEnvVarStatusMap(runtimeEnv);

      sendJson(res, 200, {
        providers: descriptors.map((descriptor) => ({
          ...descriptor,
          availability: availabilityByProvider[descriptor.providerId],
          envVarStatuses: envVarStatusByProvider[descriptor.providerId],
        })),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/web-search' && req.method === 'GET') {
    try {
      const config = await readOpenClawConfigDocument();
      sendJson(res, 200, readWebSearchSettingsSnapshot(config));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/web-search' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<WebSearchSettingsPatch>(req);
      let changed = false;
      const settings = await mutateOpenClawConfigDocument((config) => {
        changed = applyWebSearchSettingsPatch(config, body);
        return {
          changed,
          result: readWebSearchSettingsSnapshot(config),
        };
      });

      if (changed && ctx.gatewayManager.getStatus().state === 'running') {
        ctx.gatewayManager.debouncedReload();
      }

      sendJson(res, 200, { success: true, settings });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/memory' && req.method === 'GET') {
    try {
      const config = await readOpenClawConfigDocument();
      sendJson(res, 200, await readMemorySettingsSnapshot(config));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/memory' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<MemorySettingsPatch>(req);
      let changed = false;
      const settings = await mutateOpenClawConfigDocument(async (config) => {
        changed = await applyMemorySettingsPatch(config, body);
        return {
          changed,
          result: await readMemorySettingsSnapshot(config),
        };
      });

      if (changed && ctx.gatewayManager.getStatus().state === 'running') {
        ctx.gatewayManager.debouncedReload();
      }

      sendJson(res, 200, { success: true, settings });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/web-search/providers/') && req.method === 'DELETE') {
    try {
      const providerId = decodeURIComponent(url.pathname.slice('/api/settings/web-search/providers/'.length));
      const supportedProvider = listWebSearchProviderDescriptors().find((entry) => entry.providerId === providerId);
      if (!supportedProvider) {
        sendJson(res, 404, { success: false, error: 'Unknown web search provider' });
        return true;
      }
      const config = await readOpenClawConfigDocument();
      const snapshot = readWebSearchSettingsSnapshot(config);

      if (snapshot.search.provider === providerId) {
        sendJson(res, 409, { success: false, error: 'Cannot delete config for the default web search provider' });
        return true;
      }

      let changed = false;
      const settings = await mutateOpenClawConfigDocument((currentConfig) => {
        changed = deleteWebSearchProviderConfig(currentConfig, supportedProvider.providerId);
        return {
          changed,
          result: readWebSearchSettingsSnapshot(currentConfig),
        };
      });

      if (changed && ctx.gatewayManager.getStatus().state === 'running') {
        ctx.gatewayManager.debouncedReload();
      }

      sendJson(res, 200, { success: true, settings });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'GET') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      sendJson(res, 200, { value: await getSetting(key) });
    } catch (error) {
      sendJson(res, 404, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'PUT') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      const body = await parseJsonBody<{ value: AppSettings[keyof AppSettings] }>(req);
      await setSetting(key, body.value);
      if (key === 'workspaceOnly' || key === 'securityPolicy') {
        await handleSafetySettingsChange(ctx);
      }
      if (
        key === 'proxyEnabled' ||
        key === 'proxyServer' ||
        key === 'proxyHttpServer' ||
        key === 'proxyHttpsServer' ||
        key === 'proxyAllServer' ||
        key === 'proxyBypassRules'
      ) {
        await handleProxySettingsChange(ctx);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/reset' && req.method === 'POST') {
    try {
      await resetSettings();
      await replaceManagedAppEnvironmentEntries([]);
      await handleSafetySettingsChange(ctx);
      await handleProxySettingsChange(ctx);
      sendJson(res, 200, { success: true, settings: await getAllSettings() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
