import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { logger } from './logger';
import { prependPathEntries } from './env-path';
import { getBundledNodePath, getBundledPathEntries, getManagedCommandWrapperPath } from './managed-bin';

const OPENCLI_RELEASES_URL = 'https://github.com/jackwener/opencli/releases';
const OPENCLI_README_URL = 'https://github.com/jackwener/opencli/blob/main/README.zh-CN.md';
const DEFAULT_DOCTOR_TIMEOUT_MS = 20_000;
const DEFAULT_LIST_TIMEOUT_MS = 30_000;
const ANSI_ESCAPE_PREFIX = String.fromCharCode(27);

export interface OpenCliDoctorStatus {
  ok: boolean;
  daemonRunning: boolean | null;
  extensionConnected: boolean | null;
  connectivityOk: boolean | null;
  issues: string[];
  output: string;
  error?: string;
  durationMs: number;
}

export interface OpenCliStatus {
  binaryExists: boolean;
  binaryPath: string | null;
  wrapperPath: string | null;
  entryPath: string | null;
  runtimeDir: string | null;
  extensionDir: string | null;
  extensionDirExists: boolean;
  version: string | null;
  command: string | null;
  releasesUrl: string;
  readmeUrl: string;
  doctor: OpenCliDoctorStatus | null;
}

export interface OpenCliCatalogArg {
  name: string;
  type: string;
  required: boolean;
  positional: boolean;
  choices: string[];
  default: unknown;
  help: string;
}

export interface OpenCliCatalogCommand {
  command: string;
  site: string;
  name: string;
  description: string;
  strategy: string;
  browser: boolean;
  args: OpenCliCatalogArg[];
  columns: string[];
  domain: string | null;
}

export interface OpenCliCatalogSite {
  site: string;
  domains: string[];
  strategies: string[];
  commands: OpenCliCatalogCommand[];
}

export interface OpenCliCatalog {
  totalSites: number;
  totalCommands: number;
  sites: OpenCliCatalogSite[];
}

interface OpenCliExecutionSpec {
  command: string;
  argsPrefix: string[];
  env: NodeJS.ProcessEnv;
  displayCommand: string;
}

let openCliDoctorInFlight: Promise<OpenCliDoctorStatus> | null = null;
let openCliCatalogInFlight: Promise<OpenCliCatalog> | null = null;
let openCliCatalogCache: OpenCliCatalog | null = null;

function escapeForDoubleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function quoteForPosix(value: string): string {
  return `"${escapeForDoubleQuotes(value)}"`;
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function stripAnsi(value: string): string {
  return value.replace(new RegExp(`${ANSI_ESCAPE_PREFIX}\\[[0-9;]*[A-Za-z]`, 'g'), '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function compareSiteNames(left: string, right: string): number {
  const leftShared = left.startsWith('_');
  const rightShared = right.startsWith('_');
  if (leftShared !== rightShared) {
    return leftShared ? 1 : -1;
  }
  return left.localeCompare(right);
}

function getOpenCliRuntimeDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'opencli');
  }
  return join(process.cwd(), 'build', 'opencli');
}

function getOpenCliEntryPath(): string {
  return join(getOpenCliRuntimeDir(), 'dist', 'main.js');
}

function getOpenCliExtensionDir(): string {
  return join(getOpenCliRuntimeDir(), 'extension');
}

function getOpenCliWrapperPath(): string | null {
  if (!app.isPackaged) {
    return null;
  }
  return getManagedCommandWrapperPath('opencli');
}

