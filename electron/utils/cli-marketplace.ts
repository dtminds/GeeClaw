import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sortCommandCandidatesForExecution } from './command-candidates';
import {
  ensureDir,
  getGeeClawConfigDir,
  getOpenClawConfigDir,
  getOpenClawSkillsDir,
  getResourcesDir,
} from './paths';
import { getBundledNpmPath, getBundledNpxPath, getBundledPathEntries } from './managed-bin';
import { prependPathEntries } from './env-path';
import { prepareWinSpawn } from './win-shell';
import { logger } from './logger';
import { ensureManagedNpmPrefixOnUserPath, type UserPathUpdateStatus } from './user-path';
import { getGeeClawCommandSearchDirs } from './runtime-path';

const execFileAsync = promisify(execFile);

export type CliMarketplaceInstallMethod =
  | {
      type: 'managed-npm';
      packageName: string;
      installArgs?: string[];
      postInstallSkills?: string[];
      postInstallActions?: CliMarketplacePostInstallAction[];
      postUninstallSkills?: string[];
      completion?: CliMarketplaceInstallCompletion;
    }
  | {
      type: 'manual';
      label: 'brew' | 'curl' | 'npm' | 'custom';
      command: string;
      requiresCommands?: string[];
      description?: string;
    };

export type CliMarketplaceCatalogItem = {
  id: string;
  title: string;
  binNames: string[];
  description?: string;
  homepage?: string;
  docsUrl?: string;
  platforms?: Array<'darwin' | 'win32' | 'linux'>;
  installMethods?: CliMarketplaceInstallMethod[];
  // Legacy managed install shape kept for backward compatibility.
  packageName?: string;
  installArgs?: string[];
  postInstallSkills?: string[];
  postUninstallSkills?: string[];
};

export type CliMarketplacePostInstallAction =
  | {
      type: 'install-skills';
      sources: string[];
    }
  | {
      type: 'run-installed-bin';
      bin: string;
      args?: string[];
    };

export type CliMarketplaceInstallCompletion = {
  kind: 'skills-only' | 'docs-required' | 'skills-and-docs';
  requiresSkillEnable?: boolean;
  docsUrl?: string;
  extraSteps?: string[];
};

export type CliMarketplaceInstallMethodStatus = {
  type: 'managed-npm' | 'manual';
  label: 'managed-npm' | 'brew' | 'curl' | 'npm' | 'custom';
  command?: string;
  available: boolean;
  unavailableReason?: 'missing-command' | 'runtime-missing';
  missingCommands?: string[];
  managed: boolean;
};

export type CliMarketplaceActionLabel = 'install' | 'reinstall';

export type CliMarketplaceStatusItem = {
  id: string;
  title: string;
  description: string;
  homepage?: string;
  docsUrl?: string;
  installed: boolean;
  actionLabel: CliMarketplaceActionLabel | null;
  source: 'system' | 'geeclaw' | 'none';
  installMethods: CliMarketplaceInstallMethodStatus[];
};

type CliMarketplaceSource = CliMarketplaceStatusItem['source'];
type CliMarketplaceJobOperation = 'install' | 'uninstall';
type CliMarketplaceJobStatus = 'running' | 'succeeded' | 'failed';
type CliMarketplaceSkillCommand = 'add' | 'remove';
type CliMarketplaceLogAppender = (chunk: string) => void;
type CliMarketplaceCatalogResolutionContext = {
  bundledNpmAvailable: boolean;
  commandPathCache: Map<string, Promise<string | null>>;
};

export type CliMarketplaceJobSnapshot = {
  id: string;
  itemId: string;
  title: string;
  operation: CliMarketplaceJobOperation;
  status: CliMarketplaceJobStatus;
  logs: string;
  startedAt: string;
  finishedAt: string | null;
  completion?: CliMarketplaceInstallCompletion;
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
  runInstalledBinCommand?: (
    bin: string,
    args: string[],
    options: { prefixDir: string; appendLog?: CliMarketplaceLogAppender },
  ) => Promise<void>;
  ensureManagedPrefixOnUserPath?: (prefixDir: string) => Promise<UserPathUpdateStatus>;
  managedPrefixDir?: string;
}

const DEFAULT_PLATFORM_SUPPORT: Array<'darwin' | 'win32' | 'linux'> = ['darwin', 'win32', 'linux'];
const DEFAULT_CATALOG_PATH = join(getResourcesDir(), 'cli-marketplace', 'catalog.json');
const MANUAL_METHOD_LABELS = ['brew', 'curl', 'npm', 'custom'] as const;

