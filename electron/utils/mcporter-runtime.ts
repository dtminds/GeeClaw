import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from './logger';
import { prepareWinSpawn } from './paths';
import { getGeeClawCommandSearchDirs } from './runtime-path';

const execFileAsync = promisify(execFile);

const MCPORTER_INSTALL_GUIDE_URL = 'https://github.com/steipete/mcporter#installation';
const MCPORTER_REPOSITORY_URL = 'https://github.com/steipete/mcporter';

export interface McporterBinaryStatus {
  exists: boolean;
  path: string | null;
  version: string | null;
  error?: string;
}

export interface McporterStatus {
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  installGuideUrl: string;
  repositoryUrl: string;
  system: McporterBinaryStatus;
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
      candidates.push(join(dir, `${command}.exe`));
      candidates.push(join(dir, `${command}.bat`));
      candidates.push(join(dir, command));
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

async function resolveSystemMcporterCommandPath(): Promise<string | null> {
  const candidates = await listCommandCandidates('mcporter');
  return candidates[0] ?? null;
}

async function runCapturedCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
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
      rejectPromise(new Error('Command timed out after 5000ms'));
    }, 5000);

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

async function getSystemMcporterVersion(commandPath: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await runCapturedCommand(commandPath, ['--version']);
    return normalizeVersionOutput(stdout || stderr);
  } catch (error) {
    logger.debug('Failed to read system mcporter version:', error);
    return null;
  }
}

export async function getMcporterStatus(): Promise<McporterStatus> {
  const systemPath = await resolveSystemMcporterCommandPath();
  const systemVersion = systemPath ? await getSystemMcporterVersion(systemPath) : null;

  return {
    installed: !!systemPath,
    binaryPath: systemPath,
    version: systemVersion,
    installGuideUrl: MCPORTER_INSTALL_GUIDE_URL,
    repositoryUrl: MCPORTER_REPOSITORY_URL,
    system: {
      exists: !!systemPath,
      path: systemPath,
      version: systemVersion,
      error: systemPath
        ? undefined
        : 'System mcporter command not found on PATH',
    },
  };
}
