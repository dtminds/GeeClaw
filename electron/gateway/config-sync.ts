import { app } from 'electron';
import path from 'path';
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { getAllSettings } from '../utils/store';
import { resolveGeeClawAppEnvironment } from '../utils/app-env';
import { getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getProviderEnvVar, getKeyableProviderTypes } from '../utils/provider-registry';
import { getConfiguredOpenClawRuntime, type OpenClawRuntimeSource } from '../utils/openclaw-runtime';
import { getOpenClawConfigDir } from '../utils/paths';
import { getUvMirrorEnv } from '../utils/uv-env';
import { listConfiguredChannels } from '../utils/channel-config';
import { syncGatewayTokenToConfig, syncBrowserConfigToOpenClaw } from '../utils/openclaw-gateway-config';
import { buildProxyEnv, resolveProxySettings } from '../utils/proxy';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import { syncAllProviderRuntimeConfigToOpenClaw } from '../services/providers/provider-runtime-sync';
import { syncAllAgentConfigToOpenClaw } from "../services/agents/agent-runtime-sync";
import {
  ensureAlwaysEnabledSkillsConfigured,
  migrateManagedPreinstalledSkillsToBundledSource,
  syncExplicitSkillTogglesToOpenClaw,
  syncPreinstalledSkillLoadPathsToOpenClaw,
} from '../utils/skill-config';
import { sanitizeOpenClawConfig } from '../utils/openclaw-config-sanitize';
import { syncOpenClawSafetySettings } from '../utils/openclaw-safety-settings';
import {
  ensureAlwaysEnabledBundledPluginsConfigured,
  syncBundledPluginLoadPathsToOpenClaw,
} from '../utils/plugin-install';

import { syncAllChannelConfigToOpenClaw } from '../services/channels/channel-runtime-sync';
import {
  buildManagedOpenClawArgs,
  getManagedOpenClawConfigPath,
} from '../utils/openclaw-managed-profile';
import {
  getManagedAgentWorkspacePath,
  resolveManagedAgentWorkspacePath,
} from '../utils/managed-agent-workspace';
import { logger } from '../utils/logger';
import { setPathEnvValue } from '../utils/env-path';
import { getGeeClawRuntimePath, getGeeClawRuntimePathEntries } from '../utils/runtime-path';
import { getBundledNodePath } from '../utils/managed-bin';

const OPENCLAW_SETUP_TIMEOUT_MS = 300000;
const OPENCLAW_SETUP_SILENCE_WARNING_MS = 30000;
const OPENCLAW_SETUP_ARTIFACT_POLL_MS = 250;
const MANAGED_AGENT_HEARTBEAT_EVERY = '2h';
const MANAGED_AGENT_MAX_CONCURRENT = 3;
const BUILTIN_CHANNEL_EXTENSIONS = ['discord', 'telegram', 'qqbot'];

function cleanupStaleBuiltInExtensions(openclawConfigDir: string): void {
  for (const extensionId of BUILTIN_CHANNEL_EXTENSIONS) {
    const extensionDir = path.join(openclawConfigDir, 'extensions', extensionId);
    if (!existsSync(extensionDir)) {
      continue;
    }

    logger.info(`[plugin] Removing stale built-in extension copy: ${extensionId}`);
    try {
      rmSync(extensionDir, { recursive: true, force: true });
    } catch (error) {
      logger.warn(`[plugin] Failed to remove stale extension ${extensionId}:`, error);
    }
  }
}

/**
 * OpenClaw shared dist chunks resolve bare ESM imports from openclaw/node_modules,
 * not from dist/extensions/<ext>/node_modules. Link missing extension packages
 * into the top-level node_modules tree before launch so shared chunks can load.
 */