function readOpenCliVersion(runtimeDir: string): string | null {
  try {
    const raw = readFileSync(join(runtimeDir, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.trim()
      ? parsed.version.trim()
      : null;
  } catch {
    return null;
  }
}

function resolveExecutionSpec(): OpenCliExecutionSpec | null {
  const entryPath = getOpenCliEntryPath();
  if (!existsSync(entryPath)) {
    return null;
  }

  let env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCLI_EMBEDDED_IN: 'GeeClaw',
  };

  if (app.isPackaged) {
    env = prependPathEntries(env, getBundledPathEntries()).env as NodeJS.ProcessEnv;
  }

  const bundledNode = getBundledNodePath();
  if (bundledNode) {
    if (process.platform === 'win32') {
      return {
        command: bundledNode,
        argsPrefix: [entryPath],
        env,
        displayCommand: `& ${quoteForPowerShell(bundledNode)} ${quoteForPowerShell(entryPath)}`,
      };
    }

    return {
      command: bundledNode,
      argsPrefix: [entryPath],
      env,
      displayCommand: `${quoteForPosix(bundledNode)} ${quoteForPosix(entryPath)}`,
    };
  }

  if (app.isPackaged && process.platform !== 'win32') {
    return null;
  }

  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }

  if (process.platform === 'win32') {
    return {
      command: process.execPath,
      argsPrefix: [entryPath],
      env,
      displayCommand: `& ${quoteForPowerShell(process.execPath)} ${quoteForPowerShell(entryPath)}`,
    };
  }

  const envPrefix = process.versions.electron ? 'ELECTRON_RUN_AS_NODE=1 ' : '';
  return {
    command: process.execPath,
    argsPrefix: [entryPath],
    env,
    displayCommand: `${envPrefix}${quoteForPosix(process.execPath)} ${quoteForPosix(entryPath)}`,
  };
}

