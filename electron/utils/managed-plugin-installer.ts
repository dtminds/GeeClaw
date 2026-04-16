import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveGeeClawAppEnvironment } from './app-env';
import { getManagedOpenClawConfigPath } from './openclaw-managed-profile';
import { getOpenClawConfigDir } from './paths';
import { buildProxyEnv } from './proxy';
import { getGeeClawRuntimePath } from './runtime-path';
import { setPathEnvValue } from './env-path';
import { getAllSettings } from './store';
import { getUvMirrorEnv } from './uv-env';
import { prepareWinSpawn } from './win-shell';
import { logger } from './logger';
import { getManagedPlugin, getManagedPlugins, type ManagedPluginDefinition } from './managed-plugin-registry';
import { getManagedPluginStatus, setManagedPluginStatus, type ManagedPluginStatus } from './managed-plugin-status';

type RunCommandResult = {
  stdout: string;
  stderr: string;
};

export type RunManagedPluginCommand = (options: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}) => Promise<RunCommandResult>;

export type ExtractManagedPluginPackage = (options: {
  archivePath: string;
  destinationRoot: string;
}) => Promise<void>;

export type EnsureManagedPluginInstalledOptions = {
  plugin: ManagedPluginDefinition;
  configDir: string;
  currentVersion?: string | null;
  runCommand?: RunManagedPluginCommand;
  extractPackage?: ExtractManagedPluginPackage;
  commandEnv?: NodeJS.ProcessEnv;
  installPolicy?: ManagedPluginInstallPolicy;
  onStatus?: (status: ManagedPluginStatus | null) => void;
};

export type EnsureManagedPluginInstalledResult = {
  action: 'installed' | 'noop';
  pluginId: string;
  installedVersion: string;
  previousVersion: string | null;
};

export type EnsureManagedPluginsReadyBeforeGatewayLaunchOptions = {
  plugins?: ManagedPluginDefinition[];
  openclawConfigDir: string;
  finalPath: string;
  managedAppEnv: Record<string, string | undefined>;
  uvEnv: Record<string, string | undefined>;
  proxyEnv: Record<string, string | undefined>;
};

export type ManagedPluginInstallPolicy = 'startup' | 'reconcile';

function resolveTarCommand(): string {
  return process.platform === 'win32' ? 'tar.exe' : 'tar';
}

function defaultRunManagedPluginCommand(options: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): Promise<RunCommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const prepared = prepareWinSpawn(options.command, options.args);
    const child = spawn(prepared.command, prepared.args, {
      cwd: options.cwd,
      env: options.env,
      shell: prepared.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', (status) => {
      if (status === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      rejectPromise(new Error(stderr.trim() || stdout.trim() || `${options.command} exited with code ${status ?? 'unknown'}`));
    });
  });
}

async function defaultExtractManagedPluginPackage(options: {
  archivePath: string;
  destinationRoot: string;
}): Promise<void> {
  await defaultRunManagedPluginCommand({
    command: resolveTarCommand(),
    args: ['-xzf', options.archivePath, '-C', options.destinationRoot],
    cwd: options.destinationRoot,
  });
}

function getPluginFinalDir(configDir: string, pluginId: string): string {
  return join(configDir, 'extensions', pluginId);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function getInstalledPluginVersion(configDir: string, pluginId: string): Promise<string | null> {
  const packageJsonPath = join(getPluginFinalDir(configDir, pluginId), 'package.json');
  if (!await pathExists(packageJsonPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<number | string> | null;
};

function parseSemver(version: string): ParsedSemver | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]
      ? match[4].split('.').map((segment) => (
        /^\d+$/.test(segment) ? Number(segment) : segment
      ))
      : null,
  };
}

function compareSemverIdentifiers(left: number | string, right: number | string): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  if (typeof left === 'number') {
    return -1;
  }
  if (typeof right === 'number') {
    return 1;
  }
  return left.localeCompare(right);
}

