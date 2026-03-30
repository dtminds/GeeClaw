import { execFile, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ensureDir, getGeeClawConfigDir, getResourcesDir } from './paths';
import { getBundledNpmPath } from './managed-bin';
import { prepareWinSpawn } from './win-shell';
import { logger } from './logger';
import { ensureManagedNpmPrefixOnUserPath, type UserPathUpdateStatus } from './user-path';

const execFileAsync = promisify(execFile);

export type CliMarketplaceCatalogItem = {
  id: string;
  title: string;
  packageName: string;
  binNames: string[];
  description?: string;
  homepage?: string;
  platforms?: Array<'darwin' | 'win32' | 'linux'>;
  installArgs?: string[];
};

export type CliMarketplaceActionLabel = 'install' | 'reinstall';

export type CliMarketplaceStatusItem = {
  id: string;
  title: string;
  description: string;
  homepage?: string;
  installed: boolean;
  actionLabel: CliMarketplaceActionLabel;
  source: 'system' | 'geeclaw' | 'none';
};

type CliMarketplaceSource = CliMarketplaceStatusItem['source'];

export interface CliMarketplaceServiceOptions {
  catalogPath?: string;
  catalogEntries?: CliMarketplaceCatalogItem[];
  findCommand?: (bin: string) => Promise<string | null>;
  commandExistsInManagedPrefix?: (bin: string) => Promise<boolean>;
  installWithBundledNpm?: (
    packageName: string,
    installArgs: string[],
    options: { prefixDir: string },
  ) => Promise<void>;
  ensureManagedPrefixOnUserPath?: (prefixDir: string) => Promise<UserPathUpdateStatus>;
  managedPrefixDir?: string;
}

const DEFAULT_PLATFORM_SUPPORT: Array<'darwin' | 'win32' | 'linux'> = ['darwin', 'win32', 'linux'];
const DEFAULT_CATALOG_PATH = join(getResourcesDir(), 'cli-marketplace', 'catalog.json');

function describeEntry(entry: CliMarketplaceCatalogItem, index: number): string {
  return entry.id ? `"${entry.id}"` : `at index ${index}`;
}

function validateCatalogEntries(entries: CliMarketplaceCatalogItem[]): void {
  entries.forEach((entry, index) => {
    const label = describeEntry(entry, index);
    if (!entry.id || typeof entry.id !== 'string') {
      throw new Error(`[cli-marketplace] Entry ${label} is missing required field "id"`);
    }
    if (!entry.title || typeof entry.title !== 'string') {
      throw new Error(`[cli-marketplace] Entry ${label} is missing required field "title"`);
    }
    if (!entry.packageName || typeof entry.packageName !== 'string') {
      throw new Error(`[cli-marketplace] Entry ${label} is missing required field "packageName"`);
    }
    if (!Array.isArray(entry.binNames) || entry.binNames.length === 0) {
      throw new Error(`[cli-marketplace] Entry ${label} must include a non-empty "binNames" array`);
    }
    for (const bin of entry.binNames) {
      if (!bin || typeof bin !== 'string') {
        throw new Error(`[cli-marketplace] Entry ${label} has an invalid bin name`);
      }
    }
  });
}

export class CliMarketplaceService {
  private readonly catalogPath: string;
  private readonly inlineCatalogEntries?: CliMarketplaceCatalogItem[];
  private readonly findCommand: (bin: string) => Promise<string | null>;
  private readonly commandExistsInManagedPrefix: (bin: string) => Promise<boolean>;
  private readonly installWithBundledNpm: (
    packageName: string,
    installArgs: string[],
    options: { prefixDir: string },
  ) => Promise<void>;
  private readonly ensureManagedPrefixOnUserPath: (prefixDir: string) => Promise<UserPathUpdateStatus>;
  private readonly managedPrefixDir: string;