async function runOpenCliCommand(
  args: string[],
  timeoutMs = DEFAULT_DOCTOR_TIMEOUT_MS,
): Promise<{ output: string; exitCode: number | null; error?: string; durationMs: number }> {
  const spec = resolveExecutionSpec();
  if (!spec) {
    return {
      output: '',
      exitCode: null,
      error: existsSync(getOpenCliEntryPath())
        ? 'Bundled Node.js runtime not found for OpenCLI'
        : 'OpenCLI runtime entry not found',
      durationMs: 0,
    };
  }

  const startedAt = Date.now();

  return await new Promise((resolve) => {
    const child = spawn(spec.command, [...spec.argsPrefix, ...args], {
      env: spec.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGTERM');
      resolve({
        output: normalizeOpenCliOutput(stdout, stderr),
        exitCode: null,
        error: `OpenCLI command timed out after ${timeoutMs}ms`,
        durationMs: Date.now() - startedAt,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        output: normalizeOpenCliOutput(stdout, `${stderr}${error instanceof Error ? error.message : String(error)}`),
        exitCode: null,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        output: normalizeOpenCliOutput(stdout, stderr),
        exitCode: code,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function normalizeOpenCliOutput(stdout: string, stderr: string): string {
  return stripAnsi([stdout, stderr].filter(Boolean).join('\n'))
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseOpenCliCatalogArg(value: unknown): OpenCliCatalogArg | null {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return null;
  }

  return {
    name: value.name,
    type: typeof value.type === 'string' ? value.type : 'unknown',
    required: Boolean(value.required),
    positional: Boolean(value.positional),
    choices: toStringArray(value.choices),
    default: value.default,
    help: typeof value.help === 'string' ? value.help : '',
  };
}

function parseOpenCliCatalogCommand(value: unknown): OpenCliCatalogCommand | null {
  if (
    !isRecord(value)
    || typeof value.command !== 'string'
    || typeof value.site !== 'string'
    || typeof value.name !== 'string'
  ) {
    return null;
  }

  return {
    command: value.command,
    site: value.site,
    name: value.name,
    description: typeof value.description === 'string' ? value.description : '',
    strategy: typeof value.strategy === 'string' ? value.strategy : 'unknown',
    browser: Boolean(value.browser),
    args: Array.isArray(value.args)
      ? value.args
        .map((arg) => parseOpenCliCatalogArg(arg))
        .filter((arg): arg is OpenCliCatalogArg => arg !== null)
      : [],
    columns: toStringArray(value.columns),
    domain: typeof value.domain === 'string' && value.domain.trim() ? value.domain : null,
  };
}

function groupOpenCliCatalog(commands: OpenCliCatalogCommand[]): OpenCliCatalog {
  const bySite = new Map<string, OpenCliCatalogSite>();

  for (const command of commands) {
    const existing = bySite.get(command.site);
    if (existing) {
      existing.commands.push(command);
      if (command.domain && !existing.domains.includes(command.domain)) {
        existing.domains.push(command.domain);
      }
      if (!existing.strategies.includes(command.strategy)) {
        existing.strategies.push(command.strategy);
      }
      continue;
    }

    bySite.set(command.site, {
      site: command.site,
      domains: command.domain ? [command.domain] : [],
      strategies: [command.strategy],
      commands: [command],
    });
  }

  const sites = [...bySite.values()]
    .map((site) => ({
      ...site,
      domains: [...site.domains].sort((left, right) => left.localeCompare(right)),
      strategies: [...site.strategies].sort((left, right) => left.localeCompare(right)),
      commands: [...site.commands].sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => compareSiteNames(left.site, right.site));

  return {
    totalSites: sites.length,
    totalCommands: commands.length,
    sites,
  };
}

function parseDoctorIssues(lines: string[]): string[] {
  const issuesIndex = lines.findIndex((line) => line.trim() === 'Issues:');
  if (issuesIndex === -1) {
    return [];
  }

  const issues: string[] = [];
  let current = '';

  for (const rawLine of lines.slice(issuesIndex + 1)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('• ')) {
      if (current) {
        issues.push(current.trim());
      }
      current = trimmed.slice(2).trim();
      continue;
    }

    if (trimmed.startsWith('[') || trimmed === 'Sessions:') {
      break;
    }

    current = current ? `${current}\n${trimmed}` : trimmed;
  }

  if (current) {
    issues.push(current.trim());
  }

  return issues;
}

export function parseOpenCliDoctorOutput(output: string): Omit<OpenCliDoctorStatus, 'durationMs' | 'output' | 'error'> {
  const normalized = normalizeOpenCliOutput(output, '');
  const lines = normalized.split('\n');

  const daemonLine = lines.find((line) => /\]\s+Daemon:/i.test(line));
  const extensionLine = lines.find((line) => /\]\s+Extension:/i.test(line));
  const connectivityLine = lines.find((line) => /\]\s+Connectivity:/i.test(line));

  const daemonRunning = daemonLine
    ? !/not running/i.test(daemonLine)
    : null;
  const extensionConnected = extensionLine
    ? /\bconnected\b/i.test(extensionLine) && !/\bnot connected\b/i.test(extensionLine)
    : null;
  let connectivityOk: boolean | null = null;
  if (connectivityLine) {
    if (/\[OK\]/i.test(connectivityLine)) {
      connectivityOk = true;
    } else if (/\[FAIL\]/i.test(connectivityLine)) {
      connectivityOk = false;
    }
  }

  const issues = parseDoctorIssues(lines);
  const ok = daemonRunning === true
    && extensionConnected === true
    && connectivityOk !== false
    && issues.length === 0;

  return {
    ok,
    daemonRunning,
    extensionConnected,
    connectivityOk,
    issues,
  };
}

async function runOpenCliDoctor(): Promise<OpenCliDoctorStatus> {
  const result = await runOpenCliCommand(['doctor', '--no-live']);
  const parsed = parseOpenCliDoctorOutput(result.output);

  return {
    ...parsed,
    ok: result.exitCode === 0 && parsed.ok,
    output: result.output,
    error: result.error ?? (result.exitCode && result.exitCode !== 0 ? `OpenCLI doctor exited with code ${result.exitCode}` : undefined),
    durationMs: result.durationMs,
  };
}

async function runOpenCliCatalog(): Promise<OpenCliCatalog> {
  const result = await runOpenCliCommand(['list', '--json'], DEFAULT_LIST_TIMEOUT_MS);
  if (result.error) {
    throw new Error(result.error);
  }
  if (result.exitCode !== 0) {
    throw new Error(`OpenCLI list exited with code ${result.exitCode}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse OpenCLI list output: ${message}`);
  }

  const commands = Array.isArray(parsed)
    ? parsed
      .map((item) => parseOpenCliCatalogCommand(item))
      .filter((item): item is OpenCliCatalogCommand => item !== null)
    : [];

  return groupOpenCliCatalog(commands);
}

function logDoctorIssues(doctor: OpenCliDoctorStatus): void {
  if (doctor.ok) {
    return;
  }

  logger.info('OpenCLI doctor reported issues', {
    daemonRunning: doctor.daemonRunning,
    extensionConnected: doctor.extensionConnected,
    connectivityOk: doctor.connectivityOk,
    error: doctor.error,
  });
}

async function runSharedOpenCliDoctor(): Promise<OpenCliDoctorStatus> {
  if (openCliDoctorInFlight) {
    return await openCliDoctorInFlight;
  }

  openCliDoctorInFlight = (async () => {
    const doctor = await runOpenCliDoctor();
    logDoctorIssues(doctor);
    return doctor;
  })();

  try {
    return await openCliDoctorInFlight;
  } finally {
    openCliDoctorInFlight = null;
  }
}

export async function warmupOpenCliDoctor(): Promise<OpenCliDoctorStatus | null> {
  if (!existsSync(getOpenCliEntryPath())) {
    return null;
  }

  return await runSharedOpenCliDoctor();
}

export async function getOpenCliCatalog(): Promise<OpenCliCatalog> {
  if (!existsSync(getOpenCliEntryPath())) {
    return {
      totalSites: 0,
      totalCommands: 0,
      sites: [],
    };
  }

  if (openCliCatalogCache) {
    return openCliCatalogCache;
  }

  if (openCliCatalogInFlight) {
    return await openCliCatalogInFlight;
  }

  openCliCatalogInFlight = (async () => {
    const catalog = await runOpenCliCatalog();
    openCliCatalogCache = catalog;
    return catalog;
  })();

  try {
    return await openCliCatalogInFlight;
  } finally {
    openCliCatalogInFlight = null;
  }
}

export async function getOpenCliStatus(): Promise<OpenCliStatus> {
  const runtimeDir = getOpenCliRuntimeDir();
  const entryPath = getOpenCliEntryPath();
  const extensionDir = getOpenCliExtensionDir();
  const wrapperPath = getOpenCliWrapperPath();
  const executionSpec = resolveExecutionSpec();
  const binaryExists = existsSync(entryPath);
  const version = binaryExists ? readOpenCliVersion(runtimeDir) : null;

  if (!binaryExists) {
    return {
      binaryExists: false,
      binaryPath: null,
      wrapperPath,
      entryPath: existsSync(entryPath) ? entryPath : null,
      runtimeDir,
      extensionDir,
      extensionDirExists: existsSync(extensionDir),
      version,
      command: executionSpec?.displayCommand ?? null,
      releasesUrl: OPENCLI_RELEASES_URL,
      readmeUrl: OPENCLI_README_URL,
      doctor: null,
    };
  }

  const doctor = await runSharedOpenCliDoctor();

  return {
    binaryExists: true,
    binaryPath: wrapperPath ?? entryPath,
    wrapperPath,
    entryPath,
    runtimeDir,
    extensionDir,
    extensionDirExists: existsSync(extensionDir),
    version,
    command: executionSpec?.displayCommand ?? null,
    releasesUrl: OPENCLI_RELEASES_URL,
    readmeUrl: OPENCLI_README_URL,
    doctor,
  };
}