function compareManagedPluginVersions(left: string, right: string): number {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);

  if (!parsedLeft || !parsedRight) {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  }

  if (parsedLeft.major !== parsedRight.major) {
    return parsedLeft.major - parsedRight.major;
  }
  if (parsedLeft.minor !== parsedRight.minor) {
    return parsedLeft.minor - parsedRight.minor;
  }
  if (parsedLeft.patch !== parsedRight.patch) {
    return parsedLeft.patch - parsedRight.patch;
  }

  if (!parsedLeft.prerelease && !parsedRight.prerelease) {
    return 0;
  }
  if (!parsedLeft.prerelease) {
    return 1;
  }
  if (!parsedRight.prerelease) {
    return -1;
  }

  const maxLength = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftSegment = parsedLeft.prerelease[index];
    const rightSegment = parsedRight.prerelease[index];
    if (leftSegment === undefined) {
      return -1;
    }
    if (rightSegment === undefined) {
      return 1;
    }

    const comparison = compareSemverIdentifiers(leftSegment, rightSegment);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

function shouldInstallManagedPlugin(
  plugin: ManagedPluginDefinition,
  currentVersion: string | null,
  installPolicy: ManagedPluginInstallPolicy = 'startup',
): boolean {
  if (installPolicy === 'reconcile') {
    return currentVersion !== plugin.targetVersion;
  }

  if (!currentVersion) {
    return plugin.startupInstallPolicy === 'missing-or-outdated';
  }

  return compareManagedPluginVersions(currentVersion, plugin.targetVersion) < 0;
}

function createManagedPluginEnv(options: EnsureManagedPluginsReadyBeforeGatewayLaunchOptions): NodeJS.ProcessEnv {
  const { NODE_OPTIONS: _nodeOptions, ...forwardedEnv } = process.env;
  const forwardedEnvRecord = forwardedEnv as Record<string, string | undefined>;
  const runtimePath = getGeeClawRuntimePath(
    { ...forwardedEnvRecord, PATH: options.finalPath },
    { includeBundled: false },
  );

  return {
    ...setPathEnvValue(forwardedEnvRecord, runtimePath),
    ...options.managedAppEnv,
    ...options.uvEnv,
    ...options.proxyEnv,
    OPENCLAW_STATE_DIR: options.openclawConfigDir,
    OPENCLAW_CONFIG_PATH: getManagedOpenClawConfigPath(options.openclawConfigDir),
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_ASKPASS: 'echo',
    SSH_ASKPASS: 'echo',
  };
}

function emitManagedPluginStatus(
  plugin: ManagedPluginDefinition,
  status: ManagedPluginStatus | null,
  onStatus?: (status: ManagedPluginStatus | null) => void,
): void {
  if (!status || status.pluginId === plugin.pluginId) {
    setManagedPluginStatus(status);
    onStatus?.(status);
  }
}

function buildManagedPluginStepStatus(options: {
  plugin: ManagedPluginDefinition;
  stage: ManagedPluginStatus['stage'];
  message: string;
  installedVersion: string | null;
  error?: string;
}): ManagedPluginStatus {
  return {
    pluginId: options.plugin.pluginId,
    displayName: options.plugin.displayName,
    stage: options.stage,
    message: options.message,
    targetVersion: options.plugin.targetVersion,
    installedVersion: options.installedVersion,
    ...(options.error ? { error: options.error } : {}),
  };
}

async function createStagingRoot(configDir: string, pluginId: string): Promise<string> {
  const stagingBase = join(configDir, '.managed-plugin-staging');
  await mkdir(stagingBase, { recursive: true });
  return mkdtemp(join(stagingBase, `${pluginId}-${Date.now()}-${randomUUID()}-`));
}

async function cleanupDirectory(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: true });
}

async function promotePluginDirectory(options: {
  packageRoot: string;
  finalDir: string;
  pluginId: string;
}): Promise<void> {
  const finalParentDir = resolve(options.finalDir, '..');
  const backupDir = join(finalParentDir, `${options.pluginId}.replace-backup-${randomUUID()}`);
  const finalDirExists = await pathExists(options.finalDir);

  await mkdir(finalParentDir, { recursive: true });

  if (finalDirExists) {
    await rename(options.finalDir, backupDir);
  }

  try {
    await rename(options.packageRoot, options.finalDir);
  } catch (error) {
    await cleanupDirectory(options.finalDir);
    if (finalDirExists) {
      await cleanupDirectory(backupDir);
    }
    throw error;
  }

  if (finalDirExists) {
    await cleanupDirectory(backupDir);
  }
}

async function readPackageJson(packageRoot: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
}

async function resolveExtractedPackageRoot(destinationRoot: string): Promise<string> {
  const npmPackageRoot = join(destinationRoot, 'package');
  return await pathExists(join(npmPackageRoot, 'package.json')) ? npmPackageRoot : destinationRoot;
}

