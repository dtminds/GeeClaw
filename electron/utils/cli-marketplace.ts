import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ensureDir, getGeeClawConfigDir, getResourcesDir } from './paths';
import { getBundledNpmPath, getBundledNpxPath } from './managed-bin';
import { prepareWinSpawn } from './win-shell';
import { logger } from './logger';
import { ensureManagedNpmPrefixOnUserPath, type UserPathUpdateStatus } from './user-path';
import { getGeeClawCommandSearchDirs } from './runtime-path';

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
  postInstallSkills?: string[];
  postUninstallSkills?: string[];
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
type CliMarketplaceJobOperation = 'install' | 'uninstall';
type CliMarketplaceJobStatus = 'running' | 'succeeded' | 'failed';
type CliMarketplaceSkillCommand = 'add' | 'remove';
type CliMarketplaceLogAppender = (chunk: string) => void;

export type CliMarketplaceJobSnapshot = {
  id: string;
  itemId: string;
  title: string;
  operation: CliMarketplaceJobOperation;
  status: CliMarketplaceJobStatus;
  logs: string;
  startedAt: string;
  finishedAt: string | null;
  error?: string;
};

export interface CliMarketplaceServiceOptions {
  catalogPath?: string;
  catalogEntries?: CliMarketplaceCatalogItem[];
  findCommand?: (bin: string) => Promise<string | null>;
  commandExistsInManagedPrefix?: (bin: string) => Promise<boolean>;
  installWithBundledNpm?: (
    packageName: string,
    installArgs: string[],
    options: { prefixDir: string; appendLog?: CliMarketplaceLogAppender },
  ) => Promise<void>;
  uninstallWithBundledNpm?: (
    packageName: string,
    options: { prefixDir: string; appendLog?: CliMarketplaceLogAppender },
  ) => Promise<void>;
  runSkillCommandWithBundledNpx?: (
    command: CliMarketplaceSkillCommand,
    source: string,
    options: { prefixDir: string; appendLog?: CliMarketplaceLogAppender },
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
    if (entry.postInstallSkills !== undefined) {
      if (!Array.isArray(entry.postInstallSkills) || entry.postInstallSkills.some((skill) => !skill || typeof skill !== 'string')) {
        throw new Error(`[cli-marketplace] Entry ${label} has an invalid "postInstallSkills" array`);
      }
    }
    if (entry.postUninstallSkills !== undefined) {
      if (!Array.isArray(entry.postUninstallSkills) || entry.postUninstallSkills.some((skill) => !skill || typeof skill !== 'string')) {
        throw new Error(`[cli-marketplace] Entry ${label} has an invalid "postUninstallSkills" array`);
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
    options: { prefixDir: string; appendLog?: CliMarketplaceLogAppender },
  ) => Promise<void>;
  private readonly uninstallWithBundledNpm: (
    packageName: string,
    options: { prefixDir: string; appendLog?: CliMarketplaceLogAppender },
  ) => Promise<void>;
  private readonly runSkillCommandWithBundledNpx: (
    command: CliMarketplaceSkillCommand,
    source: string,
    options: { prefixDir: string; appendLog?: CliMarketplaceLogAppender },
  ) => Promise<void>;
  private readonly ensureManagedPrefixOnUserPath: (prefixDir: string) => Promise<UserPathUpdateStatus>;
  private readonly managedPrefixDir: string;
  private readonly jobs = new Map<string, CliMarketplaceJobSnapshot>();

  constructor(options?: CliMarketplaceServiceOptions) {
    this.catalogPath = options?.catalogPath ?? DEFAULT_CATALOG_PATH;
    this.inlineCatalogEntries = options?.catalogEntries;
    this.findCommand = options?.findCommand ?? defaultFindCommand;
    this.commandExistsInManagedPrefix = options?.commandExistsInManagedPrefix ?? defaultCommandExistsInManagedPrefix;
    this.installWithBundledNpm = options?.installWithBundledNpm ?? defaultInstallWithBundledNpm;
    this.uninstallWithBundledNpm = options?.uninstallWithBundledNpm ?? defaultUninstallWithBundledNpm;
    this.runSkillCommandWithBundledNpx = options?.runSkillCommandWithBundledNpx ?? defaultRunSkillCommandWithBundledNpx;
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
    return this.installEntry(entry);
  }

  async uninstall({ id }: { id: string }): Promise<CliMarketplaceStatusItem> {
    const entry = await this.getEntryById(id);
    return this.uninstallEntry(entry);
  }

  async startInstallJob({ id }: { id: string }): Promise<CliMarketplaceJobSnapshot> {
    const entry = await this.getEntryById(id);
    const job = this.createJob(entry, 'install');
    void this.runJob(job, async () => {
      await this.installEntry(entry, this.appendJobLog(job));
    });
    return this.getJob(job.id);
  }

  async startUninstallJob({ id }: { id: string }): Promise<CliMarketplaceJobSnapshot> {
    const entry = await this.getEntryById(id);
    const job = this.createJob(entry, 'uninstall');
    void this.runJob(job, async () => {
      await this.uninstallEntry(entry, this.appendJobLog(job));
    });
    return this.getJob(job.id);
  }

  getJob(jobId: string): CliMarketplaceJobSnapshot {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`CLI marketplace job "${jobId}" was not found`);
    }
    return { ...job };
  }

