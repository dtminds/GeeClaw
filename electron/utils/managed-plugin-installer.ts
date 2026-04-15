import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getManagedOpenClawConfigPath } from './openclaw-managed-profile';
import { getGeeClawRuntimePath } from './runtime-path';
import { setPathEnvValue } from './env-path';
import { prepareWinSpawn } from './win-shell';
import { logger } from './logger';
import { getManagedPlugins, type ManagedPluginDefinition } from './managed-plugin-registry';
import { setManagedPluginStatus } from './managed-plugin-status';

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
  runCommand?: RunManagedPluginCommand;
  extractPackage?: ExtractManagedPluginPackage;
  commandEnv?: NodeJS.ProcessEnv;
};

export type EnsureManagedPluginInstalledResult = {
  action: 'installed';
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

async function createStagingRoot(configDir: string, pluginId: string): Promise<string> {
  const stagingBase = join(configDir, '.managed-plugin-staging');
  await mkdir(stagingBase, { recursive: true });
  return mkdtemp(join(stagingBase, `${pluginId}-${Date.now()}-${randomUUID()}-`));
}

async function cleanupDirectory(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: true });
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
  const currentVersion = await getInstalledPluginVersion(options.configDir, options.plugin.pluginId);
  const stagingRoot = await createStagingRoot(options.configDir, options.plugin.pluginId);
  const packDir = join(stagingRoot, 'pack');
  const extractRoot = join(stagingRoot, 'extract');
  await mkdir(packDir, { recursive: true });
  await mkdir(extractRoot, { recursive: true });

  try {
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

    const packageRoot = await resolveExtractedPackageRoot(extractRoot);
    const packageJson = await readPackageJson(packageRoot);
    validatePluginManifest(packageJson);

    if (hasDependencies(packageJson)) {
      await runCommand({
        command: 'npm',
        args: ['install', '--omit=dev', '--ignore-scripts', '--silent'],
        cwd: packageRoot,
        env: options.commandEnv,
      });
    }

    await cleanupDirectory(finalDir);
    await mkdir(resolve(finalDir, '..'), { recursive: true });
    await rename(packageRoot, finalDir);
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
    setManagedPluginStatus({
      pluginId: plugin.pluginId,
      displayName: plugin.displayName,
      stage: 'checking',
      message: plugin.installMessage,
      targetVersion: plugin.targetVersion,
      installedVersion,
    });

    try {
      setManagedPluginStatus({
        pluginId: plugin.pluginId,
        displayName: plugin.displayName,
        stage: 'installing',
        message: plugin.installMessage,
        targetVersion: plugin.targetVersion,
        installedVersion,
      });

      const result = await ensureManagedPluginInstalled({
        plugin,
        configDir: options.openclawConfigDir,
        commandEnv: env,
      });

      results.push(result);
      setManagedPluginStatus({
        pluginId: plugin.pluginId,
        displayName: plugin.displayName,
        stage: 'installed',
        message: plugin.installMessage,
        targetVersion: plugin.targetVersion,
        installedVersion: result.installedVersion,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setManagedPluginStatus({
        pluginId: plugin.pluginId,
        displayName: plugin.displayName,
        stage: 'failed',
        message: plugin.installMessage,
        targetVersion: plugin.targetVersion,
        installedVersion: null,
        error: message,
      });
      logger.error(`[managed-plugin] Failed to install ${plugin.pluginId}:`, error);
      if (plugin.requiredForStartup) {
        throw error;
      }
    }
  }

  return results;
}