  constructor(options?: CliMarketplaceServiceOptions) {
    this.catalogPath = options?.catalogPath ?? DEFAULT_CATALOG_PATH;
    this.inlineCatalogEntries = options?.catalogEntries;
    this.findCommand = options?.findCommand ?? defaultFindCommand;
    this.commandExistsInManagedPrefix = options?.commandExistsInManagedPrefix ?? defaultCommandExistsInManagedPrefix;
    this.installWithBundledNpm = options?.installWithBundledNpm ?? defaultInstallWithBundledNpm;
    this.ensureManagedPrefixOnUserPath = options?.ensureManagedPrefixOnUserPath ?? ensureManagedNpmPrefixOnUserPath;
    this.managedPrefixDir = options?.managedPrefixDir ?? getDefaultManagedPrefixDir();
  }

  async getCatalog(): Promise<CliMarketplaceStatusItem[]> {
    const entries = await this.loadCatalogEntries();
    const statuses = await Promise.all(entries.map((entry) => this.resolveEntryStatus(entry)));
    return statuses.filter((item): item is CliMarketplaceStatusItem => Boolean(item));
  }

  async install({ id }: { id: string }): Promise<CliMarketplaceStatusItem> {
    const entry = await this.getEntryById(id);
    ensureDir(this.managedPrefixDir);
    if (process.platform !== 'win32') {
      ensureDir(join(this.managedPrefixDir, 'bin'));
    }

    await this.installWithBundledNpm(entry.packageName, entry.installArgs ?? [], {
      prefixDir: this.managedPrefixDir,
    });

    try {
      const pathStatus = await this.ensureManagedPrefixOnUserPath(this.managedPrefixDir);
      logger.info(`[cli-marketplace] ensured managed npm PATH (${pathStatus}) for "${entry.id}"`);
    } catch (error) {
      logger.warn(`[cli-marketplace] Failed to update user PATH for managed npm prefix ${this.managedPrefixDir}:`, error);
    }

    const installedStatus = await this.resolveEntryStatus(entry);
    if (!installedStatus) {
      throw new Error(`Unable to resolve status for "${entry.id}" after install`);
    }

    return installedStatus;
  }

  private async loadCatalogEntries(): Promise<CliMarketplaceCatalogItem[]> {
    if (this.inlineCatalogEntries) {
      validateCatalogEntries(this.inlineCatalogEntries);
      return this.inlineCatalogEntries;
    }

    try {
      const content = await readFile(this.catalogPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        throw new Error('[cli-marketplace] Catalog file must contain an array');
      }

      const casted = parsed as CliMarketplaceCatalogItem[];
      validateCatalogEntries(casted);
      return casted;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async getEntryById(id: string): Promise<CliMarketplaceCatalogItem> {
    const entries = await this.loadCatalogEntries();
    const entry = entries.find((item) => item.id === id);
    if (!entry) {
      throw new Error(`Catalog entry "${id}" is missing`);
    }
    if (!this.supportsPlatform(entry)) {
      throw new Error(`Catalog entry "${id}" is not supported on ${process.platform}`);
    }
    return entry;
  }

  private supportsPlatform(entry: CliMarketplaceCatalogItem): boolean {
    if (!entry.platforms || entry.platforms.length === 0) {
      return DEFAULT_PLATFORM_SUPPORT.includes(process.platform as typeof DEFAULT_PLATFORM_SUPPORT[number]);
    }
    return entry.platforms.includes(process.platform as 'darwin' | 'win32' | 'linux');
  }

  private async resolveEntryStatus(entry: CliMarketplaceCatalogItem): Promise<CliMarketplaceStatusItem | null> {
    if (!this.supportsPlatform(entry)) {
      return null;
    }

    const { installed, source } = await this.detectEntrySource(entry);
    return {
      id: entry.id,
      title: entry.title,
      description: entry.description ?? '',
      homepage: entry.homepage,
      installed,
      actionLabel: installed ? 'reinstall' : 'install',
      source,
    };
  }

  private async detectEntrySource(entry: CliMarketplaceCatalogItem): Promise<{ installed: boolean; source: CliMarketplaceSource }> {
    for (const binName of entry.binNames) {
      if (!binName) continue;
      try {
        const commandPath = await this.findCommand(binName);
        if (commandPath) {
          return { installed: true, source: 'system' };
        }
      } catch {
        // ignore detection failures for a single bin
      }
    }

    for (const binName of entry.binNames) {
      if (!binName) continue;
      try {
        if (await this.commandExistsInManagedPrefix(binName)) {
          return { installed: true, source: 'geeclaw' };
        }
      } catch {
        // ignore prefix checks
      }
    }

    return { installed: false, source: 'none' };
  }
}

function getDefaultManagedPrefixDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'GeeClaw', 'npm-global');
  }
  return join(getGeeClawConfigDir(), 'npm-global');
}

