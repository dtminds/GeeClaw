import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;
const tempDirs: string[] = [];

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

function createMockChildProcess(output: string, code = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  setTimeout(() => {
    if (output) {
      child.stdout.emit('data', Buffer.from(output));
    }
    child.emit('close', code);
  }, 0);

  return child;
}

describe('user-path', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('adds GeeClaw managed npm bin to zsh profiles on macOS', async () => {
    setPlatform('darwin');
    const homeDir = mkdtempSync(join(tmpdir(), 'geeclaw-user-path-'));
    tempDirs.push(homeDir);
    const prefixDir = join(homeDir, '.geeclaw', 'npm-global');

    const { ensureManagedNpmPrefixOnUserPath } = await import('@electron/utils/user-path');

    const status = await ensureManagedNpmPrefixOnUserPath(prefixDir, {
      homeDir,
      shell: '/bin/zsh',
      currentPath: '/usr/bin:/bin',
    });

    expect(status).toBe('updated');
    const zprofilePath = join(homeDir, '.zprofile');
    const zshrcPath = join(homeDir, '.zshrc');
    expect(existsSync(zprofilePath)).toBe(true);
    expect(existsSync(zshrcPath)).toBe(true);
    expect(readFileSync(zprofilePath, 'utf8')).toContain(join(homeDir, '.geeclaw', 'npm-global', 'bin'));
    expect(readFileSync(zshrcPath, 'utf8')).toContain('# >>> GeeClaw managed npm PATH >>>');
  });

  it('does not rewrite profiles when the managed npm bin is already on PATH', async () => {
    setPlatform('darwin');
    const homeDir = mkdtempSync(join(tmpdir(), 'geeclaw-user-path-'));
    tempDirs.push(homeDir);
    const prefixDir = join(homeDir, '.geeclaw', 'npm-global');
    const managedBinDir = join(prefixDir, 'bin');

    const { ensureManagedNpmPrefixOnUserPath } = await import('@electron/utils/user-path');

    const status = await ensureManagedNpmPrefixOnUserPath(prefixDir, {
      homeDir,
      shell: '/bin/zsh',
      currentPath: `${managedBinDir}:/usr/bin:/bin`,
    });

    expect(status).toBe('already-present');
    expect(existsSync(join(homeDir, '.zprofile'))).toBe(false);
    expect(existsSync(join(homeDir, '.zshrc'))).toBe(false);
  });

  it('uses the Windows PATH helper for managed npm installs', async () => {
    setPlatform('win32');
    const { ensureManagedNpmPrefixOnUserPath } = await import('@electron/utils/user-path');
    const spawnImpl = vi.fn(() => createMockChildProcess('updated'));
    const managedBinDir = mkdtempSync(join(tmpdir(), 'geeclaw-user-path-win-'));
    tempDirs.push(managedBinDir);
    mkdirSync(managedBinDir, { recursive: true });
    writeFileSync(join(managedBinDir, 'update-user-path.ps1'), 'Write-Output "updated"\n', 'utf8');

    const status = await ensureManagedNpmPrefixOnUserPath('C:\\Users\\me\\AppData\\Roaming\\GeeClaw\\npm-global', {
      managedBinDir,
      spawnImpl,
      env: {},
    });

    expect(status).toBe('updated');
    expect(spawnImpl).toHaveBeenCalledWith(
      expect.stringContaining('powershell.exe'),
      expect.arrayContaining([
        '-File',
        join(managedBinDir, 'update-user-path.ps1'),
        '-Action',
        'add',
        '-CliDir',
        'C:\\Users\\me\\AppData\\Roaming\\GeeClaw\\npm-global',
      ]),
      expect.objectContaining({
        windowsHide: true,
      }),
    );
  });
});