function ensureExtensionDepsResolvable(openclawDir: string): void {
  const extensionsDir = path.join(openclawDir, 'dist', 'extensions');
  const topLevelNodeModulesDir = path.join(openclawDir, 'node_modules');
  let linkedCount = 0;

  try {
    if (!existsSync(extensionsDir)) {
      return;
    }

    for (const extensionEntry of readdirSync(extensionsDir, { withFileTypes: true })) {
      if (!extensionEntry.isDirectory()) {
        continue;
      }

      const extensionNodeModulesDir = path.join(extensionsDir, extensionEntry.name, 'node_modules');
      if (!existsSync(extensionNodeModulesDir)) {
        continue;
      }

      for (const packageEntry of readdirSync(extensionNodeModulesDir, { withFileTypes: true })) {
        if (!packageEntry.isDirectory() || packageEntry.name === '.bin') {
          continue;
        }

        if (packageEntry.name.startsWith('@')) {
          const scopeDir = path.join(extensionNodeModulesDir, packageEntry.name);
          let scopedEntries: ReturnType<typeof readdirSync>;
          try {
            scopedEntries = readdirSync(scopeDir, { withFileTypes: true });
          } catch {
            continue;
          }

          for (const scopedEntry of scopedEntries) {
            if (!scopedEntry.isDirectory()) {
              continue;
            }

            const destination = path.join(topLevelNodeModulesDir, packageEntry.name, scopedEntry.name);
            if (existsSync(destination)) {
              continue;
            }

            try {
              mkdirSync(path.dirname(destination), { recursive: true });
              if (pathExistsButBroken(destination)) {
                rmSync(destination, { recursive: true, force: true });
              }
              symlinkSync(path.join(scopeDir, scopedEntry.name), destination, getDirectorySymlinkType());
              linkedCount++;
            } catch {
              // Non-fatal: best-effort for extension-only dependencies.
            }
          }

          continue;
        }

        const destination = path.join(topLevelNodeModulesDir, packageEntry.name);
        if (existsSync(destination)) {
          continue;
        }

        try {
          mkdirSync(path.dirname(destination), { recursive: true });
          if (pathExistsButBroken(destination)) {
            rmSync(destination, { recursive: true, force: true });
          }
          symlinkSync(path.join(extensionNodeModulesDir, packageEntry.name), destination, getDirectorySymlinkType());
          linkedCount++;
        } catch {
          // Non-fatal: best-effort for extension-only dependencies.
        }
      }
    }
  } catch {
    // Extension bundles may not exist yet in all runtime layouts.
  }

  if (linkedCount > 0) {
    logger.info(`[extension-deps] Linked ${linkedCount} extension packages into ${topLevelNodeModulesDir}`);
  }
}