function parsePackFilename(stdout: string): string {
  const parsed = JSON.parse(stdout) as Array<{ filename?: unknown }>;
  const filename = parsed[0]?.filename;
  if (typeof filename !== 'string' || !filename.trim()) {
    throw new Error('npm pack did not return a package filename');
  }
  return filename;
}

function validatePluginManifest(packageJson: Record<string, unknown>): void {
  const openclaw = packageJson.openclaw;
  const extensions = openclaw && typeof openclaw === 'object' && !Array.isArray(openclaw)
    ? (openclaw as { extensions?: unknown }).extensions
    : undefined;

  if (!Array.isArray(extensions) || extensions.length === 0) {
    throw new Error('Managed plugin package.json is missing openclaw.extensions');
  }
}

function hasDependencies(packageJson: Record<string, unknown>): boolean {
  const dependencies = packageJson.dependencies;
  return !!dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies) && Object.keys(dependencies).length > 0;
}

export async function ensureManagedPluginInstalled(
  options: EnsureManagedPluginInstalledOptions,
): Promise<EnsureManagedPluginInstalledResult> {
  const runCommand = options.runCommand ?? defaultRunManagedPluginCommand;
  const extractPackage = options.extractPackage ?? defaultExtractManagedPluginPackage;
  const finalDir = getPluginFinalDir(options.configDir, options.plugin.pluginId);
  const currentVersion = options.currentVersion ?? await getInstalledPluginVersion(
    options.configDir,
    options.plugin.pluginId,
  );
  if (!shouldInstallManagedPlugin(options.plugin, currentVersion, options.installPolicy)) {
    return {
      action: 'noop',
      pluginId: options.plugin.pluginId,
      installedVersion: currentVersion ?? '',
      previousVersion: currentVersion,
    };
  }
  const stagingRoot = await createStagingRoot(options.configDir, options.plugin.pluginId);
  const packDir = join(stagingRoot, 'pack');
  const extractRoot = join(stagingRoot, 'extract');
  await mkdir(packDir, { recursive: true });
  await mkdir(extractRoot, { recursive: true });

  try {
    emitManagedPluginStatus(
      options.plugin,
      buildManagedPluginStepStatus({
        plugin: options.plugin,
        stage: 'installing',
        message: `正在下载 ${options.plugin.displayName} 插件…`,
        installedVersion: currentVersion,
      }),
      options.onStatus,
    );
    const packResult = await runCommand({
      command: 'npm',
      args: ['pack', `${options.plugin.packageName}@${options.plugin.targetVersion}`, '--ignore-scripts', '--json'],
      cwd: packDir,
      env: options.commandEnv,
    });
    const archivePath = join(packDir, parsePackFilename(packResult.stdout));

    await extractPackage({
      archivePath,
      destinationRoot: extractRoot,
    });

    emitManagedPluginStatus(
      options.plugin,
      buildManagedPluginStepStatus({
        plugin: options.plugin,
        stage: 'installing',
        message: `正在校验 ${options.plugin.displayName} 插件…`,
        installedVersion: currentVersion,
      }),
      options.onStatus,
    );
    const packageRoot = await resolveExtractedPackageRoot(extractRoot);
    const packageJson = await readPackageJson(packageRoot);
    validatePluginManifest(packageJson);

    if (hasDependencies(packageJson)) {
      emitManagedPluginStatus(
        options.plugin,
        buildManagedPluginStepStatus({
          plugin: options.plugin,
          stage: 'installing',
          message: `正在安装 ${options.plugin.displayName} 依赖…`,
          installedVersion: currentVersion,
        }),
        options.onStatus,
      );
      await runCommand({
        command: 'npm',
        args: ['install', '--omit=dev', '--ignore-scripts', '--silent'],
        cwd: packageRoot,
        env: options.commandEnv,
      });
    }

    emitManagedPluginStatus(
      options.plugin,
      buildManagedPluginStepStatus({
        plugin: options.plugin,
        stage: 'installing',
        message: `正在完成 ${options.plugin.displayName} 安装…`,
        installedVersion: currentVersion,
      }),
      options.onStatus,
    );
    await promotePluginDirectory({
      packageRoot,
      finalDir,
      pluginId: options.plugin.pluginId,
    });
    await cleanupDirectory(stagingRoot);

    return {
      action: 'installed',
      pluginId: options.plugin.pluginId,
      installedVersion: options.plugin.targetVersion,
      previousVersion: currentVersion,
    };
  } catch (error) {
    await cleanupDirectory(stagingRoot);
    await cleanupDirectory(finalDir);
    throw error;
  }
}