function describeEntry(entry: CliMarketplaceCatalogItem, index: number): string {
  return entry.id ? `"${entry.id}"` : `at index ${index}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isNonEmptyString(item));
}

function isCliMarketplaceCompletionKind(value: unknown): value is CliMarketplaceInstallCompletion['kind'] {
  return value === 'skills-only' || value === 'docs-required' || value === 'skills-and-docs';
}

function validateOptionalStringArray(entry: CliMarketplaceCatalogItem, fieldName: 'installArgs' | 'postInstallSkills' | 'postUninstallSkills', label: string): void {
  const value = entry[fieldName];
  if (value === undefined) {
    return;
  }
  if (!isNonEmptyStringArray(value)) {
    throw new Error(`[cli-marketplace] Entry ${label} has an invalid "${fieldName}" array`);
  }
}

function normalizeManagedPostInstallActions(
  method: Extract<CliMarketplaceInstallMethod, { type: 'managed-npm' }>,
): CliMarketplacePostInstallAction[] {
  const actions: CliMarketplacePostInstallAction[] = [];

  if (method.postInstallSkills && method.postInstallSkills.length > 0) {
    actions.push({
      type: 'install-skills',
      sources: [...method.postInstallSkills],
    });
  }

  if (Array.isArray(method.postInstallActions) && method.postInstallActions.length > 0) {
    actions.push(...method.postInstallActions);
  }

  return actions;
}

function resolveInstallCompletion(
  entry: CliMarketplaceCatalogItem,
  method: Extract<CliMarketplaceInstallMethod, { type: 'managed-npm' }>,
): CliMarketplaceInstallCompletion | undefined {
  if (!method.completion) {
    return undefined;
  }

  const shouldInheritDocsUrl = method.completion.kind === 'docs-required' || method.completion.kind === 'skills-and-docs';
  return {
    ...method.completion,
    docsUrl: method.completion.docsUrl ?? (shouldInheritDocsUrl ? entry.docsUrl : undefined),
  };
}

function normalizeLegacyManagedInstallMethod(entry: CliMarketplaceCatalogItem): Extract<CliMarketplaceInstallMethod, { type: 'managed-npm' }> | null {
  if (!isNonEmptyString(entry.packageName)) {
    return null;
  }

  return {
    type: 'managed-npm',
    packageName: entry.packageName,
    installArgs: entry.installArgs,
    postInstallSkills: entry.postInstallSkills,
    postUninstallSkills: entry.postUninstallSkills,
  };
}

function normalizeInstallMethods(entry: CliMarketplaceCatalogItem): CliMarketplaceInstallMethod[] {
  const installMethods = Array.isArray(entry.installMethods) ? [...entry.installMethods] : [];
  if (installMethods.some((method) => method.type === 'managed-npm')) {
    return installMethods;
  }

  const legacyManagedInstallMethod = normalizeLegacyManagedInstallMethod(entry);
  if (!legacyManagedInstallMethod) {
    return installMethods;
  }

  return [legacyManagedInstallMethod, ...installMethods];
}

function getManagedInstallMethod(entry: CliMarketplaceCatalogItem): Extract<CliMarketplaceInstallMethod, { type: 'managed-npm' }> | null {
  return normalizeInstallMethods(entry).find(
    (method): method is Extract<CliMarketplaceInstallMethod, { type: 'managed-npm' }> => method.type === 'managed-npm',
  ) ?? null;
}

function hasLegacyManagedFields(entry: CliMarketplaceCatalogItem): boolean {
  return entry.packageName !== undefined
    || entry.installArgs !== undefined
    || entry.postInstallSkills !== undefined
    || entry.postUninstallSkills !== undefined;
}

function requireManagedInstallMethod(entry: CliMarketplaceCatalogItem): Extract<CliMarketplaceInstallMethod, { type: 'managed-npm' }> {
  const managedMethod = getManagedInstallMethod(entry);
  if (!managedMethod) {
    throw new Error(`Catalog entry "${entry.id}" does not support managed install`);
  }
  return managedMethod;
}

function requireBundledNpmRuntime(): void {
  if (!getBundledNpmPath()) {
    throw new Error('Bundled npm runtime is missing');
  }
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
    if (entry.docsUrl !== undefined && typeof entry.docsUrl !== 'string') {
      throw new Error(`[cli-marketplace] Entry ${label} has an invalid "docsUrl" field`);
    }
    if (!Array.isArray(entry.binNames) || entry.binNames.length === 0) {
      throw new Error(`[cli-marketplace] Entry ${label} must include a non-empty "binNames" array`);
    }
    for (const bin of entry.binNames) {
      if (!isNonEmptyString(bin)) {
        throw new Error(`[cli-marketplace] Entry ${label} has an invalid bin name`);
      }
    }

    validateOptionalStringArray(entry, 'installArgs', label);
    validateOptionalStringArray(entry, 'postInstallSkills', label);
    validateOptionalStringArray(entry, 'postUninstallSkills', label);

    if (entry.installMethods !== undefined) {
      if (!Array.isArray(entry.installMethods) || entry.installMethods.length === 0) {
        throw new Error(`[cli-marketplace] Entry ${label} has an invalid "installMethods" array`);
      }

      for (const method of entry.installMethods) {
        if (!method || typeof method !== 'object') {
          throw new Error(`[cli-marketplace] Entry ${label} has an invalid install method`);
        }

        if (method.type === 'managed-npm') {
          if (!isNonEmptyString(method.packageName)) {
            throw new Error(`[cli-marketplace] Entry ${label} has an invalid managed npm install method`);
          }
          if (method.installArgs !== undefined && !isNonEmptyStringArray(method.installArgs)) {
            throw new Error(`[cli-marketplace] Entry ${label} has an invalid managed npm installArgs array`);
          }
          if (method.postInstallSkills !== undefined && !isNonEmptyStringArray(method.postInstallSkills)) {
            throw new Error(`[cli-marketplace] Entry ${label} has an invalid managed npm postInstallSkills array`);
          }
          if (method.postInstallActions !== undefined) {
            if (!Array.isArray(method.postInstallActions)) {
              throw new Error(`[cli-marketplace] Entry ${label} has an invalid managed npm postInstallActions array`);
            }
            for (const action of method.postInstallActions) {
              if (!action || typeof action !== 'object') {
                throw new Error(`[cli-marketplace] Entry ${label} has an invalid managed npm postInstallActions entry`);
              }
              if (action.type === 'install-skills') {
                if (!isNonEmptyStringArray(action.sources)) {
                  throw new Error(`[cli-marketplace] Entry ${label} has an invalid install-skills sources array`);
                }
                continue;
              }
              if (action.type === 'run-installed-bin') {
                if (!isNonEmptyString(action.bin)) {
                  throw new Error(`[cli-marketplace] Entry ${label} has an invalid run-installed-bin bin`);
                }
                if (action.args !== undefined && !isNonEmptyStringArray(action.args)) {
                  throw new Error(`[cli-marketplace] Entry ${label} has an invalid run-installed-bin args array`);
                }
                continue;
              }
              throw new Error(`[cli-marketplace] Entry ${label} has an unsupported postInstallActions type`);
            }
          }
          if (method.postUninstallSkills !== undefined && !isNonEmptyStringArray(method.postUninstallSkills)) {
            throw new Error(`[cli-marketplace] Entry ${label} has an invalid managed npm postUninstallSkills array`);
          }
          if (method.completion !== undefined) {
            if (!method.completion || typeof method.completion !== 'object') {
              throw new Error(`[cli-marketplace] Entry ${label} has an invalid managed npm completion object`);
            }
            if (!isCliMarketplaceCompletionKind(method.completion.kind)) {
              throw new Error(`[cli-marketplace] Entry ${label} has an invalid managed npm completion kind`);
            }
            if (method.completion.requiresSkillEnable !== undefined && typeof method.completion.requiresSkillEnable !== 'boolean') {
              throw new Error(`[cli-marketplace] Entry ${label} has an invalid managed npm completion requiresSkillEnable value`);
            }
            if (method.completion.docsUrl !== undefined && typeof method.completion.docsUrl !== 'string') {
              throw new Error(`[cli-marketplace] Entry ${label} has an invalid managed npm completion docsUrl`);
            }
            if (method.completion.extraSteps !== undefined && !isNonEmptyStringArray(method.completion.extraSteps)) {
              throw new Error(`[cli-marketplace] Entry ${label} has an invalid managed npm completion extraSteps`);
            }
          }
          continue;
        }

        if (method.type === 'manual') {
          if (!MANUAL_METHOD_LABELS.includes(method.label)) {
            throw new Error(`[cli-marketplace] Entry ${label} has an invalid manual install method label`);
          }
          if (!isNonEmptyString(method.command)) {
            throw new Error(`[cli-marketplace] Entry ${label} has an invalid manual install command`);
          }
          if (method.requiresCommands !== undefined && !isNonEmptyStringArray(method.requiresCommands)) {
            throw new Error(`[cli-marketplace] Entry ${label} has an invalid manual requiresCommands array`);
          }
          if (method.description !== undefined && typeof method.description !== 'string') {
            throw new Error(`[cli-marketplace] Entry ${label} has an invalid manual description`);
          }
          continue;
        }

        throw new Error(`[cli-marketplace] Entry ${label} has an unsupported install method type`);
      }
    }

    const normalizedInstallMethods = normalizeInstallMethods(entry);
    if (normalizedInstallMethods.length === 0) {
      throw new Error(`[cli-marketplace] Entry ${label} must include at least one install method`);
    }

    const hasExplicitManagedMethod = Array.isArray(entry.installMethods)
      && entry.installMethods.some((method) => method?.type === 'managed-npm');
    if (hasExplicitManagedMethod && hasLegacyManagedFields(entry)) {
      throw new Error(`[cli-marketplace] Entry ${label} must not mix legacy managed fields with explicit managed-npm install methods`);
    }

    const managedMethodCount = normalizedInstallMethods.filter((method) => method.type === 'managed-npm').length;
    if (managedMethodCount > 1) {
      throw new Error(`[cli-marketplace] Entry ${label} must not include multiple managed-npm install methods`);
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
  private readonly runInstalledBinCommand: (
    bin: string,
    args: string[],
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
    this.runInstalledBinCommand = options?.runInstalledBinCommand ?? defaultRunInstalledBinCommand;
    this.ensureManagedPrefixOnUserPath = options?.ensureManagedPrefixOnUserPath ?? ensureManagedNpmPrefixOnUserPath;
    this.managedPrefixDir = options?.managedPrefixDir ?? getDefaultManagedPrefixDir();
  }

  async getCatalog(): Promise<CliMarketplaceStatusItem[]> {
    const entries = await this.loadCatalogEntries();
    const resolutionContext = this.createCatalogResolutionContext();
    const statuses = await Promise.all(entries.map((entry) => this.resolveEntryStatus(entry, resolutionContext)));
    return statuses.filter((item): item is CliMarketplaceStatusItem => Boolean(item));
  }

  async install({ id }: { id: string }): Promise<CliMarketplaceStatusItem> {
    const entry = await this.getEntryById(id);
    const managedMethod = requireManagedInstallMethod(entry);
    requireBundledNpmRuntime();
    return this.installEntry(entry, managedMethod);
  }

  async uninstall({ id }: { id: string }): Promise<CliMarketplaceStatusItem> {
    const entry = await this.getEntryById(id);
    const managedMethod = requireManagedInstallMethod(entry);
    requireBundledNpmRuntime();
    return this.uninstallEntry(entry, managedMethod);
  }

  async startInstallJob({ id }: { id: string }): Promise<CliMarketplaceJobSnapshot> {
    const entry = await this.getEntryById(id);
    const managedMethod = requireManagedInstallMethod(entry);
    requireBundledNpmRuntime();
    const job = this.createJob(entry, 'install', resolveInstallCompletion(entry, managedMethod));
    void this.runJob(job, async () => {
      await this.installEntry(entry, managedMethod, this.appendJobLog(job));
    });
    return this.getJob(job.id);
  }

  async startUninstallJob({ id }: { id: string }): Promise<CliMarketplaceJobSnapshot> {
    const entry = await this.getEntryById(id);
    const managedMethod = requireManagedInstallMethod(entry);
    requireBundledNpmRuntime();
    const job = this.createJob(entry, 'uninstall');
    void this.runJob(job, async () => {
      await this.uninstallEntry(entry, managedMethod, this.appendJobLog(job));
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
    managedMethod: Extract<CliMarketplaceInstallMethod, { type: 'managed-npm' }>,
    appendLog?: CliMarketplaceLogAppender,
  ): Promise<CliMarketplaceStatusItem> {
    ensureDir(this.managedPrefixDir);
    if (process.platform !== 'win32') {
      ensureDir(join(this.managedPrefixDir, 'bin'));
    }

    await this.installWithBundledNpm(managedMethod.packageName, managedMethod.installArgs ?? [], {
      prefixDir: this.managedPrefixDir,
      appendLog,
    });

    for (const action of normalizeManagedPostInstallActions(managedMethod)) {
      if (action.type === 'install-skills') {
        for (const source of action.sources) {
          await this.runSkillCommandWithBundledNpx('add', source, {
            prefixDir: this.managedPrefixDir,
            appendLog,
          });
        }
        continue;
      }

      await this.runInstalledBinCommand(
        action.bin,
        action.args?.map((arg) => resolveCliMarketplaceTemplate(arg)) ?? [],
        {
          prefixDir: this.managedPrefixDir,
          appendLog,
        },
      );
    }

    try {
      const pathStatus = await this.ensureManagedPrefixOnUserPath(this.managedPrefixDir);
      logger.info(`[cli-marketplace] ensured managed npm PATH (${pathStatus}) for "${entry.id}"`);
    } catch (error) {
      logger.warn(`[cli-marketplace] Failed to update user PATH for managed npm prefix ${this.managedPrefixDir}:`, error);
      appendLog?.(`[warn] Failed to update user PATH automatically: ${formatUnknownError(error)}\n`);
    }

    const installedStatus = await this.resolveEntryStatus(entry, this.createCatalogResolutionContext());
    if (!installedStatus) {
      throw new Error(`Unable to resolve status for "${entry.id}" after install`);
    }

    return installedStatus;
  }

  private async uninstallEntry(
    entry: CliMarketplaceCatalogItem,
    managedMethod: Extract<CliMarketplaceInstallMethod, { type: 'managed-npm' }>,
    appendLog?: CliMarketplaceLogAppender,
  ): Promise<CliMarketplaceStatusItem> {
    for (const source of managedMethod.postUninstallSkills ?? []) {
      await this.runSkillCommandWithBundledNpx('remove', source, {
        prefixDir: this.managedPrefixDir,
        appendLog,
      });
    }

    await this.uninstallWithBundledNpm(managedMethod.packageName, {
      prefixDir: this.managedPrefixDir,
      appendLog,
    });

    const status = await this.resolveEntryStatus(entry, this.createCatalogResolutionContext());
    if (!status) {
      throw new Error(`Unable to resolve status for "${entry.id}" after uninstall`);
    }

    return status;
  }

  private createJob(
    entry: CliMarketplaceCatalogItem,
    operation: CliMarketplaceJobOperation,
    completion?: CliMarketplaceInstallCompletion,
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
      completion,
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

  private createCatalogResolutionContext(): CliMarketplaceCatalogResolutionContext {
    return {
      bundledNpmAvailable: Boolean(getBundledNpmPath()),
      commandPathCache: new Map(),
    };
  }

  private getCachedCommandPath(
    command: string,
    context: CliMarketplaceCatalogResolutionContext,
  ): Promise<string | null> {
    const cached = context.commandPathCache.get(command);
    if (cached) {
      return cached;
    }

    const lookupPromise = this.findCommand(command);
    context.commandPathCache.set(command, lookupPromise);
    return lookupPromise;
  }

  private isManagedCommandPath(commandPath: string, binName: string): boolean {
    return getPrefixCandidates(this.managedPrefixDir, binName).some((candidate) => (
      pathsReferToSameLocation(candidate, commandPath)
    ));
  }

  private async resolveEntryStatus(
    entry: CliMarketplaceCatalogItem,
    context: CliMarketplaceCatalogResolutionContext,
  ): Promise<CliMarketplaceStatusItem | null> {
    if (!this.supportsPlatform(entry)) {
      return null;
    }

    const { installed, source } = await this.detectEntrySource(entry, context);
    const installMethods = await this.resolveInstallMethodStatuses(entry, context);
    const managedMethod = getManagedInstallMethod(entry);
    return {
      id: entry.id,
      title: entry.title,
      description: entry.description ?? '',
      homepage: entry.homepage,
      docsUrl: entry.docsUrl,
      installed,
      actionLabel: managedMethod ? (installed ? 'reinstall' : 'install') : null,
      source,
      installMethods,
    };
  }

  private async resolveInstallMethodStatuses(
    entry: CliMarketplaceCatalogItem,
    context: CliMarketplaceCatalogResolutionContext,
  ): Promise<CliMarketplaceInstallMethodStatus[]> {
    const installMethods = normalizeInstallMethods(entry);
    return Promise.all(installMethods.map(async (method) => {
      if (method.type === 'managed-npm') {
        if (context.bundledNpmAvailable) {
          return {
            type: 'managed-npm',
            label: 'managed-npm',
            available: true,
            managed: true,
          } satisfies CliMarketplaceInstallMethodStatus;
        }
        return {
          type: 'managed-npm',
          label: 'managed-npm',
          available: false,
          unavailableReason: 'runtime-missing',
          managed: true,
        } satisfies CliMarketplaceInstallMethodStatus;
      }

      const requiredCommands = [...new Set(method.requiresCommands ?? [])];
      const commandResults = await Promise.all(requiredCommands.map(async (command) => {
        try {
          const commandPath = await this.getCachedCommandPath(command, context);
          return { command, found: Boolean(commandPath) };
        } catch {
          return { command, found: false };
        }
      }));
      const missingCommands = commandResults
        .filter((result) => !result.found)
        .map((result) => result.command);

      if (missingCommands.length > 0) {
        return {
          type: 'manual',
          label: method.label,
          command: method.command,
          available: false,
          unavailableReason: 'missing-command',
          missingCommands,
          managed: false,
        } satisfies CliMarketplaceInstallMethodStatus;
      }

      return {
        type: 'manual',
        label: method.label,
        command: method.command,
        available: true,
        managed: false,
      } satisfies CliMarketplaceInstallMethodStatus;
    }));
  }

  private async detectEntrySource(
    entry: CliMarketplaceCatalogItem,
    context: CliMarketplaceCatalogResolutionContext,
  ): Promise<{ installed: boolean; source: CliMarketplaceSource }> {
    for (const binName of entry.binNames) {
      if (!binName) continue;
      try {
        const commandPath = await this.getCachedCommandPath(binName, context);
        if (commandPath) {
          if (this.isManagedCommandPath(commandPath, binName)) {
            return { installed: true, source: 'geeclaw' };
          }
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

function resolveCliMarketplaceTemplate(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, variableName: string) => {
    if (variableName === 'openclawSkillsDir') {
      return getOpenClawSkillsDir();
    }
    if (variableName === 'openclawConfigDir') {
      return getOpenClawConfigDir();
    }
    if (variableName === 'geeclawConfigDir') {
      return getGeeClawConfigDir();
    }
    throw new Error(`Unsupported cli marketplace template variable "${variableName}"`);
  });
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

  return filterExistingUniqueCandidates(sortCommandCandidatesForExecution(candidates));
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

function normalizePathForComparison(candidate: string): string {
  let normalized = candidate;
  try {
    normalized = realpathSync(candidate);
  } catch {
    // keep raw path when the candidate is not yet materialized
  }

  const normalizedWithoutTrailingSeparator = normalized.replace(/[\\/]+$/, '');
  return process.platform === 'win32'
    ? normalizedWithoutTrailingSeparator.toLowerCase()
    : normalizedWithoutTrailingSeparator;
}

function pathsReferToSameLocation(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
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

async function defaultRunInstalledBinCommand(
  bin: string,
  args: string[],
  options: { prefixDir: string; appendLog?: CliMarketplaceLogAppender },
): Promise<void> {
  const executablePath = getPrefixCandidates(options.prefixDir, bin).find((candidate) => existsSync(candidate));
  if (!executablePath) {
    throw new Error(`Installed CLI "${bin}" was not found in managed prefix`);
  }

  await runBundledCommand({
    executablePath,
    displayCommand: bin,
    args,
    prefixDir: options.prefixDir,
    appendLog: options.appendLog,
    failureMessage: `${bin} exited`,
  });
}

function getManagedPrefixPathEntries(prefixDir: string): string[] {
  if (process.platform === 'win32') {
    return [prefixDir, join(prefixDir, 'bin')];
  }
  return [join(prefixDir, 'bin'), prefixDir];
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
  const bundledPath = prependPathEntries(env, [
    ...getManagedPrefixPathEntries(options.prefixDir),
    ...getBundledPathEntries(),
  ]);
  const commandEnv = bundledPath.env;

  options.appendLog?.(`$ ${options.displayCommand} ${options.args.join(' ')}\n`);

  await new Promise<void>((resolve, reject) => {
    const forceShell = process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(options.executablePath);
    const { command, args: spawnArgs, shell } = prepareWinSpawn(options.executablePath, options.args, forceShell);
    const child = spawn(command, spawnArgs, {
      env: commandEnv,
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