  private async installEntry(
    entry: CliMarketplaceCatalogItem,
    appendLog?: CliMarketplaceLogAppender,
  ): Promise<CliMarketplaceStatusItem> {
    ensureDir(this.managedPrefixDir);
    if (process.platform !== 'win32') {
      ensureDir(join(this.managedPrefixDir, 'bin'));
    }

    await this.installWithBundledNpm(entry.packageName, entry.installArgs ?? [], {
      prefixDir: this.managedPrefixDir,
      appendLog,
    });

    for (const source of entry.postInstallSkills ?? []) {
      await this.runSkillCommandWithBundledNpx('add', source, {
        prefixDir: this.managedPrefixDir,
        appendLog,
      });
    }

    try {
      const pathStatus = await this.ensureManagedPrefixOnUserPath(this.managedPrefixDir);
      logger.info(`[cli-marketplace] ensured managed npm PATH (${pathStatus}) for "${entry.id}"`);
    } catch (error) {
      logger.warn(`[cli-marketplace] Failed to update user PATH for managed npm prefix ${this.managedPrefixDir}:`, error);
      appendLog?.(`[warn] Failed to update user PATH automatically: ${formatUnknownError(error)}\n`);
    }

    const installedStatus = await this.resolveEntryStatus(entry);
    if (!installedStatus) {
      throw new Error(`Unable to resolve status for "${entry.id}" after install`);
    }

    return installedStatus;
  }

  private async uninstallEntry(
    entry: CliMarketplaceCatalogItem,
    appendLog?: CliMarketplaceLogAppender,
  ): Promise<CliMarketplaceStatusItem> {
    for (const source of entry.postUninstallSkills ?? []) {
      await this.runSkillCommandWithBundledNpx('remove', source, {
        prefixDir: this.managedPrefixDir,
        appendLog,
      });
    }

    await this.uninstallWithBundledNpm(entry.packageName, {
      prefixDir: this.managedPrefixDir,
      appendLog,
    });

    const status = await this.resolveEntryStatus(entry);
    if (!status) {
      throw new Error(`Unable to resolve status for "${entry.id}" after uninstall`);
    }

    return status;
  }