async function defaultFindCommand(binName: string): Promise<string | null> {
  const candidates = await listCommandCandidates(binName);
  return candidates[0] ?? null;
}

function getPosixSearchDirs(): string[] {
  const pathEntries = (process.env.PATH ?? '')
    .split(':')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const fallbackDirs = [
    join(homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/snap/bin',
  ];

  return Array.from(new Set([...pathEntries, ...fallbackDirs]));
}

async function listCommandCandidates(command: string): Promise<string[]> {
  const candidates: string[] = [];

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('where.exe', [command], {
        timeout: 5000,
        windowsHide: true,
      });
      candidates.push(
        ...stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      );
    } catch {
      // ignore
    }

    const appData = process.env.APPDATA;
    if (appData) {
      candidates.push(join(appData, 'npm', `${command}.cmd`));
      candidates.push(join(appData, 'npm', command));
      candidates.push(join(appData, 'npm-cache', `${command}.cmd`));
      candidates.push(join(appData, 'npm-cache', command));
    }
  } else {
    try {
      const { stdout } = await execFileAsync('which', ['-a', command], {
        timeout: 5000,
        windowsHide: true,
      });
      candidates.push(
        ...stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      );
    } catch {
      // ignore
    }

    for (const dir of getPosixSearchDirs()) {
      candidates.push(join(dir, command));
    }
  }

  return filterExistingUniqueCandidates(candidates);
}

function filterExistingUniqueCandidates(candidates: string[]): string[] {
  const seen = new Set<string>();
  const filtered: string[] = [];

  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) {
      continue;
    }

    let normalized = candidate;
    try {
      normalized = realpathSync(candidate);
    } catch {
      // keep raw path
    }

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    filtered.push(candidate);
  }

  return filtered;
}

function getPrefixCandidates(prefixDir: string, binName: string): string[] {
  const candidates = [] as string[];
  if (process.platform === 'win32') {
    candidates.push(join(prefixDir, `${binName}.cmd`));
    candidates.push(join(prefixDir, binName));
    candidates.push(join(prefixDir, `${binName}.ps1`));
    candidates.push(join(prefixDir, 'bin', `${binName}.cmd`));
  } else {
    candidates.push(join(prefixDir, 'bin', binName));
    candidates.push(join(prefixDir, 'bin', `${binName}.sh`));
    candidates.push(join(prefixDir, binName));
  }
  return candidates;
}

async function defaultCommandExistsInManagedPrefix(binName: string): Promise<boolean> {
  const prefixDir = getDefaultManagedPrefixDir();
  return getPrefixCandidates(prefixDir, binName).some((candidate) => existsSync(candidate));
}

async function defaultInstallWithBundledNpm(
  packageName: string,
  installArgs: string[],
  options: { prefixDir: string },
): Promise<void> {
  const npmPath = getBundledNpmPath();
  if (!npmPath) {
    throw new Error('Bundled npm runtime is missing');
  }

  const args = ['install', '--global', packageName, ...installArgs];
  const env = {
    ...process.env,
    npm_config_prefix: options.prefixDir,
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
  };

  await new Promise<void>((resolve, reject) => {
    const forceShell = process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(npmPath);
    const { command, args: spawnArgs, shell } = prepareWinSpawn(npmPath, args, forceShell);
    const child = spawn(command, spawnArgs, { env, windowsHide: true, stdio: 'inherit', shell });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm install exited with code ${code}`));
    });
  });
}