export async function ensureManagedPluginsReadyBeforeGatewayLaunch(
  options: EnsureManagedPluginsReadyBeforeGatewayLaunchOptions,
): Promise<EnsureManagedPluginInstalledResult[]> {
  const env = createManagedPluginEnv(options);
  const plugins = options.plugins ?? getManagedPlugins();
  const results: EnsureManagedPluginInstalledResult[] = [];

  for (const plugin of plugins) {
    const installedVersion = await getInstalledPluginVersion(options.openclawConfigDir, plugin.pluginId);
    const shouldInstall = shouldInstallManagedPlugin(plugin, installedVersion, 'startup');
    if (shouldInstall) {
      emitManagedPluginStatus(
        plugin,
        buildManagedPluginStepStatus({
          plugin,
          stage: 'checking',
          message: plugin.installMessage,
          installedVersion,
        }),
      );
    } else {
      emitManagedPluginStatus(plugin, null);
    }

    try {
      if (shouldInstall) {
        emitManagedPluginStatus(
          plugin,
          buildManagedPluginStepStatus({
            plugin,
            stage: 'installing',
            message: plugin.installMessage,
            installedVersion,
          }),
        );
      }

      const result = await ensureManagedPluginInstalled({
        plugin,
        configDir: options.openclawConfigDir,
        currentVersion: installedVersion,
        commandEnv: env,
        installPolicy: 'startup',
      });

      results.push(result);
      if (result.action === 'installed') {
        emitManagedPluginStatus(
          plugin,
          buildManagedPluginStepStatus({
            plugin,
            stage: 'installed',
            message: plugin.installMessage,
            installedVersion: result.installedVersion,
          }),
        );
      } else {
        emitManagedPluginStatus(plugin, null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitManagedPluginStatus(
        plugin,
        buildManagedPluginStepStatus({
          plugin,
          stage: 'failed',
          message: plugin.installMessage,
          installedVersion: null,
          error: message,
        }),
      );
      logger.error(`[managed-plugin] Failed to install ${plugin.pluginId}:`, error);
      if (plugin.requiredForStartup) {
        throw error;
      }
    }
  }

  return results;
}

const runningManagedPluginInstalls = new Map<string, Promise<EnsureManagedPluginInstalledResult>>();

export async function installManagedPluginNow(options: {
  pluginId: string;
}): Promise<EnsureManagedPluginInstalledResult> {
  const existing = runningManagedPluginInstalls.get(options.pluginId);
  if (existing) {
    return existing;
  }

  const plugin = getManagedPlugin(options.pluginId);
  if (!plugin) {
    throw new Error(`Unknown managed plugin: ${options.pluginId}`);
  }

  const installPromise = (async () => {
    const appSettings = await getAllSettings();
    const managedAppEnv = await resolveGeeClawAppEnvironment({});
    const uvEnv = await getUvMirrorEnv();
    const proxyEnv = buildProxyEnv(appSettings);
    const openclawConfigDir = getOpenClawConfigDir();
    const finalPath = getGeeClawRuntimePath(process.env as Record<string, string | undefined>);
    const commandEnv = createManagedPluginEnv({
      openclawConfigDir,
      finalPath,
      managedAppEnv,
      uvEnv,
      proxyEnv,
    });
    const installedVersion = await getInstalledPluginVersion(openclawConfigDir, plugin.pluginId);

    emitManagedPluginStatus(
      plugin,
      buildManagedPluginStepStatus({
        plugin,
        stage: 'checking',
        message: plugin.installMessage,
        installedVersion,
      }),
    );

    try {
      const result = await ensureManagedPluginInstalled({
        plugin,
        configDir: openclawConfigDir,
        currentVersion: installedVersion,
        commandEnv,
        installPolicy: 'reconcile',
      });

      emitManagedPluginStatus(plugin, null);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitManagedPluginStatus(
        plugin,
        buildManagedPluginStepStatus({
          plugin,
          stage: 'failed',
          message: plugin.installMessage,
          installedVersion,
          error: message,
        }),
      );
      logger.error(`[managed-plugin] Failed to install ${plugin.pluginId}:`, error);
      throw error;
    } finally {
      runningManagedPluginInstalls.delete(plugin.pluginId);
    }
  })();

  runningManagedPluginInstalls.set(options.pluginId, installPromise);
  return installPromise;
}
