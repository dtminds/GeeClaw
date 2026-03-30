import { execFile, spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { logger } from './logger';
import { prepareWinSpawn } from './paths';
import { getGeeClawCommandSearchDirs } from './runtime-path';

const execFileAsync = promisify(execFile);

const OPENCLI_RELEASES_URL = 'https://github.com/jackwener/opencli/releases';
const OPENCLI_README_URL = 'https://github.com/jackwener/opencli/blob/main/README.zh-CN.md';
const DEFAULT_DOCTOR_TIMEOUT_MS = 20_000;
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
  version: string | null;
  command: string | null;
  releasesUrl: string;
  readmeUrl: string;
  doctor: OpenCliDoctorStatus | null;
}

let openCliDoctorInFlight: Promise<OpenCliDoctorStatus> | null = null;

function stripAnsi(value: string): string {
  return value.replace(new RegExp(`${ANSI_ESCAPE_PREFIX}\\[[0-9;]*[A-Za-z]`, 'g'), '');
}

function normalizeOpenCliOutput(stdout: string, stderr: string): string {
  return stripAnsi([stdout, stderr].filter(Boolean).join('\n'))
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeVersionOutput(output: string): string | null {
  const line = output.trim().split(/\r?\n/, 1)[0]?.trim();
  if (!line) {
    return null;
  }

  const match = line.match(/(\d+\.\d+\.\d+(?:[-+._][A-Za-z0-9.-]+)?)/);
  return match?.[1] ?? line;
}

function normalizeExistingPath(pathValue: string): string {
  try {
    return realpathSync(pathValue);
  } catch {
    return pathValue;
  }
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
      // Ignore missing where.exe results and fall through to manual candidates.
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
      // Ignore missing which results and fall through to manual candidates.
    }

    for (const dir of getGeeClawCommandSearchDirs()) {
      candidates.push(join(dir, command));
      candidates.push(join(dir, `${command}.sh`));
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate || !existsSync(candidate)) {
      return false;
    }

    const normalized = normalizeExistingPath(candidate);
    if (seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

async function resolveSystemOpenCliCommandPath(): Promise<string | null> {
  const candidates = await listCommandCandidates('opencli');
  return candidates[0] ?? null;
}

async function runCapturedCommand(command: string, args: string[], timeoutMs = 5000): Promise<{ stdout: string; stderr: string }> {
  const forceShell = process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(command);
  const prepared = prepareWinSpawn(command, args, forceShell);

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(prepared.command, prepared.args, {
      cwd: homedir(),
      env: process.env,
      windowsHide: true,
      shell: prepared.shell,
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
      rejectPromise(new Error(`Command timed out after ${timeoutMs}ms`));
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
      rejectPromise(error);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      rejectPromise(new Error(stderr.trim() || stdout.trim() || `Command exited with code ${code}`));
    });
  });
}

async function runOpenCliCommand(
  command: string,
  args: string[],
  timeoutMs = DEFAULT_DOCTOR_TIMEOUT_MS,
): Promise<{ output: string; exitCode: number | null; error?: string; durationMs: number }> {
  const forceShell = process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(command);
  const prepared = prepareWinSpawn(command, args, forceShell);
  const startedAt = Date.now();

  return await new Promise((resolve) => {
    const child = spawn(prepared.command, prepared.args, {
      cwd: homedir(),
      env: process.env,
      windowsHide: true,
      shell: prepared.shell,
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

async function getSystemOpenCliVersion(commandPath: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await runCapturedCommand(commandPath, ['--version']);
    return normalizeVersionOutput(stdout || stderr);
  } catch (error) {
    logger.debug('Failed to read system opencli version:', error);
    return null;
  }
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

async function runOpenCliDoctor(commandPath: string): Promise<OpenCliDoctorStatus> {
  const result = await runOpenCliCommand(commandPath, ['doctor', '--no-live']);
  const parsed = parseOpenCliDoctorOutput(result.output);

  return {
    ...parsed,
    ok: result.exitCode === 0 && parsed.ok,
    output: result.output,
    error: result.error ?? (result.exitCode && result.exitCode !== 0 ? `OpenCLI doctor exited with code ${result.exitCode}` : undefined),
    durationMs: result.durationMs,
  };
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

async function runSharedOpenCliDoctor(commandPath: string): Promise<OpenCliDoctorStatus> {
  if (openCliDoctorInFlight) {
    return await openCliDoctorInFlight;
  }

  openCliDoctorInFlight = (async () => {
    const doctor = await runOpenCliDoctor(commandPath);
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
  const systemPath = await resolveSystemOpenCliCommandPath();
  if (!systemPath) {
    return null;
  }

  return await runSharedOpenCliDoctor(systemPath);
}

export async function getOpenCliStatus(): Promise<OpenCliStatus> {
  const systemPath = await resolveSystemOpenCliCommandPath();
  const version = systemPath ? await getSystemOpenCliVersion(systemPath) : null;

  if (!systemPath) {
    return {
      binaryExists: false,
      binaryPath: null,
      version: null,
      command: null,
      releasesUrl: OPENCLI_RELEASES_URL,
      readmeUrl: OPENCLI_README_URL,
      doctor: null,
    };
  }

  const doctor = await runSharedOpenCliDoctor(systemPath);

  return {
    binaryExists: true,
    binaryPath: systemPath,
    version,
    command: systemPath,
    releasesUrl: OPENCLI_RELEASES_URL,
    readmeUrl: OPENCLI_README_URL,
    doctor,
  };
}
