import { execFile } from 'node:child_process';
import { app } from 'electron';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import {
  getOpenClawDir,
  getOpenClawEntryPath,
  getOpenClawResolvedDir,
  isOpenClawBuilt,
  isOpenClawPresent,
} from './paths';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

export type OpenClawRuntimeSource = 'bundled' | 'system';

export interface ResolvedOpenClawRuntime {
  source: OpenClawRuntimeSource;
  packageExists: boolean;
  isBuilt: boolean;
  dir: string;
  entryPath: string | null;
  commandPath: string | null;
  version?: string;
  error?: string;
  displayName: string;
}

function readBundledVersion(dir: string): string | undefined {
  try {
    const pkgPath = `${dir}/package.json`;
    if (!existsSync(pkgPath)) return undefined;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

function normalizeVersionOutput(output: string): string | undefined {
  const line = output.trim().split(/\r?\n/, 1)[0]?.trim();
  if (!line) return undefined;
  const match = line.match(/(\d+\.\d+\.\d+(?:[-+._][A-Za-z0-9.-]+)?)/);
  return match?.[1] ?? line;
}

function normalizeExistingPath(pathValue: string): string {
  try {
    return realpathSync(pathValue);
  } catch {
    return resolve(pathValue);
  }
}

function getRejectedSystemRuntimeRoots(): string[] {
  const roots = new Set<string>();

  roots.add(normalizeExistingPath(process.cwd()));
  roots.add(normalizeExistingPath(app.getAppPath()));

  const bundledDir = getOpenClawDir();
  if (existsSync(bundledDir)) {
    roots.add(normalizeExistingPath(bundledDir));
  }

  const packagedCliDir = join(process.resourcesPath, 'cli');
  if (existsSync(packagedCliDir)) {
    roots.add(normalizeExistingPath(packagedCliDir));
  }

  return [...roots];
}

function isRejectedSystemRuntimeCandidate(candidate: string): boolean {
  const normalizedCandidate = normalizeExistingPath(candidate);
  const rejectedRoots = getRejectedSystemRuntimeRoots();
  return rejectedRoots.some((root) => (
    normalizedCandidate === root ||
    normalizedCandidate.startsWith(`${root}/`) ||
    normalizedCandidate.startsWith(`${root}\\`)
  ));
}

async function resolveSystemOpenClawCommandPath(): Promise<string | null> {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const locatorArgs = process.platform === 'win32' ? ['openclaw'] : ['-a', 'openclaw'];
  try {
    const { stdout } = await execFileAsync(locator, locatorArgs, {
      timeout: 5000,
      windowsHide: true,
    });
    const candidates = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return candidates.find((candidate) => (
      existsSync(candidate) && !isRejectedSystemRuntimeCandidate(candidate)
    )) ?? null;
  } catch {
    return null;
  }
}

async function getSystemOpenClawVersion(commandPath: string): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync(commandPath, ['--version'], {
      timeout: 5000,
      windowsHide: true,
      cwd: homedir(),
    });
    return normalizeVersionOutput(stdout || stderr);
  } catch (error) {
    logger.debug('Failed to read system OpenClaw version:', error);
    return undefined;
  }
}

function getBundledOpenClawRuntime(): ResolvedOpenClawRuntime {
  const dir = getOpenClawDir();
  return {
    source: 'bundled',
    packageExists: isOpenClawPresent(),
    isBuilt: isOpenClawBuilt(),
    dir,
    entryPath: getOpenClawEntryPath(),
    commandPath: null,
    version: readBundledVersion(dir),
    displayName: 'Bundled OpenClaw',
  };
}

export async function detectSystemOpenClawRuntime(): Promise<ResolvedOpenClawRuntime> {
  const commandPath = await resolveSystemOpenClawCommandPath();
  if (!commandPath) {
    return {
      source: 'system',
      packageExists: false,
      isBuilt: false,
      dir: '',
      entryPath: null,
      commandPath: null,
      error: 'System openclaw command not found on PATH (excluding GeeClaw bundled/project-local binaries)',
      displayName: 'System OpenClaw',
    };
  }

  return {
    source: 'system',
    packageExists: true,
    isBuilt: true,
    dir: dirname(commandPath),
    entryPath: null,
    commandPath,
    version: await getSystemOpenClawVersion(commandPath),
    displayName: 'System OpenClaw',
  };
}

export async function getConfiguredOpenClawRuntimeSource(): Promise<OpenClawRuntimeSource> {
  return 'bundled';
}

export async function getConfiguredOpenClawRuntime(): Promise<ResolvedOpenClawRuntime> {
  return getBundledOpenClawRuntime();
}

export function getBundledOpenClawResolvedDir(): string {
  return getOpenClawResolvedDir();
}
