import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getManagedBinDir } from './managed-bin';

export type UserPathUpdateStatus = 'updated' | 'already-present';

type PosixProfileSyntax = 'fish' | 'posix';

type PosixProfileTarget = {
  path: string;
  syntax: PosixProfileSyntax;
};

type SpawnImpl = (
  command: string,
  args?: readonly string[],
  options?: Parameters<typeof spawn>[2],
) => ChildProcess;

export interface EnsureManagedNpmPrefixOnUserPathOptions {
  homeDir?: string;
  shell?: string;
  currentPath?: string;
  managedBinDir?: string;
  spawnImpl?: SpawnImpl;
  env?: NodeJS.ProcessEnv;
}

const MARKER_START = '# >>> GeeClaw managed npm PATH >>>';
const MARKER_END = '# <<< GeeClaw managed npm PATH <<<';

function getPathDelimiter(): string {
  return process.platform === 'win32' ? ';' : ':';
}

function normalizePathEntry(entry: string): string {
  const trimmed = entry.trim();
  return process.platform === 'win32'
    ? trimmed.toLowerCase()
    : trimmed;
}

function pathContainsEntry(pathValue: string, entry: string): boolean {
  const normalizedEntry = normalizePathEntry(entry);
  return pathValue
    .split(getPathDelimiter())
    .map(normalizePathEntry)
    .filter(Boolean)
    .includes(normalizedEntry);
}

function escapeForDoubleQuotes(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}

export function getManagedNpmBinDir(prefixDir: string): string {
  return process.platform === 'win32' ? prefixDir : join(prefixDir, 'bin');
}

export function getPosixPathTargets(shell: string, homeDir: string): PosixProfileTarget[] {
  if (shell.includes('fish')) {
    return [{ path: join(homeDir, '.config', 'fish', 'config.fish'), syntax: 'fish' }];
  }

  if (shell.includes('bash')) {
    return [
      { path: join(homeDir, '.bash_profile'), syntax: 'posix' },
      { path: join(homeDir, '.bashrc'), syntax: 'posix' },
    ];
  }

  if (shell.includes('zsh')) {
    return [
      { path: join(homeDir, '.zprofile'), syntax: 'posix' },
      { path: join(homeDir, '.zshrc'), syntax: 'posix' },
    ];
  }

  return [{ path: join(homeDir, '.profile'), syntax: 'posix' }];
}

export function buildPosixPathSnippet(entry: string): string {
  const escapedEntry = escapeForDoubleQuotes(entry);
  return `\n${MARKER_START}\nGEECLAW_MANAGED_NPM_BIN="${escapedEntry}"\nif [ -d "$GEECLAW_MANAGED_NPM_BIN" ]; then\n  case ":$PATH:" in\n    *":$GEECLAW_MANAGED_NPM_BIN:"*) ;;\n    *) export PATH="$GEECLAW_MANAGED_NPM_BIN:$PATH" ;;\n  esac\nfi\n${MARKER_END}\n`;
}

export function buildFishPathSnippet(entry: string): string {
  const escapedEntry = escapeForDoubleQuotes(entry);
  return `\n${MARKER_START}\nset -l GEECLAW_MANAGED_NPM_BIN "${escapedEntry}"\nif test -d "$GEECLAW_MANAGED_NPM_BIN"\n    if not contains "$GEECLAW_MANAGED_NPM_BIN" $PATH\n        fish_add_path -p "$GEECLAW_MANAGED_NPM_BIN"\n    end\nend\n${MARKER_END}\n`;
}

async function ensurePosixPathEntry(
  entry: string,
  options: EnsureManagedNpmPrefixOnUserPathOptions,
): Promise<UserPathUpdateStatus> {
  const currentPath = options.currentPath ?? process.env.PATH ?? '';
  if (pathContainsEntry(currentPath, entry)) {
    return 'already-present';
  }

  const homeDir = options.homeDir ?? homedir();
  const shell = options.shell ?? process.env.SHELL ?? '/bin/zsh';
  const targets = getPosixPathTargets(shell, homeDir);

  for (const target of targets) {
    try {
      const existing = await readFile(target.path, 'utf8');
      if (existing.includes(MARKER_START) || existing.includes(entry)) {
        return 'already-present';
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  for (const target of targets) {
    await mkdir(dirname(target.path), { recursive: true });
    const snippet = target.syntax === 'fish'
      ? buildFishPathSnippet(entry)
      : buildPosixPathSnippet(entry);
    await appendFile(target.path, snippet, 'utf8');
  }

  return 'updated';
}

function getWindowsPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  return join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

async function ensureWindowsPathEntry(
  entry: string,
  options: EnsureManagedNpmPrefixOnUserPathOptions,
): Promise<UserPathUpdateStatus> {
  const helperPath = join(options.managedBinDir ?? getManagedBinDir(), 'update-user-path.ps1');
  if (!existsSync(helperPath)) {
    throw new Error(`PATH helper not found at ${helperPath}`);
  }

  const spawnImpl = options.spawnImpl ?? spawn;

  return await new Promise<UserPathUpdateStatus>((resolve, reject) => {
    const child = spawnImpl(
      getWindowsPowerShellPath(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        helperPath,
        '-Action',
        'add',
        '-CliDir',
        entry,
      ],
      {
        env: options.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
        return;
      }

      const status = stdout.trim();
      if (status === 'updated' || status === 'already-present') {
        resolve(status);
        return;
      }

      reject(new Error(`Unexpected PowerShell output: ${status || '(empty)'}`));
    });
  });
}

export async function ensureManagedNpmPrefixOnUserPath(
  prefixDir: string,
  options: EnsureManagedNpmPrefixOnUserPathOptions = {},
): Promise<UserPathUpdateStatus> {
  const entry = getManagedNpmBinDir(prefixDir);
  if (process.platform === 'win32') {
    return ensureWindowsPathEntry(entry, options);
  }

  return ensurePosixPathEntry(entry, options);
}