function pathExistsButBroken(targetPath: string): boolean {
  if (existsSync(targetPath)) {
    return false;
  }

  try {
    lstatSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getDirectorySymlinkType(): 'dir' | 'junction' {
  return process.platform === 'win32' ? 'junction' : 'dir';
}

export interface GatewayLaunchContext {
  appSettings: Awaited<ReturnType<typeof getAllSettings>>;
  runtimeSource: OpenClawRuntimeSource;
  openclawDir: string;
  entryScript: string | null;
  commandPath: string;
  launchMode: 'fork';
  gatewayArgs: string[];
  forkEnv: Record<string, string | undefined>;
  mode: 'dev' | 'packaged';
  binPathExists: boolean;
  loadedProviderKeyCount: number;
  proxySummary: string;
  channelStartupSummary: string;
}

export function buildGatewayForkEnv(options: {
  baseEnv: NodeJS.ProcessEnv;
  finalPath: string;
  injectedEnv: Record<string, string | undefined>;
  openclawConfigDir: string;
  gatewayPort: number;
}): Record<string, string | undefined> {
  const { NODE_OPTIONS: _nodeOptions, ...forwardedEnv } = options.baseEnv;
  const forwardedEnvRecord = forwardedEnv as Record<string, string | undefined>;
  const forwardedEnvWithPath = setPathEnvValue(
    forwardedEnvRecord,
    getGeeClawRuntimePath({ ...forwardedEnvRecord, PATH: options.finalPath }, { includeBundled: false }),
  );

  return {
    ...forwardedEnvWithPath,
    ...options.injectedEnv,
    OPENCLAW_STATE_DIR: options.openclawConfigDir,
    OPENCLAW_CONFIG_PATH: getManagedOpenClawConfigPath(options.openclawConfigDir),
    OPENCLAW_GATEWAY_PORT: String(options.gatewayPort),
    OPENCLAW_NO_RESPAWN: '1',
  };
}

function getManagedWorkspaceDir(): string {
  return resolveManagedAgentWorkspacePath('main');
}

function getManagedSessionsDir(openclawConfigDir: string): string {
  return path.join(openclawConfigDir, 'agents', 'main', 'sessions');
}

async function ensureManagedWorkspaceConfig(openclawConfigDir: string, gatewayPort: number): Promise<void> {
  const configPath = getManagedOpenClawConfigPath(openclawConfigDir);

  await mkdir(openclawConfigDir, { recursive: true });

  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`Failed to parse managed OpenClaw config at ${configPath}: ${String(error)}`, {
        cause: error,
      });
    }
  }

  const agents = (
    config.agents && typeof config.agents === 'object'
      ? { ...(config.agents as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  const defaults = (
    agents.defaults && typeof agents.defaults === 'object'
      ? { ...(agents.defaults as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  const heartbeat = (
    defaults.heartbeat && typeof defaults.heartbeat === 'object' && !Array.isArray(defaults.heartbeat)
      ? { ...(defaults.heartbeat as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;

  defaults.workspace = getManagedAgentWorkspacePath('main');
  heartbeat.every = MANAGED_AGENT_HEARTBEAT_EVERY;
  defaults.heartbeat = heartbeat;
  defaults.maxConcurrent = MANAGED_AGENT_MAX_CONCURRENT;
  agents.defaults = defaults;
  config.agents = agents;

  const gateway = (
    config.gateway && typeof config.gateway === 'object'
      ? { ...(config.gateway as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  gateway.port = gatewayPort;
  config.gateway = gateway;

  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function resolveOpenClawSetupCommand(entryScript: string): {
  command: string;
  args: string[];
  envPatch?: Record<string, string>;
} {
  const bundledNodePath = getBundledNodePath();
  if (bundledNodePath) {
    return {
      command: bundledNodePath,
      args: [entryScript],
    };
  }

  return {
    command: process.execPath,
    args: [entryScript],
    envPatch: {
      ELECTRON_RUN_AS_NODE: '1',
    },
  };
}

async function runManagedProfileSetupOnce(options: {
  openclawConfigDir: string;
  openclawDir: string;
  entryScript: string;
  finalPath: string;
  managedAppEnv: Record<string, string | undefined>;
  uvEnv: Record<string, string | undefined>;
  proxyEnv: Record<string, string | undefined>;
  gatewayPort: number;
}): Promise<void> {
  const workspaceDir = getManagedWorkspaceDir();
  const sessionsDir = getManagedSessionsDir(options.openclawConfigDir);
  const setupArgs = buildManagedOpenClawArgs('setup');
  const setupEnv = buildGatewayForkEnv({
    baseEnv: process.env,
    finalPath: options.finalPath,
    injectedEnv: {
      ...options.managedAppEnv,
      ...options.uvEnv,
      ...options.proxyEnv,
      ELECTRON_RUN_AS_NODE: '1',
      OPENCLAW_EMBEDDED_IN: 'GeeClaw',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_ASKPASS: 'echo',
      SSH_ASKPASS: 'echo',
    },
    openclawConfigDir: options.openclawConfigDir,
    gatewayPort: options.gatewayPort,
  });
  const setupCommand = resolveOpenClawSetupCommand(options.entryScript);

  await new Promise<void>((resolve, reject) => {
    const child: ChildProcess = spawn(
      setupCommand.command,
      [...setupCommand.args, ...setupArgs],
      {
        cwd: options.openclawDir,
        env: {
          ...setupEnv,
          ...setupCommand.envPatch,
        } as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    logger.info(
      `OpenClaw setup spawned (pid=${child.pid ?? 'unknown'}, command="${setupCommand.command}", cwd="${options.openclawDir}")`,
    );

    const stderrLines: string[] = [];
    let settled = false;
    let childExited = false;
    let silenceWarningTimer: NodeJS.Timeout | null = null;
    const clearSilenceWarningTimer = () => {
      if (!silenceWarningTimer) {
        return;
      }
      clearTimeout(silenceWarningTimer);
      silenceWarningTimer = null;
    };
    const resolveDiagnostics = () => ({
      workspaceExists: existsSync(workspaceDir),
      sessionsExists: existsSync(sessionsDir),
    });
    const armSilenceWarningTimer = () => {
      clearSilenceWarningTimer();
      silenceWarningTimer = setTimeout(() => {
        const diagnostics = resolveDiagnostics();
        logger.warn(
          `OpenClaw setup has produced no output for ${OPENCLAW_SETUP_SILENCE_WARNING_MS}ms; still waiting (workspaceExists=${diagnostics.workspaceExists}, sessionsExists=${diagnostics.sessionsExists})`,
        );
      }, OPENCLAW_SETUP_SILENCE_WARNING_MS);
    };
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(artifactPoll);
      clearSilenceWarningTimer();
      resolve();
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(artifactPoll);
      clearSilenceWarningTimer();
      reject(error);
    };
    const maybeResolveFromReadyArtifacts = (reason: string) => {
      if (settled || !existsSync(workspaceDir) || !existsSync(sessionsDir)) {
        return;
      }

      logger.info(`Managed OpenClaw profile initialized (${reason})`);
      resolveOnce();

      setTimeout(() => {
        if (childExited) {
          return;
        }
        try {
          child.kill();
          logger.warn('OpenClaw setup helper did not exit after readiness; terminating lingering setup process');
        } catch {
          // ignore
        }
      }, 2000);
    };
    const timeout = setTimeout(() => {
      const diagnostics = resolveDiagnostics();
      try {
        child.kill();
      } catch {
        // ignore
      }
      rejectOnce(new Error(
        `OpenClaw setup timed out after ${OPENCLAW_SETUP_TIMEOUT_MS}ms (workspaceExists=${diagnostics.workspaceExists}, sessionsExists=${diagnostics.sessionsExists})`,
      ));
    }, OPENCLAW_SETUP_TIMEOUT_MS);
    const artifactPoll = setInterval(() => {
      maybeResolveFromReadyArtifacts('poll');
    }, OPENCLAW_SETUP_ARTIFACT_POLL_MS);

    armSilenceWarningTimer();

    child.stdout?.on('data', (data) => {
      armSilenceWarningTimer();
      const raw = data.toString();
      for (const line of raw.split(/\r?\n/)) {
        const normalized = line.trim();
        if (!normalized) continue;
        logger.debug(`[OpenClaw setup stdout] ${normalized}`);
        maybeResolveFromReadyArtifacts(`stdout:${normalized}`);
      }
    });

    child.stderr?.on('data', (data) => {
      armSilenceWarningTimer();
      const raw = data.toString();
      for (const line of raw.split(/\r?\n/)) {
        const normalized = line.trim();
        if (!normalized) continue;
        stderrLines.push(normalized);
        logger.warn(`[OpenClaw setup stderr] ${normalized}`);
      }
    });

    child.on('error', (error) => {
      childExited = true;
      rejectOnce(error);
    });

    child.on('exit', (code) => {
      childExited = true;
      if (settled) {
        return;
      }
      if (code === 0 && existsSync(workspaceDir) && existsSync(sessionsDir)) {
        logger.info('Managed OpenClaw profile initialized (exit)');
        resolveOnce();
        return;
      }

      const detail = stderrLines.length > 0
        ? ` Last stderr: ${stderrLines.slice(-5).join(' | ')}`
        : '';
      rejectOnce(new Error(`OpenClaw setup exited with code ${code ?? 'unknown'}.${detail}`));
    });

    maybeResolveFromReadyArtifacts('initial');
  });
}

async function ensureManagedProfileSetup(options: {
  openclawConfigDir: string;
  openclawDir: string;
  entryScript: string;
  finalPath: string;
  managedAppEnv: Record<string, string | undefined>;
  uvEnv: Record<string, string | undefined>;
  proxyEnv: Record<string, string | undefined>;
  gatewayPort: number;
}): Promise<void> {
  const workspaceDir = getManagedWorkspaceDir();
  const sessionsDir = getManagedSessionsDir(options.openclawConfigDir);
  if (existsSync(workspaceDir) && existsSync(sessionsDir)) {
    return;
  }

  await ensureManagedWorkspaceConfig(options.openclawConfigDir, options.gatewayPort);

  logger.info(
    `Managed OpenClaw workspace is missing; rewriting config and running setup for ${options.openclawConfigDir}`,
  );
  await runManagedProfileSetupOnce(options);
}

export async function syncGatewayConfigBeforeLaunch(
  appSettings: Awaited<ReturnType<typeof getAllSettings>>,
  port: number,
): Promise<void> {
  // Sync channels and agents FIRST so that if they were manually deleted from
  // openclaw.json, they are restored from the local store before any other
  // startup routine calls writeOpenClawConfig() and accidentally wipes the store.
  try {
    await syncAllChannelConfigToOpenClaw();
  } catch (err) {
    logger.warn('Failed to sync channel configs to openclaw.json on startup:', err);
  }

  try {
    await syncAllAgentConfigToOpenClaw();
  } catch (err) {
    logger.warn('Failed to sync agent configs to openclaw.json on startup:', err);
  }

  try {
    cleanupStaleBuiltInExtensions(getOpenClawConfigDir());
  } catch (err) {
    logger.warn('Failed to clean stale built-in extensions:', err);
  }

  await syncProxyConfigToOpenClaw(appSettings);

  try {
    await sanitizeOpenClawConfig();
  } catch (err) {
    logger.warn('Failed to sanitize openclaw.json:', err);
  }

  try {
    await syncOpenClawSafetySettings(appSettings);
  } catch (err) {
    logger.warn('Failed to sync safety settings to openclaw.json:', err);
  }

  try {
    await syncBundledPluginLoadPathsToOpenClaw();
  } catch (err) {
    logger.warn('Failed to sync bundled plugin load paths to openclaw.json:', err);
  }

  try {
    await syncPreinstalledSkillLoadPathsToOpenClaw();
  } catch (err) {
    logger.warn('Failed to sync bundled skill load paths to openclaw.json:', err);
  }

  try {
    await migrateManagedPreinstalledSkillsToBundledSource();
  } catch (err) {
    logger.warn('Failed to migrate managed preinstalled skills to bundled sources:', err);
  }

  try {
    await ensureAlwaysEnabledBundledPluginsConfigured();
  } catch (err) {
    logger.warn('Failed to sync always-enabled bundled plugins to openclaw.json:', err);
  }

  try {
    await syncGatewayTokenToConfig(appSettings.gatewayToken, port);
  } catch (err) {
    logger.warn('Failed to sync gateway token to openclaw.json:', err);
  }

  try {
    await syncBrowserConfigToOpenClaw();
  } catch (err) {
    logger.warn('Failed to sync browser config to openclaw.json:', err);
  }

  try {
    await syncExplicitSkillTogglesToOpenClaw();
  } catch (err) {
    logger.warn('Failed to sync explicit skill toggles to openclaw.json on startup:', err);
  }

  try {
    await ensureAlwaysEnabledSkillsConfigured();
  } catch (err) {
    logger.warn('Failed to sync always-enabled skills to openclaw.json on startup:', err);
  }

  try {
    await syncAllProviderRuntimeConfigToOpenClaw();
  } catch (err) {
    logger.warn('Failed to sync provider configs to openclaw.json on startup:', err);
  }
}

async function loadProviderEnv(): Promise<{ providerEnv: Record<string, string>; loadedProviderKeyCount: number }> {
  const providerEnv: Record<string, string> = {};
  const providerTypes = getKeyableProviderTypes();
  let loadedProviderKeyCount = 0;

  try {
    const defaultProviderId = await getDefaultProvider();
    if (defaultProviderId) {
      const defaultProvider = await getProvider(defaultProviderId);
      const defaultProviderType = defaultProvider?.type;
      const defaultProviderKey = await getApiKey(defaultProviderId);
      if (defaultProviderType && defaultProviderKey) {
        const envVar = getProviderEnvVar(defaultProviderType);
        if (envVar) {
          providerEnv[envVar] = defaultProviderKey;
          loadedProviderKeyCount++;
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load default provider key for environment injection:', err);
  }

  for (const providerType of providerTypes) {
    try {
      const key = await getApiKey(providerType);
      if (key) {
        const envVar = getProviderEnvVar(providerType);
        if (envVar) {
          providerEnv[envVar] = key;
          loadedProviderKeyCount++;
        }
      }
    } catch (err) {
      logger.warn(`Failed to load API key for ${providerType}:`, err);
    }
  }

  return { providerEnv, loadedProviderKeyCount };
}

async function resolveChannelStartupPolicy(): Promise<{
  skipChannels: boolean;
  channelStartupSummary: string;
}> {
  try {
    const configuredChannels = await listConfiguredChannels();
    if (configuredChannels.length === 0) {
      return {
        skipChannels: true,
        channelStartupSummary: 'skipped(no configured channels)',
      };
    }

    return {
      skipChannels: false,
      channelStartupSummary: `enabled(${configuredChannels.join(',')})`,
    };
  } catch (error) {
    logger.warn('Failed to determine configured channels for gateway launch:', error);
    return {
      skipChannels: false,
      channelStartupSummary: 'enabled(unknown)',
    };
  }
}

export async function prepareGatewayLaunchContext(port: number): Promise<GatewayLaunchContext> {
  const runtime = await getConfiguredOpenClawRuntime();
  const openclawDir = runtime.dir;
  const entryScript = runtime.entryPath;
  const commandPath = runtime.commandPath ?? runtime.entryPath;

  if (!runtime.packageExists || !commandPath) {
    throw new Error(runtime.error || 'Bundled OpenClaw runtime not found');
  }

  if (!entryScript || !existsSync(entryScript)) {
    throw new Error(`OpenClaw entry script not found at: ${entryScript}`);
  }

  const mode = app.isPackaged ? 'packaged' : 'dev';

  const baseProcessEnv = process.env as Record<string, string | undefined>;
  const pathEntries = getGeeClawRuntimePathEntries(baseProcessEnv);
  const binPathExists = pathEntries.length > 0;
  const finalPath = getGeeClawRuntimePath(baseProcessEnv);

  const appSettings = await getAllSettings();
  const uvEnv = await getUvMirrorEnv();
  const proxyEnv = buildProxyEnv(appSettings);
  const managedAppEnv = await resolveGeeClawAppEnvironment({});
  const openclawConfigDir = getOpenClawConfigDir();

  await ensureManagedProfileSetup({
    openclawConfigDir,
    openclawDir,
    entryScript,
    finalPath,
    managedAppEnv,
    uvEnv,
    proxyEnv,
    gatewayPort: port,
  });

  await syncGatewayConfigBeforeLaunch(appSettings, port);

  if (runtime.source === 'bundled') {
    ensureExtensionDepsResolvable(openclawDir);
  }

  const gatewayArgs = buildManagedOpenClawArgs('gateway', [
    '--port',
    String(port),
    '--token',
    appSettings.gatewayToken,
    '--allow-unconfigured',
  ]);
  const { providerEnv, loadedProviderKeyCount } = await loadProviderEnv();
  const { skipChannels, channelStartupSummary } = await resolveChannelStartupPolicy();
  const resolvedProxy = resolveProxySettings(appSettings);
  const proxySummary = appSettings.proxyEnabled
    ? `http=${resolvedProxy.httpProxy || '-'}, https=${resolvedProxy.httpsProxy || '-'}, all=${resolvedProxy.allProxy || '-'}`
    : 'disabled';

  const forkEnv = buildGatewayForkEnv({
    baseEnv: process.env,
    finalPath,
    injectedEnv: {
      ...managedAppEnv,
      ...providerEnv,
      ...uvEnv,
      ...proxyEnv,
      OPENCLAW_GATEWAY_TOKEN: appSettings.gatewayToken,
      OPENCLAW_SKIP_CHANNELS: skipChannels ? '1' : '',
      CLAWDBOT_SKIP_CHANNELS: skipChannels ? '1' : '',
    },
    openclawConfigDir,
    gatewayPort: port,
  });

  return {
    appSettings,
    runtimeSource: runtime.source,
    openclawDir,
    entryScript,
    commandPath,
    launchMode: 'fork',
    gatewayArgs,
    forkEnv,
    mode,
    binPathExists,
    loadedProviderKeyCount,
    proxySummary,
    channelStartupSummary,
  };
}