  private createJob(
    entry: CliMarketplaceCatalogItem,
    operation: CliMarketplaceJobOperation,
  ): CliMarketplaceJobSnapshot {
    const job: CliMarketplaceJobSnapshot = {
      id: randomUUID(),
      itemId: entry.id,
      title: entry.title,
      operation,
      status: 'running',
      logs: '',
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  private appendJobLog(job: CliMarketplaceJobSnapshot): CliMarketplaceLogAppender {
    return (chunk: string) => {
      const current = this.jobs.get(job.id);
      if (!current || !chunk) {
        return;
      }
      current.logs += normalizeLogChunk(chunk);
    };
  }

  private async runJob(
    job: CliMarketplaceJobSnapshot,
    task: () => Promise<void>,
  ): Promise<void> {
    try {
      await task();
      const current = this.jobs.get(job.id);
      if (current) {
        current.status = 'succeeded';
        current.finishedAt = new Date().toISOString();
      }
    } catch (error) {
      const current = this.jobs.get(job.id);
      if (current) {
        current.status = 'failed';
        current.finishedAt = new Date().toISOString();
        current.error = formatUnknownError(error);
        current.logs += `[error] ${current.error}\n`;
      }
    }
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
    for (const dir of getGeeClawCommandSearchDirs()) {
      candidates.push(join(dir, `${command}.cmd`));
      candidates.push(join(dir, command));
      candidates.push(join(dir, `${command}.ps1`));
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

    for (const dir of getGeeClawCommandSearchDirs()) {
      candidates.push(join(dir, command));
      candidates.push(join(dir, `${command}.sh`));
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
  options: { prefixDir: string; appendLog?: CliMarketplaceLogAppender },
): Promise<void> {
  const npmPath = getBundledNpmPath();
  if (!npmPath) {
    throw new Error('Bundled npm runtime is missing');
  }

  const args = ['install', '--global', packageName, ...installArgs];
  await runBundledCommand({
    executablePath: npmPath,
    displayCommand: 'npm',
    args,
    prefixDir: options.prefixDir,
    appendLog: options.appendLog,
    failureMessage: 'npm install exited',
  });
}

async function defaultUninstallWithBundledNpm(
  packageName: string,
  options: { prefixDir: string; appendLog?: CliMarketplaceLogAppender },
): Promise<void> {
  const npmPath = getBundledNpmPath();
  if (!npmPath) {
    throw new Error('Bundled npm runtime is missing');
  }

  await runBundledCommand({
    executablePath: npmPath,
    displayCommand: 'npm',
    args: ['uninstall', '--global', packageName],
    prefixDir: options.prefixDir,
    appendLog: options.appendLog,
    failureMessage: 'npm uninstall exited',
  });
}

async function defaultRunSkillCommandWithBundledNpx(
  command: CliMarketplaceSkillCommand,
  source: string,
  options: { prefixDir: string; appendLog?: CliMarketplaceLogAppender },
): Promise<void> {
  const npxPath = getBundledNpxPath();
  if (!npxPath) {
    throw new Error('Bundled npx runtime is missing');
  }

  await runBundledCommand({
    executablePath: npxPath,
    displayCommand: 'npx',
    args: ['-y', 'skills', command, source, '-y', '-g'],
    prefixDir: options.prefixDir,
    appendLog: options.appendLog,
    failureMessage: `npx skills ${command} exited`,
  });
}

async function runBundledCommand(options: {
  executablePath: string;
  displayCommand: string;
  args: string[];
  prefixDir: string;
  appendLog?: CliMarketplaceLogAppender;
  failureMessage: string;
}): Promise<void> {
  const env = {
    ...process.env,
    npm_config_prefix: options.prefixDir,
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
  };

  options.appendLog?.(`$ ${options.displayCommand} ${options.args.join(' ')}\n`);

  await new Promise<void>((resolve, reject) => {
    const forceShell = process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(options.executablePath);
    const { command, args: spawnArgs, shell } = prepareWinSpawn(options.executablePath, options.args, forceShell);
    const child = spawn(command, spawnArgs, {
      env,
      windowsHide: true,
      shell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk) => {
      options.appendLog?.(String(chunk));
    });
    child.stderr?.on('data', (chunk) => {
      options.appendLog?.(String(chunk));
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${options.failureMessage} with code ${code ?? 'unknown'}`));
    });
  });
}

function normalizeLogChunk(chunk: string): string {
  return chunk.replace(/\r\n?/g, '\n');
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
